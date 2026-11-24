**Validation round:** 6

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

Round 5's fixes were checked first. Fixes 1, 2, 4, 5, 7, 8, 10, 12, 13 and 14 are in Steps, Tests and Harness constraints and agree with the code. One fix (11, the re-count of the run limit inside the synchronous launch block) is worded so that the literal reading counts nothing, and it leaves out `startedThisTick`. Three smaller gaps came in with fixes 1, 2 and 14. Code paths were checked against the pre-move files (`scripts/plans-dashboard.mjs`, `scripts/scout.mjs`, `scripts/test/plans-dashboard.test.mjs`, `scripts/plans-dashboard/app.js`).

### Blocking issues
- [Correctness / owner decision Q6] The re-check of the 4-run limit in the synchronous launch block (step 6b.6, plan line 149) can let a fifth run start. 1) The sum is "`running` plus the entries of `launches` … with `state: 'starting'` that are neither in the `plans` snapshot nor started by this tick". It does not include `startedThisTick`, but `canAutoLaunch` before the `await` uses `running + startedThisTick` (same line). 2) "Neither in the `plans` snapshot" read literally is always empty: a manual `/api/launch` always starts a plan that is in the snapshot, because `listPlans()` lists every active plan (`scripts/plans-dashboard.mjs:488-517`). Example: `running` = 2, the tick already started plan A (`startedThisTick` = 1), plan B passes `canAutoLaunch` (3 < 4), the owner launches plan C by hand during `await pipelineLive(B)`. The re-check gives 2 + 1 (C) = 3 < 4 and B starts. Now 2 + A + C + B = 5 runs. `runLauncher` sets `launches` to `starting` at once (`scripts/plans-dashboard.mjs:649`), so the data for a correct count is there. — Fix: write the re-check as `running + startedThisTick + manualNew < WATCH_LIMIT`. `manualNew` = the entries of `launches` for this project with `state: 'starting'` whose plan had `launch === null` in the snapshot and that this tick did not start.

### Non-blocking concerns
- [Tests / consistency, from round 5 fix 1] The `prMap` unit case (plan line 179) still calls `prEvents(prev, rows)` with no `since`. It also says "gives one `pr-merged` on the first tick", but step 2 (line 121) says `prev === null` (the first tick) → `[]`. — Write `prEvents(prev, rows, since)` with a non-null `prev` that lacks the number, and say "on the first tick that sees the number".
- [Contracts, from round 5 fix 14] Step 2 (line 121) and the unit case (line 176) give every PR event a `base` field (from `baseRefName`). Contracts (line 40) lists only `number`, `title`, `url`, `branch` (+ `pull`). — Add `base` to the Contracts line for `pr-opened`, `pr-closed` and `pr-merged`.
- [Lifecycle, from round 5 fix 2] Step 6.1 (line 143) adds `<root>#<number>` to `buttonMerged` before `gh pr merge` and removes it when the merge fails. It does not say who removes it after a successful merge. — Say that the watcher deletes the mark when it writes the "Pulled by the merge button" event.
- [Reference implementation] Step 5 (line 139) runs `merge-base --is-ancestor` with a new `execFile` call because "`gitIn()` keeps only `ok`". The server already has `gitRaw()` (`scripts/plans-dashboard.mjs:1611-1615`), which returns `code`. `hasCommit()` (line 1621) already uses it for the same `cat-file -e <sha>^{commit}` check. — Use `gitRaw` for `cat-file` and `merge-base`, or name the reason for a new helper.
- [Time comparison] `createdAt > since`, `mergedAt > since` (line 121) and "`updatedAt` older than `checkedAt` minus 2 minutes" (line 143) compare GitHub times (`…T10:00:00Z`) with `toISOString()` times (`…T10:00:00.000Z`). A string comparison at the same second puts `Z` after `.`. — Say "compare with `Date.parse`".
- [Harness] Every server in `watcher.test.mjs` (the restart case, the two servers of "One watcher per HOME", the stale-lock case) must get `DASH_NOTIFIER` (the fake) or `DASH_NO_NOTIFY=1`. Without one of them, `notifyMac` on macOS calls the real `terminal-notifier` or `osascript` during `npm test` (step 4, line 132). Only the own-repo case says so (line 196). — Add one line to the e2e harness text.
- [Notification noise] `outcomeEvents` fires on every `status` change (line 122), and step 6b.7 (line 150) notifies on "`run-outcome` to `needs-you`". It is not clear whether a status change inside `needs-you` (for example `COMMITTED` → `PR OPEN`) notifies again. — Say "notify only when `outcome` changed to `needs-you` or `failed`", or say that each new needs-you status notifies.

