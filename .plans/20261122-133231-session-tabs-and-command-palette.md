# Plan: Session tabs and the ⌘K command palette in the dashboard page

- **Base**: main
- **Parent**: .plans/20261122-151056-plans-mac-app-parent.md

## Goal

Each plan you open in the dashboard becomes a tab (a session) in a strip under the header, so you can work on several plans at once and switch between them from the keyboard. ⌘K opens a command palette that finds plans and runs the header actions. The page exposes these actions as `window.dashboard`, so the Mac app (the next plan) can call them from its menu shortcuts (⌘1–9, ⌘W, ⌘⇧T).

This is phase 1 of the parent plan "Plans Mac app" (`.plans/20261122-151056-plans-mac-app-parent.md`).

## Context

- Parent plan sections: `.plans/20261122-151056-plans-mac-app-parent.md` → Phases item 1 and "Decisions taken by the owner"; `docs/roadmap.md` → Architecture (Server, Page)..
- Decisions taken for this plan (owner, this session):
  - Release 1 of the Mac app is three plans: 1) page tabs + ⌘K palette + hooks (this plan), 2) the Mac app (Swift + WKWebView shell, menus, notifications with Allow / Deny, Dock badge, keep-awake, auto reload, "App update ready" bar), 3) the ⌘N "new session" sheet with its server work.
  - Tabs live inside the page (one page, one `/api/state` poll), the same in the browser and the app; not native window tabs.
  - Keys in the browser: Ctrl+1–8 go to tab 1–8, Ctrl+9 to the last tab, Ctrl+W closes the open tab, Ctrl+Shift+T opens the last closed tab, ⌘K (Ctrl+K off macOS) opens the palette.
  - Every plan you open becomes a tab. Closing a tab never stops an agent or a run: the plan stays in the sidebar and in the run strip.
- Design reference: the proposal page "Plans Mac app" (sections 3A, 4B, 5), saved in the owner's local QA store.
- Open decisions this plan does not take: the ⌘N sheet (plan 3), and everything native (plan 2).

## Hard rules

- **Restart after dashboard changes.** The plan changes `scripts/plans-dashboard/` (page.html, app.js, app.css). The login service runs the main checkout's `plans-dashboard.mjs` (the `__SCRIPT__` path in `scripts/launchd/com.plans-dashboard.plist.template`), not the run's worktree, so a restart during the run would serve the old code. The rule (reworded by the owner in this session: "A pipeline run in a worktree does not restart … its report lists the restart under Open items") applies where the change lands: the run report's Open items says "after merge and `git pull`: run `pgrep -fl chat-relay.mjs`; only when it shows that the live chats run under the relay, run `npm run restart`, then reload plans.test". The tests start their own server, as today.
- **No npm dependencies.** Plain JS and CSS in the existing files. No package, no CDN library.
- **Public repo: no private data.** Tests and docs use the existing test fixtures (project `demo`, plan `demo-plan`). No client or project names, no home paths.
- **Global rules affect every project.** Not touched: no change to the root `CLAUDE.md` or `skills/`.
- **Never stop processes by name.** The tests start and stop their own server as today (`before`/`after` in `scripts/test/plans-dashboard.test.mjs`). No `pkill`/`killall`.
- **Tests for logic changes.** The tab list logic and the palette match are pure functions in `app.js`, tested in `scripts/test/plans-dashboard.test.mjs` by slicing them out of the served page, as the test "an answer still arriving shows as Markdown, with no raw marks" does for `mdLive`. The `scripts/docs-media.mjs` fix gets its own test: step 17 moves the copy into an exported `copyDashboard(dest)`, and a new test copies the dashboard with it, starts the copy on its own port and checks that `/` answers with the page.
- **Docs: current state only.** `docs/plans-dashboard.md` gets a "Tabs and keyboard shortcuts" section in the present tense; the parent plan only marks phase 1 as built.

## Contracts

