**Validation round:** 8

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

Round 7's fixes checked: fencing (`holdsLock()` before every side effect), the plan-validator template in step 15 and Affected files, the `manualNew` exclusion, one notification per `run-outcome` event, dropping a PR number seen twice in one tick, and the `dashboard/server.mjs` match for `ps`. They mostly hold. Two problems remain. The new fencing test, as written, cannot pass. Two rule lines contradict step 15.

### Blocking issues
- [Tests / round-7 regression] The fencing test in "One watcher per HOME" (plan line 214) and in Harness constraints (line 224) says: "the test rewrites `watcher.lock` to name another live PID", then checks that the server "writes no watch.json, no event and starts no plan from then on" ("watch.json and the args log do not change"). By the plan's own `takeLock()` (step 4, line 132), this cannot pass with any PID the test has at hand. (a) The test process's PID (the PID the "A stale lock" case uses, line 215) is alive, but `ps -p <pid> -o command=` does not contain `dashboard/server.mjs`. So on its next tick the fenced server runs `!holdsLock() && !takeLock()`, judges the lock stale, takes it back, and writes `watch.json` again (`checkedAt` changes every tick). (b) The other server's PID is not available: the holder was just stopped. Had it been alive, it would hold the lock and write `watch.json` itself. — evidence: plan lines 132, 154, 214, 215, 224 — why it matters: a literal implementation gives a test that always fails, and the run stalls in the test or verify steps, or the implementer weakens the check. — fix: give the lock the PID of a live helper process that looks like a dashboard but runs no watcher, for example a child `spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)', '/x/dashboard/server.mjs'])`, stopped by its handle in `after()`. A third server with `DASH_WATCH_MS=0` also works. Bound the check, for example "for the next 5 ticks (1.5 s)". Take the `watch.json` and args-log snapshot about one tick after the rewrite, so a save that was already running does not count.

### Non-blocking concerns
- [Consistency / round-7 regression] Hard rules → "Global rules affect every project" (line 26) still says "Two template files change one generic sentence each … Nothing else in `skills/` … changes". Step 15 (line 163) and Affected files (line 92) now also change `skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md`. The rule audit in `/skill-4-verify` can flag that edit as outside the plan. — Change it to "Three template files" and name `plan-validator.md`.
- [Consistency / round-7 regression] The Open items line (line 167) says the owner adds the plan-validator note "in `.claude/agents/plan-validator.md` and its template, by hand". Step 15 already edits that template in the run, so a hand edit would add the parenthetical twice. — Remove "and its template" from the open item.
- [Edge / `manualNew`] Step 6b.6 (line 150) counts a manual launch made during the `await` only when "its plan had `launch === null` in the `plans` snapshot". Example: the snapshot shows a plan whose last launch failed (`launch.state === 'failed'`), and the owner presses ▶ Launch during the `await`. `runLauncher` sets `starting` (server `scripts/plans-dashboard.mjs:649`), but `manualNew` does not count that launch and `runningCount()` does not count a failed launch. The watcher can then start a fifth run. — Count the entries whose snapshot `launch?.state !== 'starting'` (and keep the `live` / fresh-report exclusion).
- [Accuracy] Step 4 (line 132) says "at worst a tick is cut short and the next holder repeats its reads". Step 6.1 saves `prs` before the pull, so a tick that is fenced after that save loses the pull and its `pr-merged` event for good. The next holder sees the PR as already `MERGED` in `saved.prs`. This matches the at-most-once contract (line 51), but the sentence is not correct. — Say that a fenced tick can lose that tick's events and pulls, as a crash can.
- [Accuracy] "On exit (`process.on('exit')`) the holder removes the file" (line 132). The server has no signal handlers (`grep "process.on(" scripts/plans-dashboard.mjs` finds none). The test `stop()` uses SIGKILL (`scripts/test/plans-dashboard.test.mjs:171`), and launchd sends SIGTERM. In both cases the `exit` handler does not run. Takeover then always goes through the stale-lock path (dead PID). That works, but the plan and docs should not promise that the lock is removed. The exit handler must also remove the file only when `holdsLock()` is true.
- [Verify] "How to verify" has no grep for the plan-validator template edit. — Add `grep -n "Waits for" skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md`.

### Edge cases the plan should address
- A server started with a relative script path (`cd apps/dashboard && node server.mjs`): `ps` shows `node server.mjs`, which does not contain `dashboard/server.mjs`. A second server then sees the lock as stale on every tick, and the two servers take the lock from each other in turn. Fencing prevents double side effects, but ticks are cut short. Docs: start it with `node apps/dashboard/server.mjs` from the repo root, or with an absolute path.
- The busy-chat test ends a `hold` turn: after an interrupt, the fake claude answers after 9.5 s (`scripts/test/plans-dashboard.test.mjs:74`). Give that case's `until()` a timeout longer than 10 s.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (pre-move names checked: `planBranch`, `listPlans` with `launch: live ? null : …`, `chatWaits`, `runLauncher`/`chatEnd`, `gitIn`/`gitRaw` with `code`, `pullRoot`, `runPrAction`, `refreshPrList`/`allByBranch`, `crossSiteReason`, `NOTIFIERS` export and the scout's main-module check, `autoChips`/`escA`, the docs sections, the Orchestrator roadmap entry, the template sentences)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [ ] Global rules affect every project respected (Hard rules line still says "two template files", see the non-blocking concern)
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (the fencing test cannot pass as written)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In End-to-end tests "One watcher per HOME" (fencing part) and in Harness constraints, say which PID the test writes into watcher.lock: a live helper process whose command line contains dashboard/server.mjs and that runs no watcher (for example spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)', '/x/dashboard/server.mjs']), stopped by its handle), or a third server with DASH_WATCH_MS=0. The test process's own PID does not work: takeLock() judges it stale (no dashboard/server.mjs in ps) and the fenced server takes the lock back on its next tick. Bound "from then on" (for example 5 ticks) and take the watch.json / args-log snapshot one tick after the rewrite. (evidence: plan lines 132, 154, 214, 215, 224)

SHOULD FIX:
1. Hard rules "Global rules affect every project": say three template files change, and name skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md (step 15 and Affected files already edit it). (evidence: plan lines 26, 92, 163)
2. Open items: remove "and its template" from the plan-validator note; step 15 edits the template in the run. (evidence: plan line 167)
3. Step 6b.6 manualNew: count the launches entries in 'starting' whose plan's snapshot launch was not 'starting' (not only launch === null), so a manual relaunch of a failed launch during the await is counted. (evidence: plan line 150; scripts/plans-dashboard.mjs:649)
4. Step 4: replace "at worst a tick is cut short and the next holder repeats its reads" with: a fenced tick can lose that tick's events and pulls (at-most-once, as with a crash). (evidence: plan lines 51, 132, 144)
5. Step 4: say the exit handler removes watcher.lock only when holdsLock() is true, and that a SIGTERM/SIGKILL stop leaves the file, which the next server takes through the stale-lock (dead PID) path. (evidence: no process.on( in scripts/plans-dashboard.mjs; scripts/test/plans-dashboard.test.mjs:171)
6. How to verify: add grep -n "Waits for" skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md.

ADD THESE EDGE CASES:
- A server started with a relative path (node server.mjs) does not match dashboard/server.mjs in ps; docs: start it from the repo root (node apps/dashboard/server.mjs) or with an absolute path.
- The busy-chat test: after an interrupt the fake claude answers after 9.5 s; the until() timeout must be longer than 10 s.

Do not change anything the validation did not flag.
```
