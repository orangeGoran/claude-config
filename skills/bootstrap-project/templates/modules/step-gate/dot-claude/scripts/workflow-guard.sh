#!/usr/bin/env bash
#
# Workflow guard — blocks `git commit` until the plan's workflow steps are done.
# Called as a PreToolUse hook on Bash (.claude/settings.json); receives the tool
# input as JSON on stdin. Exit 2 blocks the command and shows stderr to Claude.
#
# A finished plan lives in .plans/done/. An open plan keeps its step flags in
# .plans/.workflow-state/<plan-name>/ (implement, test, verify, document), written
# by .claude/scripts/workflow-complete-step.sh.
#
# The guard checks every worktree of its own repo (the same git common dir): it
# reads the branch, the index and `.plans/` of the worktree the commit runs in
# (the `cd` and `-C` folders of the command in shell order, from the hook input's
# `cwd`). A commit whose folder it cannot tell is blocked. A commit in another
# repo passes, because the other repo has its own rules.
#
# Allowed without flags:
#   - commits on an auto/* branch (the pipeline makes one commit for the plan there),
#   - commits that stage only files under .plans/ (plans and validation files),
#   - a commit that adds a plan to .plans/done/ (the plan is finished),
#   - follow-up commits on a branch that already finished its plan.
#
set -euo pipefail

# --- EDIT 1: the base branch that PRs go to ----------------------------------
BASE_BRANCH="@@BASE_BRANCH@@"

