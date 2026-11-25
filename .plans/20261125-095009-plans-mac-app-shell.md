# Plan: The Plans Mac app shell (phase 2a)

- **Base**: main
- **Parent**: .plans/20261122-151056-plans-mac-app-parent.md

## Goal

A native Mac app, `~/Applications/Plans.app`, that shows the dashboard page in one window and gives the owner the ⌘ shortcuts that a browser keeps for itself: ⌘1–8, ⌘9, ⌘⇧[ / ⌘⇧], ⌘W, ⌘⇧T, ⌘K, ⌘L, ⌘B and ⌘,. `npm run build-app` builds and installs it, and `scripts/setup.sh` asks before it does. Closing the window keeps the app running in the background, and it never stops a run or a chat.

This is phase 2a of the parent plan "Plans Mac app" (`.plans/20261122-151056-plans-mac-app-parent.md`). Phase 2b (notifications, Dock badge, keep-awake, reload after a restart, the update bar) builds on it.

## Context

- Parent plan sections: Goal; "Decisions taken by the owner (2026-11-22)"; Phases → 2a. Roadmap: `docs/roadmap.md` → Architecture (Page, Service) and Parent plans → Plans Mac app.
- Design reference: the page "Plans Mac app" (2026-11-22) in the local QA store. Its key table says: ⌘B Board, ⌘L "Focus the chat input", ⌘, Settings (all "App menu").
- Decisions taken for this plan (owner, 2026-11-25):
  - 1A — The app is plain AppKit + WebKit in Swift source files, compiled with `swiftc` by a Node script `apps/plans-mac/build.mjs` (no Xcode project, no SwiftPM, no SwiftUI).
  - 2A — Closing the window hides it; the app keeps running in the background, the Dock icon shows the window again, and only ⌘Q quits. The owner's words: "it must run in background and it should not kill any runs … like the web: when I close the browser it was up and running to the end." Runs and chats run under the server and the chat relay, so neither closing the window nor ⌘Q stops them.
- Choices made in this plan (no owner decision needed):
  - The app opens the dashboard URL that `scripts/setup-macos.sh` serves: `build.mjs` reads the domain from `~/.claude/pipeline-dashboard/caddy-site.caddy` (the same file that `scripts/setup.sh` reads back with `sed`), else `https://plans.test`. `--url` overrides it. Only an `https:` URL is accepted (the Caddy site is always HTTPS; plain `http:` would also need an App Transport Security exception): `--url http://…` or a URL that `new URL()` cannot read exits 1, and an unreadable Caddy file falls back to `https://plans.test`.
  - Links: a main-frame load stays in the window only when its origin (scheme, host and port) is the app's origin; every other link (another origin — also the QA reports server on its own port, which `apps/dashboard/server.mjs` serves on a separate origin on purpose —, `target="_blank"`, `window.open`, a non-web scheme such as `vscode:`, a main-frame file the web view cannot show) opens in the default browser or app. The app's own pages (`about:`, `data:`, `blob:`) stay in the window. The menu hooks run only while the web view shows the app's origin.
  - The page's `alert()` and `confirm()` calls (`grep -c "confirm(" apps/dashboard/page/app.js` → 11) show as native panels. WKWebView without a UI delegate answers `confirm()` with false and shows nothing, so without this the page's confirm steps would fail silently.
  - When the dashboard does not load (a connection error or a certificate error, in `NSURLErrorDomain`, not a cancelled load, -999; or a 502 / 503 / 504 from Caddy while the dashboard service is down), the window shows a short "Waiting for the dashboard…" page and loads the same URL again after 5 s (a failed plan link comes back to that plan). One retry timer only: a new failure replaces it, a successful load and app quit cancel it. A certificate error shows the hint "run `caddy trust` (scripts/setup-macos.sh does it)". (2b adds the reload after a server restart while the page is open.)
  - A hidden window keeps the page's timers at full speed (`inactiveSchedulingPolicy = .none`, macOS 14 and later), so the 5 s `/api/state` poll and the 🔔 sound keep working while the window is closed. On macOS 13 WebKit can slow them, as a background browser tab does (a known limit in the docs).
  - The browser keeps its current keys. Board, Settings and the chat box already work there by click and through the palette (Board, Settings, Chat on/off rows in `PALETTE_ACTIONS`), so the parent rule "the web dashboard stays complete on its own" holds without new browser keys.
- Open decisions this plan does not take: the two phase 2b decisions in the parent plan (how the app sees new shell code; which events notify), and phase 3 (the ⌘N sheet).

## Hard rules

