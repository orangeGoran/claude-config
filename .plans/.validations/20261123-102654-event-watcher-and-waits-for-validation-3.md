**Validation round:** 3

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

Round 2's fixes are applied and consistent in the steps, Contracts, Tests and docs step: the own-repo pull exception, launch-before-events order, the atomic lock with the PID and `ps` check, the `sort=updated` PR map, the plan file `Branch` line, the 500-character cut, the `/api/events` cases, the header-first `waits`, no checks after a start, the re-check before the launch, the `appendFileSync` import, `wait-error` notifications, the four greps and the `docs-media.mjs` env. Checked against the pre-move files (`scripts/plans-dashboard.mjs`, `scripts/scout.mjs`, `scripts/test/plans-dashboard.test.mjs`, `scripts/plans-dashboard/app.js`, `scripts/docs-media.mjs`) and the move plan's post-move values (`DASH_REPO` = `new URL('../..', import.meta.url)`, `copyDashboard` behind `IS_MAIN`, `npm test` = `node --test apps/*/test/*.test.mjs test/*.test.mjs`). The things the plan names exist as it says: `refreshPrList`, `prLists[...].allByBranch`, `PR_JQ` with `mergedAt`, `pullRoot`, `gitIn`, `runLauncher` → `chatEnd`, `launches`, `pipelineModes`, `modeFlag`, `planBranch`, `chatting`/`chatWaits`, `export const NOTIFIERS`, `dashUrl`, `saveJson`, `escA`, `autoChips`, `boardCard`, `readUrl` (`sel`), and the `server.listen` callback with `chatReattach()`. I found one new blocking gap and five should-fix items.

### Blocking issues

- [Restart after dashboard changes / own-repo pull] The guard "except when `proj.root === DASH_REPO`" (plan step 6.1, line 139; Hard rules line 23) compares raw strings. `proj.root` is `expand(p.root)` with no normalizing (`scripts/plans-dashboard.mjs:180`, `:138`). `addProject` saves the typed path as it is: `expand(String(b.root).trim())` then `tilde(root)` (`scripts/plans-dashboard.mjs:1095`, `:1100`). `DASH_REPO` comes from `fileURLToPath(import.meta.url)` (`:53`), and Node resolves symlinks for the main module. If the registry entry has a trailing slash, a symlinked folder (for example `~/Workspace` as a link) or a different spelling, the comparison is false. The watcher then runs `git pull --ff-only` on the dashboard's own checkout with no relay check and no restart, which is the exact case the hard rule forbids. The e2e case can miss this too: the test's tmp path must be the real path (the dashboard test uses `realpathSync(mkdtempSync(...))`, `scripts/test/plans-dashboard.test.mjs:184`), or the case fails for the wrong reason. Fix: compare real paths, `safeReal(proj.root) === safeReal(DASH_REPO)`, where `safeReal` is `realpathSync` in a try/catch (`realpathSync` is already imported, `:29`). Add a unit or e2e case where the registry `root` has a trailing slash or goes through a symlink.

### Non-blocking concerns

- [Wrong data on the page] The `⏳ waits` chip shows on plans that will never auto-start. Step 6b.5 (line 144) skips plans with `launched[slug]` or a `run`, so `waitStatus` never gets a value for them. Step 8 (line 151) then falls back to `met: false` for every condition. Two cases: (a) after a dashboard restart, every auto-launched plan still in `.plans/` shows "⏳ waits … ✗" next to its run status; (b) a plan the owner launched by hand before the condition was true shows the waits chip on a running plan. Fix: in `listPlans()`, give `waits: null`, or hide the chip in `autoChips()`, when the plan has a `run`, is `live`, has a `launch`, or has `launched[slug]` in `watch.json`. Add an e2e case: restart after an auto-launch shows no waits chip data.
- [Event correctness] Spurious `pr-merged` and `pr-opened` events for old PRs. A comment, a label or a review on an old PR changes its `updated_at`. `prEvents` (line 118) counts "a number not in `prev` that is `MERGED`" as `pr-merged`. After the first tick the map has only the 100 most recently updated PRs (and later at most 2000), so a comment on a PR merged months ago makes a `pr-merged` event and a pull. The same goes for an old open PR (`pr-opened`). Phase 3's conductor will read these events as new merges. Fix: store `since` (the first tick's time) in `watch.json`. For a number not in `prev`, emit `pr-merged` only when `mergedAt` (already in `PR_JQ`, `scripts/plans-dashboard.mjs:1317`) is later than `since`, and emit `pr-opened` only when the number is higher than the highest known number. Add a unit case for each.
- [Concurrency] A short race in the lock. `takeLock()` (line 127) creates the file with `openSync(…, 'wx')`, then writes `{ pid, … }`. A second process that reads in between gets an empty file, finds no `pid`, calls the lock stale, unlinks it and takes it. The first process's `takeLock()` has already returned `true`, so both run that tick. The e2e "started at the same moment" case aims at this window. Fix: write the content to a temp file and `linkSync` it to `watcher.lock` (atomic, and the file has its content from the start), or treat an unreadable lock file younger than about 10 s as held.
- [Test harness] The e2e case "The dashboard's own repo is not pulled" (line 186) does not say which HOME the copied server uses. With the same HOME as the other servers in the file, one watcher per HOME (`watcher.lock`) means a different server may tick the copy's project. Its `DASH_REPO` is the real repo, so the case would then pull the copy. Fix: say that the copy's server uses its own throwaway HOME and registry, and its own `DASH_NOTIFIER` or `DASH_NO_NOTIFY=1` so that no real notification fires on the dev Mac.
- [Noise] Each transient error makes a notification. Step 5 (line 136) clears an error that a later tick no longer has, and step 6b.7 (line 146) notifies on each new `wait-error`. When the laptop goes offline and online again, every waiting `pr` or `submodule` plan gets a `gh` or fetch error, then a clear, then a new notification next time. Fix: notify only for errors that need the owner (`bad`, unknown or ambiguous project, `no Base line`, `not a submodule`, `submodule not initialized`, `commit not found`, a generic project). Record the `gh` and fetch errors as events only.
- [Clarity] `loadWatch()` returns `null` for a new project (line 125, `loadJson(…, null)`), but steps 6–6b read `saved.prs`, `saved.met[slug]`, `saved.errors` and `launched[slug]` directly. Say that `saved` defaults to `{ prs: null, outcomes: null, launched: {}, met: {}, errors: {} }` while `prs` and `outcomes` stay `null` (that keeps the "no flood on the first tick" rule).
- [Input hygiene] The `planBase()` regex `[\w./-]+` (line 122) allows a value that starts with `-`, which then goes to `git fetch -q origin <base>` as an option. Reject a base that starts with `-`, as the plan already does for the submodule path.
- [Contract] `/api/events` `limit` (lines 39 and 152): say what happens for `limit=0`, `limit=abc` and `limit=5000` (clamp to 1–1000, or 400), and add one e2e assertion for it.
- [Affected files] The server.mjs line (line 81) lists the watcher functions but not `takeLock()` and `holdsLock()`. Add them.

