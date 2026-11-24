# Round 3 — pipeline-diet-templates

- Claude: ON (`-validation-3.md`, APPROVE WITH CHANGES, 0 blocking, 6 should-fix, 2 style)
- Codex: ON (`-codex-raw-3.md`, NEEDS REWORK, 3 blocking, 1 non-blocking)

## Regressions from round 2 edits

| # | Regression | Raised by | Fix |
| --- | --- | --- | --- |
| R1 | The new Commit check and Resume sentence had no `MOD_DECISION_SHEET` switch | Codex B1, Claude S2 | Each sheet line in Commit and Resume has its own `@@IF MOD_DECISION_SHEET@@` block; module-off test |
| R2 | Done check matched a line start, but Timeline entries start with `- HH:MM:SS — ` | Codex B2 | Check the text after the prefix; test |
| R3 | A committed run sent to item 5 got `--fix` | Claude S1 | Item 5 picks its case from the Status: before the commit, after the commit (no `--fix`), after a failed gate |
| R4 | Compaction tokens 0; row before a compaction had no clear end | Claude S3, S4 | Tokens from the `result` line's `model_usage_since_last_result`; the row before ends at its last timestamp |

## Findings

| # | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| 1 | Codex B1 | Commit check without the module switch | VALID | R1 |
| 2 | Codex B2 | Done check against a timestamped line | VALID | R2 |
| 3 | Codex B3 | Full e2e gate drops plans that list e2e tests only in Tests | VALID | Step 10 adds the Tests-section condition; test |
| 4 | Codex NB1 | Field evidence not independently verified | PARTIALLY VALID | Claude rounds 2 and 3 confirmed the shapes (field names only); owner check of a real log added under Open items |
| 5 | Claude S1 | Commit-mode resume with `--fix` | VALID | R3 |
| 6 | Claude S2 | Module-off sheet lines | VALID | R1 |
| 7 | Claude S3 | Compaction row tokens | VALID | R4 |
| 8 | Claude S4 | Row end before a compaction | VALID | R4 |
| 9 | Claude S5 | `total_cost_usd` fallback misses earlier streams | VALID | Sum of the last value per stream (`init` line); test |
| 10 | Claude S6 | Resume after `FAILED: decision sheet` | VALID | Item 5 case 6: no second Codex run, the test gate again |
| 11 | Claude style | `5. **Decision sheet**` style; 4 → 6 with the module off | VALID / INVALID | Style applied; the gap matches today's pr-mode list without item 6 |
| 12 | Claude style | `result` lines carry thinking tokens | VALID | Total table shows them; caveat reworded |

Only Codex found 1–4 (1 also Claude). Only Claude found 5–12.

## Note

Claude's validator printed nine lines of a gitignored local run log into its own output to check the segment shape. Nothing from it is in the plan or the reports (field names only).

## Validation response

All VALID items applied. Round 4 validates these edits; it is the last round.
