# Validation round 2: 20261127-230101-contracts-jump-autopilot

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (`-validation-claude-2.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-2.md`)

## Regressions from step a (round 1 edits)

- R1 — Context still named only the 169b888 drawer symbols (`CHECK_TITLE`, `openChecklist()`) after step 10 was re-mapped. Fixed before the validators ran: Context names both shapes and points to step 10.
- R2 — Reference implementation "Deviations" still said `checklistHtml()` gets a fourth parameter. Fixed: the card is `jumpCardHtml(items, off)`.
- R3 — Breaking changes still said `checklistHtml()` gets a fourth parameter. Fixed: one new call each in `checklistHtml()` and `renderChecklist()`, signatures unchanged.

All three were fixed and the round 2 snapshot was taken again after the fixes. No open regression.

## Findings

| # | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1 + Codex B1 | `recommendJump()` filters on `base`; `PR_JQ` rows have `baseRefName` (`server.mjs` `PR_JQ`) | VALID | Step 2 filters `baseRefName` and names the `PR_JQ` shape; unit test with a `base`-only row |
| F2 | Codex B2 | `sub.prs.rows` read when `prs` is null | VALID | `(sub.prs && sub.prs.rows) \|\| []` |
| F3 | Codex B3 | A branch fetch may not update `origin/<branch>` | VALID | Jump plan step 1 uses the explicit refspec `+refs/heads/<branch>:refs/remotes/origin/<branch>`; unit test |
| F4 | Codex B4 | Guard checks only the first commit segment's folder | VALID | Each commit segment gets its folder; different folders → `unknown` → checked by the guard's own rules; test |
| F5 | Codex B5 | `safeSubPath()` allows `..` inside a segment; `parseWaitsFor()` rejects any `..` (`watch.mjs`) | VALID | No `..` anywhere; test `contracts..old` |
| F6 | Claude S | `esc(41)` throws (`esc` calls `.replace`) | VALID | `String()` first |
| F7 | Claude S | Box key holds `\n`; attribute selector fails | VALID | Compare `dataset.jkey` in JS |
| F8 | Claude S | `Q` placeholder breaks on an unquoted `QA-tool` | VALID | Sentinel `\u0001<index>\u0001`; test |
| F9 | Claude S | Two new guard cases pass today | VALID | Text names the three that fail today; the rest are regression checks |
| F10 | Claude S | Cross-site 403 is not JSON | VALID | Raw `fetch` |
| F11 | Claude S | `cj6` registry POST body shape | VALID | `{ projects: [...registry(), …] }`; also `'a b'` split into two good paths → now `'../y'` |
| F12 | Claude S | `dropped` not exact | VALID | Defined |
| F13 | Claude S | `repoKey()` keeps `user:token@` | VALID | Strips it |
| F14 | Claude S | Push commands need "on branch <base>" | VALID | Added |
| F15 | Claude S | `plansDir` outside root → `pushed` always false | VALID | `pushed: null`, shown as nothing |
| F16 | Claude S | "a fourth part" wording; `audience: both` needs `customer.en` | VALID | Both fixed |
| F17 | Codex S1 | No full comparison of owner copies | VALID | `render.mjs --upgrade --stage --json` check added for the owner |
| F18 | Codex S2 | Recheck 2a after merge | RAISED BEFORE (round 1, F18) | none |

Found by one validator only: F2–F5, F17 (Codex); F6–F16 (Claude). Both: F1.

## Validation response

Accepted and applied: F1–F17. F18 raised before. No owner question.
