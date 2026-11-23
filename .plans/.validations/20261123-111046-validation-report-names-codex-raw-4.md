## Plan validation (codex): 20261123-111046-validation-report-names.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data ownership] The longest-slug rule assigns some new reports to the wrong plan. The plan’s own test assigns `demo-plan-validation-codex-1.md`, written as the new Codex report for `demo-plan`, to `demo-plan-validation` as an old Codex report — [.plans/20261123-111046-validation-report-names.md:101](/Users/gorantubic/Workspace/claude-config/.plans/20261123-111046-validation-report-names.md:101) — this can mark the wrong plan validated and hide evidence from the plan that produced it. The filename alone is ambiguous between the accepted old and new formats. Define a collision policy that preserves correct ownership, including how writers avoid new collisions and how readers handle ambiguous existing files; add tests for both.
- [Contracts] The plan adds `validation.rounds` to the lanes digest but updates only the `.plans/` row of the contracts reference — [skills/bootstrap-project/references/contracts.md:53](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/references/contracts.md:53) documents the `recommendedBatch` JSON shape without that field — consumers and future changes would have an incomplete contract. Update the JSON contract as part of the plan.

### Non-blocking concerns

- [Prerequisite] The move plan is not yet complete in this checkout: [package.json:7](/Users/gorantubic/Workspace/claude-config/package.json:7) still runs the old test location, and the planned `apps/dashboard/` paths do not exist here. Step 0 correctly blocks the run until the move lands, but the future paths and signatures cannot be verified until then.
- [Wiring] The plan says the lanes field remains `{ claude, codex }` in Wiring & registration, while its contract and steps add `rounds` — [.plans/20261123-111046-validation-report-names.md:78](/Users/gorantubic/Workspace/claude-config/.plans/20261123-111046-validation-report-names.md:78). Align the section with the proposed shape.
- [Upgrade wording] Other projects receive changed files only after their owners approve each replacement during upgrade — [skills/bootstrap-project/SKILL.md:16](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/SKILL.md:16), [skills/bootstrap-project/SKILL.md:44](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/SKILL.md:44). Qualify the plan’s claim that running upgrade alone applies the change.

### Edge cases the plan should address

- A new report filename that also matches an older report format for a longer plan slug — readers cannot infer its authoring plan from the filename alone.
- A validator report and a decision log whose names overlap accepted forms for different plan slugs — the numbering and ownership rules need a consistent collision policy.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [ ] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261123-111046-validation-report-names.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Define a collision policy for report ownership that avoids assigning a new report to the wrong plan. Specify how writers prevent new filename collisions and how readers handle ambiguous existing names; update both readers and tests. The planned test currently assigns demo-plan's new validation-codex-1 report to demo-plan-validation as an old codex-1 report (evidence: .plans/20261123-111046-validation-report-names.md:101).
2. Update the plan-lanes JSON contract in skills/bootstrap-project/references/contracts.md to include validation.rounds in recommendedBatch, in addition to updating the .plans/ row (evidence: skills/bootstrap-project/references/contracts.md:53).

SHOULD FIX:
1. Reverify the moved dashboard paths, helper signatures and test commands after the prerequisite move plan lands; they do not yet exist in this checkout (evidence: package.json:7; .plans/20261123-111046-validation-report-names.md:90).
2. Update Wiring & registration to state that the validation object gains rounds (evidence: .plans/20261123-111046-validation-report-names.md:78).
3. Qualify the upgrade claims to say that owners must approve the changed files before replacement (evidence: skills/bootstrap-project/SKILL.md:16 and skills/bootstrap-project/SKILL.md:44).

ADD THESE EDGE CASES:
- A new report filename also matches an older report format for a longer plan slug.
- A validator report and a decision log overlap accepted forms for different plan slugs; keep ownership and round numbering consistent.

Do not change anything the validation did not flag.
```