#!/usr/bin/env bash
#
# setup.sh — first-time setup: pick what to install, then it runs the matching scripts.
#
#   scripts/setup.sh                      asks what to set up, then asks inside each part
#   scripts/setup.sh --yes                sets up everything without asking
#   scripts/setup.sh --domain plans.test  domain for the dashboard (default: asks, plans.test)
#
# Parts
#   1. Claude Code config   scripts/setup-claude.sh — CLAUDE.md, skills, settings
#   2. Plans dashboard      scripts/setup-macos.sh  — runs at login on https://<domain> (macOS)
#
# Each part is its own script and still works on its own. Safe to re-run.
set -euo pipefail

YES=0 DOMAIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1; shift ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
LABELS=("Claude Code config — CLAUDE.md, skills, settings"
        "Plans dashboard — runs at login on https://${DOMAIN:-plans.test}")
PICKED=(1 1)
# the dashboard's login agent, Caddy and /etc/hosts are macOS-only
if [ "$(uname)" != Darwin ]; then
  PICKED[1]=0
  LABELS[1]="Plans dashboard — macOS only; run node scripts/plans-dashboard.mjs instead"
fi

if [ "$YES" = 0 ]; then
  while :; do
    printf '\nWhat do you want to set up?\n'
    for i in "${!LABELS[@]}"; do
      printf '  [%s] %d. %s\n' "$([ "${PICKED[$i]}" = 1 ] && echo x || echo ' ')" "$((i + 1))" "${LABELS[$i]}"
    done
    read -r -p "Enter to continue, or type numbers to toggle: " reply
    [ -z "$reply" ] && break
    for n in $(printf '%s' "$reply" | tr -c '0-9' ' '); do
      i=$((n - 1))
      if [ "$i" -ge 0 ] && [ "$i" -lt "${#LABELS[@]}" ]; then
        if [ "$i" = 1 ] && [ "$(uname)" != Darwin ]; then continue; fi
        PICKED[$i]=$((1 - PICKED[$i]))
      fi
    done
  done
fi

[ "${PICKED[0]}" = 1 ] || [ "${PICKED[1]}" = 1 ] || { echo "Nothing selected."; exit 0; }

if [ "${PICKED[0]}" = 1 ]; then
  printf '\n━━ 1. Claude Code config\n'
  args=(); [ "$YES" = 1 ] && args+=(--yes)
  "$HERE/setup-claude.sh" ${args[@]+"${args[@]}"}
fi

if [ "${PICKED[1]}" = 1 ]; then
  printf '\n━━ 2. Plans dashboard\n'
  # --yes means no prompts at all, so the domain falls back to its default
  [ "$YES" = 1 ] && DOMAIN="${DOMAIN:-plans.test}"
  args=(); [ -n "$DOMAIN" ] && args+=(--domain "$DOMAIN")
  "$HERE/setup-macos.sh" ${args[@]+"${args[@]}"}
  # setup-macos.sh asked for the domain if we didn't pass one; read back what it served
  url="$(sed -n 's/^\([^ {]*\) {.*/https:\/\/\1/p' "$HOME/.claude/pipeline-dashboard/caddy-site.caddy" 2>/dev/null | head -1)"
  url="${url:-https://${DOMAIN:-plans.test}}"
  printf '\nDone. Opening %s — the guide there helps you add your repos.\n' "$url"
  open "$url" 2>/dev/null || true
else
  printf '\nDone. To try the dashboard: node %s/plans-dashboard.mjs\n' "$HERE"
fi
