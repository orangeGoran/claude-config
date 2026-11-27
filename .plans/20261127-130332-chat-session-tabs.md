# Plan: Session tabs in the plan chat

- **Base**: main

## Goal

The chat panel of a plan shows one tab for each session you can continue: the run's latest session and every copy that Fork made. A click on a tab switches the chat to that session, and the next message continues it. Today a copy is lost from the page as soon as you click New chat or fork again: its id stays only in `copies` in `ask/<slug>.json`. This plan serves the "Chats" line of `docs/roadmap.md` (Architecture); it belongs to no parent plan.

## Context

- Parent plan sections: none. `docs/roadmap.md` → the **Chats** bullet (chats run under `apps/dashboard/chat-relay.mjs`).
- Decisions taken for this plan (owner, 2026-11-27, after the mockup `http://localhost:4898/plans-dashboard/artifacts/2026-11-27-chat-session-switcher.html`):
  - 1C — the switcher is a row of session tabs inside the chat panel. The run tab replaces the **New chat** button.
  - 2A — tabs show the run's latest session and every copy. Older run sessions (before a resume) get no tab; they stay in the AI session history block.
  - 3B — no close button on a tab. The owner expects about one copy per plan.
- Open decisions this plan does not take: None.

## Hard rules

- **Restart after dashboard changes.** The plan changes `apps/dashboard/server.mjs` and `apps/dashboard/page/`. A pipeline run in a worktree does not restart; its report lists under Open items: after the merge and `git pull` in the main checkout, run `pgrep -fl chat-relay.mjs`, then `npm run restart`, but only when that shows that the live chats run under the relay.
- **No npm dependencies.** Plain Node built-ins on the server and plain JS/CSS on the page. No package is added.
- **Public repo: no private data.** Tests use the made-up ids `ses-mine`, `ses-copy`, `ses-probe` of the existing fake `claude` and the made-up `ses-gone`, `ses-nope`. No paths or names from a real project.
- **Global rules affect every project.** Not touched: no change to the root `CLAUDE.md` or `skills/`.
- **Never stop processes by name.** The end-to-end tests use the existing harness, which starts and stops its test dashboard by its own child process. A manual check uses the test-dashboard command from AGENTS.md **Commands** and stops it by its PID.
- **Tests for logic changes.** The new server logic (`chatTabs()`, `chatSwitch()`, the `bases` record in `chatOnLine()`) gets end-to-end cases, and the new page function `chatTabsHtml()` gets a page-function test, all in `apps/dashboard/test/dashboard.test.mjs`, run with `npm test`.
- **Docs: current state only.** `docs/plans-dashboard.md` → **Chat with the agent** → the **Fork** bullet is rewritten to describe the tabs as they are, one line per paragraph, ASD-STE100, no history.

## Endpoint access

| Endpoint | Method | Access |
| --- | --- | --- |
| `/api/chat/switch` | POST | Same as every `/api/*` POST of the dashboard: loopback only (`BIND` / `LOOPBACK` in `server.mjs`), refused with 403 for a cross-site request (`crossSiteReason()`), and 400 `bad request` for an unknown project or a bad slug (the shared guard `if (!proj \|\| !safeName(b.slug))` before the plan routes). No sign-in, no roles and no tenants: the dashboard is a local, one-user tool. No rate limit, as for `/api/chat/fork` and `/api/chat/new`. |

## Contracts

The project has no shared contract source. The page and the server share these JSON shapes:

- `GET /api/chat` (and the `state` event of the chat stream) → `chatState()` gets one new field `tabs`: an array of `{ id, kind, at, last }`, where `kind` is `'run'` or `'copy'`, `at` is the transcript file's mtime (ms), and `last` is the text of the last message you sent in that session, cut to at most 120 characters with `String(text).slice(0, 120)` (`''` when none). The run tab is first when a run session exists. Consumer: `chatState()` in `apps/dashboard/page/app.js`, which reads `st.tabs || []` so a page newer than the server does not throw.
- `POST /api/chat/switch` with body `{ project, slug, id }` → `{ ok: true }`, or `{ ok: false, output: <message> }` while the agent works or when `id` is not one of the tabs. An unknown session is a 200 with `ok: false`, not a 404, as for every `/api/chat/*` refusal (`chatRestart()` answers the same way); the only error statuses are the shared 400 and 403. Consumer: the tab row in `apps/dashboard/page/app.js`.
- `ask/<slug>.json` gets one new optional field `bases`: an object `copy id → base id`. Old files without it still load (`loadChat()` returns the parsed object as it is); a copy with no `bases` entry takes the run tab's id as its base, or its own id when there is no run tab.

