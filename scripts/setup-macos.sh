#!/usr/bin/env bash
#
# setup-macos.sh — run the plans dashboard at login, served at https://<domain>.
#
#   scripts/setup-macos.sh                      asks for the domain (default plans.test)
#   scripts/setup-macos.sh --domain plans.test  no prompt
#
# Options
#   --domain <name>   hostname to serve the dashboard at (default: asks, plans.test)
#   --port <n>        port the dashboard itself listens on (default 4899, must be
#                     above 1023 — Caddy owns 80 and 443)
#
# Installs Caddy with Homebrew if missing, installs the launchd agent from
# scripts/launchd/, points Caddy at the dashboard, adds the domain to /etc/hosts
# and trusts Caddy's local certificate authority. The last two need sudo.
# Safe to re-run — e.g. to change the domain.
set -euo pipefail

DOMAIN="" PORT=4899

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

die() { echo "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

[ "$(uname)" = Darwin ] || die "macOS only."
command -v brew >/dev/null || die "Homebrew is required: https://brew.sh"
NODE="$(command -v node)" || die "node is required."

if [ -z "$DOMAIN" ]; then
  read -r -p "Domain for the dashboard [plans.test]: " DOMAIN
  DOMAIN="${DOMAIN:-plans.test}"
fi
DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
  || die "not a hostname: $DOMAIN"
case "$DOMAIN" in
  *.test|*.localhost) ;;
  *) echo "warning: $DOMAIN is not under .test or .localhost — if it is a real domain," \
          "this machine will no longer reach the real site." >&2 ;;
esac
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] \
  || die "--port must be 1024–65535 (Caddy owns 80 and 443)."

HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="$HOME/.claude/pipeline-dashboard"
PLIST="$HOME/Library/LaunchAgents/com.plans-dashboard.plist"
SITE="$STATE/caddy-site.caddy"
CADDYFILE="$(brew --prefix)/etc/Caddyfile"
IMPORT="import $SITE"
mkdir -p "$STATE" "$HOME/Library/LaunchAgents"

step "Caddy"
if brew list caddy >/dev/null 2>&1; then echo "already installed"; else brew install caddy; fi

step "Dashboard login agent (port $PORT)"
sed -e "s|__NODE__|$NODE|" \
    -e "s|__SCRIPT__|$HERE/plans-dashboard.mjs|" \
    -e "s|__LOG__|$STATE/server.log|" \
    "$HERE/launchd/com.plans-dashboard.plist.template" > "$PLIST"
plutil -replace EnvironmentVariables.DASH_PORT -string "$PORT" "$PLIST"
# bootout returns before the old process is gone; bootstrapping too early fails.
if launchctl bootout "gui/$(id -u)/com.plans-dashboard" 2>/dev/null; then
  for _ in $(seq 50); do
    launchctl print "gui/$(id -u)/com.plans-dashboard" >/dev/null 2>&1 || break
    sleep 0.2
  done
fi
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST"

step "Caddy site for $DOMAIN"
sed -e "s|__DOMAIN__|$DOMAIN|" -e "s|__PORT__|$PORT|" \
    "$HERE/caddy/plans.caddy.template" > "$SITE"
touch "$CADDYFILE"
grep -qxF "$IMPORT" "$CADDYFILE" || printf '%s\n' "$IMPORT" >> "$CADDYFILE"
caddy validate --config "$CADDYFILE" >/dev/null 2>&1 \
  || { caddy validate --config "$CADDYFILE"; die "invalid Caddyfile: $CADDYFILE"; }
brew services restart caddy >/dev/null
echo "$CADDYFILE imports $SITE"

step "/etc/hosts"
if awk -v d="$DOMAIN" '$1 == "127.0.0.1" { for (i = 2; i <= NF; i++) if ($i == d) f = 1 }
                       END { exit !f }' /etc/hosts; then
  echo "already has $DOMAIN"
else
  echo "adding 127.0.0.1 $DOMAIN (sudo)"
  printf '127.0.0.1 %s\n' "$DOMAIN" | sudo tee -a /etc/hosts >/dev/null
fi

step "Trust Caddy's local certificate authority"
# Caddy fetches its root certificate over its admin API, which needs a moment
# after the restart above.
for _ in $(seq 50); do curl -s -o /dev/null http://localhost:2019/config/ && break; sleep 0.2; done
if security find-certificate -c "Caddy Local Authority" /Library/Keychains/System.keychain >/dev/null 2>&1; then
  echo "already trusted"
else
  caddy trust
fi

step "Check"
code=000
for _ in $(seq 25); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' "https://$DOMAIN/" || true)"
  [ "$code" = 200 ] && break
  sleep 0.2
done
if [ "$code" = 200 ]; then
  printf '\nDashboard → https://%s\n' "$DOMAIN"
else
  die "https://$DOMAIN answered $code. Logs: $STATE/server.log and $(brew --prefix)/var/log/caddy.log"
fi
echo "Firefox keeps its own certificate list: if it warns, set security.enterprise_roots.enabled to true in about:config."
