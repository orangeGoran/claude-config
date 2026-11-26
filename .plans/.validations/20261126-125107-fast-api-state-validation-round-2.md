# Validation round 2: 20261126-125107-fast-api-state.md

- Claude: ON (`-validation-claude-2.md`, APPROVE WITH CHANGES)
- Codex: ON (`-validation-codex-2.md`, NEEDS REWORK)
- Regressions from round 1 (diff `pre-round-1` → `pre-round-2`): one cross-reference ("steps 7 and 8" for the env change; only step 7 sets it), fixed before the round-2 snapshot. Two round-1 fixes were not complete and came back as findings: F1 (`close` does not cover an awaited POST) and F3 (random offsets in the load test).

## Findings

| ID | Validator | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| F1 | Codex B1 | `close` fires when the client hangs up, but an awaited POST can change state after that and after a GET has cached it | VALID | The handler awaits the work of many POSTs (`/api/launch`, `/api/archive`) | Step 6 (`finally` on the handler `try`), Harness constraints |
| F2 | Codex B2 | A failed build answers `String(e)` and can show internal paths | INVALID | That is the existing `catch (e)` of the handler for every route; the server answers loopback clients only; the plan does not change it | Harness constraints (noted) |
| F3 | Codex B3 + Claude B1 | The load test is flaky: random offsets of 0–5 s in a 3 s run, and a timing limit under `npm test` | VALID | (2/5)² = 16 % zero-sample runs | Step 9 (fixed offsets, `--max-state-ms`, `--max-usage-ms`, a 30 s request limit), Tests 7 |
| F4 | Claude B2 | `compare` fails for live fields (`sessions`, `run`, `worktree`, …) that the run itself changes | VALID | `planSessions()` reports the transcript mtime and size of the run's own worktree | Step 9 (fail only on projects, plan keys and `validations`; all else is "info") |
| F5 | Codex S1 | The measurement is the evidence, because synchronous work stays | RAISED BEFORE (round 1, F3) | Steps 13–14 already make the measurement decide the outcome | No change |
| F6 | Codex S2 | Clean up the cache entries of a folder that is gone | VALID | Step 2 | Step 2 |
| F7 | Codex S3 | The roadmap sentence must say "by default" | VALID | Step 10 | Step 10 |
| F8 | Claude S1 | Test 4 depends on timing; a fake slow `pgrep` on that server's PATH only makes it certain | VALID | `pipelineLive()` runs `execFile('pgrep')` with the server's PATH | Step 8, Tests 4 |
| F9 | Claude S2 | The second server needs the full env of the docs-media test (`QA_REPORTS_PORT`, `QA_HOME`, `CLAUDE_TMP`, …) | VALID | `dashboard.test.mjs` docs-media test env; without `QA_REPORTS_PORT` the server tries 4898 | Step 8 |
| F10 | Claude S3 | `apps/dashboard/restart.mjs` → `up()` is a consumer of `/api/state` | VALID (no code change) | `restart.mjs` reads `res.ok` only | Contracts |
| F11 | Claude S4 | In the page's 1 s fast mode a 2 s cache is older than one poll | VALID | `app.js` 1 s `setInterval` with `fastUntil` and `starting()`; the owner's rule "never stale longer than one poll" | Default 1000 ms: Goal, Context, Contracts, Reference, Breaking changes, steps 4 and 10, Affected files |
| F12 | Claude S5 | An empty `DASH_STATE_CACHE_MS=` gives 0; the Mirror bullet names another parse form | VALID | `Number('')` is 0 | Step 4, Reference (Mirror) |
| F13 | Claude S6 | Step 3 drops the `!rounds.has(...)` check before `hasText()` | VALID | `validationRounds()` today | Step 3 |
| F14 | Claude S7 | `compare` across branches: another merged change can cause a difference | VALID | The insights-ledger plan also changes `server.mjs` | How to verify (merge-base note) |

Found by one validator only: F1, F2, F6, F7 (Codex); F4, F8, F9, F10, F11, F12, F13, F14 (Claude). Both: F3. Raised before: F5.

## Validation response

```text
Round 2 of .plans/20261126-125107-fast-api-state.md: 14 findings. 12 applied, F2 rejected (existing loopback-only 500 answer, not changed by this plan), F5 raised before (round 1, F3). Main changes: invalidation in a finally of the request handler instead of on close; a deterministic load test (fixed offsets, limit flags, request time limit); compare fails only on project names, plan keys and validation counts; a fake slow pgrep and the full env for the cache test; cache default 1 s, because the page polls every 1 s while a plan starts and the owner's rule is "never stale longer than one poll".
```
