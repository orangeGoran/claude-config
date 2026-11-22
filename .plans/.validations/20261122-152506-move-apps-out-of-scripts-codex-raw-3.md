## Plan validation (codex): 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues

- [Tests] The old-path test scans only files returned by `git ls-files`, so it misses newly created, untracked files during verification. It can pass while a new file contains a broken old path. The plan requires verification before the pipeline commit — [.plans/20261122-152506-move-apps-out-of-scripts.md:110](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:110) — include untracked, non-ignored files in the scan and test that they are detected.
- [Project rules] Step 0 replaces the old dashboard paths in the restart rule before the files move. Between that push and the merge, changes to the still-active dashboard paths would no longer be covered by the rendered rule — [.plans/20261122-152506-move-apps-out-of-scripts.md:85](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:85), [.claude/bootstrap.json:16](/Users/gorantubic/Workspace/claude-config/.claude/bootstrap.json:16) — retain both old and new paths in the rule during the transition.

### Non-blocking concerns

- [Documentation] The breaking-changes section says the README and dashboard guide will tell users to rerun setup after the pull, but the documentation step instead describes rerunning it when the service fails — [.plans/20261122-152506-move-apps-out-of-scripts.md:78](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:78), [.plans/20261122-152506-move-apps-out-of-scripts.md:97](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:97) — reconcile the promised instructions with the current-state documentation rule.
- [Verification] The post-merge step omits the explicit `npm run restart` named in the hard-rules section — [.plans/20261122-152506-move-apps-out-of-scripts.md:23](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:23), [.plans/20261122-152506-move-apps-out-of-scripts.md:100](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:100) — repeat the complete sequence in the step.

### Edge cases the plan should address

- An untracked source file contains an old path before the commit — the regression test must detect it.
- The owner changes the old dashboard files after step 0 but before the move merges — the restart rule must still apply.
- A Mac has no scout configuration — the release instructions should not direct its owner to install the scout unconditionally.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

The review was read-only. The proposed new files and their eventual behavior cannot be verified until implementation; the plan’s tests and post-merge checks are needed to prove them.

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the old-path test scan untracked, non-ignored files as well as tracked files before the pipeline commit, and add coverage proving an old path in an untracked file is detected. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:110)
2. Keep both the existing and new dashboard paths covered by the rendered restart rule during the transition between step 0 and the merge; specify when the obsolete paths can be removed. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:85; .claude/bootstrap.json:16)

SHOULD FIX:
1. Reconcile the promised README and dashboard-guide migration instructions with the planned current-state documentation. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:78; .plans/20261122-152506-move-apps-out-of-scripts.md:97)
2. State the complete post-merge sequence, including npm run restart after setup, in step 14. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:23; .plans/20261122-152506-move-apps-out-of-scripts.md:100)

ADD THESE EDGE CASES:
- An untracked source file contains an old path before the commit.
- An old dashboard file changes after step 0 and before the move merges.
- A Mac has no scout configuration and should not be told to install the scout unconditionally.

Do not change anything the validation did not flag.
```