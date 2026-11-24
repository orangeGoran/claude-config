# Parent plan: Pipeline diet

> **Master plan.** This file holds no implementation steps.

## Goal

Cut the Claude tokens and the wall time of an unattended pipeline run in every project that `skills/bootstrap-project/` sets up, keep the review value, and stop the owner's manual follow-ups after a PR (fix Codex findings at once; turn a defect of another repo into a ticket there).

## Plans, in order

### 1. Templates diet — `.plans/20261124-161043-pipeline-diet-templates.md`

- **Scope:** the skill-text diet in the templates (verify, test, implement, test-review, auto-pipeline); Codex leaves verify by default (`pipeline.codexInVerify`, `CODEX_IN_VERIFY`); in "to PR" mode the decision sheet runs before the commit with `--fix`; the core script `run-usage.mjs` with its self-test, Commands rows and allow rules.
- **Owner decisions:** 1A generic infrastructure retry signs; 2A the diet applies to the Codex-in-verify variant too; 3B the sheet fixes its Codex findings before the commit and lists each fixed finding, which is not a checkbox question ("fix it now", no follow-up tickets).
- **Open decisions:** none.

### 2. Tickets for defects of another repo — not written yet

- **Scope:** when a review (the decision sheet's Codex review, verify, the browser test) finds a defect whose cause is in another repo (for example the backend of a frontend), the run opens a ticket in that repo by itself and links it in the sheet and the PR body. The run does not fix it in this repo. Parts: a new `bootstrap.json` answer that names the related repos (for example `project.relatedRepos[]`), a `gh issue create` rule in the "to PR" run rules, the sheet and skill text, tests.
- **Owner decisions:** 4B the run opens the ticket by itself (the owner no longer says "make a ticket for the backend" after the PR); duplicates are not checked by the run: the planner (`skill-1-plan`) finds related open tickets and merges them into one plan (owner's lean, 2026-11-24; confirm when the plan is written).
- **Open decisions:**
  - The shape and name of the related-repos answer, and how the run picks the target repo of a finding.
  - A guard so the planner finds these tickets in one search: a fixed label (for example `from-pipeline`) and the source PR link in each ticket body.
  - Which modes may open a ticket: only "to PR" (the only mode with network writes today), or also "commit" and "stop at verify".
  - How `skill-1-plan` searches for and merges related tickets (which repos, which labels, open tickets only).
