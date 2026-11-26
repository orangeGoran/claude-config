---
name: skill-auto-validate-plan
description: Automated validation loop for a .plans/ file — runs the Claude plan-validator agent and the repo's Codex validate-plan skill (through codex exec) in parallel, checks all findings against the repo and docs/roadmap.md, applies the valid fixes to the plan, and validates again. When one validator is not available, it continues with the other and says so. Each round leaves the raw reports and one decision log. Max 4 rounds; it stops after the first round with no accepted fix and no open regression. Ends with READY + a commit message, or a list of open items. /skill-1-plan runs it after saving a plan.
argument-hint: "[plan file]"
---

Auto-validate plan: $ARGUMENTS

This skill runs `/skill-validate-plan` (Claude), the Codex `validate-plan` skill and `/apply-validation` in a loop until the plan is clean. It edits **only** the plan file and `.plans/.validations/` files, never code, and it never commits.

Run every shell command bare: one command per call, no pipes, `&&`, `||`, redirection or heredocs. Headless runs auto-deny compound commands.
The Codex command in step b is the one exception: it keeps its `</dev/null`.

## Step 0 — Resolve the plan and preflight

- Resolve the plan file as `/skill-validate-plan` does (named in `$ARGUMENTS`, else the most recent `.plans/*.md` outside `.plans/done/` and `.plans/.workflow-state/`). Say which plan you resolved.
- A parent plan, roadmap or spec that comes with the plan is **context only**: pass it to the validators as context, and validate only the named plan.
- Run `mkdir -p .plans/.validations`.
- Find the Codex CLI. Run `command -v codex`. When it prints nothing, run `test -x ~/.local/bin/codex` (the Bash tool does not load `~/.zshrc`, and `~/.local/bin` is the installer default). Use the path you found as `<codex>` in every later Codex command. Write the path exactly as `codex` or `~/.local/bin/codex` (with the `~`, not the expanded home folder): the allow rules match that text. Then run `<codex> login status`.
- When `codex` is not on PATH and not in `~/.local/bin`, or the login check fails: say `Codex not available: <reason> — continuing with Claude only`, give the owner the fix (`npm install -g @openai/codex`, then `codex login`), mark **Codex OFF** for the whole run, and continue. A missing Codex never fails this skill.

## Validator availability

Either validator can be unavailable: Codex (CLI missing, not logged in, network, quota, timeout, non-zero exit, empty `-o` file) or Claude (`plan-validator` fails, times out, or gives no artifact path). The handling is the same:

- Mark that validator **OFF** for the round. Tell the owner in one line: `<Codex|Claude> is OFF this round: <reason> — continuing with <other>`. Continue with the other one. Never stop the run because one validator is off.
- Try an OFF validator again in the next round. When it fails two rounds in a row, or it failed the preflight, keep it OFF for the rest of the run.
- Never write a substitute review for an OFF validator. Its slot in the round stays empty.
- Both OFF in the same round → stop with status `BLOCKED` and the two reasons.

## Rounds (max 4)

Count the rounds of this run with `k` = 1 … 4: round `k` = 1, then each next round only when step d says so.

At the start of each round, list `.plans/.validations/` and take the round number `<n>`: `<n>` is 1 plus the highest number at the end of any validator report or decision log of this plan in `.plans/.validations/` (`<plan-base>-validation-claude-<n>.md`, `-validation-codex-<n>.md`, `-validation-round-<n>.md`, and the older `-validation-<n>.md`, `-codex-raw-<n>.md`, `-round-<n>.md`), or 1 when there is none. A file of a longer plan name does not count: when `.plans/` or `.plans/done/` has a plan whose base starts with `<plan-base>-` (for example `<plan-base>-validation`) and the file name starts with that longer base plus `-`, the file belongs to that plan. Never write over a file that exists: when the name is taken, take the next free number. Use this `<n>` for the snapshot, the reports and the decision log of the round. A new run never overwrites an earlier round. The snapshot `-pre-round-<n>.md` does not count. Inside one run the rounds take consecutive numbers, so the previous round of this run has the number `<n-1>`.

### a. Snapshot the plan, then check the previous round's edits

Copy the plan before the validators run. Nothing in this loop is committed, so the snapshots make the check and a rollback possible (they are gitignored):

