## Plan validation (codex): 20261127-230105-insights-page.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Error handling] The proposed endpoint sends a 200 header before calling `insightsBody()`. A file-read or `statSync` error then reaches the existing catch, which attempts to send a second response and includes `String(e)` in its body. The response can fail after headers are sent and can expose a local path. — [.plans/20261127-230105-insights-page.md:143](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:143), [apps/dashboard/server.mjs:3594](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:3594) — Build the body before sending headers, handle endpoint errors with a generic response, and test an I/O failure.
- [Navigation] `dashSearch` is updated when leaving Dashboard, but the proposed `popstate` handling does not update it when returning to a Dashboard history entry. After switching from plan A to Insights, going Back, opening plan B, then going Forward to Insights, the Dashboard menu restores A instead of B. — [.plans/20261127-230105-insights-page.md:149](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:149), [apps/dashboard/page/app.js:679](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:679) — Define how history transitions preserve the current Dashboard query and add this sequence to the browser test.

### Non-blocking concerns

- [Reference verification] The ledger module and test are not on the current checkout. Their proposed interfaces match the predecessor plan, but the merged implementation cannot yet be verified. — [.plans/20261126-113132-insights-ledger.md:102](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:102) — Keep the pre-implementation check against the merged code.
- [Reference verification] The preview is outside the repository, so its chart behavior and the claimed mirror could not be verified within the review limits. — [.plans/20261126-113131-plans-insights-parent.md:13](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113131-plans-insights-parent.md:13) — Check the preview during implementation against the stated panel requirements.

### Edge cases the plan should address

- An unreadable run log or plan directory — the endpoint needs a controlled error without leaking a filesystem path.
- Back and Forward after changing the selected plan — the Dashboard menu should restore the plan from the most recent Dashboard history entry.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
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
Update the plan at .plans/20261127-230105-insights-page.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Build the insights response before sending its 200 headers. Specify an endpoint error branch that returns a generic error without an internal message or local path, and add an I/O failure test. The existing outer catch writes a response containing String(e), which is also unsafe after headers have been sent. (evidence: .plans/20261127-230105-insights-page.md:143, apps/dashboard/server.mjs:3594)
2. Define how popstate preserves the current Dashboard query when moving between Dashboard and Insights. Add a browser test that opens plan A, switches to Insights, goes Back, opens plan B, goes Forward, and confirms the Dashboard menu restores B. (evidence: .plans/20261127-230105-insights-page.md:149, apps/dashboard/page/app.js:679)

SHOULD FIX:
1. Keep the pre-implementation check against the merged ledger module and test: the predecessor is not on the current checkout. (evidence: .plans/20261126-113132-insights-ledger.md:102)
2. Check the external preview during implementation against the stated panel requirements; its behavior could not be verified from the repository. (evidence: .plans/20261126-113131-plans-insights-parent.md:13)

ADD THESE EDGE CASES:
- An unreadable run log or plan directory returns a controlled error without exposing a filesystem path.
- Back and Forward after changing the selected plan preserve the most recent Dashboard history entry.

Do not change anything the validation did not flag.
```