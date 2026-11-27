# Parent plan: Pipeline diet

> **Master plan.** This file holds no implementation steps.

## Goal

Cut the Claude tokens and the wall time of an unattended pipeline run in every project that `skills/bootstrap-project/` sets up, keep the review value, and stop the owner's manual follow-ups after a PR (fix Codex findings at once; turn a defect of another repo into a ticket there).

## Plans, in order

### 1. Templates diet — `.plans/done/20261124-161043-pipeline-diet-templates.md`

- **Scope:** the skill-text diet in the templates (verify, test, implement, test-review, auto-pipeline); Codex leaves verify by default (`pipeline.codexInVerify`, `CODEX_IN_VERIFY`); in "to PR" mode the decision sheet runs before the commit with `--fix`; the core script `run-usage.mjs` with its self-test, Commands rows and allow rules.
- **Owner decisions:** 1A generic infrastructure retry signs; 2A the diet applies to the Codex-in-verify variant too; 3B the sheet fixes its Codex findings before the commit and lists each fixed finding, which is not a checkbox question ("fix it now", no follow-up tickets). Plan validation 1A (2026-11-24): `/skill-auto-validate-plan` runs max 2 rounds, not 4 (step 19). Reversed on 2026-11-25 by plan 3 (max 4 rounds with an early stop).
- **Open decisions:** none.

### 2. Tickets for defects of another repo — `.plans/20261127-230102-cross-repo-defect-tickets.md`

- **Scope:** when a review (the decision sheet's Codex review, verify, the browser test) finds a defect whose cause is in another repo (for example the backend of a frontend), the run opens a ticket in that repo by itself and links it in the PR body. The run does not fix it in this repo. Parts: the dashboard passes the other repos of the project's group to the run (`DASH_RELATED_REPOS` → `.plans/auto-runs/<slug>-related.json` → `--related=`), the `## Defects in other repos` report section and item 7.5 "Tickets" in the `skill-auto-pipeline` template, the verify, test and decision-sheet rule text, `gh issue create` and `gh label create` in the "to PR" overlay, the `from-pipeline` search in the `skill-1-plan` template, the `needs-triage` watcher poll with its notification and the "Needs you" card of the ☑ Checklist, tests. Waits for orchestrator plan 5 (`20261127-230101-contracts-jump-autopilot`), and uses the groups of orchestrator plan 2a.
- **Owner decisions:** 4B the run opens the ticket by itself (the owner no longer says "make a ticket for the backend" after the PR). 2026-11-27: 5A the related repos come from the 2a group, not from `bootstrap.json`; a run started by hand outside the dashboard gets no list, opens no ticket and writes the defect into the PR body. 6A an unclear owner repo gives a triage issue in the run's own repo (labels `from-pipeline` and `needs-triage`, the candidate repos, the PR link); the ☑ Checklist shows a "Needs you" row for each open `needs-triage` issue of the group, and the watcher sends one notification per new one. 7A only "to PR" mode opens tickets; the other modes write "Would open a ticket in <repo>: <one line>" into the run report. 8A no duplicate check in the run: every ticket has the label `from-pipeline` (made when missing) and the source PR link; `skill-1-plan` lists the open `from-pipeline` issues of its repo, merges the related ones into one plan and names them all on the `Tickets:` line. No new endpoint; `GET /api/ledger` keeps the access of every `/api/*` route. The smaller choices are in the plan's `## Decisions taken for the owner`.
- **Open decisions:** none. (How the phase 3 conductor triages a `needs-triage` ticket belongs to the orchestrator parent plan.)

### 3. Review loop caps — `.plans/done/20261125-210049-review-loop-caps.md`

- **Scope:** `/skill-auto-validate-plan` runs max 4 rounds with an early stop (a round with no accepted fix and no open regression ends the loop), a `RAISED BEFORE` rule for findings that an earlier round rejected, and a final edits check instead of a fifth round; `pipeline.codexInVerify` is on by default when the `codex` module is on.
- **Owner decisions:** 1A (2026-11-25) plan validation max 4 rounds with an early stop, raised-before and a final edits check; 2A (2026-11-25) `pipeline.codexInVerify` defaults to true when `modules.codex` is on. Both from the round-caps report.
- **Open decisions:** none.
