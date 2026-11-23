## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] The lock can be stolen while its creator is still writing it: another process can see the newly created but empty file and treat its missing PID as stale. Two processes can also race to remove a stale lock. Both can then run watcher side effects — `.plans/20261123-102654-event-watcher-and-waits-for.md:127` — use a lock protocol that makes acquisition and stale-lock recovery safe under concurrent readers and removers; test both races.
- [Concurrency] The final launch check awaits `pipelineLive()` after checking `launches`, leaving a window for a manual launch or chat to start before the watcher calls `launchPipeline()`. The manual route calls `launchPipeline()` independently, and `runLauncher()` ends the chat — `.plans/20261123-102654-event-watcher-and-waits-for.md:143`, `scripts/plans-dashboard.mjs:643`, `scripts/plans-dashboard.mjs:648`, `scripts/plans-dashboard.mjs:2842` — put manual and automatic launch decisions behind a shared per-plan reservation, then recheck the chat and eligibility while holding it.
- [Missed events] Only the 100 most recently updated PRs are fetched. More than 100 updates between ticks, including while the dashboard is down, can hide a merge permanently, so its event and checkout pull never happen — `.plans/20261123-102654-event-watcher-and-waits-for.md:75`, `.plans/20261123-102654-event-watcher-and-waits-for.md:138` — paginate against a durable update watermark, including ties and recovery after downtime, and test a burst exceeding one page.
- [Repeated side effects] `prMap()` discards all but the 2,000 highest PR numbers, but `prEvents()` treats a newly encountered merged PR as a merge. An updated older merged PR outside that retained set can therefore trigger a pull and event on every tick — `.plans/20261123-102654-event-watcher-and-waits-for.md:115`, `.plans/20261123-102654-event-watcher-and-waits-for.md:118` — retain enough durable identity or watermark information to deduplicate old PRs, and test repeated ticks for an old PR.
- [Data safety] A `plan … merged` slug accepts `..`, then is joined into another project’s plan directory without a containment check — `.plans/20261123-102654-event-watcher-and-waits-for.md:114`, `.plans/20261123-102654-event-watcher-and-waits-for.md:133` — validate it as a safe single filename before reading and test traversal-like slugs.
- [Error handling] Command output is truncated but not redacted before it is persisted and returned by `/api/events`; `ghProblem()` can pass through the first line of a command error — `.plans/20261123-102654-event-watcher-and-waits-for.md:126`, `scripts/plans-dashboard.mjs:1311` — define a redaction or safe error-mapping step before events, notifications and API responses, and test secret-bearing errors.

### Non-blocking concerns

- [Verification] The post-move files and commands are not yet present in this checkout. The move plan specifies them, but their final wiring cannot be verified until it lands — `.plans/20261123-102654-event-watcher-and-waits-for.md:19`, `.plans/20261122-152506-move-apps-out-of-scripts.md` — revalidate against the merged move before implementation.
- [Reference] The plan says the watcher reads `gh()` results as rows, but `gh()` returns an object whose successful output is a string; the existing list parser calls `JSON.parse(r.out)` — `.plans/20261123-102654-event-watcher-and-waits-for.md:138`, `scripts/plans-dashboard.mjs:1283`, `scripts/plans-dashboard.mjs:1322` — specify parsing and malformed-output handling for both PR calls.
- [Behavior] Saving watcher state before writing events can lose a merge event and its notification after a crash, as the plan acknowledges — `.plans/20261123-102654-event-watcher-and-waits-for.md:144` — document this delivery guarantee in the user-facing contract or use a recoverable event journal.

### Edge cases the plan should address

- A watcher starts while another process has created the lock but has not written its contents, and two watchers recover the same stale lock.
- A manual launch or chat starts during the watcher’s final asynchronous eligibility check.
- More than 100 PR updates occur between ticks, including equal update timestamps.
- A merged PR older than the 2,000 retained highest numbers remains in the updated list across ticks.
- A command error contains a credential or URL query.
- GitHub returns malformed JSON or an incomplete page.

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
1. Replace the watcher lock protocol with one that handles an incompletely written new lock and concurrent stale-lock recovery without allowing two holders. Add tests for both races. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:127)
2. Put manual and automatic launches behind a shared per-plan reservation. Recheck eligibility and chat activity while holding it, so a manual launch or chat cannot win during the asynchronous live check and then be interrupted or duplicated. Add race tests. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:143; scripts/plans-dashboard.mjs:643; scripts/plans-dashboard.mjs:648; scripts/plans-dashboard.mjs:2842)
3. Paginate updated PRs using a durable update watermark, with handling for equal timestamps and downtime, so a burst of more than 100 updates cannot hide a merge. Add a test exceeding one page. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:75; .plans/20261123-102654-event-watcher-and-waits-for.md:138)
4. Preserve sufficient durable PR identity or watermark information to prevent repeated merge events and pulls for an updated old PR outside the 2,000 highest numbers. Add a repeated-tick test. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:115; .plans/20261123-102654-event-watcher-and-waits-for.md:118)
5. Validate a referenced plan slug as a safe single filename before joining it to another project's plan directory. Add traversal-like slug tests. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:114; .plans/20261123-102654-event-watcher-and-waits-for.md:133)
6. Define redaction or safe error mapping before command output reaches persistent events, notifications or API responses, and test errors containing credentials and URL queries. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:126; scripts/plans-dashboard.mjs:1311)

SHOULD FIX:
1. Revalidate the proposed paths, wiring and commands against the merged move plan before implementation. They do not yet exist in the current checkout. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:19; .plans/20261122-152506-move-apps-out-of-scripts.md)
2. Specify parsing of gh().out and handling of malformed output for the watcher PR calls. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:138; scripts/plans-dashboard.mjs:1283; scripts/plans-dashboard.mjs:1322)
3. Document the possibility of event loss after a crash in the user-facing contract, or use a recoverable event journal. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:144)

ADD THESE EDGE CASES:
- Concurrent new-lock creation and stale-lock recovery.
- Manual launch or chat beginning during the watcher's final eligibility check.
- More than 100 PR updates between ticks, including equal timestamps.
- An old merged PR outside the retained 2,000 numbers appearing on repeated ticks.
- Command errors containing credentials or URL queries.
- Malformed JSON or incomplete GitHub pages.

Do not change anything the validation did not flag.
```