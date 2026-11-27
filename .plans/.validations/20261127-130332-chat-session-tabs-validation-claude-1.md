**Validation round:** 1

## Plan validation: 20261127-130332-chat-session-tabs.md

**Verdict:** APPROVE WITH CHANGES

The symbols, line anchors, the fake `claude`, the chat test flow and the routes are as the plan says. The server steps work for a worktree or generic chat. Two defects must be fixed before implementation: in a root chat (a scout proposal), the run tab starts a new session, and the CSS as written keeps the hidden tab row on the screen.

### Blocking issues

- [Edge case / wrong behaviour] In a root chat, the run tab does not continue the run session. It starts a new, empty session. — `apps/dashboard/server.mjs:3036` `const id = a.current ? a.current.id : a.root ? null : (sessions.at(-1) || {}).id;` and `:3049` (`--resume` only when `id`); plan Step 4 "for the run tab set `a.current = null`". — Example: a scout proposal chat (`a.root`, test at `apps/dashboard/test/dashboard.test.mjs:1637`) has own session `S1`. You fork and get copy `C1`. You click the `run S1…` tab. Step 4 sets `a.current = null`, so the next message runs `claude` with no `--resume`, and `chatOnLine()` (`server.mjs:2964`) pins a new id. The tab promised "the next message continues it" (Goal), but the agent has no history. Today the **New chat** button does the same, but its label says "new". The run tab's label says "continue S1". — Fix: for the run tab, set `a.current = a.root ? { id, base: id, copy: false } : null` (or always `{ id, base: id, copy: false }`, which is what `chatStart()` writes anyway at `server.mjs:3038`). Change the Deviations line "does exactly what `chatRestart(…, false)` does" to match. Add an end-to-end case to the root-chat test, or state why the harness cannot cover it.
- [Page defect] `.ctabs` gets `display:flex`, so its `hidden` attribute has no effect. The empty row with its border and padding stays visible on every chat. — `apps/dashboard/page/app.css:692`, `:693`, `:1023` (the repo adds an `X[hidden] { display:none; }` rule for each element with its own `display`); plan Step 9 gives `.ctabs` a flex row and Step 7 relies on `hidden`. — This breaks the deviation "a plan with no copy looks as it does today" and browser check (1). — Fix: in Step 9, add `.ctabs[hidden] { display:none; }`.

### Non-blocking concerns

- [Tests / harness] The Harness constraints say the page "has no unit harness". That is not correct: page tests take a function out of `app.js` with a regex and `new Function`, for example `sentLanded` (`apps/dashboard/test/dashboard.test.mjs:2208-2219`) and `revealInSide` (`:2221`), and source checks such as `:2354-2358`. — Suggestion: move the tab markup into a pure function `chatTabsHtml(st)` in `app.js`. Test it: no row when there are fewer than 2 tabs, `on` on the current id (or on `latest` when `current` is null), `disabled` while busy, `esc`/`escA` on `last`. Add a source assertion that `id="cnew"` is gone, in the same way as `:2357`.
- [Contract accuracy] `clip(text, 120)` does not give at most 120 characters. It appends `'\n… (N more characters)'` (`server.mjs:2606`). — Suggestion: use `text.slice(0, 120)`, or change the Contracts line to say what `clip` really returns.
- [Robustness] Step 4 loads the chat with plain `loadChat()`. `chatState()` builds its tabs after `followVscodeCopy()` (`server.mjs:3256`). When the follow was skipped because the chat was live (`server.mjs:2558`), the tab the page shows for a VS Code copy is not in `chatSwitch()`'s tab list, so `chatSwitch()` refuses it. — Suggestion: in `chatSwitch()`, close the open `claude` first and then call `followVscodeCopy(proj, slug, loadChat(proj, slug))` before you build the tabs.
- [Edge case] A VS Code copy tab exists only while `a.current` points to it (Step 2: "`a.current.id` as a `copy` tab when it is in neither"). After you switch to another tab, that tab is gone for good, although decision 2A says "every copy" has a tab. — Suggestion: state this limit in the plan and the docs, or record the followed id in a separate list when you switch away from it.
- [Page robustness] Step 8 reads `st.tabs.length`. When a page and a server of different versions meet (for example, the page is reloaded after `git pull` and before the restart), `st.tabs` is `undefined` and `chatState()` throws. — Suggestion: use `(st.tabs || [])`.
- [Performance] `chatState()` runs on each `chatEmitState()` (`server.mjs:2817-2820`), and the plan adds a `statSync()` and a `readTranscript()` for each tab. `readTranscript()` keeps only 12 transcripts (`server.mjs:2605`), for all plans together. Extra tab files push other transcripts out of the cache, and the next read of a long run transcript (several MB) starts again from byte 0. — Suggestion: keep `last` in a small cache keyed by file and mtime, or get `last` only when `at` changed. As a minimum, write in the plan that you accept this cost.
- [Consistency] Affected files says the test assertions go "after the 'Fork' block". Step 6 and Tests say "after the 'New chat' … block" (`dashboard.test.mjs:910-916`). — Suggestion: use "after the New chat block" in all three places.
- [How to verify] `grep -c "id=\"cnew\"" apps/dashboard/page/app.js` prints `0` with exit status 1 when the work is correct, so a reader can take success for a failure. The `grep -n "api/chat/switch"` line passes when only one of the two files has the route. — Suggestion: state the expected output of each grep, or replace them with the source assertion from the first concern.
- [Accessibility] `role="tab"` without `aria-controls` and without arrow-key support is a partial tablist pattern. — Suggestion: leave out the tab roles (use plain buttons with `aria-pressed`), or add arrow-key handling.
- [Style] The global `button:hover { border-color:var(--accent); }` (`app.css:207`) also gives a `.ctab` an accent border on hover. `.stab` avoids this because its inner buttons have `border:0` (`app.css:986`). — Suggestion: add `.ctab:hover { border-color:transparent }` (or `var(--line)` when the tab is `.on`), or check this in the browser test.

