#!/usr/bin/env bash
#
# Dashboard launcher template — copy into your repo as .claude/scripts/run-skill.sh
# and edit the two marked spots.
#
#   bash .claude/scripts/run-skill.sh <skill> <plan file> [--dry-run]
#
# Then register it as the launcher command for the project:
#   { "label": "Implement", "cmd": "bash .claude/scripts/run-skill.sh implement {plan}" }
#
# Why a wrapper rather than `claude -p ...` straight from the registry: a
# headless session does not honour the allowlist in .claude/settings.json, and a
# denied tool call is not a pause — it fails. The run then reports problems that
# never happened ("git status failed", "the test suite is missing"). Rules passed
# on the command line via --allowedTools are honoured, so this script reads the
# repo's own settings files and replays them. One source of truth, both modes.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

SKILL="${1:-}"
PLAN="${2:-}"
DRY_RUN=false
[ "${3:-}" = "--dry-run" ] && DRY_RUN=true

# --- EDIT 1: the skills this launcher is allowed to run ----------------------
case "$SKILL" in
  implement|review) ;;
  *) echo "usage: run-skill.sh <implement|review> [plan file] [--dry-run]" >&2; exit 2 ;;
esac

command -v claude >/dev/null || { echo "claude CLI not found on PATH" >&2; exit 1; }
command -v jq >/dev/null     || { echo "jq not found on PATH" >&2; exit 1; }
[ -z "$PLAN" ] || [ -f "$PLAN" ] || { echo "plan file not found: $PLAN" >&2; exit 1; }

# --- EDIT 2: rules this run needs beyond the repo's own settings -------------
# Keep it to what the run writes; put everything reusable in .claude/settings.json
# so interactive sessions get it too.
RUN_SETTINGS="$(mktemp -t launcher-settings)"
trap 'rm -f "$RUN_SETTINGS"' EXIT
jq -n --arg repo "$REPO" '($repo | ltrimstr("/")) as $r | {
  permissions: { allow: [
    ("Read(//" + $r + "/.plans/**)"),
    ("Edit(//" + $r + "/.plans/**)")
  ] }
}' > "$RUN_SETTINGS"

ALLOW_RULES=()
while IFS= read -r rule; do
  [ -n "$rule" ] && ALLOW_RULES+=("$rule")
done < <(jq -r -s '[.[].permissions.allow // []] | add | unique | .[]' \
  .claude/settings.json \
  "$( [ -f .claude/settings.local.json ] && echo .claude/settings.local.json || echo "$RUN_SETTINGS" )" \
  "$RUN_SETTINGS" 2>/dev/null)

[ ${#ALLOW_RULES[@]} -gt 0 ] || { echo "no allow rules — is .claude/settings.json valid JSON?" >&2; exit 1; }

PROMPT="/$SKILL${PLAN:+ $PLAN}"

if [ "$DRY_RUN" = true ]; then
  echo "cwd:    $REPO"
  echo "prompt: $PROMPT"
  printf '  %s\n' "${ALLOW_RULES[@]}"
  exit 0
fi

# stream-json is not cosmetic: the dashboard parses it into the activity feed, and
# the session ids it carries are how a run's transcripts get tied to this plan.
exec claude -p "$PROMPT" \
  --permission-mode acceptEdits \
  --allowedTools ${ALLOW_RULES[@]+"${ALLOW_RULES[@]}"} \
  --verbose \
  --output-format stream-json
