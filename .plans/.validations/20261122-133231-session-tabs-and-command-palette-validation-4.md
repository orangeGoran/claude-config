**Validation round:** 4

## Plan validation: 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round-3 edits match each other across the plan: IS_MAC hints, who owns Escape, the block placement, the Contracts field list, browser steps 10 and 12, and the restart rule now worded as the owner reworded it. One real defect is left. Step 17 puts only the run block of `docs-media.mjs` behind the main-module guard. The Chrome and Node checks at the top of that file still call `process.exit(1)` when the file is imported, so the new `copyDashboard` test stops the whole dashboard test file on any machine without Chrome in `/Applications`, and on Node 18 to 21.

### Blocking issues

- [Tests for logic changes / Edge cases] Importing `scripts/docs-media.mjs` still exits the process. — `scripts/docs-media.mjs:27` `if (!existsSync(CHROME)) { …; process.exit(1); }` and `:28` `if (typeof WebSocket === 'undefined') { …; process.exit(1); }` run at module top level. Plan step 17 (plan line 112) wraps only the run at `:571-578`. The unit test at plan line 127 imports `copyDashboard` from this file inside `scripts/test/plans-dashboard.test.mjs`. — Why it breaks: on Linux (supported by hand per `README.md:25`), on a Mac without Chrome in `/Applications`, or on Node 18 to 21 (`docs/plans-dashboard.md:34` "Requires Node 18+"), the import calls `process.exit(1)`. This ends every test in `plans-dashboard.test.mjs`, so `npm test` fails. The pipeline does not catch this, because the owner's Mac runs Node 24 (`node --version` → v24.21.0) and probably has Chrome. — Fix: in step 17, also move the two checks at lines 27–28 into the main-module guard (or into `openChrome()`/`demoVideo()`). After that, an import only defines the constants and functions. Add to the test or the step: "importing the file does not exit and does not need Chrome".

### Non-blocking concerns

- [Edge cases / Never stop processes by name] The env of the `copyDashboard` test server is only implied ("as `before()` starts the test server", plan line 127). — `scripts/plans-dashboard.mjs:3283-3284` runs `open <url>` on darwin unless `DASH_NO_OPEN` is set. `:45` and `:3255` bind QA port 4898 unless `QA_REPORTS_PORT` is set, and that is the real QA store port. `:49` and `:3282` start summaries unless `DASH_NO_SUMMARY` is set. — Suggestion: name the env in the test bullet: `DASH_NO_OPEN=1 DASH_NO_SUMMARY=1`, a free `DASH_PORT` and a free `QA_REPORTS_PORT`, a throwaway `HOME`, and `CLAUDE_TMP` in the temp folder. Stop the server by its child PID, as `stop()` does at `scripts/test/plans-dashboard.test.mjs:169-173`.
- [Reference implementation] The main-module check does not follow the existing pattern. — `scripts/artifact-copies.mjs:263` uses `if (process.argv[1] === fileURLToPath(import.meta.url))`, and `fileURLToPath` is already imported in `scripts/docs-media.mjs:20`. Step 17 adds `pathToFileURL` instead. — Suggestion: use the existing form, or state why it differs.
- [Consistency] Affected files does not list the new test. — Plan line 60 says the test file gets "two tests for the pure functions, one test that the page has `window.dashboard`…". The Tests section (plan lines 121–131) also has the `copyDashboard` test and more than two pure-function tests. The name also differs: `copyDashboard(dest)` at line 63 and `copyDashboard(dash)` at line 112. — Suggestion: update line 60 to match the Tests list, and use one parameter name.
- [Edge cases] With an empty query, `paletteMatch` reads raw `sessionTabs`. — Step 9 (plan line 104) passes `sessionTabs`, which can hold stale keys of a missing project (step 8 keeps them on purpose). `paletteDraw()` then reads `p.file` from `find(key)`. — Suggestion: say that tab keys with no matching item in `plans` give no row, or pass `shownTabs()`. Add an `old/x` stale key to the empty-query unit test.

### Edge cases the plan should address

