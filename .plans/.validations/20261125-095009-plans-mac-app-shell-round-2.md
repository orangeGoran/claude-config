# Round 2 — 20261125-095009-plans-mac-app-shell.md

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES, report `20261125-095009-plans-mac-app-shell-validation-2.md`
- Codex (`validate-plan`): ON — NEEDS REWORK, report `20261125-095009-plans-mac-app-shell-codex-raw-2.md`
- Regressions from round 1 (diff `-pre-round-1.md` → `-pre-round-2.md`): 1, fixed before the validators ran: the deviation line cited `installApp()` as "step 7", but step 6 defines it. Both validators found no other broken round 1 edit. The two blocking findings below are gaps in round 1 fixes (install recovery, waiting page), not broken text.

## Findings

| # | Finding | Raised by | Verdict | Evidence | Fix in the plan |
| --- | --- | --- | --- | --- | --- |
| 1 | No waiting page when Caddy answers 502/503/504 while the dashboard service is down; `didFinish` cancels the retry | Claude | VALID | Caddy is its own brew service (`scripts/setup-macos.sh`, `brew services restart caddy`); `reverse_proxy` in `scripts/caddy/plans.caddy.template` | Step 5: the response handler sends main-frame same-origin 502/503/504 to `showWaiting`; Context line; source test; app check 11 |
| 2 | Retry always loads the root, so a failed plan link loses its place | Codex | VALID | Step 5 reloaded the app URL | `showWaiting` keeps a same-origin failed URL as `retryURL`; ⌘R on the waiting page loads it; source test |
| 3 | Install rollback is wrong after the second rename, and stale `.new` / `.old` break the next install; the restore path has no test | Codex + Claude | VALID | Step 6 `installApp()` | Six ordered sub-steps with recovery per step; a stale `.old` with no `dest` is restored first; cleanup failure is a warning; `rename` parameter; tests for the second-rename failure and stale folders |
| 4 | The setup test "the line after the block is `open …`" cannot pass: the `Done. Opening` printf is between them | Claude | VALID | `scripts/setup.sh` (`printf '\nDone. Opening %s …` then `open "$url" 2>/dev/null \|\| true`) | Step 10 changes both lines; the test checks both lines and the old one's absence |
| 5 | `runSetupPart()` with `startsWith` misses the indented markers | Claude | VALID | `runPart()` in `test/setup-paths.test.mjs` uses `l.startsWith(from)`; the block sits inside `if [ "${PICKED[1]}" = 1 ]` | `l.trim().startsWith(…)`; step 10 says the block is indented |
| 6 | Certificate codes should be -1206 … -1200 | Claude | VALID | `NSURLErrorSecureConnectionFailed` = -1200, `NSURLErrorServerCertificateHasBadDate` = -1201 | Step 5 |
| 7 | ⌘R on the waiting page reloads `about:blank` | Claude | VALID | — | Step 5 Reload rule; step 4 points to it |
| 8 | `inactiveSchedulingPolicy` must be set before the web view is made | Claude | VALID | It is a `WKPreferences` value read at creation | Step 3 order |
| 9 | Key test regex breaks if Tab 1–8 are made in a loop | Claude | VALID | — | Step 4: one `NSMenuItem` line per item |
| 10 | Browser test dashboard lacks `DASH_WATCH_MS=0` | Claude | VALID | AGENTS.md → Commands, "Run a test dashboard by hand" | Browser test command |
| 11 | `appUrl` return value unclear (trailing `/`) | Claude | VALID | — | Step 6: returns the string as given; test expects the exact string |
| 12 | `siteUrl` is not exactly the `setup.sh` pattern (it skips `#`) | Claude | VALID | `scripts/setup.sh` `sed` line | Step 6 wording |
| 13 | `stdio` of the probes and the compile | Claude | VALID | — | Step 6: `'ignore'` for `--check`, `'inherit'` for `swiftc` / `codesign`. The install-dialog concern is not reachable from `setup.sh` (Homebrew before it needs the Command Line Tools), no change |
| 14 | Compile test time on every `npm test` is not measured | Claude | PARTIALLY VALID | Not measured | No plan change; open item: the run report gives the measured time of the compile test |
| 15 | macOS 13 has no `inactiveSchedulingPolicy`; the app check expects the sound | Codex | VALID | `if #available(macOS 14.0, *)` in step 3; `LSMinimumSystemVersion` 13.0 | Context line, docs known limit (step 13), app check 10 split by version |
| 16 | Source checks do not prove GUI behavior; record the app check result and macOS version | Codex | VALID | — | App check ends with the report line (macOS version, one result per item, "not done yet" until the owner does it) |

Found by one validator only: Claude 1, 4–14; Codex 2, 15, 16. Both: 3.

## Validation response

```text
Round 2 (the last round) of the plan .plans/20261125-095009-plans-mac-app-shell.md is done. All 16 findings were valid or partly valid and are fixed in the plan: the waiting page also shows on a Caddy 502/503/504 and retries the same plan URL; the app install has a recovery step for each failure, including stale .new/.old folders, with a test for a failure after the first swap; the setup.sh test checks the right lines and finds indented markers; the certificate error range, ⌘R on the waiting page, the scheduling setting order, one menu item per line, DASH_WATCH_MS=0, the exact appUrl value, stdio of the compile, and the macOS 13 timer limit. No third round runs, so these round 2 edits are not checked by a validator yet. Open item: the compile test's time on npm test is not measured.
```
