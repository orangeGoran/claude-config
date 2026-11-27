## Plan validation (codex): 20261127-230105-insights-page.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Wiring] Opening Board from Insights calls `setPage('dashboard')`, but `setPage()` writes no history, and the existing `openBoard()` does not call `syncUrl()`. The Board can therefore appear while the address remains `/insights`; a reload returns to Insights. This contradicts the plan’s expected `/dashboard?view=board` behavior. — [.plans/20261127-230105-insights-page.md:147](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:147), [app.js:4855](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:4855) — Specify the URL update and add a test that exercises the transition.
- [Integration] The proposed `syncUrl()` must change the path when a plan opens from Insights, but the existing function returns before constructing a URL when the query already matches. For `/insights?sel=…`, selecting that same plan can leave the address on `/insights`, so reload hides the plan again. — [app.js:663](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:663), [.plans/20261127-230105-insights-page.md:150](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:150) — Make the early-return condition include the path and test this case.

### Non-blocking concerns

- [Verification] The ledger module and its test do not exist in the current checkout. Their planned interfaces are documented by the prerequisite plan, but their actual implementation cannot be verified until that plan merges. Recheck the imports, return shape and reader behavior against the merged code before implementation. — [.plans/20261127-230105-insights-page.md:24](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:24)
- [Reference implementation] The preview is identified as a QA artifact rather than a repository file; its functions and visual behavior were not verified in this read-only review. A readable copy of the preview would prove those references. — [.plans/20261127-230105-insights-page.md:100](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:100)

### Edge cases the plan should address

- Opening Board from Insights, then reloading or using Back/Forward — the visible view and URL must stay in agreement.
- Opening the plan already named in an `/insights?sel=…` query — matching query parameters must not prevent the path from changing.

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
Update the plan at .plans/20261127-230105-insights-page.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Specify how opening Board from Insights writes /dashboard?view=board, and add a transition test including reload or history navigation. setPage() writes no history and the current openBoard() does not call syncUrl(). (evidence: .plans/20261127-230105-insights-page.md:147; apps/dashboard/page/app.js:4855)
2. Require syncUrl() to include the pathname in its early-return condition, and test opening the same plan already named in /insights?sel=…. Otherwise matching query parameters can leave the address on /insights. (evidence: apps/dashboard/page/app.js:663; .plans/20261127-230105-insights-page.md:150)

SHOULD FIX:
1. Require a recheck of the ledger module's actual exports, return shape and reader behavior after the prerequisite plan merges. (evidence: .plans/20261127-230105-insights-page.md:24)
2. Make the referenced preview available for implementation review, or record how its specified behavior can be verified. (evidence: .plans/20261127-230105-insights-page.md:100)

ADD THESE EDGE CASES:
- Open Board from Insights, then reload and use Back/Forward; verify that the URL and visible view agree.
- Open the plan already named in /insights?sel=…; verify that the path changes to /dashboard.

Do not change anything the validation did not flag.
```