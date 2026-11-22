# Round 1: move-apps-out-of-scripts

- Claude (plan-validator): ON — APPROVE WITH CHANGES, 1 blocking (`-validation-1.md`)
- Codex (validate-plan): ON — NEEDS REWORK, 4 blocking (`-codex-raw-1.md`)
- Regressions: none (round 1)

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Codex + Claude | Restart order: setup restarts the service itself; `npm run restart` before setup starts a deleted path | VALID | `scripts/setup-macos.sh` boots out and bootstraps the job when the plist changes. Hard rules now give the order: pgrep, then setup (it is the restart), never `npm run restart` before it. |
| 2 | Codex + Claude | Rule sources and rendered files still name old paths during the run | VALID | Step 0 (owner, by hand, before launch): update `.claude/bootstrap.json`, re-render, push with the plan; step 14 is now only the post-merge order. |
| 3 | Codex | Quoted test globs need Node 21+ | INVALID | `package.json` already runs `node --test 'scripts/test/*.test.mjs'`; the plan keeps the same form, so no new Node version risk. |
| 4 | Codex | Dashboard test comment names `scripts/chat-relay.mjs` | VALID | Step 7. |
| 5 | Claude | Verify grep hits `docs/roadmap.md` (`restart-dashboard.mjs`) | VALID | Step 11 rewrites the roadmap entry with the new paths only; the grep now must print nothing. |
| 6 | Claude | Bare `plans-dashboard.mjs` in `contracts.md` and `verify.mjs` | VALID | Step 12 covers mentions with or without `scripts/`; a second grep (`-w plans-dashboard.mjs`). |
| 7 | Claude | Server comments say the example registry is "next to this file" | VALID | Step 2. |
| 8 | Claude | Plain `mv` is not in the run allow list | VALID | `.claude/scripts/auto-pipeline.sh` allows `git mv*`; step 1 uses `git mv`. |
| 9 | Claude | Scout install on a Mac without the scout | VALID | Hard rules: only where `~/.claude/scout.json` exists, as `scripts/setup.sh` does. |
| 10 | Claude | `IS_MAIN` string compare differs from `scout.mjs` | VALID | Step 10 uses the `scout.mjs` check. |
| 11 | Codex | Exit handler runs on import | VALID | Step 10 guards it too. |
| 12 | Claude | `copyDashboard` test needs a dynamic import and the `Workspace/claude-config` folder | VALID | Tests. |
| 13 | Codex | Copy lacks `skills/bootstrap-project` | VALID | Step 10 copies `skills/` (without `node_modules/`). |
| 14 | Claude | New exports missing from Affected files and Wiring | VALID | Both sections. |
| 15 | Claude | Docs line names a past version | VALID | Step 11 wording in the present tense. |
| 16 | Codex | Confirm the rule-file list with git ls-files | INVALID | Only `AGENTS.md` and `changelog.d/AGENTS.md` exist (`find . -name AGENTS.md -not -path './.git/*'`); the plan follows both. |
| 17 | Codex | Live chat reconnect not checked | VALID | Harness constraints: owner check after setup. |

Only Codex found: 3, 4, 11, 13, 16, 17. Only Claude found: 5–10, 12, 14, 15.
