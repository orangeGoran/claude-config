# Plan: Move the apps out of scripts/

- **Base**: main

## Goal

Put the things that run in `apps/` and keep `scripts/` for setup and helper scripts. The dashboard server, its page, the chat relay and the restart command move to `apps/dashboard/`; the scout moves to `apps/scout/`; each app gets its own `test/` folder; the skill test moves to a root `test/`. This is the roadmap entry "Move the apps out of `scripts/`" (`docs/roadmap.md` → Parent plans), which runs before Mac app phase 1. It also makes `scripts/docs-media.mjs` able to start its throwaway dashboard again.

## Context

- Parent plan sections: `docs/roadmap.md` → Architecture and Parent plans ("Move the apps out of `scripts/`").
- Decisions taken for this plan (owner, this session):
  - The new layout (drawn in this session, adjusted after the web research): `apps/dashboard/` (`server.mjs`, `page/`, `chat-relay.mjs`, `restart.mjs`, `test/`), `apps/scout/` (`scout.mjs`, `test/`), root `test/` for the skill test, `scripts/` for setup, `launchd/`, `caddy/` and helpers. No `packages/`, no npm workspaces.
  - 1B — Hard move, no forwarders at the old paths. Each Mac re-runs `scripts/setup-macos.sh` after the pull (and the scout install where the scout is set up); the release note says so, and `docs/plans-dashboard.md` says when to re-run setup.
  - 2A — A `test/` folder in each app, plus a root `test/` for the skill test (a test inside `skills/` would be installed into `~/.claude/skills/`).
  - `artifact-copies.mjs` and `page-versions.mjs` stay in `scripts/`: the global `CLAUDE.md` runs `scripts/artifact-copies.mjs` by path, and `page-versions.mjs` is imported by `scripts/artifact-copies.mjs`, the server and `skills/browser-usability-test/scripts/compare.mjs` (`grep -rn "page-versions.mjs" scripts skills`).
- Open decisions this plan does not take: none. The Mac app (`apps/plans-mac/`) is phase 2 of `.plans/20261122-151056-plans-mac-app-parent.md`, not part of this plan.
- The rule sources must name the new paths before the run starts, so the run's checks (the rule audit of `/skill-4-verify`, `plan-lanes.mjs`) do not flag the new folders: step 0 is an owner step before launch.
- After this plan merges, the session-tabs plan (`.plans/20261122-133231-session-tabs-and-command-palette.md`) needs its paths updated before it runs; that is a planning edit in the owner's session, not a step here.

## Hard rules