```bash
cp <plan-file> .plans/.validations/<plan-base>-pre-round-<n>.md
```

From the second round of this run on (`k` ≥ 2): read the edits of the previous round of this run. The first round of a run (`k` = 1) has no diff.

```bash
diff -u .plans/.validations/<plan-base>-pre-round-<n-1>.md .plans/.validations/<plan-base>-pre-round-<n>.md
```

You wrote these edits, so read them the hardest. Each hunk must do what its finding asked and must not break what was correct. Run these three checks:

1. **Citations.** Open each `file:line` and section reference in or next to an edited hunk again. Edits move anchors: a line number that was right before the edit can be wrong after it.
2. **Cross-references.** If a step was added, removed or renumbered, find each `step <n>` in the plan and confirm it still points at the right step.
3. **Propagation.** For each fix, find each place the plan mentions that subject (Goal, Context, Hard rules, Endpoint access, Contracts, Reference implementation, Affected files, Wiring & registration, Breaking changes, Steps, Migrations, Tests, Browser test (when the plan has one), How to verify, and any doc-update step) and confirm the fix reached all of them.

Tag each problem `REGRESSION` in this round's decision log. If the previous round's edits are a net loss, restore that round's snapshot instead of patching forward: `cp .plans/.validations/<plan-base>-pre-round-<n-1>.md <plan-file>`. Then take this round's snapshot again (`cp <plan-file> .plans/.validations/<plan-base>-pre-round-<n>.md`), so step e and the next round's step a do not read the rollback as this round's edits.

### b. Run the validators

Both validators only read the plan, so run them at the same time. Skip a validator that is OFF.

- **Codex** (background Bash, 10-minute timeout). Do not write a new prompt. Use the repo's Codex skill as it is:

  ```bash
  <codex> exec --sandbox read-only -o ".plans/.validations/<plan-base>-validation-codex-<n>.md" "Use the validate-plan skill from this repository (.codex/skills/validate-plan/SKILL.md) and follow it exactly. Validate plan: .plans/<plan-file>. Read the skill file first, then execute its full process. Your final message must be only the report + copy-paste block." </dev/null
  ```

  Keep `</dev/null`. Without it, `codex exec` waits for input forever in a background shell. Do not pipe the output. The `-o` file is the raw Codex report. Never edit it.

- **Claude**: dispatch the `plan-validator` agent with the same briefing as `/skill-validate-plan` Step 1, plus the round number `<n>`. It writes `.plans/.validations/<plan-base>-validation-claude-<n>.md` and states the path in its reply as proof that it ran. Never edit that report.

Wait for both. When one fails, apply "Validator availability" and continue with the report you have.

### c. Reconcile the findings

Read the raw reports you have (`-validation-codex-<n>.md` and `-validation-claude-<n>.md`). Process each finding from each report as `/apply-validation` says: number it, check it against the repo, `AGENTS.md` and `docs/roadmap.md`, classify it VALID / PARTIALLY VALID / INVALID with evidence, and apply the valid fixes **to the plan file**. A Claude `APPROVE` with zero findings needs no work: only the Codex findings are left.

**Raised before.** From the second round of this run on (`k` ≥ 2): before you check a finding, compare it with the decision logs of the earlier rounds (`.plans/.validations/<plan-base>-validation-round-<m>.md`, and the older `-round-<m>.md`). A finding that matches a finding an earlier round classified INVALID, or one the owner deferred or answered with no plan change, and that brings no new evidence (no new `file:line`, no new fact) is `RAISED BEFORE (round <m>, F<id>)`. Do not edit the plan for it. It is not an accepted finding. Write it in the findings table with that verdict. Every other finding gets the normal check: a new finding that needs a scope or design decision still goes to the owner (see **Owner decisions** below), and a finding that an earlier round accepted and that comes back means the earlier fix did not land, so check it again.

Write one decision log with the Write tool at `.plans/.validations/<plan-base>-validation-round-<n>.md`: the round header (each validator `ON` or `OFF (<reason>)`), the findings table with the validator that raised each finding, the regressions from step a, and the "## Validation response" block of `/apply-validation`. Record the findings that only one validator found: that difference is the reason to run two.

Never put one validator's findings into a file named after the other validator (for example Codex findings in `-validation-claude-<n>.md`). The raw reports stay as they were written: without them, nobody can check that the decision log is faithful.

