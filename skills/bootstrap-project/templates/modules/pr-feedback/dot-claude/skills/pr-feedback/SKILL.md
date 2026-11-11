---
name: pr-feedback
@@IF MOD_DECISION_SHEET@@
description: Apply the owner's feedback on an open PR — review comments, PR comments, and edits they made in the worktree — then test again, merge the base branch, run the checks again, push, reply to each comment, and rebuild the decision sheet in the PR body. When the PR has no new feedback, asks the owner in chat what to do. Use when the owner runs /pr-feedback <PR#>, or says "I commented on the PR", "apply my PR comments", "process the feedback on #107".
@@END@@
@@IFNOT MOD_DECISION_SHEET@@
description: Apply the owner's feedback on an open PR — review comments, PR comments, and edits they made in the worktree — then test again, merge the base branch, run the checks again, push, and reply to each comment. When the PR has no new feedback, asks the owner in chat what to do. Use when the owner runs /pr-feedback <PR#>, or says "I commented on the PR", "apply my PR comments", "process the feedback on #107".
@@END@@
disable-model-invocation: true
@@IF MOD_CODEX@@
argument-hint: "<PR#> [--codex]"
@@END@@
@@IFNOT MOD_CODEX@@
argument-hint: "<PR#>"
@@END@@
---

PR feedback: $ARGUMENTS

When the owner runs this skill, they ask you to commit and push fixes to the PR branch. This skill never uses `git push --force`, `git reset`, `git stash` or `git commit --no-verify`, and it never merges the PR.

## Rules

- Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs. Write a file with the Write tool, then give its path to the command.
- Commands come from the repo: `AGENTS.md`, section **Commands**, and the scripts in @@MANIFESTS@@. If a command is missing, write "not available yet". Never invent a command.
- Commit messages use Conventional Commits, with no AI attribution.
- Questions to the owner go in a chat message, in the decision format from `/skill-1-plan` (the facts, one example step by step with real values, Option A (recommended) and Option B, why A). Never use AskUserQuestion for them.

## Step 0 — Find the PR and the worktree

1. `gh pr view <PR#> --json number,url,state,isDraft,headRefName,baseRefName,body`. If the state is not `OPEN`, stop and say so.
2. `git branch --show-current` must equal `headRefName`. If not, **stop** and say where to run the skill:
   - an `auto/<slug>` branch is in the worktree `../worktrees/@@PROJECT_NAME@@/<slug>`, next to the repo. Take the exact path from `git worktree list`. Tell the owner: `cd <path>`, start `claude`, then run `/pr-feedback <PR#>`;
   - any other branch: `git switch <headRefName>` first.
3. `git fetch origin <headRefName>`. Then `git rev-list --count HEAD..origin/<headRefName>`. If the count is not 0, stop: someone pushed to the PR. Ask the owner before you merge these commits.

## Step 1 — Collect the feedback

This skill marks a handled comment with `<!-- pr-feedback:done <comment-id> -->` in its reply. Collect every comment **without** such a reply. Run each command alone:

```bash
gh api repos/{owner}/{repo}/pulls/<PR#>/comments
gh api repos/{owner}/{repo}/pulls/<PR#>/reviews
gh api repos/{owner}/{repo}/issues/<PR#>/comments
git status --short
```

The first command gives the inline review comments, the second the review summaries (use only the ones with a body), the third the PR conversation, and the last the owner's own edits. Skip bot comments and the replies of this skill (they have the marker).
@@IF MOD_DECISION_SHEET@@

Then read the decision sheet in the PR body, between the `<!-- decision-sheet:start` and `<!-- decision-sheet:end -->` markers. **Only a comment counts as a "no".** A box that is not ticked yet looks the same as a box that the owner does not agree with. Link a comment to a box when it quotes the box, names its number, or is on the line that the box cites.
@@END@@

@@IF MOD_DECISION_SHEET@@
Show the owner what you found, in one short block: each comment (one line), each open box with no comment, and the local edits.
@@END@@
@@IFNOT MOD_DECISION_SHEET@@
Show the owner what you found, in one short block: each comment (one line) and the local edits.
@@END@@

## Step 2 — Nothing to do → ask in chat

When there are no new comments and no local edits, ask in a chat message (not a popup):

```
PR #<n> has no new comments and no local changes.
@@IF MOD_DECISION_SHEET@@
Open boxes without a comment: <list, or "none">.
@@END@@
What do you want to do?
  - Tell me what to change, in your own words, or
@@IF MOD_CODEX@@
  - say "codex" to run the Codex review now, or
@@END@@
  - say "done" to mark the PR ready for review.
```

