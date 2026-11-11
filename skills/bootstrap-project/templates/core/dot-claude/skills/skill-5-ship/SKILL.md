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

## Step 1 — Preflight

1. `git branch --show-current`. Stop if it is `@@BASE_BRANCH@@` or `@@PROD_BRANCH@@`.
2. `git status --porcelain`. Stop if it is not empty, and name the files. (Interactive: ask the owner whether to commit them first.)
3. `git log --oneline origin/<base>..HEAD`. Stop if there are no commits to ship.

## Step 2 — Merge the base branch

1. `git fetch origin <base>`.
2. `git merge --no-edit origin/<base>`.
   - "Already up to date" → Step 3.
   - Merged cleanly → run the checks again (Step 3), because the base changed.
   - Conflicts → stop. Leave the merge in progress, and list the conflicted files. Do not resolve conflicts in `@@PARENT_PLAN@@`, `AGENTS.md` or contract files by guessing. (Interactive: the owner can run `/merge-parent`.)

## Step 3 — Checks

Run the repo's real checks for the changed files (AGENTS.md, **Commands**: lint, type check, tests), each as a bare command. If a check is "not available yet", say so. A failing check → stop.
@@IF MOD_CHANGELOG@@

## Step 3.5 — Changelog entry

When the branch adds no file under `changelog.d/` (`git diff --name-only --diff-filter=A origin/<base>...HEAD -- changelog.d/`):

- Interactive: run `/changelog-entry <slug>`. Unattended: read `.claude/skills/changelog-entry/SKILL.md` and follow it.
- Commit the new file: `git add changelog.d/<file>`, then `git commit -m "docs(changelog): add entry for <slug>"`.
- If the skill decides that no entry is necessary, remember it: Step 5 adds the `no-changelog` label.
@@END@@

## Step 4 — PR body

Write the body with the Write tool. Unattended: to `<report dir>/<slug>-pr-body.md`. Interactive: to a file in the scratchpad. Sections:

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
| <command> | <pass / fail / not available yet> |

## Code review
<findings fixed and findings deferred, from the report; "none" if none>
@@IF MOD_TEST_REVIEW@@

## Test review
<the "Summary for the PR" block from /test-review; "not run" if it did not run>
@@END@@
@@IF MOD_DECISION_SHEET@@

<the decision sheet: paste `<report dir>/<slug>-decision-sheet.md` (unattended) or the `/decision-sheet` output (interactive) as it is, with its `<!-- decision-sheet:start v1 -->` and `<!-- decision-sheet:end -->` markers. Leave it out when no sheet was made.>
@@END@@

## Open points
<questions or follow-ups for the owner; "none" if none>
```

## Step 5 — Push and open the PR

1. `git push -u origin <current branch>`.
2. `gh pr create --draft --base <base> --title "<title>" --body-file <abs path to body>`. The title is a Conventional Commits subject for the whole change, for example `feat(orders): add the order export endpoint`.
@@IF MOD_CHANGELOG@@
3. If Step 3.5 decided that no entry is necessary: `gh pr edit <number> --add-label no-changelog`.
@@END@@
4. Unattended: set the report status `PR OPEN — <url>` and add a line `PR: <url>` below it.

## Step 6 — Output

1. The PR title.
2. Merge conflicts that stopped the run, if any.
3. The last line is the PR link: `PR: <url>`.
