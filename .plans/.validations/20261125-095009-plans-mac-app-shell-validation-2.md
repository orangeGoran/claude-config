**Validation round:** 2

## Plan validation: 20261125-095009-plans-mac-app-shell.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round-1 fixes went in correctly. Every file, symbol and test helper the plan names exists as described, and every "How to verify" command is allowed. One blocking gap remains: when the dashboard service is down but Caddy is up, Caddy answers 502 with no network error, so the "Waiting for the dashboard…" page never shows. That breaks app check 8. Two of the setup.sh block tests also do not match the real file layout.

### Blocking issues

1. [Edge case / wrong behavior] When the dashboard is down, the waiting page does not show — `scripts/setup-macos.sh:116` (`brew services restart caddy`: Caddy is its own service) and `scripts/caddy/plans.caddy.template` (`reverse_proxy 127.0.0.1:__PORT__`) — Step 5 shows the waiting page only for `NSURLErrorDomain` failures in `didFailProvisionalNavigation` / `didFail`. When the owner stops `com.plans-dashboard` (app check 8), or while `npm run restart` runs, Caddy still answers, with HTTP 502 and an empty body. WKWebView treats that as a successful load: there is no NSURLError, `didFinish` fires with a `sameOrigin` URL, the retry timer is cancelled, and the window stays blank for good. So app check 8 fails, and so does the Context promise ("When the dashboard URL does not load … tries again after 5 s"). — Fix: in `decidePolicyFor navigationResponse`, when the response is for the main frame, has the app's origin, and is an `HTTPURLResponse` with `statusCode` 502, 503 or 504, return `.cancel` and show the same waiting page with the same single retry timer. Then make sure the 102 "frame load interrupted" from that cancel does not replace it (it is in WebKitErrorDomain, so the current filter already skips it). Add this to the source test ("the response handler treats 502/503/504 as not loaded") and to the Context line.

### Non-blocking concerns

