## Plan validation (codex): 20261127-195706-groups-ledger-checklist.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Security] The checklist instructions do not escape wait text or its error before inserting them into HTML. Both can contain text from a plan or a command, so a crafted value can execute markup in the dashboard. The existing Scout renderer escapes plan-derived text — `.plans/20261127-195706-groups-ledger-checklist.md:159`, `apps/dashboard/page/app.js:5016` — require `esc()` for both fields and add a page-function test with markup in each.
- [Error handling] `ledgerState()` awaits `buildStateBody()` without a local error branch. A failed state build reaches the server’s global catch, which returns `String(e)` to the caller; that can expose an internal path or other error detail. The plan’s instruction that no error reaches the global catch covers only `ledgerOpen()` — `.plans/20261127-195706-groups-ledger-checklist.md:151`, `apps/dashboard/server.mjs:685`, `apps/dashboard/server.mjs:3594` — handle this failure at the ledger route or helper with a fixed public error, and test the response.

### Non-blocking concerns

- [Data isolation] Group names are case-sensitive in the registry comparison but become directory names on disk. On a case-insensitive Mac filesystem, groups such as `Product` and `product` can resolve to the same ledger while appearing as separate groups — `.plans/20261127-195706-groups-ledger-checklist.md:138`, `.plans/20261127-195706-groups-ledger-checklist.md:149` — define and test a consistent canonical form or reject names that collide.
- [Error handling] The proposed `isFileSafe()` treats every `statSync()` failure as “not a file,” including permission failures. The checklist can therefore say there is no ledger when one exists but cannot be accessed — `.plans/20261127-195706-groups-ledger-checklist.md:151` — distinguish missing or non-file paths from access errors.
- [Responsiveness] Every refresh increments `ckGen`, invalidating the preceding request. If ledger responses consistently take longer than the refresh interval, none can paint — `.plans/20261127-195706-groups-ledger-checklist.md:161`, `apps/dashboard/page/app.js:4350` — coalesce refreshes or allow an in-flight request for the current selection to finish.

### Edge cases the plan should address

- A closed PR with a fresh running report but no live process or starting launch — the proposed rule reports `closed` before checking the running report, although the watcher counts that report as running.
- Ledger read and state-build failures — verify the page receives a useful, fixed error without internal details.
- A valid Markdown file ending in a real replacement character at the size limit — removing a trailing `�` unconditionally can remove content that was not cut.

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
1. Require HTML escaping of both wait text and wait errors in checklistHtml(), and add a page-function test with markup in each value. The existing Scout renderer escapes plan-derived text. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:159; apps/dashboard/page/app.js:5016)
2. Handle buildStateBody() failures in the ledger route or helper with a fixed public error, and test that internal error details do not reach the response. The global catch otherwise returns String(e). (evidence: .plans/20261127-195706-groups-ledger-checklist.md:151; apps/dashboard/server.mjs:685; apps/dashboard/server.mjs:3594)

SHOULD FIX:
1. Define and test a consistent group-name canonical form, or reject names that collide on a case-insensitive filesystem. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:138; .plans/20261127-195706-groups-ledger-checklist.md:149)
2. Distinguish missing or non-file ledger paths from stat permission errors, and show an access error for the latter. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:151)
3. Coalesce checklist refreshes or let an in-flight request for the current selection finish, so repeated slow responses can still paint. (evidence: .plans/20261127-195706-groups-ledger-checklist.md:161; apps/dashboard/page/app.js:4350)

ADD THESE EDGE CASES:
- A closed PR with a fresh running report but no live process or starting launch.
- Ledger read and state-build failures, including a fixed public response without internal details.
- A valid Markdown file ending in a real replacement character at the read limit.

Do not change anything the validation did not flag.
```