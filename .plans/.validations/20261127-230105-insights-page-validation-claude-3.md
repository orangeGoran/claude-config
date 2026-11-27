**Validation round:** 3

## Plan validation: 20261127-230105-insights-page.md

**Verdict:** APPROVE WITH CHANGES

The round 2 edits to step 10 hold up against `apps/dashboard/page/app.js`. I traced every way a plan or the Board opens from Insights (session tab, palette, alert, scout drawer, `boardWithTag()`, the tour, Back/Forward). Each one goes through `renderDetail()`, `openBoard()` or `startTour()`, so the new `setPage('dashboard')` guard and the path check in `syncUrl()` cover them all. I found no blocking issue. Five small gaps remain.

### Blocking issues

None.

### Non-blocking concerns

- [Edge case / parent rule] Only `setPage()` writes `dash-page` (plan step 10, line 148). `readUrl()` sets `pageNow` directly (line 152), and the `popstate` handler and the init lines then call `applyPage()`, not `setPage()`. So a direct load of a `/dashboard` bookmark, a reload, or Back/Forward between the two pages does not save the page that shows. Example: the owner picks Insights from the menu (`dash-page` = insights), presses Back to `/dashboard?sel=x` and closes the tab. The next `/` opens Insights, not the page used last (parent plan line 11: "`/` opens the page that the browser used last"). — Suggestion: in `applyPage()` (or at the end of `readUrl()`), save `dash-page` = `pageNow` in a `try`, and add a markup-test assertion for it.
- [CSS] `.hdtitle` resets only "no border, no padding, bold, inherit colour" (step 12, line 155). The global `button` rule at `apps/dashboard/page/app.css:205-206` also sets `background:var(--btn)`, `border-radius:8px` and `font-size:calc(13px * var(--fs))`, and `h1` is 15 px (`app.css:28`). The title would get a button background and a smaller font than today's link. — Suggestion: add `background:none; font:inherit; border-radius:0` to `.hdtitle`.
- [Test harness] The end-to-end Access cases use "the suite's `raw()` helper" (line 199), but `raw()` always targets the suite server's `port` (`apps/dashboard/test/dashboard.test.mjs:1135-1136`), not the test's own server. — Suggestion: say that `raw()` gets a port argument (or a local copy with the own port), or that the access cases run against the suite server.
- [CSS side effect] `--hdl` also sets the first column of the Files changed bar (`.rbar { grid-template-columns:var(--hdl) … }`, `app.css:542`). The 184 → 200 px change moves the Plan / Files switch 16 px to the right in both bars, so the two bars stay aligned. Steps 12 and the Breaking changes name only `#hdtabs`. — Suggestion: name `.rbar` in step 12 and add "Files changed bar: the switch is at the same x as in the header" to the Browser test.
- [Wording] The Contracts section says `open` is "`planFiles()`" and `done` is "`doneFiles()`" (lines 77). Those are private helpers of `server.mjs` (`server.mjs:285-292`), while step 2 reads the folders again in `insights.mjs`. — Suggestion: say "the same count as `planFiles()` / `doneFiles()`" so the implementer does not try to import them.

### Edge cases the plan should address

- `renderInsights()` before the first `/api/insights` answer. Step 11 makes `refreshOnce()` call `renderInsights()` when the state changes, and the first state answer can come before the first insights answer. With `insData === null`, the panels need a "loading…" text, not a TypeError.
- `dash-page` on Back/Forward and on a direct load (see the first concern above).

### Checks done (evidence)

