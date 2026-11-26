## Plan validation (codex): 20261126-125107-fast-api-state.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Freshness] The proposed cache can serve data older than the owner’s one-poll limit. A change made after its field was read can remain absent for the rest of the build **plus** the full one-second cache window; the next poll can therefore receive stale data more than one second after the change. The plan explicitly describes that window but calls it one poll — `.plans/20261126-125107-fast-api-state.md:19`, `.plans/20261126-125107-fast-api-state.md:71`, `apps/dashboard/server.mjs:574` — define a freshness mechanism and test that meet the stated limit, or obtain an owner decision to change it.
- [Error handling] The planned `finally` does not necessarily run when a client disconnects while the handler awaits a request body: `body()` resolves only on `end`, with no aborted or error handling. The handler can remain pending indefinitely — `apps/dashboard/server.mjs:3243`, `.plans/20261126-125107-fast-api-state.md:120` — handle aborted requests so pending body reads settle, and test that invalidation completes after a disconnect.
- [Process safety] The measurement instructions infer ownership from a port being free before startup, then kill whichever PID later listens there. Another process can acquire that port before the test server binds, or after it exits, so the command can stop an unrelated process — `.plans/20261126-125107-fast-api-state.md:29`, `.plans/20261126-125107-fast-api-state.md:214` — retain each spawned server’s PID, verify startup and ownership, and stop only that child.
- [Public data] The comparison prints arbitrary differing JSON paths, including session and run state, and the plan calls for those paths in the run report; it also directs measurement numbers to the changelog. The state includes project and filesystem information, and live-data output can contain private identifiers — `apps/dashboard/server.mjs:574`, `.plans/20261126-125107-fast-api-state.md:135`, `.plans/20261126-125107-fast-api-state.md:148` — specify a safe, aggregate-only output and release note, with no live identifiers or paths.

### Non-blocking concerns

- [Verification] The claim that a disconnect reaches `finally` also needs coverage for an already-started asynchronous action, separate from an incomplete request body — `apps/dashboard/server.mjs:3472` — add a controlled test for both cases.
- [Measurement] The two measurement servers both default to the QA reports port, so they conflict with each other or the live dashboard’s report server — `apps/dashboard/server.mjs:48`, `apps/dashboard/server.mjs:3818` — assign separate free QA ports.
- [Verification] The real-data performance and comparison claims were not verified during this read-only review. The plan’s isolated measurement must establish them — `.plans/20261126-125107-fast-api-state.md:214`.

### Edge cases the plan should address

- A file changes after its field was read but before a slow build completes — verify the next polls respect the freshness limit.
- A client disconnects before completing a POST body, or while an asynchronous action is running — ensure the request settles and the cache is invalidated.
- A measurement server fails to bind and another process acquires its intended port — cleanup must leave that process alone.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected
- [x] Global rules affect every project respected
- [ ] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Define and test a cache freshness mechanism that meets the owner’s one-poll limit when a field changes during a slow build, or obtain an owner decision to change that limit. The proposed window lasts for the rest of the build plus one second. (evidence: .plans/20261126-125107-fast-api-state.md:19, .plans/20261126-125107-fast-api-state.md:71, apps/dashboard/server.mjs:574)
2. Make aborted request-body reads settle so the handler’s finally can invalidate the cache, and test a disconnect before the POST body ends. (evidence: apps/dashboard/server.mjs:3243, .plans/20261126-125107-fast-api-state.md:120)
3. Retain each measurement server’s spawned PID, verify its startup and ownership, and stop only that child. Do not infer ownership solely from a previously free port. (evidence: .plans/20261126-125107-fast-api-state.md:29, .plans/20261126-125107-fast-api-state.md:214)
4. Restrict comparison output, run-report contents and the changelog to safe aggregates; exclude live project identifiers, filesystem paths and other private data. (evidence: apps/dashboard/server.mjs:574, .plans/20261126-125107-fast-api-state.md:135, .plans/20261126-125107-fast-api-state.md:148)

SHOULD FIX:
1. Test invalidation after a disconnect during an already-started asynchronous action as well as during an incomplete body. (evidence: apps/dashboard/server.mjs:3472)
2. Give the two measurement servers separate free QA reports ports. (evidence: apps/dashboard/server.mjs:48, apps/dashboard/server.mjs:3818)

ADD THESE EDGE CASES:
- A file changes after its field was read but before a slow state build completes.
- A client disconnects before completing a POST body or during an asynchronous action.
- A test server fails to bind and another process acquires its intended port.

Do not change anything the validation did not flag.
```