**Validation round:** 7

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

Round 6 fixes checked first:

- Fix 1 (`manualNew` recount): present in step 6b.6. It keeps the limit, but it can count one run twice (see concern 1). It never allows a fifth run.
- Fix 2 (save `prs` before the pull): present in step 6.1. It matches the Contracts "Delivery" text and step 6b.7.
- Fix 4 (`redact()` on every `error` from a command): present in steps 4 and 5. There is an e2e case (`HTTP 401 …?token=abc`).
- Fix 5 (plan-validator "go" wording): this is in Open items.
- Fix 6 (`prMap` unit case with a non-null `prev`): the case is now correct with `prEvents()` in step 2.
- Fix 7 (`base` on PR events): this is in Contracts and step 2.
- Fix 8 (`buttonMerged` lifecycle): this is in step 6.1 and has an e2e case, including a failed merge.
- Fix 9 (`gitRaw` keeps `code`): verified at `scripts/plans-dashboard.mjs:1611-1615` (`code: err ? err.code : 0`). `hasCommit` uses it at :1621.
- Fix 10 (`Date.parse`): this is in step 2.
- Fix 11 (notifier env on every test server): this is in the e2e harness text, and step 11 sets it for `dashboard.test.mjs` and `docs-media.mjs`.
- Fix 12 (second notification on the first `PR OPEN`): present in step 6b.7. The wording is ambiguous (see concern 2).

The repository references were checked against the pre-move files: `gh`, `ghProblem`, `PR_JQ`, `listPrs`, `refreshPrList` (`allByBranch`, `loading`), `prsFor`, `gitIn`, `pullRoot`, `prAction`, `runPrAction` (merge branch, :1572-1588), `gitRaw`, `hasCommit`, `planBranch` (:301), `pipelineLive`, `worktreeOf`, `listPlans` (`launch: live ? null : launches.get(key)`, `chatting`, `chatWaits`, :504-513), `runLauncher` (`chatEnd`, `starting`, SKIP → `failed`, :643-670), `modeFlag`, `launchPipeline`, `loadJson(f, fallback)`, `crossSiteReason`, `getProj`, `/api/report` (:2784), the `server.listen` callback → `chatReattach()` (:3267-3268), scout `NOTIFIERS` (export, :328) and the main-module guard (:624), and the template `--describe` mode ids `verify`/`commit`/`pr` (`.claude/scripts/auto-pipeline.sh:478-485`). The docs sections, the "go" sentences in the three files, the roadmap Orchestrator entry and `changelog-validate.mjs` all exist. The move plan defines `copyDashboard(dest)` behind `IS_MAIN` (move plan lines 57, 96), so the static import in `watcher.test.mjs` is safe after the move.

### Blocking issues

None.

### Non-blocking concerns

- [Logic / limit] `manualNew` can count a live run twice. Evidence: `listPlans()` gives `launch: null` for a live plan (`scripts/plans-dashboard.mjs:504`). `runLauncher` keeps `launches` at `starting` until the launcher process exits (:649, :654-667). In a manual batch of several plans, the first plan is already `live` (it counts in `running`) while the launcher still sets up the next ones. Its `launches` entry is still `starting`, and its snapshot `launch` is `null`, so `manualNew` counts it again. The effect is a one-tick delay, never a fifth run. Suggestion: limit `manualNew` to plans that `runningCount()` did not count in the snapshot (not `live` and no fresh `running` report).
- [Ambiguity / notifications] Step 6b.7 says "a notification when the outcome changes, and once more when the status first starts with `PR OPEN`". For RUNNING → `PR OPEN — …` both triggers are true. An implementer can read "once more" as two notifications. The e2e case "Run outcome events and the notification link" expects "a second line" only after `FAILED`. Suggestion: say "one notification per `run-outcome` event, when the outcome changes or when the status changes from one that does not start with `PR OPEN` to one that does". Add an e2e step for COMMITTED → PR OPEN (both `needs-you`) that gives exactly one notifier line.
- [Logic / duplicates] Step 6.1 reads up to 10 pages sorted by `updated`. A PR updated during the paging moves forward, so it can appear on two pages. `prEvents()` then makes two `pr-merged` events and two pulls in one tick. Suggestion: dedupe `rows` by `number` (keep the first, newest row) before `prEvents()`/`prMap()`, and add a unit case.
- [Lock / stale check] Step 4 judges a lock as live when `ps -p <pid> -o command=` contains `server.mjs`. That name is common. After a reboot, an unrelated `node server.mjs` with the reused PID blocks the watcher until that process exits. Suggestion: match `apps/dashboard/server.mjs` (the copied dashboard of `copyDashboard()` has the same relative path).
- [UX] Step 10 hides the `⏳ waits` chip when all conditions are met. A met plan that is held back by the 4-run limit, a busy chat or `parked` then shows no hint of why it does not start. This does not cause wrong behavior. You can give it a later chip text such as "⏳ waits for a free slot".

### Edge cases the plan should address

- The same PR on two pages of one tick: this can give a double event and a double pull (see above).
- RUNNING → PR OPEN and COMMITTED → PR OPEN: each must give exactly one notification.
- A manual batch launch with plans that are already live while the launcher still runs: this must not delay a met plan for more than one tick.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (post-move paths mapped to the pre-move files)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently (Q6 reading is in the round-6 log, reported to the owner)
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
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
(none)

SHOULD FIX:
1. In step 6b.7, state one notification per run-outcome event: notify when the outcome changes, or when the status changes from one that does not start with "PR OPEN" to one that does. In the e2e case "Run outcome events and the notification link", add COMMITTED -> PR OPEN (both needs-you), which gives exactly one notifier line, and RUNNING -> PR OPEN, which gives exactly one line, not two. (evidence: plan step 6b.7, e2e line "Run outcome events and the notification link")
2. In step 6b.6, count in manualNew only the plans that runningCount() did not count in the snapshot (not live, no fresh running report). A live plan has launch null in listPlans() while its launches entry can still be 'starting'. (evidence: scripts/plans-dashboard.mjs:504, :649, :654-667)
3. In step 6.1, dedupe the paged rows by PR number (keep the first, newest row) before prEvents() and prMap(). Add a unit case: the same MERGED number twice in rows gives one pr-merged. (evidence: plan step 6.1, sort=updated paging)
4. In step 4, judge a lock as live only when the ps command contains "apps/dashboard/server.mjs", not only "server.mjs". (evidence: plan step 4, stale lock rule)

ADD THESE EDGE CASES:
- The same PR on two pages of one tick: one event, one pull.
- A manual batch launch with plans that are already live while the launcher still runs: no extra delay for a met plan.

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
