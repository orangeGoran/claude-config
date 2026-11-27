## Plan validation (codex): 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Workflow conflict] The new ticket commands conflict with the pipeline skill’s existing prohibition on network writes other than shipping — [skill-auto-pipeline/SKILL.md:25](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:25), [plan:185](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:185) — the unattended run receives contradictory instructions and may refuse the authorized writes. Explicitly amend that rule to permit the specified ticket and label writes in PR mode.
- [Resume] Verify and commit modes replace `ticket: open` with `ticket: would open in …`, but item 7.5 processes only `ticket: open` — [plan:184](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:184), [plan:185](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:185) — resuming those runs in PR mode skips their tickets. Define the transition back to a ticketable state and test the resume path.
- [Duplicate side effects] The issue URL and timeline marker are written only after `gh issue create` returns — [plan:185](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:185) — a crash or ambiguous response after GitHub creates the issue leaves `ticket: open`, so resume can create a duplicate. Define recovery for an uncertain create outcome using the proposed source marker, without silently creating a second issue.
- [PR body] Item 7.5 edits the locally saved body, but `/skill-5-ship` owns the final PR body — [skill-auto-pipeline/SKILL.md:183](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:183), [plan:185](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:185) — the saved file is not established as the current remote body, so the edit can overwrite ship’s additions or intervening edits. Fetch the current PR body before updating the section, replace that section idempotently, and specify failure handling.
- [Secrets] The plan sends request and response evidence to another repository and exposes raw first-line errors in reports and PR bodies without a redaction step — [plan:182](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:182), [plan:185](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:185) — evidence or errors can contain credentials, private data or URL queries. Specify redaction before persistence or publication and cover it in verification.
- [Validation] `write_related()` validates `self` only as a string, although an unclear finding uses it as the issue destination — [plan:174](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:174), [plan:185](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:185) — malformed input can direct a triage write to an unintended destination. Validate `self` with the same repository-name rule and test rejection.
- [Watcher] The plan puts triage events in the shared `events` array before later watcher steps that can save `next` — [plan:167](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:167), [server.mjs:2259](/Users/gorantubic/Workspace/worktrees/claude-config/20261127-195706-groups-ledger-checklist/apps/dashboard/server.mjs:2259) — a crash after that save but before the final event append loses the event and notification permanently. Define and test the desired persistence and notification recovery behavior.

### Non-blocking concerns

- [Pagination] The triage card reports only the first 100 issues, and the ticket search also stops at 100 — [plan:164](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:164), [plan:190](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:190) — make the ticket-search limit visible to the planner as well.
- [Future integration] The sibling plan’s eventual checklist integration cannot be verified from the specified 2a worktree alone — [plan:26](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:26) — recheck card ordering and symbols against the merged sibling before implementation.

### Edge cases the plan should address

- A label creation fails for a reason other than “already exists” — preserve a useful failure reason and do not claim a ticket was opened.
- A ticket is created but the PR body edit fails — preserve its URL and provide an idempotent retry.
- A dashboard resume changes the related-repo list after findings were recorded — define how existing targets are revalidated.
- More than one registry project points to the same GitHub repository — avoid duplicate checklist rows and notifications, or explicitly document that behavior.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230102-cross-repo-defect-tickets.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Amend the pipeline skill’s network-write rule to permit the specified ticket and label writes in PR mode. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:25; .plans/20261127-230102-cross-repo-defect-tickets.md:185)
2. Define how findings marked “would open” become ticketable when a verify or commit run resumes in PR mode, and test that path. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:184)
3. Define recovery for an issue-create outcome that is uncertain after a crash or lost response, using the proposed source marker without silently creating a duplicate. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:185)
4. Fetch the current PR body before updating the defects section, replace that section idempotently, and specify edit-failure handling. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:183; .plans/20261127-230102-cross-repo-defect-tickets.md:185)
5. Redact credentials, private data and URL queries from evidence and errors before persistence or publication, and cover the behavior in verification. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:182)
6. Validate self against the repository-name rule as well as related repositories, and test rejection. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:174)
7. Define and test persistence and notification recovery when watcher state is saved before triage events are appended. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:167; apps/dashboard/server.mjs:2259 in worktree 20261127-195706-groups-ledger-checklist)

SHOULD FIX:
1. Make the 100-issue ticket-search limit visible to the planner. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:190)
2. Recheck checklist card ordering and integration against the merged sibling plan before implementation. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:26)

ADD THESE EDGE CASES:
- Label creation fails for a reason other than an existing label.
- Issue creation succeeds but the PR body edit fails.
- The related-repo list changes on resume after findings were recorded.
- Multiple registry projects point to the same GitHub repository.

Do not change anything the validation did not flag.
```