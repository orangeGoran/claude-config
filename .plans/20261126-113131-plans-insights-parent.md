# Parent plan: Plans Insights

> **Master plan.** This file holds no implementation steps.

## Goal

Show the owner what the background runs cost and give: spend per week and per project, cost per phase, and the state of the plans, on one Insights page of the plans dashboard (https://plans.test). The numbers come from a ledger of finished runs, so the history stays when old run logs or session transcripts go away.

## Owner decisions (2026-11-26)

- **Page.** Insights is a view inside the same dashboard page, with its own endpoint `GET /api/insights` (with a server cache). Two URLs: `/insights` and `/dashboard` (the current page). `/` opens the page that the browser used last; the first visit opens Insights. A simple switch goes between the two pages (a side menu, or a click on the page title opens a menu, or similar).
- **Ledger (2A + 1A).** One JSON line per finished run in a ledger file. The dashboard server writes the lines (the event watcher), not `auto-pipeline.sh`, so no project and no bootstrap template changes. A migration command writes the lines of all old runs of all registered projects; it is safe to run again. The ledger is `~/.claude/pipeline-dashboard/insights.jsonl`, next to the other dashboard data.
- **First panels (3).** The KPI row, the period filter (7 days, 30 days, All) and the project chips, then Spend per week (stacked by project), Cost by phase, the Projects table and the Plans pipeline (plan counts). The preview is the model: `2026-11-26-plans-insights-preview.html` in the `plans-dashboard` QA pages (http://localhost:4898/plans-dashboard/artifacts/2026-11-26-plans-insights-preview.html).

## Plans, in order

### 1. Insights ledger — `.plans/20261126-113132-insights-ledger.md`

- Scope: `apps/dashboard/insights.mjs` (one ledger line from a run log and its report, the sync of all projects, the ledger reader, the `--migrate` command), the watcher calls the sync each tick, tests, docs.
- Decisions: 1A (the server writes the line), the ledger path above.
- Open decisions: none.

### 2. Insights page — `.plans/20261127-230105-insights-page.md`

- Scope: the `/insights` and `/dashboard` URLs, `/` opens the last page (per-browser `localStorage` `dash-page`; a query on `/` always opens the Dashboard), the page switch in the header, `GET /api/insights` (reads the run log of plan 1 and the plan counts, with a cache), and the first panels (decision 3). The Plans pipeline panel counts the plan files of each project (open, parent, done) and the runs and draft PRs from the run log. Waits for plan 1 merged.
- Decisions: the Page and First panels decisions above; 13A (2026-11-27): `GET /api/insights` has the same access as every other `/api/*` route (local host names and same-origin requests only); 14A (2026-11-27): a click on the page title opens a small menu with Dashboard and Insights, and the ⋯ menu keeps the tools; naming (2026-11-27): UI and docs call `insights.jsonl` the "run log", because orchestrator plan 2a adds a separate "group ledger" (plan 1's code names stay); a group chip is out of scope (later), so this plan does not depend on orchestrator 2a. The plan lists the defaults it took for the owner under "Decisions taken for the owner".
- Open decisions: none. Not in this plan: the preview's "Most expensive runs" panel (no plan has it yet).

### 3. More panels — not written yet

- Scope: speed (minutes per phase, launch to PR, PR to merge), quality (review rounds, findings fixed or deferred, revert checks), run outcomes, the quota forecast, the scout results and the "waiting for you" list of open PRs.
- Open decisions: the run reports give review rounds and findings in free text (36 of 194 reports in the preview had a "review rounds" line, measured by the preview's collector); a fixed results line in the report needs a bootstrap template change. Decide in the plan.
