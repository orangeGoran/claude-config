## Plan validation (codex): 20261127-230104-plans-mac-native-parts.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data loss] The proposed `appStatus()` checks only fields currently in the DOM. Chat drafts and pasted images for other plans are held in memory and their fields are removed when another chat is bound — [app.js:1079](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:1079), [app.js:1133](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:1133), [app.js:1674](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:1674). An automatic reload or relaunch can therefore discard unsent work even when `typing` is false. Include all unsent chat drafts and images in the guard, and test switching away from a draft before a reload or relaunch.

### Non-blocking concerns

- [Reference discrepancy] The plan reads `input.file_path` for `NotebookEdit`, but the existing tool summary recognizes `input.notebook_path` — [server.mjs:2609](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:2609). Verify the actual permission payload and use its target field; add a test so the documented button behavior is covered.
- [Contract discrepancy] The breaking-changes section says that off macOS affected alerts have only a card and chime, while the planned `SERVER_RINGS` logic retains browser notifications when the server cannot ring — [plan:35](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:35), [plan:140](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:140). Correct the description.
- [Verification limit] Notification delivery, cold-launch actions, unlock behavior and the Swift UI are not verifiable by this read-only review. The plan assigns them to manual checks; those checks remain open until run on macOS.

### Edge cases the plan should address

- Unsent text or images in a chat that is no longer selected — a reload or relaunch destroys its in-memory draft.
- A `NotebookEdit` permission request with `notebook_path` — confirm whether its complete target can be shown and receive buttons.

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
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Extend the reload and relaunch guard to include unsent chat text and pasted images for every plan, including chats that are not currently selected. Add tests that switch away from a draft before checking the guard. The page stores these in memory while chatBind replaces the visible fields (evidence: apps/dashboard/page/app.js:1079, apps/dashboard/page/app.js:1133, apps/dashboard/page/app.js:1674).

SHOULD FIX:
1. Verify the NotebookEdit permission payload, use its actual target field, and add a test. The existing tool summary recognizes notebook_path (evidence: apps/dashboard/server.mjs:2609).
2. Correct the breaking-changes description of off-macOS browser notifications to match the planned SERVER_RINGS fallback (evidence: .plans/20261127-230104-plans-mac-native-parts.md:35).

ADD THESE EDGE CASES:
- Unsent text and images in a chat that is no longer selected when reload or relaunch is pending.
- A NotebookEdit request carrying notebook_path.

Do not change anything the validation did not flag.
```