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
# ===================================================================================

usage() { sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }

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
  jq -n --arg repo "$REPO" --argjson pr "$pr_rules" --args '($repo | ltrimstr("/")) as $r | {
    permissions: { allow: ([
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(git restore*)",
      "Bash(git mv*)",
      "Bash(git rev-parse*)",
      "Bash(mkdir*)",
      ("Read(//" + $r + "/.plans/auto-runs/**)"),
      ("Edit(//" + $r + "/.plans/auto-runs/**)")
    ] + $ARGS.positional + $pr) }
  }' ${RUN_EXTRA_ALLOW[@]+"${RUN_EXTRA_ALLOW[@]}"} > "$1"
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
}

# runs the headless session in the background; $1 = worktree, $2 = prompt, $3 = report,
# $4 = log, $5 = run settings
start_session() {
  (
    cd "$1"
    { trap '' HUP
      rc=0
      # keep the Mac awake during the run (macOS only)
      local awake=()
      command -v caffeinate >/dev/null && awake=(caffeinate -i)
      nohup ${awake[@]+"${awake[@]}"} claude -p "$2" \
        --permission-mode acceptEdits \
        --settings "$5" \
        --allowedTools ${ALLOW_RULES[@]+"${ALLOW_RULES[@]}"} \
        --verbose \
        --output-format stream-json || rc=$?
      mark_ended_if_unfinished "$3" "$rc"
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
    if [ -n "$(git -C "$wt" status --porcelain)" ]; then
      echo "Worktree has uncommitted changes — commit/ship them first, or if truly abandoning:"
      echo "  git -C \"$REPO\" worktree remove --force \"$wt\""
      exit 1
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
    sed_i "s|^## Status:.*|## Status: CLEANED — worktree and branch removed $(date +%Y-%m-%d)|" "$RUNS_DIR/$slug.md"
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
  write_run_settings "$run_settings" "$STOP_AFTER"
  build_allow_rules "$run_settings"
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

  echo "== $slug =="
  echo "-> creating worktree $wt on $branch (from $BASE_REF)"
  git -C "$REPO" worktree add --no-track "$wt" -b "$branch" "$BASE_REF" >/dev/null
  for env_file in ${ENV_FILES[@]+"${ENV_FILES[@]}"}; do
    if [ -f "$REPO/$env_file" ]; then
      mkdir -p "$(dirname "$wt/$env_file")"
      cp "$REPO/$env_file" "$wt/$env_file"
    fi
  done

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

  if [ -n "$INSTALL_CMD" ] && [ -f "$wt/$INSTALL_MANIFEST" ]; then
    echo "-> $INSTALL_CMD (worktree)"
    read -r -a install_argv <<< "$INSTALL_CMD"
    ( cd "$wt" && "${install_argv[@]}" ) >> "$log" 2>&1 \
      || { echo "FAIL: install failed for $slug — see $log"
           sed_i 's|^## Status: .*|## Status: FAILED: install — see log|' "$report"
           sync_report_outcome "$report"
           echo "- $(now) — install failed; fix the cause and Resume" >> "$report"
           continue; }
  fi

  echo "-> launching headless pipeline (log: .plans/auto-runs/$slug.log)"
  start_session "$wt" "/skill-auto-pipeline $plan_base --report=$report --stop-after=$STOP_AFTER --base=$BASE_BRANCH" \
    "$report" "$log" "$run_settings"
  echo "   report: .plans/auto-runs/$slug.md"
  echo "   watch:  tail -f .plans/auto-runs/$slug.log"
done

echo
echo "Watch progress:  bash .claude/scripts/auto-pipeline.sh --status"
