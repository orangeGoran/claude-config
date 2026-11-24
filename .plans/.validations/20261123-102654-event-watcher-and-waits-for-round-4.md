# Round 4 — decision log (last round)

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-4.md`, APPROVE WITH CHANGES (1 blocking, 7 should-fix)
- Codex: ON — `-codex-raw-4.md`, NEEDS REWORK (4 blocking)
- Regressions of round 3's edits: 2 — the chip fix relied on the in-memory `launch` (lost on restart) (Claude); the 2000-number cap could repeat a `pr-merged` for an evicted PR merged after `since` (Codex). Both fixed below.
- The edits of this round are not checked by a fifth round (the cap is 4).

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Waits chip returns after a restart for a started / failed plan | Claude | VALID (REGRESSION) | `launches` is in memory only | `launchedNow` map from `watch.json`; `listPlans` gives `waits: null`; e2e case |
| 2 | Stale-lock takeover can remove a replacement lock; holder can lose the lock mid-tick | Codex | VALID | rename race | Mover checks the moved file's `pid` and puts a fresh lock back; `holdsLock()` re-checked in the launch block |
| 3 | Manual launch during the `await` exceeds the limit | Codex | VALID | `/api/launch` independent | Synchronous block re-counts `launches` entries in `starting` |
| 4 | Evicted PR merged after `since` repeats `pr-merged` | Codex | VALID (REGRESSION) | 2000 cap | No cap; `prs` stores only `{ state }` per number; unit case |
| 5 | Button merge and watcher pull at the same time | both | VALID | `runPrAction` pulls; watcher pulls | `buttonMerged` set; watcher skips the pull and says so; e2e case |
| 6 | `linkSync` missing from the import | Claude | VALID | `node:fs` import list | Step 3 |
| 7 | `CENTRAL` missing in a fresh HOME | Claude | VALID | nothing creates it at start | `mkdirSync(CENTRAL)` in `takeLock()` |
| 8 | Generic project: `met` not forced false | Claude | VALID | — | Every condition with an `error` has `met: false` |
| 9 | `ghProblem(out)` should be `ghProblem(r.output)` | Claude | VALID | `gh()` returns `{ ok: false, output }` | Step 5 |
| 10 | Contracts miss `reportAt` | Claude | VALID | — | Contracts |
| 11 | Scout already exports `redact()` | Claude | VALID | `scripts/scout.mjs` `redact` | Deviation explained |
| 12 | e2e env must mirror `start()` (QA port) | Claude | VALID | `start()` env | e2e env |
| 13 | Pending record of a plan moved to `done/` | Claude | VALID | — | Record removed |
| 14 | `short` with a space | Claude | VALID | condition grammar is one word | Stated in `findProject` |
| 15 | Move plan's copied-server test should pass `DASH_WATCH_MS=0` | Claude | VALID (other plan) | — | Open item |
| 16 | Step 0 should check the move's `copyDashboard` export | Codex | VALID | — | Step 0 greps it |
| 17 | Re-validate after the move merges | Codex | VALID (note) | — | Open item |

Findings only one validator raised: Claude 1, 6–15; Codex 2–4, 16.
