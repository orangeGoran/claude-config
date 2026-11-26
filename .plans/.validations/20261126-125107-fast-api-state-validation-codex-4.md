## Plan validation (codex): 20261126-125107-fast-api-state.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Freshness] An in-flight build is shared regardless of its age. If a file or in-memory state changes just after the build reads it and the build takes longer than one poll, later requests still receive that old result. This contradicts the plan’s one-poll freshness rule — `.plans/20261126-125107-fast-api-state.md:19`, `.plans/20261126-125107-fast-api-state.md:114` — specify how an expired in-flight result is handled, and test a change during a build that lasts longer than the cache window.

### Non-blocking concerns

- [Performance] The plan does not establish that other endpoints stay responsive during a build: `listPlans()` still performs synchronous file operations, and `claudeProcessCwds()` can call `execFileSync` — `apps/dashboard/server.mjs:385`, `apps/dashboard/server.mjs:505` — retain the real-data acceptance check and report the goal as unverified until it passes.
- [Concurrency] Invalidating the generation permits a new build while an older build is still running, so the claim that there is always at most one build is inaccurate — `.plans/20261126-125107-fast-api-state.md:72`, `.plans/20261126-125107-fast-api-state.md:114` — describe and test this overlap.
- [Verification] The `finally` clause cannot guarantee cleanup when a client disconnects while `body(req)` awaits an `end` event that never arrives — `apps/dashboard/server.mjs:3244`, `.plans/20261126-125107-fast-api-state.md:121` — qualify the claim or handle and test aborted request bodies.

### Edge cases the plan should address

- A validation directory is replaced with another directory having the same mtime — the index can retain the old listing.
- A non-GET request invalidates the cache while a state build is in flight — verify which result each waiting GET receives and that an older build cannot become the current cached result.

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
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Specify how the cache avoids returning an in-flight build that has exceeded the one-poll freshness limit, and add a test in which state changes after it was read during a build lasting longer than the cache window. (evidence: .plans/20261126-125107-fast-api-state.md:19, .plans/20261126-125107-fast-api-state.md:114)

SHOULD FIX:
1. Keep the real-data performance check and state that responsiveness during a build is unverified until it passes; synchronous work remains in the build. (evidence: apps/dashboard/server.mjs:385, apps/dashboard/server.mjs:505)
2. Correct the claim that only one build can run at a time after invalidation, and test overlapping generations. (evidence: .plans/20261126-125107-fast-api-state.md:72, .plans/20261126-125107-fast-api-state.md:114)
3. Qualify the disconnect cleanup claim or handle and test aborted request bodies. (evidence: apps/dashboard/server.mjs:3244, .plans/20261126-125107-fast-api-state.md:121)

ADD THESE EDGE CASES:
- A validation directory is replaced by one with the same mtime.
- A non-GET request invalidates the cache while a state build is in flight; verify waiting GET results and cache ownership.

Do not change anything the validation did not flag.
```