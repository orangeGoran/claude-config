## Plan validation (codex): 20261126-113132-insights-ledger.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Cost accuracy] The plan says cost stays exact and calls for a mixed log test, but `applyCosts()` uses only result lines with model-usage costs whenever any such line exists. It ignores `total_cost_usd`-only results in that case. A run with mixed result formats can therefore be undercounted, and the proposed mixed-log test checks tokens but not cost. — [.plans/20261126-113132-insights-ledger.md:41](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:41), [.claude/scripts/run-usage.mjs:340](/Users/gorantubic/Workspace/claude-config/.claude/scripts/run-usage.mjs:340) — Define how to account for mixed-format streams without double-counting resumed totals, and test the resulting cost.
- [Error handling] The scan puts each project in a `try`, but specifies per-run recovery only for errors from `runRecord()`. A failed log read, report read or `stat` can therefore abort the rest of that project and bypass the `failed` retry map, despite the tests requiring later runs to be processed. — [.plans/20261126-113132-insights-ledger.md:106](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:106) — Put all per-run I/O inside a per-run error boundary; distinguish an absent report from an unreadable one, record retryable failures, and continue with the next run.

### Non-blocking concerns

- [Reference discrepancy] The plan describes its outcome rule as copied from the dashboard, but the dashboard returns `running` for an unrecognized status while the planned ledger returns null. This appears intentional for cleaned reports, but the deviation should be explicit. — [.plans/20261126-113132-insights-ledger.md:38](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:38), [server.mjs:336](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:336).
- [Verification] The proposed permissions test uses mode `000`; it may still be readable under a privileged test runner. Use a deterministic injected read failure or state the harness constraint. — [.plans/20261126-113132-insights-ledger.md:159](/Users/gorantubic/Workspace/claude-config/.plans/20261126-113132-insights-ledger.md:159).

### Edge cases the plan should address

- A log containing both model-usage costs and `total_cost_usd`-only results, including a resumed session — the total must neither omit a stream nor count a cumulative total twice.
- A report that exists but cannot be read — treating it as absent can append incomplete metadata instead of retrying.
- A log disappearing or changing permissions between directory listing, `stat` and read — one run’s failure must not prevent later runs in that project from being scanned.

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
1. Define and test how mixed model-usage and total_cost_usd-only streams contribute to the ledger cost, including resumed cumulative totals, without omission or double-counting. applyCosts currently ignores total_cost_usd-only results when any result has model-usage cost. (evidence: .plans/20261126-113132-insights-ledger.md:41; .claude/scripts/run-usage.mjs:340)
2. Put each run's stat, report read, log read, parsing and re-stat inside a per-run error boundary. Distinguish a missing report from an unreadable one, record retryable failures, and continue scanning later runs in the project. Add tests for these failures. (evidence: .plans/20261126-113132-insights-ledger.md:106)

SHOULD FIX:
1. State explicitly that the ledger's null outcome for an unrecognized status differs from the dashboard's running fallback, and explain why. (evidence: .plans/20261126-113132-insights-ledger.md:38; apps/dashboard/server.mjs:336)
2. Make the unreadable-file test deterministic under privileged test runners, or state its harness constraint. (evidence: .plans/20261126-113132-insights-ledger.md:159)

ADD THESE EDGE CASES:
- Mixed model-usage and total_cost_usd-only results, including a resumed session.
- An existing report that cannot be read.
- A log that disappears or changes permissions between listing, stat and read.

Do not change anything the validation did not flag.
```