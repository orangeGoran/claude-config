**Validation round:** 2

## Plan validation: 20261127-230103-template-updates-collector.md

**Verdict:** APPROVE WITH CHANGES

The round-1 fixes went in, but the new wave model (saved lines, `waveWritten`, the `collected` ids, round `k`) has six gaps where the plan's own resume and retry promises do not hold against the code it mirrors. Each gap has a small fix. No owner decision is missing. The "Decisions taken for the owner" defaults are sound. Three of them need the fixes below to work as written: the retry until the append worked, the `collected` ids and the take-back of a closed PR.

### Blocking issues

- [Edge cases / resume paths] `flushWave()` runs only "right after `committed = true` and at the start of `publish()`" (plan step 4, decision line 22), but three resume branches of `upgrade()` never reach `publish()`. These are: the open-PR branch (`skills/bootstrap-project/scripts/upgrade-run.mjs:502-511`), and the `--no-push` returns after a remote branch (`:521`) and after a local branch (`:531`). Step 6's own test ("a wave folder that cannot be written … leaves the run in state `committed` …, and the next run (the resume path) appends the lines") uses `--no-push`, so the second run takes `:531` and returns before any flush: the test as written fails. Worse, when the append fails and the PR is then opened (`:440` → `publish()`), the next run takes the open-PR branch with no flush. The dashboard also refuses a new run while that PR is open (`apps/dashboard/server.mjs:1095-1096`), so the lines are lost for good. That contradicts "a retry appends them again until it worked". Also, `waveWritten` does not survive a retry, because `upgrade()` rewrites the status with `fresh = true` (`upgrade-run.mjs:468-469`). — Fix: call `flushWave(ctx)` once in `upgrade()` right after `ctx` is built and the status gets the hash (after `:497-498`), before the resume branches, and keep the call after the commit. Say that the id de-duplication in `readWave()` is the real guard, because the fresh status write drops `waveWritten`, or carry `waveWritten` over the way `session` is carried at `:460-467`. Add a test that runs without `--no-push`: the append fails, the PR opens, the second run finds the PR open, and the lines get appended.

- [Edge cases / wrong data] The saved lines file `bootstrap-upgrade-updates-<hash>.json` is written "right before the commit". The commit runs the project's git hooks and can fail (`upgrade-run.mjs:432`; the catch at `:443-448` drops the worktree). The file then stays. The next run of the same hash starts fresh (`:545`), and if its session reports no template updates, the step-4 rule "when `decisions.templateUpdates.length`" never overwrites the file. After its commit, `flushWave()` appends the lines of a session whose work was thrown away. That breaks "Only a run that really changed the repo reports updates". — Fix: delete the saved file when a fresh worktree is made (`:545`) and in the catch when `!committed`. Write the file after `installDeps()` (`:430`), so it sits right before the commit at `:432`. In `flushWave()`, append to the `templatesHash` stored in the saved lines, not `ctx.templatesHash` of the resumed run: the templates can change between the commit and the retry while this project's `renderHash` stays the same.

- [Edge cases / collector resume] The plan relies on "the status `ids`" in three places: the retry that finds the PR open, the crash between `gh pr create` and the `collected` line (decision line 29, step 10), and the `appendCollected(hash, { branch, pr, ids })` at the end of a resumed publish (step 13). But the collector mirrors `upgrade()`, which starts every run with a fresh status write (`upgrade-run.mjs:468-469`). Only `session` and `replaces` are read back before it (`:460-467`). A collector that mirrors this loses the earlier run's `ids` before the retry reads them. The `collected` line then gets `[]` or the current pending set, which is wrong. A crash leaves the ids pending, and they come back in the next round after the merge. If the current set is used, ids that came after the PR are marked collected without being in it. — Fix: in step 10, read `ids` and `branch` from the previous `bootstrap-collect.json` before the fresh write, carry them over, and use them only when their `branch` equals the branch being resumed. Extend the crash test: the retry's `collected` line holds exactly the first run's ids, and not an id added to the wave after the first run.

