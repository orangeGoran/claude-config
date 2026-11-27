**Validation round:** 4

## Plan validation: 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round 3 fixes are correct against the code. I found no blocking issue. Four small points remain. The most useful one: the crash recovery command uses `--label`, and that can make `gh issue list` use the search index, which is the delay that round 2 (G5) wanted to avoid. I could not prove this here.

Scope of this round: the diff `-pre-round-3` → the plan now (round 3 fixes H1–H9), plus a new check of the claims against the 2a worktree (`/Users/gorantubic/Workspace/worktrees/claude-config/20261127-195706-groups-ledger-checklist`, uncommitted rework included) and the templates on `main`. Findings that rounds 1–3 rejected (G4, H10) are not raised again.

### Blocking issues

None.

### Non-blocking concerns

- [Edge case / not verified] With `--label`, the recovery `gh issue list` may use the GitHub search index. Decision "Recovery never guesses" (plan line 61) says the list is "not the search index, so a new issue shows at once". Item 7.5.2 (plan line 205) runs `gh issue list --repo <recorded repo> --label from-pipeline --author @me --state all --limit 200 --json url,body`. As far as I know, the gh CLI sends `issue list` to the search API when `--label`, `--milestone` or `--search` is given (it does this to get AND for labels), so the same indexing delay as round 2 G5 applies. Within these limits I cannot prove it: `gh issue list --help` does not say, and I did not read the gh source. A crash right after `gh issue create`, then a fast resume, could find no row and create a second ticket. Suggestion: remove `--label from-pipeline` from the recovery command. `--author @me --state all --limit 200` plus the exact hidden marker is enough to find the run's own issue, and the newest issue of `@me` is always in the first 200 rows. Or keep the command and change the reason text. Proof: read the `issueList` function in `pkg/cmd/issue/list/http.go` of the gh CLI.
- [Docs / Contracts] Step 20 (plan line 221) says "the two Timeline lines", but Contracts (plan line 84) names four kinds of Timeline lines: `ticket creating:` / `ticket opened:`, `pr body: defects section written` / `… not written (<reason>)`, and `Would open a ticket in <repo>: <one line>`. Suggestion: change step 20 to "the Timeline lines of Contracts", so `contracts.md` gets every line that a resume or the conductor reads.
- [Tests] The ledger case (plan line 246) expects `#90` with `title: 'Total is null'`, but the notification case (plan line 242) only says "Add `#90` to `issues.json`", with no title. The case also depends on the state of the cases before it (`[89, 90]`, then `#89` dropped, then `fail-issues`). Suggestion: give `#90` its title in the case that adds it, and say that the `ct-tri` bullets are one `test()` in the given order (or that each one sets its own `issues.json`).
- [Edge case] The notification subtitle is the raw issue title (`subtitle: e.title`, plan step 5, line 182). `notifyParts()` (worktree `server.mjs` 2043–2048) removes URLs from its detail text, and `notifyMac()` (2053–2059) runs `redact()` only on `message`. The process gets the title as an argv value, so this is safe, but a title with a URL or a token-like value shows in the macOS notification as it is. Suggestion: pass `e.title` through the same URL strip as `notifyParts()` (or through `redact()`).

### Edge cases the plan should address

- A repo with more than one remote. `repoOf(proj.issuesUrl)` comes from `origin` (`issuesUrlFor()`, worktree `server.mjs` 181–191), but `gh api repos/{owner}/{repo}/…` lets gh choose the base repo, which can be `upstream` in a fork. Then the triage cache key (origin) and the repo that was read (upstream) can differ. `listPrs()` (1631–1641) has the same behaviour, so this follows the existing pattern. One sentence in the docs or the Harness constraints is enough.
- `listTriage()` output that does not parse. Step 4 parses `r.out`. When `JSON.parse` fails, `refreshTriage()` must mark an error and must not store `items: undefined`, else `tc.items.map` in step 1b throws for that project every tick. `refreshPrList()` catches only a rejected promise (`.catch` at 1645), not a parse error after `ok: true`. Suggestion: one `try` around the parse in `listTriage()`, which returns `{ ok: false, output: 'bad JSON from gh' }`.

### Checked and correct (round 3 fixes and claims)

