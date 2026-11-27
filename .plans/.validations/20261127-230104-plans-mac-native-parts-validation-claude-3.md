**Validation round:** 3

## Plan validation: 20261127-230104-plans-mac-native-parts.md

**Verdict:** NEEDS REWORK

The round 2 changes are mostly sound. The atomic `openSync(lock, 'wx')`, the PID that the shell writes itself, the EXIT trap, the `/*@RINGS*/{}` fill and the fresh boot check all fit the code. Four gaps remain, and each one gives broken or unsafe work. Each fix is local (a few lines in Decisions, Steps and Tests); the rest of the plan can stay.

### Blocking issues

- [Edge cases / broken feature] The wider `typing` rule is true almost all the time, so the reload (goal 4) and the relaunch after Build and install (goal 5) never run. — `apps/dashboard/page/page.html:82` (`<textarea id="notetext">` is always in the DOM); `app.js:5282` (`byId('notetext').value = note.text`), `app.js:5267` (the note is saved to localStorage, so its text is not unsent work); `app.js:3488-3507` (the Settings rows are `<input type="text" … value="<saved value>">`); `app.js:3236` (`closeLog()` only removes the `open` class, so the rows stay in the DOM after Settings closes); `app.js:3899-3904`, `app.js:3983` (`#scandir` with a `value=`), `app.js:4916` (`#bq`, the board search box, with a `value=`). — Plan step 14 says "some `textarea` or text `input` … other than `#q` has a non-empty value". An owner with a saved sticky note, or one who opened Settings or Add project once, always has `typing: true`, so the reload and the relaunch stay pending for ever. The plan's test ("false when only `#q` has text and every other field is empty") cannot find this. — Fix: count a field only when it holds unsaved text: `el.value.length > 0 && el.value !== el.defaultValue` (an `<input value="…">` that the owner did not change equals its `defaultValue`). Leave out `#notetext` (it saves on each input) and the search and filter boxes (`type=search`: `#q`, `#bq`, `#palq`, `#pfq`). Keep `settingsDirty()`. Add tests: a prefilled, unchanged Settings row gives false; a note textarea with text gives false; `#bq` with text gives false; `#cin` with `'  '` gives true.

- [Wrong data] The build output that goes through `redact()` is cut to 500 characters, so the bar shows the wrong lines. — `apps/dashboard/watch.mjs:133-140` (`redact()` ends with `.slice(0, 500)`). — Plan Contracts ("`output` is the last 4000 characters of `CENTRAL/app-build.log`, through `redact()`") and step 10 run `redact()` on the 4000-character tail, so `output` becomes the first 500 characters of that tail. Step 20 shows "the last output line" while the build runs and "the last 3 output lines in red" after a failure. A swiftc error log is longer than 500 characters, so the bar shows old middle lines and not the error. The tests use short output (`building…`, `done`, `error: swiftc failed`), so they pass anyway. — Fix: redact line by line, then take the tail: `log.split('\n').map(redact).join('\n').slice(-4000)`. Add a test: the `fail` mode prints 2000 characters of filler, then `error: swiftc failed`, and `output` ends with `error: swiftc failed`.

- [Safety / decision taken for the owner] Allow / Deny can still run something that the owner did not see. (a) "A tool with no target (other tools) shows its name and gets the buttons." This covers WebFetch (its `input.url` is never shown), WebSearch, Task, Skill and every `mcp__*` tool, whose arguments can delete or send data. A Bash command with a URL gets no buttons, but a WebFetch of the same URL does, so the rule is not consistent. (b) The `full` check counts characters only. A Bash command of 120 characters or less can hold newlines, tabs or bidi control characters (U+202E). Then the collapsed banner shows a harmless first line, and Allow runs the hidden rest (for example `ls` + newlines + `rm -rf ~/x`). — Plan Decisions line 34 and step 6; `notifyParts()` at `apps/dashboard/server.mjs:1931-1936` changes only URLs and does not join lines; `chatAnswer()` at `server.mjs:3190-3191` sends `updatedInput: input` unchanged. — The plan's own reason ("Allow must never run a command that the owner could not read in full") does not hold. — Fix: give buttons only to Bash (`input.command`) and to `Edit` / `Write` / `MultiEdit` / `NotebookEdit` (`input.file_path`) when `full` is true. Every other tool gets its name, no buttons, and a click opens the plan. Add to `full` the check that the target is printable ASCII only (`/^[\x20-\x7e]*$/`: no newline, tab, control or bidi character). Add watcher tests: `ask Bash` with a command that has a newline gives no `-askId`, and an `ask WebFetch` gives no `-askId`.

