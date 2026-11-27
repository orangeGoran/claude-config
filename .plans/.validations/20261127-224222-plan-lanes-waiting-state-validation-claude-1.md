**Validation round:** 1

## Plan validation: 20261127-224222-plan-lanes-waiting-state.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues
- [Edge cases / wrong data] `waitingPlans` is built from all `plans` (Step 6: `plans.filter((p) => p.waits && !p.waits.met)`), so a plan that already runs or has shipped still shows in `WAITING`, counts in `waitingCount`, and creates `sharesWithWaiting` warnings. — evidence: the watcher never checks a plan again once it has a run (`apps/dashboard/server.mjs:2105` `if (next.launched[p.slug] || p.run) continue;`), so a plan that the owner launched by hand before its condition was met never gets `met[slug] = true` (`server.mjs:2121-2122`). plan-lanes marks such a plan as `in-flight` or `shipped` (`plan-lanes.mjs:295-300`), and a shipped plan stays in `.plans/` of the main checkout until the merge is pulled. — why it breaks: the same plan shows in `IN FLIGHT / AWAITING REVIEW` and in `WAITING (starts by itself when its condition is met)`, which is false. A batch plan gets an extra `!! … waiting plan … which starts by itself` line next to the real `blockedByActiveRun` line (`plan-lanes.mjs:394-401`) for the same run. — fix: build `waitingPlans` only from plans that are not occupied and not shipped, for example `plans.filter((p) => p.waits && !p.waits.met && !occupied(p.runState) && p.runState !== 'shipped')` (or from `schedulable`, if docs-only waiting plans may drop out of the list). Keep `plans[].waits` for every plan. Add a test: a waiting plan with a live generic run (`<HOME>/.claude/pipeline-dashboard/state/acme-api/runs.json` = `{ "<slug>": { "pid": <test pid>, "exitCode": null } }`, read at `plan-lanes.mjs:85,238-239`) is in `inFlight` and not in `waiting`, and a batch plan that shares files with it has no `sharesWithWaiting` entry.

### Non-blocking concerns
- [Edge cases] A parked or proposed plan with a not-met `Waits for:` line is listed as "starts by itself", but the watcher never starts it (`apps/dashboard/watch.mjs:115` `plan.status !== 'parked' && plan.status !== 'proposed'`, `server.mjs:2142`). — plan-lanes already has the status (`plan-lanes.mjs:369`). Suggestion: for these plans, set the note to "parked: the watcher does not start it" (or leave them out of `waiting`), and say so in the SKILL.md `WAITING` row.
- [Tests] `lanesWith()` writes a fixed body from a title only (`test/bootstrap-project.test.mjs:407`), so it cannot write a `Waits for:` header or a fence. Step 10 adds only `writeWatch()`. Suggestion: name a second helper (for example `lanesRaw(c, { slug: text }, json)`) that writes full plan texts and runs the script like `lanesWith()` (lines 409-412), or write the plans inline as the test at lines 456-465 does.
- [Contracts / staleness] `checkedAt` is set only when the PR read of step 1 works (`server.mjs:2055-2059`); step 5 (waits) runs every tick also when the PR read fails. So with a broken `gh` the note says "last checked N min ago" while the watcher still checks submodule conditions. The plan describes `checkedAt` correctly in **Contracts**; add one line to Known limits so the follow-up plan (a per-condition result) also writes its own time.
- [Staleness] `WAIT_STALE_MS` is fixed at 10 minutes, but `DASH_WATCH_MS` can be set higher (`server.mjs:1815`). With `DASH_WATCH_MS=900000` every result shows as stale. Acceptable for now; one line in the Deviations would make it explicit.
- [Edge cases] `waitStateOf()` crashes on a `watch.json` that holds `null` (`readJson` returns `null`, then `Object.keys(null)` throws; `plan-lanes.mjs:89`). `saveWatch()` never writes `null` (`server.mjs:1899-1905`), so this needs a hand edit. Suggestion: `const watch = readJson(WATCH_FILE) || {};` and treat a non-object as `{}`. A `checkedAt` that `Date.parse` cannot read gives "NaN min ago": use "never" when `age` is NaN.
- [Breaking changes] The consumer list misses `skills/bootstrap-project/scripts/verify.mjs:109-110` (reads `schedulableCount`, `laneCount`, `maxParallel`, `recommendedBatch`, `lanes`, `inFlight`). None of these change, so nothing breaks; add it to the list for completeness of the search.
- [Scope / dashboard] The drawer's "⚡ All" launches `recommendedBatch` and does not show the new `!!` line (2A), so a batch plan that shares files with a waiting plan is launched from the dashboard with no warning. This is outside the plan's files (`apps/dashboard/page/app.js`, plan 2a), but add it to the Context known limits next to the `waitingCount` drawer note.
- [Scope / parent plan] The parent plan says 2b "touches no file of 2a" (`.plans/20261123-100855-orchestrator-parent.md:94`), but both plans change `docs/plans-dashboard.md` (this plan Step 13; 2a `.plans/20261127-195706-groups-ledger-checklist.md:114`, a new section after "Waits for and the event watcher"). It is a doc, so plan-lanes counts it as soft (`.claude/scripts/plan-lanes.mjs:42`, only `docs/roadmap.md` is a hard doc); expect a small merge conflict. Context only: no change to this plan required beyond knowing it.
- [Step 15] This repo has `.claude/bootstrap.json`, so after the merge the dashboard can show "bootstrap update" for this repo (renderHash, `contracts.md:124`). A hand copy does not update `renderHash`. Suggestion: say in Step 15 that the owner can run `/bootstrap-project --upgrade` in this repo instead of the hand copy, or that the "bootstrap update" mark stays until then.
- [Edge cases] A met plan that the watcher has not started yet (the `WATCH_LIMIT` slot is full, `server.mjs:2151`) is in `recommendedBatch`, so the owner can launch it by hand while the watcher wants to start it. The watcher then skips it (`server.mjs:2144`), so there is no double run. Optional: mark such a batch plan "the watcher starts it by itself".

