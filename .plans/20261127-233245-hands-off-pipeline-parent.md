# Plan: Hands-off pipeline runs (the owner only looks at screens and merges): parent plan

> **Master plan.** This file holds no implementation steps. Each plan below gets its own child plan through /skill-1-plan, and only those child plans are implemented. Each child plan names this file in its - **Parent**: line.

- **Base**: main

## Goal

After a "to PR" run, the owner does almost nothing by hand. The run applies the owner's standing answers by itself, posts the PO questions and the backend tickets, fixes its deferred findings, keeps its PR up to date with the base branch, and ends with a PR whose top shows the screens (before/after pictures, the browser-test report). The owner looks at the screens, answers the few items that really need a person, and merges.

All changes go into the templates in `skills/bootstrap-project/templates/` (and the dashboard watcher for plan 4), so every bootstrapped repo gets them through `/bootstrap-project --upgrade`.

Example, end to end (made-up values):
1. The owner launches the plan `20261201-090000-invoice-filter` of `acme/web` in "to PR" mode. The run opens draft PR `acme/web#40`.
2. The review loop hit its cap with one deferred finding F3 (a missing empty state). The finish step fixes F3 in one more round, runs the scoped tests, and ticks "F3 fixed (rule: deferred finding)" in the sheet.
3. The run chose "filter resets on page change" because the plan was silent. The sheet ticks it under "Decided by policy" (rule: unplanned choice, keep what was built), and the PR body says so.
4. The run had to pick a default sort for the new list (a product choice). It ships option A, posts one comment on ticket `acme/web#31` ("What: …, Why: …, A (shipped): …, B: …") with the PO login `ana-po` assigned, and ticks the item with the comment link.
5. The API gives no `currency` field. The run opens `acme/web#41` with the backend label, the assignee, the board and the Status column of `#31`, and ticks the item with the issue link.
6. The sheet says "Needs you: none", the status is green, and the PR body starts with the before/after pictures of each "Done when" line.
7. Later the owner merges `acme/web#38`. The watcher sees the merge to `develop`, merges `develop` into `auto/20261201-090000-invoice-filter`, gives `package.json` the next free version step, runs the checks and pushes. The owner gets no prompt.

## Findings (evidence of 26 to 27 Nov 2026)

The evidence comes from the sessions of the first target project (a frontend repo of a client, with a separate backend team and a PO who answers on GitHub tickets). The client data stays out of this public repo; the numbers below are the generic result.

### What the owner did by hand after each run

- After almost every "to PR" run (about 12 times in 2 days) the owner typed the same follow-up: fix the findings from the report and the PR decisions; a backend gap becomes a backend ticket; a PO question becomes a ticket comment; then merge the parent branch; then "guide me through the rest".
- The answers per kind of decision were always the same:
  - Deferred finding (the review loop cap ended the loop): always "fix it".
  - Choice nobody planned: almost always A (keep what was built).
  - UI, product or accessibility choice: always "ship A, post the question on the ticket; the PO opens a QA ticket when they want B".
  - Backend gap: always "open a backend issue". The run cannot do it: today its only network writes are the push and the PR.
  - Release coupling (for example "this PR needs a backend PR first"): a standing rule, but still asked.
  - Version conflict: every PR raises `version` in `package.json`, so each merge to the base gives every other open PR a conflict. The owner ran `/merge-parent` by hand on each one.
- The questions were hard to read: the owner wrote "I do not understand, what is the problem?" 3 times.
- Permission stops: 3 times, in headless runs and in follow-up sessions (dashboard chats after the run).
- Follow-ups start from a compacted session, so the report must hold every fact the follow-up needs (the report protocol of `skill-auto-pipeline` already says so).

### What the templates and the dashboard already have

