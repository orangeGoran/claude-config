## Plan validation (codex): 20261127-230104-plans-mac-native-parts.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] Stale-lock removal is not atomic with acquisition. Two servers can both judge the same lock stale; one can remove it and acquire a new lock before the other removes that new lock. Both can then start a build against the same install paths. — `.plans/20261127-230104-plans-mac-native-parts.md:163` — Add a recovery protocol that prevents one contender from removing another contender’s new lock, and test concurrent recovery from a stale lock.
- [Data loss] The reload checks `typing` before an asynchronous fresh `GET /api/app`. The owner can start typing while that request is in flight, after which the callback reloads and loses the new draft. — `.plans/20261127-230104-plans-mac-native-parts.md:171` — Recheck page identity and unsent input immediately before reload, and test input entered during the GET.
- [Permission safety] The plan grants Allow and Deny buttons to every other tool using only its name. Tool inputs can contain consequential arguments that the notification does not show, so the owner cannot assess what Allow will authorize. Missing targets for the named tools also fall into the “no target” case. — `.plans/20261127-230104-plans-mac-native-parts.md:34` and `.plans/20261127-230104-plans-mac-native-parts.md:158` — Give buttons only to explicitly supported requests whose required, complete target is visible; open the plan for other or malformed requests.
- [Lost notification] `SERVER_RINGS.runs` depends on the local watcher setting, but only the server holding the watcher lock emits watcher notifications. A second server can suppress its page notification even when the lock holder cannot observe that server’s run. The watcher also records state before it sends notifications, so the server path can intentionally lose an event. — `.plans/20261127-230104-plans-mac-native-parts.md:35`, `apps/dashboard/server.mjs:2160`, and `apps/dashboard/server.mjs:2184` — Define suppression from evidence that the corresponding event is actually covered, and test multiple servers and watcher failure or takeover.
- [Relaunch] The update bar is intended to work with a broken or old page, but relaunch is executed only inside a successful `appStatus()` callback. A page without that new hook, or a waiting page off origin, cannot complete the update. — `.plans/20261127-230104-plans-mac-native-parts.md:48` and `.plans/20261127-230104-plans-mac-native-parts.md:171` — Define a safe completion path for unavailable or older pages that preserves unsent work, and test it.

### Non-blocking concerns

- [Verification] Native notification delivery, cold launch, unlock behavior, and the actual build endpoint are not verified by the planned automated tests. The plan correctly assigns these to manual checks; their outcome remains unverified until those checks run. — `.plans/20261127-230104-plans-mac-native-parts.md:214`.
- [Error handling] `psCommand()` returns `null` on any `ps` failure, but the proposed stale check treats absence of `app-build` as proof that the PID is not a build. A transient inspection failure can therefore free a live build’s lock. — `apps/dashboard/server.mjs:1846` and `.plans/20261127-230104-plans-mac-native-parts.md:162` — Treat an indeterminate process inspection separately from a confirmed stale lock.

### Edge cases the plan should address

- Two servers attempt stale-lock recovery at the same time.
- The owner enters a draft after the typing check but before the reload response arrives.
- A tool request has an absent, malformed, or undisplayed input.
- The page has no `appStatus()` hook, fails to load, or is on the waiting page after a successful build.
- Process inspection fails while the build PID remains alive.

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
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make stale-lock recovery safe when two servers recover the same stale lock concurrently; one contender must not remove another contender’s newly acquired lock. Add a concurrent recovery test. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:163)
2. Recheck the page identity and unsent input immediately before an asynchronous reload, and test text entered while the fresh GET is in flight. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:171)
3. Offer notification buttons only for explicitly supported requests whose required, complete target is visible. Open the plan for other tools and missing or malformed targets. Add tests for those cases. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:34 and .plans/20261127-230104-plans-mac-native-parts.md:158)
4. Revise run-notification suppression so it does not assume that an enabled local watcher guarantees delivery. Cover a second server and watcher failure or takeover. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:35 and apps/dashboard/server.mjs:2160)
5. Define and test a safe update-completion path when the page is old, broken, or off origin and cannot provide appStatus(), while preserving unsent work. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:48 and .plans/20261127-230104-plans-mac-native-parts.md:171)

SHOULD FIX:
1. Treat a failed process inspection as indeterminate rather than proof that a live build lock is stale, and test that case. (evidence: apps/dashboard/server.mjs:1846 and .plans/20261127-230104-plans-mac-native-parts.md:162)

ADD THESE EDGE CASES:
- Concurrent stale-lock recovery by two servers.
- A draft entered while the reload confirmation GET is in flight.
- Missing, malformed, or undisplayed tool input.
- An old or unavailable page after a successful build.
- Process inspection failure while the build PID remains alive.

Do not change anything the validation did not flag.
```