# Validation round 1 — 20261127-224222-plan-lanes-waiting-state

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (`-validation-claude-1.md`)
- Codex (`validate-plan`): ON — NEEDS REWORK (`-validation-codex-1.md`)
- Regressions from the previous round: none (first round of this run)

## Findings

| ID | Raised by | Section | Finding | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- | --- |
| C-B1 | Codex (blocking) | Freshness | A stale timestamp still lets a met plan into the batch | PARTIALLY VALID | `server.mjs` `watchProject()` sets `next.met[p.slug] = true` only after `waits.every((w) => w.met)` and never resets it; the three conditions in `watch.mjs` (`PR_RE`, `PLAN_RE`, `SUB_RE`) do not go back. A met plan must stay launchable when the dashboard is off. The plan text "an old watch.json counts as not met" was unclear | Context 1A+ now says: not-met stays not-met at any age, a stored `met: true` is met at any age. New test "Met stays met at any age". Old/missing/bad/future timestamp tests added |
| C-B2 | Codex (blocking) | State lookup | State folder by folder name, but the dashboard uses the registry name | VALID | `server.mjs` `resolveProject()`: `stateDir = path.join(CENTRAL, 'state', p.name)`; `register.mjs`: `entry = { name: p.project.name, …, root }`; template `CENTRAL_STATE … path.basename(REPO)` | New step 1a `projectName()` (registry entry whose real root is `REPO`, else folder name); Context, Contracts (registry read), Breaking changes (plan-meta/runs now read from the right folder), Mirror, Deviations (realpath), test "Registry name differs" |
| C-B3 | Codex (blocking) | Conflict warning | The dashboard drawer does not show `sharesWithWaiting` | NEEDS OWNER DECISION | `app.js` `laneRowHtml()` reads only `slug`, `file`, `validation`, `areas`; changing it touches `apps/dashboard/page/app.js` (also in plan 2a) and the restart rule | Sent to the owner as question 1 of 1 |
| C-N1 | Codex | Accuracy | "starts by itself" promises too much | VALID | `watch.mjs` `canAutoLaunch()` guards (status, run, worktree, chat, limit); generic projects cannot auto-start | Wording "can start by itself" in step 1, 6, 9, 11 and tests; parked/proposed note |
| C-N2 | Codex | Freshness semantics | `checkedAt` moves on PR read, not on the waits check | VALID | `watchProject()` step 1 `next.checkedAt = tickAt` inside `if (rows)` | Context known limit; Contracts `watch.json` row |
| L-B1 | Claude (blocking) | Waiting list | A plan that runs or shipped still shows as waiting | VALID | `watchProject()`: `if (next.launched[p.slug] \|\| p.run) continue;` | Step 6 filter `!occupied(p.runState) && p.runState !== 'shipped'`; Contracts; docs line; Context limit; test "A waiting plan that runs is not waiting" |
| L-S1 | Claude | Parked/proposed | Listed as "starts by itself" though the watcher never starts them | VALID | `watch.mjs` `canAutoLaunch()`: `plan.status !== 'parked' && plan.status !== 'proposed'` | Step 4 note `status <s>: the watcher does not start it by itself`; test "A parked waiting plan says so"; skill row text |
| L-S2 | Claude | Tests | `lanesWith()` cannot write a header or a fence | VALID | `test/bootstrap-project.test.mjs` `lanesWith()` writes `# Plan: ${title}\n\n## Steps…` | Step 10 helpers `writePlans()`, `writeState()`, `runLanes()`; Affected files |
| L-S3 | Claude | Robustness | `watch.json` with `null` crashes; bad time gives `NaN min ago` | VALID | template `readJson` returns the parsed value (`null` for `null`) | Step 4 object guard, `when` text "at an unknown time"; tests |
| L-S4 | Claude | Consumers | `verify.mjs` missing from the consumer list | VALID | `skills/bootstrap-project/scripts/verify.mjs` reads `schedulableCount`, `laneCount`, `maxParallel`, `recommendedBatch`, `lanes`, `inFlight` | Contracts consumer list |
| L-S5 | Claude | Known limits | `checkedAt` semantics, fixed stale limit, drawer does not show `!!` | VALID (first two); third = C-B3 | as C-N2; `WATCH_MS` read only by `server.mjs` | Context limits; drawer goes to the owner (C-B3) |
| L-S6 | Claude | Owner step | This repo has `.claude/bootstrap.json`: offer `--upgrade` | VALID | `ls .claude/bootstrap.json` | Step 15 and Affected files |
| L-C1 | Claude (context) | Parent plan | 2a and 2b both edit `docs/plans-dashboard.md` | VALID | 2a Affected files lists `docs/plans-dashboard.md` | Parent plan line corrected (context file, not the validated plan) |

Found by one validator only: C-B2, C-B3, C-N1 (Codex); L-B1, L-S2, L-S3, L-S4, L-S6, L-C1 (Claude). Both: the `checkedAt` meaning (C-N2 / L-S5), the parked/eligibility wording (C-N1 / L-S1).

## Validation response

- Accepted and applied: C-B1 (partly), C-B2, C-N1, C-N2, L-B1, L-S1–L-S6.
- Rejected part of C-B1: "require a fresh timestamp for met" — a met marker is written only after all conditions held and the conditions do not go back; requiring freshness would hide a launchable plan while the dashboard is off.
- Owner decision: C-B3 (show the waiting warning in the dashboard drawer in this plan, or defer). Owner answer: **A — defer** to the later watcher plan. Applied: plan Context line; parent plan "Watcher follow-ups" line.
