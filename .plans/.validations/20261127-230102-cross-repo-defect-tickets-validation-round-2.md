# Validation round 2 — 20261127-230102-cross-repo-defect-tickets

- Claude (plan-validator): ON — APPROVE WITH CHANGES — `-validation-claude-2.md`
- Codex: ON — NEEDS REWORK — `-validation-codex-2.md`
- Regressions from round 1 (diff `-pre-round-1` → `-pre-round-2`): none. Self-check before this round added the `ticket creating:` / `pr body:` Timeline lines and the PR body markers to Contracts (propagation of round 1 F7/F8).

## Findings

| # | Raised by | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| G1 | Claude B1 | Step 8 and the page tests target `169b888`; the 2a worktree has an uncommitted rework (`checklistHtml(d)`, `.ck-box`, "Needs you now", `CK_DRAWER`, `showChecklist()`); the sibling plan does not give the signature this plan quoted | VALID | Worktree `app.js` `checklistHtml(d)` and its "Needs you now" box; sibling plan step 10 "Map to the merged 2a page first". Context rewritten; triage rows go into the 2a "Needs you now" box; page tests rewritten; wrong signature claim removed. |
| G2 | Claude B2 | `labels=needs-triage` catches ordinary issues | VALID | Query is now `labels=from-pipeline,needs-triage` (REST `labels` is AND); new decision. |
| G3 | Claude B3, Codex B2 | `skill-1-plan` cannot skip triage tickets without `labels` in `--json` | VALID | `--json number,title,url,labels`. |
| G4 | Codex B1 | The run cannot use Write in the report folder (overlay has Read/Edit only) | INVALID | The template already writes `<report dir>/<slug>-pr-body.md` with the Write tool in commit mode (`skill-auto-pipeline/SKILL.md` "commit mode" item 1) and `<slug>-tree.txt` (item 5.1) under the same overlay; Claude Code `Edit(...)` rules cover the Write tool. No change. |
| G5 | Codex B3, Claude S | Recovery uses the search index (delay) and treats a failed search as absence | VALID | Recovery now uses `gh issue list --json url,body` (no search index) and the exact marker; a failed list creates nothing. |
| G6 | Codex B4 | Two entries on one repo still make two requests | VALID | Cache keyed by repo; `triageReader()` picks the one reader before refresh; test asserts the second folder's `calls.log`. |
| G7 | Codex B5 | PRs in the issues list can hide the 100-limit | VALID | `TRIAGE_JQ` returns `{ full, items }` with `full` from the raw count; hint uses `full`. |
| G8 | Claude S | `issue-allow` narrower than `push-allow` | VALID | Now `gh (issue|label)` except `gh issue view|list`. |
| G9 | Claude S | `write_related()` needs `return 0`; reset `related_arg` per plan | VALID | Step 11. |
| G10 | Claude S | Cleanup leaves ticket bodies and the live PR body | VALID | Script `--cleanup` and server `cleanup()` artifacts list. |
| G11 | Claude S | Redaction does not name the issue title | VALID | Added. |
| G12 | Claude S | Tickets land after `PR OPEN` | VALID (documented) | New decision: the PR is a draft; the ticket needs the PR link. |
| G13 | Claude S | The "unset" test must `unset` the variable | VALID | Test text. |
| G14 | Claude S | `docs/roadmap.md` still says plan 2 is not written | VALID, out of scope | The caller updates `docs/roadmap.md`; reported in the final reply. |
| G15 | Codex NB, edges | Sibling not landed; reader change; mixed PR/issue page | VALID | Covered by G1, G6, G7. |

Only Claude found: G1, G2, G8–G14. Only Codex found: G4 (rejected), G6, G7.

## Validation response

All valid findings were applied to the plan. G4 is rejected with evidence. No owner decision was needed.
