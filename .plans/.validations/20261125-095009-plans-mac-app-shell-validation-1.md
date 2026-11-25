**Validation round:** 1

## Plan validation: 20261125-095009-plans-mac-app-shell.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The plan's references to the repo are correct: hooks, gates, the test, `restart.mjs`, the `setup.sh` lines, `package.json`, the changelog command and the `.claude/` owner-only marker all check out. Four parts of the Swift and setup design would fail at run time. (1) The "waiting" page would be cancelled by the plan's own link rule. (2) A cancelled load would replace the dashboard with the waiting page. (3) `command -v swiftc` is always true on macOS. (4) The delegate wiring is not stated. Fix these before implementation.

### Blocking issues

1. [Edge case / WKWebView] The waiting page cannot show. Evidence: plan line 116 (`decidePolicyFor navigationAction`: a scheme that is not http/https -> `NSWorkspace.shared.open(url)` + `.cancel`) and line 120 (`didFailProvisionalNavigation` -> `loadHTMLString` ...). `loadHTMLString(_:baseURL: nil)` starts a main-frame navigation to `about:blank`, and that navigation goes through `decidePolicyFor navigationAction`. The rule on line 116 cancels it and sends `about:blank` to the default browser. So when the server is down, the owner gets a browser window and no waiting page, every 5 s. Fix: allow `about:`, `data:` and `blob:` URLs (or call `loadHTMLString` with `baseURL` = the app URL). Send a URL to the default browser only when it has another http(s) host or an external scheme such as `vscode:`/`mailto:`. Add a source test that the policy code allows `about:`.

2. [Edge case / WKWebView] `didFailProvisionalNavigation` also fires for loads that were cancelled on purpose. Evidence: plan line 118 (`navigationResponse` -> `.cancel` for a download) and line 120 (any provisional failure -> waiting page). A `.cancel` in `decidePolicyFor navigationResponse` ends in `didFailProvisionalNavigation` with WebKitErrorDomain 102 ("Frame load interrupted"). A navigation that a newer one replaces fails with NSURLErrorCancelled (-999). In both cases the plan replaces the working dashboard with "Waiting for the dashboard…". Fix: show the waiting page only for connection errors (NSURLErrorDomain: `cannotConnectToHost`, `cannotFindHost`, `timedOut`, `networkConnectionLost`, `notConnectedToInternet`, and the server-certificate errors). Ignore -999 and 102. Keep only one retry `Timer` (invalidate the old one before you schedule a new one).

3. [Edge case / setup] `command -v swiftc` does not prove that swiftc works. Evidence: plan line 133 (`when command -v swiftc finds it`) and line 97 (`--yes` "skips it with a note when it does not"). `scripts/setup.sh:14` is `set -euo pipefail`. On macOS, `/usr/bin/swiftc` is always there as an `xcrun` shim. Without the Command Line Tools, that shim opens the "install the command line developer tools" dialog and exits non-zero. So the "skipped" branch never runs. `build.mjs` exits 1 (its `ENOENT` branch on plan line 128 never happens), and `set -e` stops `setup.sh` before its `Done.` / `open` lines (`scripts/setup.sh:82-83`). Fix: test with `xcrun --find swiftc` (or `xcode-select -p`) in `setup.sh` and in `build.mjs`. Treat a non-zero status like ENOENT. Run the build as `node … || printf 'Mac app: build failed …\n'`, so a failed build does not stop setup. The compile test's skip check (plan line 152, "swiftc runs") must use the same probe, or `npm test` on a Mac without the Command Line Tools opens the install dialog.

4. [Wiring / Swift] The delegate wiring is not in the plan. The 2A behavior and the panels depend on it. Evidence: plan lines 103-108 and 115-120 name the delegate methods, but no step sets `window.delegate`, `web.navigationDelegate`, `web.uiDelegate` or `app.delegate`. `NSApplication.delegate` and `NSWindow.delegate` are weak, so the `AppDelegate` must be held by a top-level `let`. Without this wiring, the code still compiles and every test on lines 149-152 passes (they match text only). But the close button would close the window, `confirm()` would answer false with no dialog (plan line 22), and links would stay in the app. Fix: add these lines to step 3: `let delegate = AppDelegate()` (top level), `app.delegate = delegate`, `window.delegate = self`, `web.navigationDelegate = self`, `web.uiDelegate = self`. Extend the "2A in the source" test (line 151) so that it also checks those four assignments.

### Non-blocking concerns

5. [Swift / key equivalents] ⇧⌘[ and ⇧⌘] given as `"["`/`"]"` plus the Shift modifier (plan lines 113 and 150) do not match reliably. AppKit matches a key equivalent against `charactersIgnoringModifiers`, which still applies Shift, so on a US layout the key gives `{` / `}`. Safari and Terminal use `"{"` / `"}"` with `.command` only. Suggestion: use `"{"`/`"}"` with `[.command]`, `"T"` with `[.command]` for ⇧⌘T, and `"Z"` for Redo. Change the key table in the test to match.

