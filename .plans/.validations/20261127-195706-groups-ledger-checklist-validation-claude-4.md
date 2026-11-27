**Validation round:** 4

## Plan validation: 20261127-195706-groups-ledger-checklist.md

**Verdict:** APPROVE WITH CHANGES

The round 3 fixes are correct and complete. One new display defect remains in `renderChecklist()`: after the no-group view, a group that comes back with the same answer is never painted. There are also five smaller points.

### Round 3 fixes checked

- R1 `renderChecklist(byUser)`: the focus guard applies only when `!byUser`. Open, change and edit call `renderChecklist(true)`, and `refreshOnce()` calls `renderChecklist()` (plan step 11, step 12). Correct.
- F1 `ckGen`: `gen = ++ckGen` is taken right after the first `showing()` check and before every other return, including the no-pick return. After the `await`, `gen !== ckGen || !showing()` drops the answer. Correct.
- R2 `isFileSafe()`: when a file is at `groups/<g>`, `mkdirSync(dirname, { recursive: true })` fails with `EEXIST`, `statSync(groups/<g>/ledger.md)` fails with `ENOTDIR`, and the helper returns false, so the result is `{ ok: false }` and not a 500. When a folder is at the `ledger.md` path, `writeFileSync(…, { flag: 'wx' })` gives `EEXIST` and the helper returns false, so `{ ok: false }`. `ledgerState()` uses the same helper for `exists`. Correct. The server's global catch is at `apps/dashboard/server.mjs:3594`.
- F5 `CLEANED` rule: `planStep()` uses the same rule as `runningCount()` (`apps/dashboard/watch.mjs:97-101`), and `outcomeOf()` gives `running` for an unknown status (`server.mjs:405-407`). A `CLEANED` or `unknown` report counts as no run. Correct.
- F3 independent E2E cases: each case has its own projects. "Bad groups" sends a 403 GET for `gl-group`, which another case owns. `crossSiteReason` runs before routing (`server.mjs:3355-3356`), so the result does not depend on that case.
- F4 `code.log`: `openFolderInVsCode()` calls `execFile('code', …)` without waiting (`server.mjs:1320-1325`). `until()` is used for a new line and `ticks(2)` before each "no new line" check. Correct. `ENV.PATH` starts with `process.env.PATH` (`server.mjs:156-157`), and `envFor()` puts `bin` first (`watcher.test.mjs:86`), so the fake `code` runs.
- F8 browser setup: `FAKE_GH` reads `$FAKE_GH_DIR/<basename of cwd>/list.json` (`watcher.test.mjs:36,45`), and `gh` runs with `cwd: proj.root` (`server.mjs:1486`), so `<tmp>/gh/acme-api/list.json` is the right place. Correct.
- The `é` truncation numbers: 1 + 300000 bytes, cut at 262144. The last byte is the lead byte of a 2-byte character, and removing the one `U+FFFD` gives 262143 bytes. Correct.

### Blocking issues

- [Edge case / wrong data on screen] The no-group paint does not reset the repaint key `_ck`. If a group comes back with the same answer, it is never painted, and the drawer stays on "No group yet". — Plan line 161: "With no `pick`, paint `checklistHtml(null, [], null)` and return". `_ck` is cleared only on open, on a change, on an edit and on an error. — Sequence:
  1. Group `acme-product` shows: `_ck = 'acme-product|acme-product|<text>'`.
  2. The owner removes the group (in another tab, or in the registry file). The next tick paints "No group yet", and `_ck` keeps the old key.
  3. The owner adds the group again. The next tick computes the same key and returns without a repaint, because the key equals `_ck`.
  4. The drawer says "No group yet" while a group exists, until the owner closes and opens the drawer.
  
  — Fix: in the no-pick branch, set `byId('logbody')._ck = null` before the paint. Or store a fixed key such as `'∅'`, compare it like the normal key, and skip the paint when it is equal (this also stops a repaint every 5 s that drops a text selection). Add the "remove, then add back" sequence to Browser test 3c.

### Non-blocking concerns

- [Browser test] Step 3c cannot be done as written. "Give `acme-e2e` a new group in ⚙ Settings while the drawer is open" is not possible, because Settings opens in the same `#logpane` and replaces the drawer title (`apps/dashboard/page/app.js:3461-3465`, `byId('logtitle').textContent = '⚙ settings — projects'`). When Settings is open, the checklist is not showing. — Make the Settings change in a second browser tab on port 4911, or edit `<tmp>/home/.claude/pipeline-projects.json` by hand, while the first tab keeps the checklist open.
- [Reference deviation accuracy] "no second build of every plan list" is not true in all cases. `buildStateBody()` shares a build only while it is less than `STATE_CACHE_MS` old, counted from the start of the build (`server.mjs:678`, default 1000 ms, `server.mjs:1817`). The page asks `/api/ledger` only after `/api/state` has returned and the page has painted (`refreshOnce()` ends with `if (logKey) loadLog();`, `app.js:4426`). So when a build takes about 1 s or more, every 5 s tick with the drawer open starts a second full build. — Correct the sentence. Or let `ledgerState()` use the last finished build when it is less than one tick old. Or accept the cost and say so.
- [Escaping] Step 11 says that `checklistHtml()` "uses only `esc`, `escA`…" but does not say which values go through `escA`. A repo-less ticket URL comes from `issuesUrl`, which comes from the git remote. The remote regex `[^/\s]+?` (`server.mjs:184`) and the `ticketKey()` regex `[^/]+` both let a `"` through. — Say that every attribute value goes through `escA()`: `data-sopen`, the ticket `url` and the PR `url`. Add one page-function case with a `"` in a URL.
- [Browser test / data] The test-dashboard command has no `DASH_NO_SUMMARY=1`. The server then sends the made-up plans to the `claude` CLI for summaries (`server.mjs:53,77-79`; `docs/plans-dashboard.md:387`). — Add `DASH_NO_SUMMARY=1` to the command.
- [Tests] The `ledger.error` path (the file exists but cannot be read) has no end-to-end case. Only the page-function case covers it. — Add a `chmod 0o000` ledger case that expects 200 with `exists: true`, `text: ''` and an `error` that starts with `Cannot read the ledger:`. Skip it when `process.getuid() === 0`, and restore the mode in a `finally`.
- [Context] New evidence for the round 2 F14 rejection. The parent plan's 3A now gives the same path as this plan, `~/.claude/pipeline-dashboard/groups/<group>/ledger.md` (`.plans/20261123-100855-orchestrator-parent.md:76`). The "Path detail" note says that the owner's example was `state/groups/<group>/`, which the parent no longer says. — Shorten the note to the reason only (`state/<name>/` belongs to a project called `<name>`), or remove it.

