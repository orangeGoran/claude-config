# Plan: Orchestrator (one parent session, PRs out) — parent plan

> **Master plan.** This file holds no implementation steps. Each phase below gets its own child plan through `/skill-1-plan`, and only those child plans are implemented. Each child plan names this file in its `- **Parent**:` line.

- **Base**: main

## Goal

The owner stops being the message bus between sessions. One parent session ("conductor") per project group (for example a backend repo and a frontend repo that shares a contracts submodule) reads the tickets, gives work to one lead session per repo, reacts to git and GitHub events by itself, sends product questions to the Product Owner (PO), and brings only two things to the owner: engineering decisions (in one batch) and draft PRs to merge.

## Findings (research of 2026-11-23)

The research read three real sessions of one client project (a frontend "parent" session, a frontend contracts-sync session and a backend planning session, 21–23 Nov 2026), the two repos, their GitHub data and the dashboard code. The client data stays out of this public repo; the numbers below are the generic result.

### What the owner did by hand

- About 85 % of the owner's messages were coordination, not decisions. In the frontend parent session: about 105 real prompts, of which about 25 were "backend PR #N merged, check if we need a new plan", about 25 were "status? / checklist? / what next?", 8 were "the PO answered, check", 7 were "can we compact?", and only about 6 were real product or process decisions.
- The owner copied handoff blocks between sessions (backend notes to frontend, frontend `be` issue lists to backend, PO answers as screenshots into two sessions, an orchestrator prompt from one session into another). Twice a paste was late or duplicate.
- The owner launched runs, ran commit and cleanup commands, and merged every PR. Each merge was the clock for the next step.
- The owner lost track across sessions: "I am losing track at what stage we are", "I need one checklist, not 5 of them", "I did what now?".
- Almost every engineering decision question was answered with the recommended option A.

### Delays that automation removes

- The backend already publishes contracts by itself: a backend merge to the base branch with contract notes triggers a CI job that commits the spec to the shared contracts repo within about 1 minute.
- Nothing on the frontend side reacts. The frontend session learned of a new contracts commit only when the owner typed "api PR #N merged". Frontend PRs opened 2 to 22 hours after the backend merge.
- One contracts-sync plan per contracts commit made a serial chain of about 16 plans, each gated on the previous merge. The owner then decided (2026-11-22) on one types-only "jump" plan to the newest contracts commit plus feature plans in parallel that check "pointer contains X". This model is mechanical and safe to automate.

### Defects found on the way (fix in the client repos or in the templates)

- Headless runs were denied `git -C contracts …` and `git ls-tree`; the allow list lacked them. Five runs stopped for the same reason.
- `--cleanup` failed on worktrees with a submodule. The current template already deinits submodules (`auto-pipeline.sh` "checked-out submodules block `git worktree remove`"); the client repos run an older copy, so `/bootstrap-project --upgrade` fixes it there.
- A workflow-guard hook read the branch of the main checkout, not of the worktree, and blocked commits in the run worktree.
- Plan validation ran 4 rounds per plan and still ended as OPEN ITEMS; a cap of 2+1 rounds was used later.
- A long-lived parent session needed 6 compactions in 2 days; the owner wrote the state summary by hand. State must live in a file, not in the chat context.

### What the dashboard already has

- HTTP endpoints for every action a conductor needs: `/api/launch`, `/api/resume`, `/api/cleanup`, `/api/pr-action` (merge with `--match-head-commit`, then pull), `/api/pr`, `/api/state`, `/api/chat/send`.
- The server can already send a message into a chat (`scoutConfirm` calls `chatMessage` with a `/skill-1-plan` prompt in a repo-root chat).
- Runs already stop with `NEEDS DECISION — <n> questions` and a `## Questions` section.

### What the dashboard does not have

- No server-side watcher: the PR list is read only when the page polls, and a merge done on GitHub triggers nothing.
- No dependency between plans ("wait for PR #N in the other repo", "wait until the contracts pointer contains X").
- No link between repos in the registry (each entry is one repo; only the `client` string groups them).
- No chat without a plan file (the same gap as Mac app phase 3).
- The merge button pulls, but does not clean up the run and does not start the next step.

### What Claude Code offers (docs checked 2026-11-23)

