**Validation round:** 1

## Plan validation: 20261126-125107-fast-api-state.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues
- [Breaking changes / Tests] `apps/dashboard/test/watcher.test.mjs` spawns its own servers with no `DASH_STATE_CACHE_MS`, so after the change they run with the default 2000 ms result cache. Several of its tests write a file or the registry, then read `/api/state` at once. — `apps/dashboard/test/watcher.test.mjs:83-88` (`envFor` has no `DASH_STATE_CACHE_MS`), `:99` (`startServer` polls `/api/state`, which starts a build and fills the cache), `:207-208` (`register(...)`, then `plan('web1', 'waiting')` at once, and `plan()` at `:165` calls `.find(...).plans` on a project that is not in the cached body, so it throws a TypeError), `:351-352` (rewrite `gone.md`, then expect `waits === null` at once). Also `:214`, `:231`, `:450-451`, `:696-697`, `:866`. — `npm test` (block 1) fails. The plan names `watcher.test.mjs` only as a consumer that "reads no header" (Contracts) and does not list it in **Affected files** or **Breaking changes**. Step 7 changes only `start()` in `dashboard.test.mjs`. — Add `DASH_STATE_CACHE_MS: '0'` to `envFor()` in `watcher.test.mjs` (the second server at `:759` uses `envFor` too, so it gets the value). List the file in **Affected files** and **Breaking changes**, and add it to step 7.

