**Validation round:** 2

## Plan validation: 20261127-130332-chat-session-tabs.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The server, page, CSS and docs steps match the code, and the round-1 fixes are in. One new test cannot pass as written: the root-chat case added to the scout Confirm test waits for an idle chat that never comes, switches to a tab that does not exist, and would not reach the code it claims to test even if it ran. Two smaller test gaps also need a fix.

### Blocking issues

- [Tests / edge case] The root-chat case in the scout Confirm test cannot pass, and it does not test the root branch of `chatSwitch()`. — Evidence: `apps/dashboard/server.mjs:1347` (`scoutConfirmPrompt` sends `/skill-1-plan Turn the scout proposal … into a plan.`); `apps/dashboard/test/dashboard.test.mjs:139-141` (the fake `claude`: `if (/plan/.test(q)) return out({ type: 'control_request', … tool_name: 'ExitPlanMode' … })`). This branch writes no transcript line and sends no `result`. `apps/dashboard/server.mjs:3129` sets `ch.busy = true`, and only a `result` sets it back (`server.mjs:3010-3012`). Plan Tests section, scout Confirm case (plan line 129). — Why it breaks: (1) "Wait until … is not busy" never comes true: the turn waits for the ExitPlanMode answer until `/api/chat/stop`, so the `until` helper (10 s, `dashboard.test.mjs:1638-1642`) fails. (2) The fake never writes `ses-probe.jsonl`: it only appends on `log(...)`, and no test sends a non-resume message that reaches `log`. Per Step 2, `chatTabs()` skips an id with no file, so `ses-probe` is not a tab, and `chatSwitch()` returns `ok: false` ("not a tab of this chat"). (3) Even with the file and an idle chat, `a.current.id === 'ses-probe'` is the open tab, so Step 4's open-tab short-circuit returns before the `a.root ? { id, base: id, copy: false } : null` line. The claim "Fails with `a.current = null` for the run tab" is false. — Fix: remove the switch from the scout Confirm test. Add a separate test "a root chat's run tab keeps its session" that builds the state by hand. Write a plan file `root-plan.md`. Write two made-up transcripts `ses-root.jsonl` and `ses-rootcopy.jsonl` in the repo's transcript dir, each with one `{"type":"user","message":{"role":"user","content":"hi"}}` line. Write `ask/root-plan.json` = `{ root: true, own: ['ses-root'], current: { id: 'ses-rootcopy', base: 'ses-root', copy: true }, copies: ['ses-rootcopy'], bases: { 'ses-rootcopy': 'ses-root' } }`. Assert that `tabs` lists `[['ses-root','run'],['ses-rootcopy','copy']]`. Then `post('/api/chat/switch', { project: 'demo', slug: 'root-plan', id: 'ses-root' })` should return `{ ok: true }`, and `.current` should deep-equal `{ id: 'ses-root', base: 'ses-root', copy: false }`. This version fails with `a.current = null`. Remove the files in `finally`. This works because `planSessions()` for a root chat in a generic project uses `only = sessionIdsInLog ∪ a.own` (`server.mjs:2580`), so `ses-root` is the run session.

### Non-blocking concerns

- [Steps / Tests] No step adds the `chatTabsHtml()` page-function test. Step 6 adds only "the server cases", and Steps 7–9 change `app.js` but add no test. — Evidence: plan Steps 6–9 against Tests → Unit tests. — Suggestion: after Step 7, add "add the test 'the page: the chat's session tabs' (Tests → Unit tests) and run `node --test apps/dashboard/test/dashboard.test.mjs`".
- [Tests / race] "Switch is refused while the agent works" sends `'step one'` after it only waits for `answer: back in the copy` in the history. The fake writes the transcript line before it prints `assistant` + `result` (`dashboard.test.mjs:59-62`), so the history can show the answer while the server has not yet read the earlier `result`. In that case a poll can see `busy: true` from `chatMessage()` (`server.mjs:3129`), and then the late `result` sets `busy` to false (`server.mjs:3012`) before the switch arrives. The window is small, but the test can then flake. — Suggestion: before `'step one'`, wait for idle, as every other send in this test does (`await until(async () => !(await chat()).busy, …)`, for example `dashboard.test.mjs:853`). Then wait until `busy` is true.
- [Contracts / labels] Step 2 adds `a.current.id` as `kind: 'copy'` when it is neither the run id nor in `a.copies`. When `a.current` points to an older run session (in `sessions` but not `sessions.at(-1)`, for example a VS Code copy in a pipeline worktree that is not the newest file), the tab says "copy", but `current.copy` is `false`. After a switch away it gets no tab (Step 4 adds only ids that are in neither `sessions` nor `copies`). This matches decision 2A, but the label is wrong. — Suggestion: add one line to Step 2 or Deviations that accepts this, or label such a tab from `a.current.copy`.
- [Cost] `chatTabs()` calls `planSessions()` again (a `readdirSync` + `statSync` per file), and `chatState()` already calls it once (`server.mjs:3257`). State is emitted many times per turn. — Suggestion: let `chatState()` compute `planSessions()` once and pass it to `chatTabs()`, or accept the cost in the plan.
- [Tests] The `ses-gone` step leaves `ses-gone` in `copies` of `demo-plan.json` for the later tests (Stop, background, usage, restart). I checked: they start from `a.current = null` and `ses-gone` is not a session, so nothing breaks. Still, say in the plan that the change stays in the file, or restore it in `finally`.

### Edge cases the plan should address

