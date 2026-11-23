**Validation round:** 4

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

Paths are checked against the pre-move files (`scripts/plans-dashboard.mjs` = `apps/dashboard/server.mjs`, `scripts/plans-dashboard/app.js` = `apps/dashboard/page/app.js`, `scripts/test/plans-dashboard.test.mjs` = `apps/dashboard/test/dashboard.test.mjs`, `scripts/scout.mjs` = `apps/scout/scout.mjs`) and the move plan `.plans/20261122-152506-move-apps-out-of-scripts.md` (`DASH_REPO` → `../..`, `copyDashboard` + `IS_MAIN` in `scripts/docs-media.mjs`).

Round 3's fixes are correct as written for: realpath own-repo check, `linkSync` lock with `renameSync` stale move, the synchronous launch block, PR paging with `checkedAt`, `prEvents(…, since)`, the `..` slug rule, `redact()`, `JSON.parse` in `try`, at-most-once delivery, `fix` flag, default `watch.json` object, `planBase()` leading `-`, `/api/events` `limit`, and parked/proposed. They are consistent across Contracts, Affected files, Steps, Tests and the docs step, with the gaps below.

### Blocking issues
- [Wrong data / test cannot pass] The "no waits chip after a restart" rule (round 3 fix #10) depends on `launch` or `run`, but `launch` lives only in memory — `scripts/plans-dashboard.mjs:639-642` ("In memory only: a restart forgets it") and `listPlans()` `launch: live ? null : launches.get(key)` at `scripts/plans-dashboard.mjs:507`. The e2e fake launcher (the `pipeRepo()` shape, `scripts/test/plans-dashboard.test.mjs:866-867`) only logs its arguments and writes no report, so after "Restart keeps the state" the plan has no `run` and no `launch`. Then step 8 gives `waits` with `met: false` for each condition (step 6b.5 never sets `waitStatus` for a slug in `launched`), and step 10 shows "⏳ waits — api PR #7 merged ✗". The e2e case "After a restart an auto-launched plan shows no waits chip" and the browser-test line "after a server restart the started plan still shows no ⏳ waits chip" then fail. In real use the same happens to every failed auto-launch after a restart (SKIP, or the 10-minute "no run started"): the page says the plan "Starts by itself when: … ✗", but the `launched` record means it never starts by itself again. Fix: the server knows the watcher's `launched` records (an in-memory map filled from `watch.json` at startup and updated each tick); `listPlans()` gives `waits: null` (or a `waits` with `auto: 'started' | 'failed'`) for a slug in `launched`, so the chip never shows for a plan the watcher already started or tried to start. Add a unit/e2e check for a failed auto-launch after a restart.

### Non-blocking concerns
- [References] `linkSync` is not imported. Step 4 `takeLock()` uses `linkSync()`, but step 3 adds only `appendFileSync` to the `node:fs` import, and the current import (`scripts/plans-dashboard.mjs:27-30`) has no `linkSync`. A literal implementation throws a ReferenceError in `takeLock()`; `startWatcher()` logs it and the watcher never runs on any tick. Add `linkSync` in step 3.
- [Edge case / fresh HOME] `takeLock()` writes `watcher.lock.<pid>` into `CENTRAL`, but nothing creates `CENTRAL` at startup (the only `mkdirSync(CENTRAL…)` is in the usage write, `scripts/plans-dashboard.mjs:1778`; `saveWatch()` runs only after the lock). In a fresh HOME (every e2e test, a new install) the write fails with ENOENT on each tick and the watcher never runs. Step 4: `mkdirSync(CENTRAL, { recursive: true })` in `takeLock()`.
- [Logic gap] Step 6b.5 gives each condition of a generic project `error: 'auto-start needs …'`, but does not say `met: false`. `canAutoLaunch()` checks only `met`, so a met condition would call `launchPipeline()` on a project with no `launcherScript` (`runLauncher` spawns `bash <missing file>`, `scripts/plans-dashboard.mjs:643-651`). Say `met: false`, or skip the launch part (6b.4, 6b.6) when `!proj.hasPipeline`.
- [Signatures] Step 5 `pr`: "`error` = `ghProblem(out)`". A failed `gh()` returns `{ ok: false, output }`, not `out` (`scripts/plans-dashboard.mjs:1283-1288`). Write `ghProblem(r.output)`.
- [Contracts] The Contracts "Changed" item names only `waits`; `listPlans()` also adds `reportAt` to every plan in `/api/state` (step 3, Breaking changes). Add `reportAt` (ms or `null`) to the Contracts item.
- [Reference implementation] `scripts/scout.mjs:47` already exports `redact()` (emails, ids, IPs, `token|key|secret|password` values). The plan writes a second, different `redact()` in `watch.mjs` without naming the scout one as a deviation. Add one line: why a new one (query strings, GitHub and `sk-` tokens, 500-character cut) and that the server does not import the scout's.
- [Harness] The e2e env list omits `QA_REPORTS_PORT`, `QA_HOME: ''` and `CLAUDE_TMP` that the dashboard test's `start()` passes (`scripts/test/plans-dashboard.test.mjs:153-155`). Without `QA_REPORTS_PORT` each test server tries port 4898 (`scripts/plans-dashboard.mjs:45`, `:3255`), the real QA reports port. Say "the env of `start()` plus …".

### Edge cases the plan should address
- A merge with the dashboard button and a watcher tick at the same moment run two `git pull --ff-only` in one checkout; the second can fail on `index.lock` and its `pr-merged` event says "Pull by hand" though the other pull worked.
- A `launched[slug]` in `pending` whose plan file moved to `done/` is not in the filtered plan list; the 10-minute rule must handle a slug with no plan object (mark it failed or drop it).
- The move plan's copied-server test in `dashboard.test.mjs` starts its own server with its own env (not `start()`), so its watcher runs (default 60 s, first tick after 2 s). Harmless with an empty registry, but add `DASH_WATCH_MS: '0'` there too for the same reason as step 11.
- A registry `short` with a space (`cleanEntry` keeps it, `scripts/plans-dashboard.mjs:807`) never matches `(\S+)`, so the condition is `bad`; the docs could say so.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (except the missing `linkSync` import and `ghProblem(out)`)
- [ ] Reference implementation mirrored, deviations justified (scout `redact()` not named)
- [x] Breaking changes for changed symbols listed (consumer search done: `app.js`, `docs-media.mjs`, `restart-dashboard.mjs`, the dashboard test)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; `reportAt` missing from the plan's own Contracts list)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the server hide the waits of a plan that the watcher already started or tried to start, also after a restart. Keep an in-memory map of the watcher's `launched` records (filled from watch.json at startup and updated each tick), and in step 8 give `waits: null` (or mark it as already started/failed) for a slug in that map. Today `launch` is in memory only and the e2e fake launcher writes no report, so after a restart /api/state shows `met: false` and the page shows "⏳ waits … ✗" for a plan that never starts by itself again; the e2e case "After a restart an auto-launched plan shows no waits chip" and the browser-test line fail. Add a test: a failed auto-launch, then a restart -> no waits chip / `waits: null`. (evidence: scripts/plans-dashboard.mjs:639-642, :507; scripts/test/plans-dashboard.test.mjs:866-867)

SHOULD FIX:
1. Step 3: add `linkSync` to the `node:fs` import (takeLock uses it; the import has none). (evidence: scripts/plans-dashboard.mjs:27-30)
2. Step 4: `takeLock()` runs `mkdirSync(CENTRAL, { recursive: true })` before it writes `watcher.lock.<pid>`; in a fresh HOME nothing creates CENTRAL. (evidence: scripts/plans-dashboard.mjs:42, :1778)
3. Step 6b.5: a generic project's conditions get `met: false` as well as the error, or skip 6b.4 and 6b.6 when `!proj.hasPipeline`, so `canAutoLaunch` can never call `launchPipeline` there. (evidence: scripts/plans-dashboard.mjs:643-651)
4. Step 5 `pr`: write `ghProblem(r.output)`; a failed gh() returns `{ ok: false, output }`. (evidence: scripts/plans-dashboard.mjs:1283-1288)
5. Contracts: add `reportAt` (ms or null) to the changed `/api/state` plan fields.
6. Reference implementation → Deviations: name the scout's existing `redact()` and say why watch.mjs has its own. (evidence: scripts/scout.mjs:47)
7. End-to-end tests: the server env is the env of the dashboard test's `start()` (with `QA_REPORTS_PORT`, `QA_HOME: ''`, `CLAUDE_TMP`) plus the watcher variables, so no test server binds port 4898. (evidence: scripts/test/plans-dashboard.test.mjs:153-155; scripts/plans-dashboard.mjs:45, :3255)

ADD THESE EDGE CASES:
- A button merge and a watcher tick pull the same checkout at once: the second pull can fail on index.lock; its event text must not mislead (or the watcher skips the pull while a button merge runs).
- A pending `launched` record whose plan moved to done/: the 10-minute rule handles a slug with no plan object.
- The move plan's copied-server test also gets `DASH_WATCH_MS: '0'`.
- A registry `short` with a space never matches a condition (document it).

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.

/Users/gorantubic/Workspace/claude-config/.plans/.validations/20261123-102654-event-watcher-and-waits-for-validation-4.md
