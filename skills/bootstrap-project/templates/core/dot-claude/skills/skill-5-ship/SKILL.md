---
name: skill-5-ship
description: Ship the current branch — merge the base branch, run the checks, push the branch and open a draft PR. Run only when the owner asks for it, or from /skill-auto-pipeline in "to PR" mode.
disable-model-invocation: true
argument-hint: "[--base <branch>] [--unattended --report <path>]"
---

Ship: $ARGUMENTS

`--base` defaults to `@@BASE_BRANCH@@`. `--unattended --report <path>` is set by `/skill-auto-pipeline`.

## Rules

- **Push only when allowed.** Interactive: the owner asked for `/skill-5-ship` or said "push" in the current message. Unattended: the owner chose the "to PR" mode.
- Push only the current branch, never `@@BASE_BRANCH@@` or `@@PROD_BRANCH@@`, never with `--force` or `-f`.
- The PR is always a **draft**. The owner marks it ready and merges it.
- No AI attribution in commits or the PR body.
- Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs.
- **Unattended:** never use AskUserQuestion. Every "stop" below sets the report status `BLOCKED: <one-line reason>`, writes the details under `## Diagnosis`, pushes nothing, and ends the session. When a command is denied, write the exact command in the diagnosis. Do not suggest "add an allow rule" without checking `.claude/settings.json` first: a deny rule wins over every allow rule.

@@REPORTING_RULES@@

## Step 1 — Preflight

1. `git branch --show-current`. Stop if it is `@@BASE_BRANCH@@` or `@@PROD_BRANCH@@`.
2. `git status --porcelain`. Stop if it is not empty, and name the files. (Interactive: ask the owner whether to commit them first.)
3. `git log --oneline origin/<base>..HEAD`. Stop if there are no commits to ship.

## Step 2 — Merge the base branch

1. `git fetch origin <base>`.
2. `git merge --no-edit origin/<base>`.
   - "Already up to date" → Step 3.
   - Merged cleanly → run the checks again (Step 3), because the base changed.
   - Conflicts → resolve them (below), commit the merge with `git commit --no-edit`, then run the checks again (Step 3). A conflict alone never stops the ship: the owner chose "to PR" to get a PR.

### Resolve the conflicts

`git diff --name-only --diff-filter=U` lists the files. For each file, run `git merge-base HEAD MERGE_HEAD`, then `git diff <merge-base> MERGE_HEAD -- <file>` (what the base changed) and `git diff <merge-base> HEAD -- <file>` (what this branch changed). Write a result that keeps both changes:

- **Both sides added different things** (imports, routes, enum members, translations, tests): keep both, in the file's order.
- **The base renamed or moved something that this branch uses:** apply this branch's change to the new name or place.
- **A version field that both sides changed** (for example `"version"` in `package.json`): start from the base's version and make this branch's step again (patch or minor, the same kind of step the branch made). Example: base `1.90.0`, branch `1.91.0` from `1.89.0` (a minor step) → `1.91.0`; base `1.91.0` → `1.92.0`.
@@IF MOD_CHANGELOG@@
  Then the changelog check must pass (see `.claude/skills/changelog-entry/SKILL.md`).
