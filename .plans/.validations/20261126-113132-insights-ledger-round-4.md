# Round 4 — 20261126-113132-insights-ledger

- Claude (plan-validator): ON — APPROVE WITH CHANGES, nothing blocking (`-validation-4.md`)
- Codex: ON — NEEDS REWORK (`-codex-raw-4.md`)
- Regressions from round 3 edits: 1 — the usage reuse was in Contracts and step 5 but not in step 2 (Claude #1). Fixed.
- This is the last round (AGENTS.md: max 4). The round-4 edits below were not checked by another round.

## Findings

| # | Validator | Finding | Verdict | Evidence | Fix in the plan |
| --- | --- | --- | --- | --- | --- |
| 1 | Codex B1 | mixed cost formats undercount | PARTIALLY VALID | `applyCosts()` sums model-usage lines only when one exists | not changed: the ledger keeps the `run-usage.mjs` total by design; known limit stated in Contracts; test pins the behaviour |
| 2 | Codex B2 | per-run I/O errors stop the project | VALID | — | per-run `try` around every sub-step; unreadable report ≠ missing; injected `readFile`; tests |
| 3 | both (Codex S1, Claude #2) | outcome difference from `outcomeOf()` not stated; case | VALID | `server.mjs` `outcomeOf()` | Contracts and Deviations state it; case-insensitive |
| 4 | Codex S2 | mode-`000` test not deterministic | VALID | — | injected `readFile` that fails once |
| 5 | Claude #1 | usage reuse missing in step 2 | VALID (REGRESSION) | step 2 text | step 2 starts with the reuse rule |
| 6 | Claude #3 | lock-reclaim test cannot fail | VALID | — | test keeps the first holder alive; Harness constraint for the rename guard |
| 7 | Claude #4 | busy-lock test `cmd` | VALID | `lockState()` compares the `ps` command | `ps -p <pid> -o command=` |
| 8 | Claude #5 | lock function signatures | VALID | — | stated, with `'ok' \| 'busy' \| 'no-ps'` |
| 9 | Claude edge | `ps` fails for own pid → wrong CLI message | VALID | `linkLock()` returns false with no `ps` | `reason` in the busy result; own CLI message |
| 10 | Claude edge | dead run with Outcome `running` | VALID (intended) | — | Contracts states it |

Found by one validator only: Codex #1, #2, #4; Claude #5–#10.

## Validation response

All findings applied except #1 (partially valid: a known limit of `run-usage.mjs`, out of scope). No owner decision was needed. Status: OPEN ITEMS — the round-4 edits were not validated by a later round.
