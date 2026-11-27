**Validation round:** 1

## Plan validation: 20261127-230105-insights-page.md

**Verdict:** APPROVE WITH CHANGES

The plan is detailed and mostly right against the code. Two page-switch gaps give wrong behaviour on the main flow: the `renderDetail()` guard pulls the user off Insights on a background repaint, and the first load of `/insights` never fetches `/api/insights`. Both have small fixes.

### Blocking issues

- [Edge case / wrong behaviour] The switch in `renderDetail()` (`if (selected && pageNow !== 'dashboard') showPage('dashboard')`, step 10, and the markup test that requires it) pulls the user back to the Dashboard while they look at Insights. — `apps/dashboard/page/app.js:4413` (`if (selected && !typing) renderDetail(false);` runs on every state change in `refreshOnce()`), and more background calls at `app.js:1872`, `1892`, `2360`, `2387`, `3044`, `3406`. Step 10's `showPage()` keeps the Dashboard query in `dashSearch` and does not clear `selected`. — Example: Ana opens plan `demo-api/x` on the Dashboard, then picks **Plans ▾ → Insights**. `selected` is still `demo-api/x`. On the next `/api/state` change, `refreshOnce()` calls `renderDetail(false)`, the guard runs `showPage('dashboard')`, and the page jumps back to the Dashboard by itself. A PR load that ends after the switch (`app.js:1872`, `2360`) does the same. — Fix: do not put the switch in `renderDetail()`. Put `showPage('dashboard')` only in the user actions that open a plan (the sidebar row click `app.js:647`, the run strip `app.js:502`, the palette/tab switch `app.js:4571`, the board `openFromBoard()` `app.js:4862`, the scout link `app.js:5164`, the QA/side-pane list `app.js:3675`, the tour `app.js:4083`), or keep it in `renderDetail()` but make `showPage('insights')` save `selected` (with the `dashSearch`) and set `selected = null`, and make `showPage('dashboard')` give it back. Change the markup test in Tests to match, and add a Browser test row: "open a plan, switch to Insights, wait for a state change (edit a plan file) → Insights stays".

- [Wiring / main flow] The first load of `/insights` (and `/` that resolves to Insights) never shows Insights and never sends `GET /api/insights` for 60 s. — `apps/dashboard/page/app.js:5469-5472` (init: `readUrl(); applyView(); … refresh();`). Step 10 makes `readUrl()` set `pageNow` and `replaceState`, but only `showPage()` calls `applyPage()` and `loadInsights()`; the init lines are not changed, and the 60 s `setInterval` of step 11 is the first fetch. The popstate handler (step 10: "also calls `applyPage()`") has the same gap: Back from `/dashboard` to `/insights` shows an empty or old Insights section. — This breaks Example steps 1–2 (the first visit shows Insights and sends `GET /api/insights`). — Fix: in step 10, add `applyPage()` after `applyView()` in the init lines at the end of `app.js`, and call `loadInsights()` there and in the popstate handler when `pageNow === 'insights'`. Add both to the markup test (text check) and to the Browser test.

### Non-blocking concerns

- [Edge case] Esc while `#pagemenu` is open also closes the open plan. — `app.js:3745` returns early only for `#hdmenu` (`if (byId('hdmenu').matches(':popover-open')) return;`). — Add the same check for `#pagemenu` in step 10.
- [Edge case] The Board stays on behind Insights. — `applyView()` `app.js:4844-4853` keeps `body.boardview` and shows `#boardExit` (`app.js:4852`) while `boardOn`. When the owner is on the Board and picks **Plans ▾ → Insights**, `✕ Board` stays in the header over Insights. — Say in step 10 that `applyPage()` hides `#boardExit` and `#bpClose` on Insights (or that `showPage('insights')` keeps `boardOn` and the Dashboard gives the Board back), and add it to the Browser test.
- [History] `showPage('dashboard')` pushes `/dashboard` + `dashSearch`, then `renderDetail()` → `syncUrl()` (`app.js:658-668`) pushes again for the new `sel`, so one plan open from Insights makes two history entries; Back goes to `/dashboard?<old sel>`, not to `/insights`. — Use `showPage('dashboard', false)` + `replaceState` in the open paths, or say that two entries are wanted.
- [Charts] `projLook()` returns a CSS custom property string (`--pc:#hex` or `--ph:<hue>`), not a colour, and every project that is not in `state` gets the same `--ph:210`. — `app.js:339-349`, `app.css:161-162` (`.pcx { --pc:hsl(var(--ph, 210) 40% 66%); }`). — Say in step 11/12 that each SVG segment and dot gets `class="pcx" style="<projLook().style>"` and a CSS rule `fill: var(--pc)`, and that run-only (removed) projects share one grey/blue colour (or pick a hue by name).
- [Shipyard] `body.insightsview #hdtabs { display:none }` (step 12) removes the box that the Mac app's header script sizes to keep the session tabs at the sidebar's right edge. — `apps/plans-mac/src/main.swift:65` (`.shipyard #hdtabs { min-width: calc(var(--asw) - …) }`). On Insights in Shipyard the session tabs shift left. — Use `visibility:hidden` for `#hdtabs`, or note the shift as intended in the Browser test.
- [Roadmap text] `docs/roadmap.md:37` says "plans 2 and 3 are not written yet"; step 16 only adds "plan 2 … is done". — Make step 16 replace that clause too, so the entry does not say both.
- [Preview copy] `insMin()` copied from the preview `fmtMin()` (preview line 169) prints `1 h 60 min` for 119.6. — Round first (`Math.round(m)`), then split into hours and minutes; add the case to the `insMin` test.
- [Cache test timing] The cache-hit check (`d.md` added, same `build`) relies on the next GET arriving less than 10 s after the build. Under a loaded `npm test` this is very likely but not certain. — Optional: read `INSIGHTS_CACHE_MS` from an env var only in tests, or accept the small risk and say so in Harness constraints.
- [Server work] `insightsBody()` reads the full text of every plan file of every project synchronously on each build (`isParentPlan()` needs only the head). — Optional: read only the first few KB of each file.

