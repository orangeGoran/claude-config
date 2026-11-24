**Validation round:** 1

## Plan validation: 20261123-111046-validation-report-names.md

**Verdict:** APPROVE WITH CHANGES

Post-move paths were checked against `.plans/20261122-152506-move-apps-out-of-scripts.md` (Affected files lines 44-59, step 1, package.json `test` glob at line 53): `apps/dashboard/server.mjs`, `apps/dashboard/page/app.js`, `apps/dashboard/test/dashboard.test.mjs` and `test/bootstrap-project.test.mjs` match. Symbols were checked at today's paths (`scripts/plans-dashboard.mjs`, `scripts/test/*.test.mjs`).

### Blocking issues

- [Affected files / How to verify] The plan misses a writer text that names the old decision log, so the last "How to verify" command prints a line and fails after all steps are done — `skills/bootstrap-project/templates/core/dot-claude/skills/apply-validation/SKILL.md:101` says "When `/skill-auto-validate-plan` runs this step, it writes its own `` `-round-<n>.md` `` decision log instead." The pattern ``"\`-round-<n>"`` in the plan's `git grep` matches this line, and the file is not in Affected files, Steps or the step 9 render list. The text is also wrong after step 2 (the log becomes `-validation-round-<n>.md`). — Fix: add the template to Affected files and to a step (change `-round-<n>.md` to `-validation-round-<n>.md`), and add `.claude/skills/apply-validation/SKILL.md` to the step 9 list and to the last Affected files line.

- [Edge case / wrong data] Step 1's numbering rule makes the round count wrong for every plan that already has old-name reports — plan step 1: "the agent lists `.plans/.validations/` and takes the next `<n>` of `-validation-claude-` files". This repo has `20261123-102654-event-watcher-and-waits-for-validation-1..6.md` (ls `.plans/.validations/`). Its next Claude report after step 9 would be `-validation-claude-1.md`, and step 7's `Set` of round numbers already holds 1, so the dashboard count does not go up. The Goal says N "must be the number of rounds". — Fix: in step 1 (and the matching text in step 2 for the Claude lines), the next free `<n>` is 1 + the highest `<n>` of the plan's Claude reports with any name (`-validation-<n>` and `-validation-claude-<n>`); or let `/skill-auto-validate-plan` pass its round `<n>` to the agent, the same `<n>` it gives Codex in `-o`. Add one dashboard test case for it if the rule changes logic, or say in Harness constraints that it is skill text only.

### Non-blocking concerns

- [Breaking changes] A second page consumer of `plan-lanes.mjs` `validation` is not listed — `scripts/plans-dashboard/app.js:3285-3286` (after the move `apps/dashboard/page/app.js`) shows "✓ validated N× claude · M× codex" from the lanes data, and `plan-lanes.mjs:470-471` (`score`) adds 50 per report, so the recommended batch order can change once Codex reports count. — Add both to Breaking changes.
- [Commands] `git grep` is not in the run's allow list — `.claude/settings.json:7-17` allows `git status/diff/log/show/ls-files…` and `grep *`, not `git grep`; `.claude/scripts/auto-pipeline.sh:206-217` adds no `git grep` either. A headless run auto-denies it. — Use `grep -rn -e "codex-raw-<n>" -e "-validation-<n>" -e "<plan-base>-round-<n>" -e "\`-round-<n>" skills/bootstrap-project/templates AGENTS.md` (grep then exits 1 when nothing matches).
- [Estimates vs measurements] The browser test numbers are stale and have no measuring command — plan line 115-116 says event-watcher has "4 rounds from both validators" and shows "validated ×8" → "×4". The main checkout has `-validation-1..6` and `-codex-raw-1..7` (ls `.plans/.validations/`; 5-7 are untracked), so today it shows ×13 and the new code ×7. — Tell the tester to count with `ls .plans/.validations/` at test time, or name the expected numbers as "files today, distinct round numbers after".
- [Discrepancy] Step 7 says "Update the comment above it", but `validationRounds` has no comment — `scripts/plans-dashboard.mjs:310-311` (`};` then `const validationRounds`). — Say "Add a one-line comment".
- [Step 0] A squash merge (AGENTS.md "Merge style: squash") gives a commit title from the PR, which may not hold the text `move-apps-out-of-scripts`. — Check `.plans/done/20261122-152506-move-apps-out-of-scripts.md` and `apps/dashboard/server.mjs` exist instead of reading `git log`.
- [Step 9] `node skills/bootstrap-project/scripts/render.mjs . --upgrade` without `--apply` only stages and prints (`render.mjs:11-21`). — Name the apply command: `--upgrade --apply <comma list of the five .claude paths>`.
- [Tests] Step 8a deletes the files "then"; put the deletion in a `finally`, so a failed assert does not leave validation files that change later tests (for example the ready/backlog logic is not tested now, but `onlyPlan()` callers read the same plan).
- [Not verified] The Goal claim that `node .claude/scripts/plan-lanes.mjs --json` shows `"codex": 0` was not run (review is read-only). The regex `/^(.*?)-(validation|codex)-(\d+)\.md$/` at `plan-lanes.mjs:314` cannot match `-codex-raw-<n>.md`, so the claim holds by reading. Running the command would prove it.

