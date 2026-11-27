**Validation round:** 3

## Plan validation: 20261127-130332-chat-session-tabs.md

**Verdict:** APPROVE WITH CHANGES

The server and page design checks out against the code: `chatRestart()`, `chatOnLine()`, `chatState()`, `followVscodeCopy()`, `planSessions()`, the POST guard, `esc` / `escA`, `post()`, the CSS rules and the docs bullet are all as the plan says. Two new test cases will not run as written. Both fail because of state that earlier tests leave in the same server process.

### Blocking issues

- [Tests / harness state] The assertion "the `ses-copy` tab's `last` is `'and in a copy?'`" will fail. The reason is the `readTranscript()` cache, not the feature. — Evidence: the VS Code copy test writes `ses-copy.jsonl` as `'{}\n'` (3 bytes) at `apps/dashboard/test/dashboard.test.mjs:759`. It reads that file through `/api/chat/history` at `:768` (and through `chatStartedAt()` at `:765`), so `transcripts` caches it with `size: 3`. Then it deletes the file at `:771`. `readTranscript()` resets its cache entry only when the file got smaller (`apps/dashboard/server.mjs:2744` `if (!t || st.size < t.size)`). Only `/api/log` reads other files through that cache, so nothing between the two tests evicts the entry (`TRANSCRIPTS_KEPT = 12`, `:2605`). The Fork in the chat test then writes a new `ses-copy.jsonl`. Its first line is the user message `'and in a copy?'` (`FAKE_CLAUDE` `log({ type: 'user', … })`, test file `:142`, written before the answer). The cache reads the new file from byte 3, so that line becomes `ype":"user",…`, which `transcriptLine()` skips (`server.mjs:2722`). As a result no `k: 'you'` item exists and `last` is `''`. The test at `:904` passes today only because it checks the answer and not the user line. — Why it breaks: the test fails even when the feature is correct. — Fix: assert `last` only after "The next message continues the copy". `'back in the copy'` is appended as a whole line, so after that send the copy tab's `last` must be `'back in the copy'` (the `^step` path that follows logs no user line, `FAKE_CLAUDE` `:110-113`). As an alternative, fix `readTranscript()` so that it also resets when the mtime goes back or the inode changes. That fix is wider than this plan; see the sibling defect below.

- [Tests / test order] The plan does not say where the new test "a root chat's run tab resumes its own session" goes. If it goes before the chat test (for example next to the VS Code copy test, where the root-chat setup naturally fits), the chat test breaks. — Evidence: the root chat runs in `proj.root` (the same `wtPath` as `demo-plan`, `server.mjs:2577`). `chatAttach()` stores its initialize answer in `chatMetaCache` for that folder (`:3090-3092`), with no `contextMax`. The chat test then gets the cache hit (`:2917`), so `test:792` ("one lookup for both pages", which expects 1 non-resume spawn) and `test:795` (`contextMax` 200000) fail. Its `--resume ses-root` spawn also becomes `spawns()[0]` and breaks `test:811-812` (`spawns().length === 1`, `--resume ses-mine$`). — Why it breaks: the implementer can place the test before line 775 and get unrelated failures. — Fix: state that the root-chat test goes after the chat test "the chat continues the plan's session live…" (`test:775-917`). The best place is after the restart test (`test:995-1029`): the server restarts there, so `chatMetaCache` is fresh for the tests that follow, and no later test counts non-resume spawns.

### Non-blocking concerns

- [Tests / cleanup] The root-chat test ends with `post('/api/chat/stop', …)` on an idle chat. `chatStop()` only sends an interrupt (`server.mjs:3191-3203`), so the `claude` stays open in `chats` after the test. A late `chatContextRefresh()` can then write `ask/20261127-000000-root-plan.json` again (`{ ...a, context }`, `:2892-2893`) after `finally` deleted it. — Suggestion: wait for `!busy`, then end with `post('/api/chat/new', …)`, which closes the chat (`chats.delete`, so the refresh guard at `:2890` returns early), as the other chat tests do (`test:942`, `:959`, `:1028`). Say that the test defines its own `until`, `calls` / `spawns` and `chat` / `history` helpers, because those in the chat test are local to it.
- [Sibling defect] `readTranscript()` does not notice a transcript that was deleted and written again with a larger size (`server.mjs:2744`). Today it already drops the first line of the fork's `ses-copy.jsonl` in the chat test's history. Report it to the owner, or fix it in a separate plan.
- [Tests / regex] The page-function regex `^function chatTabsHtml\(tabs, on, busy\) \{[\s\S]*?\n\}$` needs the `m` flag, as the `sentLanded` test has (`test:2210`). Write the flag in the plan so the extraction does not fail with `$` at the end of the file.
- [Wording] Step 2 says the folder is "scanned once per state, not twice". `chatState()` also calls `planSessions()` through `chatTranscript()` in `chatContext()`, `chatIdleFrom()` and `chatStartedAt()` (`:2762`, `:3264-3266`). The claim to make is "no extra scan for the tabs".
- [Edge] `chatSwitch()` mirrors `chatRestart()` and closes a chat that has a background task running (`ch.bg.size > 0`, `busy` false). `chatIdle()` refuses to close in that case (`:2855`), and the page disables the tabs only on `busy`. Either refuse on `ch.bg.size` with the busy text, or say in Deviations that a switch stops a background task, as Fork / New chat do today.

