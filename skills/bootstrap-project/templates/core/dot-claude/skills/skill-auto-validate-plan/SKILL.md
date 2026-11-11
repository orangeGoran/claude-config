---
name: skill-auto-validate-plan
@@IF MOD_CODEX@@
description: Automated validation loop for a .plans/ file — runs the Claude plan-validator agent and the repo's Codex validate-plan skill (through codex exec) in parallel, checks all findings against the repo and @@PARENT_PLAN@@, applies the valid fixes to the plan, and validates again. When one validator is not available, it continues with the other and says so. Each round leaves the raw reports and one decision log. Max 4 rounds. Ends with READY + a commit message, or a list of open items. /skill-1-plan runs it after saving a plan.
@@END@@
@@IFNOT MOD_CODEX@@
description: Automated validation loop for a .plans/ file — runs the plan-validator agent, checks its findings against the repo and @@PARENT_PLAN@@, applies the valid fixes to the plan, and validates again. Each round leaves the raw report and one decision log. Max 4 rounds. Ends with READY + a commit message, or a list of open items. /skill-1-plan runs it after saving a plan.
@@END@@
argument-hint: "[plan file]"
---

Auto-validate plan: $ARGUMENTS

@@IF MOD_CODEX@@
This skill runs `/skill-validate-plan` (Claude), the Codex `validate-plan` skill and `/apply-validation` in a loop until the plan is clean. It edits **only** the plan file and `.plans/.validations/` files, never code, and it never commits.
@@END@@
@@IFNOT MOD_CODEX@@
This skill runs `/skill-validate-plan` + `/apply-validation` in a loop until the plan is clean. It edits **only** the plan file and `.plans/.validations/` files, never code, and it never commits. There is no Codex validator in this project, so a READY plan was checked by the Claude `plan-validator` agent only.
@@END@@

Run every shell command bare: one command per call, no pipes, `&&`, redirection or heredocs. Headless runs auto-deny compound commands.

## Step 0 — Resolve the plan and preflight

- Resolve the plan file as `/skill-validate-plan` does (named in `$ARGUMENTS`, else the most recent `.plans/*.md` outside `.plans/done/`). Say which plan you resolved.
- Run `mkdir -p .plans/.validations`.
@@IF MOD_CODEX@@
- Find the Codex CLI. Run `command -v codex`. When it prints nothing, run `test -x ~/.local/bin/codex` (the Bash tool does not load `~/.zshrc`, and `~/.local/bin` is the installer default). Use the path you found as `<codex>` in every later Codex command. Write the path exactly as `codex` or `~/.local/bin/codex` (with the `~`, not the expanded home folder): the allow rules match that text. Then run `<codex> login status`.
- When `codex` is not on PATH and not in `~/.local/bin`, or the login check fails: say `Codex not available: <reason> — continuing with Claude only`, give the owner the fix (`npm install -g @openai/codex`, then `codex login`), mark **Codex OFF** for the whole run, and continue. A missing Codex never fails this skill.

## Validator availability

Either validator can be unavailable: Codex (CLI missing, not logged in, network, quota, timeout, non-zero exit, empty `-o` file) or Claude (`plan-validator` fails, times out, or gives no artifact path). The handling is the same:

- Mark that validator **OFF** for the round. Tell the owner in one line: `<Codex|Claude> is OFF this round: <reason> — continuing with <other>`. Continue with the other one. Never stop the run because one validator is off.
- Try an OFF validator again in the next round. When it fails two rounds in a row, or it failed the preflight, keep it OFF for the rest of the run.
- Never write a substitute review for an OFF validator. Its slot in the round stays empty.
- Both OFF in the same round → stop with status `BLOCKED` and the two reasons.
@@END@@

## Rounds (max 4)

For round `n` = 1, then each next round only if the previous round changed the plan:

### a. Snapshot the plan, then check the previous round's edits

Copy the plan before the validators run. Nothing in this loop is committed, so the snapshots make the check and a rollback possible (they are gitignored):

```bash
cp <plan-file> .plans/.validations/<plan-base>-pre-round-<n>.md
```

Rounds 2+ only: read the edits of the previous round.

```bash
diff -u .plans/.validations/<plan-base>-pre-round-<n-1>.md .plans/.validations/<plan-base>-pre-round-<n>.md
```

You wrote these edits, so read them the hardest. Each hunk must do what its finding asked and must not break what was correct. Run these three checks:

1. **Citations.** Open each `file:line` and section reference in or next to an edited hunk again.
2. **Cross-references.** If a step was added, removed or renumbered, find each `step <n>` in the plan and confirm it still points at the right step.
3. **Propagation.** For each fix, find each place the plan mentions that subject (Goal, the project rule sections, Contracts, Affected files, Steps, Tests, How to verify) and confirm the fix reached all of them.

Tag each problem `REGRESSION` in this round's decision log. If a round's edits are a net loss, restore its snapshot instead of patching forward: `cp .plans/.validations/<plan-base>-pre-round-<n>.md <plan-file>`.

### b. Run the validators

@@IF MOD_CODEX@@
Both validators only read the plan, so run them at the same time. Skip a validator that is OFF.

