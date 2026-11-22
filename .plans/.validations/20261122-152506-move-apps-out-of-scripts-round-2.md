# Round 2: move-apps-out-of-scripts

- Claude (plan-validator): ON — APPROVE WITH CHANGES, 1 blocking (`-validation-2.md`)
- Codex (validate-plan): ON — APPROVE WITH CHANGES, 2 blocking (`-codex-raw-2.md`)
- Regressions from round 1 edits: 2 — step 0 named only the `rule` text, not the `check` / `tests` fields (finding 3); the round-1 "grep must print nothing" check exits non-zero on success (finding 2). Fixed forward.

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Codex | Setup skips the restart when the plist matches; the rule asks for `npm run restart` | VALID | `scripts/setup-macos.sh` "already running with these settings — left untouched". Order: pgrep → setup → `npm run restart`; never restart before setup. |
| 2 | Codex | `grep` with no match exits 1 (REGRESSION) | VALID | Replaced by `test/old-paths.test.mjs` (step 1b), which fails with `<file>:<line>` per leftover and on a git error. |
| 3 | Claude | Step 0 misses the `check` / `tests` fields of two rules (REGRESSION) | VALID | `.claude/bootstrap.json` rule 1 `check`, "Tests for logic changes" `check` and `tests`; step 0 names them and a search of the file. |
| 4 | Codex | Scout test does not prove `install()` uses the path | PARTIALLY VALID | Step 4 makes `install()` read `plistTemplate()`, the same function the test checks; the link is in the code, not in a second test. |
| 5 | Codex | Node 18 and quoted globs | INVALID | As round 1: `package.json` already uses this form. |
| 6 | Claude | Step 4 lacked `plistTemplate()` | VALID | Step 4. |
| 7 | Claude | Test line 1 names `plans-dashboard.mjs` | VALID | Step 7. |
| 8 | Claude | Docs "Re-run it only to…" contradicts the new line | VALID | Step 11 rewrites that sentence. |
| 9 | Claude | Roadmap entry is not on `origin/main` | VALID | Step 0 pushes `docs/roadmap.md` and the parent-plan edits with this plan. |
| 10 | Claude | Where the `docs/` copy goes | VALID | Step 10: into `copyDashboard`. |
| 11 | Claude | Keep the `skills/` and `docs/` layout rows | VALID | Step 0. |
| 12 | Claude | Uncommitted edit to `scripts/plans-dashboard/app.js` in the main checkout | VALID | Step 0: commit or discard before launch. |
| 13 | Claude | Do not run with the session-tabs plan | VALID | Already in Context: the tabs plan runs after this one, with updated paths. |
