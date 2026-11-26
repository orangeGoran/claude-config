## Plan validation (codex): 20261126-113132-insights-ledger.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Integration] Neither the watcher nor migration supplies `projectsDir`, and the plan gives it no default. `loadSubagents()` therefore sees no transcript directory, so phase costs omit subagent usage and can differ from `run-usage.mjs` — [.plans/20261126-113132-insights-ledger.md:74](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:74), [.claude/scripts/run-usage.mjs:131](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:131), [.claude/scripts/run-usage.mjs:420](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:420) — Default it to `~/.claude/projects` and test the production call path with a throwaway transcript.

- [Data accuracy] The unchanged check uses only log size and modification time, although the record includes report fields. The pipeline updates the report independently, including after the session exits; report-only changes can leave the ledger permanently missing the final outcome, status or PR — [.plans/20261126-113132-insights-ledger.md:74](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:74), [.claude/scripts/auto-pipeline.sh:487](/Users/gorantubic/Workspace/claude-config/.claude/scripts/auto-pipeline.sh:487) — Track report changes as well and test a report-only transition.

- [Run completion] A quiet run is treated as finished after 30 minutes even if it is still live, and a missing outcome is treated as finished immediately. The dashboard explicitly distinguishes a live session from report status — [.plans/20261126-113132-insights-ledger.md:74](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:74), [docs/plans-dashboard.md:131](/Users/gorantubic/Workspace/claude-config/docs/plans-dashboard.md:131) — Define a completion check that protects live and starting runs, including quiet runs and missing or stale reports; test those cases.

- [Concurrency] The watcher and migration can both read the same ledger state and append the same run, or append an older snapshot after a newer one. The watcher’s existing lock does not cover the migration command — [.plans/20261126-113132-insights-ledger.md:73](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:73), [.plans/20261126-113132-insights-ledger.md:75](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:75), [apps/dashboard/server.mjs:2070](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:2070) — Serialize ledger read, comparison and append across both writers, with recovery from a stale lock, and test concurrent writers.

- [Wiring] The new server import transitively requires `.claude/scripts/run-usage.mjs`, but `copyDashboard()` copies only `apps`, `scripts`, `skills` and `docs`. Existing copied-dashboard tests and the documentation preview would fail to start — [.plans/20261126-113132-insights-ledger.md:62](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:62), [scripts/docs-media.mjs:51](/Users/gorantubic/Workspace/claude-config/scripts/docs-media.mjs:51) — Include the dependency in copied dashboards or choose an integration that preserves those consumers, and verify them.

- [Data accuracy] `parsed.results[].usage` can be null when a result has only `total_cost_usd`; the prescribed token summation would fail or give no meaningful token total for that supported log format — [.plans/20261126-113132-insights-ledger.md:72](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:72), [.claude/scripts/run-usage.mjs:101](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:101) — Define missing-usage token semantics and test `total_cost_usd`-only and mixed result lines.

- [Watcher ownership] The proposed append has no lock fence immediately before its side effect. Existing watcher writes call `fence()` because ownership can change during an awaited tick — [.plans/20261126-113132-insights-ledger.md:76](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:76), [apps/dashboard/server.mjs:1793](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:1793) — Fence ledger writes and preserve `LOST_LOCK` handling; test a lock change during a tick.

### Non-blocking concerns

- [Restart rule] The plan omits the condition that restart runs only when `pgrep` shows live chats under the relay — [.plans/20261126-113132-insights-ledger.md:18](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:18), [AGENTS.md:9](/Users/gorantubic/Workspace/claude-config/AGENTS.md:9) — State the condition in the Open item.

- [Test harness] `watcher.test.mjs` already starts its shared server in `before()`; the proposed case says to start another server with the same environment and port — [.plans/20261126-113132-insights-ledger.md:105](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:105), [apps/dashboard/test/watcher.test.mjs:172](/Users/gorantubic/Workspace/claude-config/apps/dashboard/test/watcher.test.mjs:172) — Use the shared server or a separate HOME and ports.

- [Performance] A limit on appended lines does not bound the work to scan unchanged, empty, live or failing logs, nor the synchronous reading of large logs and transcripts — [.plans/20261126-113132-insights-ledger.md:74](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:74) — Specify a bounded scan or explain and verify its effect on the server.

### Edge cases the plan should address

- Missing or unreadable `auto-runs` directories — one project must not prevent later projects from syncing.
- Null phase durations and costs across sessions — preserve unknown values instead of silently converting them to zero.
- A partially written final ledger line — a later append must remain independently readable.
- A log or report changing during collection — avoid marking an inconsistent snapshot as current.
- Migration encountering per-log errors — make incomplete migration visible through its exit status or an explicit documented result.

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
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261126-113132-insights-ledger.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Default projectsDir to ~/.claude/projects for watcher and migration calls, and test the production call path with a throwaway subagent transcript (evidence: .plans/20261126-113132-insights-ledger.md:74; .claude/scripts/run-usage.mjs:131,420).
2. Include report changes in the record freshness check and test a report-only transition to the final outcome and PR (evidence: .plans/20261126-113132-insights-ledger.md:74; .claude/scripts/auto-pipeline.sh:487).
3. Define a completion check that protects live and starting runs, including quiet runs and missing or stale reports, and test those cases (evidence: .plans/20261126-113132-insights-ledger.md:74; docs/plans-dashboard.md:131).
4. Serialize the ledger read, comparison and append across watcher and migration writers, recover from stale locks, and test concurrent writers and snapshot ordering (evidence: .plans/20261126-113132-insights-ledger.md:73-75; apps/dashboard/server.mjs:2070).
5. Include the run-usage dependency in copied dashboards or use an integration that preserves copied-dashboard consumers, and verify those consumers (evidence: .plans/20261126-113132-insights-ledger.md:62; scripts/docs-media.mjs:51).
6. Define token semantics when result usage is missing, and test total_cost_usd-only and mixed result lines (evidence: .plans/20261126-113132-insights-ledger.md:72; .claude/scripts/run-usage.mjs:101).
7. Fence watcher ledger writes immediately before their side effects, preserve LOST_LOCK handling, and test a lock change during a tick (evidence: .plans/20261126-113132-insights-ledger.md:76; apps/dashboard/server.mjs:1793).

SHOULD FIX:
1. State that the post-merge restart runs only when pgrep shows that live chats run under the relay (evidence: .plans/20261126-113132-insights-ledger.md:18; AGENTS.md:9).
2. Use the watcher test's shared server or give a new server a separate HOME and ports (evidence: .plans/20261126-113132-insights-ledger.md:105; apps/dashboard/test/watcher.test.mjs:172).
3. Bound the work of scanning and reading runs per tick, or explain and verify its effect on the server (evidence: .plans/20261126-113132-insights-ledger.md:74).

ADD THESE EDGE CASES:
- Missing or unreadable auto-runs directories must not prevent later projects from syncing.
- Preserve unknown phase durations and costs when aggregating sessions.
- A partial final ledger line must not make the next appended line unreadable.
- A log or report that changes during collection must not produce a snapshot marked current.
- Make per-log migration errors visible through the exit status or an explicit documented result.

Do not change anything the validation did not flag.
```