None. No server change, no new endpoint, no `/api/state` field. The page uses existing fields only (`key`, `slug`, `file`, `title`, `project`, `client`, `tags`, `live`, `chatWaits`, `run`, `launch`, `archived`, `pr`, and on worktree items `kind` and `agent`) through the existing helpers `find()`, `dotClass()`, `matchesQ()` and `projPill()`.

## Reference implementation

- Closest existing patterns:
  - The palette list and its keys: the chat `/` and `@` menu (`chatMenu()`, `chatMenuUse()`, `chatKey()` in `app.js`; `.cmenu` / `.cmi` in `app.css`).
  - The tab strip: the header Plan · PR / Files changed switch (`prTabs()`, `drawHdTabs()`, `#hdtabs`).
  - Opening a plan: the sidebar item click (`selected = key; renderList(); renderDetail(true);` in `renderList()`), and `goHome()`.
  - Saved per-viewer state: `collapsedProjects` / `saveCollapsed()` and the `dash-chat-open` key (`localStorage` in try/catch).
  - Page-function tests: "an answer still arriving shows as Markdown, with no raw marks" in `scripts/test/plans-dashboard.test.mjs`.
- Files read end to end: `scripts/plans-dashboard/page.html`; in `app.js`: `renderList()`, `itemHtml`, `dotClass`, `matchesQ`, `visiblePlans()`, `archivedMatches()`, `syncUrl()`, `readUrl()`, `renderDetail()` (start), `prTabs()`, `drawHdTabs()`, `toggleChat()`, `chatMenu()`, `chatMenuUse()`, `chatKey()`, the Escape keydown handler, `goHome()`, `applyView()`, `openBoard()`, `leaveBoard()`, `checkAlerts()`, `alertUser()`, `openFromAlert()`; in `app.css`: `body`, `header`, `.mainhd`, `#hdtabs`, `.dot`, `.cmenu`, `.cmi`; in the test file: the `get`/`post` helpers and the `mdLive` test.
- Mirror:
  - `chatMenu()` / `chatKey()` → `paletteDraw()` / `paletteKey()` (Arrow Up/Down move `.on`, Enter runs, mousedown picks; Escape belongs to the global key handler, step 12).
  - `.cmenu` / `.cmi` → `.palette` / `.pali` (same panel colors and row style, centered as a dialog).
  - `drawHdTabs()` → `drawSessionTabs()` (buttons with `data-` attributes, one bind per render).
  - `saveCollapsed()` → `saveTabs()` (`localStorage` key `dash-tabs`, try/catch).
  - The sidebar item click → `openSession(key)` = `selected = key; renderList(); renderDetail(true);`.
- Deviations:
  - The tab list is added in one place, `renderDetail()`, not at each place that sets `selected` (sidebar, run strip, board, alerts, URL, palette). Every one of them ends in `renderDetail()`, so one hook covers all, including future ones.
  - No "keeps running" toast when a tab with a running agent closes (the design showed one). The run strip and the sidebar dot already show the running plan, and the existing alert cards persist until closed, which is wrong for a passing note.

## Affected files

