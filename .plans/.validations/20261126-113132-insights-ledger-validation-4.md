**Validation round:** 4

## Plan validation: 20261126-113132-insights-ledger.md

**Verdict:** APPROVE WITH CHANGES

Scope of this round: the round-3 edits (diff of `-pre-round-3.md` against `-pre-round-4.md`), checked against `apps/dashboard/server.mjs`, `.claude/scripts/run-usage.mjs`, `scripts/docs-media.mjs`, `.claude/scripts/auto-pipeline.sh` and `apps/dashboard/test/watcher.test.mjs`. Every round-3 fix is present and mostly correct. No finding blocks the plan. Four small gaps remain: two are text that does not match, and two are tests that may be flaky or may not be able to fail.

### Blocking issues

None.

### Non-blocking concerns

1. [Consistency, usage reuse] The Contracts section (plan line 41) and step 5 (line 112: "it reuses the usage fields when only the report changed") put the reuse inside `runRecord()`. But step 2 (line 101), which specifies `runRecord()`, still says "It calls `parseLog(logText)`" with no condition, and it names only "the carry-over from `previous`" from the Contracts section. An implementer who follows step 2 parses again and splits the phases again, and then the "transcript deleted" test (line 150) fails. Fix: in step 2, say first: "When `previous` exists and `src.logSize`/`src.logMtimeMs` equal `previous.src`, copy `results`, `cost`, `costSource`, `tokens`, `phases`, `minutes` from `previous` and skip `parseLog`/`loadSubagents`/`phaseRows`/`applyCosts`."
2. [Reference implementation, outcome rule] The plan says the outcome rule is "copied" (line 38, line 66). But it differs from `outcomeOf()` at `apps/dashboard/server.mjs:336-338`: there, any other status gives `'running'`, while the plan gives null (and the test at line 136 expects `CLEANED` → null). Null is the right value for the ledger, but the Deviations list does not name this difference. The plan also does not say that the status words are matched without regard to case (`/i` at `server.mjs:337-338`), or that the separator is `\s*` (`server.mjs:344,346`), while step 2 uses a literal single space. Fix: add to the outcome deviation line: "any other status gives null instead of `running` (a finished run in the ledger is never `running` by status words); the status words match without regard to case, as in `outcomeOf()`."
3. [Test that can be flaky or unable to fail, lock reclaim] Line 148 says: "Two `takeLedgerLock()` calls on the same stale lock (one through a child process): exactly one gets the lock." The two calls do not run at the same moment, so they run one after the other. A simple reclaim (unlink the stale lock, then link) also passes, so the test cannot catch the defect that `renameSync` + pid compare (`server.mjs:1780-1789`) prevents. The test can also be flaky: when the child takes the lock and exits before the parent calls, its pid is dead, the parent reclaims the lock, and both calls succeed. Fix: keep the child alive (it reports its result on stdout, and the test stops it by its handle) until the parent's call has returned. Add a line in Harness constraints: "the rename guard against a lock that another process replaces between the check and the rename is not proven by a test (no deterministic seam), as for the watcher lock".
4. [Test setup, busy lock] At line 148, a live child holds the lock as `{ pid, cmd }`. The lock is not stale only when `cmd` equals the `ps -p <pid> -o command=` output of the child (`server.mjs:1768-1769`). When the test writes any other text, the lock is judged stale and taken, and the busy test fails. That failure is visible, but the plan should say how the test gets `cmd`. Fix: "the test reads `cmd` with `ps -p <child pid> -o command=`."
5. [Signatures] `takeLedgerLock()` and `releaseLedgerLock()` are exported (line 72) and called directly by the tests (line 148), but the plan gives no arguments and no return value. Fix: state `takeLedgerLock(lockFile) → boolean` and `releaseLedgerLock(lockFile) → void`.

### Edge cases the plan should address

- `ps` fails for the own pid. `linkLock()` then returns false (`server.mjs:1750-1752`), so `takeLedgerLock()` fails and `syncLedger()` returns `{ busy: true }`. The `--migrate` command then waits 60 s and prints "The dashboard is writing the ledger", which is not true in this case. A short note, or a different message when this process cannot read its own command, would help.
- A dead run whose report still says `Outcome: running` after `staleMs` gets `outcome: 'running'` in the ledger, and the carry-over does not fix it (the value is not null). This follows the copied rule, so the plan only needs to say that it is intended.

