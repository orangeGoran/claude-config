---
name: skill-4-verify
description: Verify step of the workflow (step 4). Runs a capped /code-review bug-hunt loop that fixes defects and re-tests them (it stops when it converges or only deferrals are left), then audits the result against the hard rules in AGENTS.md (@@HARD_RULE_TITLES@@), contracts, doc comments, tests, secrets and plan scope, and reports an evidence table. Use after /skill-3-test; /skill-auto-pipeline calls it unattended.
argument-hint: "[plan file | files] [--unattended]"
---

Verify: $ARGUMENTS

You run the **Verify** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

**Order matters.** The bug hunt runs first, the rule audit second. The reviewer's fixes are code too, so the audit must see them.

## Rules

- Run commands bare, one per call: no pipes, `&&`, redirection or heredocs. Commands come from `AGENTS.md` (**Commands**) and @@MANIFESTS@@ only; a missing one is "not available yet".
- **Unattended** (`--unattended`): never use AskUserQuestion. Fix rule violations that have one clear fix. Put everything that needs a decision under **Open items**.
- Do not run `git add`, `git commit` or `git push`. The pipeline commits.

@@REPORTING_RULES@@

## Step 0 — Scope

- The changed files, each command in its own call: `git diff --name-only @@BASE_BRANCH@@...HEAD`, `git diff --name-only`, `git diff --cached --name-only`, `git ls-files --others --exclude-standard`.
- A plan file: also read it. Its **Affected files** list is the expected scope, and its **Tests** section feeds the **Tests** row.
- Unclear scope: interactive, ask; unattended, use the plan's **Affected files** plus the changed files, and record the choice under **Open items**.

## Step 1 — Bug hunt (code-review loop, max 2 rounds)

The rule audit (Step 2) checks compliance, not logic. Run the bug hunt yourself; do not leave "run /code-review next" for the owner. It is a loop, because a round that rewrites a query or a branch changes the code that the next round reads.

1. Invoke the code-review skill: `Skill(skill: "code-review", args: "high --fix")`. You wrote this code, so do not review it inline yourself.
2. The fixes it applied are not checked yet. List the files it touched (`git diff --name-only`). For each one, run the scoped tests (AGENTS.md, **Commands**, "Test (one file)") and the check-only lint and format commands again. When it touched an entry point that an end-to-end test covers (a route, a handler, a public interface), also run the matching end-to-end test ("Test (end to end)"). A command that is "not available yet" is skipped with that reason. Fix a failure before the next round.
3. Record the round: findings fixed, findings deferred, files touched, re-test result. Number each finding `F1`, `F2`, … in the order found.

**Stop the loop** as soon as one of these is true. An early stop is the normal result:

- **Converged:** the round fixed nothing and found nothing new. A finding that repeats an earlier deferred finding is not new.
- **Only deferrals left:** the round found problems but could fix none of them. They need a person; more rounds do not help.

**Hard cap: 2 rounds.** Never run a third. If round 2 still fixed something, stop anyway, say that the loop hit the cap, and list what round 2 changed, so the owner looks at it first.

**Stop at once and escalate** (report, do not continue):

- **Oscillation:** a round undoes or argues against an earlier round's fix. Report both versions and which one is in the tree. A person decides.
- **A test keeps failing:** the same test still fails after two fix attempts. Report it; do not keep patching.

## Step 2 — Rule audit