2. [Test design] The text check "the line after the block is `open "${APP:-$url}"…`" cannot pass with the block placement the plan gives — `scripts/setup.sh:82-83`: `printf '\nDone. Opening %s …' "$url"` sits between the end of the scout block and the `open` line. Step 10 puts the block "before the final `Done.` line", so the line after `# --- end Mac app ---` is the `printf`, not the `open` line. — Fix: test that `scripts/setup.sh` contains the line `open "${APP:-$url}" 2>/dev/null || true` and does not contain the old `open "$url"` line. Also decide whether the `Done. Opening %s` text should name the app when `APP` is set (today it would say "Opening https://plans.test" while it opens Plans.app).
3. [Test design] A `runSetupPart()` twin that is "the same code" as `runPart()` will not find the markers — `test/setup-paths.test.mjs:25` matches with `l.startsWith(from)`. The block lives inside `if [ "${PICKED[1]}" = 1 ]; then` (`scripts/setup.sh:64-83`, indented two spaces), so the lines read `  # --- Mac app ---`. The `setup-macos.sh` lines that `runPart()` reads are not indented (`scripts/setup-macos.sh:75-80`). — Fix: `runSetupPart()` matches `l.trim() === '# --- Mac app ---'` (and the end marker), and the plan says so.
4. [Install logic] A leftover `.old` from an earlier crashed install makes the next install fail — step 6 removes an old `.new`, but not an old `.old`. `renameSync(dest, dest + '.old')` onto a non-empty folder fails with ENOTEMPTY on macOS. — Fix: before the first rename, also `rmSync(dest + '.old', { recursive: true, force: true })`.
5. [Test can't fail] The restore path of `installApp()` is not tested — the only failure test ("the source does not exist") throws in `cpSync`, before any rename. It passes even when the "rename `.old` back" code is missing. — Fix: add a test that fails after the first rename. For example, `installApp(built, dest, { rename })` takes an optional rename function for tests, and the test makes the second rename throw. Then assert that `dest` holds the old file and no `.old` is left. Or drop the claim from the deviation line.
6. [Swift] The certificate hint range misses two TLS codes — step 5 says -1202 … -1206. `NSURLErrorServerCertificateHasBadDate` is -1201 and `NSURLErrorSecureConnectionFailed` is -1200. An expired or failed Caddy local certificate gives one of these. — Fix: use -1206 … -1200.
7. [Swift] ⌘R on the waiting page reloads `about:blank` — step 4 maps Reload to `web.reload()`. — Fix: when `!sameOrigin(web.url)`, ⌘R loads the app URL (and resets the retry timer).
8. [Swift] Set the order explicitly: `config.preferences.inactiveSchedulingPolicy = .none` must be set before `WKWebView(frame:configuration:)`, because the web view copies the configuration — step 3 lists the policy after the web view. — Fix: say "set on `config` before the web view is made".
9. [Test design] The key-equivalent test is "a regex over the item lines". It fails if Tabs 1–8 are built in a loop (`for n in 1...8 { … "\(n)" … }`), and the contract regex `call("<name>(` still passes then. — Fix: tell the implementer to write one item per line (or a literal table in Swift that the test reads). That keeps the two tests in step with the code.
10. [Browser test] The test dashboard command leaves the event watcher on — AGENTS.md → Commands: `DASH_PORT=4911 DASH_NO_OPEN=1 DASH_WATCH_MS=0 node apps/dashboard/server.mjs`; the plan's Browser test omits `DASH_WATCH_MS=0` (`apps/dashboard/server.mjs:1641`). — Fix: add `DASH_WATCH_MS=0`.
11. [Ambiguity] The expected output of `appUrl({ flag: 'https://dash.example.test:8443' })` is "that URL". If `appUrl` returns `new URL(x).href`, the result is `https://dash.example.test:8443/` (a slash is added). — Fix: state whether the result is normalized (`href`) or the raw input, and write the test to match.
12. [Claim accuracy] `siteUrl` uses `/^([^ {#]+) \{/m`, but it is called "the same pattern as setup.sh". `scripts/setup.sh:71` uses `^\([^ {]*\) {`, which allows an empty name and `#`. The result is the same for the files `setup-macos.sh` writes, because the template comment lines never end a token with ` {`. — Fix: say "the same rule as setup.sh, plus it skips `#` lines".
13. [Not verified] `xcrun --find swiftc` on a Mac with no Command Line Tools may itself open the install dialog (`/usr/bin/xcrun` is the shim launcher). In `setup.sh` this cannot happen, because `setup-macos.sh` needs Homebrew, which needs the Command Line Tools. Proof: run the check on a Mac without the tools. A cheap guard: `xcode-select -p` first. Also give `--check` `stdio: 'ignore'`, and give the compile `stdio: 'inherit'` (or print the `stderr`), so a Swift compile error is readable.
14. [Cost] The compile test runs on every `npm test` on macOS. A cold AppKit/WebKit module cache under a throwaway `HOME` can take tens of seconds. Not measured. — Suggest: say so in the Tests section, or keep `HOME` for the compile and point only the install destination at the throwaway folder.

Verified as correct (no action):
- `runPart(from, to, env, tail)` at `test/setup-paths.test.mjs:23-28`.
- `set -euo pipefail` at `scripts/setup.sh:14`.
- `open "$url" 2>/dev/null || true` at `scripts/setup.sh:83`.
- The scout `[Y/n]` block at `scripts/setup.sh:75-81`.
- The `sed` line at `scripts/setup.sh:71`.
- In `apps/dashboard/page/app.js`:
  - `tabHook` / `searchHook` / `window.dashboard` at lines 4385-4388.
  - `const hasChat` at 995, `toggleChat(on)` at 1057 (it focuses `#cin` at 1062), `async function openSettings` at 3190.
  - The `boardBtn` click handler at 4787 and `PALETTE_ACTIONS` at 4270-4275.
  - `find` at 133, `openRunLink` → `window.open(url, '_blank', 'noopener')` at 929.
  - 11 `confirm(` calls; no `prompt(`.
- The hooks test at `apps/dashboard/test/dashboard.test.mjs:407-425`. Its `[^}]*` capture still works, because the new entries contain no `}`.
- `package.json`: `scripts.test` has the glob `apps/*/test/*.test.mjs`, and there is no `version` (so 1.0 is used).
- Parent plan line 23 "— planning now." and roadmap line 26 "being planned" exist. Roadmap Architecture **Service** is at line 18.
- docs/plans-dashboard.md "## Tabs and keyboard shortcuts" is at line 162, with the hook sentence at 178.
- Swift/AppKit/WebKit names are right:
  - `WKPreferences.inactiveSchedulingPolicy` / `.none` (macOS 14+).
  - `WKNavigationResponse.isForMainFrame` / `canShowMIMEType`, `navigationAction.targetFrame?.isMainFrame`.
  - `NSWindow.deminiaturize(_:)`, `applicationShouldHandleReopen(_:hasVisibleWindows:)`, `windowShouldClose(_:)`.
  - `webView(_:createWebViewWith:for:windowFeatures:)`, `runJavaScriptAlertPanelWithMessage` / `runJavaScriptConfirmPanelWithMessage`.
  - Key equivalents `"{"` / `"}"` / `"T"` (Shift is implied).
- Error 102 is in WebKitErrorDomain, so the `NSURLErrorDomain` filter skips it.
- The `swiftc` flags `-O -swift-version 5 -target <arch>-apple-macos13.0 -o`, through `xcrun`, are valid. `codesign --force --sign -` and `codesign --verify` are valid.
- `cpSync` `verbatimSymlinks` has existed since Node 16.15 / 17.6, so Node 18+ has it (local Node: v24.21.0). `os.homedir()` follows `HOME`, so the `--no-install` test can fail.
- The page's own ⌘K handler (`app.js:4375`) calls `preventDefault`, so WKWebView does not also fire the menu item, and ⌘K does not run twice.
- Each setup.sh block test fails without the feature: the markers are missing, the `if` wrapper is missing (a build that exits 1 stops `set -e`), and the skip message is missing.
- All "How to verify" commands are allowed in `.claude/settings.json` `permissions.allow`: `node --test*`, `npm test*`, `grep *`, `node .claude/scripts/changelog-validate.mjs*`. The script `changelog-validate.mjs` reads `--base` (line 150).
- No regression from the round-1 edits.

### Edge cases the plan should address

- Caddy up, dashboard down (502/503/504), as well as during `npm run restart`. This is finding 1.
- `setup.sh` with an empty answer (Enter) to the Mac app question: the default is yes, so the build must run. Add a fifth block test with `YES=0` and stdin `\n`.
- A stale `Plans.app.old` or `Plans.app.new` left by a killed install (finding 4).
- Two `npm run build-app` runs at the same time share `dest + '.new'`. This is acceptable if documented ("run one at a time").
- App Nap: a windowless app can be napped by macOS even with `inactiveSchedulingPolicy = .none`. App check 10 covers it; if it fails, 2b's keep-awake (`ProcessInfo.beginActivity`) is the place to fix it.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (except the "line after the block" claim, finding 2)
- [x] Reference implementation mirrored, deviations justified (the `runSetupPart` twin needs trimmed matching, finding 3)
- [x] Breaking changes for changed symbols listed (consumer search done: `window.dashboard` appears only in app.js, dashboard.test.mjs and docs/plans-dashboard.md)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no endpoints)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (the `installApp` restore path is untested, finding 5)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261125-095009-plans-mac-app-shell.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Show the waiting page also when Caddy answers but the dashboard is down. In step 5, decidePolicyFor navigationResponse: for a main-frame response with the app's origin and HTTP status 502, 503 or 504, return .cancel and show the waiting page with the same single retry timer. Add it to the Context line and to the source test. (evidence: scripts/setup-macos.sh:116 runs Caddy as its own brew service; scripts/caddy/plans.caddy.template reverse_proxy; app check 8 stops only com.plans-dashboard)