- `usage()` is `sed -n '2,30p'` (template `auto-pipeline.sh:91`). The `--describe` line is line 26, and line 30 is the last usage line. A new line after 26 needs `2,31p`, as step 11 says.
- `.ck-you .chip.warn { display:none; }` is in the worktree `app.css` (in the `.ck-*` block, about line 998–1006; the file is still being edited). `.chip` has no `display` (line 100–101), and `.ck-you .ck-triage .chip.warn` has higher specificity than the 2a rule, so the step 9 rule wins.
- `checklistHtml(d)` (worktree `app.js:5276`) has `you`, `row()`, the `ck-box ck-you` "Needs you now" box (5296) before `<h3>Tickets</h3>` (5297), and no `T` variable. `esc`, `escA` and `projPill` exist (60, 3442, 351). The page test cut `/^function checklistHtml\(d\) \{[\s\S]*?\n\}$/m` and `goal({ chain: { tickets: [], untracked: [] } })` exist in `dashboard.test.mjs` (2635, 2686).
- `watchProject(proj, projects, cache)` (2161). Step 1 saves and calls `addEvents` at once (2172, 2183). The step 7 rule comment is at 2272. `watchTick()` has the `Promise.all` with `refreshPrList(p)` (2305–2309). `loadWatch()` `blank` is at 1951. `cleanup()` artifacts are `['.md', '.log', '-settings.json', '-pr-body.md']` (1331). `runLauncher()` uses `env: ENV` (785). `/api/resume` calls `runLauncher()` (3689). `ledgerState()` has `const projs = groupProjects(group, st)` (1387). `gh()`, `PR_TTL`, `ghProblem()` are at 1594–1625.
- `notifyMac()` uses `-group 'plans-' + query` (2059), so `&issue=<n>` makes each triage notification unique. The fake notifier logs raw args (`watcher.test.mjs:189`), so the assertion `?checklist=ct-group3&issue=90` can match.
- `FAKE_GH` ends with `else process.stdout.write('{}')` (watcher.test 55) and answers per cwd folder name (36). This supports the `ct-dup-a` / `ct-dup-b` "one reader" case. `makeRepo(name, { script })`, `gitRemote()` (`example/<name>`), `watchJson`, `seen`, `notes`, `ticks`, `until` and `mainEnv()` exist (112–177). The shared server runs with `mainEnv()` (195). The 2a group names (`gl-group*`) do not clash with `ct-group*`.
- Template: `pr_rules` (226–231) already has `gh pr view*` and `gh pr edit*`. `real_read_rules` and `home_bash_rules` exist (199, 215), and `REPO` is set at line 38, outside the CONFIG slice of `pipelineBash()` (test 118–123), as the overlay test says. The resume and launch `start_session` lines are at 637 and later in the launch loop; `cat > "$report"` is at 756; `rm -f "$RUNS_DIR/$slug-settings.json"` is at 578.
- The `verify.mjs` `overlay` / `push-allow` shape (145–152) is as the plan describes. `render.mjs` `'Bash(gh issue view*)'` is in `allow` (397). `runExtra` (`gh issue comment*` for HAS_TICKETS, 460) goes to the run overlay and not to `settings.json`, so the new `issue-allow` check does not fail HAS_TICKETS projects.
- `@@IFNOT NAME@@` is supported (`render.mjs:39, 732`). The `skill-1-plan` HAS_TICKETS block and the Step 4 header are at 23–25 and 137–139.
- Skill text anchors exist: `skill-auto-pipeline` lines 17, 25, items 7 (183) and 8 (192), "Take over" (107), "Hand-off" (170). `skill-3-test` 131, 170, 173. `skill-4-verify` `## Rules` (26) and Findings states (201). Decision sheet `Contract changes` line (132).
- `changelog-validate.mjs` has no `VERSION_FILE` (29), so `--base origin/main` needs only the new entry. The command has an allow rule (`.claude/settings.json:35`).
- The parent plan, item 2: scope and decisions 4B/5A/6A/7A/8A match. It lists no open decisions. Nothing in `docs/roadmap.md` is raised (caller's note).

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (2a symbols checked in the worktree)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `ticketKey`, `runLauncher`, `/api/ledger`, `verify.mjs` with `runExtra`)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no new endpoint; `/api/ledger` 403 for a foreign Origin is in the e2e list)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; `contracts.md` rows are added)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230102-cross-repo-defect-tickets.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In item 7.5.2 and in the decisions "No duplicate after a crash" and "Recovery never guesses", remove `--label from-pipeline` from the recovery command: `gh issue list --repo <recorded repo> --author @me --state all --limit 200 --json url,body`. With `--label`, gh can use the search index, and a new issue then shows only after a delay. The exact marker line still decides. If you keep `--label`, change the reason text "not the search index". (evidence: plan lines 50, 61, 205)
2. In step 20, write "the Timeline lines of Contracts" (ticket creating/opened, pr body written/not written, Would open a ticket in) instead of "the two Timeline lines". (evidence: plan lines 84, 221)
3. In the watcher cases, give `#90` the title `Total is null` where it is added, and say that the `ct-tri` bullets are one test() in the given order. (evidence: plan lines 242, 243, 246)
4. In step 5, pass the notification subtitle through the same URL strip as notifyParts() (or through redact()), because an issue title is free text. (evidence: plan line 182; worktree apps/dashboard/server.mjs 2043-2059)

ADD THESE EDGE CASES:
- listTriage(): a gh answer that is not JSON gives { ok: false, output: 'bad JSON from gh' } (try around JSON.parse), so tc.items is never undefined.
- A repo with several remotes: `gh api repos/{owner}/{repo}` lets gh choose the base repo, while repoOf() uses origin. Add one sentence in the Harness constraints or the docs, the same as listPrs().

Do not change anything the validation did not flag.
```
