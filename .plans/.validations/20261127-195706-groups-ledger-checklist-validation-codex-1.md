## Plan validation (codex): 20261127-195706-groups-ledger-checklist.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Wiring] The planned `/api/ledger/open` route sits next to `/api/vscode`, after the POST handler rejects requests without a project and slug. The checklist sends only `{ group }`, so the request will return `400 bad request` before reaching the new route. — [server.mjs:3551](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:3551), [plan:149](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:149) — Place the route before that guard.
- [Refresh] The plan puts `renderChecklist()` after `renderBoard()`, inside the branch that runs only when `/api/state` changes. Editing `ledger.md` alone does not change that response, so the goal may never appear at the next refresh. — [app.js:4373](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:4373), [app.js:4415](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:4415) — Poll the open checklist on every successful refresh, including unchanged state.
- [Integration] The planned response cache survives closing the drawer, while opening it replaces `#logbody` with “loading…”. Reopening with an unchanged response therefore skips the repaint and leaves the drawer loading. — [plan:155](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:155), [app.js:3232](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:3232), [app.js:4995](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:4995) — Clear the cache on open or tie it to the currently rendered content.
- [Async integration] The planned checklist fetch checks the drawer before awaiting but does not recheck it afterward. A delayed response can overwrite another drawer or an earlier group selection. The Scout reference explicitly checks again after its fetch. — [plan:155](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:155), [app.js:5041](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:5041) — Recheck the active drawer and selected group after the fetch, and discard stale responses.

### Non-blocking concerns

- [Ticket parsing] The proposed regex can interpret a fragment of malformed or overlong ticket text as a separate local ticket. Define boundaries and test malformed references. — [plan:137](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:137)
- [Verification] The two `grep` commands succeed if a match exists in any named file; they do not establish that every intended hook location was updated. Use checks that fail for each missing location. — [plan:242](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:242)
- [Read limits] The ledger test asserts a byte limit using JavaScript string length, which differs for multibyte UTF-8. Specify behavior for a character split at the limit and test it. — [plan:147](/Users/gorantubic/Workspace/claude-config/.plans/20261127-195706-groups-ledger-checklist.md:147)

### Edge cases the plan should address

- Reopen the checklist with an unchanged response, and switch groups or drawers while requests are in flight.
- Edit only the ledger while `/api/state` remains unchanged.
- Test malformed and overlong ticket references, plus UTF-8 text crossing the ledger read limit.
- Test concurrent first opens of the same ledger and verify that existing text is preserved.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-195706-groups-ledger-checklist.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Place POST /api/ledger/open before the POST handler's project-and-slug guard, and test a request containing only group. The existing guard rejects it before the planned route beside /api/vscode (evidence: apps/dashboard/server.mjs:3551; .plans/20261127-195706-groups-ledger-checklist.md:149).
2. Poll the open checklist on every successful refresh, including when /api/state is unchanged, and test a ledger-only edit (evidence: apps/dashboard/page/app.js:4373; apps/dashboard/page/app.js:4415).
3. Clear the checklist response cache on open, or tie it to the rendered content, and test closing and reopening with unchanged data (evidence: .plans/20261127-195706-groups-ledger-checklist.md:155; apps/dashboard/page/app.js:3232; apps/dashboard/page/app.js:4995).
4. Recheck that the checklist is still open and the requested group is still selected after the fetch; discard stale responses and test group and drawer switches during a delayed request (evidence: .plans/20261127-195706-groups-ledger-checklist.md:155; apps/dashboard/page/app.js:5041).

SHOULD FIX:
1. Define ticket-reference boundaries and test malformed and overlong references so partial matches do not become local tickets (evidence: .plans/20261127-195706-groups-ledger-checklist.md:137).
2. Make verification fail when any required hook location is missing, rather than relying on a grep that can match only one file (evidence: .plans/20261127-195706-groups-ledger-checklist.md:242).
3. Define and test UTF-8 behavior at the 256 KB read boundary without equating byte count with JavaScript string length (evidence: .plans/20261127-195706-groups-ledger-checklist.md:147).

ADD THESE EDGE CASES:
- Reopen the checklist with an unchanged response, and switch groups or drawers while requests are in flight.
- Edit only the ledger while /api/state remains unchanged.
- Test malformed and overlong ticket references, plus UTF-8 text crossing the ledger read limit.
- Test concurrent first opens of the same ledger and verify that existing text is preserved.

Do not change anything the validation did not flag.
```