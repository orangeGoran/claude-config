---
name: pr
description: Create a pull request from a source branch into a destination branch
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *)
argument-hint: "[source-branch] [destination-branch]"
---

Create a pull request from a source branch into a destination branch.

Arguments: `$ARGUMENTS`. Read them like this:

- **Two arguments** → first is the source branch, second is the destination branch.
- **One argument** → it is the destination branch; the source is the current branch.
- **No arguments** → the source is the current branch (`git branch --show-current`); the
  destination is `develop` if it exists on origin, otherwise the repository default branch
  (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).

Before doing anything else, state the resolved pair in one line, e.g.
`PR: feature/login → develop`.

## Steps

1. **Normalize both names**: strip any leading `origin/` so you have bare branch names
   (`<source>`, `<destination>`). If they are the same branch, STOP and tell the user.

2. **Pick the source ref**:
   - If `<source>` is the current branch → use `HEAD` as `<source-ref>` (includes local,
     unpushed commits).
   - Otherwise → use `origin/<source>` as `<source-ref>`. If it doesn't exist on origin,
     STOP and tell the user to push it first.

3. **`git fetch origin <destination> <source>`** (drop `<source>` if it has never been pushed) —
   local `origin/*` refs may be stale. Skipping this makes the range include commits already
   merged, producing a wrong PR with an inflated commit count. Non-negotiable. Always compare
   against `origin/<destination>`, never the local branch.

4. **Sanity-check the range** before drafting anything:
   - `git rev-list --count origin/<destination>..<source-ref>` — record this number.
   - If it is 0, STOP: there is nothing to merge.
   - If it looks surprisingly large (e.g. >15 for a feature branch), STOP and ask the user
     before continuing. A bloated range usually means the wrong destination branch.

5. Run these in parallel:
   - `git status` (never use `-uall`) — only when the source is the current branch
   - `git diff --stat origin/<destination>..<source-ref>`
   - `git log --oneline --reverse origin/<destination>..<source-ref>`

6. Analyze ALL commits in the range (not just the latest) and draft:
   - **Title**: under 70 chars, conventional commit style matching the repo pattern
   - **Body**: use the template below

7. If the source is the current branch, push it if needed (`git push -u origin <source>`).
   Never push a branch you are not on. Then create the PR:

```
gh pr create --base <destination> --head <source> --title "<title>" --body "$(cat <<'EOF'
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