### Edge cases the plan should address

- A registry root with a trailing slash or through a symlink for the dashboard's own repo: the watcher must still see it as `DASH_REPO`.
- A comment or label on a PR that was merged long ago: no new `pr-merged` event.
- A dashboard restart after an auto-launch: the page shows the run status, not a "waits ✗" chip.
- The network goes off and on again while plans wait: no repeated notifications.
- The owner sets a plan's dashboard status (for example on hold) while its `Waits for:` line is still in the file. The plan still starts by itself. Say this in the docs (step 14), or skip plans with such a status.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (pre-move names checked; post-move names from the move plan)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [ ] Restart after dashboard changes respected (the own-repo guard compares raw path strings)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 6.1 and in Hard rules, compare real paths for the own-repo guard: realpathSync(proj.root) === realpathSync(DASH_REPO), each in a try/catch. Add a test where the registry root of the dashboard copy has a trailing slash or goes through a symlink, and the copy is still not pulled. (evidence: scripts/plans-dashboard.mjs:53, :180, :1095, :1100; plan line 139)

SHOULD FIX:
1. In step 8 (listPlans) or step 10 (autoChips), give no waits chip when the plan has a run, is live, has a launch, or has launched[slug] in watch.json. Add an e2e case: after a restart, an auto-launched plan shows no waits chip. (evidence: plan lines 144, 151)
2. Store `since` (the first tick's time) in watch.json. In prEvents, for a number not in prev, emit pr-merged only when mergedAt is later than since, and emit pr-opened only when the number is higher than the highest known number. Add unit cases. (evidence: plan line 118; scripts/plans-dashboard.mjs:1317 PR_JQ has mergedAt)
3. Make the lock content atomic: write a temp file and linkSync it to watcher.lock, or treat an unreadable lock younger than about 10 s as held. (evidence: plan line 127)
4. In the e2e case "The dashboard's own repo is not pulled", say that the copied server uses its own throwaway HOME and registry, and DASH_NOTIFIER or DASH_NO_NOTIFY=1. (evidence: plan line 186)
5. Notify only for wait errors that need the owner (bad, unknown or ambiguous project, no Base line, not a submodule, submodule not initialized, commit not found, generic project). Record the gh and fetch errors as events only. (evidence: plan lines 136, 146)
6. Say that saved defaults to { prs: null, outcomes: null, launched: {}, met: {}, errors: {} } when watch.json does not exist. (evidence: plan line 125)
7. In planBase(), reject a value that starts with "-". (evidence: plan line 122)
8. Say what /api/events does for limit=0, limit=abc and limit=5000, and test one of them. (evidence: plan line 152)
9. Add takeLock() and holdsLock() to the server.mjs line in Affected files. (evidence: plan line 81)

ADD THESE EDGE CASES:
- A registry root for the dashboard's own repo with a trailing slash or through a symlink.
- A comment on a PR merged long ago gives no pr-merged event.
- A restart after an auto-launch shows the run status, not a waits chip.
- The network goes off and on: no repeated notifications.
- A plan with a dashboard status such as "on hold" and a Waits for line: document that it still starts, or skip it.

Do not change anything the validation did not flag.
```
