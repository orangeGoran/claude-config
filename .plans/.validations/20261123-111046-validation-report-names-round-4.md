# Validation round 4 — 20261123-111046-validation-report-names

- Claude (plan-validator): ON — `-validation-4.md`, APPROVE WITH CHANGES (2 blocking, 4 should-fix)
- Codex: ON — `-codex-raw-4.md`, NEEDS REWORK (2 blocking, 3 should-fix)
- Regressions from round 3: 1 — the round-3 owner rule (longest slug wins) still gives a new report of `demo-plan` to `demo-plan-validation` (finding 1). Fixed this round by removing the cause.

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Longest-slug rule assigns `demo-plan-validation-codex-1.md` (new Codex of `demo-plan`) to `demo-plan-validation` | Codex B1, Claude edge | VALID (REGRESSION) | The old form `-codex-<n>` makes the name ambiguous; `git log -S "-codex-<n>" -- skills .claude` finds no writer; `-codex-raw-` since the first commit | Dropped `-codex-<n>` from the accepted old names; Contracts proves one owner per name; owner rule and plan-name lists removed from both readers; tests 9a/9b check the two-plan case with the real values |
| 2 | `contracts.md` JSON shape lacks `validation.rounds` | Codex B2 | VALID | `references/contracts.md` "`recommendedBatch`: … `validation: { claude, codex }`" | Step 6 updates it; Contracts and Breaking changes name it |
| 3 | Step 0 uses `test -f`, not in the run allow list | Claude B1 | VALID | `.claude/settings.json` allows only `test -x ~/.local/bin/codex`; `Bash(ls *)` allowed | Step 0 uses one bare `ls` and reads `package.json` |
| 4 | `/plans-parallel` reads the text digest, which has no `rounds` | Claude B2 | VALID | `plan-lanes.mjs` text digest prints `validation=Nc/Mx` | Step 7 prints `<c>c/<x>x/<r>r`; step 6b reads `r`; test 9b checks the line |
| 5 | Wiring & registration still says `{ claude, codex }` | Claude S, Codex S2 | VALID | — | Fixed |
| 6 | `score` adds `claude + codex` | Claude S | VALID | `plan-lanes.mjs` `score` | Step 7 uses `rounds * 50` |
| 7 | Lanes chip changes only after step 10 | Claude S | VALID | dashboard runs the project's own `plan-lanes.mjs` | Browser test checks only the card |
| 8 | Upgrade needs the owner's yes per file | Codex S3 | VALID | `skills/bootstrap-project/SKILL.md` "Never replace an existing file without showing its diff and getting a yes" | Goal, Hard rules, Breaking changes, step 12 say so |
| 9 | Old reports from two runs can show more rounds than ran | Claude edge | VALID | — | Contracts Count rule accepts it for old reports (decision 1A) |
| 10 | Step 8 reads folders per plan each poll | Claude S (optional) | INVALID now | Step 8 no longer reads plan lists (finding 1) | No change |
| 11 | Post-move paths not in this checkout | Codex S1 | VALID, already covered | Step 0 | No change |

Findings found by one validator only: #3, #4, #6, #7, #9, #10 (Claude); #2, #8 (Codex).

Round 4 edited the plan, and it is the last round of this run: the edits of this round are not validated yet.
