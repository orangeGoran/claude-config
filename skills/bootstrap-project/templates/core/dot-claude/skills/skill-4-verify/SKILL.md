---
name: skill-4-verify
@@IF MOD_CODEX@@
description: Verify step of the workflow (step 4). Runs a bug-hunt loop of max 2 rounds; each round is one Claude /code-review and then one Codex review (the repo's validate-implementation skill; skipped when Codex is missing or out of quota), and it fixes and re-tests their valid findings (it stops when it converges or only deferrals are left), then audits the result against the hard rules in AGENTS.md (@@HARD_RULE_TITLES@@), contracts, doc comments, tests, secrets and plan scope, and reports an evidence table. Use after /skill-3-test; /skill-auto-pipeline calls it unattended.
argument-hint: "[plan file | files] [--unattended] [--no-codex]"
@@END@@
@@IFNOT MOD_CODEX@@
description: Verify step of the workflow (step 4). Runs a capped /code-review bug-hunt loop that fixes defects and re-tests them (it stops when it converges or only deferrals are left), then audits the result against the hard rules in AGENTS.md (@@HARD_RULE_TITLES@@), contracts, doc comments, tests, secrets and plan scope, and reports an evidence table. Use after /skill-3-test; /skill-auto-pipeline calls it unattended.
argument-hint: "[plan file | files] [--unattended]"
@@END@@
---

Verify: $ARGUMENTS

You run the **Verify** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

@@IF MOD_CODEX@@
`--no-codex` skips the Codex part of each round (Step 1, item 4).

**Order matters.** The bug hunt runs first (each round: Claude, then Codex), the rule audit second. The reviewers' fixes are code too, so the audit must see them.
@@END@@
@@IFNOT MOD_CODEX@@
**Order matters.** The bug hunt runs first, the rule audit second. The reviewer's fixes are code too, so the audit must see them.
@@END@@

## Rules

- Run commands bare, one per call: no pipes, `&&`, redirection or heredocs. Commands come from `AGENTS.md` (**Commands**) and @@MANIFESTS@@ only; a missing one is "not available yet".
- **Unattended** (`--unattended`): never use AskUserQuestion. Fix rule violations that have one clear fix. Put everything that needs a decision under **Open items**.
- Do not run `git add`, `git commit` or `git push`. The pipeline commits.

@@REPORTING_RULES@@

## Step 0 — Scope

- The changed files, each command in its own call: `git diff --name-only @@BASE_BRANCH@@...HEAD`, `git diff --name-only`, `git diff --cached --name-only`, `git ls-files --others --exclude-standard`.
- A plan file: also read it. Its **Affected files** list is the expected scope, and its **Tests** section feeds the **Tests** row.
- Unclear scope: interactive, ask; unattended, use the plan's **Affected files** plus the changed files, and record the choice under **Open items**.

@@IF MOD_CODEX@@
## Step 1 — Bug hunt (max 2 rounds; each round is one Claude review, then one Codex review)

The rule audit (Step 2) checks compliance, not logic. Run the bug hunt yourself; do not leave "run /code-review next" for the owner. It is a loop, because a fix that rewrites a query or a branch changes the code that the next review reads. Each round has two reviewers in this order: Claude reads the code, then Codex reads the code that Claude's fixes left. Round 2 repeats both on the result of round 1.

### One round

1. **Claude.** Invoke the code-review skill: `Skill(skill: "code-review", args: "high --fix")`. You wrote this code, so do not review it inline yourself.
2. **Re-test Claude's fixes.** They are not checked yet. List the files it touched (`git diff --name-only`). For each one, run the scoped tests (AGENTS.md, **Commands**, "Test (one file)") and the check-only lint and format commands again. When it touched an entry point that an end-to-end test covers (a route, a handler, a public interface), also run the matching end-to-end test ("Test (end to end)"). A command that is "not available yet" is skipped with that reason. Fix a failure before the Codex part.
3. **Record Claude's part:** findings fixed, findings deferred, files touched, re-test result. Number each finding `F1`, `F2`, … in the order found.
4. **Codex** (skip with `--no-codex`, or when Codex is OFF for the run):
   1. **Find the CLI (round 1 only).** `command -v codex`, else `test -x ~/.local/bin/codex` (the Bash tool does not load `~/.zshrc`). Use the one you found as `<codex>`. Write the path exactly as `codex` or `~/.local/bin/codex` (with the `~`, not the expanded home folder): the allow rules match that text. Then run `<codex> login status`. Missing or not logged in → **Codex OFF for the run** ("Codex not available"; the fix for the owner: `npm install -g @openai/codex`, then `codex login`). A command that the session refuses ("requires approval") is not a missing CLI: record `permission denied: <command>`.
   2. **Run it.** `mkdir -p .plans/.code-reviews`. Then, as a background Bash with a 10-minute timeout, run the repo's Codex skill as it is, with the round number in the file name:
      ```bash
      <codex> exec --sandbox read-only -o ".plans/.code-reviews/<branch-with-slashes-as-dashes>-codex-round-<n>.md" "Use the validate-implementation skill from this repository (.codex/skills/validate-implementation/SKILL.md) and follow it exactly. Base: @@BASE_BRANCH@@. Plan: <plan file or none>. Read the skill file first. Your final message must be only the report." </dev/null
      ```
      Keep `</dev/null` (without it, `codex exec` waits for input forever). Do not pipe the output, and never edit the `-o` file. A non-zero exit, a timeout, an empty `-o` file, or output that mentions a quota, a usage limit, a rate limit or billing → **Codex OFF for this round** with that reason in a few words (`quota: usage limit until 14:00`). A quota or a missing CLI keeps it OFF for the rest of the run; after another failure, try again in the next round.
   3. **Codex OFF never fails this step.** Interactive: tell the owner in one line (`Codex is OFF: <reason> — continuing with Claude only`). Write the reason in the round log and in row 1.
   4. **Check each finding** against the code as `/apply-validation` does: VALID, PARTIALLY VALID or INVALID, each with `file:line` evidence. A finding that repeats an earlier finding keeps its `F<n>`. Number the new ones after the last number and mark them `(codex)`.
   5. **Fix the VALID findings.** Then re-test the touched files as item 2 says. A VALID finding without one clear fix is deferred and goes under **Open items**. A finding that argues against an earlier fix is an oscillation: do not change the code, report both versions ("Stop at once").
   6. **Record Codex's part:** VALID, fixed, deferred, files touched, re-test result, and the report path. Codex's "Present but not planned" list goes under **Open items** when a person must decide whether to keep the extra code.

### When to stop

Stop the loop after a round as soon as one of these is true. An early stop is the normal result:

- **Converged:** in this round, neither Claude nor Codex fixed anything or found anything new. A finding that repeats an earlier deferred finding is not new.
- **Only deferrals left:** the round found problems but could fix none of them. They need a person; more rounds do not help.

**Hard cap: 2 rounds** (Claude, Codex, Claude, Codex). Never run a third. If round 2 still fixed something, stop anyway, say that the loop hit the cap, and list what round 2 changed, so the owner looks at it first.

**Stop at once and escalate** (report, do not continue):

- **Oscillation:** a reviewer undoes or argues against an earlier fix (its own or the other reviewer's). Report both versions and which one is in the tree. A person decides.
- **A test keeps failing:** the same test still fails after two fix attempts. Report it; do not keep patching.
@@END@@
@@IFNOT MOD_CODEX@@
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
@@END@@

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
- Files that a reviewer's fixes rewrote (Step 1 and later) rank above equal files that the author wrote, because nobody has read them yet. Mark them `(auto-fixed)`.
- Put each file with a Fail in the table at the top.

Then the table:

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
@@IF MOD_CODEX@@
| 1 | Code review | Pass/Fail | rounds, fixed, deferred, re-test result; per round `Codex ON: <n> VALID, <n> fixed, <n> deferred` or `Codex OFF: <reason>`; the path of the last Codex report that ran |
@@END@@
@@IFNOT MOD_CODEX@@
| 1 | Code review | Pass/Fail | rounds, fixed, deferred, re-test result |
@@END@@
| 2–@@AUDIT_LAST@@ | (as above) | Pass/Fail/N/A | files and lines, or command and counts |

@@IF MOD_CODEX@@
Codex OFF does not make row 1 Fail.

Then **Code review rounds** (per round one line for Claude and one line for Codex: ON with its counts and the report path, or OFF with the reason; then why the loop stopped: converged, only deferrals left, hit the cap, or escalated), **Findings**, **Violations** (file, line, what is wrong, the fix, and whether you fixed it), and **Open items**.
@@END@@
@@IFNOT MOD_CODEX@@
Then **Code review rounds** (one line per round, and why the loop stopped: converged, only deferrals left, hit the cap, or escalated), **Findings**, **Violations** (file, line, what is wrong, the fix, and whether you fixed it), and **Open items**.
@@END@@

- **Findings:** every code-review finding of every round, numbered `F1`, `F2`, … in the order found: `F<n>. file:line — one-line gist — fixed | deferred | decided (<by whom>)`. Keep the numbers when you report again, so that "F3" means the same finding in the report, the PR and a follow-up chat.
- **Open items:** the deferred findings (by their `F<n>`) and the decisions for the owner. Write each decision as `Question N: <title>` in ASD-STE100: the facts, one example step by step, Option A (recommended) and Option B, and why A. The owner answers with a reply like "1A 2B", so the text must make sense without this session.

After any fix in this step, run the scoped tests and the check-only lint for the touched files again. Do not start the Step 1 loop again for rule fixes.

The step is complete only when rows 1–@@AUDIT_LAST@@ are Pass or N/A. Otherwise report what is left and stop.
@@IF MOD_STEP_GATE@@

When the step is complete, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> verify` (`<plan-basename>` without `.md`).
@@END@@

Next: `/skill-5-ship` (only when the owner asks, or in "to PR" mode).