## Reference implementation

- Closest existing pattern: Fork and New chat → `chatRestart()` in `apps/dashboard/server.mjs` and its routes `/api/chat/fork`, `/api/chat/new`; on the page the `cfork` / `cnew` buttons in `chatBind()` and their state in `chatState()` of `apps/dashboard/page/app.js`. The tab look mirrors the plan session tabs (`.stab`, `.stab.on` in `apps/dashboard/page/app.css`). The page-function test mirrors "the page: a sent slash command with args on new lines leaves the live area when the log has it" (`sentLanded`, extracted from `app.js` with a regex and `new Function`).
- Files read end to end (the chat parts): `apps/dashboard/server.mjs` → `loadChat()`, `saveChat()`, `followVscodeCopy()`, `rootChat()`, `planSessions()`, `sessionsIn()`, `transcriptDirFor()`, `readTranscript()` (cache `transcripts`, `TRANSCRIPTS_KEPT = 12`), `userItems()` (item `k: 'you'`), `clip()`, `chatTranscript()`, `chatHistory()`, `chatEmitState()`, `chatOnLine()`, `chatStart()`, `chatEnd()`, `chatRestart()`, `chatState()`, `chatStartedAt()`, the POST guard and the `/api/chat/*` routes; `apps/dashboard/page/app.js` → `chatBind()`, `chatState()`, `sentLanded()`; `apps/dashboard/page/app.css` → `button:hover`, `.chead`, `.cwho`, `.stab*`, the `[hidden]` rules; `apps/dashboard/test/dashboard.test.mjs` → `FAKE_CLAUDE`, the chat test that ends with the "Fork" / "New chat" blocks, the VS Code copy test, the scout Confirm test, the `bootstrap-upgrade` refusal test, the `sentLanded` page test; `docs/plans-dashboard.md` → **Chat with the agent**; `changelog.d/AGENTS.md`.
- Mirror:
  - `chatRestart(proj, slug, fork)` → `chatSwitch(proj, slug, id)` (same busy refusal text, same close of the open `claude`, same `saveChat` → `chatNotes.delete` → `chatEmitState` → `chatEmit(key, 'history', {})` order).
  - route `/api/chat/new` → route `/api/chat/switch`.
  - `cnew` button → `#ctabs` row painted by `chatTabsHtml()`; `.stab` / `.stab.on` → `.ctab` / `.ctab.on`; `#stabs[hidden]` → `.ctabs[hidden]`.
  - `a.copies` record in `chatOnLine()` → `a.bases` record next to it.
  - `sessionIdCache` (a cache keyed on size + mtime) → `tabLastCache` for the `last` text of a tab.
- Deviations:
  - The run tab calls `/api/chat/switch` with the run's id, not `/api/chat/new` — one click handler for all tabs. In a normal chat `chatSwitch()` on the run id sets `a.current = null`, which is what `chatRestart(…, false)` does. In a root chat (a confirmed scout proposal, `rootChat(proj, slug, a)`) it pins `a.current = { id, base: id, copy: false }` instead, because `chatStart()` starts a new session without `--resume` when a root chat has no `current`.
  - `/api/chat/new` and `chatRestart(…, false)` stay — the existing tests use them; only the page button goes.
  - The tab row is hidden when there is only one tab and that tab is the open session — a plan with no copy looks as it does today. When the open session has no tab (its transcript is gone), the row shows even with one tab, so the run tab stays reachable (New chat did that before).
  - A switch closes the open `claude` also while a background task runs (`bg > 0`, not busy), as Fork and New chat do today in `chatRestart()`; the refusal covers `busy` only.
  - The tabs are plain buttons with `aria-pressed`, not `role="tab"` — a tablist role needs `aria-controls` and arrow keys, which this small row does not need.
  - A `current` session that is neither the latest run session nor in `copies` gets `kind: 'copy'`, also when it is an older run session (`current.copy` is `false` for a VS Code copy too, so it cannot tell them apart). `chatEnd()` clears `current` when a run starts, so an older run session is `current` only in rare cases; one more "copy" tab there is accepted.

## Affected files

