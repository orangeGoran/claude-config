**Validation round:** 3

## Plan validation: 20261127-230103-template-updates-collector.md

**Verdict:** APPROVE WITH CHANGES

The round-2 edits mostly hold together. The saved-lines / `flushWave` model, `runAt`/`of` run selection, the per-branch `collected` line and the clone fixture are sound in outline. Three defects remain that would give wrong or unsafe results: the report file name does not match the URL the 📄 button builds; the "added line" base can be the run-folder copy that the session can edit; and the global collector status is resumed against the wrong wave. One leftover step contradicts the "no exemption" rule.

### Blocking issues

- [Discrepancy / wiring] The collector report file name does not match the slug that the page asks for. Contracts (plan line 68) name the report `bootstrap-collect-<slug>.md`, where `<slug>` is `bootstrap-collect-<hash>[-<k>]`. That gives `bootstrap-collect-bootstrap-collect-<hash>.md`. Step 17 sets `data-kind="bootstrap-collect"` and `data-hash="<slug suffix>"`, so `openUpgradeReport` asks `/api/report?slug=bootstrap-collect-<hash>`. `server.mjs:3434` reads `path.join(proj.autoRunsDir, slug + '.md')`, which is `bootstrap-collect-<hash>.md`. — plan line 68 vs step 17 (plan line 154); `apps/dashboard/server.mjs:3434`, `apps/dashboard/page/app.js:3445` — the 📄 button shows "(no report yet)", so the owner cannot see the alias table (the only place that maps P1/P2 to projects) or the skip reasons. — Name the report `<slug>.md` (that is, `bootstrap-collect-<hash>[-<k>].md`) in Contracts, step 14 and contracts.md. Optionally name the body `bootstrap-collect-pr-body-<hash>[-<k>].md`. Add a dashboard or collector test that the report is at `/api/report?slug=<slug>`.

- [Public repo: no private data] The "added line" check can compare against a copy that the session can change. Decision 32 and step 12 define an added line as "a line that the file it replaces does not have". Step 11 copies the templates into the run folder as `templates/`, and the session runs there with `--permission-mode acceptEdits` (`upgrade-run.mjs:269-274`, which `claudeSession()` keeps). A session that edits `runDir/templates/<rel>` in place (a likely mistake) and then copies it to `out/<rel>` makes a private-name line look "not added" if the implementer diffs against the run-folder copy. The text does not say which file "it replaces" means. — plan lines 32, 148, 149; `skills/bootstrap-project/scripts/upgrade-run.mjs:269-274` — a project or client name can pass the generic check and reach the public claude-config PR. — State that the base is `<wt>/skills/bootstrap-project/templates/<rel>` (the worktree, which the session cannot write; the `git status --porcelain --ignored` check proves that). Also refuse the run when the run folder's `templates/` copy differs from the worktree after the session. Add a refusal test: the fake session writes `nimbus-web` into `runDir/templates/<rel>` and into `out/<rel>`.

- [Edge case: cross-wave resume] The collector status file is one global file (`bootstrap-collect.json`), but the resume and "one PR at a time" rules only look at one wave. Step 10 says: carry `collectId`, `ids`, `round` and `branch` from the previous status, and resume that branch "when no `collected` line has it". It does not say which wave's lines are checked, or which hash `appendCollected()` writes to. Example: a run for wave A crashes after `gh pr create`. The owner (or phase 3) then starts wave B (`--hash B`, or B is now the newest pending wave). B's file has no line for A's branch, so the run resumes A's branch and appends A's ids into B's file. A's ids stay pending, and after A's PR merges the chip offers A again as round 2, which collects the same features twice. Also, step 10 only checks "the newest `collected` line with a `pr`" of the current wave, so an open PR of wave A does not stop a new PR for wave B. Decision 39 says "one collector PR at a time", and decision 28 says "of the wave". — plan lines 28, 29, 39, 147 — a wrong wave file, duplicate features in a later round, and two open collector PRs that edit the same templates. — Resume only against the wave of `prev.hash`: `readWave(prev.hash)`, then `appendCollected(prev.hash, …)`, done before the requested hash is handled. Check the newest PR-bearing `collected` line across all waves (or the previous status in state `pr` with an open PR) before a new round opens a PR. Add a test: the status names a branch of wave A, and the run is started with `--hash B`.

- [Internal contradiction / Public repo] Step 14 still lists "the names left out of the check as common vocabulary" in the report. Decision 32 says "There is no exemption for a name that occurs elsewhere in the templates", and step 12 says "no exemption". — plan line 151 vs lines 32, 149 — an implementer who follows step 14 builds an exemption list. The regression R3/F7 fix then silently comes back, and a name can leak. — Delete that item from step 14. If a narrow exemption is wanted for known contract defaults (see the concern on `Default` below), write it as an explicit decision with its exact list.

