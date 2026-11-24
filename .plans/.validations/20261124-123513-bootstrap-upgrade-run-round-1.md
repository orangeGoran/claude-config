# Round 1 — 20261124-123513-bootstrap-upgrade-run.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (5 blocking, 16 non-blocking) — `-validation-1.md`
- Codex: ON — NEEDS REWORK (8 blocking, 3 non-blocking) — `-codex-raw-1.md`
- Regressions: none (first round)

## Findings

| # | Finding | Raised by | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | `--add-dir <wt>` and `--add-dir <skill>` with acceptEdits make the repo and the templates writable for Claude | Claude | VALID | auto-pipeline.sh `start_session()` flags. Plan: copies into the run folder, no `--add-dir`, a `git status` check after the session, a test that argv has no `--add-dir`. |
| 2 | Decision paths are not checked; every file in `merged/` is copied; traversal and symlinks | Claude, Codex | VALID | Step 6 now requires the exact changed set, `safeRel()`, no symlink, no extra file; tests per bad input. |
| 3 | The "verify fails" test edits `auto-pipeline.sh`, which is not a changed file | Claude | VALID | verify.mjs `bare-commands` check (`\bbare\b`). The test now uses a merged skill file without "bare". |
| 4 | A retry after a failure always fails (the branch is left); no recovery after push or PR create | Claude, Codex | VALID | Step 3 recovery order (open PR, remote branch, local commits, leftover); steps 9–10 cleanup rules; saved PR body; tests for each retry. |
| 5 | The example answers have base `develop`; the test repo has `main` | Claude | VALID | bootstrap.example.json `git.base`. The tests set `git.base = 'main'`. |
| 6 | The dashboard "starts a run" test is racy and breaks the registry count | Claude | VALID | Test rewritten: poll for `outdated`, assert only that the status file has a `pid`, check "already live" with a status that names the test's own PID, restore the registry. |
| 7 | The lock has a window; a losing run overwrites the status | Codex, Claude | VALID | Step 2: `openSync(…, 'wx')` lock file, only the holder writes the status; a test with two runs started at the same time. |
| 8 | The hash and base come from the main checkout, the render from `origin/<base>` | Codex, Claude | VALID | render.mjs `main()` reads the repo's `bootstrap.json`. Step 3: fail when the file differs from `origin/<base>`; the hash comes from a pending worktree at `origin/<base>`; test "answers not pushed". |
| 9 | No changed file → `decisions.json` missing → failure | Codex | VALID | Step 4: empty decisions, Claude not called; test "only new files". |
| 10 | verify.mjs exits 1 on a failed check; `execFileSync` throws | Codex, Claude | VALID | verify.mjs `process.exit(failed.length ? 1 : 0)`. `run()` uses `spawnSync`; exit 1 with JSON is a result. |
| 11 | Real projects may already fail a check before the upgrade | Claude | VALID | Step 7 verify before; only new failures stop; test "a check that failed before". |
| 12 | The restart line lacks the relay condition | Codex | VALID | AGENTS.md hard rule. Hard rules line fixed. |
| 13 | The example names a real project and private paths | Codex | VALID | AGENTS.md "Public repo". The example now uses `acme-api` in `~/code/acme-api`. |
| 14 | The `@@` check is too broad | Claude | VALID | verify.mjs placeholder pattern `/@@[A-Z][A-Z0-9_ ]*@@/`; test with a diff hunk. |
| 15 | The "template path" encoding is not defined | Claude | VALID | Contracts: the `dot-` rule with an example. |
| 16 | The Claude session has no timeout | Claude | VALID | Step 5: 45 min, `child.kill()` of its own child. |
| 17 | A POST while a PR for the same hash is open overwrites `pr` | Claude | VALID | Step 15 refuses it; step 3 also finds the open PR. |
| 18 | Temp `HOME` → git has no identity | Claude | VALID | The test env sets `GIT_AUTHOR_*` / `GIT_COMMITTER_*` to made-up values. |
| 19 | The Breaking changes consumer list is not exact | Claude | VALID | `bootstrapCheck()` is called by `projectHealth()` (server.mjs). Fixed. |
| 20 | `node --check` has no allow rule | Claude | VALID | `.claude/settings.json` allows `node --test*` only. The line is removed; the tests load the module. |
| 21 | The route must sit before the generic slug guard; use the server `ENV` | Claude | VALID | server.mjs POST router (`safeName(b.slug)` guard). Step 15 and Wiring fixed. |
| 22 | `--cleanup` uses `git branch -d`, which can refuse after a squash merge | Codex | VALID | PR body and docs say to run `git branch -D auto/<slug>` then. |
| 23 | The real headless permissions cannot be tested with fakes | Codex | VALID (non-blocking) | Harness constraints: a by-hand check after the merge, with the evidence named. |
| 24 | A failed `no-changelog` label call must reach the owner | Codex | VALID | Step 10 adds an owner line to the body; test "the label fails". |
| 25 | "Preserve uncommitted work on a failed run" | Codex | PARTIALLY VALID | The uncommitted files are only machine output. The run folder (merged files, decisions) stays and is named in `error`; the worktree is removed so that a retry works. |

Only Claude found 1, 3, 5, 6, 11, 14–21. Only Codex found 9, 12, 13, 22, 24.

No finding needs an owner decision.

## Validation response

All blocking findings of both validators were applied to the plan. Finding 25 was applied in part: the run folder keeps the machine output, and the worktree is removed, so a retry can start. Round 2 validates the changes.