### Edge cases the plan should address

- A plan is open on the Dashboard, then the owner switches to Insights and a state change or a PR load arrives — Insights must stay (blocking item 1).
- A direct load of `/insights?sel=demo-api/x` (a hand-edited link) — `pageFromUrl` gives Insights, `readUrl()` sets `selected`, and with the current guard the page jumps to the Dashboard; say what wins and test it in `pageFromUrl`.
- Back/Forward between `/insights` and `/dashboard` — the Insights data must load on popstate (blocking item 2).
- Two dashboard tabs: one on Insights, one on the Dashboard — `dash-page` is last-writer-wins; say that this is intended.
- `GET /api/insights` while the run log is being appended (a partial last line) — plan 1's `readLedger()` skips it; the cache key changes on the next append, so this is fine, but say it in the docs section.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`server.mjs` handler `:3351-3599`, `crossSiteReason` `:138`, `planFiles`/`doneFiles` `:285-292`, `allProjects` `:252`, `PAGE` `:3611`; `app.js` `syncUrl`/`readUrl`/popstate `:658-682`, `goHome` `:3773`, `#home` click `:3774`, Board block `:4818-4863`, `#hdmenu` handlers `:5462-5468`, init `:5469`; `page.html:7` `#home` markup; test `:318` assertion, `pageBlock` `:345`, `raw` `:1135`, cache test `:1803`; `plan-lanes.mjs:362-364` `looksRoadmap`; `docs-media.mjs:305,334,458` the three `b.open`). Plan 1 symbols checked against plan 1's text only.
- [x] Reference implementation mirrored, deviations justified (the preview functions at preview lines 165-320 match the planned `ins*` functions; the null rule is a stated deviation)
- [x] Breaking changes for changed symbols listed (consumer search done: `#home` only in `page.html:7`, `app.css:29`, `app.js:3774`, `app.js:4070`, test `:318`)
- [ ] Wiring & registration matches the code (declared, exported, imported, registered) — the init lines of `app.js` are not wired (blocking item 2)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (no tenants, no roles; 403 cases and 404 given)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; plan 1's line format is the consumed contract)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230105-insights-page.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Remove the switch `if (selected && pageNow !== 'dashboard') showPage('dashboard')` from renderDetail(). refreshOnce() calls renderDetail(false) on every state change while a plan is selected, and PR loads call it later too, so the page would jump from Insights back to the Dashboard by itself. Either call showPage('dashboard') only in the user actions that open a plan (sidebar row, run strip, palette/session tab, openFromBoard, scout link, side-pane list, tour), or make showPage('insights') save `selected` with dashSearch and set `selected = null`, and showPage('dashboard') give it back. Update the markup test in Tests to match, and add a Browser test row "open a plan, switch to Insights, change a plan file → Insights stays". (evidence: apps/dashboard/page/app.js:4413, 1872, 2360, 2387, 3044)
2. Wire the first load and Back/Forward: in step 10, add applyPage() after applyView() in the init lines at the end of app.js, and call loadInsights() there and in the popstate handler when pageNow === 'insights'. Add both to the markup test and the Browser test. (evidence: apps/dashboard/page/app.js:5469-5472, 679-682)

SHOULD FIX:
1. Make Esc ignore the key while #pagemenu is open, as it does for #hdmenu. (evidence: apps/dashboard/page/app.js:3745)
2. Say what happens to the Board when the owner switches to Insights from the Board: hide #boardExit and #bpClose on Insights, and test it. (evidence: apps/dashboard/page/app.js:4844-4853)
3. Avoid two history entries when a plan opens from Insights (showPage then syncUrl both push), or say it is intended. (evidence: apps/dashboard/page/app.js:658-668)
4. Say how projLook() styles become SVG colours (class "pcx" + style + `fill: var(--pc)`), and what colour a project that is only in the run log gets (projLook gives every unknown name --ph:210). (evidence: apps/dashboard/page/app.js:339-349, apps/dashboard/page/app.css:161-162)
5. Hide #hdtabs on Insights with visibility:hidden, or note in the Browser test that the Shipyard session tabs move left. (evidence: apps/plans-mac/src/main.swift:65)
6. In step 16, also replace "plans 2 and 3 are not written yet" in the roadmap entry. (evidence: docs/roadmap.md:37)
7. Make insMin() round before it splits hours and minutes (119.6 must not give "1 h 60 min"), and add that case to the insMin test.

ADD THESE EDGE CASES:
- A direct load of /insights?sel=<plan>: say whether the path or the query wins, and test it in pageFromUrl.
- Two browser tabs on different pages: dash-page is last-writer-wins; say it is intended.
- A partial last line in the run log during GET /api/insights: readLedger() skips it; say it in the docs section.

Do not change anything the validation did not flag.
```