### Non-blocking concerns

- [Edge case: flush of uncommitted work] `flushWave()` runs in `upgrade()` right after `ctx` is built, before the fresh-worktree delete. Take a run that is killed (sleep, reboot, `SIGKILL`) after it saved `bootstrap-upgrade-updates-<hash>.json` and before `git commit` finished. Its `catch` never runs, so the next run appends the lines of work that was never committed. — plan lines 22, 141 — Flush only when the branch has a commit ahead of `baseSha` (local or remote), or save `baseSha` in the file and check `rev-list --count`. Otherwise delete the saved file.
- [Edge case: lost lines after a render-hash change] `flushWave(repo, hash)` reads only the saved file of the current render hash. A committed run whose wave append failed, followed by a template change that changes this project's `renderHash`, never flushes its lines. — plan line 141 — Flush every `bootstrap-upgrade-updates-*.json` in the runs folder. Each file already holds its own `templatesHash`.
- [Test feasibility] Step 6: "a retry after the templates changed appends into the saved `templatesHash`". The upgrade test renders from the real `SKILL_DIR` templates, so a test cannot change them. — plan line 143; `test/bootstrap-upgrade-run.test.mjs:104-114` — Say how the test simulates it, for example by rewriting `templatesHash` in the saved file to a made-up 16-hex value before the retry.
- [Test harness: clone fixture] Step 15 clones "this repo's `HEAD`" and sets `origin` to "a bare clone of it". In the pipeline worktree, HEAD is on `auto/<slug>`, so the clone and its bare copy have no `main` branch. Then `git fetch origin main` (base from `.claude/bootstrap.json:81`, `"base": "main"`) fails, and so does the happy path. — plan line 152 — Run `git branch -f main HEAD` (or `checkout -B main`) in the clone before making the bare origin, and push `main` to it.
- [Generic check: default values] `names` takes `project.client`. Contracts give `Default` as the default client (`references/contracts.md:69`), and this repo's own `.claude/bootstrap.json:7` has `"client": "Personal"`. A whole-word, case-insensitive match on `default` refuses almost every template edit. — plan lines 24, 32 — Leave contract default values (`Default`, a `title` equal to `name`) out of `names` by an explicit rule, and test it. Also escape regex characters in names, and use a boundary that works for names that start or end with a non-word character.
- [Generic check: redaction markers] Step 11 puts `<project>`, `<home>` and the `redactText()` markers (`<email>`, `<redacted>`, `<id>`, `<ip>`) into `task.json`. Nothing refuses an `out/` line that copies such a marker into a template, and the verify render does not catch plain text. — plan lines 26, 148, 149 — Refuse added lines that contain these markers, in the same way that `checkDecisions()` refuses a leftover placeholder (`upgrade-run.mjs:223`).
- [Secret pattern] `(token|key|secret|password)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{12,}` has no word boundary or `i` flag. It matches prose such as `cache-key: node-modules-linux` and misses `TOKEN=`. — plan line 33 — Add `\b…\b` and `i`, and add one test for each.
- [Step order] Step 4 computes `templatesHash()` "right after the `writeStatus(… state: 'running' …)` call". That call is at `upgrade-run.mjs:468-469`, outside the `try` that starts at line 470, so a throw leaves the status at `running`. — Say "inside the `try`, before the params read".
- [Wiring] Step 16 keys the `/api/state` cache on the files in `wavesDir()`, but imports only `pendingWaves` and `readWave`. — plan line 153 — Add `wavesDir` to the import and to the Wiring row.
- [Test detail] Unit test "a `token=sk-test-0000` in the fake feature text" needs `FAKE_UPDATE` to set `feature` too. Step 6 says that it sets only `repoPath` and `excerpt`. — plan lines 143, 165; the fake feature is fixed at `test/bootstrap-upgrade-run.test.mjs:50`.
- [Changelog name] `changelog.d/bootstrap-collect-<hash>.yaml` does not follow `changelog.d/README.md` ("`<pr-number-or-date>-<short-slug>.yaml`"). `changelog-validate.mjs:173` checks only `.yaml`, so it passes. — Name it `<YYYYMMDD>-<slug>.yaml` and keep the exists-refusal, or state the deviation and the reason in Reference implementation → Deviations.
- [Browser test] With a temp `HOME`, the registry is empty. The temp collector repo must be registered in `<temp home>/.claude/pipeline-projects.json`. Because it is not `DASH_REPO`, its card also shows a bootstrap chip (`server.mjs:1042`). — plan lines 197-202 — Say both.

### Edge cases the plan should address

