**Validation round:** 3

## Plan validation: 20261123-111046-validation-report-names.md

**Verdict:** APPROVE WITH CHANGES

The fixes from rounds 1 and 2 reached the plan. The per-run counter `k` is in Contracts, step 2 and test 9c. The `-validation-round-<n>` name is in steps 4 and 5, Affected files and the step 10 list. Step 6b is in Affected files, Breaking changes and step 10. One new defect came from the round 2 fix for the slug collision (finding 3): the expected result of the second half of test 9b cannot happen under the rule of step 7.

### Blocking issues

- [Tests / edge case] The second half of test 9b expects results that the step 7 rule cannot give — plan step 9b (line 101), step 7 (line 97) — Step 7 says that "the longest known slug `S`" wins. The rest of the name after `S-` must match `/^(validation-claude|validation-codex|validation|codex-raw|codex)-(\d+)\.md$/`. After the test writes `.plans/ana-plan-validation.md`, the file `ana-plan-validation-codex-1.md` (written in the first half of the test as the new-style Codex report of `ana-plan`) also fits the longer slug `ana-plan-validation` with the rest `codex-1.md`, which matches `codex-(\d+)`. So it goes to `ana-plan-validation`, and so does `ana-plan-validation-codex-3.md`. Under step 7, the result is `ana-plan` = `{ claude: 2, codex: 1 }` (only `-codex-raw-2` and `-codex-2` are left, which is one round) and `ana-plan-validation` = `{ claude: 0, codex: 2 }`. The plan expects `ana-plan` to stay `{ claude: 2, codex: 2 }` and `ana-plan-validation` to have `codex: 1`. No rule that looks only at file names can give that result: `ana-plan-validation-codex-1.md` and `ana-plan-validation-codex-3.md` have the same shape, so any such rule puts both files with the same plan. The implementer must then break the test or break the rule. — Fix: keep the "longest slug wins" rule. Write it into Contracts (Count rule) as the answer for a name that fits two plans. Then change 9b in one of two ways. (a) Keep one repo and change the expected values to `ana-plan` `{ claude: 2, codex: 1 }` and `ana-plan-validation` `{ claude: 0, codex: 2 }`, and say why. (b) Run the collision check in a second `bootstrapRepo()` where `ana-plan` has no `-validation-codex-<n>` file.

### Non-blocking concerns

- [Discrepancy / consistency] Step 7 says "match each file against the known plan slugs, as the dashboard does". The dashboard does not do that. `validationRounds` (`scripts/plans-dashboard.mjs:311-317`, after the move `apps/dashboard/server.mjs`) filters by `f.startsWith(slug + '-')` for one slug, and step 8 keeps that shape. Example: plan `X` and plan `X-validation` both exist, and the file is `X-validation-codex-3.md`. The dashboard counts it as round 3 of `X`, but `plan-lanes.mjs` gives it to `X-validation`. The Count rule says "both readers" but the two readers now disagree on this case. — Suggestion: remove "as the dashboard does". Then either apply the same longest-slug rule in step 8 (`planFiles(proj)` and `doneFiles(proj)` already exist, see `listPlans` at line 489 and line 520, so the signature `(proj, slug)` can stay), or state the difference in Contracts.
- [Consistency] Step 6b makes `/plans-parallel` show `×N` as "the larger of the Claude and Codex round counts". The dashboard's "validated ×R" (step 8) is the number of distinct `<n>` across both validators. These differ when a round had one validator OFF. Example: Codex only in round 1 and Claude only in round 2 gives `/plans-parallel` ×1 and the dashboard ×2. — Suggestion: write in step 6b that `×N` can be lower than the dashboard number, or accept the difference in one sentence.
- [Estimates vs measurements] Goal (line 13) says that `ls .plans/.validations` shows event-watcher with `-validation-1..7`, `-codex-raw-1..8` and `-round-1..7`. Today the listing shows `-validation-1..8`, `-codex-raw-1..8`, `-round-1..8` and `-pre-round-1..8`. The mismatch that the sentence used as evidence is gone. — Suggestion: change it to 1..8, or remove the counts and keep the reason ("a later run went on past 4").
- [Docs] `skills/bootstrap-project/references/contracts.md:15` points at `validationRounds (≈ 314)`. Step 8 adds a comment above the function, so the line number moves. — Suggestion: in step 6, update or remove the `≈` line number.