### Edge cases the plan should address

- A switch while a background task runs (`bg > 0`, not busy): today Fork / New chat kill it the same way. Decide whether the tabs refuse or accept this.
- A switch that arrives while `chatMessage()` waits for a closing chat (`server.mjs:3109-3113`): the message then opens the old `a.current` or the new one, depending on timing. This is the same race that `chatRestart()` has today; a Deviations line that accepts it is enough.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `cnew` only in `app.js`; `New chat` also in `docs/plans-dashboard.md:286`, which step 11 rewrites; nothing in `apps/plans-mac`)
- [x] Wiring & registration matches the code (route after the shared guard, `server.mjs:3548`, next to `:3580-3581`)
- [x] Scope stays inside the goal; no open decision is taken silently (roadmap: "None at the repo level")
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (403 and 400 cases; 404 does not apply, see Contracts; single-user tool)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (the tests exist, but two of them fail as written: see Blocking)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-130332-chat-session-tabs.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Move the check of the copy tab's `last` text. Do not assert 'and in a copy?' right after the New chat block: the VS Code copy test leaves a 3-byte `ses-copy.jsonl` in the readTranscript() cache, and the cache reads the fork's new file from byte 3, so the first user line is lost and `last` is ''. Assert instead, after "The next message continues the copy", that the ses-copy tab's `last` is 'back in the copy'. In Harness constraints, add one line on why. (evidence: apps/dashboard/test/dashboard.test.mjs:759, :768, :771; apps/dashboard/server.mjs:2744, :2722; FAKE_CLAUDE user log line at test :142)
2. Say where the new test "a root chat's run tab resumes its own session" goes: after the chat test, and best after "a chat outlives a server restart". If it runs before the chat test, its chat fills chatMetaCache for the repo root and adds a `--resume ses-root` spawn, which breaks the chat test's "one lookup for both pages", contextMax and spawns()[0] checks. (evidence: apps/dashboard/server.mjs:2917, :3090-3092; apps/dashboard/test/dashboard.test.mjs:792, :795, :811-812, :995-1029)

SHOULD FIX:
1. End the root-chat test with a wait for idle and then post('/api/chat/new', …) instead of /api/chat/stop, so its claude closes and a late context refresh cannot write its ask file again after finally. Say that the test defines its own until / calls / spawns / chat / history helpers. (evidence: apps/dashboard/server.mjs:3191-3203, :2890-2893)
2. Write the `m` flag on the chatTabsHtml extraction regex, as in the sentLanded test. (evidence: apps/dashboard/test/dashboard.test.mjs:2210)
3. In step 2, write "no extra transcript-folder scan for the tabs" instead of "scanned once per state", because chatState() also scans through chatTranscript(). (evidence: apps/dashboard/server.mjs:2762, :3264-3266)
4. Decide whether chatSwitch() refuses while a background task runs (ch.bg.size > 0), or add a Deviations line saying that a switch stops it, as Fork / New chat do today. (evidence: apps/dashboard/server.mjs:2855, :3220-3221)
5. List the readTranscript() stale-cache defect (a deleted file that is written again larger keeps the old offset) as a sibling defect for the owner. Do not fix it silently in this plan. (evidence: apps/dashboard/server.mjs:2744)

ADD THESE EDGE CASES:
- A switch while a background task runs (bg > 0, not busy).
- A switch that arrives while chatMessage() waits for a closing chat (the same race as chatRestart(); accept it in Deviations).

Do not change anything the validation did not flag.
```
