# Validation round 1: 20261126-125107-fast-api-state.md

- Claude: ON (`-validation-claude-1.md`, APPROVE WITH CHANGES)
- Codex: ON (`-validation-codex-1.md`, NEEDS REWORK)
- Regressions from the previous round: none (first round of this run)

## Findings

| ID | Validator | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| F1 | Codex B3 + Claude B1 | `watcher.test.mjs` → `envFor()` has no `DASH_STATE_CACHE_MS=0`, and its tests read `/api/state` right after changes | VALID | `apps/dashboard/test/watcher.test.mjs` `envFor()`, `startServer()` probe, `plan()` | Step 7, Affected files, Contracts, Breaking changes, Hard rules, Tests 6, How to verify |
| F2 | Codex B2 | The parallel test does not prove in-flight sharing: the start probe builds the state, and a build with no real await never overlaps | VALID | `dashboard.test.mjs` `start()` probes `/api/state`; a non-pipeline `listPlans()` has no real await | Step 8 (pipeline fixture, `/api/usage` probe), Tests 4 |
| F3 | Codex B1 | The shared promise does not remove synchronous work; the outcome and the release note must follow the measurement | PARTIALLY VALID | Fix A removes most of the work; the result is unknown until it is measured | Step 13 (measure first, "goal not met"), step 14 (release note text from the measurement) |
| F4 | Codex B4 | A cleanup by port can stop a process that was there before | PARTIALLY VALID | The server exits on `EADDRINUSE` (`server.on('error')`), but `lsof` would then show the other process | Hard rules, How to verify (check that the port is free first) |
| F5 | Codex S1 | The load script must fail on a non-200 answer, a bad body, zero samples or bad arguments | VALID | Step 9 | Step 9, Tests 7 |
| F6 | Codex S2 | The changelog audience must be `both` for a change the user sees | VALID | `changelog.d/README.md` "When unsure, use `both`" | Step 14 |
| F7 | Codex S3 + Claude | `scripts/docs-media.mjs` is a consumer of `/api/state` | VALID (no code change) | `scripts/docs-media.mjs` `startDashboard()` writes the world before the start | Contracts |
| F8 | Claude | Store the mtime of the stat taken before the listing | VALID | Step 2 | Step 2 |
| F9 | Claude | The error handling of the promise is not specified, and the server has no `unhandledRejection` handler | VALID | `grep unhandledRejection server.mjs`: no match; the handler's `catch (e)` answers 500 | Step 4 |
| F10 | Claude + Codex edge | A build of 2 s or more never gets a cache hit when the window starts at the build start | VALID | Planner measurement 2.57–2.78 s | Step 4 (`doneAt`), Reference deviations, Contracts, Breaking changes |
| F11 | Claude + Codex edge | Use `close`, not `finish`, so a POST whose client hung up still clears the cache | VALID | Node `res` 'close' fires in both cases | Step 6, Harness constraints |
| F12 | Claude | The header test passes with no header (`undefined === undefined`) | VALID | Tests 4 | Tests 4 and 5 (`/^\d+$/`) |
| F13 | Claude | The allow rule form is `Bash(<cmd> *)`, not `:*` | VALID | `.claude/settings.json` `"Bash(node .claude/scripts/run-usage.mjs *)"` | Step 12, Affected files |
| F14 | Claude | `compare` must accept live fields (`pr`, `prError`, `reportAt`, `summary`) | VALID | Two servers read gh and the summaries at different times | Step 9 (the "changing" paths) |
| F15 | Claude | `state-load.mjs` has logic but no test | VALID | AGENTS.md hard rule "Tests for logic changes" | Step 9, Tests 7, Affected files |
| F16 | Claude | A `DASH_STATE_CACHE_MS` that is not a number turns the cache off | VALID | `+'abc'` is `NaN` | Step 4, Contracts |
| F17 | Claude | Unit tests 1–3 pass on today's code | PARTIALLY VALID | They guard the cache keys against a naive cache (they fail with a path-only key or a never-refreshed index); tests 4 and 5 prove that the cache exists | No change |
| F18 | Claude | The owner's counts (634 plans, 3341 files) have no command | INVALID | The plan marks them as the owner's measurement in Context; the planner's numbers have their command | No change |
| F19 | Codex edge | A report replaced with the same size and mtime | VALID (document) | The same limit as `sessionIdCache` | Breaking changes |

Found by one validator only: F2, F3, F4, F5, F6 (Codex); F8, F9, F12, F13, F14, F15, F16, F17, F18 (Claude).

## Validation response

```text
Round 1 of .plans/20261126-125107-fast-api-state.md: 19 findings, 16 applied (VALID or PARTIALLY VALID with a plan change), F17 kept with no change, F18 rejected (the owner's numbers are marked as such), F7 noted as a consumer with no code change. The plan now covers the watcher harness, a deterministic in-flight test, the promise error path, a cache window from the build end, close instead of finish, the load script checks and its test, a measurement-driven release note, and a port check before the measurement servers start.
```
