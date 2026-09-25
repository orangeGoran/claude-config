#!/usr/bin/env bash
#
# worktree-run.sh — run one plan to completion in its own git worktree.
#
# Repo-agnostic. The plans dashboard calls it once per plan to run a batch in
# parallel, and it works by hand for a single plan:
#
#   scripts/worktree-run.sh --repo ~/Workspace/acme/api \
#       --plan wiki/plans/2026-09-04-thing.md \
#       --prompt '/auto-implement %PLAN%'
#   scripts/worktree-run.sh --repo ~/Workspace/acme/api --cleanup 2026-09-04-thing
#
# Options
#   --repo <path>      repository root (required)
#   --plan <path>      plan file, absolute or relative to the repo (required)
#   --prompt <text>    phase 1 prompt; %PLAN% is replaced with the plan path
#                      relative to the worktree (required). %PLAN%, not {plan}:
#                      the dashboard substitutes {plan} in launcher commands
#                      before this script is ever invoked
#   --base <branch>    branch to fork the worktree from (default: the repo's
#                      current HEAD — the work in progress, not develop)
#   --setup <cmd>      per-repo dependency install, run inside the worktree
#   --copy <paths>     comma-separated gitignored files to copy in (default .env)
#   --review <level>   /code-review level for phase 2 (default: high; "none" skips)
#   --no-submodules    skip `submodule update --init`
#   --dry-run          print the plan of action and exit
#   --cleanup <slug>   remove that run's worktree and auto/<slug> branch
#
# Each plan gets a worktree at <parent-of-repo>/worktrees/<slug> on branch
# auto/<slug>, so parallel runs never share a working tree. The work is left
# uncommitted in the worktree for a human to review.
set -euo pipefail

REPO="" PLAN="" PROMPT="" BASE="" SETUP="" COPY=".env" REVIEW="high"
SUBMODULES=true DRY_RUN=false CLEANUP_SLUG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --plan) PLAN="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --setup) SETUP="$2"; shift 2 ;;
    --copy) COPY="$2"; shift 2 ;;
    --review) REVIEW="$2"; shift 2 ;;
    --no-submodules) SUBMODULES=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --cleanup) CLEANUP_SLUG="$2"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$REPO" ] || { echo "--repo is required" >&2; exit 2; }
REPO="$(cd "${REPO/#\~/$HOME}" && pwd)"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repo: $REPO" >&2; exit 2; }
WORKTREES="$(dirname "$REPO")/worktrees"

# --- cleanup ------------------------------------------------------------------
# Mirrors the create path in reverse. Populated submodules block `git worktree
# remove`, so they are deinitialised first.
if [ -n "$CLEANUP_SLUG" ]; then
  wt="$WORKTREES/$CLEANUP_SLUG"
  branch="auto/$CLEANUP_SLUG"
  if [ -d "$wt" ]; then
    if [ -n "$(git -C "$wt" status --porcelain --ignore-submodules=all)" ]; then
      echo "Refusing to remove $wt — it has uncommitted work."
      echo "Review it, then: git -C \"$REPO\" worktree remove --force \"$wt\""
      exit 1
    fi
    git -C "$wt" submodule deinit -f --all >/dev/null 2>&1 || true
    git -C "$REPO" worktree remove "$wt" \
      || { echo "Removal refused. Re-check, then: git -C \"$REPO\" worktree remove --force \"$wt\""; exit 1; }
    echo "Removed worktree $wt"
  fi
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$REPO" branch -d "$branch" \
      || { echo "Branch $branch is not merged. If you are sure: git -C \"$REPO\" branch -D $branch"; exit 1; }
    echo "Deleted branch $branch"
  fi
  exit 0
fi

[ -n "$PLAN" ]   || { echo "--plan is required" >&2; exit 2; }
[ -n "$PROMPT" ] || { echo "--prompt is required" >&2; exit 2; }
command -v claude >/dev/null || { echo "claude CLI not found on PATH" >&2; exit 1; }
command -v jq >/dev/null     || { echo "jq not found on PATH" >&2; exit 1; }

