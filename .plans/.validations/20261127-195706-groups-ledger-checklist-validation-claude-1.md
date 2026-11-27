**Validation round:** 1

## Plan validation: 20261127-195706-groups-ledger-checklist.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues

- [Wiring / discrepancy] Step 7 puts `POST /api/ledger/open` "in the POST block, next to `/api/vscode`". `/api/vscode` is at `apps/dashboard/server.mjs:3575`, which is after the guard `if (!proj || !safeName(b.slug)) return json(res, 400, { error: 'bad request' });` at `server.mjs:3548`. A body `{ group }` has no `project` and no `slug`, so the route never runs: each call gets 400 `bad request`. The Wiring table says "it needs no `proj`", which contradicts the step. — Fix: put the route before line 3548, next to `/api/vscode-dash` (`server.mjs:3529`) or `/api/scout/run` (`server.mjs:3546`), and say so in step 7 and in the Wiring table.
- [Logic / discrepancy] Step 12 adds `renderChecklist();` "after `renderBoard();`" in `refreshOnce()`. That `renderBoard()` (`apps/dashboard/page/app.js:4415`) is inside `if (raw !== lastStateRaw && …)` (`app.js:4373`), so it runs only when `/api/state` changed. An edit of `ledger.md` does not change `/api/state`. So the drawer does not show the new goal "at the next refresh (5 s)" (Goal step 5, Browser test step 3). — Fix: call `renderChecklist()` on every tick, after the changed-state block (for example just before the end of `refreshOnce()`). The `_ck` dedupe and the `selectionIn()` guard already stop needless repaints.
- [Logic] Step 11 stores the last response text in `byId('logbody')._ck` and skips the repaint when the text is the same. It clears `_ck` only on a group change and after ✎ Edit. `openChecklist()` (like `openScout()`, `app.js:4991-4997`) sets `#logbody` to "loading…". Scout, Settings and the log also write into `#logbody` and never clear `_ck`. Close the checklist, open it again (or go Checklist → Scout → Checklist): the response equals the old `_ck`, nothing repaints, and the drawer stays on "loading…". — Fix: `openChecklist()` clears `byId('logbody')._ck` before it calls `renderChecklist()`. Add this to the Browser test (close and open again with no change).
- [Tests] E2E "The chain follows a merge" calls `POST /api/pr-refresh` with `{ project: 'gl-merge' }`. That route is after the `safeName(b.slug)` guard (`server.mjs:3548`, `3583`), so it returns 400 and the PR list is not read again. `PR_TTL` is 60 s (`server.mjs:1482`), so `until()` (15 s, `watcher.test.mjs:114`) times out. The page sends `{ project, slug }` (`app.js:1867-1868`). — Fix: send `{ project: 'gl-merge', slug: '20261127-120000-merge-me' }`.
- [Tests] E2E "Settings keep the group" posts `/api/registry` with only the `gl-api` entry and one `a/b` entry. The route replaces the whole registry with the posted list (`server.mjs:3512-3523`, `saveRegistry(cleaned)`). On the shared server this removes every project that the earlier cases registered (`register()` appends to the file, `watcher.test.mjs:127`), so later cases and their watcher ticks see a different world. — Fix: post `registry()` (all current entries) with `group: 'gl-group'` set on `gl-api`, plus one new entry with `group: 'a/b'` and a real root; assert on the saved file; or run this case last and restore the registry after it with `writeFileSync(regFile(), …)`.

### Non-blocking concerns

