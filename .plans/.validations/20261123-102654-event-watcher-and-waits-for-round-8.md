# Round 8 — decision log (second run, round 4 of 4 — last)

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-8.md`, APPROVE WITH CHANGES (1 blocking, 6 should-fix)
- Codex: ON — `-codex-raw-8.md`, NEEDS REWORK (3 blocking)
- Regressions of round 7's edits: 2 (Claude) — the Hard rules line still said two template files; the Open items asked for a double template edit. Both fixed below.
- The edits of this round are not checked by another round (the cap is 4 per run).

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Fencing test cannot pass (test PID fails the `ps` check) | Claude | VALID | `takeLock()` stale rule | Lock records the holder's `cmd`; test uses a helper process and writes its pid + `cmd`; bounded to three ticks |
| 2 | Check-to-use race on the lock | Codex | PARTIALLY VALID | a live holder is never stale (PID alive, `cmd` unchanged) | Text states it: hand-over only after the holder dies or the three-server start; fencing limits that to one cut-short tick. Without OS file locks (no npm dependencies, Node has no `flock`), this is the limit |
| 3 | Button mark consumed before the button's pull ends; restart loses the mark | Codex | PARTIALLY VALID | the button's response already shows its pull result | Event text "Pull left to the merge button"; after a restart the watcher pulls (`--ff-only` safe) |
| 4 | Existing plans with header `Waits for:` lines would start without a go | Codex | INVALID | `grep -rl "Waits for\*\*" .plans` → only this plan and its parent, both in the body, not the header; the owner decided the line is the go (parent plan, 2026-11-23) | No change |
| 5 | Hard rules: two vs three template files | both | VALID (REGRESSION) | step 15 | Three files named |
| 6 | Open item asks for a double template edit | Claude | VALID (REGRESSION) | step 15 | Only the `.claude/` copy stays by hand |
| 7 | `manualNew` misses a relaunch after a failed launch | Claude | VALID | snapshot `launch` may be `failed` | Count when snapshot `launch` was not `starting` |
| 8 | "Next holder repeats its reads" overstated | Claude | VALID | save-before-pull | Text corrected (at-most-once) |
| 9 | Exit handler does not run on signals | Claude | VALID | no `process.on(` signal handlers | Text says so; removes only when `holdsLock()` |
| 10 | No grep for the plan-validator template | Claude | VALID | — | Added to How to verify |
| 11 | Relative `node server.mjs` vs `dashboard/server.mjs` match | Claude | VALID | — | Fixed by the recorded `cmd` (#1) |
| 12 | Busy-chat case needs > 10 s | Claude | VALID | fake claude answers 9.5 s after an interrupt | Up to 15 s |
| 13 | Re-validate after the move merges | Codex | VALID (note) | — | Open item |

Findings only one validator raised: Claude 1, 6–12; Codex 2–4.
