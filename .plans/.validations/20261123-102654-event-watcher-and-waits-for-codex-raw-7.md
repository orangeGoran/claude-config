## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] Stale-lock recovery can temporarily remove a replacement holder’s live lock. A second contender can acquire the now-empty lock path before the recovering process tries to restore the replacement lock. The displaced watcher can still be inside `watchProject()`, whose PR pull and state writes do not recheck ownership. That can produce concurrent pulls, state writes, or duplicate events, contrary to the one-watcher and at-most-once guarantees — `.plans/20261123-102654-event-watcher-and-waits-for.md:132`, `.plans/20261123-102654-event-watcher-and-waits-for.md:141`, `.plans/20261123-102654-event-watcher-and-waits-for.md:151` — Specify a recovery protocol that cannot displace a live replacement, and fence state-changing work against lock loss. Add a test for competing stale-lock recovery and takeover.

### Non-blocking concerns

- [Dependencies] The post-move files and `copyDashboard()` do not exist in this checkout. Their proposed locations and exports match the move plan, but their final implementation and the updated `npm test` command cannot yet be verified — `.plans/20261122-152506-move-apps-out-of-scripts.md:44`, `.plans/20261122-152506-move-apps-out-of-scripts.md:53`, `.plans/20261122-152506-move-apps-out-of-scripts.md:57` — Revalidate those references after the move lands.
- [Workflow] The plan defers updates to this repo’s planning skill and both validator instructions to an owner follow-up, while describing the new `Waits for:` line as an accepted go — `.plans/20261123-102654-event-watcher-and-waits-for.md:166`, `.claude/skills/skill-1-plan/SKILL.md:276`, `.claude/agents/plan-validator.md:48` — Keep that follow-up visible until applied, and reconcile the statement that the validator template needs no change with the requested follow-up.

### Edge cases the plan should address

- Two contenders inspect the same stale lock while a third server acquires its replacement — a recovery attempt must not displace the new holder or allow the old holder to commit watcher effects.
- A watcher loses ownership after beginning a tick but before a pull or state write — ownership must be enforced at each relevant side effect.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
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
1. Replace stale-lock recovery with a protocol that cannot displace a live replacement holder, and fence pulls, state writes, event writes, and launches against ownership loss. Add a test with competing stale-lock recovery and takeover that proves one watcher performs the effects. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:132, .plans/20261123-102654-event-watcher-and-waits-for.md:141, .plans/20261123-102654-event-watcher-and-waits-for.md:151)

SHOULD FIX:
1. Recheck the post-move paths, copyDashboard export, and npm test command after the move plan lands; they cannot yet be verified in the current checkout. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:44, .plans/20261122-152506-move-apps-out-of-scripts.md:53, .plans/20261122-152506-move-apps-out-of-scripts.md:57)
2. Reconcile the claim that the validator template needs no change with the deferred updates to the planning skill and validator instructions, and keep the follow-up visible until applied. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:109, .plans/20261123-102654-event-watcher-and-waits-for.md:166, .claude/skills/skill-1-plan/SKILL.md:276, .claude/agents/plan-validator.md:48)

ADD THESE EDGE CASES:
- Two contenders inspect the same stale lock while another server acquires its replacement.
- A watcher loses ownership after a tick starts but before a pull or state write.

Do not change anything the validation did not flag.
```