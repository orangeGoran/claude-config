## Plan validation (codex): 20261127-230103-template-updates-collector.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data loss] Wave lines are saved only immediately before a commit, but the existing upgrade runner can finish in `same` state before committing, including after Claude has produced decisions — [upgrade-run.mjs:420](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/upgrade-run.mjs:420), [plan:142](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:142) — updates found in such a run are lost, and a zero-update run cannot supersede older updates. Define a durable completion record for successful no-commit runs and test both cases.
- [Recovery] The plan treats any remote branch SHA as proof that the saved run committed — [plan:142](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:142), [upgrade-run.mjs:96](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/upgrade-run.mjs:96) — an existing remote branch may point at the base or at an earlier commit, so a crash before this run’s commit can publish discarded updates. Record and verify the actual commit or an equivalent run-specific proof before flushing.
- [Project rule] The collector script writes a changelog entry directly — [plan:151](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:151) — but the applicable rules require `/changelog-entry` to write entries ([changelog.d/AGENTS.md:11](/Users/gorantubic/Workspace/claude-config/changelog.d/AGENTS.md:11)). Revise the workflow to comply with that rule or obtain an explicit owner decision to change it.
- [Recovery] The dashboard start gate permits a retry only for a pending wave or a branch without a collected line — [plan:154](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:154) — a failed run with no pending wave can display a retry chip that the server refuses, and a completed collection with an open PR cannot be refreshed through this path. Specify consistent retry and open-PR behavior for the gate and chip, with tests.

### Non-blocking concerns

- [Verification] `grep` succeeds if either named document contains `bootstrap-waves`, so it does not prove both were updated — [plan:215](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:215). Check each document independently.
- [Reference] The dependency plans have not been validated as merged in this read-only review; the dashboard integration must be checked again against their actual merged code before implementation — [plan:16](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:16).

### Edge cases the plan should address

- A successful upgrade with no commit, both with template updates and with zero updates, must leave the correct complete wave record.
- A saved pre-commit record whose remote branch exists but has no commit from that run must remain uncollected.
- A failed collector with no pending wave must have a clear, working retry or dismissal path.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
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
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Define durable wave completion for successful upgrade runs that produce no commit, including runs with updates and runs with zero updates, and add tests. The existing runner can return `same` before a commit (evidence: skills/bootstrap-project/scripts/upgrade-run.mjs:420; .plans/20261127-230103-template-updates-collector.md:142).
2. Replace the remote-branch-exists check with run-specific proof that the saved run actually committed, and test a pre-commit crash with an existing remote branch (evidence: .plans/20261127-230103-template-updates-collector.md:142; skills/bootstrap-project/scripts/upgrade-run.mjs:96).
3. Make the collector's changelog workflow comply with the requirement to use `/changelog-entry`, or obtain an explicit owner decision to change that rule (evidence: changelog.d/AGENTS.md:11; .plans/20261127-230103-template-updates-collector.md:151).
4. Align the dashboard start gate and retry chip for failed runs with no pending wave and for an open collector PR; specify and test the intended behavior (evidence: .plans/20261127-230103-template-updates-collector.md:154).

SHOULD FIX:
1. Make the documentation verification check each named file independently (evidence: .plans/20261127-230103-template-updates-collector.md:215).
2. Recheck dashboard wiring against the actual merged dependency plans before implementation (evidence: .plans/20261127-230103-template-updates-collector.md:16).

ADD THESE EDGE CASES:
- Successful no-commit upgrades with updates and with zero updates.
- A pre-commit saved record when a remote branch already exists.
- A failed collector with no pending wave and a visible retry action.

Do not change anything the validation did not flag.
```