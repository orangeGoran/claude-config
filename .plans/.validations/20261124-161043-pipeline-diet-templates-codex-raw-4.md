## Plan validation (codex): 20261124-161043-pipeline-diet-templates.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Review scope] Moving the decision sheet before the commit leaves newly created files untracked when Codex reviews the implementation. The sheet itself reads untracked files, but the Codex validation skill identifies the implementation through Git diffs, which omit them. New files can therefore miss the default Codex review entirely. — [decision-sheet/SKILL.md](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md:39), [validate-implementation/SKILL.md](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/modules/codex/dot-codex/skills/validate-implementation/SKILL.md:15) — Update the Codex review’s scope discovery to include and read untracked implementation files, and add a test for a new file before the commit.
- [Resume] The proposed decision-sheet done check accepts any earlier `decision sheet: done` Timeline entry. A run that completed the sheet, then stopped before its commit, can resume with later tree changes and skip rebuilding the sheet; its findings and gate evidence can then describe a different tree from the committed one. — [plan](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:153), [skill-auto-pipeline/SKILL.md](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:54) — Bind the done check to the reviewed tree state, and specify how to rebuild and recheck when that state changes.

### Non-blocking concerns

- [Calculation] The cost allocation divides by the weighted token total without defining the result when that total is zero. A result-only or missing-usage log can still have a cost. — [plan](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:193) — Define an unattributed or `n/a` allocation and test it.
- [Verification limits] The plan’s claims about real log fields and automatic loading of nested instruction files were not verified by this read-only review. A representative permitted log inspection and a controlled Claude Code run would prove those behaviors. — [plan](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:138)

### Edge cases the plan should address

- A resumed run has a completed sheet but the working tree changed before the commit — the sheet and its test evidence need to match the committed tree.
- A result has a cost but no countable assistant tokens — weighted allocation must not divide by zero or invent row costs.

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
1. Extend the Codex implementation review to discover and read untracked implementation files before the decision sheet runs before the commit. Add a test for a newly created file in that state. The decision sheet reads untracked files, but the Codex skill's diff commands do not include them. (evidence: skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md:39; skills/bootstrap-project/templates/modules/codex/dot-codex/skills/validate-implementation/SKILL.md:15)
2. Bind the decision-sheet done check to the reviewed tree state. Specify how a resumed run rebuilds the sheet and repeats the necessary checks if the tree changed before the commit, and add coverage for that resume case. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:153; skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:54)

SHOULD FIX:
1. Define and test cost allocation when a result has a cost but the weighted token total is zero; do not divide by zero or invent row costs. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:193)
2. Verify the claimed real-log fields and automatic loading of nested instruction files with a permitted representative log inspection and a controlled Claude Code run, or identify them as unverified implementation assumptions. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:138)

ADD THESE EDGE CASES:
- A completed decision sheet is followed by a working-tree change before a resumed run commits.
- A result has a cost but no countable assistant tokens.

Do not change anything the validation did not flag.
```