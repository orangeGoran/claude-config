---
name: decision-sheet
@@IF MOD_CODEX@@
description: Build the PR decision sheet — at most 5 yes/no questions that only a person can answer (behavior changes, breaking changes, production impact, access changes, choices nobody planned), plus one block of what machines already checked. Optionally runs the Codex implementation review first, and skips it when Codex is missing or out of quota. The output is a checkbox block that /skill-5-ship --unattended puts in the PR body and that the "Decision Sheet" CI check reads. Use in /skill-auto-pipeline before ship, from /pr-feedback, or when the owner asks for "the decision sheet" or "what do I need to decide on this branch".
argument-hint: "[--base <ref>] [--plan <file>] [--report <pipeline report>] [--test-review <report>] [--out <path>] [--no-codex] [--fix]"
@@END@@
@@IFNOT MOD_CODEX@@
description: Build the PR decision sheet — at most 5 yes/no questions that only a person can answer (behavior changes, breaking changes, production impact, access changes, choices nobody planned), plus one block of what machines already checked. The output is a checkbox block that /skill-5-ship --unattended puts in the PR body and that the "Decision Sheet" CI check reads. Use in /skill-auto-pipeline before ship, from /pr-feedback, or when the owner asks for "the decision sheet" or "what do I need to decide on this branch".
argument-hint: "[--base <ref>] [--plan <file>] [--report <pipeline report>] [--test-review <report>] [--out <path>]"
@@END@@
---

Decision sheet: $ARGUMENTS

The reader opens this on a PR and has about two minutes. The reader does not read the code. The reader must be able to answer each question from the question text alone.

## Step 0 — Arguments

- `--base` (default `@@BASE_BRANCH@@`). `--plan` (optional; else the plan named in `--report`, else none).
- `--report`: the `/skill-auto-pipeline` run report, when there is one.
- `--test-review`: the `/test-review` report (default `.plans/.test-review/<branch-with-slashes-as-dashes>.md` when it exists).
- `--out` (default `.plans/.decision-sheets/<branch-with-slashes-as-dashes>.md`). Run `mkdir -p .plans/.decision-sheets` when you use the default.
@@IF MOD_CODEX@@
- `--no-codex`: skip Step 2. `--fix`: fix the VALID Codex findings (Step 2, item 4).
@@END@@

Run every shell command bare: one command per call, no pipes, `&&`, redirection or heredocs. Headless runs auto-deny compound commands. Run the commands in this session, never in a subagent.

## Step 1 — Collect the facts

Read, do not guess. Each number in a question must come from one of these facts. Run each command alone:

- `git merge-base <base> HEAD` → `<mb>`
- `git diff --stat <mb>`
- `git diff <mb>`
- `git status --short` (untracked files are new: read them)
- `git log --format=%s <mb>..HEAD`

Also read: the plan; the `changelog.d/` entry of this branch, if the project has `changelog.d/`; the contract changes (contract source: @@CONTRACT_SOURCE@@); the `## Timeline`, `## Code review` and `## Verification` sections of the pipeline report; the summary of the test-review report, if there is one.

@@IF MOD_CODEX@@
## Step 2 — Codex review (optional, never blocking)

Skip it with `--no-codex`. Otherwise:

1. Find the CLI: `command -v codex`, else `test -x ~/.local/bin/codex` (the Bash tool does not load `~/.zshrc`). Use the one you found as `<codex>`. Write the path exactly as `codex` or `~/.local/bin/codex` (with the `~`, not the expanded home folder): the allow rules match that text. Then run `<codex> login status`. Missing or not logged in → **Codex OFF** ("Codex not available"). A command that the session refuses ("requires approval") is not a missing CLI. Record it as `permission denied: <command>`, so that the allow rule is easy to fix.
2. Run it (background Bash, 10-minute timeout) with the repo's Codex skill as it is:
   ```bash
   <codex> exec --sandbox read-only -o "<out-dir>/<branch>-codex.md" "Use the validate-implementation skill from this repository (.codex/skills/validate-implementation/SKILL.md) and follow it exactly. Base: <base>. Plan: <plan or none>. Read the skill file first. Your final message must be only the report." </dev/null
   ```
   Keep `</dev/null` (without it, `codex exec` waits for input forever). A non-zero exit, a timeout, an empty `-o` file, or output that mentions a quota, a usage limit, a rate limit or billing → **Codex OFF** with that reason in a few words (`quota: usage limit until 14:00`).
