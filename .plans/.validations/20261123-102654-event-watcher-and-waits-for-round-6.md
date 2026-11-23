# Round 6 — decision log (second run, round 2 of 4)

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-6.md`, APPROVE WITH CHANGES (1 blocking, 7 should-fix)
- Codex: ON — `-codex-raw-6.md`, NEEDS REWORK (3 blocking)
- Regressions of round 5's edits: 1 — fix 11 (the launch-limit recount) dropped `startedThisTick` and used a filter that is always empty (Claude). Fixed below.

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Recount can allow a fifth run | Claude | VALID (REGRESSION) | `listPlans()` lists every active plan | `running + startedThisTick + manualNew < WATCH_LIMIT`, `manualNew` defined |
| 2 | Pull before the state save can pull twice after a crash | Codex | VALID | step 6.1 order | `saveWatch()` with the new `prs` before any pull |
| 3 | Manual `/api/launch` ignores the 4-run limit | Codex | PARTIALLY VALID | Q6 was asked for the autopilot ("How many runs at the same time per project?", recommended "the batch size you used by hand") | Context states the reading: the limit governs the watcher's (and later the conductor's) starts; a manual click counts but is never refused. Reported to the owner in the final report |
| 4 | `ghProblem()` text in `waitStatus` / `/api/state` is not redacted | Codex | VALID | `ghProblem()` returns a raw first line | `redact()` on every command-derived `error` before any storage or response; e2e case |
| 5 | plan-validator still flags "skips an explicit go" | Codex | VALID | `.claude/agents/plan-validator.md` | Open item (owner, by hand, `.claude/` and its template) |
| 6 | `prMap` unit case wrong about the first tick and `since` | Claude | VALID | `prev === null` → `[]` | Case rewritten with a non-null `prev` |
| 7 | Contracts miss `base` on PR events | Claude | VALID | — | Added |
| 8 | Who removes a `buttonMerged` mark | Claude | VALID | — | Removed on the `pr-merged` event, or after one hour |
| 9 | Use `gitRaw()` (keeps `code`) | Claude | VALID | `gitRaw` / `hasCommit()` | Step 5 uses `gitRaw` |
| 10 | Compare times with `Date.parse` | Claude | VALID | `…Z` vs `….000Z` | Stated in step 2 |
| 11 | Every test server needs a notifier setting | Claude | VALID | — | e2e env |
| 12 | Second notification inside `needs-you` | Claude | VALID | — | Notify on outcome change and on the first `PR OPEN` status |
| 13 | Re-validate after the move merges | Codex | VALID (note) | — | Open item |

Findings only one validator raised: Claude 1, 6–12; Codex 2–5.
