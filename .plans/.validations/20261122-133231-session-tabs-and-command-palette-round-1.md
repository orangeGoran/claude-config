# Round 1: session-tabs-and-command-palette

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-1.md`)
- Codex (validate-plan): ON — NEEDS REWORK (`-codex-raw-1.md`)
- Regressions from the previous round: none (round 1)

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Codex | Restart deferred to after merge breaks the restart rule | INVALID (clarified) | The service runs the main checkout's script (`scripts/launchd/com.plans-dashboard.plist.template`, `__SCRIPT__`), so a restart in the run serves old code, and the validator limits forbid touching the real service. Hard rules line now says why, and puts the restart in Open items after merge. |
| 2 | Codex | Closing a background tab switches the open plan | VALID | Step 6: `closeSession` keeps `selected` for a background tab; browser-test step 4 checks it. |
| 3 | Codex + Claude | Nested `×` button; `display:flex` overrides `hidden` | VALID | Step 5: two sibling buttons in a `.stab` div; step 14: `#stabs[hidden], #palette[hidden] { display:none; }` (no global `[hidden]` rule in `app.css`). Test checks the rule. |
| 4 | Codex | Browser fixture has one plan | VALID | Browser test: throwaway `HOME` with one fake repo and three plans, old and new instances on their own ports, stopped by PID. |
| 5 | Codex + Claude | `paletteMatch` has no tabs argument | VALID | Step 9: `paletteMatch(q, plans, actions, tabs)`, no other globals; tests use `tabs`. |
| 6 | Codex + Claude | `matchesFields` / `matchesQ` are not one-line | VALID | Tests: cut from `const squash =` to `function visiblePlans() {`; fixtures carry `slug` and `tags: []`. |
| 7 | Codex | Worktrees in tabs and palette undecided | VALID | Step 5: tabs take any item `find()` returns (plans and worktrees, as the sidebar opens both); step 9: the palette searches plans only, as `#q` does. |
| 8 | Codex | Design proposal not verified | INVALID | The decisions are recorded from the owner in this session (Context); the proposal is a design reference, not a spec to check. |
| 9 | Codex + Claude | Changelog validator missing from How to verify | VALID | Added `node .claude/scripts/changelog-validate.mjs --base origin/main` (`changelog.d/AGENTS.md`). |
| 10 | Codex | Reopen of a stale closed plan | VALID | Step 6: `reopenSession` skips and drops stale keys. |
| 11 | Codex | Duplicate or malformed saved tabs | VALID | Step 3: `tabsLoad(raw)`; unit test. |
| 12 | Codex + Claude | Board selection not redrawn | VALID | Step 6: `openSession` calls `renderBoard()` when `boardOn`, as `openFromBoard()` does; browser-test step 7. |
| 13 | Codex | Palette focus restore, empty results, focus containment | VALID | Step 11: remember and restore focus, "No matches" row, Tab stays in `#palq`. |
| 14 | Claude | Wrong `ctrlKey` hit list | VALID | Breaking changes corrected: `chatKey()` arrows, Mermaid wheel zoom, `#home` click. |
| 15 | Claude | Global keys fire behind overlays | VALID | Step 12: off while `#onb.open`, tour, `.mmdfull`, `.imgview`, `#seldlg.open`, or the palette; browser-test step 10. |
| 16 | Claude | `closeSession` with no plan open pushes `null` | VALID | Step 6: return early; `tabsClose` with a missing key gives `next: null`. |
| 17 | Claude | `nextSession` wrap-around untested | VALID | Step 3: `tabStep`; unit test. |
| 18 | Claude | Docs: other systems, ⌘ vs Ctrl detection, screenshots, PLAN.md open decisions | VALID | Breaking changes "Known limits" (docs step 16 includes them); step 12 `IS_MAC`; step 17 `node scripts/docs-media.mjs` (+ Affected files); step 1 lists phase 2 and 3 details as open decisions. |
| 19 | Claude | Edge cases: two windows, Back/Forward, prune on a short gap, Mission Control, ⌘K in Monaco, z-index | VALID | Known limits list; step 8 prunes only when the project is in the state; step 14 `z-index:40` above `#tourpop` (32). |

Only Codex found: 1, 2, 4, 7, 8, 10, 11, 13. Only Claude found: 14, 15, 16, 17, 18, 19 (parts).
