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
# The guard checks only the repo that holds this script. A `git -C <other repo>
# commit` passes, because the other repo has its own rules.
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
# A second line holds the folder of `git -C <folder> commit`, when there is one.
INPUT=$(cat)
# shellcheck disable=SC2016
CLASSIFY='
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd;
  try {
    cmd = JSON.parse(raw).tool_input?.command ?? "";
  } catch {
    // Unreadable input: block if it looks like a commit.
    if (/\bgit\b[\s\S]*\bcommit\b/.test(raw)) console.log("commit all");
    return;
  }
  // A command inside a quoted shell string (bash -c "...", eval) runs as a commit too.
  const nested = /\b(?:(?:bash|sh|zsh)\s+(?:-\w+\s+)*-\w*c\b|eval\b)/.test(cmd) && /\bgit\b[\s\S]*\bcommit\b/.test(cmd);
  // Remove quoted text, so a commit message or a path cannot look like a command.
  const bare = cmd.replace(/"(?:[^"\\]|\\[\s\S])*"|\x27[^\x27]*\x27/g, "Q");
  const isCommit = /^\s*(?:\w+=\S*\s+)*(?:(?:command|sudo|env)\s+)*git(?:\s+(?:-[cC]\s+\S+|--\S+))*\s+commit(?:\s|$)/;
  const hits = bare.split(/&&|\|\||[;|&()\n`{}]/).filter((s) => isCommit.test(s));
  if (!hits.length && !nested) return;
  const all = nested || hits.some((s) => /(?:^|\s)(?:--all|-[A-Za-z]*a[A-Za-z]*)(?:\s|$)/.test(s));
  console.log(all ? "commit all" : "commit");
  // The -C folder of the commit, read from the full command (a quoted path is kept).
  const opts = cmd.match(/\bgit((?:\s+(?:-c\s+\S+|-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+)|--\S+))*)\s+commit(?:\s|$)/);
  const dirs = opts ? [...opts[1].matchAll(/-C\s+("[^"]*"|\x27[^\x27]*\x27|\S+)/g)].map((m) => m[1].replace(/^["\x27]|["\x27]$/g, "")) : [];
  if (dirs.length && !nested) console.log(dirs[dirs.length - 1]);
});
'
CLASSIFIED=$(printf '%s' "$INPUT" | node -e "$CLASSIFY")
VERDICT=$(printf '%s\n' "$CLASSIFIED" | sed -n 1p)
COMMIT_DIR=$(printf '%s\n' "$CLASSIFIED" | sed -n 2p)

# Only a git commit can be blocked (not git status, diff, log, and so on).
if [ -z "$VERDICT" ]; then
  exit 0
fi

# This guard owns only its own repo: the repo that holds this script. A commit in
# another repo (`git -C <other repo> commit`) passes; that repo's own guard checks it.
GUARD_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "")"
case "$COMMIT_DIR" in "~"|"~/"*) COMMIT_DIR="$HOME${COMMIT_DIR#\~}" ;; esac
REPO_ROOT="$(git -C "${COMMIT_DIR:-.}" rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -n "$GUARD_ROOT" ] && [ -n "$REPO_ROOT" ] && [ "$REPO_ROOT" != "$GUARD_ROOT" ]; then
  exit 0
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