### Checks of the round-3 fixes

- Ledger lock (round 3 #1): matches `linkLock()`/`lockState()`/`takeLock()` at `server.mjs:1748-1792`. That covers the temp file + `linkSync`, an unreadable lock older than 10 s, a dead pid, the `ps` command compare, a rename to `.stale.<pid>` with a moved-pid check and link-back, and release only of an own lock. The `EPERM` = alive change is named as a deviation with a reason (`pidAlive()` at `server.mjs:412`). Correct.
- Folder before lock (#2): step 5 makes the folder, then takes the lock, and does not make the folder at append time any more. This matches `takeLock()` `mkdirSync(CENTRAL)` at `server.mjs:1774`. A fresh-folder test was added. Correct.
- Usage reuse (#3): Contracts and step 5 are correct. Step 2 does not match them (concern 1). The test at line 150 can fail.
- Failed-map expiry (#4): `{ src, at: now }`, removed after 10 min. The test (line 151) uses mode `000` → `644`. `chmod` changes only ctime, and `src` uses size and mtime, so without the expiry the second call skips the run and the test fails. Correct.
- Busy result in step 8 (#5): a busy result is skipped before the `added`/`errors` logging. Correct. `watchTick()` is guarded by `watching` (`server.mjs:2071`), so one server never runs two syncs at once.
- Outcome rule (#6): `OUTCOMES`, lower case and the stale `failed` match `parseReport()`/`pipelineRunInfo()` at `server.mjs:335-366`. The other-status value and case are not listed (concern 2).
- Test baselines (#7): `SKILL_PHASES` keys (`run-usage.mjs:24`) and the `loadSubagents` path and meta rule (`run-usage.mjs:131-170`) match the fixture. The baseline is the same call with an empty `projectsDir`, so a wrong default `projectsDir` in the CLI fails the test. Correct.
- Mode regex `[a-z]+`: covers the modes `verify|commit|pr` (`auto-pipeline.sh:596-598,761`). Launched format matches `now()` (`auto-pipeline.sh:91`).

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated
- [ ] Reference implementation mirrored, deviations justified (outcome null/case not listed, concern 2)
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no endpoint changes)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail (the lock-reclaim test cannot fail for a simple reclaim, concern 3)

```
Update the plan at .plans/20261126-113132-insights-ledger.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 2, start runRecord() with the usage-reuse rule: when previous exists and src.logSize and src.logMtimeMs equal previous.src, copy results, cost, costSource, tokens, phases and minutes from previous and do not call parseLog, loadSubagents, phaseRows or applyCosts. Step 2 now says that it always calls parseLog. (evidence: plan line 101 vs lines 41 and 112)
2. In Deviations, on the outcome-rule line, say that any other status gives null instead of 'running' (outcomeOf() returns 'running'), and that the status words match without regard to case, as in outcomeOf(). (evidence: apps/dashboard/server.mjs:336-338, plan lines 38 and 66)
3. In the lock test, keep the child process alive until the parent's takeLedgerLock() call has returned (the child prints its result, and the test stops it by its handle). Add to Harness constraints that no test proves the rename guard against a lock that is replaced between the check and the rename. (evidence: plan line 148, server.mjs:1780-1789)
4. In the busy-lock test, say that the test reads the child's cmd with `ps -p <pid> -o command=`; any other text makes the lock stale. (evidence: server.mjs:1768-1769)
5. State the signatures: takeLedgerLock(lockFile) returns a boolean, releaseLedgerLock(lockFile) returns nothing. (evidence: plan lines 72 and 148)

ADD THESE EDGE CASES:
- ps cannot read this process's own command: takeLedgerLock() fails, and --migrate must not say "The dashboard is writing the ledger" in that case.
- A dead run whose report still says Outcome running after staleMs is recorded as 'running'. Say that this is intended.

Do not change anything the validation did not flag.
```
