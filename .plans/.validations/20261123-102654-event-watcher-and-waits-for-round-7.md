# Round 7 — decision log (second run, round 3 of 4)

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-7.md`, APPROVE WITH CHANGES (0 blocking, 4 should-fix)
- Codex: ON — `-codex-raw-7.md`, NEEDS REWORK (1 blocking)
- Regressions of round 6's edits: 0 blocking; fix 1 (`manualNew`) could count a live plan twice (a one-tick delay, never a fifth run) and fix 12 was ambiguous — both refined below.

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Stale-lock recovery can displace a replacement; displaced holder keeps working | Codex | VALID | rename / link-back window | Fencing: `holdsLock()` before every save, pull, event write, notification and launch; link-back failure = lock lost; e2e fencing case; three-way race listed in Harness constraints |
| 2 | Plan-validator template "needs no change" vs the open item | Codex | VALID | Breaking changes text | Template `plan-validator.md` updated in step 15 and Affected files; `.claude/` copy stays an owner open item |
| 3 | `manualNew` counts a live plan twice | Claude | VALID | `listPlans` sets `launch: null` for a live plan; `launches` stays `starting` until the launcher exits | Exclude plans `runningCount()` already counted |
| 4 | Two notifications for RUNNING → PR OPEN | Claude | VALID | wording | Exactly one notification per event; e2e COMMITTED → PR OPEN case |
| 5 | A PR on two pages → two events / pulls | Claude | VALID | update-sorted paging | Drop repeated numbers per tick; e2e case |
| 6 | `ps` match `server.mjs` too broad | Claude | VALID | common file name | Match `dashboard/server.mjs` |
| 7 | Chip hides once met, while the limit or a chat holds the start | Claude | NOTE (UX, not a defect) | — | No change; the `wait-met` event records it; a "queued" chip can come with the phase 3 conductor |
| 8 | Re-validate after the move merges | Codex | VALID (note) | — | Open item |

Tried and reverted in this round: a default "watcher only on port 4899" — rejected, because `scripts/setup-macos.sh --port` sets the service port per Mac; the docs tell a hand-started test dashboard to set `DASH_WATCH_MS=0` instead.

Findings only one validator raised: Claude 3–7; Codex 1, 2.
