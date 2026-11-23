# claude-config: roadmap

A Claude Code setup in one repo: a local dashboard that runs plan files in the background, plus global rules and skills linked into ~/.claude/.

This is the roadmap: the goals and the architecture of the repo, and the list of parent plans. Each change gets its own child plan in `.plans/`. A big piece of work gets its own parent plan, `.plans/<YYYYMMDD-HHMMSS>-<slug>-parent.md`, listed below. `/skill-1-plan` and the `plan-validator` agent read this file.

## Goals

- Run Claude Code plans in the background, several at once, each in its own git worktree, and come back to a finished draft PR.
- Show the plans of every registered project on one page: what runs, what waits for the owner, what is done.
- Keep the global rules (`CLAUDE.md`) and skills (`skills/`) under version control, linked into `~/.claude/`, so a `git pull` brings a change to every machine.
- Let the owner drive the dashboard from the keyboard, in a native Mac app (the "Plans Mac app" phases below).

## Architecture

- **Server:** `scripts/plans-dashboard.mjs`, one Node process with no dependencies. It reads the registry (`~/.claude/pipeline-projects.json`), the plan files, the run reports and `gh`, and serves the page and the `/api/*` endpoints on 127.0.0.1:4899. It accepts only local host names and same-origin requests.
- **Page:** `scripts/plans-dashboard/` (`page.html`, `app.js`, `app.css`), inlined into one page by the server. It polls `/api/state` every 5 s and keeps per-viewer settings in `localStorage`.
- **Service:** a launchd login service (`scripts/launchd/com.plans-dashboard.plist.template`) runs the main checkout's server; Caddy (`scripts/caddy/plans.caddy.template`) serves it as https://plans.test. `npm run restart` restarts it.
- **Chats:** each plan's chat runs `claude` under `scripts/chat-relay.mjs`, outside the service, so chats survive a restart.
- **Runs:** a project's `.claude/scripts/auto-pipeline.sh` starts a worktree on `auto/<slug>` and runs `/skill-auto-pipeline` headless; the report goes to `.plans/auto-runs/<slug>.md`.
- **Scout:** `scripts/scout.mjs` (its own launchd job) looks for problems in the projects and writes plan proposals.
- **Skills:** `skills/` holds the global skills; `skills/bootstrap-project/` sets up a project for the dashboard from templates.

## Parent plans

- **Plans Mac app** — [.plans/20261122-151056-plans-mac-app-parent.md](../.plans/20261122-151056-plans-mac-app-parent.md): a native Mac app around the dashboard, with keyboard shortcuts for sessions. Phase 1 (session tabs and ⌘K) is planned; phases 2 and 3 are not written yet.

- **Move the apps out of `scripts/`** — plan not written yet. Move the dashboard (`plans-dashboard.mjs`, `plans-dashboard/`, `chat-relay.mjs`, `restart-dashboard.mjs`) to `apps/dashboard/` and the scout (`scout.mjs`) to `apps/scout/`, so `scripts/` keeps only setup and helper scripts. About 25 files point at the old paths, and the installed login service has the old script path in its plist, so the plan also updates `setup-macos.sh` and says to run it again on each Mac. Runs first, before Mac app phase 1, whose paths it changes (owner decision 2026-11-22).

- **Orchestrator** — [.plans/20261123-100855-orchestrator-parent.md](../.plans/20261123-100855-orchestrator-parent.md): one parent session per project group that gives work to a lead session per repo, reacts to merges and contracts commits by itself, sends product questions to the PO on GitHub, and brings the owner only decisions and draft PRs. Full autopilot from a new ticket to a draft PR (owner decision 2026-11-23). Five phases; phase 1 (event watcher and `Waits for:` plans, `.plans/20261123-102654-event-watcher-and-waits-for.md`) is planned, phases 2–5 are not written yet. The conductor acts for the owner; only PR merges stay with the owner. Open decisions are in the parent plan.

## Open decisions

- None at the repo level. Each parent plan lists its own open decisions.
