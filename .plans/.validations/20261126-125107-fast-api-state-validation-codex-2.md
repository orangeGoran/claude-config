## Plan validation (codex): 20261126-125107-fast-api-state.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Cache invalidation] A client can disconnect while an asynchronous POST is still running. The planned `close` handler invalidates the cache at disconnect, but the POST can subsequently finish its mutation after a GET has built and cached state — [plan:119](/Users/gorantubic/Workspace/claude-config/.plans/20261126-125107-fast-api-state.md:119), [server.mjs:3465](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:3465) — the next GET can return stale state despite the plan’s freshness guarantee. Invalidate again when the request handler’s work settles, including after a disconnected client, and test an asynchronous mutation with a disconnect.
- [Error handling] The new shared-build failure path rethrows to a handler that returns `String(e)` to the client — [plan:116](/Users/gorantubic/Workspace/claude-config/.plans/20261126-125107-fast-api-state.md:116), [server.mjs:3490](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:3490) — filesystem errors can expose internal paths or other internal details in the response. Specify a sanitized response for build failures and test that an internal error is not echoed.
- [Tests] The load-script test uses a three-second run while each client starts after a random delay of up to five seconds — [plan:127](/Users/gorantubic/Workspace/claude-config/.plans/20261126-125107-fast-api-state.md:127), [plan:169](/Users/gorantubic/Workspace/claude-config/.plans/20261126-125107-fast-api-state.md:169) — both clients can start after the run ends, causing the required zero-sample failure. Make the test deterministic, including control of start offsets and timing, and test the threshold failure paths without depending on machine speed.

### Non-blocking concerns

- [Measurement] The plan’s performance and freshness claims cannot be verified by reading. The synchronous filesystem work in `listPlans()` and `fullState()` remains on the event loop — [server.mjs:508](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:508), [server.mjs:574](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:574). The specified real-data load measurement is needed to establish whether the targets are met.
- [Cache lifecycle] A missing validation folder returns an empty map without removing its existing `validIndexes` entry or associated text entries — [plan:108](/Users/gorantubic/Workspace/claude-config/.plans/20261126-125107-fast-api-state.md:108). Specify cleanup for deleted folders and projects to prevent stale entries accumulating.
- [Documentation] The roadmap sentence says the server keeps state for two seconds even when `DASH_STATE_CACHE_MS` changes that duration — [plan:139](/Users/gorantubic/Workspace/claude-config/.plans/20261126-125107-fast-api-state.md:139). Describe two seconds as the default.
- [Verification] The rule-file listing completed but Git printed sandbox cache errors. No additional applicable rules were listed; confirming the listing in a normal environment would remove that uncertainty.

### Edge cases the plan should address

- A POST disconnects before an awaited mutation completes, while a GET builds state in between — the mutation must invalidate that build after it settles.
- A build fails while another generation is running — the failure must not clear the newer build, and the response must not expose the internal error.
- Validation folders or registered projects disappear and later return — cached indexes and text entries need a defined lifecycle.
- A short load run receives no samples, or a request hangs — the measurement must terminate and report failure deterministically.

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
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Invalidate state when a non-GET handler’s work settles even if the client disconnected earlier, and add a test with a disconnected client, an asynchronous mutation and an intervening GET. The response close event can occur before awaited mutations finish. (evidence: .plans/20261126-125107-fast-api-state.md:119; apps/dashboard/server.mjs:3465)
2. Specify a sanitized response for shared-build failures and test that internal errors are not returned to the client. The existing handler echoes String(e). (evidence: .plans/20261126-125107-fast-api-state.md:116; apps/dashboard/server.mjs:3490)
3. Make the load-script test deterministic by controlling its start offsets and timing, and test threshold failures without relying on machine speed. A three-second run can end before either randomly delayed client starts. (evidence: .plans/20261126-125107-fast-api-state.md:127; .plans/20261126-125107-fast-api-state.md:169)

SHOULD FIX:
1. Retain the real-data measurement as the evidence for the performance target; synchronous state-building work remains on the event loop. (evidence: apps/dashboard/server.mjs:508; apps/dashboard/server.mjs:574)
2. Define cleanup of cached validation indexes and text entries when folders or projects disappear. (evidence: .plans/20261126-125107-fast-api-state.md:108)
3. Describe the two-second result-cache duration as the default in the roadmap sentence. (evidence: .plans/20261126-125107-fast-api-state.md:139)

ADD THESE EDGE CASES:
- A POST disconnects before an awaited mutation finishes, with a GET between disconnect and completion.
- A failed build overlaps a newer generation; the error must not clear the newer build or expose internal details.
- A validation folder or registered project disappears and later returns.
- A load run receives no samples or a request hangs; it must terminate and report failure.

Do not change anything the validation did not flag.
```