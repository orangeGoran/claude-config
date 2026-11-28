---
name: contracts-jump
description: Holds the rules of a contracts jump plan — a plan that the plans dashboard writes to move a watched submodule (for example the contracts repo) to its newest upstream commit and make the code build with the new types. Use when a plan header has a "- **Contracts jump**:" line, when the owner asks for a contracts jump, or invokes /contracts-jump.
argument-hint: "[submodule path]"
allowed-tools: Bash, Read, Grep, Glob, Edit
---

The rules of a contracts jump for: $ARGUMENTS

Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs.

## How a jump plan starts

1. The plans dashboard watches the submodule (registry `watchSubmodules`). When its pin on `origin/@@BASE_BRANCH@@` is behind the upstream branch, the dashboard shows one notification.
2. The ☑ Checklist of the project's group proposes one jump after the open, non-draft upstream PRs. The owner confirms it there.
3. The dashboard writes one jump plan in `.plans/`. Its header has `- **Contracts jump**: <path>` and one `- **Waits for**: <upstream> PR #<n> merged` line per chosen PR.
4. The owner pushes the plan to `origin/@@BASE_BRANCH@@`. When all its PRs are merged, the dashboard starts it.

## Rules of a jump plan

- A jump plan is types-only. It moves the submodule and fixes only what the new contracts break: types, imports, renamed fields. No feature work and no behavior change.
- Move the pointer to the newest commit of the upstream branch at run time:
  1. `git -C <path> fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch>`
  2. `git -C <path> merge-base --is-ancestor HEAD origin/<branch>`. When it fails, stop and write the problem under `## Questions`.
  3. `git -C <path> checkout --detach origin/<branch>`
- Run the contract or type generation command of the AGENTS.md **Commands** table, then the type check and the build that exist.
- Read the `## Steps`, `## Tests` and `## How to verify` headings of the jump plan as the step, test and verify headings of this project.
- A fix that needs a product or design decision: stop and write it under `## Questions`. Do not guess.
- Feature plans that need the new contracts wait with `- **Waits for**: submodule <path> contains <sha>`. They are not part of the jump plan.
- Never write a second jump plan for the same path while one waits, runs or has an open PR.
