## Plan validation (codex): 20261124-161043-pipeline-diet-templates.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Wiring] The new Commit prerequisite applies in every “to PR” run, but the decision-sheet step exists only when `MOD_DECISION_SHEET` is enabled. With that module off, the generated pipeline asks for a Timeline entry that no step can produce. — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:122`, `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:146` — Put the prerequisite and resume instructions under the same module switch, and test the module-off pipeline through commit and ship.

- [Resume] The proposed done check looks for a Timeline line that starts with `decision sheet: done`, but the pipeline requires Timeline entries to start with `- HH:MM:SS —`. A compliant entry will not satisfy the literal check, so a resume can repeat the sheet or prevent commit. — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:60` — Define the check against the entry text after the timestamp and test the exact persisted line.

- [Tests] The revised full end-to-end gate omits plans that list end-to-end tests in their Tests section but do not repeat the command in How to verify and do not change an endpoint or existing covered entry point. The existing scoped loop explicitly treats a plan that lists end-to-end tests as in scope. — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:24`, `skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:64`, `skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:141` — Preserve that scope in the full-suite condition and add a regression case.

### Non-blocking concerns

- [Verification] The plan cites field evidence from local run logs and subagent metadata, but that evidence was not independently verified in this read-only review. — `.plans/20261124-161043-pipeline-diet-templates.md:181` — Validate the parser against a permitted representative log during implementation, without copying private content into the repository.

### Edge cases the plan should address

- A “to PR” run with the decision-sheet module disabled — it must commit and ship without waiting for a sheet.
- A resume after a timestamped `decision sheet: done` Timeline entry — it must recognize the completed step.
- A plan that requests end-to-end tests only in its Tests section — the full end-to-end evidence gate must still run.

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
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261124-161043-pipeline-diet-templates.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Put the decision-sheet Commit prerequisite and its resume instructions under MOD_DECISION_SHEET, and test that a to-PR run with the module off can commit and ship. The existing sheet step is conditional, while Commit is not (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:122 and skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:146).
2. Define the decision-sheet done check against the text after the Timeline timestamp, and test the exact persisted entry. Timeline lines start with "- HH:MM:SS —", not "decision sheet: done" (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:60).
3. Preserve full end-to-end execution when the plan lists end-to-end tests in its Tests section, and add a regression case where How to verify does not repeat the command. The existing scope and scoped loop include that case (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:24, skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:64, and skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:141).

SHOULD FIX:
1. During implementation, validate the usage parser against a permitted representative run log without copying private content into the repository; the stated local field evidence was not independently verified (evidence: .plans/20261124-161043-pipeline-diet-templates.md:181).

ADD THESE EDGE CASES:
- A to-PR run with the decision-sheet module disabled.
- A resume after a timestamped decision-sheet completion entry.
- A plan that requests end-to-end tests only in its Tests section.

Do not change anything the validation did not flag.
```