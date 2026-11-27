## Plan validation (codex): 20261127-130332-chat-session-tabs.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Session lifecycle] The plan selects the run tab using `a.root`, but a pipeline plan can retain `a.root` after its worktree appears. In that state, `chatStart()` clears `current` when the next message starts, so switching to a copy can appear to succeed while the message continues the run instead. — `apps/dashboard/server.mjs:2572`, `apps/dashboard/server.mjs:3028`, `.plans/20261127-130332-chat-session-tabs.md:93` — Normalize the root-to-worktree transition before building tabs or switching, and test switching to a worktree copy after that transition.

- [Recovery] The plan removes New chat and hides the tab row when fewer than two transcript files exist. If the current copy’s transcript is missing while the run transcript exists, only the run tab remains and the user has no control to return to it. The existing New chat control remains visible whenever current differs from latest. — `apps/dashboard/page/app.js:1424`, `.plans/20261127-130332-chat-session-tabs.md:86`, `.plans/20261127-130332-chat-session-tabs.md:96` — Provide a reachable return-to-run control in this state and add a test for a missing current transcript.

### Non-blocking concerns

- [Performance] The proposed cache holds 100 summaries, but a cache miss reads each full transcript through a cache that retains only 12 transcripts. A state refresh after many transcripts change can repeatedly evict the currently displayed transcript. — `apps/dashboard/server.mjs:2604`, `apps/dashboard/server.mjs:2740`, `.plans/20261127-130332-chat-session-tabs.md:86` — Consider a bounded summary reader that does not displace history entries, and cover cache eviction in review or testing.

- [Verification] The new endpoint’s tests cover a bad project and cross-site request, but do not explicitly cover a bad slug or an unknown route’s 404. The plan specifies unknown session IDs as application-level refusals. — `apps/dashboard/server.mjs:3547`, `.plans/20261127-130332-chat-session-tabs.md:139` — Add assertions for the shared bad-slug guard and 404 behavior, or explain why existing tests establish them.

### Edge cases the plan should address

- A root chat gains a worktree, then the user selects a worktree copy before sending a message — the selected session must survive the transition.
- The current copy’s transcript is deleted while the run transcript remains — the user must still be able to return to the run.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-130332-chat-session-tabs.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Normalize the root-chat-to-worktree transition before building or switching tabs, so chatStart cannot discard a selected worktree copy. Add a test that switches to a copy after the worktree appears and verifies the next message resumes it. (evidence: apps/dashboard/server.mjs:2572, apps/dashboard/server.mjs:3028, .plans/20261127-130332-chat-session-tabs.md:93)
2. Keep a reachable way to return to the run when the current copy transcript is missing and only the run tab remains. Add a test for this state. (evidence: apps/dashboard/page/app.js:1424, .plans/20261127-130332-chat-session-tabs.md:86, .plans/20261127-130332-chat-session-tabs.md:96)

SHOULD FIX:
1. Assess whether summary reads can evict the active history transcript from the 12-entry transcript cache, and specify a bounded approach or review coverage. (evidence: apps/dashboard/server.mjs:2604, apps/dashboard/server.mjs:2740, .plans/20261127-130332-chat-session-tabs.md:86)
2. Add endpoint tests for a bad slug and unknown-route 404, or explain how existing tests establish those shared behaviors. (evidence: apps/dashboard/server.mjs:3547, .plans/20261127-130332-chat-session-tabs.md:139)

ADD THESE EDGE CASES:
- A root chat gains a worktree, then the user selects a worktree copy before sending a message.
- The current copy’s transcript is deleted while the run transcript remains.

Do not change anything the validation did not flag.
```