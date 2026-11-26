**Validation round:** 3

## Plan validation: 20261126-113132-insights-ledger.md

**Verdict:** APPROVE WITH CHANGES

Scope of this round: the diff `pre-round-2.md` → current plan (the current plan is identical to `pre-round-3.md`), checked against `apps/dashboard/server.mjs`, `.claude/scripts/run-usage.mjs`, `.claude/scripts/auto-pipeline.sh`, `docs/plans-dashboard.md`, `scripts/docs-media.mjs` and `apps/dashboard/test/watcher.test.mjs`. Every round-2 fix (#1, #3–#16) reached Contracts, Reference implementation, Steps, Tests and the docs step (step 11). The fixes below are regressions or gaps in the new text, not points the round logs already decided.

Verified correct:
- Subagent fixture (round-2 #5): `loadSubagents()` reads `agent-*.meta.json` `toolUseId` (`run-usage.mjs:146-153`); `phaseRows()` maps an `Agent`/`Task` tool_use id to the current row (`run-usage.mjs:247`), and a transcript goes to that row, else to `unattributed` (`run-usage.mjs:259-262`). Phases start at a `Skill` tool_use whose `input.skill` is in `SKILL_PHASES` (`run-usage.mjs:24`, `markerOf` at `:175-181`). Since the total cost is fixed by `costUSD`, more test tokens move cost share from `implement` to `test` (`applyCosts` `:354-355`), so "test larger, implement smaller" can fail when the transcript is not attributed. Correct.
- `applyCosts(parsed, rows)` with the `phaseRows()` result (round-2 #6): matches `run-usage.mjs:340,348` and `main()` `:434-436`.
- Fake `pgrep` test (round-2 #8): the arguments `-f` and `[s]kill-auto-pipeline demo\.run\.md` match `pipelineLive()` escaping (`server.mjs:401`). `execFileSync` resolves `pgrep` through `process.env.PATH`, so a fake first in `PATH` works in-process.
- `hasPipeline` filter (round-2 #3): `resolveProject()` sets `hasPipeline: existsSync(<root>/.claude/scripts/auto-pipeline.sh)` (`server.mjs:193,198`); the resolved objects carry `name` and `autoRunsDir` (`:191,195,204`), so `projects.filter((p) => p.hasPipeline)` is a valid `syncLedger` input. `registryProjects()` uses the same check.
- Status-word rule (round-2 #4): the word lists match `docs/plans-dashboard.md:131` and `outcomeOf()` (`server.mjs:336-338`); mapping "other" to null instead of `running` is what makes the carry-over work, and the cleanup case matches `auto-pipeline.sh:580-581`.
- PR regex (round-2 #10): matches `sync_report_outcome` `auto-pipeline.sh:150`.
- Watcher end-to-end case: the shared server's `PATH` has no fake `pgrep` (`watcher.test.mjs:86,180-182`), so the real `pgrep` finds nothing and the run is not live; other cases write no `*.log` into `auto-runs/`.

### Blocking issues

None.

### Non-blocking concerns

1. [Regression: ledger lock] The lock only mirrors `linkLock()`, not the stale handling of `takeLock()`/`lockState()`. Evidence: plan lines 59, 102; `server.mjs:1757-1791`. (a) Two writers that both see a stale lock can both "replace" it (unlink + link): the second unlinks the first one's fresh lock and both write. `takeLock()` prevents this with a `renameSync` to a unique name and a pid compare (`:1780-1789`). (b) A pid that the OS gave to another process of the same user makes `process.kill(pid, 0)` succeed, so the lock is never stale: the watcher returns `busy` on every tick and `--migrate` always exits 1, with no message that says why. `lockState()` stores and compares the `ps` command line for this (`:1768-1769`). (c) The release in `finally` must unlink only a lock that still names this pid, else a process can delete a lock another process took after a stale replacement. Fix: in step 5 and Reference implementation, name `takeLock()` + `lockState()` as the pattern (rename-to-unique replacement, `cmd` compare or a max lock age, owner check on release), and add a unit test for the owner check on release.
2. [Regression: busy result shape] Step 5 returns `{ busy: true }` only (plan line 102), but step 8 logs "each error path once" from the result (line 113). With `errors` undefined, a loop over `r.errors` throws a TypeError, which the own `try`/`catch` logs as `watcher: insights: … is not iterable` on every tick while a migration runs. Fix: return the full counts with `busy: true` (all 0, `errors: []`), or say in step 8 that a `busy` result is skipped (optionally one log line, like `lockNoted` at `server.mjs:2075-2076`).
3. [Regression: lock folder] Step 5 takes `file + '.lock'` first (line 102) but creates the folder only before the append (line 109). On a fresh HOME (`~/.claude/pipeline-dashboard/` missing, the CLI test case at line 148) the link fails with ENOENT; if that counts as "held", `--migrate` retries 60 s and exits 1. `takeLock()` runs `mkdirSync(CENTRAL, { recursive: true })` first (`server.mjs:1774`). Fix: create the ledger folder before taking the lock, and treat only EEXIST as "held".
4. [Outcome rule vs dashboard] The plan takes the Outcome line as it is (Contracts line 38, step 2 regex `^- \*\*Outcome\*\*: (\S+)`). The dashboard treats an Outcome `failed` whose status words are not failed as stale and uses the status words (`server.mjs:362-366`, `docs/plans-dashboard.md:131`: "A `failed` whose status no longer starts with `BLOCKED`, `FAILED` or `ENDED` is stale"). It also accepts only `running | needs-you | failed`, case-insensitive, with `\s*` after the colon (`parseReport`, `server.mjs:344,347`). A run that a chat fixed (status `PR OPEN`, Outcome still `failed`) would be a failure in the ledger and "waiting on you" on the dashboard, so the Insights page (plan 2) would count it wrong. Fix: in Contracts and step 2, apply the stale-`failed` rule and the `OUTCOMES` filter (an unknown Outcome word counts as no Outcome line), mirror the `parseReport` regexes, and add one `runRecord` test: Outcome `failed` + `## Status: PR OPEN …` gives `needs-you`.
5. [Test can fail weakly] The CLI test says the transcript run "has the larger `phases.test.cost`" (line 148) but names no baseline. Fix: compare with the value that `runRecord` gives for the same log with an empty `projectsDir` (or with a fixed expected value). Also state that the `Skill` fixture uses `input.skill` (the `skill()` helper of `run-usage.selftest.mjs`), because `markerOf` reads `tu.input?.skill` (`run-usage.mjs:177`).

### Edge cases the plan should address

- Re-launch of a slug in `verify` mode after an earlier run of the same slug opened a PR: the new report has no `PR:` line, so the carry-over (line 41) keeps the old PR in the new line. Say whether that is intended (one line per slug, line 12) or limit the `pr` carry-over to reports whose status is `CLEANED`.
- A crash or `npm run restart` while `syncLedger()` holds the lock: `finally` does not run on a signal, so the lock stays with a dead pid. That is handled as stale, but only after the fix in concern 1 is it safe against pid reuse.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [ ] Reference implementation mirrored, deviations justified (lock: concern 1; outcome: concern 4)
- [x] Breaking changes for changed symbols listed (consumer search done: `copyDashboard` is the only copier, `scripts/docs-media.mjs:51-60`)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no endpoint in this plan)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261126-113132-insights-ledger.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In Reference implementation and step 5, name takeLock() and lockState() of apps/dashboard/server.mjs as the lock pattern, not only linkLock(): replace a stale lock with a rename to a unique name and a pid compare, detect a reused pid (store and compare the ps command line, or a max lock age), and in the finally unlink the lock only when it still names this pid. Add a unit test for the owner check on release. (evidence: apps/dashboard/server.mjs:1757-1791; plan lines 59, 102)
2. Make the busy result of syncLedger() carry the full counts ({ busy: true, added: 0, ..., errors: [] }), or say in step 8 that the watcher skips a busy result, so the error-path loop does not throw on every tick during a migration. (evidence: plan lines 102, 110, 113)
3. In step 5, create the ledger folder (mkdirSync recursive) before taking the lock, and treat only EEXIST as a held lock. (evidence: apps/dashboard/server.mjs:1774; plan lines 102, 109, 148)
4. In Contracts and step 2, mirror the dashboard's outcome rules: an Outcome of failed whose status words are not failed is stale and the status words decide; only running, needs-you and failed count as an Outcome (case-insensitive, \s* after the colon, as parseReport). Add a runRecord test: Outcome failed with "## Status: PR OPEN ..." gives needs-you. (evidence: apps/dashboard/server.mjs:344-347, 362-366; docs/plans-dashboard.md:131)
5. In the CLI test, name the baseline of "the larger phases.test.cost" (the runRecord value for the same log with an empty projectsDir), and say that the Skill fixture uses input.skill like the skill() helper of run-usage.selftest.mjs. (evidence: plan line 148; .claude/scripts/run-usage.mjs:177)

ADD THESE EDGE CASES:
- A re-launch of a slug in verify mode after an earlier run opened a PR: the pr carry-over keeps the old PR; state that this is intended, or carry pr over only for a CLEANED report.
- A crash or restart while syncLedger() holds the lock leaves a lock with a dead pid; the stale rule must replace it safely (see SHOULD FIX 1).

Do not change anything the validation did not flag.
```