### Non-blocking concerns
- [Edge case / crash] Step 4 says "On success it sets `b.done = true`. On an error it sets `stateBuild = null`", but it does not say how the handlers attach. Code like `b.promise.then(() => { b.done = true; })` with no rejection handler makes a second promise that rejects with no handler. `server.mjs` has no `unhandledRejection` handler (grep found none), so Node 18+ stops the process, and that stops the dashboard. — `apps/dashboard/server.mjs:3491` (the only 500 path, in the handler's catch) — Tell the implementer to use one `b.promise.then(() => { b.done = true; }, () => { if (stateBuild === b) stateBuild = null; })`, or a try/catch inside the IIFE that sets the flags and throws again.
- [Performance / design] The cache key is the build's start time (`at`). When a build takes `STATE_CACHE_MS` (2 s) or longer, every answer is already too old when it is ready. Then the next request starts a new build at once, and with 10 clients the server builds without a pause. The planner measured 2.57–2.78 s for one build (Context). Fix A can make the build shorter, but the plan does not show a measured time for it. — plan step 4 and Context measurements — Write in the doc comment that the result cache helps only when a build takes less than `STATE_CACHE_MS`. Let `state-load.mjs load` print the build time too (the time of a request that has a new `X-State-Build` value), so the owner can see this case when deciding about fix C.
- [Performance] The archived rows in `listPlans()` stay fully synchronous (`readFileSync` of each archived plan for its title, `existsSync`, `planSessions`), with no `await`. During that part of a build, `/api/usage` waits. A max of 100 ms for `/api/usage` can fail with 558 archived plans even after fixes A and B. — `apps/dashboard/server.mjs:547-570` — The plan already sends that result to fix C (decision 1A). This is a note only; no change is needed.
- [Tests] Unit test 4, first part: "the `X-State-Build` values are the same" passes even with no header (`undefined === undefined`). — plan, Tests, unit test 4 — Also assert that each value matches `/^\d+$/`.
- [Tests] Unit tests 1–3 pass on the current code as well. They prove that the caches give correct counts, but they do not prove that a cache exists. The harness constraints say so for the speed, but not for the index. — plan, Harness constraints — Add one line saying that tests 1–3 guard the cache keys, and that nothing proves the folder is listed once. Only the `load` measurement shows that.
- [Edge case] Step 2 must store the `mtimeMs` from the `statSync` that runs before `readdirSync`, not one taken after it. Then a file that is added between the two calls makes a new mtime on the next stat, and the next build reads the folder again. The plan's order (stat, then readdir) is correct, but it does not say which mtime to store. — plan step 2 — Add "store the mtime of the stat before the listing".
- [Edge case] Step 6 uses `res.on('finish', …)`. When the client closes the connection before the answer is complete, `finish` does not fire, and only `close` fires. — plan step 6 — Use `res.on('close', invalidateState)`. It fires in both cases.
- [Commands] Step 12 writes the allow rule as `"Bash(node apps/dashboard/state-load.mjs:*)"`. The rules in the file use the form with a space, for example `"Bash(node .claude/scripts/run-usage.mjs *)"`. — `.claude/settings.json:23` — Use `"Bash(node apps/dashboard/state-load.mjs *)"`.
- [Tests for logic changes] `state-load.mjs` has logic (the JSON path diff of `compare`, the median and maximum, the exit codes) but no test. — AGENTS.md Hard rules, "Tests for logic changes" — Add a small `node --test` case for the diff function (export it and keep the CLI behind an `IS_MAIN` guard, like `scripts/docs-media.mjs`), or say in **Tests** why the measurement script has no test.
- [Measurement] `compare` waits 6 s for the PR list cache. When `gh` answers slowly, `pr` and `prError` can differ between the old and the new server. The list of paths that can change (`live`, `chatting`, `chatWaits`, `run.lastEvent`) does not include `pr`, `prError`, `reportAt` or `summary`. — plan, How to verify block 2 — Add these to the paths that can change, or let `compare` read again until two reads from the same port are the same.
- [Other consumer] `scripts/docs-media.mjs:217-227` starts a dashboard with the default cache. It writes its demo world before the start, so it is not affected now. — `scripts/docs-media.mjs:217` — Name it under Contracts consumers.
- [Estimates] The owner's numbers (634 plans, 3341 and 1075 files) have no command that measured them. — plan, Context — Name the command (for example `ls <dir>` counts), or mark them as the owner's report.

### Edge cases the plan should address
- A build that throws: all requests that wait for it get a 500, and the next request builds again. Make sure no unhandled rejection stops the process (see above).
- Two builds at the same time after a POST: the old build that was not finished and the new build both run. The old build must not write over `stateBuild` (the plan sets `stateBuild = b` only when it starts a build, and clears it on an error only when `stateBuild === b`, which is correct). Keep that guard as written.
- A non-number `DASH_STATE_CACHE_MS` (for example `abc`) gives `NaN`. Then the time check is always false and no answer is kept. That is safe, but say it in the doc row.
- A folder mtime with a coarse clock (a file system with a 1 s mtime): a change in the same second as the cached stat is not seen until the next change. APFS and ext4 have fine mtimes, so this is a note only.
- A build that the page's fast mode (1 s ticks after a launch, `app.js:5361-5365`) reads: the answer can be up to 2 s old. A POST `/api/launch` clears the cache, so the first tick after it is fresh.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done) — `watcher.test.mjs` depends on a fresh `/api/state`
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (tenant or owner, when the project scopes data) per endpoint — local-only endpoint with no auth, explained
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected — `state-load.mjs` logic has no test
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail — `npm test` fails until `watcher.test.mjs` is fixed; block 2 needs allow rules that a headless run does not have (the plan puts block 2 under Open items in that case)

Verified facts (summary):
- `server.mjs:329-341` (`VALIDATOR_REPORT`, `hasText`, `validationRounds`), `:476-490` (`sessionIdCache`), `:384-391` (`claudeCwds`), `:505-572` (`listPlans`, active and archived callers of `validationRounds`), `:574-602` (`fullState`), `:648-662` (`enqueueMissingSummaries`), `:1725` (`WATCH_MS`), `:3235-3238` (`json`), `:3251-3271` (handler, `crossSiteReason`, `/api/state` route), `:82-83` (`--help`, `DASH_WATCH_MS`) match the plan.
- Step 2 index equivalence: a name `f` is counted for `slug` today if and only if `f[slug.length] === '-'` and `f.slice(slug.length + 1)` matches the anchored regex. The index stores every split `i` that matches, so `bySlug.get(slug)` holds the same files. The ambiguous case (`demo-plan-validation-codex-raw-5.md`) splits only at `demo-plan-validation`. The counts are the same.
- The numbers in unit test 1 are correct (5, then 4, 5, 4). Test 3 expects 2, which is correct. `doneDir` is `plansDir/done` (`server.mjs:202`).
- `DASH_STATE_CACHE_MS=0` in `dashboard.test.mjs` `start()` (`:162-170`): the tests are sequential and wait for each answer, so no existing test reads a build that was not finished, and the old freshness stays.
- `docs/plans-dashboard.md:331` (`DASH_WATCH_MS` row) and `docs/roadmap.md:17` (Page line) exist as quoted. `changelog-validate.mjs:33` accepts `performance`.

```
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Add `DASH_STATE_CACHE_MS: '0'` to `envFor()` in apps/dashboard/test/watcher.test.mjs. Without it, the watcher servers use the 2 s default cache, and the tests that register a project or rewrite a plan and then read /api/state at once fail (a TypeError in `plan()`, or a stale `waits`). List the file in Affected files and in Breaking changes, and add it to step 7. (evidence: apps/dashboard/test/watcher.test.mjs:83-88, :99, :165, :207-208, :351-352)

SHOULD FIX:
1. In step 4, say how the done and error handlers attach: one `b.promise.then(() => { b.done = true; }, () => { if (stateBuild === b) stateBuild = null; })` (or a try/catch inside the IIFE), so that no second promise rejects with no handler. server.mjs has no unhandledRejection handler, so such a promise stops the dashboard. (evidence: apps/dashboard/server.mjs:3491, no `unhandledRejection` in the file)
2. In the step 4 doc comment, say that the result cache helps only when a build takes less than STATE_CACHE_MS (the key is the start time). Let `state-load.mjs load` also print the build time (the time of a request that has a new X-State-Build value). (evidence: plan Context, 2.57-2.78 s for one build)
3. In unit test 4, also assert that each X-State-Build value matches /^\d+$/, so the "same value" check cannot pass with no header.
4. In step 2, say that the stored mtime is the one from the statSync before readdirSync.
5. In step 6, use `res.on('close', invalidateState)` in place of 'finish', so a request whose client went away also clears the cache.
6. In step 12, write the allow rule as "Bash(node apps/dashboard/state-load.mjs *)", the same form as the rules in the file. (evidence: .claude/settings.json:23)
7. Give state-load.mjs a small node --test case for its compare diff (export the function, keep the CLI behind an IS_MAIN guard like scripts/docs-media.mjs), or say in Tests why the script has no test. (evidence: AGENTS.md Hard rules, "Tests for logic changes")
8. In How to verify block 2, add `pr`, `prError`, `reportAt` and `summary` to the paths that can change between the two servers.
9. In Harness constraints, say that unit tests 1-3 also pass on the old code: they guard the cache keys, and only the load measurement shows that the folder is listed once.
10. Name scripts/docs-media.mjs (startDashboard) under Contracts consumers of /api/state. (evidence: scripts/docs-media.mjs:217-227)

ADD THESE EDGE CASES:
- A build that throws: every request that waits for it gets a 500, the next request builds again, and the process does not stop.
- A non-number DASH_STATE_CACHE_MS gives NaN, so no answer is kept; say this in the Environment row.
- An old build and a new build at the same time after a POST: only the new build is in stateBuild, and the error path clears it only when stateBuild === b.

Do not change anything the validation did not flag.
```
