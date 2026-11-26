# claude-config

A Claude Code setup in one repo: a local dashboard that runs plan files in the background, plus global rules and skills linked into ~/.claude/. Required reading: `docs/roadmap.md` (the parent plan: goals, architecture, open decisions).

Instruction files are `AGENTS.md`. Each one has a one-line `CLAUDE.md` (`@AGENTS.md`) next to it. Never write rules into a `CLAUDE.md`. When a folder gets its own rules, add an `AGENTS.md` + `CLAUDE.md` pair in that folder: a new folder `AGENTS.md` needs both files and a line in this root file that names it.

## Hard rules

- **Restart after dashboard changes.** After a change to apps/dashboard/server.mjs, the page files in apps/dashboard/page/ or anything they import lands in the main checkout (a merge and git pull, or an edit there), run pgrep -fl chat-relay.mjs, then npm run restart, but only when it shows that the live chats run under the relay. A pipeline run in a worktree does not restart: the service runs the main checkout, so its report lists the restart under Open items.
- **No npm dependencies.** The scripts use only Node built-ins; package.json has no dependencies, and the page loads browser libraries (Monaco, Mermaid) from a CDN.
- **Public repo: no private data.** The repo is public: files hold no client names, private paths or secrets, and the templates in skills/bootstrap-project/templates/ stay generic (project values come from the interview).
- **Global rules affect every project.** The root CLAUDE.md and the skills/ folders are symlinked into ~/.claude/, so a change there changes every project; keep them short and generic.
- **Never stop processes by name.** Stop a test dashboard or server by its port or PID, never with pkill or killall by name: that once stopped the real dashboard and a live chat.
- **Tests for logic changes.** A change to server or script logic gets a test in the app's test/ folder (apps/<app>/test/) or in the root test/, run with npm test.
- **Docs: current state only.** READMEs and docs describe the current state in simple English (ASD-STE100), one line per paragraph, no change history.
- **Contracts.** The project has no shared contract source yet. When one exists, add it here and take types and enum values only from it.
- **Test data.** Use made-up test data only. Never put real customer data, real names, real addresses or real secrets in a test or a fixture. Example: `"Ana Example"`, `ana@example.test`, a fake key `sk-test-0000`.

## Layout

| Path | What |
| --- | --- |
| `apps/dashboard/` | The dashboard server (server.mjs), the chat relay and the restart command |
| `apps/dashboard/page/` | The dashboard page (page.html, app.js, app.css) |
| `apps/scout/` | The scout: finds problems in the projects and writes plan proposals |
| `apps/plans-mac/` | Shipyard, the Mac app of the dashboard (Swift shell around the page); rules in `apps/plans-mac/AGENTS.md` |
| `test/` | node --test tests of the skills (each app has its own test/ folder) |
| `scripts/` | Setup, service templates and helper scripts |
| `skills/` | Global skills, symlinked into ~/.claude/skills/ |
| `docs/` | User docs and screenshots |

## Code rules

- Follow the existing pattern. Before you design something new, find how the repo solves the same problem and match it. If you diverge, say why.
- Never hardcode a value that a contract, an enum, a config or an API response gives. Import it.
- After you fix a defect, search sibling code for the same defect, and fix it or report it.
- Doc comments on public functions, in ASD-STE100.
- Add a package only with the owner's yes. Then install its latest version with the package manager, never type a version by hand.
- No secrets in code, config fallbacks or fixtures.

## Plans

- Plans live in `.plans/`, named `YYYYMMDD-HHMMSS-<kebab-slug>.md`. Finished plans move to `.plans/done/`.
- Validation reports live in `.plans/.validations/`. Run reports live in `.plans/auto-runs/` (gitignored).
- `docs/roadmap.md` is the parent plan. Child plans are written one step ahead.
- A big piece of work that needs several plans has its own parent plan: `.plans/YYYYMMDD-HHMMSS-<slug>-parent.md`, which starts with `> **Master plan.**` (no steps, never launched) and holds the ordered child plans, the owner's decisions and the open decisions. `docs/roadmap.md` links each parent plan. A child plan names its parent plan in its header (`- **Parent**:`).
- Every plan starts only after an explicit "go" from the owner, or when the plans dashboard starts it because the `- **Waits for**:` condition in its header became true (that line is the go). One plan per run.
- When a plan needs an owner decision, do not guess. Write the question down and continue with the steps that do not depend on it.

## Workflow

`/skill-1-plan <what>` (writes the plan, then validates it) → push the plan to `main` → launch it in the plans dashboard → review the draft PR → merge → `bash .claude/scripts/auto-pipeline.sh --cleanup <slug>`.

