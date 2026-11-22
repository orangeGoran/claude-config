# Round 2: session-tabs-and-command-palette

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-2.md`)
- Codex (validate-plan): ON — NEEDS REWORK (`-codex-raw-2.md`)
- Regressions from round 1 edits: 1 — the round-1 prune fix (keep keys of a missing project) left hidden keys in the list that the keys and the close fallback used (finding 3). Fixed forward: the edit was right, its propagation was missing.

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Codex | Restart must happen during the run | INVALID (again) | Same evidence as round 1: the service runs the main checkout's script; a restart from the worktree serves the old code. Reported to the owner as a rule-wording note. |
| 2 | Codex | `docs-media.mjs` copies only `plans-dashboard.mjs`; the server needs `scripts/plans-dashboard/` and three imports | VALID | `scripts/docs-media.mjs` `newHome()`; `UI_DIR`, imports of `artifact-copies.mjs`, `page-versions.mjs`, `CHAT_RELAY` in `plans-dashboard.mjs`. Step 17 copies `scripts/` without `scripts/test/`; Affected files lists the script. |
| 3 | Codex + Claude | Strip numbers and keys use different lists (REGRESSION) | VALID | Step 3 `tabsShown`; steps 5 and 6 use `shownTabs()` for hints, switch, step and close; test with a stale key at the front. |
| 4 | Codex | Run strip and alert cards need fixture state | PARTIALLY VALID | No safe live run in the fixture; siblings now name board cards, `?sel=` reload and palette, and say why run strip and alerts are covered by the `renderDetail()` hook. |
| 5 | Codex | Design reference not verifiable | INVALID | Same as round 1: decisions recorded from the owner. |
| 6 | Codex + Claude | Reopen of an already-open tab | VALID | Step 3 `closedPush`; step 6 `reopenSession` skips open and stale keys. |
| 7 | Claude | Two `</header>` in `page.html` | VALID | Step 2 names the first one (`header.mainhd`). |
| 8 | Claude | `z-index:40` ties `#toasts` | VALID | Step 14: `z-index:60`. |
| 9 | Claude | Row mousedown needs `preventDefault()` | VALID | Step 11, as `chatMenu()`. |
| 10 | Claude | Close before or after the action; focus | VALID | Step 11: `closeSearch(false)` then run; restore focus only on Escape or click outside. |
| 11 | Claude | Exact modifier checks; keys in text boxes | VALID | Step 12 gives each check; keys work in text boxes. |
| 12 | Claude | Worktree tab dot; palette does not list worktree tabs | VALID | Step 5 uses the `wtItemHtml` dot; step 9 says worktree tabs are reached from the strip. |
| 13 | Claude | Prune lambda untested | VALID | Step 3 `tabsPrune(tabs, known, projects)`; unit test. |
| 14 | Claude | `#12` case needs `pr` in a fixture | VALID | Tests: one fixture has `pr`. |
| 15 | Claude | `docs/PLAN.md` says fill before the first feature plan | PARTIALLY VALID | Context: this is the first plan, so it fills the parent plan in the same PR. |
| 16 | Claude | Hints show on other systems | VALID | Step 5: hints only with `IS_MAC` (defined in step 4). |
| 17 | Claude | Block placement not named | VALID | Step 9: right after the session-tabs block, before `let boardOn = false;`. |

Only Codex found: 1, 2, 4, 5. Only Claude found: 7–17 except 13's overlap.