### Edge cases the plan should address

- A root chat (scout proposal) with a copy, when you click the run tab. This is the blocking item: the run tab must continue `S1` and not start a new session.
- A click on a tab while a Fork is pending (`a.fork = true`). Step 4 clears the fork. Add one assertion that `(await chat()).fork` is `false` after the switch.
- An `ask/<slug>.json` from before this change, with `copies` and no `bases`. The base falls back to `tabs[0]?.id`. One test that writes such a file (as the VS Code copy test does at `dashboard.test.mjs:750-755`) would prove the fallback.
- A switch to the tab that is already current. It closes the idle `claude` with no need. This is harmless, but say whether it is intended.
- A copy whose `.jsonl` file is deleted. It loses its tab, and when it is `a.current`, `chatTranscript()` falls back to its base. Say that this is intended.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified (except the root-chat effect of "same as `chatRestart(…, false)`")
- [x] Breaking changes for changed symbols listed (consumer search done: `cnew`, `chat/new`, `chat/fork` and `chatRestart` appear only in `server.mjs`, `page/app.js` and `test/dashboard.test.mjs`; nothing in `apps/plans-mac`, `docs`, `skills` or `.claude`)
- [x] Wiring & registration matches the code (module-local functions, POST route list at `server.mjs:3576-3581`)
- [x] Scope stays inside the goal; no open decision is taken silently (`docs/roadmap.md:39-41`: no open decisions)
- [ ] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (success, unknown id and busy are covered; the cross-site refusal is shared and already tested at `dashboard.test.mjs:1143`; no case for a root chat and no page test)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (the mockup URL is a localhost link with no private data)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (server: yes; the page tab logic has a test pattern that the plan does not use)
- [x] Docs: current state only respected
- [x] Contracts respected (no contract source; the `clip` length claim is wrong, see the concern)
- [ ] "How to verify" commands are real and can fail (the `grep -c` line exits with status 1 when the work is correct)

```
Update the plan at .plans/20261127-130332-chat-session-tabs.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In Step 4, make the run tab continue its session in a root chat: set a.current = a.root ? { id, base: id, copy: false } : null (or always { id, base: id, copy: false }). With a.current = null, chatStart() starts a new session with no --resume for a root chat. Update the Deviations line "does exactly what chatRestart(…, false) does", and add a root-chat case to Tests (or state why the harness cannot cover it). (evidence: apps/dashboard/server.mjs:3036, :3049, :2964)
2. In Step 9, add `.ctabs[hidden] { display:none; }`. Without it, display:flex wins over the hidden attribute and the empty row shows on every chat. (evidence: apps/dashboard/page/app.css:692, :693, :1023)

SHOULD FIX:
1. Replace the Harness constraint "the page has no unit harness". Move the tab markup into a pure function (for example chatTabsHtml(st)) and test it with the regex + new Function pattern: no row when there are fewer than 2 tabs, the on class, disabled while busy, escaping. Add a source assertion that id="cnew" is gone. (evidence: apps/dashboard/test/dashboard.test.mjs:2208-2219, :2354-2358)
2. Make `last` at most 120 characters (text.slice(0, 120)), or change the Contracts text. clip() appends "\n… (N more characters)". (evidence: apps/dashboard/server.mjs:2606)
3. In chatSwitch(), close the open claude first, then load the chat through followVscodeCopy(), so that its tab list is the same as the one chatState() shows. (evidence: apps/dashboard/server.mjs:2558, :3256)
4. In Step 8, read (st.tabs || []), so that a page and a server of different versions do not throw.
5. Write down the extra readTranscript()/statSync() cost for each tab in each chatState() call and the 12-entry cache, or cache `last` by file and mtime. (evidence: apps/dashboard/server.mjs:2605, :2817-2820)
6. Use "after the New chat block" in Affected files, Step 6 and Tests. (evidence: apps/dashboard/test/dashboard.test.mjs:910-916)
7. In How to verify, state the expected output of each grep (grep -c prints 0 and exits with status 1 when the work is correct), or replace them with the source assertion from item 1.
8. Make the CSS keep the global button:hover accent border off .ctab, or add it to the browser test. (evidence: apps/dashboard/page/app.css:207, :986)

ADD THESE EDGE CASES:
- A click on a tab while a Fork is pending: assert that fork is false after the switch.
- An ask/<slug>.json from before this change, with copies and no bases: the base falls back to the run tab's id.
- A VS Code copy tab goes away after you switch away from it: state this limit (decision 2A says every copy has a tab).
- A switch to the tab that is already current closes the idle claude: say whether this is intended.
- A copy whose transcript file is deleted loses its tab: say what the page shows then.

Do not change anything the validation did not flag.
```
