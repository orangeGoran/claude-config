# Validation round 1 — 20261127-230105-insights-page

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-claude-1.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-1.md`)
- Regressions from the previous round: none (first round of the run)

## Findings

| # | Raised by | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude + Codex (blocking) | The `renderDetail()` guard switches back to the Dashboard on a state refresh while a plan stays `selected` (`refreshOnce()` calls `renderDetail(false)` when `selected`, app.js ~4413) | VALID | Step 10: `showInsights()` keeps `dashSearch`, clears `selected` and `boardOn`; `showDashboard()` restores; the guard uses `setPage()`; markup test and Browser test updated |
| F2 | Claude + Codex (blocking) | First load, reload and Back/Forward never call `loadInsights()` (init lines call only `applyView()`, popstate too) | VALID | `applyPage()` calls `loadInsights()`; init lines and popstate call `applyPage()`; tests updated |
| F3 | Claude | Esc with `#pagemenu` open also closes the plan (guard checks only `#hdmenu`) | VALID (verified app.js Esc handler) | Step 10: Esc returns while `#pagemenu` is open |
| F4 | Claude | ✕ Board stays when switching from the Board to Insights | VALID | fixed by F1 (`boardOn = false`, `applyView()`) |
| F5 | Claude | Two history entries when a plan opens from Insights | VALID | `setPage()` writes no history; `syncUrl()` builds `/dashboard` + query and pushes once |
| F6 | Claude | `projLook()` gives a CSS variable, not a colour; run-log-only projects all hue 210 | VALID (verified `.pcx` rule app.css) | Step 11: `class="pcx"` + style, fill `var(--pc)`; run-only hues from `PROJ_HUES` |
| F7 | Claude | Hiding `#hdtabs` moves Shipyard tabs (main.swift min-width) | VALID (verified main.swift) | Step 12: `#hdtabs` not hidden (empty while no plan open) |
| F8 | Claude | Roadmap step leaves "plans 2 and 3 are not written yet" | VALID | Step 16: replace the whole status sentence |
| F9 | Claude | `insMin(119.6)` gives "1 h 60 min" | VALID | Step 9: round first; test case added |
| F10 | Claude | Cache-hit test timing under load | PARTIALLY VALID | Harness constraints: the two GETs are back to back (ms vs 10 s); no change to the design |
| F11 | Codex | `insMedian()` 0 vs `median: null` in the test | VALID | `insMedian()` returns null; drawn as `–`; test cases added |
| F12 | Codex | Plan 1 exports not verifiable yet | PARTIALLY VALID | Already handled: `Waits for` line and "from plan 1 (not on main yet)"; no change |
| F13 | Claude + Codex (edge) | `/insights?sel=`, two tabs on `dash-page`, partial last line, stale responses, saved filters with gone projects | VALID | Decisions taken for the owner + step 11 (request number, filter cleanup) |

Only Claude: F3–F10. Only Codex: F11, the stale-response and saved-filter edge cases.

## Validation response

Both blocking issues are fixed in step 10 (the page switch keeps the Dashboard selection aside and loads Insights on every way in). The should-fix items F3–F9, F11 and the edge cases are applied. F10 and F12 need no design change. No owner decision was needed.
