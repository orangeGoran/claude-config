## Plan validation (codex): 20261126-113132-insights-ledger.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data loss] Source selection uses the largest of the log and report modification times, with the later append winning ties. If a report is removed or restored with an older timestamp, or if only the older of the two files changes, a newer snapshot can lose to an older one; concurrent writers can also append equal-timestamp snapshots in the wrong order. The scanner then repeatedly sees a changed source without making the new data valid. — `.plans/20261126-113132-insights-ledger.md:43`, `.plans/20261126-113132-insights-ledger.md:96` — Define a concurrency-safe ordering or serialized update protocol that handles changes and deletion of either source, and test late writers and equal timestamps.

- [Duplicate side effects] The watcher and migration command can both inspect a partial final line and append its separator and a record separately. Their writes can interleave, leaving an unparsable record; choosing the newest valid source cannot recover a record that was corrupted during append. — `.plans/20261126-113132-insights-ledger.md:59`, `.plans/20261126-113132-insights-ledger.md:101` — Coordinate writers across processes, including partial-line repair, and test concurrent migration and watcher writes.

- [Live-run detection] The migration command uses only `pgrep`, while the dashboard’s `pipelineLive()` also checks activity in the run’s worktree when the pipeline process is not found. A long-running active session without a matching process can be recorded as finished by migration. — `apps/dashboard/server.mjs:397`, `.plans/20261126-113132-insights-ledger.md:94` — Share or reproduce the complete live check for the CLI, and cover the worktree activity fallback.

- [Project scope] Both the watcher and migration scan every registered project’s `auto-runs` directory, although the plan excludes generic-flavor projects. The server identifies pipeline flavor with `hasPipeline`; `allProjects()` includes both flavors. A generic project with an `auto-runs` directory can therefore enter the ledger. — `apps/dashboard/server.mjs:194`, `apps/dashboard/server.mjs:199`, `apps/dashboard/server.mjs:247`, `.plans/20261126-113132-insights-ledger.md:103` — Apply the same pipeline-flavor check in both entry points and test a generic project with a populated `auto-runs` directory.

- [History preservation] Cleanup rewrites the report status and removes its Outcome line. The planned rescan treats that changed report as a new source and, after the stale period, replaces the recorded outcome with null. — `.claude/scripts/auto-pipeline.sh:580`, `.claude/scripts/auto-pipeline.sh:581`, `.plans/20261126-113132-insights-ledger.md:97` — Define how cleanup preserves the last finished outcome, including when migration first sees an already-cleaned report, and add tests for both cases.

### Non-blocking concerns

- [Verification] The CLI’s `pgrep` check and its response to errors other than exit code 1 are not covered by the proposed tests. — `.plans/20261126-113132-insights-ledger.md:94`, `.plans/20261126-113132-insights-ledger.md:133` — Add isolated coverage for the command’s arguments and failure handling.
- [Documentation] The documented 40 MB per-tick limit is not strict: the tests require one oversized log to be processed. — `.plans/20261126-113132-insights-ledger.md:108`, `.plans/20261126-113132-insights-ledger.md:129` — Document the single-log exception.

### Edge cases the plan should address

- A report disappears, is restored with an older timestamp, or changes while its log has a later timestamp — the valid record must still reflect the intended current source.
- The watcher and migration repair a partial ledger line at the same time — neither record should be corrupted.
- A run is active in its worktree without a matching pipeline command — migration must not record it as finished.
- A generic project has an `auto-runs` directory — its logs must remain outside the ledger.
- Cleanup removes an Outcome before or after migration — the ledger must retain or explicitly account for the finished outcome.

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
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261126-113132-insights-ledger.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Replace the max-mtime and append-order selection rule with a concurrency-safe ordering or serialized update protocol that handles changes and deletion of either source. Test late writers, equal timestamps, and a changed source whose timestamp is older than the other source. (evidence: .plans/20261126-113132-insights-ledger.md:43, .plans/20261126-113132-insights-ledger.md:96)
2. Coordinate watcher and migration writes across processes, including partial-last-line repair, and test simultaneous writers. A newest-valid-record rule cannot recover an interleaved, unparsable append. (evidence: .plans/20261126-113132-insights-ledger.md:59, .plans/20261126-113132-insights-ledger.md:101)
3. Make migration use the complete live-run check, including the worktree activity fallback, and test that fallback. (evidence: apps/dashboard/server.mjs:397, .plans/20261126-113132-insights-ledger.md:94)
4. Filter both watcher and migration inputs by the dashboard's pipeline-flavor check, and test a generic project with a populated auto-runs directory. (evidence: apps/dashboard/server.mjs:194, apps/dashboard/server.mjs:199, apps/dashboard/server.mjs:247, .plans/20261126-113132-insights-ledger.md:103)
5. Define how the ledger preserves a finished outcome when cleanup removes the report's Outcome line, including when migration first sees an already-cleaned report; add tests for both cases. (evidence: .claude/scripts/auto-pipeline.sh:580, .claude/scripts/auto-pipeline.sh:581, .plans/20261126-113132-insights-ledger.md:97)

SHOULD FIX:
1. Add isolated CLI live-check tests for the pgrep arguments and errors other than exit code 1. (evidence: .plans/20261126-113132-insights-ledger.md:94, .plans/20261126-113132-insights-ledger.md:133)
2. Document that one oversized log can exceed the stated 40 MB per-tick limit. (evidence: .plans/20261126-113132-insights-ledger.md:108, .plans/20261126-113132-insights-ledger.md:129)

ADD THESE EDGE CASES:
- A report disappears, is restored with an older timestamp, or changes while its log has a later timestamp.
- The watcher and migration repair a partial ledger line at the same time.
- A run is active in its worktree without a matching pipeline command.
- A generic project has an auto-runs directory.
- Cleanup removes an Outcome before or after migration.

Do not change anything the validation did not flag.
```