- `apps/dashboard/server.mjs` — modified: `chatOnLine()` records `a.bases`; new `tabLastCache` + `chatTabs()`; new `chatSwitch()`; `chatState()` returns `tabs`; new route `/api/chat/switch`.
- `apps/dashboard/page/app.js` — modified: new top-level `chatTabsHtml()`; `chatBind()` drops the `cnew` button and adds the `#ctabs` row with one click handler; `chatState()` paints the tabs and drops the `cnew` line.
- `apps/dashboard/page/app.css` — modified: `.ctabs`, `.ctabs[hidden]`, `.ctab`, `.ctab:hover`, `.ctab.on` rules after `.cwho`.
- `apps/dashboard/test/dashboard.test.mjs` — modified: new assertions in the chat test after the "New chat: back to the run's latest session" block; a switch-away case in the VS Code copy test; a new root-chat test; a new refusal test for `/api/chat/switch`; a new page-function test for `chatTabsHtml()`.
- `docs/plans-dashboard.md` — modified: the **Fork** bullet under **Chat with the agent** describes Fork and the session tabs.
- `changelog.d/20261127-chat-session-tabs.yaml` — new: the release note.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `chatSwitch()` | `apps/dashboard/server.mjs` | not exported (module-local, as `chatRestart()`) | same file | the POST route list after the shared `bad request` guard, next to `/api/chat/fork` and `/api/chat/new` |
| `chatTabs()`, `tabLastCache` | `apps/dashboard/server.mjs` | not exported | same file | called from `chatState()` and `chatSwitch()` |
| `tabs` field | `chatState()` return object | `GET /api/chat` and the `state` SSE event (both already send `chatState()`) | `chatState(st)` in `apps/dashboard/page/app.js` | none: the field rides on the existing state |
| `chatTabsHtml()` | `apps/dashboard/page/app.js`, top level | not exported (a plain page function) | `chatState(st)` in the same file; the test extracts it by regex | none |

## Breaking changes

- `chatState()` return object: one field added (`tabs`). Consumers: `apps/dashboard/page/app.js` → `chatState()`, and the tests that read `/api/chat` (`grep -n "/api/chat?" apps/dashboard/test/dashboard.test.mjs`), which compare picked fields only, so none breaks.
- The page's `#cnew` button is removed. Consumers (`grep -rln -e cnew -e chat/new -e chat/fork apps docs scripts skills test .claude`): `apps/dashboard/page/app.js` only for `cnew`. `/api/chat/new` keeps working.
- `ask/<slug>.json`: one optional field added (`bases`). No reader breaks.

## Steps