SHOULD FIX:
1. Replace the setup.sh text check "the line after the block is open ..." with: the file contains `open "${APP:-$url}" 2>/dev/null || true` and no longer contains `open "$url" 2>/dev/null || true`. The Done printf sits between the block and the open line. Decide whether the Done text names the app when APP is set. (evidence: scripts/setup.sh:82-83)
2. Say that runSetupPart() matches the markers after trim(), because the block is indented inside the dashboard `if`. (evidence: test/setup-paths.test.mjs:25 uses startsWith; scripts/setup.sh:64-83 is indented)
3. In installApp(), also remove a stale dest + '.old' before the first rename. (evidence: plan step 6)
4. Add a test that makes installApp fail after the first rename (for example an optional rename function argument) and checks that the old app is restored. The current failure test throws before any rename. (evidence: plan Tests, installApp bullet)
5. Widen the certificate-hint range to -1206 … -1200 (bad date -1201, secure connection failed -1200). (evidence: plan step 5)
6. Make Reload (⌘R) load the app URL when web.url is not the app's origin (the waiting page). (evidence: plan step 4)
7. Say that inactiveSchedulingPolicy is set on config before the WKWebView is made. (evidence: plan step 3)
8. Say that the Tabs menu items are written one per line (or as a literal table), so the key-equivalent regex test can read them. (evidence: plan Tests, key equivalents bullet)
9. Add DASH_WATCH_MS=0 to the Browser test dashboard command. (evidence: AGENTS.md Commands; apps/dashboard/server.mjs:1641)
10. State whether appUrl returns new URL(x).href (with a trailing slash) or the raw value, and fix the test expectation. (evidence: plan Tests, appUrl bullet)
11. Change "the same pattern as setup.sh" to "the same rule as setup.sh, and it skips # lines". (evidence: scripts/setup.sh:71)
12. Give --check stdio 'ignore' and the swiftc call stdio 'inherit' (or print stderr), so a compile error is readable. (evidence: plan step 7)

ADD THESE EDGE CASES:
- Caddy up, dashboard down or restarting (502/503/504).
- setup.sh with an empty answer (Enter) builds the app: a fifth block test with YES=0 and stdin "\n".
- A stale Plans.app.old or Plans.app.new from a killed install.
- Two build-app runs at the same time (document "one at a time").
- App Nap of the windowless app (app check 10; 2b keep-awake if it fails).

Do not change anything the validation did not flag.
```
