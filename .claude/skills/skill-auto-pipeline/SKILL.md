---
name: skill-auto-pipeline
description: Unattended pipeline runner. Runs /skill-2-implement → /skill-3-test → /skill-4-verify (/code-review loop + rule audit) → plan to done/ and one commit for the whole plan → optionally /skill-5-ship to a draft PR, for one plan inside a dedicated auto/* worktree, and keeps a status report. Launched headlessly by .claude/scripts/auto-pipeline.sh — not for interactive use.
disable-model-invocation: true
argument-hint: "<plan-file> --report=<abs-path> --stop-after=verify|commit|pr [--base=<branch>] [--resume]"
---

Run the unattended pipeline for: $ARGUMENTS

## Operating context — read first

You run **unattended** (headless `claude -p`, nobody watching) inside a dedicated **git worktree** on a branch `auto/<slug>`, created from `origin/<base>` by `.claude/scripts/auto-pipeline.sh`. `<base>` is `--base` (default `main`). Other runs may work in sibling worktrees. Never touch anything outside this worktree, except the report files in the main repo's `.plans/auto-runs/`.

**Authorization (owner-granted, this skill only):** you may `git add` and `git commit` on the current `auto/*` branch, in the **Commit** phase only. This is an exception to the global "never commit" rule.

**One commit per plan.** Phases 1–3 commit nothing: their work stays uncommitted in the worktree, and a resumed run finds it there. The Commit phase makes the one commit for the whole plan. `/skill-5-ship` adds no commit of its own, except the merge commit when `<base>` moved.

**Hard rules:**

- **Never** `git push`, `gh pr create` or another network write — except in `--stop-after=pr`, where `/skill-5-ship` pushes the current `auto/*` branch (never `--force`) and opens a **draft** PR. The owner granted this by choosing the "to PR" mode.
- **Never** switch branches, touch `<base>` or `main`, or change other worktrees.
- **Never** use AskUserQuestion. Nobody can answer it.
- **Never end your turn between two phases.** Continue until the run reaches the stop point of its mode (`--stop-after`) or a stop state (`FAILED`, `BLOCKED`, `NEEDS DECISION`). When a phase ends, update the report and start the next phase in the same turn. A turn that ends early stops the run silently: nobody is there to say "continue".
- **Never** delete or reset anything on failure. Leave the worktree as it is.
- **Never** edit files under `.claude/`, `.vscode/` or `~/.claude/`. A headless run cannot write there (Claude Code protects these folders). If the plan needs such a file, do the other steps and list the file under Open items for the owner.

**Run commands bare.** Allow rules match command prefixes. `git status` is allowed, but `git status && git log` or `<test command> 2>&1 | tail` is auto-denied headless. Run one bare command per call, with no pipes, `&&`, redirection or heredocs. A denied command is not a missing tool: write the exact command in the diagnosis.

**Background helpers.** The session ends when no background work is left. A helper that is not running any more can end the run silently, with the status still `RUNNING`.

- Before you start a helper, check that its prompt has no unfilled placeholder (for example `<...>`, `TODO`, `FILES_PLACEHOLDER`, an empty list). Fill each one, or do not start the helper.
- If a helper finished without doing its job, start a new one with corrected instructions, or do the work yourself. Never send a `SendMessage` correction to a helper that has finished, and do not wait for it to "resume".
- Before you end a turn to wait for helpers, name each helper you wait for. Wait only for a helper whose "finished" notice has not arrived.

**Owner decisions.** (1) Do what the plan says. (2) If the plan is silent and the choice is minor and conventional, follow the codebase and record the choice in the Timeline. (3) If the choice is significant (behavior, schema, an open decision in `docs/roadmap.md`, anything an external spec should define), do not guess: `/skill-2-implement` writes the question down and skips the dependent steps. See "Needs decision" below.

## Step 0 — Parse arguments and preflight

From `$ARGUMENTS` take the plan filename, `--report=<path>`, `--stop-after=verify|commit|pr`, the optional `--base=<branch>` and the optional `--resume`.

Preflight (on failure: status `FAILED: preflight` with the reason, then end):

- `git branch --show-current` starts with `auto/`.
- `git status --porcelain` is empty — fresh runs only, skipped with `--resume`.
- The plan file exists in `.plans/`, and the report file exists.
- **Submodules.** A new worktree does not initialize its submodules, and a command that writes into an empty submodule folder leaves stray files. When the worktree has a `.gitmodules` file, read the `path = …` lines and run `ls <path>` for each one (headless runs deny `git submodule status`). A folder that is empty or missing → run `git submodule update --init`, then check it again. When stray files block the update, list them under `## Diagnosis` and set status `BLOCKED: submodule <path> is not initialized`. Never delete the stray files yourself.
- Set the report status to `RUNNING` and add a Timeline entry.

**Resume:** read the report's Status and Timeline, `git status` and `git diff` (the work of finished phases is uncommitted until the Commit phase). Continue from the first incomplete phase. Do not redo completed phases. Add a Timeline entry that says where you resumed and why the earlier session stopped.

## Report protocol

The report is the owner's window into this run. The plans dashboard reads it. After the run, the launcher compacts this session, and the owner's follow-ups start from a summary. The report must hold everything a follow-up needs: every finding with its number, every open question exactly as written, the checks with their results, and the paths of the evidence files.

- After each phase: update the `## Status:` line and add one Timeline entry (`- HH:MM:SS — <one line>`).
- Statuses: `RUNNING` → `IMPLEMENTED` → `TESTED` → `VERIFIED` (→ `VERIFIED — AWAITING REVIEW` in verify mode) → `DOCUMENTED` → `COMMITTED — READY TO PUSH` (commit mode) or `PR OPEN — <url>` (pr mode). Stop states: `FAILED: <phase>`, `BLOCKED: <reason>`, `NEEDS DECISION — <n> questions`.
- Use no other status words. The dashboard reads `REVIEWED`, `VERIFIED`, `COMMITTED` and `PR OPEN` as "needs you". A status such as "TESTS REVIEWED" shows a running run as finished.
- Never edit the `- **Mode**:`, `- **Outcome**:` or `- **Link**:` lines. The launcher owns them.
- On `FAILED` or `BLOCKED`: add `## Diagnosis` — what failed, evidence (output excerpt, file:line), what you tried, a suggested next step.

## Phases

1. **Implement** — invoke `/skill-2-implement <plan-file>`. It commits nothing. Copy its summary into the report under `## Implementation`. Status `IMPLEMENTED`.
   - If it reports open questions, go to **Needs decision**.
2. **Test** — invoke `/skill-3-test <plan-file> --unattended`. It writes the missing tests, runs the scoped fix loop and one full run as evidence. Copy its summary under `## Tests`. Status `TESTED`. Tests still failing → `FAILED: test`. Open questions → **Needs decision**.
   - It also runs the plan's browser test. Copy its browser-test lines (rounds, report page link, findings fixed, findings listed, test data made) under `## Browser test`. In-scope findings still open after 3 rounds do not fail the run: they go to the PR as open points.
   - When the plan has a **Browser test** section that is not `None — <reason>`, "skipped" is not a valid result. The browser test did not run, or has no report page link → status `BLOCKED — browser test (<reason>)`, the reason under `## Diagnosis`, and end the session. Do not commit or ship without it.
3. **Verify** — invoke `/skill-4-verify <plan-file> --unattended`. It runs the `/code-review` loop (max 2 rounds) and the rule audit (hard rules, contracts, doc comments, tests, secrets, security, plan scope).
   - Each round of the loop is one Claude review, then one Codex review of the code that Claude's fixes left (max 2 rounds: Claude, Codex, Claude, Codex). It fixes the valid findings of both. Codex OFF (missing, not logged in, quota) never fails the phase: write one Timeline line with the reason.
   - It also runs `/test-review --fix`. Copy its `## Summary for the PR` under `## Test review`.
   - A `POSSIBLE PRODUCTION BUG` from the test review does not stop the run. A revert check that did not put a file back byte for byte (its `git hash-object` before and after differ) does: set `FAILED: test-review`, name the file under `## Diagnosis`, and end the session.
   - Run every command in the plan's "How to verify" yourself, as bare commands.
   - If its code-review loop, its Codex fixes or its test review changed a file, run the full test command once (AGENTS.md, **Commands**, "Test (full)"; skip it when that row is "not available yet") as a regression gate. The skill runs only the scoped tests. A failure counts toward the failure budget.
   - Copy its review order, table, rounds, numbered findings (`F1`, `F2`, …, with file:line and state) and open items (each question exactly as written) under `## Verification` and `## Code review`, plus its **Security: needs validation** block when there is one.
   - Any row still Fail after its fixes → `FAILED: verify`. Open items that need the owner → **Needs decision**. Otherwise status `VERIFIED`.

**Failure budget:** each phase gets at most 2 fix-and-retry rounds beyond the skills' own loops. Then set `FAILED: <phase>` with a diagnosis and end the session.

## Needs decision

When `/skill-2-implement` reports open questions: finish the phases that do not depend on them (verify the steps that were done), then set status `NEEDS DECISION — <n> questions`. Add a `## Questions` section with each question exactly as `/skill-2-implement` wrote it (ASD-STE100: the facts, one example step by step with real values, Option A (recommended) and Option B, why A). Do not document or ship. End the session. The owner answers, edits the plan, and resumes.

## If `--stop-after=verify`

Set status `VERIFIED — AWAITING REVIEW`, then append and end the session:

```markdown
## Take over

The work is in the worktree on `auto/<slug>`, not committed. Nothing is pushed.

    cd <worktree-path>
    git status
    git diff

To ship: resume this run in "to PR" mode. It makes the one commit, then opens the PR.
```

## If `--stop-after=commit` or `pr` — document

4. **Document** — run `bash .claude/scripts/workflow-complete-step.sh <slug> document`. After the fourth step mark, the script moves the plan to `.plans/done/` itself. Do not run `git mv`, and do not commit yet. If the plan is still in `.plans/`, a step mark is missing: run the missing marks (`implement`, `test`, `verify`) only when that phase passed, else `FAILED: document`. Status `DOCUMENTED`.
   - Record the new conventions now: read `.claude/skills/skill-5-ship/SKILL.md` and do its **Docs** step (Step 1.5) without its commit item, so the doc edits are part of the one commit. Write the files you changed, or "nothing to record", in the Timeline.
   - When the work adds no file under `changelog.d/`, read `.claude/skills/changelog-entry/SKILL.md` and follow it now, so the entry is part of the one commit. If it decides that no entry is necessary, write that in the Timeline.
5. **Commit** — one commit for the whole plan:
   1. `git status --porcelain`. Every path must belong to this plan: the files it changed, its tests, the plan's move to `.plans/done/`, the doc edits of the Document phase, and a changelog entry (with its version raise) if one was written. A path that does not belong (for example a tool's output file) → `FAILED: commit`, with the list under `## Diagnosis`.
   2. `git add -- <path> <path> …`, naming every path (a deleted or moved path too). Never `git add -A` or `git add .`.
   3. `git commit -m "<type>(<scope>): <what the plan does, in plain words>"`. Conventional Commits, no AI attribution. One commit: never split the work into several.

**commit mode:**

1. **PR body** — write `<report dir>/<slug>-pr-body.md` with the Write tool: a summary of the change, the plan file, the verification table and the test results. No AI attribution.
2. Set status `COMMITTED — READY TO PUSH`, append the hand-off with the real worktree path, base, commit title and PR body path, and end the session. Do not run its commands yourself.

```markdown
## Hand-off

Nothing is pushed. Resume this run in "to PR" mode, or run:

    cd <worktree-path>
    git push -u origin auto/<slug>
    gh pr create --draft --base <base> --title "<commit title>" --body-file <abs-path-to-pr-body>

After the merge, from the main checkout: `git pull`, then `bash .claude/scripts/auto-pipeline.sh --cleanup <slug>`.
```

**pr mode:**

6. **Decision sheet** — read `.claude/skills/decision-sheet/SKILL.md` and follow it with `--base <base> --plan .plans/done/<plan-file> --report <report> --out <report dir>/<slug>-decision-sheet.md`.
   When the Verify phase ran Codex (row 1 says `Codex ON`), add `--codex-report <path>` with the Codex report that row 1 names (`.plans/.code-reviews/<branch-with-slashes-as-dashes>-codex.md`, which holds the last round), so Codex does not review the same code twice.
   Write one Timeline line with its status, the number of questions and its path. It never blocks: when it fails, write one Timeline line and continue.
7. **Ship** — `/skill-5-ship` cannot be invoked as a skill from here (`disable-model-invocation`). Read `.claude/skills/skill-5-ship/SKILL.md` and follow it end to end with `--unattended --report <report> --base <base>`. It sets the final status: `PR OPEN — <url>` (with a `PR: <url>` line) or `BLOCKED: …`.
   - Its browser-test gate can stop the ship with `BLOCKED — browser test (<reason>)` and no PR. Copy the reason under `## Diagnosis`: the test did not run, it has no report page, or the PR body does not link it.
8. On `PR OPEN`, append and end the session:

```markdown
## Next — your part

1. Open the PR and review it ("Files changed" shows the whole change, in one commit).
2. Mark it "Ready for review" and merge it (squash: a squash merge keeps main to one commit per PR).
3. After the merge: `git pull`, then `bash .claude/scripts/auto-pipeline.sh --cleanup <slug>`.

Disagree with something? Comment on the PR, then run `/pr-feedback <PR#>`.
```
