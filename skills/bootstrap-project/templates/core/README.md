# @@PROJECT_TITLE@@

@@PROJECT_SUMMARY@@

## Status

The project is set up for planned, Claude Code–assisted work. See `AGENTS.md`, section **Status**, for the current state.

## Read this first

| File | What it holds |
| --- | --- |
| [@@PARENT_PLAN@@](@@PARENT_PLAN@@) | The parent plan: goals, architecture, open decisions |
| [AGENTS.md](AGENTS.md) | The rules for each change: hard rules, layout, plans, workflow, git, commands |
| [.plans/](.plans/) | One plan file for each change. Finished plans are in `.plans/done/`. |

## How to run it

The stack: @@STACK_SUMMARY@@

@@COMMANDS_TABLE@@

## How changes are made

Each change is a plan, and Claude Code implements it in the background:

1. `/skill-1-plan <what>` writes the plan in `.plans/` and validates it.
2. The owner pushes the plan to `@@BASE_BRANCH@@` and launches it in the plans dashboard.
3. The run implements, tests and verifies the plan in its own worktree, then opens a draft PR.
4. The owner reviews and merges the PR, then runs `bash .claude/scripts/auto-pipeline.sh --cleanup <slug>`.

`AGENTS.md`, section **Workflow**, has the full steps.
