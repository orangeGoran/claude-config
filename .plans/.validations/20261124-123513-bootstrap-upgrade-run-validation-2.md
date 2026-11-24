**Validation round:** 2

## Plan validation: 20261124-123513-bootstrap-upgrade-run.md

**Verdict:** APPROVE WITH CHANGES

TLDR: Most round 1 fixes hold. Four gaps are blocking. (1) `git worktree move` fails in every repo with submodules. (2) A failure in step 3 leaves the pending worktree behind and has no `failed` status write. (3) Recovery branch 3 ("continue at push") has no PR body to send. (4) A bare `Read` allow rule lets the session read any file on the disk, not only the run folder. Each one has a small fix.

### Round 1 fixes: do they hold?

| R1 # | Fix | Holds? | Note |
| --- | --- | --- | --- |
| 1 | Copies in the run folder, no `--add-dir`, `git status` check after the session | Partly | No `--add-dir` holds. New defects: bare `--allowedTools Read Glob Grep` widens reads to the whole disk (B4); nested `CLAUDE.md` copies in the cwd (S9). |
| 2 | Exact path set, `safeRel()`, no symlink, no extra file | Yes | Plan:118. Encoded names cannot collide: rendered paths never keep a `dot-` segment (`render.mjs:727`). |
| 3 | "verify fails" test uses a merged skill without "bare" | Yes | `verify.mjs:200-201`. |
| 4 | Recovery order in step 3 | Partly | B1, B2, B3, S2. |
| 5 | `git.base = 'main'` in tests | Yes | `bootstrapRepo(edit)` at `test/bootstrap-project.test.mjs:16,22` takes the edit. |
| 6 | Dashboard "starts a run" test | Partly | Still a race on the status file (S8). |
| 7 | `openSync(…,'wx')` lock | Partly | The lock folder may not exist (S5). The two-runs test is not deterministic (S6). |
| 8 | Hash from a pending worktree at `origin/<base>` | Yes | `render.mjs:983` accepts a worktree (`.git` file exists). |
| 9 | Empty decisions when nothing is `changed` | Yes | Plan:116. |
| 10 | `spawnSync`, exit 1 with JSON is a result | Yes | `verify.mjs:268,279`. |
| 11 | Verify before and after | Yes, but test S7 | |
| 12–24 | Restart line, `acme-api`, `@@` pattern, `dot-` rule, timeout, open-PR refusal, git identity, consumer list, no `node --check`, route order, `branch -D` note, harness note, label fallback | Yes | Checked against `server.mjs:2853-2899`, `verify.mjs:194`, `auto-pipeline.sh:572-573`, `.claude/settings.json:16,23,24,32`. |
| 25 | Run folder stays, worktree removed | Yes for steps 4–9 | Steps 2–3 are not covered (B2). |

### Blocking issues

1. [Recovery / git] `git worktree move` refuses a worktree with submodules. Evidence: plan:115 ("`git worktree move <pending> <worktrees dir>/<slug>`"). The git-worktree docs for `move` say that linked worktrees that contain submodules cannot be moved. git checks the gitlinks in the index, so this applies even when the submodules are not initialized. The fleet has repos with submodules: `auto-pipeline.sh:554-566` has special handling for them. Result: in such a repo, every run fails at step 3. Fix: do not move. After `render.mjs <pending> --status`, run `git worktree remove --force <pending>` (remove `--force` works with submodules), then `git worktree add -b <branch> <worktrees dir>/<slug> origin/<base>`. That is the same commit, so the hash does not change. The order-of-branches logic stays the same.

2. [Recovery / cleanup] Failures in steps 2–3 have no cleanup rule and no status rule. Evidence: plan:121 ("Every failure in steps 4–9 removes the worktree…"), plan:122 (step 10 only), plan:110-115. Step 3 can fail after the pending worktree exists: `render.mjs --status` fails (bad answers), `gh pr list` fails (no `gh` login, no GitHub remote), `git ls-remote` fails, `worktree add`/`move` fails, or branch 2 fails with "no saved body". Then `bootstrap-upgrade-pending-<pid>` stays registered in `git worktree list`. It gets a new name on each retry, and `--cleanup` never removes it (`auto-pipeline.sh:545-546` only knows `auto/<slug>`). The dashboard also lists it as a stray worktree (`server.mjs:568-569`, `worktreesFor()` at 1455). No step says that a step 3 failure writes `failed`, so the status stays `running` until the server marks the PID as gone. Fix: (a) Put step 3 in a `try/finally` that removes the pending worktree on every exit path (the success path, the three early exits and every throw). (b) Use one top-level `catch` that writes `failed` with `step` and `error` for any failure after the lock. (c) At the start of step 3, under the lock, run `git worktree prune` and remove leftover `bootstrap-upgrade-pending-*` folders (a crashed run, a killed run). (d) Add a test: `gh pr list` fails → exit 1, status `failed`, no `bootstrap-upgrade-pending-*` folder or worktree entry left.

