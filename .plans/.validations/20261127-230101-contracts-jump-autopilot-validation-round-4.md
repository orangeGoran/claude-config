# Validation round 4: 20261127-230101-contracts-jump-autopilot

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (`-validation-claude-4.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-4.md`)
- Regressions from step a (round 3 edits): none open. Claude found F13 of round 3 (start from the hook input's `cwd`) half applied; that is F1 below (a fix that did not fully land), not a new regression of a correct part.

## Findings

| # | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1 + Codex B1 | A plain `git commit` prints no folder, so the guard still reads the hook process's folder, not the input `cwd` | VALID | Step 16 prints the folder always; two tests where the `spawnSync` cwd and the JSON `cwd` differ |
| F2 | Codex B2 | A `plansDir` outside `<root>/.plans` can never start (the launcher reads `$REPO/.plans` on `origin/<base>`) | VALID (`auto-pipeline.sh` `plan_file="$REPO/.plans/$plan_base"`, "plan not on" check) | `jumpConfirm()` refuses; D21 |
| F3 | Codex B3 | An archived jump plan's open PR is looked up in the 200-PR cache; unknown state lets a second jump through | VALID | The watcher reads the downstream open jump PRs in full (`subs.jumpPrs`); a read error blocks; D22; e2e cases |
| F4 | Claude S1 | Mirror line "the same once() keys" is stale | VALID | Listed as a deviation (two submodule fetches per tick in one case) |
| F5 | Claude S2 | "keeps its old another-repo exit" is wrong; `--path-format` needs git 2.31 | VALID | `common()` follows `gitCommonDir()` (`server.mjs`); harness note fixed |
| F6 | Claude S3 | `warning` used before `let warning` in 2a `cleanEntry()` | VALID | Step 5 places the warning after the 2a group-warning block |
| F7 | Claude S4 | 2a head is `a31cc98` | VALID | Step 10 names it |
| F8 | Claude S5 | `cj3` must wait for `batch` first | VALID | `until()` first |
| F9 | Claude S6 | Projects can rename plan headings | VALID | D10: the plan says its headings are defaults; the module maps them |
| F10 | Claude S7 | Breaking change: unknown-folder commits now blocked | VALID | Breaking changes |
| F11 | Claude S8 | Wrong 2a test pattern name | VALID | `pick(/^const BT = .*$/m)` |
| F12 | Codex S1 | Owner-copy checks vs the "diff" claim | VALID (wording) | Harness note names the `grep` and `render.mjs --upgrade` checks |
| F13 | Codex S2 | Recheck 2a after merge | RAISED BEFORE (round 1, F18) | none |

Found by one validator only: F2, F3, F12 (Codex); F4–F11 (Claude). Both: F1.

## Validation response

Accepted and applied: F1–F12. F13 raised before. No owner question.

## Final edits check

`diff -u -pre-round-4.md <plan>` read hunk by hunk, with the three checks (citations, cross-references, propagation).

- Problem: the new `jumpPrs` field was not in the `watch.json` contract, the `checkSubmodule()` return list and the step 7 field list. Fixed in Contracts, step 6 and step 7.
- Problem: the `GET /api/ledger` contract did not show the `{ slug: null, error }` blocker that F3 adds, and the card had no text for it. Fixed in Contracts (`blockers`) and step 10 (`blocked` state text).
- Checked: step numbers did not change; "How to verify" `grep -n "git-common-dir" …workflow-guard.sh` still matches the step 16 text; D21/D22 are named in step 8 and the e2e case; the parent plan names D1–D22.
- Unresolved: none.
