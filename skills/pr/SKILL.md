---
name: pr
description: Create a pull request comparing current branch against a target branch
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *)
argument-hint: "[target-branch]"
---

Create a pull request for the current branch.

Target branch argument: `$ARGUMENTS`. If no argument is provided, detect the repo's default PR target: prefer a `develop` branch if it exists on origin, otherwise the repository default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).

## Steps

1. **Normalize the target**: strip any leading `origin/` from the argument so you have a bare
   branch name (e.g. `staging`). All downstream commands use `origin/<target>` explicitly —
   never compare against the local branch, which may be behind.

2. **`git fetch origin <target>`** — the local `origin/<target>` ref may be stale. Skipping
   this makes `origin/<target>..HEAD` include commits already merged, producing a wrong PR
   with inflated commit count. This step is non-negotiable.

3. **Sanity-check the range** before drafting anything:
   - `git rev-list --count origin/<target>..HEAD` — record this number.
   - If the count looks surprisingly large (e.g. >15 for a feature branch), STOP and ask the
     user before continuing. A bloated range usually means the wrong target branch.

4. Run these in parallel:
   - `git status` (never use `-uall`)
   - `git diff --stat origin/<target>..HEAD`
   - `git log --oneline --reverse origin/<target>..HEAD`

5. Analyze ALL commits in the range (not just the latest) and draft:
   - **Title**: under 70 chars, conventional commit style matching the repo pattern
   - **Body**: use the template below

6. Push to remote if needed (`git push -u origin <branch>`), then create the PR:

```
gh pr create --base <target> --title "<title>" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Breaking changes
<list breaking changes, or remove section if none>

## Test plan
- [ ] <bulleted checklist>
EOF
)"
```

## Rules

- Never include "Generated with Claude Code" or any AI attribution in the PR body.
- Return the PR URL when done.
