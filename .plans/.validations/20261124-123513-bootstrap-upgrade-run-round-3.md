# Round 3 — 20261124-123513-bootstrap-upgrade-run.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (1 blocking, 10 non-blocking) — `-validation-3.md`
- Codex: ON — NEEDS REWORK (5 blocking, 2 non-blocking, 4 edge cases) — `-codex-raw-3.md`
- Regressions of round 2 edits: 1 (R3 below)

## Regressions

- R3 — the round 2 closed-PR rule printed "start again" commands that can never work: GitHub keeps a closed PR for the head name after the branch is deleted (Claude B1). Fixed: a closed PR stops the run only while the branch still exists; test extended.

## Findings

| # | Finding | Raised by | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Closed PR loops forever | Claude | VALID | R3. Step 3 first branch; test "a closed PR exists" extended. |
| 2 | The isolation of the Claude session is not proven | Codex | PARTIALLY VALID | No OS sandbox exists in the repo's pattern; auto-pipeline.sh runs read the whole repo with the same trust. The plan no longer claims "reads only"; Harness constraints say what the boundary is and what it does not prove; `--strict-mcp-config` added (Claude NB4); the script does not rely on it for repo writes. The by-hand check stays an open item. |
| 3 | A leftover worktree is removed without a clean-tree check | Codex | VALID | auto-pipeline.sh `--cleanup` refuses uncommitted work. Step 3 refuses a dirty leftover; test. |
| 4 | Crash after commit, before the body is saved | Codex | VALID | Step 10 writes the body before the commit; step 3 checks the body hash for branches 2 and 3 (Claude NB8); test "the body is gone". |
| 5 | `git.base` is optional, default `develop` | Codex | VALID | contracts.md `git.base` default; render.mjs `str(g.base, 'develop')`. New export `baseBranch()`; test with no `git.base`. |
| 6 | Submodules are not initialized | Codex | PARTIALLY VALID | auto-pipeline.sh inits them for builds and checks. `render.mjs` and `verify.mjs` read only tooling, so no init; the plan says why. A submodule test is added for worktree add and removal. |
| 7 | The `running` status merges into the old status | Codex | VALID | Step 2 writes a fresh status. |
| 8 | Empty lock file | Codex | VALID | Step 2 mtime rule; test. |
| 9 | PR made but the run died before it recorded it or set the label | Codex | VALID | Step 3: the open-PR path runs the label rule again; test. |
| 10 | The remote branch ref is not fetched | Codex, Claude | VALID | Step 3 fetches `refs/heads/<branch>` before the tracking worktree. |
| 11 | Stale-lock recovery overlaps a new holder | Codex, Claude | VALID | Step 2: `ENOENT` rule, restore with `linkSync` (never overwrites), residual window stated. |
| 12 | Branch 2 ignores `--no-push` | Claude | VALID | Step 3. |
| 13 | `origin/<base>` can move between the two worktrees | Claude | VALID | server.mjs background fetch. `baseSha` pinned once. |
| 14 | Test "no stage folder" contradicts `stage/<n>` | Claude | VALID | Test text fixed. |
| 15 | Test "only new files" builds on a setup with a changed file | Claude | VALID | Test now starts from a just-rendered repo. |
| 16 | Temp folders are never removed | Claude | VALID | Step 10. |
| 17 | The run-folder path can fall off the 500-character error | Claude | VALID | Step 10: the path comes first. |
| 18 | Controlled evidence for real Claude and GitHub | Codex | VALID (non-blocking) | Already in Harness constraints and Open items. |

Only Claude found 1, 12–17. Only Codex found 2–9.

No finding needs an owner decision.

## Validation response

All blocking findings were applied, 2 in part with evidence (2, 6). The round 2 regression R3 is fixed. Round 4 (the last) validates the changes.