- **Restart after dashboard changes.** The plan moves the server and the page. The run does not restart (a worktree run). Its Open items give the owner this order right after merge and `git pull` (until setup runs, the old server still starts new chats and scout runs from paths the pull removed): 1) `pgrep -fl chat-relay.mjs`; 2) only when it shows that the live chats run under the relay (or there are no live chats), run `scripts/setup-macos.sh` with the same `--domain` and `--port` that Mac uses (else the defaults replace them; it writes the new server path into the login service), then `DASH_PORT=<that Mac's port> npm run restart` (setup restarts only when the plist changed, so the restart always follows it; `restart.mjs` checks port 4899 unless `DASH_PORT` says otherwise); 3) never run `npm run restart` before `scripts/setup-macos.sh`: launchd would start the old path, which no longer exists, and the dashboard would not come back; 4) on a Mac where the scout is set up (`~/.claude/scout.json` exists), run `node apps/scout/scout.mjs --install`. Running relays keep working: they are separate processes, and the new server connects to their sockets as after any restart.
- **No npm dependencies.** Only moves and path changes; no package, no workspace.
- **Public repo: no private data.** Paths are repo-relative or built from `import.meta.url`; no home paths are added.
- **Global rules affect every project.** The root `CLAUDE.md` is not changed: it names only `scripts/artifact-copies.mjs`, which stays. `skills/` changes only in comments and docs of `bootstrap-project` (the dashboard path), no behavior.
- **Never stop processes by name.** The tests start and stop their servers as today, by PID.
- **Tests for logic changes.** The changed path logic (`DASH_REPO`, `SCOUT_SCRIPT`, the scout's launchd template path, the docs-media copy) gets tests in `apps/dashboard/test/` and `apps/scout/test/` (see **Tests**). All existing tests move and must still pass.
- **Docs: current state only.** The docs describe the new paths in the present tense; the one-time "re-run setup after this pull" note goes into the release note and a short "Moved in this version" line is not added to the docs.

## Contracts

None. No endpoint, no `/api/state` field and no page code changes. The script paths that other repos see stay the same: `scripts/artifact-copies.mjs` (global `CLAUDE.md`) and `scripts/launcher-template.sh` (the server tells repos to copy it).

## Reference implementation

- Closest existing pattern: commit `72691e7` "refactor(plans-dashboard): move the page HTML, CSS and JS into their own files", which moved the page out of `scripts/plans-dashboard.mjs` into `scripts/plans-dashboard/` and made the server find it with `new URL('./plans-dashboard/', import.meta.url)` (`UI_DIR`).
- Files read end to end for this plan: `package.json`; in `scripts/plans-dashboard.mjs` the imports, `DASH_REPO`, `BOOTSTRAP_SKILL`, `SCOUT_SCRIPT`, `CHAT_RELAY`, `UI_DIR`, `PAGE` and the scout state (`script:`, `example:`, `docs:`); `scripts/scout.mjs` (header, imports, `install()`, the main-module check); `scripts/setup-macos.sh` (the login agent step); `scripts/setup.sh`; `scripts/restart-dashboard.mjs`; `scripts/docs-media.mjs` (`newHome()`); the two launchd templates; the heads of the three test files (imports, `SCRIPT`, `SKILL`).
- Mirror: `new URL('./plans-dashboard/', import.meta.url)` → `new URL('./page/', import.meta.url)`; `new URL('..', import.meta.url)` (`DASH_REPO`) → `new URL('../..', import.meta.url)`; `path.join(DASH_REPO, 'scripts', 'scout.mjs')` → `path.join(DASH_REPO, 'apps', 'scout', 'scout.mjs')`.
- Deviations: none. The run uses `git mv`, as the run's allow list permits; its one commit records the moves as renames.

## Affected files

- `scripts/plans-dashboard.mjs` → `apps/dashboard/server.mjs` — moved, modified: `DASH_REPO` two folders up; `UI_DIR` → `./page/`; imports `../../scripts/artifact-copies.mjs` and `../../scripts/page-versions.mjs`; `SCOUT_SCRIPT` → `apps/scout/scout.mjs`; the header usage line and the comments that name the old paths.
- `scripts/plans-dashboard/` (`page.html`, `app.js`, `app.css`) → `apps/dashboard/page/` — moved; `app.js` modified: the "Found by the scout (scripts/scout.mjs)" status hint names `apps/scout/scout.mjs`.
- `scripts/chat-relay.mjs` → `apps/dashboard/chat-relay.mjs` — moved, no change.
- `scripts/restart-dashboard.mjs` → `apps/dashboard/restart.mjs` — moved, modified: the header comment.
- `scripts/scout.mjs` → `apps/scout/scout.mjs` — moved, modified: new `export const plistTemplate = () => …` gives the template path in `../../scripts/launchd/`, and `install()` reads it; the header usage lines.
- `scripts/test/plans-dashboard.test.mjs` → `apps/dashboard/test/dashboard.test.mjs` — moved, modified: `SCRIPT` → `../server.mjs`; import `../../../scripts/page-versions.mjs`; the header comment; new tests (see **Tests**).
- `scripts/test/scout.test.mjs` → `apps/scout/test/scout.test.mjs` — moved, modified: the header comment; a new test (see **Tests**).
- `scripts/test/bootstrap-project.test.mjs` → `test/bootstrap-project.test.mjs` — moved, modified: `SKILL` → `../skills/bootstrap-project`.
- `test/old-paths.test.mjs` — new: fails on any old path left in the tracked files (see **Tests**).
- `package.json` — modified: `"restart": "node apps/dashboard/restart.mjs"`, `"test": "node --test apps/*/test/*.test.mjs test/*.test.mjs"` (no quotes: the shell that npm runs expands the file list, so it also works on Node 18, which does not expand globs itself).
- `scripts/setup-macos.sh` — modified: `__SCRIPT__` → the absolute `apps/dashboard/server.mjs` (from `$HERE/..`).
- `scripts/setup.sh` — modified: the scout install calls `apps/scout/scout.mjs`; the label and the "To try the dashboard" line name `apps/dashboard/server.mjs`.
- `scripts/launchd/com.plans-dashboard.plist.template`, `scripts/launchd/com.plans-dashboard.scout.plist.template` — modified: the comments that name the script paths.
- `scripts/docs-media.mjs` — modified: new `export function copyDashboard(dest)` copies `apps/`, `scripts/`, `skills/` and `docs/` (not the test folders, not `node_modules/`) into the throwaway repo, `newHome()` calls it and starts `apps/dashboard/server.mjs`; the run-only parts sit behind `IS_MAIN`.
- `README.md`, `docs/plans-dashboard.md`, `docs/add-project.md`, `docs/scout.md`, `docs/roadmap.md` — modified: the new paths; the roadmap Architecture names `apps/` and the entry "Move the apps out of `scripts/`" says "built".
- `skills/bootstrap-project/references/contracts.md`, `skills/bootstrap-project/references/checklist.md`, `skills/bootstrap-project/scripts/verify.mjs` — modified: comments and docs that name `scripts/plans-dashboard.mjs`.
- `changelog.d/<entry>.yml` — new: the release note, with the order from **Hard rules** → Restart (pgrep, setup, restart, the scout install only where the scout is set up).
- `.claude/bootstrap.json`, `AGENTS.md`, `.claude/scripts/plan-lanes.mjs`, `.claude/agents/plan-validator.md`, `.claude/skills/skill-1-plan/SKILL.md`, `.claude/skills/skill-3-test/SKILL.md`, `.claude/skills/skill-4-verify/SKILL.md`, `.codex/skills/validate-plan/SKILL.md`, `.codex/skills/validate-implementation/SKILL.md` — modified (owner, by hand, step 0, before launch): the hard-rule text, the layout folders and the commands come from `bootstrap.json` and are rendered.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `apps/dashboard/server.mjs` | the file | — (an entry script) | the login service plist (`__SCRIPT__`), `scripts/setup.sh`, `scripts/docs-media.mjs`, the dashboard test (`SCRIPT`) | `scripts/setup-macos.sh` writes the plist |
| `apps/dashboard/page/` | the folder | — | `server.mjs` (`UI_DIR`) | — |
| `apps/dashboard/chat-relay.mjs` | the file | — | `server.mjs` (`CHAT_RELAY`, next to it) | — |
| `apps/scout/scout.mjs` | the file | its named exports (as today) | `server.mjs` (`SCOUT_SCRIPT`), the scout test, the scout plist | `node apps/scout/scout.mjs --install` writes the plist |
| `scripts/artifact-copies.mjs`, `scripts/page-versions.mjs` | unchanged | unchanged | `server.mjs` through `../../scripts/…` | — |
| `apps/dashboard/restart.mjs` | the file | — | `package.json` `restart` | — |
| `plistTemplate()` | `apps/scout/scout.mjs` | named export | `install()` in the same file, the scout test | — |
| `copyDashboard(dest)` | `scripts/docs-media.mjs` | named export | `newHome()` in the same file, the dashboard test (dynamic import) | — |

## Breaking changes

- The installed login services on each Mac point at `scripts/plans-dashboard.mjs` and `scripts/scout.mjs`, which no longer exist after the pull. Fix (owner decision 1B): on each Mac, follow the order in **Hard rules** → Restart (the scout install only where `~/.claude/scout.json` exists). The release note says it; `docs/plans-dashboard.md` → "Install it to run at login" says when to re-run setup.
- Anyone who runs `node scripts/plans-dashboard.mjs` by hand: the command is now `node apps/dashboard/server.mjs` (README, docs).
- Other repos: none. They use `scripts/launcher-template.sh` and `scripts/artifact-copies.mjs`, which stay.
- The browser-usability-test profile notes (`~/.claude/browser-usability-test/projects/plans-dashboard/notes.md`, outside the repo) name `scripts/plans-dashboard.mjs`; the run lists it under Open items for the owner.

## Steps

0. (owner, by hand, before launch) Commit or discard the uncommitted edit to `scripts/plans-dashboard/app.js` in the main checkout, so the merge does not carry it across the rename. From here to the merge, change no dashboard or scout file in the main checkout (the rules already name the new paths). In `.claude/bootstrap.json`: hard rule 1 `rule` and `check` (`apps/dashboard/server.mjs`, `apps/dashboard/page/`), the rule "Tests for logic changes" `rule`, `check` and `tests` (logic in `apps/`, `scripts/` or `skills/*/scripts/` gets a test in the app's `test/` folder or the root `test/`, run with `npm test`), `layout.folders` (`apps/dashboard/`, `apps/dashboard/page/`, `apps/scout/`, `test/`, `scripts/` as "Setup, service templates and helper scripts", and keep `skills/` and `docs/`) and `stack.extraCommands` (the test dashboard: `node apps/dashboard/server.mjs`); search the file afterwards for `scripts/plans-dashboard`, `scripts/test` and `scripts/scout` and change every hit. Then `node ~/.claude/skills/bootstrap-project/scripts/render.mjs . --upgrade`, apply the changed files (`AGENTS.md`, `.claude/scripts/plan-lanes.mjs`, the skills), and push them with this plan, `docs/roadmap.md` (the run's step 11 edits its entry) and the parent-plan edits. A headless run cannot write `.claude/`.
1. `mkdir -p apps/dashboard/test apps/scout/test test`, then `git mv scripts/plans-dashboard.mjs apps/dashboard/server.mjs`, `git mv scripts/plans-dashboard apps/dashboard/page`, `git mv scripts/chat-relay.mjs apps/dashboard/chat-relay.mjs`, `git mv scripts/restart-dashboard.mjs apps/dashboard/restart.mjs`, `git mv scripts/scout.mjs apps/scout/scout.mjs`, `git mv scripts/test/plans-dashboard.test.mjs apps/dashboard/test/dashboard.test.mjs`, `git mv scripts/test/scout.test.mjs apps/scout/test/scout.test.mjs`, `git mv scripts/test/bootstrap-project.test.mjs test/bootstrap-project.test.mjs`. One command per call (`git mv*` and `mkdir*` are in the run's allow list, `.claude/scripts/auto-pipeline.sh`; plain `mv` is not). The empty `scripts/test/` goes with the last move.
1b. Write `test/old-paths.test.mjs` as in **Tests** (it fails until step 12 is done).
2. `apps/dashboard/server.mjs`: `DASH_REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')`; `UI_DIR = fileURLToPath(new URL('./page/', import.meta.url))` and its comment ("The browser page lives in page/"); the imports `from '../../scripts/artifact-copies.mjs'` and `from '../../scripts/page-versions.mjs'`; `SCOUT_SCRIPT = path.join(DASH_REPO, 'apps', 'scout', 'scout.mjs')`; the header line `node ~/Workspace/claude-config/apps/dashboard/server.mjs`, the comments that say `pipeline-projects.example.json` is "next to this file" (it stays in `scripts/`: say `scripts/pipeline-projects.example.json`), the `--help` usage text (`node server.mjs`), and the comments that name `scripts/chat-relay.mjs` and `scripts/scout.mjs` (the comments that name `scripts/page-versions.mjs` and `scripts/artifact-copies.mjs` stay: those files stay). The `--help` text line "see pipeline-projects.example.json next to this script" names `scripts/pipeline-projects.example.json`. `CHAT_RELAY` stays `./chat-relay.mjs` (it moves with the server).
3. `apps/dashboard/page/app.js`: the "Proposed" status hint names `apps/scout/scout.mjs`.
4. `apps/scout/scout.mjs`: add `export const plistTemplate = () => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'launchd', 'com.plans-dashboard.scout.plist.template')`, and make `install()` read `readFileSync(plistTemplate(), 'utf8')` in place of its own `path.join(here, 'launchd', …)` (the `label` constant stays for the plist name; remove the `here` constant, which has no use after that); the header usage lines say `node apps/scout/scout.mjs …`; the "Copy scripts/scout.example.json" message stays (that file stays).
5. `apps/dashboard/restart.mjs`: the header comment (`node apps/dashboard/restart.mjs`, chats under `apps/dashboard/chat-relay.mjs`).
6. `package.json`: `restart` and `test` as in **Affected files**.
7. The three test files: `SCRIPT` and imports as in **Affected files**; the header comments name `npm test` (the dashboard test's first line "Smoke tests for plans-dashboard.mjs" names `apps/dashboard/server.mjs`); the dashboard test's comment "chats outlive the server on purpose (scripts/chat-relay.mjs)" names `apps/dashboard/chat-relay.mjs`.
8. `scripts/setup-macos.sh`: set `REPO="$(cd "$HERE/.." && pwd)"` next to `HERE`, and `-e "s|__SCRIPT__|$REPO/apps/dashboard/server.mjs|"`. `scripts/setup.sh`: `node "$REPO/apps/scout/scout.mjs" --install` (with the same `REPO` line), the label "run node apps/dashboard/server.mjs instead" and the "To try the dashboard" line.
9. `scripts/launchd/*.plist.template`: the comments name `apps/dashboard/server.mjs` and `apps/scout/scout.mjs`.
10. `scripts/docs-media.mjs`, `newHome()`: replace the copy of `scripts/plans-dashboard.mjs` with `cpSync` of `apps/` and `scripts/` into `dash`, each with a filter that skips any `test` folder directly under an app or `scripts/` (compare the exact paths, `path.join(REPO, 'apps', <app>, 'test')`, `path.join(REPO, 'scripts', 'test')`), and return `script: path.join(dash, 'apps/dashboard/server.mjs')`. Move this copy into `export function copyDashboard(dest)`, The copy of `docs/` that `newHome()` makes today moves into `copyDashboard` (the copied server reads `docs/plans-dashboard.md` and `docs/scout.md`). Copy `skills/` too (without any `node_modules/` folder, for example the one `npm install --prefix skills/browser-usability-test` makes), so the copy's bootstrap status checks find `skills/bootstrap-project` (`BOOTSTRAP_SKILL`). Put the file's run-only parts behind `const IS_MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;` (the check `scripts/scout.mjs` uses; add `pathToFileURL` to the `node:url` import): the two top-level `process.exit(1)` checks (Chrome, `WebSocket`), the `process.on('exit', …)` cleanup handler, and the run at the end of the file, so a test can import `copyDashboard`.
11. Docs: `README.md`, `docs/plans-dashboard.md` (Quick reference, Start it, After editing the dashboard code, the summary prompt line, Tests), `docs/add-project.md`, `docs/scout.md`: the new paths. `docs/plans-dashboard.md` → "Install it to run at login": change "Re-run it only to change the domain or port, or after switching Node versions with nvm (the agent stores Node's full path)." to "Re-run it to change the domain or port, after switching Node versions with nvm (the agent stores Node's full path), or when the login service does not start after a `git pull` or a move of the repo (the agent stores the server's full path)." `docs/roadmap.md`: Architecture names `apps/dashboard/server.mjs`, `apps/dashboard/page/`, `apps/dashboard/chat-relay.mjs` and `apps/scout/scout.mjs`; rewrite the entry "Move the apps out of `scripts/`" in the present tense with the new paths only (the apps live in `apps/`, built, with a link to this plan), so no old path is left.
12. `skills/bootstrap-project/references/contracts.md`, `references/checklist.md`, `scripts/verify.mjs`: every mention of the dashboard file, with or without `scripts/` (`plans-dashboard.mjs`, for example in the `contracts.md` table and the `verify.mjs` comments on `pipelineModes` and `lanesFixPrompt`), names `apps/dashboard/server.mjs`.
13. Run `/changelog-entry` for the release note in `changelog.d/`, with the order from **Hard rules** → Restart in `summary` (the scout install only where the scout is set up).
14. (owner, right after merge and `git pull`) The order in **Hard rules** → Restart: `pgrep -fl chat-relay.mjs`; when the live chats run under the relay, `scripts/setup-macos.sh` (with that Mac's `--domain` and `--port`), then `DASH_PORT=<that port> npm run restart`; then `node apps/scout/scout.mjs --install` only where `~/.claude/scout.json` exists. Update `~/.claude/browser-usability-test/projects/plans-dashboard/notes.md` (outside the repo) to `apps/dashboard/server.mjs`.

## Tests

### Unit tests

- `apps/dashboard/test/dashboard.test.mjs`, new: `GET /api/scout` gives `script` ending in `apps/scout/scout.mjs` and `docs` ending in `docs/scout.md`, and both files exist (after `~` expansion). This fails when `DASH_REPO` is one folder off.
- `apps/dashboard/test/dashboard.test.mjs`: the existing tests pass from the new place; "a repo without bootstrap.json shows needs bootstrap" proves `BOOTSTRAP_SKILL` (`DASH_REPO/skills/bootstrap-project`) and the page tests prove `UI_DIR`.
- `apps/scout/test/scout.test.mjs`, new: the template path that `install()` reads exists. Make the path a small exported function `plistTemplate()` in `scout.mjs` that `install()` calls, and assert `existsSync(plistTemplate())` (no launchd call in the test).
- `apps/dashboard/test/dashboard.test.mjs`, new: set `process.env.CHROME = '/nonexistent'`, then `const { copyDashboard } = await import('../../../scripts/docs-media.mjs')` (a dynamic import, so it runs after the variable is set and fails without the `IS_MAIN` guard); copy into `<tmp>/Workspace/claude-config`, as `newHome()` does; the copy has `apps/dashboard/server.mjs`, `apps/dashboard/page/app.js`, `apps/dashboard/chat-relay.mjs`, `scripts/artifact-copies.mjs`, `scripts/page-versions.mjs` and no `apps/*/test/`; start the copied server with a throwaway `HOME`, a temp `CLAUDE_TMP`, a free `DASH_PORT` and `QA_REPORTS_PORT` (never 4899 / 4898), `DASH_NO_OPEN=1` and `DASH_NO_SUMMARY=1`; `GET /` answers 200; stop it by its PID, and delete the temp folder in a `finally` (the copy holds `docs/`, about 7.7 MB).
- `test/old-paths.test.mjs`, new: `git ls-files --cached --others --exclude-standard` (run with `execFileSync` and `cwd` set to the repo root, so a git error fails the test) lists the tracked and new not-ignored files outside `.plans/` and `changelog.d/`, without the test file itself (it holds the patterns); a file that has a NUL byte in its first 8 KB is binary and is skipped (the PNGs and the video in `docs/`); the test reads each text file and fails with `<file>:<line>` for every match of `scripts/plans-dashboard`, `scripts/scout.mjs`, `scripts/chat-relay`, `scripts/test/`, `restart-dashboard` or the bare word `plans-dashboard.mjs`. It fails today (the old paths are everywhere) and passes only when every reference moved.
- `npm test` runs all four test files from their new places (the `test` glob in `package.json`).

### End-to-end tests

None: no endpoint changes.

### Harness constraints

`npm test` cannot run `scripts/setup-macos.sh` (it changes the real login service) or `launchctl`. Those are owner checks after merge, in the order of **Hard rules** → Restart: after `scripts/setup-macos.sh`, `launchctl print gui/$(id -u)/com.plans-dashboard` shows `apps/dashboard/server.mjs`, https://plans.test answers, and a chat that was live before the move shows its history and answers a new message (the relay reconnect).

## Browser test

- Routes: `/` and `/?view=board` on a test instance started from the worktree (`DASH_PORT=4913 DASH_NO_OPEN=1 node apps/dashboard/server.mjs` with a throwaway `HOME`, as the profile notes say).
- Siblings: the Scout drawer (🔭 Scout), which shows the script and docs paths.
- Account and data: no login; the profile notes' throwaway `HOME` with one fake repo and one plan; block `POST /api/launch*` and `/api/registry`.
- What to compare: the old page on http://127.0.0.1:4899 and the new instance look the same (sidebar, plan, board); the Scout drawer shows `apps/scout/scout.mjs` where the old one shows `scripts/scout.mjs`.

## How to verify

```bash
npm test
node --test apps/dashboard/test/dashboard.test.mjs
node --test apps/scout/test/scout.test.mjs
node --test test/bootstrap-project.test.mjs
node --test test/old-paths.test.mjs
node .claude/scripts/changelog-validate.mjs --base origin/main
```

`test/old-paths.test.mjs` fails with the file and line of each reference to an old path that is left.
