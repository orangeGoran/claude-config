## Plan validation (codex): 20261127-230105-insights-page.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Integration shape] Switching to Insights while a plan is selected leaves `selected` set. The proposed `renderDetail()` guard then switches back to Dashboard when an ordinary state refresh calls it — [plan:143](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:143), [app.js:4413](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:4413) — Insights can disappear without a navigation action. Preserve the Dashboard selection separately or distinguish an explicit plan-opening action from a refresh, and test switching with a plan selected.
- [Wiring] The plan calls `loadInsights()` from `showPage()`, but initial navigation uses `readUrl()` and the proposed `popstate` change only calls `applyPage()` — [plan:143](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:143), [app.js:679](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:679), [app.js:5469](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:5469) — a direct visit, reload, first visit to `/`, or browser history navigation can show an empty page until the interval fires. Load Insights on every transition into it, including initialization and history navigation; test those paths.

### Non-blocking concerns

- [References] The ledger module and its tests are future deliverables, so their actual exports and behavior cannot yet be verified — [plan:23](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:23). Recheck them against the merged prerequisite before implementation. The preview is also outside the repository; its claimed behavior was not verified by this read-only review.
- [Contracts] `insMedian()` returns `0` for no values, while the Projects table test expects `median: null` for a project with no runs — [plan:142](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:142), [plan:167](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230105-insights-page.md:167). Specify where the empty case is converted so missing data is displayed consistently.

### Edge cases the plan should address

- An Insights request completes after the user has switched pages or after a newer request has completed — prevent stale responses from replacing newer data.
- Saved project filters name projects that have since disappeared, or leave every currently available project hidden — ensure the filters remain usable.

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
1. Distinguish an explicit plan-opening action from a routine detail refresh, or preserve the Dashboard selection separately, so switching to Insights with a selected plan does not switch back on a state refresh. Add a test for that sequence. (evidence: .plans/20261127-230105-insights-page.md:143; apps/dashboard/page/app.js:4413)
2. Load Insights on initial direct visits, reloads, first visits through /, and browser history navigation into Insights, as well as menu navigation. Add tests for those paths. (evidence: .plans/20261127-230105-insights-page.md:143; apps/dashboard/page/app.js:679; apps/dashboard/page/app.js:5469)

SHOULD FIX:
1. Recheck the ledger module and its exports against the merged prerequisite, and verify the preview behavior before implementing its mirrored panels. (evidence: .plans/20261127-230105-insights-page.md:23; .plans/20261127-230105-insights-page.md:80)
2. Specify how an empty median becomes null in the Projects table when insMedian returns 0 for no values. (evidence: .plans/20261127-230105-insights-page.md:142; .plans/20261127-230105-insights-page.md:167)

ADD THESE EDGE CASES:
- An Insights request completes after navigation away or after a newer request; prevent stale data from replacing newer data.
- Saved hidden-project filters contain removed projects or hide every currently available project; keep the filters usable.

Do not change anything the validation did not flag.
```