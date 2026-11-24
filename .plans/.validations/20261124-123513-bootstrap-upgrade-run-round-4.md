# Round 4 (last) — 20261124-123513-bootstrap-upgrade-run.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (0 blocking, 6 non-blocking) — `-validation-4.md`
- Codex: ON — NEEDS REWORK (7 blocking, 2 non-blocking) — `-codex-raw-4.md`
- Regressions of round 3 edits: 1 (R4 below)

## Regressions

- R4 — the round 3 stale-lock recovery (rename, check, `linkSync` back) still lets a run remove a new holder's empty lock (Codex B1). Fixed by a simpler design: the script never removes a lock it did not make; the server, one process, removes stale locks before a spawn.

## Findings

| # | Finding | Raised by | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Stale-lock recovery can remove a new holder's lock | Codex | VALID | R4. Step 2 and step 16; tests moved to the dashboard file. |
| 2 | Recovery removes unknown pending or worktree folders | Codex, Claude NB2 | VALID | Step 3: only `worktree prune`; unique pending name; an unlisted `<wt>` folder fails with a message; test with user files. |
| 3 | A failed `ls-remote` reads as "no branch" | Codex, Claude NB1 | VALID | `must` + output check; helper `remoteBranchSha()` with a test. |
| 4 | The server opens the log before the folder exists | Codex | VALID | Step 16 `mkdirSync`, open and spawn errors return `{ ok: false }`; test. |
| 5 | The real session boundary is not proven, and it depends on global settings | Codex | OPEN ITEM | Same as round 3 #2. No OS sandbox is in the repo's pattern; the plan states the boundary and its limits (Harness constraints). Whether to require a stronger boundary (for example an empty `--settings` file or a sandbox) before the route is used is an owner decision. |
| 6 | One saved body file for all hashes | Codex | VALID | One file per hash; test "two hashes wait". |
| 7 | Logs and PR body can carry secrets | Codex | PARTIALLY VALID | The PR body text from Claude is now redacted, with a test. The local log stays as the `auto-pipeline.sh` logs are (gitignored, never sent). |
| 8 | `gh pr list` uses GraphQL; the server uses REST | Codex | VALID | server.mjs PR list. Step 3 uses `gh api …/pulls`; fakes and tests updated. |
| 9 | Submodule test needs `protocol.file.allow=always` | Claude | VALID | Test setup. |
| 10 | `process.exit()` inside `try` skips the `finally` | Claude | VALID | Step 2: return a code, set `process.exitCode`. |
| 11 | The body check sits after the new-worktree bullet | Claude | VALID | Moved into the two resume bullets. |
| 12 | Dashboard hash vs run hash through the Makefile | Claude | INVALID (no change) | The validator itself says nothing breaks: step 3's open-PR path exits 0. |
| 13 | Real Claude and GitHub need controlled evidence | Codex | VALID (non-blocking) | Already in Harness constraints and Open items. |

Only Claude found 9–12. Only Codex found 1, 4–8.

## Validation response

Round 4 is the last round. All findings except #5 were applied, but no further round validates the round 4 edits. Status: OPEN ITEMS — the round 4 edits are not validated, and #5 needs the owner.
