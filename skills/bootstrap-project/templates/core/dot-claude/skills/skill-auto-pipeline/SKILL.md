---
name: skill-auto-pipeline
description: Unattended pipeline runner. Runs /skill-2-implement → /skill-3-test → /skill-4-verify (/code-review loop + rule audit) → plan to done/ and one commit for the whole plan → optionally /skill-5-ship to a draft PR, for one plan inside a dedicated auto/* worktree, and keeps a status report. Launched headlessly by .claude/scripts/auto-pipeline.sh — not for interactive use.
disable-model-invocation: true
argument-hint: "<plan-file> --report=<abs-path> --stop-after=verify|commit|pr [--base=<branch>] [--resume]"
---

Run the unattended pipeline for: $ARGUMENTS

## Operating context — read first

You run **unattended** (headless `claude -p`, nobody watching) inside a dedicated **git worktree** on a branch `auto/<slug>`, created from `origin/<base>` by `.claude/scripts/auto-pipeline.sh`. `<base>` is `--base` (default `@@BASE_BRANCH@@`). Other runs may work in sibling worktrees. Never touch anything outside this worktree, except the report files in the main repo's `.plans/auto-runs/`.

**Authorization (owner-granted, this skill only):** you may `git add` and `git commit` on the current `auto/*` branch, in the **Commit** phase only. This is an exception to the global "never commit" rule.

**One commit per plan.** Phases 1–3 commit nothing: their work stays uncommitted in the worktree, and a resumed run finds it there. The Commit phase makes the one commit for the whole plan. `/skill-5-ship` adds no commit of its own, except the merge commit when `<base>` moved.

**Hard rules:**

- **Never** `git push`, `gh pr create` or another network write — except in `--stop-after=pr`, where `/skill-5-ship` pushes the current `auto/*` branch (never `--force`) and opens a **draft** PR. The owner granted this by choosing the "to PR" mode.
- **Never** switch branches, touch `<base>` or `@@PROD_BRANCH@@`, or change other worktrees.
- **Never** use AskUserQuestion. Nobody can answer it.
- **Never** delete or reset anything on failure. Leave the worktree as it is.
- **Never** edit files under `.claude/`, `.vscode/` or `~/.claude/`. A headless run cannot write there (Claude Code protects these folders). If the plan needs such a file, do the other steps and list the file under Open items for the owner.

**Run commands bare.** Allow rules match command prefixes. `git status` is allowed, but `git status && git log` or `<test command> 2>&1 | tail` is auto-denied headless. Run one bare command per call, with no pipes, `&&`, redirection or heredocs. A denied command is not a missing tool: write the exact command in the diagnosis.

**Background helpers.** The session ends when no background work is left. Before you wait for a helper, name it. If a helper finished without doing its job, start a new one with corrected instructions, or do the work yourself.

**Owner decisions.** (1) Do what the plan says. (2) If the plan is silent and the choice is minor and conventional, follow the codebase and record the choice in the Timeline. (3) If the choice is significant (behavior, schema, an open decision in `@@PARENT_PLAN@@`, anything an external spec should define), do not guess: `/skill-2-implement` writes the question down and skips the dependent steps. See "Needs decision" below.

## Step 0 — Parse arguments and preflight

From `$ARGUMENTS` take the plan filename, `--report=<path>`, `--stop-after=verify|commit|pr`, the optional `--base=<branch>` and the optional `--resume`.

Preflight (on failure: status `FAILED: preflight` with the reason, then end):

- `git branch --show-current` starts with `auto/`.
- `git status --porcelain` is empty — fresh runs only, skipped with `--resume`.
- The plan file exists in `.plans/`, and the report file exists.
- Set the report status to `RUNNING` and add a Timeline entry.

**Resume:** read the report's Status and Timeline, `git status` and `git diff` (the work of finished phases is uncommitted until the Commit phase). Continue from the first incomplete phase. Do not redo completed phases. Add a Timeline entry that says where you resumed and why the earlier session stopped.

## Report protocol

The report is the owner's window into this run. The plans dashboard reads it.

- After each phase: update the `## Status:` line and add one Timeline entry (`- HH:MM:SS — <one line>`).
- Statuses: `RUNNING` → `IMPLEMENTED` → `TESTED` → `VERIFIED` (→ `VERIFIED — AWAITING REVIEW` in verify mode) → `DOCUMENTED` → `COMMITTED — READY TO PUSH` (commit mode) or `PR OPEN — <url>` (pr mode). Stop states: `FAILED: <phase>`, `BLOCKED: <reason>`, `NEEDS DECISION — <n> questions`.
- Never edit the `- **Mode**:`, `- **Outcome**:` or `- **Link**:` lines. The launcher owns them.
- On `FAILED` or `BLOCKED`: add `## Diagnosis` — what failed, evidence (output excerpt, file:line), what you tried, a suggested next step.

## Phases

1. **Implement** — invoke `/skill-2-implement <plan-file>`. It commits nothing. Copy its summary into the report under `## Implementation`. Status `IMPLEMENTED`.
   - If it reports open questions, go to **Needs decision**.
2. **Test** — invoke `/skill-3-test <plan-file> --unattended`. It writes the missing tests, runs the scoped fix loop and one full run as evidence. Copy its summary under `## Tests`. Status `TESTED`. Tests still failing → `FAILED: test`. Open questions → **Needs decision**.
3. **Verify** — invoke `/skill-4-verify <plan-file> --unattended`. It runs the `/code-review` loop (max 2 rounds) and the rule audit (hard rules, contracts, doc comments, tests, secrets, plan scope).
@@IF MOD_TEST_REVIEW@@
   - It also runs `/test-review --fix`. Copy its `## Summary for the PR` under `## Test review`.
@@END@@
   - Run every command in the plan's "How to verify" yourself, as bare commands.
   - Copy its review order, table, rounds and open items under `## Verification` and `## Code review`.
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

@@IFNOT MOD_STEP_GATE@@
4. **Document** — `git mv .plans/<plan-file> .plans/done/<plan-file>`. Do not commit yet. Status `DOCUMENTED`.
@@END@@
@@IF MOD_STEP_GATE@@
4. **Document** — run `bash .claude/scripts/workflow-complete-step.sh <slug> document`. After the fourth step mark, the script moves the plan to `.plans/done/` itself. Do not run `git mv`, and do not commit yet. If the plan is still in `.plans/`, a step mark is missing: run the missing marks (`implement`, `test`, `verify`) only when that phase passed, else `FAILED: document`. Status `DOCUMENTED`.
@@END@@
@@IF MOD_CHANGELOG@@
   - When the work adds no file under `changelog.d/`, read `.claude/skills/changelog-entry/SKILL.md` and follow it now, so the entry is part of the one commit. If it decides that no entry is necessary, write that in the Timeline.
@@END@@
5. **Commit** — one commit for the whole plan:
   1. `git status --porcelain`. Every path must belong to this plan: the files it changed, its tests, the plan's move to `.plans/done/`, and a changelog entry if one was written. A path that does not belong (for example a tool's output file) → `FAILED: commit`, with the list under `## Diagnosis`.
   2. `git add -- <path> <path> …`, naming every path (a deleted or moved path too). Never `git add -A` or `git add .`.
   3. `git commit -m "<type>(<scope>): <what the plan does, in plain words>"`. Conventional Commits, no AI attribution. One commit: never split the work into several.

**commit mode:** set status `COMMITTED — READY TO PUSH`, append, and end the session:

```markdown
## Hand-off

Nothing is pushed. To open the PR, resume this run in "to PR" mode, or:

    cd <worktree-path>
    claude    # then say "push" and run /skill-5-ship
```

**pr mode:**

@@IF MOD_DECISION_SHEET@@
6. **Decision sheet** — read `.claude/skills/decision-sheet/SKILL.md` and follow it with `--base <base> --plan .plans/done/<plan-file> --report <report> --out <report dir>/<slug>-decision-sheet.md`. It never blocks: when it fails, write one Timeline line and continue.
@@END@@
7. **Ship** — `/skill-5-ship` cannot be invoked as a skill from here (`disable-model-invocation`). Read `.claude/skills/skill-5-ship/SKILL.md` and follow it end to end with `--unattended --report <report> --base <base>`. It sets the final status: `PR OPEN — <url>` (with a `PR: <url>` line) or `BLOCKED: …`.
8. On `PR OPEN`, append and end the session:

```markdown
## Next — your part

1. Open the PR and review it ("Files changed" shows the whole change, in one commit).
2. Mark it "Ready for review" and merge it (@@MERGE_STYLE@@: @@MERGE_HINT@@).
3. After the merge: `git pull`, then `bash .claude/scripts/auto-pipeline.sh --cleanup <slug>`.
@@IF MOD_PR_FEEDBACK@@

Disagree with something? Comment on the PR, then run `/pr-feedback <PR#>`.
@@END@@
```
