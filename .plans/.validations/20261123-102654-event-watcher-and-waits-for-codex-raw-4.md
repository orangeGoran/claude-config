## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] Stale-lock takeover is not safe when two servers race. Both can decide the old lock is stale; one can rename it and acquire a new lock before the other renames that new lock. Both can then run watchers and launch the same plan. The plan also checks ownership only at tick start, so a displaced holder can continue its tick — [.plans/20261123-102654-event-watcher-and-waits-for.md:130](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:130), [.plans/20261123-102654-event-watcher-and-waits-for.md:152](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:152) — Specify a takeover protocol that cannot remove a replacement lock, and test simultaneous stale-lock takeovers and ownership loss during a tick.
- [Concurrency] The four-run limit uses a snapshot taken before asynchronous `pipelineLive()` checks. A manual `/api/launch` can start another plan during those checks; the final synchronous block checks only the waiting plan, not the project’s current run count. The existing launch endpoint accepts launches independently — [.plans/20261123-102654-event-watcher-and-waits-for.md:149](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:149), [scripts/plans-dashboard.mjs:2838](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:2838) — Define shared admission or reservation logic that enforces the limit across manual and automatic launches, and test the race.
- [Event delivery] The 2,000-entry PR map discards lower-numbered PRs, but a discarded PR merged after `since` is treated as new on every tick. If it remains in the updated PR pages, each tick can emit `pr-merged` and pull again, contrary to the at-most-once contract — [.plans/20261123-102654-event-watcher-and-waits-for.md:116](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:116), [.plans/20261123-102654-event-watcher-and-waits-for.md:120](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:120) — Persist sufficient deduplication information or change the eviction and event rules, with a repeated-tick test for an evicted PR merged after `since`.
- [Integration] The watcher pulls after observing a merge even when the dashboard merge handler has already pulled. The plan assumes the second pull is harmless, but the watcher can observe the merge while the handler’s pull is still running; two `git pull --ff-only` operations can contend and report a false failure — [.plans/20261123-102654-event-watcher-and-waits-for.md:143](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:143), [scripts/plans-dashboard.mjs:1587](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1587) — Give pulls one per-project owner or serialize them across both paths, and test an overlapping dashboard merge and watcher tick.

### Non-blocking concerns

- [References] The post-move files and `copyDashboard` export do not exist in this checkout. The prerequisite move plan specifies them, but their final signatures and wiring cannot be verified until that plan lands — [.plans/20261123-102654-event-watcher-and-waits-for.md:19](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:19), [.plans/20261122-152506-move-apps-out-of-scripts.md:96](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:96) — Revalidate against the merged implementation before starting this plan.
- [Verification] Step 0 checks only that `server.mjs` exists; that alone does not prove the prerequisite move is complete or that its `copyDashboard` export and test wiring are present — [.plans/20261123-102654-event-watcher-and-waits-for.md:113](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:113) — Check the prerequisite’s actual completion and required exports.

### Edge cases the plan should address

- Two servers concurrently reclaim the same stale lock, including a holder losing ownership during a tick — duplicate launches and event writes must remain impossible.
- A manual launch begins while the watcher is evaluating the fourth available slot — the combined count must remain within the project limit.
- An old PR is evicted from the 2,000-entry map and then merges — repeated overlapping pages must not repeat its event or pull.
- The dashboard merge handler and watcher pull the same project concurrently — the user should not receive a spurious pull failure.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
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
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Replace the stale-lock takeover with a protocol that cannot remove a replacement lock, and define how a watcher stops side effects if it loses ownership during a tick. Add a simultaneous stale-takeover test. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:130, .plans/20261123-102654-event-watcher-and-waits-for.md:152)
2. Enforce the four-run limit across manual and automatic launches with shared admission or reservation logic, and test a manual launch racing an automatic launch. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:149, scripts/plans-dashboard.mjs:2838)
3. Prevent repeated merge events and pulls for PRs evicted from the 2,000-entry map. Add a repeated-tick test for an evicted PR merged after the watcher started. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:116, .plans/20261123-102654-event-watcher-and-waits-for.md:120)
4. Serialize or assign one owner to pulls from the dashboard merge handler and watcher, and test overlapping operations. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:143, scripts/plans-dashboard.mjs:1587)

SHOULD FIX:
1. Revalidate post-move paths, signatures, exports and test wiring against the prerequisite after it lands. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:19, .plans/20261122-152506-move-apps-out-of-scripts.md:96)
2. Make step 0 verify the prerequisite move is complete and its required exports exist, rather than checking only for server.mjs. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:113)

ADD THESE EDGE CASES:
- Two servers reclaim the same stale lock concurrently, including ownership loss during a tick.
- A manual launch races the watcher for the final available project slot.
- A PR evicted from the saved map merges and remains in overlapping result pages.
- A dashboard merge and watcher tick attempt to pull the same project at the same time.

Do not change anything the validation did not flag.
```