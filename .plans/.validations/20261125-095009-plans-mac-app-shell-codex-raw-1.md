## Plan validation (codex): 20261125-095009-plans-mac-app-shell.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Security] The navigation policy compares only the host, so a different scheme or port on the dashboard host can load in the web view and receive menu calls intended for the dashboard — [.plans/20261125-095009-plans-mac-app-shell.md:105](/Users/gorantubic/Workspace/claude-config/.plans/20261125-095009-plans-mac-app-shell.md:105), [apps/dashboard/server.mjs:3395](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:3395) — the existing QA server deliberately uses a separate origin to isolate its scripts from the dashboard. Compare the full configured origin, restrict hook calls to that origin, and test same-host URLs with a different scheme or port.
- [Data safety] The installer deletes the installed app before copying its replacement — [.plans/20261125-095009-plans-mac-app-shell.md:130](/Users/gorantubic/Workspace/claude-config/.plans/20261125-095009-plans-mac-app-shell.md:130) — a copy failure can leave no working installation, and the plan does not address replacing a bundle while it is running. Stage and verify the replacement, preserve or restore the old bundle on failure, and define safe behavior for a running app.
- [Tests for logic changes] The plan changes `scripts/setup.sh` control flow but provides no test for its new prompt, skip, build and open branches — [.plans/20261125-095009-plans-mac-app-shell.md:133](/Users/gorantubic/Workspace/claude-config/.plans/20261125-095009-plans-mac-app-shell.md:133), [AGENTS.md](/Users/gorantubic/Workspace/claude-config/AGENTS.md) — the project requires tests for script logic changes. Add isolated tests that exercise these branches without running the real setup or opening an app.
- [Recovery] Every provisional navigation failure schedules a retry, but the plan does not distinguish the dashboard URL from other navigation failures or cancel an outstanding timer — [.plans/20261125-095009-plans-mac-app-shell.md:120](/Users/gorantubic/Workspace/claude-config/.plans/20261125-095009-plans-mac-app-shell.md:120) — a stale retry can replace a page after recovery, and repeated failures can create competing retries. Specify one owned retry timer, cancellation on success and shutdown, and the failures that trigger it; test the recovery behavior.

### Non-blocking concerns

- [Verification] The Swift compile and sign test skips when `swiftc` cannot run, so the listed automated checks can pass without compiling the app — [.plans/20261125-095009-plans-mac-app-shell.md:152](/Users/gorantubic/Workspace/claude-config/.plans/20261125-095009-plans-mac-app-shell.md:152). Require a macOS compile-and-sign result before treating the implementation as verified.
- [Reference] The local QA design page and actual WKWebView behavior were not verified: this review permits repository reads only. The owner’s app check and access to that design page would establish those claims.

### Edge cases the plan should address

- A fresh account without `~/Applications`, a failed copy, and an app already running during installation.
- An invalid `--url`, an unreadable Caddy file, and a URL with a different port or scheme.
- Dashboard recovery after several failed loads, including a retry pending when the page succeeds or the app quits.
- Setup with `--yes`, a declined prompt, missing or unusable `swiftc`, and a failed build.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261125-095009-plans-mac-app-shell.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Compare navigation against the full configured dashboard origin, restrict menu hook calls to that origin, and test different schemes and ports on the same host. The QA server uses a separate origin to isolate its scripts. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:105, .plans/20261125-095009-plans-mac-app-shell.md:116, apps/dashboard/server.mjs:3395)
2. Stage and verify the replacement app, preserve or restore the installed bundle if installation fails, and define safe behavior when the app is running. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:130)
3. Add isolated tests for the setup prompt, skip, build and open branches without running the real setup or opening an app. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:133, AGENTS.md)
4. Specify which navigation failures trigger recovery, use one owned retry timer, cancel it on success and shutdown, and test recovery. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:120)

SHOULD FIX:
1. Require a macOS compile-and-sign result before treating the implementation as verified; the automated test can otherwise skip. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:152)

ADD THESE EDGE CASES:
- A missing ~/Applications directory, a failed copy, and an app running during installation.
- An invalid --url, an unreadable Caddy file, and a same-host URL with a different port or scheme.
- Several failed loads followed by recovery while a retry is pending, and quitting with a retry pending.
- Setup with --yes, a declined prompt, missing or unusable swiftc, and a failed build.

Do not change anything the validation did not flag.
```