# Parse the command with a real JSON parser. A regex stops at the first escaped
# quote and misses a commit later in the command.
# Prints nothing for no commit, "commit" for a commit, "commit all" with -a/--all.
# A second line holds the folder the commit runs in (absolute), or "unknown" when
# the guard cannot tell it. A nested command (bash -c, eval) gets the hook input's
# folder, or "unknown" when its text has a cd, a pushd or a -C.
INPUT=$(cat)
# The script below is one single-quoted shell string: it must hold no single quote,
# also not in a comment (write \x27 in a regex, and "of the hook input", not an apostrophe).
# shellcheck disable=SC2016
CLASSIFY='
const path = require("path");
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd, cwd;
  try {
    const j = JSON.parse(raw);
    cmd = j.tool_input?.command ?? "";
    cwd = typeof j.cwd === "string" && j.cwd ? j.cwd : process.cwd();
  } catch {
    // Unreadable input: block if it looks like a commit.
    if (/\bgit\b[\s\S]*\bcommit\b/.test(raw)) console.log("commit all");
    return;
  }
  // A command inside a quoted shell string (bash -c "...", eval) runs as a commit too.
  const nested = /\b(?:(?:bash|sh|zsh)\s+(?:-\w+\s+)*-\w*c\b|eval\b)/.test(cmd) && /\bgit\b[\s\S]*\bcommit\b/.test(cmd);
  // Put a sentinel in place of each quoted text, so a commit message or a path cannot look like a command
  // and a separator inside quotes never splits a segment. The texts stay in order, to read the words back.
  const quoted = [];
  // A backslash outside quotes makes the next character plain: `\x27` or `\"` there opens no quoted text.
  const bare = cmd.replace(/\\[\s\S]|"(?:[^"\\]|\\[\s\S])*"|\x27[^\x27]*\x27/g, (q) => {
    quoted.push(q[0] === "\\" ? q.slice(1) : q[0] === "\"" ? q.slice(1, -1).replace(/\\([\s\S])/g, "$1") : q.slice(1, -1));
    return "\u0001" + (quoted.length - 1) + "\u0001";
  })
    // a redirection with `&` (2>&1, >&2, &>file) is one more word, not a background `&`; `|&` is a pipe
    .replace(/\|&/g, "|").replace(/\d*[<>]&\d*-?|&>>?/g, " \u0002 ");
  const words = (s) => s.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/\u0001(\d+)\u0001/g, (m, i) => quoted[+i]));
  const home = (w) => (w === "~" || w.startsWith("~/") ? (process.env.HOME || "") + w.slice(1) : w);
  const unreadable = (w) => !w || w === "-" || /[$`*?[\]{}]/.test(w) || (w[0] === "~" && w !== "~" && !w.startsWith("~/"));
  // The folder that `cd w` or `-C w` gives from folder d, as the system follows it: one part at a time, each link
  // to its real folder, so `link/..` is the parent of the real folder. A folder that does not exist gives null (unknown).
  const fs = require("fs");
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  const move = (d, w) => {
    if (d === null || unreadable(w)) return null;
    const to = home(w);
    let at = to.startsWith("/") ? "/" : d;
    for (const part of to.split("/")) {
      if (!part || part === ".") continue;
      at = part === ".." ? path.dirname(at) : real(path.join(at, part));
      if (at === null) return null;
    }
    return fs.existsSync(at) && fs.statSync(at).isDirectory() ? at : null;
  };
  // shell words that can come before a command in the same shell (`then cd x`, `! git commit`)
  const LEAD = ["if", "then", "else", "elif", "do", "while", "until", "!", "time", "builtin", "command"];
  const isCommit = /^\s*(?:(?:if|then|else|elif|do|while|until|!|time)\s+)*(?:\w+=\S*\s+)*(?:(?:command|sudo|env)\s+)*git(?:\s+(?:-[cC]\s+\S+|--\S+))*\s+commit(?:\s|$)/;
  // Walk the segments in shell order: each `cd <folder>` moves the folder; each commit takes the folder it has then.
  // A `(` or a backtick starts a subshell: the folder goes back at its end, so `(cd x && ls); git commit` commits here.
  // Each part of a pipeline (`|`) and a part before a background `&` also runs in a subshell: its `cd` does not move
  // the folder. A `cd`, `pushd` or `popd` word that the guard cannot follow makes the folder unknown.
  // A `cd` that may not run is a guess: after `||` or a shell keyword (`if false; then cd x; fi`) the folder is unknown;
  // after `&&` it counts only while each separator up to the commit is `&&` (`false && cd x; git commit` is unknown).
  const COND = ["if", "then", "else", "elif", "do", "while", "until"];
  const SEPS = ["&&", "||", ";", "|", "&", "\n", "{", "}"];
  // GIT_DIR, GIT_WORK_TREE and the like (also from an export) move the commit to a folder the guard does not follow.
  const gitEnv = /\bGIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY)=/.test(bare);
  let dir = gitEnv ? null : real(cwd), tick = false, maybe = false;
  const hits = [], dirs = [], subshells = [];
  const parts = bare.split(/(&&|\|\||[;|&()\n`{}])/);
  for (let k = 0; k < parts.length; k++) {
    const seg = parts[k];
    if (seg === "(" || (seg === "`" && !tick)) { subshells.push(dir); if (seg === "`") tick = true; continue; }
    if (seg === ")" || seg === "`") { if (subshells.length) dir = subshells.pop(); if (seg === "`") tick = false; continue; }
    if (SEPS.includes(seg)) { if (maybe && seg !== "&&") { dir = null; maybe = false; } continue; }
    const w = words(seg);
    let keyword = false;
    while (w.length > 1 && LEAD.includes(w[0])) { if (COND.includes(w[0])) keyword = true; w.shift(); }
    if (w[0] === "cd") {
      const alone = parts[k - 1] === "|" || ["|", "&"].includes(parts[k + 1]);
      if (alone) continue;
      dir = w.length === 2 ? move(dir, w[1]) : null;
      if (keyword || parts[k - 1] === "||") dir = null;
      else if (parts[k - 1] === "&&") maybe = true;
      continue;
    }
    // pushd and popd keep a folder stack that the guard does not follow
    if (w[0] === "pushd" || w[0] === "popd") { dir = null; continue; }
    if (!isCommit.test(seg)) {
      // a bare cd word elsewhere (sudo cd x, xargs cd): the folder is unknown; a quoted "cd" is a sentinel here
      if (seg.trim().split(/\s+/).some((x) => x === "cd" || x === "pushd" || x === "popd")) dir = null;
      continue;
    }
    hits.push(seg);
    // the -C options of this commit, in order, as git applies them; they do not move the folder of later segments
    let d = dir;
    const at = w.indexOf("git");
    for (let i = at + 1; i < w.length && w[i] !== "commit"; i++) {
      if (w[i] === "-C") d = move(d, w[++i]);
      else if (w[i] === "-c") i++;
      // --git-dir and --work-tree move the commit to a folder the guard does not follow
      else if (/^--(?:git-dir|work-tree|namespace)(?:=|$)/.test(w[i])) d = null;
    }
    dirs.push(d);
  }
  if (!hits.length && !nested) return;
  const all = nested || hits.some((s) => /(?:^|\s)(?:--all|-[A-Za-z]*a[A-Za-z]*)(?:\s|$)/.test(s));
  console.log(all ? "commit all" : "commit");
  // A nested commit runs in the folder of the hook input, unless the nested text can move it (cd, -C, pushd): then unknown.
  if (nested) { console.log(gitEnv || /\b(?:cd|pushd|popd)\b|(?:^|\s)-C(?:\s|$)|--(?:git-dir|work-tree|namespace)\b/.test(cmd) || !real(cwd) ? "unknown" : real(cwd)); return; }
  console.log(dirs.every((d) => d !== null && d === dirs[0]) ? dirs[0] : "unknown");
});
'
CLASSIFIED=$(printf '%s' "$INPUT" | node -e "$CLASSIFY")
VERDICT=$(printf '%s\n' "$CLASSIFIED" | sed -n 1p)
COMMIT_DIR=$(printf '%s\n' "$CLASSIFIED" | sed -n 2p)

