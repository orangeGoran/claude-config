# Validation round 2 — 20261123-111046-validation-report-names

- Claude (plan-validator): ON — `-validation-2.md`, APPROVE WITH CHANGES (2 blocking, 5 should-fix)
- Codex: ON — `-codex-raw-2.md`, NEEDS REWORK (3 blocking, 1 should-fix)
- Regressions from round 1: 1 — fix #3 (one numbering rule) did not reach step d and the "Rounds 2+" line of the skill (found by both validators, finding 1 below). Fixed this round.

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Stop rules still use `n` < 4 / "Round 4"; a run that starts at `n` = 5 has no defined limit; its first diff compares with the previous run | Claude B1, Codex B1 | VALID (REGRESSION of round 1 #3) | template skill-auto-validate-plan step d "`n` < 4 → run round `n+1`", "Round 4 is still not clean", step a "Rounds 2+ only" | Contracts: per-run counter `k`; step 2 rewrites step a and step d; test 9c checks the stop rule uses `k` |
| 2 | Test 9c forbids `codex-raw` / `-round-<n>.md`, but the rule sentence must name them | Claude B2 | VALID | plan Contracts rule lists the old forms | 9c negative checks look only at the write lines; the rule sentence is given word for word; step 1 no longer points at "the Contracts section" of this plan only |
| 3 | `plan-lanes` regex cannot tell `demo-validation-codex-1` (old, slug `demo-validation`) from new (slug `demo`) | Codex B2 | PARTIALLY VALID | `.*?` lazy slug in the regex | Step 7 matches against known plan slugs (`planFiles`, `DONE_DIR`), longest slug wins, unknown files skipped; test 9b adds a second plan `ana-plan-validation` |
| 4 | Concurrent validations of one plan can pick the same number | Codex B3 | INVALID | One validation loop edits the plan file; two at once would already conflict on the plan itself; the workflow runs one at a time | Contracts states the one-at-a-time rule; no reservation |
| 5 | Snapshot left without report, missing folder | Codex edge | PARTIALLY VALID | Step 0 of the skill runs `mkdir -p .plans/.validations`; snapshots are not in the rule | Contracts: a stopped round reuses its number and overwrites only its gitignored snapshot |
| 6 | Browser-test counts stale again | Claude S | VALID | event-watcher is still being validated | Browser test counts C, X, R with `ls` at run time |
| 7 | Test 9a: no `.validations` folder; `onlyPlan()` returns the first plan | Claude S | VALID | `before` hook makes only the plans folder | 9a runs `mkdirSync` and finds `demo-plan` by slug |
| 8 | `/plans-parallel` "Take ×N from the count in .validations/" counts files | Claude S | VALID | `templates/modules/plans-parallel/.../SKILL.md` Status cell | New step 6b, Affected files, step 10 render list, Breaking changes |
| 9 | docs screenshots keep ×2 | Claude S | VALID | — | Step 11 notes it as an Open item |
| 10 | Commit in test 9b is not needed | Claude S | VALID, no change | `gitLines` catches errors | Kept: harmless |
| 11 | Move plan paths not in this checkout | Codex S | VALID, already covered | Step 0 | No change |

Findings found by one validator only: #2, #6–#10 (Claude); #3–#5 (Codex).