### Edge cases the plan should address
- A manual launch during the `await` when this tick already started a plan. This is the blocking case above. Add an e2e or unit case for the re-check sum, if it can be timed. Else add a unit test of a small pure helper for the sum.
- A `pr-merged` event for a PR whose base is not the branch that the main checkout has checked out (for example a PR into a feature branch). `pullRoot` then answers "is on main, not feature-x. Pull by hand." (`scripts/plans-dashboard.mjs:1484-1485`). This is harmless, but the docs could say it.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (pre-move names; `copyDashboard` comes from the move plan, step 10)
- [ ] Reference implementation mirrored, deviations justified (`gitRaw` not used, no reason given; non-blocking)
- [x] Breaking changes for changed symbols listed (consumer search done: `/api/state` consumers; `runPrAction` signature is unchanged)
- [x] Wiring & registration matches the code (`../scout/scout.mjs` and `../../../scripts/docs-media.mjs` resolve from the post-move paths; `NOTIFIERS` is exported at `scripts/scout.mjs:328`; the `server.listen` callback calls `chatReattach()` at line 3268)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; mode ids come from `pipelineModes()`)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 6b.6, write the run-limit re-check in the synchronous block as `running + startedThisTick + manualNew < WATCH_LIMIT`. manualNew = the entries of `launches` for this project with state 'starting' whose plan had `launch === null` in the `plans` snapshot and that this tick did not start. Remove the words "neither in the plans snapshot". (Evidence: plan line 149; scripts/plans-dashboard.mjs:488-517, listPlans lists every active plan; :649, runLauncher sets 'starting' at once.)

SHOULD FIX:
1. In the prMap unit case, call `prEvents(prev, rows, since)` with a non-null prev that lacks the number, and say "the first tick that sees the number" instead of "the first tick". (Evidence: plan lines 121, 179.)
2. Add `base` to the Contracts fields of pr-opened, pr-closed and pr-merged. (Evidence: plan lines 40, 121, 176.)
3. In step 6.1, say that the watcher deletes the `buttonMerged` mark when it writes the "Pulled by the merge button" event. (Evidence: plan line 143.)
4. In step 5, use the existing `gitRaw()` (which returns `code`) for `cat-file -e` and `merge-base --is-ancestor`, or give a reason for a new execFile helper. (Evidence: scripts/plans-dashboard.mjs:1611-1621.)
5. Say that createdAt, mergedAt, updatedAt, since and checkedAt are compared with Date.parse, not as strings. (Evidence: plan lines 121, 143.)
6. In the e2e harness, say that every server the test starts gets DASH_NOTIFIER (the fake) or DASH_NO_NOTIFY=1. (Evidence: plan lines 132, 186.)
7. In step 6b.7, say whether a run-outcome notification needs a change of `outcome`, or comes on every new needs-you status. (Evidence: plan lines 122, 150.)

ADD THESE EDGE CASES:
- A manual launch during the await when this tick already started a plan: the re-check still stops at 4 runs (a unit test of a small pure helper for the sum is enough).
- A pr-merged event for a PR whose base is not the branch of the main checkout: the pull text says "Pull by hand" (say so in the docs).

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
