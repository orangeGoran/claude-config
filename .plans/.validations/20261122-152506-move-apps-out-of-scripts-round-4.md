# Round 4: move-apps-out-of-scripts

- Claude (plan-validator): ON — APPROVE WITH CHANGES, nothing blocking (`-validation-4.md`)
- Codex (validate-plan): ON — APPROVE WITH CHANGES, 2 blocking (`-codex-raw-4.md`)
- Regressions from round 3 edits: 1 — the scout-install limit did not reach Affected files (release note) and Breaking changes (Claude 1). Fixed forward.

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Codex | Quoted globs need Node 21+ | VALID (new fix) | Rounds 1–3 rejected it because today's command has the same form. A better fix exists: drop the quotes, so the npm shell expands the list on every Node version. |
| 2 | Codex | `npm run restart` checks port 4899 | VALID | `restart-dashboard.mjs` `PORT = DASH_PORT || 4899`; Hard rules and step 14 pass `DASH_PORT`. |
| 3 | Codex | `BOOTSTRAP_SKILL` not proven by the missing-bootstrap case | INVALID | The same existing test also covers "a broken one shows the render error", which runs `render.mjs` from `BOOTSTRAP_SKILL`. |
| 4 | Codex | Compare the full reference commit | INVALID | The plan mirrors only the `new URL(..., import.meta.url)` pattern from `72691e7`, which the validators confirmed. |
| 5 | Claude | Release note and Breaking changes tell every Mac to install the scout (REGRESSION) | VALID | Both point to Hard rules → Restart. |
| 6 | Claude | Step 2 changes comments for files that stay | VALID | Step 2: those comments stay. |
| 7 | Claude | `--help` line "next to this script" | VALID | Step 2. |

Round 4 is the last round and it edited the plan, so the status is OPEN ITEMS: the fixes above are in the plan but no validator has checked them.
