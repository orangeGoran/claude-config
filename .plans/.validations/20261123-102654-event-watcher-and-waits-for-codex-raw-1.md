## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Integration] The PR cache keeps only the newest PR per branch and at most the newest 200 PRs. A wait for a specific PR can therefore stay unmet after that PR merges, and merges outside the retained window can be missed — [scripts/plans-dashboard.mjs:1320](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1320), [scripts/plans-dashboard.mjs:1336](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1336). Define a number-based lookup for PR waits and a reliable way to discover merges across polling gaps; test branch reuse and an older PR.
- [Integration] The plan checks and acts on each project while refreshing projects in sequence. A wait can read another project’s stale or missing cache, or its `planBranches` before `listPlans()` has populated it. A stale merged state can cause a launch — [plan:113](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:113), [plan:117](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:117), [scripts/plans-dashboard.mjs:485](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:485). Refresh all dependencies first, reject failed or stale dependency results, and populate named branches before evaluating waits.
- [Launch safety] The four-run count omits launches that are still starting, and the plan makes the launch decision from a snapshot that can race a manual launch. The existing launcher records `starting` separately from `live` and run reports — [plan:104](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:104), [scripts/plans-dashboard.mjs:639](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:639). Count starting launches and serialize or recheck manual and automatic launches against the same per-project limit.
- [Reliability] The plan records a launch as completed immediately after calling `launchPipeline()`, although that function returns before the child can report a `SKIP` or failure. The persisted marker then prevents a later retry — [plan:121](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:121), [scripts/plans-dashboard.mjs:653](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:653). Define durable pending, accepted and failed launch states, recovery after restart, and an explicit retry policy; test a skipped or failed launcher.
- [Integration] The specified notification link uses `?plan=`, but the page reads the selected plan from `?sel=`. Clicking a notification will not open its plan — [plan:122](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:122), [scripts/plans-dashboard/app.js:596](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard/app.js:596). Use the existing selection parameter with encoded values and test the link.
- [Rule] The release note is specified as `audience: internal`, although the change adds a visible chip, behavior and API route. The changelog rules classify these as customer-visible — [plan:133](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:133), [changelog.d/README.md:42](/Users/gorantubic/Workspace/claude-config/changelog.d/README.md:42). Use `both` and provide the customer text.

### Non-blocking concerns

- [Verification] The move has not yet landed in this checkout, so the post-move paths and test command cannot be verified here. The prerequisite plan specifies those paths and updates the test glob — [.plans/20261122-152506-move-apps-out-of-scripts.md:53](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:53). Revalidate against the merged move before implementation.
- [Discrepancy] The browser-test claim that board cards do not use `autoChips` is wrong: they already call it — [scripts/plans-dashboard/app.js:4144](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard/app.js:4144). Correct the test description and check the chip on the board.
- [Verification] The changelog rules require the changelog validator, but it is absent from the verification commands — [changelog.d/AGENTS.md:7](/Users/gorantubic/Workspace/claude-config/changelog.d/AGENTS.md:7). Add the required command.

### Edge cases the plan should address

- A GitHub refresh fails for a dependency after a previous successful tick: keep its waits unmet until fresh data is available.
- Two plans use different base branches in one project: fetch and check each base independently.
- A plan’s wait line changes or is removed after a tick: discard the old cached status before using it for display or launch.
- A merge pull fails or the server stops between recording an event and saving state: define retry and duplicate-event behavior.
- A project has no GitHub access but has a submodule-only wait: define whether that independent condition can proceed.
- A submodule is missing or uninitialized, or a path is not a submodule: report a stable error and do not launch.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
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
1. Replace reliance on the branch-deduplicated, 200-PR cache for PR-number waits and merge discovery. Specify number-based lookup and detection across polling gaps; test branch reuse and an older PR. (evidence: scripts/plans-dashboard.mjs:1320, scripts/plans-dashboard.mjs:1336)
2. Refresh all project dependencies before evaluating any waits, reject failed or stale dependency results, and populate named plan branches before cross-project checks. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:113, .plans/20261123-102654-event-watcher-and-waits-for.md:117, scripts/plans-dashboard.mjs:485)
3. Count launches that are still starting and coordinate manual and automatic launches against the same per-project limit, with a recheck or serialization. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:104, scripts/plans-dashboard.mjs:639)
4. Define durable pending, accepted and failed launch states, restart recovery and retry behavior. Test a launcher that skips or fails instead of permanently marking it launched on invocation. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:121, scripts/plans-dashboard.mjs:653)
5. Use the page's encoded `sel` parameter for notification links and test that the link selects the plan. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:122, scripts/plans-dashboard/app.js:596)
6. Change the release note audience to `both` and include customer text for the visible behavior and API. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:133, changelog.d/README.md:42)

SHOULD FIX:
1. Revalidate the post-move paths and test command after the prerequisite move merges. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:53)
2. Correct the browser-test description: board cards already use `autoChips`; check the chip there. (evidence: scripts/plans-dashboard/app.js:4144)
3. Add the required changelog validation command to How to verify. (evidence: changelog.d/AGENTS.md:7)

ADD THESE EDGE CASES:
- A dependency refresh fails after an earlier successful tick.
- Plans in one project wait on different base branches.
- A wait line is edited or removed after a tick.
- A merge pull fails, or the server stops between event and state writes.
- A project lacks GitHub access but has a submodule-only wait.
- A submodule is missing or uninitialized, or the path is not a submodule.

Do not change anything the validation did not flag.
```