# Validation round 4: 20261127-230103-template-updates-collector.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-claude-4.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-4.md`)

## Regressions from round 3 (step a)

- REGRESSION R1 (Claude B1): round 3 added the `run` line kind but left "two kinds" in the decisions and a garbled Contracts line. Fixed (F1).
- REGRESSION R2 (Claude B2): round 3 added name leave-outs to the check but not to the `<project>` replacement in `task.json`. Fixed (F2).

## Findings

| ID | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1 | Three line kinds, Contracts garbled | VALID | "three kinds"; Contracts `run` line fixed; test that `run` is a known kind |
| F2 | Claude B2 | Replacement ignores leave-outs | VALID | One helper `privateNames()` for both; full-run test with `Personal` |
| F3 | Codex B1 | Runs ending in `same` before a commit lose their updates and cannot supersede | VALID | Both `same` exits append right away (`of: 0` before Claude, lines after Claude) |
| F4 | Codex B2, Claude S | A remote branch is no proof of this run's commit; `rev-list`/`remoteBranchSha` can throw on a deleted branch | VALID | Saved `commit` SHA after `git commit`; fallback by commit message and time; all git calls through `run()`; tests incl. merge-commit merge |
| F5 | Codex B3 | Script-written changelog vs `/changelog-entry` | RAISED BEFORE (round 1, F7; round 3, F10) | No new evidence; no edit |
| F6 | Codex B4 | Gate and chip retry paths disagree | VALID | Gate allows a `failed` last run; chip "collect failed" exactly then; `pr` chip is only a link |
| F7 | Claude S | `hash` not carried; dropped branch keeps `branch`/`ids` | VALID | `hash` carried; `branch`/`ids` cleared after a drop |
| F8 | Claude S | `runId` not in the doc step | VALID | Step 19 |
| F9 | Claude S | Global open-PR check costs one gh call per wave | VALID | One `pulls?state=open` call filtered by head ref |
| F10 | Claude S | `same` run crash leaves its worktree | VALID | Order: drop worktree, then line, then status |
| F11 | Codex S1 | One grep for two docs | VALID | Two commands |
| F12 | Codex S2 | Recheck against merged earlier plans | RAISED BEFORE (round 1, F16) | No edit |
| F13 | Claude edge cases | Merge-commit merge; refound after a closed PR; `of: 0` supersede | VALID | Tests added |

## Validation response

Applied: F1–F4, F6–F11, F13. Raised before: F5, F12. No owner question.

## Final edits check

- Read the round-4 diff hunk by hunk. Each hunk does what its finding asked.
- Citations: the plan cites by symbol; no `:line` citation was added.
- Cross-references: no step was added, removed or renumbered.
- Propagation: the `run` kind is in Decisions, Contracts, step 2/3 tests; `privateNames()` is in Decisions (names, free-text cleaning), steps 11 and 12, and Tests; the commit proof is in Decisions, Contracts (`commit` field), step 4, step 6 and step 19; the gate change is in Decisions, steps 16 and 17, and Tests.
- Fixes made in this check: none needed.
- Unresolved problems: none.
