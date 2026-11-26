# Round 1 — 20261126-113132-insights-ledger

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-1.md`)
- Codex: ON — NEEDS REWORK (`-codex-raw-1.md`)
- Regressions from the previous round: none (round 1).

## Findings

| # | Validator | Finding | Verdict | Evidence | Fix in the plan |
| --- | --- | --- | --- | --- | --- |
| 1 | both (Codex B1, Claude B1) | `projectsDir` has no default | VALID | `run-usage.mjs` `main()` defaults to `~/.claude/projects`; step 6 (old) passed none | default in `runRecord`/`syncLedger`; CLI test with a transcript under `<HOME>/.claude/projects` |
| 2 | Codex B2 | report-only changes never update the line | VALID | `auto-pipeline.sh` `sync_report_outcome` writes the report after the session ends | `src` holds the log and report size + mtime; unit test for a report-only change |
| 3 | Codex B3 | completion check too weak (quiet live run, missing Outcome) | VALID | `pipelineLive()` (pgrep) decides "live" in `server.mjs`; docs "Pipeline modes and run reports" | `isLive` (server: `pipelineLive`, CLI: `pgrepLive`) + Outcome/stale rule; tests |
| 4 | Codex B4 | watcher and CLI can race | PARTIALLY VALID | no shared lock | no cross-process lock; the reader takes the newest source, so order and duplicates are harmless; test |
| 5 | Codex B5 | `copyDashboard()` does not copy `.claude/` | VALID | `scripts/docs-media.mjs` `copyDashboard()` copies only apps, scripts, skills, docs | step 7 copies `run-usage.mjs`; copy test asserts it |
| 6 | both (Codex B6, Claude B2) | null `usage` throws on tokens | VALID | `parseLog` sets `usage: sumModelUsage(...)`, null without model usage | `r.usage?.tokens`, `tokens: null`; tests for `total_cost_usd`-only and mixed |
| 7 | Codex B7 | no `fence()` before the append | VALID | `server.mjs` `fence()` / `LOST_LOCK` | `beforeWrite: fence`, `LOST_LOCK` rethrown; unit test |
| 8 | Claude B3 | `(\d+) findings` regex picks the wrong number | VALID | real report text "Claude 2 findings"; parent plan leaves the format to plan 3 | review rounds and findings removed from v1 |
| 9 | both (Codex S2, Claude B4) | end-to-end case starts a second server | VALID | shared server in `before()` of `watcher.test.mjs` | use the shared server + `register`/`unregister` |
| 10 | Codex S1 | restart condition missing | VALID | AGENTS.md "Restart after dashboard changes" | Hard rules wording |
| 11 | both (Codex S3, Claude NB1) | work per tick not bounded; logs are several MB | VALID | validator measured 3.5–14.7 MB logs | `limit: 20` + `maxBytes: 40e6`, `deferred` count |
| 12 | Claude NB2 | empty and failing logs parsed again each tick | VALID | — | empty log → a line with `results: 0`; `failed` map by `src` |
| 13 | Claude NB3 | roadmap text wrong at merge | VALID | docs/roadmap.md entries name the `done/` path | step 12 wording |
| 14 | Claude NB4 | `staleMs` duplicates `STALE_RUN_MS` | VALID | `server.mjs` `STALE_RUN_MS` | server passes `STALE_RUN_MS` |
| 15 | Claude NB5 | `launched` and `ended` in different formats | VALID | — | both ISO |
| 16 | Claude NB6 | float cents and nulls in phases | VALID | `sumRows()` null rule | null rule + rounding in Contracts; test rounds |
| 17 | Claude NB7 | generic-flavor projects not covered | VALID | `resolveProject()` `logsDir` | Goal states the scope |
| 18 | Claude NB8 | settings.json step needs an Open items note | VALID | — | step 13 |
| 19 | Claude NB9 | duplicates from `--migrate` during the watcher | VALID | — | covered by #4 |
| 20 | Claude NB10 | `npm test` does not run `run-usage.selftest.mjs` | VALID | `package.json` test glob | transcript cases in the new tests; Harness constraints |
| 21 | Codex edge cases | missing dir, partial last line, changing files, CLI exit code | VALID | — | `missing`, `\n` repair, `changing`, exit 1 on errors; tests |

Found by one validator only: Codex #2, #3, #4, #5, #7 and the edge cases; Claude #8, #12–#18, #20.

## Validation response

All findings were applied, except #4, which is partially valid: a cross-process lock is replaced by a "newest source wins" rule in the reader. No owner decision was needed.
