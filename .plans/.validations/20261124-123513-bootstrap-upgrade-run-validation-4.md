**Validation round:** 4

## Plan validation: 20261124-123513-bootstrap-upgrade-run.md

**Verdict:** APPROVE WITH CHANGES

TLDR: Every round 3 fix holds, and none of them adds a defect that would make the implementation fail or be unsafe. No blocking findings. Six small points stay. Each one is a clearer sentence or a test-setup detail.

### Round 3 fixes checked

- **Step 2 lock (linkSync restore, ENOENT, empty-lock mtime rule):** this is correct. Only one `renameSync` of the same file succeeds. `linkSync(private, lock)` never overwrites (`EEXIST` means a third holder). A run that dies between the `'wx'` open and the PID write leaves an empty file, and the 60 s mtime rule covers it. The status is written fresh after the lock, so an old run's `pr`/`error` fields cannot leak into the new one. Test "An empty lock file" covers both sides.
- **Step 3 `baseSha`:** this is correct. `server.mjs:1640` fetches in the background, so pinning `baseSha` once is needed. The pending worktree, the `show` compare and the new worktree all use it. `renderHash()` (render.mjs:941) reads the repo only for `HAS_MAKEFILE` (render.mjs:742), so the pending worktree and `<wt>` at the same SHA give the same hash.
- **Closed-PR rule:** this is correct. The rule now fails only while the branch exists (remote or local), and goes on when no branch is left. That fixes the round 3 loop. When an `OPEN` and a `CLOSED` PR both exist, the `OPEN` one wins. On the dashboard side, step 16 allows a click when `prState` is `CLOSED`, so the owner gets the error that holds the two commands. The test covers both runs.
- **Dirty leftover refusal:** this is correct for a listed worktree (`--ignore-submodules=none`). See NB2 for a folder that git does not list.
- **Body before commit:** this is correct. Step 10 writes the body, then commits. Step 3 checks the hash on the body's first line before step 11 on the resume paths. Test "Committed, but the body is gone" proves that nothing is pushed.
- **`baseBranch` export:** this is correct. render.mjs:65 `str` and render.mjs:324 `str(g.base, 'develop')` exist, contracts.md:96 says the default is `develop`, and render.mjs:185 exports `moduleOn`. render.mjs:737 `isExecutable` is not exported today; step 1 exports it.
- **New tests:** they are consistent with the steps (open PR from a crash, dirty leftover, body gone, no `git.base`, empty lock, submodule). See NB3 for the submodule setup.

### Blocking issues

None.

### Non-blocking concerns

1. [Edge case] Step 3 uses `remoteSha` = the output of `git ls-remote --heads origin refs/heads/<branch>` ("empty when none"). A failed `ls-remote` (auth or network) then looks the same as "no remote branch". — plan line 120 — Use `must` for `ls-remote`, so a failure fails the run and is not read as "none". The fetch just before it usually fails first, so the risk is small.
2. [Edge case] Step 3, leftover bullet: "`rmSync` when git does not list the folder". `git -C <wt> status --porcelain` on a folder that is not a worktree exits non-zero with empty stdout, so the dirty check passes and `rmSync` deletes the folder. — plan line 124 — When git does not list `<wt>` and the folder is not empty, check the `git status` exit code too. If it is non-zero, refuse with the same "look at them" message. Only this script makes that folder name, so the risk is small, but the plan says "never discard work".
3. [Tests] Test "A repo with a submodule" adds a local repo as a submodule. Git 2.38.1 and later refuse `file://` and local-path submodule clones unless the command sets `-c protocol.file.allow=always`. — plan line 179 — Name that flag in the test setup, or write `.gitmodules` and the gitlink with `git update-index --cacheinfo 160000,...`, so the setup does not fail on a current git.
4. [Clarity] Step 2 puts the lock removal in a `finally`. Steps 3, 4, 10 and 11 "exit 0" or "exit 1" from inside the `try`. A `process.exit()` there skips the `finally` and leaves the own-PID lock. The stale rule recovers it later, but a reused PID could make it look live. — plan lines 118, 121–127 — Say that `main()` returns an exit code, and that `process.exitCode` is set after the `finally` (no `process.exit()` inside the `try`).
5. [Clarity] The bullet "Step 11 needs the saved body file" comes after the fresh `worktree add` bullet. It applies only to the two resume paths that jump to step 11 (remote branch, and local branch with commits). — plan lines 122–126 — Move it into those two bullets ("before step 11, check the saved body ..."). An implementer could otherwise run it on the fresh path before step 10 writes the body. The test at line 176 would catch that mistake, but the order in the text should match.
6. [Edge case] `bootstrapHash` on the dashboard is the hash of the main checkout (step 15). The run's `hash` comes from `baseSha`. The two are the same while `.claude/bootstrap.json` matches (step 3 checks this) and the Makefile is the same on both sides. When a Makefile was added or removed on only one side, the chip "upgrade PR #N" does not show and the click is allowed again. Step 3's open-PR path then exits 0 with no new PR, so nothing breaks. — server.mjs:913, render.mjs:742 — No change needed. A one-line note in docs/plans-dashboard.md is enough.

