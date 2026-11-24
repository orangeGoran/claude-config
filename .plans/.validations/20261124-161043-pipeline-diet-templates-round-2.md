# Round 2 — pipeline-diet-templates

- Claude: ON (`-validation-2.md`, APPROVE WITH CHANGES, 1 blocking, 12 should-fix)
- Codex: ON (`-codex-raw-2.md`, NEEDS REWORK, 4 blocking, 3 non-blocking)

## Regressions from round 1 edits

| # | Regression | Raised by | Fix |
| --- | --- | --- | --- |
| R1 | The 3B move put the sheet inside the Document phase: a stop after `DOCUMENTED` or a commit-mode → "to PR" resume could skip it | Codex B1, B4 | The sheet is its own item 5 with a `decision sheet: done` Timeline line; Commit checks it; Resume rule for a committed run (no `--fix`) |
| R2 | "It never blocks" also covered a failure after `--fix` edited files | Codex B2 | Item 5 splits "no fix" (never blocks) from "fixes" (full test gate; failure → `FAILED: decision sheet`, no commit) |
| R3 | The compaction row of round 1 assumed assistant lines | Claude B1 | Compaction cost comes from its own `result` line; fixture uses the real shape |
| R4 | One-message wall rule contradicted the `n/a` rule | Codex NB3 | Span from marker timestamps; `n/a` only without a start or end timestamp |

## Findings

| # | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| 1 | Codex B1 | Commit → PR resume skips the sheet | VALID | R1 |
| 2 | Codex B2 | Failure after `--fix` edits still commits | VALID | R2 |
| 3 | Codex B3 | Check-only lint and format on the final tree | PARTIALLY VALID | Audit row 2 already runs check-only lint and format on the changed files after the loop (`render.mjs` `lintRow`); step 8 says so; test keeps row 2 in both configs |
| 4 | Codex B4 | No completion state for the moved sheet | VALID | R1 |
| 5 | Codex NB1 | Folder match by slug is ambiguous | VALID | Lookup `<projects-dir>/*/<session id>/subagents/`, each file name once |
| 6 | Codex NB2 | Field shapes not independently verifiable | PARTIALLY VALID | Claude round 2 confirmed the shapes in a second local log (counts only); fixtures follow them |
| 7 | Codex NB3 | Wall-time rules conflict | VALID | R4 |
| 8 | Claude B1 | Compaction segment has no assistant line | VALID | R3 |
| 9 | Claude S | Status name for a failed sheet fix | VALID | `FAILED: decision sheet` |
| 10 | Claude S | Sheet fixes are not audited | VALID | Breaking changes line |
| 11 | Claude S | `skill-5-ship` browser-test rebuilds run Codex again | VALID | Step 14: `--no-codex`, copy the Codex line |
| 12 | Claude S | Meta files without `toolUseId` | VALID | `unattributed`; test |
| 13 | Claude S | Cut project folder names | VALID | #5 |
| 14 | Claude S | VS Code copy has the same subagent files | VALID | Each file name once; session ids from JSON lines only |
| 15 | Claude S | Compaction text line has no timestamp | VALID | Row span from its segment's timestamps |
| 16 | Claude S | Verify report stop reasons | VALID | Step 8 |
| 17 | Claude S | `skill-2-implement` full-suite fallback with `--unattended` | VALID | Step 11 |
| 18 | Claude S | `checklist.md` hand-off example | VALID | Step 16 |
| 19 | Claude S | AGENTS.md has no verify line when Codex is off in verify | VALID | Step 15 `IFNOT` line; test |
| 20 | Claude S | `git.keepTracked` with `.plans/.code-reviews/` fails the commit path check | INVALID | Exists today and is not changed; by default nothing writes that folder now |
| 21 | Claude S | Row cost is an estimate | VALID | Output caveat |

Only Codex found 1–7. Only Claude found 8–21 (Claude also confirmed 3B against the pipeline text).

## Validation response

All VALID items applied; two INVALID or partly answered with evidence (#3, #20). Round 3 validates these edits.