- `scripts/plans-dashboard/page.html` — modified: a `<nav id="stabs">` row between `header.mainhd` and `.wrap`; a hidden `<div id="palette">` dialog before `#toasts`.
- `scripts/plans-dashboard/app.js` — modified: the session-tabs block (pure functions + state + draw + keys), the palette block, the hook in `renderDetail()`, the `window.dashboard` object.
- `scripts/plans-dashboard/app.css` — modified: `#stabs` / `.stab` and `.palette` / `.pali` styles, in both themes through the existing variables.
- `scripts/test/plans-dashboard.test.mjs` — modified: the tests for the pure functions, one test that the page has `window.dashboard` and the two new elements, and the `copyDashboard` test.
- `docs/plans-dashboard.md` — modified: a "Tabs and keyboard shortcuts" section after "Board".
- `.plans/20261122-151056-plans-mac-app-parent.md` — modified: phase 1 marked as built (step 1).
- `scripts/docs-media.mjs` — modified: `copyDashboard(dest)` copies the whole `scripts/` folder (without `scripts/test/`), so the throwaway dashboard can start; the run code is behind a main-module check (step 17).
- `changelog.d/<entry>.yml` — new: the release note, written by `/changelog-entry`.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `window.dashboard` (`switchSession`, `nextSession`, `closeSession`, `reopenSession`, `openSearch`) | `app.js`, session-tabs block | a global on `window` | the Mac app (plan 2) through `evaluateJavaScript`; the page's own keydown handler | none: `app.js` is inlined into `page.html` by `PAGE` in `scripts/plans-dashboard.mjs` (`<!--@JS-->`) |
| `#stabs`, `#palette` elements | `page.html` | — | `app.js` through `byId()` | — |

No new route, module or server wiring.

## Breaking changes

