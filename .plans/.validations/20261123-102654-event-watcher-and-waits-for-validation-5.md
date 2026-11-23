**Validation round:** 5

## Plan validation: 20261123-102654-event-watcher-and-waits-for.md

**Verdict:** APPROVE WITH CHANGES

Scope of this round: the round-4 edits were checked first (launchedNow, lock takeover, launch-limit recount, uncapped `prs`, `buttonMerged`, `linkSync`, `mkdirSync(CENTRAL)`, generic `met: false`, `ghProblem(r.output)`, `reportAt`, scout `redact()` deviation, e2e env, pending record removal, step 0 `copyDashboard` grep). Most are correct. One of them leaves the `prEvents` contract with data it cannot use, and one leaves a race. Code was checked against the pre-move files (`scripts/plans-dashboard.mjs`, `scripts/scout.mjs`, `scripts/test/plans-dashboard.test.mjs`, `scripts/plans-dashboard/app.js`, `scripts/docs-media.mjs`), and the post-move paths against `.plans/20261122-152506-move-apps-out-of-scripts.md`.

### Blocking issues

- [Discrepancy / round-4 regression] `prEvents()` gets maps that hold only `{ state }`, but it must read `createdAt`, `mergedAt`, `title`, `url` and the branch. Step 1 (plan line 117) makes `prMap()` store only `{ state }` per number, and says "the event takes the other fields from the row itself". Step 2 (line 121) still defines `prEvents(prev, next, since)`, and step 6.1 (line 143) calls `prEvents(saved.prs, next.prs, saved.since)`, where `next.prs` is the `prMap()` output. Line 121's "since" rule (new number with `createdAt > since` / `mergedAt > since`) and the event fields in Contracts (line 40: `number`, `title`, `url`, `branch`) need the rows. With `next.prs` there are no rows to read. An implementer who follows the signature must either emit `pr-merged` for every new MERGED number, which brings back the round-3 flood of old PRs, or emit none. Both are wrong. Fix: make the signature `prEvents(prev, rows, since)`. It walks this tick's rows and compares each one with `prev[number].state`. Make step 6.1 call `prEvents(saved.prs, rows, saved.since)` before or alongside `prMap()`, and align the unit tests (lines 176, 179, 180) with that signature.

### Non-blocking concerns

- [Race / round-4 edit] `buttonMerged` is set too late. `runPrAction()` merge (`scripts/plans-dashboard.mjs:1576-1587`) awaits `gh pr merge`, then `gh api pulls/<n>`, then the optional branch DELETE, and only then reaches `pullRoot()`. The plan adds `<root>#<number>` "before its own `pullRoot()`" (line 143). A watcher tick that runs during those awaits sees the PR as MERGED and calls `pullRoot()` in the same checkout. That is the double `git pull` the edit was meant to stop: one pull can then fail on `.git` locks and say "Pull by hand". Suggestion: add the key before `gh pr merge`, and remove it when the merge fails.
- [Contracts / round-4 edit] Contracts (line 45) says `waits` is `null` only when there is no `Waits for:` line. Step 8 (line 155) also returns `null` for a plan with a `launchedNow` record. Add that case to Contracts.
- [Ambiguity / round-4 edit] The launch-limit recount in 6b.6 (line 149) is unclear. It counts "the entries of `launches` for this project with `state: 'starting'` that were not counted yet", and it also adds `startedThisTick`. The watcher's own earlier launches in this tick are also `starting` entries in `launches` (`runLauncher` sets them, `scripts/plans-dashboard.mjs:649`), so they would count twice. That is safe (fewer starts), but it can hold back a start below the limit. Say "not counted by `runningCount` and not started by this tick".
- [Test harness] The fake `gh` must answer `gh pr merge` for the "A button merge is not pulled twice" case (line 206). The Harness constraints (line 218) say the fake answers only the PR list and the single-PR call. The FAKE_GH shape exits 0 for unknown commands (`scripts/test/plans-dashboard.test.mjs:34-38`), so it works by accident. `runPrAction` also parses the single-PR answer for `baseRefName`/`headRefName` (`:1578-1579`), so `pr-7.json` must hold those fields as well as `merged_at`. State both, and fix the Harness constraints line.
- [Test cleanup] The busy-chat case (line 201) opens a chat. Chats outlive the server through the chat relay. The dashboard test ends them in `after()` (`scripts/test/plans-dashboard.test.mjs:210-214`), and `watcher.test.mjs` should do the same with its own socket paths, never by process name.
- [Naming] Step 6.1 says `pullRoot(proj, pr.base)`, but the `WATCH_PR_JQ` row field is `baseRefName` (`PR_JQ`, `scripts/plans-dashboard.mjs:1316-1317`). `base` is the name used only in the `allByBranch` cache.

