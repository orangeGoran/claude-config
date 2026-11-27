**Validation round:** 1

## Plan validation: 20261127-230104-plans-mac-native-parts.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues

- [Edge cases / verify can fail] The "one ring per ask, also across a restart" design and its test do not work as written. The `rung` dedupe never runs in the restart case, and asks replayed after a restart never ring. — `apps/dashboard/server.mjs:3947-3949` (`server.listen` → `chatReattach()` first, then `startWatcher()`); `server.mjs:2215` (the first watcher tick, which is the first `takeLock()`, runs 2 s after start); `server.mjs:2184` (the lock is taken only inside `watchTick`); `server.mjs:1851` (`holdsLock()` reads the lock file). — The relay replays the running turn (`apps/dashboard/chat-relay.mjs:15,81`) when `chatReattach()` connects, which is before the new server holds the lock. Step 6 returns on `!holdsLock()`, so the replayed `control_request` is dropped before `rung` is read. Result: (a) the watcher test "a restart does not ring it again" passes even without the `rung` code, so it cannot fail when step 6's dedupe is wrong; (b) an ask that arrives while the server is down or restarting (the relay keeps it and replays it) never rings at all, and goal 1 fails in silence for exactly that case. — Fix: after the server takes the watcher lock (in `watchTick`, after `holdsLock() || takeLock()` succeeds), go through `chats` and call `noteAsk(ch, id, req)` for each entry of `ch.waits`; `rung` then prevents the second ring. In the test, wait until the restarted server holds the lock (for example, until the next `watch.json` write or `ticks(2)`) before you check `notes()`. Assert that the chat file's `rung` has `req-test-1`. Add one case that proves the re-ring path: an ask that comes in during the restart window rings once after the lock is taken.

- [Wrong behaviour / regression] `SERVER_RINGS` (step 15) removes the browser notification for "Run failed" and "Run needs you" for every plan. The server rings these two only for pipeline projects. — `apps/dashboard/server.mjs:2076-2078` (`if (proj.hasPipeline) { next.outcomes = … outcomeEvents(…) }`); the generic launcher runs get `failed` / `needs-you` outcomes too (`server.mjs:515-517`, `genericRunInfo`); the page alerts for all plans (`apps/dashboard/page/app.js:4313-4318`). — A browser owner with notifications allowed loses the system notification for a failed or needs-you run of a generic (launcher) project. The reason of the decision ("these rang twice") is not true there. The server also does not ring when `DASH_NO_NOTIFY` is set, when the watcher is off (`DASH_WATCH_MS=0`), or on the server that does not hold the lock. — Fix: suppress the page notification of the two run titles only when the plan's project has a pipeline (`p.hasPipeline` is on each page plan, `app.js:4387`; pass it to `alertUser()` or check it in `checkAlerts()`). Say in the plan and in the docs that the page keeps its notification for generic projects. Add a page test for both cases.

### Non-blocking concerns

