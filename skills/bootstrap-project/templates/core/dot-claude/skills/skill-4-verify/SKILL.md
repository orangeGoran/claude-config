---
name: skill-4-verify
description: Verify step of the workflow (step 4). Runs a capped /code-review bug-hunt loop that fixes defects and re-tests them, then audits the result against the hard rules in AGENTS.md (@@HARD_RULE_TITLES@@), contracts, doc comments, tests, secrets and plan scope, and reports an evidence table. Use after /skill-3-test; /skill-auto-pipeline calls it unattended.
argument-hint: "[plan file | files] [--unattended]"
---

Verify: $ARGUMENTS

You run the **Verify** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

**Order matters.** The bug hunt runs first, the rule audit second. The reviewer's fixes are code too, so the audit must see them.

## Rules

- Run commands bare, one per call: no pipes, `&&`, redirection or heredocs. Commands come from `AGENTS.md` (**Commands**) and @@MANIFESTS@@ only; a missing one is "not available yet".
- **Unattended** (`--unattended`): never use AskUserQuestion. Fix rule violations that have one clear fix. Put everything that needs a decision under **Open items**.
- Do not run `git add`, `git commit` or `git push`. The pipeline commits.

## Step 0 — Scope

- The changed files: `git diff --name-only @@BASE_BRANCH@@...HEAD` plus `git status --porcelain`.
- A plan file: also read it. Its **Affected files** list is the expected scope.

## Step 1 — Bug hunt (code-review loop, max 2 rounds)

1. Invoke the code-review skill: `Skill(skill: "code-review", args: "high --fix")`. You wrote this code, so do not review it inline yourself.
2. The fixes it applied are not checked yet. For each file it touched: run the scoped tests and lint again (the same commands as `/skill-3-test`). Fix a failure before the next round.
3. Record the round: findings fixed, findings deferred, files touched, re-test result.

Stop when a round fixes nothing new, or when only deferred findings are left. Never run a third round. Stop at once and report if a round undoes an earlier fix, or if the same test fails after two fix attempts.

## Step 2 — Rule audit

Read the nested `AGENTS.md` files of the touched folders. Then check the post-review tree. Run the Grep and Read checks in parallel subagents if the scope is large; run all Bash commands yourself (subagents do not get the run's Bash permissions).

| # | Check | How |
| --- | --- | --- |
@@AUDIT_ROWS@@

**Evidence gate.** A row is Pass only when you looked: name the files and lines, or the command and its counts. "Lint passed" does not prove a hard-rule row. An auto-fixed file gets the same audit.
@@IF MOD_TEST_REVIEW@@

## Step 2.5 — Test review

Invoke `Skill(skill: "test-review", args: "--fix --base @@BASE_BRANCH@@ --plan <plan file>")`. It writes `.plans/.test-review/<branch-with-slashes-as-dashes>.md`. Carry its `## Summary for the PR` into your report; `/skill-5-ship` and `/decision-sheet` read the file. A blocking test-review finding is a Fail in the **Tests** row.
@@END@@

## Step 3 — Report

Start with:

> **TLDR:** 1–3 plain sentences: what changed and the one thing to check first.
>
> **Suggested review order** (most important first):
> 1. `path/file` — why it matters

Rank the code that the hard rules protect first, then contracts and data, then services, then controllers and UI, then tests, then wiring. Mark files the reviewer rewrote `(auto-fixed)` and rank them above equal files. Put any file with a Fail at the top.

Then the table:

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Code review | Pass/Fail | rounds, fixed, deferred, re-test result |
| 2–@@AUDIT_LAST@@ | (as above) | Pass/Fail/N/A | files and lines, or command and counts |

Then **Code review rounds** (one line per round, and why the loop stopped), **Violations** (file, line, what is wrong, the fix, and whether you fixed it), and **Open items** (deferred findings and decisions for the owner, in ASD-STE100).

After any fix in this step, run the scoped tests and lint for the touched files again. Do not start the Step 1 loop again for rule fixes.

The step is complete only when rows 1–@@AUDIT_LAST@@ are Pass or N/A. Otherwise report what is left and stop.
@@IF MOD_STEP_GATE@@

When the step is complete, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> verify` (`<plan-basename>` without `.md`).
@@END@@

Next: `/skill-5-ship` (only when the owner asks, or in "to PR" mode).
