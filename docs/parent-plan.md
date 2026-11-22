# claude-config: parent plan

A Claude Code setup in one repo: a local dashboard that runs plan files in the background, plus global rules and skills linked into ~/.claude/.

This is the parent plan. Each change gets its own child plan in `.plans/`. `/skill-1-plan` and the `plan-validator` agent read this file.

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

## Phases

### Plans Mac app

Goal: a native Mac app around the dashboard, so the owner can switch between working sessions and run actions with keyboard shortcuts (⌘1–9, ⌘N, ⌘W, ⌘K) that a browser keeps for itself. The design proposal is the page "Plans Mac app" in the local QA store (`plans-dashboard` artifacts, 2026-11-22).

Decisions taken by the owner (2026-11-22):

- The app is a thin Swift + WKWebView shell that loads https://plans.test (the same engine Tauri uses on macOS; Electron only if WKWebView breaks a page part). Page updates reach the app through the server, as today; only the shell needs a rebuild.
- Tabs live inside the page, the same in the browser and the app: every plan you open becomes a tab. Closing a tab never stops an agent or a run.
- ⌘N opens a sheet with three choices: ask about the project, new plan, launch a ready plan.
- Release 1 covers all three phases below.

1. **Session tabs and the ⌘K palette (page)** — `.plans/20261122-133231-session-tabs-and-command-palette.md`. The tab strip, Ctrl+1–9 / Ctrl+W / Ctrl+Shift+T in the browser, the ⌘K palette (plans, worktrees and header actions), and the `window.dashboard` hooks (`switchSession`, `nextSession`, `closeSession`, `reopenSession`, `openSearch`) that the app calls.
2. **The Mac app shell and native parts** — plan not written yet. In `scripts/plans-app/`: the Swift app and `npm run build-app` (`swiftc`, ad-hoc signed, copied to `~/Applications`); the menu bar with ⌘1–8, ⌘9 (last tab), ⌘⇧[ / ⌘⇧], ⌘W, ⌘⇧T, ⌘K, ⌘L, ⌘B, ⌘, and the Edit menu, each calling a `window.dashboard` hook; links to other sites open in the default browser; window size and place kept. Native parts: notifications with Allow / Deny that answer through `POST /api/chat/answer` (WKWebView has no web notifications), a Dock badge with the count of sessions that need the owner, keep the Mac awake while a run or chat works, reload by itself after the server restarts, and an "App update ready" bar when the shell code on disk is newer than the app.
3. **The ⌘N new-session sheet** — plan not written yet. The sheet and its server work: "ask about the project" and "new plan" need a chat that has no plan file yet (today every chat belongs to a plan, and only a confirmed scout proposal starts `/skill-1-plan` in a repo-root chat, `scoutConfirm()`). "Launch a ready plan" lists the Ready plans.

Later (not in Release 1): menu bar icon with live status, a global quick-capture hotkey, `plans://` deep links, files dropped on the Dock icon, Touch ID for risky permissions, tabs torn out into their own window, a morning summary.

## Open decisions

- Phase 2: how the app finds out that the shell code changed (version endpoint or file hash), and which events ring a notification (all alerts, or only permission asks and failed runs). Decided in the phase 2 plan.
- Phase 3: where a chat without a plan lives (a placeholder plan file, or a new chat kind on the server), and its endpoint access. Decided in the phase 3 plan.
