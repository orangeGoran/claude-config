**Validation round:** 2

## Plan validation: 20261127-195706-groups-ledger-checklist.md

**Verdict:** APPROVE WITH CHANGES

Round 1 fixes F1–F20 are in the plan and match the code. Exception: F9 (the cut UTF-8 character) has a test that cannot fail (B1). One new defect: two end-to-end assertions race the first PR list load (B2). Everything else is small.

### Blocking issues

- [Tests can fail / round 1 F9 incomplete] The `é` truncation case cannot catch a missing U+FFFD fix. — Plan line 194: "A file of 150000 × `é` (2 bytes each, 300000 bytes) → `truncated: true`, `text` has no `�`, and `Buffer.byteLength(text)` is 262144." 262144 is even, so the 256 KB cut falls between two 2-byte characters. Nothing is cut in half, `toString('utf8')` gives no U+FFFD, and the test passes with or without the "remove one trailing `�`" rule of step 6 (plan line 150). — The rule that F9 added has no test that fails when the rule is missing. — Fix: put one ASCII byte before the `é` characters (`'a' + 'é'.repeat(150000)`), so byte 262144 cuts an `é`. Expect `text` with no `�` and `Buffer.byteLength(text) === 262143`. Optional: use `StringDecoder` from `node:string_decoder` (a built-in). Its `write()` holds back an incomplete last character, so no `�` appears and none needs to be removed.

- [Tests: race on async PR load] The first `/api/ledger` read in "The chain from two repos" and in "The chain follows a merge" expects PR data, but the server loads the PR list in the background on first use. — `apps/dashboard/server.mjs:1547-1551`: `prsFor()` starts `refreshPrList(proj)` and returns `{}` while `c` is missing. `listPlans()` sets `pr: prOf(slug)` from that map (`server.mjs:571`, `:601`). Plan line 191 expects `invoice-export: needs-you, PR #7 OPEN` right after `register()`. Plan line 192 expects `step needs-you` before the merge. Neither waits. The only `until()` is after the merge. — The first build after `register()` sees `pr: null`, so the step is `planned`. The test fails often, depending on whether a 300 ms watcher tick loaded the list first. No other case in `watcher.test.mjs` reads `pr` from `/api/state` without waiting. — Fix: read both first assertions with `until()` (until the row has `pr.number === 7` / `8`), or call `seen('gl-api')` / `seen('gl-merge')` first (`watcher.test.mjs:163`).

### Non-blocking concerns

- [Reference implementation / layout] Most of the checklist HTML is not inside a `.setup` wrapper. — `app.css:308` `#logbody { … white-space:pre-wrap; }`. Scout wraps its whole drawer in `<div class="setup sc">` (`app.js:5053`), and `.setup` sets `white-space:normal` (`app.css:310`). `md()` puts `\n` between blocks. — Wrap the whole `checklistHtml()` output in `<div class="setup sc">` like `renderScout()`, so the ledger text has no extra blank lines.
- [Test harness pattern] The new end-to-end cases never unregister their projects. — Every existing case ends with `unregister([...])` (for example `watcher.test.mjs:251`, `:269`, `:869`). The plan's cases also depend on each other (cases 3 and 4 use the `gl-group` of case 1). — Unregister the `gl-*` projects at the end of the last case that uses them, or make each case set up its own group.
- [Test setup gaps] Plan line 194: `gl-group4` (folder at the `ledger.md` path) must have a registered project, or `GET` is 400, not the 200 that the case expects. The same applies to `gl-group5` in line 195. — Say "register one `makeRepo` project with `group: 'gl-groupN'`" in each case.
- [Page-function test detail] Plan line 207: "The `md` stub returns the `CUR_ISSUES` it sees". A stub passed as a `new Function` parameter cannot see a `let CUR_ISSUES` declared inside the function body. — Define the `md` stub and `let CUR_ISSUES` in the same body text, and return a getter for `CUR_ISSUES` next to `checklistHtml`.
- [planStep rule order] `closed` (PR CLOSED and not `live`) comes before `running`. A relaunch after a closed PR (`launch.state === 'starting'`, `live` still false) shows "closed", not "running". The Board's `boardCol()` (`app.js:4837-4842`) has no closed column and shows it as running. — Make `closed` require `!p.live && p.launch?.state !== 'starting'`, and add a unit case.
- [Data dropped] `buildChain()` maps `waits` to `{ text, met }` and drops `error` (`/api/state` has `{ text, met, error }`, `server.mjs:2110`, `:2223`). A typo such as "unknown project" then shows only `✗` with no reason. — Keep `error` in the row and show it in the title or after the ✗.
- [Repaint while the select is open] `renderChecklist()` runs on every tick (each second during fast ticks, `app.js:5474-5478`). When the answer changes (a run moves), it repaints and closes an open `#ckGroup` dropdown. The plan guards only against a text selection. — Also skip the repaint while `#ckGroup` has focus.
- [Docs/UI text] `page.html:7`: the `#hdmenuBtn` title lists the ⋯ items ("Board, Scout, QA reports, Add project, Settings, alerts and theme"). The plan does not add "Checklist". — Add it in step 9.
- [Context accuracy] Plan line 33 says the owner's 3A example said `state/groups/<group>/`. The parent plan now records 3A as `~/.claude/pipeline-dashboard/groups/<group>/ledger.md` (`.plans/20261123-100855-orchestrator-parent.md:76`). — Remove the stale note or reword it. The plan and the parent agree.
- [Public repo, carried over from round 1 F21] `scripts/pipeline-projects.example.json` still has `"client": "Galileon"` and `~/Workspace/galileon/...` paths. The plan edits this file (step 17). This is outside the plan's goal, so it is still the owner's call. The run report should name it again.

