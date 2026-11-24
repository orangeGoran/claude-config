# Plan: Unattended bootstrap upgrade of one project (dashboard button → draft PR)

- **Base**: main
- **Parent**: `.plans/20261124-123512-bootstrap-fleet-upgrade-parent.md`

## Goal

One click on the dashboard chip "bootstrap update" upgrades that project's bootstrap-project scaffolding with no chat and no owner step, and ends in a draft PR. This is phase 1 of the parent plan. Phases 2–5 (collector, waves, owner values, auto-merge) build on the script and the status file of this plan.

Example, end to end (made-up project `acme-api` in `~/code/acme-api`):

1. `acme-api` shows the chip "bootstrap update" (the template hash differs from the saved `renderHash`).
2. The owner clicks it. The server starts `node skills/bootstrap-project/scripts/upgrade-run.mjs ~/code/acme-api` in the background.
3. The script takes the lock, fetches `origin/main`, finds the template hash of `origin/main`, and creates the worktree `~/code/worktrees/acme-api/bootstrap-upgrade-<hash>` on the branch `auto/bootstrap-upgrade-<hash>`.
4. `render.mjs` renders the templates for the worktree into a private work folder. There are 30 changed files. The script copies the repo version and the rendered version of each changed file into a run folder, as numbered files (`current/1`, `stage/1`, …).
5. A headless Claude session, with only the run folder as its working folder and no read rules, runs `/bootstrap-project --upgrade --unattended <run folder>/task.json`. It decides merge, keep or replace for each file and writes `merged/<n>` files and `decisions.json` into the run folder.
6. The script checks the decisions, writes the new, replaced and merged files into the worktree, runs `verify.mjs`, makes one commit, pushes the branch and opens a draft PR. The chip now says "upgrade PR #41".
7. The owner reviews and merges PR #41. After a pull, the hash matches and the chip goes away.

## Context

- Parent plan sections: Findings, Decisions taken by the owner, Phases (1).
- Decisions taken for this plan:
  - Parent 3A, phase 1 part: owner items (CONFIG lines that differ, orphan files, template updates, questions from the merge, checks that already failed before the upgrade) go into the PR body as checkboxes. The run never stops for them.
  - Parent 2A, phase 1 part: template updates go only into the PR body. The collector is phase 2.
  - Approach (decided in this plan, see Reference implementation): a standalone script in the skill. Claude gets everything it needs in the run folder and can write only there; the script writes the repo. The project's own `auto-pipeline.sh` is not used.
  - The push and the draft PR on `auto/bootstrap-upgrade-<hash>` count as the "to PR" permission (AGENTS.md, Git). The script never pushes the base branch and never force-pushes.
  - The PR gets the label `no-changelog` when the project's `changelog` module is on. The change is internal tooling. When the label call fails, the PR body gets one more owner checkbox: "add the label `no-changelog`".
  - Recovery (see step 3): a failure before the commit removes the worktree and the local branch, so a retry starts clean; the run folder stays for a look. A failure after the commit keeps the branch, and a retry continues from the push or the PR. An open PR for the same hash is never made twice. A PR for the same hash that was closed stops the run with the commands to start again (the owner closed it on purpose).
  - Owner answer 2026-11-24 (validation round 4, question 1 → A): the Claude session's boundary is the Claude Code permission system (the same trust as every `auto-pipeline.sh` run), with no probe gate. The first real run is checked by hand (Harness constraints, Open items).
  - The commit runs the project's git hooks (no `--no-verify`). A hook failure is a run failure, and the `error` has the hook output.
- Open decisions this plan does not take: the open decisions of the parent plan (canary choice, trigger, auto-merge file list).

## Hard rules

- **Restart after dashboard changes:** the plan changes `apps/dashboard/server.mjs` and `apps/dashboard/page/app.js`. The run is in a worktree, so its report lists under Open items: "after the merge and `git pull`, run `pgrep -fl chat-relay.mjs`; run `npm run restart` only when it shows that the live chats run under the relay".
- **No npm dependencies:** `upgrade-run.mjs` and the tests use only Node built-ins (`node:child_process`, `node:fs`, `node:os`, `node:path`). It calls `git`, `gh` and `claude` as programs.
- **Public repo: no private data:** the plan, the tests and the docs use the made-up project `acme-api` (the example answers) and temp folders. The PR body template names no project. The status `error` is redacted before it is written (step 1).
- **Global rules affect every project:** `skills/bootstrap-project/SKILL.md` gets one short section (about 3 lines) that points to the run folder's copy of `references/unattended.md`. Interactive runs skip it when `--unattended` is not given.
- **Never stop processes by name:** the script stops only its own Claude child after the timeout, with `child.kill()`. The lock checks a PID with `process.kill(pid, 0)`. The tests stop only the children that they started.
- **Tests for logic changes:** the new `test/bootstrap-upgrade-run.test.mjs` tests the script, and `apps/dashboard/test/dashboard.test.mjs` gets tests for the new route and state fields.
- **Docs: current state only:** `docs/plans-dashboard.md` gets one short section about the chip. `references/contracts.md` gets the new file shapes. No change history.

## Endpoint access

| Endpoint | Method | Access |
| --- | --- | --- |
| `/api/bootstrap-upgrade` | POST | The same as every other POST route: the existing local-host and same-origin checks of the server (403 otherwise). No rate limit; the lock file refuses a second run (`{ ok: false }`). |

## Contracts

