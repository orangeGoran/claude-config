## Plan validation (codex): 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Shell] `write_related()` is called without a third argument on launch, but its proposed unset-variable branch reads `$3`. The launcher uses `set -u`, so a hand launch with `DASH_RELATED_REPOS` unset would terminate with an unbound-variable error. — [.plans/20261127-230102-cross-repo-defect-tickets.md:190](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:190), [auto-pipeline.sh:31](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:31) — Use `${3:-}` and retain the launch-with-unset-variable test.

- [Recovery] Item 7.5 checks the current related file before recovery and sets `none (no list)` when the file is gone. That can skip recovery of an issue created immediately before a crash when the group changes before resume, leaving an existing issue unlinked. The plan separately requires recovery against the recorded repo even after it leaves the group. — [.plans/20261127-230102-cross-repo-defect-tickets.md:50](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:50), [.plans/20261127-230102-cross-repo-defect-tickets.md:205](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:205) — Recover any outstanding creation attempt first; apply the current-list policy only before a new create.

### Non-blocking concerns

- [Verification] The sibling plan and the 2a rework have not landed, so the final integration and references cannot yet be verified against the eventual merged code. The plan instructs the implementer to map differences; verify that mapping after both dependencies merge. — [.plans/20261127-230102-cross-repo-defect-tickets.md:25](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:25)

### Edge cases the plan should address

- An issue leaves the first 100 results because newer issues arrive, then reappears when another issue closes. Replacing the baseline with only the current page can notify again for an issue that never closed. Define how truncated reads affect the baseline and test that transition.

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
- [x] Release note step present

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230102-cross-repo-defect-tickets.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make write_related() safely handle its omitted third argument, for example with ${3:-}, and retain the test for a hand launch with DASH_RELATED_REPOS unset. The script runs with set -u. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:190; skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:31)
2. Recover an outstanding ticket creation attempt against its recorded repo before applying the current related-list policy. Apply that policy before a new create, including when the related file is now absent. Test a crash after creation followed by a resume with no related file. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:50 and :205)

SHOULD FIX:
1. After the sibling and 2a changes merge, verify and document the mapping to their actual integration points. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:25)

ADD THESE EDGE CASES:
- An open issue falls outside the first 100 results and later reappears without closing. Define and test how the watcher avoids a repeat notification.

Do not change anything the validation did not flag.
```