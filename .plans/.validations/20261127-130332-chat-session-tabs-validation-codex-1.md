## Plan validation (codex): 20261127-130332-chat-session-tabs.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Session ownership] A VS Code copy is added as a tab only while it is `a.current.id`. Switching away replaces `a.current`, and `followVscodeCopy()` does not add that ID to `a.copies`; the tab then disappears. In a pipeline worktree, the same unrecorded copy can also appear in `planSessions()` as a run session because only `a.copies` is filtered. — `apps/dashboard/server.mjs:2557`, `apps/dashboard/server.mjs:2575`, `.plans/20261127-130332-chat-session-tabs.md:82` — Persist and classify followed VS Code copies before switching away, preserve their base, and test switching away and back in both pipeline and generic projects.
- [Missing transcripts] The plan unconditionally calls `statSync()` for the current session even though it may have no transcript yet. Existing history code explicitly falls back to another available transcript, and `readTranscript()` tolerates a missing file. A missing or deleted current transcript can therefore make chat state fail. — `apps/dashboard/server.mjs:2740`, `apps/dashboard/server.mjs:2761`, `.plans/20261127-130332-chat-session-tabs.md:82` — Define and test how tabs handle missing files and files removed between discovery and stat.
- [Hidden tab row] The planned `.ctabs { display:flex }` rule overrides the browser’s default presentation of the `hidden` attribute, so setting `hidden` alone will not reliably hide the row with fewer than two tabs. The page explicitly overrides `display` for other hidden flex elements. — `apps/dashboard/page/app.css:1023`, `.plans/20261127-130332-chat-session-tabs.md:87` — Add an explicit `.ctabs[hidden] { display:none }` rule and verify the one-tab case.

### Non-blocking concerns

- [Restart rule] The plan lists the restart commands but omits the condition that the relay check must show live chats run under the relay before restarting. — `AGENTS.md:9`, `.plans/20261127-130332-chat-session-tabs.md:20` — Include that condition in the Open items instruction.
- [Verification] `grep -c "id=\"cnew\""` exits with status 1 when the desired zero matches are found, so the successful outcome appears as a failed command. — `.plans/20261127-130332-chat-session-tabs.md:135` — Replace it with a check whose exit status is successful only when the button is absent.
- [Contract] `clip(text, 120)` appends a suffix when text exceeds 120 characters, so it does not produce a string capped at 120 characters as the contract states. — `apps/dashboard/server.mjs:2606`, `.plans/20261127-130332-chat-session-tabs.md:38` — Align the stated limit and implementation.
- [Endpoint tests] The new route has success and invalid-ID cases, but no specified cross-site refusal or invalid project/slug coverage. — `apps/dashboard/server.mjs:3351`, `.plans/20261127-130332-chat-session-tabs.md:99` — Add cases for the applicable 403 and invalid-request or not-found responses; document that sign-in and tenants do not apply.
- [Release note] The changelog rules require its validator, but the verification section does not include it. — `changelog.d/AGENTS.md:7`, `.plans/20261127-130332-chat-session-tabs.md:129` — Include the required validator.
- [Performance] Every state event would read every listed transcript, while the transcript cache retains only 12 files and state events occur during streaming. Many copies can repeatedly evict and reread transcripts. — `apps/dashboard/server.mjs:2603`, `apps/dashboard/server.mjs:2740`, `apps/dashboard/server.mjs:2977` — Define a bounded or cached way to obtain tab metadata and cover cache eviction.

### Edge cases the plan should address

- An older saved chat has copies but no `bases` record, particularly after the run’s latest session changes — the fallback can display the wrong copy ancestry.
- Fork is armed, then the currently selected tab is clicked — define whether that click cancels the pending fork.
- Two sessions have the same first eight ID characters — the visible tab labels become indistinguishable.
- A transcript disappears during tab construction — state and switch requests must remain usable.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [ ] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-130332-chat-session-tabs.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Persist and classify followed VS Code copies before switching away, preserve their base, and test switching away and back in pipeline and generic projects. Otherwise the copy tab disappears, and a pipeline copy can be listed as a run session. (evidence: apps/dashboard/server.mjs:2557, apps/dashboard/server.mjs:2575, .plans/20261127-130332-chat-session-tabs.md:82)
2. Define and test how tab construction handles a missing current transcript and a file removed between discovery and stat; do not let either make chat state fail. (evidence: apps/dashboard/server.mjs:2740, apps/dashboard/server.mjs:2761, .plans/20261127-130332-chat-session-tabs.md:82)
3. Add an explicit .ctabs[hidden] { display:none } rule and verify that the row is hidden with fewer than two tabs. (evidence: apps/dashboard/page/app.css:1023, .plans/20261127-130332-chat-session-tabs.md:87)

SHOULD FIX:
1. State that the dashboard restart runs only when the relay check shows live chats run under the relay. (evidence: AGENTS.md:9, .plans/20261127-130332-chat-session-tabs.md:20)
2. Replace the cnew grep with a check that exits successfully when the button is absent. (evidence: .plans/20261127-130332-chat-session-tabs.md:135)
3. Align the 120-character contract with the behavior of clip(), including its appended suffix. (evidence: apps/dashboard/server.mjs:2606, .plans/20261127-130332-chat-session-tabs.md:38)
4. Add cross-site refusal and invalid project or slug tests for the switch route, and document why sign-in and tenant cases do not apply. (evidence: apps/dashboard/server.mjs:3351, .plans/20261127-130332-chat-session-tabs.md:99)
5. Include the required changelog validator in verification. (evidence: changelog.d/AGENTS.md:7)
6. Specify bounded or cached tab metadata reads and cover transcript-cache eviction. (evidence: apps/dashboard/server.mjs:2603, apps/dashboard/server.mjs:2740, apps/dashboard/server.mjs:2977)

ADD THESE EDGE CASES:
- Older saved chats without bases, including when the latest run session has changed.
- Clicking the selected tab while a fork is armed.
- Session IDs that share their first eight characters.
- A transcript disappearing during tab construction.

Do not change anything the validation did not flag.
```