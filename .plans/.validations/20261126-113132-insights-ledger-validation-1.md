**Validation round:** 1

## Plan validation: 20261126-113132-insights-ledger.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The plan's structure, wiring and symbols are right. All run-usage.mjs exports exist with the stated signatures, and importing that file from apps/dashboard is safe. Four gaps would give wrong data or a broken test: no default for `projectsDir`, a null `usage` that throws, a `findings` regex that picks the wrong number on real reports, and an end-to-end step that starts a second server on a port that is already in use.

### Verified (no finding)

- `.claude/scripts/run-usage.mjs` exports `parseLog(text)` (:67), `loadSubagents(sessionIds, projectsDir)` (:131), `phaseRows(parsed, subagents)` (:194) and `applyCosts(parsed, report)` (:340), which returns `{ total, source, crossCheck, thinking }` (:366). The `source` values are `'model_usage'` / `'total_cost_usd'` (:344-345). Rows have `name`, `cost`, `wall`, `active` (:172, :286-288), and `report.sessions[].rows[]` (:291). `sumModelUsage` is not exported (:45), and the plan does not import it.
- The main guard at run-usage.mjs:441 compares `realpathSync(process.argv[1])` with the file's own path. When server.mjs or a test imports the file, `argv[1]` is another file, so `main()` does not run. The import path `../../.claude/scripts/run-usage.mjs` from `apps/dashboard/` resolves to the repo file, which git tracks.
- `watchTick()` (server.mjs:2070-2096) has the `for (const p of projects)` loop inside a `try`. `allProjects()` (:247) maps `resolveProject()` (:187-213), which returns `name` and `autoRunsDir` (:195, :204). `redact` is imported from watch.mjs (:39). `resolveProject` is not exported, and server.mjs starts the server when imported, so the deviation is justified.
- The watcher.test.mjs helpers exist: `makeRepo` (:144), `register` (:125), `until` (:112), `mainEnv` (:110), `startServer` (:90), `stop` (:105, by child process), `TICK` (:20), `sleep` (:19). `mainEnv()` uses `envFor(home, …)`, which sets `HOME: h` to the throwaway home (:83-84, :176).
- The `--help` Files block (server.mjs:92-96) exists. `docs/plans-dashboard.md` has "Environment" at :320, after "Waits for and the event watcher" (:276). `docs/roadmap.md` has "Parent plans" (:24). `changelog-validate.mjs` exists, and `changelog.d/AGENTS.md:8` names the same command. `npm test` is `node --test apps/*/test/*.test.mjs test/*.test.mjs` (package.json:7), so the new test file runs.
- Report regexes against auto-pipeline.sh: `- **Mode**: $STOP_AFTER (...)` (:761), `- **Outcome**:` (:149, :762), `- **Launched**: $(now)` (:763), `## Status:` (:765), `PR: https://…` (the script's sed :150, and real report line 14 `PR: https://github.com/.../pull/11`). These match.
- The settings.json owner step: earlier run logs in `.plans/auto-runs/` show that the headless runs were refused writes to `.claude/`. Marking the step owner-by-hand is reasonable.

### Blocking issues

- [Edge case / wrong data] `projectsDir` has no default. Step 4's `syncLedger({ …, projectsDir, … })` names no default, and Step 6 calls `syncLedger({ projects, limit: 20 })` without it. — run-usage.mjs:134 (`existsSync(projectsDir) ? … : []`) — With `undefined`, `loadSubagents` finds no folder, so no subagent tokens are counted. The cost is then shared over the main-session rows only, and every phase cost in the ledger is wrong (verify and its code-review subagents get too little). The line is never written again while the log stays the same. The same gap lets an in-process unit test that forgets `file` or `projectsDir` read the real `~/.claude/projects` or write the real `~/.claude/pipeline-dashboard/insights.jsonl`. — Fix: give `syncLedger` and `runRecord` the default `projectsDir = path.join(os.homedir(), '.claude', 'projects')`, the same as `main()` (run-usage.mjs:420). In Tests / Harness constraints, state that every in-process `syncLedger`/`readLedger` call passes `file` and `projectsDir` inside the `mkdtempSync` folder.
- [Edge case / crash] Step 2 says "the tokens summed from `parsed.results[].usage.tokens`". — run-usage.mjs:46 (`if (!mu …) return null`) and :101 (`usage: sumModelUsage(o.model_usage_since_last_result)`) — A result line without `model_usage_since_last_result` has `usage === null`, so `.usage.tokens` throws a TypeError. That is exactly the `costSource: 'total_cost_usd'` case that the Contracts name. That log then counts as an error on every tick, forever, and never gets a line. — Fix: sum `r.usage?.tokens` and skip null. Add a unit test: a log whose result lines have only `total_cost_usd` → `cost` set, `costSource` is `total_cost_usd`, tokens `{0,0,0,0}`, no error.
- [Owner decisions / wrong data] `findings` with the regex `(\d+) findings` (Step 2, Contracts). — In the real report `.plans/auto-runs/20261125-210049-review-loop-caps.md:91`, the first match is "Claude 2 findings" (round 1 only), while the run had F1–F8. Parent plan :32 keeps "the run reports give review rounds and findings in free text … Decide in the plan" as an open decision of plan 3. — The regex writes wrong numbers into a ledger that is meant to outlive the reports, and it takes part of plan 3's open decision. — Fix: in v1, write `findings: null` (or leave the field out) and say that plan 3 decides the format. Keep `reviewRounds` only if the plan states which match it takes (first) and accepts that it is a best guess. Otherwise also leave it to plan 3.
- [Tests / broken step] End-to-end case: "Start the server with `mainEnv()`". — watcher.test.mjs:184-186 starts the shared `server` in `before()` on `port`, with `mainEnv()`. The other cases only `register()` and wait (for example :553-559). — A second `startServer(mainEnv())` binds the same `DASH_PORT` and fails ("server exited"). It would also fight over watcher.lock. — Fix: use the running shared server. Call `makeRepo('ledger-demo')`, write the two files, `register([{ name: 'ledger-demo', root }])`, then `until(...)` on the ledger file. At the end, `unregister(['ledger-demo'])`, like the sibling cases.

### Non-blocking concerns

- [Edge case / performance] The 20 logs per tick are read and parsed synchronously in the server process. The real logs are 3.5 MB to 14.7 MB each (measured with `ls -la .plans/auto-runs/`: for example `…-session-tabs-and-command-palette.log` 14696620 bytes). The first tick after deploy can parse about 150+ MB of JSON on the event loop and block `/api/state` for seconds. — Lower the server limit (for example 3), or add a byte budget per tick. Tell the owner in the docs to run `--migrate` once after the restart.
- [Edge case / idempotency] Logs that give `empty` (no result line) or `errors` have no ledger line, so the "same size and mtimeMs" skip never applies. They are read and parsed again on every tick, forever. — Let `syncLedger` take an optional `seen` Map (`file → {size, mtimeMs}`) that the server keeps between ticks. Or write a line with `cost: null` for a finished log with no result line (a preflight-BLOCKED run is a finished run, and plan 3's run outcomes would need it).
- [Docs: current state] Step 10 writes "plan 1 (insights ledger) is planned" into `docs/roadmap.md`. The pipeline moves the plan to `.plans/done/` in the same commit, so the text is wrong at merge. — Follow docs/roadmap.md:34: "plan 1 (`.plans/done/20261126-113132-insights-ledger.md`) is done; plans 2 and 3 are not written yet".
- [Follow existing pattern] `staleMs = 30 * 60 * 1000` duplicates `STALE_RUN_MS` (server.mjs:1717). The server's own "running" rule (watch.mjs:97-101) uses the report mtime, the live process and the CLEANED check, not the log mtime. — Pass `staleMs: STALE_RUN_MS` from the server, and say in Deviations why the log mtime is used.
- [Contracts] `launched` comes from the report as local time without a zone ("2026-11-25 21:41:13", review-loop-caps.md:10), while `ended` is ISO. — Normalise `launched` to ISO, or document the two formats in Contracts so that plan 2 does not compare them as strings. The fallback "the log's first line time" is vague: name the field (run-usage `tsOf`, which is not exported).
- [Tests] "The sum of `phases[].cost` is 3.75": the row costs are `cents/100` floats, and the `whole run`/`preflight` rows can have `cost: null` when the weights are 0 (run-usage.mjs:356-364 puts the rest on `unattributed`). — Compare with rounding to cents, and treat null as 0. Say how `phases` stores a null `wall`/`active` and how `minutes` skips null.
- [Scope / Goal wording] The goal says "every registered project", but only `autoRunsDir` is read. Generic-flavor projects keep their logs in `~/.claude/pipeline-dashboard/logs/<name>/` (server.mjs:209). — State in the Goal and the docs that only pipeline projects are covered.
- [Commands] AGENTS.md (Commands) says: add a command "here (and to `.claude/settings.json` `permissions.allow`) in the same change". — Say that the run lists step 11 under Open items, and that the owner adds the allow rule to the PR branch before the merge.
- [Concurrency] `--migrate` while the watcher ticks: both can append the same pair. Last-wins makes this harmless, but say so in the docs. Note also that `.plans/20261126-113131-plans-insights-parent.md` is untracked (git status), so push it with the plan, or the roadmap link and the run's `Parent` read fail in the worktree.
- [Tests] The harness constraint relies on `run-usage.selftest.mjs` for the subagent part, but that file is not in the `npm test` glob (package.json:7). It runs only with its own command (AGENTS.md Commands). State this.
- [Docs] README.md:79-87 has a short command table ("AGENTS.md … has the full list"). Optional: no change is needed.

### Edge cases the plan should address

- A result line without `model_usage_since_last_result` (`usage: null`): the `total_cost_usd`-only path.
- A finished log with no result line (preflight BLOCKED) or an unreadable log: the same work on every tick.
- The first tick after deploy with many large logs: the event loop is blocked.
- The pipeline appends launcher text to the log after the report's Outcome changes: a second line for the same run (harmless, last wins). Say so.
- A resume appends to the same `<slug>.log`: a new line with the new totals is correct. Test that `launched` stays the first launch, or document which one it is.
- `--migrate` and the watcher at the same time: duplicate lines.
- The registry has a project whose `autoRunsDir` does not exist: `readdirSync` throws. Count it, or skip it without an error.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified (staleMs literal is a small silent deviation)
- [x] Breaking changes for changed symbols listed (consumer search done: only `watchTick` changes; run-usage is read-only)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [ ] Scope stays inside the goal; no open decision is taken silently (`findings` regex touches plan 3's open decision)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no endpoint added)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (e2e step starts a conflicting server; null-usage case untested; in-process tests must pin `file`/`projectsDir`)
- [ ] Docs: current state only respected (roadmap "is planned" text is wrong at merge)
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261126-113132-insights-ledger.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Give runRecord and syncLedger the default projectsDir = path.join(os.homedir(), '.claude', 'projects') (as run-usage main() does), and state in Tests/Harness constraints that every in-process syncLedger/readLedger/runRecord call passes file and projectsDir inside the mkdtempSync folder (evidence: .claude/scripts/run-usage.mjs:134, :420; plan Step 6 passes no projectsDir).
2. Sum tokens with r.usage?.tokens and skip null; add a unit test for a log whose result lines have only total_cost_usd (cost set, costSource 'total_cost_usd', zero tokens, no error) (evidence: .claude/scripts/run-usage.mjs:46, :101).
3. Drop the `(\d+) findings` regex: write findings: null in v1 and say plan 3 decides the format; for reviewRounds, state which match is taken or also leave it to plan 3 (evidence: .plans/auto-runs/20261125-210049-review-loop-caps.md:91; parent plan :32).
4. In the end-to-end case, do not start a server: use the shared server of watcher.test.mjs, register the repo, wait with until(), and unregister at the end (evidence: apps/dashboard/test/watcher.test.mjs:184-186, :553-580).

SHOULD FIX:
1. Lower the per-tick limit (for example 3) or add a byte budget, because the real logs are 3.5-14.7 MB and the parse is synchronous; tell the owner to run --migrate once after the restart (evidence: ls -la .plans/auto-runs/).
2. Stop re-parsing empty or error logs on every tick: an in-memory seen Map (file → size+mtimeMs) passed by the server, or a ledger line with cost null for a finished log with no result line (evidence: plan Step 4 skip rule only applies to pairs in the ledger).
3. Write the roadmap entry as done, with the .plans/done/ path, like docs/roadmap.md:34.
4. Pass staleMs: STALE_RUN_MS from the server and say why the log mtime is used instead of the report mtime (evidence: apps/dashboard/server.mjs:1717; apps/dashboard/watch.mjs:97-101).
5. Normalise launched to ISO, or document its local-time format in Contracts; name the exact source of the "log's first line time" fallback (evidence: review-loop-caps.md:10).
6. Compare the phase-cost sum with cent rounding, and state how null cost/wall/active are stored and skipped in minutes (evidence: run-usage.mjs:356-364).
7. Say that only pipeline projects (autoRunsDir) are covered, not generic-flavor logs (evidence: apps/dashboard/server.mjs:209).
8. Say that the run lists step 11 under Open items and that the owner adds the allow rule to the PR branch before the merge (evidence: AGENTS.md Commands paragraph).
9. Note that run-usage.selftest.mjs is not in the npm test glob (evidence: package.json:7).

ADD THESE EDGE CASES:
- A registered project whose autoRunsDir does not exist: skip it without an error.
- --migrate while the watcher ticks: duplicate lines are harmless (last wins); say so in the docs.
- A resume that appends to the same log: the new line replaces the old one; state which Launched value it keeps.
- Launcher text appended after the Outcome changes: a second line for the same run is expected.

Do not change anything the validation did not flag.
```
