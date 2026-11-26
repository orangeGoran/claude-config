#!/usr/bin/env bash
#
# setup.sh — first-time setup: pick what to install, then it runs the matching scripts.
#
#   scripts/setup.sh                      asks what to set up, then asks inside each part
#   scripts/setup.sh --yes                sets up everything without asking
#   scripts/setup.sh --domain shipyard.test  domain for the dashboard (default: asks, shipyard.test)
#
# Parts
#   1. Claude Code config   scripts/setup-claude.sh — CLAUDE.md, skills, settings
#   2. Plans dashboard      scripts/setup-macos.sh  — runs at login on https://<domain> (macOS)
#                           then asks to build Shipyard, the Mac app (npm run build-app) when swiftc is there
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
REPO="$(cd "$HERE/.." && pwd)"
LABELS=("Claude Code config — CLAUDE.md, skills, settings"
        "Plans dashboard — runs at login on https://${DOMAIN:-shipyard.test}")
PICKED=(1 1)
# the dashboard's login agent, Caddy and /etc/hosts are macOS-only
if [ "$(uname)" != Darwin ]; then
  PICKED[1]=0
  LABELS[1]="Plans dashboard — macOS only; run node apps/dashboard/server.mjs instead"
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
  [ "$YES" = 1 ] && DOMAIN="${DOMAIN:-shipyard.test}"
  args=(); [ -n "$DOMAIN" ] && args+=(--domain "$DOMAIN")
  "$HERE/setup-macos.sh" ${args[@]+"${args[@]}"}
  # setup-macos.sh asked for the domain if we didn't pass one; read back what it served
  url="$(sed -n 's/^\([^ {]*\) {.*/https:\/\/\1/p' "$HOME/.claude/pipeline-dashboard/caddy-site.caddy" 2>/dev/null | head -1)"
  url="${url:-https://${DOMAIN:-shipyard.test}}"
  # the scout's config and AWS keys stay on each Mac (not in this repo): install its daily job only
  # when this Mac has a config; otherwise the 🔭 Scout drawer lists the steps
  if [ -f "$HOME/.claude/scout.json" ]; then
    ans=y
    [ "$YES" = 1 ] || read -r -p "Run the scout every day at 07:00 (~/.claude/scout.json found)? [Y/n] " ans
    case "${ans:-y}" in [Nn]*) ;; *) node "$REPO/apps/scout/scout.mjs" --install ;; esac
  else
    printf '\nScout: not set up on this Mac. The 🔭 Scout button on the dashboard lists the steps (docs/scout.md).\n'
  fi
  # --- Mac app ---
  # the optional Mac app, Shipyard (apps/plans-mac): one window with the ⌘ menu keys; it needs the Swift compiler
  APP=""
  # --check prints its own hint; the skipped line below says the same, so its stderr is dropped
  if node "$REPO/apps/plans-mac/build.mjs" --check 2>/dev/null; then
    ans=y
    [ "$YES" = 1 ] || read -r -p "Build and install Shipyard, the Mac app of the dashboard (~/Applications/Shipyard.app)? [Y/n] " ans
    case "${ans:-y}" in
      [Nn]*) ;;
      *) if node "$REPO/apps/plans-mac/build.mjs"; then APP="$HOME/Applications/Shipyard.app"; else printf 'Mac app: the build failed; setup goes on. Run npm run build-app to try again.\n'; fi ;;
    esac
  else
    printf 'Mac app: skipped (no Swift compiler; xcode-select --install, then npm run build-app).\n'
  fi
  # --- end Mac app ---
  printf '\nDone. Opening %s — the guide there helps you add your repos.\n' "${APP:-$url}"
  open "${APP:-$url}" 2>/dev/null || true
else
  printf '\nDone. To try the dashboard: node %s/apps/dashboard/server.mjs\n' "$REPO"
fi
