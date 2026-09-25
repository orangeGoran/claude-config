#!/usr/bin/env bash
#
# setup-claude.sh — link this repo's Claude Code configuration into ~/.claude/.
#
#   scripts/setup-claude.sh         asks before each step
#   scripts/setup-claude.sh --yes   does every step without asking
#
# Steps
#   CLAUDE.md          symlink the global rules to ~/.claude/CLAUDE.md
#   skills/<name>/     symlink each skill to ~/.claude/skills/<name>, one question per skill
#   cleanupPeriodDays  set it to 99999 in ~/.claude/settings.json, so Claude Code keeps
#                      session transcripts instead of deleting them after 30 days
#   attribution        set commit and pr to "", so Claude Code adds no co-author line
#                      to commits and no footer to PR descriptions
#
# A real file or folder already at a target is moved aside to <target>.bak-<timestamp>.
# settings.json is merged, never replaced. Safe to re-run.
set -euo pipefail

YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1; shift ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

die() { echo "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
ask() {
  [ "$YES" = 1 ] && return 0
  local reply
  read -r -p "$1 [Y/n] " reply
  case "$reply" in [nN]*) return 1 ;; *) return 0 ;; esac
}

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE="$HOME/.claude"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$CLAUDE/skills"

# link <source> <target>: symlink, moving a real file or folder at <target> aside first.
link() {
  if [ -e "$2" ] && [ ! -L "$2" ]; then
    mv "$2" "$2.bak-$STAMP"
    echo "moved existing $2 to $2.bak-$STAMP"
  fi
  ln -sfn "$1" "$2"
  echo "$2 -> $1"
}

step "Global rules"
if ask "Link CLAUDE.md (global standing rules)?"; then
  link "$REPO/CLAUDE.md" "$CLAUDE/CLAUDE.md"
else
  echo "skipped"
fi

step "Skills"
for dir in "$REPO"/skills/*/; do
  name="$(basename "$dir")"
  if ask "Link skill /$name?"; then
    link "$REPO/skills/$name" "$CLAUDE/skills/$name"
  else
    echo "skipped /$name"
  fi
done

# set_setting <key> <json value>: set one top-level key in settings.json, keeping the rest.
set_setting() {
  command -v node >/dev/null || die "node is required to edit settings.json."
  node - "$CLAUDE/settings.json" "$1" "$2" <<'JS'
const fs = require('fs');
const [file, key, value] = process.argv.slice(2);
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
settings[key] = JSON.parse(value);
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
JS
  echo "$CLAUDE/settings.json: $1 = $2"
}

step "Keep session history"
if ask "Set cleanupPeriodDays to 99999 (keep session transcripts instead of deleting them after 30 days)?"; then
  set_setting cleanupPeriodDays 99999
else
  echo "skipped"
fi

step "No AI attribution"
if ask "Turn off the Claude co-author line in commits and the footer in PR descriptions?"; then
  set_setting attribution '{"commit":"","pr":""}'
else
  echo "skipped"
fi

printf '\nDone. Restart Claude Code to pick up the changes.\n'
