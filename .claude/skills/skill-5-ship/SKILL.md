---
name: skill-5-ship
description: Ship the current branch — record new conventions in the right AGENTS.md, merge the base branch and resolve the conflicts (stop only on product, migration, dependency or rule-document decisions), run the checks, push the branch and open a draft PR. Run only when the owner asks for it, or from /skill-auto-pipeline in "to PR" mode.
disable-model-invocation: true
argument-hint: "[topic] [--base <branch>] [--skip-docs] [--unattended --report <path>]"
---

Ship: $ARGUMENTS

`--base` defaults to `main` (strip a leading `origin/`). `--unattended --report <path>` is set by `/skill-auto-pipeline`. `--skip-docs` skips Step 1.5. Any other text is a documentation topic for Step 1.5.

## Rules

- **Push only when allowed.** Interactive: the owner asked for `/skill-5-ship` or said "push" in the current message. Unattended: the owner chose the "to PR" mode.
- Push only the current branch, never `main`, never with `--force` or `-f`.
- The PR is always a **draft**. The owner marks it ready and merges it.
- No AI attribution in commits or the PR body.
- Run shell commands bare: one command per call, no pipes, `&&`, `$(...)`, redirection or heredocs.
- **Stage by path, and only this work.** Never `git add -A` or `git add .`. Never stage `.env*` files, `.claude/settings.local.json`, or untracked files that are not part of this work (for example the files of other plans). When a file is unclear, leave it unstaged. Step 7 lists every file left unstaged on purpose, with the reason.
- **Unattended:** never use AskUserQuestion. Every "stop" below sets the report status `BLOCKED: <one-line reason>`, writes the details under `## Diagnosis`, pushes nothing, and ends the session. When a command is denied, write the exact command in the diagnosis. Do not suggest "add an allow rule" without checking `.claude/settings.json` first: a deny rule wins over every allow rule.

## Reporting rules

These rules apply to every summary, report section, PR body, comment and status line that this skill writes. The owner reads them instead of the code, so a wrong "done" costs more than an honest "open".

- **Every claim names its evidence:** a link, a `file:line`, or the command and its result (counts, exit code). A claim without evidence is "not checked", never "done".
- **An odd value is a finding until you prove that it is harmless:** a count of 0, a skipped test, an empty file or section, a link that does not load, a status that does not match the plan. Write what you checked to clear it, or list it as open.
- **Count the real state.** A summary gives the count of the whole, for example "41 passed, 2 skipped". Never write "all done", "everything works" or "complete" unless the count shows it.
- **"Skipped" is not a result** for a check that the plan or this skill requires. A required check that did not run is open, with the reason.
- **When the evidence changes after the PR opened** (a new test result, a fix, a new browser-test report), rebuild the decision sheet and update the PR body. Each line of the sheet (for example "Browser test") must match the PR body.

## Step 1 — Preflight

1. `git branch --show-current`. Stop if it is `main`.
2. **A merge in progress.** `git status`. When it says "You have unmerged paths" or "All conflicts fixed but you are still merging", an earlier run stopped during a merge, or the owner merged by hand. Do not start a new merge. Resolve the files of `git diff --name-only --diff-filter=U` as **Resolve the conflicts** says (Step 2), and keep the files the owner already staged as they are. Then continue at its "commit the merge" item.
3. `git status --porcelain`. Stop if it shows a change that belongs to this work and is not committed, and name the files. (Interactive: ask the owner whether to commit them first.) A file that never ships (`.env*`, `.claude/settings.local.json`, the files of another plan) does not stop the ship: leave it unstaged and note it for Step 7.
4. `git log --oneline origin/<base>..HEAD`. Stop if there are no commits to ship.
5. **Re-run detection.** An earlier ship attempt can have done part of the work. Each step checks its own result first and does not do it twice: Step 1.5 skips a convention that an `AGENTS.md` already holds,
   Step 3.5 skips when the branch already adds a file under `changelog.d/`,
   and Step 6 updates the open PR of the branch instead of opening a second one.

## Step 1.5 — Docs

Skip this step with `--skip-docs`, and when `/skill-auto-pipeline` runs this skill as its ship phase: its Document phase did this step already, so the doc edits are in the one commit of the plan. When the Document phase sends you here, do the step (without its commit item).

