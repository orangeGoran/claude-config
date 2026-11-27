# Validation round 4: 20261127-195706-groups-ledger-checklist.md

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (1 blocking, 6 should fix). Report: `20261127-195706-groups-ledger-checklist-validation-claude-4.md`. It confirmed the round 3 fixes against the code.
- Codex (`validate-plan`): ON — NEEDS REWORK (2 blocking, 3 non-blocking, 3 edge cases). Report: `20261127-195706-groups-ledger-checklist-validation-codex-4.md`.
- Regressions from round 3 (step a): none. One propagation gap fixed before this round: the Deviation text named the old repaint rule.

## Findings

| ID | Raised by | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| F1 | Codex B1, Claude NB3 | Wait text, wait error and URLs in attributes are not named as escaped | VALID | `scoutRunCard()` escapes plan text; `issuesUrlFor()` lets a `"` through | Step 11: every text through `esc()`/`inline()`, every attribute through `escA()`; page-function cases with markup and a `"` in a URL |
| F2 | Codex B2 | A failed `buildStateBody()` reaches the global catch, which returns `String(e)` | VALID | Global catch of the request handler | Step 6/7: fixed 500 text, error to the server log; Contracts; Harness constraints (cannot be made on demand) |
| F3 | Claude B1 | "No group yet" keeps the old repaint key: a group that comes back does not repaint | VALID | Step 11 no-group branch | `_ck = null` in that branch; Browser test 3c |
| F4 | Codex NB1 | `Product` and `product` share one folder on a case-insensitive Mac disk | VALID | The name is a folder name | Contracts, step 4: group names are stored and read in lower case; E2E cases |
| F5 | Codex NB2, Claude NB5 | A `stat` permission error reads as "no ledger"; no unreadable-ledger case | VALID | `isFileSafe()` hid every error | Step 6: `fileState()` gives `file`/`none`/`error`; E2E `chmod 000` case (skipped as root) |
| F6 | Codex NB3 | Each tick drops the request before it: slow answers never paint | VALID | `++ckGen` on every call | Step 11: `ckBusy`, a tick call returns while a request runs |
| F7 | Codex edge | Closed PR with a fresh running report shows `closed` | VALID | `runningCount()` counts that report | Step 2: `running` before `closed`; unit case |
| F8 | Codex edge | Dropping a trailing U+FFFD also drops a real one | VALID | Round 2 rule | Step 6: `StringDecoder` (built-in); E2E case with a real U+FFFD at the limit; Hard rules and Affected files name the import |
| F9 | Claude NB1 | Browser test 3c: Settings replaces the drawer | VALID | Settings opens in the same side pane | Edit the test registry by hand |
| F10 | Claude NB2 | "No second build" is not always true | VALID | `STATE_CACHE_MS` shares a build for 1 s | Deviation and step 6 text corrected |
| F11 | Claude NB4 | Browser-test server needs `DASH_NO_SUMMARY=1` | VALID | Summaries call `claude` | Command updated |
| F12 | Claude NB6 | The "Path detail" note is out of date | VALID (new evidence) | The parent plan's 3A line now names `groups/` | Note shortened to the one reason the folder is not in `state/` |

Findings raised by one validator only: Claude F3, F9–F12; Codex F2, F4, F6–F8. Both: F1, F5.

## Validation response

Applied: F1–F12. Rejected: none. Raised before: none (F12 brings new evidence against round 2 F14). No owner decision was needed.

## Final edits check

Diff of `-pre-round-4.md` against the plan, each hunk read, and the three checks run:

- Citations: no `:line` citation in the plan; the names `fileState`, `ckBusy`, `StringDecoder`, `STATE_CACHE_MS` are used the same way in every section.
- Cross-references: no step was added or renumbered; "step 6", "step 7", "step 11" references still point at the right steps.
- Propagation, and fixes made in this check (no validator read them):
  1. Tests → End-to-end, "Settings keep the group": the posted value was `gl-group6` while the text said `GL-Group6`; the posted value is now `GL-Group6`.
  2. Tests → End-to-end intro: `gl-group9` added to the list of groups with a registered project.
  3. Hard rules → No npm dependencies, and Affected files → `server.mjs`: the new `node:string_decoder` import is named.
- Unresolved problems: none. The old name `isFileSafe` and the old U+FFFD rule are gone (`grep` found no match).
