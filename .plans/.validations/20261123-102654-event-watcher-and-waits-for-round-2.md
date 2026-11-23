# Round 2 — decision log

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-2.md`, APPROVE WITH CHANGES (2 blocking, 11 should-fix)
- Codex: ON — `-codex-raw-2.md`, NEEDS REWORK (7 blocking)
- Regressions of round 1's edits: 2 (raised by Claude): the watcher lock (row 19) trusted a bare PID and was checked only at start; the cached `waitStatus` (row 14) overrode the file. Both fixed below.

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Auto-pull of the dashboard's own repo skips the relay check + restart | Codex | VALID | AGENTS.md hard rule 1 | The watcher never pulls `DASH_REPO`; event says to pull and restart by hand; e2e case with a `copyDashboard` copy |
| 2 | Crash between launch / events / state save duplicates work | Codex | PARTIALLY VALID | `runLauncher` spawns detached | `launched` saved before `launchPipeline`; state saved before events (a crash loses an event, never duplicates). No interruption test: the order makes the guarantee, and killing a process between two sync writes is not reproducible in the harness |
| 3 | Lock not atomic; bare PID; checked once | both | VALID (REGRESSION) | `scoutRunning()` pattern | `openSync('wx')`, PID + `ps` command check, retaken each tick, removed on exit; e2e: simultaneous start, takeover, stale PID |
| 4 | Old report excluded while run still works | Codex | INVALID | `pipelineLive()` finds the run's process, so a working run counts through `live` | Kept; clarified in step 2 and a unit case (live + old report counts) |
| 5 | Merge events miss old PRs / reused branches | Codex | VALID | cache: newest 200 by creation, one per branch | Own `sort=updated` list per tick merged into saved map (2000 cap); e2e case |
| 6 | `plan` condition uses `planBranches` cache | both | VALID | `ownBranch` reads the cache filled by `listPlans()` | Reads the other plan file's `Branch` line |
| 7 | Command output exposed without redaction | Codex | PARTIALLY VALID | `/api/state` already serves `launch.output`; local-only server | Cut to 500 characters; no new exposure; e2e case |
| 8 | Endpoint tests: success, order, limit, bad lines, missing file; 401/404 | Codex | VALID | — | Cases added; 401/404 explained (3A, 400 for unknown project) |
| 9 | Stale `waitStatus` overrides the file | Claude | VALID (REGRESSION) | step 8 read the cache first | Header parsed first; cache used only when texts match; `delete` for plans without a line; e2e case |
| 10 | Conditions checked after start (gh calls) | Claude | VALID | — | Not checked once `launched` or a run exists |
| 11 | Manual click during a tick | Claude (Codex edge case) | VALID | `launches` map | Re-check `launches`, `pipelineLive`, file exists just before the start |
| 12 | `appendFileSync` import | Claude | VALID | server `node:fs` import list | Step 3 |
| 13 | Unknown / ambiguous submodule sha; fetch failures | both | VALID | — | `cat-file -e` and fetch errors as `error`; exit 1 of `merge-base` = not met |
| 14 | Notify on new `wait-error` | Claude | VALID | — | Step 6b.7 |
| 15 | Docs: name the PR-list limits | Claude | VALID | — | Step 14 |
| 16 | One grep over four files | Claude | VALID | — | Four greps |
| 17 | Consumer search should include `apps/` | Claude | VALID | — | Breaking changes |
| 18 | Throwaway servers should run without watcher | Claude | PARTIALLY VALID | `scripts/docs-media.mjs` spawn env | `docs-media.mjs` env changed; the move plan's own test runs in a throwaway HOME, so its watcher touches nothing real — no change to the other plan |
| 19 | Step 6 too long | Claude | VALID | — | Split into 6 and 6b |
| 20 | Error dedupe never cleared; failed pull recovery; plan edited before launch | Codex | VALID | — | Errors cleared when gone; failed pull → "Pull by hand" (📥 Pull); file re-checked before launch |
| 21 | Re-validate after the move merges | Codex | VALID (note) | — | Already in Context; step 0 blocks |

Findings only one validator raised: Claude 9–12, 14–19; Codex 1, 2, 4, 5, 7, 8.
