**Validation round:** 2

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

Symbols were checked in today's pre-move files (`scripts/plans-dashboard.mjs`, `scripts/scout.mjs`, `scripts/plans-dashboard/app.js`, `scripts/test/plans-dashboard.test.mjs`). The round 1 fixes (decision log rows 1–28) are in the plan and match the code: `?sel=` (app.js:596-598 `readUrl`), `chatting`/`chatWaits` (plans-dashboard.mjs:512-513), `chatEnd` in `runLauncher` (:648), `launches` states (:642-668), `allByBranch` one PR per branch and 200-PR cap (:1318-1344), `outcomeOf` defaulting to `running` (:322-324), `CLEANED —` status (.claude/scripts/auto-pipeline.sh:554), `NOTIFIERS` export and the main-module check (scout.mjs:328, :624), template `pr` mode (template auto-pipeline.sh:485), `changelog-validate.mjs --base` (.claude/scripts/changelog-validate.mjs:150), the "go" sentences (AGENTS.md:46, AGENTS.md.tmpl:34, template skill-1-plan SKILL.md:313). Two round 1 fixes brought new gaps (the lock, row 19; the `waitStatus` cache, row 14).

### Blocking issues
- [Edge cases / Wiring] The `WATCH_LOCK` check trusts a bare PID, and only once at startup. Evidence: plan step 7 ("take `WATCH_LOCK` … when the file is missing or its `pid` is not alive (`process.kill(pid, 0)`), else log … and return"); the mirrored `scoutRunning()` at plans-dashboard.mjs:1194-1198; the lock file sits in `~/.claude/pipeline-dashboard/` and stays there after a reboot or a SIGKILL (the test `stop()` at plans-dashboard.test.mjs:169-173 uses SIGKILL). Why it breaks: after a reboot, the old PID often belongs to another process. The login service then logs "another dashboard runs the watcher" and runs with no watcher until the next restart. Nothing tells the owner, and the whole feature is off. In the same way, a hand-started test dashboard that took the lock while the service was down keeps it, and the service never takes it back. Fix: (a) count a lock as held only when its PID is alive and its command is this server (`ps -p <pid> -o command=` contains `server.mjs`), or when its `port` answers; (b) check the lock again at each tick, so a server without the watcher takes it over when the holder is gone; (c) add a unit or e2e case: a lock file with a PID that is alive but is not a dashboard (for example the test's own `process.pid`) does not block the watcher.
- [Contracts / wrong data] When a `Waits for:` line is removed or changed, the old status stays. Evidence: plan step 6.5 calls `waitStatus.set(key, waits)` only "for each active plan with `parseWaitsFor(planText)`" and never deletes; step 8 reads `waitStatus.get(key) || …` before it parses the file. Contracts (plan line 45) say `waits` is `null` when there is no line. Why it breaks: after the owner deletes the line, `/api/state` still sends the old conditions, and the page shows "⏳ waits — Starts by itself when: …" for a plan that will never start by itself. This lasts until the server restarts. Fix: in step 8, parse the header first: no line → `waits: null`. Use `waitStatus` only when its texts are the same as the parsed texts, else use the parsed list with `met: false`. In step 6.5, delete the `waitStatus` key of every plan that has no line. Add an e2e case: remove the line, and the next `/api/state` has `waits: null`.

### Non-blocking concerns
- [Edge cases / rate] After a plan starts, its conditions are still checked at every tick. Evidence: step 6.5 runs for "each active plan with `parseWaitsFor`", and a `pr` condition is one `gh api …/pulls/<n>` call per tick (step 5). The GitHub limit is shared with other tools (plans-dashboard.mjs:1313-1314). Suggestion: when `launched[slug]` or `met[slug]` is set, skip `checkCondition` and report `met: true`.
- [Edge cases / race] A manual launch can come in during the `await`s of step 6.5, between `listPlans()` (6.2) and the launch (6.6). Then `canAutoLaunch` reads an old `plan.launch`, and the plan starts twice. The second start gives a SKIP, an `auto-launch-failed` event and a false notification. Suggestion: in 6.6, read `launches.get(key)` again just before `launchPipeline`.
- [References] `addEvents` appends lines, but `appendFileSync` is not in the server's `node:fs` import (plans-dashboard.mjs:27-30). Suggestion: name it in step 3 or 4.
- [Edge cases] `submodule … contains <sha>` with a sha that does not exist: `merge-base --is-ancestor` exits 128, the condition stays "not met", and there is no error, so a typing mistake waits forever. Suggestion: tell exit 1 (not an ancestor yet) from other failures, for example with `rev-parse --verify <sha>^{commit}` in the submodule, and set `error: 'unknown commit'`.
- [Edge cases] `plan … merged` reads `ownBranch(other, slug)`, which comes from `planBranches[other.root]`. `listPlans(other)` fills that list (plans-dashboard.mjs:486, 305-310). On the first tick, or when `other` comes after this project in the loop, the list can be empty or old, so a plan with a `- **Branch**:` line is looked up on `auto/<slug>`. Suggestion: read the other plan's file (active or `done/`) with `planBranch()`.
- [Owner needs to know] A new `wait-error` makes an event but no notification (step 6.7). The Goal says to notify "when something needs the owner", and a broken condition does. Suggestion: notify on a new `wait-error`.
- [Docs] Round 1 row 7 says that the list-based limit of `pr-merged` events and pulls is "documented". Step 14 does not name it (newest 200 PRs, one PR per branch). Suggestion: add it to step 14's list.
- [How to verify] The `grep -n "Waits for" <4 files>` exits 0 when only one of the four files matches, so it cannot show that a file was skipped. Suggestion: one grep per file, or `grep -c` and check that each count is at least 1.
- [Breaking changes] The consumer search command says `grep -rn "api/state" scripts skills`. After the move, the consumers are in `apps/`. Suggestion: `grep -rn "api/state" apps scripts skills`. The listed consumers are correct (checked today: docs-media.mjs, restart-dashboard.mjs, app.js, the test).
- [Edge cases / throwaway servers] `scripts/docs-media.mjs` and the move plan's new `copyDashboard` test start a server that has the watcher on. It has its own HOME, so it calls `gh`, runs `listPlans` every minute, and can call `notifyMac`. Suggestion: pass `DASH_WATCH_MS=0` and `DASH_NO_NOTIFY=1` there too (docs-media.mjs, near the spawn that probes `/api/state` at :208).
- [Steps] Step 6 has seven sub-steps and is longer than 5 minutes. Suggestion: split it into PRs and outcomes, launch states and waits, then launch and notifications.

### Edge cases the plan should address
- The lock file holds a PID that a non-dashboard process uses again after a reboot: the watcher must still start (blocking item 1).
- A `Waits for:` line is removed or edited while the server runs: `waits` follows the file at the next poll (blocking item 2).
- A manual Launch click while a tick is between `listPlans` and the launch: no second launch.
- A `submodule` condition with a sha that is not in the submodule's history: an error, not a silent wait.
- `errors` keys are never cleared: an error that goes away and comes back gives no second `wait-error` event. Say so in the docs, or clear the key when the error goes away.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (pre-move names; `appendFileSync` must be added to the import)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done; the grep path needs `apps`)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (missing: the lock with a reused PID, and a removed `Waits for:` line)
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; the `waits: null` contract is broken by the cache, blocking item 2)
- [ ] "How to verify" commands are real and can fail (the multi-file grep cannot fail when only one file is changed)

