## Plan validation (codex): 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Crash recovery] Recovery treats the absence of a marker in a list capped at 50 issues as proof that no ticket exists. If more than 50 matching-label issues precede the ticket, a resumed run can create a duplicate. — [.plans/20261127-230102-cross-repo-defect-tickets.md:50](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:50) — Search all relevant pages, or treat a full, incomplete result as inconclusive and do not create a ticket.
- [Resume / target authorization] The plan rechecks the target against the current related-repo list, but recovery then uses the repo recorded in the earlier `ticket creating` line. If that repo left the group, recovery can still link its issue, or proceed toward creating a ticket there. — [.plans/20261127-230102-cross-repo-defect-tickets.md:51](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:51), [.plans/20261127-230102-cross-repo-defect-tickets.md:204](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:204) — Define how to resolve an unfinished write when its recorded repo is no longer authorized; do not create or link a ticket there without an explicit policy.

### Non-blocking concerns

- [Verification] The sibling plan and the 2a rework have not landed, so their final integration cannot yet be verified. Map and check the merged implementations when this plan starts. — [.plans/20261127-230102-cross-repo-defect-tickets.md:26](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:26)

### Edge cases the plan should address

- More than 50 labeled issues exist between a ticket write and recovery — the marker may be outside the returned page.
- The related-repo list changes after `ticket creating` but before recovery — the recorded target and the currently permitted target can differ.

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
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230102-cross-repo-defect-tickets.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make crash recovery search all relevant issue pages, or treat a full but incomplete result as inconclusive and create nothing. A 50-issue limit cannot prove the marker is absent (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:50).
2. Define recovery when the repo recorded by “ticket creating” is no longer in the current related-repo list. Preserve the current-target restriction and specify whether an existing ticket may be linked; do not create a ticket in an unauthorized repo (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:51 and :204).

SHOULD FIX:
1. Check the final merged 2a and sibling implementations and map the integration to them when this plan starts (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:26).

ADD THESE EDGE CASES:
- More than 50 labeled issues exist when recovery searches for the marker.
- The related-repo list changes after “ticket creating” and before recovery.

Do not change anything the validation did not flag.
```