**Validation round:** 3

## Plan validation: 20261124-123513-bootstrap-upgrade-run.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round 2 fixes hold. Those fixes are the submodule-safe pending worktree, the top-level catch, the saved body with its hash marker, isolation with no allow rules, the lock with `ESRCH` and rename, the nothing-staged rule, and the deterministic lock and dashboard tests. One new blocking defect: after a closed PR, the "start again" commands that the plan prints can never work. `gh pr list --state all` still returns the closed PR after you delete the branch, so the next run stops again for the same hash. The other findings are small and do not block.

### Round 2 fixes: do they hold?

| Area | Holds? | Evidence |
| --- | --- | --- |
| Step 2 lock (`mkdirSync`, `'wx'`, `ESRCH` only, `EPERM` = live, rename to a private name, PID check, one retry, `finally` removes only its own lock) | Yes | plan:114-118. A run with 3 runs at the same time is NB 3. |
| Step 3: pending worktree removed with `remove --force` in a `finally`, prune, stray `pending-*` removed, real worktree added at `origin/<base>` | Yes | plan:119, 124. `render.mjs:983` accepts a worktree. No `worktree move`. |
| Step 3 recovery order (gh only without `--no-push`, `ls-remote refs/heads/<branch>` + non-empty check, SHA compare, fast-forward push, gh with cwd = repo, branch 3 `--no-push` → `committed`, unregistered folder → `rmSync` + prune) | Partly | B1 (a closed PR loops forever), NB 1 (branch 2 ignores `--no-push`), NB 2 (`origin/<branch>` may not exist locally). |
| Step 5 isolation (cwd = run folder, no `--add-dir`, no `--allowedTools`, `--disallowedTools Bash WebFetch WebSearch`, numbered files, stage in `workDir`, worktree `status --ignored` check) | Yes, as far as reading can prove it | plan:126, 77. Harness constraints (plan:187) keep the live check as an open item. NB 4: user-level allow rules and MCP tools. |
| Step 10 nothing-staged rule | Yes | `render.mjs:1042-1043` always writes `renderHash`. Nothing is staged only when `saved === hash` and every file is `keep`. The "nothing staged" test (plan:154) sets up exactly that state. |
| Step 10 saved body before the `--no-push` exit, hash marker | Yes | plan:53, 131. |
| Closed PR on the chip (`prState` from `prLists[root].allByBranch`) | Yes | `server.mjs:1344-1353`, 1458. |
| Test determinism (two runs with a `go` file, `keep` for the "failed before" file, dashboard test waits for the run's PID to end) | Yes | plan:158, 161, 179. NB 6 and NB 7 are two contradictions in the test text. |

### Blocking issues

1. [Recovery / closed PR] The "start again" path after a closed PR cannot work. Evidence: plan:120 (`gh pr list --head <branch> --state all …`; "A `CLOSED` or `MERGED` PR → fail with '… to start again run: git branch -D <branch> and git push origin --delete <branch>'"), plan:29 (Context), plan:139 (the docs describe "a closed PR"), plan:171 (the test checks only the error text). GitHub keeps a closed PR, with its `headRefName`, after the head branch is deleted. So `gh pr list --head auto/bootstrap-upgrade-<hash> --state all` returns the same `CLOSED` PR after the owner runs both commands, and the next run stops again with the same message. The dashboard does not block the click (step 16 allows it, because `prState` is `CLOSED`), so the owner gets "upgrade failed" on every click until the template hash changes. This is known gh/GitHub behavior; a live call did not verify it (that would need a real repo). Fix: count a `CLOSED` or `MERGED` PR as a stop only while the branch still exists on `origin` or locally (check the `ls-remote` and the local branch first). When both are gone, ignore the closed PRs and start fresh. When the list holds an `OPEN` PR, it wins over the closed ones. Extend the test: a `CLOSED` PR in `pr list` with no local or remote branch → the run goes on and ends `pr` (or `committed` with `--no-push`).

### Non-blocking concerns

1. [Recovery / `--no-push`] Branch 2 (the branch is on `origin`) ignores `--no-push`: when the SHAs are equal it goes to step 11 (PR), and when local is ahead it goes to step 11 (push). Evidence: plan:121, against plan:120 ("Without `--no-push` only") and plan:122 (branch 3 handles `--no-push`). Suggestion: with `--no-push`, branch 2 also writes `committed` and exits 0.
2. [Recovery / remote-tracking ref] `git worktree add --track -b <branch> <wt> origin/<branch>` needs the local ref `refs/remotes/origin/<branch>`. Step 3 fetches only `<base>` (plan:119), and `ls-remote` writes no ref. The ref exists only when this clone did the `push -u`. Evidence: plan:121. Suggestion: first run `git fetch origin refs/heads/<branch>:refs/remotes/origin/<branch>`, or create the branch from the SHA that `ls-remote` printed.
3. [Lock] When B renames A's new, live lock and then "renames it back", `renameSync` overwrites. A third run that took the lock in that gap loses its lock. A rename that gets `ENOENT` (A removed the stale lock, but its new lock does not exist yet) has no rule. Evidence: plan:116. Suggestion: rename back with `linkSync` + `unlinkSync`, which fails on `EEXIST`, and treat `ENOENT` on the rename as "retry `'wx'` once". This needs 3 runs at the same time, so it is rare.
4. [Isolation] "No allow rules" covers only the CLI flags. The session still loads the user's `~/.claude/settings.json` (its allow rules, hooks and MCP servers) and plugin tools. An allow rule there, for example a bare `Read` or an MCP tool, widens the session again. Evidence: plan:77, 126. The owner's file has no `Read`/`Glob`/`Grep`/`Write`/`Edit`/`mcp__` rules today (checked with grep), but the skill is global. Suggestion: add `--strict-mcp-config` (no MCP servers), and add a line about the user-level rules to Harness constraints.
5. [Base pinning] The dashboard fetches `pr.base` in the background (`server.mjs:1640-1641`), and that fetch can move `origin/<base>` between the pending worktree and the real worktree (plan:119, 124). The branch name then carries the hash of another commit. Suggestion: resolve `origin/<base>` to a SHA once, and use that SHA for both worktrees and for "commits over `origin/<base>`".
6. [Test text] "Claude sees only the run folder" asserts "no stage folder" (plan:150), but the Contracts put `stage/<n>` in the run folder (plan:55, 126). Suggestion: assert "no folder other than `current`, `stage`, `refs`, `merged`, and no file with a repo path name".
7. [Test text] "Only new files, no changed file" (plan:153) adds a deleted file to the common setup (plan:147). That setup already changes an answer and edits a skill file, so files are `changed` and the fake `claude` is called. Suggestion: start this test from a repo just rendered (as in "Nothing staged"), then delete one rendered file. With no answer change and no skill edit, nothing is `changed`.
8. [Branch 3 body] Branch 3 goes to step 11 (push), but it does not say that it checks the saved body hash as branch 2 does. A crash between the commit and the body write leaves no body. Evidence: plan:122, 131. Suggestion: use the same "no saved body" check in both branches.
9. [Leftovers] On success, no step removes `workDir` or `runDir` (they hold copies of project files in the system temp folder). Evidence: plan:125, 131. Suggestion: always remove `workDir`, and remove `runDir` on success.
10. [Error length] The `error` is cut to 500 characters (plan:52), and on a hook failure it holds the hook output. The run folder path can fall off the end. Suggestion: put the run folder first.

### Edge cases the plan should address

- A PR closed without a merge, then the owner deletes both branches as told: the next run must start fresh (B1).
- A list with a closed PR and an open PR for the same head: the open PR wins (B1).
- A `--no-push` run when the branch is already on `origin` (NB 1).
- A clone that did not push the branch itself: `origin/<branch>` is missing (NB 2).
- A background dashboard fetch that moves `origin/<base>` during step 3 (NB 5).

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`render.mjs:185` `moduleOn`, `:737` `isExecutable`, `:897-933` `plan()`, `:941` `renderHash`, `:1005-1009` `--status`, `:1028-1043` `--apply`; `verify.mjs:195,200-201,265-279`; `server.mjs:54,694-715,875,896-920,921,1344-1353,2856,2899`; `app.js:509-533,2939`; `auto-pipeline.sh:37-38,479-485,543-573`; `scout.mjs:48-52`; `test/bootstrap-project.test.mjs:16-26`; `SKILL.md:4,7,9`)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently (canary, trigger and auto-merge list stay open, parent:37-39)
- [x] Restart after dashboard changes respected (plan:35)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected (NB 6, NB 7 are text fixes)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail (`package.json:7` globs `test/*.test.mjs`; `.claude/scripts/changelog-validate.mjs` exists)

