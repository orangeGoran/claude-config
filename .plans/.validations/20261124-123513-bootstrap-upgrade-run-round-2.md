# Round 2 — 20261124-123513-bootstrap-upgrade-run.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (4 blocking, 12 non-blocking, 3 test problems) — `-validation-2.md`
- Codex: ON — NEEDS REWORK (6 blocking, 3 non-blocking) — `-codex-raw-2.md`
- Regressions of round 1 edits: 2 (R1, R2 below)

## Regressions

- R1 — the round 1 recovery used `git worktree move`, which git refuses for a worktree with submodules (Claude B1). Fixed: the pending worktree only gives the hash and is removed; the real worktree is added at the same commit.
- R2 — the round 1 isolation fix kept `--allowedTools Read Glob Grep`; a bare tool rule matches every path, so "reads only the run folder" was false (Claude B4, Codex B3). Fixed: no allow rules, `--disallowedTools Bash WebFetch WebSearch`, numbered files, stage outside the run folder.

## Findings

| # | Finding | Raised by | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | `git worktree move` fails with submodules | Claude | VALID | git docs; auto-pipeline.sh `--cleanup` handles submodules. Step 3 rewritten (R1). |
| 2 | Failures in steps 2–3 leave the pending worktree and write no status | Claude | VALID | Step 2 top-level catch; step 3 `finally`, prune, removal of stray `pending-*`; tests "answers not pushed", "a pending folder from a crash". |
| 3 | Recovery has no PR body after `--no-push` | Claude | VALID | The body is written right after the commit (step 10) with a hash marker; test "resume after `--no-push`". |
| 4 | Bare `Read` rule reads any path | Claude, Codex | VALID | R2. Step 5, Reference deviations, test "Claude sees only the run folder", Harness constraints. |
| 5 | Pushed-branch retry has no worktree for `gh`, skips the push without a SHA compare | Codex | VALID | Step 3 branch 2: worktree ensured, SHA compare, fast-forward push; `gh pr create` runs in the repo; test "retry with the remote behind". |
| 6 | Stale lock: only `ESRCH` is dead; ownership-safe removal | Codex, Claude | VALID | Step 2: `ESRCH` only, rename-to-private and check, `finally` removes only its own lock; tests. |
| 7 | `dot-` encoding is not injective; parent symlinks | Codex | VALID | Encoding replaced by flat numbered files; `merged` folder and files checked with `lstatSync`. |
| 8 | Status errors and logs may hold secrets | Codex | PARTIALLY VALID | The status `error` is shown on the page: `redactError()` + test. The log stays unredacted, local and gitignored, as the `auto-pipeline.sh` logs are (same pattern). |
| 9 | Nothing staged → empty commit fails | Codex | VALID | Step 10 checks `git diff --cached --quiet` → `same`; test "nothing staged". |
| 10 | `gh` branches run with `--no-push`; no clear gh error | Claude | VALID | Step 3: `gh` only without `--no-push`, with a clear error. |
| 11 | `ls-remote` pattern matches longer names | Claude | VALID | `refs/heads/<branch>` and a non-empty check. |
| 12 | Branch 3 pushes even with `--no-push` | Claude | VALID | Step 3: writes `committed` and stops. |
| 13 | `worktree remove` fails on an unregistered folder | Claude | VALID | Step 3: `rmSync` + `worktree prune`. |
| 14 | A closed PR blocks the chip | Codex, Claude | VALID | `prState` from `prLists[root].allByBranch` (server.mjs); route and chip; step 3 stops on a closed PR with the commands; test. |
| 15 | Project git hooks in a worktree with no install | Claude | VALID | Context: hooks run; a failure is a run failure with the output. |
| 16 | `openSync` fails when `.plans/auto-runs/` is missing | Claude | VALID | Step 2 `mkdirSync`. |
| 17 | No `step` value for step 3 | Claude | VALID | `prepare`. |
| 18 | Stage and copied `CLAUDE.md`/`AGENTS.md` in the session cwd | Claude | VALID | Stage moved to `workDir`; numbered copies; test asserts no such file names. |
| 19 | "Unattended mode" must come before the lessons line | Claude | VALID | Step 13 places it right after `Bootstrap this repo: $ARGUMENTS`. |
| 20 | Two-runs lock test is not deterministic | Claude | VALID | The fake waits for a `go` file. |
| 21 | "A check that failed before": the edited skill becomes `changed` | Claude | VALID | render.mjs `plan()` status. The fake decides `keep` for it. |
| 22 | Dashboard "starts a run" test races the script's `failed` write | Claude | VALID | Waits until the run's PID has ended. |
| 23 | Cross-origin / invalid host test for the new route | Codex | VALID | Test added (403, the existing check). |
| 24 | Keep the real Claude permission check as an open item | Codex | VALID | Harness constraints: evidence and the failure path. |

Only Claude found 1–3, 10–13, 15–22. Only Codex found 5, 7–9, 23, 24.

No finding needs an owner decision.

## Validation response

All blocking findings of both validators were applied, and the two regressions of round 1 were fixed. Finding 8 was applied in part (the status error is redacted; the local log follows the existing `auto-pipeline.sh` pattern). Round 3 validates the changes.
