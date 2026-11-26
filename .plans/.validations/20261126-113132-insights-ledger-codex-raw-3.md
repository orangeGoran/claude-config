## Plan validation (codex): 20261126-113132-insights-ledger.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data retention] A report-only change causes `runRecord()` to recalculate phase costs from the current transcripts. If those transcripts have been deleted, the new last line replaces the preserved phase history with a different allocation, despite the stated retention goal — [.plans/20261126-113132-insights-ledger.md:107](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:107), [.claude/scripts/run-usage.mjs:340](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:340) — Preserve the prior usage-derived fields when only the report changes, and define safe behavior when a changed log needs transcripts that are no longer available. Add tests for both cases.
- [Concurrency] The stale-lock rule treats every `process.kill(pid, 0)` error as proof that the process is dead, and does not specify a safe stale-lock replacement or ownership check on release — [.plans/20261126-113132-insights-ledger.md:59](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:59), [apps/dashboard/server.mjs:1773](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:1773) — A permission error can identify a live holder as stale, and competing reclaimers can remove a replacement lock, allowing concurrent writers. Specify ownership-safe acquisition, stale recovery and release; treat permission errors as alive or indeterminate. Test concurrent reclaim and release.
- [Initialization] The plan takes the ledger lock before creating its parent directory; directory creation occurs only immediately before append — [.plans/20261126-113132-insights-ledger.md:102](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:102), [.plans/20261126-113132-insights-ledger.md:109](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:109) — A first migration with no dashboard data directory cannot create the lock or ledger. Create the directory before acquiring the lock and test a fresh HOME.
- [Recovery] The persistent `failed` map suppresses retries whenever source metadata is unchanged, including after transient read or transcript errors — [.plans/20261126-113132-insights-ledger.md:104](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:104), [.plans/20261126-113132-insights-ledger.md:108](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:108) — A temporary permission or I/O failure can permanently omit a run until its source changes or the server restarts. Add a bounded retry or expiry policy and test recovery without a source change.

### Non-blocking concerns

- [Verification] The plan assumes the proposed scan limits keep a watcher tick short, but the budget excludes transcript reads and synchronous processing — [.plans/20261126-113132-insights-ledger.md:106](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:106), [.claude/scripts/run-usage.mjs:131](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:131) — Qualify the claim or specify a bound that includes transcript work.
- [Reference accuracy] `sumModelUsage` and `sumRows` exist but are not exported; the plan’s list calls them exported functions — [.plans/20261126-113132-insights-ledger.md:53](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:53), [.claude/scripts/run-usage.mjs:45](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:45), [.claude/scripts/run-usage.mjs:372](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:372) — Correct the description; neither is required by the proposed imports.

### Edge cases the plan should address

- A report changes after transcript deletion — retain the previously recorded usage data.
- Two processes attempt to reclaim a stale lock at once, or a live lock holder cannot be signaled — preserve one writer.
- A transient read failure clears without changing file metadata — retry the run.
- A fresh HOME has no ledger directory — migration can initialize it.
- A valid JSON object is the last ledger line without a newline — preserve it while appending the next record.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
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
1. Preserve previously recorded usage-derived fields when only the report changes after transcripts are deleted. Define safe behavior for a changed log when needed transcripts are gone, and add tests for both cases. (evidence: .plans/20261126-113132-insights-ledger.md:107; .claude/scripts/run-usage.mjs:340)
2. Specify ownership-safe lock acquisition, stale-lock recovery and release. Treat permission errors from the PID check as alive or indeterminate, and test concurrent stale-lock reclaim and release. (evidence: .plans/20261126-113132-insights-ledger.md:59; apps/dashboard/server.mjs:1773)
3. Create the ledger parent directory before acquiring its lock, and test migration with a fresh HOME. (evidence: .plans/20261126-113132-insights-ledger.md:102; .plans/20261126-113132-insights-ledger.md:109)
4. Add a bounded retry or expiry policy for failed records so transient failures recover without source metadata changing, and test that recovery. (evidence: .plans/20261126-113132-insights-ledger.md:104; .plans/20261126-113132-insights-ledger.md:108)

SHOULD FIX:
1. Qualify the claim that scan limits keep a watcher tick short, or specify a bound that includes transcript reads and processing. (evidence: .plans/20261126-113132-insights-ledger.md:106; .claude/scripts/run-usage.mjs:131)
2. Correct the reference description: sumModelUsage and sumRows are not exported. (evidence: .plans/20261126-113132-insights-ledger.md:53; .claude/scripts/run-usage.mjs:45; .claude/scripts/run-usage.mjs:372)

ADD THESE EDGE CASES:
- A report changes after its transcripts are deleted.
- Two processes reclaim a stale lock concurrently, or a live holder cannot be signaled.
- A transient read failure clears without a source metadata change.
- A fresh HOME has no ledger directory.
- The final ledger line is valid JSON but has no newline before an append.

Do not change anything the validation did not flag.
```