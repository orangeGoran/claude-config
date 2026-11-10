---
name: merge-parent
description: Merge the parent branch (the PR's base, usually develop) into the current branch, resolve the conflicts, check the result, commit the merge and push. Use when the user or the plans dashboard asks to "merge develop", "merge develop in", "merge main in", "update the branch", "bring the branch up to date", or "fix the PR conflicts", or invokes /merge-parent (formerly /update-branch).
argument-hint: "[parent branch, default: the open PR's base, else develop]"
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(pnpm *), Bash(yarn *), Bash(npx *), Bash(composer *), Bash(php *), Read, Edit, Write, Grep, Glob
---

Merge the parent branch into this branch, fix the conflicts and push: $ARGUMENTS

The user asked for this merge commit and this push by running the skill. That is the explicit request the global git rules need, for this merge only. Do not commit or push anything else.

## Hard rules

- Never force-push, never rebase, never `git reset`, never `git stash`. The result is one normal merge commit on top of the branch.
- Never resolve a file by taking one whole side (`git checkout --ours/--theirs`, pasting a file). Find what each side changed against the merge base and keep both changes. Exception: lockfiles and generated files, see Step 3.
- Keep each file's existing format byte for byte (indentation, key order, trailing newline, minified JSON stays one line).
- Verify before you claim. "Tests pass" or "no other caller" needs a command you ran in this session.
- Put temporary files in the session scratchpad, never in the repo.
- zsh: quote globs and refs with special characters.

## Step 1: check that the branch can take a merge

Run in parallel:
- `git branch --show-current`
- `git status --short`
- `gh pr view --json number,baseRefName,headRefName,url 2>/dev/null`

Stop and tell the user when:
- HEAD is detached, or the branch is the parent itself (for example `develop` into `develop`).
- A merge or rebase is already in progress (`git status` says so). Ask if they want you to continue that one.
- The working tree has uncommitted changes. List them. Do not stash. The user commits or discards them first.

Pick the parent branch, first match wins:
1. The argument, without a leading `origin/`.
2. The open PR's `baseRefName`.
3. `develop` when `origin/develop` exists, else the repo's default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).

Say it in one line before you continue, for example: `Update: develop → auto/2026-11-03-invoice-export`.

## Step 2: fetch and merge

1. `git fetch origin <parent> <branch>` (drop `<branch>` when it has no remote yet).
2. When the remote branch has commits that are not local (`git rev-list --count HEAD..origin/<branch>` > 0), merge them first with `git merge --ff-only origin/<branch>`. If that fails, stop: the branch moved somewhere else and the user must decide.
3. `git rev-list --count HEAD..origin/<parent>`. When it is 0, say "Already up to date with <parent>" and skip to Step 5 (push only if the branch is ahead of its remote).
4. `git merge --no-ff --no-edit origin/<parent>`.
5. No conflicts: go to Step 4.

## Step 3: resolve the conflicts

`git diff --name-only --diff-filter=U` lists the files. For each one:

1. Read the conflict and the history of both sides:
   - `git log --oneline --format='%h %s' MERGE_HEAD...HEAD -- <file>` shows which commits touched it on each side.
   - `git diff $(git merge-base HEAD MERGE_HEAD) MERGE_HEAD -- <file>` shows what the parent changed.
   - `git diff $(git merge-base HEAD MERGE_HEAD) HEAD -- <file>` shows what this branch changed.
2. Write a result that keeps both intents. Typical cases:
   - Both sides added different things (imports, routes, enum members, translations, tests): keep both, in the file's order.
   - The parent renamed or moved something that this branch uses: apply this branch's change to the new name or place.
   - The parent deleted a file that this branch edits: find where the code went (`git log --follow --diff-filter=D MERGE_HEAD -- <file>`) and move this branch's change there.
3. Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`): take the parent's version, then run the package manager's install so it adds this branch's dependencies again. Generated files (OpenAPI clients, built assets): run the generator instead of editing.
4. `grep -n '^<<<<<<<\|^=======$\|^>>>>>>>' <file>` returns nothing.

Stop and ask when both sides changed the same behavior in ways that do not fit together (for example, the parent made a field required and this branch removed it). Leave the merge in progress, do not commit. Explain the choice in a chat message: what each side wanted, one example with real values, the options, and your recommendation.

## Step 4: check the result

1. Search for code that the parent changed and this branch uses outside the conflict files. A clean text merge can still break: a renamed function, a changed signature, a removed export. `git diff --stat HEAD...MERGE_HEAD` (or `HEAD...origin/<parent>` after a clean merge) shows what came in.
2. Run the project's checks, scoped to the touched area. Use what the repo defines (`package.json` scripts, `composer.json`, the project CLAUDE.md): typecheck, lint, and the tests for the conflict files and the files this branch changed. Do not run the full suite unless the repo has no way to scope it.
3. If a check fails because of the merge, fix it. If it also fails on `origin/<parent>` alone, it is not from this merge: report it and do not fix it.

## Step 5: commit and push

1. `git add` only the files the merge touched, then `git commit --no-edit` (keeps Git's merge message; no AI attribution).
2. `git push` (use `git push -u origin HEAD` when the branch has no upstream). Never `--force`.
3. If the push is refused because the remote moved, go back to Step 2 point 2. Do not force.

## Report

Keep it short:
- TLDR: `Merged develop (12 commits) into auto/2026-11-03-invoice-export, 3 conflicts fixed, pushed as a1b2c3d.`
- One line per conflict file: what each side changed and how you combined them.
- Checks you ran and their result. Failures that also exist on the parent.
- Anything the user must look at by hand.
