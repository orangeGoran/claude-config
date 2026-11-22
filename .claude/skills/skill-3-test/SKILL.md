---
name: skill-3-test
description: Test step of the workflow (step 3). Writes the tests the plan asks for that are still missing (end-to-end tests are mandatory for each new or changed endpoint), then runs separate scoped run → diagnose → fix loops for unit tests, end-to-end tests and lint until they pass, and ends with one full-suite run as evidence. Use after /skill-2-implement; /skill-auto-pipeline calls it unattended.
argument-hint: "[plan file | pattern | all] [--unattended]"
---

Test: $ARGUMENTS

You run the **Test** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

## Rules

- **Commands come from the repo.** Use only the commands in `AGENTS.md`, section **Commands**, and the scripts in `package.json`. If a check has no command yet, write "not available yet". Never invent a command.
- **Run commands bare:** one command per call, no pipes, `&&`, `tee`, redirection or heredocs. Headless runs auto-deny compound commands. Read the failures from the command output itself. When the output is too long to read, search it with the Grep tool, not with a pipe. Never run a suite again only to find its failures.
- **Command rows.** This skill names rows of the `AGENTS.md` **Commands** table: "Test (one file)", "Test (full)", "Test (end to end)", "Lint", "Lint (check only)" (only some repos have it) and "Format". A row that says "not available yet", or that the table does not have, has no command: write "not available yet" for that check and do not invent one.
- **Test data.** Use made-up test data only. Never put real customer data, real names, real addresses or real secrets in a test or a fixture. Example: `"Ana Example"`, `ana@example.test`, a fake key `sk-test-0000`.
- **Unattended** (`--unattended`, set by `/skill-auto-pipeline`): never use AskUserQuestion. When this skill says "ask", write the question in the summary as an open question instead.
- Do not run `git add`, `git commit` or `git push` here. The pipeline commits.

## Reporting rules

These rules apply to every summary, report section, PR body, comment and status line that this skill writes. The owner reads them instead of the code, so a wrong "done" costs more than an honest "open".

- **Every claim names its evidence:** a link, a `file:line`, or the command and its result (counts, exit code). A claim without evidence is "not checked", never "done".
- **An odd value is a finding until you prove that it is harmless:** a count of 0, a skipped test, an empty file or section, a link that does not load, a status that does not match the plan. Write what you checked to clear it, or list it as open.
- **Count the real state.** A summary gives the count of the whole, for example "41 passed, 2 skipped". Never write "all done", "everything works" or "complete" unless the count shows it.
- **"Skipped" is not a result** for a check that the plan or this skill requires. A required check that did not run is open, with the reason.
- **When the evidence changes after the PR opened** (a new test result, a fix, a new browser-test report), rebuild the decision sheet and update the PR body. Each line of the sheet (for example "Browser test") must match the PR body.

## Step 0 — Scope

- A plan file: read its **Tests** section (unit tests, end-to-end tests, harness constraints), its **Browser test** section and its **How to verify** section. That is the scope.
- A pattern: test only the matching files.
- `all`: every test command the repo has.
- Nothing: use `git diff --name-only main...HEAD` and `git status --porcelain`. If the scope is still unclear, ask (interactive) or test the changed packages (unattended).

## Step 1 — Write the missing tests

