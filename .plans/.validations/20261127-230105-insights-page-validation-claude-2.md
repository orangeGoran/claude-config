**Validation round:** 2

## Plan validation: 20261127-230105-insights-page.md

**Verdict:** APPROVE WITH CHANGES

Plan 1 symbols (`apps/dashboard/insights.mjs`, `LEDGER`, `readLedger`, `syncLedger`, `apps/dashboard/test/insights.test.mjs`, the "Insights ledger" docs section, the AGENTS.md Commands row) are not on main; they were checked against `.plans/20261126-113132-insights-ledger.md` (steps 1, 3, 8, 11, 12) and match the plan's use of them.

The round 1 rewrite of step 10 was checked against `apps/dashboard/page/app.js`: `syncUrl()` (658-668), `readUrl()` (669-678), `popstate` (679-682), `renderDetail()` (683-705), `goHome()` and the `#home` click (3773-3777), the Esc handler (3733-3755), `startTour()` (4079-4088), `refreshOnce()` (4350-4427), `openSession()` (4569-4573), `applyView()`/`openBoard()`/`leaveBoard()` (4844-4859), the `#hdmenu` handlers and the init lines (5462-5489). The guard, the `syncUrl()` early return, `applyPage()` from init and popstate, and the Esc guard are sound. One gap stays (blocking item 1).

### Blocking issues

- [Edge case / wrong UI state] `showInsights()` clears `selected` but never repaints the detail state, so the plan that was open stays half-alive on Insights. — `app.js:3803-3815` (`renderEmptyDetail()` is the only code that calls `syncChat(null)`, `drawHdTabs(null)` and `drawSessionTabs()` for "no plan"); `app.js:1113-1120` (`syncChat` keeps the chat `EventSource` and calls `holdChatLock()`); `app.js:1043-1049` (`drawHdTabs` fills `#hdtabs` and calls `setSelTitle`); `app.js:4413-4414` (`refreshOnce()` calls `renderEmptyDetail()` only when the `/api/state` body changed). — Step 10 lists `selected = null`, `boardOn = false`, `applyView()`, `setPage('insights')`, `pushState`. Nothing there calls `renderEmptyDetail()`. Result until the next state change (can be minutes): the Plan / Files switch of the old plan stays in `#hdtabs` (step 12 keeps `#hdtabs` visible on the claim "it is empty while no plan is open", which is false here), its buttons call `renderDetail(false)` with `selected` null; the tab title keeps the plan name; the active session tab stays marked; the chat stream stays open and keeps the `dash-chat:<key>` Web Lock, so other browser tabs drop that chat's alerts (`app.js:4196-4199` returns false when the lock is held) while nobody sees the chat. — Fix: in `showInsights()`, after `setPage('insights')` (so `syncUrl()` returns at once and writes no extra `/dashboard` history entry), call `renderEmptyDetail()`; add it to the markup test ("`showInsights()` calls `renderEmptyDetail()` after `setPage('insights')`") and to the Browser test (open a plan with a chat, switch to Insights → no Plan/Files switch in the header, the tab title is not the plan name).

### Non-blocking concerns

- [Wiring / load order] Step 11 does not say where the Insights drawing block goes. `applyPage()` runs at init (`app.js:5469-5470`) and calls `loadInsights()`, which reads `insData`, `insF` and the request number. If those `let` lines are placed after the init lines (for example appended at the end of `app.js`, where the plan itself expects merge conflicts), the first `applyPage()` throws a `ReferenceError` (temporal dead zone) and the whole page stops. No node test catches it. — Say "before the init lines (next to the page switch)", and add a markup assertion that `let insData` comes before the `readUrl();\napplyView();` init lines.
- [Spec ambiguity] `insMin()`: "rounds the whole minutes first" conflicts with the test `0.5 → <1 min` if the `< 1` check runs on the rounded value (0.5 rounds to 1 → `1 min`). — Say: check `m < 1` on the raw value, then round, then split into hours and minutes (preview `fmtMin`, preview line 169).
- [Edge] `syncUrl()` "pushes when the path changed": the current early return `if (same('sel') && same('tab') && same('file') && same('view')) return;` (`app.js:663`) runs before any path check. On `/insights?sel=x`, opening plan x from the palette gives the same query, so the early return keeps `/insights?sel=x` while the Dashboard shows; a reload then shows Insights. — Say that the early return also needs the path to be `/dashboard`.
- [Edge] `startTour()` with `setPage('dashboard')` first, but no plan to open (`app.js:4081-4084`): no `renderDetail()` runs, so the address stays `/insights` while the Dashboard shows. — Call `syncUrl()` (or push `/dashboard` + `dashSearch`) when `startTour()` switched the page and opened no plan.
- [Layout] `.mainhd .hdl` has a fixed width `--hdl: 184px * --fs` with `white-space:nowrap` (`app.css:37-38`) and holds the title, ⋯ and **Code**. "Plans ▾" as a button is wider than the "Plans" link; Shipyard sizes `#hdtabs` from `--hdl` (`apps/plans-mac/src/main.swift:65`). — Step 12: `.hdtitle` gets no padding and the page checks that `.hdl` does not overflow at 1440 px (Browser test), or widen `--hdl` and say so.
- [Docs: naming] The `docs/roadmap.md` "Plans Insights" entry (`docs/roadmap.md:37`) says "read from a ledger of finished runs"; step 16 replaces only the status sentence. The naming decision says docs call the file the "run log". — Reword that clause too.
- [Changelog] `audience: internal` for a new page the owner uses; the earlier dashboard features use `both` (`changelog.d/20261126-fast-api-state.yaml`). Not wrong under `changelog.d/README.md`, but check the choice.
- [Edge, weeks] `insWeeks()` "empty weeks from the first run's week to the week of now": a loop that adds `7 * 864e5` drifts by one hour across a DST change; the preview adds 12 h before `weekStart()` for that reason (preview line 223). — Step 9: step the weeks with `setDate(+7)` or the preview's 12 h shift, and add a test week that crosses the last Sunday of October.

