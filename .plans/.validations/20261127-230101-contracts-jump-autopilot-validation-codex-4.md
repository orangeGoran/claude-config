## Plan validation (codex): 20261127-230101-contracts-jump-autopilot.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Integration] The guard uses the hook input’s `cwd` to calculate commit folders, but prints no folder for a plain `git commit`. Bash then resolves `.` in the hook process’s working directory, which may be a different worktree. The plan explicitly tests a plain commit using the main checkout’s guard, so that case can still read the wrong branch and index — `.plans/20261127-230101-contracts-jump-autopilot.md:55`, `.plans/20261127-230101-contracts-jump-autopilot.md:227`, `skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:71` — always pass the resolved commit folder, including for a plain commit, and test with the hook process directory different from the input `cwd`.
- [Integration] The plan writes to the configurable `proj.plansDir`, including folders outside the repository, but tells the owner to add and push that file. The pipeline requires the plan on its base ref; a file outside the repository cannot be added to that ref, so the advertised automatic start cannot work — `.plans/20261127-230101-contracts-jump-autopilot.md:206`, `apps/dashboard/server.mjs:194`, `.claude/scripts/auto-pipeline.sh:684` — reject unsupported plans directories before writing, or define and test an in-repository destination that the launcher actually reads.
- [Duplicate side effects] Archived jump plans block a recommendation only when their PR appears as `OPEN` in `allByBranch`. That cache holds only the newest 200 PRs; an older still-open jump PR, or an unavailable cache, can be treated as absent and allow another jump plan — `.plans/20261127-230101-contracts-jump-autopilot.md:206`, `apps/dashboard/server.mjs:1515` — check the relevant PR reliably and treat unknown PR state as blocking; test an older open PR and a failed PR lookup.

### Non-blocking concerns

- [Verification] Step 18 and the harness constraints promise `diff` checks for the owner’s copies, but “How to verify” contains only individual `grep` checks. Those checks cannot establish that the copies match the rendered templates — `.plans/20261127-230101-contracts-jump-autopilot.md:230`, `.plans/20261127-230101-contracts-jump-autopilot.md:283`, `.plans/20261127-230101-contracts-jump-autopilot.md:323` — add executable comparison checks or correct the claim.
- [References] The checklist and ledger integration depends on plan 2a, which has not merged yet. Its final signatures and wiring are not verified against the eventual merged code — `.plans/20261127-230101-contracts-jump-autopilot.md:23` — recheck them after that merge, as step 10 already directs.

### Edge cases the plan should address

- A hook receives a plain commit with an input `cwd` in a linked worktree while the hook process starts in the main checkout — the guard must inspect the input worktree.
- A configured plans directory is outside the repository — Confirm must not create a plan that cannot be pushed and launched.
- An archived jump plan has an open PR older than the cache window, or GitHub lookup fails — an unknown result must not permit a duplicate recommendation.

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
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230101-contracts-jump-autopilot.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the guard pass the resolved input cwd as the commit folder even for a plain git commit. Add a test where the hook process directory differs from the input cwd and verify that the linked worktree’s branch and index are checked. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:227; skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:71)
2. Reject a plans directory that cannot be committed to the pipeline repository before writing a jump plan, or define and test an in-repository destination that the launcher reads. Do not return push commands for an unpushable plan. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:206; apps/dashboard/server.mjs:194; .claude/scripts/auto-pipeline.sh:684)
3. Check an archived jump plan’s PR reliably rather than relying solely on the newest-200-PR cache. Treat an unknown PR state as blocking and test an older open PR and a failed lookup. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:206; apps/dashboard/server.mjs:1515)

SHOULD FIX:
1. Add executable comparisons for the owner-by-hand copies against their rendered templates, or correct the claim that How to verify contains diff checks. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:230; .plans/20261127-230101-contracts-jump-autopilot.md:283; .plans/20261127-230101-contracts-jump-autopilot.md:323)
2. Recheck the checklist and ledger signatures and wiring against the final merged plan 2a code. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:23)

ADD THESE EDGE CASES:
- A plain commit whose hook input cwd is a linked worktree while the hook process directory is the main checkout.
- A configured plans directory outside the repository.
- An archived jump plan with an open PR older than the cache window, and an unavailable PR lookup.

Do not change anything the validation did not flag.
```