- A run killed between the save of the wave lines and the commit. Its lines must not reach the wave.
- A collector status of wave A while wave B is requested: resume against A's file, and allow only one open collector PR across all waves.
- A session that edits `runDir/templates/` in place. Compare against the worktree file, and refuse the change.
- `names` with regex characters, a name equal to a contract default (`Default`), and the owner login (the same in every `project.remote`).
- An added line that holds a redaction marker (`<project>`, `<home>`, `<redacted>`).

### Checklist

- [ ] All referenced files, lines, sections and symbols exist as stated (the report name does not match `/api/report`, `server.mjs:3434`)
- [x] Reference implementation mirrored, deviations justified (the changelog file name deviation is not stated)
- [x] Breaking changes for changed symbols listed (consumer search done: `openUpgradeReport` only at `app.js:600` and the chip; `checkDecisions` consumed by `prBody` and the tests)
- [ ] Wiring & registration matches the code (`wavesDir` import missing)
- [x] Scope stays inside the goal; no open decision is taken silently (phase 3 canary and trigger are left open)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (404 not applicable, reason given)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected (added-line base and step 14 exemption)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared source; shapes in contracts.md)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Name the collector report <slug>.md (bootstrap-collect-<hash>.md or bootstrap-collect-<hash>-<k>.md), not bootstrap-collect-<slug>.md, in Contracts, step 14 and the contracts.md text, so /api/report?slug=<slug> (server.mjs:3434 reads slug + '.md') finds it. Add a test that the report is at that slug. (evidence: plan line 68 vs step 17; apps/dashboard/server.mjs:3434; apps/dashboard/page/app.js:3445)
2. In decision 32 and steps 11-12, define the base of an "added line" as <wt>/skills/bootstrap-project/templates/<rel> (the worktree), not the run-folder copy. Refuse the run when runDir/templates/ differs from the worktree after the session. Add a refusal test: the fake session writes nimbus-web into runDir/templates/<rel> and out/<rel>. (evidence: plan lines 32, 148, 149; upgrade-run.mjs:269-274 acceptEdits)
3. In step 10 and decisions 28-29, resume the previous status against the wave of prev.hash (readWave(prev.hash), appendCollected(prev.hash, ...)), before the requested hash is handled. Check for an open collector PR across all waves (the newest collected line with a pr in any wave, or a previous status in state pr with an open PR) before a new round opens a PR. Add a test: the status names a branch of wave A, and the run is started with --hash B. (evidence: plan lines 28, 29, 39, 147)
4. Delete "the names left out of the check as common vocabulary" from step 14. It contradicts "no exemption" in decision 32 and step 12. (evidence: plan line 151 vs lines 32, 149)

SHOULD FIX:
1. Make flushWave() append only when the branch has a commit ahead of baseSha (local or remote). Otherwise delete the saved file, so a run killed before its commit adds no lines. (evidence: plan lines 22, 141)
2. Make flushWave() flush every bootstrap-upgrade-updates-*.json, not only the current render hash. (evidence: plan line 141)
3. Say how step 6 simulates "templates changed" (for example, rewrite templatesHash in the saved file). The test cannot change the real templates. (evidence: test/bootstrap-upgrade-run.test.mjs:104-114)
4. In step 15, run git branch -f main HEAD in the clone before making the bare origin. Otherwise the fetch of main fails in the pipeline worktree. (evidence: plan line 152; .claude/bootstrap.json:81)
5. Leave contract default values (client "Default", a title equal to name) out of names. Escape regex characters in names, and use a boundary that works for names that start or end with a non-word character. Test it. (evidence: references/contracts.md:69; .claude/bootstrap.json:7)
6. Refuse added out/ lines that contain <project>, <home>, <email>, <redacted>, <id> or <ip>. (evidence: plan lines 26, 148; upgrade-run.mjs:223)
7. Add a word boundary and the i flag to the secret pattern, with one test for each. (evidence: plan line 33)
8. In step 4, compute templatesHash() and runId inside the try of upgrade(). (evidence: upgrade-run.mjs:468-470)
9. Import wavesDir in server.mjs (step 16 and the Wiring row). (evidence: plan line 153)
10. Let FAKE_UPDATE set feature too, for the token-redaction test. (evidence: plan lines 143, 165; test/bootstrap-upgrade-run.test.mjs:50)
11. Name the collector changelog <YYYYMMDD>-<slug>.yaml, or list the deviation from changelog.d/README.md with a reason. (evidence: changelog.d/README.md "Add an entry")
12. In Browser test, register the temp collector repo in the temp HOME's pipeline-projects.json, and say that its card also shows a bootstrap chip. (evidence: server.mjs:1042)

ADD THESE EDGE CASES:
- A run killed between the save of the wave lines and the commit.
- A collector status of wave A while wave B is started.
- A session that edits runDir/templates/ in place.
- names with regex characters, contract defaults, and the owner login.
- Added lines with redaction markers.

Do not change anything the validation did not flag.
```
