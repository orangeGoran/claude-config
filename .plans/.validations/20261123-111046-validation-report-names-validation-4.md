**Validation round:** 4

## Plan validation: 20261123-111046-validation-report-names.md

**Verdict:** APPROVE WITH CHANGES

The round 3 fixes are correct and reach every section. I recomputed every count in the Tests section by hand against the Owner rule and the Count rule, and all of them are right. Two instructions cannot be followed as written. Step 0 uses `test -f`, and a headless run denies it. Step 6b sends `/plans-parallel` to a `validation.rounds` value that the default text digest does not print.

### Blocking issues
- [Commands] Step 0 checks the move with `test -f apps/dashboard/server.mjs` and `test -f .plans/done/...`, but `test -f` is not in the run's allow list. — `.claude/settings.json:4-32` allows `Bash(ls *)` and only `Bash(test -x ~/.local/bin/codex)`. `.claude/scripts/auto-pipeline.sh:55` adds `RUN_EXTRA_ALLOW` and has no `test -f`. `.claude/scripts/auto-pipeline.sh:459-462` runs with `--permission-mode acceptEdits --allowedTools`. — A headless run denies the command. Step 0 can then end with the false status `BLOCKED — the move plan is not merged as written`. Round 1 (#5) removed `git grep` for the same reason. — Check with the Read tool, or with `ls apps/dashboard/server.mjs .plans/done/20261122-152506-move-apps-out-of-scripts.md` (one bare command; `Bash(ls *)` allows it). Read `package.json` with the Read tool.
- [Wiring / wrong data] Step 6b says "Take `×N` from the digest: `validation.rounds`". The digest that `/plans-parallel` runs by default does not print `rounds`. — `templates/modules/plans-parallel/.../SKILL.md:21` runs `node .claude/scripts/plan-lanes.mjs` with no `--json`, and line 24 adds `--json` only on request. `templates/core/dot-claude/scripts/plan-lanes.mjs:555-557` prints only `validation=${claude}c/${codex}x` for the batch rows, and prints nothing for the other lane members. Step 7 does not change the text output. — The skill cannot find N and goes back to guessing or to counting files: the defect that the plan fixes. The `Nc/Mx` text (line 59) also stays the only value it can see. — Do one of these: (a) in step 7, print the rounds in the text digest too (for example `validation=3c/3x (4 rounds)`, and `v` from `rounds`); or (b) in step 6b, tell the skill to read `validation.rounds` from `--json` for each plan in the table. Add a check of the chosen output to test 9b.

### Non-blocking concerns
- [Browser test] "The new code shows … `C× claude · X× codex`" in the lanes row is not true at run time. The server runs the project's own `.claude/scripts/plan-lanes.mjs` (`scripts/plans-dashboard.mjs:242-244`, `path.join(proj.root, '.claude/scripts/plan-lanes.mjs')`). That file changes only in step 10, by hand, after the merge, because a headless run cannot write `.claude/`. — In the run, compare only the card ("validated ×R" and "not validated"). Say that the lanes row keeps "C× claude · 0× codex" until step 10, and list the lanes check under Open items.
- [Consistency] Wiring & registration says "`plan-lanes.mjs` keeps the `validation: { claude, codex }` field per plan". Breaking changes and step 7 add `rounds`. — Write `{ claude, codex, rounds }` in Wiring too.
- [Consistency] `score` in `plan-lanes.mjs:470-471` still adds `claude + codex`. A plan with both validators in 4 rounds gets 8 × 50, the same weight as today's file count. Step 7 can use `rounds * 50`, which matches the new meaning of the dashboard. Optional: if you keep it, say why.
- [Performance] Step 8 makes `validationRounds(proj, slug)` read `plansDir`, `doneDir` and `validDir` once per plan. `listPlans` calls it for every active and archived plan (`scripts/plans-dashboard.mjs:505,534`) on each 5-second `/api/state` poll. The size today is small (`ls .plans/.validations` lists 78 files), so this is not a defect. You can build the slug list once in `listPlans` and keep the `(proj, slug)` signature by adding an optional third argument.

### Edge cases the plan should address
- Two plans with the same timestamp, where one slug is the other slug plus `-validation` (for example `<ts>-foo` and `<ts>-foo-validation`). The Owner rule then gives the new Codex report of `<ts>-foo` (`<ts>-foo-validation-codex-1.md`) to `<ts>-foo-validation`. Plan slugs start with a unique `YYYYMMDD-HHMMSS`, so this almost never happens. The Owner rule example shows the behaviour; one sentence in Contracts can say that it is accepted. No writer ever made a `-codex-<n>.md` report (`git log -S "codex-<n>" -- skills/bootstrap-project/templates` finds no commit). Only the demo (step 11) and the old `plan-lanes` regex use that form.
- Plans validated twice under the old rules: the agent took "the next free" Claude number, and the skill started the Codex and log numbers at 1. Their Claude and Codex numbers can differ, so the union count can show more rounds than really ran. This repo has no such case today: every plan in `ls .plans/.validations` has the same numbers for Claude and Codex. The Breaking changes section can say this in one line.

