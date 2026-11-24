# Round 4 — pipeline-diet-templates (last round)

- Claude: ON (`-validation-4.md`, APPROVE WITH CHANGES, 1 blocking, 4 should-fix)
- Codex: ON (`-codex-raw-4.md`, NEEDS REWORK, 2 blocking, 2 non-blocking)

## Regressions from round 3 edits

| # | Regression | Raised by | Fix |
| --- | --- | --- | --- |
| R1 | Item 5 picked its case from the Status, which the preflight sets to `RUNNING` on every resume | Claude B1 | Case from the commit log (`git log --format=%s <base>..HEAD`) and Timeline entries (`decision sheet: done` with a tree mark, `decision sheet: gate failed`) |
| R2 | 3B test searched for `**5. Decision sheet**` and `Do not commit.` (texts that do not render) | Claude S1, S2 | Test strings match the plan text; indexes asserted >= 0 |

## Findings

| # | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| 1 | Codex B1 | Before the commit, the Codex review misses untracked new files | VALID | `validate-implementation` Input lists and reads `git ls-files --others --exclude-standard`; Affected files; test |
| 2 | Codex B2 | A `done` entry is not bound to the tree | VALID | Each `done` entry carries a tree mark (`git diff --shortstat` + `git status --porcelain` count); a different mark runs the sheet again |
| 3 | Codex NB1 | Cost split divides by a zero weight | VALID | All of the rest goes to `unattributed`, other rows `n/a`; test |
| 4 | Codex NB2 | Log fields and auto-load not verified by Codex | INVALID (answered) | Claude rounds 2–4 confirmed the log fields (names only); the auto-load has the shim fallback (round 1); owner check of a real log under Open items |
| 5 | Claude B1 | Case from the Status | VALID | R1 |
| 6 | Claude S1 | Wrong item string in the test | VALID | R2 |
| 7 | Claude S2 | `Do not commit.` not in the text | VALID | R2 |
| 8 | Claude S3 | A failed gate re-runs only "Test (full)" | VALID | Item 5 (Test gate) runs scoped tests and lint of the changed files, then the full suite; item 7 re-runs item 5 on the files of the `gate failed` entry |
| 9 | Claude S4 | A sheet that fails after it changed a file | VALID | Changed files come from `git status --porcelain` / `git diff --shortstat` before and after; any change → the test gate |

Only Codex found 1–4. Only Claude found 5–9.

## Validation response

All VALID items applied. Round 4 is the cap, so these edits are not validated again. Status: OPEN ITEMS (the round-4 edits to step 12 item 5, the `validate-implementation` step and the zero-weight rule).