- [Tests can fail] The second-server test ("a second server on another port (no watcher lock) … rings nothing") passes for the wrong reason unless that server has the notifier env. `envFor()` sets `DASH_NO_NOTIFY: '1'` and `DASH_NOTIFIER: ''` by default (`apps/dashboard/test/watcher.test.mjs:87`), so `notifyMac()` returns early (`server.mjs:1942-1944`). — Start the second server with the same HOME, another port, `DASH_NO_NOTIFY: ''`, `DASH_NOTIFIER: <bin>/notifier` and `NOTIFY_LOG`, and use a plan that the main server has no chat for.
- [Edge case] The ask notification uses the plan's group `plans-<query>` (`server.mjs:1947`). A second ask in the same plan replaces the first notification (its buttons go away while the first ask still waits), and a later "your turn" replaces the ask. — In the Shipyard-only `extra`, add `-group plans-ask-<id>`. `notifierArgs()` keeps the last value of a flag (`main.swift:93-95`), so terminal-notifier still gets the 5 flags of today.
- [Edge case] Step 20 (c) does not say what happens when the build ends `done` but `build.hash` is not the server's current `shellHash` (the source changed during the build, for example a `git pull`). — Say it: the app leaves the waiting state and shows "New version ready" again; no relaunch.
- [Edge case] The reload after a restart can run twice. During `npm run restart` the window can show the waiting page (`main.swift:458-462`); its 5 s retry loads the new page, and then the next `/api/app` poll sees the new `boot` and reloads again. — Keep as the known `boot` the value read after the last page load (`didFinish` of the app origin), or skip the reload when the page loaded after the boot change.
- [Edge case] Step 11: the 10-minute timer must be cleared on `exit` and `error` and must be `unref()`'d; else it sets `failed` on a done build. `error` and `exit` can both fire; set the state once. Mirror `bootstrapUpgrade()`'s guard `if (bootstrapChildren.get(...) === child)` (`server.mjs:1119`).
- [Consistency] `relaunch()` quits the app with no check of `typing`. That goes against the plan's own rule "No reload over unsent text" (a quit loses the chat draft in the same way). — Before the relaunch, wait while `typing` is true (as the reload does), or say why the click on Build and install is enough consent.
- [Docs] `docs/roadmap.md:27` still says "2b and phase 3 are not written yet". The plan's Docs rule mentions only the parent plan, and Affected files does not list `docs/roadmap.md`. — Add `docs/roadmap.md` (Projects → Shipyard line) to Affected files and the Steps: "2b is planned: <plan link>".
- [Fact drift] "next to the 5 that exist": plan `20261127-230102-cross-repo-defect-tickets.md` (it runs before this one) adds a `triage-ticket` event and its notification (its line 196). — Write "the watcher notifications that exist" instead of a count, or find them by `note(` when the plan runs.
- [Changelog] `audience: both` needs a `customer.en` key (`changelog.d/AGENTS.md:6`; see `changelog.d/20261125-plans-mac-app-shell.yaml:10-11`). Step 26 names only the summary. — Name `customer.en` in step 26.
- [Privacy] The ask notification shows the Bash command (`input.command`, after `redact()`) on the lock screen when macOS shows notification previews there. — Write this in the docs, or show only the tool name and the plan when the detail is a command.
- [Keep awake] Pipeline runs already keep the Mac awake with `caffeinate -i` (`.claude/scripts/auto-pipeline.sh:476`, `server.mjs:836`, `server.mjs:1112`). The Shipyard assertion adds the chats. This does no harm. — One sentence in the docs, so that the owner knows that runs stay awake without the app.
- [Restart rule] With step 10, `server.mjs` imports `apps/plans-mac/build.mjs`. A change to `build.mjs` then also needs a dashboard restart. — Add this to the Open items text, or to `apps/plans-mac/AGENTS.md`.
- [Estimates] "a 1-minute build", "about a minute" (Decisions; Deviations) have no command that measured them. — Remove them, or cite one timed `npm run build-app`.
- [Test clarity] "`shellHash` equals `shellHash(<repo>/apps/plans-mac)`" in `dashboard.test.mjs`: there, `repo` is the temp project (`dashboard.test.mjs:202`). — Write "the real repo root (the folder of `SCRIPT`, `../../`)".
- [Test flake] The `running` check of the build test reads `GET /api/app` against a fake build that sleeps only 0.5 s. — Read the state right after the first POST, or make the fake build sleep longer.

### Edge cases the plan should address

- An ask that arrives while the server is down, or in the first 2 s after a restart (before the lock) — today it never rings (blocking issue 1).
- A generic (launcher) project run that fails or needs the owner, in a browser with notifications allowed — the page must still ring (blocking issue 2).
- Two asks waiting in one plan — each needs its own notification with its own buttons.
- An ask answered in the page while its notification is still shown — the button then gives "The agent no longer waits for this answer." and opens the plan (this is covered by "A failed button answer opens the plan"; say so in the docs).
- A done build whose hash is not the current server hash (the source changed during the build).
- A focused board search box or settings field with text: `typing` stays true, so the reload waits until the focus moves. That is acceptable, but say it in the plan.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`notifyParts`, `notifyMac`, `selQuery`, `fence`, `holdsLock`, `chatOnLine` → `can_use_tool`, `chatAnswer` texts, `chatFile` / `loadChat` / `saveChat`, `bootstrapRunOf` / `bootstrapUpgrade` / `bootstrapChildren`, `crossSiteReason`, `/api/usage` and `/api/add-project` routes, `if (!proj || !safeName(b.slug))`, `NOTIFIERS` / `SHIPYARD_NOTIFIER` / `notifyFirst`, `starting`, `boardCol`, `alertUser`, `checkAlerts` titles, `useNativeMenu`, `window.dashboard = {`, `pageHooks()`, the "fourteen" test, the `FAKE_CLAUDE` / `envFor` / `mainEnv` / `notes()` harness, the docs quotes at `docs/plans-dashboard.md:197` and `:230`)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `notifyMac` has one caller, `server.mjs:2165`; `notifyFirst` callers are `scout.mjs:351`, `server.mjs:1948` and the scout test; `infoPlist` callers are `build.mjs:170` and `build.test.mjs`)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently
- [ ] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (403 cross-site is covered; the ask restart and second-server tests cannot fail as written)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [ ] Docs: current state only respected (`docs/roadmap.md:27` is stale and not in the plan)
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail (the commands exist; the restart-dedupe assertion inside `watcher.test.mjs` cannot fail)