### Edge cases the plan should address

- A plan with old-name reports that gets new-name rounds (see blocking issue 2) — the Set merges different rounds that share a number.
- Claude OFF in one round, Codex OFF in another — the two number series drift; the Set count stays correct only when both use the skill's round `<n>`.
- A slug that is a prefix of another slug (`demo` and `demo-plan`) — today's `startsWith(slug + '-validation-')` cannot confuse them either, but the new anchored regex on "the rest" is the guard; a test file name like `demo-plan-validation-claude-1.md` for a plan `demo` would be a good extra assert (optional).
- The un-numbered `<plan>-validation.md` (plan-validator.md:113) — neither reader counts it, today or after; say so in Contracts.

### Checklist
- [ ] All referenced files, lines, sections and symbols exist as stated (no comment above `validationRounds`)
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done) — `app.js:3286` lanes chip and `score` missing
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected (both tests fail before the change: dashboard counts 5 files today, plan-lanes gives `{ claude: 1, codex: 0 }`)
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail — the `git grep` fails after the steps because of `apply-validation/SKILL.md:101`, and `git grep` is not in the run's allow list

```
Update the plan at .plans/20261123-111046-validation-report-names.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Add skills/bootstrap-project/templates/core/dot-claude/skills/apply-validation/SKILL.md to Affected files and to a step: its line "it writes its own `-round-<n>.md` decision log instead" becomes `-validation-round-<n>.md`. Add .claude/skills/apply-validation/SKILL.md to the step 9 render list and the last Affected files line. Without it the last How-to-verify grep prints this line and fails. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/apply-validation/SKILL.md:101)
2. Change the numbering rule in step 1 (and the Claude lines of step 2): the next free <n> is 1 + the highest <n> of the plan's Claude reports with any name (`-validation-<n>` and `-validation-claude-<n>`), or the agent uses the round <n> that /skill-auto-validate-plan passes (the same <n> as the Codex -o file). Otherwise a plan with old reports gets `-validation-claude-1`, and the round Set in step 7 does not count the new round. (evidence: .plans/.validations/ has 20261123-102654-event-watcher-and-waits-for-validation-1..6.md; plan step 1, step 7)

SHOULD FIX:
1. In Breaking changes, list the lanes row chip "validated N× claude · M× codex" and the recommended-batch score (+50 per report), which both change when Codex reports count. (evidence: scripts/plans-dashboard/app.js:3285-3286; skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs:470-471)
2. Replace `git grep` in How to verify with `grep -rn -e "codex-raw-<n>" -e "-validation-<n>" -e "<plan-base>-round-<n>" -e "\`-round-<n>" skills/bootstrap-project/templates AGENTS.md`: `git grep` is not in the run's allow list. (evidence: .claude/settings.json:7-17; .claude/scripts/auto-pipeline.sh:206-217)
3. In Browser test, drop the fixed "×8 / ×4" numbers or measure them: the main checkout has -validation-1..6 and -codex-raw-1..7 for event-watcher (old ×13, new ×7). Tell the tester to count with `ls .plans/.validations/`. (evidence: ls .plans/.validations/)
4. Step 7: "Add a one-line comment above it" (there is no comment today). (evidence: scripts/plans-dashboard.mjs:310-311)
5. Step 0: check that .plans/done/20261122-152506-move-apps-out-of-scripts.md and apps/dashboard/server.mjs exist; a squash-merge title may not hold the slug. (evidence: AGENTS.md Git "Merge style: squash")
6. Step 9: name the apply command (`node skills/bootstrap-project/scripts/render.mjs . --upgrade --apply <comma list of the .claude paths>`); without --apply the render only stages. (evidence: skills/bootstrap-project/scripts/render.mjs:11-21)
7. Step 8a: delete the written files in a `finally`. (evidence: plan step 8a)

ADD THESE EDGE CASES:
- A plan with old-name reports that gets new-name rounds: the round Set must not merge different rounds that share a number.
- Claude OFF in one round and Codex OFF in another: both validators must use the same round <n>.
- The un-numbered `<plan>-validation.md` (plan-validator.md:113) is counted by neither reader; say so in Contracts.

Do not change anything the validation did not flag.
```