### Edge cases the plan should address

- Two plans where one slug is the other slug plus `-validation` or `-codex` (the 9b case). The plan must write down the result in Contracts, and the tests must assert that result.
- A round where Claude was OFF and only Codex wrote a report. The dashboard counts the round, and the `/plans-parallel` `×N` (largest per validator) can be lower. The plan should say which number is correct.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated. I checked them at today's paths: `validationRounds` at `scripts/plans-dashboard.mjs:311` and its callers at 505 and 534; the `plan-lanes.mjs` regex at template line 314 and `score` at 470-471; the template lines named in steps 1-6b; `docs-media.mjs:144-146`; the test harness (`state`, `onlyPlan`, the `before` hook at 182-199, `bootstrapRepo`, and the codex on/off test at 323).
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done). Consumers: `app.js:243, 3286, 4108, 4132`, plan-lanes `score`, plans-parallel Status cell, `docs-media.mjs`. No test asserts the old names today.
- [x] Wiring & registration matches the code (no new wiring)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected: the second half of test 9b asserts a result that the rule of step 7 cannot give
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail. Test 9a: today's filter counts 5 files and the new code gives 2. Test 9b (first half): today's regex gives `{1,1}`, the new code gives `{2,2}`, and a count per file gives `codex: 3`. Test 9c: the old text has none of the new names.

Check that each test fails without the change: I worked through 9a and the first half of 9b against today's code. 9a gives 5 today and needs 2. 9b gives `{ claude: 1, codex: 1 }` today. Both claims are correct. The second half of 9b is the blocking issue above.

```
Update the plan at .plans/20261123-111046-validation-report-names.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Fix the expected result of the second half of test 9b. With the "longest known slug wins" rule of step 7, after .plans/ana-plan-validation.md exists, both ana-plan-validation-codex-1.md and ana-plan-validation-codex-3.md go to ana-plan-validation (rest "codex-<n>.md"). The result is ana-plan { claude: 2, codex: 1 } and ana-plan-validation { claude: 0, codex: 2 }, not the values the plan states. Either assert these values and say why, or run the collision check in a second bootstrapRepo() where ana-plan has no -validation-codex-<n> file. Add the "longest slug wins" result for a name that fits two plans to the Count rule in Contracts. (evidence: plan step 9b line 101, step 7 line 97)

SHOULD FIX:
1. In step 7, remove "as the dashboard does". The server filters by one slug prefix (scripts/plans-dashboard.mjs:311-317). Either apply the same longest-known-slug rule in step 8 (planFiles(proj) and doneFiles(proj) exist, listPlans lines 489/520; keep the signature (proj, slug)), or state in Contracts that the two readers differ for a slug that is another slug plus "-validation" or "-codex". (evidence: scripts/plans-dashboard.mjs:311-317)
2. In step 6b, say that ×N (the larger of the Claude and Codex counts) can be lower than the dashboard's "validated ×R" (distinct rounds across both validators) when one validator was OFF in a round. Or accept the difference in one sentence. (evidence: plan step 6b line 96, step 8 line 98)
3. Goal line 13: event-watcher now has -validation-1..8, -codex-raw-1..8, -round-1..8. Update the counts or remove them. (evidence: ls .plans/.validations)
4. Step 6: the contracts.md row names "validationRounds (≈ 314)". Update or remove the line number, because step 8 adds a comment above the function. (evidence: skills/bootstrap-project/references/contracts.md:15)

ADD THESE EDGE CASES:
- Two plans whose slugs differ only by a "-validation" or "-codex" suffix: write down which plan gets the report, and test that result.
- A round where one validator was OFF: the dashboard counts the round, and the /plans-parallel ×N can be lower.

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
