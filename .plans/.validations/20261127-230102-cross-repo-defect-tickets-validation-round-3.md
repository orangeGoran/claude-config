# Validation round 3 — 20261127-230102-cross-repo-defect-tickets

- Claude (plan-validator): ON — APPROVE WITH CHANGES — `-validation-claude-3.md`
- Codex: ON — NEEDS REWORK — `-validation-codex-3.md`
- Regressions from round 2 (diff `-pre-round-2` → `-pre-round-3`): none. Checked: no `triageLists[proj.root]`, `cache.items` or `projByName` left; the Contracts `triage` shape has `full`; the page tests, Browser test and docs step name "Needs you now".

## Findings

| # | Raised by | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| H1 | Claude B1 | The "needs triage" chip is hidden by `.ck-you .chip.warn { display:none; }` | VALID | Worktree `app.css` (2a rework). Step 9 adds `.ck-you .ck-triage .chip.warn { display:inline-block; }`; Harness constraints and Browser test name the CSS check. |
| H2 | Codex B1 | Recovery list capped at 50 treats "not found" as absent | VALID | Now `--author @me --limit 200`; 200 rows without a hit is inconclusive: no create. |
| H3 | Codex B2 | Recovery uses the recorded repo after it left the group | VALID | Explicit policy: an existing issue is linked; a new one goes only to the target of now. |
| H4 | Claude S1 | A hand launch reuses an old related file | VALID | `write_related` third argument `resume`; a launch with the variable unset removes the file; test added. |
| H5 | Claude S2 | `usage()` prints `2,30p`; the new header line cuts the last usage line | VALID | Step 11 changes it to `2,31p`. |
| H6 | Claude S3 | A crash inside item 7.5 is invisible after `PR OPEN` | VALID | Item 7.5.8: the "Next — your part" block lists the `D<n>` lines without a ticket. |
| H7 | Claude S4 | The sidebar group count does not count triage tickets | VALID (documented) | Step 21 says so in the docs. |
| H8 | Claude S5 | `inline(i.title)` turns an issue title into links | VALID | `esc(i.title)`. |
| H9 | Claude edges | Ship BLOCKED with no PR; reopened issue notifies again | VALID | Item 7.5.8 and step 21. |
| H10 | Codex NB | Sibling and 2a rework not landed | RAISED BEFORE (round 2, G1/G15) | The Context already says to map to the merged code. No change. |

Only Claude found: H1, H4–H9. Only Codex found: H2, H3.

## Validation response

All valid findings were applied. H10 brought no new evidence.
