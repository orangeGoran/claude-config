**Validation round:** 2

## Plan validation: 20261123-111046-validation-report-names.md

**Verdict:** APPROVE WITH CHANGES

Context: the plan runs after the move plan (PR #1). The symbols were checked at today's paths: `scripts/plans-dashboard.mjs`, `scripts/plans-dashboard/app.js`, `scripts/test/plans-dashboard.test.mjs`, `scripts/test/bootstrap-project.test.mjs`. Round 1 fixes #1, #2, #4, #5, #6, #8, #9, #10 and #11 are in the plan and are correct. Fix #3 is incomplete (B1 below). The numbers from fix #7 are out of date again (S1).

### Blocking issues

- [Scope / correctness] Step 2 changes how `<n>` is numbered but leaves step d, and the "Rounds 2+ only" line in step a, tied to `n`. — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:121` "The round edited the plan and `n` < 4 → run round `n+1`", `:122` "Round 4 is still not clean → stop … Never run a fifth round.", `:59` "Rounds 2+ only: read the edits of the previous round." — Under the new rule, a second run on a plan that already has 4 rounds starts at `n` = 5. Then `n < 4` is false after its first round, and "Round 4 is still not clean" never matches, so the loop stops after one round or behaves undefined. The "max 4 counts this run's rounds" sentence in step 2 does not reach these lines, and Affected files lists only "Rounds" and step a. Also, at the first round of a second run, "Rounds 2+" (read as `n` ≥ 2) diffs `pre-round-<n-1>` from the earlier run. That diff includes the earlier run's edits and the owner's edits, and they get tagged as regressions. — Fix: in step 2 and Affected files, also rewrite step d with a run counter: "the round edited the plan and this run has run fewer than 4 rounds → run the next round (take a new `<n>`)", and "the 4th round of this run is still not clean → stop with `OPEN ITEMS`". Rewrite `:59` as "From the second round of this run on". Add a 9c assertion that the rendered SKILL.md no longer matches /`n` < 4/.
- [Tests / contradiction] Test 9c asserts that the rendered `skill-auto-validate-plan/SKILL.md` "does not match `codex-raw` or `` `-round-<n>.md` ``". But step 2 puts "the round number rule of the Contracts section" into that same file, and that rule names the old forms `-codex-raw-`, `-codex-`, `-round-` (plan Contracts, line 45). The rendered skill must name them: other projects have no copy of this plan's Contracts. — plan lines 45, 88, 98. — An implementer who follows step 2 faithfully writes `codex-raw` into the skill, and test 9c then fails. If they leave it out to pass the test, the rule cannot see old reports, and the numbering restarts at 1 (the defect from round 1 #2). — Fix: tie the negative assertions to the write paths only. Examples: `doesNotMatch(/-o "[^"]*-codex-raw-/)`, `doesNotMatch(/decision log with the Write tool at `[^`]*<plan-base>-round-<n>/)` and `doesNotMatch(/writes `[^`]*<plan-base>-validation-<n>\.md`/)`. Also give the exact sentence of the round rule that steps 1 and 2 put into the agent file and the skill, with all seven name forms written out. In step 1, "the names of the Contracts section" does not exist in another project's agent file, and an agent may read it as the Contracts section of the plan under review.

### Non-blocking concerns

- [Estimates vs measurements] The event-watcher counts are stale again. `ls .plans/.validations` today shows `-validation-1..8`, `-codex-raw-1..8` and `-round-1..7`, not `-validation-1..7`. So the old app shows "validated ×16" and "8× claude · 0× codex", and the new code shows "validated ×8" and "8× claude · 8× codex". — plan lines 13, 123, 124. — That plan is still in validation, so the numbers will keep changing. Let the Browser test take the numbers from `ls .plans/.validations/20261123-102654-event-watcher-and-waits-for-*` at run time, and state the rule (old = file count of `-validation-`/`-codex-` prefixes, new = distinct `<n>`). Do not hard-code the numbers.
- [Tests / harness] Test 9a writes into `<plansDir>/.validations/`. The harness `before` hook (`scripts/test/plans-dashboard.test.mjs:198`) creates only `plansDir`, so the test must `mkdirSync(..., { recursive: true })` first. `onlyPlan()` (`:180`) returns `plans[0]`. Place the test before the archive test (`:745`) and the scout test (`:1306`), or find `demo-plan` by slug. — Say both in step 9a.
- [Consistency sweep] `skills/bootstrap-project/templates/modules/plans-parallel/dot-claude/skills/plans-parallel/SKILL.md:101` says "Take `×N` from the count in `.validations/`". With two reports per round, a reader that counts files shows the wrong number. — Point it at the digest's `Nc/Mx` (`:59`), or say "distinct round numbers". If you keep it out of scope, list it under Breaking changes.
- [Docs] Step 11 changes the docs-media demo from ×2 to ×1. Screenshots in `docs/` made from that demo show the old number until someone runs docs-media again. — Say this in the run report's Open items, or say that no screenshot shows the chip (not verified: I did not open the images).
- [Clarity] Step 9b's commit (`git add -A`, `git commit`) is not needed: `gitLines` in `plan-lanes.mjs:91-96` catches every git error. It does no harm (the dashboard tests commit the same way, `scripts/test/plans-dashboard.test.mjs:1059`). Keep it or drop it, but do not say that `HEAD` is required.

### Edge cases the plan should address

