**Validation round:** 2

## Plan validation: 20261127-224222-plan-lanes-waiting-state.md

**Verdict:** APPROVE WITH CHANGES

The round 1 changes hold up against the code. `projectName()` can run above `CENTRAL_STATE`: it needs only `REPO`, `os`, `path` and `readFileSync`, and all of them are defined or imported before line 80. `waitStateOf()` reads `meta`, which line 196 defines, and `WAIT_STALE_MS`, which step 2 adds. `waitingPlans` uses `occupied()` (line 301) and `p.runState` (line 390), and both exist before the batch loop at line 486. The steps still run in the order they are written. I found no blocking issue. The findings below are test-precision and wording gaps.

### Blocking issues

None.

### Non-blocking concerns

- [Tests / harness] The "Registry name differs" case writes `path.join(dir, '.claude/pipeline-projects.json')` first. `bootstrapRepo()` creates only `<dir>/acme-api/.claude` (`test/bootstrap-project.test.mjs:18-19`), not `<dir>/.claude`, so this `writeFileSync` fails with ENOENT unless `writeState()` runs first or the test makes the folder. — evidence: `test/bootstrap-project.test.mjs:16-25`; plan Tests, "Registry name differs". — Suggestion: say "`mkdirSync(path.join(dir, '.claude'), { recursive: true })` first", or call `writeState()` before the registry write.
- [Tests / fails without the feature] The "Only the header counts" case does not set the line order inside the fence for `dan-plan`. If the fenced `## ` line comes before the fenced `Waits for:` line, a parser with no fence handling also stops at the `## ` line and gives `waits: null`, so the test passes without the fence logic. No case proves the other half of the dashboard rule (`watch.mjs:22`: "a `## ` line inside an example block does not end the header"), which is that a real `Waits for:` line after a fence that holds `## ` still counts. — evidence: `apps/dashboard/watch.mjs:17-35`; plan Tests, "Only the header counts". — Suggestion: put the fenced `Waits for:` line before the fenced `## ` line. Add a plan `eli-plan` whose header has a fence with `## x`, then a real `- **Waits for**: acme-web PR #12 merged` after the fence. Assert that `eli-plan` waits.
- [Edge case / projectName] Step 1a says "the first entry with a string `name`…". With `typeof x.name`, a `null` entry in `projects[]` throws inside the `try`, so the code falls back to the folder name even when a later entry matches. — evidence: plan step 1a; `apps/dashboard/server.mjs:171-174` (`loadRegistry` accepts any array). — Suggestion: write `x && typeof x.name === 'string' && typeof x.root === 'string' && …`.
- [Parent plan consistency] Parent line 94 still says that plan-lanes "counts a missing or old result as 'not met'". After round 1, the plan's 1A+ is more precise: a stored `met: true` is met at any age, and only a not-met result stays not met. A reader of the parent plan can take this as a contradiction. — evidence: `.plans/20261123-100855-orchestrator-parent.md:94`; plan Context 1A+. — Suggestion: change the parent line to "a plan the watcher has not seen met stays not met, also when the result is missing or old; a stored met is met at any age".
- [Docs wording] The `RECOMMENDED PARALLEL BATCH` row already says that a `!!` line means "files that a running or waiting run holds", and "waiting" there means awaiting review. Step 11 adds a second `!!` sentence about "waiting plans", so "waiting" gets two meanings in one cell. — evidence: `skills/bootstrap-project/templates/modules/plans-parallel/dot-claude/skills/plans-parallel/SKILL.md:32`. — Suggestion: in the same step, change "running or waiting run" to "a running run or a run that waits for review".
- [Scope of `waiting`] `waitingPlans` also takes plans that are not schedulable (roadmap, handoff, ops runbook, no hard files), because its filter does not use `schedulable`. They show in `WAITING` but in no lane. This is harmless, but the contract text does not say it. — evidence: template lines 406-407 (`schedulable` filter); plan step 6. — Suggestion: say in Contracts that `waiting` can hold a plan that is also in `excluded`, or filter on `schedulable.includes(p)`.

### Edge cases the plan should address

- A plan that is met but not yet started (`met: true`, the watcher starts it on its next tick) goes into `recommendedBatch`, and no `sharesWithWaiting` warning names it. The owner can launch it by hand while the watcher starts it. The dashboard's `launches` / `pipelineLive` guards (`server.mjs:2132-2136`) prevent a double start from the dashboard, but not a batch plan that shares its files. This follows from owner decision 1A+, so note it as a known limit rather than change it.
- A first dashboard tick saves the blank watch state (`server.mjs:1839`: `met: {}`, `checkedAt: null`). plan-lanes then shows "watcher last checked never", not "no watcher state". That is correct, and a test assertion could pin it down.
- Timing in the "2 hours ago → 120 min ago" case is safe: `Math.round` absorbs a few seconds of test delay.