- **Codex** (background Bash, 10-minute timeout). Do not write a new prompt. Use the repo's Codex skill as it is:

  ```bash
  <codex> exec --sandbox read-only -o ".plans/.validations/<plan-base>-codex-raw-<n>.md" "Use the validate-plan skill from this repository (.codex/skills/validate-plan/SKILL.md) and follow it exactly. Validate plan: .plans/<plan-file>. Read the skill file first, then execute its full process. Your final message must be only the report + copy-paste block." </dev/null
  ```

  Keep `</dev/null`. Without it, `codex exec` waits for input forever in a background shell. Do not pipe the output. The `-o` file is the raw Codex report. Never edit it.

- **Claude**: dispatch the `plan-validator` agent with the same briefing as `/skill-validate-plan` Step 1. It writes `.plans/.validations/<plan-base>-validation-<n>.md` and states the path in its reply as proof that it ran. Never edit that report.

Wait for both. When one fails, apply "Validator availability" and continue with the report you have.
@@END@@
@@IFNOT MOD_CODEX@@
Dispatch the `plan-validator` agent with the same briefing as `/skill-validate-plan` Step 1. It writes `.plans/.validations/<plan-base>-validation-<n>.md` and states the path in its reply as proof that it ran. Never edit that report.

The agent fails or gives no path → run it again once. A second failure → stop with status `BLOCKED` and the reason. Never write a substitute review yourself.
@@END@@

### c. Reconcile the findings

@@IF MOD_CODEX@@
Read the raw reports you have (`-codex-raw-<n>.md` and `-validation-<n>.md`). Process each finding from each report as `/apply-validation` says: number it, check it against the repo, `AGENTS.md` and `@@PARENT_PLAN@@`, classify it VALID / PARTIALLY VALID / INVALID with evidence, and apply the valid fixes **to the plan file**.

Write one decision log with the Write tool at `.plans/.validations/<plan-base>-round-<n>.md`: the round header (each validator `ON` or `OFF (<reason>)`), the findings table with the validator that raised each finding, and the regressions from step a. Record the findings that only one validator found: that difference is the reason to run two.
@@END@@
@@IFNOT MOD_CODEX@@
Process each finding as `/apply-validation` says: number it, check it against the repo, `AGENTS.md` and `@@PARENT_PLAN@@`, classify it VALID / PARTIALLY VALID / INVALID with evidence, and apply the valid fixes **to the plan file**.

Write one decision log with the Write tool at `.plans/.validations/<plan-base>-round-<n>.md`: the round header, the findings table, and the regressions from step a.
@@END@@

**Owner decisions:** never apply a finding that needs a scope or design decision, or that takes an open decision of `@@PARENT_PLAN@@`. Ask the owner with the "Question queue" and "Decision question format" from `/skill-1-plan`. List a decision under Open items if the owner defers it.

### d. Converge or continue

@@IF MOD_CODEX@@
- Each validator that ran is clean (Claude says APPROVE, Codex has no VALID blocking finding), no `REGRESSION` is open, and the plan was not edited this round → **READY**, stop. If a validator was OFF this round, the status is `READY (<Codex|Claude> OFF)`, never a plain `READY`.
@@END@@
@@IFNOT MOD_CODEX@@
- The plan was not edited this round, no `REGRESSION` is open, and the verdict is APPROVE or every finding was rejected with evidence → **READY**, stop.
@@END@@
- The round edited the plan and `n` < 4 → run round `n+1`. A later round validates every fix.
- Round 4 is still not clean → stop with status `OPEN ITEMS`. Never run a fifth round.

## Final report

@@IF MOD_CODEX@@
- **Status:** `READY`, `READY (<Codex|Claude> OFF)`, `OPEN ITEMS` (each with its evidence and the validator that raised it), or `BLOCKED`.
- **Validators:** per round, `Claude ON|OFF` and `Codex ON|OFF`, with the reason for each OFF. When one was OFF in the last round, say that one validator only checked the plan, and suggest a new run when it is back.
- **Files**, one path per line, per round: the raw reports (`-codex-raw-<n>.md`, `-validation-<n>.md`), the decision log and the snapshot.
@@END@@
@@IFNOT MOD_CODEX@@
- **Status:** `READY`, `OPEN ITEMS` (each with its evidence), or `BLOCKED`.
- **Files**, one path per line, per round: the raw report, the decision log and the snapshot.
@@END@@
- **What changed in the plan:** short bullets per round, or "no changes".
- **Regressions:** the count per round, even when it is zero.
- **Commit message:** one copy-paste Conventional Commits message for the plan and its validation files, for example `docs(plans): add <slug> plan`.
- **Staging command**, in its own fenced block:
  ```bash
  git add -- .plans/<plan-base>.md '.plans/.validations/<plan-base>-*'
  ```
  Keep the quotes on the second path. Git then expands the pattern itself and skips the gitignored `-pre-round-*` snapshots without an error. Never use `git add .plans/`, because it also stages the files of other plans.

## Rules

- Never weaken or delete a rule in `AGENTS.md` or `@@PARENT_PLAN@@` because a validator disliked it. Reject the finding with the reference.
- Never edit anything except the plan file and `.plans/.validations/` files.
- Never invent fields or shapes to satisfy a finding. That is an owner decision.
- Never run `git add`, `git commit` or `git push` in this skill. Rollback uses the snapshots, not git.