@@IF MOD_DECISION_SHEET@@
- **"done"**: if every box is ticked, run `gh pr ready <PR#>` and stop. If a box is open, name it and stop: the "Decision Sheet" check blocks the merge until it is ticked.
@@END@@
@@IFNOT MOD_DECISION_SHEET@@
- **"done"**: run `gh pr ready <PR#>` and stop.
@@END@@
@@IF MOD_CODEX@@
- **"codex"**: continue at Step 5 with `--codex` and no code changes.
@@END@@
- Anything else is feedback: continue at Step 3.

## Step 3 — Apply the feedback

1. **The owner's local edits first.** Commit them by path, as they are: `chore(<scope>): reviewer edits`. Never "improve" them in the same commit.
2. For each comment, decide what it asks. When a comment has two meanings with different results, ask in chat (decision format) before you change code. Otherwise apply it. Follow the patterns of the codebase and `AGENTS.md`.
3. A comment that asks a question and not for a change: answer it in the reply (Step 6), with file:line evidence. Do not change code.
4. Run the scoped tests for the changed files with the **Test (one file)** command from `AGENTS.md`, **Commands**. When a route or a public interface changed, also run the matching end-to-end test, if the repo has the command. Run the lint and format commands on the changed files. Fix the failures (at most 2 tries for each one, then stop and report).
@@IF MOD_TEST_REVIEW@@
5. If production code changed: `/test-review --fix --focus "<the behaviors that these fixes changed>"`.
@@END@@
6. Commit by path: `fix(<scope>): <what the feedback changed>`.

## Step 4 — Merge the base branch and run the checks again

Read `.claude/skills/skill-5-ship/SKILL.md`. Do its step **Merge the base branch** (with its stop cases), then its step **Checks** on the merged tree. Commit the output of the checks, if there is any. Do not do its other steps.

@@IF MOD_DECISION_SHEET@@
## Step 5 — Rebuild the decision sheet

@@IF MOD_CODEX@@
Read `.claude/skills/decision-sheet/SKILL.md` and follow it with `--base <baseRefName>`, `--no-codex` unless `--codex` was given (or the owner said "codex"), and the test-review report, if Step 3 made one.
@@END@@
@@IFNOT MOD_CODEX@@
Read `.claude/skills/decision-sheet/SKILL.md` and follow it with `--base <baseRefName>` and the test-review report, if Step 3 made one.
@@END@@

- **Keep the owner's ticks:** a question whose text did not change keeps its `[x]`. Remove a question that a fix answered. A new question starts with no tick.
- Replace only the part between the two markers in the PR body. Keep the rest of the body. Add one line under "Checked by machines" in the sheet: `🔁 Feedback round <n>: <k> comments applied (<short sha>)`.

@@END@@
@@IFNOT MOD_DECISION_SHEET@@
## Step 5 — Update the PR body

Add one line under `## Open points` in the PR body: `Feedback round <n>: <k> comments applied (<short sha>)`. Keep the rest of the body.

@@END@@
## Step 6 — Push, reply, update the PR

1. `git push origin <headRefName>` (never `--force`).
2. Write the new body with the Write tool to the scratchpad. Then run `gh pr edit <PR#> --body-file <path>`.
3. Reply to each handled comment. Every reply ends with `<!-- pr-feedback:done <comment-id> -->`. Write each reply to a file with the Write tool first.
   - Inline review comment: `gh api -X POST repos/{owner}/{repo}/pulls/<PR#>/comments/<id>/replies -F body=@<file>`
   - PR conversation or review summary: one PR comment that quotes the first line of each comment and answers it, with one marker for each comment id: `gh pr comment <PR#> --body-file <file>`.
   - Each answer says what changed, the commit (`abc1234`), and file:line. For a question: the answer.

## Step 7 — Report

@@IF MOD_DECISION_SHEET@@
In 4–6 lines: the comments applied, the commits, the result of the checks, the state of the sheet (open boxes or all ticked), and the next step ("Tick the remaining boxes" or "Click Ready for review, then merge"). The last line is `PR: <url>`.
@@END@@
@@IFNOT MOD_DECISION_SHEET@@
In 4–6 lines: the comments applied, the commits, the result of the checks, and the next step ("Click Ready for review, then merge"). The last line is `PR: <url>`.
@@END@@