# Only a git commit can be blocked (not git status, diff, log, and so on).
if [ -z "$VERDICT" ]; then
  exit 0
fi

# A commit whose folder the guard cannot tell is never checked against another
# worktree's exemptions (auto/*, plan-only files): it is blocked.
if [ "$COMMIT_DIR" = "unknown" ]; then
  echo "BLOCKED: cannot tell which worktree this commit runs in. Run one commit per command, as \`git -C <folder> commit\`." >&2
  exit 2
fi

# This guard owns its own repo: every worktree with the same git common dir. A commit
# in another repo (`git -C <other repo> commit`) passes; that repo's own guard checks it.
# --git-common-dir can be relative to the folder: cd resolves it. `|| true` keeps
# set -e from ending the hook with exit 1, which would let the commit run unchecked.
# A folder that is no git repo gives nothing (git prints no common dir, and `cd ""` would stay in the folder).
common() { (cd "$1" 2>/dev/null && d=$(git rev-parse --git-common-dir 2>/dev/null) && [ -n "$d" ] && cd "$d" 2>/dev/null && pwd -P) || true; }
GUARD_COMMON=$(common "$(dirname "$0")")
COMMIT_COMMON=$(common "${COMMIT_DIR:-.}")
if [ -n "$GUARD_COMMON" ] && [ -n "$COMMIT_COMMON" ] && [ "$GUARD_COMMON" != "$COMMIT_COMMON" ]; then
  exit 0
fi
GUARD_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "")"
REPO_ROOT="$(git -C "${COMMIT_DIR:-.}" rev-parse --show-toplevel 2>/dev/null || echo "")"
# A named folder that is no worktree is never checked against the guard's own folder (its exemptions could differ).
if [ -n "$COMMIT_DIR" ] && { [ -z "$COMMIT_COMMON" ] || [ -z "$REPO_ROOT" ]; }; then
  echo "BLOCKED: the folder of this commit is not a worktree of a git repo: $COMMIT_DIR" >&2
  exit 2
fi
REPO_ROOT="${REPO_ROOT:-${GUARD_ROOT:-.}}"
STATE_DIR="$REPO_ROOT/.plans/.workflow-state"

# Allow commits on a pipeline branch. /skill-auto-pipeline makes one commit for
# the whole plan on auto/<slug>; the review is the PR.
BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)
case "$BRANCH" in
  auto/*) exit 0 ;;
esac

# Allow plan-only commits (plan files and validation files are not production code).
# Two conditions, both required: no -a/--all (it would add unstaged files that the
# index check cannot see), and every staged path is under .plans/.
if [ "$VERDICT" != "commit all" ]; then
  STAGED=$(git -C "$REPO_ROOT" diff --cached --name-only 2>/dev/null || true)
  if [ -n "$STAGED" ] && ! echo "$STAGED" | grep -qv '^\.plans/'; then
    exit 0
  fi
fi

# Allow a commit that finishes a plan. workflow-complete-step.sh moves the plan
# file to .plans/done/ after the last step, so the commit adds that file.
# --no-renames shows the move as an add, not as a rename.
DONE_ADDED=$(git -C "$REPO_ROOT" diff --cached --no-renames --diff-filter=A --name-only -- '.plans/done/*.md' 2>/dev/null || true)
if [ -n "$DONE_ADDED" ]; then
  exit 0
fi

# Allow a follow-up commit on a branch that already finished its plan
# (/skill-5-ship commits the checks' output after it merges the base branch).
# The three-dot diff starts at the merge base, so plans that the base branch
# finished do not count.
BRANCH_DONE=$(git -C "$REPO_ROOT" diff --no-renames --diff-filter=A --name-only "origin/$BASE_BRANCH...HEAD" -- '.plans/done/*.md' 2>/dev/null || true)
if [ -n "$BRANCH_DONE" ]; then
  exit 0
fi

# A hook shows Claude only stderr, so the reason goes there.
exec 1>&2
echo "BLOCKED: This commit does not finish a plan."
echo ""
echo "A plan file moves to .plans/done/ after its last step. Open plans:"
for plan_file in "$REPO_ROOT"/.plans/*.md; do
  [ -f "$plan_file" ] || continue
  plan_name=$(basename "$plan_file" .md)
  # A plan has no state folder until its first step, so ls can fail here.
  steps=$(ls "$STATE_DIR/$plan_name" 2>/dev/null | sed 's/\.done$//' | tr '\n' ' ' || true)
  echo "  - $plan_name: done steps: ${steps:-none}"
done
echo ""
echo "Complete all steps before you commit:"
echo "  /skill-1-plan → /skill-auto-validate-plan → /skill-2-implement → /skill-3-test → /skill-4-verify → /skill-5-ship"
echo "Each step marks itself done with: bash .claude/scripts/workflow-complete-step.sh <plan-name> <implement|test|verify|document>"
exit 2
