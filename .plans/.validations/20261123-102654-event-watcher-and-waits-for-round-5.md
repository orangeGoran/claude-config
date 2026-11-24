# Round 5 — decision log (second run, round 1 of 4; file numbers continue the first run)

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-5.md`, APPROVE WITH CHANGES (1 blocking, 6 should-fix)
- Codex: ON — `-codex-raw-5.md`, NEEDS REWORK (6 blocking)
- Regressions of round 4's edits: 2 — `prEvents` received the `{ state }`-only map (both validators); `buttonMerged` was set after the merge's awaits (both). Both fixed below.

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | `prEvents` gets `{ state }` only; needs times, title, url, branch, base | both | VALID (REGRESSION) | round 4 `prMap` | `prEvents(prev, rows, since)` reads this tick's rows; called before `prMap`; unit cases follow |
| 2 | `buttonMerged` set after `gh pr merge` + `gh api` + DELETE | both | VALID (REGRESSION) | `runPrAction` awaits (`scripts/plans-dashboard.mjs` merge branch) | Set before `gh pr merge`, removed on failure; e2e failure case |
| 3 | Second dashboard's button merge not in the in-memory set | Codex | PARTIALLY VALID | only the lock holder watches | Documented: worst case one "Pull by hand" text (`--ff-only` is safe); not tested (timing) |
| 4 | Manual run starts and finishes during the awaits | Codex | VALID | snapshot is stale | Sync block also checks report file and worktree |
| 5 | Per-plan state lifecycle (done/, restore, slug reuse) | both | VALID | — | `met`/`errors` dropped when inactive; `launched` kept while the file is in plans or done; e2e archive/unarchive case |
| 6 | Quiet run older than 30 min not counted | Codex | INVALID | `pipelineLive()` first runs `pgrep -f "[s]kill-auto-pipeline <slug>.md"`, which matches the run's process for its whole life; the transcript fallback only adds interactive chats | No change |
| 7 | `merge-base` errors read as "not met" | Codex | VALID | `gitIn()` keeps only `ok` | `execFile` keeps the exit code: 0 met, 1 not met, other → error |
| 8 | `refreshPrList` joins an older running read | Codex | VALID | `c.loading` reuse | Await `loading`, then refresh (as `prAction()`) |
| 9 | `.claude/` skill-1-plan wording until the owner updates it | Codex | VALID (note) | headless runs cannot write `.claude/` | Already an Open item (owner, by hand) |
| 10 | Contracts: `waits` null for launched plans | Claude | VALID | step 8 | Contracts updated |
| 11 | Recount counts this tick's own launches twice | Claude | VALID | `runLauncher` sets `starting` | Count only entries not in the snapshot and not started by this tick |
| 12 | Fake `gh` must answer `pr merge` and the head/base refs | Claude | VALID | `runPrAction` parses `baseRefName`/`headRefName` | e2e fake + Harness constraints |
| 13 | Busy-chat case must end its relay | Claude | VALID | dashboard test `after()` | Harness constraints |
| 14 | `pr.base` vs `baseRefName` | Claude | VALID | `PR_JQ` | `event.base` from the row's `baseRefName` |
| 15 | Re-validate after the move merges | Codex | VALID (note) | — | Open item |

Findings only one validator raised: Claude 10–14; Codex 3, 4, 6–9.