- New file `<repo>/.plans/auto-runs/bootstrap-upgrade.lock`: one line `<pid>`, made with `openSync(…, 'wx')`. Only the lock holder writes the status file. The script removes only its own lock; the server removes a stale lock (dead PID, or empty and older than 60 s) right before it starts a run.
- New file `<repo>/.plans/auto-runs/bootstrap-upgrade.json` (the run status). Written by `upgrade-run.mjs`, read by the server. Shape: `{ state: 'running' | 'pr' | 'committed' | 'same' | 'failed', step, hash, base, branch, worktree, runDir, pid, pr: { number, url } | null, error, startedAt, endedAt }`. `step` is the last step that started: `prepare`, `render`, `claude`, `apply`, `verify`, `commit`, `push`, `pr`. `error` is redacted and at most 500 characters.
- New file `<repo>/.plans/auto-runs/bootstrap-upgrade-pr-body-<hash>.md`: the PR body, one file per hash, written right before the commit. Its first line is `<!-- bootstrap-upgrade <hash> -->`, so a retry uses it only for the same hash. The text that Claude wrote (`added`, `kept`, `dropped`, `templateUpdates`, `questions`) goes through `redactError()`'s patterns before it is written (no cut to 500 characters).
- `.plans/auto-runs/` is already gitignored (`templates/core/gitignore.fragment`).
- The run folder (`runDir`, the Claude session's only working folder) holds only: `task.json`, `current/<n>`, `stage/<n>`, `refs/unattended.md`, `refs/lessons.md`, and what Claude writes: `merged/<n>` and `decisions.json`. `<n>` is the 1-based index of the file in `task.json` `changed`. The flat numbered names are unique for each path, have no folders to follow, and do not look like instruction files (`CLAUDE.md`, `AGENTS.md`) to the session.
- `task.json`, written by the script, read by Claude. Shape: `{ changed: [{ n, path, current: 'current/<n>', stage: 'stage/<n>', merged: 'merged/<n>', note, diff }], orphans: [path] }`. All its paths are relative to the run folder.
- `decisions.json`, written by Claude, read by the script. Shape: `{ files: [{ path, decision: 'merge' | 'keep' | 'replace', added: [string], kept: [string], dropped: [string] }], templateUpdates: [{ path, feature, why }], questions: [string] }`.
- The script's own work folder (`workDir`, not visible to Claude) holds the render stages (`stage`, `stage-apply`).
- The state fields `bootstrapRun` and `bootstrapHash` in the `/api/state` project objects (read by `app.js`).
- The file shapes are documented in `skills/bootstrap-project/references/contracts.md`.

## Reference implementation

- Closest existing pattern: `.claude/scripts/auto-pipeline.sh` (worktree from `origin/<base>`, headless `claude -p`, report in `.plans/auto-runs/`), the server's `launchGeneric()` / `runLauncher()` (a detached child with its log), and the `bootstrapStatus()` / `bootstrapCheck()` chip in `server.mjs` + `app.js`.
- Files read end to end: `skills/bootstrap-project/SKILL.md`, `skills/bootstrap-project/scripts/render.mjs` (header and `plan()`, `renderHash()`, `main()`), `skills/bootstrap-project/scripts/verify.mjs` (header, the `placeholders` and `bare-commands` checks, exit code), `skills/bootstrap-project/references/lessons.md`, `.claude/scripts/auto-pipeline.sh` (header, `start_session()`, the launch loop, `--cleanup` with its submodule handling), `apps/dashboard/server.mjs` (`fullState()`, `runLauncher()`, `launchGeneric()`, `bootstrapStatus()`, `bootstrapCheck()`, `projectHealth()`, `ENV`, the PR cache `prLists[root].allByBranch`, the POST router), `apps/dashboard/page/app.js` (the project header chip and its `data-bscopy` handler, `post()`), `apps/scout/scout.mjs` (`redact()`), `test/bootstrap-project.test.mjs` (the `bootstrapRepo()` helper), `apps/dashboard/test/dashboard.test.mjs` (fake `gh` / `claude` in `PATH`, `start()`, the registry restore in the later tests).
- Mirror:
  - `auto-pipeline.sh` `WORKTREES_DIR` (`<parent of repo>/worktrees/<repo name>`) and `branch="auto/$slug"` → `upgrade-run.mjs` uses the same folder and `auto/bootstrap-upgrade-<hash>`, so `auto-pipeline.sh --cleanup bootstrap-upgrade-<hash>` removes it after the merge.
  - `start_session()` flags (`--permission-mode acceptEdits`, `--verbose --output-format stream-json`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`) → the same flags in `upgrade-run.mjs`.
  - `launchGeneric()` spawn (`caffeinate -i` on macOS, detached, stdio to a log file, `unref()`) and the server `ENV` → `bootstrapUpgrade()` in `server.mjs`.
  - `bootstrapStatus()` result → it also keeps `hash` (from `--status`), so the page can tell whether a PR belongs to the current hash.
  - `prLists[root].allByBranch[branch].state` (the PR cache that the worktrees section reads) → the PR state of `auto/bootstrap-upgrade-<hash>` for the chip and the route.
  - scout `redact()` → `redactError()` in `upgrade-run.mjs`, with the same patterns plus the credentials in a URL (`https://user:token@`).
  - `data-bscopy` chip handler → a `data-bsupgrade` handler that calls `post('/api/bootstrap-upgrade', { project }, true)`.
  - `bootstrapRepo()` test helper → the same helper in the new test file, plus a bare `origin` repo.
- Deviations:
  - The upgrade does not run through the project's `auto-pipeline.sh` — that file is one of the outdated files, and it needs a plan file on `origin/<base>`.
  - The Claude session gets no `--add-dir` and no `--allowedTools` read rules. `acceptEdits` makes every working folder writable, and a bare `Read` rule matches every path. With the run folder as the only working folder, the session can write only there, and it needs to read nothing else; `--disallowedTools Bash WebFetch WebSearch` and `--strict-mcp-config` remove the other ways out (see Harness constraints for what this does not prove). Files are numbered, not named by path (lesson 10a: a headless session cannot write `.claude/`).
  - `redactError()` is a copy of the scout patterns, not an import: a global skill must not import from `apps/`.
  - The script, not Claude, commits and pushes — a plain program writes `.claude/settings.json` with no Self-Modification refusal (lesson 2).

## Affected files

- `skills/bootstrap-project/scripts/upgrade-run.mjs` — new: the unattended upgrade run.
- `skills/bootstrap-project/scripts/render.mjs` — modified: `isExecutable` is exported, and a new export `baseBranch(params)` holds the `git.base` default that `buildVars()` uses (no behavior change).
- `skills/bootstrap-project/references/unattended.md` — new: the rules for the Claude part of the run.
- `skills/bootstrap-project/SKILL.md` — modified: `argument-hint`, and a short "Unattended mode" section at the top.
- `skills/bootstrap-project/references/contracts.md` — modified: sections "Upgrade run status" and "Upgrade task and decisions".
- `apps/dashboard/server.mjs` — modified: `hash` in the `bootstrapStatus()` result, `bootstrapRunOf()`, `bootstrapUpgrade()`, `bootstrapRun` and `bootstrapHash` in `fullState()`, the `/api/bootstrap-upgrade` route.
- `apps/dashboard/page/app.js` — modified: the chip for `outdated` starts the upgrade and shows the run state.
- `test/bootstrap-upgrade-run.test.mjs` — new: tests of `upgrade-run.mjs`.
- `apps/dashboard/test/dashboard.test.mjs` — modified: route and state tests.
- `docs/plans-dashboard.md` — modified: one section "Upgrade the scaffolding".
- `changelog.d/20261124-bootstrap-upgrade-run.yaml` — new: the release note.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `upgrade-run.mjs` CLI | `skills/bootstrap-project/scripts/upgrade-run.mjs` | the `main()` guard (the same `realpathSync` check as `render.mjs`) | spawned by `server.mjs` `bootstrapUpgrade()` through `path.join(BOOTSTRAP_SKILL, 'scripts/upgrade-run.mjs')` | none |
| `isExecutable`, `moduleOn`, `baseBranch` | `render.mjs` | `export` | `upgrade-run.mjs` | none |
| `/api/bootstrap-upgrade` | `server.mjs` POST router | — | `app.js` `post()` | the POST router, next to `/api/launch` and before the generic `safeName(b.slug)` guard |
| `bootstrapRun`, `bootstrapHash` state fields | `server.mjs` `fullState()` | `/api/state` | `app.js` project header | none |
| `--unattended` mode | `skills/bootstrap-project/SKILL.md` | the global skill (symlink `~/.claude/skills/bootstrap-project`) | the `claude -p` prompt of `upgrade-run.mjs` | none |

## Breaking changes

- `bootstrapStatus()` gets one more field (`hash`). Its consumers are `bootstrapCheck()`, which `projectHealth()` calls, and `fullState()`, which reads the `bootstrap` check from `projectHealth()` (`grep -n "bootstrapStatus\|bootstrapCheck" apps/dashboard/server.mjs`). The new field breaks no consumer.
- The `outdated` chip no longer copies the prompt: it starts the run. The `missing` and `error` chips keep the copy. The setup guide keeps `fixPrompt` unchanged.
- Otherwise none.

## Steps

1. Create `skills/bootstrap-project/scripts/upgrade-run.mjs` with the header comment (usage `node upgrade-run.mjs <repo> [--no-push]`, what it writes, the exit codes 0 = done or nothing to do, 1 = failed or locked) and the helpers: `run(cmd, args, cwd)` (`spawnSync`, returns `{ status, stdout, stderr }`, never throws); `must(cmd, args, cwd)` (throws an `Error` with the command name and stderr when `status !== 0`); `redactError(s)` (the scout `redact()` patterns, plus `://<user>:<secret>@` → `://<redacted>@`, cut to 500 characters); `writeStatus(repo, patch)` (merges into the status file; `error` always goes through `redactError()`); and the `main()` guard copied from `render.mjs`. In `render.mjs`, change `const isExecutable = …` to `export const isExecutable = …`.
2. Lock (step `prepare`): `mkdirSync(<repo>/.plans/auto-runs, { recursive: true })`, then `openSync(<lock>, 'wx')` and write the PID. On `EEXIST`, print "an upgrade run is already live, or a stale lock is left: <lock>" and exit 1 with no status write. The script never removes a lock that it did not make, so two scripts can never both hold it; the server removes a stale lock before it starts a run (step 16), and the server is one process, so two clicks cannot race.
   - `main()` never calls `process.exit()` inside the `try`: it returns an exit code, and `process.exitCode` is set after the `finally`. In the `finally`, remove the lock only when it still holds the own PID.
   - Right after the lock, write a fresh status (replace the file, do not merge with an earlier run): `running` with `pid`, `startedAt`, `step: 'prepare'`. From here on, one top-level `try/catch` writes `failed` with `error` and `endedAt` for every failure, after the cleanup of the step that failed.
3. Inputs and recovery (step `prepare`): base = `baseBranch(params)` from `<repo>/.claude/bootstrap.json` (a new export of `render.mjs` that returns `str(g.base, 'develop')`, the same default as `buildVars()`, which then uses it too). `must git -C <repo> fetch origin <base>`, then pin `baseSha` = `git -C <repo> rev-parse origin/<base>` once; every later step uses `baseSha`, not `origin/<base>` (the dashboard fetches in the background). Fail when `git -C <repo> show <baseSha>:.claude/bootstrap.json` differs from the main checkout's file ("push or pull .claude/bootstrap.json first"). `git -C <repo> worktree prune` (it removes only git's own records of folders that are gone; the script never deletes a folder that it did not make in this run). Make the detached worktree `<worktrees dir>/bootstrap-upgrade-pending-<pid>-<startedAt ms>` at `baseSha` (a unique name; when the folder exists, fail with its path), take `hash` from `render.mjs <pending> --status`, and remove it again with `git worktree remove --force` (in a `finally`, so a failed `--status` removes it too). Set slug = `bootstrap-upgrade-<hash>`, branch = `auto/<slug>`, wt = `<worktrees dir>/<slug>`. `remoteSha` = the SHA that `must git -C <repo> ls-remote --heads origin refs/heads/<branch>` prints (a failed command fails the run; empty output = no branch; output that is not `<40 hex> refs/heads/<branch>` fails the run). Then, in this order:
   - Without `--no-push` only: the PRs of the branch, read as the server reads them (REST, not GraphQL, which can fail for the account): `must gh api "repos/{owner}/{repo}/pulls?state=all&head=<owner>:<branch>"` (cwd = repo), with `<owner>` from `gh repo view --json owner --jq .owner.login`. The state is `OPEN` when `state` is `open`, `MERGED` when `merged_at` is set, else `CLOSED`. A failure fails the run with "gh cannot see this repo's PRs: run gh auth status". An `OPEN` PR → run the label rule of step 11 again (it is safe to repeat), write status `pr` with it, exit 0. Only `CLOSED` or `MERGED` PRs, and the branch still exists (`remoteSha` is not empty, or the local branch exists) → fail with "PR #N for this hash was closed; to start again run: git branch -D <branch> and git push origin --delete <branch>". Only closed PRs and no branch anywhere → the owner deleted it to start again: go on.
   - `remoteSha` is not empty → `must git -C <repo> fetch origin refs/heads/<branch>:refs/remotes/origin/<branch>`, then make sure there is a local branch and worktree for it (`git worktree add <wt> <branch>`, or `git worktree add --track -b <branch> <wt> origin/<branch>` when there is no local branch). With `--no-push`: write status `committed` and exit 0. Else check the saved body (below), then compare `git rev-parse <branch>` with `remoteSha`: equal → go to step 11 (PR); local ahead (`git merge-base --is-ancestor <remoteSha> <branch>`) → go to step 11 (push); else fail with "the local and remote branch differ".
   - The local branch exists with commits over `baseSha` → make sure its worktree exists (`git worktree add <wt> <branch>` when it does not), then: with `--no-push`, write status `committed` and exit 0; else check the saved body (below) and go to step 11 (push).
   - The saved body check of the two resume cases: the file `bootstrap-upgrade-pr-body-<hash>.md` must exist and its first line must name this hash. Else fail with "the branch has commits but no saved PR body: open the PR by hand or delete the branch".
   - The local branch or the folder `<wt>` exists with no commit over `baseSha` → a leftover. When git does not list `<wt>` as a worktree and the folder exists, fail with "the folder <wt> is not a worktree of this repo: look at it and remove it by hand". When `git -C <wt> status --porcelain --ignore-submodules=none` fails or prints anything, fail with "the worktree <wt> has uncommitted changes: look at them, then run git worktree remove --force <wt>" (never discard work). Else `git worktree remove --force <wt>` and `git branch -D <branch>`, then go on.
   - Then `must git -C <repo> worktree add --no-track -b <branch> <wt> <baseSha>` (the same commit as the pending worktree, so the hash is the same). Submodules are not checked out: `render.mjs` and `verify.mjs` read only the tooling files, and `git worktree remove --force` removes a worktree with uninitialized submodules.
4. Render (step `render`): `workDir` = `realpathSync(mkdtempSync(os.tmpdir() + '/bootstrap-upgrade-work-'))` and `runDir` = `realpathSync(mkdtempSync(os.tmpdir() + '/bootstrap-upgrade-run-'))`. `must render.mjs <wt> --upgrade --json --stage <workDir>/stage` and parse `files`. When no file is `changed`, `new` or `merge` and the saved hash equals `hash`, remove the worktree and the branch, write status `same`, and exit 0. When no file is `changed`, skip step 5 and use the empty decisions `{ files: [], templateUpdates: [], questions: [] }`.
5. Claude (step `claude`): number the `changed` files 1..N. Copy each worktree file to `<runDir>/current/<n>` and each stage file to `<runDir>/stage/<n>`, and copy `references/unattended.md` and `references/lessons.md` of the skill to `<runDir>/refs/`. Write `<runDir>/task.json` (Contracts shape). Spawn `claude -p "/bootstrap-project --upgrade --unattended <runDir>/task.json"` with `cwd: runDir`, `--permission-mode acceptEdits`, `--disallowedTools Bash WebFetch WebSearch`, `--strict-mcp-config` (no MCP servers), `--verbose --output-format stream-json`, env `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, no `--add-dir` and no `--allowedTools`, and stdout and stderr appended to `<repo>/.plans/auto-runs/bootstrap-upgrade.log` (local and gitignored, as the `auto-pipeline.sh` logs). Wait for the exit (a Promise around `spawn`). After 45 minutes, `child.kill()` and fail with "the Claude session timed out". A non-zero exit is a failure. After the exit, fail when `git -C <wt> status --porcelain --ignored` differs from its output before the session (the session must not touch the worktree).
6. Check the decisions (step `apply`): read `<runDir>/decisions.json`. Fail (no write to the worktree) when: the file is missing or not JSON; the set of `files[].path` is not exactly the set of `changed` paths (a missing, extra or duplicate path); a decision is not `merge`, `keep` or `replace`; `<runDir>/merged` is not a real folder (`lstatSync`, no symlink); a `merge` entry has no regular file `merged/<n>` (`lstatSync`, no symlink); `merged/` holds an entry that no `merge` entry names; or a merged file matches `/@@[A-Z][A-Z0-9_ ]*@@/` (the `verify.mjs` placeholder pattern).
7. Verify before (step `verify`): `run verify.mjs <wt> --json` on the untouched worktree, and keep the ids in `failed` as `failedBefore`. Exit 1 with JSON is a result; any other exit, or stdout that is not JSON, is an execution error and fails the run.
8. Apply (step `apply`): the list = paths with status `new` or `merge`, plus the `replace` paths. `must render.mjs <wt> --upgrade --stage <workDir>/stage-apply --apply <list>`, or `--apply new` when the list is empty (this also writes `renderHash`). Then copy each `merged/<n>` of a `merge` entry to `path.join(wt, <path>)` (the paths come from the render output, not from Claude), and `chmodSync(…, 0o755)` when `isExecutable(path)`.
9. Verify after (step `verify`): run `verify.mjs <wt> --json` again, as in step 7. Fail when `failed` has an id that is not in `failedBefore` (name the ids). The ids in both runs go into the PR body as "already failing before the upgrade".
10. Commit (step `commit`): `must git -C <wt> add -- <every written path> .claude/bootstrap.json` (by path, never `-A`). When `git -C <wt> diff --cached --quiet` exits 0 (nothing staged), remove the worktree and the branch, write status `same` with `error: null`, and exit 0. Else write the PR body file first, then `must git -C <wt> commit -m "chore(claude): upgrade the bootstrap-project scaffolding (<hash>)"`, so a branch with a commit always has its body. The body file has (`<!-- bootstrap-upgrade <hash> -->` first, then: a TLDR with the hash and the counts replaced, merged, kept, new; a table of the changed files: path, decision, what moved in, project text kept; the CONFIG lines that differ, from the render JSON `diff`; "Not deleted" with the orphans; "Template updates" from `templateUpdates`, which the parent plan's phase 2 collects; "Questions for the owner" as `- [ ]` lines: `questions`, one line per orphan, one per CONFIG difference, one per check that already failed; the verify result; and "After the merge: `bash .claude/scripts/auto-pipeline.sh --cleanup <slug>`; when it cannot delete the branch after a squash merge, run `git branch -D auto/<slug>`"). With `--no-push`, write status `committed` and exit 0. Every failure in steps 4–10 before the commit removes the worktree and the local branch; the `error` starts with the run folder path (which stays), then the reason. A run that ends `pr`, `committed` or `same` removes `workDir` and `runDir`.
11. Push and PR (steps `push`, `pr`): `must git -C <wt> push -u origin <branch>` (skipped when the remote SHA equals the local one). `must gh pr create --draft --base <base> --head <branch> --title "chore(claude): upgrade the bootstrap-project scaffolding" --body-file <body file>` (cwd = repo). Read the URL from stdout and the number from its last path part. When `moduleOn(params, 'changelog')`, run `gh pr edit <n> --add-label no-changelog`; on failure, add the owner line "add the label `no-changelog`" to the body file and run `gh pr edit <n> --body-file <body file>`. Write status `pr` with `pr` and `endedAt`. A failure in this step keeps the worktree and the branch (step 3 continues from them).
12. Write `skills/bootstrap-project/references/unattended.md`: in unattended mode nobody answers. Everything the session needs is in its working folder: read nothing outside it, and write only there. Read `task.json` and `refs/lessons.md`. For each `changed` entry, read `current` and `stage` in full and decide by the rules of SKILL.md Step 2 (merge by default; keep only when the template adds no feature; replace only when the repo file has no project content). Write each merged file to its `merged` path, and write nothing else except `decisions.json`. Never try to edit `templates/`: put a feature that every project needs in `templateUpdates`. Put each item that only the owner can decide in `questions`. Write `decisions.json` last, in the Contracts shape. End with one line: `DONE <n> files`.
13. Edit `skills/bootstrap-project/SKILL.md`: set `argument-hint` to `"[--upgrade] [--unattended <task.json>]"`, and add a section "## Unattended mode" right after the line "Bootstrap this repo: $ARGUMENTS", before the `SKILL_DIR` and lessons lines: "When `$ARGUMENTS` has `--unattended <task.json>`, `scripts/upgrade-run.mjs` runs this skill, not a person. Read `refs/unattended.md` next to `task.json` and follow only it; skip the rest of this file."
14. Edit `skills/bootstrap-project/references/contracts.md`: add the sections "Upgrade run status" (lock, status file, saved body) and "Upgrade task and decisions" (the run folder, `task.json`, `decisions.json`), with the shapes from Contracts.
15. `apps/dashboard/server.mjs`: in `bootstrapStatus()`, keep `hash: s.hash` in `result`. Add `bootstrapRunOf(root)`: read `<root>/.plans/auto-runs/bootstrap-upgrade.json` (null when missing or not JSON). When the state is `running` and `process.kill(pid, 0)` throws `ESRCH`, return `state: 'failed'`, `error: 'the run stopped (pid N is gone)'`. When the state is `pr`, add `prState` from `prLists[root]?.allByBranch?.[branch]?.state` (undefined when not cached). In `fullState()`, add `bootstrapRun` and `bootstrapHash` (the cached `bootstrapStatus(root)?.hash`) to each project (both null for `DASH_REPO`).
16. `apps/dashboard/server.mjs`: add `bootstrapUpgrade(proj)`. Return `{ ok: false, output }` when the project is `DASH_REPO`; when `bootstrapStatus(proj.root)?.state !== 'outdated'` ("nothing to upgrade"); when `bootstrapRunOf()` says `running` ("an upgrade run is already live"); or when it says `pr` for the current hash and `prState` is not `CLOSED` or `MERGED` ("upgrade PR #N is open"). When `<root>/.plans/auto-runs/bootstrap-upgrade.lock` exists: its PID is dead (`process.kill` throws `ESRCH`), or the file is empty or not a number and older than 60 s → remove it (stale); else return "an upgrade run is already live". Then `mkdirSync(<root>/.plans/auto-runs, { recursive: true })`, open the log `<root>/.plans/auto-runs/bootstrap-upgrade.log`, and spawn `process.execPath <BOOTSTRAP_SKILL>/scripts/upgrade-run.mjs <root>` as `launchGeneric()` does (caffeinate on macOS, `env: ENV`, detached, `unref()`). A failed open or spawn (a `try/catch` and the child's `error` event) returns `{ ok: false, output: <the reason> }`. Else return `{ ok: true }`. Add the route `if (url.pathname === '/api/bootstrap-upgrade') { if (!proj) return json(res, 400, { error: 'unknown project' }); return json(res, 200, bootstrapUpgrade(proj)); }` next to `/api/launch`, before the generic `safeName(b.slug)` guard.
17. `apps/dashboard/page/app.js`: in the project header, when `sp.bootstrap === 'outdated'`, show by `sp.bootstrapRun`: `running` → the chip "upgrading…" (no click); `pr` with `hash === sp.bootstrapHash` and `prState` not `CLOSED`/`MERGED` → the chip "upgrade PR #N", which opens the PR URL; `failed` → the chip "upgrade failed" (title = `error`), whose click starts again; else → "bootstrap update ▶" with `data-bsupgrade="<project>"` and the title "upgrade in a worktree and open a draft PR". Add the `data-bsupgrade` click handler next to the `data-bscopy` one: `post('/api/bootstrap-upgrade', { project }, true)`. The `missing` and `error` chips do not change.
18. `docs/plans-dashboard.md`: add a short section "Upgrade the scaffolding": the chip, the click, the draft PR, a retry after a failure, a closed PR, the cleanup command after the merge (and `git branch -D` when it refuses), and where the log is.
19. Write `test/bootstrap-upgrade-run.test.mjs` (cases in Tests), then add the dashboard tests to `apps/dashboard/test/dashboard.test.mjs`.
20. Add the release note with `/changelog-entry` (`changelog.d/20261124-bootstrap-upgrade-run.yaml`, `audience: internal`).

## Tests

### Unit tests

`test/bootstrap-upgrade-run.test.mjs`. Setup per test: a repo made with the `bootstrapRepo()` pattern, with the example answers edited to `git.base = 'main'` (the example says `develop`, and the helper makes `main`), rendered with `--apply new`, committed, and pushed to a bare `origin` in the same temp folder. Then one answer changes (for example `stack.commands.lint`) and one rendered skill file gets one project line; both are committed and pushed, so `--status` gives a `saved` that differs from `hash`, and the skill file is `changed`. The env has a temp `HOME`, `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME` = `Ana Example`, `GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_EMAIL` = `ana@example.test`, and a fake `claude` and `gh` in `PATH` (as in `dashboard.test.mjs`). The fake `claude` reads `task.json` and writes `decisions.json` and `merged/<n>` files; its behavior comes from an env var per test, and it logs its argv and cwd. The fake `gh` logs its calls, prints `https://github.com/acme-co/acme-api/pull/41` for `pr create`, answers `repo view` with `acme-co`, and answers the `api …/pulls?…` call (below: "the PR list") from a file (`[]` by default; each PR as `{ number, html_url, state, merged_at }`).

- **The happy path with `--no-push`:** exit 0; the branch `auto/bootstrap-upgrade-<hash>` has exactly one commit over `origin/main`; the merged skill file in that commit has the fake merge line and the project line; a `replace` file equals the rendered file; `renderHash` in the committed `bootstrap.json` equals the new hash; the status is `committed`; the body file starts with `<!-- bootstrap-upgrade <hash> -->`; `git -C <repo> status --porcelain` of the main checkout prints nothing; `gh` was not called.
- **Claude sees only the run folder:** the cwd is the run folder; argv has `--disallowedTools` with `Bash` and has no `--add-dir` and no `--allowedTools`; argv has `--strict-mcp-config`; the run folder holds no file named `CLAUDE.md`, `AGENTS.md` or `bootstrap.json` (no render stage); every path in `task.json` is relative.
- **Push and PR:** without `--no-push`, the status is `pr` with `{ number: 41 }`; the bare origin has the branch; the gh log has `pr create --draft --base main --head auto/bootstrap-upgrade-<hash>`; the body file has the file table, a `- [ ]` line for the fake question, and the cleanup line; and `pr edit 41 --add-label no-changelog` is logged.
- **The label fails:** the fake `gh` fails `--add-label`. The status is still `pr`, and the body file has the line "add the label `no-changelog`".
- **Only new files, no changed file:** a repo just rendered and not changed (the saved hash equals the hash), then one rendered file deleted, committed and pushed. That file is `new`, no file is `changed`. The fake `claude` is not called (its log is empty), exit 0, and the commit has the new file.
- **Nothing staged:** a repo just rendered (the saved hash equals the hash), then one project line added to a rendered skill file, committed and pushed. That file is `changed`, so step 4 does not stop; the fake decides `keep`. `--apply new` writes the same `renderHash`, so nothing is staged: exit 0, status `same`, `git commit` was not run (no new commit), and no branch is left.
- **Decision paths:** one test per bad input — a changed path left out, an extra path, a duplicate path, an extra file in `merged/`, a `merged/<n>` that is a symlink, and a `merged` folder that is a symlink. Each: exit 1, status `failed`, the `error` names the problem, no new commit, and no worktree or local branch left.
- **A merged file with `@@LINT_CMD@@`:** exit 1, status `failed`, no commit. A merged file with the text `@@ -1,3 +1,4 @@` (a diff hunk) passes.
- **verify fails after the apply:** the fake writes a merged skill file without the word "bare" (the `bare-commands` check). Exit 1, the `error` names `bare-commands`, no commit.
- **A check that failed before:** the setup removes the word "bare" from one skill file and commits (that file is then `changed`); the fake decides `keep` for it. The run ends with `committed`, and the body file lists `bare-commands` under "already failing".
- **The session touches the worktree:** the fake writes a file into the worktree path (given in an env var only for this test). Exit 1, the `error` says the worktree changed.
- **Lock held:** a lock file with `process.pid`: exit 1 with "already live", and the status file does not change.
- **Two runs at the same time:** the fake `claude` waits until a file `go` exists in the test folder. Start run A; when its status is `running`, start run B and wait for its exit: B exits 1 with "already live", and the status `pid` is A's. Then create `go`; A ends with `committed`.
- **A lock that the script did not make:** a lock file with the PID of a process that has ended: the script exits 1 and does not remove it (the server removes stale locks; see the dashboard tests).
- **Answers not pushed:** the main checkout's `bootstrap.json` differs from `origin/main`. Exit 1 with "push or pull .claude/bootstrap.json first", status `failed`, and no `bootstrap-upgrade-pending-*` folder is left.
- **Folders the script did not make stay:** the setup leaves a folder `bootstrap-upgrade-pending-99999-1` with a file in it, which git does not list. The run ends with `committed`, and the folder and its file are still there. A folder at `<wt>` that git does not list: exit 1 with "is not a worktree of this repo", and the folder is still there.
- **`ls-remote` fails:** step 3 reads `remoteSha` through an exported helper `remoteBranchSha(repo, branch)`. The test points `origin` of a temp repo at a missing folder and calls the helper: it throws with the git reason (it does not return "no branch"). With a good `origin` and no branch it returns `''`.
- **Two hashes wait:** a run for hash A ends `committed` (`--no-push`); the answers change and a run for hash B ends `committed`. Both body files exist (`…-<A>.md`, `…-<B>.md`).
- **Nothing to upgrade:** a repo just rendered and not changed. Exit 0, status `same`, no worktree folder and no `auto/bootstrap-upgrade-*` branch left.
- **Retry after a failure before the commit:** a failed run (bad decisions), then a good run: the second run ends with `committed`.
- **Retry after a failed PR create:** the fake `gh` fails `pr create` once. The first run ends `failed` with the branch on `origin`; the second run does not push again and calls `pr create` once, with the saved body, and ends with `pr`.
- **Retry with the remote behind:** the first run pushes; the test adds one commit to the local branch; the second run pushes it (fast-forward) and opens the PR.
- **Resume after `--no-push`:** a run with `--no-push` ends `committed`; a second run without it pushes and opens the PR with the saved body.
- **An open PR exists:** the PR list returns `{ number: 41, state: 'open', merged_at: null }`. Exit 0, status `pr` #41, `pr create` is not called, and no worktree is left.
- **A closed PR exists:** the PR list returns `{ number: 41, state: 'closed', merged_at: null }` and the branch is on `origin`. Exit 1, and the `error` has the two commands to start again. Then the test deletes the branch locally and on `origin` (the PR list still returns the closed PR, as GitHub does) and runs again: the run goes on and ends with `pr`.
- **An open PR from a crash:** the PR list returns `{ number: 41, state: 'open', merged_at: null }` and the status file has no PR. Exit 0, status `pr` #41, and `pr edit 41 --add-label no-changelog` is logged.
- **A leftover with uncommitted work:** the branch's worktree exists with no commit over the base and one changed file. Exit 1, the `error` names the worktree, and the worktree and its file are still there.
- **Committed, but the body is gone:** a run with `--no-push` ends `committed`; the test deletes the body file; a run without `--no-push` exits 1 with "no saved PR body", and nothing is pushed.
- **No `git.base` in the answers:** the answers have no `git.base`, and the bare `origin` has the branch `develop` (the default). The run fetches `develop` and ends with `committed` on a branch made from `origin/develop`.
- **A repo with a submodule:** the setup adds one submodule (a second temp repo) with `git -c protocol.file.allow=always submodule add <path>` (git 2.38+ refuses local paths without it) and commits. The run ends with `committed`, and a failed run (bad decisions) still removes its worktree.
- **Redaction:** the fake `gh` fails the PR list with stderr `token=sk-test-0000 https://ana:sk-test-0000@example.test`. The status `error` does not contain `sk-test-0000`. In a second run, the fake `claude` writes a question with `password=sk-test-0000`; the body file does not contain `sk-test-0000`.

`apps/dashboard/test/dashboard.test.mjs`:

- **State field:** write the test repo's `.plans/auto-runs/bootstrap-upgrade.json` with `{ state: 'pr', hash: 'abc', branch: 'auto/bootstrap-upgrade-abc', pr: { number: 41, url: 'https://github.com/o/r/pull/41' } }` → `/api/state` has that project's `bootstrapRun.pr.number === 41`.
- **A dead run:** status `running` with the PID of a process that has ended (spawn `node -e ""`, wait for its exit, use its PID) → `bootstrapRun.state === 'failed'`, and the `error` names the PID.
- **The route refuses:** `POST /api/bootstrap-upgrade` for the test repo with no `bootstrap.json` → `{ ok: false }` with "nothing to upgrade"; for an unknown project → 400; with an `Origin` header of another site → 403 (the existing check).
- **Stale lock and a missing folder:** the outdated second project (below) has no `.plans/auto-runs/` folder before the first POST, and the run still starts (the folder is made). Before a later POST, its lock holds a dead PID → the server removes it and the run starts; its lock holds `process.pid` → `{ ok: false }` with "already live"; an empty lock younger than 60 s → "already live"; one with an `mtime` older than 60 s (`utimesSync`) → removed and started.
- **The route starts a run:** a second project, made with `render.mjs` (example answers with base `main`, `--apply new`, one answer changed after the apply), is added to the registry, and the test restores the registry at its end (as the later registry tests do). Poll `/api/state` until that project shows `bootstrap: 'outdated'`. POST → `{ ok: true }`. Wait (max 10 s) until its status file has a `pid` and that PID has ended (the project has no `origin`, so the run fails at the fetch). Then write status `running` with `process.pid` (the test's own PID) and POST again → `{ ok: false }` with "already live".

### End-to-end tests

- Not available yet (AGENTS.md, Commands). The unit tests above run the real `render.mjs`, `verify.mjs` and `git` against temp repos.

### Harness constraints

- The boundary of the Claude session is the Claude Code permission system, not an operating-system sandbox: writes are possible only in the working folder (`acceptEdits`) and Bash, web and MCP tools are off. The owner's `~/.claude/settings.json` still applies (it has no Read, Write, Edit or MCP allow rules today). This is the same trust as every `auto-pipeline.sh` run, which reads the whole repo. The script does not depend on the boundary for the repo: it writes only the changed paths that the render names, and checks the worktree after the session.
- The real `claude` session and the real GitHub do not run in the tests: fakes in `PATH` stand in for both. So the tests cannot prove that the real headless session, with `acceptEdits`, no read rules and the run folder as its working folder, can read its run folder and cannot read or write outside it. The real check is by hand, once, after the merge: the owner clicks the chip on one project. The evidence is the draft PR, the run log (no denied write in the run folder; any read outside it shows as denied) and the step 5 worktree check. When the session cannot write `merged/` there, the run ends `failed` at step 6, and the fix is a follow-up plan. The run report lists this check under Open items.

### AI output

- None. The tests use a fake `claude`; no line is about the length or language of AI text.

## Browser test

- Routes: the dashboard home page of a test dashboard (`DASH_PORT=4911 DASH_NO_OPEN=1 node apps/dashboard/server.mjs` with a test `HOME`, stopped by its PID), the project list in the side panel.
- Siblings: the `needs bootstrap` chip and the `bootstrap error` chip (they must still copy the prompt), and the `needs setup` chip (it must still open the guide).
- Same in every place: None.
- Widths: 1440 px and 390 px with touch.
- Account and data: no sign-in. A test `HOME` with a registry of two temp repos: one `outdated`, and one with a status file `pr` (#41) for the current hash.
- What to compare: the old app on http://127.0.0.1:4899 shows "bootstrap update" and copies a prompt on click. The new app shows "bootstrap update ▶", starts a run on click (after the refresh, the chip says "upgrading…" or "upgrade failed"), and shows "upgrade PR #41" for the second repo, which opens the PR link.

## How to verify

```bash
node --test test/bootstrap-upgrade-run.test.mjs
node --test apps/dashboard/test/dashboard.test.mjs
node --test test/bootstrap-project.test.mjs
grep -n "## Unattended mode" skills/bootstrap-project/SKILL.md
grep -n "Upgrade run status" skills/bootstrap-project/references/contracts.md
grep -n "/api/bootstrap-upgrade" apps/dashboard/server.mjs
node .claude/scripts/changelog-validate.mjs --base origin/main
npm test
```