```
Update the plan at .plans/20261124-123513-bootstrap-upgrade-run.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Step 3: stop on a CLOSED or MERGED PR only while the branch still exists on origin or locally. When both are gone (the owner ran the two "start again" commands), ignore the closed PRs and start fresh. An OPEN PR in the list wins over the closed ones. Extend the test "A closed PR exists" with a second case: a CLOSED PR in `pr list`, no local or remote branch → the run goes on and ends `pr`. Update Context (line 29) and the docs step (line 139) to match. (evidence: plan:120, plan:29, plan:171; GitHub keeps a closed PR's headRefName after the branch is deleted)

SHOULD FIX:
1. Step 3 branch 2: with --no-push, write status `committed` and exit 0 (no push, no PR). (evidence: plan:121)
2. Step 3 branch 2: run `git fetch origin refs/heads/<branch>:refs/remotes/origin/<branch>` before `git worktree add --track -b <branch> <wt> origin/<branch>`, or create the branch from the SHA that ls-remote printed. (evidence: plan:119, plan:121)
3. Step 2: rename the lock back with linkSync + unlinkSync (fails on EEXIST), and treat ENOENT on the rename as "retry 'wx' once". (evidence: plan:116)
4. Step 5: add `--strict-mcp-config`, and say in Harness constraints that user-level allow rules in ~/.claude/settings.json still apply to the session. (evidence: plan:77, plan:126, plan:187)
5. Step 3: resolve origin/<base> to a SHA once, and use it for the pending worktree, the real worktree and "commits over origin/<base>" (the dashboard fetches the base in the background). (evidence: plan:119, plan:124; apps/dashboard/server.mjs:1640-1641)
6. Test "Claude sees only the run folder": replace "no stage folder" with "only the folders current, stage, refs, merged". (evidence: plan:150 against plan:55)
7. Test "Only new files, no changed file": start from a repo just rendered (no answer change, no skill edit), then delete one rendered file. (evidence: plan:153 against plan:147)
8. Step 3 branch 3: check the saved body hash, as branch 2 does, before step 11. (evidence: plan:122)
9. Remove workDir after every run, and runDir after a successful run. (evidence: plan:125, plan:131)
10. Put the run folder path first in the error text, so the 500-character cut does not remove it. (evidence: plan:52, plan:131)

ADD THESE EDGE CASES:
- A closed PR, then both branches deleted: the next run starts fresh.
- A closed PR and an open PR for the same head branch.
- A --no-push run when the branch is already on origin.
- A clone that did not push the branch itself (no origin/<branch> ref).
- A background fetch that moves origin/<base> during step 3.

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
