## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] The lock fencing has a check-to-use race. Another process can replace the lock after `holdsLock()` returns but before the first process writes state or starts a side effect; an asynchronous `pullRoot()` can also continue after ownership changes. The proposed recovery can itself displace a live holder. — [.plans/20261123-102654-event-watcher-and-waits-for.md:132](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:132), [.plans/20261123-102654-event-watcher-and-waits-for.md:144](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:144) — This breaks the claimed single-watcher and at-most-once guarantees. Specify an ownership mechanism that prevents takeover while a live holder can perform side effects, and test takeover during a tick.
- [Duplicate side effects] The merge-button marker is added before `gh pr merge`, but the watcher may observe the merge and consume the marker before the button’s `pullRoot()` runs or completes. The event then reports “Pulled by the merge button” even if that pull fails; a server restart also loses the marker. — [.plans/20261123-102654-event-watcher-and-waits-for.md:144](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:144), [scripts/plans-dashboard.mjs:1565](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1565) — Coordinate the merge and pull through durable shared state with one owner, and record the actual pull result.
- [Authorization] The plan treats every header `Waits for:` line as the owner’s go, but it also allows the watcher to start a plan on its first tick. The existing rule requires an explicit owner go, and the proposed rule change is part of this same run. — [AGENTS.md:39](/Users/gorantubic/Workspace/claude-config/AGENTS.md:39), [.plans/20261123-102654-event-watcher-and-waits-for.md:152](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:152) — Define how existing plans with example or unapproved header lines are distinguished from owner-authorized waits before enabling automatic launches.

### Non-blocking concerns

- [References] The `apps/` paths and `copyDashboard()` do not exist in this checkout. The plan correctly makes their availability a prerequisite, but their final signatures and wiring cannot be verified until the move plan lands. — [.plans/20261123-102654-event-watcher-and-waits-for.md:19](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:19), [.plans/20261123-102654-event-watcher-and-waits-for.md:115](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:115) — Revalidate against the merged files before implementation.
- [Consistency] The hard-rules section says only two files under `skills/` change, but the affected-files list also changes the plan-validator template. — [.plans/20261123-102654-event-watcher-and-waits-for.md:26](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:26), [.plans/20261123-102654-event-watcher-and-waits-for.md:92](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:92) — Correct the hard-rules description.

### Edge cases the plan should address

- A watcher loses ownership immediately after checking its lock, while a pull or launch is starting.
- A merge succeeds but the button’s pull fails, or the server restarts between merge and pull.
- An existing plan has a header wait line that the owner did not intend as permission to launch.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [ ] Global rules affect every project respected
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
1. Replace the check-then-act lock fencing with an ownership mechanism that prevents takeover while a live holder can perform side effects, including an asynchronous pull. Add a test for ownership changing during a tick. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:132 and :144)
2. Coordinate button merges and watcher pulls through durable shared state with one owner. Record the actual pull result, including failure and restart between merge and pull, rather than consuming an in-memory pre-merge marker. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:144; scripts/plans-dashboard.mjs:1565)
3. Define how existing plans with unapproved or illustrative header wait lines are distinguished from owner-authorized waits before automatic launches are enabled. (evidence: AGENTS.md:39; .plans/20261123-102654-event-watcher-and-waits-for.md:152)

SHOULD FIX:
1. Revalidate the post-move paths, signatures, wiring, and verification commands against the merged move before implementation. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:19 and :115)
2. Correct the hard-rules description to include the plan-validator template among the changed skill files. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:26 and :92)

ADD THESE EDGE CASES:
- Lock ownership changes immediately after its check while a pull or launch is starting.
- A merge succeeds but the button pull fails, or the server restarts between merge and pull.
- An existing plan has a header wait line that the owner did not intend as permission to launch.

Do not change anything the validation did not flag.
```