# Validation round 2: 20261125-210049-review-loop-caps.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES — `.plans/.validations/20261125-210049-review-loop-caps-validation-2.md`
- Codex (validate-plan): ON — NEEDS REWORK — `.plans/.validations/20261125-210049-review-loop-caps-codex-raw-2.md`
- Regressions from step a (round 1 edits): none found by me. Claude's F2 below is a gap that the round 1 status rules left open (a contradiction between the "no accepted blocking finding → the loop ends" bullet and status rule 1), so it is tagged REGRESSION.

## Findings

| F# | Validator | Severity | Verdict | Action taken |
| --- | --- | --- | --- | --- |
| F1 | Claude | Blocking | VALID | `"codexInVerify": true` in the example breaks the 4 `bootstrapRepo` tests that set `modules.codex: false` (`checkParams()` rejects it). The example now deletes the field (unset = on). Steps 7, 8; Affected files; Tests. |
| F2 | Codex (blocking) + Claude (should fix) | Blocking, REGRESSION | VALID | Step d is now one ordered procedure: Accepted fix → Continue (no status) → Final edits check → Status (the first rule that matches wins). A round with an accepted fix and `n` < 4 always continues. Step 3. |
| F3 | Codex | Blocking | VALID | Step e now reads each hunk as step a does (does what its finding asked, does not break what was correct) before the three checks. Step 3; test string `must not break what was correct`. |
| F4 | Claude | Should fix | VALID | "Accepted fix" now covers a REGRESSION found in step a and an owner answer to a blocking finding, so a round-4 fix of either ends as `READY (round 4 edits self-checked)`. Step 3. |
| F5 | Claude | Should fix | VALID | The test phrase `the first rule that matches wins` is now quoted as template text. Step 3. |
| F6 | Claude | Edge case | VALID (no change) | An early stop with a validator OFF skips its retry: recorded as a plan-author choice in step 3; the status names the OFF validator. |
| F7 | Claude | Should fix | VALID | Breaking changes names `checklist.md` (`--unused`) as a reader; no edit needed. |
| F8 | Claude | Should fix | VALID | The interview row says to leave `codexInVerify` unset, write `false` only on the owner's no, never `true` with Codex off. Step 8. |
| F9 | Codex | Non-blocking | VALID | The descriptions and AGENTS lines say "no accepted fix and no open regression". Steps 1, 5, 10; Goal. |
| F10 | Codex | Edge case | VALID | A deferred owner decision that comes back as `RAISED BEFORE` keeps the status `OPEN ITEMS` (status rule 2). Step 3. |
| F11 | Codex | Non-blocking | RAISED BEFORE (round 1, F5) | Same claim about registered projects, no new evidence. No edit. |

Found by one validator only: F1, F4–F8 (Claude); F3, F9–F11 (Codex). Found by both: F2.

## Validation response

```text
Round 2 of the review-loop-caps plan: 11 findings, 10 applied, 1 raised before. Blocking items fixed: the example no longer sets codexInVerify true (it breaks 4 tests), step d is one ordered procedure (continue before any status), step e checks that each fix is correct. This was the last round allowed by the current 2-round cap, so the round 2 edits are not validated by a validator.
```
