**Validation round:** 4

## Plan validation: 20261127-230103-template-updates-collector.md

**Verdict:** APPROVE WITH CHANGES

Scope of this round: the sections the round-3 edits changed (flushWave gated on a branch commit, the `run` line with `of`, resume in the status's own wave, the global one-PR limit, the changelog check in `publish()`, the worktree compare, the name leave-outs). Items that the round-1 to round-3 logs fixed or rejected are not raised again.

### Blocking issues

- [Discrepancy / wrong data] The round-3 `run` line is a third line kind, but the plan still says there are two kinds, and the reader drops lines of an unknown kind. — Plan line 21: "Wave lines are append-only, two kinds: `update` and `collected`". Plan line 65 (Contracts) is garbled: "`update` line: `run` line: { v: 1, kind: 'run', … }". Step 2 (line 140): `readWave()` "skips lines that … have no known `kind`", and then keeps per repo only "the complete run (its `run` line and all `of` update lines present)". — An implementer who takes the kinds from line 21 or from the Contracts list makes `run` an unknown kind. Then no run is ever complete, and `readWave()` drops every update, so no wave is ever pending. — Fix: say "three kinds: `run`, `update` and `collected`" in line 21. In Contracts, give the `run` line its own bullet. In step 2, name the three known kinds. Add one waves test: a wave with only `run` and `update` lines gives a pending update (fails if `run` is an unknown kind).

- [Contradiction / wrong data] The `<project>` replacement in `task.json` does not apply the name leave-outs, but the generic check does. — Plan line 24 leaves out short names, contract defaults and the collector repo's own values (for example `Personal` in `.claude/bootstrap.json:7`) "so a common value does not block every template edit". Plan line 26 and step 11 (line 149) still replace "each private name of the wave with `<project>`", with no leave-out. Step 12 (line 150) applies the leave-outs only in `privateHits()`, and `privateHits()` refuses the marker `<project>` (line 32). — Example: a project with client `Personal` sends the excerpt "use a personal access token". `task.json` then says "use a `<project>` access token". The session copies that line, and the run fails on the marker, or writes wrong text. The Tests case "a `names` entry `Default` or `Personal` does not refuse a template line" (line 174) calls `checkCollect()` directly, so it passes and does not catch this. — Fix: in line 26 and step 11, replace only the names that are left after the leave-outs of line 24 (one shared helper for both places). Add a full-run test: a wave whose `names` holds `Personal` and an excerpt with "personal access token" gives a `task.json` with that text unchanged.

### Non-blocking concerns

- [Edge case / failure path] `flushWave()` reads every saved file of the repo with `git rev-list --count <baseSha>..<branch>`, but a saved file stays after a successful append until its branch is gone. — Step 4 (line 142). After a merge, `auto-pipeline.sh --cleanup` or GitHub deletes the branch. Then `rev-list` on a missing branch fails, and `must()` throws (`upgrade-run.mjs:61`). Today `upgrade()` guards the same call with `hasLocal ?` (`upgrade-run.mjs:528`). `remoteBranchSha()` also throws when `ls-remote` fails (`upgrade-run.mjs:96-101`). Plan line 22 covers only a failed append. — Suggestion: say that a missing local branch counts as 0, and that a failed branch check is handled like a failed append (one redacted line, no failed run). Add a test: a saved file whose branch was deleted after its lines were appended is deleted, and the run does not fail.

- [Contradiction] Plan line 29 carries "`collectId`, `ids`, `round` and `branch`" from the previous status, without `hash`. Step 10 (line 148) carries `hash` too, and the resume "in the status's own wave" needs it. The mirror `upgrade()` writes `hash: null, branch: null` in its first status write (`upgrade-run.mjs:468-469`). — When an implementer mirrors that and a run fails at `git fetch`, the status loses the wave of a PR made before a crash. The next run then picks another wave, and two collector PRs can be open. — Suggestion: add `hash` to line 29. Say that the first status write keeps `hash`, `branch`, `ids`, `round` and `collectId`, and that the new `hash` and `branch` go into the status together, in one `writeStatus()`.

- [Edge case] After the resume drops a branch with no commit (line 29), the status still holds that `branch` and its `ids`, and no `collected` line has them. — `startBootstrapCollect()` (step 16, line 154) allows a start when "a branch with no `collected` line in its own wave" exists. That test then stays true after every later run. — Suggestion: clear `branch`, `ids` and `round` in the status when the resume drops the branch.

- [Discrepancy] Contracts line 72 says that `bootstrap-upgrade.json` gets `templatesHash` and `runId`. Step 19 (line 157) adds only `templatesHash` to "Upgrade run status" in `contracts.md`. Step 4 writes both. — Suggestion: add `runId` in step 19.

- [Cost] The global open-PR check (step 10) calls `branchPrs()` once for each wave file that has a `collected` line with a `pr`. Wave files are never deleted, so the number of `gh` calls goes up with each wave. — Suggestion: check only `collected` lines whose PR state is not yet known as merged or closed, or say that the growth is accepted.

- [Edge case] A `same` run that crashes after its `collected` line and before "drop the worktree and branch" (step 11) leaves the round-k worktree. No resume path removes it, because its branch has a `collected` line. — Suggestion: name the leftover worktree in the report, or drop it when the next run finds it.

### Edge cases the plan should address

- An upgrade PR of a project that is merged with a merge commit (`git.mergeStyle` is not always `squash`, `contracts.md:97`). Then `<baseSha>..<branch>` is 0. When the remote branch is gone and the worktree is removed, `flushWave()` deletes lines that it never appended. — Lines that a failed append kept are then lost with no log.
- A closed collector PR is "the owner's no" (line 28), but a newer upgrade run of the same repo in the same wave writes the same feature with new ids. They are pending, so the next round proposes the rejected feature again. — The owner can get the same rejected PR again and again.
- A wave whose updates all come from runs with `of: 0` after older runs that had updates (line 23). The wave stops being pending even when a `collected` line never took the older ids. — This is correct, but the dashboard and the report should not show it as an error.

### Checklist

- [ ] All referenced files, lines, sections and symbols exist as stated (the symbols exist: `remoteBranchSha`, `listedWorktrees`, `branchPrs`, `publish`, `bootstrapRunOf`, `changelog-validate.mjs --base`, lesson 16; the Contracts label of the `run` line is garbled, and the kinds count is wrong)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (tenant or owner, when the project scopes data) per endpoint
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (no test for a `run`-kind wave read through `readWave()` alone, a full-run leave-out case, or a deleted-branch flush)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the line kinds the same in every section. In "Decisions taken for the owner", change "two kinds: `update` and `collected`" to "three kinds: `run`, `update` and `collected`". In Contracts, give the `run` line its own bullet (remove the "`update` line: `run` line:" label). In step 2, name the three kinds that `readWave()` knows. Add a bootstrap-waves test: a wave with only `run` and `update` lines gives one pending update. (evidence: plan lines 21, 65, 140)
2. Apply the name leave-outs (short names, contract defaults, the collector repo's own `.claude/bootstrap.json` values) to the `<project>` replacement in `task.json`, with the same helper as `privateHits()`. Change the redaction decision and step 11. Add a full-run test: `names` holds `Personal`, and an excerpt "use a personal access token" stays unchanged in `task.json`. (evidence: plan lines 24, 26, 149, 150; .claude/bootstrap.json:7)

SHOULD FIX:
1. In step 4 `flushWave()`: a missing local branch counts as 0 commits ahead (guard it as upgrade-run.mjs:528 does), and a failed `rev-list` or `ls-remote` logs one redacted line and does not fail the run. Add a test: a saved file whose branch was deleted after its lines were appended is deleted, and the run does not fail. (evidence: upgrade-run.mjs:61, 96-101, 528; plan line 142)
2. Add `hash` to the carried fields of the collector-id decision. Say that the first status write keeps `hash`, `branch`, `ids`, `round`, `collectId`, unlike upgrade-run.mjs:468, and that a new `hash` and `branch` go into the status in one write. (evidence: plan lines 29, 148; upgrade-run.mjs:468-469)
3. When the resume drops a branch with no commit, clear `branch`, `ids` and `round` in the status, so `startBootstrapCollect()` does not see a resume that is needed forever. (evidence: plan lines 29, 154)
4. In step 19, add `runId` to "Upgrade run status" next to `templatesHash`. (evidence: plan lines 72, 157)
5. Limit the global open-PR check to `collected` lines whose PR is not yet known to be merged or closed, or say that one `gh` call per wave file is accepted. (evidence: plan line 148)
6. Name the leftover round-k worktree of a `same` run that crashed after its `collected` line in the report, or drop it on the next run. (evidence: plan line 149)

ADD THESE EDGE CASES:
- An upgrade PR merged with a merge commit (mergeStyle is not squash): `<baseSha>..<branch>` is 0, and lines that were never appended can be deleted without a log.
- A collector PR that the owner closed, then a newer upgrade run of the same repo in the same wave with the same feature: the new ids are pending again, and the next round proposes the rejected feature.
- A newer `of: 0` run that makes a wave not pending: the dashboard and the report do not show it as an error.

Do not change anything the validation did not flag.
```