6. [Node] `cpSync` of a folder needs `{ recursive: true }`, or it throws `ERR_FS_EISDIR`. Evidence: plan line 130 ("`cpSync` the new app there"). Write `cpSync(src, dest, { recursive: true, verbatimSymlinks: true })`, and call `mkdirSync(~/Applications, { recursive: true })` first, because `~/Applications` does not exist on every Mac. The bundle has no symlinks today, but `verbatimSymlinks` keeps a future framework bundle intact.

7. [Swift / build] `swiftc` gets no `-target`, so the binary's minimum OS is the toolchain default, not the `LSMinimumSystemVersion 13.0` in Info.plist (line 123). Also, a newer toolchain can use Swift 6 strict concurrency, and the `Timer` and delegate closures can then fail to compile. Suggestion: pass `-swift-version 5` and `-target <arch>-apple-macos13` (arch from `process.arch`: `arm64` or `x86_64`).

8. [Edge case / keys] The page sees ⌘ keys before the menu does: WKWebView sends a key equivalent to the page first, and a `preventDefault` there stops the menu item. Two effects follow. ⌘K already works through the page handler (`apps/dashboard/page/app.js:4375`). Monaco (CDN) takes ⌘K / ⌘L / ⌘B as its own shortcuts while it has the focus. The app check (line 178) should test ⌘L / ⌘B once with the focus in a Monaco editor, and `docs/plans-dashboard.md` should say what happens there.

9. [Edge case / hidden window] After `orderOut`, the page is hidden (`document.hidden` is true), and WebKit throttles its timers. The page changes its alert behavior when it is hidden (`app.js:4010`). This does not stop runs or chats, but the 5 s poll can slow down. State it in the docs section (step 13), or leave it to 2b on purpose and say so.

10. [Edge case / two clients] The app has its own `localStorage`, separate from the browser's. The tabs (`dash-tabs`) and the chat lock that tells other tabs to leave alerts to the tab with the open chat (`app.js:1079`) are not shared with a browser tab. With the app and a browser tab both open, both can ring for the same chat. Say this in the docs section.

11. [Scope] The waiting page with its 5 s retry (line 23), ⌘R, ⇧⌘W and the native alert/confirm panels are not in the parent's 2a list (`.plans/20261122-151056-plans-mac-app-parent.md:23`). The panels are needed (line 22 gives the reason). The startup retry overlaps 2b's "reload by itself after the server restarts" (parent line 24). The plan says this on line 23, which is acceptable. Keep the retry to app start only, as written.

12. [Docs] `docs/roadmap.md:14-22` (Architecture) gets no line for the Mac app. Add one bullet, for example "**Mac app:** `apps/plans-mac/`, a Swift shell that loads the served dashboard URL". Step 13 also says "no notifications yet", which hints at the future. Write "The app shows no notifications." in the present tense.

13. [Edge case / ATS] `--url http://127.0.0.1:4899` (line 6/121 allow any URL) can be blocked by App Transport Security in WKWebView. Either accept only https in `--url`, or add `NSAppTransportSecurity` → `NSAllowsLocalNetworking` to `infoPlist()` and test it.

14. [Tests] Browser test item 3 (line 177) says "after a chat exists in the fixture (or with `hasChat` true)". `hasChat` is a top-level `const` (`app.js:995`) that the console cannot replace. Say how the fixture gets a plan with `sessions` (or `asked`), or drop the "or" clause.

15. [Swift] `decidePolicyFor navigationResponse` (line 118) should act only when `navigationResponse.isForMainFrame`, so that a sub-resource does not open a browser tab.

### Edge cases the plan should address

- `about:blank` / `data:` / `blob:` navigations (the waiting page, Monaco workers): they must not go to the default browser.
- Cancelled loads (-999, WebKit 102) must not show the waiting page.
- A Mac without the Command Line Tools: the `/usr/bin/swiftc` shim, the install dialog, `set -e` in `setup.sh`, and the skip check of the compile test.
- `~/Applications` does not exist.
- A server certificate that the Mac does not trust (Caddy CA not trusted): the waiting page must give that reason, not wait forever.
- Two failures in a row must not leave two retry timers.
- A Dock click while the window is minimized: `makeKeyAndOrderFront` must restore it (call `deminiaturize` if needed).
- The app and a browser tab are open at the same time (separate storage, double alerts).

### Checked and correct

