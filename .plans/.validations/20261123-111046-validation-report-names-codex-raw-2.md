## Plan validation (codex): 20261123-111046-validation-report-names.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Control flow] The plan changes the report number `n` to continue from earlier runs but does not change the existing stop conditions, which use `n < 4` and “Round 4” to enforce the per-run limit — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:121` — a run starting at round 5 cannot follow those conditions correctly — add a separate per-run counter and update both stop conditions and their tests.
- [Incorrect counts] The proposed `plan-lanes.mjs` regex cannot always distinguish a plan slug from a report suffix. For example, `demo-validation-codex-1.md` can be the old Codex report for `demo-validation` or the new Codex report for `demo` — `.plans/20261123-111046-validation-report-names.md:95` and `skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs:314` — it can attribute a report to the wrong plan and change its ranking — define how to resolve ambiguous names against known plan slugs, including the case where both plans exist, and test that behavior.
- [Data safety] Choosing the highest existing number by listing files does not reserve it. Two concurrent validations of the same plan can choose the same number and overwrite reports or snapshots — `.plans/20261123-111046-validation-report-names.md:47` and `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:81` — specify a concurrency guard or an atomic reservation and recovery rule, and cover concurrent starts.

### Non-blocking concerns

- [Verification] The move plan has not yet landed in this checkout, so the proposed `apps/dashboard/` and root `test/` paths and their post-move behavior cannot be verified here — `.plans/20261123-111046-validation-report-names.md:25` — recheck them against the merged move before implementation.

### Edge cases the plan should address

- A first round numbered above 4, followed by edits — it must still permit up to four rounds in that run.
- Two plan slugs that make an old filename indistinguishable from a new filename — readers need a defined, tested result.
- Two validations starting together, or a run interrupted after reserving a number — neither should overwrite an existing artifact.
- A missing `.plans/.validations/` directory and a snapshot left without a report or decision log — numbering and recovery need defined behavior.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261123-111046-validation-report-names.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Add a per-run counter separate from the artifact number, update both stop conditions, and test a run that starts above round 4. The existing conditions use `n < 4` and “Round 4”. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:121)
2. Define and test how plan-lanes resolves filenames that can belong to more than one plan under the old and new naming schemes, including when both candidate slugs exist. For example, `demo-validation-codex-1.md` has two possible interpretations. (evidence: .plans/20261123-111046-validation-report-names.md:95; skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs:314)
3. Add a concurrency guard or atomic number reservation, with an interrupted-run recovery rule and tests, so simultaneous validations of the same plan cannot overwrite artifacts. Listing existing filenames alone does not reserve a number. (evidence: .plans/20261123-111046-validation-report-names.md:47; skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:81)

SHOULD FIX:
1. Recheck the target paths, test harnesses and verification commands against the merged move plan before implementation; those paths are not yet present in this checkout. (evidence: .plans/20261123-111046-validation-report-names.md:25)

ADD THESE EDGE CASES:
- A run starts with an artifact number above 4 and needs further rounds.
- Two existing plan slugs make one report filename ambiguous.
- Concurrent starts and interruption after a number is reserved.
- A missing validations directory and a snapshot without a report or decision log.

Do not change anything the validation did not flag.
```