### Edge cases the plan should address
- A waiting plan that already runs (launched by hand) or shipped — it must not show as waiting (blocking item above).
- A parked or proposed waiting plan — the watcher never starts it, so "starts by itself" is wrong.
- `watch.json` with `null` content or an unreadable `checkedAt` — no crash, no "NaN min ago".
- A watcher interval longer than 10 minutes — every result shows as stale.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (`parseWaitsFor` `watch.mjs:17-35`, `loadWatch` `server.mjs:1837-1841`, `checkedAt` `server.mjs:2059`, `met` `server.mjs:2121-2122`, `WATCH_MS` `server.mjs:1815`, `readJson`/`CENTRAL_STATE`/`GENERIC_RUNS`/`MINOR_MAX_SHARED` `plan-lanes.mjs:80-89`, batch loop `plan-lanes.mjs:485-490`, `bootstrapRepo()` names the repo `acme-api` `test/bootstrap-project.test.mjs:18`, tests run with `HOME: dir` line 410)
- [x] Reference implementation mirrored, deviations justified (regex and fence rule match `watch.mjs:5,21-26`)
- [ ] Breaking changes for changed symbols listed (consumer search done) — `verify.mjs` missing from the list, no break
- [x] Wiring & registration matches the code (no new wiring; no `@@` placeholder in new code)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope — no endpoint; N/A
- [x] Restart after dashboard changes respected (no `apps/dashboard/` file changes; `runLanes()` spawns the script per call, `server.mjs:256-261`)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail (`WAITING` and `sharesWithWaiting` are absent today; `changelog-validate.mjs` exists in `.claude/scripts/`; `kind: added` is valid per `changelog.d/README.md:28`)

Variable order checked: `WATCH_FILE` (after line 85) uses `CENTRAL_STATE` (line 80); `WAIT_STALE_MS` after line 87; `watch` and `waitStateOf` after line 197, before the `plans` map (line 356); `waitingPlans` before the batch loop and before `recommendedBatch` and `result`. The step code runs as written.

```
Update the plan at .plans/20261127-224222-plan-lanes-waiting-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In Step 6, build waitingPlans only from plans that are not occupied and not shipped, for example plans.filter((p) => p.waits && !p.waits.met && !occupied(p.runState) && p.runState !== 'shipped'). A plan launched by hand before its condition was met is never checked again by the watcher (apps/dashboard/server.mjs:2105) and so would show in IN FLIGHT and in WAITING at once, with a false "starts by itself" text and a duplicate !! line next to blockedByActiveRun. Keep plans[].waits for every plan. Add a unit test: a waiting plan with a live generic run (runs.json under <HOME>/.claude/pipeline-dashboard/state/acme-api/ with the test's pid and exitCode null, read at plan-lanes.mjs:85,238-239) is in inFlight, not in waiting, and gives no sharesWithWaiting entry. (evidence: apps/dashboard/server.mjs:2105, 2121-2122; plan-lanes.mjs:295-300, 394-401)

SHOULD FIX:
1. Give parked and proposed waiting plans a note that the watcher does not start them (or leave them out of waiting), and say so in the SKILL.md WAITING row. (evidence: apps/dashboard/watch.mjs:115, server.mjs:2142)
2. In Step 10, name the helper that writes full plan texts (lanesWith() writes only a fixed body from a title), or say the cases write the plans inline like the test at test/bootstrap-project.test.mjs:456-465. (evidence: test/bootstrap-project.test.mjs:407)
3. In Step 4, use `readJson(WATCH_FILE) || {}` and treat a non-object as {}; when Date.parse(checkedAt) is NaN, write "never" in the note, not "NaN min ago". (evidence: plan-lanes.mjs:89)
4. Add skills/bootstrap-project/scripts/verify.mjs (reads schedulableCount, laneCount, maxParallel, recommendedBatch, lanes, inFlight) to the consumer list in Contracts. (evidence: skills/bootstrap-project/scripts/verify.mjs:109-110)
5. Add to the Context known limits: checkedAt moves only when the PR read works, while waits are checked every tick (server.mjs:2055-2059, 2097-2125); WAIT_STALE_MS does not follow DASH_WATCH_MS (server.mjs:1815); the drawer's "⚡ All" does not show the new !! sharesWithWaiting line.
6. In Step 15, say that the owner can run /bootstrap-project --upgrade in this repo instead of the hand copy (the repo has .claude/bootstrap.json), or that the dashboard shows "bootstrap update" until then. (evidence: skills/bootstrap-project/references/contracts.md:124)

ADD THESE EDGE CASES:
- A waiting plan that already runs or has shipped is not listed as waiting.
- A parked or proposed waiting plan: the watcher never starts it.
- watch.json with null content, or a checkedAt that Date.parse cannot read: no crash, no "NaN min ago".
- A watcher interval longer than 10 minutes: every result shows as stale.

Do not change anything the validation did not flag.
```