1. **Gather.** Read the plan, the nested `AGENTS.md` of each folder the branch touches (`git diff --name-only origin/<base>...HEAD`), and the conversation. List the decisions, patterns, conventions and traps this work found. If a topic was given, focus on it.
2. **Filter.** Keep only what future work must follow and cannot see in the code: a new convention or pattern, an architecture decision, a setup change (an env value, a service, a command). Leave out, with one line of reason each: what the code shows, a one-off fix, an addition that follows a documented pattern, and anything already documented.
3. **Place.** A rule for one folder goes in the `AGENTS.md` of that folder. When the folder has none, create the pair: `AGENTS.md` with the rule, and `CLAUDE.md` next to it that holds only `@AGENTS.md`. Add one row for the new file to the **Layout** table of the root `AGENTS.md`. The root `AGENTS.md` loads in every session: put a rule there only when it applies to the whole repo.
4. **Write short.** One bullet per rule: a bold name, at most 3 sentences, and a pointer to one file that shows the pattern. Present tense, no history, no ticket or plan numbers. A rule lives in one place; elsewhere, point to it. When you update a bullet, rewrite it to fit, do not append.
5. When the repo records architecture decisions (a decisions folder that the root `AGENTS.md` names), a changed rule follows that process.
6. Commit the doc files by path: `git add -- <file> <file>`, then `git commit -m "docs(<scope>): record conventions from <slug>"`. Nothing to record → say so in one line and skip the commit.

Interactive: ask the owner only for a real either/or that the conversation does not answer, or for a rule that contradicts a documented rule. Otherwise apply and report.

## Step 2 — Merge the base branch

1. `git fetch origin <base>`.
2. `git merge --no-edit origin/<base>`.
   - "Already up to date" → Step 3.
   - Git refuses because local changes would be overwritten → stop and name the files. Only files left unstaged on purpose can cause this.
   - Merged cleanly → check the auto-merged files (below), then run the checks again (Step 3), because the base changed.
   - Conflicts → resolve them (below), check the auto-merged files, commit the merge with `git commit --no-edit`, then run the checks again (Step 3). A conflict alone never stops the ship: the owner chose "to PR" to get a PR.

### Check the auto-merged files

A file without a conflict marker can still be wrong after a merge. List the files that both sides changed. During a merge with conflicts, the two sides are `HEAD` and `MERGE_HEAD`; after a clean merge (git made the merge commit), they are `HEAD^1` and `HEAD^2`. Run `git merge-base <side 1> <side 2>` for `<mb>`, then `git diff --name-only <mb> <side 1>` and `git diff --name-only <mb> <side 2>`, each in its own call. In each file on both lists, use the Grep tool to find a duplicated import, method, function, test block, route, enum member or translation key. Remove the duplicate, and keep the base's copy when both sides added the same helper.

### Resolve the conflicts

`git diff --name-only --diff-filter=U` lists the files. For each file, run `git merge-base HEAD MERGE_HEAD`, then `git diff <merge-base> MERGE_HEAD -- <file>` (what the base changed) and `git diff <merge-base> HEAD -- <file>` (what this branch changed). Write a result that keeps both changes:

- **Both sides added different things** (imports, routes, enum members, translations, tests): keep both, in the file's order.
- **The base renamed or moved something that this branch uses:** apply this branch's change to the new name or place.
- **A version field that both sides changed** (for example `"version"` in `package.json`): start from the base's version and make this branch's step again (patch or minor, the same kind of step the branch made). Example: base `1.90.0`, branch `1.91.0` from `1.89.0` (a minor step) → `1.91.0`; base `1.91.0` → `1.92.0`.
  Then the changelog check must pass (see `.claude/skills/changelog-entry/SKILL.md`).
