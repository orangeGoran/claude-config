#!/usr/bin/env bash
#
# Marks one workflow step as done for one plan.
# Usage: workflow-complete-step.sh <plan-name> <step-name>
#
# Example: workflow-complete-step.sh 20260101-090000-add-health-endpoint implement
#
# Steps: implement, test, verify, document. After the last one, the plan moves to
# .plans/done/ and its state folder is removed. workflow-guard.sh reads these flags
# and .plans/done/ to allow a commit.
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
STATE_DIR="$REPO_ROOT/.plans/.workflow-state"

PLAN_NAME="${1:?Usage: workflow-complete-step.sh <plan-name> <step-name>}"
STEP_NAME="${2:?Usage: workflow-complete-step.sh <plan-name> <step-name>}"
PLAN_NAME="$(basename "$PLAN_NAME" .md)"

VALID_STEPS=("implement" "test" "verify" "document")
VALID=false
for s in "${VALID_STEPS[@]}"; do
  if [ "$s" = "$STEP_NAME" ]; then
    VALID=true
    break
  fi
done

if [ "$VALID" = false ]; then
  echo "Invalid step: $STEP_NAME. Must be one of: ${VALID_STEPS[*]}"
  exit 1
fi

mkdir -p "$STATE_DIR/$PLAN_NAME"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STATE_DIR/$PLAN_NAME/$STEP_NAME.done"
echo "Step '$STEP_NAME' marked complete for plan '$PLAN_NAME'."

# When all steps are done, move the plan file to done/ and remove its state folder.
# The flags show progress only for an open plan; the guard reads .plans/done/ for a
# finished plan.
PLANS_DIR="$REPO_ROOT/.plans"
DONE_DIR="$PLANS_DIR/done"
ALL_DONE=true
for s in "${VALID_STEPS[@]}"; do
  if [ ! -f "$STATE_DIR/$PLAN_NAME/$s.done" ]; then
    ALL_DONE=false
    break
  fi
done

if [ "$ALL_DONE" = true ]; then
  if [ -f "$PLANS_DIR/$PLAN_NAME.md" ]; then
    mkdir -p "$DONE_DIR"
    mv "$PLANS_DIR/$PLAN_NAME.md" "$DONE_DIR/$PLAN_NAME.md"
    echo "Plan '$PLAN_NAME' fully complete — moved to done/"
  fi
  if [ -f "$DONE_DIR/$PLAN_NAME.md" ]; then
    rm -rf "${STATE_DIR:?}/$PLAN_NAME"
    echo "Workflow state removed for plan '$PLAN_NAME'."
  fi
fi
