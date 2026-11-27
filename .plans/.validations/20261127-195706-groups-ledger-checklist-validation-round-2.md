# Validation round 2: 20261127-195706-groups-ledger-checklist.md

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (2 blocking, 10 should fix). Report: `20261127-195706-groups-ledger-checklist-validation-claude-2.md`.
- Codex (`validate-plan`): ON — NEEDS REWORK (2 blocking, 2 non-blocking). Report: `20261127-195706-groups-ledger-checklist-validation-codex-2.md`.
- Regressions from round 1 (step a): none found by the diff check (no old placement text left; the `step 2` and `step 4` references still point at the right steps). Claude found that round 1 F9 was incomplete (its test could not fail): recorded as R1 below, not as a regression of a correct part.

## Findings

| ID | Raised by | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| R1 | Claude B1 | The `é` truncation test cannot fail: 262144 is even, so the cut never falls inside a 2-byte character | VALID (round 1 F9 incomplete) | 150000 × 2 bytes, cut at an even byte | E2E: `'a' + 'é'.repeat(150000)`, expect 262143 bytes and no U+FFFD |
| F1 | Codex B1 | `ledgerOpen()` treats `EEXIST` on a folder as an existing ledger, and `mkdirSync` is outside the `try` | VALID | `open(O_CREAT\|O_EXCL)` gives `EEXIST` for any existing path; the server's global catch returns the error text | Step 6: one `try` around both calls; `EEXIST` counts only when `statSync(f).isFile()`; else `{ ok: false, output }`; E2E cases for a folder and for a failed `mkdirSync` |
| F2 | Codex B2 | A → B → A or close and reopen: an older answer can paint over a newer one | VALID | Round 1 checked only the drawer title and the pick | Step 11: `ckGen` request number; only the newest request paints; Browser test 3b |
| F3 | Claude B2 | First `/api/ledger` read races the PR list load | VALID | `prsFor()` returns `{}` on first use and calls `refreshPrList()` in the background (`server.mjs` → `prsFor`) | E2E: the first reads are inside `until()` |
| F4 | Codex NB1 | The repaint key ignores the group list | VALID | The select is built from `state`, not from the answer | Step 11: key = groups + pick + text; Browser test 3c |
| F5 | Codex NB2 | A stale `running` report shows as running | VALID | `watch.mjs` → `runningCount()` counts only a fresh report, not `CLEANED`/`unknown` | Step 2 `planStep(p, now, staleMs)`: fresh rule; a stale running report is `failed`; `buildChain()` and step 6 pass `Date.now()`, `STALE_RUN_MS`; unit cases |
| F6 | Claude NB | Wrap the output in `<div class="setup sc">` | VALID | `app.css`: `#logbody { … white-space:pre-wrap; }` | Step 11 |
| F7 | Claude NB | Cases must unregister their projects and not depend on each other | VALID | Other cases in `watcher.test.mjs` call `unregister()` | E2E intro |
| F8 | Claude NB | `gl-group4` / `gl-group5` have no registered project: 400 | VALID | `ledgerState()` and `ledgerOpen()` need a project with the group | E2E intro names a project per group |
| F9 | Claude NB | The `md` stub cannot see `CUR_ISSUES` in another body | VALID | `new Function` scopes | Page function case: one body for all three |
| F10 | Claude NB | Closed PR plus a new start shows "closed" | VALID | `planStep()` rule order | Step 2: `closed` needs `launch.state !== 'starting'`; unit case |
| F11 | Claude NB | `buildChain()` drops the wait `error` | VALID | `planWaits()` gives `{ text, met, error }` | Step 2 keeps `error`; step 11 shows it; Contracts; unit case; E2E does not compare it |
| F12 | Claude NB | Skip a repaint while `#ckGroup` has focus | VALID | A repaint replaces the open select | Step 11 |
| F13 | Claude NB | Add "Checklist" to the ⋯ button title | VALID | `page.html`: `#hdmenuBtn` title lists the menu items | Step 9, Affected files |
| F14 | Claude NB | Remove the "Path detail" note in Context | INVALID | The note explains why the path differs from the owner's example text in question 3; the implementer needs it | No change |
| F15 | Claude NB | `"client": "Galileon"` in the example registry | RAISED BEFORE (round 1, F21) | No new evidence | No change |

Findings raised by one validator only: Claude R1, F3, F6–F15; Codex F1, F2, F4, F5.

## Validation response

Applied: R1, F1–F13. Rejected: F14 (the note is needed context). Raised before: F15. No owner decision was needed.