**Owner decisions:** never apply a finding that needs a scope or design decision, or that takes an open decision of `docs/roadmap.md`. Collect them, then ask the owner in chat with the "Question queue" and "Decision question format" from `/skill-1-plan`: show the numbered list of questions first, then one question per message with the heading `## Question N of M: <title>`. Never use AskUserQuestion for these questions. Accept a plain-text reply. List a decision under Open items if the owner defers it.

### d. Continue or stop

Do the parts in this order. Each part runs only when the part before it did not start a new round.

1. **Accepted fix.** This round has an accepted fix when any of these is true: a finding from the "Blocking issues" section of a report that ran this round is VALID or PARTIALLY VALID and you applied its fix to the plan (a finding that went to the owner counts only through the owner answer below); step a of this round found a `REGRESSION`; an owner answer to a blocking finding changed the plan this round.
2. **Continue.** An accepted fix, or a `REGRESSION` that is still open, and `k` < 4 → run round `k+1`. Do not set a status.
3. **Final edits check.** You did not continue and this round edited the plan → do step e.
4. **Status.** The first rule that matches wins:
   1. An open `REGRESSION` or an unresolved problem from step e: `k` < 4 → run round `k+1` (step e does not end the loop); `k` = 4 → `OPEN ITEMS`.
   2. The owner deferred a decision in any round (also when it came back as `RAISED BEFORE`) → `OPEN ITEMS`.
   3. `k` = 4, round 4 had an accepted fix, and step e ran → `READY (round 4 edits self-checked)`.
   4. Else → `READY`.
- A validator was OFF in the last round → a READY status names it: `READY (<Codex|Claude> OFF)` or `READY (round 4 edits self-checked; <Codex|Claude> OFF)`. Never a plain `READY` then. Do not run one more round only to retry the OFF validator.

Never run a fifth round.

### e. Final edits check

Run `diff -u .plans/.validations/<plan-base>-pre-round-<n>.md <plan-file>`. Read each hunk as step a says: it must do what its finding asked and must not break what was correct. Then run the three checks of step a on the hunks. Fix a problem you find, then check the hunks of that fix once more in the same way. A problem that is still there after that is unresolved: do not try a third time. Write the result in this round's decision log under `## Final edits check`: each problem, each fix you made (no validator reads these fixes, so list each one with its plan section), and each unresolved problem.

## Final report

- **Status:** `READY`, `READY (<Codex|Claude> OFF)`, `READY (round 4 edits self-checked)`, `READY (round 4 edits self-checked; <Codex|Claude> OFF)`, `OPEN ITEMS` (each with its evidence and the validator that raised it), or `BLOCKED`.
- **Validators:** per round, `Claude ON|OFF` and `Codex ON|OFF`, with the reason for each OFF. When one was OFF in the last round, say that one validator only checked the plan, and suggest a new run when it is back.
- **Files**, one path per line, per round: the raw reports (`-validation-codex-<n>.md`, `-validation-claude-<n>.md`), the decision log (`-validation-round-<n>.md`) and the snapshot.
- **What changed in the plan:** short bullets per round, or "no changes".
- **Regressions:** the count per round, even when it is zero.
- **Raised before:** the count per round, even when it is zero.
- **Final edits check:** the fixes it made and the unresolved problems, or "none".
- **Commit message:** one copy-paste Conventional Commits message for the plan and its validation files, for example `docs(plans): add <slug> plan`.
- **Staging command**, in its own fenced block:
  ```bash
  git add -- .plans/<plan-base>.md '.plans/.validations/<plan-base>-*'
  ```
  Keep the quotes on the second path. Git then expands the pattern itself and skips the gitignored `-pre-round-*` snapshots without an error. Never use `git add .plans/`, because it also stages the files of other plans.

## Rules

- Never weaken or delete a rule in `AGENTS.md`, `docs/roadmap.md`, `docs/plans-dashboard.md` because a validator disliked it. Reject the finding with the reference.
- Never edit anything except the plan file and `.plans/.validations/` files.
- Never invent fields or shapes to satisfy a finding. That is an owner decision.
- Never run `git add`, `git commit` or `git push` in this skill. Rollback uses the snapshots, not git.
