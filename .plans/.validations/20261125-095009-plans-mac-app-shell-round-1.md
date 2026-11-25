# Round 1 — 20261125-095009-plans-mac-app-shell.md

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES, report `20261125-095009-plans-mac-app-shell-validation-1.md`
- Codex (`validate-plan`): ON — NEEDS REWORK, report `20261125-095009-plans-mac-app-shell-codex-raw-1.md`
- Regressions from the previous round: none (round 1)

## Findings

| # | Finding | Raised by | Verdict | Evidence | Fix in the plan |
| --- | --- | --- | --- | --- | --- |
| 1 | The waiting page (`loadHTMLString`, `about:blank`) is cancelled by the "not http/https → browser" rule | Claude | VALID | WebKit loads `loadHTMLString(_, baseURL: nil)` as `about:blank`; plan step 5 sent every non-http scheme to `NSWorkspace` | Step 5: `about`, `data`, `blob` → `.allow`; Context links line |
| 2 | The waiting page and its retry fire on cancelled loads (-999, 102) and can replace a working page; no single owned timer | Claude + Codex | VALID | `didFailProvisionalNavigation` also reports cancellations; the download `.cancel` gives WebKit 102 | Step 5: only `NSURLErrorDomain` errors except -999; one `retry` timer, invalidated on a new failure, on `didFinish` and on quit (step 3); Context line; source test |
| 3 | `command -v swiftc` is always true (`/usr/bin/swiftc` shim); a failed build stops `setup.sh` under `set -euo pipefail` | Claude | VALID | `scripts/setup.sh` line `set -euo pipefail`; `xcrun --find swiftc` resolves the real toolchain on this Mac | Step 7 `--check` with `xcrun --find swiftc`; step 10 uses it and wraps the build in `if`; compile test skip uses `--check` |
| 4 | Delegate wiring missing: `window.delegate`, `navigationDelegate`, `uiDelegate`, a strong top-level delegate | Claude | VALID | `NSApplication.delegate` is weak; the plan never assigned the delegates | Step 3; Wiring row; source test |
| 5 | Navigation compares only the host; same host with another port or scheme loads in the app and gets the menu calls | Codex | VALID | `apps/dashboard/server.mjs` serves the QA reports on its own origin on purpose (comment near the QA server) | `sameOrigin()` (scheme, host, port) in step 5; `call()` runs only on the app's origin (step 4); source test; AGENTS.md rule (step 11) |
| 6 | Install deletes the old app before the copy; no safe swap | Codex | VALID | step 7 had `rmSync` then `cpSync` | New `installApp()` with `.new` / `.old` staged swap and restore; tests; deviation line |
| 7 | `setup.sh` control flow has no test (hard rule "Tests for logic changes") | Codex | VALID | `test/setup-paths.test.mjs` already runs parts of `setup-macos.sh` with `runPart()` | Marked block in step 10; `runSetupPart()` tests for yes / no / no compiler / failed build; Affected files; How to verify |
| 8 | The compile test can skip and still pass the checks | Codex | PARTIALLY VALID | A skip is right off macOS, but on this Mac the toolchain exists | The run report must show the compile test as passed, a skip is an Open item |
| 9 | ⇧⌘[ / ⇧⌘] key equivalents must be `"{"` / `"}"` | Claude | VALID | AppKit matches the shifted character | Step 4; key test table |
| 10 | `cpSync` of a bundle needs `recursive`, and `~/Applications` may be missing | Claude + Codex (edge case) | VALID | — | `installApp()`: `mkdirSync` parent, `cpSync(…, { recursive: true, verbatimSymlinks: true })` |
| 11 | Pass `-swift-version 5` and a macOS 13 target to `swiftc` | Claude | VALID | Installed compiler is Swift 6.4.2 (`swiftc --version`); `LSMinimumSystemVersion` 13.0 | Step 7 command |
| 12 | Handle a download only for the main frame | Claude | VALID | — | Step 5 `isForMainFrame` |
| 13 | Roadmap Architecture has no Mac app line; "no notifications yet" is change-history wording | Claude | VALID | `docs/roadmap.md` → Architecture; AGENTS.md "Docs: current state only" | Step 14 Architecture line; step 13 wording |
| 14 | `--url` with `http:` needs an ATS exception, or accept only https | Claude + Codex (invalid `--url` edge case) | VALID | The Caddy site is always HTTPS (`scripts/caddy/plans.caddy.template`, `tls internal`) | `appUrl()` accepts only `https:`; unreadable Caddy file falls back; tests |
| 15 | Browser test item 3 cannot set `hasChat` (a `const`) | Claude | VALID | `const hasChat =` in `app.js` | Item 3 checks only the no-chat case; the chat case moves to app check 2 |
| 16 | Edge cases: Monaco takes ⌘K/⌘L/⌘B; hidden window slows timers; separate storage rings twice; untrusted certificate; reopen a minimized window | Claude | VALID | — | Known limits in step 13; `inactiveSchedulingPolicy = .none` (step 3, macOS 14+); certificate hint (step 5); `deminiaturize` (step 3); app checks 9–10 |
| 17 | The QA design page and real WKWebView behavior were not checked by Codex | Codex | INVALID (no change) | The planner read the design page in this session (key table: ⌘B Board, ⌘L focus chat input, ⌘, Settings); WKWebView behavior is the owner's app check | None |

Found by one validator only: Claude 1, 3, 4, 9, 11, 12, 13, 15, 16; Codex 5, 6, 7, 8. Both: 2, 10, 14.

Extra fix found while applying: `node apps/plans-mac/build.mjs --check` is not in `.claude/settings.json` `permissions.allow`, so it is not a "How to verify" command; the compile test runs it under `node --test`.

## Validation response

```text
Round 1 of the plan .plans/20261125-095009-plans-mac-app-shell.md is done. 16 of 17 findings were valid or partly valid and are fixed in the plan: the origin rule for links and menu calls, the waiting page (allowed schemes, only real connection errors, one retry timer), the delegate wiring, a staged app install with restore, a real compiler check (xcrun --find swiftc) used by setup.sh and the test, a failed build that no longer stops setup, tests for the new setup.sh block, the ⇧⌘[ / ⇧⌘] key equivalents, swiftc flags, https-only --url, main-frame downloads, timers in a hidden window, reopening a minimized window, the certificate hint, the roadmap Architecture line and the known limits in the docs. Rejected: the claim that the design page was not checked (it was read in the planning session). Round 2 validates these edits.
```
