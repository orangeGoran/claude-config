**Validation round:** 4

## Plan validation: 20261127-130332-chat-session-tabs.md

**Verdict:** APPROVE WITH CHANGES

Focus of this round: the round-3 changes (diff `-pre-round-3.md` → plan): `rootChat()` in step 4, the tab row shown when the open session has no tab, the moved `last` check, the placement and ending of the root-chat test, the new chat-test case with `current` = `ses-gone`, and the bad-slug case. I traced each one against the current `server.mjs`, the fake `claude` and the harness state at that point in `dashboard.test.mjs`. Each one runs as written. No blocking finding.

### Trace of the round-3 changes

- **`rootChat()` in step 4.** `rootChat` exists at `apps/dashboard/server.mjs:2572` (`!!a.root && !(proj.hasPipeline && existsSync(worktreeOf(proj, slug)))`). `chatStart()` resets a root chat that got a worktree at `server.mjs:3032`, and starts a new session without `--resume` when a root chat has no `current` at `server.mjs:3036`. The pin `{ id, base: id, copy: false }` is right, and the harness-constraint line for the worktree case is honest (`demo` has no pipeline, `test/dashboard.test.mjs:217`).
- **Row shown when the open session has no tab (step 7, step 9).** Page `on` = `st.current ? st.current.id : st.latest`. Server open tab = `a.current ? a.current.id : run?.id`. These agree, because `chatState().latest` comes from the same `planSessions().sessions.at(-1)` (`server.mjs:3257`). The rule "`''` when `tabs.length < 2` and `tabs.some((t) => t.id === on)`" gives one button for one tab with `on = 'ses-gone'`. The page test case can pass and can fail.
- **Moved `last` check.** `readTranscript()` resets a cache entry only when `st.size < t.size` (`server.mjs:2744`). The VS Code copy test leaves `ses-copy.jsonl` as `'{}\n'` (`test:759`). Between that test and the fork, no read of other files evicts that entry from the 12-file cache, so the fork's first line is read from byte 3. After `'back in the copy'` the file only grows. The fake logs the user line with `content: c` (`test:142`), so the last `k: 'you'` item is `'back in the copy'`. The new check is sound.
- **Root-chat test placement and ending.** It goes after the restart test (`test:995-1029`). That test ends with `/api/chat/new` on a fresh server. The root test is then the first to fill `chatMetaCache` for `repo` in that server process. No later test counts lookups: the only lookup count is `test:792`, and the Confirm test reads only calls after its own `before` (`test:1645`, `test:1657`). `'home again'` hits none of the fake's special patterns (`hold`, `hang`, `background`, `step`, `late`, `slow`, `plan`, `edit`, `merge`), so it is a plain answer. The fake resumes with `id = a[r + 1]` = `ses-root` (`test:50`), so `ch.session` does not change and the ask file is not rewritten by `chatOnLine`. `chatMessage()`'s `genericRunInfo(proj, slug).live` is false for a slug with no run (`server.mjs:500-501`). The spawn line ends with `--resume ses-root` because the repo has no allow rules (`test:812` proves this for the same cwd). `/api/chat/new` deletes the chat from `chats` before the kill (`server.mjs:3221`), so a late `chatContextRefresh()` returns at `server.mjs:2890` and does not write the ask file again after `finally`.
- **Chat-test case `current` = `ses-gone`.** At that point no `claude` is open (the "switch back to the run tab" step closed it). `followVscodeCopy()` returns early, because the VS Code test removed `.vscode-copies.json` (`test:771`). `chatTabs()` skips `ses-gone`: it has no file, and it is in `copies`. The switch to `ses-mine` goes to the "otherwise" branch, because the open tab is `ses-gone`. The "keep the VS Code copy" part does not fire, because `ses-gone` is not a tab and is in `copies`. `rootChat()` is false, so `current` becomes `null`. The expected values hold.
- **Bad-slug case.** `safeName('../x')` is false (`server.mjs:3349`), so the shared guard at `server.mjs:3548` answers 400. `raw` exists at `test:1135`, and the 403 case mirrors `test:2047-2048`.

### Blocking issues

None.

### Non-blocking concerns

- [Docs / UI] Step 11 says "a click on the open tab cancels a pending Fork". But with no copy the row is hidden (step 7), so a first Fork cannot be cancelled from the page. This matches today: `cnew` is hidden while `current.id === latest` (`apps/dashboard/page/app.js:1424`). Suggestion: write "when the tab row shows, a click on the open tab cancels a pending Fork", so the doc describes what a user can do.
- [Tests / cleanup] The root-chat test calls `/api/chat/new` only at the end of the test body. If an assertion fails after the send, `finally` removes the ask file while `claude` is still open, and a late `chatContextRefresh()` (`server.mjs:2892-2893`) can write `ask/20261127-000000-root-plan.json` again. Suggestion: put `await post('/api/chat/new', …)` at the start of `finally`, before the files are removed.
- [Page] `esc` is `(x || '').replace(...)` (`app.js:60`). A non-zero number passed to it throws. Step 7 passes strings only (`id`, `last`, `new Date(at).toLocaleString()`). Suggestion: tell the implementer never to pass `at` or other numbers raw, or wrap the values in `String()`.

### Edge cases the plan should address

- A switch POST that comes while `chatMessage()` is still awaiting (the 5 s wait for a closing chat at `server.mjs:3111`, or `pipelineLive()` at `server.mjs:3118`). `ch.busy` is not set yet, so the switch succeeds and the typed message goes to the newly selected session. Fork and New chat have the same window today (`chatRestart()`, `server.mjs:3220`). A one-line note under Deviations is enough.
- Zero tabs: for example a root chat whose only transcript is gone. `chatTabsHtml([])` gives `''` by the map, so the row hides. This is fine, but say it, so the implementer does not add a wrapper that renders an empty row.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `cnew` only in `app.js:1143,1192,1424`; "New chat" also in `docs/plans-dashboard.md:286`, which step 11 rewrites)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently (`docs/roadmap.md:41`: no repo-level open decisions)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (no 404 by contract, explained; no tenants)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail (`node --test`, `npm test`, `.claude/scripts/changelog-validate.mjs` exists)

```
Update the plan at .plans/20261127-130332-chat-session-tabs.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 11 (the Fork bullet), write that a click on the open tab cancels a pending Fork only when the tab row shows. With no copy, the row is hidden, as New chat was (evidence: apps/dashboard/page/app.js:1424).
2. In the root-chat test, call post('/api/chat/new', …) at the start of `finally`, before the four files are removed. Then a failed assertion does not leave claude open to write the ask file again (evidence: apps/dashboard/server.mjs:2890-2893).
3. In step 7, say that only strings go into esc / escA (wrap them in String()). esc throws on a non-zero number (evidence: apps/dashboard/page/app.js:60).

ADD THESE EDGE CASES:
- A switch that comes while chatMessage() still awaits (closing wait, pipelineLive) succeeds, and the message goes to the new tab. This is the same window as Fork / New chat today. Note it under Deviations.
- Zero tabs: chatTabsHtml([]) returns '' and the row hides.

Do not change anything the validation did not flag.
```