- `/skill-1-plan` asks the owner one decision at a time, saves `.plans/<file>.md`, then runs `/skill-auto-validate-plan`.
- `/skill-auto-validate-plan` loops (max 4 rounds; it stops after a round with no accepted fix and no open regression): the `plan-validator` agent and Codex (when `codex` is installed) each write a report in `.plans/.validations/`, the valid findings go into the plan, and each round leaves a `-validation-round-<n>.md` decision log. `/skill-validate-plan` is one Claude round with no edits.
- `/apply-validation` checks a pasted review (another agent, another session, a person) against the repo and writes `-external-<n>.md`.
- The dashboard runs `.claude/scripts/auto-pipeline.sh <mode> <plan>`. It creates a worktree `../worktrees/claude-config/<slug>` on branch `auto/<slug>` from `origin/main` and runs `/skill-auto-pipeline` headless: `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` (`/code-review` loop + rule audit, then `/test-review --fix`) → plan to `.plans/done/` → `/decision-sheet` ("to PR" mode) → one commit for the whole plan → `/skill-5-ship` (draft PR). Modes: stop at verify (nothing committed), full (one local commit), to PR. The report is `.plans/auto-runs/<slug>.md`.
- `/skill-2-implement <plan file>` alone implements one plan in the current tree, with no commits.
- `/skill-3-test` and `/skill-4-verify` also run alone, after a manual `/skill-2-implement`.
- `/skill-4-verify` runs a review loop of max 2 rounds (round 2 only after a behaviour fix), each round one Claude `/code-review` and then one Codex review (`.codex/skills/validate-implementation`, when `codex` is installed; `--no-codex` skips it), then the rule audit. A missing Codex never blocks it.
- `/skill-5-ship` merges `main`, runs the checks, pushes the branch and opens a draft PR. Only when the owner asks.
- `/test-review` checks the tests of a change against the plan (the `test-reviewer` agent). The pipeline runs it inside `/skill-4-verify`.
- `/changelog-entry` writes the `changelog.d/` entry of a change. Every PR adds one, or carries the `no-changelog` label.
- `/decision-sheet` writes the decisions of a change for the reviewer. In "to PR" mode the pipeline runs it before the commit (its fixes go into the one commit); `/skill-5-ship` adds it to the PR.
- `/plans-parallel` reads `node .claude/scripts/plan-lanes.mjs --json` and proposes which plans can run at the same time.
- `/pr-feedback <PR>` works the review comments of a PR in its run worktree.
- The skill names are a contract with the plans dashboard (it looks for `/skill-auto-pipeline <slug>.md` to see a live run, and copies `/skill-auto-validate-plan`). Do not rename them.
- Every skill runs shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs. Headless runs auto-deny compound commands.

## Git

- Branches: main only. `main` is the base branch. PRs go to `main`.
- Never wait for or watch GitHub CI runs (no `gh pr checks --watch`, no polling). After a push the step is done.
- Push only when the owner says so, or as a follow-up on an open PR (next rule). The "to PR" mode counts as that permission, for its own `auto/<slug>` branch only. Never push `main` from an automated run. Never force-push.
- **Follow-ups on an open PR: commit and push without asking.** When the current branch is not `main` and has an open PR (`gh pr view --json number,state` says `OPEN`), each change the owner asks for in the chat ships to that PR. Do not hand over `git add` or `git commit` commands. Run the scoped tests and the check-only lint for the touched files; a failure → fix it or report it, and do not push. Stage by path (never `git add -A` or `git add .`; never `.env*`, `.claude/settings.local.json` or the files of another plan), commit with a Conventional Commits message, and `git push`. When the change makes the PR body wrong (Changes, Verification, Code review, Open points), update the body with `gh pr edit <number> --body-file <file>`. This rule overrides a personal "never commit unless asked" rule for this case only.
- Merge style: squash (a squash merge keeps main to one commit per PR).
- Commit messages use Conventional Commits, with no AI attribution.

## Commands

The stack: Node.js 18+ ES-module scripts with no dependencies, Bash, and a plain JS/CSS browser page. Package manager: npm.

| What | Command |
| --- | --- |
| Install | not available yet |
| Test (full) | `npm test` |
| Test (one file) | `node --test <file>` |
| Test (end to end) | not available yet |
| Lint | not available yet |
| Format | not available yet |
| Type check | not available yet |
| Build | not available yet |
| Run usage (one pipeline run) | `node .claude/scripts/run-usage.mjs <run .log>` |
| Test run-usage.mjs | `node --test .claude/scripts/run-usage.selftest.mjs` |
| Restart the dashboard service | `npm run restart` (check pgrep -fl chat-relay.mjs first) |
| Build and install the Mac app (Shipyard) | `npm run build-app` |
| Run a test dashboard by hand | `DASH_PORT=4911 DASH_NO_OPEN=1 DASH_WATCH_MS=0 node apps/dashboard/server.mjs` (stop it by its PID) |

Skills take commands from this table and from `package.json`. A command that is "not available yet" does not exist: never invent one. Add it here (and to `.claude/settings.json` `permissions.allow`) in the same change that adds it.