### Edge cases the plan should address

- A button merge while a watcher tick is between its PR list read and its pull. See the `buttonMerged` concern above.
- A plan unarchived from `done/` after its `launched` record was removed (6b.4). It is checked again, and if it has no run report it can auto-start a second time. Say whether that is intended.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (pre-move names; `gh`, `ghProblem`, `PR_JQ`, `refreshPrList`, `pullRoot`, `runPrAction`, `runLauncher`, `launchPipeline`, `modeFlag`, `pipelineModes`, `pipelineLive`, `planBranch`, `SCOUT_LOCK`, `scoutRunning`, `NOTIFIERS`, `dashUrl`, `autoChips`, `escA`, `chatEnd`, `chats`, `crossSiteReason` verified)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (`NOTIFIERS` is `export const` at `scripts/scout.mjs:328`; scout main is behind the main-module check at `:624`; `copyDashboard` is added by the move plan)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; mode ids come from `pipelineModes()`)
- [x] "How to verify" commands are real and can fail (`changelog-validate.mjs` exists in `.claude/scripts/`)
- [ ] `prEvents` contract consistent with `prMap` (blocking item 1)

```
Update the plan at .plans/20261123-102654-event-watcher-and-waits-for.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Change prEvents to read this tick's PR rows, not the prMap output: signature prEvents(prev, rows, since); a row whose number is not in prev makes pr-opened (OPEN, createdAt > since) or pr-merged (MERGED, mergedAt > since); a row whose prev state differs makes pr-merged / pr-closed; the event fields (number, title, url, branch) come from the row. In step 6.1 call prEvents(saved.prs, rows, saved.since) and then next.prs = prMap(rows, saved.prs). Align the unit tests for prEvents and prMap with this signature. (evidence: plan lines 117, 121, 143, 176, 179-180 — prMap stores only { state }, so createdAt/mergedAt/title are not in next.prs)

SHOULD FIX:
1. Add <root>#<number> to buttonMerged before runPrAction calls gh pr merge (remove it when the merge fails), not just before pullRoot: the awaits of gh pr merge, gh api pulls/<n> and the branch DELETE let a watcher tick pull in between. (evidence: scripts/plans-dashboard.mjs:1576-1587; plan line 143)
2. In Contracts, say that waits is also null for a plan with a launchedNow record. (evidence: plan lines 45 and 155)
3. In 6b.6, count only the launches entries in state 'starting' that runningCount did not count and that this tick did not start, so startedThisTick is not counted twice. (evidence: scripts/plans-dashboard.mjs:649; plan line 149)
4. In the e2e harness, state that the fake gh also answers gh pr merge (exit 0) and that pr-<n>.json holds merged_at, baseRefName and headRefName (runPrAction parses them); fix the Harness constraints line. (evidence: scripts/plans-dashboard.mjs:1576-1579; plan lines 206, 218)
5. In watcher.test.mjs, end the chat relay the busy-chat case leaves, as the dashboard test's after() does (by its socket path, never by process name). (evidence: scripts/test/plans-dashboard.test.mjs:210-214)
6. In step 6.1, use the row's baseRefName for pullRoot (pr.base is the allByBranch name). (evidence: scripts/plans-dashboard.mjs:1316-1317, 1337-1338)

ADD THESE EDGE CASES:
- A button merge while a watcher tick is between its PR list read and its pull.
- A plan unarchived from done/ after its launched record was removed: say whether it may auto-start again.

Do not change anything the validation did not flag.
```
