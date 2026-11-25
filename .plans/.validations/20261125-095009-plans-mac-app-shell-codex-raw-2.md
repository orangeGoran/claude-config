## Plan validation (codex): 20261125-095009-plans-mac-app-shell.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data safety] The install rollback cannot restore `.old` over a newly installed, non-empty `dest` if removing `.old` fails after the second rename. A stale `.old` from an interrupted install can also prevent the next swap. The specified test only fails before the first rename, so it does not exercise rollback — `.plans/20261125-095009-plans-mac-app-shell.md:130`, `.plans/20261125-095009-plans-mac-app-shell.md:165` — Define recovery for each swap and cleanup failure, including stale staging paths, and test failures after the first rename and after the new app is installed.
- [Error handling] Every non-cancelled `NSURLErrorDomain` failure triggers a reload of the dashboard URL, regardless of which navigation failed. A failed load of a same-origin plan or other page can therefore discard its location and retry the root instead — `.plans/20261125-095009-plans-mac-app-shell.md:126` — Preserve and retry the failed main-frame URL, or explicitly constrain recovery to the initial dashboard load, and test that behavior.

### Non-blocking concerns

- [Verification] The plan supports macOS 13 but only disables inactive scheduling on macOS 14 and later, while its app check expects a hidden-window sound without a version qualification — `.plans/20261125-095009-plans-mac-app-shell.md:112`, `.plans/20261125-095009-plans-mac-app-shell.md:200` — State the macOS 13 limitation and check the behavior separately.
- [Verification] The proposed tests inspect Swift source for delegate and navigation behavior; they do not prove that the app’s menus, panels, links or timer work. The owner’s manual check covers these, but its result remains unverified until performed — `.plans/20261125-095009-plans-mac-app-shell.md:160`, `.plans/20261125-095009-plans-mac-app-shell.md:184` — Record the manual check result and macOS version in the run report.

### Edge cases the plan should address

- An interrupted install leaves `.new` or `.old` behind — the next install needs a defined recovery path that preserves the last working app.
- A retry succeeds after a failure on a plan URL — the user should return to the intended location.
- A hidden window on macOS 13 — timer and sound behavior may differ from macOS 14 and later.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261125-095009-plans-mac-app-shell.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Define install recovery for each swap and cleanup failure, including stale .new and .old paths. Ensure a failure after the new app is installed does not attempt to rename .old over a non-empty destination. Add tests that inject failures after the first rename and after installation of the new app. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:130, .plans/20261125-095009-plans-mac-app-shell.md:165)
2. Preserve and retry the failed main-frame URL, or explicitly constrain waiting-page recovery to the initial dashboard load. Add coverage for a failed same-origin plan navigation. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:126)

SHOULD FIX:
1. State the hidden-window timer limitation on macOS 13 and distinguish it in the manual sound check. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:112, .plans/20261125-095009-plans-mac-app-shell.md:200)
2. Record the manual app check result and macOS version in the run report, because source checks alone do not prove GUI behavior. (evidence: .plans/20261125-095009-plans-mac-app-shell.md:160, .plans/20261125-095009-plans-mac-app-shell.md:184)

ADD THESE EDGE CASES:
- An interrupted install leaves .new or .old behind.
- A failed plan navigation succeeds on retry without losing the intended location.
- A window hidden on macOS 13 may have different timer and sound behavior.

Do not change anything the validation did not flag.
```