- [Tests] "Bad groups" asserts that "no folder `groups/..` exists". `path.join(LEDGER_DIR, '..')` is `~/.claude/pipeline-dashboard`, which exists, and `existsSync('<…>/groups/..')` without a join depends on whether `groups/` exists. The check is fragile, or it fails for the wrong reason. — Assert that `~/.claude/pipeline-dashboard/ledger.md` does not exist and that `groups/nobody` does not exist.
- [Tests] The page-function case uses "the real `esc`, `escA` and `inline` lines". `inline()` reads `BT` and `CUR_ISSUES` (`app.js:177`, `app.js:183`). Without them the cut function throws. — Add `const BT = …` (the `line('const BT =')` pattern of `dashboard.test.mjs:324`) and `const CUR_ISSUES = ""`.
- [Logic] `renderChecklist()` checks `CHECK_TITLE` only before the fetch. `renderScout()` checks again after its await (`app.js:5042-5045`). Without the second check, a slow `/api/ledger` answer paints the checklist over Scout or Settings. — Check `showing()` again after the fetch.
- [Logic] `md(d.ledger.text)` links `#41` to `CUR_ISSUES` (`app.js:183`), the issues URL of the plan that is open now, not of the group. — Set `CUR_ISSUES` to `''` around the call, or say that the ledger text does not link bare `#n`.
- [Logic] `parseTickets()` removes repeats by `repo` + `number`, but `#41` and `example/acme-api#41` in the same `acme-api` plan give the same key in `ticketKey()`. `buildChain()` then puts the same plan twice in one ticket. — Remove repeats by ticket key per plan in `buildChain()`, and add a unit case.
- [Logic] `ticketKey()` keeps the case of `repo`. `Example/Acme-API#41` and `example/acme-api#41` give two tickets; GitHub names are not case-sensitive. — Lowercase the repo part of the key (keep the URL as written), or note the limit in the docs.
- [Logic] A short form `acme-api#41` (no owner) does not match the repo group of the ticket regex (it needs `/`), so it is read as `#41` of the plan's own repo. A full issue URL on the `Tickets:` line gives `[]`. — Name both cases in the docs section and add unit cases, so the behavior is fixed by a test.
- [Logic] `renderChecklist()` does not say what happens when `/api/ledger` fails (server restart, 400 after the group was removed in Settings). `await r.json()` on a 400 gives `{ error }`, and `checklistHtml()` then reads `d.ledger.text` of `undefined`. — Show a one-line error in the drawer and keep `_ck` empty.
- [Tests] The 403 case covers only `GET /api/ledger`. — Also send `POST /api/ledger/open` with `Origin: https://evil.example` and assert 403 and no file.
- [Tests] Step 8's `gitRemote()` uses `execFileSync` directly. The file already has `git(cwd, …a)` with `GIT_ENV` (`watcher.test.mjs:78`). — Reuse `git(root, 'init', '-q')` and `git(root, 'remote', 'add', 'origin', …)`.
- [Public repo] `scripts/pipeline-projects.example.json:5` (the file that step 17 edits) has `"client": "Galileon"`, which may be a real client name, not made-up data. This is an existing line, not part of this plan. — The owner checks it; when it is a real client, the step changes it to a made-up name (for example `Acme`) too.
- [Breaking changes] `state-load.mjs compare` (`apps/dashboard/state-load.mjs:118`) will report a difference when one port runs the old code and one the new code (new `group` and `tickets` fields). The plan says only "two builds of the same code". — Add one line: a compare of an old and a new build shows these two fields as a difference.

### Edge cases the plan should address

- The drawer is closed and opened again with no change in the ledger or the state — it must not stay on "loading…" (blocking item 3).
- Every plan of a ticket is archived — the ticket disappears from the checklist (rule "an archived plan goes only into tickets that also have an active plan"). Say in the docs that a finished ticket leaves the list.
- The same ticket appears twice in one plan in two forms (`#41` and `owner/repo#41`) — one row, not two.
- A ledger file of more than 256 KB is cut in the middle of a multi-byte UTF-8 character — the last character becomes U+FFFD. Acceptable, but say it, or cut at the last newline.
- The group is renamed in Settings while the drawer is open — `checkGroup` is no longer in `groups`, so `pick` falls back to `groups[0]`; the old ledger folder stays on disk. Say this in the docs.
- `ledger.md` is a folder or cannot be read (permissions) — `ledgerState()` must give `exists: false` or an error field, not a 500.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`resolveProject`, `cleanEntry`, `listPlans`, `fullState`, `buildStateBody`, `openFolderInVsCode`, `tilde`, `CENTRAL`, `SCOUT_TITLE`, `openScout`, `renderScout`, `PALETTE_ACTIONS`, `menuHook`, `window.dashboard`, `selectionIn`, `#scoutBtn`, Swift `scout`, the doc sections, the template `Tickets:` line), except the two placements in blocking items 1 and 2
- [ ] Reference implementation mirrored, deviations justified (the `/api/vscode` placement and the `refreshOnce()` call site do not work as stated)
- [x] Breaking changes for changed symbols listed (consumer search done; one small note on `state-load.mjs compare`)
- [ ] Wiring & registration matches the code (POST route placement, blocking item 1)
- [x] Scope stays inside the goal; no open decision is taken silently (decisions 1A–4A are applied; phase 3/4 decisions are left open)
- [ ] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (403 only for GET; two E2E cases are wrong as written, blocking items 4 and 5)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (one existing line in the example file to check, non-blocking)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; the `Tickets:` format comes from the template)
- [x] "How to verify" commands are real and can fail (`npm test` globs `apps/*/test/*.test.mjs`, so `groups.test.mjs` runs; `changelog-validate.mjs` exists)