3. **Codex OFF never fails this skill.** Record the reason and continue.
4. Codex ON: check each finding against the code as `/apply-validation` does (VALID / PARTIALLY VALID / INVALID with evidence). With `--fix`, fix the VALID findings (max 1 round), then run the scoped tests and lint for the touched files again (AGENTS.md, Commands; a missing command is "not available yet"). A VALID finding that you did not fix becomes an open item (Step 3, kind 6). Its "Present but not planned" list feeds kind 5.
@@END@@

## Step 3 — Pick the questions

**The plan is already decided.** The owner approved it before the run. Do not ask about anything that the plan states and the tests prove.

**Do not ask about other teams or apps that consume a contract change.** Put each contract change (a new or changed status code, field, route, event or payload) on the `Contract changes` line in "Checked by machines" (Step 5).

Ask only about these six kinds, and only when the facts show one:

1. **Behavior change for existing users.** Something that worked one way before this branch and works another way now (a list that now shows or hides rows, a rule that now refuses an action). Not a new feature that the plan asked for.
2. **Breaking change for a customer.** A change that breaks a customer's own integration or stored data, for example a script that calls the API.
3. **Production impact.** A migration (read each statement: `NOT NULL` on an existing column, an `UPDATE` backfill, a type change, an index on a large table), a manual deploy step, a new key in `.env.example`, a changed default in a seed or a configuration.
4. **Access change.** Who can now do something that they could not do before, or the reverse: a new or changed access check, permission or role, a public endpoint, a rate limit.
5. **Choice nobody planned.** A Timeline entry where the pipeline chose a convention because the plan was silent, a merge conflict where the run picked one side, or an unplanned change that a review judged VALID.
6. **Open finding.** A test-review finding marked as a possible production bug, a verify finding marked deferred, a VALID review finding that is not fixed, or a fact that a security check needs (ask for the missing fact).

Order the questions by risk, highest first. **More than 5 → the PR is too big for a two-minute read.** Keep all of them (to hide one is worse), and set the status to 🔴 with "split suggested".

### How to write one question

- One checkbox line, then at most 3 indented lines.
- Plain words. A real role and real values, **before → after**. Example: `@@QUESTION_ACTOR@@ sends PUT /api/v1/items/X, where X belongs to another user. Before: 200 and the item changes. Now: 404.`
- End with a question that a "yes" accepts: `Keep it?`, `OK?`
- A number that you could not get from the facts stays out. Write `row count in production: unknown` and not a guess.
- Add the evidence at the end: `(src/…/items.service.ts:88)`.

## Step 4 — Status

- 🟢 every check ran and there is no kind-6 item;
- 🟡 a check was OFF or skipped and there is no kind-6 item;
- 🔴 any kind-6 item, or more than 5 questions.

## Step 5 — Write the sheet

Write `--out` with the Write tool, in exactly this shape. The markers and the checkbox format are a contract: the "Decision Sheet" CI check and `/pr-feedback` read them.

```markdown
<!-- decision-sheet:start v1 -->
## Your decisions — tick each box you agree with
Status: 🟡 1 check skipped (<check>: <reason>)

- [ ] 1. Behavior. <actor> …. Before: …. Now: …. OK?
      (src/…:88)
- [ ] 2. …

Disagree? Untick or comment, then run `/pr-feedback <PR#>`.

## Checked by machines
✅ Local gates: <each check that ran, with its counts>
✅ Verify: <n> findings fixed, <n> open
✅ Test review: <the first two lines of its summary>
ℹ️ Contract changes: <one short item per change, or "none">
@@IF MOD_CODEX@@
⏭ Codex: skipped (<reason>). Run `/pr-feedback <PR#> --codex` to add it later.
@@END@@
<!-- decision-sheet:end -->
```

- No questions → put `No decisions needed.` in place of the list, and keep the rest. The CI check passes with zero boxes.
- Each "Checked by machines" line states what really ran. A check that did not run is ⏭ with the reason, never ✅.
- Numbers start at 1 each time you build the sheet again. `/pr-feedback` matches boxes by their text, not their number.

Then tell the owner in 3 lines: the status, the number of questions, and the path.
