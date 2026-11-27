# Validation round 2 — 20261127-230105-insights-page

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-claude-2.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-2.md`)
- Regressions from round 1 (step a): 1 — `readUrl()` on `/insights` overwrote `dashSearch` with an empty query on Back, losing the plan kept aside. Fixed before the validators ran (only a non-empty query replaces `dashSearch`); snapshot retaken.

## Findings

| # | Raised by | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude (blocking) | `showInsights()` does not call `renderEmptyDetail()`: `#hdtabs`, the title, the active tab and the chat stream/lock of the old plan stay | VALID (verified app.js `renderEmptyDetail()`) | Step 10: `renderEmptyDetail()` after `setPage('insights')`; markup and Browser test lines |
| F2 | Codex (blocking) | ⋯ → Board from Insights leaves the address on `/insights` | VALID | `syncUrl()` early return checks the path; `openBoard()` → `renderEmptyDetail()` → `syncUrl()` writes `/dashboard?view=board`; Browser test |
| F3 | Codex (blocking) + Claude | `syncUrl()` early return ignores the path (`/insights?sel=x` → open x) | VALID (app.js `syncUrl()`) | Same fix as F2; Browser test line |
| F4 | Claude | `startTour()` with no plan leaves `/insights` | VALID | `startTour()` calls `setPage` + `syncUrl()` |
| F5 | Claude | Insights drawing block placement vs the init lines (ReferenceError) | VALID | Step 11: block before the init lines; markup test |
| F6 | Claude | `insMin()` must check `m < 1` before rounding | VALID | Step 9 wording |
| F7 | Claude | "Plans ▾" may overflow the fixed `--hdl` group (app.css, Shipyard) | VALID (verified app.css `--hdl`) | Step 12: `--hdl` 184 → 200 px; Browser test check; Affected files |
| F8 | Claude | Roadmap entry still says "ledger" | VALID | Step 16 rewords it |
| F9 | Claude | `insWeeks()` DST drift | VALID | Step 9: the preview's +12 h step; test asserts Monday 00:00 |
| F10 | Claude (edge) | Same `plansDir` in two entries counts twice | PARTIALLY VALID | Decision taken for the owner: counted per entry |
| F11 | Claude (edge) | `isParentPlan()` should read only the head | VALID | Step 2: first 8 KB |
| F12 | Claude (edge) | `showDashboard()` extra entry when the kept plan is gone | INVALID | `renderDetail()` → `renderEmptyDetail()` → `syncUrl()` finds the same query and path and writes nothing |
| F13 | Codex | Recheck plan 1's merged module before implementing | PARTIALLY VALID (RAISED BEFORE round 1 F12, but a cheap guard) | Step 1 opens and confirms plan 1's merged exports first |
| F14 | Codex | The preview is outside the repo | INVALID | The plan names it as the owner's approved model (parent plan decision 3); the implementer reads it on disk |

Only Claude: F1, F4–F12. Only Codex: F2, F14.

## Validation response

All three blocking issues are fixed in step 10. The should-fix items F4–F9 and F11 are applied, F10 is recorded as a default, F12 and F14 are rejected with reasons, F13 adds a guard to step 1. No owner decision was needed.