- Two validation runs on the same plan at the same time take the same `<n>` and overwrite each other. Say that this is not supported. (The dashboard copies the command; it does not run it.)
- A run that stops after the snapshot and before the reports leaves `-pre-round-<n>.md` with no report. The next run takes the same `<n>` and overwrites the snapshot. This is fine because snapshots do not count. Say it, so no one "fixes" the rule to count snapshots.
- `/skill-validate-plan` run alone between two auto runs writes `-validation-claude-<k>.md` with no decision log. The dashboard counts it as a round, and the next auto run starts at `<k+1>`. Confirm that this is intended.
- A slug that is a prefix of another slug (`demo-plan` and `demo-plan-v2`). The new anchored regex in step 8 already excludes `demo-plan-v2-validation-claude-1.md` from `demo-plan`, so this is an improvement. One 9a fixture could prove it.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (checked at the paths before the move; step 0 guards the move)
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done): `plans-parallel` `×N` wording not listed
- [x] Wiring & registration matches the code (no new wiring)
- [ ] Scope stays inside the goal; no open decision is taken silently: the step d / round-counter rewrite is missing from step 2
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; the file-name contract lives in `references/contracts.md`, which the plan updates)
- [ ] "How to verify" commands are real and can fail: they are real, but 9c contradicts step 2 (B2)

Checks done:
- Test 9a before the change: the prefix filter (`scripts/plans-dashboard.mjs:313-315`) counts 5 files (`-validation-claude-1`, `-validation-codex-1`, `-validation-round-1`, `-validation-2`, `-codex-raw-2`), as the plan says. After the change: {1, 2} → 2.
- Test 9b before the change: `-validation-codex-1` matches the old regex with `m[1] = "ana-plan-validation"`, so it is keyed to a different slug. `-validation-2` → claude, `-codex-2` → codex. So `{ claude: 1, codex: 1 }`, as the plan says. Per file with the new regex: codex 3. With the Set: `{ 2, 2 }`. The new regex with the lazy `(.*?)` gives `m[1] = "ana-plan"` for every new name, and it does not match `-validation-round-`, `-round-`, `-pre-round-` or `-external-`.
- `bootstrapRepo()` renders `.claude/scripts/plan-lanes.mjs` and `AGENTS.md` (`scripts/test/bootstrap-project.test.mjs:195`, `:349`). `os.homedir()` follows `HOME`, so `CENTRAL_STATE` stays in the temp dir.
- `render.mjs --upgrade --apply <comma list>` exists (`skills/bootstrap-project/scripts/render.mjs:5`, `:21-22`).
- `changelog.d/README.md:9` uses `.yaml`, which matches step 12.

Commands that touched a service or the database: none.

```
Update the plan at .plans/20261123-111046-validation-report-names.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 2 and in Affected files, also rewrite step d of skill-auto-validate-plan/SKILL.md with a counter of the rounds of this run. Example: "The round edited the plan and this run has run fewer than 4 rounds → run the next round (take a new <n>)" and "The 4th round of this run is still not clean → stop with OPEN ITEMS. Never run a fifth round in one run." Rewrite "Rounds 2+ only" as "From the second round of this run on". Add a 9c assertion that the rendered skill no longer contains "`n` < 4". (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:59, :121, :122)
2. Make test 9c agree with step 2. The rendered skill must name the old forms (codex-raw, codex, round) in the round number rule, so the negative assertions check only the write paths. Examples: doesNotMatch /-o "[^"]*-codex-raw-/, /decision log with the Write tool at `[^`]*<plan-base>-round-<n>/, /writes `[^`]*<plan-base>-validation-<n>\.md`/. Give the exact rule sentence, with all seven name forms written out, that steps 1 and 2 put into plan-validator.md and the skill. Replace "the names of the Contracts section" in step 1. (evidence: plan lines 45, 87, 88, 98)

SHOULD FIX:
1. Do not hard-code the event-watcher counts (today: -validation-1..8, -codex-raw-1..8, so old ×16 / 8× claude · 0× codex, new ×8 / 8× claude · 8× codex). Let the Browser test measure them with ls at run time, and fix the Goal sentence. (evidence: ls .plans/.validations; plan lines 13, 123, 124)
2. In step 9a, create <plansDir>/.validations with mkdirSync recursive, and either place the test before the archive and scout tests or find demo-plan by slug, not onlyPlan(). (evidence: scripts/test/plans-dashboard.test.mjs:180, :198, :745, :1306)
3. Update the plans-parallel template line "Take ×N from the count in .validations/" to use the digest's Nc/Mx or distinct round numbers, or list it under Breaking changes. (evidence: skills/bootstrap-project/templates/modules/plans-parallel/dot-claude/skills/plans-parallel/SKILL.md:101)
4. Say in step 11 or in Open items that docs screenshots made from the docs-media demo show the old ×2 until someone runs docs-media again.
5. In step 9b, drop the claim that git needs a HEAD (gitLines catches errors, plan-lanes.mjs:91-96), or keep the commit only as harmless setup.

ADD THESE EDGE CASES:
- Two validation runs on the same plan at the same time take the same <n>. Say that this is not supported.
- A run that stops after the snapshot reuses <n> next time and overwrites -pre-round-<n>.md. This is intended because snapshots do not count.
- /skill-validate-plan run alone writes -validation-claude-<k>.md with no decision log. It counts as a round, and the next auto run starts at <k+1>.
- A slug that is a prefix of another slug (demo-plan and demo-plan-v2). Add one 9a fixture that proves that the anchored regex excludes it.

Do not change anything the validation did not flag.
```