- [Edge cases / take-back breaks the round number] Round `k` = "the number of `collected` lines + 1" (decision line 28, step 10). The documented take-back of a closed PR is "delete that `collected` line by hand". After the delete, `k` falls back to the closed round's number, so the next run picks the same branch `auto/bootstrap-collect-<hash>[-k]`. Step 10 finds that branch's CLOSED PR and takes the branch "a merged or closed PR → the same `appendCollected()`, then state `same`". That marks the ids collected again, and the take-back silently does nothing. — Fix: store `round` in each `collected` line, and set `k` = 1 + the highest `round`, which never decreases. The take-back is then "set `ids` of that line to `[]`", not "delete the line". Add a test: a closed round-1 PR, its line's ids emptied by hand, and the next run uses `-2` with those ids in `task.json`.

- [Edge cases / chip stuck] Step 10: when the PR of the newest `collected` line is open, the run will "stop in state `pr` with it". The chip reads `prState` by the status `branch` (`apps/dashboard/server.mjs:1079`, which `bootstrapCollectRunOf()` mirrors). By that point step 10 has already computed the new branch `-<k>`. If the status gets that new branch with the old PR, the lookup never finds `MERGED` or `CLOSED`. Step 17 then keeps "collect PR #n" up after the old PR is merged and hides the "Collect template updates" button. — Fix: in that refusal, write the old PR's branch (the branch of that `collected` line) into the status with the PR. Add a dashboard or page case: status `pr` from the refusal, the PR marked `MERGED` in the PR list, and a pending wave together give the button.

- [Public repo: no private data] `privateHits()` checks the added lines of each `out/` file and every `collect.json` text (step 12). It does not check the `out/` relative paths. Those paths become new file names in the public commit and appear in the PR body column "Template files" (step 13). A session can write `out/modules/<m>/dot-claude/skills/acme-web-deploy/SKILL.md`. Decision line 32 says the check covers "every public channel". — Fix: run `privateHits()` on each rel path and on each `files` entry of `collect.json`. Add a refusal case with a path that holds `acme-web`.

### Non-blocking concerns

- [Discrepancy] Step 17 says the 📄 button is "`data-bsreport` with slug `bootstrap-collect-<hash>`". In the current page, `data-bsreport` holds the project name and `data-hash` holds the hash (`apps/dashboard/page/app.js:3417`, and the handler at `:600`). The Breaking changes row adds `data-kind`. — Suggestion: write step 17 as `data-bsreport="<project>" data-hash="<hash>" data-kind="bootstrap-collect"`, so the step matches Breaking changes.
- [Contracts] The Contracts section adds `templatesHash`, `runId` and `waveWritten` to the upgrade status. Step 19 adds only `templatesHash` to `contracts.md` "Upgrade run status". — Suggestion: name all three in step 19.
- [Tests] Fixture names: `acme-api` and `acme-` already occur in `skills/bootstrap-project/templates/core/dot-claude/scripts/run-usage.selftest.mjs`, so the case-insensitive word match treats `acme-api` and the client `Acme` as common vocabulary. `references/bootstrap.example.json:4,7` has `acme-api` and `Acme`. The refusal cases use `acme-web` and `Acme Example Co`, so they still work, but the happy path checks less than it seems. — Suggestion: say this in the test, assert that `acme-api` is listed as "left out as common vocabulary" in the report, and escape regex characters in `names` before the word match.
- [Tests] The dashboard POST success case expects "ends `failed` at the fetch". `collect-run.mjs` reads `<repo>/.claude/bootstrap.json` before the fetch (step 10). — Suggestion: step 18 and the Browser test fixture should write a `.claude/bootstrap.json` with `git.base = 'main'` into `collect-repo`. Without it, the run fails at prepare and not at the fetch.
- [Performance] `fullState()` calls `pendingWaves()` on every `/api/state` request. That reads every wave file, which is append-only and never pruned, and `readWave()` reads one upgrade status file per repo for the PR join. — Suggestion: cache by the mtime of the wave folder, keep the PR join out of `pendingWaves()`, and measure with `node apps/dashboard/state-load.mjs load <port>` (AGENTS.md Commands).
- [Edge cases] The PR body file and the report are keyed by hash only (`bootstrap-collect-pr-body-<hash>.md`, `bootstrap-collect-<hash>.md`), while the branch carries `-<k>`. A round-2 resume can find the round-1 body with the same first-line mark. — Suggestion: key them by slug, or put `k` in the body mark.
- [Edge cases] The changelog entry is built from Claude texts (`title`, `why`). — Suggestion: write `summary` and `internal` as YAML block scalars, fold newlines, and let `changelog-validate.mjs` (which exists at `.claude/scripts/changelog-validate.mjs`) catch the rest.
- [Edge cases] Step 11 copies `out/<rel>` into `<wt>/skills/bootstrap-project/templates/<rel>` with a symlink check only on the `out/` side. — Suggestion: run `symlinkedPath()` (`upgrade-run.mjs:239`) on the destination, as `upgradeInWorktree()` does at `:373`.
- [Docs: current state only] `docs/roadmap.md:33` still says the fleet-upgrade phase 1 is "planned" and phases 2–5 are "not written yet". Phase 1 is in `.plans/done/20261124-123513-bootstrap-upgrade-run.md`, and phase 2 is this plan. — Suggestion: add a step that updates that roadmap line.
- [Edge cases] `templatesHash()` hashes path and content only. A change to only the executable bit of a template (`isExecutable()` is derived from the path) does not change it. That is acceptable, but say so in the doc comment.