3. [Recovery / PR body] Recovery branch 3 ("local branch with commits → continue at step 10 (push)") has no body to send. Evidence: plan:113, plan:121 ("With `--no-push`, write status `committed` and exit 0", which comes before the body), plan:122 (the body is built from `templateUpdates`, `questions`, the verify result and the file table). A new process has none of that data. The usual way into branch 3 is a `--no-push` run (or a `committed` status) followed by a click. Then step 10 either builds an empty or wrong body, or crashes. Branch 2 already requires the saved body, but branch 3 does not. Fix: write `bootstrap-upgrade-pr-body.md` in step 9 right after the commit, before the `--no-push` exit. Put the hash in the body file (or in its name), so that a body from another hash is never sent. Branches 2 and 3 then use the saved file and fail with the same "no saved body" message when it is missing or has another hash. Step 10 says "write the body (skipped when resuming)". Add a test: a `--no-push` run, then a run without it → one push, `pr create` with the saved body, status `pr`, no second commit.

4. [Scope of the session] A bare `--allowedTools Read Glob Grep` lets the session read any path. Evidence: plan:117 (`--allowedTools Read Glob Grep`), plan:26 ("Claude reads and writes only the run folder"), plan:140 (the test only checks cwd and argv). In Claude Code, an allow rule with a bare tool name matches every use of that tool, including paths outside the working folder. Read-only tools inside the cwd need no rule. The session reads project files (input that the project controls), and its output (the merged files) goes into a PR on GitHub. So a file outside the run folder (for example another project's `.env`) could end up in a PR. Fix: give no `--allowedTools` for these tools (the cwd is enough), or scope them to the run folder (`Read(//<runDir>/**)`, `Glob(//<runDir>/**)`, `Grep(//<runDir>/**)`). Add the argv check to the test "Claude sees only the run folder". (Taken from the Claude Code permission rules. A live run did not verify it; the by-hand check in Harness constraints can include one read outside the run folder.)

### Non-blocking concerns

1. [Recovery / gh] `gh pr list --head <branch> --state open --json number,url` is valid gh syntax and prints `[]` when no PR matches. But it fails when `gh` is not logged in or the repo has no GitHub remote, and the plan runs it even with `--no-push`. Evidence: plan:111. Suggestion: skip branches 1–2 with `--no-push`, and write a clear `error` ("gh cannot see the GitHub repo") otherwise.
2. [Recovery / ls-remote] `git ls-remote --heads origin <branch>` exits 0 also when nothing matches, and its pattern matches the end of the ref (`refs/heads/x/auto/bootstrap-upgrade-<hash>` matches too). Evidence: plan:112. Suggestion: query `refs/heads/<branch>` and test for non-empty stdout (or use `--exit-code` and treat exit 2 as "absent").
3. [Recovery / cwd] Branch 2 runs `gh pr create` with cwd = `<wt>`, which may not exist any more (the owner removed it). Evidence: plan:112, plan:122. Suggestion: run gh with cwd = `<repo>` (with `--head`, no worktree is needed).
4. [Recovery / --no-push] Branch 3 continues at the push even when this run has `--no-push`. Evidence: plan:113. Suggestion: with `--no-push`, branch 3 writes `committed` and exits 0.
5. [Recovery / leftover] Branch 4 says "the local branch or its worktree folder exists". When the folder exists but git does not have it registered, `git worktree remove --force` fails. Evidence: plan:114. Suggestion: `git worktree prune`, then remove the folder when no registered worktree points at it.
6. [Closed PR] A PR that the owner closes without a merge blocks the chip until the hash changes: step 15 refuses ("upgrade PR #N is open"), and step 16 shows only the link. Evidence: plan:127-128. The server already knows the PR state per branch (`prLists[root].allByBranch`, `server.mjs:1458`). Suggestion: treat a `pr` status as open only when that branch's PR is `OPEN` in the cached list. Otherwise show "bootstrap update ▶" again.
7. [Git hooks] `git commit` and `git push` in a fresh worktree run the project's hooks (husky sets `core.hooksPath`, which all worktrees share), and the worktree has no install. The hooks fail or download tools. Evidence: plan:121-122. `render.mjs:245` counts git hooks as a feature that projects have. Suggestion: state the choice. Either keep the hooks and write an `error` that names the hook, or use `git -c core.hooksPath=/dev/null` with a reason. It is internal tooling, and `verify.mjs` already ran.
8. [Lock folder] `openSync(<repo>/.plans/auto-runs/bootstrap-upgrade.lock,'wx')` throws ENOENT when `.plans/auto-runs/` does not exist yet (a repo that never ran a pipeline). Evidence: plan:109. Suggestion: `mkdirSync(…, { recursive: true })` first.
9. [Stale lock race] Two runs that both see a stale lock can both unlink and recreate it: B can remove the lock that A just made. Evidence: plan:109. Suggestion: after the unlink, retry with `'wx'` once and fail on a second `EEXIST`, or have the loser check the file's PID again after its own create.
10. [Status step] `step` has no value for step 3 (inputs and recovery). A step 3 failure would show `render`. Evidence: plan:51, plan:109. Suggestion: add `prepare`.
11. [Session context] The session's cwd holds the full render stage `<runDir>/stage` (with `CLAUDE.md`, `AGENTS.md` and `.claude/skills/*`), plus copies named `CLAUDE.md` / `AGENTS.md` in `current/` and `stage-copy/`. Claude Code loads a nested `CLAUDE.md` when it reads files in that folder, and `CLAUDE.md` is `@AGENTS.md`, so the project's old rules ("never replace without a yes", etc.) can load as instructions. Evidence: plan:116-117. Suggestion: render the stage outside the run folder (a sibling temp folder), and give each copy a suffix (for example `<encoded>.txt`). Not verified live.
12. [SKILL.md placement] The new section goes after "## Rules". But `SKILL.md:9` first says to read `references/lessons.md` from the skill folder, and `SKILL.md:16` says never to replace a file without a yes. Evidence: plan:124. Suggestion: put the "Unattended mode" lines directly under line 7, so the model reads them first.

### Tests: feasibility

1. [Test / lock] "Two runs started at the same time: exactly one gets past the lock" is not deterministic. When the first run finishes before the second one starts, both get past the lock one after the other. Evidence: plan:149. Fix: the fake `claude` waits for a file that the test writes only after the second run has exited.
2. [Test / failed before] "removes the word 'bare' from a skill file that the upgrade does not change" is not possible as written. Any edit to a rendered file makes it `changed` (`render.mjs:931`), so the fake gets it in `task.json`. Evidence: plan:147. Fix: the fake decides `keep` for that file, and the test says so.
3. [Test / dashboard race] In "The route starts a run", the spawned script fails at the fetch and writes `failed`. That write can land after the test's own `running` write and overwrite it. The second POST then starts a run, and the test fails at random. Evidence: plan:162. Fix: wait until the status is not `running` (or the lock file is gone), then write the `running` status with `process.pid`.
4. The other cases can be done with the existing patterns: fake `gh` and `claude` in `PATH` (`apps/dashboard/test/dashboard.test.mjs:151-155,190-191`), `bootstrapRepo(edit)`, a bare `origin`, and real `git`. The example answers have `changelog: true` (`bootstrap.example.json:122`), so the `--add-label` assertion is valid.

### Edge cases the plan should address

- A repo with submodules: the worktree move (B1), and remove only with `--force`.
- A crashed or killed run leaves `bootstrap-upgrade-pending-*`: prune and remove them under the lock (B2).
- `--no-push`, then a click: the resume path needs the saved body (B3).
- The PR was closed without a merge: a retry must be possible (NB 6).
- Project git hooks in a worktree with no install (NB 7).
- A repo with no `.plans/auto-runs/` yet (NB 8).
- A project with no GitHub remote or no `gh` login (NB 1).
- The main checkout is not pulled after the merge: step 3 already fails with "push or pull .claude/bootstrap.json first". This is correct; the docs section should name it.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`render.mjs:185` `moduleOn`, `:737` `isExecutable`, `:960-1062` CLI, `:1047` JSON; `verify.mjs:194,200,268,279`; `server.mjs:142` ENV, `:548` `fullState`, `:694` `launchGeneric`, `:875` `BOOTSTRAP_SKILL`, `:896` `bootstrapStatus`, `:921` `bootstrapCheck`, `:2856` `/api/launch`, `:2899` slug guard; `app.js:509,529,2939`; `auto-pipeline.sh:37-38,479-487,543-575`; `gitignore.fragment:17`; lessons 2 and 10a)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `bootstrapStatus` → `bootstrapCheck` (`server.mjs:1028`) → `fullState` (`:553`))
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently (canary, trigger and auto-merge list stay open)
- [x] Restart after dashboard changes respected (plan:34)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (one short SKILL.md section; see NB 12)
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (tests 1–3 above; no test for a step 3 failure or a `--no-push` resume)
- [x] Docs: current state only respected
- [x] Contracts respected (shapes go to `references/contracts.md`)
- [x] "How to verify" commands are real and can fail (`.claude/settings.json:16,23,24,32`)

