## Plan validation (codex): 20261127-130332-chat-session-tabs.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data integrity] The VS Code copy path assigns `a.bases[that id]` without initializing `a.bases`, although existing chat files do not have that field. Switching away from such a copy can throw after the open chat has been closed — `.plans/20261127-130332-chat-session-tabs.md:91`, `apps/dashboard/server.mjs:2547` — initialize the map before assignment and add an automated regression test using an old chat file.
- [Integration] `followVscodeCopy()` uses the worktree transcript directory for every pipeline project, while `planSessions()` uses the repo root for an active root chat. The planned switch and tab discovery therefore cannot reliably follow a root chat’s VS Code copy — `apps/dashboard/server.mjs:2557`, `apps/dashboard/server.mjs:2575` — use the same effective root/worktree selection and test both cases.
- [Test coverage] The root-chat test clicks the already open session. The planned early return leaves `current` unchanged, so that test does not exercise switching **back** from a copy or prove that the next message resumes the root session — `.plans/20261127-130332-chat-session-tabs.md:90`, `.plans/20261127-130332-chat-session-tabs.md:129`, `apps/dashboard/server.mjs:3035` — create a copy, switch back to the root session, and assert the next spawn resumes it.
- [Session selection] The plan treats `tabs[0]` as the run session even when the run transcript is missing and the first remaining tab is a copy. It can then consider that copy open while `a.current` is null, or use another copy as its base — `.plans/20261127-130332-chat-session-tabs.md:85`, `.plans/20261127-130332-chat-session-tabs.md:90`, `.plans/20261127-130332-chat-session-tabs.md:92` — identify the run tab by `kind`, define behavior when it is absent, and test switching in that state.

### Non-blocking concerns

- [Verification] The proposed endpoint tests cover success, 400 and 403, but do not specify a 404 case or explain why the local API has no applicable 404 behavior — `.plans/20261127-130332-chat-session-tabs.md:114` — document and test the applicable missing-resource behavior.
- [Verification] The page click handler ignores the response from `post()`, so a busy or stale-tab refusal is not explicitly surfaced by the proposed handler — `.plans/20261127-130332-chat-session-tabs.md:97`, `apps/dashboard/page/app.js:3064` — specify how the page reports a refusal.

### Edge cases the plan should address

- A saved copy exists but the run transcript was deleted: selecting the copy must not silently leave the run selected or assign another copy as its base.
- An old chat file has no `bases` field and its current session moves to a VS Code copy: switching away must retain that copy without throwing.
- A confirmed scout chat has a copy: switching back to its root session must resume that session on the next message.
- A root chat moves to a pipeline worktree: stale root-session copy IDs must not select unrelated worktree transcripts.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-130332-chat-session-tabs.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Initialize a.bases before retaining a VS Code copy, and add an automated regression test with an old chat file that has no bases field. The current instruction can throw after closing the chat (evidence: .plans/20261127-130332-chat-session-tabs.md:91; apps/dashboard/server.mjs:2547).
2. Align followVscodeCopy() transcript-directory selection with planSessions() for active root chats and worktree chats, and test both paths (evidence: apps/dashboard/server.mjs:2557; apps/dashboard/server.mjs:2575).
3. Change the root-chat regression test to create a copy, switch back to the root session, and verify that the next spawn resumes it. Clicking the already open tab only exercises the early return (evidence: .plans/20261127-130332-chat-session-tabs.md:90; .plans/20261127-130332-chat-session-tabs.md:129; apps/dashboard/server.mjs:3035).
4. Identify the run tab by kind rather than assuming tabs[0] is the run. Define and test selection and copy-base behavior when the run transcript is missing (evidence: .plans/20261127-130332-chat-session-tabs.md:85; .plans/20261127-130332-chat-session-tabs.md:90; .plans/20261127-130332-chat-session-tabs.md:92).

SHOULD FIX:
1. Specify and test the applicable missing-resource or 404 behavior for the new endpoint, or explain why it does not apply (evidence: .plans/20261127-130332-chat-session-tabs.md:114).
2. Specify how the page surfaces a switch refusal from a busy chat or stale tab (evidence: .plans/20261127-130332-chat-session-tabs.md:97; apps/dashboard/page/app.js:3064).

ADD THESE EDGE CASES:
- A saved copy remains after the run transcript is deleted.
- An old chat file without bases follows a VS Code copy and then switches away.
- A confirmed scout chat switches from a copy back to its root session and sends another message.
- A root chat moves to a pipeline worktree while root-session copy IDs remain saved.

Do not change anything the validation did not flag.
```