- `tabHook`, `searchHook`, `window.dashboard` (`app.js:4383-4388`), `hasChat` (`app.js:995`), `toggleChat(on)` with the `#cin` focus (`app.js:1057-1063`; `#cin` is created synchronously in `chatBind`, `app.js:1107`), `openSettings` (async, `app.js:3190`), `boardBtn` click handler (`app.js:4787`), `openBoard`/`leaveBoard` (`app.js:4429-4433`), `PALETTE_ACTIONS` rows board/settings/chat (`app.js:4270-4275`), `paletteOpen` (`app.js:4285`), `keysOwned` (`app.js:4367`), `switchSession(9)` = last tab (`app.js:4235-4239`), `openRunLink` `window.open` (`app.js:929`).
- `grep -c "confirm(" apps/dashboard/page/app.js` -> 11 (measured). No `prompt()` (0).
- The hooks test is at `apps/dashboard/test/dashboard.test.mjs:407-425`. Its regex `/window\.dashboard = \{([^}]*)\}/` still matches with the new entries, because `tabHook(() => openSettings())` has no `}`.
- `restart.mjs` `IS_MAIN` with `realpathSync` (`apps/dashboard/restart.mjs:34-36`); exported pure helpers `plistScript`/`plistPort`; `restart.test.mjs:30` uses `skip: process.platform !== 'darwin'`.
- `scripts/setup.sh`: the scout question is at line 77, the caddy `sed` at line 71, the header Parts list at lines 9-11; the dashboard part already runs only on Darwin (lines 33-36).
- `package.json` test glob `apps/*/test/*.test.mjs` picks up `apps/plans-mac/test/build.test.mjs`; no dependencies.
- `node .claude/scripts/changelog-validate.mjs --base origin/main` exists (`changelog-validate.mjs:150`) and is allowed in `.claude/settings.json:33`.
- The `.claude/settings.json` edit is marked owner-only (plan lines 77 and 138).
- The Restart hard rule is respected (line 29, as an Open item). No stop by name. No private data: generic bundle id, test domains `plans.test`/`dash.example.test`.
- `siteUrl` regex `/^([^ {#]+) \{/m` is slightly stricter than the `setup.sh` sed (it skips `#` lines). That is a justified, harmless difference from the "same pattern" claim.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done; only additions to `window.dashboard`)
- [ ] Wiring & registration matches the code (Swift delegate wiring missing, finding 4)
- [x] Scope stays inside the goal; no open decision is taken silently (finding 11 is minor)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope: not applicable (no endpoint)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected (the source tests should also cover findings 1, 2 and 4)
- [x] Docs: current state only respected (wording of step 13, finding 12)
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261125-095009-plans-mac-app-shell.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 5, allow about:, data: and blob: navigations (or load the waiting page with baseURL = the app URL). Send a URL to the default browser only for another http(s) host or an external scheme. Without this, loadHTMLString's about:blank is cancelled and opened in the browser. Add a source test for it. (evidence: plan lines 116, 120)
2. In step 5, show the waiting page only for connection and certificate errors (NSURLErrorDomain cannotConnectToHost, cannotFindHost, timedOut, networkConnectionLost, notConnectedToInternet, server-certificate errors). Ignore NSURLErrorCancelled (-999) and WebKitErrorDomain 102, which a navigationResponse .cancel causes. Keep a single retry Timer (invalidate the old one first). (evidence: plan lines 118, 120)
3. Replace `command -v swiftc` with `xcrun --find swiftc` (or `xcode-select -p`) in setup.sh, build.mjs and the compile test's skip check. Treat a non-zero status like ENOENT. Guard the build call in setup.sh with `|| printf ...`, so set -e does not stop setup before "Done.". (evidence: plan lines 97, 128, 133, 152; scripts/setup.sh:14, 82-83)
4. In step 3, add the delegate wiring: top-level `let delegate = AppDelegate()`, `app.delegate = delegate`, `window.delegate = self`, `web.navigationDelegate = self`, `web.uiDelegate = self`. Extend the "2A in the source" test to check them. (evidence: plan lines 103-108, 115-120, 151)

SHOULD FIX:
1. Use the key equivalents "{" / "}" with [.command] for previous/next tab, "T" with [.command] for reopen and "Z" for redo. Update the key table in the test. (evidence: plan lines 113, 150)
2. Write `mkdirSync(~/Applications, { recursive: true })`, then `cpSync(src, dest, { recursive: true, verbatimSymlinks: true })`. (evidence: plan line 130)
3. Pass `-swift-version 5` and `-target <arch>-apple-macos13` to swiftc. (evidence: plan lines 123, 128)
4. In decidePolicyFor navigationResponse, act only when isForMainFrame. (evidence: plan line 118)
5. Add a "Mac app" bullet to docs/roadmap.md Architecture, and write the "no notifications" sentence of step 13 in the present tense. (evidence: docs/roadmap.md:14-22; plan line 136)
6. Either accept only https URLs in --url, or add NSAppTransportSecurity/NSAllowsLocalNetworking to infoPlist() with a test. (evidence: plan lines 121-123)
7. In Browser test item 3, say how the fixture gives the plan a chat (sessions or asked), or drop "or with hasChat true" (hasChat is a const). (evidence: plan line 177; apps/dashboard/page/app.js:995)

ADD THESE EDGE CASES:
- ⌘L / ⌘B / ⌘K while a Monaco editor has the focus (the page sees the key first; a preventDefault there stops the menu item): add to the app check and the docs.
- Hidden window: the page is hidden and its timers are throttled. The docs say what this means for alerts.
- The app and a browser tab are open at the same time: separate localStorage, so the tabs and the chat lock are not shared.
- Server certificate not trusted: the waiting page names the reason.
- Dock click while the window is minimized: the window comes back (deminiaturize).

Do not change anything the validation did not flag.
```