- **Lockfiles** (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`): take the base's file (`git restore --source=MERGE_HEAD --staged --worktree -- <file>`), then run the package manager's install so it adds this branch's dependencies again. **Generated files:** run the generator instead of editing.
- **One side deleted code that the other side shows only as unchanged context:** keep the deletion. **Both sides added the same helper:** keep the base's copy and change this branch's callers to use it.
- Keep each file's format byte for byte. Never take one whole side of a source file.
- The Grep tool finds no `^<<<<<<<`, `^=======$` or `^>>>>>>>` line in the file, then `git add -- <file>`.

Before the merge commit, check the result: no conflict markers (`git diff --check`), no reference to a name that one side removed, and the build passes (AGENTS.md, **Commands**, "Build"; when it is "not available yet", the type check or the scoped tests of the conflicted files). Then commit the merge: `git commit --no-edit`.

Stop (unattended: `BLOCKED: merge conflict in <file>`, each side's change and your proposal under `## Diagnosis`) only for these cases. Resolve and stage every other file first, leave the hard files unresolved and the merge in progress, so a later run continues it (Step 1, item 2):
- The conflict is in `docs/parent-plan.md`, an `AGENTS.md`, a rule or decision document, or a contract file. Exception: both sides only added rows or lines to the same list or table (for example two new rows in the **Layout** table of `AGENTS.md`): keep both and go on.
- Both sides changed the same behavior in ways that do not fit together: a different status code, error, validation limit, access check or scope check for one case (for example, the base made a field required and this branch removed it).
- The conflict is in a database migration, or both sides changed the same model column, enum or index: the migration can be wrong after the merge.
- One side deleted or renamed a file or symbol that the other side changed (a modify/delete conflict), and the change is not only unchanged context.
- Both sides changed the same dependency to different versions.
- The build still fails after two fix attempts.

Interactive: ask one question per hard file, in the decision question format (the facts, one example step by step, Option A (recommended) and Option B, why A). Continue after the answer.

Record each resolved file in one line (what each side changed and how you combined them) for the PR body and, unattended, the Timeline.

## Step 3 — Checks

Run the repo's real checks for the changed files (AGENTS.md, **Commands**: lint, type check, tests), each as a bare command. If a check is "not available yet", say so. A failing check → stop.

## Step 3.5 — Changelog entry

When the branch adds no file under `changelog.d/` (`git diff --name-only --diff-filter=A origin/<base>...HEAD -- changelog.d/`):

- Interactive: run `/changelog-entry <slug>`. Unattended: read `.claude/skills/changelog-entry/SKILL.md` and follow it.
- Commit the new file: `git add changelog.d/<file>`, then `git commit -m "docs(changelog): add entry for <slug>"`.
- If the skill decides that no entry is necessary, remember it: Step 6 adds the `no-changelog` label.

## Step 5 — PR body

Write the body with the Write tool. Unattended: to `<report dir>/<slug>-pr-body.md`. Interactive: to a file in the scratchpad.

When the sheet's "Browser test" line does not match the browser-test evidence (the report page, the rounds, the open findings), build the sheet again first: read `.claude/skills/decision-sheet/SKILL.md` and follow it with the same `--out`.

Sections:

```markdown
## Summary
<2–4 sentences: what changed and why, in plain words>

## Plan
`.plans/done/<plan-file>` (or `.plans/<plan-file>` when it is not moved yet)

## Changes
<one line per commit: `<hash> <subject>`, from `git log --oneline origin/<base>..HEAD`>

## Verification
| Check | Result |
| --- | --- |
| <command> | <pass / fail / not available yet, with the counts> |

## Code review
<findings fixed and findings deferred, from the report; "none" if none>

## Test review
<the `## Summary for the PR` section of the /test-review report, as it is; "not run" if it did not run>

<the decision sheet: paste `<report dir>/<slug>-decision-sheet.md` (unattended) or the `/decision-sheet` output (interactive) as it is, with its `<!-- decision-sheet:start v1 -->` and `<!-- decision-sheet:end -->` markers. Leave it out when no sheet was made.>

## Browser test
Report page: <the report page link from the browser test, `http://localhost:4898/<project>/<file>.html`> (a local page: it opens on the machine that ran the test)
<rounds; findings: <n> fixed, <n> open. "None — <reason>" when the plan's Browser test section is `None`.>

## Merge conflicts resolved
<the Step 2 list, one line per file; leave the section out when there were none>

## Open points
<questions, known limits, backend follow-ups and findings left open; "none" if none>
```

## Step 5.5 — Browser-test gate

Run it when the plan has a **Browser test** section that is not `None — <reason>`. It is a hard gate: the PR opens only when every row passes. Check each row against the evidence itself, never against an earlier summary.

| # | Pass when |
| --- | --- |
| a | The browser test ran on this branch, with a report page: the pipeline report or the `/skill-3-test` output has its rounds and the report page link. |
| b | The PR body's **Browser test** section links that report page. |

"Skipped" is never a pass. A browser test that did not run fails the gate.

Any row fails → do not push, and do not open or update the PR. Unattended: status `BLOCKED — browser test (<reason>)`, for example `BLOCKED — browser test (no report page)`, the failed rows under `## Diagnosis`, then end the session. Interactive: tell the owner which row failed and stop.

## Step 6 — Push and open the PR

1. `git push -u origin <current branch>`.
2. `gh pr create --draft --base <base> --title "<title>" --body-file <abs path to body>`. The title is a Conventional Commits subject for the whole change, for example `feat(orders): add the order export endpoint`. When the branch already has an open PR (`gh pr view --json number,url,state`), update its body instead: `gh pr edit <number> --body-file <abs path to body>`.
3. If Step 3.5 decided that no entry is necessary: `gh pr edit <number> --add-label no-changelog`.
4. Unattended: set the report status `PR OPEN — <url>` and add a line `PR: <url>` below it.

## Step 7 — Output

1. The commit titles of this step and the PR title.
2. The files left unstaged on purpose, each with the reason, or "none".
3. The resolved merge conflicts (the Step 2 list), or the stop case or failed gate that stopped the run, if any.
4. The last line is the PR link: `PR: <url>`.

## After the ship

The PR is open. Each later change that the owner asks for in this chat follows `AGENTS.md`, **Git**, "Follow-ups on an open PR": commit it by path and push it to this branch without asking. Never answer with `git add` or `git commit` commands for the owner to run.
