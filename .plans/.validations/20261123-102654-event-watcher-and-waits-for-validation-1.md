**Validation round:** 1

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

The plan is well researched. Its symbols, line references and post-move paths match the code and the move plan. Four gaps would give wrong behavior at run time: the notification link opens nothing, an auto-launch can kill a live chat, a `Waits for` example in a plan's body can start a run without a go, and the 4-run limit (owner decision Q6) counts the wrong runs.

Path mapping checked against `.plans/20261122-152506-move-apps-out-of-scripts.md` (lines 44-51, 86): `scripts/plans-dashboard.mjs` → `apps/dashboard/server.mjs`, `scripts/plans-dashboard/` → `apps/dashboard/page/`, `scripts/test/plans-dashboard.test.mjs` → `apps/dashboard/test/dashboard.test.mjs`, `scripts/scout.mjs` → `apps/scout/scout.mjs`, and `scripts/page-versions.mjs` stays in `scripts/` (move plan line 16). All correct. The post-move `npm test` glob `apps/*/test/*.test.mjs test/*.test.mjs` (move plan line 53) picks up both new test files.

Symbols verified in today's files: `planBranch` (plans-dashboard.mjs:301), `planBranches`/`ownBranch` (305-310), `outcomeOf` (322), `parseReport` (329), `pipelineRunInfo` (341), `pipelineLive` (383), `worktreeOf` (379), `listPlans` (481, plan fields `run`, `live`, `launch`, `worktree`, `chatting`, `chatWaits` at 504-513), `launches`/`runLauncher` (642-670), `modeFlag` (674), `launchPipeline` (678), `loadJson(f, fallback)` (152), `allProjects` (239), `resolveProject` with `stateDir` and `short` (179-205), `PR_TTL`/`prLists`/`refreshPrList`/`prsFor` (1281-1350, `allByBranch` values have `number,state,isDraft,title,url,head,base`), `gitIn` (1476), `pullRoot` (1480), `runPrAction` merge branch (1572-1588), `crossSiteReason` (125), `getProj` (2717), `/api/report` (2784), `server.listen` + `chatReattach()` (3267-3268); scout `dashUrl` (scout.mjs:321), `export const NOTIFIERS` (328), `notify` (329), main-module check (624); test `FAKE_GH` (plans-dashboard.test.mjs:29), `start` (151), `stop` (169), `pipeRepo` (861), `report` (873), merge test (1050); page `autoChips` (app.js:236), `chatChip` (232), `escA` (3161), `boardCard` (4129); docs sections "How a plan gets launched" (91), "Alerts" (162), "Running several plans at once" (199), "Environment" (229); the "go" sentence in `AGENTS.md:46` and `skills/bootstrap-project/templates/core/AGENTS.md.tmpl:34`.

### Blocking issues