- A root chat with a copy, then a click on the run tab — this is the only path to the `a.root` branch of Step 4. The current test does not reach it (see the blocking issue).
- The killed `claude` of the tab you leave prints one more line after `chats.delete(key)`. `chatOnLine()` then still runs `loadChat`/`saveChat` on its own `ch` (`server.mjs:2955-2966`), but only on a new `session_id`. `chatRestart()` has the same gap today, so this is not new. Note it for the code review of Step 4.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`chatOnLine` 2952, `chatStart` 3028, `chatEnd` 3208, `chatRestart` 3218, `chatState` 3255, `followVscodeCopy` 2557, `planSessions` 2575, `readTranscript` 2740, `TRANSCRIPTS_KEPT` 2605, `sessionIdCache` 535, the POST guard 3548, routes 3580-3581; `app.js` `esc` 60, `escA` 3410, `chatBind` 1134, `cnew` 1143/1192/1424, `sentLanded` 1373, `chatState` 1413; `app.css` `button:hover` 207, `.cwho` 631, `.stab*` 972-993, `#stabs[hidden]` 1023; docs Fork bullet `docs/plans-dashboard.md:286`)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `cnew` only in `app.js`; `chat/new` in `server.mjs`, the tests and the docs)
- [x] Wiring & registration matches the code (module-local functions, a route after the shared guard)
- [x] Scope stays inside the goal; no open decision is taken silently (roadmap: "None at the repo level")
- [ ] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint — 403 and 400 are covered; no sign-in, so no 401; the root-chat success case is broken (blocking)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected (except the missing step for the page test)
- [x] Docs: current state only respected
- [x] Contracts respected (no contract source; shapes written down in Contracts)
- [x] "How to verify" commands are real and can fail (`npm test`, `node --test …`, `changelog-validate.mjs` exists at `.claude/scripts/changelog-validate.mjs`; the `grep` exits 1 when the route is missing)

Checked and fine (the chat test against the fake `claude`): after New chat the chat is closed with `a.current = null`. `ses-mine.jsonl` and `ses-copy.jsonl` exist (the VS Code copy test removes its own `ses-copy.jsonl` in `finally`, `dashboard.test.mjs:771`; the Fork block writes a new one). The `last` text of `ses-copy` is `'and in a copy?'`. `bases` = `{ 'ses-copy': 'ses-mine' }` (the earlier fork at line 889 had no message). A click on the open tab while a Fork waits takes the open-tab path (`tabs[0]` = `ses-mine`). The switch to the copy gives `current` `{ id: 'ses-copy', base: 'ses-mine', copy: true }`, and `history().session` is `ses-copy` (`chatTranscript()` takes `a.current.id`). The next message spawns `--resume ses-copy` with no `--allowedTools` suffix (as `dashboard.test.mjs:905`), and the fake keeps the id `ses-copy`. `'step one'` holds `busy` for 2 s. The switch back to the run tab closes the open `claude` and sets `current` to `null`. `ses-gone` and `ses-nope` are refused. The page-test regex and the `esc`/`escA` one-liners can be extracted as written.

```
Update the plan at .plans/20261127-130332-chat-session-tabs.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Remove the root-chat switch from the scout Confirm test. That test's '/skill-1-plan … into a plan.' prompt hits the fake claude's /plan/ branch (ExitPlanMode permission). That branch writes no ses-probe.jsonl and sends no result, so "wait until not busy" times out, ses-probe is not a tab, and the open-tab short-circuit would skip the a.root branch anyway. Replace it with a new test "a root chat's run tab keeps its session". It writes root-plan.md, the made-up transcripts ses-root.jsonl and ses-rootcopy.jsonl (one user line each) in the repo's transcript dir, and ask/root-plan.json = { root: true, own: ['ses-root'], current: { id: 'ses-rootcopy', base: 'ses-root', copy: true }, copies: ['ses-rootcopy'], bases: { 'ses-rootcopy': 'ses-root' } }. It asserts tabs [['ses-root','run'],['ses-rootcopy','copy']]. Then the switch to 'ses-root' gives { ok: true }, and .current deep-equals { id: 'ses-root', base: 'ses-root', copy: false }. It removes the files in finally. Update Affected files and Step 6 to match. (evidence: apps/dashboard/server.mjs:1347, apps/dashboard/test/dashboard.test.mjs:139-141, server.mjs:3010-3012, server.mjs:2580)

SHOULD FIX:
1. Add a step after Step 7 that writes the page-function test "the page: the chat's session tabs" and runs node --test apps/dashboard/test/dashboard.test.mjs. Today no step adds it. (evidence: plan Steps 6-9 vs Tests → Unit tests)
2. In "Switch is refused while the agent works", wait for idle (until !busy) before you send 'step one', as the other sends in this test do. The history can show the answer before the server has read the earlier result. (evidence: apps/dashboard/test/dashboard.test.mjs:59-62, :853; server.mjs:3012, :3129)
3. In Step 2, say what happens when a.current is an older run session (in sessions but not the latest): either accept the 'copy' label in Deviations, or take the kind from a.current.copy. (evidence: server.mjs:2557-2569, plan Step 2)
4. Let chatState() call planSessions() once and pass its result to chatTabs(), or state that the second directory scan per state event is accepted. (evidence: server.mjs:3257)

ADD THESE EDGE CASES:
- A root chat with a copy, then a click on the run tab (the only path to the a.root branch of Step 4).
- ses-gone stays in copies of demo-plan.json for the later tests: say so, or restore the file in finally.

Do not change anything the validation did not flag.
```