### Edge cases the plan should address

- The commit hook fails after the saved lines file is written: no stale lines may reach the wave (blocking item 2).
- An upgrade PR opens after a failed wave append: the lines must still reach the wave (blocking item 1).
- The owner takes back the ids of a closed collector PR: the next round must use a new branch (blocking item 4).
- A crash between `gh pr create` and the `collected` line while new updates arrive: the `collected` line must hold only the ids that the PR holds (blocking item 3).
- A private name with regex characters (`Acme (EU)`, `a.b`): the word match must escape it.
- A wave file that holds only `collected` lines, or an empty file: `readWave()` and `pendingWaves()` give no pending update and do not throw.
- Two collector rounds on the same day: the changelog file names must differ. The file name `<YYYYMMDD>-bootstrap-collect-<hash>.yaml` already does not hold `k` (see the next note).

Note on the changelog file name: step 13 names the entry `changelog.d/<YYYYMMDD>-bootstrap-collect-<hash>.yaml`. A round-2 run on the same day as a merged round 1 writes the same name and overwrites the merged entry in the worktree. `changelog.d/AGENTS.md` says "Never edit or delete an entry of another PR". Use the slug (`<YYYYMMDD>-bootstrap-collect-<hash>-<k>.yaml` from round 2 on). This is listed under SHOULD FIX in the block below because the fix is one word, but it changes a merged file when it happens.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`renderHash`, `TEMPLATES`, `MODULES`, `baseBranch`, `branchPrs` (not exported today), `resumeCommand`/`run`/`must`/`redactText`/`redactError` (exported), `bootstrapRunOf`, `bootstrapUpgrade`, `bootstrapCheck`, `fullState`, `/api/report` via `proj.autoRunsDir`, `openUpgradeReport`, `data-bsreport`/`data-bspr`/`data-bsupgrade`, `changelog-validate.mjs`, SKILL.md "Unattended mode", the contracts.md sections)
- [x] Reference implementation mirrored, deviations justified (but the fresh status write of `upgrade()` must not be mirrored as is for `ids`, blocking item 3)
- [x] Breaking changes for changed symbols listed (consumer search done: `openUpgradeReport` is called only from `app.js:600`; `checkDecisions` is used by `upgradeInWorktree` and the tests; the dashboard test picks `bootstrapUpgradeChip`/`bootstrapRunChip` by regex, `dashboard.test.mjs:2169-2170`, and asserts the header expression at `:2513`. Adding the chip after the ternary keeps that true)
- [x] Wiring & registration matches the code (the server import path mirrors the `qa-icon.mjs` import at `server.mjs:41`)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (403 for Origin and Host; 404 is not applicable, because there is no resource id; no tenants)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected (blocking item 6: `out/` paths are not checked)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [ ] Docs: current state only respected (the roadmap line 33 is stale; non-blocking)
- [x] Contracts respected (none exist; shapes documented in `contracts.md`)
- [x] "How to verify" commands are real and can fail (the `npm test` glob `apps/*/test/*.test.mjs test/*.test.mjs` picks up the new files; `changelog-validate.mjs --base` exists)

