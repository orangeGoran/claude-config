## Plan validation (codex): 20261127-230101-contracts-jump-autopilot.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Discrepancy] `recommendJump()` filters PRs on `base`, but the specified `PR_JQ` returns `baseRefName` — [plan:197](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:197), [server.mjs:1517](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:1517). Real PRs will be excluded, so a behind submodule can incorrectly offer “jump now.” Use the actual field or explicitly normalize the response, and test the real response shape.
- [Edge case] `recommendJump()` reads `sub.prs.rows` even though the plan permits `prs: null` when no upstream project matches — [plan:195](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:195), [plan:197](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:197). The prescribed no-upstream “jump now” case can throw instead. Default the rows to an empty array before filtering.
- [Integration] The generated plan fetches a named branch and then checks out `origin/<branch>` — [plan:201](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:201). A branch-specific fetch need not update that remote-tracking ref, so the run can check out an old tip despite the promise to use the newest commit. Fetch into an explicit remote-tracking ref or resolve and use the fetched commit, and test a stale tracking ref.
- [Integration] The proposed guard checks only the first commit segment’s directory, while the existing classifier detects all commit segments — [plan:225](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:225), [workflow-guard.sh:48](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:48). A command containing commits in multiple worktrees can apply the first worktree’s rules to a later commit. Check each commit against its own resolved worktree, or conservatively block commands whose commit targets cannot all be checked.
- [Discrepancy] `safeSubPath()` permits names containing `..` within a segment, but `parseWaitsFor()` rejects any path containing `..` — [plan:182](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:182), [watch.mjs:30](/Users/gorantubic/Workspace/claude-config/apps/dashboard/watch.mjs:30). Such a watched path can produce feature-plan wait conditions that never parse. Align the accepted path rules and add a test for a name such as `contracts..old`.

### Non-blocking concerns

- [Verification] The plan says the owner will diff the rendered copies against the templates, but its verification section contains only `grep` checks — [plan:230](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:230), [plan:322](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:322). Add a comparison that can detect other missed changes.
- [Dependency] The checklist and ledger implementation is not in the current checkout. Its final signatures, wiring, and harness cannot be verified until plan 2a merges — [plan:5](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:5), [plan:215](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:215). Recheck those references against the merged implementation before work starts.

### Edge cases the plan should address

- A branch-specific fetch when `origin/<branch>` is stale or absent — the jump must use the commit just fetched.
- Multiple `git commit` commands targeting different worktrees in one shell command — each target needs its own guard check.
- A watched path with `..` inside a segment — generated wait conditions must remain valid.

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
1. Make recommendJump filter on the actual PR_JQ baseRefName field, or explicitly normalize it, and test the real response shape. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:197; apps/dashboard/server.mjs:1517)
2. Default PR rows to an empty array when prs is null so the no-upstream jump-now case cannot throw. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:195)
3. Make the generated jump plan use the commit actually fetched, rather than assuming a branch-specific fetch updated origin/<branch>; test a stale or absent tracking ref. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:201)
4. Check every commit segment against its resolved worktree, or conservatively block commands whose multiple commit targets cannot all be checked. Add a multi-worktree command test. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:225; skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:48)
5. Align safeSubPath with parseWaitsFor for paths containing consecutive dots, and test a path such as contracts..old. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:182; apps/dashboard/watch.mjs:30)

SHOULD FIX:
1. Add a comparison that checks the owner’s rendered copies against the templates; the current grep checks do not provide the promised diff. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:230; .plans/20261127-230101-contracts-jump-autopilot.md:322)
2. Recheck the checklist and ledger signatures, wiring, and test harness against plan 2a after it merges. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:5; .plans/20261127-230101-contracts-jump-autopilot.md:215)

ADD THESE EDGE CASES:
- A branch-specific fetch with a stale or absent origin/<branch> tracking ref.
- Multiple git commit commands targeting different worktrees in one shell command.
- A watched path with consecutive dots inside a segment.

Do not change anything the validation did not flag.
```