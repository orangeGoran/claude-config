**Validation round:** 4

## Plan validation: 20261127-230105-insights-page.md

**Verdict:** APPROVE WITH CHANGES

The round 3 edits match the code. Step 6 fits `server.mjs`: `json()` writes the header itself (`server.mjs:3342-3345`), the handler catch sends `String(e)` (`server.mjs:3601-3602`), `redact` is already imported from `./watch.mjs` (`server.mjs:39`, `watch.mjs:133`), and `invalidateState()` runs before the routes and in `finally` (`server.mjs:3366`, `server.mjs:3604`). Step 10 fits `app.js`: `syncUrl()` builds from `location.pathname` and has the early return (`app.js:658-668`), `readUrl()` is at `app.js:669-678`, the `popstate` handler is at `app.js:679-682`, and the init lines are at `app.js:5473-5476`. No other top-level call runs `syncUrl`, `renderDetail` or `readUrl` before `let pageNow` would be declared near `app.js:4822`, so no TDZ error. Step 12 fits `app.css`: the global `button` rule is at `app.css:205-206`, `--hdl` is `calc(184px * var(--fs))` at `app.css:37`, `.rbar` uses `var(--hdl)` at `app.css:542`, and `.hdmenu` is a class rule (`app.css:50-58`), so `#pagemenu class="hdmenu"` gets the menu look. The `raw()` signature is `(method, p, headers, data)` and it always uses the suite's `port` (`dashboard.test.mjs:1156-1162`), so the fifth parameter `toPort = port` is right. I found no blocking issue.

### Blocking issues

None.

### Non-blocking concerns

- [Docs: current state only] Plan 1 step 1 writes a header comment in `apps/dashboard/insights.mjs` that names the guide section "Insights ledger" (`.plans/20261126-113132-insights-ledger.md:100`). Step 15 renames that section to "Insights run log", so the code comment then points to a section that does not exist. Suggestion: in step 15 (and in Affected files for `insights.mjs`), also change that header comment to "Insights run log", and change every `#insights-ledger` anchor that plan 1 adds.
- [Tests / Edge] The End-to-end setup names only a `plansDir` for `insights-demo`. `resolveProject()` calls `path.join(root, '.claude/scripts/auto-pipeline.sh')` without a guard (`server.mjs:198`), and `loadRegistry()` does not filter entries that have no `root` (`server.mjs:171-174`). So an entry with no `root` makes `allProjects()` throw, and every route that calls it returns 500. Suggestion: say "a registry entry with `root` and `plansDir`, as the cache test does (`dashboard.test.mjs:1835-1837`)".
- [Verify can fail] In the Read-error case, "the body has no HOME path" cannot fail when the run log is a folder: the error is EISDIR, and its message holds no path. The real guard is the next `GET /api/state` that returns 200. Suggestion: when the answer is 500, also check that the body is exactly `{ error: 'Cannot read the run log or the plan files. See the server log.' }`, so a leftover `String(e)` fails the test.
- [Reference implementation] One Deviation says `insightsBody()` "does only file reads (no `pgrep`, no `gh`)". But `allProjects()` → `resolveProject()` → `issuesUrlFor()` runs `execFileSync('git', … 'remote', 'get-url', …)` once per root, with a 5 s timeout, and caches the result (`server.mjs:179-189`, `server.mjs:216`). It stays synchronous, so the claim "two requests cannot overlap" still holds. Suggestion: change the wording to "file reads and the cached `git remote` lookup of `allProjects()`".
- [Edge] Step 11: "fills with `var(--pc)`" is not clear for SVG. Inside an SVG `fill="…"` attribute, `var()` is not reliable. Suggestion: set `style="fill:var(--pc)"`, or use a CSS rule such as `.pcx rect { fill:var(--pc) }`.
- [Tests clarity] The Markup test is described as working on "the page from `GET /`", but one item ("the `/api/insights` branch calls `insightsBody()` before `res.writeHead`") checks the text of `server.mjs`, which the page does not contain. Suggestion: say that this item reads `apps/dashboard/server.mjs` with `readFileSync`.

### Edge cases the plan should address

- A registry entry with no `root` (a hand-edited registry): `allProjects()` throws (`server.mjs:198`), so `/api/insights` returns the generic 500. That is acceptable, but the test fixture must not hit it by accident.
- Closing the last session tab from Insights: `closeSession()` calls `openSession(next)` only when `key === selected` (`app.js:4586-4587`). On Insights, `selected` is null, so a tab close only redraws the tabs. This is correct today; keep it that way.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (plan 1 symbols checked against plan 1's text only)
- [x] Reference implementation mirrored, deviations justified (one deviation's wording is a little wrong, see above)
- [x] Breaking changes for changed symbols listed (consumer search done: `id="home"`, `close the open plan`, `#home`, `goHome`, `b.open(` in docs-media, the Shipyard navigation policy and headerScript)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (no tenants or roles; 403 and 404 are covered; there are no parameters)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [ ] Docs: current state only respected (the stale "Insights ledger" reference in the `insights.mjs` header)
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230105-insights-page.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 15 and in Affected files (insights.mjs), also change the header comment of apps/dashboard/insights.mjs that names the guide section "Insights ledger" to "Insights run log", and change every #insights-ledger anchor that plan 1 adds (evidence: .plans/20261126-113132-insights-ledger.md:100).
2. In the End-to-end setup, give the insights-demo registry entry a root and a plansDir, as the cache test does; an entry with no root makes allProjects() throw (evidence: apps/dashboard/server.mjs:198, apps/dashboard/test/dashboard.test.mjs:1835-1837).
3. In the Read-error case, when the answer is 500, check that the body is exactly the generic error object, so that a leftover String(e) fails the test; an EISDIR message holds no path (evidence: apps/dashboard/server.mjs:3601-3602).
4. Reword the insightsBody() deviation: allProjects() also runs a cached synchronous `git remote get-url` per root, so it does not do only file reads (evidence: apps/dashboard/server.mjs:179-189).
5. In step 11, say that SVG shapes get their colour through CSS (style="fill:var(--pc)" or a .pcx rule), not through a fill="var(--pc)" attribute.
6. In the Markup test, say that the "insightsBody() before res.writeHead" check reads apps/dashboard/server.mjs, not the page from GET /.

ADD THESE EDGE CASES:
- A registry entry with no root gives the generic 500 on /api/insights; the test fixture must include a root.

Do not change anything the validation did not flag.
```