### Edge cases the plan should address

- `ls-remote` failure treated as "no branch" (NB1): this hides an auth problem behind a later push error.
- A non-worktree folder at `<wt>` (NB2): it is removed with no dirty check.
- A local-path submodule in the test needs `protocol.file.allow` (NB3).

### Checked against the repository

- render.mjs: `str` :65, `moduleOn` export :185, `buildVars` base default :324, `isExecutable` not exported :737, `--status` JSON :1008, `--apply` list/`new` and the `renderHash` write :1027–1043, the `realpathSync` main guard :1062.
- verify.mjs: `--json` prints `failed` ids :268, exit 1 when it fails :279, placeholder pattern :194, `bare-commands` :201.
- server.mjs: `bootstrapStatus()` result :913 (the `hash` field is added in step 15), `BOOTSTRAP_SKILL` :875, `allByBranch` :1345–1353, POST router `/api/launch` :2856 and the `safeName(b.slug)` guard :2899, cross-site check :131–134, background fetch :1640.
- app.js: `data-bscopy` chip :511–516 and handler :531, `post()` :2941.
- SKILL.md: `argument-hint` :4, "Bootstrap this repo: $ARGUMENTS" :7, the `SKILL_DIR`/lessons line :9.
- auto-pipeline.sh: `WORKTREES_DIR` :37–38, `--cleanup` :543–546, `start_session()` flags :479–487.
- `.plans/auto-runs/` gitignored: gitignore.fragment:17. contracts.md `git.base` default: :96.
- `npm test` glob `apps/*/test/*.test.mjs test/*.test.mjs` (package.json:7) runs the new `test/bootstrap-upgrade-run.test.mjs`.
- `.claude/scripts/changelog-validate.mjs` exists. The roadmap links the parent plan (docs/roadmap.md:32).

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261124-123513-bootstrap-upgrade-run.md. A validation found the issues below. There are no blocking items. Keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 3, get remoteSha with `must git ls-remote ...`, so a failed ls-remote fails the run and is not read as "no remote branch" (evidence: plan line 120).
2. In the step 3 leftover bullet, when git does not list <wt> and the folder is not empty, refuse when `git -C <wt> status` exits non-zero, with the same "look at them" message, before any rmSync (evidence: plan line 124).
3. In the test "A repo with a submodule", add the submodule with `git -c protocol.file.allow=always submodule add`, or write the gitlink with `git update-index --cacheinfo`, so the setup works on git 2.38.1 and later (evidence: plan line 179).
4. In step 2, say that main() returns the exit code and sets process.exitCode after the finally; no process.exit() inside the try, so the lock is always removed (evidence: plan lines 118-127).
5. In step 3, move the "saved body" check into the two resume bullets that go to step 11 (remote branch, local branch with commits), so it never runs on the fresh path (evidence: plan lines 122-126).

ADD THESE EDGE CASES:
- ls-remote fails (auth or network) -> the run fails with the reason.
- A folder at <wt> that git does not list and that is not empty -> the run refuses, and the folder stays.

Do not change anything the validation did not flag.
```
