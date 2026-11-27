**Validation round:** 1

## Plan validation: 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** APPROVE WITH CHANGES

Symbols of plan 2a were checked in the worktree `worktrees/claude-config/20261127-195706-groups-ledger-checklist` (groups.mjs, server.mjs, page/app.js, test/watcher.test.mjs, test/dashboard.test.mjs, test/groups.test.mjs, docs/plans-dashboard.md). Templates, render.mjs, verify.mjs and test/bootstrap-project.test.mjs were checked on main. Most references are correct: `ISSUES_RE`/`ticketKey()` (groups.mjs:7, :56-62), `resolveProject()` with `group` and `issuesUrl` (server.mjs:194-221), `runLauncher()` with `env: ENV` (server.mjs:771-798), and its three callers `/api/launch`, `/api/resume` and the watcher auto-launch (server.mjs:3619, :3683, :2261). Also correct: `launchGeneric()` env (server.mjs:839), `gh()`/`ghProblem()`/`PR_TTL`/`refreshPrList()`/`prsFor()` (server.mjs:1588-1657), `loadWatch()` blank (server.mjs:1945), `watchProject()` steps 1-7 (server.mjs:2155-2283), `watchTick()` `Promise.all` (server.mjs:2299-2303), `ledgerState()` (server.mjs:1374-1416), `checklistHtml()` and the `?scout` boot block (app.js:5204-5238, :5609-5612), `FAKE_GH`/`mainEnv()`/`gitRemote()`/`notes()`/`ticks()` (watcher.test.mjs:33-177), `write_run_settings()` `pr_rules`, both `start_session` prompts and `--cleanup` (auto-pipeline.sh:224-248, :637, :814, :578), render.mjs `allow` (render.mjs:388-405), verify.mjs `overlay`/`push-allow` (verify.mjs:145-152), and `pipelineBash()` (bootstrap-project.test.mjs:118-123).

### Blocking issues

