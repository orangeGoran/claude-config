## Plan validation (codex): 20261127-230105-insights-page.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Navigation] The specified Back/Forward case cannot work as written: after Back, opening plan B creates a history entry, which discards the Forward entry for Insights. The browser test nevertheless requires Forward to return to Insights — [plan:152](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:152), [app.js:665](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:665), [plan:232](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:232) — the required navigation sequence is impossible with the prescribed history behavior — revise the sequence and define how the saved Dashboard query is updated and tested.
- [Plan counts] `isParentPlan()` is said to copy `looksRoadmap`, but `planCounts()` passes only the first 8 KB. The reference checks the entire header before the first `## `, so a longer header can be classified differently — [plan:139](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:139), [plan-lanes.mjs:362](/Users/gorantubic/Workspace/claude-config/.claude/scripts/plan-lanes.mjs:362) — parent and open-plan counts can be wrong — read enough to apply the same rule and add a long-header test.

### Non-blocking concerns

- [Dependency] The ledger module and its tests are not yet present, so their actual exports and behavior cannot be verified. The plan correctly waits for that plan and asks the implementer to check the merged code — [plan:23](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:23), [plan:138](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:138). Recheck the integration against the merged implementation.
- [Reference] The preview is referenced as a QA artifact outside the repository; its functions and visual behavior were not verified in this read-only review — [plan:85](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:85). Compare the implementation with the artifact during the planned browser test.

### Edge cases the plan should address

- A parent marker beyond the first 8 KB but before the first section — it must produce the same result as the lane checker.
- Back, then a new plan selection — specify the resulting history and saved Dashboard query without relying on a discarded Forward entry.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile — ledger implementation and preview await verification
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code, subject to the ledger dependency
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
Update the plan at .plans/20261127-230105-insights-page.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Revise the Back/Forward scenario and define how the saved Dashboard query is updated and tested. Opening plan B after Back creates a history entry and discards the Forward entry, so the specified sequence cannot return Forward to Insights. (evidence: .plans/20261127-230105-insights-page.md:152, apps/dashboard/page/app.js:665, .plans/20261127-230105-insights-page.md:232)
2. Make parent-plan detection inspect enough of each file to match the lane checker's full-header rule, and add a test with a parent marker beyond 8 KB before the first section. (evidence: .plans/20261127-230105-insights-page.md:139, .claude/scripts/plan-lanes.mjs:362)

SHOULD FIX:
1. After the ledger plan merges, verify its actual exports and reader behavior against this plan before implementation. (evidence: .plans/20261127-230105-insights-page.md:23)
2. Compare the implementation with the referenced preview during the browser test; the preview was not available for this repository review. (evidence: .plans/20261127-230105-insights-page.md:85)

ADD THESE EDGE CASES:
- A parent marker beyond the first 8 KB but before the first section.
- Back followed by a new plan selection, including the resulting history and saved Dashboard query.

Do not change anything the validation did not flag.
```