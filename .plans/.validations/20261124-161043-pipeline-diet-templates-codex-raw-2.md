## Plan validation (codex): 20261124-161043-pipeline-diet-templates.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Resume] Moving the decision sheet into Document skips it when a run stops after commit and is later resumed in “to PR” mode — [skill-auto-pipeline/SKILL.md:54](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:54), [skill-auto-pipeline/SKILL.md:127](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:127), [plan:157](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:157) — Resume skips completed phases, so the PR can ship without a sheet or its review. Define how this mode transition creates the sheet and handles fixes while preserving the one-commit rule; add a test for it.
- [Failure handling] The moved sheet runs with `--fix`, but the proposed instruction still says it never blocks on failure — [plan:158](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:158), [decision-sheet/SKILL.md:66](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md:66) — A failed sheet or failed scoped check can leave edits in the tree that are then committed. Distinguish an unavailable review from a failure after edits, and stop the commit when those edits or their required checks fail.
- [Verification] The plan removes check-only lint and format from each review round but only adds a post-loop lint run when there is no check-only lint command — [plan:133](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:133), [skill-4-verify/SKILL.md:48](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-4-verify/SKILL.md:48) — Check-only formatting has no specified replacement after fixes, so a changed file can escape the existing check. Specify where both available check-only lint and format commands run on the final tree, and test both configurations.
- [Resume] Document is marked complete before its subsequent bullets, while the plan assumes a resume before commit reruns the sheet — [skill-auto-pipeline/SKILL.md:113](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:113), [plan:114](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:114) — A stop after `DOCUMENTED` but before the sheet can resume at Commit and omit the sheet. Give the sheet an independently recorded completion state and define recovery before commit.

### Non-blocking concerns

- [Accounting] The subagent lookup matches every project folder containing the slug — [plan:176](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:176); the launcher derives a folder from the full worktree path at [auto-pipeline.sh:394](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:394). Specify how to disambiguate matching folders and avoid counting a transcript twice.
- [Evidence] The claimed stream and transcript field shapes cannot be verified under this review’s limits without inspecting the local run data — [plan:172](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:172). A sanitized fixture or documented schema would make those assumptions independently verifiable.
- [Calculation] The wall-time rules say a row ends at the next marker, but also make a row with fewer than two timestamps `n/a` — [plan:183](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:183), [plan:186](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:186). Reconcile that with the one-message row test at [plan:200](/Users/gorantubic/Workspace/claude-config/.plans/20261124-161043-pipeline-diet-templates.md:200).

### Edge cases the plan should address

- Resume from commit mode into PR mode — the sheet must still be produced.
- Interruption after `DOCUMENTED` and before or during the sheet — resume must not silently skip it or commit incomplete fixes.
- A sheet fix followed by a failed scoped test or lint — the failed tree must not be committed.
- More than one matching transcript directory, or a repeated session transcript — usage must not be duplicated.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [ ] Global rules affect every project respected
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
1. Define how a run resumed from commit mode into PR mode creates the decision sheet and handles any review fixes while preserving the one-commit rule; add a test for this transition. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:54 and :127; .plans/20261124-161043-pipeline-diet-templates.md:157)
2. Distinguish an unavailable decision-sheet review from a failure after --fix has edited files. Stop the commit if those edits or their required scoped tests or lint fail, and test that behavior. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:158; skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md:66)
3. Specify where available check-only lint and format commands run on the final tree after review fixes, including when a check-only lint command exists; test both lint configurations and format coverage. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:133; skills/bootstrap-project/templates/core/dot-claude/skills/skill-4-verify/SKILL.md:48)
4. Give the moved decision sheet an independently recorded completion state and define resume recovery when interruption occurs after DOCUMENTED but before or during the sheet; test that it cannot be skipped before commit. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:113; .plans/20261124-161043-pipeline-diet-templates.md:114)

SHOULD FIX:
1. Define how transcript folder matches are disambiguated and how duplicate transcript counts are prevented. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:176; skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:394)
2. Provide a sanitized fixture or documented schema for the assumed stream and transcript fields, or mark those assumptions for verification during implementation. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:172)
3. Reconcile the one-message wall-time test with the rule that rows with fewer than two timestamps print n/a. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:183, :186 and :200)

ADD THESE EDGE CASES:
- Resume from commit mode into PR mode.
- Interrupt after DOCUMENTED and before or during the decision sheet.
- A decision-sheet fix followed by a failed scoped test or lint.
- Multiple matching transcript folders or repeated session transcripts.

Do not change anything the validation did not flag.
```