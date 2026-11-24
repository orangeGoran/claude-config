## Plan validation (codex): 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Restart rule] The watcher pulls merged changes into the main checkout without performing the required relay check and conditional restart. Documenting the rule does not perform it when the watcher is the actor that pulls the changes. — [.plans/20261123-102654-event-watcher-and-waits-for.md:23](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:23), [AGENTS.md:9](/Users/gorantubic/Workspace/claude-config/AGENTS.md:9) — Specify how the automatic pull satisfies the rule, including detecting relevant changes and safely arranging the check and restart.
- [Duplicate side effects] The plan starts the launcher before persisting `launched`, and appends events before saving watcher state. A crash between those operations can launch the same plan or emit the same events again after restart. — [.plans/20261123-102654-event-watcher-and-waits-for.md:138](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:138), [scripts/plans-dashboard.mjs:643](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:643) — Define durable intent and recovery around launch and event writes, and test interruption at each boundary.
- [Concurrency] The watcher lock checks for a live PID and then writes the lock without an atomic acquisition. Two servers starting together can both acquire it and launch the same plans. — [.plans/20261123-102654-event-watcher-and-waits-for.md:143](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:143) — Specify atomic lock acquisition, safe stale-lock recovery, and a simultaneous-start test.
- [Run limit] The 30-minute report-age cutoff excludes a run that is still executing but has not updated its report recently. That can allow a fifth run despite the four-run limit. — [.plans/20261123-102654-event-watcher-and-waits-for.md:116](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:116), [scripts/plans-dashboard.mjs:496](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:496) — Use reliable process or run evidence and fail closed when the status is uncertain; test a live run with an old report.
- [Missing merge events] The event watcher derives PRs from a cache that keeps only the newest 200 PRs and one per branch. A merge outside that retained set, including an older PR on a reused branch, is never detected or pulled. — [.plans/20261123-102654-event-watcher-and-waits-for.md:74](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:74), [scripts/plans-dashboard.mjs:1320](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1320) — Give event detection a complete, independently paginated source and test older PRs and reused branches.
- [Condition evaluation] A plan wait uses `ownBranch()`, but that function reads a map populated by `listPlans()`. The watcher refreshes PR lists first, then processes projects in registry order, so a referenced project’s custom branch can be missing or stale when its condition is evaluated. — [.plans/20261123-102654-event-watcher-and-waits-for.md:129](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:129), [scripts/plans-dashboard.mjs:305](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:305), [scripts/plans-dashboard.mjs:486](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:486) — Populate current branch mappings for all projects before evaluating conditions, and test both project orders and a changed branch header.
- [Security and error handling] The new event endpoint exposes `ghProblem()` and launcher output, but the plan has no redaction step. Those strings can contain internal URLs, query strings or secrets from external commands. — [.plans/20261123-102654-event-watcher-and-waits-for.md:128](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:128), [scripts/plans-dashboard.mjs:1311](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:1311) — Define sanitized public errors and redact sensitive data before persistence, notification, logging and API responses; test representative secrets and URL queries.

### Non-blocking concerns

- [Verification] The post-move files and test command do not exist in the current checkout; their intended paths and test glob are described by the prerequisite move plan. Their final integration cannot be verified until that plan merges. — [.plans/20261122-152506-move-apps-out-of-scripts.md:44](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:44) — Revalidate against the merged code.
- [Endpoint tests] The endpoint tests cover invalid projects and cross-site access, but do not specify successful ordering, limits, malformed lines or a missing events file. — [.plans/20261123-102654-event-watcher-and-waits-for.md:188](/Users/gorantubic/Workspace/claude-config/.plans/20261123-102654-event-watcher-and-waits-for.md:188) — Add those cases and document why 401 and 404 do not apply to this route’s chosen contract.

### Edge cases the plan should address

- A failed automatic pull followed by recovery — the persisted merge state otherwise prevents another pull attempt.
- A waiting plan edited or removed between evaluation and launch — recheck the condition and eligibility before starting work.
- Git fetch or ancestry checks fail, or a short SHA is ambiguous — distinguish an error from a condition that is simply unmet.
- A saved wait error resolves and later recurs — define when its deduplication record is cleared.
- A dashboard holding the watcher lock exits while another remains running — define takeover without requiring the second server to restart.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
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
1. Specify how an automatic pull of relevant dashboard changes performs the relay check and conditional restart required after changes land in the main checkout. Include safe handling when the watcher itself performs the pull. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:23; AGENTS.md:9)
2. Define durable launch intent, event persistence and recovery so interruption between launch, event append and state save cannot duplicate launches or events. Add interruption tests. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:138; scripts/plans-dashboard.mjs:643)
3. Use atomic watcher-lock acquisition and safe stale-lock recovery, and test simultaneous server starts. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:143)
4. Count long-running work using reliable process or run evidence; fail closed when uncertain rather than excluding a run solely because its report is old. Test a live run with an old report. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:116; scripts/plans-dashboard.mjs:496)
5. Give merge-event detection a complete, independently paginated PR source, and test an older PR and multiple PRs on a reused branch. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:74; scripts/plans-dashboard.mjs:1320)
6. Populate current plan-branch mappings for every project before checking plan conditions, and test both registry orders and a changed custom branch header. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:129; scripts/plans-dashboard.mjs:305; scripts/plans-dashboard.mjs:486)
7. Specify sanitized public errors and redaction before persisting, notifying, logging or returning external command output. Test secrets and URL queries. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:128; scripts/plans-dashboard.mjs:1311)

SHOULD FIX:
1. Revalidate the post-move paths, wiring and test command against the prerequisite move after it merges. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:44)
2. Add endpoint tests for success, ordering, limits, malformed lines and a missing file, and explain why 401 and 404 do not apply to the chosen contract. (evidence: .plans/20261123-102654-event-watcher-and-waits-for.md:188)

ADD THESE EDGE CASES:
- A failed automatic pull followed by recovery.
- A plan edited or removed between condition evaluation and launch.
- Fetch or ancestry failures and ambiguous short SHAs.
- A wait error that resolves and later recurs.
- Watcher takeover after the lock holder exits while another server remains running.

Do not change anything the validation did not flag.
```