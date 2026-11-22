# Round 3: session-tabs-and-command-palette

- Claude (plan-validator): ON — APPROVE WITH CHANGES, nothing blocking (`-validation-3.md`)
- Codex (validate-plan): ON — NEEDS REWORK (`-codex-raw-3.md`)
- Regressions from round 2 edits: 4 (propagation gaps, Claude 1–4 below): the IS_MAC hint rule did not reach the palette rows; the Contracts field list missed the new fields; browser-test steps 10 and the review route did not match the new fixture. Fixed forward.

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Codex | Restart must happen in the run (third time) | OWNER DECISION | The rule text in `AGENTS.md` says "after a change"; the run works in a worktree that the service does not serve. Asked the owner. |
| 2 | Codex | `docs-media.mjs` change needs a test | VALID | Step 17: `export function copyDashboard(dash)` + main-module guard; unit test starts the copied server and fails today. |
| 3 | Codex | Keys in data attributes not escaped | VALID | Step 5: `escA(key)`, as `wtItemHtml` and board cards. |
| 4 | Codex | Browser step 7 order wrong after reopen | VALID | Step 5 states the order (gamma, alpha); step 7 uses Ctrl+2. |
| 5 | Codex | Worktrees: the sidebar search does search them | VALID | `visibleWts()`; palette now passes `[...plans, ...wts]`; test for a worktree match. |
| 6 | Codex | Design reference | INVALID | As rounds 1–2. |
| 7 | Codex | Palette accessible name and active option | VALID | Step 2 `aria-label`; step 11 `role=option`, `aria-activedescendant`, `aria-controls`. |
| 8 | Codex | More than 50 tabs hide actions | VALID | Step 9: the cap counts plan rows only; test with 60 tabs. |
| 9 | Codex | Project present with incomplete data prunes tabs | INVALID | `refreshOnce()` repaints only on a full, parsed `/api/state` array; a project's plans come from its `.plans/` folder listing, not from a partial answer. |
| 10 | Codex | Unsaved settings edits | INVALID | The header buttons (Board, Scout, ⚙, ＋ Add project) have no unsaved guard today; only the settings drawer's own "Add project" asks (`openSettings()`, `addProj`). The palette calls the same handlers, so nothing changes. |
| 11 | Claude | Palette Ctrl hints off macOS (REGRESSION) | VALID | Step 10. |
| 12 | Claude | Contracts field list incomplete (REGRESSION) | VALID | Contracts. |
| 13 | Claude | Browser step 10 has no image or Mermaid (REGRESSION) | VALID | Step 10 adds a Mermaid block to gamma. |
| 14 | Claude | Review route uses the unit fixture (REGRESSION) | VALID | Routes use the fake repo; review mode checked by the CSS rule. |
| 15 | Claude | `node --check` and `docs-media` not in Commands / allow list | VALID | `node --check` removed from How to verify (npm test loads the page); screenshots moved to Open items "(owner, by hand)". |
| 16 | Claude | Escape owned twice | VALID | Step 12 owns it; step 11 and the mirror line no longer list it. |
| 17 | Claude | Placement splits the Board comment | VALID | Step 9: before `// --- Board:`. |
| 18 | Claude | Filter matches `scripts/test` anywhere | VALID | Step 17 compares the exact folder. |
| 19 | Claude | `openSession` reloads the open tab | VALID | Step 6: early return. |
| 20 | Claude | Edge cases: Esc leaves an unmarked tab; worktree tabs in the empty palette; `dash-tabs` written every repaint | VALID | Browser step 12; palette gets worktrees; steps 7 and 8 save only on a change. |