- [Concurrency / the build lock] The live check judges a live build stale when `ps` fails or cuts the command line, and then a second build starts on the same `.new` / `.old` paths. — `apps/dashboard/server.mjs:1846-1848` (`psCommand()` gives `null` on an error or a 5 s timeout, and runs `ps -p <pid> -o command=` with no `-ww`); `server.mjs:1873-1875` (the watcher lock check says "a ps call that fails … a live holder is never judged stale on it"). — Step 10 says live = `pidAlive` and `psCommand(pid)` contains `app-build`, so a `null` answer makes the build stale. Also, the bash command line starts with the script text, which is about 100 characters, and `app-build` comes after it. BSD `ps` cuts the last column to the terminal width (79 columns when no stdio is a terminal, as under launchd). This is not verified here (this review cannot run `ps`), but if it is true, every live build reads as stale. — Fix: (1) as in `lockState()`, a `null` from `psCommand()` keeps the lock live; (2) put the marker where a cut cannot drop it: spawn with `argv0: 'app-build'` (Node `spawn` option, so `ps` shows `app-build -lc …`), or read the command with `ps -ww`. Say which one in step 10/11. The restart test ("the new server's POST gives 'A build is already running.'" after the shell has written its PID) then proves it.

### Non-blocking concerns

- [Concurrency] The removal of a stale lock is check-then-unlink. Server A judges the lock stale, removes it, takes a new lock and spawns. Server B judged the same old lock stale a moment earlier and now unlinks A's fresh lock, so B's `wx` succeeds. — Plan step 11 ("when the lock exists and `appBuildLock().live` is false, remove it"); `takeLock()` at `server.mjs:1886-1897` solves the same race with `renameSync` to `.stale.<pid>` and a content compare. — Suggestion: move the stale lock aside with `renameSync(lock, lock + '.stale.' + process.pid)`, check that the moved file has the PID text that was judged stale, and only then unlink it (else put it back), as `takeLock()` does.
- [Consistency] Step 15 says "the 'The agent answered' call needs none", but the unit test says "the three `checkAlerts()` calls pass `p`". — `app.js:4321`, `:4325`, `:4329`. — Suggestion: make both say the same thing (two calls, or three).
- [Test can fail] Nothing tests a served `SERVER_RINGS` of `{"asks":true,"runs":true}`, so a fill that always gives `false` passes. — Plan Tests, `serverRings()` bullet; `apps/dashboard/test/watcher.test.mjs:112` (`mainEnv()` has `DASH_NO_NOTIFY: ''` and a `DASH_NOTIFIER`). — Suggestion: in `watcher.test.mjs`, check that the main server's `GET /` has `const SERVER_RINGS = {"asks":true,"runs":true}` (its watcher runs).
- [Flaky test] "`app-build.lock` holds a live PID", checked right after the POST, can read an empty lock: the shell may not have written `$$` yet. — Plan Tests, `POST /api/app/build` bullet. — Suggestion: poll until the lock text is a number.
- [Lost notification] The watcher rings a run outcome only when it changes (`outcomeEvents()` at `watch.mjs:82-91`, and `e.previous !== e.outcome` at `server.mjs:2172`). Take a pipeline run that fails, then a second run that fails again between two 60 s ticks. The server does not ring the second failure, and the page now stays quiet too (`serverRings`). — Suggestion: write this case in the docs, or let the page skip only when the server's last tick saw the run.
- [Edge case] Two status ticks 5 s apart can both start the fresh `GET /api/app` before the first reload ends, so the page reloads twice. — Plan step 19. — Suggestion: one in-flight flag for the reload check.
- [Safety, recorded] For `Edit` / `Write`, the notification shows the path but not the new content. Allow on a path such as `.git/hooks/pre-commit` writes content that the owner did not see. — Suggestion: say this in the docs sentence about Allow, or record it as accepted in Decisions.
- [Not verified] A collapsed macOS banner can cut a 120-character body to about two lines, so "shows the full target" can be false until the owner expands the banner. Proof: the manual check, step 1, with a 120-character command.
- [Not verified] In the notifier mode, `setNotificationCategories` comes right before `center.add`. The category may not be registered yet for the first ask, which then shows no buttons. The app also registers the category at launch, so later asks are fine. Proof: the manual check, step 2.
- [Minor] `pidAlive()` (`server.mjs:481`) gives false on `EPERM`. `bootstrapUpgrade()` uses `pidGone()` (`server.mjs:1063-1065`, ESRCH only). The plan says it mirrors `bootstrapUpgrade()`, so use `pidGone()` or say why not.

### Edge cases the plan should address

