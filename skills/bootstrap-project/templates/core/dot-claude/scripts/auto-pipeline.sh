#!/usr/bin/env bash
# auto-pipeline.sh — launch unattended plan runs, one git worktree per plan.
#
# Each plan gets its own worktree + auto/<slug> branch (from origin/$BASE_BRANCH; push the plan first)
# and a background headless Claude session that runs /skill-auto-pipeline:
# /skill-2-implement -> /skill-3-test -> /skill-4-verify -> plan to done/ + one commit for the plan ->
# optionally /skill-5-ship (merge the base branch, push auto/<slug>, open a DRAFT PR).
# Progress goes to .plans/auto-runs/<slug>.md. Only --to-pr pushes, and only auto/<slug>.
# Template: claude-config skills/bootstrap-project. The project values are in the
# CONFIG block below; the rest is the same in every repo.
#
# Usage:
#   bash .claude/scripts/auto-pipeline.sh [--stop-at-verify | --full | --to-pr] <plan-file>...
#   bash .claude/scripts/auto-pipeline.sh --resume <slug> [--stop-at-verify | --full | --to-pr]
#   bash .claude/scripts/auto-pipeline.sh --status
#   bash .claude/scripts/auto-pipeline.sh --cleanup <slug>
#
#   <plan-file>       filename in .plans/ (basename or path)
#   --resume <slug>   continue a BLOCKED/FAILED/ENDED run in its existing worktree
#   --stop-at-verify  stop after checks + code review; nothing is committed or pushed
#   --full            also move the plan to .plans/done/ and make one commit; nothing is pushed
#   --to-pr           also merge the base branch, push auto/<slug> and open a DRAFT PR
#   (no mode flag)    asks in a terminal [default: stop at verify]
#   --status          list all runs and their status
#   --cleanup <slug>  remove a run's worktree and auto/<slug> branch (after merge)
#   --describe        print the modes as JSON (read by the plans dashboard)
#
# Every launch and resume runs a preflight first: the allow rules of the commands a run
# needs, PREFLIGHT_CMDS and the browser-test profile in the worktree, and plan-lanes.
# A failure stops the launch with the reason, before the headless session starts.
set -euo pipefail
@@IF MOD_CODEX@@
# codex is often installed in ~/.local/bin, which a non-login shell does not have.
# Append it, so the owner's PATH still decides which claude runs.
export PATH="$PATH:$HOME/.local/bin"
@@END@@

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKTREES_ROOT="$(dirname "$REPO")/worktrees"
WORKTREES_DIR="$WORKTREES_ROOT/$(basename "$REPO")"
RUNS_DIR="$REPO/.plans/auto-runs"

# ============================ CONFIG (@@PROJECT_NAME@@) ============================
# Written by /bootstrap-project from .claude/bootstrap.json. Change the values here
# (or re-run /bootstrap-project --upgrade); keep the rest of the file generic.
# EDIT 1: the branch that worktrees start from and PRs go to.
BASE_BRANCH="@@BASE_BRANCH@@"
# EDIT 2: the install step in a new worktree. Empty INSTALL_CMD = no install step.
# It runs only when INSTALL_MANIFEST exists in the worktree.
INSTALL_CMD="@@INSTALL_CMD@@"
INSTALL_MANIFEST="@@INSTALL_MANIFEST@@"
# EDIT 3: untracked files the main checkout copies into each new worktree.
ENV_FILES=(@@ENV_FILES_BASH@@)
# EDIT 4: extra allow rules for every run (install, services, migrations). A command
# the plan's "How to verify" uses must be here or in .claude/settings.json, or the
# headless run is BLOCKED. Never put push or PR rules here: the PR overlay below has them.
RUN_EXTRA_ALLOW=(@@RUN_EXTRA_ALLOW_BASH@@)
# EDIT 5: the mode the dashboard preselects (verify | commit | pr).
DEFAULT_MODE="@@DEFAULT_MODE@@"
# EDIT 6: bare commands every run needs (for example a generator the browser test reads).
# The preflight runs each once in the new worktree; each must also have an allow rule.
PREFLIGHT_CMDS=(@@PREFLIGHT_BASH@@)
# EDIT 7: the browser-usability-test project of this repo; empty = no browser test.
BROWSER_TEST_PROJECT="@@BROWSER_TEST_PROJECT@@"
# ===================================================================================
# settings that a CONFIG block from an older template does not have
[ -n "${PREFLIGHT_CMDS+x}" ] || PREFLIGHT_CMDS=()
BROWSER_TEST_PROJECT="${BROWSER_TEST_PROJECT:-}"

# --add-dir for a browser-test run: run.mjs runs click scripts only from a temp folder, and a
# headless session writes only in its working directories. /tmp/claude-<uid> holds the
# session scratchpad, so the click script can be written there.
add_dir_args() {
  ADD_DIR_ARGS=()
  [ -n "$BROWSER_TEST_PROJECT" ] || return 0
  local d
  d="$(cd /tmp && pwd -P)/claude-$(id -u)"
  mkdir -p "$d" && ADD_DIR_ARGS=(--add-dir "$d")
  return 0
}

usage() { sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }

now() { date '+%Y-%m-%d %H:%M:%S'; }

# sed -i is different on macOS (BSD) and Linux (GNU)
sed_i() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }

# prints the worktree that has auto/<slug> checked out, or nothing
worktree_of_branch() { # $1 = slug
  git -C "$REPO" worktree list --porcelain \
    | awk -v ref="branch refs/heads/auto/$1" '/^worktree /{ wt = substr($0, 10) } $0 == ref { print wt }'
}

existing_worktree() { # $1 = slug
  local wt
  wt="$(worktree_of_branch "$1")"
  echo "${wt:-$WORKTREES_DIR/$1}"
}

