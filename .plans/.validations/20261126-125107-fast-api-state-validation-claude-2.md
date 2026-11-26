**Validation round:** 2

## Plan validation: 20261126-125107-fast-api-state.md

**Verdict:** APPROVE WITH CHANGES

The round-1 changes are mostly correct. The three questions from the briefing:

- A pipeline project does make the build wait for a real child process. `resolveProject()` sets `hasPipeline: existsSync(launcherScript)` (server.mjs:193, 198), so the file does not need an exec bit. `pipelineModes()` runs the script only when its text has `--describe)` (server.mjs:233), so an `exit 0` script gives `DEFAULT_MODES` with no exec. `listPlans()` awaits `pipelineLive()` (server.mjs:519-521), which is `execFile('pgrep', ...)` (server.mjs:407-414).
- `/api/usage` answers with `usageState()` only (server.mjs:3267, 2344). It does not build state. Nothing at start builds state either: `server.listen` runs `chatReattach()`, `startWatcher()` (off when `DASH_WATCH_MS=0`) and `enqueueMissingSummaries()` (returns at once when `NO_SUMMARY` is set) (server.mjs:3837-3856, 648-649).
- Tests 4, 5 and 7 fail without the feature: there is no `X-State-Build` header today (`json()` at server.mjs:3235-3238 sets only `Content-Type`), and `state-load.mjs` does not exist. Tests 1–3 also pass on today's code. Round 1 accepted that (F17).

Two new blocking issues are in the round-1 additions. Both are in `state-load.mjs` and its test (steps 9, 13 and Tests 7).

### Blocking issues

- [Tests / flaky] Tests 7 runs `load <port> 2 3` and expects exit 0. Step 9 gives each loop a random start offset of 0–5 s and fails the run on "an endpoint has zero samples". With a 3 s run, the chance that both of the 2 loops start after 3 s is (2/5)^2 = 16 %. In that case `/api/state` has zero samples and the script exits 1. The same test also checks the 100 ms `/api/usage` limit while `npm test` runs the test files in parallel processes (`package.json:7`, `node --test apps/*/test/*.test.mjs test/*.test.mjs`). That is the timing check that **Harness constraints** calls "slow and flaky". — Evidence: plan step 9 (lines 127-129), Tests 7 (line 171), Harness constraints (line 182), package.json:7. — A test that fails about 1 run in 6 breaks `npm test` for every later run. — Fix: limit the start offset to `min(5 s, seconds)`, or make each loop send its first request at once and put the offset only between later requests. Add limit arguments or env values (for example `--max-state-ms`, `--max-usage-ms`, with defaults 1000 and 100). In Tests 7, pass large limits (for example 30000) so the test checks the logic, not the speed.
- [Verify can fail for a wrong reason] The "changing" list of `compare` (step 9, line 133) does not have `sessions`, `run.status`, `run.outcome`, `worktree`, `launch`, `asked`, `worktrees` or `bootstrapRun`. Step 13 runs `compare` from inside the pipeline run of this plan. For a pipeline project, `planSessions()` lists the transcripts of the plan's worktree with `mtime` and `size` (server.mjs:2475-2483, `sessionsIn` at server.mjs:493-503). The headless run of this plan writes its transcript there all the time. So the row of this plan in claude-config differs between the two servers' reads, and `compare` exits 1 although the JSON shape is the same. — Evidence: server.mjs:2477-2482, 499-500, 534 (`worktree`), 531 (`launch`), 538 (`asked`). — The run then reports a body change that is not real, or a "goal not met". — Fix: add `sessions` (all of it), `run` (all of it), `worktree`, `launch`, `asked`, `waits`, `worktrees` and `bootstrapRun` to the paths that `compare` reports as "changing". Or compare only the rows of archived plans plus the project keys that are not live, and name that rule in step 9.

### Non-blocking concerns

- [Tests / timing] Tests 4 relies on the 4 other parallel requests being handled while the `pgrep` child runs. That is very likely, but it depends on timing (the `pgrep` call on macOS takes a few tens of ms). The plan calls it deterministic (validation round 1, F2). — Evidence: server.mjs:407-414. — Suggestion: put a fake `pgrep` (a script that sleeps 0.5 s and exits 1) in a `bin` folder of that test only, first on the `PATH` of that second server. `execFile('pgrep', ...)` takes `PATH` from the server's env. Do not put it in the shared `ghDir/bin`, because the main test server uses that folder too.
- [Mirror] Step 8 lists the env of the second server but leaves out `DASH_PORT`, `DASH_NO_OPEN`, `QA_REPORTS_PORT`, `QA_HOME` and `CLAUDE_TMP`, which the docs-media test sets (dashboard.test.mjs:1670-1672). Without `QA_REPORTS_PORT`, the test server tries port 4898 of the live QA report server. It only logs the error (server.mjs:3817), but the test should not touch it. — Suggestion: name the full env of the docs-media test and add the plan's extra keys.
- [Contracts / consumers] The consumer list of `/api/state` does not have `apps/dashboard/restart.mjs:48`, which uses `/api/state` as a health probe with a 15 s timeout. The plan's own search command (`grep -rn "api/state" apps scripts skills test`) finds it. It needs no change (it reads only `.ok`). — Suggestion: add it to the list.
- [Freshness claim] The plan says that the staleness ("one build plus 2 s") is "shorter than one 5 s poll". The page also polls every 1 s while `fastUntil` is active or a plan is `starting` (app.js:5361-5365). In that fast mode, a run that starts after a launch can show up to build + 2 s later than today. The POST of the launch clears the cache, but the run's later file changes do not. — Suggestion: say this in **Breaking changes**. Decision 2A is not affected.
- [Reference mirror] The **Mirror** bullet (line 64) says that `STATE_CACHE_MS` uses "the same `== null ? default : +value` form" as `WATCH_MS` (server.mjs:1725). Step 4 uses `Number(x ?? 2000)` with a finite check. An empty `DASH_STATE_CACHE_MS=` gives `Number('') = 0`, which turns the cache off. The Contracts text says that an invalid value gives 2000. — Suggestion: treat `''` as unset, and correct the Mirror bullet to the form of step 4.
- [Performance detail] Step 3 drops the `!rounds.has(m[1])` short-circuit that today's loop has before `hasText()` (server.mjs:337). Without it, each report of a round that already counts gets a `statSync`. — Suggestion: keep the check before `hasText()`.
- [Compare across branches] `compare 4912 4911` compares the main checkout with the worktree. When main has moved on (for example, `.plans/20261126-113132-insights-ledger.md` changes `server.mjs`), a real difference comes from that other change. — Suggestion: in step 13, check that the main checkout is at the worktree's base commit (`git merge-base`), or else write the result as "not comparable".