1. `apps/dashboard/server.mjs` → `chatOnLine()`: in the `if (ch.fork && a.current && j.session_id !== a.current.id)` branch, next to the `a.copies = …` line, add `a.bases = { ...(a.bases || {}), [j.session_id]: a.current.base };`.
2. `apps/dashboard/server.mjs`: after `chatRestart()`, add `tabLastCache` (a `Map` file → `{ key, last }`, where `key` is `size + ':' + mtimeMs`; when it holds more than 100 entries, delete the oldest) and `chatTabs(a, ps)` with a doc comment, where `ps` is the `{ wtPath, transcriptDir, sessions }` result of one `planSessions(proj, slug)` call that the caller already made (so the tabs add no extra scan of the transcript folder). `chatTabs()` builds the ids in this order, without repeats: `sessions.at(-1)?.id` as `kind: 'run'`; each id of `a.copies` as `kind: 'copy'`; `a.current?.id` as `kind: 'copy'` when it is in neither (a VS Code copy that `followVscodeCopy()` moved to). For each id it calls `statSync(path.join(transcriptDir, id + '.jsonl'))` inside `try`/`catch`; an id with no file (not written yet, deleted, or a copy of a root chat whose plan has since moved to a worktree, so the id belongs to another transcript folder) gets no tab. `at` is `st.mtimeMs`. `last` comes from `tabLastCache` when the key matches; else from the last item with `k === 'you'` of `readTranscript(file, wtPath).items`, `String(text).slice(0, 120)` (`''` when none), and is stored in `tabLastCache`. So a state event during a turn reads only the transcript that grew, which is the open session's, the one `chatHistory()` reads anyway; a copy that is not open does not change, so its `last` stays in `tabLastCache` and it does not push the open transcript out of the 12-file `transcripts` cache.
3. `apps/dashboard/server.mjs` → `chatState()`: replace its `planSessions(proj, slug).sessions.at(-1)` call with `const ps = planSessions(proj, slug)`, take `latest` from `ps.sessions.at(-1)`, compute `const tabs = chatTabs(a, ps)` (with the `a` it already loads through `followVscodeCopy()`) and return it as `tabs`, next to `latest` and `fork`.
4. `apps/dashboard/server.mjs`: after `chatTabs()`, add `chatSwitch(proj, slug, id)` with a doc comment, mirroring `chatRestart()`:
   - refuse with the same `{ ok: false, output: 'The agent is still working. Stop it or wait for the answer first.' }` when `ch && ch.busy`;
   - load the chat as `chatState()` does: `const a = followVscodeCopy(proj, slug, loadChat(proj, slug))`, `const ps = planSessions(proj, slug)`, `const tabs = chatTabs(a, ps)`, `const run = tabs.find((t) => t.kind === 'run')` (the run tab is found by `kind`, never by position: it is missing when the run's transcript is gone); when `id` is not the `id` of a tab, return `{ ok: false, output: 'This session is not a tab of this chat.' }`;
   - the open tab is `a.current ? a.current.id : run?.id`. When `id` is the open tab: set `a.fork = false` (a click on the open tab cancels a pending Fork), save, emit the state, return `{ ok: true }`, and do not close the open `claude`;
   - otherwise close the open `claude` as `chatRestart()` does. When the session you leave (`a.current?.id`) is a tab that is in neither `ps.sessions` nor `a.copies` (a VS Code copy), set `a.copies = [...(a.copies || []), that id]` and `a.bases = { ...(a.bases || {}), [that id]: a.current.base }` (an old chat file has no `bases`), so its tab stays;
   - for the run tab (`kind: 'run'`) set `a.current = rootChat(proj, slug, a) ? { id, base: id, copy: false } : null` (`rootChat()`, not the raw `a.root`: a root chat whose plan got a worktree is no longer a root chat, and `chatStart()` resets it on the next message); for a copy set `a.current = { id, base: (a.bases || {})[id] || run?.id || id, copy: true }` (with no run tab and no `bases` entry the copy is its own base); always set `a.fork = false`;
   - then `saveChat`, `chatNotes.delete(key)`, `chatEmitState(proj, slug)`, `chatEmit(key, 'history', {})`, return `{ ok: true }`.
5. `apps/dashboard/server.mjs`: in the POST routes, after the `/api/chat/new` line, add `if (url.pathname === '/api/chat/switch') return json(res, 200, chatSwitch(proj, b.slug, String(b.id || '')));`.
6. `apps/dashboard/test/dashboard.test.mjs`: add the server cases listed under **End-to-end tests** (the chat test, the VS Code copy test, the new root-chat test, the new refusal test). Run `node --test apps/dashboard/test/dashboard.test.mjs`.
7. `apps/dashboard/page/app.js`: add a top-level `function chatTabsHtml(tabs, on, busy) {` … `}` (closing brace at column 0, so the test regex finds it) with a doc comment. It returns `''` when `tabs.length < 2` and `tabs.some((t) => t.id === on)` (one tab, and it is open); else one `<button class="ctab[ on]" data-id="…" aria-pressed="true|false"[ disabled]>` per tab, with the text `run <first 8 of id>` or `copy <first 8 of id>`, and a `title` with the full id, the `last` text and `new Date(at).toLocaleString()`. Every value goes through `esc` / `escA` as a string (`esc` calls `.replace` on its argument, so a number must be turned into a string first). `on` is the id of the open tab; `busy` adds `disabled` to every tab.
8. `apps/dashboard/page/app.js` → `chatBind()`: remove the `<button id="cnew" …>New chat</button>` markup and its `addEventListener` line; after the `.chead` div, add `<div class="ctabs" id="ctabs" aria-label="Sessions of this chat" hidden></div>`; add one click listener on `#ctabs` that reads `data-id` from the clicked `.ctab` and calls `post('/api/chat/switch', { project: c.p.project, slug: c.p.slug, id })`.
9. `apps/dashboard/page/app.js` → `chatState(st)`: remove the `byId('cnew').hidden = …` line; set `const tabs = st.tabs || [], html = chatTabsHtml(tabs, st.current ? st.current.id : st.latest, !!st.busy)`; `byId('ctabs').innerHTML = html`; `byId('ctabs').hidden = !html`. A refused switch shows its `output` through `post()`, which alerts every `output` (as Fork does today). Then add the page-function test listed under **Unit tests** to `apps/dashboard/test/dashboard.test.mjs`, and run `node --test apps/dashboard/test/dashboard.test.mjs`.
10. `apps/dashboard/page/app.css`: after the `.cwho` rule, add `.ctabs` (flex row, `gap:2px`, `padding:4px 8px 0`, `border-bottom:1px solid var(--line)`, `overflow-x:auto`, `flex-shrink:0`), `.ctabs[hidden] { display:none; }`, `.ctab` (mono `calc(11.5px * var(--fs))`, `padding:3px 10px`, `border:1px solid transparent`, `border-bottom:0`, `border-radius:6px 6px 0 0`, `background:none`, `color:var(--dim)`, `white-space:nowrap`), `.ctab:hover` (`background:var(--hover)`, `border-color:transparent`, overriding the global `button:hover` accent border) and `.ctab.on, .ctab.on:hover` (`background:var(--card)`, `border-color:var(--line)`, `color:var(--fg)`), mirroring `.stab` / `.stab.on`.
11. `docs/plans-dashboard.md` → **Chat with the agent**: rewrite the **Fork** bullet: Fork makes a copy on the next message; when the chat has a copy, a tab row under the header shows `run <id>` (the run's latest session) and one tab per copy; a click switches the chat to that session and the next message continues it; while the tab row shows, a click on the open tab cancels a pending Fork; the tabs are disabled while the agent works; older run sessions stay in **AI session history**.
12. Run `/changelog-entry` to write `changelog.d/20261127-chat-session-tabs.yaml` (customers see the change: the New chat button becomes the run tab), and check it with `node .claude/scripts/changelog-validate.mjs --base origin/main`.

## Tests

### Unit tests

- **`chatTabsHtml()` page-function test** (new test "the page: the chat's session tabs", mirroring the `sentLanded` test: extract `/^function chatTabsHtml\(tabs, on, busy\) \{[\s\S]*?\n\}$/m` (with the `m` flag, as the `sentLanded` test) from `app.js`, and build it with `new Function` together with the one-line `esc` and `escA` arrow functions, extracted with `/^const esc = .*$/m` and `/^const escA = .*$/m`):
  - one tab that is open (`on` is its id) → `''` (the row stays hidden);
  - one tab with `on = 'ses-gone'` (the open session has no tab) → one `.ctab` button (the way back to the run);
  - two tabs `[{ id: 'ses-mine', kind: 'run', at: 0, last: '' }, { id: 'ses-copy', kind: 'copy', at: 0, last: '<b>x</b>' }]` with `on = 'ses-copy'` → two `.ctab` buttons, text `run ses-mine` and `copy ses-copy`, only the second has `on` and `aria-pressed="true"`, and the `<b>` in `last` comes out escaped;
  - the same with `busy = true` → both buttons have `disabled`;
  - the page source has no `id="cnew"` (`assert.doesNotMatch(src, /id="cnew"/)`).
- Would it pass with the feature not built? No: without `chatTabsHtml` the regex finds nothing and `assert.ok(m)` fails.

### End-to-end tests

In the chat test of `apps/dashboard/test/dashboard.test.mjs`, after the "New chat: back to the run's latest session" block (the chat is idle on `ses-mine`, and `ses-copy` exists from the Fork block). The test defines `askFile = path.join(home, '.claude', 'pipeline-dashboard', 'state', 'demo', 'ask', 'demo-plan.json')` (the same path the VS Code copy test builds; that one is local to its own test):

- **Tabs list the run and the copy.** `(await chat()).tabs.map((t) => [t.id, t.kind])` deep-equals `[['ses-mine', 'run'], ['ses-copy', 'copy']]`. Fails without `chatTabs()` (no `tabs` field). (`last` is not checked here: the VS Code copy test leaves a 3-byte `transcripts` cache entry for `ses-copy.jsonl`, and `readTranscript()` resets an entry only when the file gets smaller, so the first line of the fork's new file, `'and in a copy?'`, is not read. It is checked below with a line appended later.)
- **The base of a copy is recorded.** `JSON.parse(readFileSync(askFile, 'utf8')).bases` deep-equals `{ 'ses-copy': 'ses-mine' }`. Fails without step 1.
- **A click on the open tab cancels a pending Fork.** `post('/api/chat/fork', who)`; `(await chat()).fork` is `true`; `post('/api/chat/switch', { ...who, id: 'ses-mine' })` → `{ ok: true }`; `(await chat()).fork` is `false` and `.session` is `'ses-mine'`.
- **Switch to the copy.** `post('/api/chat/switch', { ...who, id: 'ses-copy' })` deep-equals `{ ok: true }`; then `(await chat()).current` deep-equals `{ id: 'ses-copy', base: 'ses-mine', copy: true }`, and `(await history()).session` is `'ses-copy'`.
- **The next message continues the copy, not a new fork.** Send `'back in the copy'`; wait for `answer: back in the copy` in the history; `spawns().at(-1)` matches `/--resume ses-copy$/` (no `--fork-session`); the `ses-copy` tab's `last` is `'back in the copy'` (the line is appended whole).
- **Switch is refused while the agent works.** Wait until `(await chat()).busy` is false (the history can show the answer before the server reads its `result`, as the other sends in this test wait for). Send `'step one'` (the fake's `^step` path streams for 2 s before its result), wait until `(await chat()).busy` is true, then `post('/api/chat/switch', { ...who, id: 'ses-mine' })` returns `ok: false` with the busy text, and `(await chat()).session` is still `'ses-copy'`; wait for idle.
- **Switch back to the run tab.** `post('/api/chat/switch', { ...who, id: 'ses-mine' })` → `{ ok: true }`; `(await chat()).session` is `'ses-mine'` and `.current` is `null`; `(await onlyPlan()).sessions.map((s) => s.id)` is still `['ses-mine']` (the copy is not a run session).
- **A copy with no transcript gets no tab, and an unknown id is refused.** Add `'ses-gone'` to `copies` in `askFile` (read, change, write; no `ses-gone.jsonl` exists); `(await chat()).tabs.map((t) => t.id)` is still `['ses-mine', 'ses-copy']`; `post('/api/chat/switch', { ...who, id: 'ses-gone' })` and `{ ...who, id: 'ses-nope' }` both return `ok: false`, and `(await chat()).session` stays `'ses-mine'`.
- **An open copy whose transcript is gone can still go back to the run.** Set `current` in `askFile` to `{ id: 'ses-gone', base: 'ses-mine', copy: true }`; the tabs are still `['ses-mine', 'ses-copy']` (no `ses-gone` tab); `post('/api/chat/switch', { ...who, id: 'ses-mine' })` → `{ ok: true }` and `.current` is `null`. Then take `'ses-gone'` out of `copies` again, so the later tests see the file as before.

In the VS Code copy test ("the chat follows its session to the VS Code copy once the copy is continued"; `demo` is a generic project, so `ses-copy` is not one of the plan's run sessions there), after the panel has moved to `ses-copy`. Its pinned `askFile` has no `bases` field, as an old chat file:

- **A VS Code copy keeps its tab after a switch away.** `(await chat()).tabs.map((t) => [t.id, t.kind])` deep-equals `[['ses-mine', 'run'], ['ses-copy', 'copy']]`; `post('/api/chat/switch', { project: 'demo', slug: 'demo-plan', id: 'ses-mine' })` → `{ ok: true }` (no throw on the missing `bases`); the saved `askFile` has `copies` `['ses-copy']` and `bases` `{ 'ses-copy': 'ses-mine' }`; the tabs are still the same two. Fails without the "keep the VS Code copy" part of step 4 (the copy tab goes away).

A new test "a root chat's run tab resumes its own session", with a hand-made root chat in the generic project `demo` (a root chat there counts `a.own` as its run sessions, see `planSessions()`). It goes right after the test "a chat outlives a server restart: the new server shows its question and the same claude answers": it runs `claude` in the same repo-root folder as `demo-plan`, so placed before the chat test it would fill the commands/models lookup cache (`chatMetaCache`) and add a `--resume` spawn that the chat test's first checks count. It has its own `until`, `chat`, `history` and `spawns` helpers, built like those of the chat test:

- Setup: write `<plansDir>/20261127-000000-root-plan.md` (`# Root plan`), the made-up transcripts `ses-root.jsonl` and `ses-rootcopy.jsonl` (`'{}\n'`) in the repo root's transcript folder, and `ask/20261127-000000-root-plan.json` = `{ root: true, own: ['ses-root'], current: { id: 'ses-rootcopy', base: 'ses-root', copy: true }, copies: ['ses-rootcopy'], bases: { 'ses-rootcopy': 'ses-root' } }`. `finally` first calls `post('/api/chat/new', …)` (so a failed assertion does not leave `claude` open), then removes all four files.
- `(await chat()).tabs.map((t) => [t.id, t.kind])` deep-equals `[['ses-root', 'run'], ['ses-rootcopy', 'copy']]`.
- `post('/api/chat/switch', { project: 'demo', slug: '20261127-000000-root-plan', id: 'ses-root' })` → `{ ok: true }`; `(await chat()).current` deep-equals `{ id: 'ses-root', base: 'ses-root', copy: false }` (not `null`, which would make the next message start a new session). Fails with `a.current = null` for the run tab.
- Send `'home again'`; wait for `answer: home again` in the history and for idle; the last `claude` spawn matches `/--resume ses-root$/`. Then wait for idle; `finally` closes the `claude` with `/api/chat/new` (Stop leaves it open, and a late context refresh could write the ask file again after `finally` removed it).

A new test "POST /api/chat/switch refuses another site and a bad request", mirroring the `bootstrap-upgrade` refusal test:

- `raw('POST', '/api/chat/switch', { Host: '127.0.0.1:' + port, Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, JSON.stringify({ project: 'demo', slug: 'demo-plan', id: 'ses-mine' }))` → `403`;
- a `fetch` POST with `{ project: 'no-such-project', slug: 'demo-plan', id: 'x' }` → status `400`;
- a `fetch` POST with `{ project: 'demo', slug: '../x', id: 'x' }` → status `400` (the shared `safeName(b.slug)` guard).
- No 404 case: an unknown session is a refusal inside a 200 (see **Contracts**), and the route exists for every project and slug.

### Harness constraints

- The harness runs a fake `claude` that always names a fork `ses-copy` (`FAKE_CLAUDE`, `id = … '--fork-session' ? 'ses-copy' : …`). A second, different copy cannot be made, so "two copies, switch between them" is covered by one copy plus the run tab; the order of several copies goes to the browser test.
- The harness cannot remove the run's transcript (`ses-mine.jsonl`) without breaking the later tests, so "a copy with no run tab" (its base falls back to itself) goes to the code review of step 4.
- The `demo` project of the harness is generic, so "a root chat whose plan got a worktree" (`rootChat()` false while `a.root` is still true) cannot be built there; the `rootChat()` call in step 4 goes to the code review.
- The scout Confirm prompt contains "plan", so the fake `claude` answers it with an ExitPlanMode prompt and the turn never ends; the root-chat case therefore uses its own hand-made root chat, not the Confirm test.
- The page outside `chatTabsHtml()` (the click handler, `hidden` on `#ctabs`) has no harness; it goes to the browser test.

### AI output

None — no line is about text an AI model writes.

## Browser test

- Routes: the dashboard page `/` → open a plan that has a Claude session → the chat panel.
- Siblings: the plan session tabs at the top of the page (`.stab`) — check that the chat tabs look different enough and do not change them; the Fork button and the `cwho` label (`· next message: a copy`, `· copy of …`).
- Same in every place: None.
- Widths: 1440 px and 390 px with touch, for the chat panel.
- Account and data: no sign-in. A test dashboard (`DASH_PORT=4911 DASH_NO_OPEN=1 DASH_WATCH_MS=0 node apps/dashboard/server.mjs`, stopped by its PID) on a throwaway test project (a scratch git repo registered only for this check, with a made-up plan that has one short run session), so the copies change no real plan's chat state; make two copies by Fork + a message, twice, with the run tab clicked in between.
- What to compare: the old app on `http://127.0.0.1:4899` against the new code. Old: after the second fork, the first copy is not reachable from the page. New: (1) a plan with no copy shows no tab row; (2) after the first fork + message the row shows `run …` and `copy …`, the copy `on`; (3) after the run tab + second fork the row shows three tabs; (4) clicking the first copy shows its history and the next message continues it; (5) while the agent works the tabs are disabled; (6) hovering a tab shows no accent border; (7) at 390 px the row scrolls sideways and does not push the Fork button out of the header; (8) there is no New chat button.

## How to verify

```bash
node --test apps/dashboard/test/dashboard.test.mjs
npm test
grep -n "api/chat/switch" apps/dashboard/server.mjs apps/dashboard/page/app.js
node .claude/scripts/changelog-validate.mjs --base origin/main
```