- [Workflow conflict] The plan makes the run open issues and labels in other repos, but it does not change the skill's hard rule against every other network write — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:25` ("**Never** `git push`, `gh pr create` or another network write — except in `--stop-after=pr`, where `/skill-5-ship` pushes … and opens a **draft** PR") and `:17` ("Never touch anything outside this worktree, except the report files") — Step 12 adds item 7.5 but leaves these lines as they are. The headless run then gets two rules that contradict each other, and it can refuse the ticket writes or do them against a hard rule — Step 12: change line 25 so that it also allows `gh label create` and `gh issue create` in item 7.5, in `--stop-after=pr` only, and only for the repos of the `--related` file and `self`. Add a rendered-text assertion for it in Tests → Template tests.
- [Resume / wrong data] Verify and commit modes change `ticket: open` to `ticket: would open in <repo>` (plan Step 12, 4th bullet, plan:184). Item 7.5 handles only `ticket: open` lines (plan:185). The template tells the owner to ship a verify run by resuming it in "to PR" mode (`skill-auto-pipeline/SKILL.md:115`, "To ship: resume this run in "to PR" mode"), and commit mode says the same (`:172`). So a run that is launched in verify mode and resumed to PR never opens its tickets — Item 7.5: also take `ticket: would open in <repo>` lines (and `none (no list)` lines when the run now has a `--related` file) that have no `ticket opened: D<n>` Timeline line. Add a rendered-text test for this rule.
- [Sibling overlap / wiring] The sibling plan now exists: `.plans/20261127-230101-contracts-jump-autopilot.md`. This plan waits for its merge (plan:5), and the sibling already adds the `?checklist=<group>` opener next to `?scout` (sibling :57 D15, :123, :134, :163). It also changes the signature to `checklistHtml(d, groups, pick, off = new Set())` and the dashboard test cut pattern (sibling :128, :138, :213), and puts its card after "Tickets" and before "Questions" (sibling :210). This plan says the sibling "did not exist" (plan:26), adds a second `?checklist` boot block (Step 8, plan:170), lists `?checklist=<group>` as a new contract (plan:77) and wiring row (plan:139), and places the sibling card wrongly ("Needs you", then the sibling's card, then "Goals, holds and notes", plan:26). As written, the page gets two openers that both call `openChecklist()`, and Step 10 can cut the wrong function signature — Rewrite Context (plan:26) against the sibling plan as it is now. In Step 8, reuse the sibling's opener (no new boot block; the notification only uses the existing query). Mark `?checklist=` in Contracts and Wiring as existing (from plan 5). In Step 10, use the post-sibling cut pattern. State the real card order: "Needs you" after `ck-bar`; "Contracts jump" stays after "Tickets".
- [Public data / secrets] The ticket body carries "the evidence" (the request and the answer, plan:70, :182, :185), and `ticket: failed (<first line of the error>)` goes into the report and the PR body. Neither is redacted. The target repo can be public or have other readers. API answers, request headers and gh errors can hold tokens, cookies, keys or personal data. The server redacts such text (`redact()` in `notifyMac()`, server.mjs:2052), but the skill text has no such rule — In the new "Defects in other repos" section (Step 12), add a rule: before you write a ticket body, a `D<n>` line or a PR-body line, remove or mask tokens, cookies, `Authorization` headers, keys, passwords, secret query values and real personal data, and use only the test data of the run. Add a rendered-text assertion for it.
- [Tests] The template test "The ticket rules are only in the "to PR" overlay" (plan:227) runs `write_run_settings out-pr.json pr` through `pipelineBash()`. `pipelineBash()` takes only the CONFIG block and the named functions (`test/bootstrap-project.test.mjs:120-122`) under `set -euo pipefail`. `REPO` is set outside that slice (`auto-pipeline.sh:38`), and `write_run_settings` reads it (`auto-pipeline.sh:235`, `--arg repo "$REPO"`), so the test stops with "REPO: unbound variable". The relative `out-pr.json` would also be written into the cwd of `npm test` (the repo root) — In the test body, set `REPO='<tmp dir>'` (as the existing cases at `bootstrap-project.test.mjs:537`, `:562` do) and write both files to absolute paths in a temp folder.
- [Commands] `bash -n skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh` in How to verify (plan:260) is not in AGENTS.md **Commands**. It is not in `.claude/settings.json` `permissions.allow` (`.claude/settings.json:4-36`) or in this repo's `RUN_EXTRA_ALLOW` (`.claude/scripts/auto-pipeline.sh:62`). The headless run runs every How-to-verify command bare (`skill-auto-pipeline/SKILL.md:92`), so this one is refused. A headless run also cannot add the rule (`SKILL.md:30`, no edits under `.claude/`) — Remove the line: the template test already asserts `bash -n` (plan:228).

### Non-blocking concerns

- [Naming] Step 5 says "the cache has no `error`, `triageEvents(saved.triage, cache.items)`", but `cache` in `watchProject(proj, projects, cache)` is the `once()` Map (server.mjs:2155, :2069) — Write `const tc = triageLists[proj.root]`, and skip the step when `tc` is missing.
- [Validation] `write_related()` checks `self` only as a string (plan:174), but `self` becomes `--repo <self>` for a triage ticket (plan:185) — Apply the same `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` rule to `.self`, and add a rejection case to the `write_related` test.
- [Idempotency] Item 7.5 "append `## Defects in other repos` … to `<slug>-pr-body.md`" (plan:185). A second pass (a resume after `PR OPEN`) appends the section again when the body file was not written again. A crash between `gh issue create` and the `ticket opened:` Timeline line creates the issue a second time on resume — Replace the section when it is there. Before a create on resume, look for the hidden marker `defect=D<n>` with `gh issue list --repo <repo> --label from-pipeline --search "<source PR url>"` (this plan adds `gh issue list*` to the shared allow list).
- [Consistency] The deviation says the card shows "100+" (plan:104), but Step 8 writes "Only the first 100 are shown." (plan:170) — Pick one text.
- [Docs] `docs/plans-dashboard.md` (2a) says "The checklist has three parts" (:375), lists the event types in a table (:357-365) and lists the `GET /api/ledger` fields (:395) — Step 21: update all three (parts count, a `triage-ticket` row, the `triage` field).
- [Global rules] The hard-rule text says "no change … to `skills/` outside `skills/bootstrap-project/`" (plan:58), but `skills/bootstrap-project/` is itself in the symlinked `skills/`. The render.mjs and verify.mjs changes take effect at once for every project that runs `/bootstrap-project` — Say that in the hard-rule line.
- [Breaking changes] The new `issue-allow` check fails a project whose owner put a `gh issue create`/`gh label create` rule into the shared allow list through `extraAllow` (render.mjs:404) — List this under Breaking changes, and say what the owner does (move the rule to `.claude/settings.local.json`).
- [Permission scope] `Bash(gh issue create*)` and `Bash(gh label create*)` allow every repo. Only the skill text limits the target to `related[]` and `self` — Write this limit down as an accepted risk in "Decisions taken for the owner", or add a skill rule: compare `--repo` with the file before each call.
- [Performance] `ledgerState()` Step 6 calls `projByName(p.name)` per project, and each call reads and resolves the whole registry (server.mjs:255-256) — Call `allProjects()` once and look up by name.
- [Harness] The new template tests need `jq` on the test machine. No existing test in `test/bootstrap-project.test.mjs` uses it — Add it to Harness constraints.

### Edge cases the plan should address

- A project loses its group (or its GitHub remote) and gets it back later. `next.triage` keeps the old baseline, so every `needs-triage` issue opened in between makes a notification at once. Set `next.triage = null` when the project has no group, so that a regroup starts a new baseline.
- Two registry entries on the same repo in one group (the `acme-web-2` case of the `relatedRepos` test). The triage poll is per project, so each issue is read twice, shows two rows in "Needs you" and gives two notifications. Dedupe by repo, as `relatedRepos()` does.
- More than 100 open `needs-triage` issues. An issue that drops out of the first 100 and comes back counts as new and notifies again.
- A verify-mode run resumed into "to PR" mode (see Blocking 2), and a run launched by hand and resumed from the dashboard (the file appears only at resume).
- `gh label create` succeeds but `gh issue create --label needs-triage` fails because the own repo refuses the label. The `D<n>` line must say which call failed.
- A `from-pipeline` + `needs-triage` issue in the own repo is also listed by `skill-1-plan` "Open pipeline tickets". Say if a triage ticket can be merged into a plan before the owner triages it.

### Checklist

- [ ] All referenced files, lines, sections and symbols exist as stated (sibling-plan facts at plan:26 are out of date)
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done; the `extraAllow` + `issue-allow` case is missing)
- [ ] Wiring & registration matches the code (the `?checklist=` opener already comes from the sibling plan)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (local tool: the 403 Origin guard and the 400 bad group are covered; no tenants)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected (ticket evidence goes out without redaction)
- [x] Global rules affect every project respected (wording should be clearer)
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (the overlay test fails as written)
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail (`bash -n` is not an allowed command)

