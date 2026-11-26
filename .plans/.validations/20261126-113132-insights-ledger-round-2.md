# Round 2 — 20261126-113132-insights-ledger

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-2.md`)
- Codex: ON — NEEDS REWORK (`-codex-raw-2.md`)
- Regressions from round 1 edits: 1 — the "newest source wins" ordering (round-1 #4) was unsafe (Codex B1/B2). Replaced, see #1.
- Round limit: the skill text says max 2 rounds; AGENTS.md (Workflow) says max 4 with an early stop. AGENTS.md wins, so round 3 runs to check these edits.

## Findings

| # | Validator | Finding | Verdict | Evidence | Fix in the plan |
| --- | --- | --- | --- | --- | --- |
| 1 | Codex B1, B2 | mtime ordering and concurrent appends unsafe | VALID (REGRESSION of round-1 #4) | — | ledger lock `insights.jsonl.lock` (pattern of `linkLock()`), stale pid replaced; last line wins; CLI retries 60 s on busy; tests |
| 2 | Codex B3, Claude edge | CLI misses `pipelineLive()` chat fallback | PARTIALLY VALID | `server.mjs` `pipelineLive()` → `chatActiveIn()` | not added: a chat does not write the run log, and a later report change makes a new line; recorded as a deviation |
| 3 | Codex B4, Claude S9 | generic projects scanned | VALID | `resolveProject()` `hasPipeline` | server filters `hasPipeline`; `registryProjects()` checks `auto-pipeline.sh`; test |
| 4 | both (Codex B5, Claude B1) | `--cleanup` deletes Outcome → outcome lost | VALID | `auto-pipeline.sh` cleanup `sed_i '/^- \*\*Outcome\*\*:/d'` | status-word rule + carry-over from the previous line; tests |
| 5 | Claude B2 | subagent tests cannot fail (no meta.json; migrate test counts only) | VALID | `run-usage.mjs` `loadSubagents()` reads `agent-*.meta.json` `toolUseId` | fixture with meta file; asserts on `phases.test.cost` in both tests |
| 6 | Claude S1 | `applyCosts` second argument named "report" | VALID | `applyCosts(parsed, report)` takes the `phaseRows()` result | step 2 wording |
| 7 | Claude S2 | live check needs the report first; `isLive` argument | VALID | — | step 5 order; `isLive(name, slug)` |
| 8 | Claude S3, Codex S1 | `pgrepLive` errors; untested | VALID | `pipelineLive()` treats every error as not live | every error → false; fake `pgrep` test |
| 9 | Claude S4 | Launched parse | VALID | — | format check, else null; test |
| 10 | Claude S5 | PR regex differs from the writer's | VALID | `sync_report_outcome` `^PR: *` | regex aligned |
| 11 | Claude S6 | template-copy import risk | VALID | — | deviation note |
| 12 | Claude S7 | `npm test` claim half true | VALID | `test/bootstrap-project.test.mjs` runs the template self-test | Harness constraints wording |
| 13 | Claude S8, Codex S2 | 40 MB limit not strict, logs only | VALID | — | step 5 and docs say so |
| 14 | Claude edge | two entries with the same runs folder | VALID | — | dedupe by `autoRunsDir`; test |
| 15 | Claude edge | entry with no name or root | VALID | — | skipped in `registryProjects()`; test |
| 16 | Claude edge | re-launch appends to the same log | VALID | `auto-pipeline.sh` `>> "$4"` | Goal states one line per slug |

Found by one validator only: Codex #1, #2; Claude #5–#7, #9–#12, #14–#16.

## Validation response

All findings were applied, except #2 (partially valid, recorded as a deviation with the reason). No owner decision was needed.