- `/skill-2-implement` writes the unit tests with each step. Here, compare the plan's **Tests** section with the test files, and write only the missing ones. Write the end-to-end tests here.
- Put tests where the package's existing tests are. Follow their pattern. If the package has no tests yet, follow the pattern the plan names. Read the nested `AGENTS.md` of the test folder first, if it has one: it lists the traps of the test harness.
- **End-to-end tests are mandatory for each new or changed endpoint** when the project has an HTTP API. Each endpoint gets tests for: success, a validation error, 401 and 403 for each role that the plan's access rules name, 404 for a missing or foreign resource, and, when the project is multi-tenant, a request from another tenant that gets no data. Use the shared test helpers that the existing end-to-end tests use. When the repo has no end-to-end command yet ("Test (end to end)" is "not available yet"), write the cases as an open question, not as skipped tests.
- **Hard rules need a negative test.** When the change touches a hard rule in `AGENTS.md` (restart after dashboard changes, no npm dependencies, public repo: no private data, global rules affect every project, never stop processes by name, tests for logic changes, docs: current state only), add a test that fails when the rule breaks. A test that only checks the happy path is not enough.
- **The tests this project needs for its rules** (when the change touches the rule):
- **Tests for logic changes:**
  - node --test on the matching apps/<app>/test/*.test.mjs or test/*.test.mjs file passes.
- **Contracts:** a contract change needs a test that accepts a valid sample and rejects an invalid one.
- Do not change an existing test to make it pass unless the plan changes that behavior. Say which tests you changed and why.
- For each new test, ask: would it still pass if the feature were not built? If yes, rewrite it.

## Step 2 — Fix loops (scoped)

Run only the tests in scope. Never the full suite inside a loop. Each loop below has its own circuit breaker: **the same test (or lint error) still fails after 3 different fixes → stop that loop and report it** (interactive: ask the owner; unattended: an open question in the summary).

**Check that a scoped run ran only the scoped files.** Read the file list or the file count in the output. A wrong pattern can silently run every file, or none: 0 tests ran is a failure of the command, not a pass.

### 2a — Unit tests

1. Run the scoped command (AGENTS.md, **Commands**, "Test (one file)") with the test files in scope. If that row is "not available yet", run "Test (full)" once and treat it as the scoped run; say so in the summary.
2. All pass → 2b.
3. A failure → read every failure from the output of that run (do not run it again to find them). Read the test and the code it tests. Decide where the defect is. Fix the code, unless the test expectation is wrong. Run the same command again.

### 2b — End-to-end tests

Run this loop when the scope has end-to-end tests (a new or changed endpoint, or a plan that lists them). Start the local services first when the end-to-end tests need them.

1. Run "Test (end to end)" for the scoped files only, with the file filter the runner has. When the row is "not available yet", say so and skip this loop.
2. All pass → 2c.
3. A failure → the same diagnose → fix → run cycle as 2a.

### 2c — Lint and format

1. Run the "Lint" and "Format" commands on the changed files (a command that fixes files is fine in this step). When the Commands table has a "Lint (check only)" row, run it after the fix: its exit code is the result.
2. **Judge by the exit code and the error count, never by the tail of the output.** A long output can bury an error under many warnings. Search it with the Grep tool for the error marker of the linter. Exit 0 → go on.
3. Lint errors (not only warnings) → read them from that output, fix the code (never the lint config), and run the lint command again.
4. **After any lint fix, run the scoped tests of 2a and 2b again once.** A lint fix can break a test. A failure → back to that loop.

## Step 2.5 — Browser test

Run it when the plan has a **Browser test** section that is not `None`. Unit tests pass first (Step 2). Then it is required: "skipped" is not a result. When it cannot run (a service is down, the new code does not start, an account is missing), stop and report `BLOCKED — browser test (<reason>)` (interactive: tell the owner). A plan that needs no browser test says `None — <reason>` in its section; only that skips this step.

Call the skill's scripts with the home folder written out, for example `node /Users/ana/.claude/skills/browser-usability-test/scripts/<file>.mjs` (not `~` and not `$HOME`; `QA_*=` variables in front when needed), as bare commands: the run's allow rules match that form. Click flows (a script you write in the scratchpad) run through the skill's runner, `node /Users/ana/.claude/skills/browser-usability-test/scripts/run.mjs <absolute path>/flow.mjs`, never as `node flow.mjs`. A headless run can click: "cannot click" is not a reason for `BLOCKED`. A refused command is, with the exact command quoted. Run scripts write only into `QA_DIR`, never into this tree.

1. Read `~/.claude/browser-usability-test/projects/claude-config/notes.md`. It says how to start the new code next to the app on http://127.0.0.1:4899 (the old code), which accounts to use, and which test data writes are allowed.
2. Start the new code from this tree as the notes say, in the background. Name the helper before you wait for it. A temporary config file the notes add is deleted in step 6 and is never committed.
3. Run the `browser-usability-test` skill on the routes and siblings of the plan's **Browser test** section: the old code on http://127.0.0.1:4899 and the new code, with the same account, width and data. Answer its questions from here, so it never stops:

   | It wants to ask | Answer |
   | --- | --- |
   | Which account or tenant | The profile notes; make new test data only as they allow |
   | May I write test data | Yes, where the profile notes allow it; nowhere else |
   | Which siblings to compare | The plan's **Siblings** line |
   | Should I fix a finding | Item 4 below decides |
   | Post pictures on a ticket | No. This project posts no ticket evidence; the report page is the evidence |
   | Where the report page goes | Set `QA_RUN_SLUG=<plan slug>` when you run `compare.mjs`: one page per run, so parallel runs on the same route do not overwrite each other |
   | A design choice (siblings disagree) | Do not pick. Write it as an open question |

4. For each finding:
   - **Inside the plan:** fix it now, without asking. Add a unit test when one can catch it, run the scoped tests again, and retest that screen.
   - **The same defect in a sibling place:** fix it when the plan covers that place; otherwise list it with `file:line`.
   - **A backend defect** (wrong data, a missing field, a wrong error): never work around it in this repo. Follow the hard rules in `AGENTS.md`, and list it.
   - **Outside the plan:** do not fix it. List it as a known limit.
5. Repeat the browser test on the changed screens until no finding inside the plan is open, at most 3 rounds. Findings still open after round 3 go to the summary as open points.
6. Stop the server and delete the temporary files of step 2 with the skill's `scripts/cleanup.mjs` (full path, as above; it removes the `vite.qa.config.*` files and `node_modules/.vite-qa-*` caches of this tree, and lists other untracked files a script may have left). Keep the report page link.

## Step 3 — Evidence gate

**No claim without a fresh run.**

1. Run each full test command once, not scoped (AGENTS.md, **Commands**, "Test (full)", and "Test (end to end)" when the scope has end-to-end tests). A row that is "not available yet" is reported as such.
2. Read every failure from that output; do not run the suite again to find them. Search a long output with the Grep tool for the failure markers: ` FAIL ` and `✗` or `×` lines (Vitest, Jest), `✘` and `<n> failed` lines (Playwright), `FAILED` and `ERROR` lines (pytest).
3. Read the result counts per command: passed, failed, skipped. Check for 0 failed, and that the count of tests that ran is not 0.
4. Only then report. A skipped test is not a pass. Results from an earlier run do not count.
5. When all tests pass, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> test` (`<plan-basename>` without `.md`).

### Red flags — stop if you catch yourself doing one of these

- "The tests should pass" or "probably pass" without a run.
- A result from an earlier run instead of a fresh one.
- A lint or test verdict from the last lines of a long output.
- "All tests pass" when some were skipped, or when a scoped run ran 0 tests or every file.
- Only the unit tests ran, but the scope also needs the end-to-end tests.
- An existing test was changed to make it pass, and the plan does not change that behavior.
- A test that would still pass if the feature were not built.

## Step 4 — Summary

- **Loop rounds:** how many fix rounds per loop (unit, end to end, lint; 0 = passed the first time).
- **Tests:** per command: passed, failed, skipped. Unit and end-to-end tests on separate lines.
- **Lint:** the exit code, errors and warnings per command, or "not available yet".
- **Tests written:** one line each, with what it proves.
- **Fixes made:** file and what changed.
- **Browser test:** rounds, the report page link, findings fixed, findings listed (sibling, backend, outside the plan), and test data made (accounts, tenants, records). `None — <reason>` only when the plan's section says `None`; otherwise a browser test that did not run is `BLOCKED — browser test (<reason>)`, never "skipped".
- **Open questions:** "none", or each one in ASD-STE100 (the facts, one example step by step, Option A (recommended) and Option B, why A).

Next: `/skill-4-verify`.
