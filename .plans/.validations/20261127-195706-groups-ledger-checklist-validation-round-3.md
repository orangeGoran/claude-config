# Validation round 3: 20261127-195706-groups-ledger-checklist.md

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (2 blocking, 6 should fix). Report: `20261127-195706-groups-ledger-checklist-validation-claude-3.md`.
- Codex (`validate-plan`): ON — NEEDS REWORK (3 blocking, 1 non-blocking). Report: `20261127-195706-groups-ledger-checklist-validation-codex-3.md`.

## Regressions from round 2

| ID | Raised by | Regression | Fix |
| --- | --- | --- | --- |
| REGRESSION R1 | Claude B1, Codex B1 | Round 2 F12 (skip a repaint while `#ckGroup` has focus) also blocked the repaint that the group change itself asks for: the select keeps focus after a pick, so the new group never showed | Step 11: `renderChecklist(byUser)`; the focus guard applies only to the `refreshOnce()` call; open, change and edit call `renderChecklist(true)`; Browser test 3c |
| REGRESSION R2 | Claude B2, Codex B3 | Round 2 F1 called `statSync(f)` in the `catch` without a guard: `ENOTDIR` (a file at `groups/<group>`) or a dangling link reached the global catch (500) | Step 6: `isFileSafe(f)` (a throw counts as not a file), also used by `ledgerState()` |

## Findings

| ID | Raised by | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| F1 | Codex B2 | The no-group return comes before `++ckGen`: an old request for a removed group can still paint | VALID | Round 2 step 11 order | Step 11: `gen = ++ckGen` right after the `showing()` check, before every other return; Browser test 3c |
| F2 | Claude NB1 | `inline(title)` links `#41` in a title to the open plan's issues | VALID | `inline()` uses `CUR_ISSUES`; `renderDetail` sets it | Step 11: `CUR_ISSUES = ''` for the whole `checklistHtml()`; page-function case |
| F3 | Claude NB2 | "Untracked" and "Ledger text" cases depend on other cases | VALID | They reused `gl-api` / `gl-group` | Own projects `gl-un` (`gl-group7`) and `gl-text` (`gl-group8`) |
| F4 | Claude NB3 | `code.log` checks race the asynchronous `code` call | VALID | `openFolderInVsCode()` → `execFile('code', …)` with a callback | `until()` for a line; `ticks(2)` before each "no new line" check |
| F5 | Claude NB4 | A `CLEANED` report shows as `failed` | VALID | `outcomeOf()` gives `running` for `CLEANED …`; `auto-pipeline.sh --cleanup` writes it | Step 2: a `CLEANED`/`unknown` report counts as no run; unit cases changed |
| F6 | Claude NB5 | The guide tour text that lists the ⋯ items lacks "Checklist" | VALID | `app.js` tour text `'Board, Scout, Sticky Note, QA Reports, …'` and `'Board, Scout, QA reports, …'` | Step 12, Affected files |
| F7 | Claude NB6 | `inline` is a multi-line function, not one line | VALID | `app.js` `function inline(` up to `function md(` | Page-function case says how to cut it |
| F8 | Codex NB1 | The manual browser test has no fake `gh` setup | VALID | The fake data lives in the test harness only | Browser test → Account and data: `<tmp>/bin/gh` copy of `FAKE_GH`, `FAKE_GH_DIR`, `PATH`, `HOME` |

Findings raised by one validator only: Claude F2–F7; Codex F1, F8. Both: R1, R2.

## Validation response

Applied: R1, R2, F1–F8. Rejected: none. Raised before: none. No owner decision was needed.
