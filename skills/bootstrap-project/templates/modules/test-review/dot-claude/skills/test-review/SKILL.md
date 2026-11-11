---
name: test-review
description: Independent review of the TESTS of a change. Dispatches the read-only test-reviewer agent (it never sees the author's reasoning) to map every behavior to the test that proves it, then runs revert checks — undo one behavior in production code, run its test, put the code back byte for byte — to prove that each test fails without the fix. With --fix, it makes weak or missing tests stronger and checks them again. Writes one report whose last section is a short summary for the PR. Use after /skill-4-verify, inside /skill-auto-pipeline, or on any branch when asked to "review the tests" or "do the tests prove anything".
argument-hint: "[--base <ref>] [--plan <file>] [--out <report path>] [--fix] [--max-checks <n>] [--focus \"<behaviors>\"]"
---

Test review: $ARGUMENTS

## Hard rules — read first

- **Never** run `git restore`, `git checkout -- <file>`, `git stash` or `git reset` to undo a revert check. The worktree can hold the whole change **uncommitted**, and each of these commands deletes it. Undo a check only with the reverse Edit, then prove that the file is identical (Step 3, item 5).
- Never edit production code, except the temporary revert-check edit. Always undo it before the next step.
- Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs. Headless pipeline runs auto-deny compound commands.
- Run Bash in this session, never in a subagent. Subagents do not get the run's Bash permissions.
- Commands come from the repo: `AGENTS.md`, section **Commands**, and the scripts in @@MANIFESTS@@. If a command is missing, write "not available yet". Never invent a command.

## Step 0 — Arguments and crash recovery

- `--base` (default `@@BASE_BRANCH@@`), `--plan` (optional), `--fix` (default off), `--max-checks` (default 10).
- `--focus "<text>"` (optional): the behaviors to review, for example the ones that a `/pr-feedback` fix changed. Give it to the reviewer word for word. The reviewer then reviews only those.
- `--out` default: `.plans/.test-review/<branch-with-slashes-as-dashes>.md`. Run `mkdir -p .plans/.test-review` when you use the default.
- **Crash recovery:** if the report file exists and has a `## Revert check in progress` section, an earlier run stopped while a revert check was applied. Undo it first: Edit `replace` → `find` in that file, run `git hash-object <file>`, and compare the result with the recorded hash. Equal → delete the section and continue. Not equal → **stop**, show the section, and tell the owner to examine the file by hand. Never guess.

## Step 1 — Dispatch the reviewer

Dispatch the `test-reviewer` agent (Agent tool, `subagent_type: "test-reviewer"`). The briefing has **only** these items: the base ref, the plan path (if any), the `--focus` text (if any), and "Follow your instructions and return your report." Do not describe the change, the bugs you fixed, or what you think the tests cover. The reviewer must not know the author's story.

Save its reply word for word in the report, under `## Reviewer report`. If the agent fails or returns nothing, try again once. A second failure → write `Test review: OFF (<reason>)` as the summary line (Step 5) and stop. Never write a substitute review yourself.

## Step 2 — Check the reviewer's claims

For each revert check, before you run it:

- Grep the file: `find` must occur **exactly once**. If not, skip the check as `INVALID (find not unique)`.
- Make sure that `file` is production code from the diff, not a test file, a fixture or a migration. If not, skip the check as `INVALID (not production code)`.

Keep the first `--max-checks` valid checks. At most 3 of them may use a slow end-to-end test.

## Step 3 — Run each revert check

Run the checks one at a time, in this order:

1. `git hash-object <file>`. Record the hash `H0`.
2. Add this to the report:
   ```
   ## Revert check in progress
   id: R1 · file: <file> · hash: <H0>
   find: <find> / replace: <replace>   (fenced, word for word)
   ```
3. Edit `<file>`: `find` → `replace`.
4. Run `command` exactly as given.
5. Edit `<file>`: `replace` → `find`. Run `git hash-object <file>`. The result must equal `H0`. If not, **stop the whole skill** and report. Keep the "in progress" section, so that the crash recovery can find it.
6. Delete the "in progress" section. Classify the check from the test output:
   - **KILLED** — at least one test failed on an assertion. The test proves the behavior.
   - **SURVIVED** — every test passed. The test does not prove the behavior.
   - **INVALID** — the test suite did not load or run (a syntax error, a missing module, a reference error), or 0 tests ran. This proves nothing.

## Step 4 — Fix (only with `--fix`)

At most 2 rounds. For each MISSING behavior, each WEAK test and each SURVIVED check:

1. Write the test, or make it stronger. Follow the pattern of the tests next to it and the nested `AGENTS.md` of the test folder, if there is one.
2. Run it against the unchanged code. It must pass. **If a new or stronger test fails against the real code, do not change the production code and do not make the test weaker.** Record it as `POSSIBLE PRODUCTION BUG` with the failure output. A person must decide about it.
3. Run the matching revert check again (Step 3). It must now be KILLED.

At the end, run the repo's lint and format commands (`AGENTS.md`, **Commands**) on the changed test files, if the commands exist.

## Step 5 — Report

Write the report at `--out`, with these sections in this order:

1. `## Revert checks` — a table: id, behavior, file, command, result (KILLED / SURVIVED / INVALID and the reason), and after `--fix`, the result of the second run.
2. `## Fixes` (only with `--fix`) — the tests added or changed, as file:line.
3. `## Reviewer report` — word for word, from Step 1.
4. `## Summary for the PR` — always the last section, always this shape:

```
Test review: <N> behaviors — <c> covered, <w> weak, <m> missing.
Revert checks: <k> killed, <s> survived, <i> invalid.
Open for a human: <none | one line per item: SURVIVED or MISSING not fixed, POSSIBLE PRODUCTION BUG>
```

Then tell the owner, in 3–5 lines: the summary, the report path, and the open items that need a decision (if any). In an interactive run without `--fix`, end with: "Run `/test-review --fix` to make the weak and missing tests stronger."