- [Discrepancy] The notification link uses `?plan=<project>/<slug>`, but the page opens a plan only from `?sel=<key>` — `scripts/plans-dashboard/app.js:596-603` (`readUrl()` reads `sel`, `tab`, `file`, `view`; no `plan` key anywhere in app.js) — a click on every "Started" / "needs you" / "failed" notification opens the plain dashboard, not the plan — use `?sel=` + `encodeURIComponent(<project>/<slug>)` (the plan key format of `listPlans`, plans-dashboard.mjs:491), and assert the `-open` argument in the e2e notifier test.
- [Edge case / live chats] An auto-launch kills the plan's open chat. `launchPipeline` → `runLauncher` calls `chatEnd(proj, s)` for each slug (plans-dashboard.mjs:648), and `chatEnd` calls `chatKill` (2572-2574). `canAutoLaunch` (plan step 1) does not check `plan.chatting` or `plan.chatWaits`. Example: the owner refines `waiting.md` in its chat; PR #7 merges; the next tick kills the chat in the middle of a turn — add `plan.chatting === false` and `plan.chatWaits === 0` (both already in the `listPlans` objects, plans-dashboard.mjs:512-513) to `canAutoLaunch`, add both to the unit test list "false for each single missing condition", and say in the docs that a busy chat delays the start to a later tick.
- [Scope / go rule] `parseWaitsFor` matches `^\s*[-*]\s*\*\*Waits for\*\*:` on every line of the file (plan step 1, `gm` flag), including fenced code blocks and examples in the body. Under the new rule, that line is the owner's go (plan step 13). A plan that shows an example `- **Waits for**: api PR #7 merged` in a code block (phase 2-5 plans will describe this feature) starts by itself when that PR merges. `planBranch` has the same shape (plans-dashboard.mjs:301-303), but a wrong branch name does not start a run — read `Waits for` lines only from the plan header (the lines before the first `## ` heading, where `- **Base**:` and `- **Parent**:` are), skip fenced code, and add unit tests: a line inside a ``` block and a line after `## Goal` → `null`.
- [Owner decision Q6] `runningCount(plans)` = `live === true` or `run.outcome === 'running'` (plan step 1) gives a wrong count in both directions. (a) Too low: a plan launched on an earlier tick that is still in the launcher's preflight has `plan.launch.state === 'starting'`, no report and no pgrep match (plans-dashboard.mjs:649, 504; `auto-pipeline.sh` writes the report only after `git worktree add`, .claude/scripts/auto-pipeline.sh:697/737). `launchedThisTick` covers only the current tick. A manual launch from the page in the same window is not counted either. (b) Too high: `outcomeOf` returns `'running'` for any status that is not in its two lists (plans-dashboard.mjs:322-324), for example `CLEANED — …` (auto-pipeline.sh:554), `unknown` (no `## Status:` line, 346) or a stale `RUNNING` from a run that died. Four such stale reports block every auto-launch of the project with no message — count `live`, `launch?.state === 'starting'`, and `run.outcome === 'running'` only when the run is not stale (for example `live`, or the report changed in the last N minutes); exclude `CLEANED`; add unit tests for `starting` (counted) and `CLEANED` (not counted).

### Non-blocking concerns

