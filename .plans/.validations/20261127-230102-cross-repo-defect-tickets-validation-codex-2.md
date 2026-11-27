## Plan validation (codex): 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Permissions] Item 7.5 uses the Write tool to create ticket and PR-body files in the main checkout’s run folder, but the run overlay grants only `Read` and `Edit` there — [plan:201](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:201), [auto-pipeline.sh:244](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:244) — an unattended run may be unable to create the files needed by `gh`. Grant the scoped `Write` permission and test it in the overlay.

- [Ticket intake] The planned issue-list command requests only `number,title,url`, then asks the planner to skip issues with `needs-triage` — [plan:209](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:209) — the returned rows do not contain labels, so the planner cannot reliably distinguish tickets awaiting triage. Request labels and test both ticket types.

- [Crash recovery] Recovery treats a search with no hit as permission to create another issue, without distinguishing a failed or incomplete search from a confirmed absence — [plan:49](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:49), [plan:199](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:199) — a lost create response followed by an unsuccessful or delayed search can produce a duplicate. Define a safe uncertain state, verify an exact source marker on any candidate, and retry only when absence is established. The proposed GitHub search’s indexing and matching behavior is not verified by this read-only review.

- [Watcher integration] The plan skips duplicate repos during event processing, but refreshes every grouped project’s cache before that check — [plan:177](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:177), [server.mjs:2303](/Users/gorantubic/Workspace/worktrees/claude-config/20261127-195706-groups-ledger-checklist/apps/dashboard/server.mjs:2303) — two registry entries for one repo still make two requests per tick, contrary to the stated one-reader rule. Select the reader before refreshing, share its result with ledger consumers, and test the call count and reader changes.

- [Pagination] The issue endpoint returns pull requests as well as issues, but the plan takes one 100-item page before filtering pull requests — [plan:173](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:173), [plan:174](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:174) — labeled PRs can displace triage issues, and fewer than 100 displayed issues can hide truncation without the warning. Fetch enough pages to establish the issue limit and truncation state, and test mixed results.

### Non-blocking concerns

- [Future integration] The sibling plan has not landed, so its final checklist signature, opener and watcher changes cannot yet be verified against merged code — [plan:26](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230102-cross-repo-defect-tickets.md:26). Recheck those integration points when it lands.

### Edge cases the plan should address

- The selected registry reader is removed or changes group while another entry still points to the repo — preserve a correct baseline and make the checklist data available to each relevant group.
- A recovery search fails, returns an unrelated candidate, or does not yet return a newly created issue — avoid both duplicate creation and linking the wrong issue.
- A page of labeled results contains both pull requests and issues — show the actual truncation state.

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
1. Grant the run overlay scoped Write permission for the ticket and PR-body files in the main checkout’s auto-runs folder, and test that permission. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:201; skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:244)
2. Include labels in the pipeline issue-list result and test that needs-triage issues are skipped while other pipeline issues remain available. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:209)
3. Define recovery for a failed, incomplete or delayed search after an uncertain issue creation. Verify the exact source marker on candidates and do not create another issue while the outcome is uncertain. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:49,199)
4. Select one reader per GitHub repo before refreshing triage data, share its result with ledger consumers, and test request counts and reader changes. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:177; apps/dashboard/server.mjs:2303 in worktree 20261127-195706-groups-ledger-checklist)
5. Handle labeled pull requests in the issues endpoint without silently displacing triage issues or hiding truncation. Define pagination and a truncation indicator, and test mixed results. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:173)

SHOULD FIX:
1. Recheck the checklist signature, URL opener and watcher integration against the merged sibling plan before implementation. (evidence: .plans/20261127-230102-cross-repo-defect-tickets.md:26)

ADD THESE EDGE CASES:
- The selected registry reader is removed or changes group while another entry points to the same repo.
- Recovery search fails, returns an unrelated candidate, or does not yet return a newly created issue.
- A page of labeled results contains both pull requests and issues.

Do not change anything the validation did not flag.
```