- Cross-session messaging (`SendMessage`, `ListAgents`, a Unix socket per session, v2.1.224+): a local session can message another local session, and an idle receiver starts a new turn. Useful for the owner's own interactive sessions; not needed for dashboard chats, which the server can write to directly.
- Agent teams: experimental, one repo per team. Not a fit for two repos.
- Channels (a local MCP server that pushes events into an interactive session): research preview, interactive only, a custom one needs `--dangerously-load-development-channels`. The dashboard chats run `claude -p`, so the server writing into the chat is simpler.
- Routines (cloud) can trigger on "PR merged", but run in the cloud and cannot wake a local session.
- Cowork has no documented message path from Claude Code. It supports connectors and skills, so a PO can use a "PO inbox" skill that reads and answers GitHub comments.

## Decisions taken by the owner (2026-11-23)

- Q1 A: the conductor is a chat that the dashboard runs; the server writes every event into it.
- Q2 (extended by the owner): full autopilot. A new ticket starts the work with no owner "go": the conductor triages it (backend, frontend, both, or other), the lead chats write and validate the plans, and when no question is open the implementation starts by itself. The owner normally comes in only at the PR.
  - PO questions block only their own ticket until the PO answers. Plans never guess product behavior.
  - Owner (engineering) questions: the agent decides by itself with its recommended option, writes each such choice in the plan under `## Decisions taken for the owner`, and the PR decision sheet asks the owner at the end "do you agree?". An owner question that the agent cannot decide safely (data loss, security, a breaking contract, production impact) is sent to the owner upfront, before the work starts, and blocks only that ticket.
  - This replaces the "every plan starts only after a go" rule for autopilot tickets in the projects that turn the autopilot on.
- Q3 A: the PO channel is GitHub comments (hidden markers) plus a "PO inbox" skill for Cowork.
- Q4 A: the owner merges every PR; a merge starts the next waiting step by itself.
- The conductor acts for the owner ("conductor = almost me"): it may say "go" to plans, answer engineering questions, choose the next tickets in priority order (as the owner did from the high-priority board columns), and launch runs. Only the PR review and merge stay with the owner.
- Q5 (2026-11-23): ticket choice is the one daily owner touch. Once a day the conductor proposes what to work on next (from the board, the goals and what is in flight) and asks the owner; the owner picks, and from then on the autopilot runs without a "go".
- Q6 (2026-11-23): at most 4 runs at the same time per project.

### Phase 2 decisions (owner, 2026-11-27)

- 1A: a group is a new optional registry field `group`. It is not the `client`. A project with no `group` has no ledger and no checklist, and the conductor never gives it work. `client` still groups the sidebar.
- 2A: the ledger file `ledger.md` holds only what people and agents write: `## Goals`, `## Holds` and `## Notes`. The chain ticket → plan → PR is computed by the server on each request and never stored. Questions are not in the ledger file: they live where the PO (and later other developers) can answer them, the "question source", and the checklist only reads them from there.
- 3A: the ledger lives in the dashboard folder on the owner's Mac (`~/.claude/pipeline-dashboard/groups/<group>/ledger.md`), not in a repo. Sharing it with other developers comes later, with the question source on a server.
- 4A: `GET /api/ledger` and `POST /api/ledger/open` have the same access as every other route. Security is reviewed when the dashboard is made public.
- A plan names its tickets with the template's existing `- **Tickets**: #n, #m` header line. The server does not guess tickets from the plan text.

## Proposed design

1. **Event watcher (server).** A timer in the dashboard server (every 60 s, with the existing PR cache) records events per project in the state folder: PR merged, PR opened, run outcome changed (PR open, needs decision, failed), upstream submodule moved (for example a new contracts commit), new comment from the PO on a question. This reads PR and issue state, not CI, so the "never watch CI" rule stays.
2. **Follow-ups on events.** A plan gets an optional `- **Waits for**:` line (`<project> PR #N merged`, `<project> plan <slug> merged`, `submodule <path> contains <sha>`). The watcher launches a waiting plan when its condition becomes true. After a merge (button or GitHub), the server cleans up the run worktree and pulls.
3. **Project groups and one ledger.** The registry gets a `group` (backend + frontend + e2e). Each group has one ledger file with the goals (for example a CEO wish list), the release holds and notes. The server computes the chain ticket → plan → PR → contracts commit → plan → PR from the plans, the run reports and the PRs. The open questions come from the question source (item 5). The dashboard shows all three as the one checklist. Sessions read and write the ledger, so a compaction loses nothing.
4. **The conductor.** A plan-less group chat in the dashboard. It gets a small CLI (`dash`, Node built-ins only) that calls the local `/api/*` endpoints: launch, resume, send to a lead chat, read events, write the ledger. The server sends every event to the conductor as a short user message. The conductor gives work to one lead chat per repo (triage, `/skill-1-plan`, `be` issues), which launch runs. The conductor batches engineering decisions into one owner message.
5. **PO channel.** GitHub issue comments stay the record (the PO already answers there with "1A, 2A"). Questions get a hidden marker (`<!-- po-q id=… plan=… -->`); the watcher finds the answer comment, writes the answers into the plan's `## Questions`, and resumes the stopped run. For the PO: a "PO inbox" skill for Cowork that lists the open questions with context and posts the answers in the right format.
6. **Contracts autopilot (a project rule, not code in this repo).** When the upstream contracts commit is newer than the frontend pin and no jump PR is open, the conductor writes and launches one types-only jump plan. Feature plans wait with `Waits for: submodule contracts contains <sha>`.