### Edge cases the plan should address

- Remove a group, then add it back with an unchanged ledger. Without the B1 fix, the drawer stays on "No group yet".
- A project registered less than `STATE_CACHE_MS` ago. `GET /api/ledger` reads the cached state and can answer 400 `bad group`. `POST /api/ledger/open` reads the registry (`allProjects()`) and accepts the same group. This is harmless, because the page takes groups from the same state, but the docs could say that a new group shows at the next refresh.
- A slow `/api/state` build (see the deviation concern above): the cost of a second build every 5 s while the drawer is open.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated. Checked: `resolveProject`, `cleanEntry`, `listPlans` (active and archived rows), `fullState` (`client: proj.client`), `buildStateBody`, `openFolderInVsCode`, `openInVsCode`, `STALE_RUN_MS`, `tilde`, `CENTRAL`, the `/api/events` and `/api/scout/run` placement, the guard at `server.mjs:3548`, `/api/pr-refresh` after the guard; in `app.js`: `openScout`, `renderScout`, `SCOUT_TITLE`, the `scoutBtn` handler, `PALETTE_ACTIONS`, `menuHook`, the tour text, `selectionIn`, `CUR_ISSUES`, `inline`, `md`, `projPill`, `escA`, the `data-f="client"` input; `page.html` `#scoutBtn` and the `#hdmenuBtn` title; `main.swift:314,375`; `build.test.mjs:67-78`; the `watcher.test.mjs` helpers
- [x] Reference implementation mirrored, deviations justified (one inaccurate claim, non-blocking)
- [x] Breaking changes for changed symbols listed (consumer search done: no test compares the full `/api/state` keys; `copyDashboard()` copies all of `apps/`, so the new `groups.mjs` is copied too)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 403 / unknown group per endpoint. There is no 401 (no login, 4A) and no tenant scope.
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (the existing example registry line was raised before, round 1 F21)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no contract source exists)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-195706-groups-ledger-checklist.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 11, renderChecklist(): in the branch with no pick, set byId('logbody')._ck = null before you paint checklistHtml(null, [], null). Or store a fixed key such as '∅', compare it like the normal key, and skip the paint when it is equal. Reason: after "No group yet", a group that comes back with the same answer gives the old key again, and the drawer never repaints. Add "remove the group, then add it back" to Browser test 3c. (evidence: plan line 161; the key rule in the same step)

SHOULD FIX:
1. Browser test 3c: make the Settings change in a second browser tab on port 4911, or edit <tmp>/home/.claude/pipeline-projects.json by hand, while the first tab keeps the checklist open. Settings opens in the same #logpane and replaces the checklist. (evidence: apps/dashboard/page/app.js:3461-3465)
2. Reference implementation → Deviations: correct "no second build of every plan list". buildStateBody() shares a build only for STATE_CACHE_MS (default 1000 ms) from its start, so the /api/ledger call after the page paint can start a second full build. Either reuse the last finished build in ledgerState(), or state the cost. (evidence: apps/dashboard/server.mjs:678, 1817; app.js:4426)
3. Step 11: say that every attribute value in checklistHtml() goes through escA(): data-sopen, the ticket url and the PR url. Add a page-function case with a '"' in a URL. (evidence: server.mjs:184 issuesUrl regex lets '"' through)
4. Browser test → Account and data: add DASH_NO_SUMMARY=1 to the test-dashboard command, so the made-up plans are not sent to the claude CLI. (evidence: server.mjs:53, docs/plans-dashboard.md:387)
5. Tests → End-to-end "Ledger text": add an unreadable ledger case (chmod 0o000; skip when process.getuid() === 0; restore the mode in a finally). Expect 200 with exists: true, text: '' and an error that starts with "Cannot read the ledger:".
6. Context → Path detail: the parent's 3A now names ~/.claude/pipeline-dashboard/groups/<group>/ledger.md. Remove the sentence about the owner's state/groups/ example, and keep only the reason. (evidence: .plans/20261123-100855-orchestrator-parent.md:76)

ADD THESE EDGE CASES:
- A group is removed and then added back with an unchanged ledger (the B1 sequence).
- A project registered less than STATE_CACHE_MS ago: GET /api/ledger can answer 400 for a moment while POST /api/ledger/open accepts the group. The group shows at the next refresh.

Do not change anything the validation did not flag.
```
