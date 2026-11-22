#!/usr/bin/env bash
#
# Post-edit lint — runs the lint fixer, then the formatter, on the one file that
# Claude just edited. Called as a PostToolUse hook on Edit|Write|NotebookEdit
# (.claude/settings.json); receives the tool input as JSON on stdin.
#
# Exit 2 shows stderr to Claude, so it fixes the file before it continues.
# Exit 0 in every other case: a file type that is not linted, a file outside the
# repo, or no install yet (fresh worktree). A tool that is missing although the
# dependencies are installed is a wrong CONFIG command: exit 2 once per session with
# that message, then exit 0.
#
set -uo pipefail

# ============================ CONFIG (claude-config) =======================================
# EDIT 1: the command that lints and fixes ONE file (the file path is added at
# the end). Empty = skip the lint step.
LINT_FIX_FILE_CMD=""
# EDIT 2: the command that formats ONE file (the file path is added at the end).
# Empty = skip the format step. For oxfmt and prettier, --no-error-on-unmatched-pattern
# keeps an ignored file (gitignored, .prettierignore) from failing the hook.
FORMAT_FILE_CMD=""
# EDIT 3: the file types to lint, as a bash case pattern (for example *.ts|*.tsx).
is_lint_file() {
  case "$1" in
    *.__none__) return 0 ;;
    *) return 1 ;;
  esac
}
# ============================================================================

[ -n "$LINT_FIX_FILE_CMD$FORMAT_FILE_CMD" ] || exit 0

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
INPUT=$(cat)

# the edited file from the tool input (jq when available, grep fallback)
if command -v jq >/dev/null 2>&1; then
  FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
else
  FILE=$(printf '%s' "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')
fi

# only the configured file types, only files that still exist
[ -n "$FILE" ] || exit 0
is_lint_file "$FILE" || exit 0
[ -f "$FILE" ] || exit 0

# only files inside this repo (not sibling worktrees or scratch folders).
# Compare physical paths, so a symlinked spelling (macOS /tmp -> /private/tmp)
# or a relative path is not skipped by mistake.
REPO_ROOT="$(CDPATH= cd -- "$REPO_ROOT" 2>/dev/null && pwd -P)" || exit 0
FILE="$(CDPATH= cd -- "$(dirname "$FILE")" 2>/dev/null && pwd -P)/$(basename "$FILE")" || exit 0
case "$FILE" in
  "$REPO_ROOT"/*) ;;
  *) exit 0 ;;
esac
cd "$REPO_ROOT" || exit 0

# tool_ready <command words...>: true when the tool of the command can run here.
# For npx / pnpm exec / yarn / bunx, the tool must be in node_modules/.bin, so an
# npx call never downloads a package in the middle of an edit. Options before the
# tool (--filter=<dir>, -C <dir>, --prefix <dir>) are skipped; a folder they name is
# searched too.
tool_ready() {
  local words=("$@") tool="" dir="" script="" i=1 w
  case "${words[0]}" in
    npx|bunx|pnpm|yarn|npm) ;;
    *) command -v "${words[0]}" >/dev/null 2>&1; return ;;
  esac
  while [ "$i" -lt "${#words[@]}" ]; do
    w="${words[$i]}"
    case "$w" in
      --filter=*|--prefix=*|--dir=*|--cwd=*) dir="${w#*=}" ;;
      -C|--filter|--prefix|--dir|--cwd) i=$((i + 1)); dir="${words[$i]:-}" ;;
      run|run-script) script=1 ;;
      exec|-*) ;;
      *) tool="$w"; break ;;
    esac
    i=$((i + 1))
  done
  [ -n "$tool" ] || return 1
  # "npm run <script>": a package script, not a binary; it runs when the deps are installed
  [ -z "$script" ] || { [ -d "${dir:-.}/node_modules" ] || [ -d node_modules ]; return; }
  [ -x "node_modules/.bin/$tool" ] || { [ -n "$dir" ] && [ -x "${dir%/}/node_modules/.bin/$tool" ]; }
}

# A command whose tool is missing although the dependencies are installed is a wrong
# command in the CONFIG block (for example a folder that moved). Say so, once per
# session: a hook that silently does nothing hides that the lint never runs.
warn_missing_tool() { # $1 = the CONFIG name, $2 = the command
  [ -d node_modules ] || return 0
  local flag="${TMPDIR:-/tmp}/post-edit-lint-warned-$(printf '%s' "$REPO_ROOT$2" | cksum | cut -d' ' -f1)"
  [ -f "$flag" ] && return 0
  : > "$flag"
  echo "post-edit-lint: the tool of $1 (\"$2\") is not installed here, so this hook does not lint." >&2
  echo "Fix stack.postEditLint in .claude/bootstrap.json and run /bootstrap-project --upgrade, or edit the CONFIG block of .claude/scripts/post-edit-lint.sh." >&2
  STATUS=2
}

STATUS=0

if [ -n "$LINT_FIX_FILE_CMD" ]; then
  read -r -a LINT_CMD <<< "$LINT_FIX_FILE_CMD"
  if tool_ready "${LINT_CMD[@]}"; then
    LINT_OUT=$("${LINT_CMD[@]}" "$FILE" 2>&1)
    if [ $? -ne 0 ]; then
      echo "Lint found errors in $FILE — fix them before you continue:" >&2
      echo "$LINT_OUT" >&2
      STATUS=2
    fi
  else
    warn_missing_tool LINT_FIX_FILE_CMD "$LINT_FIX_FILE_CMD"
  fi
fi

# always format, also when lint has errors, so the file always leaves here formatted
if [ -n "$FORMAT_FILE_CMD" ]; then
  read -r -a FMT_CMD <<< "$FORMAT_FILE_CMD"
  if tool_ready "${FMT_CMD[@]}"; then
    FMT_OUT=$("${FMT_CMD[@]}" "$FILE" 2>&1)
    if [ $? -ne 0 ]; then
      echo "The formatter failed on $FILE:" >&2
      echo "$FMT_OUT" >&2
      STATUS=2
    fi
  else
    warn_missing_tool FORMAT_FILE_CMD "$FORMAT_FILE_CMD"
  fi
fi

exit $STATUS
