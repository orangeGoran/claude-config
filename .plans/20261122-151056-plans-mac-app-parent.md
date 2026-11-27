# Plan: Shipyard, the Mac app of the plans dashboard — parent plan

> **Master plan.** This file holds no implementation steps. Each phase below gets its own child plan through `/skill-1-plan`, and only those child plans are implemented. Each child plan names this file in its `- **Parent**:` line.

- **Base**: main

## Goal

A native Mac app around the dashboard, so the owner can switch between working sessions and run actions with keyboard shortcuts (⌘1–9, ⌘N, ⌘W, ⌘K) that a browser keeps for itself. The design proposal is the page "Plans Mac app" in the local QA store (`plans-dashboard` artifacts, 2026-11-22).

## Decisions taken by the owner (2026-11-22)

- The app is a thin Swift + WKWebView shell that loads the dashboard's domain, https://shipyard.test by default (the same engine Tauri uses on macOS; Electron only if WKWebView breaks a page part). Page updates reach the app through the server, as today; only the shell needs a rebuild.
- Tabs live inside the page, the same in the browser and the app: every plan you open becomes a tab. Closing a tab never stops an agent or a run.
- ⌘N opens a sheet with three choices: ask about the project, new plan, launch a ready plan.
- Release 1 covers all three phases below.
- The app is named **Shipyard** (`~/Applications/Shipyard.app`; owner decision 2026-11-26). The folder stays `apps/plans-mac/`, and the dashboard page keeps its "Plans" title. The default dashboard domain is `shipyard.test` (was `plans.test`; owner decision 2026-11-26).
- The web dashboard (https://shipyard.test in any browser) stays complete on its own: every feature works there, with Ctrl keys where the browser keeps the ⌘ keys. The Mac app is optional: `scripts/setup.sh` asks before it builds and installs it, and the page sends messages to the app only when `window.webkit` exists.

## Phases

1. **Session tabs and the ⌘K palette (page)**, built — `.plans/done/20261122-133231-session-tabs-and-command-palette.md`. The tab strip, Ctrl+1–9 / Ctrl+W / Ctrl+Shift+T in the browser, the ⌘K palette (plans, worktrees and header actions), and the `window.dashboard` hooks (`switchSession`, `nextSession`, `closeSession`, `reopenSession`, `openSearch`) that the app calls.
2. **The Mac app**, in `apps/plans-mac/` (a new top-level `apps/` folder; owner decision 2026-11-22). Too big for one PR, so it is two plans, in this order:
   - **2a. The app shell** — built. The Swift app and `npm run build-app` (`swiftc`, ad-hoc signed, copied to `~/Applications`); the menu bar with ⌘1–8, ⌘9 (last tab), ⌘⇧[ / ⌘⇧], ⌘W, ⌘⇧T, ⌘K, ⌘L, ⌘B, ⌘, and the Edit menu, each calling a `window.dashboard` hook (the page gets the hooks that are still missing); links to other sites open in the default browser; window size and place kept; `scripts/setup.sh` asks before it builds and installs the app. The owner can try it first, and 2b builds on it.
   - **2b. The native parts** — planned: `.plans/20261127-230104-plans-mac-native-parts.md` (waits for plan 20261127-230103-template-updates-collector merged). Notifications with Allow / Deny that answer through `POST /api/chat/answer` (WKWebView has no web notifications), a Dock badge with the count of sessions that need the owner, keep the Mac awake while a run or chat works, reload by itself after the server restarts, and a "New version ready" bar with a **Build and install** button when the shell code on disk differs from the app. Owner decisions (2026-11-27):
     - **12A — one notification path.** The server stays the only place that decides what rings: one new event "permission ask" (with Allow / Deny) next to the 5 watcher events, which stay. Shipyard only shows the notifications and sends the button back. Nothing rings twice. Later orchestrator events go into the same place.
     - **11A — update check by hash, with a call to action.** `npm run build-app` bakes a hash of the shell source into the app; the server reports the hash of the source on disk; when they differ, the app shows the bar. The click runs the build through a new server endpoint, shows the progress, then restarts Shipyard into the new build (relaunch by PID, never a stop by name). A failed build shows the error, and the old app keeps running.
     - The new endpoints have the same access as every other `/api/*` route.
3. **The ⌘N new-session sheet** — plan not written yet. The sheet and its server work: "ask about the project" and "new plan" need a chat that has no plan file yet (today every chat belongs to a plan, and only a confirmed scout proposal starts `/skill-1-plan` in a repo-root chat, `scoutConfirm()`). "Launch a ready plan" lists the Ready plans.

## Later (not in Release 1)

Menu bar icon with live status, a global quick-capture hotkey, `plans://` deep links, files dropped on the Dock icon, Touch ID for risky permissions, tabs torn out into their own window, a morning summary.

## Open decisions

- Phase 2b: decided 2026-11-27 (11A file hash with a Build and install bar; 12A the server rings the 5 watcher events plus permission asks). See Phases → 2b.
- Phase 3: where a chat without a plan lives (a placeholder plan file, or a new chat kind on the server), and its endpoint access. Decided in the phase 3 plan.
