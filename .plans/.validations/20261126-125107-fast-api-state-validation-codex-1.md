## Plan validation (codex): 20261126-125107-fast-api-state.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Performance] The shared promise does not move synchronous work off the event loop. `listPlans()` still reads files and builds archived rows synchronously, so `/api/usage` can still wait during a build; the proposed cache only reduces repeated work. The plan allows a failed load check to become an open item while the release note claims the goal was met. — `apps/dashboard/server.mjs:512`, `apps/dashboard/server.mjs:547`, `.plans/20261126-125107-fast-api-state.md:118` — Make the acceptance result govern the shipped claims and outcome; if it fails, report the goal as unmet rather than stating that other requests no longer wait.
- [Test coverage] The parallel-request test uses a 60-second result cache, so it passes even if every request arrives after the first build and no in-flight sharing exists. The existing startup pattern also probes `/api/state` before returning, which can populate that cache before the five requests. — `apps/dashboard/test/dashboard.test.mjs:173`, `.plans/20261126-125107-fast-api-state.md:135` — Specify a readiness check that does not build state and a controlled overlapping-build test that fails when in-flight sharing is removed.
- [Test freshness] Only `dashboard.test.mjs` disables the result cache. The separate watcher harness also polls `/api/state` and reads changing watcher state, so its assertions can observe cached values under the new default. — `apps/dashboard/test/watcher.test.mjs:83`, `apps/dashboard/test/watcher.test.mjs:165` — Set `DASH_STATE_CACHE_MS=0` in that harness or explicitly adapt and verify its tests.
- [Process safety] The measurement cleanup kills whichever process is listening on ports 4911 and 4912. If either test server fails to bind because the port is already occupied, this can kill an unrelated process. — `apps/dashboard/server.mjs:3827`, `.plans/20261126-125107-fast-api-state.md:180` — Capture each spawned server’s PID, verify startup, and clean up only those PIDs.

### Non-blocking concerns

- [Verification] The load script specifies latency thresholds but does not require successful HTTP status codes, valid bodies, nonzero samples, or valid arguments. Fast error responses could pass the timing check. — `.plans/20261126-125107-fast-api-state.md:110` — Require these checks and a nonzero exit on failure.
- [Release note] The stated `audience: internal` conflicts with the changelog guidance for a user-visible performance change. — `changelog.d/README.md:37` — Reassess the audience and add customer text if applicable.
- [References] The plan omits `scripts/docs-media.mjs` from its `/api/state` consumer list. — `scripts/docs-media.mjs:227` — Include it in the consumer review.

### Edge cases the plan should address

- A POST overlaps an in-flight build, or the response closes before `finish` — verify that later GETs cannot reuse stale state.
- A validation directory is removed and recreated, or a report is replaced with the same size and timestamp — define and test the intended cache freshness.
- A build fails — verify that a later request retries and that the existing error handler remains responsible for the response.
- The cache TTL expires during a slow build — verify the next request’s behavior and describe freshness accordingly.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [ ] Release note step present (or `no-changelog` justified)

The performance claims and real-data comparison were **not verified**: the skill limits this review to reading. The plan’s controlled load and comparison runs would provide that evidence.

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the measured acceptance result govern the outcome and release claims. The shared promise does not move synchronous list building off the event loop; if the load check fails, report the goal as unmet rather than claiming other requests no longer wait. (evidence: apps/dashboard/server.mjs:512, apps/dashboard/server.mjs:547, .plans/20261126-125107-fast-api-state.md:118)
2. Specify readiness without an /api/state build and a controlled overlapping-build test that fails when in-flight sharing is removed. A 60-second result cache alone can make sequential requests pass, and the existing startup probe builds state. (evidence: apps/dashboard/test/dashboard.test.mjs:173, .plans/20261126-125107-fast-api-state.md:135)
3. Disable the result cache in the watcher test harness or explicitly adapt and verify its changing-state assertions. (evidence: apps/dashboard/test/watcher.test.mjs:83, apps/dashboard/test/watcher.test.mjs:165)
4. Capture each measurement server's PID, verify it started, and stop only that PID; do not kill an arbitrary listener on a selected port after a bind failure. (evidence: apps/dashboard/server.mjs:3827, .plans/20261126-125107-fast-api-state.md:180)

SHOULD FIX:
1. Require the load script to reject unsuccessful HTTP responses, invalid bodies or arguments, and zero samples. (evidence: .plans/20261126-125107-fast-api-state.md:110)
2. Reassess the changelog audience for the user-visible performance change and add customer text if applicable. (evidence: changelog.d/README.md:37)
3. Include the docs-media readiness probe in the /api/state consumer review. (evidence: scripts/docs-media.mjs:227)

ADD THESE EDGE CASES:
- A POST overlaps an in-flight build, or its response closes before finish.
- A validation directory is removed and recreated, or a report is replaced with the same size and timestamp.
- A failed build is retried and uses the existing error handler.
- The cache TTL expires during a slow build.

Do not change anything the validation did not flag.
```