- [Edge case] Step 5.1 skips the whole project when `prLists[root].error` is set. A pipeline project with no GitHub remote always has a gh error, so it never gets `run-outcome` events, notifications or `submodule` waits — skip only the PR part (steps 5.2-5.3) on a gh error, and still run steps 5.4-5.6.
- [Edge case] Waits on a generic (non-pipeline) project: step 7 shows `waits` for every active plan, but steps 5.4-5.5 check and launch only pipeline projects. Such a plan shows "⏳ waits" for ever — say what happens (for example a `wait-error` "auto-start needs auto-pipeline.sh", or no chip), and document it.
- [Correctness] Step 5.5 calls `canAutoLaunch(plan, …)` with `plan` from `listPlans` (step 5.4), whose `waits` was read from `waitStatus` before this tick's checks (step 7). The launch then happens one tick late, or never on the first tick (fallback `met: false`) — pass the fresh `[{ text, met }]` of this tick to `canAutoLaunch`.
- [Edge case] A failed auto-launch: the launcher prints `SKIP: plan not on origin/main … push it first` (auto-pipeline.sh:690) and `runLauncher` sets `launch.state = 'failed'` (plans-dashboard.mjs:662). The plan already sent "Started <slug>", and `launched[slug]` blocks every retry — on a later tick, when an auto-launched plan has `launch.state === 'failed'`, add an `auto-launch-failed` event and a notification with the launcher's output.
- [Contracts] The `watch.json` shape `{ prs, outcomes, launched }` (step 3) has no place for the `wait-error` dedupe (step 4, "kept in watch.json") or for "all met for the first time" (step 5.5, `wait-met`). After a restart both repeat — add the keys (for example `errors`, `met`) to the shape.
- [Robustness] `saveWatch()` uses a plain `writeFileSync`. The restart test stops the server with SIGKILL (`stop()`, plans-dashboard.test.mjs:169-173). A torn file reads as `null` → treated as the first tick → `launched` is lost — write a temp file and `renameSync` it (the scout's `saveJson` imports `renameSync`, scout.mjs:12, 28).
- [Ordering] Step 5.1 refreshes and processes one project at a time. When `web` comes before `api` in the registry, `web` reads `api`'s list from the previous tick — refresh every project's PR list first, then run steps 5.2-5.6.
- [Commands] Step 0 `test -f apps/dashboard/server.mjs` is not in the allow list (`.claude/settings.json` has only `Bash(test -x ~/.local/bin/codex)`); headless runs auto-deny it, and the run can read the denial as "not merged" — use `ls apps/dashboard/server.mjs` (allowed, settings.json:17) or the Read tool.
- [Breaking changes] The consumer search for `/api/state` also finds `scripts/docs-media.mjs` and `scripts/restart-dashboard.mjs` (post-move `apps/dashboard/restart.mjs`). Both use it as a readiness probe only, so nothing breaks; list them so the claim "app.js only" is true.
- [Edge case] `submodule` condition: when the submodule is not initialized in the main checkout, `git -C <root>/<path>` runs in the superproject, `merge-base` fails, and the condition stays "not met" with no message — check that `<root>/<path>/.git` exists, else a `wait-error`. Also reject a path that starts with `-`, and pass `--` before `cond.path` in `ls-tree`.
- [Concurrency] AGENTS.md's "Run a test dashboard by hand" command (`DASH_PORT=4911 … node apps/dashboard/server.mjs`) uses the real HOME, so it runs a second watcher on the same `stateDir`: double pulls, double notifications, and a race on `watch.json` that can launch a plan twice — run the watcher only when `PORT` is the service port, or hold a lock file in `<CENTRAL>`, or document `DASH_WATCH_MS=0` in that command (AGENTS.md Commands is rendered from `.claude/bootstrap.json`; a headless run cannot write `.claude/`).
- [Docs] With the page open and 🔔 on, a run outcome now gives two notifications (the page's, docs/plans-dashboard.md:164, and the server's). Say so in "## Alerts", or skip the server's outcome notification when a page polled in the last minute.
- [Consistency] `.claude/skills/skill-1-plan/SKILL.md:276` and `skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md:313` still say "The work starts only after the owner's explicit go". Report them under Open items (or update the template one); a headless run cannot write `.claude/`.
- [Restart] The server now imports `apps/scout/scout.mjs`, so a scout change also needs the restart check. Name it in the Open items text. An automatic pull of this repo's own main checkout after a dashboard PR merges does not restart the service; the docs section should say that the restart rule still applies.
- [Edge case] `events.jsonl` grows without a limit, and `/api/events` reads the whole file for each request — cap it (for example keep the last 5000 lines when it is written).
- [Steps] Step 5 is much longer than 2-5 minutes; split it into 5a-5f.

### Edge cases the plan should address

- Two projects with the same `short` — `<project>` resolves to the wrong repo or to two; take `name` first and give a `wait-error` when `short` is ambiguous.
- A waited PR that is older than the newest 200 PRs, or that is hidden by a newer PR on the same branch (`allByBranch` keeps only the newest per branch, plans-dashboard.mjs:1336) — never met with no message; say it in the docs or emit a `wait-error` after N ticks.
- The waiting plan is not pushed to `origin/<base>` when its condition becomes true — the launcher skips it (see the failed auto-launch item).
- The default mode is `verify` for projects without `--describe` (plans-dashboard.mjs:212-215), so an auto-started run commits nothing and opens no PR — document which mode an auto-start uses.
- The owner launches the waiting plan by hand before the condition is true — `plan.run` blocks the auto-launch (correct); keep it in the unit tests.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done) — two readiness-probe consumers missing (non-blocking)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [ ] Scope stays inside the goal; no open decision is taken silently — body examples of `Waits for` act as a go
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail — the commands are real; step 0's `test -f` is auto-denied in headless runs