- `skill-4-verify` (template): a review loop of max 2 rounds; a VALID finding with no clear fix, or one the cap leaves, is "deferred" and goes under Open items (Step 1 items 3 to 6, "Converged" and "Only deferrals left"). The caps come from `.plans/done/20261125-210049-review-loop-caps.md`.
- The decision sheet (module `decision-sheet`, `SKILL.md` Steps 2 to 5): in "to PR" mode it runs before the commit with `--fix` and fixes its VALID Codex findings (`.plans/done/20261124-161043-pipeline-diet-templates.md`, owner decision 3B). It asks at most 5 questions of six kinds (behavior, breaking, production, access, choice nobody planned, open finding). Each question is one checkbox line plus at most 3 lines, not the owner's question format.
- The "Decision Sheet" CI check (`decision-sheet.yml`) fails while a line `- [ ] <n>.` is in the sheet, and passes when every box is ticked. A ticked box passes already, so a ticked "Decided by policy" item needs no CI change.
- `/pr-feedback` (module) keeps the owner's ticks by box text, and only a comment counts as a "no" (Step 4, "Keep the owner's ticks").
- `skill-5-ship` (template): Step 2 merges the base and already resolves a version field that is the only conflict hunk ("make this branch's step again"); Step 4 posts the evidence comment with before/after pictures on each ticket; Step 5 writes the PR body (Summary, Plan, Changes, Verification, Code review, Test review, Browser test, …, Open points); Step 6.5 moves the tickets on the board.
- `render.mjs`: with tickets, every run already gets `Bash(gh issue comment*)`; with a board, `Bash(gh project item-edit*)` and the other `gh project` read rules (`runExtra`, lines 459 to 461). `Bash(gh issue create*)` comes with pipeline diet plan 2 (below), in the "to PR" overlay only.
- `merge-parent` is a global skill (`skills/merge-parent/SKILL.md`), not a template. Its commands use pipes, `2>/dev/null` and `$(…)`, so a headless run cannot use it as it is. The dashboard chat's "Fix conflicts" button sends `/merge-parent <base>` into the plan chat (`apps/dashboard/page/app.js`, `paintSync()`).
- The event watcher (`apps/dashboard/server.mjs`, `watchProject()` step 1): `readUpdatedPrs()` reads every PR of the repo sorted by update, with no base filter, and `prEvents()` (`apps/dashboard/watch.mjs`) gives a `pr-merged` event with `base: <baseRefName>`. So the watcher sees a merge to `develop` (or any base) of a client repo each minute. `pullRoot()` pulls only when the main checkout is on that base. A direct push to the base (no PR) gives no event.
- `pipelineLive()` sees a run only by the process text `skill-auto-pipeline <slug>.md`. A new session for the same plan must start with that text to count as live.

### Plans that overlap