- `syncUrl()`: `app.js:658-668`. It builds from `location.pathname` (line 666), and its early return compares only the query (line 663). Step 10 changes both, and a path change counts as a push. This is correct.
- `readUrl()`, `popstate`: `app.js:669-682`. They match step 10 (applyPage after applyView).
- `renderDetail()`: `app.js:683-687`. `applyView()` comes first, then `syncUrl()`. The guard goes in before `syncUrl()`, and with `selected` null it falls through to `renderEmptyDetail()`, whose `syncUrl()` returns at once on Insights.
- `renderEmptyDetail()`: `app.js:3803-3815`. It calls `syncUrl`, `syncChat(null)`, `drawHdTabs(null)`, `drawSessionTabs()`, and removes `review`. This matches the step 10 text.
- `openBoard()` / `leaveBoard()`: `app.js:4855-4859`. The callers are the boardBtn handler (5452) and `boardWithTag()` (5009-5011), so all go through `openBoard()`. `toggleBoard` (the Mac hook, 4797) clicks boardBtn.
- `startTour()`: `app.js:4079-4088`. The callers are 4052 (the guide) and 5486 (`?tour`).
- Paths where a plan opens: 502, 647, 3675, 4083, 4201-4205, 4571, 4862, 4972, 5164. All of them call `renderDetail()`. `closeSession()` on a tab that is not selected only redraws (4582). `goHome()` from Esc only runs when `selected` is set (3754).
- `refreshOnce()`: `app.js:4413-4414`. With `selected` null it calls `renderEmptyDetail()`. That is harmless on Insights.
- The init lines are at the end of the file (`app.js:5469-5491`), so the drawing block "before the init lines" is a valid placement.
- `--hdl` / `--hdsw`: `app.css:37-39`. In Shipyard, `main.swift:65` gives `#hdtabs` the min-width 400−80−200−20 = 100 px, which is still positive. `apps/plans-mac/test/build.test.mjs:141` checks only that `--hdl:` exists. No test asserts 184px.
- `#home` consumers: `app.js:3774` (removed by step 10), `app.js:4070` (the tour anchor, id kept), `app.css:29`, `dashboard.test.mjs:318` (listed). No other consumer in apps/, test/, scripts/ or docs/.
- Server: the handler is at `server.mjs:3351-3599`. `changes`/`invalidateState()` is at 3358-3359 and 3597, the `/` branch at 3365, `/api/state` at 3371, and POST `/api/meta` at 3553 (it takes `b.project`/`b.slug`, so the e2e POST works). `crossSiteReason` (138-148) refuses a GET with a foreign `Origin`, so the 403 cases hold.
- `looksRoadmap`: `.claude/scripts/plan-lanes.mjs:362-364`. Step 1 quotes it correctly.
- Preview `usd`, `fmtMin`, `weekStart` and the +12 h week step: they match steps 9 and 183 (`fmtMin` in the preview rounds after it splits the hours, and the plan fixes that).
- `scripts/docs-media.mjs:305,334,458`: the three `b.open(... + '/')` calls are as stated.
- Plan 1 (context): `LEDGER = os.homedir()/...` (plan 1 step 1), so a child `HOME` moves it. `readLedger` needs `v, project, slug, src` (plan 1 step 3), and the e2e lines carry `src`. The import line is `import { syncLedger, LEDGER } from './insights.mjs'`.
- `docs/roadmap.md:37`: the status sentence starts "Three plans;", as step 16 says.
- `changelog.d/AGENTS.md`: an `audience: internal` entry has no `customer` key. Step 17 matches.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (plan 1 symbols checked against plan 1's text)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (no tenants; 403 and 404 cases present)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230105-insights-page.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. Save dash-page whenever the shown page changes, not only in setPage(): in applyPage() (or at the end of readUrl()), write dash-page = pageNow inside a try, so a direct load of /dashboard, a reload and Back/Forward also count as "the page used last". Add a markup-test assertion for it. (evidence: plan lines 148 and 152; parent plan line 11)
2. In step 12, make .hdtitle also reset background (none), font (inherit) and border-radius, because the global button rule sets background:var(--btn), border-radius:8px and font-size 13px. (evidence: apps/dashboard/page/app.css:205-206, app.css:28)
3. In the End-to-end Access cases, say how raw() reaches the test's own server: raw() is bound to the suite server's port. Give it a port argument, or run the access cases against the suite server. (evidence: apps/dashboard/test/dashboard.test.mjs:1135-1136)
4. In step 12, name the second user of --hdl: the first column of the Files changed bar (.rbar). Add a Browser test line that the Plan / Files switch has the same x in the header and in the Files changed bar. (evidence: apps/dashboard/page/app.css:542)
5. In Contracts, write "the same count as planFiles() / doneFiles()": these are private helpers of server.mjs, and step 2 counts the files again in insights.mjs. (evidence: apps/dashboard/server.mjs:285-292)

ADD THESE EDGE CASES:
- renderInsights() called by refreshOnce() before the first /api/insights answer (insData null): show "loading…" and do not throw.

Do not change anything the validation did not flag.
```