case "$PLAN" in /*) PLAN_ABS="$PLAN" ;; *) PLAN_ABS="$REPO/$PLAN" ;; esac
[ -f "$PLAN_ABS" ] || { echo "plan file not found: $PLAN_ABS" >&2; exit 1; }
PLAN_REL="${PLAN_ABS#$REPO/}"
SLUG="$(basename "$PLAN_ABS" .md)"
[ -n "$BASE" ] || BASE="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
WT="$WORKTREES/$SLUG"
BRANCH="auto/$SLUG"

# A worktree is checked out from $BASE, so anything the run needs must be
# committed there. Uncommitted skills are the usual cause of a run that starts
# and immediately reports the skill does not exist.
MISSING_ON_BASE=()
git -C "$REPO" cat-file -e "$BASE:$PLAN_REL" 2>/dev/null || MISSING_ON_BASE+=("$PLAN_REL")
# every /skill the prompt invokes must exist on $BASE too — an uncommitted skill
# is the usual cause of a run that starts and reports the command does not exist
for name in $(printf '%s' "$PROMPT" | grep -oE '(^|[[:space:]])/[a-z0-9][a-z0-9-]*' | tr -d ' /'); do
  [ -d "$REPO/.claude/skills/$name" ] || continue
  git -C "$REPO" cat-file -e "$BASE:.claude/skills/$name/SKILL.md" 2>/dev/null \
    || MISSING_ON_BASE+=(".claude/skills/$name/SKILL.md")
done
if [ ${#MISSING_ON_BASE[@]} -gt 0 ]; then
  echo "These are not committed on $BASE, so the worktree will not contain them:" >&2
  printf '  %s\n' "${MISSING_ON_BASE[@]}" >&2
  echo "Commit them first — a worktree is a checkout of $BASE, not a copy of your working tree." >&2
  [ "$DRY_RUN" = true ] || exit 1
fi

if [ "$DRY_RUN" = true ]; then
  cat <<INFO
repo:       $REPO
plan:       $PLAN_REL
slug:       $SLUG
base:       $BASE
worktree:   $WT
branch:     $BRANCH
submodules: $SUBMODULES
copy:       $COPY
setup:      ${SETUP:-<none>}
phase 1:    ${PROMPT//\%PLAN\%/$PLAN_REL}
phase 2:    $([ "$REVIEW" = none ] && echo '<skipped>' || echo "/code-review $REVIEW --fix")
INFO
  exit 0
fi

git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH" \
  && { echo "branch $BRANCH already exists — run --cleanup $SLUG first" >&2; exit 1; }
[ -d "$WT" ] && { echo "worktree $WT already exists — run --cleanup $SLUG first" >&2; exit 1; }

mkdir -p "$WORKTREES"
echo "== $SLUG =="
echo "-> worktree $WT on $BRANCH (from $BASE)"
git -C "$REPO" worktree add "$WT" -b "$BRANCH" "$BASE" >/dev/null

# worktrees do not populate submodules — without this every services/* is empty
if [ "$SUBMODULES" = true ] && [ -f "$REPO/.gitmodules" ]; then
  echo "-> submodule update --init"
  git -C "$WT" submodule update --init || echo "   (submodule init reported errors — continuing)"
fi

# gitignored local files the worktree needs (credentials for private feeds, etc.)
IFS=',' read -ra COPY_PATHS <<< "$COPY"
for rel in "${COPY_PATHS[@]}"; do
  rel="$(echo "$rel" | xargs)"
  [ -n "$rel" ] && [ -e "$REPO/$rel" ] || continue
  mkdir -p "$(dirname "$WT/$rel")"
  cp -R "$REPO/$rel" "$WT/$rel"
  echo "-> copied $rel"
done

# A new worktree is a path Claude Code has never seen, and an untrusted path
# ignores settings allowlists in a headless session — the run then fails at the
# test phase in a way that reads as broken tests. Backed up before editing.
CLAUDE_JSON="$HOME/.claude.json"
if [ -f "$CLAUDE_JSON" ]; then
  [ -f "$CLAUDE_JSON.bak-worktree-run" ] || cp "$CLAUDE_JSON" "$CLAUDE_JSON.bak-worktree-run"
  tmp="$(mktemp)"
  if jq --arg wt "$WT" --arg repo "$REPO" \
      '.projects[$wt].hasTrustDialogAccepted = true
       | .projects[$repo].hasTrustDialogAccepted = true' "$CLAUDE_JSON" > "$tmp"; then
    mv "$tmp" "$CLAUDE_JSON"
    echo "-> worktree marked trusted (backup: $CLAUDE_JSON.bak-worktree-run)"
  else
    rm -f "$tmp"
    echo "WARNING: could not update $CLAUDE_JSON — the run may ignore your allowlist."
  fi
fi

if [ -n "$SETUP" ]; then
  echo "-> setup: $SETUP"
  ( cd "$WT" && eval "$SETUP" ) || { echo "FAIL: setup command failed in $WT" >&2; exit 1; }
fi

# the repo's own allowlist, replayed onto the CLI: settings files are not
# honoured headlessly, --allowedTools rules are
ALLOW_RULES=()
while IFS= read -r rule; do
  [ -n "$rule" ] && ALLOW_RULES+=("$rule")
done < <(jq -r -s '[.[].permissions.allow // []] | add | unique | .[]' \
  "$REPO/.claude/settings.json" \
  "$( [ -f "$REPO/.claude/settings.local.json" ] \
      && echo "$REPO/.claude/settings.local.json" || echo "$REPO/.claude/settings.json" )" \
  2>/dev/null || true)

run_phase() { # $1 = label, $2 = prompt
  echo "-> $1: $2"
  ( cd "$WT" && claude -p "$2" \
      --permission-mode acceptEdits \
      --allowedTools ${ALLOW_RULES[@]+"${ALLOW_RULES[@]}"} \
      --verbose --output-format stream-json )
}

run_phase "phase 1" "${PROMPT//\%PLAN\%/$PLAN_REL}"

# Phase 2 is the environment-agnostic half: /code-review ships with the CLI, so
# every project gets a correctness pass even when it has no validation gate of
# its own. It runs second because a repo's own gate checks plan fidelity and
# conventions, which is the cheaper thing to get wrong.
if [ "$REVIEW" != none ]; then
  run_phase "phase 2" "/code-review $REVIEW --fix — then re-run the tests covering every file the review touched, and report what changed, what still fails, and anything you could not verify. Do not commit."
fi

cat <<DONE

== $SLUG done ==
worktree: $WT
branch:   $BRANCH
review it, then clean up with:
  $(dirname "$0")/worktree-run.sh --repo "$REPO" --cleanup "$SLUG"
DONE