### Checks of the round 1 focus points

- `projectName()`: `realpathSync` with a `path.resolve` fallback matches what Node does with the main module (it starts by real path), so `/var/folders/…` in the registry and `/private/var/…` in `REPO` compare equal on macOS. The `~` regex is the same as `register.mjs:25` `untilde`. The folder-name fallback covers a missing file, bad JSON, a missing list (a throw inside the `try`) and no match. Inline `JSON.parse` is needed and correct: `readJson` is a `const` at line 89.
- `waitStateOf()`: the object guard covers `null` and numbers (`readJson` returns the parsed value, line 89). `stale = !(age >= 0 && age < WAIT_STALE_MS)` is true for a missing, bad (NaN) or future time. `when` never prints `NaN`. The order of the notes (parked/proposed → no state → stale → null) matches the tests. The `parked`/`proposed` note matches `canAutoLaunch()` (`watch.mjs:115`).
- `waitingPlans`: it is defined after `plans` (line 356) and `occupied` (line 301), and before the batch loop, `recommendedBatch` and the text output that read it.
- The `runs.json` live-run case is right: `genericLive` needs `exitCode == null && pidAlive(pid)` (lines 238-239). The test process's own PID is alive while the child runs. `runState` gives `in-flight` (line 298), `launchedSlugs` takes `genericLive` (line 335), and `heldByRun` takes the planned files from the plan copy (line 347). So `bea-plan`'s `blockedByActiveRun` names `ana-plan`. Without the `occupied()` filter, `ana-plan` would be in `waiting` and in `bea-plan`'s `sharesWithWaiting`, so the test can fail. The shape matches what the dashboard writes (`server.mjs:843-844`).
- The 2A case can fail: without the feature, both plans score the same, and the sort keeps file order, so the batch picks `eva-plan`.
- The helpers can be written: `writePlans`, `writeState` and `runLanes` do not clash with any existing name in the test file (grep). `HOME: c.dir` makes `os.homedir()` resolve to the temp folder, the same as `lanesWith()` (line 410).
- `parseWaitsFor` mirror: `WAITS_RE` (`watch.mjs:5`) is the same as the regex in step 3. The fence and `## ` rules match `watch.mjs:21-23`.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `git grep recommendedBatch|schedulableCount`, which also finds `apps/dashboard/test/dashboard.test.mjs`, a test with no field change)
- [x] Wiring & registration matches the code (no new wiring)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope: not applicable (no endpoint)
- [x] Restart after dashboard changes respected (no file under apps/dashboard/ changes)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail (the two test commands and `changelog-validate.mjs` can fail; the three `grep` lines are presence checks only)

```
Update the plan at .plans/20261127-224222-plan-lanes-waiting-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In Tests, "Registry name differs": say that the test makes <dir>/.claude first (mkdirSync recursive) or calls writeState() before it writes pipeline-projects.json. bootstrapRepo() makes only <dir>/acme-api/.claude. (evidence: test/bootstrap-project.test.mjs:16-25)
2. In Tests, "Only the header counts": put the fenced Waits for line BEFORE the fenced "## " line in dan-plan, so that a parser with no fence handling fails. Add a plan whose header has a fence that holds "## x", followed by a real "- **Waits for**:" line after the fence, and assert that this plan waits. (evidence: apps/dashboard/watch.mjs:21-23)
3. In step 1a, guard each registry entry: `x && typeof x.name === 'string' && typeof x.root === 'string' && ...`, so that a null entry does not throw and hide a later match. (evidence: apps/dashboard/server.mjs:171-174)
4. In step 11, also change "files that a running or waiting run holds" in the RECOMMENDED PARALLEL BATCH row to "a running run or a run that waits for review", so that "waiting" has one meaning. (evidence: skills/bootstrap-project/templates/modules/plans-parallel/dot-claude/skills/plans-parallel/SKILL.md:32)
5. In Contracts, say that `waiting` can also hold a plan that is not schedulable (it is in `excluded`, not in a lane), or filter waitingPlans on schedulable. (evidence: skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs:406-407)
6. Align the parent plan line 94 with 1A+: a stored met is met at any age; only a not-met result stays not met when it is missing or old. (evidence: .plans/20261123-100855-orchestrator-parent.md:94)

ADD THESE EDGE CASES:
- A met plan that the watcher has not started yet is in recommendedBatch, and no sharesWithWaiting entry names it: list it as a known limit (follows from 1A+).
- A blank watch.json from a first tick (met: {}, checkedAt: null) gives "last checked never", not "no watcher state": add one assertion.

Do not change anything the validation did not flag.
```