```
Update the plan at .plans/20261127-230102-cross-repo-defect-tickets.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In Step 12, change the hard rule of skill-auto-pipeline/SKILL.md line 25 (and line 17), so that it allows `gh label create` and `gh issue create` in item 7.5, in --stop-after=pr only, and only for the repos of the --related file and self. Add the file line to Affected files, and add a rendered-text assertion to Tests → Template tests. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:17, :25)
2. In item 7.5, also handle `ticket: would open in <repo>` lines (and `none (no list)` lines when the run now has a --related file) that have no `ticket opened: D<n>` Timeline line. A verify or commit run that is resumed into "to PR" mode must open its tickets. Add a rendered-text test. (evidence: plan:184-185; skill-auto-pipeline/SKILL.md:115, :172)
3. Rewrite Context (plan:26) against the sibling plan .plans/20261127-230101-contracts-jump-autopilot.md, which exists now. Remove the new `?checklist` boot block from Step 8 and reuse the sibling's opener. Mark `?checklist=` in Contracts (plan:77) and Wiring (plan:139) as existing from plan 5. In Step 10, use the sibling's cut pattern `checklistHtml(d, groups, pick, off = new Set())`. State the real card order: "Needs you" after ck-bar; "Contracts jump" stays after "Tickets". (evidence: sibling plan :57, :123, :128, :134, :163, :210, :213)
4. Add a redaction rule to the new "Defects in other repos" section: before you write a ticket body, a D<n> line or a PR-body line, remove or mask tokens, cookies, Authorization headers, keys, passwords, secret query values and real personal data, and use only test data. This includes the `failed (<error>)` text. Add a rendered-text assertion. (evidence: plan:70, :182, :185; server.mjs redact() at :2052 has no counterpart in the skill text)
5. Fix the template test "The ticket rules are only in the "to PR" overlay": set REPO='<tmp dir>' in the pipelineBash body, and write out-pr.json and out-v.json to absolute paths in a temp folder. (evidence: test/bootstrap-project.test.mjs:120-122; auto-pipeline.sh:38, :235)
6. Remove `bash -n skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh` from How to verify. It is not an allowed command, and the template test already runs bash -n. (evidence: .claude/settings.json:4-36; .claude/scripts/auto-pipeline.sh:62; skill-auto-pipeline/SKILL.md:30, :92)

SHOULD FIX:
1. Step 5: do not write `cache.items`. `cache` is the once() Map parameter of watchProject. Use `const tc = triageLists[proj.root]` and skip the step when it is missing. (evidence: server.mjs:2155, :2069)
2. Step 11 write_related: check `.self` with the same repo-name regex, and add a rejection case to the write_related test. (evidence: plan:174, :185)
3. Item 7.5: replace an existing `## Defects in other repos` section of the PR body instead of appending it again. Before a create on resume, look for the hidden `defect=D<n>` marker with `gh issue list --repo <repo> --label from-pipeline --search "<source PR url>"`. (evidence: plan:185)
4. Make the >100 text the same in the Deviation (plan:104, "100+") and in Step 8 (plan:170, "Only the first 100 are shown.").
5. Step 21: also update "The checklist has three parts", add a `triage-ticket` row to the events table, and add `triage` to the GET /api/ledger field list. (evidence: worktree docs/plans-dashboard.md:357-365, :375, :395)
6. Hard rules → Global rules: say that skills/bootstrap-project/ is in the symlinked skills/ folder, and that the render.mjs and verify.mjs changes take effect at once for every project that runs /bootstrap-project. (evidence: plan:58; AGENTS.md "Global rules affect every project")
7. Breaking changes: the new issue-allow check fails a project that has a gh issue/label write rule in registry extraAllow. Name the fix (move it to settings.local.json). (evidence: skills/bootstrap-project/scripts/render.mjs:404)
8. Decisions taken for the owner: say that Bash(gh issue create*) and Bash(gh label create*) allow every repo, and that only the skill text limits the target. Or add a skill rule: compare --repo with the --related file before each call.
9. Step 6: call allProjects() once in ledgerState instead of projByName() per project. (evidence: server.mjs:255-256)
10. Harness constraints: the new template tests need jq on the test machine.

ADD THESE EDGE CASES:
- A project loses its group or remote and gets it back later: set next.triage = null while it has no group, so the regroup starts a new baseline and does not notify for every issue opened in between.
- Two registry entries on the same repo in one group: dedupe the triage poll and the "Needs you" rows by repo, so each issue shows once and notifies once.
- More than 100 open needs-triage issues: an issue that drops out of the first 100 and comes back notifies again.
- The needs-triage label cannot be created or added in the own repo: the D<n> line says which gh call failed.
- skill-1-plan lists a from-pipeline + needs-triage issue of its own repo: say whether a plan may take it before the owner triages it.

Do not change anything the validation did not flag.
```