None. The URL format (`?sel=&tab=&file=&view=`) stays the same; `syncUrl()` / `readUrl()` do not change. The search box `#q` keeps its job. No existing key changes: Escape keeps its order (the palette closes first when open), and no page handler uses Ctrl with a digit, W or Shift+T today (`grep -n "ctrlKey" scripts/plans-dashboard/app.js` shows the chat history arrow check in `chatKey()`, the Mermaid viewer's wheel zoom, and the modifier check on the `#home` link click).

Known limits, written in the docs: ⌘K inside the Monaco diff editor opens the palette (Monaco's ⌘K chords are not used in the read-only diff); two browser windows share one `dash-tabs` list, and the last change wins; Back / Forward to a closed plan opens it as a tab again, as any open does; macOS can take Ctrl+1–9 when "Switch to Desktop N" is on in System Settings → Keyboard Shortcuts → Mission Control; on Windows and Linux browsers keep Ctrl+1–8, Ctrl+W and Ctrl+Shift+T for themselves, so there only ⌘K's twin Ctrl+K and clicks work.

## Steps

1. `.plans/20261122-151056-plans-mac-app-parent.md`, Phases → item 1: change "**Session tabs and the ⌘K palette (page)**" to "**Session tabs and the ⌘K palette (page)**, built", so the parent plan shows the phase as done. Nothing else in the parent plan changes.
2. `page.html`: add `<nav id="stabs" aria-label="Open plans" hidden></nav>` right after the closing `</header>` of `header.mainhd` (the first `</header>` in the file; the second one belongs to `#logpane`), and `<div id="palette" class="palette" role="dialog" aria-modal="true" aria-label="Command palette" hidden><input id="palq" type="search" autocomplete="off" spellcheck="false" aria-label="Search plans and actions" placeholder="Search plans and actions…"><div id="pall" role="listbox"></div></div>` right before `<div id="toasts"`.
3. `app.js`, new block that starts with the line `// --- session tabs ---` (before the board code, `let boardOn = false;`); its pure functions come first and end with the line `// --- end session tabs ---`, so the test can cut them out. The pure functions:
   - `tabsOpen(tabs, key)` → the list with `key` added at the end when it is missing (same list when present).
   - `tabsClose(tabs, key)` → `{ tabs, next }`: the list without `key`, and the key to show next (the tab to its right, else to its left, else `null`). A `key` not in the list gives the same list and `next: null`.
   - `tabAt(tabs, n)` → the key of tab `n` (1-based); `n === 9` gives the last tab; out of range gives `null`.
   - `tabStep(tabs, key, d)` → the key `d` places from `key` (`d` = 1 or -1), with wrap-around; a `key` not in the list gives the first tab (or `null` for an empty list).
   - `tabsPrune(tabs, known, projects)` → the list without the keys that are not `known(key)` while their project (the part before the first `/`) is in `projects`. A key whose project is missing from `projects` stays, so a project that is missing from one state answer keeps its tabs.
   - `tabsShown(tabs, known)` → the keys for which `known(key)` is true, in order. The strip, the key hints, `switchSession`, `nextSession` and the next tab after a close all use this list, so a hidden key never gets a number.
   - `tabsLoad(raw)` → a clean list from the saved JSON text: only strings, no duplicates, order kept; bad JSON or a non-array gives `[]`.
   - `closedPush(closed, key)` → the closed-tab stack with `key` on top, an older copy of `key` removed, at most 10 keys.
4. `app.js`, same block, after the end marker: the state. `let sessionTabs = tabsLoad(<localStorage 'dash-tabs'>)` (the read in try/catch), `closedTabs = []` (in memory), `saveTabs()`, `shownTabs = () => tabsShown(sessionTabs, (k) => !!find(k))`, and `const IS_MAC = /Mac/.test(navigator.platform)` (used by the hints in step 5 and the palette key in step 12).
5. `app.js`, same block: `drawSessionTabs()`. For each key of `shownTabs()` (a plan or a worktree item, as the sidebar opens both), one `<div class="stab" role="presentation">` with two sibling controls (no button inside a button): `<button class="stabgo" data-go-tab="${escA(key)}">` with the dot (a worktree item: `p.agent === 'working' ? 'live' : ''`, as `wtItemHtml` does; a plan: `p.chatWaits ? 'warn' : dotClass(p)`), `projPill(p.project)`, `esc(p.file)` and, on macOS only (`IS_MAC`, step 12), the key hint (`⌃1`–`⌃8`, the last tab `⌃9`; no hint after the 8th tab except on the last), and `<button class="stabx" data-close-tab="${escA(key)}" aria-label="Close tab">×</button>` (keys go through `escA()`, as `wtItemHtml` and the board cards do). `class="on"` on the `.stab` and `aria-current="true"` on its `.stabgo` for the tab of `selected`. `#stabs.hidden = !shownTabs().length`. A click on `.stabgo` calls `openSession(key)`; a click on `.stabx` calls `closeSession(key)`.
6. `app.js`, same block:
   - `openSession(key)`: return when `key === selected` (as `openFromBoard()` does, so a key on the open tab does not reload it). Else `selected = key; renderList(); renderDetail(true);` and, when `boardOn`, `renderBoard()` too.
   - `closeSession(key = selected)`: return when `key` is `null` or not in `shownTabs()`. Else take `next` from `tabsClose(shownTabs(), key)`, remove `key` from `sessionTabs`, `closedTabs = closedPush(closedTabs, key)`, `saveTabs()`. When `key === selected`: `openSession(next)`, or `goHome()` when `next` is `null`. When it was a background tab: keep `selected` and only `drawSessionTabs()`.
   - `reopenSession()`: pop `closedTabs` until a key that `find()` returns and that is not already in `sessionTabs` (drop the stale and the already-open keys on the way), then `openSession(key)`; nothing happens when none is left.
   - `switchSession(n)`: `tabAt(shownTabs(), n)`, then `openSession` when it is not `null`.
   - `nextSession(d)`: `tabStep(shownTabs(), selected, d)`, then `openSession` when it is not `null`.
7. `app.js`, `renderDetail()`: after `const p = find(selected); if (!p) return renderEmptyDetail();`, add `const was = sessionTabs; sessionTabs = tabsOpen(sessionTabs, p.key); if (sessionTabs !== was) saveTabs(); drawSessionTabs();` (`tabsOpen` returns the same array when the key is in it, so `dash-tabs` is written only on a change). In `renderEmptyDetail()` call `drawSessionTabs()` too, so no tab stays marked after `goHome()`.
8. `app.js`, `refreshOnce()`: after `renderList()` in the repaint branch, `const kept = tabsPrune(sessionTabs, (k) => !!find(k), state.map((s) => s.name)); if (kept.length !== sessionTabs.length) { sessionTabs = kept; saveTabs(); } drawSessionTabs();`. A tab goes away only when its project is in the state and the plan is not; a key of a missing project stays saved but is not shown or numbered (`shownTabs()`), and shows again when the project comes back. The dots follow the state.
9. `app.js`, new block that starts with the line `// --- command palette ---`, placed right after the session-tabs block, and both blocks go before the comment block that starts `// --- Board:` (so the Board comment stays with its code; the functions it calls are declarations or are set before the first `refresh()` call at the end of the file); the pure function comes first and ends with the line `// --- end palette match ---`. The pure function `paletteMatch(q, plans, actions, tabs)` → rows of `{ kind: 'plan', key }` or `{ kind: 'action', id }`, with at most 50 plan rows (the matching actions always come in full): the actions whose label matches `q` (via `matchesFields([a.label], q)`), then the plans that match `matchesQ(p, q)` (a key in `tabs` with no item in `plans` is skipped), sorted: keys in `tabs` first (in tab order), then not archived, then archived (newest `slug` first, as `archivedMatches()` sorts). An empty `q` gives the plans in `tabs` (tab order), then all actions. It reads no global except `matchesFields` and `matchesQ`. The caller passes `[...plans, ...wts]` (plan and worktree items, as the sidebar search finds both: `visiblePlans()` and `visibleWts()`; `matchesQ` reads `file`, `title`, `project`, `client`, `tags` and `pr`, which worktree items have) and `shownTabs()`. The 50-row cap counts plan rows only, so the actions always show.
10. `app.js`, palette block: the action list `PALETTE_ACTIONS`, an array of `{ id, label, keys, run, when }` (`when` is optional; the row shows only when it returns true). Each action calls the existing handler: Board (`byId('boardBtn').click()`), Scout (`byId('scoutBtn').click()`), Settings (`openSettings()`), Add project (`openGuide(1)`), Chat on/off (`toggleChat()`, only when `hasChat(find(selected))`), Plan tab and Files changed (`prTab[selected] = …; lastPrDraw = null; renderDetail(false);`, only when the open plan has a PR, as `bindPrTabs()` does), Close tab (`closeSession()`), Reopen closed tab (`reopenSession()`), Theme (`byId('themeBtn').click()`), Alerts on/off (`byId('alertBtn').click()`). Each row shows its key hint where one exists; the Ctrl hints (Close tab, Reopen closed tab) show only when `IS_MAC`, as the strip hints do.
11. `app.js`, palette block: `openSearch()` only selects the text in `#palq` when the palette is already open (so it keeps the focus target it remembered first); else it remembers `document.activeElement`, shows `#palette`, clears and focuses `#palq`, and draws; `paletteDraw()` fills `#pall` from `paletteMatch(byId('palq').value.toLowerCase(), [...plans, ...wts], PALETTE_ACTIONS.filter((a) => !a.when || a.when()), shownTabs())` with `.pali` rows (`role="option"`, `id="pali-<n>"`, `.on` and `aria-selected="true"` on the picked row, and `#palq` gets `aria-activedescendant="pali-<n>"` and `aria-controls="pall"`), or one `.pali.none` row "No matches" when the list is empty; `paletteKey(e)` mirrors `chatKey()`: Arrow Up/Down, Enter runs the row (a plan row → `openSession`; an action → its handler), Tab and Shift+Tab stay in `#palq` (`preventDefault()`), so the focus stays in the dialog. A mousedown on a row calls `preventDefault()` (as `chatMenu()` does, so `#palq` keeps the focus) and runs it. A mousedown outside the panel closes it. Running a row first calls `closeSearch(false)`, then the plan or the action, so the focus goes where the action puts it (a dialog, the chat box). `closeSearch(true)` (Escape, a click outside) hides `#palette` and puts the focus back on the remembered element when it is still in the page.
12. `app.js`: one `document.addEventListener('keydown', …, true)` for the global keys. The palette key is ⌘K on macOS and Ctrl+K elsewhere (`IS_MAC ? e.metaKey : e.ctrlKey`, with `e.code === 'KeyK'`) → `openSearch()`, also inside text boxes. The tab keys work also inside text boxes (on macOS, Ctrl with a digit, W or T types nothing): `e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey` with `e.code` `Digit1`–`Digit9` → `switchSession(n)`; the same check with `e.code === 'KeyW'` → `closeSession()`; `e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === 'KeyT'` → `reopenSession()`. Each handled key calls `preventDefault()`. The handler does nothing while an overlay is open: the onboarding guide (`#onb.open`), the tour (`tourStep >= 0`), the Mermaid full-screen viewer (`.mmdfull`), the image viewer (`.imgview`) or the selection dialog (`byId('seldlg').open`; it is a `<dialog>`). While `#palette` is open, the tab keys are off, and this handler owns Escape: it calls `closeSearch(true)`, `preventDefault()` and `stopPropagation()` (capture phase), so the other Escape handlers do not run; `paletteKey()` does not handle Escape.
13. `app.js`: `window.dashboard = { switchSession, nextSession, closeSession: () => closeSession(), reopenSession, openSearch };` at the end of the palette block.
14. `app.css`: `#stabs` (a single row under the header, `display:flex; gap:4px; padding:4px 20px; border-bottom:1px solid var(--line); overflow-x:auto; flex-shrink:0`), `.stab` (`display:flex`, like the header buttons; `.on` uses `var(--card)`), `.stabgo` and `.stabx` (plain buttons inside the tab), the `.stab .dot` size, `.palette` (fixed, centered at the top, `z-index:60`, above `#toasts` (40) and `#tourpop` (32), `width:min(560px, 92vw)`, `background:var(--panel)`, the `.cmenu` border and shadow), `.pali` (as `.cmi`, `.on` as `.cmi.on`). `#stabs[hidden], #palette[hidden] { display:none; }`, because the page has no global `[hidden]` rule and `display:flex` would override the attribute. Hide `#stabs` in review mode (`body.review #stabs { display:none; }`), as the header is.
15. `scripts/test/plans-dashboard.test.mjs`: the tests in **Tests** below.
16. `docs/plans-dashboard.md`: add "## Tabs and keyboard shortcuts" after "## Board": each opened plan becomes a tab; the key table (Ctrl+1–8, Ctrl+9, Ctrl+W, Ctrl+Shift+T, ⌘K on macOS / Ctrl+K elsewhere, Arrow keys, Enter, Esc in the palette); closing a tab never stops an agent; tabs are kept in the browser (`dash-tabs`); `window.dashboard` is the hook list for the Mac app; the known limits from **Breaking changes**.
17. `scripts/docs-media.mjs`: the throwaway copy of the dashboard in `newHome()` copies only `scripts/plans-dashboard.mjs`, but the server also reads `scripts/plans-dashboard/` (`UI_DIR`) and imports `artifact-copies.mjs`, `page-versions.mjs` and `chat-relay.mjs`. Add `export function copyDashboard(dest)` that runs `cpSync(path.join(REPO, 'scripts'), path.join(dest, 'scripts'), { recursive: true, filter: (src) => src !== path.join(REPO, 'scripts', 'test') && !src.startsWith(path.join(REPO, 'scripts', 'test') + path.sep) })`, and call it in `newHome()` in place of the `copyFileSync`. Add `const IS_MAIN = process.argv[1] === fileURLToPath(import.meta.url);` after the imports (the same check as `artifact-copies.mjs`; `fileURLToPath` is already imported). Guard every run-only side effect with it: the two top-level checks that call `process.exit(1)` (Chrome not found, no built-in `WebSocket`) become `if (IS_MAIN && …)`, and the run at the end of the file (`const b = await openChrome(); …; process.exit(0);`) goes inside `if (IS_MAIN) { … }`. The `process.on('exit', …)` cleanup stays: it only kills children and removes temp folders the run made. So a test can import `copyDashboard` on Node 18 and on a machine without Chrome. The screenshots are not made in the run: `node scripts/docs-media.mjs` needs Chrome and is not in the allow list, so the run report lists "(owner, by hand) `node scripts/docs-media.mjs`" under Open items.
18. Run `/changelog-entry` for the release note in `changelog.d/`.

## Tests

### Unit tests

All in `scripts/test/plans-dashboard.test.mjs`. They fetch `/` from the test server and cut the block between `// --- session tabs ---` and `// --- end session tabs ---` out of the page, as the `mdLive` test does. The palette test cuts `// --- command palette ---` to `// --- end palette match ---`, plus the helpers it calls as one block: from `const squash =` to the end of `const matchesQ =` (they span several lines, so cut from the first marker to the line `function visiblePlans() {`), with a stub `projLook = () => ({ short: '' })`. Plan fixtures carry `key`, `file`, `title`, `project`, `client`, `slug`, `tags: []` and `archived`; one fixture also has `pr: { number: 12, title: 'Fix login' }` for the `#12` case.

- `tabsOpen`: adds a new key at the end; a key already in the list keeps the list the same (no duplicate, no reorder).
- `tabsClose`: closing the middle of `[a, b, c]` gives `[a, c]` and next `c`; closing the last gives next `b`; closing the only tab gives `[]` and next `null`; closing a key not in the list gives the same list and next `null`.
- `tabAt`: `tabAt([a, b, c], 2)` is `b`; `tabAt([a, b, c], 9)` is `c` (last); `tabAt([a, b], 5)` is `null`; `tabAt([], 1)` is `null`.
- `tabStep`: from `c` in `[a, b, c]`, +1 gives `a` (wrap); from `a`, -1 gives `c`; from a missing key it gives `a`; an empty list gives `null`.
- `tabsPrune`: with projects `['demo']`, drops `demo/gone` (not known) and keeps `old/x` (its project is not in the list) and `demo/a` (known), in their order.
- `tabsShown` with `['old/x', 'demo/a', 'demo/b']`, where `old/x` is not known: gives `['demo/a', 'demo/b']`, so `tabAt(shown, 1)` is `demo/a` (the stale key at the front gets no number) and `tabsClose(shown, 'demo/a').next` is `demo/b`.
- `copyDashboard` (imported with `await import()` from `scripts/docs-media.mjs` after `process.env.CHROME = '/nonexistent'`, so the import fails without the `IS_MAIN` guard): copy into a temp folder, then the copy has `scripts/plans-dashboard/app.js`, `scripts/artifact-copies.mjs`, `scripts/page-versions.mjs` and `scripts/chat-relay.mjs`, and no `scripts/test/`; start the copied `scripts/plans-dashboard.mjs` with a throwaway `HOME`, a temp `CLAUDE_TMP`, a free `DASH_PORT` and a free `QA_REPORTS_PORT` (never the real 4899 / 4898), `DASH_NO_OPEN=1` and `DASH_NO_SUMMARY=1`, and `GET /` answers 200 with `id="stabs"`; stop it by its PID. (Today the copy has no `plans-dashboard/` folder and the server cannot start, so this fails without the fix.)
- `closedPush`: pushing `a` onto `['a', 'b']` gives `['b', 'a']` (no duplicate); the stack keeps the newest 10 keys.
- `tabsLoad`: `'["a","b","a",3]'` gives `["a","b"]`; `'{"a":1}'`, `'nope'` and `null` give `[]`.
- `paletteMatch`: an action matches by label ("boa" finds Board); a plan matches by file, project and `#<PR number>` (through `matchesQ`); a plan in `tabs` comes before an other match; an archived plan comes after a not-archived one; an empty query lists the plans in `tabs` in tab order, then the actions; with 60 open tabs and an empty query, the result has 50 plan rows and every action; a worktree item matches by its `file`.
- The page has `id="stabs"`, `id="palette"`, the rule `#stabs[hidden]`, and `window.dashboard = {` with the five names (this fails when the hooks are left out).

`closeSession()`'s two cases (the open tab moves to the next one; a background tab keeps the open plan) depend on `selected` and the DOM, so they are browser-test steps 3 and 4 below; their pure part (`tabsClose`'s `next`) is covered here.

### End-to-end tests

None: no endpoint changes. The keys and the strip are checked in the browser test.

### Harness constraints

`node --test` cannot press keys in a real page or check the layout. Those go to the browser test: the keys (Ctrl+digits, Ctrl+W, Ctrl+Shift+T, ⌘K), the focus in the palette, the strip in both themes and review mode.

## Browser test

- Routes: `/` (sidebar plan open), `/?view=board` (a board card open), `/?sel=<fake-repo>/20260101-000000-alpha` (a reload with a plan in the link). Review mode needs a plan with a PR, which the fixture has no safe way to make; step 11 checks the CSS rule instead.
- Siblings: every other way to open a plan must add a tab, because the hook is in `renderDetail()`: the board cards, a `?sel=` link on reload, and the palette (all three work with the fixture below). The run strip rows (`data-go`) and the alert cards (`openFromAlert()`) need a live run, which the fixture cannot make safely; they end in the same `renderDetail()`, so the test does not cover them separately.
- Account and data: no login. Start two instances with a throwaway `HOME`, as the profile notes say: the new code from the worktree (`DASH_PORT=4913`) and the old code from a `git worktree` of `origin/main` (`DASH_PORT=4911 QA_REPORTS_PORT=4912 DASH_NO_SUMMARY=1 DASH_NO_OPEN=1`). In that `HOME`, `~/.claude/pipeline-projects.json` registers one fake repo (`git init` in the throwaway folder) whose `.plans/` has three plan files: `20260101-000000-alpha.md`, `20260101-000001-beta.md`, `20260101-000002-gamma.md`, each `# Plan: <name>` and one line. The board and the run strip need no more data: every plan shows as a board card. Block `POST /api/launch*` and `/api/registry` with `page.route`. Stop both instances by their PIDs.
- What to compare, old against new, step by step: 1) Open alpha, beta and gamma from the sidebar: the new page shows three tabs, the old none. 2) Ctrl+2 opens beta. 3) With beta open, Ctrl+W closes it: gamma opens, and beta stays in the sidebar. 4) With gamma open, click × on alpha's tab: gamma stays open. 5) Ctrl+Shift+T brings alpha back: the strip is now gamma, alpha (alpha is added at the end). 6) ⌘K, type "gam", Enter: gamma opens; ⌘K, type "zzz": "No matches". 7) ⌘K, "board", Enter: the board opens; Ctrl+2 opens alpha in the board panel, and the board marks alpha. 8) With the focus on a tab button (not a text box), ⌘K, then Esc: the palette closes and the focus is back on that tab button; a second Esc closes the plan, as today. 8b) With the focus in the chat box or `#q`, ⌘K, then Esc: the focus is back in that box, and a second Esc does not close the plan (the existing Escape handler skips text boxes). 9) A reload keeps the tabs. 10) Make gamma's file a Mermaid block (```` ```mermaid ```` with `graph TD; a-->b`) in the fixture, open it full screen, press Ctrl+1: the tab does not change. 11) Both themes; the page has the rule `body.review #stabs`; with no tabs the strip takes no space. 12) Esc with alpha open closes the plan, as today: alpha's tab stays in the strip with no mark.

## How to verify

```bash
node --test scripts/test/plans-dashboard.test.mjs
npm test
grep -n "window.dashboard = {" scripts/plans-dashboard/app.js
grep -n "id=\"stabs\"" scripts/plans-dashboard/page.html
node .claude/scripts/changelog-validate.mjs --base origin/main
```