Read the nested `AGENTS.md` files of the touched folders. Then check the post-review tree. Run the Grep and Read checks in parallel subagents if the scope is large; run all Bash commands yourself (subagents do not get the run's Bash permissions).

| # | Check | How |
| --- | --- | --- |
@@AUDIT_ROWS@@

- **Lint and format are check-only here.** @@LINT_CHECK_USE@@ and a format command that only checks. Give them the changed file paths when they take paths. Never run a command with `--fix` (or a script that runs one) in this step: an audit that changes files proves nothing. When the repo has only a fixing command, report "check-only command not available yet" and use the output of the post-review re-run. Judge by the exit code and the error count, never by the last lines of the output; search a long output with the Grep tool for the error marker of the linter.
- **One check, one place.** When a hard-rule row already covers a topic of a later row (for example secrets or contracts), the later row reuses that evidence and says so. Do not run the same check twice.

**Evidence gate.** A row is Pass only when you looked: name the files and lines, or the command and its counts. "Lint passed" does not prove a hard-rule row. An auto-fixed file gets the same audit.

### Red flags — stop if you catch yourself doing one of these

- A row is Pass, but you did not read the changed files of that row.
- A hard rule is N/A without a reason, or Pass because lint passed.
- The secrets check is skipped because "this project has no secrets".
- A placement is accepted because "the plan put it there". The plan is not an exception to a rule.
- A file is left out of the audit because the Step 1 reviewer rewrote it. Its fixes are code like any other.
- A security finding is accepted that cannot name the attacker, the victim and the result.
- A test count comes from an earlier run, not from a run in this step.
@@IF MOD_TEST_REVIEW@@

## Step 2.5 — Test review

Invoke `Skill(skill: "test-review", args: "--fix --base @@BASE_BRANCH@@ --plan <plan file>")` (leave out `--plan` when there is no plan file). It writes `.plans/.test-review/<branch-with-slashes-as-dashes>.md`. Carry its `## Summary for the PR` section into your report; `/skill-5-ship` and `/decision-sheet` read the file.

The **Tests** row fails when the summary lists a `POSSIBLE PRODUCTION BUG`, or a SURVIVED or MISSING item that `--fix` did not fix. Each such item also goes under **Open items**. A `Test review: OFF (<reason>)` summary fails the row with that reason.

After its `--fix`, run the scoped tests and the check-only lint again for the test files it changed.
@@END@@

## Step 3 — Report

Start with:

> **TLDR:** 1–3 plain sentences: what changed and the one thing to check first.
>
> **Suggested review order** (most important first):
> 1. `path/file` — why it matters

Rules for the review order:

- List only files in the verified scope: the Step 0 files plus the files Step 1 touched. Do not add other files.
- Rank by importance, not by name or folder: the code that the hard rules protect first, then contracts, data and migrations, then services and queries, then controllers, handlers and UI, then tests, then wiring and registration edits last.
- One line per file, with a short reason. Group closely related files on one line (for example a model and its spec) when it keeps the list short.
- Files the Step 1 reviewer rewrote rank above equal files that the author wrote, because nobody has read them yet. Mark them `(auto-fixed)`.
- Put each file with a Fail in the table at the top.

Then the table:

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Code review | Pass/Fail | rounds, fixed, deferred, re-test result |
| 2–@@AUDIT_LAST@@ | (as above) | Pass/Fail/N/A | files and lines, or command and counts |

Then **Code review rounds** (one line per round, and why the loop stopped: converged, only deferrals left, hit the cap, or escalated), **Findings**, **Violations** (file, line, what is wrong, the fix, and whether you fixed it), and **Open items**.

- **Findings:** every code-review finding of every round, numbered `F1`, `F2`, … in the order found: `F<n>. file:line — one-line gist — fixed | deferred | decided (<by whom>)`. Keep the numbers when you report again, so that "F3" means the same finding in the report, the PR and a follow-up chat.
- **Open items:** the deferred findings (by their `F<n>`) and the decisions for the owner. Write each decision as `Question N: <title>` in ASD-STE100: the facts, one example step by step, Option A (recommended) and Option B, and why A. The owner answers with a reply like "1A 2B", so the text must make sense without this session.

After any fix in this step, run the scoped tests and the check-only lint for the touched files again. Do not start the Step 1 loop again for rule fixes.

The step is complete only when rows 1–@@AUDIT_LAST@@ are Pass or N/A. Otherwise report what is left and stop.
@@IF MOD_STEP_GATE@@

When the step is complete, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> verify` (`<plan-basename>` without `.md`).
@@END@@

Next: `/skill-5-ship` (only when the owner asks, or in "to PR" mode).
