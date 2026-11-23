# Round 1 — decision log

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-1.md`, APPROVE WITH CHANGES
- Codex: ON — `-codex-raw-1.md`, NEEDS REWORK
- Regressions: 0 (first round)

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Notification link uses `?plan=`; the page reads `?sel=` | both | VALID | `scripts/plans-dashboard/app.js` `readUrl()` reads `sel` | Step 4 uses `?sel=<encoded key>`; e2e asserts `-open` |
| 2 | Auto-launch kills a live chat (`runLauncher` → `chatEnd`) | Claude | VALID | `runLauncher` calls `chatEnd(proj, s)` | `canAutoLaunch` checks `chatting`, `chatWaits`; unit + e2e case; docs |
| 3 | Body examples / code blocks act as a go | Claude | VALID | step 1 regex had `gm` over the whole file | Header-only parse, fences skipped; unit + e2e cases |
| 4 | Run count misses `starting`, counts stale `running`/`CLEANED` | both | VALID | `outcomeOf` defaults to `running`; `launches` map | `runningCount` with `starting`, `reportAt`, `STALE_RUN_MS`, `CLEANED`/`unknown` excluded |
| 5 | Manual and auto launches race on the limit | Codex | PARTIALLY VALID | manual launches are the owner's own choice | Manual launches count (via `starting`/`live`), are not blocked; no serialization added |
| 6 | Launch marked done at call; SKIP/failure blocks retries | both | VALID | `runLauncher` sets `failed` later | `launched[slug].state` pending/started/failed, `auto-launch-failed` event + notification, 10-minute recovery, no automatic retry (documented) |
| 7 | PR cache: newest 200, one PR per branch | Codex (Claude as edge case) | VALID | `listPrs` 2 pages; `allByBranch` keeps first per branch | `pr` waits read the single PR with `gh api …/pulls/<n>`; merge events stay list-based (documented limit) |
| 8 | Refresh all projects before checking waits | both | VALID | plan step 5.1 was per project | Step 7: `Promise.all(refreshPrList)` first |
| 9 | Release note audience must be `both` | Codex | VALID | `changelog.d/README.md` "A new API route … is visible" | Step 17 `audience: both` with customer text |
| 10 | Board cards use `autoChips` | Codex | VALID | `boardCard` calls `autoChips(p)` | Browser test checks list and board |
| 11 | Changelog validator missing from How to verify | Codex | VALID | `changelog.d/AGENTS.md` | Command added |
| 12 | gh error skips the whole project | Claude | VALID | plan step 5.1 | Only the PR part is skipped; e2e case |
| 13 | Generic projects show "waits" forever | Claude | VALID | watcher launched only pipeline projects | `error` naming auto-pipeline.sh; e2e case; docs |
| 14 | `canAutoLaunch` used last tick's waits | Claude | VALID | step 7 read `waitStatus` | Fresh `waits` passed in |
| 15 | `watch.json` lacks dedupe keys; non-atomic write | Claude | VALID | step 3 shape | `met`, `errors` keys; temp file + `renameSync`; shape in Contracts |
| 16 | Step 0 `test -f` is auto-denied | Claude | VALID | `.claude/settings.json` allow list | `ls apps/dashboard/server.mjs` |
| 17 | `/api/state` consumer list incomplete | Claude | VALID | `docs-media.mjs`, `restart-dashboard.mjs` probe it | Listed in Breaking changes |
| 18 | Submodule: uninitialized, `-` paths, missing `--` | both | VALID | plan step 4 | `.git` check, `-` rejected, `--` in `ls-tree`, errors; e2e case |
| 19 | Second watcher from a hand-started test dashboard | Claude | VALID | AGENTS.md "Run a test dashboard by hand" uses the real HOME | `WATCH_LOCK` like `SCOUT_LOCK`; e2e case |
| 20 | Double notification with 🔔 on | Claude | VALID | docs "Alerts" | Documented in "## Alerts" |
| 21 | skill-1-plan "explicit go" lines | Claude | VALID | `.claude/skills/skill-1-plan/SKILL.md`, template | Template updated in step 15; `.claude/` copy under Open items (owner) |
| 22 | Restart note: server imports the scout; pull does not restart | Claude | VALID | new import | Hard rules + docs |
| 23 | `events.jsonl` unbounded | Claude | VALID | append-only | Capped at 5000 lines (`capLines`) |
| 24 | Step 5 too long | Claude | VALID | — | Split into steps 4–7 |
| 25 | Ambiguous `short` | Claude | VALID | `short` not unique in registry | `findProject` with error; e2e case |
| 26 | Auto-start mode (default `verify` opens no PR) | Claude | VALID | `DEFAULT_MODES`; template modes `verify`/`commit`/`pr` | `autoMode()` prefers `pr` (parent plan: only PRs reach the owner) |
| 27 | Re-validate post-move paths after the move merges | Codex | VALID (note) | move plan not merged | Context note; step 0 blocks the run when not merged |
| 28 | Wait line edited after a tick; different bases per plan | Codex | VALID | — | Waits re-read every tick from the file; fetch per project and base |

Findings only one validator raised: Claude 2, 3, 12–26; Codex 5, 7, 9, 10, 11.
