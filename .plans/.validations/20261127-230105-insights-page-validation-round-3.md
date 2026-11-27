# Validation round 3 — 20261127-230105-insights-page

- Claude (plan-validator): ON — APPROVE WITH CHANGES, no blocking issue (`-validation-claude-3.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-3.md`)
- Regressions from round 2 (step a): 0. Citations re-opened: `renderEmptyDetail()`, `openBoard()`, `startTour()`, `syncUrl()`, `--hdl` (app.css); cross-references and propagation (Steps, Tests, Browser test, Affected files) checked.

## Findings

| # | Raised by | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Codex (blocking) | `/api/insights` writes the 200 header before `insightsBody()`; an I/O error then double-sends and `String(e)` may leak a path | VALID (server.mjs catch → `json(res, 500, { error: String(e) })`) | Step 6: build first, generic 500, message redacted to the log; test with an unreadable run log |
| F2 | Codex (blocking) | `dashSearch` is not updated on Back/Forward to a Dashboard entry | VALID | Step 10: `readUrl()` sets `dashSearch` on a Dashboard path; Browser test sequence |
| F3 | Claude | `dash-page` saved only by `setPage()`; direct loads, reloads, history do not update "the page used last" | VALID | `applyPage()` saves it; markup test |
| F4 | Claude | `.hdtitle` must reset the global `button` rule (app.css) | VALID (verified) | Step 12 |
| F5 | Claude | `raw()` always uses the suite port | VALID (verified dashboard.test.mjs `raw`) | `raw()` gets `toPort = port`; Affected files |
| F6 | Claude | `--hdl` also sizes `.rbar` | VALID (verified app.css `.rbar`) | Step 12 names it; Browser test checks the switch x |
| F7 | Claude | Contracts names private `planFiles()`/`doneFiles()` | VALID | Contracts: "the same count as" |
| F8 | Claude (edge) | `renderInsights()` before the first answer | VALID | Step 11: "loading…" while `insData` is null |
| F9 | Codex | Plan 1 module not on main; preview outside the repo | RAISED BEFORE (round 1 F12, round 2 F13/F14) | no change |

Only Codex: F1, F2. Only Claude: F3–F8.

## Validation response

Both Codex blocking issues are fixed (step 6, step 10). All Claude should-fix items and the edge case are applied. F9 is raised before with no new evidence. No owner decision was needed.
