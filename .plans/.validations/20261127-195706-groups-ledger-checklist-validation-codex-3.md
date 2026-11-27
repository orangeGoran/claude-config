## Plan validation (codex): 20261127-195706-groups-ledger-checklist.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Integration] Changing the group select can leave the old group displayed. The change handler calls `renderChecklist()`, but its repaint guard returns while `#ckGroup` is the active element—the normal state immediately after a change. The select can remain focused through later refreshes. — [.plans/20261127-195706-groups-ledger-checklist.md:158](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:158) — Permit a repaint caused by a completed selection change while still protecting an open or actively used select; test that the new group actually appears.

- [Concurrency] A pending ledger request is not invalidated when the last group disappears: the no-`pick` branch paints and returns before incrementing `ckGen`. If the old request then completes while the drawer remains open, its generation still matches and it paints the removed group over the empty state. — [.plans/20261127-195706-groups-ledger-checklist.md:158](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:158) — Invalidate pending requests before every early return or drawer transition, and test removal of the last group while a request is pending.

- [Error handling] `ledgerOpen()` calls `statSync(f)` inside its `EEXIST` catch without handling a failure of that call. A concurrent removal or a permission error can therefore escape to the server’s global catch, which returns a 500 containing `String(e)`, contrary to the specified safe error response. — [.plans/20261127-195706-groups-ledger-checklist.md:150](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:150), [server.mjs:3594](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:3594) — Handle errors from the existence check within the ledger operation and return the specified bounded error; test the race or an equivalent injected failure.

### Non-blocking concerns

- [Verification] The browser plan requires a fake PR in a separately started dashboard, but does not specify how to provide the watcher test’s fake `gh` environment to that process. The existing fake data belongs to the test harness. — [.plans/20261127-195706-groups-ledger-checklist.md:227](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:227), [watcher.test.mjs:129](/Users/gorantubic/Workspace/claude-config/apps/dashboard/test/watcher.test.mjs:129) — Specify a reproducible isolated setup for the manual check.

### Edge cases the plan should address

- A selected group is removed while its request is in flight — the empty state must remain visible.
- The group select retains focus after a change — the selected group’s data must still appear.
- A ledger disappears or becomes inaccessible between exclusive creation and the follow-up file check — the route must return its defined error response.

### Checklist

- [x] All referenced files, functions and types exist, and each call would compile
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
Update the plan at .plans/20261127-195706-groups-ledger-checklist.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Change the checklist select repaint guard so a completed group change can repaint while the select retains focus, and add a test that confirms the newly selected group appears. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:158)
2. Invalidate pending checklist requests before the no-group early return and on relevant drawer transitions; test removal of the last group while a request is pending. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:158)
3. Catch failures from the statSync check inside ledgerOpen's EEXIST handling and return the defined bounded error instead of allowing the global 500 handler to expose the exception; add a race or injected-failure test. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:150, apps/dashboard/server.mjs:3594)

SHOULD FIX:
1. Specify how the separate manual browser-test dashboard receives isolated fake gh responses and PR data. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:227, apps/dashboard/test/watcher.test.mjs:129)

ADD THESE EDGE CASES:
- Remove the selected and last group while its ledger request is in flight.
- Change the group while the select keeps focus.
- Remove or make the ledger inaccessible between exclusive creation and the follow-up file check.

Do not change anything the validation did not flag.
```