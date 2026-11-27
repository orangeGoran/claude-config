# Plan: Bootstrap fleet upgrade (every project upgrades by itself) — parent plan

> **Master plan.** This file holds no implementation steps. Each phase below gets its own child plan through `/skill-1-plan`, and only those child plans are implemented. Each child plan names this file in its `- **Parent**:` line.

- **Base**: main

## Goal

The owner stops running `/bootstrap-project --upgrade` by hand in each project. When the templates in `skills/bootstrap-project/templates/` change, every registered project gets an unattended upgrade run in its own worktree, and each run ends in a draft PR. Features that a project has and the template lacks come back to claude-config as one collector PR per wave. The owner only merges PRs; a later phase lets safe follower PRs merge by themselves.

## Findings (2026-11-24)

- The dashboard already sees drift: `bootstrapStatus()` in `apps/dashboard/server.mjs` runs `render.mjs <repo> --status` and marks a project `outdated` when `renderHash` in `bootstrap.json` differs from the template hash. The chip only copies the prompt "Run /bootstrap-project --upgrade in this repository" (`bootstrapCheck()`).
- `render.mjs --status` on the 5 registered projects (run on 2026-11-24): 2 have a saved hash that differs (25 and 26 changed files), 1 is up to date (its 7 changed files are merged project text), 2 have no saved hash (30 and 31 changed files).
- The skill is interactive: Step 2 asks per changed file (merge, keep or replace), it never commits, and it prints git commands.
- A headless run cannot write `.claude/` with Edit or Write (`references/lessons.md`, lesson 10a), and most upgrade files are under `.claude/`. So an unattended run lets Claude write merged files outside the repo, and a plain Node script writes them into the worktree.
- The project's own `auto-pipeline.sh` is not the right runner: it is one of the outdated files, and it needs the plan file on `origin/<base>` (an automated run never pushes `main`).
- The Orchestrator parent plan (`.plans/20261123-100855-orchestrator-parent.md`) phase 1 adds a server event watcher. Phase 3 here can use it to see a template change on claude-config `main`.

## Decisions taken by the owner (2026-11-24, in chat)

- 1A — canary first: one template change upgrades one project first; the other projects start only after that PR is merged.
- 2A — template updates found in a project go to claude-config as a draft PR, not as a Board proposal. They are collected: one collector PR per wave, with duplicates removed (the owner checks 1 claude-config PR per wave, not one per project).
- 3A — when a run needs a value only the owner can give, it opens the PR without that part and asks in the PR (decision sheet). The other files still ship.
- The owner wants to be in the flow as little as possible. Auto-merge comes last and is off at first.

## Phases

1. **Unattended upgrade of one project** — done: merged as [PR #8](https://github.com/orangeGoran/claude-config/pull/8) (`.plans/20261124-123513-bootstrap-upgrade-run.md`). A new script `skills/bootstrap-project/scripts/upgrade-run.mjs`: worktree on `auto/bootstrap-upgrade-<hash>`, Claude merges the changed files into a run folder (`/bootstrap-project --upgrade --unattended`), the script applies them, runs `verify.mjs`, commits, pushes the branch and opens a draft PR. The PR body lists the questions and the template updates. The dashboard chip "bootstrap update" starts it and shows the run and the PR. The owner can try it on one project the same day.
2. **Template updates collector** — `.plans/20261127-230103-template-updates-collector.md`. Each run writes its `templateUpdates` to a wave list instead of only the PR body. One collector run removes duplicates, writes each feature once in `templates/` (generic, no project names), and opens one draft PR to claude-config. Owner decisions (2026-11-27):
   - 9A — the wave list is a local file per template hash, `~/.claude/pipeline-dashboard/bootstrap-waves/<template-hash>.jsonl`, one JSON line per update, never committed.
   - 10A — the owner starts the collector with a "Collect template updates" chip on the dashboard; the start is a server function (`startBootstrapCollect(hash)`) that phase 3 calls after the last run of a wave.
   - The collector works in a claude-config worktree on `auto/bootstrap-collect-<hash>` and mirrors `upgrade-run.mjs`. The new endpoint has the same access as every other `/api/*` route.
   - The plan's own defaults are in its section "Decisions taken for the owner". The main one: the wave key is a new templates-only hash (`templatesHash()`), because the `--status` hash differs per project.
3. **Waves** — plan not written yet. A template change on claude-config `main` (a new template hash) starts a wave: the canary project first, the others when the canary PR is merged. A fleet view on the dashboard: one row per project with its state and PR.
4. **Owner values in the PR** — plan not written yet. A new answer that the templates need and `bootstrap.json` lacks no longer stops the render: that part stays off, the PR asks for the value, and `/pr-feedback` adds it after the owner's reply.
5. **Auto-merge for followers** — plan not written yet, off by default. A follower PR merges by itself only when the canary of the same wave was merged, `verify.mjs` passes, the PR has no open question, and it changes only tooling files.

## Open decisions

- Phase 3: which project is the canary (a fixed setting, or the project with the fewest changed files). Decided in the phase 3 plan.
- Phase 3: the trigger — the Orchestrator phase 1 watcher, or a timer of its own when that phase is not built yet. Decided in the phase 3 plan.
- Phase 5: the exact list of "tooling files" that an auto-merge may touch. Decided in the phase 5 plan.
