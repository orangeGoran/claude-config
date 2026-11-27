## Plan validation (codex): 20261127-130332-chat-session-tabs.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Integration] A VS Code copy in a pipeline project can be classified as the run’s latest session instead of a copy. Pipeline projects list all transcripts in the worktree unless their IDs are already in `copies`; `followVscodeCopy()` changes `current.id` without adding the new ID to `copies` ([server.mjs:2557](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:2557), [server.mjs:2575](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:2575)). The planned classification takes `sessions.at(-1)` as the run and only preserves a departing current session when it is absent from `ps.sessions` ([plan:87](/Users/gorantubic/Workspace/claude-config/.plans/20261127-130332-chat-session-tabs.md:87), [plan:93](/Users/gorantubic/Workspace/claude-config/.plans/20261127-130332-chat-session-tabs.md:93)). A recently continued VS Code copy can therefore replace the run tab, and switching to it can resume the wrong session. Define how to identify and persist VS Code copies before selecting the run, and test this with a pipeline project.

- [User flow] A pending Fork cannot be cancelled from a chat with only its run session. The plan hides the single open tab ([plan:98](/Users/gorantubic/Workspace/claude-config/.plans/20261127-130332-chat-session-tabs.md:98)), while the existing page disables Fork when it is pending ([app.js:1425](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:1425)). The planned cancellation requires clicking the open tab ([plan:92](/Users/gorantubic/Workspace/claude-config/.plans/20261127-130332-chat-session-tabs.md:92)), which is unavailable in this common case. Show a cancellation control or the open tab while Fork is pending, and test that flow.

### Non-blocking concerns

- [Tests] The planned tab preview relies on a transcript cache known to retain stale data when a file is replaced by a larger file ([plan:121](/Users/gorantubic/Workspace/claude-config/.plans/20261127-130332-chat-session-tabs.md:121), [server.mjs:2740](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:2740)). Address replacement detection or explicitly document the limitation and cover it with a test.
- [Verification] The browser test compares against a live dashboard and uses a test dashboard with a project containing sessions ([plan:166](/Users/gorantubic/Workspace/claude-config/.plans/20261127-130332-chat-session-tabs.md:166)). Specify disposable test data and a separate test `HOME`, so creating copies does not modify real chat state.

### Edge cases the plan should address

- A VS Code copy in a pipeline worktree becomes newer than its source before the user switches tabs.
- Fork is pending when the run is the only available tab.
- A transcript is replaced with a larger file at the same path; its cached last message may be stale.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
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
1. Identify and persist VS Code copies before selecting the latest run session, including for pipeline projects whose worktree transcript directory is listed whole. Add a pipeline-project test proving that a newer VS Code copy remains a copy tab and that the run tab resumes the run session. (Evidence: apps/dashboard/server.mjs:2557, apps/dashboard/server.mjs:2575, .plans/20261127-130332-chat-session-tabs.md:87, .plans/20261127-130332-chat-session-tabs.md:93.)
2. Make pending Fork cancellable when the open run is the only tab, for example by showing that tab while Fork is pending. Add a test for this flow. (Evidence: .plans/20261127-130332-chat-session-tabs.md:92, .plans/20261127-130332-chat-session-tabs.md:98, apps/dashboard/page/app.js:1425.)

SHOULD FIX:
1. Address or explicitly document stale tab previews when a transcript is replaced by a larger file at the same path, and add a test. (Evidence: .plans/20261127-130332-chat-session-tabs.md:121, apps/dashboard/server.mjs:2740.)
2. Specify disposable project data and a separate test HOME for the browser test so that making copies does not modify real chat state. (Evidence: .plans/20261127-130332-chat-session-tabs.md:166.)

ADD THESE EDGE CASES:
- A VS Code copy in a pipeline worktree becomes newer than its source before a tab switch.
- Fork is pending when the run is the only available tab.
- A transcript is replaced with a larger file at the same path.

Do not change anything the validation did not flag.
```