#!/usr/bin/env bash
#
# Post-edit lint — runs the lint fixer, then the formatter, on the one file that
# Claude just edited. Called as a PostToolUse hook on Edit|Write|NotebookEdit
# (.claude/settings.json); receives the tool input as JSON on stdin.
#
# Exit 2 shows stderr to Claude, so it fixes the file before it continues.
# Exit 0 in every other case: a file type that is not linted, a file outside the
# repo, no install yet (fresh worktree), or a tool that is not installed. A missing
# tool never blocks an edit; the full lint command in the checks still runs later.
#
set -uo pipefail

# ============================ CONFIG (@@PROJECT_NAME@@) =======================================
# EDIT 1: the command that lints and fixes ONE file (the file path is added at
# the end). Empty = skip the lint step.
LINT_FIX_FILE_CMD="@@LINT_FIX_FILE_CMD@@"
# EDIT 2: the command that formats ONE file (the file path is added at the end).
# Empty = skip the format step.
FORMAT_FILE_CMD="@@FORMAT_FILE_CMD@@"
# EDIT 3: the file types to lint, as a bash case pattern (for example *.ts|*.tsx).
is_lint_file() {
  case "$1" in
    @@LINT_EXTENSIONS_CASE@@) return 0 ;;
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
# npx call never downloads a package in the middle of an edit.
tool_ready() {
  local words=("$@") tool=""
  case "${words[0]}" in
    npx|bunx) tool="${words[1]:-}" ;;
    pnpm|yarn|npm) [ "${words[1]:-}" = "exec" ] && tool="${words[2]:-}" || tool="${words[1]:-}" ;;
    *) command -v "${words[0]}" >/dev/null 2>&1; return ;;
  esac
  [ -n "$tool" ] && [ -x "node_modules/.bin/$tool" ]
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
  fi
fi

exit $STATUS
