**Validation round:** 2

## Plan validation: 20261126-113132-insights-ledger.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round-1 fixes are in the plan and match the source: the `pipelineLive(proj, slug)` call, `fence`/`LOST_LOCK`/`STALE_RUN_MS`, `copyDashboard()` and its copy test, and the watcher-test helpers. One real data defect is left: `--cleanup` deletes the report's Outcome line, so the last ledger line of every shipped run gets `outcome: null` and loses the outcome it had. Two test cases also cannot fail as written: the subagent attribution case and the CLI default-`projectsDir` case.

### Round-1 fixes checked against the source

- #1 `projectsDir` default: fixed. Steps 2 and 5 use `path.join(os.homedir(), '.claude', 'projects')`, the same as `main()` in `.claude/scripts/run-usage.mjs:420`. But the CLI test cannot prove it (see B2).
- #2 report-only change: fixed. `src` holds the log and report size and mtime (Contracts line 32), and there is a unit test (Tests line 127).
- #3 live run: fixed. `pipelineLive` is `const pipelineLive = (proj, slug) => new Promise(...)` (`apps/dashboard/server.mjs:397-404`). It needs a resolved project (`proj.name`, `proj.worktrees`, `proj.legacyWorktrees` via `worktreeOf`, `server.mjs:393-396,403`). Step 8 passes `projects.find((x) => x.name === p) || p`, and `projects` is `allProjects()` (`server.mjs:2081`, resolved objects, `server.mjs:247`). That works when `p` is the name or the object. `pgrepLive()` copies the pattern and the escape of `server.mjs:401`.
- #5 copy: fixed. `copyDashboard(dest)` copies only `apps`, `scripts`, `skills` and `docs` (`scripts/docs-media.mjs:57-58`). Step 7 adds `.claude/scripts/run-usage.mjs`. The copy test is at `apps/dashboard/test/dashboard.test.mjs:1604-1626`, with the file list at line 1622. Breaking changes names the watcher-test consumers (`watcher.test.mjs:705-735` and `737-767`). Those tests run `git add -A` on the copy, so a worktree of it also gets the new file.
- #6 null usage: fixed. `parseLog` sets `usage: sumModelUsage(...)`, which is null with no model usage (`run-usage.mjs:45-46,101`). The plan uses `r.usage?.tokens`.
- #7 fence: fixed. `LOST_LOCK` (`server.mjs:1739`) and `fence` (`server.mjs:1746`) exist. The loop at `server.mjs:2089-2092` throws `LOST_LOCK` again, and step 8 does the same.
- #9 shared server: fixed. The shared server starts in `before()` with `mainEnv()` (`watcher.test.mjs:172-187`). `register` and `unregister` take `(entries|names, h = home)` (`watcher.test.mjs:125-126`). `makeRepo(name, …)` makes `.plans/auto-runs` and the fake `auto-pipeline.sh` (`watcher.test.mjs:144-154`). `until(fn, what, ms)`, `sleep` and `TICK = 300` exist (`watcher.test.mjs:19-20,112`).
- #14 stale time: fixed. `STALE_RUN_MS = 30 * 60 * 1000` (`server.mjs:1717`) has the same value as `DEFAULT_STALE_MS`.
- The other fixes (#4, #8, #10–#13, #15–#21) are in the plan, and I found no regression from them. The roadmap entry format matches `docs/roadmap.md:26-34`. "Environment" is a section of `docs/plans-dashboard.md:320`. `changelog-validate.mjs` exists in `.claude/scripts/`. `audience: internal` is valid (`changelog.d/README.md:29`).

### Blocking issues

1. [Edge cases / wrong data] After `--cleanup`, the newest ledger line of every shipped run has `outcome: null`. Evidence: `--cleanup` sets `## Status: CLEANED — …` and runs `sed_i '/^- \*\*Outcome\*\*:/d'` on the report (`.claude/scripts/auto-pipeline.sh:577-582`). That changes the report's size and mtime, so `syncLedger` makes a new line. It waits 30 minutes first ("no Outcome line" counts as live, step 5 line 97). The new line has the newest source, so it becomes the valid line (Contracts line 43), and step 2 gives null for a missing Outcome (line 92). Cleanup is a normal step of the workflow (AGENTS.md, Workflow: "merge → `auto-pipeline.sh --cleanup <slug>`"), so most shipped runs end with no outcome. Old reports with no Outcome line also get null. The dashboard does not leave those null: when the line is missing, it uses the status words (`docs/plans-dashboard.md:131`). Why it breaks: the parent plan's goal is a history that stays when the files change (parent plan line 7). Plan 3 needs "run outcomes" (parent plan line 31), and here the last line deletes a known value. Fix: when the report has no Outcome line, take the outcome from the status words with the rule of `docs/plans-dashboard.md:131`. A `CLEANED` status keeps the `outcome` of the pair's previous valid line (or a fixed value such as `needs-you`, but state which one). Add a unit test: a report with Outcome `needs-you` → cleanup edit → the valid line still has `needs-you` and `status` starting with `CLEANED`. Also add one line about it to the docs section of step 11.

2. [Tests that cannot fail] Two cases cannot fail as written. (a) The subagent case (Tests line 123) writes only `subagents/agent-1.jsonl`. `loadSubagents` links a transcript to its Agent call only through the `toolUseId` of `agent-1.meta.json` (`run-usage.mjs:146-153`). Without it, the tokens go to an `unattributed` row (`run-usage.mjs:260-262`), so "the phase that started the Agent call has a larger cost share" is false, or it is true only by chance. (b) The CLI case (Tests line 133), the round-1 fix #1, puts a transcript under `<HOME>/.claude/projects/` but asserts only the counts and the line count. A wrong `projectsDir` default would still pass. The ledger `tokens` come only from result lines (Contracts line 40), so the transcript changes only `phases`. Fix: (a) write `agent-1.meta.json` with `{"toolUseId":"<id of the Agent tool_use in the fixture>"}`, and give the fixture an assistant line with that `Agent` tool_use after a phase marker. (b) In the CLI test, assert a `phases` value that only the transcript gives. Example: with no meta file, `phases.unattributed` exists and has a cost > 0. With a meta file, the target phase cost is larger than in the same run when the transcript is missing.

### Non-blocking concerns

1. [Clarity] Step 2 says `applyCosts(parsed, report)`. In `run-usage.mjs:340`, `report` is the result of `phaseRows()`, not the run report. The plan also uses "report" for the `.md` file. Write `const rows = phaseRows(parsed, subagents); applyCosts(parsed, rows)`.
2. [Clarity] Step 5: the live check (bullet 2) needs the report's Outcome, but the report is read only in bullet 4. Say that bullet 2 reads the report (it is small). Also say whether `isLive` gets the project name or the object. Step 8 handles both, but the default `(p, slug) => pgrepLive(slug)` and the unit tests should agree with one.
3. [Edge case] `pgrepLive()`: "exit code 1 gives false" does not cover other errors (pgrep missing, exit 2/3). `pipelineLive()` treats every error as "not found" (`server.mjs:401-403`, `!err`). Mirror that: any error gives false.
4. [Parsing] `launched`: `new Date('2026-11-20 10:00:00')` is not an ES-spec date format. Parse it as `YYYY-MM-DDTHH:MM:SS` (local time) and return null for a bad value. Make the unit test check the exact ISO value for the test's time zone, or the round trip, not only "an ISO string".
5. [Regex] The report's PR regex is `^PR: (https://…)`. `sync_report_outcome` accepts `^PR: *` (any number of spaces, `auto-pipeline.sh:150`). Use `^PR: *(https://\S+/pull/(\d+))` to match the writer.
6. [Coupling] `insights.mjs` imports `.claude/scripts/run-usage.mjs`. That file is a copy of the bootstrap template (`skills/bootstrap-project/templates/core/dot-claude/scripts/run-usage.mjs`; its header says "The same in every repo that has this script"). A later template upgrade that renames `parseLog`, `loadSubagents`, `phaseRows` or `applyCosts` breaks the dashboard start. Name this in Breaking changes or in the docs section. The insights tests catch it, because they import the real file.
7. [Accuracy] Harness constraints line 146: "`npm test` does not run `run-usage.selftest.mjs`" is half true. `test/bootstrap-project.test.mjs:882-892` runs the template copy's self-test inside `npm test`. It does not run the repo copy's self-test. Write it that way.
8. [Performance] `syncLedger` reads and parses up to 40 MB per tick on the server's event loop, and `loadSubagents` reads transcripts that `maxBytes` does not count. One tick can block HTTP for a second or more while the ledger fills. The plan gives no measurement of the parse time. That is acceptable, but say in step 8 that `maxBytes` counts only log bytes, or count the transcript bytes too.
9. [Scope] The server passes all projects, generic ones too. A generic project with no `.plans/auto-runs/` is counted in `missing` on every tick, and the CLI prints that count. Filter on `hasPipeline` in the server (and on the launcher-script check in `registryProjects()`), or say that `missing` includes generic projects. This matches the Goal's Scope line.

### Edge cases the plan should address

- Two registry entries with the same `root`/`plansDir` but different names. The same runs get two ledger lines, so plan 2 counts the spend twice. Skip a second project with the same `autoRunsDir`, or document it.
- A registry entry with no `name` or no `root` (`registryProjects()`): skip it, do not throw.
- A re-launch of the same slug after cleanup appends to the same `<slug>.log` (`start_session` writes with `>> "$4"`, `auto-pipeline.sh:494`) and writes a new report (`cat > "$report"`, `auto-pipeline.sh:754`). The ledger keeps one line per slug with the cost of both runs added together, not one line per run. Say this in the Contracts section and in the docs section, because the Goal says "one JSON line per finished pipeline run".
- A post-run chat in the worktree makes `pipelineLive()` true (`chatActiveIn`, `server.mjs:403`). The line waits while the owner chats. This is harmless, but put it in the docs section ("when a run counts as finished").

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `copyDashboard` in `scripts/docs-media.mjs:68`, `dashboard.test.mjs:1608-1619`, `watcher.test.mjs:708-714,740-746`; `watchTick` has no other caller)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently (review rounds and findings stay out, as the parent plan leaves them to plan 3)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no endpoint in this plan)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (B2: two cases cannot fail; B1: no cleanup case)
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; the new format is defined in the plan)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261126-113132-insights-ledger.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Keep the outcome of a run after --cleanup. The cleanup deletes the report's Outcome line and sets "## Status: CLEANED — …" (evidence: .claude/scripts/auto-pipeline.sh:577-582), so the newest ledger line would get outcome null. In Contracts and step 2: when the report has no Outcome line, take the outcome from the status words with the rule of docs/plans-dashboard.md:131 (VERIFIED, REVIEWED, COMMITTED, FINISHED and PR OPEN mean needs-you; BLOCKED, FAILED and ENDED mean failed). A CLEANED status keeps the outcome of the pair's previous valid line (state this rule). Add a syncLedger unit test: Outcome needs-you → the cleanup edit → the valid line still has outcome needs-you and a status that starts with CLEANED. Add one sentence about it to the docs section of step 11.
2. Make the two subagent tests able to fail. (a) In the runRecord transcript case, also write <projectsDir>/<folder>/<session id>/subagents/agent-1.meta.json with {"toolUseId": "<id>"}, and give the fixture log an assistant line with an Agent tool_use of that id after a phase marker (evidence: .claude/scripts/run-usage.mjs:146-153, 259-262). (b) In the --migrate CLI case, assert a phases value that only the transcript in <HOME>/.claude/projects/ gives (for example, phases.unattributed exists with cost > 0 when there is no meta file), so a wrong projectsDir default fails the test.

