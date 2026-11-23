## Plan validation (codex): 20261123-111046-validation-report-names.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Round numbering] The plan preserves two incompatible numbering rules: the auto-validation loop starts at round 1 on each run, while the Claude agent chooses the next free report number. After a previous run, Codex can overwrite its round-1 report and the Claude report can receive a different number from its decision log. Limiting Claude’s search to the new name also ignores old reports — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:48`, `skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md:104`, `.plans/20261123-111046-validation-report-names.md:82` — define one shared, collision-safe round number for both validators and the decision log, including existing names and repeated runs; specify how standalone Claude validation chooses its number.
- [Counting] The proposed `plan-lanes.mjs` loop increments once per file, so an old and a new report for the same validator and round count twice. The dashboard’s set also merges reports with the same number across separate validation runs, although the current loop restarts at 1. Both can produce incorrect round counts — `skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs:314`, `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:48` — define how legacy and repeated-run reports map to rounds, then deduplicate per validator where appropriate and test the chosen behavior.
- [Verification] The final `git grep` is specified to succeed conceptually when it exits 1, but it searches all templates and will still find the unchanged `-round-<n>` reference in the `/apply-validation` template. That reference also becomes inaccurate after the decision-log rename — `skills/bootstrap-project/templates/core/dot-claude/skills/apply-validation/SKILL.md:101`, `.plans/20261123-111046-validation-report-names.md:124` — update the consumer’s wording and provide a check with conventional pass/fail exit status that covers the intended writers without rejecting deliberate compatibility references.

### Non-blocking concerns

- [Upgrade] Step 9 gives only a preview command and says to “apply” the files without giving the renderer’s apply command. The renderer distinguishes preview from `--apply <paths>` — `skills/bootstrap-project/scripts/render.mjs:11`, `skills/bootstrap-project/scripts/render.mjs:21` — state the scoped apply step and how the owner reviews the staged differences.
- [Dependency] The dashboard and test paths do not exist in this checkout. Their future existence and the proposed `npm test` command depend on the move plan being merged as written — `.plans/20261122-152506-move-apps-out-of-scripts.md:46`, `.plans/20261123-111046-validation-report-names.md:24` — recheck the merged implementation before this plan starts.

### Edge cases the plan should address

- Existing old and new reports for the same validator and round — they must not silently inflate the count.
- A second auto-validation run, or standalone validation followed by an auto-validation run — reports must not be overwritten or assigned misleading round numbers.
- One validator unavailable in a round — the other report and decision log must retain the same round identity.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
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
1. Define one shared, collision-safe round number for both validators and the decision log, including existing old names and repeated auto-validation runs. Specify how standalone Claude validation selects its number and prevent report overwrites. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:48; skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md:104; .plans/20261123-111046-validation-report-names.md:82)
2. Define how legacy and repeated-run reports map to rounds. Deduplicate per validator where appropriate, make the dashboard count follow that definition, and add tests for mixed old and new names representing the same round. (evidence: skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs:314; skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:48)
3. Update the /apply-validation template’s decision-log reference and replace the final grep with a check that has conventional pass/fail exit status and distinguishes obsolete writer references from intentional compatibility references. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/apply-validation/SKILL.md:101; .plans/20261123-111046-validation-report-names.md:124)

SHOULD FIX:
1. Give the scoped renderer apply step after the owner reviews the preview. (evidence: skills/bootstrap-project/scripts/render.mjs:11; skills/bootstrap-project/scripts/render.mjs:21)
2. Require a recheck of the merged move plan’s actual paths and test command before implementation. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:46; .plans/20261123-111046-validation-report-names.md:24)

ADD THESE EDGE CASES:
- Old and new report names for the same validator and round.
- A second auto-validation run, and standalone validation followed by auto-validation.
- One validator unavailable in a round.

Do not change anything the validation did not flag.
```