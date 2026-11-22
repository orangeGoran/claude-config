# Round 3: move-apps-out-of-scripts

- Claude (plan-validator): ON — APPROVE WITH CHANGES, nothing blocking (`-validation-3.md`)
- Codex (validate-plan): ON — APPROVE WITH CHANGES, 2 blocking (`-codex-raw-3.md`)
- Regressions from round 2 edits: 1 — step 14 did not carry the `npm run restart` that round 2 added to Hard rules (Codex 4, Claude 1). Fixed forward.

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Codex | Old-path test misses new, untracked files | VALID | Tests: `git ls-files --cached --others --exclude-standard`. |
| 2 | Codex | Between step 0 and the merge the rules name only the new paths | PARTIALLY VALID | Step 0 now says: change no dashboard or scout file in the main checkout until the merge. Keeping both paths in the rendered rule would make the old-path test fail on `AGENTS.md`. |
| 3 | Codex + Claude | README promised a re-run note the steps do not write | VALID | Context and Breaking changes: the release note says it; `docs/plans-dashboard.md` says when to re-run. |
| 4 | Codex + Claude | Step 14 lacks `npm run restart` (REGRESSION) | VALID | Step 14 repeats the full order. |
| 5 | Codex | Scout install told to every Mac | VALID | Step 13 and Hard rules: only where `~/.claude/scout.json` exists. |
| 6 | Claude | Affected files misses the `docs/` copy | VALID | Affected files and step 10. |
| 7 | Claude | Step 0 rule check does not name `apps/` | VALID | Step 0. |
| 8 | Claude | `plistTemplate` form; unused `here` | VALID | Affected files and step 4. |
| 9 | Claude | Old-path test: binary files, `cwd` | VALID | Tests: NUL-byte check, `cwd` at the repo root. |
| 10 | Claude | Custom `--domain` / `--port` on re-run | VALID | Hard rules and step 14. |
| 11 | Claude | Old server between pull and setup | VALID | Hard rules: run setup right after the pull. |
| 12 | Claude | Temp copy left after the test | VALID | Tests: delete in `finally`. |
