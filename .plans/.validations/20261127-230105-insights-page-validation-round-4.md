# Validation round 4 — 20261127-230105-insights-page

- Claude (plan-validator): ON — APPROVE WITH CHANGES, no blocking issue (`-validation-claude-4.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-4.md`)
- Regressions from round 3 (step a): 0 counted as REGRESSION by me; Codex F1 below is a defect in a round 3 Browser-test line (an impossible Back/Forward sequence) and is fixed here.

## Findings

| # | Raised by | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Codex (blocking) | The Browser test sequence "Back → open B → Forward" is impossible: opening B drops the Forward entry | VALID | Step 10 example and Browser test rewritten (menu to Insights, then Dashboard; plus a pure Back/Forward case) |
| F2 | Codex (blocking) | `planCounts()` reads only 8 KB, so `isParentPlan()` is not the `looksRoadmap` rule for a long header | VALID (plan-lanes.mjs reads the whole header block) | Step 2 reads the whole file (reverts round 2 F11); unit test with the marker after 9 KB |
| F3 | Claude | Plan 1's `insights.mjs` header comment and `#insights-ledger` anchors break after the section rename | VALID | Step 15 updates them (grep given); Affected files |
| F4 | Claude | The e2e registry entry needs `root` (`resolveProject()`) | VALID (server.mjs `resolveProject`) | Tests setup |
| F5 | Claude | "no HOME path" assertion cannot fail for EISDIR | VALID | 500 body must equal the generic error |
| F6 | Claude | Deviation wording: `insightsBody()` also runs the cached `git remote get-url` | VALID | Reference implementation deviation reworded |
| F7 | Claude | SVG `fill="var(--pc)"` attribute not reliable | VALID | Step 11: `style="fill:var(--pc)"` or a CSS rule |
| F8 | Claude | The `insightsBody()`-before-headers check reads `server.mjs`, not the page | VALID | Markup test line says so |
| F9 | Codex | Plan 1 module and preview not verifiable | RAISED BEFORE (round 1 F12, round 2 F13/F14, round 3 F9) | no change |

Only Codex: F1, F2. Only Claude: F3–F8.

## Validation response

Both Codex blocking issues and all Claude should-fix items are applied. F9 is raised before. No owner decision was needed. This is round 4: no fifth round; the edits were self-checked below.

## Final edits check

- Diff `-pre-round-4.md` → plan read hunk by hunk. Each hunk does what its finding asked.
- Citations: `resolveProject()` (server.mjs), `issuesUrlFor()` (server.mjs), `looksRoadmap` (plan-lanes.mjs), `json()` (server.mjs: the 500 body is `JSON.stringify({ error })`, so the exact string holds) re-opened.
- Cross-references: no step was added or renumbered; step 10's example and the Browser test now describe the same sequences; the Forward case keeps A because `readUrl()` replaces `dashSearch` only on a Dashboard path or a non-empty `/insights` query.
- Propagation: the whole-file read is in step 2 and the unit test; the section rename is in step 15 and Affected files; the `root` setup and the exact 500 body are in the e2e tests only (no other section names them).
- Fixes made in this check: none needed. Unresolved problems: none.