### Recomputed counts (Owner rule + Count rule, by hand)
- 9a, first part (plans: `demo-plan`): `-validation-claude-1` → 1, `-validation-codex-1` → 1, `-validation-2` → 2, `-codex-raw-2` → 2. `-validation-round-1`, `-round-2`, `-pre-round-3` and `-external-1` do not match. Distinct rounds {1, 2} = **2**. Correct. Today's prefix filter (`scripts/plans-dashboard.mjs:313-315`) counts `-validation-claude-1`, `-validation-codex-1`, `-validation-round-1`, `-validation-2` and `-codex-raw-2` = **5**. Correct.
- 9a, second part (plans: `demo-plan`, `demo-plan-validation`): `demo-plan-validation-codex-1` → longer slug (rest `codex-1.md`). `demo-plan-validation-codex-5` → longer slug. `demo-plan-validation-claude-1` → `demo-plan` (for the longer slug the rest `claude-1.md` does not match). `demo-plan` = {1, 2} = **2**, `demo-plan-validation` = {1, 5} = **2**. Correct. Note: `demo-plan-validation.md` sorts before `demo-plan.md` ('-' < '.'), so reading by slug instead of `onlyPlan()` is necessary. The plan does this.
- 9b, first repo: claude {1 (`-validation-claude-1`), 2 (`-validation-2`), 4} = 3; codex {1, 2 (`-codex-raw-2` and `-codex-2` together), 5} = 3; rounds {1, 2, 4, 5} = 4 → `{ claude: 3, codex: 3, rounds: 4 }`. Correct. Today's regex `^(.*?)-(validation|codex)-(\d+)\.md$` (`plan-lanes.mjs:314`) matches for `ana-plan` only `-validation-2` and `-codex-2` (it gives `-validation-codex-1` to `ana-plan-validation`) → `{ claude: 1, codex: 1 }`. Correct. One count per file gives codex 4 (`codex-1`, `codex-raw-2`, `codex-2`, `codex-raw-5`). Correct. The larger of the two validator counts is 3, not 4. Correct.
- 9b, second repo: `ana-plan` `{1, 0, 1}`, `ana-plan-validation` `{0, 1, 1}`. Correct. `--json` prints `plans[]` with `validation` for every plan (`plan-lanes.mjs:345,376,513`), so the test can read both.

### Round 1–3 fixes
- Round 3 #1/#2 (Owner rule in Contracts, used by both readers, second `bootstrapRepo()`): correct, and it reaches step 7, step 8, 9a and 9b.
- Round 3 #3 (`rounds` union): it reaches Contracts, step 7, 9b and Breaking changes. It does not reach the text digest that `/plans-parallel` reads (blocking 2) or the Wiring section (non-blocking).
- Round 3 #4 (no `git add -A`): correct. `gitLines` catches the git errors (`plan-lanes.mjs:91-96`).
- Round 3 #5, #6: correct (`references/contracts.md:15` has `validationRounds (≈ 314)`).
- Concurrency: not raised again. I found no new evidence.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (checked at the paths before the move: `scripts/plans-dashboard.mjs:272-279,311-317,505,534`, `scripts/plans-dashboard/app.js:243,3285-3287,4108,4132`, test harness `scripts/test/plans-dashboard.test.mjs:179-205`, `scripts/test/bootstrap-project.test.mjs:13-26,323-344`, every template line that the steps quote)
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done): the consumers are listed, but `/plans-parallel` cannot read the new key from its default digest
- [ ] Wiring & registration matches the code: it still says `{ claude, codex }`
- [x] Scope stays inside the goal; no open decision is taken silently (`docs/roadmap.md:32-34`: no repo-level open decisions; `-external-<n>` is left open, as the plan says)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; the Owner rule and the Count rule are written once, in Contracts)
- [ ] "How to verify" commands are real and can fail: they are real and each test fails before the change, but the step 0 command is denied in a headless run

```
Update the plan at .plans/20261123-111046-validation-report-names.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In Step 0, replace the two `test -f` checks with the Read tool or with one bare `ls apps/dashboard/server.mjs .plans/done/20261122-152506-move-apps-out-of-scripts.md`, and read package.json with the Read tool. `test -f` is not in the headless allow list, so the run would stop with a false BLOCKED. (evidence: .claude/settings.json:4-32 allows `Bash(ls *)` and only `Bash(test -x ~/.local/bin/codex)`; .claude/scripts/auto-pipeline.sh:55,459-462)
2. Make step 6b possible: /plans-parallel runs plan-lanes.mjs without --json, and the text digest prints only `validation=Nc/Mx` for the batch rows. Either (a) in step 7, also print the rounds in the text digest (for example `validation=3c/3x (4 rounds)`) and test that in 9b, or (b) in step 6b, tell the skill to read `validation.rounds` from `--json` for each plan it lists. (evidence: templates/modules/plans-parallel/dot-claude/skills/plans-parallel/SKILL.md:21,24,59,101; templates/core/dot-claude/scripts/plan-lanes.mjs:555-557)

SHOULD FIX:
1. In "Browser test", say that the lanes row chip keeps "C× claude · 0× codex" until step 10, because the server runs the project's own .claude/scripts/plan-lanes.mjs. Compare only the card in the run, and list the lanes check under Open items. (evidence: scripts/plans-dashboard.mjs:242-244)
2. In "Wiring & registration", write the per-plan field as `validation: { claude, codex, rounds }`. (evidence: the plan's Breaking changes and step 7)
3. Decide whether `score` uses `rounds * 50` instead of `(claude + codex) * 50`, and write the decision in step 7. (evidence: templates/core/dot-claude/scripts/plan-lanes.mjs:470-471)
4. Optional: in step 8, read the known slugs once per listPlans call instead of once per plan. (evidence: scripts/plans-dashboard.mjs:505,534)

ADD THESE EDGE CASES:
- Plans `<ts>-foo` and `<ts>-foo-validation` with the same timestamp: the Owner rule gives `<ts>-foo-validation-codex-<n>.md` to the longer slug. This is accepted because the timestamps are unique.
- Plans validated twice under the old rules can have different Claude and Codex numbers, so the union count can be higher than the real number of rounds.

Do not change anything the validation did not flag.
```
