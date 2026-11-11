---
name: skill-3-test
description: Test step of the workflow (step 3). Writes the tests the plan asks for that are still missing, then runs a scoped run → diagnose → fix loop until they pass, and ends with one full-suite run as evidence. Use after /skill-2-implement; /skill-auto-pipeline calls it unattended.
argument-hint: "[plan file | pattern | all] [--unattended]"
---

Test: $ARGUMENTS

You run the **Test** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

## Rules

- **Commands come from the repo.** Use only the commands in `AGENTS.md`, section **Commands**, and the scripts in @@MANIFESTS@@. If a check has no command yet, write "not available yet". Never invent a command.
- **Run commands bare:** one command per call, no pipes, `&&`, redirection or heredocs. Headless runs auto-deny compound commands. Read the failures from the command output itself.
- **Test data.** @@TEST_DATA_RULE@@
- **Unattended** (`--unattended`, set by `/skill-auto-pipeline`): never use AskUserQuestion. When this skill says "ask", write the question in the summary as an open question instead.
- Do not run `git add`, `git commit` or `git push` here. The pipeline commits.

## Step 0 — Scope

- A plan file: read its **Tests** and **How to verify** sections. That is the scope.
- A pattern: test only the matching files.
- `all`: every test command the repo has.
- Nothing: use `git diff --name-only @@BASE_BRANCH@@...HEAD` and `git status --porcelain`. If the scope is still unclear, ask (interactive) or test the changed packages (unattended).

## Step 1 — Write the missing tests

- `/skill-2-implement` writes tests with each step. Here, compare the plan's **Tests** list with the test files, and write only the missing ones.
- Put tests where the package's existing tests are. Follow their pattern. If the package has no tests yet, follow the pattern the plan names.
- **Hard rules need a negative test.** When the change touches a hard rule in `AGENTS.md` (@@HARD_RULE_TITLES@@), add a test that fails when the rule breaks. A test that only checks the happy path is not enough.
@@IF HAS_RULE_TESTS@@
- **The tests this project needs for its rules** (when the change touches the rule):
@@RULE_TESTS@@
@@END@@
- **Contracts:** a contract change needs a test that accepts a valid sample and rejects an invalid one.
- Do not change an existing test to make it pass unless the plan changes that behavior. Say which tests you changed and why.
- For each new test, ask: would it still pass if the feature were not built? If yes, rewrite it.

## Step 2 — Fix loop (scoped)

Run only the tests in scope. Never the full suite inside the loop.

1. Run the scoped command (AGENTS.md, **Commands**, "Test (one file)"). If there is none, run the full test command once and treat it as the scoped run.
2. All pass → Step 3.
3. A failure → read the test and the code it tests. Decide where the defect is. Fix the code, unless the test expectation is wrong. Run the same command again.
4. **Circuit breaker:** the same test fails 3 times after 3 different fixes → stop the loop and report it (interactive: ask the owner; unattended: open question in the summary).

Then lint and format the changed files with the repo's lint and format commands. Fix errors in the code, not in the lint config. After a lint fix, run the scoped tests again.

## Step 3 — Evidence gate

**No claim without a fresh run.**

1. Run each full test command once (AGENTS.md, **Commands**, "Test (full)", and "Test (end to end)" when the change needs it).
2. Read the result counts in the output: passed, failed, skipped.
3. Only then report. A skipped test is not a pass. Results from an earlier run do not count.
@@IF MOD_STEP_GATE@@
4. When all tests pass, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> test` (`<plan-basename>` without `.md`).
@@END@@

## Step 4 — Summary

- **Loop rounds:** how many fix rounds (0 = passed the first time).
- **Tests:** per command: passed, failed, skipped.
- **Lint:** errors and warnings per command, or "not available yet".
- **Tests written:** one line each, with what it proves.
- **Fixes made:** file and what changed.
- **Open questions:** "none", or each one in ASD-STE100 (the facts, one example step by step, Option A (recommended) and Option B, why A).

Next: `/skill-4-verify`.