# The report's Outcome and Link lines feed the plans dashboard. Contract:
# claude-config docs/plans-dashboard.md, "Pipeline modes and run reports".
# Only this script writes them, at launch, at resume and after each session.
report_status() { sed -n 's|^## Status: *||p' "$1" | head -n 1; }
report_mode() { sed -n 's|^- \*\*Mode\*\*: *\([a-z]*\).*|\1|p' "$1" | head -n 1; }

# sets `- **<key>**: <value>` directly after the Mode line, and drops an older copy
set_report_line() { # $1 = report path, $2 = key, $3 = value
  awk -v k="$2" -v v="$3" '
    BEGIN { pre = "- **" k "**:"; line = pre " " v }
    index($0, pre) == 1 { if (!done) print line; done = 1; next }
    { print }
    /^- \*\*Mode\*\*:/ && !done { print line; done = 1 }
  ' "$1" > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"
}

# true when the status is where a run in this mode is meant to stop
is_final_status() { # $1 = status, $2 = mode
  case "$1" in
    BLOCKED*|FAILED*|"NEEDS DECISION"*) return 0 ;;
    VERIFIED*) [ "$2" = verify ] ;;
    COMMITTED*) [ "$2" = commit ] ;;
    "PR OPEN"*) [ "$2" = pr ] ;;
    *) return 1 ;;
  esac
}

# derives Outcome (and the PR Link) from the current status
sync_report_outcome() { # $1 = report path
  local status mode outcome url
  status="$(report_status "$1")"
  mode="$(report_mode "$1")"
  case "$status" in
    BLOCKED*|FAILED*|ENDED*) outcome=failed ;;
    "PR OPEN"*|COMMITTED*|"NEEDS DECISION"*) outcome=needs-you ;;
    VERIFIED*) if [ "$mode" = verify ]; then outcome=needs-you; else outcome=running; fi ;;
    *) outcome=running ;;
  esac
  set_report_line "$1" Outcome "$outcome"
  url="$(sed -n 's|^PR: *\(https://[^ ]*\).*|\1|p' "$1" | tail -n 1)"
  case "$status" in
    "PR OPEN"*) [ -n "$url" ] && set_report_line "$1" Link "Open PR | $url" ;;
  esac
  return 0
}

mode_label() {
  case "$1" in
    verify) echo 'stop at verify (nothing committed or pushed)' ;;
    pr) echo "to PR (ship: merge $BASE_BRANCH, push auto/*, draft PR)" ;;
    *) echo 'full (plan to done/ + one local commit, nothing pushed)' ;;
  esac
}

# A headless session can exit early. Then the report keeps a non-final status and the
# dashboard shows the run in progress forever. This marks such a report ENDED.
mark_ended_if_unfinished() { # $1 = report path, $2 = claude exit code
  local old
  old="$(report_status "$1")"
  if ! is_final_status "$old" "$(report_mode "$1")"; then
    sed_i 's|^## Status: .*|## Status: ENDED — session exited before finishing; Resume|' "$1"
    echo "- $(now) — headless session exited (exit code $2) while status was $old; resume to continue" >> "$1"
  fi
  sync_report_outcome "$1"
}

# The install tool must run before any worktree install. A no-op while the repo has
# no INSTALL_MANIFEST (a new repo) or no INSTALL_CMD.
check_install_tool() {
  [ -n "$INSTALL_CMD" ] && [ -f "$REPO/$INSTALL_MANIFEST" ] || return 0
  local tool="${INSTALL_CMD%% *}"
  command -v "$tool" >/dev/null 2>&1 || {
    echo "FATAL: $tool is not on PATH (INSTALL_CMD in the CONFIG block)."; exit 1; }
  # The first use of a newly pinned pnpm version installs that version by itself. Parallel
  # worktree installs at that moment can leave a half-built *_tmp_* folder, and later
  # installs crash. One pnpm command here builds it once, before any worktree install.
  if [ "$tool" = pnpm ]; then
    ( cd "$REPO" && pnpm --version >/dev/null 2>&1 ) || {
      echo "FATAL: pnpm does not run (an interrupted self-install?)."
      echo "       Remove the *_tmp_* folders in the pnpm tools folder (~/Library/pnpm/.tools on macOS,"
      echo "       ~/.local/share/pnpm/.tools on Linux), then run: pnpm --version"
      exit 1
    }
  fi
  return 0
}

# A Read rule for a symlinked folder (~/.claude/skills/<skill> -> a claude-config checkout)
# also needs the real path: the session reads the files where the link points.
real_read_rules() {
  local rule dir real
  for rule in ${RUN_EXTRA_ALLOW[@]+"${RUN_EXTRA_ALLOW[@]}"}; do
    case "$rule" in 'Read(~/'*'/**)') ;; *) continue ;; esac
    dir="${rule#'Read(~/'}"
    dir="$HOME/${dir%'/**)'}"
    [ -L "$dir" ] || continue
    real="$(cd "$dir" 2>/dev/null && pwd -P)" || continue
    echo "Read(/$real/**)"
  done
  return 0
}

# A Bash rule for a tool in the home folder (~/.local/bin/codex) also needs the absolute
# spelling: a session whose PATH lacks the folder calls the tool by its full path, which
# the ~ rule does not match.
home_bash_rules() {
  local rule
  for rule in ${RUN_EXTRA_ALLOW[@]+"${RUN_EXTRA_ALLOW[@]}"}; do
    case "$rule" in 'Bash(~/'*) echo "Bash($HOME/${rule#'Bash(~/'}" ;; esac
  done
  return 0
}