- A saved sticky note, or a Settings or Add project form that was opened once — today `typing` stays true for ever (blocking 1).
- A long swiftc error log — the bar must show its last lines (blocking 2).
- A Bash command with a newline or a bidi character; an `mcp__*` or `WebFetch` ask (blocking 3).
- `ps` times out under load while a build runs (blocking 4).
- Two servers find the same stale lock at the same moment (non-blocking 1).
- Two pipeline runs in a row fail between two watcher ticks (non-blocking 5).

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`notifyMac()`, `notifyParts()`, `selQuery()`, `fence()`, `psCommand()`, `pidAlive()`, `readExit()`, `launchGeneric()`, `bootstrapUpgrade()`, `chatFile()` / `loadChat()` / `saveChat()`, the `can_use_tool` branch, `chatAnswer()`, the `PAGE` fill chain with split/join `fill()`, `SHIPYARD_NOTIFIER` exported by `scout.mjs:329`, `infoPlist()`, `installApp()`, `IS_MAIN`, `dropOut()`, `alertUser()` / `checkAlerts()`, `boardCol()`, `settingsDirty`, `window.dashboard = {`, the quoted docs sentences at `docs/plans-dashboard.md:197`, `:230`, `:243`, `:383-384`)
- [ ] Reference implementation mirrored, deviations justified — the `psCommand` null rule of `lockState()` and the rename trick of `takeLock()` are not mirrored (blocking 4, non-blocking 1); `pidAlive` is used where `bootstrapUpgrade()` uses `pidGone`
- [x] Breaking changes for changed symbols listed (consumer search done: `notifyFirst` → `scout.mjs:351`, `server.mjs:1948`, the scout test; `infoPlist` → `build.mjs:170`, `build.test.mjs:41`; `alertUser` → `app.js:1931`, `:4321`, `:4325`, `:4329`)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently (11A and 12A are owner decisions; the Waits for line is the go)
- [ ] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint — success, refusal, 403 (cross-site) and 404 (`GET /api/app/build`) are covered; there is no positive served `SERVER_RINGS` case, the typing tests miss prefilled fields, and the output tests miss long logs
- [x] Restart after dashboard changes respected (Open items text; `server.mjs` imports `build.mjs`)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected (`kill -0` check only, `NSApp.terminate` of itself, a source test)
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; the new shapes are in Contracts)
- [x] "How to verify" commands are real and can fail (`npm test`, `node --test <file>`, `.claude/scripts/changelog-validate.mjs` exists)

```
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Change the `typing` rule (Decisions "No reload and no relaunch over unsent text", step 14, the appStatus unit test). Count a field only when `el.value.length > 0 && el.value !== el.defaultValue`. Leave out `#notetext` (it saves itself) and the search and filter boxes (`#q`, `#bq`, `#palq`, `#pfq`). Keep `settingsDirty()`. Add tests: an unchanged prefilled Settings row gives false, the note textarea with text gives false, `#bq` with text gives false, and `#cin` with '  ' gives true. (evidence: apps/dashboard/page/page.html:82; apps/dashboard/page/app.js:5267, :5282, :3488-3507, :3236, :3983, :4916)
2. Change `output` of GET /api/app (Contracts, step 10) to `log.split('\n').map(redact).join('\n').slice(-4000)`, because redact() cuts its result to 500 characters. Add a test: a `fail` build with 2000 characters of output before `error: swiftc failed` gives an `output` that ends with that error. (evidence: apps/dashboard/watch.mjs:133-140)
3. In Decisions ("Buttons only when the notification shows the full target") and step 6: give Allow / Deny only to Bash and to Edit / Write / MultiEdit / NotebookEdit with a `full` target. Every other tool (WebFetch, WebSearch, Task, mcp__*) gets its name, no buttons, and a click opens the plan. Add to `full` the check that the target is printable ASCII only (/^[\x20-\x7e]*$/: no newline, tab, control or bidi character). Add watcher tests: a Bash command with a newline gives no -askId, and an `ask WebFetch` gives no -askId. (evidence: apps/dashboard/server.mjs:1931-1936, :3190-3191)
4. In Decisions ("one lock file owns it") and steps 10–11: a null from psCommand() keeps the build lock live, as lockState() does. Make the `app-build` marker safe from a cut `ps` line: spawn bash with `argv0: 'app-build'` or read the command with `ps -ww`, and say which one. (evidence: apps/dashboard/server.mjs:1846-1848, :1873-1875)

SHOULD FIX:
1. Remove a stale build lock as takeLock() does: rename it to `.stale.<pid>`, compare its content with what was judged stale, and only then unlink it (else put it back). (evidence: apps/dashboard/server.mjs:1886-1897)
2. Make step 15 and the serverRings unit test agree on which checkAlerts() calls pass `p` (two or three). (evidence: apps/dashboard/page/app.js:4321, :4325, :4329)
3. Add a test that the watcher test's main server serves `const SERVER_RINGS = {"asks":true,"runs":true}`. (evidence: apps/dashboard/test/watcher.test.mjs:112)
4. In the POST /api/app/build test, poll until app-build.lock holds a number. Do not read it once right after the POST.
5. Use pidGone() (ESRCH only) for the build lock, as bootstrapUpgrade() does, or say why pidAlive() is used. (evidence: apps/dashboard/server.mjs:481, :1063-1065)
6. Add one in-flight flag, so that two status ticks cannot both start the fresh GET /api/app and reload twice (step 19).
7. In the docs (step 25), say that Allow on Edit / Write shows the path, not the content.

ADD THESE EDGE CASES:
- Two pipeline runs in a row fail between two watcher ticks: the server rings only an outcome change (watch.mjs:82-91, server.mjs:2172), and the page now stays quiet. Write this in the docs or handle it.
- A collapsed macOS banner can cut a 120-character body (add it to manual check step 1).
- The first ask after a cold notifier run may show no buttons, if setNotificationCategories is not done before center.add (add it to manual check step 2).

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
