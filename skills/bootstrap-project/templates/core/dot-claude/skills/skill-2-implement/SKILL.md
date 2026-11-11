---
name: skill-2-implement
description: Implement one saved .plans/ plan in this repository step by step, following AGENTS.md, then run the related checks with the repo's real commands and end with a short summary. Use when given a plan file path; /skill-auto-pipeline calls it with --commit-per-step.
argument-hint: "<plan file> [--commit-per-step]"
---

Plan: $ARGUMENTS

You run the **Implement** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

## Step 0: Select the plan

- The first argument is the plan file path. If it is only a name, look for it in `.plans/`.
- If no plan matches, or the plan is in `.plans/done/`, stop and say so. Do not pick another plan.
- `--commit-per-step` is allowed only when `git branch --show-current` starts with `auto/`. On any other branch, ignore it and do not commit.

## Step 1: Read the rules

- Root `AGENTS.md` is already in context through `CLAUDE.md`. Follow it, especially **Hard rules**.
- Read the parts of `@@PARENT_PLAN@@` that the plan cites, and every nested `AGENTS.md` in the folders the plan touches.

## Step 2: Check the plan against the code

- Before you edit, check that each file, line and symbol in the plan exists as the plan says.
- If the plan does not match the code, or a step needs an owner decision, do not guess. Write the question down (Step 7), skip the steps that depend on it, and continue with the rest.

## Step 3: Implement

- Do the steps in order. Change only what the plan asks for.
- Follow existing patterns. @@CONTRACTS_RULE@@
- After each fix, search sibling code for the same defect, and fix it or report it.
- Install packages with the package manager at their latest version. Never type a version by hand.
- **Run shell commands bare:** one command per call, no pipes, `&&`, redirection or heredocs. Headless runs auto-deny compound commands.
@@IF MOD_STEP_GATE@@
- **Step gate.** When the plan's steps are done and the related checks pass, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> implement` (`<plan-basename>` without `.md`). The commit guard (`workflow-guard.sh`) reads this mark.
@@END@@

## Step 4: Commit per step (only with `--commit-per-step` on an `auto/*` branch)

After each plan step, when its related checks pass:

1. `git add <the files of this step>` (name the files; never `git add -A` with unrelated files).
2. `git commit -m "<type>(<scope>): <what this step did>"` — Conventional Commits, no AI attribution.

Small steps that change the same lines may share one commit; say so in the summary.

## Step 5: Run the related checks

- Take the commands from `AGENTS.md`, section **Commands**, and from @@MANIFESTS@@. Run only the checks related to the change (scoped tests, lint, type check).
- If a check has no command yet ("not available yet"), say so. Do not invent one.
- Run every command in the plan's **How to verify** section and record the result.

## Step 6: Never

- `git push`, `git reset`, `git stash`, or opening a PR.
- `git add` or `git commit` without `--commit-per-step` on an `auto/*` branch.
- Edits outside this repository.
- Weakening a hard rule, a lint rule or a test to make a check pass.

## Step 7: Summary

End with a short summary:

- the files changed, with one line each, and the commits made (if any),
- the checks run, with the result of each one,
- **Open questions**: "none", or each question in ASD-STE100: the facts, one example step by step with real values (@@QUESTION_ACTOR@@), Option A (recommended) and Option B, and why you recommend A.