- ⌘K while the palette is already open: `openSearch()` saves `document.activeElement`, which is `#palq` by then. Esc then puts the focus back on a hidden input, and the first saved element is lost. Make `openSearch()` only refocus `#palq` when the palette is open.
- A stale tab key (project missing from the state) in the empty-query palette list. See the concern above.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (checked: `renderDetail` `if (!p) return renderEmptyDetail();` app.js:608; `refreshOnce` repaint branch :4029-4071; `// --- Board:` :4075 / `let boardOn` :4079; `openFromBoard` early return :4121; `squash`/`matchesFields`/`matchesQ` :249-256 then `function visiblePlans() {` :257; `visibleWts` :341; worktree items carry `file`, `tags: []`, `kind: 'wt'` :4049-4050; `wtItemHtml` dot rule :357; `escA` :3156; `hasChat` :969; `toggleChat(on)` toggles with no argument :1027; `prTab[...] = …; lastPrDraw = null; renderDetail(false)` :953/:958; three `ctrlKey` uses :1535, :2317, :3470; `.mmdfull`, `.imgview`, `seldlg` `<dialog>`, `#onb.open`, `tourStep`; page.html first `</header>` :18, logpane header :44, `#toasts` :61; app.css `#toasts` z 40 :729, `#tourpop` z 32 :754, no global `[hidden]` rule, `body.review > header` :515; `PAGE`/`<!--@JS-->` uses split/join :2938-2941; plist `__SCRIPT__`; server imports `artifact-copies.mjs`, `page-versions.mjs`, `chat-relay.mjs`, and `UI_DIR` :2936)
- [ ] Reference implementation mirrored, deviations justified (main-module guard differs from artifact-copies.mjs:263 and gives no reason)
- [x] Breaking changes for changed symbols listed (consumer search done: no test slices near the new blocks; the `data-go-tab` attribute does not collide with the `[data-go=…]` selectors in docs-media.mjs:316-317)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected (matches the reworded AGENTS.md:9: restart under Open items, after merge and pull)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected (new test stops by PID; the existing `pkill -f <sock>` at test:213 is not changed)
- [ ] Tests for logic changes respected (the new test's import exits on machines without Chrome or on Node below 22; see the blocking issue)
- [x] Docs: current state only respected
- [x] Contracts respected (no contract source; fields listed are existing `/api/state` / client-side fields)
- [x] "How to verify" commands are real and can fail (`npm test`, `node --test`, `node .claude/scripts/changelog-validate.mjs` are in Commands or in the `.claude/settings.json` allow list; the greps fail when the markers are missing)

```
Update the plan at .plans/20261122-133231-session-tabs-and-command-palette.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 17, also move the Chrome check and the WebSocket check at the top of scripts/docs-media.mjs (lines 27-28, both call process.exit(1)) into the main-module guard (or into openChrome()/demoVideo()). Then importing the file from scripts/test/plans-dashboard.test.mjs does not exit on a machine without Chrome or on Node 18-21. State in the copyDashboard test bullet that the import must not need Chrome. (evidence: scripts/docs-media.mjs:27-28, README.md:25, docs/plans-dashboard.md:34)

SHOULD FIX:
1. In the copyDashboard test bullet, name the env of the copied server: DASH_NO_OPEN=1, DASH_NO_SUMMARY=1, a free DASH_PORT, a free QA_REPORTS_PORT, a throwaway HOME, and CLAUDE_TMP in the temp folder. Stop the server by its child PID. (evidence: scripts/plans-dashboard.mjs:45, :3255, :3283-3284)
2. Use the existing main-module form `process.argv[1] === fileURLToPath(import.meta.url)` (fileURLToPath is already imported), or say why pathToFileURL is used instead. (evidence: scripts/artifact-copies.mjs:263, scripts/docs-media.mjs:20)
3. Update the scripts/test/plans-dashboard.test.mjs line in Affected files so that it matches the Tests list (including the copyDashboard test), and use one parameter name for copyDashboard (dest or dash). (evidence: plan lines 60, 63, 112)
4. In step 9, say that tab keys with no matching item in plans/wts give no row (or pass shownTabs() instead of sessionTabs), and add a stale key such as old/x to the empty-query paletteMatch unit test. (evidence: plan lines 103-104; app.js:128 find())

ADD THESE EDGE CASES:
- ⌘K while the palette is open: openSearch() only refocuses #palq and keeps the first saved element, so Esc still puts the focus back where it was.

Do not change anything the validation did not flag.
```