@@END@@
- **Lockfiles** (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`): take the base's file (`git restore --source=MERGE_HEAD --staged --worktree -- <file>`), then run the package manager's install so it adds this branch's dependencies again. **Generated files:** run the generator instead of editing.
- Keep each file's format byte for byte. Never take one whole side of a source file.
- The Grep tool finds no `^<<<<<<<`, `^=======$` or `^>>>>>>>` line in the file, then `git add -- <file>`.

Stop (unattended: `BLOCKED: merge conflict in <file>`, the merge left in progress, each side's change and your proposal under `## Diagnosis`) only when:
- the conflict is in `@@PARENT_PLAN@@`, `AGENTS.md` or a contract file, or
- both sides changed the same behavior in ways that do not fit together (for example, the base made a field required and this branch removed it).

Record each resolved file in one line (what each side changed and how you combined them) for the PR body and, unattended, the Timeline.

## Step 3 — Checks

Run the repo's real checks for the changed files (AGENTS.md, **Commands**: lint, type check, tests), each as a bare command. If a check is "not available yet", say so. A failing check → stop.
@@IF MOD_CHANGELOG@@

## Step 3.5 — Changelog entry

When the branch adds no file under `changelog.d/` (`git diff --name-only --diff-filter=A origin/<base>...HEAD -- changelog.d/`):

- Interactive: run `/changelog-entry <slug>`. Unattended: read `.claude/skills/changelog-entry/SKILL.md` and follow it.
- Commit the new file: `git add changelog.d/<file>`, then `git commit -m "docs(changelog): add entry for <slug>"`.
- If the skill decides that no entry is necessary, remember it: Step 5 adds the `no-changelog` label.
@@END@@

@@IF HAS_TICKETS@@
## Step 4 — Evidence on each ticket

For each ticket on the plan's **Tickets** line (skip this step when the plan has none):

1. Write the comment with the Write tool, to `body.md` in its own folder next to the PR body (unattended: `<report dir>/<slug>-evidence-<n>/`; interactive: the scratchpad):

   ```markdown
   **<What is different for the user, in one sentence.>**

   <How it was checked: date, tests, and the browser test (viewport, account, test data) when one ran.> Before = `<base>` <hash>; after = branch `<current branch>` <hash>.

   | Done when | Result | How it was checked |
   | --- | --- | --- |
   | <the ticket's line, word for word> | Met / Partly / Not met | <test name, numbers, file:line> |
   ```

@@IF HAS_BROWSER_TEST@@
   When the plan has a **Browser test** section that is not `None`, add the before/after pictures of the browser test to the same comment, the way the `browser-usability-test` skill posts pictures on a ticket (its section "Upload evidence to GitHub"): copy the pictures next to `body.md` as `1-before.png`, `1-after.png`, and so on, and add for each pair a `**Before:** <what the user sees>` line with `![Before: <what the picture shows>](./1-before.png)`, then the same for After. Unattended: post them without asking.
@@END@@
2. Post it: `gh issue comment <n> --body-file <abs path to body.md>`, with one `--attach <abs path>` for each picture (gh uploads it and rewrites its `./` reference).
3. Read it back: `gh api repos/<owner>/<repo>/issues/comments/<id> --jq .body`. Note the comment link.
@@IF HAS_BROWSER_TEST@@
   With pictures: the body has one `https://github.com/user-attachments/` link per picture and no `./` left, and each link loads (`curl -s -o /dev/null -w %{http_code} <url>` prints 200 or 302).
@@END@@
4. Keep, for each ticket, the comment link and each picture line exactly as the comment has it (the `**Before:**` / `**After:**` caption line and the `![…](https://github.com/user-attachments/...)` image line). Step 5 copies them into the PR body.

@@END@@
## Step 5 — PR body

Write the body with the Write tool. Unattended: to `<report dir>/<slug>-pr-body.md`. Interactive: to a file in the scratchpad.
@@IF MOD_DECISION_SHEET@@
@@IF HAS_BROWSER_TEST@@

The decision sheet is usually built before Step 4 posted the pictures. When its "Browser test" line does not match the evidence of Step 4, build the sheet again first: read `.claude/skills/decision-sheet/SKILL.md` and follow it with the same `--out`.
@@END@@
@@END@@

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
@@IF MOD_TEST_REVIEW@@

## Test review
<the "Summary for the PR" block from /test-review; "not run" if it did not run>
@@END@@
@@IF MOD_DECISION_SHEET@@

<the decision sheet: paste `<report dir>/<slug>-decision-sheet.md` (unattended) or the `/decision-sheet` output (interactive) as it is, with its `<!-- decision-sheet:start v1 -->` and `<!-- decision-sheet:end -->` markers. Leave it out when no sheet was made.>
@@END@@
@@IF HAS_BROWSER_TEST@@

## Browser test
Report page: <the report page link from the browser test, `http://localhost:4898/<project>/<file>.html`> (a local page: it opens on the machine that ran the test)
<rounds; findings: <n> fixed, <n> open; "<k> of <n> tickets have pictures">

### #<ticket>
Evidence: <the comment link from Step 4>

**Before:** <the caption line, copied from the comment>
![Before: <what the picture shows>](<the same https://github.com/user-attachments/... URL>)

**After:** <the caption line, copied from the comment>
![After: <what the picture shows>](<the same https://github.com/user-attachments/... URL>)

<one `### #<n>` block for each ticket of the plan, with every picture of its comment. Copy the image lines; never upload a picture again. "None — <reason>" when the plan's Browser test section is `None`.>
@@END@@

## Open points
<questions, known limits, backend follow-ups and findings left open; "none" if none>
@@IF HAS_TICKETS@@

<one line per ticket of the plan: `Closes #<n>` when every "Done when" line of the ticket is met, else `Refs #<n>`>
@@END@@
```
@@IF HAS_BROWSER_TEST@@

## Step 5.5 — Browser-test gate

Run it when the plan has a **Browser test** section that is not `None — <reason>`. It is a hard gate: the PR opens only when every row passes. Check each row against the evidence itself (the comments read back in Step 4, the PR body file), never against an earlier summary.

| # | Pass when |
| --- | --- |
@@IF HAS_TICKETS@@
| a | Each ticket on the plan's **Tickets** line has an evidence comment with at least one Before and one After picture, and each picture link loads. |
| b | The PR body's **Browser test** section has a `### #<n>` block for each ticket, with its comment link and the same picture lines as its comment. |
@@END@@
| c | The PR body links the report page of the browser test. |

@@IF HAS_TICKETS@@
A plan without a **Tickets** line has no comment to check: rows a and b do not apply, and the Browser test section says so.
@@END@@
"Skipped" is never a pass. A browser test that did not run fails the gate.

Any row fails → do not push, and do not open or update the PR. Unattended: status `BLOCKED — browser test (<reason>)`, for example `BLOCKED — browser test (#571 has no pictures)`, the failed rows under `## Diagnosis`, then end the session. Interactive: tell the owner which row failed and stop. Write the count in the report Timeline either way: "<k> of <n> tickets have pictures".
@@END@@

## Step 6 — Push and open the PR

1. `git push -u origin <current branch>`.
2. `gh pr create --draft --base <base> --title "<title>" --body-file <abs path to body>`. The title is a Conventional Commits subject for the whole change, for example `feat(orders): add the order export endpoint`. When the branch already has an open PR (`gh pr view --json number,url,state`), update its body instead: `gh pr edit <number> --body-file <abs path to body>`.
@@IF MOD_CHANGELOG@@
3. If Step 3.5 decided that no entry is necessary: `gh pr edit <number> --add-label no-changelog`.
@@END@@
4. Unattended: set the report status `PR OPEN — <url>` and add a line `PR: <url>` below it.
@@IF HAS_BOARD@@

## Step 6.5 — Board status

For each `Closes` ticket of the PR body: set its Status to "@@BOARD_STATUS@@" on project @@BOARD_NUMBER@@ of `@@BOARD_OWNER@@`. Leave `Refs` tickets as they are.

1. `gh project field-list @@BOARD_NUMBER@@ --owner @@BOARD_OWNER@@ --format json`: find the id of the Status field and of its "@@BOARD_STATUS@@" option. Never hard-code these ids.
2. `gh project view @@BOARD_NUMBER@@ --owner @@BOARD_OWNER@@ --format json`: take the project id.
3. `gh project item-list @@BOARD_NUMBER@@ --owner @@BOARD_OWNER@@ --format json --limit 500`: find the item of the ticket. No item → write it under Open points; do not add it.
4. `gh project item-edit --id <item id> --project-id <project id> --field-id <field id> --single-select-option-id <option id>`.
5. Read it back with the item list. A failure here does not stop the ship: write it in the report Timeline.
@@END@@

## Step 7 — Output

1. The PR title.
2. Merge conflicts or a failed gate that stopped the run, if any.
3. The last line is the PR link: `PR: <url>`.
