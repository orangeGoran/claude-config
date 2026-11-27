# Validation round 4 — 20261127-230102-cross-repo-defect-tickets

- Claude (plan-validator): ON — APPROVE WITH CHANGES (no blocking) — `-validation-claude-4.md`
- Codex: ON — NEEDS REWORK — `-validation-codex-4.md`
- Regressions from round 3 (diff `-pre-round-3` → `-pre-round-4`): none. Before this round, the launch-loop wording of `write_related` was made explicit (no third argument on a launch).

## Findings

| # | Raised by | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| J1 | Codex B1 | `$3` is unbound under `set -u` on a launch | VALID | `auto-pipeline.sh` `set -euo pipefail`. Step 11 reads `${3:-}`. |
| J2 | Codex B2 | The list check runs before recovery, so a created issue can stay unlinked | VALID | Item 7.5 reordered: 1 Recovery first, 2 Which lines (list policy only for a new create). |
| J3 | Claude S1 | `gh issue list --label` may use the search index (delay) | PARTIALLY VALID | Not proven either way; recovery now uses the REST list `gh api repos/<repo>/issues -X GET -f labels=from-pipeline …` (no search index, no quotes needed), with its own overlay rule `Bash(gh api repos/*/issues -X GET -f labels=from-pipeline*)` and 100 rows as the inconclusive limit. Decisions, wiring, step 11 and the overlay test updated. |
| J4 | Claude S2 | Step 20 names "the two Timeline lines" | VALID | Now "the Timeline lines of Contracts". |
| J5 | Claude S3 | Watcher test gaps: `#90` has no title; the `ct-tri` cases depend on order | VALID | One `test()` in a fixed order; `#90` row given. |
| J6 | Claude S4 | Raw issue title in the notification subtitle | VALID | `redact()` and the URL strip of `notifyParts()`. |
| J7 | Claude edge | `listTriage()` must catch a `JSON.parse` failure | VALID | Step 4. |
| J8 | Claude edge | Fork with an `upstream` remote | VALID (documented) | Harness constraints and step 21. |
| J9 | Codex edge | A full page replaces the baseline and can notify again | VALID | When `full`, the baseline is the union (newest 1000); test part added. |
| J10 | Codex NB | Sibling and 2a rework not landed | RAISED BEFORE (round 2 G1/G15, round 3 H10) | No change. |

## Validation response

All valid findings were applied. This is round 4: no fifth round; the edits were self-checked below.

## Final edits check

`diff -u -pre-round-4.md <plan>` read hunk by hunk, with the three checks:

- Citations: the new rule names and command forms appear the same in Decisions (Allow rules, No duplicate after a crash, Recovery never guesses), Wiring, step 11, item 7.5.1 and the overlay test. Fixed during the check: the first recovery command form had `?` and `&` and needed quotes, which a prefix rule may not match; changed in all four places to the `-X GET -f …` form.
- Cross-references: item 7.5 numbers 1–8 re-read; "go to item 5" (Record) and "(item 7.5.2)" (Which lines) point at the right items. A stray sentence that put a `pr_rules` change into step 12 was removed (it belongs to step 11).
- Propagation: `${3:-}` is only in step 11; the union baseline is in step 5 and the test; the subtitle redaction is in step 5.
- Unresolved problems: none.