### Edge cases the plan should address

- A cut 3-byte or 4-byte character at the 256 KB limit. The B1 fix with one leading ASCII byte covers the 2-byte case. `StringDecoder` covers all of them.
- The first `/api/ledger` read before the PR list is loaded. The page shows "planned" for one tick. That is acceptable in the UI, but the tests must wait (B2).
- A `ledger.md` that holds a `#41`. It is not linked (`CUR_ISSUES = ''`). That is intended, and the docs should say so in one line.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (`resolveProject` `server.mjs:192`, `cleanEntry` `:916`, `listPlans` `:564` with `let title = slug` at `:611`, `fullState` `:635` with `client: proj.client` at `:642`, `buildStateBody` `:676`, `openFolderInVsCode` `:1320`, `/api/events` `:3438`, `/api/scout/run` `:3546` before the guard at `:3548`, `/api/pr-refresh` `:3583` after it; `app.js` `SCOUT_TITLE` `:4979`, `openScout` `:4991`, `renderScout` `:5041`, `[data-sopen]` `:5160`, `scoutBtn` handler `:5184`, `PALETTE_ACTIONS` `:4683`, `window.dashboard` `:4809`, `if (logKey) loadLog();` `:4426`, `selectionIn` `:121`, `BT` `:27`, `CUR_ISSUES` `:31`, `keep` pattern `:4871`; `main.swift:314`, `:375`; `build.test.mjs:67-78`; harness helpers `watcher.test.mjs:78`, `:114`, `:127`, `:131`, `:137`, `:146`, `:158`)
- [x] Reference implementation mirrored, deviations justified (one layout gap: the `.setup` wrapper, non-blocking)
- [x] Breaking changes for changed symbols listed (consumer search done: `/api/state` is also fetched by `restart.mjs:54` and `scripts/docs-media.mjs:227`, which only check `.ok`; nothing breaks)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 403 / no-match per endpoint (no login, so no 401, owner 4A; an unknown group is 400 `bad group`, like `bad project`)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (the existing Galileon line is outside the plan)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (B1: one case cannot fail; B2: two flaky assertions)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-195706-groups-ledger-checklist.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In Tests → End-to-end "Ledger text", change the multi-byte case so the 256 KB cut falls inside a character: write 'a' + 'é'.repeat(150000) (300001 bytes), and expect truncated: true, no U+FFFD in text, and Buffer.byteLength(text) === 262143. Optionally, in step 6, decode with StringDecoder from node:string_decoder (a built-in), whose write() holds back an incomplete last character. (evidence: plan line 194; 262144 is even, so 2-byte characters are never cut and the current case passes without the fix)
2. In Tests → End-to-end "The chain from two repos" and "The chain follows a merge", wait for the PR list before the first assertions: use until() until the row has pr.number 7 (or 8), or call seen('gl-api') / seen('gl-merge') first. (evidence: apps/dashboard/server.mjs:1547-1551, prsFor() returns {} and loads the list in the background on first use; :601 pr: prOf(slug))

SHOULD FIX:
1. In step 11, wrap the whole checklistHtml() output in <div class="setup sc">, like renderScout(). (evidence: apps/dashboard/page/app.css:308 #logbody is white-space:pre-wrap; app.js:5053; app.css:310)
2. In step 8 / End-to-end tests, unregister the gl-* projects at the end, as every other case does, and do not make later cases depend on the projects of an earlier case. (evidence: apps/dashboard/test/watcher.test.mjs:251, :269, :869)
3. In the End-to-end cases for gl-group4 and gl-group5, register one makeRepo project with that group before the calls. (evidence: plan lines 194-195; ledgerState() returns 400 for a group that no project has)
4. In Tests → Page function, define the md stub and let CUR_ISSUES in the same new Function body text, and return a getter for CUR_ISSUES. (evidence: plan line 207; a parameter stub cannot see a let declared in the body)
5. In step 2 planStep(), make closed also require p.launch?.state !== 'starting', and add a unit case "PR CLOSED and launch starting → running". (evidence: apps/dashboard/page/app.js:4837-4842 boardCol)
6. In step 2 buildChain(), keep error in each waits item and show it in checklistHtml() after the ✗. (evidence: apps/dashboard/server.mjs:2110, :2223)
7. In step 11 renderChecklist(), also skip the repaint while #ckGroup has focus. (evidence: apps/dashboard/page/app.js:5474-5478, ticks every second during fast mode)
8. In step 9, add "Checklist" to the #hdmenuBtn title in page.html. (evidence: apps/dashboard/page/page.html:7)
9. In Context, remove or reword the "Path detail" note: the parent plan already records 3A as ~/.claude/pipeline-dashboard/groups/<group>/ledger.md. (evidence: .plans/20261123-100855-orchestrator-parent.md:76)

ADD THESE EDGE CASES:
- A cut 3-byte or 4-byte UTF-8 character at the 256 KB limit (covered when StringDecoder is used).
- A #41 in ledger.md is not linked: say so in one line of the docs section.

Do not change anything the validation did not flag.
```