```
Update the plan at .plans/20261124-123513-bootstrap-upgrade-run.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Step 3: do not use `git worktree move` (git refuses to move a worktree that has submodules). After `render.mjs <pending> --status`, run `git worktree remove --force <pending>`, then `git worktree add -b <branch> <worktrees dir>/<slug> origin/<base>`. (evidence: plan line 115; auto-pipeline.sh:554-566 shows submodule repos in the fleet)
2. Steps 2–3: put step 3 in a try/finally that removes the pending worktree on every exit path. Add one top-level catch that writes status `failed` with `step` and `error` for any failure after the lock. At the start of step 3 (under the lock), run `git worktree prune` and remove leftover `bootstrap-upgrade-pending-*` folders. Add a test: `gh pr list` fails → exit 1, status `failed`, no pending folder and no worktree entry left. (evidence: plan lines 110-115, 121)
3. Write the PR body file in step 9 right after the commit, before the `--no-push` exit, and put the hash in the file. Recovery branches 2 and 3 both use the saved body and fail with the "no saved body" message when it is missing or has another hash. Step 10 skips the body write on a resumed run. Add a test: a `--no-push` run, then a run without it → one push, `pr create` with the saved body, status `pr`. (evidence: plan lines 113, 121, 122)
4. Step 5: remove the bare `--allowedTools Read Glob Grep`, or scope each rule to the run folder (`Read(//<runDir>/**)` etc.), so the session cannot read files outside the run folder. Extend the test "Claude sees only the run folder" to check the argv for this. (evidence: plan lines 26, 117, 140)

SHOULD FIX:
1. Step 3: skip the `gh pr list` / remote-branch branches with `--no-push`, and write a clear error when gh cannot see the GitHub repo. (evidence: plan line 111)
2. Step 3: query `git ls-remote --heads origin refs/heads/<branch>` and test for non-empty stdout (exit 0 also means "no match"). (evidence: plan line 112)
3. Recovery branch 2: run `gh pr create` with cwd = the repo, not `<wt>`, which may be gone. (evidence: plan lines 112, 122)
4. Recovery branch 3 with `--no-push`: write `committed` and exit 0, do not push. (evidence: plan line 113)
5. Recovery branch 4: when the worktree folder exists but git does not have it registered, prune and remove the folder; `git worktree remove` fails there. (evidence: plan line 114)
6. Steps 15–16: treat a `pr` status as open only when the cached PR list (`prLists[root].allByBranch`, server.mjs:1458) shows that branch's PR as OPEN. Otherwise allow a new run. (evidence: plan lines 127-128)
7. Steps 9–10: state how the project's git hooks are handled in a worktree with no install (keep them and name the hook in the error, or `git -c core.hooksPath=/dev/null` with a reason). (evidence: plan lines 121-122)
8. Step 2: `mkdirSync(<repo>/.plans/auto-runs, { recursive: true })` before the lock `openSync`. (evidence: plan line 109)
9. Step 2: after you remove a stale lock, retry `'wx'` once and fail on a second EEXIST. (evidence: plan line 109)
10. Contracts: add the step value `prepare` for step 3. (evidence: plan line 51)
11. Step 5: render the stage outside the run folder, and give the copies in `current/` and `stage-copy/` a suffix, so no nested `CLAUDE.md`/`AGENTS.md` loads as instructions in the session. (evidence: plan lines 116-117)
12. Step 12: put the "Unattended mode" lines directly under `Bootstrap this repo: $ARGUMENTS`, before the lessons line and the Rules. (evidence: skills/bootstrap-project/SKILL.md:7-16)
13. Tests: in the two-runs lock test, the fake `claude` waits for a file until the second run has exited. (evidence: plan line 149)
14. Tests: in "A check that failed before", the fake decides `keep` for the skill file without "bare" (any edit makes it `changed`, render.mjs:931). (evidence: plan line 147)
15. Dashboard test "The route starts a run": wait until the status is not `running` (or the lock is gone) before you write the `running` status with `process.pid`. (evidence: plan line 162)

ADD THESE EDGE CASES:
- A repo with submodules (worktree move and remove).
- A crashed or killed run that left `bootstrap-upgrade-pending-*`.
- A `--no-push` run, then a click (resume needs the saved body).
- A PR closed without a merge.
- Project git hooks in a worktree with no install.
- A repo with no `.plans/auto-runs/` folder yet.
- A project with no GitHub remote or no gh login.

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
