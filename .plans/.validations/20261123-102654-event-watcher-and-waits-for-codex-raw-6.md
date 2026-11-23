## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Duplicate side effects] The watcher pulls a merged PR before it saves the updated PR state. If the server exits after `pullRoot()` and before `saveWatch()`, the next tick detects the same merge and pulls again. This contradicts the plan’s at-most-once delivery claim and can repeat a failed pull that the plan says will not be retried. — [.plans/20261123-102654-event-watcher-and-waits-for.md:51](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:51), [.plans/20261123-102654-event-watcher-and-waits-for.md:140](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:140) — Save a durable claim for each merge before pulling, and define recovery and event behavior after a crash.
- [Concurrency] The four-run limit is checked only for watcher launches. The existing `/api/launch` route calls `launchPipeline()` without that limit, and a manual request can arrive immediately after the watcher’s synchronous block. The stated per-project maximum can therefore be exceeded. — [.plans/20261123-102654-event-watcher-and-waits-for.md:17](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:17), [scripts/plans-dashboard.mjs:2838](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:2838) — Put admission and reservation in a shared launch path used by both manual and automatic launches, or obtain an owner decision that the limit applies only to automatic launches.
- [Error handling] A PR-condition error is copied from `ghProblem()` into `waitStatus` and returned by `/api/state`; the plan redacts command text only when writing events or notifications. `ghProblem()` can return the first line of raw command output, including a URL query or secret. — [.plans/20261123-102654-event-watcher-and-waits-for.md:130](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:130), [.plans/20261123-102654-event-watcher-and-waits-for.md:135](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:135), [scripts/plans-dashboard.mjs:1311](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1311) — Redact or replace command-derived errors before storing them in `waitStatus`, events, notifications, logs, or any response, and test `/api/state` with secret-bearing error output.

### Non-blocking concerns

- [References] The dashboard and scout paths and `copyDashboard()` do not yet exist in the current checkout. The preceding move plan specifies them, and step 0 blocks until the move lands, but their final implementation and signatures cannot be verified until then. — [.plans/20261123-102654-event-watcher-and-waits-for.md:19](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:19), [.plans/20261123-102654-event-watcher-and-waits-for.md:114](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:114) — Revalidate the references against the merged move.
- [Rules] The repository’s plan-validator still flags a plan that “skips an explicit go,” while the plan leaves the repository’s own planning skill update as an owner open item. The new convention may consequently produce inconsistent guidance or validation. — [.claude/agents/plan-validator.md:48](/Users/gorantubic/Workspace/claude-config/.claude/agents/plan-validator.md:48), [.claude/skills/skill-1-plan/SKILL.md:276](/Users/gorantubic/Workspace/claude-config/.claude/skills/skill-1-plan/SKILL.md:276) — Make the corresponding owner-managed updates explicit and verify the validator recognizes the new convention.

### Edge cases the plan should address

- A crash after claiming a merge but before or during its pull — define whether the pull is lost or retried and what the owner sees.
- A manual launch immediately before or after an automatic launch at the project limit — both paths must obey the chosen limit.
- A `gh` error containing a secret or URL query — no API response, event, notification, or log should expose it.

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
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] “How to verify” commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Claim each detected merge durably before calling pullRoot(), and define crash recovery and event behavior so a crash cannot repeat a pull or silently contradict the at-most-once contract. Add a crash-boundary test. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:51, .plans/20261123-102654-event-watcher-and-waits-for.md:140)
2. Enforce the four-run limit through shared admission and reservation for both manual and automatic launches, including concurrent requests, or obtain the owner’s decision to limit only automatic launches. Add a concurrency test. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:17, scripts/plans-dashboard.mjs:2838)
3. Redact or replace command-derived errors before they enter waitStatus, events, notifications, logs, or responses. Add a test that injects secret-bearing gh error output and checks /api/state. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:130, .plans/20261123-102654-event-watcher-and-waits-for.md:135, scripts/plans-dashboard.mjs:1311)

SHOULD FIX:
1. Revalidate the post-move paths, exports, and signatures after the move plan merges. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:19, .plans/20261123-102654-event-watcher-and-waits-for.md:114)
2. Make the owner-managed planning-skill and validator updates explicit, and verify that validation recognizes a Waits for line as the owner’s go. (evidence: .claude/agents/plan-validator.md:48, .claude/skills/skill-1-plan/SKILL.md:276)

ADD THESE EDGE CASES:
- A crash after a merge is claimed but before or during its pull.
- A manual launch immediately before or after an automatic launch at the project limit.
- A gh error containing a secret or URL query in every exposed error path.

Do not change anything the validation did not flag.
```