- **Restart after dashboard changes.** The plan changes `apps/dashboard/page/app.js` (three new `window.dashboard` hooks). The run is in a worktree and does not restart; its report lists under Open items: "after merge and `git pull`: run `pgrep -fl chat-relay.mjs`; only when it shows that the live chats run under the relay, run `npm run restart`, then reload plans.test". The tests start their own server, as today.
- **No npm dependencies.** `build.mjs` uses only Node built-ins (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:url`). The Swift code imports only the system frameworks `AppKit` and `WebKit`. `package.json` gets one script line and no dependency.
- **Public repo: no private data.** No domain, path or name is written into the source: the URL comes from the local Caddy file at build time. The bundle id is the generic `com.plans-dashboard.mac`, next to the existing launchd label `com.plans-dashboard`. Tests use `https://plans.test` and `https://dash.example.test`.
- **Global rules affect every project.** Not touched: no change to the root `CLAUDE.md` or `skills/`.
- **Never stop processes by name.** `build.mjs` never stops the running app; it prints "Quit Plans (⌘Q) and open it again to use the new build." (macOS keeps running the old binary until then). The tests never start the app. `setup.sh` does not stop anything.
- **Tests for logic changes.** `build.mjs` exports its pure helpers (`siteUrl`, `appUrl`, `infoPlist`, `installApp`) and is tested in `apps/plans-mac/test/build.test.mjs`, which `npm test` finds through its `apps/*/test/*.test.mjs` glob (`package.json` → `scripts.test`). A test compiles the real Swift code into a temp folder on macOS, and a contract test checks that every hook the Swift menu calls exists in the page's `window.dashboard`. The new page hooks are checked in `apps/dashboard/test/dashboard.test.mjs`. The new `setup.sh` block is run by itself in `test/setup-paths.test.mjs` with a fake `build.mjs`, as `runPart()` there runs parts of `setup-macos.sh`.
- **Docs: current state only.** `docs/plans-dashboard.md` gets a "Mac app" section in the present tense; `apps/plans-mac/AGENTS.md` holds the folder rules; the parent plan and the roadmap only mark 2a as built.

## Contracts

The project has no shared contract source. The one interface across a boundary is the page hook object `window.dashboard` in `apps/dashboard/page/app.js`, which the Swift app calls through `evaluateJavaScript`:

- Existing, unchanged: `switchSession(n)`, `nextSession(d)`, `closeSession()`, `reopenSession()`, `openSearch()`.
- Added: `focusChat()` (⌘L), `toggleBoard()` (⌘B), `openSettings()` (⌘,).

The contract test in `apps/plans-mac/test/build.test.mjs` keeps the two sides in step.

## Reference implementation

- Closest existing patterns:
  - A Node command with exported pure helpers and an `IS_MAIN` guard, tested with `node --test` and `spawnSync`: `apps/dashboard/restart.mjs` + `apps/dashboard/test/restart.test.mjs`.
  - The page hooks and their gates: the `tabHook` / `searchHook` / `window.dashboard = {` lines in `apps/dashboard/page/app.js`, and the test "the page has the tab strip, the palette and the window.dashboard hooks" in `apps/dashboard/test/dashboard.test.mjs`.
  - An optional part that setup asks for: the scout question in `scripts/setup.sh` (`Run the scout every day at 07:00 … [Y/n]`).
  - Reading the served domain: the `sed -n 's/^\([^ {]*\) {.*/https:\/\/\1/p'` line on `caddy-site.caddy` in `scripts/setup.sh`.
  - Running one part of a setup script in a test: `runPart()` in `test/setup-paths.test.mjs`.
- Files read end to end: `apps/dashboard/restart.mjs` (helpers and `IS_MAIN`), `apps/dashboard/test/restart.test.mjs`, `scripts/setup.sh`, `scripts/caddy/plans.caddy.template`, `package.json`; in `apps/dashboard/page/app.js`: `toggleChat()`, `hasChat`, `openSettings()` (start), `openBoard()`, `leaveBoard()`, the `boardBtn` click handler, `PALETTE_ACTIONS`, `paletteOpen`, `openSearch()`, `keysOwned`, the global keydown handler, `tabHook`, `searchHook`, `window.dashboard`, `alertUser()` (the `'Notification' in window` guard), `openRunLink()` (`window.open`); in `apps/dashboard/test/dashboard.test.mjs`: the hooks test.
- Mirror:
  - `restart.mjs` → `plistScript()` / `plistPort()` / `IS_MAIN` → `build.mjs` → `siteUrl()` / `infoPlist()` / `IS_MAIN`.
  - `restart.test.mjs` (pure helper tests + one `spawnSync` run, `skip: process.platform !== 'darwin'`) → `build.test.mjs` (the same shape).
  - `tabHook(switchSession)` → `tabHook(focusChat)`, `tabHook(toggleBoard)`, `tabHook(() => openSettings())` (nothing while an overlay owns the keys or the palette is open).
  - The palette row `{ id: 'chat', run: () => toggleChat(), when: () => hasChat(find(selected)) }` → `focusChat()` = `if (hasChat(find(selected))) toggleChat(true);` (`toggleChat(true)` opens the chat and focuses `#cin`).
  - The palette row `{ id: 'board', run: () => byId('boardBtn').click() }` → `toggleBoard()` = `byId('boardBtn').click()`.
  - The scout question in `setup.sh` → the Mac app question.
- Deviations:
  - The Swift code has no unit test framework (no XCTest without Xcode). Its logic is kept small; the test compiles it, the contract test checks its hook names, and the owner checks the behavior in the app (see **Browser test** → app check).
  - `build.mjs` installs through a staged copy (`installApp()`, step 6): it copies the new app next to the old one, swaps them with `renameSync`, and puts the old one back when a step fails. It does not stop the running app (hard rule "Never stop processes by name").
  - `setup.sh` block test: `runPart()` in `test/setup-paths.test.mjs` reads `scripts/setup-macos.sh` only. The new test gets a twin `runSetupPart()` for `scripts/setup.sh`, the same code with the file name as an argument would change the existing calls, so the twin is the smaller change.

## Affected files

- `apps/plans-mac/src/main.swift` — new: the app (AppKit + WebKit).
- `apps/plans-mac/build.mjs` — new: build, sign and install the app; exports `siteUrl()`, `appUrl()`, `infoPlist()` and `installApp()`.
- `test/setup-paths.test.mjs` — modified: `runSetupPart()` and the tests of the Mac app block in `scripts/setup.sh`.
- `apps/plans-mac/test/build.test.mjs` — new: the tests of `build.mjs`, the compile test, the hook contract test.
- `apps/plans-mac/AGENTS.md` — new: the folder rules.
- `apps/plans-mac/CLAUDE.md` — new: one line `@AGENTS.md`.
- `apps/dashboard/page/app.js` — modified: `focusChat()`, `toggleBoard()`, and three entries in `window.dashboard`.
- `apps/dashboard/test/dashboard.test.mjs` — modified: the hooks test checks the three new hooks and their gate.
- `package.json` — modified: `"build-app": "node apps/plans-mac/build.mjs"`.
- `scripts/setup.sh` — modified: the Mac app question in the dashboard part; the header comment lists it.
- `AGENTS.md` — modified: Layout row for `apps/plans-mac/` (it names its `AGENTS.md`), Commands row "Build and install the Mac app | `npm run build-app`".
- `.claude/settings.json` — modified **(owner, by hand)**: `"Bash(npm run build-app*)"` in `permissions.allow`.
- `docs/plans-dashboard.md` — modified: a "Mac app" section after "Tabs and keyboard shortcuts"; the hook sentence in "Tabs and keyboard shortcuts" lists the three new hooks.
- `.plans/20261122-151056-plans-mac-app-parent.md` — modified: 2a marked as built.
- `docs/roadmap.md` — modified: the Plans Mac app line says 2a is built; a "Mac app" line in Architecture.
- `changelog.d/<entry>.yaml` — new: the release note, written by `/changelog-entry`.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `focusChat`, `toggleBoard`, `openSettings` hooks | `apps/dashboard/page/app.js` | the global `window.dashboard` | `apps/plans-mac/src/main.swift` through `evaluateJavaScript("window.dashboard && window.dashboard.<name>(…)")` | the `window.dashboard = {` object; `app.js` is inlined into the page by the server, as today |
| `siteUrl`, `appUrl`, `infoPlist`, `installApp` | `apps/plans-mac/build.mjs` | ES module exports | `apps/plans-mac/test/build.test.mjs` | none |
| `AppDelegate` as window, navigation and UI delegate | `apps/plans-mac/src/main.swift` | — | AppKit and WebKit, at run time | a top-level `let delegate = AppDelegate()` (`NSApplication.delegate` is weak); `app.delegate = delegate`, `window.delegate = delegate`, `web.navigationDelegate = delegate`, `web.uiDelegate = delegate` (step 3). Without these the code compiles, but close-to-hide, the panels and the link rule do nothing. |
| `npm run build-app` | `package.json` → `scripts` | — | `scripts/setup.sh`, the owner | `AGENTS.md` → Commands; `.claude/settings.json` → `permissions.allow` (owner, by hand) |
| `apps/plans-mac/test/*.test.mjs` | — | — | `npm test` | the existing glob `apps/*/test/*.test.mjs` in `package.json` (no change) |
| `apps/plans-mac/AGENTS.md` | — | — | agents in that folder | a Layout row in the root `AGENTS.md` that names it |

No new server route, endpoint or module wiring.

## Breaking changes

None. The five existing hooks keep their names and gates (the existing test checks them). No server, URL or `localStorage` key changes. `setup.sh` gets one more question only on macOS; `--yes` builds the app when `swiftc` exists and skips it with a note when it does not.

## Steps

1. `apps/dashboard/page/app.js`, next to `tabHook` / `searchHook`: add `/** Opens the chat of the open plan and puts the cursor in its message box. Does nothing when the plan has no chat. */ function focusChat() { if (hasChat(find(selected))) toggleChat(true); }` and `/** Opens the board, or closes it when it is open. */ function toggleBoard() { byId('boardBtn').click(); }`. Add to the `window.dashboard = {` object: `focusChat: tabHook(focusChat), toggleBoard: tabHook(toggleBoard), openSettings: tabHook(() => openSettings())`. Update the comment above it ("the hooks the Mac app calls from its menu shortcuts").
2. `apps/dashboard/test/dashboard.test.mjs`, test "the page has the tab strip, the palette and the window.dashboard hooks": add the three pairs `['focusChat', 'tabHook(focusChat)']`, `['toggleBoard', 'tabHook(toggleBoard)']`, `['openSettings', 'tabHook(() => openSettings())']` to the loop, and assert the two function bodies (`if (hasChat(find(selected))) toggleChat(true);` and `byId('boardBtn').click();`). Run `node --test apps/dashboard/test/dashboard.test.mjs`.
3. `apps/plans-mac/src/main.swift` — the app delegate and window:
   - At the top level: `let app = NSApplication.shared`, `let delegate = AppDelegate()` (a top-level `let`, because `NSApplication.delegate` is weak), `app.delegate = delegate`, `app.setActivationPolicy(.regular)`, `app.run()`. `AppDelegate` conforms to `NSApplicationDelegate`, `NSWindowDelegate`, `WKNavigationDelegate` and `WKUIDelegate`.
   - The URL: `Bundle.main.object(forInfoDictionaryKey: "PlansURL") as? String`, else `"https://plans.test"`; keep its origin as `appOrigin` (`scheme`, `host` and `port` of the `URL`; a missing port counts as 443).
   - In `applicationDidFinishLaunching`: one `NSWindow` (titled, closable, miniaturizable, resizable; title "Plans"; `minSize` 800×500), `setFrameAutosaveName("PlansMain")` so its size and place are kept, `isReleasedWhenClosed = false`, `window.delegate = self`.
   - One `WKWebView` with `WKWebViewConfiguration()` (its default `websiteDataStore` is the persistent one, so `localStorage` — `dash-tabs`, the settings — survives a quit). On macOS 14 and later (`if #available(macOS 14.0, *)`) set `config.preferences.inactiveSchedulingPolicy = .none` on the configuration before the web view is made, so a hidden window does not slow the page's timers. Then `WKWebView(frame:configuration:)`, `web.navigationDelegate = self`, `web.uiDelegate = self`. It is the window's `contentView` and loads the URL.
   - 2A: `windowShouldClose` → `window.orderOut(nil)`, return `false` (the page stays loaded in the background); `applicationShouldTerminateAfterLastWindowClosed` → `false`; `applicationShouldHandleReopen(_:hasVisibleWindows:)` → `window.deminiaturize(nil)` when `window.isMiniaturized`, then `window.makeKeyAndOrderFront(nil)`, return `true`. `applicationWillTerminate` stops the retry timer (step 5).
4. `apps/plans-mac/src/main.swift` — the menu bar (`NSApp.mainMenu`), each item with its key equivalent, calling `func call(_ js: String)`. `call` runs `web.evaluateJavaScript("window.dashboard && window.dashboard." + js, completionHandler: nil)` only when `web.url` has the app's origin (`sameOrigin(web.url)`, step 5); else it does nothing, so no other page gets the calls:
   - App menu "Plans": About Plans, Settings… ⌘, → `call("openSettings()")`, Hide Plans ⌘H, Hide Others ⌥⌘H, Quit Plans ⌘Q (`NSApp.terminate`).
   - Edit menu with the standard selectors so text boxes get the keys: Undo ⌘Z (`undo:`), Redo ⇧⌘Z (`redo:`), Cut ⌘X, Copy ⌘C, Paste ⌘V, Select All ⌘A (target `nil`, first responder).
   - View menu: Board ⌘B → `call("toggleBoard()")`, Command Palette ⌘K → `call("openSearch()")`, Chat Box ⌘L → `call("focusChat()")`, Reload ⌘R (as step 5 says).
   - Each menu item is one `NSMenuItem(title:action:keyEquivalent:)` line in the source (no loop for Tab 1 … Tab 8), so the key test can read it.
   - Tabs menu: Tab 1 … Tab 8 ⌘1–⌘8 → `call("switchSession(N)")`, Last Tab ⌘9 → `call("switchSession(9)")`, Previous Tab ⇧⌘[ (key equivalent `"{"`, Shift is implied) → `call("nextSession(-1)")`, Next Tab ⇧⌘] (key equivalent `"}"`) → `call("nextSession(1)")`, Close Tab ⌘W → `call("closeSession()")`, Reopen Closed Tab ⇧⌘T → `call("reopenSession()")`.
   - Window menu: Minimize ⌘M, Close Window ⇧⌘W (`performClose:`, so it hides as in step 3), and `NSApp.windowsMenu`.
5. `apps/plans-mac/src/main.swift` — links and panels (`WKNavigationDelegate`, `WKUIDelegate`):
   - `func sameOrigin(_ url: URL?) -> Bool`: true when the scheme, host and port (443 when missing for `https`) equal `appOrigin`.
   - `decidePolicyFor navigationAction`: the schemes `about`, `data` and `blob` → `.allow` (the app's own waiting page, and page parts). Another scheme that is not `http`/`https` (`vscode:`, `mailto:`) → `NSWorkspace.shared.open(url)` and `.cancel`. A main-frame action (`targetFrame?.isMainFrame == true`) whose URL is not `sameOrigin` → `NSWorkspace.shared.open(url)` and `.cancel`. Else `.allow`.
   - `createWebViewWith` (`target="_blank"`, `window.open`): `NSWorkspace.shared.open(url)` when the URL is set, return `nil`.
   - `decidePolicyFor navigationResponse`: only for the main frame (`isForMainFrame`) and `!canShowMIMEType` (a download): open the response URL in the default browser and `.cancel`. Else `.allow`.
   - `runJavaScriptAlertPanelWithMessage` and `runJavaScriptConfirmPanelWithMessage`: an `NSAlert` sheet on the window (OK; OK + Cancel), with the answer passed to the completion handler.
   - `func showWaiting(for url: URL, certificate: Bool)`: sets `retryURL = sameOrigin(url) ? url : appURL` (so a failed plan link comes back to the same plan), `loadHTMLString(<page>, baseURL: nil)` with a short page "Waiting for the dashboard at `https://plans.test`…" (the app's URL, HTML-escaped; light and dark through `prefers-color-scheme`), plus "Run `caddy trust` (scripts/setup-macos.sh does it)" when `certificate` is true. One `retry: Timer?`: `retry?.invalidate()`, then a new 5 s one-shot timer that loads `retryURL`.
   - Two ways the dashboard is "not there", both call `showWaiting`:
     - `didFailProvisionalNavigation` (and `didFail`) for the main frame: only when the error is in `NSURLErrorDomain` and is not `NSURLErrorCancelled` (-999) — so a cancelled load and WebKit's "frame load interrupted" (`WebKitErrorDomain` 102, after a `.cancel`) never replace the page. The failed URL is `error.userInfo[NSURLErrorFailingURLErrorKey]`, else `appURL`. `certificate` is true for the codes -1206 … -1200 (`NSURLErrorClientCertificateRequired` … `NSURLErrorSecureConnectionFailed`).
     - Caddy runs as its own service and answers 502 / 503 / 504 while the dashboard service is down or restarts (`reverse_proxy` in `scripts/caddy/plans.caddy.template`): in `decidePolicyFor navigationResponse`, a main-frame `sameOrigin` `HTTPURLResponse` with `statusCode` 502, 503 or 504 → `.cancel`, then `showWaiting(for: response.url, certificate: false)`.
   - `didFinish` with a `sameOrigin` URL calls `retry?.invalidate(); retry = nil`.
   - View → Reload (⌘R, step 4): `web.reload()` when `sameOrigin(web.url)`; else (the waiting page) `web.load(URLRequest(url: retryURL ?? appURL))`.
6. `apps/plans-mac/build.mjs`, top of the file: a usage comment (`npm run build-app`, `node apps/plans-mac/build.mjs [--url <url>] [--out <dir>] [--no-install]`), then the exported pure helpers with doc comments:
   - `siteUrl(caddyText)` → `'https://' + <first site name>` from the first line that matches `/^([^ {#]+) \{/m`, else `null` (the `setup.sh` `sed` pattern, plus it skips `#` comment lines), with no trailing `/`.
   - `appUrl({ flag, caddyText })` → the URL the app opens, as a string exactly as given (no `new URL().href` normalizing, so no `/` is added): `flag` (the `--url` value) when set, else `siteUrl(caddyText)`, else `https://plans.test`. It throws `Error('--url must be an https:// URL')` when the result is not an `https:` URL that `new URL()` reads.
   - `installApp(built, dest, { rename = renameSync } = {})` → copies the built app into place with a staged swap (`rename` is a parameter only so the test can make one rename fail):
     1. `mkdirSync(dirname(dest), { recursive: true })` (a new account has no `~/Applications`).
     2. A stopped install can leave `dest + '.new'` and `dest + '.old'`. First, when `dest` is missing but `.old` exists, `.old` is the last working app: `rename(dest + '.old', dest)`. Then `rmSync` a stale `.new` and a stale `.old` (`{ recursive: true, force: true }`).
     3. `cpSync(built, dest + '.new', { recursive: true, verbatimSymlinks: true })`. A failure here leaves `dest` as it was.
     4. When `dest` exists, `rename(dest, dest + '.old')`. A failure here leaves `dest` as it was.
     5. `rename(dest + '.new', dest)`. When this throws, `dest` does not exist, so it renames `.old` back to `dest` and throws again: the old app works.
     6. `rmSync(dest + '.old', …)` in try/catch: the new app is in place, so a failure here only prints a warning, and step 2 of the next install removes it.
     It returns `{ path: dest }`. `stdio` of the `execFileSync` calls: `'ignore'` for the `--check` probe, `'inherit'` for `swiftc` and `codesign`, so a compile error is readable.
   - `infoPlist({ url, version })` → the `Info.plist` XML: `CFBundleIdentifier` `com.plans-dashboard.mac`, `CFBundleName` and `CFBundleExecutable` `Plans`, `CFBundlePackageType` `APPL`, `CFBundleShortVersionString` `version`, `LSMinimumSystemVersion` `13.0`, `NSHighResolutionCapable` true, `PlansURL` `url`. Each value is XML-escaped (`&`, `<`, `>`, `"`).
7. `apps/plans-mac/build.mjs`, the command under `IS_MAIN` (the same `realpathSync` check as `restart.mjs`):
   - Exit 1 with "The Plans app builds only on macOS." when `process.platform !== 'darwin'`.
   - `--check`: exit 0 when the Swift compiler is usable, else exit 1 with the hint. Usable means `execFileSync('xcrun', ['--find', 'swiftc'])` succeeds (`/usr/bin/swiftc` is a shim that is always there and opens an install dialog when the Command Line Tools are missing, so `command -v swiftc` proves nothing). `setup.sh` and the compile test use this check.
   - The URL: `appUrl({ flag: <--url>, caddyText: <~/.claude/pipeline-dashboard/caddy-site.caddy, read in try/catch, '' when missing or unreadable> })`; its error exits 1 with the message.
   - The same compiler check as `--check`; when it fails, exit 1 with "swiftc not found. Install the Command Line Tools: xcode-select --install".
   - Make `<out>/Plans.app/Contents/MacOS` (`--out`, else a new `mkdtempSync` folder in `os.tmpdir()`), write `Contents/Info.plist` (`version` from `package.json` → `version` when set, else `1.0`).
   - `execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', process.arch === 'arm64' ? 'arm64-apple-macos13.0' : 'x86_64-apple-macos13.0', '-o', <out>/Plans.app/Contents/MacOS/Plans, ...all .swift files in apps/plans-mac/src/])` (Swift 5 language mode, so the Swift 6 strict concurrency checks of the installed compiler do not apply; the target matches `LSMinimumSystemVersion`).
   - `execFileSync('codesign', ['--force', '--sign', '-', <out>/Plans.app])` (ad hoc).
   - Without `--no-install`: `installApp(<out>/Plans.app, ~/Applications/Plans.app)`, then print the path, the URL and "Quit Plans (⌘Q) and open it again to use the new build." With `--no-install`: print the built path.
8. `package.json` → `scripts`: add `"build-app": "node apps/plans-mac/build.mjs"`.
9. `apps/plans-mac/test/build.test.mjs`: the tests in **Tests**. Run `node --test apps/plans-mac/test/build.test.mjs`.
10. `scripts/setup.sh`, dashboard part, after the scout block and before the final `Done.` line (that part runs only on Darwin), one block between the comment lines `# --- Mac app ---` and `# --- end Mac app ---`: `APP=""`; when `node "$REPO/apps/plans-mac/build.mjs" --check` exits 0, ask `Build and install the Plans Mac app (~/Applications/Plans.app)? [Y/n]` (`--yes` answers yes, as the scout question does); on yes run `if node "$REPO/apps/plans-mac/build.mjs"; then APP="$HOME/Applications/Plans.app"; else printf 'Mac app: the build failed; setup goes on. Run npm run build-app to try again.\n'; fi` (an `if` keeps `set -euo pipefail` from stopping setup); when the check fails, print `Mac app: skipped (no Swift compiler; xcode-select --install, then npm run build-app).`. After the block, the existing `printf '\nDone. Opening %s — the guide there helps you add your repos.\n' "$url"` line passes `"${APP:-$url}"`, and the `open "$url" 2>/dev/null || true` line becomes `open "${APP:-$url}" 2>/dev/null || true`. The block is indented two spaces inside `if [ "${PICKED[1]}" = 1 ]`, as its neighbours are. Add the app to the header comment's Parts list under part 2. Then add `runSetupPart()` and the setup tests from **Tests** to `test/setup-paths.test.mjs`, and run `node --test test/setup-paths.test.mjs`.
11. `apps/plans-mac/AGENTS.md` + `apps/plans-mac/CLAUDE.md` (`@AGENTS.md`): the rules of the folder: AppKit + WebKit only (no SwiftUI, no packages); build only with `npm run build-app`; the app calls the page only through `window.dashboard` hooks, and a new hook needs a page entry and the contract test; links to other origins open in the default browser, and the menu calls go only to the app's origin; closing the window hides it and never stops runs; the app never stops processes.
12. Root `AGENTS.md`: a Layout row `| apps/plans-mac/ | The Plans Mac app (Swift shell around the page); rules in apps/plans-mac/AGENTS.md |`, and a Commands row `| Build and install the Mac app | npm run build-app |`.
13. `docs/plans-dashboard.md`: a "## Mac app" section after "## Tabs and keyboard shortcuts": what it is; `npm run build-app` (and that `setup.sh` asks); it opens the domain of the installed dashboard; the key table (⌘1–8, ⌘9, ⇧⌘[ / ⇧⌘], ⌘W, ⇧⌘T, ⌘K, ⌘L, ⌘B, ⌘,, ⌘R, ⇧⌘W, ⌘Q); closing the window keeps the app running and never stops runs or chats, the Dock icon opens it again, ⌘Q quits; links to other sites open in the default browser; the app shows no notifications of its own (the page's 🔔 sound rings, and the server's notifications come). Known limits: the app and a browser tab keep separate storage (tabs, settings, 🔔), so with both open the sound can ring twice; while the Files changed diff editor has the focus, it can take ⌘K, ⌘L and ⌘B before the menu; on macOS 13 a hidden window can slow the page's timers (as a background browser tab does), so the 🔔 sound can be late; ⇧⌘W hides the window, as the red button does. In "Tabs and keyboard shortcuts", the hook sentence lists `focusChat()`, `toggleBoard()` and `openSettings()` too.
14. `.plans/20261122-151056-plans-mac-app-parent.md` → Phases → 2a: change "— planning now." to "— built.". `docs/roadmap.md` → Plans Mac app line: "2a (the app shell) is built"; Architecture: a line after **Service**: "**Mac app:** `apps/plans-mac/` (`npm run build-app`) is an optional AppKit + WKWebView window around the page, with the ⌘ menu keys; it calls the page only through `window.dashboard`."
15. `.claude/settings.json` **(owner, by hand)**: add `"Bash(npm run build-app*)"` to `permissions.allow`. The run report lists it under Open items.
16. Run `/changelog-entry` for the release note in `changelog.d/`.

## Tests

### Unit tests

In `apps/plans-mac/test/build.test.mjs` (`node:test`, `assert/strict`, the same shape as `restart.test.mjs`):

- `siteUrl`: `'plans.test {\n\ttls internal\n}'` gives `https://plans.test`; `'dash.example.test {\n}'` gives `https://dash.example.test`; a leading `# comment` line is skipped; `''` and `'nothing here'` give `null`.
- `infoPlist({ url: 'https://dash.example.test/?a=1&b=2', version: '1.0' })`: has `<key>PlansURL</key>` followed by `<string>https://dash.example.test/?a=1&amp;b=2</string>`, `<key>CFBundleIdentifier</key>` + `com.plans-dashboard.mac`, `<key>CFBundleExecutable</key>` + `Plans`, `<key>CFBundlePackageType</key>` + `APPL`, and no raw `&b=`.
- Hook contract: read `apps/plans-mac/src/main.swift`, collect every name in `call("<name>(`; read `apps/dashboard/page/app.js`, cut the `window.dashboard = { … };` object; every Swift name is a key of it, and the Swift list has all eight names (`switchSession`, `nextSession`, `closeSession`, `reopenSession`, `openSearch`, `focusChat`, `toggleBoard`, `openSettings`). Fails when the Swift menu calls a hook the page does not have, or when a menu item is missing.
- Key equivalents: `main.swift` binds each key of the parent plan's list to its hook (a table in the test: `"1"`…`"8"` → `switchSession(1…8)`, `"9"` → `switchSession(9)`, `"{"` → `nextSession(-1)`, `"}"` → `nextSession(1)`, `"w"` → `closeSession()`, `"T"` → `reopenSession()`, `"k"` → `openSearch()`, `"l"` → `focusChat()`, `"b"` → `toggleBoard()`, `","` → `openSettings()`), checked by a regex over the item lines. Fails when a key is missing or bound to the wrong hook.
- 2A and the delegate wiring in the source: `main.swift` has a top-level `let delegate = AppDelegate()` and `app.delegate = delegate`, and sets `window.delegate`, `web.navigationDelegate` and `web.uiDelegate`; `applicationShouldTerminateAfterLastWindowClosed` returns `false`; `windowShouldClose` calls `orderOut` and returns `false`. Fails when the app quits or closes the page on a window close, or when a delegate is not set (the code would compile, and the behavior would silently be gone).
- Origin rule in the source: `call(` checks `sameOrigin(web.url)`; `sameOrigin` compares scheme, host and port; the navigation handler allows `about`, `data` and `blob`. Fails when the menu calls go to any loaded page, or when the waiting page is sent to the browser.
- Waiting page rule in the source: the failure handler skips `NSURLErrorCancelled`; `showWaiting` calls `retry?.invalidate()` before it makes a timer and keeps a `sameOrigin` failed URL as `retryURL`; the response handler sends 502, 503 and 504 to `showWaiting`; `didFinish` invalidates the timer. Fails when a Caddy 502 leaves a blank window, or when the retry goes to the root after a failed plan link.
- `appUrl`: `{ flag: 'https://dash.example.test:8443' }` gives exactly `'https://dash.example.test:8443'` (no `/` added); `{ caddyText: 'dash.example.test {\n}' }` gives `https://dash.example.test`; `{ caddyText: '' }` gives `https://plans.test`; `{ flag: 'http://plans.test' }` and `{ flag: 'not a url' }` throw `--url must be an https:// URL`.
- `installApp` (temp folders, a fake `.app` folder with a file and a relative symlink): into a missing parent folder → the parent is made and the copy has the file and the symlink (as a link); over an existing app → the new file is there, the old file is gone, and no `.new` or `.old` folder is left; when the source does not exist → it throws and the old app is still in place with its file; with a `rename` that throws on its second call (the `.new` → `dest` swap) → it throws, and `dest` is the old app with its file again (fails when the restore code is missing); with a stale `dest + '.old'` and `dest + '.new'` from a stopped install → the install works and neither is left; with no `dest` but a stale `.old` (an install stopped between the two renames) and a source that does not exist → it throws, and `dest` is the old app from `.old`.
- Compile and sign (`skip` unless `process.platform === 'darwin'` and `node build.mjs --check` exits 0): `spawnSync(process.execPath, [build.mjs, '--out', <tmp>, '--no-install', '--url', 'https://plans.test'], { env: { ...process.env, HOME: <throwaway> } })` exits 0; `<tmp>/Plans.app/Contents/MacOS/Plans` exists and is executable; `Contents/Info.plist` has `https://plans.test`; `codesign --verify <tmp>/Plans.app` exits 0; `<throwaway>/Applications/Plans.app` does not exist (`--no-install`). The temp folders are removed after. Fails when the Swift code does not compile. On this Mac the compiler is there (`xcrun --find swiftc` → the Xcode toolchain path), so the run report must show this test as passed, not skipped; a skip is an Open item.
- `--url http://plans.test` exits 1 with `--url must be an https:// URL` (macOS only, before any compile).
- Not on macOS (`skip` when `process.platform === 'darwin'`): the command exits 1 with "builds only on macOS".

In `apps/dashboard/test/dashboard.test.mjs`: the hooks test (step 2) checks the three new entries with `tabHook`, and the bodies of `focusChat()` and `toggleBoard()`.

In `test/setup-paths.test.mjs`: a twin of `runPart()`, `runSetupPart(from, to, env, stdin)`, finds the marker lines with `l.trim().startsWith(…)` (the block is indented) and runs the `# --- Mac app ---` … `# --- end Mac app ---` lines of `scripts/setup.sh` in `bash -euo pipefail` with `REPO` set to a temp folder that holds a fake `apps/plans-mac/build.mjs` (it writes its arguments to a file and exits with `FAKE_CHECK` for `--check`, else `FAKE_BUILD`), then prints `APP=$APP`:

- `YES=1`, check 0, build 0 → the build ran with no arguments, and `APP=` is `$HOME/Applications/Plans.app`.
- `YES=0`, stdin `n` → only `--check` ran, and `APP=` is empty.
- check 1 → the build did not run, the output has `Mac app: skipped`, the exit code is 0.
- `YES=1`, check 0, build 1 → the output has `the build failed; setup goes on`, the exit code is 0, `APP=` is empty.
- `scripts/setup.sh` has `open "${APP:-$url}" 2>/dev/null || true` and the `Done. Opening %s` line with `"${APP:-$url}"`, and no longer has `open "$url" 2>/dev/null` (a text check, as the existing setup.sh test does).

### End-to-end tests

None: no endpoint changes.

### Harness constraints

`node --test` cannot start a GUI app, press ⌘ keys in it, or click a link in WKWebView. These go to the app check below (owner, by hand, after `npm run build-app`): the menu keys, the hidden window and the Dock reopen, links to the default browser, `confirm()` panels, and the waiting page. The page hooks are checked in the browser test by calling them.

### AI output

None.

## Browser test

- Routes: `/` with a plan open; `/?view=board`.
- Siblings: the five existing hooks (`switchSession`, `nextSession`, `closeSession`, `reopenSession`, `openSearch`) must still work after the edit to the hook object.
- Same in every place: None.
- Widths: 1440 px and 390 px with touch, for `/` (no layout change is expected; the check proves that).
- Account and data: no login. A test dashboard with a throwaway `HOME` (`DASH_PORT=4913 DASH_NO_OPEN=1 DASH_WATCH_MS=0 DASH_NO_SUMMARY=1 QA_REPORTS_PORT=4914`), one fake repo with two plans (`20260101-000000-alpha.md`, `20260101-000001-beta.md`). Stop it by its PID.
- What to compare (old code on a second test port from `origin/main` against the new code): 1) `window.dashboard.toggleBoard()` opens the board; a second call closes it (old: `toggleBoard` is undefined). 2) `window.dashboard.openSettings()` opens Settings. 3) With alpha open and no chat yet, `window.dashboard.focusChat()` does nothing (the fixture cannot make a chat safely, so the case with a chat is app check 2). 4) With the palette open (`openSearch()`), `toggleBoard()` does nothing. 5) `switchSession(2)` and `closeSession()` still work as before.
- App check (owner, by hand, after `npm run build-app`; listed under Open items): 1) Plans opens the dashboard at the served domain. 2) ⌘1, ⌘9, ⇧⌘[, ⇧⌘], ⌘W, ⇧⌘T, ⌘K, ⌘L (on a plan with a chat: the chat opens and the cursor is in its box), ⌘B, ⌘, each do what the key table says. 3) ⌘C / ⌘V work in the chat box. 4) A GitHub PR link and "QA reports ↗" open in the default browser; a plan link stays in the app. 5) "Compact this chat" (a `confirm()` in `app.js`) shows a native panel, and Cancel cancels. 6) Close the window while a run works: the Dock dot stays, the run keeps going; a Dock click shows the window at the same size and place with the same tabs. 7) ⌘Q, then open Plans again: the tabs are back (`dash-tabs`), and the run still works. 8) With the service stopped by the owner (`launchctl bootout gui/$(id -u)/com.plans-dashboard`, then `scripts/setup-macos.sh` or `launchctl bootstrap` to start it again), the app shows "Waiting for the dashboard…" and loads the page by itself when it comes back. 9) Minimize the window (⌘M), then click the Dock icon: the window comes back. 10) On macOS 14 or later: close the window for 1 minute while a run finishes with 🔔 on, and the sound rings (the page's timers keep running); on macOS 13 this is a known limit. 11) During `npm run restart` (Caddy answers 502), the app shows the waiting page and comes back on the same plan. The run report lists the app check with the macOS version and one result per item, as "not done yet" until the owner does it.

## How to verify

```bash
node --test apps/plans-mac/test/build.test.mjs
node --test apps/dashboard/test/dashboard.test.mjs
node --test test/setup-paths.test.mjs
npm test
grep -n "focusChat: tabHook(focusChat)" apps/dashboard/page/app.js
grep -n "\"build-app\"" package.json
node .claude/scripts/changelog-validate.mjs --base origin/main
```