# per-run permission overlay: local commit rights + report writing in the MAIN repo
write_run_settings() { # $1 = output path, $2 = mode (verify|commit|pr)
  # push + PR rights only in pr mode, and only for auto/* branches
  local pr_rules='[]'
  [ "${2:-}" = "pr" ] && pr_rules="$(jq -n --arg b "$BASE_BRANCH" '[
    "Bash(git fetch origin " + $b + ")", "Bash(git merge --no-edit origin/" + $b + ")",
    "Bash(git merge --abort)", "Bash(git rev-list*)",
    "Bash(git push -u origin auto/*)", "Bash(git push origin auto/*)",
    "Bash(gh pr create --draft*)", "Bash(gh pr view*)", "Bash(gh pr edit*)"]')"
  # rules derived from RUN_EXTRA_ALLOW, one per line (a rule can hold spaces and *)
  local derived=() rule
  while IFS= read -r rule; do [ -n "$rule" ] && derived+=("$rule"); done < <(real_read_rules; home_bash_rules)
  jq -n --arg repo "$REPO" --argjson pr "$pr_rules" --args '($repo | ltrimstr("/")) as $r | {
    permissions: { allow: ([
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(git restore*)",
      "Bash(git mv*)",
      "Bash(git rev-parse*)",
      "Bash(git hash-object*)",
      "Bash(mkdir*)",
      ("Read(//" + $r + "/.plans/auto-runs/**)"),
      ("Edit(//" + $r + "/.plans/auto-runs/**)")
    ] + $ARGS.positional + $pr) }
  }' ${RUN_EXTRA_ALLOW[@]+"${RUN_EXTRA_ALLOW[@]}"} ${derived[@]+"${derived[@]}"} > "$1"
}

# merge the repo allowlist + per-run overlay into ALLOW_RULES, passed via --allowedTools:
# CLI rules are honored in untrusted worktrees, settings-file allowlists are not
build_allow_rules() { # $1 = run-settings path
  local files=("$1") f
  for f in "$REPO/.claude/settings.json" "$REPO/.claude/settings.local.json"; do
    [ -f "$f" ] && files+=("$f")
  done
  ALLOW_RULES=()
  while IFS= read -r rule; do
    [ -n "$rule" ] && ALLOW_RULES+=("$rule")
  done < <(jq -r -s 'map(.permissions.allow // []) | add | unique | .[]' \
    "${files[@]}" 2>/dev/null)
  DENY_RULES=()
  while IFS= read -r rule; do
    [ -n "$rule" ] && DENY_RULES+=("$rule")
  done < <(jq -r -s 'map(.permissions.deny // []) | add | unique | .[]' \
    "${files[@]}" 2>/dev/null)
}

# --- preflight ----------------------------------------------------------------
# A run that hits a refused command or a broken generator stops hours later as BLOCKED.
# The preflight finds that before the session starts.

# true when one of the rules ($2...) matches the command $1 the way Claude Code matches
# Bash(...) rules: "*" is any text, a trailing ":*" is a prefix
rule_matches() {
  local cmd="$1" rule pat
  shift
  for rule in "$@"; do
    case "$rule" in 'Bash('*')') ;; *) continue ;; esac
    pat="${rule#Bash(}"
    pat="${pat%)}"
    case "$pat" in *':*') pat="${pat%:\*}*" ;; esac
    # shellcheck disable=SC2053 # the rule is a glob pattern
    [[ "$cmd" == $pat ]] && return 0
  done
  return 1
}

# the commands a run will need, one per line, written the way the session runs them
run_commands() {
  local c
  for c in ${PREFLIGHT_CMDS[@]+"${PREFLIGHT_CMDS[@]}"}; do echo "$c"; done
  if [ -n "$BROWSER_TEST_PROJECT" ]; then
    echo "node $HOME/.claude/skills/browser-usability-test/scripts/profile.mjs resolve"
    echo "QA_APP_URL=http://localhost:3999 node $HOME/.claude/skills/browser-usability-test/scripts/smoke.mjs /"
    echo "node $HOME/.claude/skills/browser-usability-test/scripts/compare.mjs items.json"
    echo "QA_ACCOUNT=x node $HOME/.claude/skills/browser-usability-test/scripts/run.mjs /tmp/flow.mjs"
    echo "curl -s -o /dev/null -w %{http_code} https://github.com/user-attachments/assets/x"
  fi
  return 0
}

# exits when a needed command matches no allow rule, or matches a deny rule
check_run_permissions() {
  local cmd
  local refused=()
  while IFS= read -r cmd; do
    [ -n "$cmd" ] || continue
    if rule_matches "$cmd" ${DENY_RULES[@]+"${DENY_RULES[@]}"}; then
      refused+=("$cmd   (a deny rule matches)")
    elif ! rule_matches "$cmd" ${ALLOW_RULES[@]+"${ALLOW_RULES[@]}"}; then
      refused+=("$cmd")
    fi
  done < <(run_commands)
  [ "${#refused[@]}" -eq 0 ] && return 0
  echo "FATAL: preflight — the headless run would be refused these commands:"
  printf '  %s\n' "${refused[@]}"
  echo "Add an allow rule for each (pipeline.runAllow or pipeline.preflight in .claude/bootstrap.json,"
  echo "then /bootstrap-project --upgrade; or RUN_EXTRA_ALLOW in this script's CONFIG). Nothing was launched."
  exit 1
}