```
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the watcher lock safe from PID reuse, and check it again at each tick. A lock counts as held only when its PID is alive AND that process is this server (ps -p <pid> -o command= contains server.mjs, or the lock's port answers). At each tick, a server without the watcher takes the lock when the holder is gone. Add a test: a lock file with a live PID that is not a dashboard (for example the test's own process.pid) does not block the watcher. (evidence: plan step 7; scripts/plans-dashboard.mjs:1194-1198 scoutRunning pattern; scripts/test/plans-dashboard.test.mjs:169-173 SIGKILL leaves the lock file)
2. Stop the old waitStatus from overriding the plan file. In step 8, parse the header first: no Waits for line gives waits: null. Use waitStatus only when its texts are the same as the parsed texts, else use the parsed conditions with met: false. In step 6.5, delete the waitStatus key of each plan that has no line. Add an e2e case: remove the line, and /api/state gives waits: null. (evidence: plan steps 6.5 and 8; Contracts line "waits: null (no Waits for: line in the header)")

SHOULD FIX:
1. Skip checkCondition for a plan whose launched[slug] or met[slug] is set (report met: true), so a started plan does not cost one gh call per condition per minute. (evidence: plan step 5 pr condition, step 6.5)
2. In step 6.6, read launches.get(key) again just before launchPipeline, so a manual launch during the tick's awaits does not start the plan twice. (evidence: scripts/plans-dashboard.mjs:504, 642-649)
3. Name appendFileSync as a new node:fs import for addEvents. (evidence: scripts/plans-dashboard.mjs:27-30)
4. Submodule condition: tell "not an ancestor yet" (exit 1) from an unknown sha (rev-parse --verify <sha>^{commit} fails), and set error: 'unknown commit' for the second. (evidence: plan step 5 submodule)
5. plan … merged: get the other plan's Branch line from its file (active or done/) with planBranch(), not from planBranches[other.root], which can be empty or old on the first tick or because of the project order. (evidence: scripts/plans-dashboard.mjs:305-310, 486)
6. Send a macOS notification for a new wait-error. (evidence: plan step 6.7, Goal)
7. In step 14, name the documented limit: pr-merged events and the pull come from the PR list (newest 200 PRs, one PR per branch). (evidence: round-1 decision log row 7; scripts/plans-dashboard.mjs:1318-1344)
8. How to verify: grep each of the four files on its own (or grep -c and check each count), so a skipped file fails the check.
9. Breaking changes: change the search command to grep -rn "api/state" apps scripts skills (post-move paths).
10. Pass DASH_WATCH_MS=0 and DASH_NO_NOTIFY=1 to the throwaway servers in scripts/docs-media.mjs and in the move plan's copyDashboard test. (evidence: scripts/docs-media.mjs:208)
11. Split step 6 into two or three steps of 2–5 minutes each.

ADD THESE EDGE CASES:
- The lock file holds a PID that a non-dashboard process uses again after a reboot.
- A Waits for line is removed or edited while the server runs.
- A manual Launch click during a tick.
- A submodule sha that is not in the submodule's history.
- An error key in errors that goes away and comes back (no second wait-error event): document it or clear the key.

Do not change anything the validation did not flag.
```