### Edge cases the plan should address

- `state-load.mjs load` with `seconds` shorter than the maximum start offset — zero samples, and a wrong exit 1 (see the first blocking item).
- Live transcripts and run reports that change between the two reads of `compare` — a wrong exit 1 (see the second blocking item).
- `DASH_STATE_CACHE_MS=` (empty) — today it gives 0, not the default.
- A GET that starts a build between the end of a POST and its `close` event — the build is not used by later requests (the gen goes up again), so it costs one more build. This is correct, but the plan can say it.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`validationRounds`, `hasText`, `VALIDATOR_REPORT` at server.mjs:329-341; `sessionIdCache` 476; `claudeCwds` 384; `listPlans` 505; `fullState` 574; `enqueueMissingSummaries` 648; `WATCH_MS` 1725; handler 3251-3271; `start()` dashboard.test.mjs:162; `envFor()` watcher.test.mjs:83; roadmap Page line docs/roadmap.md:17; Environment row docs/plans-dashboard.md:331; allow rule .claude/settings.json:23)
- [x] Reference implementation mirrored, deviations justified (small mismatch in the env parse form, non-blocking)
- [ ] Breaking changes for changed symbols listed (consumer search done): `apps/dashboard/restart.mjs:48` is missing (no change needed)
- [x] Wiring & registration matches the code (no new wiring; `state-load.mjs` is outside the `npm test` glob)
- [x] Scope stays inside the goal; no open decision is taken silently (1A and 2A respected)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope: not applicable (local only, no auth, no tenants), reason given
- [x] Restart after dashboard changes respected (Open items in the run report)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (root `CLAUDE.md` and `skills/` not touched; `AGENTS.md` is project-only)
- [x] Never stop processes by name respected (port-free check, then stop by PID)
- [ ] Tests for logic changes respected: Tests 7 is flaky as written
- [x] Docs: current state only respected
- [x] Contracts respected (no contract source; the header and env are new and documented)
- [ ] "How to verify" commands are real and can fail: they are real, but `compare` can also fail for a wrong reason in the run's own worktree

```
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 9, make sure that each loop of `load` sends at least one request in a short run: limit the random start offset to min(5 s, seconds), or send the first request at once and use the offset only between later requests. Add limit options (for example `--max-state-ms`, default 1000, and `--max-usage-ms`, default 100). In Tests 7, run `load <port> 2 3` with large limits (for example 30000), so that the test checks the logic and not the speed under the parallel `npm test`. (evidence: plan lines 127-129 and 171; package.json:7 runs the test files in parallel)
2. In step 9, add `sessions`, `run` (all of it), `worktree`, `launch`, `asked`, `waits`, `worktrees` and `bootstrapRun` to the paths that `compare` reports as "changing". The run of this plan writes its transcript into its own worktree, and `planSessions()` reports the mtime and size of that transcript for the plan's row. (evidence: apps/dashboard/server.mjs:2475-2483, 493-503, 531, 534, 538)

SHOULD FIX:
1. In step 8, make the slow part deterministic: put a fake `pgrep` (it sleeps 0.5 s, then exits 1) in a bin folder that only the second server has first on its PATH, not in the shared ghDir/bin. (evidence: apps/dashboard/server.mjs:407-414)
2. In step 8, name the full env of the docs-media test (DASH_PORT, DASH_NO_OPEN, QA_REPORTS_PORT from freePort(), QA_HOME '', CLAUDE_TMP) and add the plan's extra keys. (evidence: apps/dashboard/test/dashboard.test.mjs:1670-1672; apps/dashboard/server.mjs:3817)
3. In Contracts, add `apps/dashboard/restart.mjs` (a health probe that reads only `.ok`) to the consumers of /api/state. (evidence: apps/dashboard/restart.mjs:48)
4. In Breaking changes, say that in the 1 s fast poll (after an action, or while a plan is starting) a change can show up to one build plus 2 s later than today. (evidence: apps/dashboard/page/app.js:5361-5365)
5. In step 4, treat an empty DASH_STATE_CACHE_MS as unset (default 2000), and correct the Mirror bullet so that it names the form step 4 uses. (evidence: apps/dashboard/server.mjs:1725; plan line 64)
6. In step 3, keep the check `!rounds.has(round)` before `hasText()`. (evidence: apps/dashboard/server.mjs:337)
7. In step 13, before `compare`, check that the main checkout is at the base commit of the worktree. If it is not, write the result as "not comparable" and do not count it as a failure.

ADD THESE EDGE CASES:
- `load` with a run shorter than the maximum start offset (zero samples).
- Live transcripts and run reports that change between the two reads of `compare`.
- An empty DASH_STATE_CACHE_MS.
- A GET that starts a build between the end of a POST and its `close` event (one more build, correct result).

Do not change anything the validation did not flag.
```
