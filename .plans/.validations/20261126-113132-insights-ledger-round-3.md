# Round 3 — 20261126-113132-insights-ledger

- Claude (plan-validator): ON — APPROVE WITH CHANGES, nothing blocking (`-validation-3.md`)
- Codex: ON — NEEDS REWORK (`-codex-raw-3.md`)
- Regressions from round 2 edits: 2 — the new ledger lock was not safe for stale locks and release (Codex B2, Claude #1), and the lock was taken before its folder existed (Codex B3, Claude #3). Both fixed below.

## Findings

| # | Validator | Finding | Verdict | Evidence | Fix in the plan |
| --- | --- | --- | --- | --- | --- |
| 1 | both (Codex B2, Claude #1) | stale-lock reclaim, pid reuse, unsafe release | VALID (REGRESSION) | `server.mjs` `lockState()`, `takeLock()` (rename to `.stale.<pid>` + pid compare, `ps` command compare) | full `takeLock()` algorithm copied; `EPERM` = alive; release only an own lock; tests for concurrent reclaim and release |
| 2 | both (Codex B3, Claude #3) | lock before the folder exists | VALID (REGRESSION) | `takeLock()` creates `CENTRAL` first | folder first; fresh-folder test |
| 3 | Codex B1 | report-only change re-splits phases after transcripts are gone | VALID | `applyCosts()` allocates by token weight | usage fields reused when the log is unchanged; test |
| 4 | Codex B4 | `failed` map blocks retries forever | VALID | — | entries expire after 10 min; test |
| 5 | Claude #2 | `{ busy: true }` breaks the error-log loop | VALID | step 8 logs `errors` | step 8 skips a busy result |
| 6 | Claude #4 | outcome rule differs from the dashboard | VALID | `parseReport()` (`OUTCOMES`, lower case), stale `failed` in `pipelineRunInfo()` | rule copied into Contracts; tests |
| 7 | Claude #5 | CLI test has no baseline; `input.skill` | VALID | `run-usage.mjs` `SKILL_PHASES` | baseline = empty `projectsDir`; fixture wording |
| 8 | Codex S1 | tick-time claim too strong | VALID | transcripts not in the budget | step 8 wording |
| 9 | Codex S2 | `sumModelUsage`, `sumRows` not exported | VALID | `run-usage.mjs` | Reference implementation wording |
| 10 | Codex edge | valid last line with no `\n` | VALID | — | test asserts both lines |
| 11 | Claude edge | verify re-launch keeps the old PR | VALID (intended) | — | Contracts says it is intended |

Found by one validator only: Codex #3, #4, #8, #9, #10; Claude #5, #6, #7, #11.

## Validation response

All findings were applied. No owner decision was needed. Round 4 (the last round allowed by AGENTS.md) checks these edits.
