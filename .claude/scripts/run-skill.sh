#!/usr/bin/env bash
#
# Manual launcher — runs one plan skill headless in THIS checkout.
#
#   bash .claude/scripts/run-skill.sh <skill> <plan file> [--dry-run]
#
#   <skill>   skill-2-implement (or "implement", the name the plans dashboard
#             sends to a wrapper launcher; it maps to skill-2-implement)
#
# This repo has .claude/scripts/auto-pipeline.sh, so the plans dashboard uses the
# pipeline (a worktree per plan, a report, a draft PR) and ignores this script.
# Use this script only for a quick manual run in the current checkout.
#
# Why a wrapper and not `claude -p ...`: a headless session does not honour the
# allowlist in .claude/settings.json, and a denied tool call is not a pause — it
# fails. Rules passed on the command line with --allowedTools are honoured, so
# this script reads the repo's own settings files and replays them. One source of
# truth for both modes.
#
# It runs in the repo itself, NOT a worktree: a run edits the files you have open
# in your editor. Launch one plan at a time.
#
# The skill writes no dashboard report: Claude Code refuses edits under ~/.claude,
# where the dashboard keeps $PLAN_REPORT, so the exit code decides the result.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

SKILL="${1:-}"
PLAN="${2:-}"
DRY_RUN=false
[ "${3:-}" = "--dry-run" ] && DRY_RUN=true

# --- EDIT 1: the skills this launcher is allowed to run ----------------------
case "$SKILL" in
  skill-2-implement) ;;
  implement) SKILL="skill-2-implement" ;;
  *) echo "usage: run-skill.sh <skill-2-implement|implement> <plan file> [--dry-run]" >&2; exit 2 ;;
esac

command -v claude >/dev/null || { echo "claude CLI not found on PATH" >&2; exit 1; }
command -v jq >/dev/null     || { echo "jq not found on PATH" >&2; exit 1; }
[ -n "$PLAN" ] || { echo "usage: run-skill.sh <skill> <plan file> [--dry-run]" >&2; exit 2; }
[ -f "$PLAN" ] || { echo "plan file not found: $PLAN" >&2; exit 1; }

# --- EDIT 2: rules this run needs beyond the repo's own settings -------------
# Keep it to what the run writes; put everything reusable in .claude/settings.json
# so interactive sessions get it too. Never add push or PR rules here.
RUN_SETTINGS="$(mktemp -t launcher-settings)"
trap 'rm -f "$RUN_SETTINGS"' EXIT
jq -n --arg repo "$REPO" '($repo | ltrimstr("/")) as $r | {
  permissions: { allow: [
    ("Read(//" + $r + "/.plans/**)"),
    ("Edit(//" + $r + "/.plans/**)")
  ] }
}' > "$RUN_SETTINGS"

SETTINGS_FILES=(.claude/settings.json "$RUN_SETTINGS")
[ -f .claude/settings.local.json ] && SETTINGS_FILES+=(.claude/settings.local.json)

ALLOW_RULES=()
while IFS= read -r rule; do
  [ -n "$rule" ] && ALLOW_RULES+=("$rule")
done < <(jq -r -s '[.[].permissions.allow // []] | add | unique | .[]' "${SETTINGS_FILES[@]}" 2>/dev/null)

[ ${#ALLOW_RULES[@]} -gt 0 ] || { echo "no allow rules — is .claude/settings.json valid JSON?" >&2; exit 1; }

PROMPT="/$SKILL $PLAN"

if [ "$DRY_RUN" = true ]; then
  echo "cwd:    $REPO"
  echo "prompt: $PROMPT"
  printf '  %s\n' "${ALLOW_RULES[@]}"
  exit 0
fi

# stream-json is not cosmetic: the dashboard parses it into the activity feed, and
# the session ids it carries tie a run's transcripts to this plan.
exec claude -p "$PROMPT" \
  --permission-mode acceptEdits \
  --allowedTools ${ALLOW_RULES[@]+"${ALLOW_RULES[@]}"} \
  --verbose \
  --output-format stream-json