## Phases

1. **Event watcher and merge follow-ups** (done) — `.plans/done/20261123-102654-event-watcher-and-waits-for.md`. The server watcher (a timer inside the server, owner answer 1A), the event log and `GET /api/events` (the same access as every other route, 3A), the `Waits for:` line and auto-launch (at most 4 runs per project), the pull after a merge done on GitHub, and macOS notifications. No automatic worktree cleanup (2C): worktrees stay until the owner clicks "Clean up run". The owner can try it alone: merge a backend PR, and the frontend plan that waits for it starts by itself. The "upstream submodule moved past the pin" event moves to phase 5.
2. **Project groups and the ledger** — two plans, in order:
   - 2a. **Groups, the ledger and the checklist** — `.plans/20261127-195706-groups-ledger-checklist.md`. The registry `group`, `ledger.md`, the computed chain from the `Tickets:` lines, `GET /api/ledger`, `POST /api/ledger/open`, the ☑ Checklist drawer (also in the Shipyard View menu) and an empty "Questions" area. Decisions 1A–4A above.
   - 2b. **`plan-lanes.mjs` "waiting" state** — plan not written yet. A plan whose `Waits for:` condition is not met is shown as waiting, not as ready to launch, in the `plan-lanes.mjs` template (`skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs`) and so in `/plans-parallel`. The copy in this repo's `.claude/scripts/` is updated by the owner, by hand.
3. **The conductor chat, the `dash` CLI and ticket intake** — plan not written yet. The plan-less group chat (decides Mac app phase 3's open decision too), event delivery into it, lead chats per repo, the watcher event "new ticket", and the autopilot loop: triage → plans → validation → launch when no question is open, with a limit of parallel runs.
4. **Questions: PO channel and decisions taken for the owner** — plan not written yet. Question markers, the answer watcher, resume of NEEDS DECISION runs, the Cowork "PO inbox" skill, the `## Decisions taken for the owner` plan section and its "do you agree?" lines in the decision sheet, and the upfront notification for the questions the agent may not decide. Owner input for this plan (2026-11-27):
   - **Question source.** One server part reads and writes questions, and the checklist's "Questions" area (plan 2a) reads only from it. Today it is GitHub issues. Long term: a database on a server, which the PO answers with an LLM through MCP, and later other developers too. A new source replaces only this part.
   - **One parent issue, one sub-issue per question.** The questions of one piece of work are GitHub sub-issues of one parent issue. The PO answers a sub-issue and closes it; the watcher sees the close, reads the answer and gives it to the agent (plan chat or run) that asked.
   - **Three kinds of question**, chosen by the agent that asks: *blocking* (needed now: data loss, security, a breaking contract, product behavior with no safe default; only that ticket waits), *check after push* (a safe default exists: the agent builds it, records it under "Decisions taken", and the PO or QA confirms while testing; a "no" becomes a follow-up ticket), and *for information* (no answer needed; one line in the parent issue).
5. **Contracts autopilot rule and template fixes** — plan not written yet. The watcher event "upstream submodule moved past the pin", the project rule for the jump plan (in the client repo), the missing `git -C` allow entries in the templates, the worktree-aware workflow guard, and a validation round cap of 2+1.

## Open decisions

- Where each project names its priority columns or labels for the conductor (a project setting). Decided in the phase 3 plan.
- The parent issue of the questions: one per ticket, or one per delivery (a push or release with several tickets). Decided in the phase 4 plan.
