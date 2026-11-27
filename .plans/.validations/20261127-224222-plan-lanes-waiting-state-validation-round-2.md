# Validation round 2 — 20261127-224222-plan-lanes-waiting-state

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES, no blocking issues (`-validation-claude-2.md`)
- Codex (`validate-plan`): ON — APPROVE WITH CHANGES, 1 blocking issue on the parent plan (`-validation-codex-2.md`)

## Regressions (step a, round 1 edits)

| ID | Problem | Fix |
| --- | --- | --- |
| R1 | REGRESSION (propagation): Contracts named the new registry read, but step 12 added no `contracts.md` row for it | Step 12: second "Fixed names" row (`pipeline-projects.json` `name` / `root`); Affected files line |
| R2 | REGRESSION (propagation): step 14 changelog `internal` did not name `projectName()` | Step 14 text |

Both fixed before the round 2 snapshot, so the validators saw the fixed plan.

## Findings

| ID | Raised by | Finding | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| X-B1 | Codex (blocking) | Parent plan says an old result counts as "not met"; the child says `met: true` counts at any age | VALID (parent plan only) | parent plan 2b line; round 1 C-B1 rejection of a freshness rule for `met` | Parent plan 2b line reworded to the child's rule. The validated plan needs no change |
| X-N1 | Codex | Goal says the age is always listed | VALID | step 4 `note` is set only for an old or missing check | Goal bullet narrowed |
| X-N2 | Codex | `CENTRAL_STATE` change also moves the `plan-summaries.json` fallback | VALID | template `SUMMARY_CACHE = pick(…, path.join(CENTRAL_STATE, 'plan-summaries.json'))` | Breaking changes; registry test asserts `plans[].summary` |
| L-S1 | Claude | Registry test: `<dir>/.claude` does not exist | VALID | `bootstrapRepo()` makes only `<dir>/acme-api/.claude` | `mkdirSync` in the test text |
| L-S2 | Claude | Fence test can pass without the fence rule | VALID | `watch.mjs` `parseWaitsFor()` fence handling | Fixed line order in `dan-plan`; new `gus-plan` case (real line after a fence with `## `) |
| L-S3 | Claude | `null` registry entry throws and hides a later match | VALID | step 1a text | `x && typeof x.name === 'string' && …` |
| L-S4 | Claude | "waiting" has two meanings in the skill | VALID | `plans-parallel` skill: "a running or waiting run" | Step 11 sentence names "a plan that waits for a condition (see `WAITING`)" |
| L-S5 | Claude | `waiting` can hold plans that are not schedulable | VALID | `schedulable` filter in the template | Step 6 uses `schedulable.filter(…)`; Contracts; test wording |
| L-S6 | Claude | Parent plan has the older rule | VALID | same as X-B1 | same fix |
| L-E1 | Claude (edge) | A plan met but not started is in the batch with no warning | VALID (known limit) | 1A+ | Context known limit |
| L-E2 | Claude (edge) | Blank first-tick `watch.json` says "last checked never" | VALID | `loadWatch()` blank object | Test assertion added |

Found by one validator only: X-N1, X-N2 (Codex); L-S1–L-S5, L-E1, L-E2 (Claude). Both: the parent plan wording (X-B1 / L-S6).

## Validation response

- Accepted and applied: all findings above. No finding rejected. No owner question.
- Accepted fix from a blocking finding in the validated plan: none (X-B1 changed only the parent plan). So the loop stops after this round.

## Final edits check

- Hunks read: Goal, Context (known limit), Contracts (`waiting`), Breaking changes, steps 1a, 6, 11, Tests (four cases).
- Problems found and fixed: step 1a said `root` / "its `name`" where the entry is `x` → `x.root`, `x.name` (Steps). The "waiting plan that runs" test named the old `occupied()` filter → now "builds `waitingPlans` from `plans` instead of `schedulable`" (Tests). The registry test asserted `summary` on the batch entry, which has none → `plans[].summary` (Tests).
- Cross-references: "step 6" (Context, Tests), "step 15" (Affected files), "step 1a" — still correct.
- Unresolved: none.
