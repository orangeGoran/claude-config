**Validation round:** 4

## Plan validation: 20261127-230104-plans-mac-native-parts.md

**Verdict:** APPROVE WITH CHANGES

Scope of this round: the round 3 changes (typing rule, line-by-line redaction, the five-tool button rule, `argv0` / `psCommand()` null = live, the `takeLock()`-style stale move, the second `appStatus()` check with `reloading`, relaunch without the hook) and internal consistency. Items that rounds 1–3 rejected or recorded as known limits are not raised again.

Verified as stated: `redact()` cuts at 500 (`apps/dashboard/watch.mjs:140`), so redacting line by line and then `.slice(-4000)` is right. `notifyParts()` removes URLs (`server.mjs:1934`) and `notifyMac()` redacts the message (`server.mjs:1946`), so a target that passes the five-tool check shows in full. `psCommand()` gives null on failure (`server.mjs:1846-1849`), and `lockState()` treats null as "says nothing" (`server.mjs:1873-1875`). `takeLock()` does rename to `.stale.<pid>`, re-read and `linkSync` back (`server.mjs:1885-1897`). `pidGone()` treats EPERM as live (`server.mjs:1063-1065`). `bootstrapUpgrade()` has the 60 s empty-lock rule and the `!child.pid` / fd `finally` pattern (`server.mjs:1098-1125`). `launchGeneric()` has the `EXIT` trap with `DASH_EXIT_FILE` (`server.mjs:832-833`). `ch.proj` / `ch.slug` exist (`server.mjs:3064`), and so do the `can_use_tool` branch (`server.mjs:2999-3001`), `chatFile()` = `<stateDir>/ask/<slug>.json` (`server.mjs:2544`), `NOTIFIERS` / `SHIPYARD_NOTIFIER` / `notifyFirst()` (`scout.mjs:329-345`), `settingsDirty` (`app.js:3461-3474`), `#saveReg`, `logpane`, `boardCol` (`app.js:4841-4845`), `starting` (`app.js:255`), `useNativeMenu()` and `window.dashboard = {` (`app.js:4811-4813`), the `alertUser()` / `checkAlerts()` titles (`app.js:4305-4331`), `p.hasPipeline` on page plans (`app.js:4391`), the `IS_MAIN` block with `HERE`, `dropOut`, `infoPlist` before the compile, `codesign`, then `installApp` (`build.mjs:132-192`), the doc sentences that steps 25 quotes (`docs/plans-dashboard.md:197, 230, 243, 383-384`), the usage text lines (`server.mjs:89-90`), and the test harness (`dashboard.test.mjs:163-189`, `watcher.test.mjs:58-188`).

### Blocking issues

- [Edge cases / Goal 4 and 5] The `typing` rule of step 14 counts two kinds of field that are never unsent text. Because of them, the reload after a restart and the relaunch after a build can wait forever. (1) Read-only copy rows: `addCopyRow()` makes `<input>` with no `type` attribute and sets `inp.readOnly = true; inp.value = cmd` through the property (`apps/dashboard/page/app.js:910-911`), so `value !== defaultValue` (`defaultValue` is `''`), and `input:not([type])` matches it. Every plan with agent sessions draws these rows (`app.js:871-879`, `app.js:961-964`, `app.js:3456`), also inside a closed `<details>`. (2) The palette search `#palq` (`apps/dashboard/page/page.html:78`, `type="search"`): `closeSearch()` hides it but keeps its text (`app.js:4718-4726`), and only `openSearch()` clears it (`app.js:4713`). After one ⌘K search, `typing` stays true until the next ⌘K. — Why it breaks: while either kind is in the DOM, `typing` is true, so the reload never happens and the bar stays at "Installed. Shipyard restarts when the chat box is empty." with an empty chat box. — Fix: count only fields that are not `readOnly` and not `disabled` (selector `:not([readonly]):not([disabled])`, or a check on `el.readOnly || el.disabled`), and leave out `#palq` next to `#q` and `#notetext` (it is a filter, the same as `#q`). Add test cases to the `appStatus()` page test: a read-only field with a value set by the property gives `typing: false`, and `#palq` with text gives `typing: false`. Update the Decisions bullet "No reload and no relaunch over unsent text" to match.

### Non-blocking concerns