```
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 4, call flushWave(ctx) once in upgrade() right after ctx is built and the status gets the hash (before the open-PR and resume branches), and keep the call after the commit. Drop "at the start of publish()". Say that waveWritten does not survive the fresh status write of upgrade() (or carry it over like session), so the id de-duplication of readWave() is the guard. In step 6, add a push-path test: the append fails, the PR opens, the next run finds the PR open, and the lines get appended. (evidence: skills/bootstrap-project/scripts/upgrade-run.mjs:468-469, 502-511, 521, 531; apps/dashboard/server.mjs:1095-1096)
2. In step 4, delete bootstrap-upgrade-updates-<hash>.json when a fresh worktree is made and when the run fails before the commit. Write it after installDeps(), right before the commit. Let flushWave() append to the templatesHash stored in the saved lines, not ctx.templatesHash. (evidence: upgrade-run.mjs:429-433, 443-448, 545)
3. In step 10, read ids and branch from the previous bootstrap-collect.json before the fresh status write, carry them over, and use them only when their branch is the branch being resumed. In Tests, the crash-retry case asserts that the collected line holds exactly the first run's ids, and not an id added later. (evidence: upgrade-run.mjs:460-469)
4. Store a round number in each collected line and set k = 1 + the highest round. Change the take-back instruction from "delete that collected line" to "set its ids to []". Add a test for a take-back after a closed PR, where the next run uses -2. (evidence: plan decision line 28 and step 10 "a merged or closed PR → the same appendCollected(), then state same")
5. In step 10, when the PR of an older round is open, write that PR's branch (not the new -<k> branch) into the status with the PR, so the chip's prState lookup works after that PR merges. Add a case for it. (evidence: apps/dashboard/server.mjs:1079)
6. In step 12, run privateHits() on each out/ relative path and on each files entry of collect.json, and add a refusal test for a path that holds acme-web. (evidence: plan decision line 32 "every public channel"; step 13 PR body column "Template files")

SHOULD FIX:
1. In step 13, name the changelog entry by slug (<YYYYMMDD>-bootstrap-collect-<hash>-<k>.yaml from round 2 on), so a same-day round never overwrites a merged entry. Key the PR body and the report by slug too, or put k in the body mark. (evidence: changelog.d/AGENTS.md "Never edit or delete an entry of another PR")
2. In step 17, write the report button as data-bsreport="<project>" data-hash="<hash>" data-kind="bootstrap-collect", to match the existing handler and Breaking changes. (evidence: apps/dashboard/page/app.js:600, 3417)
3. In step 19, add runId and waveWritten next to templatesHash in "Upgrade run status". (evidence: plan Contracts line 71)
4. In step 18 and the Browser test, give collect-repo a .claude/bootstrap.json with git.base = 'main', so the run fails at the fetch as the test expects. (evidence: plan step 10 order: bootstrap.json is read before git fetch)
5. Note in Tests that acme-api and Acme occur in the templates (common vocabulary), assert that the report lists them, and escape regex characters in names. (evidence: skills/bootstrap-project/templates/core/dot-claude/scripts/run-usage.selftest.mjs)
6. Cache pendingWaves() in fullState() by the mtime of the wave folder, keep the PR join out of it, and measure with node apps/dashboard/state-load.mjs load <port>. (evidence: plan step 16)
7. Run symlinkedPath() on the worktree destination of each out/ file in step 11. (evidence: upgrade-run.mjs:239, 373)
8. Add a step that updates docs/roadmap.md line 33: phase 1 done, phase 2 is this plan. (evidence: docs/roadmap.md:33, .plans/done/20261124-123513-bootstrap-upgrade-run.md)
9. Write the changelog summary and internal fields as YAML block scalars, with newlines folded. (evidence: changelog.d/README.md format)

ADD THESE EDGE CASES:
- The commit hook fails after the saved lines file is written: no stale lines reach the wave.
- An upgrade PR opens after a failed wave append: the lines still reach the wave.
- The owner takes back the ids of a closed collector PR: the next round uses a new branch.
- A private name with regex characters (Acme (EU), a.b).
- A wave file that holds only collected lines, or an empty file.
- Two collector rounds on the same day (changelog, body and report names differ).

Do not change anything the validation did not flag.
```