```
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the ask ring work after a restart, and make its test able to fail. chatReattach() runs before the first watcher tick takes the lock, so the relay's replayed control_request reaches noteAsk() while holdsLock() is false: the rung check never runs, and an ask that came in while the server was down never rings. Add a step: after the server holds the watcher lock in watchTick(), call noteAsk() for every entry of ch.waits of every live chat (rung prevents a second ring). In the watcher test, wait until the restarted server holds the lock (for example ticks(2)) before you check notes(), assert that the chat file's rung has req-test-1, and add a case where an ask that comes in during the restart window rings once after the lock is taken. (evidence: apps/dashboard/server.mjs:3947-3949, :2184, :2215, :1851; apps/dashboard/chat-relay.mjs:15,81)
2. Limit SERVER_RINGS for "Run failed" and "Run needs you" to plans whose project has a pipeline (p.hasPipeline). The watcher rings run outcomes only for pipeline projects, so generic launcher runs would lose their only system notification. Update the decision "The page stops its own system notification…", step 15, the page test, the Breaking changes line and the docs step. (evidence: apps/dashboard/server.mjs:2076-2078, :515-517; apps/dashboard/page/app.js:4313-4318, :4387)

SHOULD FIX:
1. In the second-server watcher test, start the server with the same HOME, another port, DASH_NO_NOTIFY '', DASH_NOTIFIER <bin>/notifier and NOTIFY_LOG; with envFor() defaults notifyMac() returns early and the test cannot fail. (evidence: apps/dashboard/test/watcher.test.mjs:87; apps/dashboard/server.mjs:1942-1944)
2. Give the ask notification its own group in the Shipyard-only extra args (-group plans-ask-<id>), so a second ask or a later "your turn" does not replace it. (evidence: apps/dashboard/server.mjs:1947; apps/plans-mac/src/main.swift:93-95)
3. In step 20 (c), say what happens on a done build whose build.hash is not the current shellHash: leave the waiting state and show "New version ready" again, no relaunch.
4. In step 20 (a), prevent a second reload when the waiting page already loaded the new server's page (keep the boot read after the last page load of the app origin). (evidence: apps/plans-mac/src/main.swift:458-462, :490-493)
5. In step 11, clear and unref the 10-minute timer, and set the end state once when both error and exit fire (mirror the guard at apps/dashboard/server.mjs:1119).
6. Make relaunch() wait while typing is true, as the reload does, or state why the click is enough.
7. Add docs/roadmap.md (the Shipyard line: "2b is planned") to Affected files and Steps. (evidence: docs/roadmap.md:27)
8. Replace "the 5 that exist" with "the watcher notifications that exist": plan 20261127-230102 adds a triage-ticket notification before this plan runs. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:196)
9. In step 26, name the customer.en key (audience: both). (evidence: changelog.d/AGENTS.md:6)
10. In the dashboard test, compute the expected shellHash from the real repo root, not the test's temp repo variable. (evidence: apps/dashboard/test/dashboard.test.mjs:202)
11. Remove the "1-minute build" estimates, or cite a timed build.
12. Say in Open items or in apps/plans-mac/AGENTS.md that a change to build.mjs now also needs a dashboard restart, because server.mjs imports it.
13. Write in the docs that the ask notification can show the redacted command on the lock screen, and that pipeline runs keep the Mac awake with caffeinate also without the app.

ADD THESE EDGE CASES:
- An ask that arrives while the server is down or in the first 2 s after a restart.
- A generic project run that fails or needs the owner, in a browser with notifications on.
- Two asks waiting in one plan at the same time.
- An ask answered in the page while its notification is still shown (the button opens the plan).
- A done build whose hash differs from the current source hash.
- A focused text box with text (board search, settings) keeps typing true and delays the reload.

Do not change anything the validation did not flag.
```