SHOULD FIX:
1. In step 2, write `const rows = phaseRows(parsed, subagents); applyCosts(parsed, rows)`. The second argument of applyCosts is the phaseRows result, not the run report (evidence: .claude/scripts/run-usage.mjs:340,348).
2. In step 5, say that the live check reads the report's Outcome (the report is read before bullet 2), and say that isLive gets the project name (or the object), the same in the default and in the tests.
3. In step 4, any pgrep error gives false, the same as pipelineLive (evidence: apps/dashboard/server.mjs:401-403).
4. In step 2, parse Launched as `YYYY-MM-DDTHH:MM:SS` local time, and give null for a bad value. In the unit test, check the exact ISO value, not only "an ISO string".
5. In step 2, use the PR regex `^PR: *(https://\S+/pull/(\d+))` to match the writer (evidence: .claude/scripts/auto-pipeline.sh:150).
6. In Breaking changes or the docs section, say that the dashboard now imports the bootstrap-template copy .claude/scripts/run-usage.mjs (parseLog, loadSubagents, phaseRows, applyCosts). A template upgrade that renames them breaks the server start.
7. In Harness constraints, change "npm test does not run run-usage.selftest.mjs" to "npm test runs the template copy's self-test (test/bootstrap-project.test.mjs:882-892), not the repo copy's".
8. In step 8, say that maxBytes counts only log bytes (the subagent transcripts are not counted), or count them too.
9. In step 8 and in registryProjects(), pass only pipeline-flavor projects (hasPipeline, or the launcher-script check), or say that `missing` counts generic projects on every tick.

ADD THESE EDGE CASES:
- Two registry entries with the same autoRunsDir under different names: skip the second one, so the spend is not counted twice.
- A registry entry with no name or no root: registryProjects() skips it.
- A re-launch of the same slug after cleanup appends to the same <slug>.log (auto-pipeline.sh:494) and writes a new report (auto-pipeline.sh:754). The ledger keeps one line per slug with the cost of both runs added together. State this in Contracts and in the docs.
- A chat in the run's worktree makes pipelineLive() true (server.mjs:403), so the line waits while the owner chats. State it in the docs section.

Do not change anything the validation did not flag.
```