```
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Change the notification query from `?plan=<project>/<slug>` to `?sel=` + the URL-encoded plan key `<project>/<slug>` (the page reads only `sel`, `tab`, `file`, `view`), in step 5.6 and the docs; assert the `-open` argument in the e2e notifier test. (evidence: scripts/plans-dashboard/app.js:596-603)
2. Add `plan.chatting === false` and `plan.chatWaits === 0` to `canAutoLaunch`, because `runLauncher` ends the plan's chat with `chatEnd` → `chatKill`; add both to the canAutoLaunch unit cases and document that a busy chat delays the start. (evidence: scripts/plans-dashboard.mjs:648, 2572-2574, 512-513)
3. Make `parseWaitsFor` read only the plan header (the lines before the first `## ` heading) and skip fenced code, so an example line in a plan body is never a go; add unit tests for a line inside a ``` block and a line after `## Goal` → null. (evidence: plan step 1 regex with `gm`; scripts/plans-dashboard.mjs:301-303 for the header-line pattern)
4. Fix `runningCount` for owner decision Q6: count `live`, `launch?.state === 'starting'`, and `run.outcome === 'running'` only when the run is not stale (live, or report changed recently); do not count `CLEANED`, `unknown` or stale `RUNNING` reports; add unit tests for `starting` (counted) and `CLEANED` (not counted). (evidence: scripts/plans-dashboard.mjs:322-324, 346, 504, 649; .claude/scripts/auto-pipeline.sh:554, 697, 737)

SHOULD FIX:
1. On a gh error, skip only the PR steps (5.2-5.3), not the whole project, so local-only pipeline repos still get run-outcome events and submodule waits. (evidence: plan step 5.1; scripts/plans-dashboard.mjs:1341-1343)
2. Say what happens to a `Waits for` line in a generic (non-pipeline) project (a `wait-error` or no chip) and document it. (evidence: plan steps 5.4, 7)
3. Pass this tick's fresh `[{ text, met }]` to `canAutoLaunch` instead of `plan.waits` from `listPlans`. (evidence: plan steps 5.4-5.5, 7)
4. Add an `auto-launch-failed` event and notification when an auto-launched plan ends with `launch.state === 'failed'` (for example "plan not on origin/main"). (evidence: scripts/plans-dashboard.mjs:660-666; .claude/scripts/auto-pipeline.sh:690)
5. Add the keys for the wait-error dedupe and the "first time met" state to the `watch.json` shape. (evidence: plan steps 3, 4, 5.5)
6. Write `watch.json` atomically (temp file + `renameSync`). (evidence: scripts/scout.mjs:12, 28; scripts/test/plans-dashboard.test.mjs:169-173 SIGKILL)
7. Refresh every project's PR list first, then evaluate events and waits. (evidence: plan step 5.1)
8. Replace step 0's `test -f apps/dashboard/server.mjs` with `ls apps/dashboard/server.mjs` (allowed) or the Read tool. (evidence: .claude/settings.json:17, 26)
9. List `scripts/docs-media.mjs` and `apps/dashboard/restart.mjs` as `/api/state` readiness-probe consumers in Breaking changes. (evidence: grep "api/state")
10. For `submodule`: give a `wait-error` when `<root>/<path>/.git` does not exist, reject a path that starts with `-`, and pass `--` before the path to `ls-tree`. (evidence: plan step 4)
11. Prevent a second watcher on the same HOME (test dashboard by hand): run the watcher only on the service port, or hold a lock file in `<CENTRAL>`, or document `DASH_WATCH_MS=0`. (evidence: AGENTS.md Commands "Run a test dashboard by hand")
12. Document the double notification (page alert + server notification) in "## Alerts", or skip the server's outcome notification when a page polled recently. (evidence: docs/plans-dashboard.md:164)
13. Under Open items, list the two skill-1-plan "explicit go" lines that still name only the owner. (evidence: .claude/skills/skill-1-plan/SKILL.md:276; skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md:313)
14. In the restart Open item, say that the server now imports apps/scout/scout.mjs; in the docs, say that an automatic pull of this repo does not restart the service.
15. Cap `events.jsonl` (for example keep the last 5000 lines when writing it).
16. Split step 5 into smaller steps.

ADD THESE EDGE CASES:
- Two projects with the same `short`: take `name` first, `wait-error` when `short` is ambiguous.
- A waited PR older than the newest 200, or hidden by a newer PR on the same branch (allByBranch keeps one PR per branch).
- The waiting plan is not pushed to origin/<base> when its condition becomes true.
- Which mode an auto-start uses (default `verify` commits nothing and opens no PR).
- A manual launch before the condition is true blocks the auto-launch (keep it as a unit case).

Do not change anything the validation did not flag.
```