### Edge cases the plan should address

- Two registry entries with the same `plansDir` — the Plans pipeline counts their plans twice (plan 1 de-duplicates runs by `autoRunsDir`, this plan does not de-duplicate plan counts).
- `showDashboard()` when the kept-aside plan was archived or removed meanwhile — `renderDetail(true)` → `renderEmptyDetail()` → `syncUrl()` pushes a second history entry right after the `pushState` of `showDashboard()`; use `replaceState` there or drop `sel` from `dashSearch` when `find()` gives nothing.
- `isParentPlan()` reads every open plan file in full on each rebuild (sync, at most every 10 s); reading only the head (up to the first `\n## `) keeps a large plans folder cheap.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (plan 1 symbols checked against plan 1's text)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `#home` only in page.html, app.css:29, app.js:3774, app.js:4070, dashboard.test.mjs:318; `b.open(... '/')` in docs-media.mjs:305, 334, 458)
- [x] Wiring & registration matches the code (declared, exported, imported, registered) — load order of the step 11 block not stated (non-blocking)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (no tenants; 403 cases and a 404 path are in)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected (roadmap clause "ledger" left, non-blocking)
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230105-insights-page.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 10 "Leave the Dashboard", make showInsights() call renderEmptyDetail() after setPage('insights') (so syncUrl() returns and writes no /dashboard history entry). Without it the old plan's Plan/Files switch stays in #hdtabs, the tab title keeps the plan name, and the chat stream keeps its dash-chat lock, so other tabs drop that chat's alerts until the next state change. Add the call to the markup test and a Browser test line (open a plan with a chat, switch to Insights: no Plan/Files switch, the title is not the plan name). Correct the step 12 claim that #hdtabs "is empty while no plan is open" to rely on this call. (evidence: apps/dashboard/page/app.js:3803-3815, 1113-1120, 1043-1049, 4413-4414, 4196-4199)

SHOULD FIX:
1. In step 11, say that the Insights drawing block (let insData, insF, the request number, the 60 s setInterval) goes before the init lines, and add a markup assertion for that order; applyPage() at init calls loadInsights(), and a let declared after the init lines throws a ReferenceError. (evidence: apps/dashboard/page/app.js:5469-5472)
2. In step 9, say that insMin() checks m < 1 on the raw value before it rounds. (evidence: plan Tests, insMin 0.5 → <1 min)
3. In step 10, say that the syncUrl() early return (all four keys the same) also needs the path to be /dashboard. (evidence: apps/dashboard/page/app.js:663)
4. In step 10, make startTour() write /dashboard to the address when it switched the page and opened no plan. (evidence: apps/dashboard/page/app.js:4081-4084)
5. In step 12, keep the title button inside the fixed --hdl width (no padding), or widen --hdl and say why; add a 1440 px Browser test check that .hdl does not overflow. (evidence: apps/dashboard/page/app.css:37-38, apps/plans-mac/src/main.swift:65)
6. In step 16, also reword "read from a ledger of finished runs" in the roadmap entry to "run log". (evidence: docs/roadmap.md:37)
7. In step 9, step insWeeks() by calendar days (setDate +7) or the preview's 12 h shift, and add a test that crosses a DST change.

ADD THESE EDGE CASES:
- Two registry entries with the same plansDir: the plan counts double.
- showDashboard() when the kept-aside plan is gone: avoid a second history entry.
- isParentPlan(): read only the head of each plan file.

Do not change anything the validation did not flag.
```
