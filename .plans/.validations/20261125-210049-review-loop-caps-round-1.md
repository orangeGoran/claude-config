# Validation round 1: 20261125-210049-review-loop-caps.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES — `.plans/.validations/20261125-210049-review-loop-caps-validation-1.md`
- Codex (validate-plan): ON — NEEDS REWORK — `.plans/.validations/20261125-210049-review-loop-caps-codex-raw-1.md`
- Regressions from step a: none (round 1).

## Findings

| F# | Validator | Severity | Verdict | Action taken |
| --- | --- | --- | --- | --- |
| F1 | Claude + Codex | Blocking | VALID | Status rules rewritten as an ordered list: an open REGRESSION or an unresolved step-e problem → round n+1 (n < 4) or OPEN ITEMS (n = 4); deferred owner decision → OPEN ITEMS; round-4 blocking fix → READY (round 4 edits self-checked); else READY. Step 3. |
| F2 | Codex | Blocking | VALID | Validator OFF combines with the self-check status: `READY (round 4 edits self-checked; <Codex|Claude> OFF)`. Steps 3, 4; test assertion added. |
| F3 | Claude (should fix) + Codex (blocking) | Blocking | VALID | RAISED BEFORE limited to findings an earlier round classified INVALID or the owner deferred; new owner-decision findings still go to the owner; a returning accepted finding is checked again. Step 2. |
| F4 | Codex | Non-blocking | VALID | How to verify states the grep exit codes (1 = pass, 0 = match, 2 = error). |
| F5 | Codex + Claude | Non-blocking | INVALID | The claim was measured in this session with `grep -rl --include=bootstrap.json -s codexInVerify /Users/gorantubic/Workspace` (only this repo and its worktrees). The validators could not run it because it reads outside the repo. The plan already names the command. No edit. |
| F6 | Codex | Non-blocking | VALID | MODULE_INFO.codex text adds "(unless pipeline.codexInVerify is false)". Step 6. |
| F7 | Claude | Should fix | VALID | Tests: "the diet texts" needs no assertion move; its AGENTS.md check proves step 5. |
| F8 | Claude | Should fix | VALID | Tests: the section comment above `const readF` is updated. |
| F9 | Claude | Should fix | VALID | Breaking changes names the real readers of unusedParts (render.mjs, skills/bootstrap-project/SKILL.md); no reader in apps/. Step 6 too. |
| F10 | Claude | Should fix | VALID | Step 11 also fixes the entry 1 heading path to `.plans/done/`. |
| F11 | Claude | Should fix | VALID | How to verify runs `node .claude/scripts/changelog-validate.mjs --base origin/main` (must print PASS). |
| F12 | Claude + Codex (edge cases) | Edge case | VALID | Step e: the fixes it makes are checked once more and listed in the decision log; a problem left after that is unresolved (no third try). Final report gets a "Final edits check" line. |

Found by one validator only: F2, F4, F6 (Codex); F7–F11 (Claude). Found by both: F1, F3, F5, F12.

## Validation response

```text
Round 1 of the review-loop-caps plan: 12 findings, 11 applied, 1 rejected (F5, measured in this session with a grep outside the repo). Blocking items F1–F3 fixed: ordered status rules, combined OFF/self-check status, RAISED BEFORE limited to earlier INVALID or owner-deferred findings. Plan ready for round 2.
```