- [Internal consistency] Step 19 says "do one fresh `GET /api/app` and reload only when its `boot` still differs from the page `boot`". It does not mention the second `appStatus()` call, the `typing` re-check in that last callback, or the `reloading` flag. The Decisions (plan line 46) and the Swift source check (plan line 189: "the reload sits behind `reloading` and a second `appStatus()` call after the fresh `/api/app` GET") require them. — Suggestion: write the same sequence into step 19: GET → `appStatus()` → reload in that callback only when the boot still differs and `typing` is false; set `reloading` before the GET and clear it on every path that does not reload.
- [Internal consistency] The stub list of step 16 (`plans`, `boardCol`, `starting`, `byId`, `document`, `PAGE_BOOT`) does not have `settingsDirty`. The Unit test (plan line 192) stubs it, and step 14 calls it. — Suggestion: add `settingsDirty` to step 16.
- [Docs: current state only] `build.mjs` still prints "Quit Shipyard (⌘Q) and open it again to use the new build." after an install (`apps/plans-mac/build.mjs:191`). After this plan, a build from the bar restarts Shipyard by itself, so the line is half wrong. It also lands in the build log, and the plan does not say which output line the bar shows on `done`. — Suggestion: in step 2, change the line to fit both paths (for example "Installed … A Shipyard that runs restarts into it after Build and install; else quit it (⌘Q) and open it again."), or say that the bar shows its own text on `done`.
- [Edge cases] The stale-lock move copies the `takeLock()` window. Server B renames A's new lock away and puts it back with `linkSync`. Between those two calls, a third server sees no lock, takes `wx` and starts a second build. B's `linkSync` then fails with `EEXIST`. This needs three servers on one HOME at the same moment, and the watcher lock has the same window, so this is a known limit, not a defect. — Suggestion: one sentence in Decisions: when the `linkSync` back fails, refuse and do not unlink the moved file blindly.
- [Estimates] `GET /api/app` calls `psCommand()` (a synchronous `ps`, timeout 5 s, `server.mjs:1847`) on each poll while a lock exists, which is every 2 s during a build. It is cheap in practice (the watcher does the same per tick). No change is needed, but the plan says "No rate limit: it reads memory and hashes two small files" (plan line 70), and that text leaves out the `ps` call.

### Edge cases the plan should address

- A read-only or disabled text field with a value that the script set (the copy rows) — it must not count as typing (see Blocking).
- The closed palette that keeps its query in `#palq` — it must not count as typing (see Blocking).
- The `linkSync` back fails with `EEXIST` during the stale-lock move — refuse, and leave the new lock as it is.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (tenant or owner, when the project scopes data) per endpoint
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (the `typing` test misses the read-only and `#palq` cases)
- [ ] Docs: current state only respected (`build.mjs:191` text)
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 14 and in the Decisions bullet "No reload and no relaunch over unsent text", count a field for `typing` only when it is not readOnly and not disabled (`:not([readonly]):not([disabled])`), and leave out `#palq` next to `#q` and `#notetext`. Add to the `appStatus()` page test: a read-only input whose value was set by the property gives `typing: false`, and `#palq` with text gives `typing: false`. (evidence: apps/dashboard/page/app.js:910-911 addCopyRow sets readOnly and value by property, drawn at app.js:871-879, 961-964, 3456; apps/dashboard/page/page.html:78 #palq; app.js:4713 and 4718-4726 the palette keeps its query after close)

SHOULD FIX:
1. Write the full reload sequence into step 19: set `reloading`, fresh GET /api/app, then a second `appStatus()` call, and reload in that callback only when the page boot still differs from the fresh boot and `typing` is false; clear `reloading` on every path that does not reload. (evidence: plan Decisions "No reload and no relaunch over unsent text" and the Swift source check in Unit tests; step 19 has only the GET)
2. Add `settingsDirty` to the stub list of step 16. (evidence: step 14 calls it; the Unit test stubs it)
3. In step 2, change the build.mjs install message "Quit Shipyard (⌘Q) and open it again to use the new build." so that it is also true after Build and install, or say which text the bar shows on `done`. (evidence: apps/plans-mac/build.mjs:191)
4. In the Endpoint access row of GET /api/app, say that it also runs one `ps` call while a build lock exists. (evidence: apps/dashboard/server.mjs:1846-1849)

ADD THESE EDGE CASES:
- The `linkSync` back fails with EEXIST during the stale-lock move: refuse the POST and leave the new lock as it is.

Do not change anything the validation did not flag.
```