```
Update the plan at .plans/20261127-195706-groups-ledger-checklist.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Move POST /api/ledger/open before the guard `if (!proj || !safeName(b.slug)) return json(res, 400, …)` in the POST block, next to /api/vscode-dash or /api/scout/run, and say so in step 7 and in the Wiring table. Next to /api/vscode it is after the guard and always gives 400. (evidence: apps/dashboard/server.mjs:3548, 3575, 3529)
2. Call renderChecklist() on every refreshOnce() tick, after the "state changed" block, not after the renderBoard() inside it; otherwise an edit of ledger.md never shows. (evidence: apps/dashboard/page/app.js:4373, 4415)
3. In openChecklist(), clear byId('logbody')._ck before renderChecklist(), so a reopen (or Checklist → Scout → Checklist) repaints and does not stay on "loading…". Add this to the Browser test. (evidence: apps/dashboard/page/app.js:4991-4997)
4. In the E2E case "The chain follows a merge", send POST /api/pr-refresh with { project: 'gl-merge', slug: '20261127-120000-merge-me' }; without slug the route returns 400. (evidence: apps/dashboard/server.mjs:3548, 3583; apps/dashboard/page/app.js:1867-1868)
5. In the E2E case "Settings keep the group", post the full current registry (registry()) with the group change and one extra 'a/b' entry, or restore the registry after the case; POST /api/registry replaces the whole registry of the shared server. (evidence: apps/dashboard/server.mjs:3512-3523; apps/dashboard/test/watcher.test.mjs:127)

SHOULD FIX:
1. In "Bad groups", replace "no folder groups/.. exists" with: no file ~/.claude/pipeline-dashboard/ledger.md and no folder groups/nobody. (evidence: path.join(LEDGER_DIR, '..') is the dashboard folder)
2. In the page-function case, also cut the BT line and define CUR_ISSUES = "", because inline() reads both. (evidence: apps/dashboard/page/app.js:177, 183; apps/dashboard/test/dashboard.test.mjs:324)
3. In renderChecklist(), check again after the fetch that the drawer still shows CHECK_TITLE, like renderScout(). (evidence: apps/dashboard/page/app.js:5042-5045)
4. Render the ledger text with CUR_ISSUES set to '' (or say that bare #n is not linked), so #41 does not link to the open plan's repo. (evidence: apps/dashboard/page/app.js:183)
5. In buildChain(), put a plan at most once in each ticket (remove repeats by ticket key), and add a unit case with "#41, example/acme-api#41" in acme-api.
6. Lowercase the repo part of the ticket key (keep the URL), or name the case limit in the docs.
7. Say what renderChecklist() shows when /api/ledger fails or returns 400, and keep _ck empty then.
8. Add a 403 case for POST /api/ledger/open with Origin: https://evil.example (no file is written).
9. In gitRemote(), reuse the file's git(cwd, …) helper with GIT_ENV. (evidence: apps/dashboard/test/watcher.test.mjs:78)
10. Ask the owner whether "Galileon" in the example registry is a real client name; if yes, change it to a made-up name in step 17. (evidence: scripts/pipeline-projects.example.json:5)
11. In Breaking changes, add that state-load.mjs compare of an old and a new build shows the new group and tickets fields as a difference. (evidence: apps/dashboard/state-load.mjs:118)

ADD THESE EDGE CASES:
- The drawer is closed and opened again with no change: it repaints.
- Every plan of a ticket is archived: the ticket leaves the checklist (say it in the docs).
- One plan names the same ticket in two forms: one row.
- A ledger of more than 256 KB cut inside a multi-byte character.
- The group is renamed in Settings while the drawer is open: the pick falls back to the first group; the old folder stays.
- ledger.md is a folder or cannot be read: no 500.

Do not change anything the validation did not flag.
```
