# Plan: Event watcher and `Waits for:` plans

- **Base**: main
- **Parent**: `.plans/20261123-100855-orchestrator-parent.md`

## Goal

The dashboard server notices GitHub and run changes by itself, every minute, with no page open. It records them as events, starts a plan when the plan's `- **Waits for**:` condition becomes true, pulls the main checkout after a merge done on GitHub, and sends a macOS notification when something needs the owner. This is phase 1 of the orchestrator parent plan ("Event watcher and merge follow-ups"). The owner can try it alone: a frontend plan with `- **Waits for**: <backend project> PR #271 merged` starts by itself about one minute after PR #271 merges.

## Context

- Parent plan sections: Goal, Findings ("What the dashboard does not have"), Proposed design items 1 and 2, Phases → 1, Decisions taken by the owner.
- Decisions taken for this plan (owner, 2026-11-23):
  - 1A — the watcher is a timer inside the dashboard server, not a separate login job.
  - 2C — no automatic worktree cleanup after a merge. Worktrees stay until the owner clicks "Clean up run" (the owner keeps VS Code and agents in them after the merge).
  - 3A — `GET /api/events` has the same access as every other `/api/*` route.
  - Parent plan: a `Waits for:` line counts as the owner's "go" (the conductor acts for the owner); at most 4 runs at the same time per project (Q6); only PR merges stay with the owner, so an auto-start uses the project's "to PR" mode (mode id `pr`, the template's `--to-pr`) when the project has it, else the project's default mode.
- Open decisions this plan does not take: Q5 placement of the priority columns (phase 3), the "upstream submodule moved past the pin" event (phase 5), which events the Mac app rings (Mac app phase 2; this plan only adds server-side notifications).
- Order: this plan runs after `.plans/20261122-152506-move-apps-out-of-scripts.md` is merged (owner decision 2026-11-22: the move runs first). All paths below are the paths after the move. Step 0 checks it. Validation round 1 checked the post-move paths against the move plan; check them again if the move plan changes before it merges.

## Hard rules

- **Restart after dashboard changes.** The plan changes `apps/dashboard/server.mjs` and `apps/dashboard/page/app.js`, and the server now imports `apps/scout/scout.mjs`, so a scout change also needs the restart check from now on. The run is a worktree run and does not restart; its report lists under Open items: after merge and `git pull`, run `pgrep -fl chat-relay.mjs`, and `npm run restart` only when it shows the live chats run under the relay. The automatic pull after a merge (step 6) never pulls the dashboard's own repo (`DASH_REPO`): for that repo the `pr-merged` event says "Not pulled: this is the dashboard's own repo. Pull and restart by hand (AGENTS.md)", so the relay check and the restart stay with the owner as the rule says.
- **No npm dependencies.** The new module `apps/dashboard/watch.mjs` has no imports; the server uses `node:child_process` and `node:fs` as today. The notifier is the optional `terminal-notifier` binary the scout already uses, else `osascript`.
- **Public repo: no private data.** Examples in docs, tests and templates use made-up names (`api`, `web`, PR #7, `contracts`). No client names, no home paths.
- **Global rules affect every project.** Two template files change one generic sentence each (the "go" rule names the `Waits for:` line): `skills/bootstrap-project/templates/core/AGENTS.md.tmpl` and `skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md`. Nothing else in `skills/` or the root `CLAUDE.md` changes.
- **Never stop processes by name.** The new tests stop their own server with `child.kill()` on the handle they spawned (the `stop()` pattern of the dashboard test). The watcher never stops processes.
- **Tests for logic changes.** New unit tests `apps/dashboard/test/watch.test.mjs` and end-to-end tests `apps/dashboard/test/watcher.test.mjs` (see **Tests**); both run with `npm test`.
- **Docs: current state only.** `docs/plans-dashboard.md` gets a section that describes the watcher and the `Waits for:` line as they are, in ASD-STE100, one line per paragraph.

## Endpoint access

| Endpoint | Method | Access |
| --- | --- | --- |
| `/api/events?project=<name>&limit=<n>` | GET | The same as every `/api/*` route (owner answer 3A): local host names only, cross-site requests refused by `crossSiteReason`, no login, no rate limit. Read only. |

## Contracts

- New: `GET /api/events` → `{ events: [ { at, project, type, ...fields } ] }`, oldest first, at most `limit` (default 200, max 1000). Event types:
  - `pr-opened`, `pr-closed` (`number`, `title`, `url`, `branch`); `pr-merged` (the same, plus `pull`: the `pullRoot` text);
  - `run-outcome` (`slug`, `outcome`, `status`, `previous`);
  - `wait-met` (`slug`, `conditions`); `wait-error` (`slug`, `text`, `reason`);
  - `auto-launch` (`slug`, `mode`); `auto-launch-failed` (`slug`, `output`).
  - 400 `{ error: 'bad project' }` for an unknown or unsafe project name.
- Changed: each plan object in `GET /api/state` gets `reportAt` (the run report's mtime in ms, or `null`) and `waits`: `null` (no `Waits for:` line in the header) or `[ { text, met, error } ]` from the last watcher tick (`error` is a short reason or `null`). Consumers: `apps/dashboard/page/app.js` (`autoChips`, used by the sidebar rows and `boardCard`). Additive.
- New plan line (a plan-file convention, documented in `docs/plans-dashboard.md`): one or more `- **Waits for**: <condition>` lines in the plan header (the lines before the first `## ` heading, outside fenced code); all must be true. Conditions:
  - `<project> PR #<n> merged` — `<project>` is a registry `name`, else a `short` that exactly one project has.
  - `<project> plan <slug> merged` — the newest PR on `auto/<slug>` (or on the branch that plan's `- **Branch**:` line names) is merged.
  - `submodule <path> contains <sha>` — the submodule pointer at `<path>` on `origin/<base>` of this plan's own project (base = the plan's `- **Base**:` line) has `<sha>` (7–40 hex) as an ancestor.
- `<CENTRAL>/state/<project>/watch.json`: `{ prs, outcomes, launched, met, errors, since, checkedAt }` — `since` the ISO time the watcher first saw the project; `checkedAt` the start time of the last tick that read the PR list; `prs` `{ [number]: { state } }` (every PR seen); `outcomes` `{ [slug]: { outcome, status } }`; `launched` `{ [slug]: { at, mode, state: 'pending' | 'started' | 'failed' } }`; `met` `{ [slug]: true }`; `errors` `{ [slug + '\n' + text]: { reason, fix } }`.
- Delivery: events are at-most-once. A crash between the state save and the event write loses those events (the docs say so); it never repeats an event or a launch.

## Reference implementation

- Closest existing patterns:
  - The PR cache and refresh: `apps/dashboard/server.mjs` → `refreshPrList()`, `prsFor()`, `PR_TTL`, `prLists`, `gh()`.
  - Plan header lines: `planBranch()` (the `- **Branch**:` regex) and `planBranches`.
  - Launch: `launchPipeline()` → `runLauncher()`, `modeFlag()`, `pipelineModes()`, the in-memory `launches` map.
  - Pull after merge: `runPrAction()` (`merge` branch) → `pullRoot()`.
  - Lock of a single process: `SCOUT_LOCK` and `scoutRunning()` (a JSON file with a `pid`, checked with `process.kill(pid, 0)`).
  - Mac notification: `apps/scout/scout.mjs` → `notify()`, `NOTIFIERS`, `dashUrl()`, `SCOUT_NO_NOTIFY`; atomic JSON write: the scout's `saveJson()` (`renameSync`).
  - A helper module that the server imports: `scripts/page-versions.mjs`.
  - End-to-end test harness: `apps/dashboard/test/dashboard.test.mjs` → `FAKE_GH`, `start()`, `stop()`, `pipeRepo()`, `report()`, and the test "merge runs gh pr merge on the reviewed commit, deletes the remote branch, then pulls the main checkout" (its local origin + clone setup).
- Files read end to end for this plan: `scripts/plans-dashboard.mjs` (pre-move name of `apps/dashboard/server.mjs`): header and imports, `resolveProject`, `pipelineModes`, `DEFAULT_MODES`, `planBranch`, `ownBranch`, `outcomeOf`, `parseReport`, `pipelineRunInfo`, `pipelineLive`, `worktreeOf`, `listPlans`, `fullState`, `runLauncher`, `launchPipeline`, `modeFlag`, `cleanup`, `SCOUT_LOCK`, `scoutRunning`, `gh`, `PR_JQ`, `listPrs`, `refreshPrList`, `prsFor`, `gitIn`, `pullRoot`, `prAction`, `runPrAction`, the request handler head (access checks, `getProj`, `/api/state`, `/api/launch`, `/api/report`) and the `server.listen` callback; `scripts/scout.mjs` → `dashUrl`, `NOTIFIERS`, `notify`, `saveJson`; `scripts/test/plans-dashboard.test.mjs` (pre-move `apps/dashboard/test/dashboard.test.mjs`): `FAKE_GH`, `start`, `stop`, `before`, `after`, `pipeRepo`, `report`, the launch tests and the merge test; `scripts/plans-dashboard/app.js` → `autoChips`, `chatChip`, `boardCard`, `readUrl`, `escA`; `docs/plans-dashboard.md` sections "How a plan gets launched", "Alerts", "Running several plans at once", "Environment"; `changelog.d/README.md`; the template `auto-pipeline.sh` `--describe` case (mode ids `verify`, `commit`, `pr`).
- Mirror:
  - `planBranch(content)` → `planBase(content)` (same regex shape, `Base`) and `parseWaitsFor(content)` in `watch.mjs` (header only).
  - `prsFor(proj)` / `refreshPrList(proj)` → `watchTick()` awaits `refreshPrList(proj)` for every project first, then reads `prLists[proj.root].allByBranch`.
  - Scout `notify(text, query)` → server `notifyMac(title, text, query)`, with `DASH_NO_NOTIFY` in place of `SCOUT_NO_NOTIFY`.
  - `SCOUT_LOCK` → `WATCH_LOCK` (`<CENTRAL>/watcher.lock`).
  - Scout `saveJson()` → `saveWatch()` (temp file + `renameSync`).
  - `scripts/page-versions.mjs` → `apps/dashboard/watch.mjs` (pure functions the server imports).
- Deviations:
  - A new test file `apps/dashboard/test/watcher.test.mjs` with its own server, not new cases in `dashboard.test.mjs` — the shared server there runs with the watcher off (`DASH_WATCH_MS=0`), because a ticking watcher adds `gh` calls that the merge test counts.
  - `watch.mjs` has its own `redact()`; the scout's exported `redact()` (`apps/scout/scout.mjs`) is built for its own log and proposal text, and importing more of the scout into the server would tie the two apps closer than the one `NOTIFIERS` import.
  - `DASH_NOTIFIER` (an optional notifier path) — the scout has no such override; the test needs it to prove that a notification is sent and what it opens.
  - A `pr` wait reads the single PR with `gh api repos/{owner}/{repo}/pulls/<n>` (one call per waiting condition per tick, only while the plan has not started) instead of the cached list: the list keeps only the newest 200 PRs and one PR per branch.
  - PR events read their own list, sorted by update time (`pulls?state=all&sort=updated&direction=desc&per_page=100`), not the page's cache (sorted by creation, one PR per branch): a merge of an old PR, or of an older PR on a reused branch, is then seen, because a merge updates the PR.
  - The `plan … merged` condition reads the other plan's `- **Branch**:` line from its file, not the `planBranches` cache (that cache is filled only by `listPlans()` and depends on the project order).

## Affected files

- `apps/dashboard/watch.mjs` — new: `parseWaitsFor()`, `prMap()`, `prEvents()`, `outcomeEvents()`, `runningCount()`, `canAutoLaunch()`, `capLines()`, `redact()`; pure functions, no imports.
- `apps/dashboard/server.mjs` — modified: imports from `./watch.mjs` and `NOTIFIERS` from `../scout/scout.mjs`; `planBase()`; the watcher section (`WATCH_MS`, `WATCH_LIMIT`, `WATCH_LOCK`, `STALE_RUN_MS`, `WATCH_PR_JQ`, `takeLock()`, `holdsLock()`, `watchFile()`, `eventsFile()`, `loadWatch()`, `saveWatch()`, `addEvents()`, `notifyMac()`, `waitStatus` map, `findProject()`, `checkCondition()`, `autoMode()`, `watchProject()`, `watchTick()`, `startWatcher()`); `listPlans()` adds `waits` and `reportAt`; `runPrAction()` (merge branch) adds to `buttonMerged`; `launchedNow` map; the `/api/events` route; `startWatcher()` in the `server.listen` callback.
- `apps/dashboard/page/app.js` — modified: `autoChips()` shows a `⏳ waits` chip with the conditions in its title.
- `apps/dashboard/test/watch.test.mjs` — new: unit tests of `watch.mjs`.
- `apps/dashboard/test/watcher.test.mjs` — new: end-to-end tests of the watcher.
- `apps/dashboard/test/dashboard.test.mjs` — modified: `start()` passes `DASH_WATCH_MS: '0'` and `DASH_NO_NOTIFY: '1'`.
- `scripts/docs-media.mjs` — modified: the throwaway dashboard's env adds `DASH_WATCH_MS: '0'` and `DASH_NO_NOTIFY: '1'`.
- `docs/plans-dashboard.md` — modified: new section "## Waits for and the event watcher" after "## Running several plans at once"; lines in "## Alerts"; rows `DASH_WATCH_MS`, `DASH_NO_NOTIFY`, `DASH_NOTIFIER` in "## Environment".
- `AGENTS.md` — modified: the "Plans" rule "Every plan starts only after an explicit "go" from the owner." names the `Waits for:` line.
- `skills/bootstrap-project/templates/core/AGENTS.md.tmpl` — modified: the same sentence.
- `skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md` — modified: "The work starts only after the owner's explicit "go"" names the `Waits for:` line.
- `docs/roadmap.md` — modified: the Orchestrator entry says phase 1 is done.
- `changelog.d/20261123-event-watcher.yaml` — new: the release note.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `watch.mjs` functions | `apps/dashboard/watch.mjs` | named `export function` each | `apps/dashboard/server.mjs` (`import { … } from './watch.mjs'`), `apps/dashboard/test/watch.test.mjs` | none |
| `NOTIFIERS` | `apps/scout/scout.mjs` (already `export const`) | already exported | `apps/dashboard/server.mjs` (`import { NOTIFIERS } from '../scout/scout.mjs'`); the scout's main code runs only behind its main-module check | none |
| `GET /api/events` | `apps/dashboard/server.mjs` request handler | — | curl, phase 3 | the `if (url.pathname === …)` chain, next to `/api/report` |
| `startWatcher()` | `apps/dashboard/server.mjs` | — | — | called once in the `server.listen` callback, after `chatReattach()` |
| `copyDashboard(dest)` | `scripts/docs-media.mjs` (added by the move plan) | `export function` | `apps/dashboard/test/watcher.test.mjs` (`import { copyDashboard } from '../../../scripts/docs-media.mjs'`) | none |

## Breaking changes

- `GET /api/state` plan objects get the new fields `waits` and `reportAt`. Consumers (`grep -rn "api/state" apps scripts skills` after the move): `apps/dashboard/page/app.js` (reads plan fields), `scripts/docs-media.mjs` and `apps/dashboard/restart.mjs` (readiness probe only), the dashboard test. Additive; nothing breaks.
- The "go" rule in `AGENTS.md` and the two templates: a plan with a `Waits for:` line in its header is not a "skipped go". The plan-validator template ("skips an explicit go") needs no change.
- None else.

## Steps

0. Check that the move plan is merged: `ls apps/dashboard/server.mjs` and `grep -n "export function copyDashboard" scripts/docs-media.mjs`. If one fails, stop the run with BLOCKED ("the move-apps plan is not merged yet").
1. Create `apps/dashboard/watch.mjs`, part 1 (a doc comment per function, ASD-STE100):
   - `parseWaitsFor(content)`: take the lines before the first line that starts with `## `; drop the lines inside ``` fences; match `/^\s*[-*]\s*\*\*Waits for\*\*:\s*(.+?)\s*$/`; strip backticks around the condition. No match → `null`; else one object per line: `{ kind: 'pr', project, number, text }` for `^(\S+) PR #(\d{1,7}) merged$`, `{ kind: 'plan', project, slug, text }` for `^(\S+) plan ([A-Za-z0-9_-][A-Za-z0-9._-]*) merged$` (a slug that contains `..` is `bad`, so it can never leave the plan folder), `{ kind: 'submodule', path, sha, text }` for `^submodule (\S+) contains ([0-9a-f]{7,40})$` (a path with `..`, a leading `/` or a leading `-` is `bad`), else `{ kind: 'bad', text }`.
   - `prMap(rows, prev)` → a copy of `prev` (or `{}`) with each row of the updated-sorted PR list (the `WATCH_PR_JQ` shape: `number`, `state`, `isDraft`, `title`, `url`, `headRefName`, `baseRefName`, `mergedAt`, `createdAt`, `updatedAt`) written over its number as `{ state }` (the event takes the other fields from the row itself). It keeps every number (no cap): one short entry per PR, so a PR that merges long after it was first seen is still known and never makes a second event.
   - `capLines(text, max)` → the last `max` lines of `text`.
   - `redact(text)` → the text with URL query strings (`?…` after `http(s)://…`), `Bearer <x>`, `<name>=<x>` for names that contain `token`, `secret`, `password` or `key`, and tokens that start with `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_` or `sk-` replaced by `[redacted]`, then cut to 500 characters.
2. `apps/dashboard/watch.mjs`, part 2:
   - `prEvents(prev, next, since)`: a number not in `prev` that is `OPEN` and has `createdAt > since` → `pr-opened`; that is `MERGED` and has `mergedAt > since` → `pr-merged` (a comment on a PR merged before the watcher first saw the project makes no event); a number in `prev` whose state changed to `MERGED` → `pr-merged`, to `CLOSED` → `pr-closed`. `prev === null` (first tick) → `[]`. A number that is in `prev` but not in this tick's rows is unchanged. `since` is the time the watcher first saw the project (`watch.json` `since`).
   - `outcomeEvents(prev, next)` → `run-outcome` for each slug whose `outcome` or `status` changed; `prev === null` → `[]`; a slug new in `next` counts as changed from `null`.
   - `runningCount(plans, now, staleMs)` → the number of plans with `live === true`, or `launch && launch.state === 'starting'`, or `run.outcome === 'running'` and `run.status` does not start with `CLEANED` or `unknown` and `now - reportAt < staleMs`. A run that is still working but has an old report counts through `live` (`pipelineLive()` finds its `claude` process), so the age cut-off drops only reports of dead runs.
   - `canAutoLaunch(plan, waits, launched, running, limit)` → `true` only when `waits` (this tick's `[{ met }]`) is non-empty and every `met` is `true`, `launched[slug]` is not set, `plan.run` is `null`, `plan.live` is `false`, `plan.launch` is `null`, `plan.worktree` is `false`, `plan.chatting` is `false`, `plan.chatWaits === 0` (a launch ends the plan's chat: `runLauncher` → `chatEnd`), `plan.status` is not `parked` or `proposed` (the page's board statuses), and `running < limit`.
3. `apps/dashboard/server.mjs`: add `planBase(content)` next to `planBranch()` (regex `^\s*[-*]\s*\*\*Base\*\*:\s*`?([\w./][\w./-]*)`?\s*$`, `m`: a value that starts with `-` does not match, so it never reaches `git fetch` as an option), the imports from `./watch.mjs` and `../scout/scout.mjs`, `appendFileSync` and `linkSync` in the `node:fs` import, and in `listPlans()` the field `reportAt` (the run report's mtime in ms, or `null`) next to `run`.
4. `apps/dashboard/server.mjs`, new section `// ---------- event watcher ----------` after the PR cache section, part 1:
   - `WATCH_MS = process.env.DASH_WATCH_MS == null ? 60000 : +process.env.DASH_WATCH_MS` (0 turns it off), `WATCH_LIMIT = 4` (parent plan Q6), `STALE_RUN_MS = 30 * 60 * 1000`, `WATCH_LOCK = path.join(CENTRAL, 'watcher.lock')`.
   - `watchFile(proj)`, `eventsFile(proj)` (`<stateDir>/events.jsonl`), `loadWatch(proj)` → `loadJson(…, null)` or, for a project with no file, the default `{ prs: null, outcomes: null, launched: {}, met: {}, errors: {}, since: <now ISO>, checkedAt: null }`; `saveWatch(proj, w)` (mkdir, write `watch.json.tmp`, `renameSync`).
   - `WATCH_PR_JQ`: `PR_JQ` plus `createdAt: .created_at, updatedAt: .updated_at`.
   - `addEvents(proj, list)`: append one JSON line per event with `at` (ISO time) and `project`; every text that comes from a command (`ghProblem()`, launcher output, `pullRoot()`) goes through `redact()` first, also in notifications; when the file has more than 5000 lines, rewrite it with `capLines(text, 5000)`.
   - The watcher lock: `takeLock()` first runs `mkdirSync(CENTRAL, { recursive: true })` (a fresh HOME has no such folder), then writes `{ pid, port, startedAt }` to `watcher.lock.<pid>` and then `linkSync()`s it to `WATCH_LOCK` (atomic, and the lock is never empty: `link` fails when the file exists), then removes the temp file. When `WATCH_LOCK` exists, it is stale when its JSON cannot be read and the file is older than 10 s, when its `pid` is not alive, or when `ps -p <pid> -o command=` (`execFileSync`) does not contain `server.mjs` (a reboot can give the old PID to another program). A stale lock is moved away with `renameSync(WATCH_LOCK, WATCH_LOCK + '.stale.' + process.pid)` (only one process can move it; the loser gets ENOENT and stops). The mover then reads the moved file: when its `pid` is not the stale `pid` it judged (another server replaced the lock in between), it puts it back with `linkSync(moved, WATCH_LOCK)` and stops; else it removes the moved file and tries the `linkSync` once more. `holdsLock()` is checked at the start of each tick and again in the synchronous launch block (step 6b.6), so a server that lost the lock during a tick starts nothing. `holdsLock()` = the file's `pid === process.pid`. On exit (`process.on('exit')`) the holder removes the file.
   - `notifyMac(title, text, query)`: off when `DASH_NO_NOTIFY` is set, or when there is no `DASH_NOTIFIER` and `process.platform !== 'darwin'`; uses `process.env.DASH_NOTIFIER` or the first of `NOTIFIERS` that exists (`-title`, `-message`, `-open <dashboard url>/?sel=<encodeURIComponent(project + '/' + slug)>`, `-group`), else `osascript -e 'display notification …'`. `execFile`, errors ignored. The dashboard URL: `https://<host>` from `<CENTRAL>/caddy-site.caddy` as the scout's `dashUrl()` reads it, else `http://127.0.0.1:<PORT>`.
5. `apps/dashboard/server.mjs`, watcher part 2 — conditions:
   - `findProject(ref)` (a condition's project is one word, so a registry `short` with a space can only be matched by its `name`): the project whose `name === ref`; else the projects whose `short === ref` when there is exactly one; else `null` with the reason "unknown project" or "two projects have this short name".
   - `checkCondition(proj, plan, cond, cache)` → `{ met, error }`:
     - `bad` → `error: 'cannot read this condition'`.
     - `pr`: `findProject`; then `gh(other, ['api', 'repos/{owner}/{repo}/pulls/' + number, '--jq', '{merged_at}'])` (cached per project and number for the tick); met when `merged_at` is set; a gh error → not met, `error` = `ghProblem(r.output)` (a failed `gh()` returns `{ ok: false, output }`).
     - `plan`: `findProject`; the branch = `planBranch()` of the other plan's file (`<plansDir>/<slug>.md`, else `<doneDir>/<slug>.md`), else `auto/<slug>`; the newest PR on that branch in `prLists[other.root].allByBranch`; met when `state === 'MERGED'`; a gh error of that project's list this tick → not met, `error`.
     - `submodule`: base = `planBase()` of the plan, else `error: 'no Base line'`; `existsSync(path.join(root, cond.path, '.git'))`, else `error: 'submodule not initialized in the main checkout'`; once per project and base per tick `gitIn(root, ['fetch', '-q', 'origin', base])` (fails → `error: 'cannot fetch origin/<base>'`); pointer from `gitIn(root, ['ls-tree', 'origin/' + base, '--', cond.path])` (`160000 commit <sha>\t<path>`, else `error: 'not a submodule'`); once per submodule per tick `gitIn(path.join(root, cond.path), ['fetch', '-q', 'origin'])` (fails → `error: 'cannot fetch the submodule'`); `gitIn(sub, ['cat-file', '-e', cond.sha + '^{commit}'])` fails → `error: 'commit not found (unknown or ambiguous)'`; then met when `gitIn(sub, ['merge-base', '--is-ancestor', cond.sha, pointer])` is `ok` (exit 1 = not met, no error).
     - An error that a later tick no longer has is removed from `errors`, so it is reported again when it comes back. Errors have a `fix` flag: `true` for the ones the owner must fix (cannot read this condition, unknown project, two projects have this short name, no Base line, not a submodule, submodule not initialized, commit not found, auto-start needs auto-pipeline.sh), `false` for passing ones (gh or fetch failures). Only `fix: true` errors notify.
   - `autoMode(proj)`: `'pr'` when `pipelineModes(proj)` has a mode with id `pr`, else the id of the default mode.
6. `apps/dashboard/server.mjs`, watcher part 3 — `watchProject(proj, saved, cache)`, called per project, first half:
   1. PRs: pages of `gh(proj, ['api', 'repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=<p>', '--jq', WATCH_PR_JQ])`, `JSON.parse(r.out)` in a `try`, page 1, 2, … until a page has fewer than 100 rows, or its last row has `updatedAt` older than `saved.checkedAt` minus 2 minutes (the overlap covers equal times and clock drift), or 10 pages (a long downtime; the docs say that older updates are then not seen). A gh error or bad JSON skips only this part (`next.prs = saved.prs`, `checkedAt` unchanged, so the next tick reads the gap again). Else `next.prs = prMap(rows, saved.prs)`, `next.checkedAt` = the time this tick started; `prEvents(saved.prs, next.prs, saved.since)`; for each `pr-merged`: `pull = await pullRoot(proj, pr.base)` added to the event, except when the repo is the dashboard's own (`realpathSync(proj.root) === realpathSync(DASH_REPO)`, each in a `try`; a failed `realpathSync` counts as "own repo", so the watcher never pulls when it is not sure) (then `pull` = "Not pulled: this is the dashboard's own repo. Pull and restart by hand (AGENTS.md)."). A PR merged with the dashboard button is not pulled again: `runPrAction()` (merge branch) adds `<root>#<number>` to an in-memory set `buttonMerged` before its own `pullRoot()`, and the watcher's event then says "Pulled by the merge button" (no second `git pull` in the same checkout at the same time). A failed pull is not tried again; its text says "Pull by hand", and the existing 📥 Pull button does it.
   2. Plans: `plans = (await listPlans(proj)).filter((p) => !p.archived)`.
   3. Outcomes (pipeline projects): `next.outcomes` from the plans with a `run`; `outcomeEvents(saved.outcomes ?? null, next.outcomes)`.
6b. `watchProject()`, second half:
   4. Launch states: for each `launched[slug]` with `state: 'pending'`: `plan.run` or `plan.live` → `'started'`; `plan.launch.state === 'failed'` → `'failed'`, event `auto-launch-failed` with `plan.launch.output`, notification; pending for more than 10 minutes with no run, no launch and not live (a restart lost the `launches` map) → `'failed'`, event `auto-launch-failed` with "no run started". A record whose plan is no longer active (moved to `done/` or deleted) is removed from `launched`. The `launched` records of all projects are also kept in memory (`launchedNow`, filled from `watch.json` when the server starts and updated each tick), for step 8. There is no automatic retry: the owner (or the conductor) launches the plan again from the page, which starts a new run as today.
   5. Waits, for each active plan with `parseWaitsFor(planText)` that has no `launched[slug]` and no `run` (a started plan is not checked again, so its `pr` conditions cost no more `gh` calls): `waits = [{ text, met, error }]` per condition (step 5); `waitStatus.set(key, waits)`; plans with no `Waits for:` line get `waitStatus.delete(key)`; a new `error` (not in `saved.errors`) → event `wait-error` and stored in `errors`. A generic (non-pipeline) project → each condition gets `met: false` and `error: 'auto-start needs .claude/scripts/auto-pipeline.sh'`, and nothing starts. Every condition with an `error` has `met: false`. All met and `!saved.met[slug]` → event `wait-met`, `met[slug] = true`.
   6. Launch: `running = runningCount(plans, Date.now(), STALE_RUN_MS)`; for each plan with `canAutoLaunch(plan, waits, launched, running + startedThisTick, WATCH_LIMIT)`: first `await pipelineLive(proj, slug)` (must be `false`); then, in one synchronous block with no `await` (Node runs no request handler in between, so `/api/launch` and `/api/chat/send` cannot start anything inside it), check again that `holdsLock()` is true, that `launches.get(key)` is empty, that `chats.get(key)` is not busy and has no open permission question, that the plan file still exists, and that `running` plus the entries of `launches` for this project with `state: 'starting'` that were not counted yet (a manual launch during the `await`) is still below `WATCH_LIMIT`; then `launched[slug] = { at, mode, state: 'pending' }`, `saveWatch()` **before** `launchPipeline(proj, [{ slug, mode: autoMode(proj) }])`, event `auto-launch`, `startedThisTick++`.
   7. `saveWatch()`, then `addEvents()`, then the notifications: `auto-launch` ("Started <slug>"), `auto-launch-failed`, a new `wait-error` with `fix: true` ("<slug> cannot start by itself: <reason>"), `run-outcome` to `needs-you` ("<slug>: <status>", for example "PR OPEN — <url>") or `failed`. This order makes a crash lose an event at most; it never starts a plan twice (the `launched` record is saved before the launch) and never repeats an event (the state is saved before the events are written).
   - A project with no `watch.json` saves the state and makes no PR or outcome events on its first tick (no flood after the update); waits are checked and can start plans on the first tick.
7. `apps/dashboard/server.mjs`, watcher part 4:
   - `watchTick()` (a `watching` flag stops a second tick while one runs): when `!holdsLock() && !takeLock()`, log "another dashboard runs the watcher" once and return (a test dashboard started by hand with the real HOME then runs no second watcher, and takes over on a later tick when the holder exits); then `await Promise.all(allProjects().map(refreshPrList))`, so every project's PR list is fresh before any condition reads it; then `watchProject()` for each project in turn, with one shared `cache` per tick.
   - `startWatcher()`: only when `WATCH_MS > 0`; run `watchTick()` after 2 s and then every `WATCH_MS` (`setInterval`, `unref()`); log errors with `console.log`, never throw. Call it in the `server.listen` callback after `chatReattach()`.
8. `apps/dashboard/server.mjs` → `listPlans()`: active plans parse the header first: `conds = parseWaitsFor(content)`; `conds === null` → `waits: null`; a plan with a `launchedNow` record → `waits: null` (it started, or its auto-start failed and is not retried; the `auto-launch-failed` event says why); else the cached `waitStatus.get(key)` when its texts equal the `text`s of `conds` in order, else `conds.map((c) => ({ text: c.text, met: false, error: null }))`. Archived plans get `waits: null`.
9. `apps/dashboard/server.mjs`: route `GET /api/events` next to `/api/report`: `getProj()` or 400 `{ error: 'bad project' }`; read `eventsFile(proj)` when it exists; parse each line (skip bad lines); return the last `limit`: a missing, non-numeric or smaller-than-1 `limit` gives 200, a larger one than 1000 gives 1000.
10. `apps/dashboard/page/app.js` → `autoChips()`: when `p.waits` is set, not all met, and the plan has no `run`, is not `live` and has no `launch` (a started plan never waits again), add `<span class="chip warn" title="Starts by itself when: …">⏳ waits</span>`; the title lists each condition with ✓ or ✗ and its `error` (escaped with the existing `escA`). The sidebar rows and the board cards (`boardCard`) both show it.
11. `apps/dashboard/test/dashboard.test.mjs` → `start()`: add `DASH_WATCH_MS: '0', DASH_NO_NOTIFY: '1'` to the env. `scripts/docs-media.mjs`: the same two in the throwaway dashboard's env.
12. Write `apps/dashboard/test/watch.test.mjs` (see **Unit tests**).
13. Write `apps/dashboard/test/watcher.test.mjs` (see **End-to-end tests**).
14. `docs/plans-dashboard.md`: the new section "## Waits for and the event watcher": what is checked every minute; the three condition forms with a made-up example; that the line counts only in the plan header; that the line is the owner's go; the 4-run limit and what counts as running; the mode an auto-start uses (`pr` when the project has it); that a busy chat or an open permission question delays the start; that a failed auto-start is not retried; that worktrees are not cleaned up; that the watcher never pulls the dashboard's own repo (pull and restart it by hand, see AGENTS.md); that a failed pull is not tried again (📥 Pull); that a `plan … merged` condition reads the newest PR on the plan's branch from the newest 200 PRs, and a `PR #<n>` condition reads that PR directly; that PR events read at most 10 pages of 100 updated PRs per tick, so after a very long downtime older updates make no event; that events are at-most-once (a crash can lose one, never repeat one); that a `parked` or `proposed` plan never starts by itself; `/api/events` and its event types; one watcher per HOME (`watcher.lock`). In "## Alerts": the server's macOS notifications (needs `terminal-notifier` for a click to open the plan), and that with 🔔 on and the page open, a run outcome gives two notifications. The three Environment rows.
15. `AGENTS.md` and `skills/bootstrap-project/templates/core/AGENTS.md.tmpl`: the rule becomes "Every plan starts only after an explicit "go" from the owner, or when the plans dashboard starts it because the `- **Waits for**:` condition in its header became true (that line is the go). One plan per run." In `skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md`: "The work starts only after the owner's explicit "go", or by itself when the plan has a `- **Waits for**:` line and its condition becomes true."
16. `docs/roadmap.md`: the Orchestrator entry says phase 1 is done (names this plan in `.plans/done/`), phases 2–5 are not written yet.
17. Release note `changelog.d/20261123-event-watcher.yaml` with `/changelog-entry` (`kind: added`, `audience: both`, `scope: dashboard`; `customer.en`: a plan can wait for a PR or a submodule commit and start by itself, and the dashboard notifies you).

Open items for the run report: the restart check (Hard rules); the move plan's copied-server test should pass `DASH_WATCH_MS: '0'` too (a change in that plan's test, not here); the owner applies the skill-1-plan "go" sentence to this repo's own `.claude/skills/skill-1-plan/SKILL.md` by hand (or with `/bootstrap-project --upgrade`), because a headless run cannot write `.claude/`.

## Tests

### Unit tests

`apps/dashboard/test/watch.test.mjs` (`node:test`, imports `../watch.mjs`):

- `parseWaitsFor`: no line → `null`; the three forms (with and without backticks) → the right `kind` and fields; two lines → two conditions; a line inside a ``` block of the header → ignored; a line after `## Goal` → `null`; `submodule ../x contains abc1234`, `submodule -x contains abc1234`, `api plan ../x merged`, `api plan a..b merged` and `api PR #x merged` → `bad`.
- `redact`: `https://x.test/a?token=abc` → no `abc`; `Bearer abc`, `password=abc`, `ghp_abc123`, `github_pat_abc`, `sk-test-0000` → `[redacted]`; plain text unchanged; 2000 characters → 500.
- `prEvents`: `prev === null` → `[]`; new OPEN created after `since` → `pr-opened`; OPEN → MERGED → `pr-merged`; OPEN → CLOSED → `pr-closed`; unchanged → `[]`; new and MERGED after `since` → `pr-merged`; new and MERGED before `since` (an old PR with a new comment) → `[]`, also on a second call with the same rows.
- `outcomeEvents`: `prev === null` → `[]`; `running` → `needs-you` → one event with `previous: 'running'`; the same status twice → `[]`.
- `runningCount`: counts `live` (also with a report older than `staleMs`), `launch.state === 'starting'` and a fresh `running` report; does not count `needs-you`, `failed`, a `CLEANED —` status, `unknown`, or a `running` report older than `staleMs` when the plan is not live.
- `prMap`: writes the rows over `prev` as `{ state }`, keeps numbers that are not in the rows; an old number merged after `since` gives one `pr-merged` on the first call and none on a second call with the same rows.
- `prEvents`: a number in `prev` and missing from the rows → no event.
- `canAutoLaunch`: true only when all conditions hold; false for each single missing condition (one not met, empty waits, already launched, a run report — for example a manual launch before the condition was true, live, launching, a worktree, `chatting`, `chatWaits > 0`, status `parked`, status `proposed`, `running === limit`).
- `capLines`: keeps the last `max` lines.

### End-to-end tests

`apps/dashboard/test/watcher.test.mjs`: its own throwaway HOME and repos, a fake `gh` (the `FAKE_GH` shape) that answers the PR list from `list.json` (the `sort=updated` list from `updated.json` when that file exists) and a single PR (`repos/{owner}/{repo}/pulls/<n>`) from `pr-<n>.json`, per repo (the fake reads the repo from its cwd); a fake `claude` with the `hold` behavior of the dashboard test's `FAKE_CLAUDE` (for the busy-chat case); a fake notifier script (`DASH_NOTIFIER`) that appends its arguments to a file; the server started with the env of the dashboard test's `start()` (`QA_REPORTS_PORT` on a free port, `QA_HOME: ''`, `CLAUDE_TMP` in the temp folder, `DASH_NO_OPEN=1`, `DASH_NO_SUMMARY=1`, `SCOUT_NO_NOTIFY=1`) plus `DASH_WATCH_MS=300`; a helper `until(fn, ms)` that polls `/api/state` or `/api/events`.

- **A merge starts the waiting plan once, in PR mode.** Projects `api` (PR #7 OPEN) and `web` (a pipeline repo whose `auto-pipeline.sh` logs its arguments and answers `--describe` with the modes `verify` and `pr`, like `pipeRepo()`), web plan `waiting.md` with `- **Base**: main` and `- **Waits for**: api PR #7 merged` in its header. Before: `/api/state` shows `waits: [{ text: 'api PR #7 merged', met: false, error: null }]` and the args log is empty. Make PR #7 merged (`pr-7.json` and `list.json`) → within 5 s the args log has one line with `--to-pr` and `waiting.md`; `/api/events?project=api` has `pr-merged` #7; `/api/events?project=web` has `wait-met` and `auto-launch`; after three more ticks the args log still has one line.
- **An example in the body never starts a plan.** A web plan with `- **Waits for**: api PR #7 merged` only inside a ``` block under `## Goal` → no `waits`, no launch after PR #7 merges.
- **An old PR and a reused branch.** The updated-sorted list returns PR #2 (an old number) as MERGED, and two PRs #8 (CLOSED) and #11 (MERGED) on the same branch → `pr-merged` events for #2 and #11, `pr-closed` for #8. A plan waiting on `api PR #2 merged` starts (the single-PR call).
- **More than one page of updates.** `updated.json` holds 150 rows (the fake `gh` returns them in pages of 100 by the `page` parameter), and a merged PR in row 130 → its `pr-merged` event comes.
- **A gh error makes no notification, a config error does.** The fake `gh` fails for one tick for a plan waiting on `api PR #7 merged` → `waits[0].error` is set, no notifier line; a plan waiting on `nope PR #1 merged` → one notifier line ("unknown project"), and not again on later ticks.
- **Command text is redacted.** A launcher `SKIP:` line with `?token=abc` and 2000 characters → the `auto-launch-failed` event's `output` has no `abc` and at most 500 characters.
- **A parked plan never starts.** A met plan with status `parked` (`POST /api/meta`) → no launch.
- **After a restart an auto-launched plan shows no waits chip.** After the restart case, `/api/state` shows the plan with a `launch` or a `run`; the page rule (step 10) shows no chip for it (checked in the browser test).
- **The dashboard's own repo is not pulled.** In its own HOME (and with `DASH_NO_NOTIFY=1`), a second server runs from a throwaway copy made with `copyDashboard(dest)` (exported by `scripts/docs-media.mjs` after the move plan), committed as a git repo with a local origin; that copy is registered as a project and gets a merged PR with a new commit on origin → its `pr-merged` event's `pull` says "Not pulled: this is the dashboard's own repo", and its HEAD does not move. The real repo is never registered.
- **A removed `Waits for:` line.** A plan shows `waits` with `met: false`; the test removes the line from the file → `/api/state` shows `waits: null` on the next poll.
- **No flood on the first tick.** A project whose list already has a MERGED PR before the server starts → no `pr-merged` event after the first ticks.
- **`short` names and `plan … merged`.** A plan with `- **Waits for**: <short> plan other-slug merged` waits while the PR on `auto/other-slug` is OPEN and starts when it is MERGED. A second project with the same `short` → `wait-error` "two projects have this short name", no launch.
- **The 4-run limit.** Four web plans with run reports `## Status: RUNNING` (the `report()` shape) and a fifth plan whose condition is met → not launched; change one report to `## Status: PR OPEN — https://example.test/pr/1` → the fifth starts on a later tick. A `## Status: CLEANED — …` report does not count.
- **A busy chat delays the start.** The waiting plan's chat is mid-turn (the fake claude's `hold` message) when PR #7 merges → no launch while the chat is busy; the chat ends → the plan starts.
- **A failed auto-launch is reported, not retried.** The web `auto-pipeline.sh` prints `SKIP: waiting.md is not on origin/main` and exits 0 → an `auto-launch-failed` event with that line, a notifier line, and no second launch on later ticks.
- **Submodule condition.** A local bare `contracts` repo with two commits, the web repo with it as a submodule at `contracts` (`git -c protocol.file.allow=always submodule add`), pushed to a local bare `origin` with the pointer at commit 1; plan `- **Waits for**: submodule contracts contains <commit-2 short sha>` → not met; push a pointer move to commit 2 to `origin/main` → the plan starts. A plan with `submodule nothere contains <sha>` → `wait-error`, no launch. A plan with `submodule contracts contains 0000000` → `wait-error` "commit not found", and a notifier line for it.
- **A gh error skips only the PR part.** A pipeline project whose fake `gh` fails → its run-outcome events still come.
- **A generic project.** A plan with a `Waits for:` line in a project without `auto-pipeline.sh` → `waits[0].error` names auto-pipeline.sh, nothing starts.
- **A button merge is not pulled twice.** `POST /api/pr-action` merge of PR #7 in a project with a waiting plan → the next tick's `pr-merged` event says "Pulled by the merge button", and the waiting plan still starts.
- **A failed auto-start after a restart shows no chip.** An auto-launch that the fake launcher skips, then a restart → `/api/state` shows `waits: null` for that plan.
- **A merge on GitHub pulls the main checkout.** The merge test's local origin + clone setup for `api`, a new commit on origin, PR #7 → MERGED with `baseRefName: 'main'` → the file of the new commit exists in the main checkout and the `pr-merged` event's `pull` text starts with "Pulled main".
- **Run outcome events and the notification link.** A plan report changes from `RUNNING` to `PR OPEN — …` → a `run-outcome` event with `outcome: 'needs-you'`, and the notifier log has a line with the slug and `-open …/?sel=web%2F<slug>`; a `FAILED` report → `outcome: 'failed'` and a second line.
- **Restart keeps the state.** Stop the server (`stop()` by its handle) and start it again → no repeated `pr-merged`, `wait-met`, `wait-error` or `auto-launch` events, and the args log still has one line per plan.
- **One watcher per HOME.** Two servers on two ports with the same HOME, started at the same moment → exactly one `auto-launch` for a met plan, and one server's log says "another dashboard runs the watcher". Stop the holder (by its handle) → the other one takes the lock on a later tick and records the next merge.
- **A stale lock.** `watcher.lock` holds the PID of a live process that is not a dashboard (the test process's own PID) → the server takes the lock and the watcher runs. A lock file with text that is not JSON and a new mtime → held (no watcher runs); the same file with an mtime 20 s old (`utimesSync`) → taken.
- **`/api/events`.** No events file yet → 200 `{ events: [] }`; after the merge case → the events are oldest first; `limit=1` → only the newest; `limit=0` and `limit=abc` → up to 200; `limit=5000` → up to 1000; a bad line written into the file by the test → skipped, the other lines still come; `?project=nope` → 400 `{ error: 'bad project' }`; `?project=../x` → 400; a request with `Origin: https://evil.example` → 403 (the existing `crossSiteReason`). There is no 401 (no login, owner answer 3A) and no 404 (an unknown project is 400, as on every route that takes `project`).
- **Worktrees are not removed.** After the merge of a plan's PR, its worktree folder (made by the test) still exists (owner answer 2C).

### Harness constraints

- Real GitHub is never called; the fake `gh` answers only the REST PR list and the single-PR call. The test does not prove the real `gh` output shape; `PR_JQ` already shapes the list and the existing dashboard tests cover it.
- macOS notifications are not shown; the test proves that the notifier is called with the right text and link (`DASH_NOTIFIER`). The `osascript` fallback is not tested.
- The real `auto-pipeline.sh` is not run; the test script logs its arguments. That the launched run really starts is covered by the existing launch tests.

## Browser test

- Routes: `/` (the plan list) and `/?view=board` (the board) on a test dashboard with the watcher test data.
- Siblings: the sidebar row and the board card both use `autoChips`; check both.
- Account and data: no login; a test HOME with a `web` plan with `- **Waits for**: api PR #7 merged` and PR #7 OPEN in the fake list.
- What to compare: the old dashboard on http://127.0.0.1:4899 shows no chip for the plan; the new one shows `⏳ waits` with the title "api PR #7 merged ✗" in the list and on the board card; after PR #7 becomes MERGED the chip goes away and the plan shows "starting…"; after a server restart the started plan still shows no `⏳ waits` chip.

## How to verify

```bash
node --test apps/dashboard/test/watch.test.mjs
node --test apps/dashboard/test/watcher.test.mjs
node --test apps/dashboard/test/dashboard.test.mjs
npm test
node .claude/scripts/changelog-validate.mjs --base origin/main
grep -n "Waits for" docs/plans-dashboard.md
grep -n "Waits for" AGENTS.md
grep -n "Waits for" skills/bootstrap-project/templates/core/AGENTS.md.tmpl
grep -n "Waits for" skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md
```
