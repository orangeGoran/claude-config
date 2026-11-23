## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Integration] PR events are computed from `next.prs`, but `prMap()` retains only `{ state }`; the timestamps, title, URL, branch and base needed to detect new events and pull the checkout are lost — [.plans/20261123-102654-event-watcher-and-waits-for.md:117](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:117), [.plans/20261123-102654-event-watcher-and-waits-for.md:143](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:143) — pass the full current rows to `prEvents`, retain the compact map for persistence, and define the event’s base field for `pullRoot`.
- [Concurrency] The button-merge marker is set only after the merge and a further GitHub request; the watcher can observe the merge during either await and pull concurrently. A second dashboard sharing the HOME also has a separate in-memory marker — [scripts/plans-dashboard.mjs:1577](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1577), [.plans/20261123-102654-event-watcher-and-waits-for.md:143](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:143) — coordinate merge and pull ownership across dashboard processes before the merge begins, including failure and restart handling.
- [Concurrency] The final launch check uses a stale plan snapshot after asynchronous condition and liveness checks. A manual run can create a report or worktree and finish during those awaits, leaving no `launches` entry; the watcher then launches it again — [.plans/20261123-102654-event-watcher-and-waits-for.md:124](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:124), [.plans/20261123-102654-event-watcher-and-waits-for.md:149](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:149), [scripts/plans-dashboard.mjs:662](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:662) — recheck all relevant eligibility and run artifacts immediately before launch, and coordinate manual and automatic launches through a shared reservation.
- [State] The plan removes a launch record when its plan moves to `done/`, but does not reset the corresponding `met` and error records. Reusing the slug can suppress a later `wait-met` or error event; retaining the launch record across a temporary disappearance also needs an explicit policy — [.plans/20261123-102654-event-watcher-and-waits-for.md:147](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:147), [.plans/20261123-102654-event-watcher-and-waits-for.md:148](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:148) — define lifecycle and identity for all per-plan state, including deletion, restoration and slug reuse.
- [Integration] `pipelineLive()` does not guarantee that every working run remains detectable: its fallback depends on a recent transcript and is disabled when a chat entry exists. The proposed 30-minute cutoff can therefore exclude a still-running process and exceed the four-run limit — [scripts/plans-dashboard.mjs:370](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:370), [scripts/plans-dashboard.mjs:383](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:383), [.plans/20261123-102654-event-watcher-and-waits-for.md:123](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:123) — use a reliable durable run-liveness source or conservatively count uncertain runs, with a test for a long-running quiet process.
- [Error handling] Submodule ancestry treats every `merge-base --is-ancestor` failure as an ordinary unmet condition, although command errors also return nonzero. Missing pointer objects or repository errors can leave a plan waiting silently — [.plans/20261123-102654-event-watcher-and-waits-for.md:139](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:139), [scripts/plans-dashboard.mjs:1476](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1476) — preserve the exit code, distinguish exit 1 from command errors, and test both.

### Non-blocking concerns

- [Verification] The post-move files and `copyDashboard()` do not exist in this checkout. The move plan describes them, but their final signatures and wiring cannot yet be verified — [.plans/20261123-102654-event-watcher-and-waits-for.md:19](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:19) — revalidate against the merged move before implementation.
- [Reference] `refreshPrList()` can join an already-running request that began before the tick, so awaiting it does not always guarantee a fresh list — [scripts/plans-dashboard.mjs:1329](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1329) — specify a refresh after any pre-existing request completes.
- [Rules] The repository’s own planning skill retains the old go wording until an owner follow-up, leaving the shipped workflow inconsistent in the meantime — [.plans/20261123-102654-event-watcher-and-waits-for.md:166](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:166), [.claude/skills/skill-1-plan/SKILL.md:276](/Users/gorantubic/Workspace/claude-config/.claude/skills/skill-1-plan/SKILL.md:276) — schedule that update as a prerequisite or explicitly coordinate its completion with the change.

### Edge cases the plan should address

- A merge becomes visible while a dashboard button merge is still awaiting GitHub, including when the button request reaches a second dashboard.
- A manual launch starts and finishes while the watcher evaluates a condition.
- A plan disappears temporarily, returns, or a new plan reuses its slug.
- A quiet run remains active beyond 30 minutes.
- A submodule pointer commit is unavailable locally, or `merge-base` fails for a reason other than a non-ancestor result.

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
1. Pass full current PR rows to prEvents while keeping the compact persisted state map, and define how the event supplies the base branch to pullRoot. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:117 and .plans/20261123-102654-event-watcher-and-waits-for.md:143)
2. Coordinate button merges and watcher pulls across dashboard processes before the merge begins; specify failure and restart handling. (evidence: scripts/plans-dashboard.mjs:1577 and .plans/20261123-102654-event-watcher-and-waits-for.md:143)
3. Recheck eligibility and run artifacts immediately before automatic launch, and coordinate manual and automatic launches through a shared reservation. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:124, .plans/20261123-102654-event-watcher-and-waits-for.md:149 and scripts/plans-dashboard.mjs:662)
4. Define the lifecycle and identity of launched, met and error records when a plan is deleted, restored, archived or its slug is reused. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:147 and .plans/20261123-102654-event-watcher-and-waits-for.md:148)
5. Use a reliable durable run-liveness source or conservatively count uncertain runs, and test a long-running quiet process against the four-run limit. (evidence: scripts/plans-dashboard.mjs:370, scripts/plans-dashboard.mjs:383 and .plans/20261123-102654-event-watcher-and-waits-for.md:123)
6. Preserve the merge-base exit code, distinguish exit 1 from command errors, and test both outcomes. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:139 and scripts/plans-dashboard.mjs:1476)

SHOULD FIX:
1. Revalidate the post-move paths, signatures, wiring and verification commands against the merged move plan before implementation. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:19)
2. Specify a fresh PR-list request after any request already in progress finishes. (evidence: scripts/plans-dashboard.mjs:1329)
3. Coordinate the update to this repository's own planning skill with the change so its go wording is consistent. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:166 and .claude/skills/skill-1-plan/SKILL.md:276)

ADD THESE EDGE CASES:
- A merge becomes visible while a button merge is awaiting GitHub, including a request handled by a second dashboard.
- A manual launch starts and finishes while the watcher evaluates a condition.
- A plan disappears temporarily, returns, or a new plan reuses its slug.
- A quiet run remains active beyond 30 minutes.
- A submodule pointer commit is unavailable locally, or merge-base fails for a reason other than a non-ancestor result.

Do not change anything the validation did not flag.
```