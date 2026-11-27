## Plan validation (codex): 20261127-195706-groups-ledger-checklist.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Error handling] `ledgerOpen()` treats every `EEXIST` as an existing ledger, but exclusive creation also reports `EEXIST` when `ledger.md` is a directory. The plan then opens that directory and returns success, contrary to its directory test. The planned `mkdirSync` also sits outside the specified `try`, so a directory-creation failure reaches the server’s global catch, which returns the internal error string. — [.plans/20261127-195706-groups-ledger-checklist.md:151](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:151), [apps/dashboard/server.mjs:3594](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:3594) — Catch both operations, verify that an existing target is a regular file, and return a controlled error for other targets.
- [Concurrency] The checklist checks only the currently selected group and drawer title after a fetch. If the owner switches A → B → A, or closes and reopens the checklist, an older A response can still overwrite a newer one. The plan’s fast-switch test expects the last selection to win. — [.plans/20261127-195706-groups-ledger-checklist.md:160](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:160), [.plans/20261127-195706-groups-ledger-checklist.md:233](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:233) — Use a request generation or equivalent cancellation guard and test responses arriving out of order.

### Non-blocking concerns

- [UI refresh] The repaint cache compares only the ledger response, although the group selector also depends on the separate `state` array. Adding or removing another group can leave the selector stale while the selected group’s response is unchanged. — [.plans/20261127-195706-groups-ledger-checklist.md:160](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:160), [apps/dashboard/page/app.js:4384](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:4384) — Include the group list and selection in the repaint key.
- [Status] A report with outcome `running` is classified as running regardless of age, while the existing watcher excludes stale running reports. This can leave a stopped plan displayed as running. — [.plans/20261127-195706-groups-ledger-checklist.md:141](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:141), [apps/dashboard/watch.mjs:89](/Users/gorantubic/Workspace/claude-config/apps/dashboard/watch.mjs:89) — Align the rule with the existing freshness check or explain the different meaning.

### Edge cases the plan should address

- A ledger target is a directory, and the parent directory cannot be created — both must return a controlled failure without opening VS Code.
- Two requests for the same group finish in reverse order, including after closing and reopening the drawer.
- The available group list changes while the selected group’s ledger response remains identical.
- A `running` report is stale and no live process or starting launch exists.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
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
1. Catch errors from both directory creation and exclusive file creation. On EEXIST, verify that ledger.md is a regular file before treating it as an existing ledger; return a controlled failure and do not open VS Code for a directory or other invalid target. Avoid passing internal error strings through the global handler. Update the directory and permission-error tests accordingly. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:151; apps/dashboard/server.mjs:3594)
2. Guard checklist requests with a generation or equivalent cancellation mechanism so an older response cannot repaint after A → B → A or after the drawer is closed and reopened. Add an out-of-order response test. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:160; .plans/20261127-195706-groups-ledger-checklist.md:233)

SHOULD FIX:
1. Include the available group list and selected group in the checklist repaint key so changes to the selector are displayed even when the ledger response is unchanged. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:160; apps/dashboard/page/app.js:4384)
2. Align running-report classification with the existing freshness check, or explain and test the intended difference. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:141; apps/dashboard/watch.mjs:89)

ADD THESE EDGE CASES:
- The ledger target is a directory, and creation of its parent directory fails.
- Same-group requests finish in reverse order, including after closing and reopening the drawer.
- The group list changes while the selected group’s ledger response stays identical.
- A running report is stale with no live process or starting launch.

Do not change anything the validation did not flag.
```