# prints the reason when plan-lanes fails or cannot read the plan's files (stale roots)
lanes_problem() { # $1 = slug
  local out
  [ -f "$REPO/.claude/scripts/plan-lanes.mjs" ] || return 0
  out="$(cd "$REPO" && node .claude/scripts/plan-lanes.mjs --json 2>/dev/null)" \
    || { echo "plan-lanes.mjs --json failed (run it in the repo to see why)"; return 0; }
  printf '%s' "$out" | jq -e . >/dev/null 2>&1 || { echo "plan-lanes.mjs --json did not print JSON"; return 0; }
  printf '%s' "$out" | jq -r --arg s "$1" '
    [(.excluded // [])[] | select(.slug == $s and ((.unresolvedNames // []) | length) > 0
      and ((.reason // "") | startswith("names no code files")))][0] // empty
    | "plan-lanes cannot place the plan: unresolved \(.unresolvedNames | join(", ")); check layout.folders in .claude/bootstrap.json and the roots in plan-lanes.mjs"'
  return 0
}

# runs the needed commands once in the worktree; prints the first problem, or nothing
worktree_problem() { # $1 = worktree, $2 = log, $3 = "fresh" when the tree must stay clean
  local c out dirty
  local argv=()
  for c in ${PREFLIGHT_CMDS[@]+"${PREFLIGHT_CMDS[@]}"}; do
    read -r -a argv <<< "$c"
    echo "-> preflight: $c" >> "$2"
    ( cd "$1" && "${argv[@]}" ) >> "$2" 2>&1 || { echo "\`$c\` failed in the worktree (see the log)"; return 0; }
  done
  if [ -n "$BROWSER_TEST_PROJECT" ]; then
    echo "-> preflight: browser-test profile resolve" >> "$2"
    out="$(cd "$1" && node "$HOME/.claude/skills/browser-usability-test/scripts/profile.mjs" resolve 2>&1)" \
      || { echo "the browser-test profile resolve failed: $(printf '%s' "$out" | tail -n 1)"; return 0; }
    printf '%s' "$out" | jq -e --arg p "$BROWSER_TEST_PROJECT" '.project == $p and ((.missing // []) | length) == 0' >/dev/null 2>&1 \
      || { echo "the browser-test profile is not \"$BROWSER_TEST_PROJECT\" with nothing missing: $(printf '%s' "$out" | jq -c '{project, missing}' 2>/dev/null)"; return 0; }
  fi
  if [ "${3:-}" = fresh ]; then
    dirty="$(git -C "$1" status --porcelain | head -n 5 | tr '\n' ' ')"
    [ -z "$dirty" ] || { echo "the preflight changed files in the worktree (${dirty% }) — gitignore that output"; return 0; }
  fi
  return 0
}

# marks the report BLOCKED with the preflight reason
block_preflight() { # $1 = report, $2 = reason
  sed_i 's|^## Status: .*|## Status: BLOCKED: preflight — see Diagnosis|' "$1"
  printf -- '- %s — preflight failed: %s\n\n## Diagnosis\n\nPreflight: %s. Fix the cause, then Resume.\n' "$(now)" "$2" "$2" >> "$1"
  sync_report_outcome "$1"
}

# --- session compaction -------------------------------------------------------
# The owner often continues a run in VS Code hours later, after the prompt cache expired, and
# each follow-up turn then reads the whole run again (often 400k+ tokens). Right after the run
# the cache is still warm, so a /compact costs one cache read plus the summary, and later turns
# read only the summary. AUTO_PIPELINE_COMPACT_MIN_TOKENS: compact only a context of at least
# this size; 0 turns compaction off.
COMPACT_MIN_TOKENS="${AUTO_PIPELINE_COMPACT_MIN_TOKENS:-150000}"

# what the summary must keep: the owner's follow-ups ("1A 2B", "why is F3 open?") need it
compact_instructions() {
  cat <<'EOF'
This headless auto-pipeline run has ended. The owner continues this session later to ask follow-up questions. Write a summary that keeps, with exact values:
1. The plan slug, the branch, the worktree path, the PR number and URL, the last commit (hash and subject), and what is pushed, what is only committed, and what is uncommitted.
2. The final report status, the phase where the run stopped, and why.
3. Every finding, numbered as the run numbered it, with file:line, a one-line gist, and its state (fixed, deferred, decided, open).
4. Every open decision question exactly as it was written (Question N, the facts, Option A and Option B, the recommended option), so that a reply like "1A 2B" still makes sense.
5. Commands that failed or were refused, checks that were skipped, and manual steps left for the owner.
6. Checks that ran and their results (tests with counts, revert checks, the browser test with its report link), and what was not measured.
7. The paths of the plan, the run report, the validation files, the decision sheet and the evidence files.
8. Background jobs that are still running.
9. Standing rules that the owner gave during the run.
10. The browser test report: its link, its file, the path of its items.json, the QA_DIR and the account that took the shots, and the screenshot names of each finding. Keep this rule word for word: "When a later turn fixes a browser-test finding, or the owner says they fixed one, re-read section 8 of ~/.claude/skills/browser-usability-test/SKILL.md, retake that finding's shots with QA_PHASE=after, set its result in the same items.json and run compare.mjs again, before you say the fix is done."
Before answering a follow-up, re-read the run report, git and gh. Do not answer from this summary alone.
EOF
}

# the transcript folder of a working directory (the same rule as vscode-session-copy.mjs)
session_dir() { echo "$HOME/.claude/projects/$(printf '%s' "$1" | sed 's/[^a-zA-Z0-9]/-/g')"; }

# Prints the session id of the run that just ended, or nothing. The log is shared by every
# session of the plan (launch, each resume, each compaction), so this reads the log only
# after byte $2, and accepts a transcript only when it changed after the marker file $4.
run_session_id() { # $1 = log, $2 = log offset, $3 = session dir, $4 = start marker
  local id f
  id="$(tail -c +"$(( $2 + 1 ))" "$1" 2>/dev/null | grep -F '"subtype":"init"' \
    | jq -rR 'fromjson? | select(.type == "system" and .subtype == "init") | .session_id // empty' 2>/dev/null \
    | head -n 1)"
  if [ -z "$id" ] && [ -d "$3" ]; then
    # transcript names are UUIDs in a folder without spaces, so word splitting is safe
    for f in $(ls -t "$3"/*.jsonl 2>/dev/null); do
      [ "$f" -nt "$4" ] || break
      head -c 65536 "$f" | grep -q '"entrypoint":"sdk-cli"' || continue
      head -c 65536 "$f" | grep -qF '/skill-auto-pipeline ' || continue
      id="$(basename "$f" .jsonl)"; break
    done
  fi
  printf '%s' "$id"
}

# the context size of a transcript, in tokens: what the last main-thread answer reported,
# or the size after the last compaction when no answer came after it
context_tokens() { # $1 = transcript
  grep -E '"type":"assistant"|"subtype":"compact_boundary"' "$1" 2>/dev/null | jq -rR 'fromjson?
    | if .type == "assistant" and .isSidechain != true and .message.usage != null then .message.usage
        | (.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)
      elif .subtype == "compact_boundary" then .compactMetadata.postTokens // empty
      else empty end' 2>/dev/null \
    | tail -n 1
}

compact_skip() { echo "- $(now) — compaction skipped: $1" >> "$2"; } # $1 = reason, $2 = report

# Compacts the session of the run that just ended, and writes one Timeline line either way.
# It never changes the run status. Call it with `|| true`: it must not stop the VS Code copy.
compact_session() { # $1 = worktree, $2 = report, $3 = log, $4 = run settings, $5 = log offset, $6 = start marker
  local dir id file before after boundaries rc=0
  case "$COMPACT_MIN_TOKENS" in
    ''|*[!0-9]*) compact_skip "AUTO_PIPELINE_COMPACT_MIN_TOKENS is not a number ($COMPACT_MIN_TOKENS)" "$2"; return 0 ;;
  esac
  [ "$COMPACT_MIN_TOKENS" -gt 0 ] || { compact_skip "turned off (AUTO_PIPELINE_COMPACT_MIN_TOKENS=0)" "$2"; return 0; }
  dir="$(session_dir "$1")"
  id="$(run_session_id "$3" "$5" "$dir" "$6")"
  [ -n "$id" ] || { compact_skip "no session id in the log or in $dir" "$2"; return 0; }
  file="$dir/$id.jsonl"
  [ -f "$file" ] || { compact_skip "no transcript $file" "$2"; return 0; }
  before="$(context_tokens "$file")"
  [ -n "$before" ] || { compact_skip "no context size in the transcript of session $id" "$2"; return 0; }
  if [ "$before" -lt "$COMPACT_MIN_TOKENS" ]; then
    compact_skip "context $(( before / 1000 ))k is under the $(( COMPACT_MIN_TOKENS / 1000 ))k threshold (session $id)" "$2"
    return 0
  fi
  # the dashboard does not see this process as the run: say why the VS Code copy is not there yet
  echo "- $(now) — compacting session $id ($(( before / 1000 ))k) before the VS Code copy" >> "$2"
  boundaries="$(grep -cF '"subtype":"compact_boundary"' "$file")"
  echo "-> compacting session $id ($before tokens)"
  add_dir_args
  ( cd "$1" && claude -p "/compact $(compact_instructions)" --resume "$id" \
      --permission-mode acceptEdits --settings "$4" ${ADD_DIR_ARGS[@]+"${ADD_DIR_ARGS[@]}"} \
      --verbose --output-format stream-json ) || rc=$?
  if [ "$(grep -cF '"subtype":"compact_boundary"' "$file")" -le "$boundaries" ]; then
    echo "- $(now) — compaction failed (exit code $rc): session $id keeps its full context" >> "$2"
    return 0
  fi
  after="$(grep -F '"subtype":"compact_boundary"' "$file" | tail -n 1 \
    | jq -r '.compactMetadata.postTokens // empty | . / 1000 | floor' 2>/dev/null)"
  echo "- $(now) — session compacted $(( before / 1000 ))k -> ${after:-?}k (session $id)" >> "$2"
}

# runs the headless session in the background; $1 = worktree, $2 = prompt, $3 = report,
# $4 = log, $5 = run settings
start_session() {
  (
    cd "$1"
    { trap '' HUP
      rc=0
      # where this session starts in the shared log, for compact_session
      local log_offset start_mark
      log_offset="$(wc -c < "$4" | tr -d ' ')"
      start_mark="$(mktemp)"
      # keep the Mac awake during the run (macOS only)
      local awake=()
      command -v caffeinate >/dev/null && awake=(caffeinate -i)
      # wait for background subagents and shells (browser test, dev server) instead of
      # stopping them 10 min after the last turn; that ended runs as "session exited"
      export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
      add_dir_args
      nohup ${awake[@]+"${awake[@]}"} claude -p "$2" \
        --permission-mode acceptEdits \
        --settings "$5" \
        ${ADD_DIR_ARGS[@]+"${ADD_DIR_ARGS[@]}"} \
        --allowedTools ${ALLOW_RULES[@]+"${ALLOW_RULES[@]}"} \
        --verbose \
        --output-format stream-json || rc=$?
      mark_ended_if_unfinished "$3" "$rc"
      # now, while the prompt cache is warm; the copy below must start from the summary
      compact_session "$1" "$3" "$4" "$5" "$log_offset" "$start_mark" || true
      rm -f "$start_mark"
      # the VS Code extension hides headless sessions; fork this one into a copy it lists
      node "$REPO/.claude/scripts/vscode-session-copy.mjs" "$1" || true
    } >> "$4" 2>&1 &
    echo "- $(now) — pipeline session started (pid $!)" >> "$3"
  )
}

# --- subcommand: describe -----------------------------------------------------
case "${1:-}" in
  --describe)
    cat <<JSON
{"default":"$DEFAULT_MODE","modes":[
  {"id":"verify","flag":"--stop-at-verify","label":"stop at verify — I review by hand"},
  {"id":"commit","flag":"--full","label":"full — through local commit"},
  {"id":"pr","flag":"--to-pr","label":"to PR — push auto/* and open a draft PR"}]}
JSON
    exit 0 ;;
esac

# --- subcommand: status -------------------------------------------------------
# The state comes from plan-lanes.mjs, not from the report's `## Status:` line. That line
# stops changing when the session ends, so a merged run still reads "PR OPEN". plan-lanes.mjs
# reads the worktree, .plans/done/ and git instead. The report line is shown as a note.
if [ "${1:-}" = "--status" ]; then
  ls "$RUNS_DIR"/*.md >/dev/null 2>&1 || { echo "No runs yet."; exit 0; }
  states="$(node "$(dirname "$0")/plan-lanes.mjs" --json 2>/dev/null \
    | jq -r '[.inFlight[], .awaitingReview[], .needsCleanup[], .staleReports[]]
             | unique_by(.slug) | .[]
             | [.slug, .state, (.shippedCommit // "-")] | @tsv')" || true
  if [ -z "$states" ]; then
    echo "Could not get the run states from plan-lanes.mjs. Raw report status lines:"
    for r in "$RUNS_DIR"/*.md; do
      case "$r" in *-pr-body.md) continue ;; esac
      printf '%-55s %s\n' "$(basename "$r" .md)" "$(report_status "$r" | cut -c1-70)"
    done
    exit 1
  fi
  printf '%-55s %-16s %s\n' "RUN" "STATE" "NOTE"
  while IFS="$(printf '\t')" read -r slug state commit; do
    case "$state" in
      awaiting-review) note="uncommitted in $(existing_worktree "$slug") — review it" ;;
      in-flight)       note="$(report_status "$RUNS_DIR/$slug.md" 2>/dev/null | cut -c1-60 || true)" ;;
      shipped)         note="landed in ${commit}$([ -d "$(existing_worktree "$slug")" ] && echo ' — needs --cleanup' || true)" ;;
      *)               note="report kept for history; no worktree, no branch" ;;
    esac
    printf '%-55s %-16s %s\n' "$slug" "$state" "$note"
  done <<< "$states"
  exit 0
fi

# --- subcommand: cleanup ------------------------------------------------------
if [ "${1:-}" = "--cleanup" ]; then
  slug="${2:?usage: --cleanup <slug>}"
  wt="$(existing_worktree "$slug")"
  branch="auto/$slug"
  if [ -d "$wt" ]; then
    # refuse on real uncommitted work; a moved submodule pointer alone is not work
    if [ -n "$(git -C "$wt" status --porcelain --ignore-submodules=all)" ]; then
      echo "Worktree has uncommitted changes — commit/ship them first, or if truly abandoning:"
      echo "  git -C \"$REPO\" worktree remove --force \"$wt\""
      exit 1
    fi
    if [ -f "$wt/.gitmodules" ]; then
      # uncommitted files inside a submodule are work too: deinit -f would delete them
      if [ -n "$(git -C "$wt" submodule foreach --quiet --recursive 'git status --porcelain' 2>/dev/null)" ]; then
        echo "A submodule in the worktree has uncommitted changes — commit or drop them first, or if truly abandoning:"
        echo "  git -C \"$REPO\" worktree remove --force \"$wt\""
        exit 1
      fi
      # submodules block `git worktree remove`: deinit them, then drop the worktree's
      # modules/ store (git refuses while .git/worktrees/<id>/modules exists, even after deinit)
      git -C "$wt" submodule deinit -f --all >/dev/null 2>&1 || true
      wt_gitdir="$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null || true)"
      case "$wt_gitdir" in */.git/worktrees/*) rm -rf "$wt_gitdir/modules" ;; esac
    fi
    git -C "$REPO" worktree remove "$wt" \
      || { echo "Removal refused. Re-check, then: git -C \"$REPO\" worktree remove --force \"$wt\""; exit 1; }
    echo "Removed worktree $wt"
  fi
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$REPO" branch -d "$branch" \
      || { echo "Branch $branch not merged. If you are sure: git -C \"$REPO\" branch -D $branch"; exit 1; }
    echo "Deleted branch $branch"
  fi
  rm -f "$RUNS_DIR/$slug-settings.json"
  if [ -f "$RUNS_DIR/$slug.md" ]; then
    # the commit that put the plan in .plans/done/ on the base branch, when there is one
    landed="$(git -C "$REPO" log -1 --format=%h "$BASE_BRANCH" -- ".plans/done/$slug.md" 2>/dev/null || true)"
    sed_i "s|^## Status:.*|## Status: CLEANED — ${landed:+shipped in $landed, }worktree and branch removed $(date +%Y-%m-%d)|" "$RUNS_DIR/$slug.md"
    sed_i '/^- \*\*Outcome\*\*:/d' "$RUNS_DIR/$slug.md"
  fi
  # drop remote-tracking refs of merged and deleted branches (origin/auto/<slug>)
  git -C "$REPO" fetch --prune --quiet origin 2>/dev/null || true
  echo "Kept report + log in .plans/auto-runs/ for history (status stamped CLEANED)."
  exit 0
fi

# --- subcommand: resume -------------------------------------------------------
if [ "${1:-}" = "--resume" ]; then
  slug="${2:?usage: --resume <slug> [--stop-at-verify | --full | --to-pr]}"
  shift 2
  STOP_AFTER=""
  for arg in "$@"; do
    case "$arg" in
      --stop-at-verify) STOP_AFTER="verify" ;;
      --full) STOP_AFTER="commit" ;;
      --to-pr) STOP_AFTER="pr" ;;
    esac
  done
  wt="$(existing_worktree "$slug")"
  report="$RUNS_DIR/$slug.md"
  log="$RUNS_DIR/$slug.log"
  run_settings="$RUNS_DIR/$slug-settings.json"
  plan_base="$slug.md"
  [ -d "$wt" ] || { echo "No worktree at $wt — nothing to resume."; exit 1; }
  [ -f "$report" ] || { echo "No report for $slug — nothing to resume."; exit 1; }
  check_install_tool
  if pgrep -f "claude -p /skill-auto-pipeline $plan_base" >/dev/null 2>&1; then
    echo "A pipeline session for $slug is already running."; exit 1
  fi
  if [ -z "$STOP_AFTER" ]; then
    if [ -t 0 ]; then
      printf 'Stop at verify for hands-on review? [Y/n] '
      read -r ans
      case "$ans" in n|N|no|NO) STOP_AFTER="commit" ;; *) STOP_AFTER="verify" ;; esac
    else
      echo "No terminal to ask for mode — pass --stop-at-verify, --full or --to-pr."; exit 1
    fi
  fi
  # a worktree from an older script may have empty submodule folders: check them out
  [ ! -f "$wt/.gitmodules" ] || git -C "$wt" submodule update --init --recursive >> "$log" 2>&1 || true
  write_run_settings "$run_settings" "$STOP_AFTER"
  build_allow_rules "$run_settings"
  check_run_permissions
  problem="$(worktree_problem "$wt" "$log" resume)"
  if [ -n "$problem" ]; then
    echo "SKIP: preflight failed for $slug — $problem"
    block_preflight "$report" "$problem"
    exit 1
  fi
  echo "- $(now) — resume requested (mode: $STOP_AFTER)" >> "$report"
  set_report_line "$report" Mode "$STOP_AFTER ($(mode_label "$STOP_AFTER"))"
  set_report_line "$report" Outcome running
  start_session "$wt" "/skill-auto-pipeline $plan_base --report=$report --stop-after=$STOP_AFTER --base=$BASE_BRANCH --resume — RESUME MODE: a prior session stopped partway (see the report's Status/Timeline). Skip the clean-tree preflight. Read the report, git log and git status, then continue from the first incomplete phase; do not redo completed phases. Do not trust prior claims that a command was permission-blocked: re-run it once before declaring it blocked." \
    "$report" "$log" "$run_settings"
  echo "Resumed $slug."
  echo "   report: .plans/auto-runs/$slug.md"
  echo "   watch:  tail -f .plans/auto-runs/$slug.log"
  exit 0
fi

# --- launch -------------------------------------------------------------------
STOP_AFTER=""
PLANS=()
for arg in "$@"; do
  case "$arg" in
    --stop-at-verify) STOP_AFTER="verify" ;;
    --full) STOP_AFTER="commit" ;;
    --to-pr) STOP_AFTER="pr" ;;
    -h|--help) usage ;;
    *) PLANS+=("$arg") ;;
  esac
done
[ "${#PLANS[@]}" -gt 0 ] || usage
check_install_tool

if [ -z "$STOP_AFTER" ]; then
  if [ -t 0 ]; then
    printf 'Stop at verify for hands-on review? [Y/n] '
    read -r ans
    case "$ans" in n|N|no|NO) STOP_AFTER="commit" ;; *) STOP_AFTER="verify" ;; esac
  else
    echo "No terminal to ask for mode — pass --stop-at-verify, --full or --to-pr."; exit 1
  fi
fi
echo "Mode: $(mode_label "$STOP_AFTER")"

# each worktree is a new path Claude Code treats as untrusted — ask once per invocation
TRUST_WT="no"
if [ -t 0 ]; then
  printf 'Trust the new worktree(s) in ~/.claude.json so the headless run can use your allowlist? [Y/n] '
  read -r tans
  case "$tans" in n|N|no|NO) TRUST_WT="no" ;; *) TRUST_WT="yes" ;; esac
else
  echo "Note: no terminal to ask about worktree trust — rules come from --allowedTools only."
fi
if [ "$TRUST_WT" = "yes" ] && [ -f "$HOME/.claude.json" ]; then
  cp "$HOME/.claude.json" "$HOME/.claude.json.bak-auto-pipeline"
fi

command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
command -v jq >/dev/null || { echo "jq not found"; exit 1; }
# worktrees are created FROM the remote $BASE_BRANCH, so local unpushed commits stay out
BASE_REF="origin/$BASE_BRANCH"
echo "-> fetching $BASE_REF"
git -C "$REPO" fetch --quiet origin "$BASE_BRANCH" \
  || { echo "git fetch origin $BASE_BRANCH failed — check the network and try again."; exit 1; }
git -C "$REPO" cat-file -e "$BASE_REF:.claude/skills/skill-auto-pipeline/SKILL.md" 2>/dev/null \
  || { echo "auto-pipeline skill is not on $BASE_REF yet — push the pipeline system first."; exit 1; }
mkdir -p "$RUNS_DIR" "$WORKTREES_DIR"

# preflight, part 1: the allow rules, once for all plans, before any worktree exists
write_run_settings "$RUNS_DIR/.preflight-settings.json" "$STOP_AFTER"
build_allow_rules "$RUNS_DIR/.preflight-settings.json"
rm -f "$RUNS_DIR/.preflight-settings.json"
check_run_permissions

for plan in "${PLANS[@]}"; do
  plan_base="$(basename "$plan")"
  plan_file="$REPO/.plans/$plan_base"
  [ -f "$plan_file" ] || { echo "SKIP: plan not found: .plans/$plan_base"; continue; }

  slug="${plan_base%.md}"
  branch="auto/$slug"
  wt="$WORKTREES_DIR/$slug"
  report="$RUNS_DIR/$slug.md"
  log="$RUNS_DIR/$slug.log"
  run_settings="$RUNS_DIR/$slug-settings.json"

  existing_wt="$(worktree_of_branch "$slug")"
  [ -z "$existing_wt" ] || { echo "SKIP: worktree $existing_wt already has branch $branch (use --cleanup $slug first)"; continue; }
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "SKIP: branch $branch already exists (use --cleanup $slug first)"; continue
  fi
  [ ! -d "$wt" ] || { echo "SKIP: worktree $wt already exists (use --cleanup $slug first)"; continue; }
  if ! git -C "$REPO" cat-file -e "$BASE_REF:.plans/$plan_base" 2>/dev/null; then
    echo "SKIP: plan not on $BASE_REF: .plans/$plan_base — push it first"; continue
  fi
  problem="$(lanes_problem "$slug")"
  [ -z "$problem" ] || { echo "SKIP: preflight failed for $slug — $problem"; continue; }

  echo "== $slug =="
  echo "-> creating worktree $wt on $branch (from $BASE_REF)"
  git -C "$REPO" worktree add --no-track "$wt" -b "$branch" "$BASE_REF" >/dev/null
  env_missing=()
  for env_file in ${ENV_FILES[@]+"${ENV_FILES[@]}"}; do
    if [ -f "$REPO/$env_file" ]; then
      mkdir -p "$(dirname "$wt/$env_file")"
      cp "$REPO/$env_file" "$wt/$env_file"
    else
      env_missing+=("$env_file")
    fi
  done
  # a missing env file is often a stale ENV_FILES path (the app moved): say it
  [ "${#env_missing[@]}" -eq 0 ] || echo "WARNING: not in the main checkout, not copied: ${env_missing[*]} (ENV_FILES in the CONFIG block)"

  write_run_settings "$run_settings" "$STOP_AFTER"
  build_allow_rules "$run_settings"

  if [ "$TRUST_WT" = "yes" ] && [ -f "$HOME/.claude.json" ]; then
    tmp_json="$(mktemp)"
    if jq --arg wt "$wt" --arg repo "$REPO" \
        '.projects[$wt].hasTrustDialogAccepted = true | .projects[$repo].hasTrustDialogAccepted = true' \
        "$HOME/.claude.json" > "$tmp_json"; then
      mv "$tmp_json" "$HOME/.claude.json"
      echo "-> worktree marked trusted (backup: ~/.claude.json.bak-auto-pipeline)"
    else
      rm -f "$tmp_json"
      echo "WARNING: could not update ~/.claude.json."
    fi
  fi

  cat > "$report" <<EOF
# Auto-pipeline run: $slug

- **Plan**: .plans/$plan_base
- **Branch**: \`$branch\`
- **Worktree**: \`$wt\`
- **Log**: \`.plans/auto-runs/$slug.log\`
- **Mode**: $STOP_AFTER ($(mode_label "$STOP_AFTER"))
- **Outcome**: running
- **Launched**: $(now)

## Status: LAUNCHED

## Timeline

- $(now) — worktree created
EOF
  [ "${#env_missing[@]}" -eq 0 ] || echo "- $(now) — env files not in the main checkout, not copied: ${env_missing[*]}" >> "$report"

  # a new worktree has empty submodule folders; generators, checks and contract
  # syncs read them, so check them out at the commit the base branch pins
  if [ -f "$wt/.gitmodules" ]; then
    echo "-> git submodule update --init --recursive (worktree)"
    git -C "$wt" submodule update --init --recursive >> "$log" 2>&1 \
      || { echo "FAIL: submodule checkout failed for $slug — see $log"
           sed_i 's|^## Status: .*|## Status: FAILED: submodules — see log|' "$report"
           sync_report_outcome "$report"
           echo "- $(now) — submodule checkout failed (access to the submodule remote?); fix the cause and Resume" >> "$report"
           continue; }
    echo "- $(now) — submodules checked out" >> "$report"
  fi

  if [ -n "$INSTALL_CMD" ] && [ -f "$wt/$INSTALL_MANIFEST" ]; then
    echo "-> $INSTALL_CMD (worktree)"
    read -r -a install_argv <<< "$INSTALL_CMD"
    ( cd "$wt" && "${install_argv[@]}" ) >> "$log" 2>&1 \
      || { echo "FAIL: install failed for $slug — see $log"
           # the tool, node and PATH that the install saw: a wrong PATH is a common cause
           { echo "FAIL: install failed at $(now)"
             echo "${install_argv[0]}: $(command -v "${install_argv[0]}" || echo 'NOT ON PATH')  node: $(command -v node || echo 'NOT ON PATH') $(node --version 2>/dev/null || true)"
             echo "PATH=$PATH"
           } >> "$log"
           sed_i 's|^## Status: .*|## Status: FAILED: install — see log|' "$report"
           sync_report_outcome "$report"
           echo "- $(now) — install failed; fix the cause and Resume" >> "$report"
           continue; }
  fi

  # preflight, part 2: the run's commands once in the new worktree
  problem="$(worktree_problem "$wt" "$log" fresh)"
  if [ -n "$problem" ]; then
    echo "SKIP: preflight failed for $slug — $problem (worktree kept; fix the cause, then Resume)"
    block_preflight "$report" "$problem"
    continue
  fi
  echo "- $(now) — preflight passed" >> "$report"

  echo "-> launching headless pipeline (log: .plans/auto-runs/$slug.log)"
  start_session "$wt" "/skill-auto-pipeline $plan_base --report=$report --stop-after=$STOP_AFTER --base=$BASE_BRANCH" \
    "$report" "$log" "$run_settings"
  echo "   report: .plans/auto-runs/$slug.md"
  echo "   watch:  tail -f .plans/auto-runs/$slug.log"
done

echo
echo "Watch progress:  bash .claude/scripts/auto-pipeline.sh --status"