- Pipeline diet plan 2, `.plans/20261127-230102-cross-repo-defect-tickets.md`: the run opens a ticket in another repo of the 2a group (item 7.5 "Tickets" of `skill-auto-pipeline`), labels `from-pipeline` and `needs-triage`, only in "to PR" mode, the target list from the group (its 5A), never the own repo except for triage. The first target project files backend issues in its own repo with a backend label, so it needs one routing rule more.
- Orchestrator parent `.plans/20261123-100855-orchestrator-parent.md`, phase 4: the question source, one parent issue with one sub-issue per question, three question kinds (blocking, check after push, for information), the plan section `## Decisions taken for the owner` and its "do you agree?" lines in the decision sheet.
- `.plans/20261125-125414-run-command-allow-rules.md` (written, never launched): allow rules for the repo's own command rows that a run uses (`run: true`), and the launch preflight check.
- The chain of `Waits for` lines now: 2a (PR #13) → `20261127-230101-contracts-jump-autopilot` (orchestrator phase 5) → `20261127-230102-cross-repo-defect-tickets` (diet 2) → `20261127-230103-template-updates-collector` (fleet 2) → `20261127-230104-plans-mac-native-parts` (Shipyard 2b). Diet 2 and fleet 2 change `render.mjs`, `references/contracts.md` and `test/bootstrap-project.test.mjs`, which every plan below changes too. Shipyard 2b changes `apps/dashboard/server.mjs` and `app.js`, which plan 4 changes.

## Decisions taken by the owner (2026-11-27)

- The goal: the owner only looks at the generated screens and merges. Everything else follows a written policy.
- The changes go into the templates, so `/bootstrap-project --upgrade` brings them to every project. The upgrade shows the new files as a diff. The 6 files that the owner keeps merged by hand in the first target project stay as they are: the gate workflow, `AGENTS.md`, `README.md`, the changelog docs and the plan-lanes CONFIG.
- The standing answers per kind, as listed under Findings, become the policy (Part A below).
- Project values (the backend label, the assignee, the PO login, the board and its columns) come from `.claude/bootstrap.json`, filled by the interview. Nothing is hardcoded in a template.
- The finish step is a new skill. The existing skill names stay (the dashboard depends on them).
- Never push the base branch, never force-push. Shell commands in skills stay bare.
- No em dash in skill text, ASD-STE100, no AI attribution.

## Proposed design

### A. The policy file `.claude/decision-policy.md`

- A new template in the `decision-sheet` module, rendered from a new `bootstrap.json` key `policy`. It holds the owner's standing answers, one action per kind:

| Kind | Action of the run | Sheet section |
| --- | --- | --- |
| Deferred finding (loop cap, no clear fix in the loop) | Fix it in one more round (finish step), with scoped tests and a revert check | Decided by policy |
| Choice nobody planned | Keep what was built (A); write it in the PR body | Decided by policy |
| UI, product or accessibility choice | Ship A; post the question as a comment on the plan's ticket (what, why, A shipped, B), assign the PO | Decided by policy |
| Backend gap (the frontend needs data or behavior the API lacks) | Open a backend issue through the one ticket path of diet 2, with the project's routing values | Decided by policy |
| Older defect found on the way | Fix it when the fix is small and in a file the PR touches; else a follow-up ticket through the same ticket path | Decided by policy |
| Release coupling (this PR needs another PR first) | State the standing rule in the PR body Open points; do not ask | Decided by policy |
| Access or security change; data loss, deletion or migration in production; ticket text and plan disagree; the review loop oscillates on the same code; no rule covers it | Ask the owner (Q1) | Needs you |

- New `bootstrap.json` fields (`references/contracts.md` "bootstrap.json"), all optional, empty = the action falls back to "write it in the PR body": `policy.po.assignee` (the PO's GitHub login, for example `ana-po`), `policy.backend.repo` (`self` or `owner/repo`, for example `acme/api`), `policy.backend.labels[]` (for example `["backend"]`), `policy.backend.assignee`, `policy.backend.board` (`{owner, number}`; default `git.tickets.board`), `policy.backend.status` (`same-as-ticket`, or a column name).
- The run reads the file; it never edits it (a headless run cannot write under `.claude/`). The owner changes it through `bootstrap.json` and `--upgrade`.

### B. The decision sheet in two sections

- The sheet keeps its markers and its checkbox format (the CI check and `/pr-feedback` read them). It gets two sections: **Decided by policy** (ticked boxes, each with the kind, the rule and a link to the comment, the ticket or the commit) and **Needs you** (unticked boxes, only the kinds of the last table row).
- Each "Needs you" item uses the owner's question format: plain words, one example step by step with real values, Option A (recommended), Option B, why A. The CI check still sees one `- [ ] <n>.` line per item; the format lines are indented under it.
- The numbers run across both sections, so `/pr-feedback` keeps matching boxes by text.
- Status: zero "Needs you" items and every check ran → 🟢. The 5-question limit counts only "Needs you" items.
- An item whose action is not done yet (plan 1 runs before the finish step exists) is ticked with `action: open (<what>)`, so the owner sees the work that plan 3 later does by itself.
- The plan's `## Decisions taken for the owner` lines (orchestrator phase 4) go into "Decided by policy" as "decided in the plan, do you agree?" items. Unticking one is a "no", and the owner comments and runs `/pr-feedback`.

### C. The finish step `/skill-6-finish`

- A new template skill in the `decision-sheet` module. In "to PR" mode `skill-auto-pipeline` reads and follows it after `skill-5-ship` set `PR OPEN` and after item 7.5 "Tickets" (it needs the PR link, as diet 2's tickets do). It also runs alone in a follow-up session: `/skill-6-finish <PR#>`.
- Parts, in order, each recorded in the Timeline so a resume skips what is done:
  1. **Deferred findings.** One more fix round for the items that verify, the test review or the sheet left open (kind 6). No new reviewer run: the loop caps stay as they are. Scoped tests and the check-only lint for each touched file, a revert check for each new test (the `/test-review` rules), then the full test command once. A finding that the round cannot fix becomes a "Needs you" item. A fix that undoes an earlier fix is an oscillation: no change, a "Needs you" item.
  2. **Policy actions.** PO comments on the plan's ticket (`gh issue comment`, with the hidden marker `<!-- po-q id=<slug>-q<n> plan=<slug> kind=check-after-push -->` of orchestrator phase 4, and the PO as assignee); backend issues and follow-up tickets through item 7.5 of diet 2 with the policy routing. A duplicate check before each new issue: `gh search issues` in the target repo for the same endpoint or field, open issues only; a match gets a comment with the PR link instead of a new issue.
  3. **Merge the base.** The rules of `skill-5-ship` Step 2 (they are headless-safe and already resolve the version field), then the checks of Step 3. When the merge brought commits and the plan has a browser test, run the browser test again on the merged tree and replace the pictures.
  4. **Rebuild and push.** Build the sheet again (`--no-codex`, keep the Codex line), replace the sheet and the evidence blocks in the PR body (`gh pr edit`), push the `auto/*` branch (never `--force`).
- Allow rules: `gh issue comment`, `gh project item-edit` and the `gh project` reads exist already with tickets and a board (`render.mjs` `runExtra`). Diet 2 adds `gh issue create` and `gh label create` to the "to PR" overlay and `gh issue list` to the shared list. This plan adds `Bash(gh search issues*)` (read only) and nothing else.

### D. Keep the open `auto/*` PRs up to date (started by the watcher)

- A follow-up of the `pr-merged` event in `watchProject()`, not a separate script and not `/loop`. After a PR of project P merges into base B, the watcher finds the other open `auto/*` PRs of P with base B (the PR cache of `refreshPrList()`), and for each one whose run worktree exists, with no live run, no busy chat and room under `WATCH_LIMIT`, starts `auto-pipeline.sh --update <slug>`.
- `--update` starts a headless session with `/skill-auto-pipeline <slug>.md --report=<report> --stop-after=pr --base=<B> --update`, so `pipelineLive()` sees it with no change. With `--update` the skill follows only part 3 and part 4 of `/skill-6-finish` (merge, version step, checks, rebuilt sheet, push) and sets the status back to the `PR OPEN` status line of the report protocol.
- The watcher stores the base tip it updated against per slug in `watch.json`, so one merge gives one update per PR. An update that ends in the same `PR OPEN` state gives no notification; a stop state (`BLOCKED: merge conflict in <file>`, `FAILED`) gives one.
- A version conflict gets the next free version step (`skill-5-ship` Step 2 rule). The base is never pushed, nothing is force-pushed.
- A direct push to the base (no PR) gives no event. The next PR merge, or the chat's "Fix conflicts" button, covers it.
- Alternative (Q2 B): CI sets the version at merge, and a PR carries only its changelog entry. That removes the conflict at its cause, but changes the "one version step per PR" rule and the changelog gate of every project.

### E. The PR body leads with the evidence

- `skill-5-ship` Step 5: the body starts with one block per "Done when" line of the ticket (the line, the before/after pictures of Step 4, the browser-test report page link), then the Summary. "Needs you" comes at the bottom, before Open points. The machine checks (Verification, Code review, Test review) go into collapsed `<details>` blocks.
- The Step 5.5 browser-test gate keeps its rows; only the place of the blocks changes.

### F. Close the permission gaps

- The owner runs `/fewer-permission-prompts` in the first target project over its session transcripts of 26 to 27 Nov, by hand (the transcripts hold client data, so no run of this repo reads them). The owner gives the plan the generic command shapes only, for example `git -C <submodule> log*`.
- The plan adds the missing read-only commands to the shared allow list of `render.mjs`, and the missing pipeline commands of the new skills to the run overlay, with the "bare command" form. `verify.mjs` keeps refusing write rules in the shared list (the `push-allow` and diet 2 `issue-allow` checks).
- It builds on `20261125-125414-run-command-allow-rules`: that plan gives the repo's own command rows their rules; this plan adds what the transcripts still show.

### Fit with orchestrator phase 4

- "Needs you" = a *blocking* question. "Decided by policy" = *check after push* (an unplanned choice A, a PO comment) or *for information* (a fixed deferred finding, a fixed older defect, a stated release rule).
- The ticket comment of Part C is the first, simple PO channel. It carries the phase 4 marker, so phase 4 can read the PO's answers later. Phase 4 replaces only the transport (one parent issue with one sub-issue per question); the policy file, the sheet sections and the finish step stay.
- A PO "no" on a check-after-push comment becomes a QA ticket by the PO (the owner's standing answer), and later a follow-up ticket through phase 4.

## Plans in order

### 1. Decision policy and the two-section sheet: `.plans/<ts>-hands-off-decision-policy.md`

- **Scope:** Parts A and B. The policy template, the `policy` fields in `bootstrap.json` and the interview, the sheet's two sections, the owner's question format for "Needs you", the green status rule, the plan's `## Decisions taken for the owner` lines as "do you agree?" items. The owner can try it on the next run: the sheet shows what the policy decided and what needs a person, before any action is automatic.
- **Files:** `skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/decision-policy.md` (new), `templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md`, `templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md` (the Needs decision section points to the policy), `scripts/render.mjs` (the `policy` vars, `checkParams()`), `references/contracts.md` ("bootstrap.json" rows, "Fixed names": the file and the two section names), `references/checklist.md` (the interview rows), `references/bootstrap.example.json`, `test/bootstrap-project.test.mjs`, `changelog.d/<ts>-hands-off-decision-policy.yaml`.
- **Owner decisions:** the policy table above (2026-11-27). Q1 decides the last table row.
- **Open decisions:** Q1.
- **Waits for:** `claude-config plan 20261127-230103-template-updates-collector merged` (fleet 2 changes `render.mjs`, `contracts.md` and the test file). It can run at the same time as Shipyard 2b (no shared file except a changelog entry of its own).

### 2. The PR body leads with the evidence: `.plans/<ts>-pr-body-evidence-first.md`

- **Scope:** Part E. The body order of `skill-5-ship` Step 5, the collapsed machine checks, "Needs you" at the bottom, the commit-mode PR body of `skill-auto-pipeline` in the same order.
- **Files:** `templates/core/dot-claude/skills/skill-5-ship/SKILL.md`, `templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md` (commit mode item 1), `templates/modules/pr-feedback/dot-claude/skills/pr-feedback/SKILL.md` (it rewrites the body), `test/bootstrap-project.test.mjs`, `changelog.d/<ts>-pr-body-evidence-first.yaml`.
- **Owner decisions:** none beyond the goal.
- **Open decisions:** none.
- **Waits for:** `claude-config plan <ts>-hands-off-decision-policy merged` (the section names, and both change `skill-auto-pipeline` and the test file).

### 3. The finish step: `.plans/<ts>-pipeline-finish-step.md`

- **Scope:** Part C. The `skill-6-finish` template, its call in `skill-auto-pipeline` after item 7.5, the policy routing in item 7.5 (own repo with the backend label, assignee, board and Status column), the PO comment with the phase 4 marker, the duplicate check, the merge and the browser test on the merged tree, the rebuilt sheet and body, the push. The owner tries it on one run: it ends with "Needs you: none" and the comments and issues linked.
- **Files:** `templates/modules/decision-sheet/dot-claude/skills/skill-6-finish/SKILL.md` (new), `templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md`, `templates/core/dot-claude/scripts/auto-pipeline.sh` (the finish part of the overlay, if one is missing after diet 2), `templates/core/AGENTS.md.tmpl` (Workflow line), `scripts/render.mjs` (`Bash(gh search issues*)`, the module file list), `scripts/verify.mjs` (the finish rules are not in the shared list), `references/contracts.md` (Fixed names: `skill-6-finish`, the Timeline lines, the marker), `test/bootstrap-project.test.mjs`, `changelog.d/<ts>-pipeline-finish-step.yaml`.
- **Owner decisions:** the finish step is a new skill; the names of the existing skills stay.
- **Open decisions:** none of its own; it follows Q1.
- **Waits for:** `claude-config plan <ts>-pr-body-evidence-first merged` (it uses the body order, and the three plans change the same files).

### 4. Keep open `auto/*` PRs up to date: `.plans/<ts>-keep-auto-prs-updated.md`

- **Scope:** Part D. The watcher follow-up of `pr-merged`, the new registry field (Q3), `auto-pipeline.sh --update <slug>`, the `--update` argument of `skill-auto-pipeline`, the base tip in `watch.json`, the notification rule, tests with the fake `gh`.
- **Files:** `apps/dashboard/server.mjs` (`watchProject()` follow-up, `resolveProject()` and `cleanEntry()` field), `apps/dashboard/watch.mjs` (a pure helper that picks the PRs to update), `apps/dashboard/test/watcher.test.mjs`, `apps/dashboard/test/` unit case of the helper, `apps/dashboard/page/app.js` (the Settings input of the field), `templates/core/dot-claude/scripts/auto-pipeline.sh` (`--update`), `templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md` (`--update`), `docs/plans-dashboard.md` (registry row, events table), `changelog.d/<ts>-keep-auto-prs-updated.yaml`.
- **Owner decisions:** started by the watcher; never push the base, never force-push.
- **Open decisions:** Q2 (the script or CI sets the version), Q3 (opt-in per project). With Q2 B this plan shrinks to the CI change and a changelog gate change.
- **Waits for:** `claude-config plan <ts>-pipeline-finish-step merged` and `claude-config plan 20261127-230104-plans-mac-native-parts merged` (Shipyard 2b changes `server.mjs` and `app.js`). After the merge, the owner restarts the dashboard (AGENTS.md "Restart after dashboard changes").

### 5. Close the permission gaps: `.plans/<ts>-pipeline-permission-gaps.md`

- **Scope:** Part F. The command shapes from the owner's `/fewer-permission-prompts` pass, added to the shared allow list (read only) or the run overlay (pipeline writes), plus the commands of the skills of plans 1 to 4 that a test run still shows missing.
- **Files:** `scripts/render.mjs`, `templates/core/dot-claude/scripts/auto-pipeline.sh` (overlay), `scripts/verify.mjs` (only when a new write rule needs a guard), `references/lessons.md` (one lesson line), `test/bootstrap-project.test.mjs`, `changelog.d/<ts>-pipeline-permission-gaps.yaml`.
- **Owner decisions:** the transcripts stay in the client project; only generic command shapes come into this repo.
- **Open decisions:** none.
- **Waits for:** `claude-config plan <ts>-keep-auto-prs-updated merged` (so it sees the commands of every new skill). `20261125-125414-run-command-allow-rules` goes before plan 1 (proposal below), so its rules are there first.

### Place in the chain

- Proposed order: 2a → 230101 → 230102 (diet 2) → 230103 (fleet 2) → `20261125-125414-run-command-allow-rules` → plan 1 → plan 2 → plan 3 → plan 4 (also after 230104) → plan 5.
- `20261125-125414-run-command-allow-rules` gets `- **Waits for**: claude-config plan 20261127-230103-template-updates-collector merged`, and plan 1 then waits for `claude-config plan 20261125-125414-run-command-allow-rules merged` in place of fleet 2. Reason: it is written and small, it removes the "one hour, then BLOCKED" stops at once, and it changes `render.mjs`, `contracts.md`, `checklist.md` and the test file, as plan 1 does.
- Shipyard 2b (230104) changes no template file, so it runs at the same time as plans 1 to 3.

### Changes that other plans need

- Diet 2 (`20261127-230102-cross-repo-defect-tickets`), "Decisions taken for the owner": "Item 7.5 'Tickets' is the one path for every issue a run opens. A later plan of `.plans/20261127-233245-hands-off-pipeline-parent.md` adds the policy routing of `.claude/decision-policy.md` to this item (a target `self` with the project's backend label, an assignee, a board and a Status column); it adds no second ticket path." No step of diet 2 changes.
- Orchestrator parent, phase 4: "The `## Decisions taken for the owner` lines and their 'do you agree?' boxes come from hands-off plan 1 (`.plans/20261127-233245-hands-off-pipeline-parent.md`, 'Decided by policy'); the first PO channel is the ticket comment of hands-off plan 3, with the `<!-- po-q … -->` marker. Phase 4 replaces only the transport (sub-issues), and maps 'Needs you' to blocking and 'Decided by policy' to check after push or for information."
- `docs/roadmap.md`, "Parent plans": "- **Hands-off pipeline runs**: [.plans/20261127-233245-hands-off-pipeline-parent.md](../.plans/20261127-233245-hands-off-pipeline-parent.md): after a "to PR" run the owner only looks at the screens and merges; a written policy decides the usual questions, a finish step posts the PO comments and the backend issues and fixes the deferred findings, and the watcher keeps open PRs up to date with the base. Five plans; none written yet."

## Done when

- A "to PR" run in the first target project ends with no deferred finding, the PO comments and the backend issues posted by the run and linked in the sheet, the base merged in, the browser test run on the merged tree, and "Needs you: none" for a normal PR.
- An open `auto/*` PR gets the base merged and its version conflict resolved, with no owner prompt, after another PR merges.
- No permission prompt in a headless run or a follow-up session for the commands of the pipeline skills.
- `/bootstrap-project --upgrade` in the first target project shows the new files as a diff, and the 6 files that the owner keeps merged by hand stay as they are.
- No em dash in the new skill text, ASD-STE100, no AI attribution.

## Open decisions

- **Q1: Who decides the items that no rule covers** (an access change, data loss in production, ticket text against the plan, a loop that oscillates). A (recommended): the owner. They are "Needs you" items and the PR status is red until the owner ticks them; this is about 1 PR in 5 in the evidence. B: the pipeline picks the safer option, ticks it and writes a ticket comment. Why A: these are the cases the orchestrator parent already keeps with the owner (Q2 there: "data loss, security, a breaking contract, production impact"), and a wrong guess there is costly and hard to undo.
- **Q2: Who resolves the version conflict between open PRs.** A (recommended): the watcher starts the update of each open `auto/*` PR, which merges the base and takes the next free version step (Part D). B: CI sets the version at merge and a PR carries only its changelog entry; this changes the "one version step per PR" rule and the changelog gate of every project. Why A: it uses the rule `skill-5-ship` Step 2 already has, it keeps every project's release process, and it also keeps PRs free of other conflicts.
- **Q3: Which projects get the automatic PR update.** A (recommended): opt-in per project with a new registry field (off by default), as `watchSubmodules` in orchestrator phase 5 (its 1A). B: on for every project with a pipeline. The owner must decide because the update pushes to PR branches without a run launch, which today only the "to PR" launch permits. Why A: the owner turns it on first for the first target project, and nothing changes for the others.
