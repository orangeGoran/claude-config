## Plan validation (codex): 20261124-123513-bootstrap-upgrade-run.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Security] The plan treats the Claude working directory and three disallowed tools as an isolation boundary, but the real session’s access outside that folder is unverified. Its worktree check cannot detect reads or changes elsewhere, and the planned test checks only arguments and cwd — [.plans/20261124-123513-bootstrap-upgrade-run.md:77](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:77), [.plans/20261124-123513-bootstrap-upgrade-run.md:126](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:126) — the run could expose or alter files outside its intended scope — define and verify an enforced isolation boundary before relying on unattended execution.
- [Data safety] Recovery deletes a worktree and branch whenever they have no commit over the current base, without checking for uncommitted work or proving that this run owns them — [.plans/20261124-123513-bootstrap-upgrade-run.md:123](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:123); the reference cleanup refuses uncommitted work, including inside submodules — [.claude/scripts/auto-pipeline.sh:548](/Users/gorantubic/Workspace/claude-config/.claude/scripts/auto-pipeline.sh:548) — a retry can discard edits — require an ownership marker and clean-tree checks, and refuse ambiguous leftovers.
- [Recovery] The commit happens before the PR body is saved, but recovery pushes any local branch with commits over the base — [.plans/20261124-123513-bootstrap-upgrade-run.md:122](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:122), [.plans/20261124-123513-bootstrap-upgrade-run.md:131](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:131) — a crash or body-write failure after the commit can leave no usable body, yet the retry attempts to publish the branch — persist and validate recovery metadata before publishing, and test this interruption.
- [Input] The plan reads `params.git.base` directly, although the existing contract makes it optional and defaults it to `develop` — [.plans/20261124-123513-bootstrap-upgrade-run.md:119](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:119), [skills/bootstrap-project/references/contracts.md](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/references/contracts.md) — valid projects without an explicit base cannot fetch or create a PR correctly — use the renderer’s existing default and test an omitted base.
- [Integration] The reference pipeline initializes submodules in a new worktree, but the plan does not — [.claude/scripts/auto-pipeline.sh:773](/Users/gorantubic/Workspace/claude-config/.claude/scripts/auto-pipeline.sh:773), [.plans/20261124-123513-bootstrap-upgrade-run.md:124](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:124) — projects whose checks or rendering depend on submodule content can produce incorrect results or fail — specify initialization, failure handling and safe cleanup, with a submodule test.

### Non-blocking concerns

- [Status] The `running` status merges a patch into the previous status without specifying that old `pr`, `error`, `endedAt` and hash fields are cleared — [.plans/20261124-123513-bootstrap-upgrade-run.md:113](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:113), [.plans/20261124-123513-bootstrap-upgrade-run.md:118](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:118) — initialize a fresh status for each run.
- [Verification] The real Claude permission behavior and GitHub integration cannot be verified within this reading-only review. The plan’s fakes cannot establish those behaviors — [.plans/20261124-123513-bootstrap-upgrade-run.md](/Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md) — provide evidence from controlled integration checks during implementation.

### Edge cases the plan should address

- A process dies between creating the lock file and writing its PID — a later run must handle an empty or malformed lock safely.
- A PR is created successfully but the process exits before recording its URL or applying the label — retry must reconcile the existing PR and finish the label or owner-checkbox action.
- The remote branch exists but its tracking ref has not been fetched — recovery must use a verified remote commit before creating a tracking worktree.
- Two stale-lock recovery attempts overlap with a new lock holder — recovery must never rename or remove the new holder’s lock.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
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
Update the plan at .plans/20261124-123513-bootstrap-upgrade-run.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Define an enforced isolation boundary for the unattended Claude session, and specify controlled checks that establish its read and write limits before relying on it. The cwd, tool list and worktree status check do not prove isolation. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:77, .plans/20261124-123513-bootstrap-upgrade-run.md:126)
2. Require proof that a leftover worktree and branch belong to this run, check for uncommitted work including submodules, and refuse cleanup when ownership or safety is uncertain. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:123, .claude/scripts/auto-pipeline.sh:548)
3. Make recovery from an interruption after commit and before the PR body is saved safe: persist and validate the metadata needed before publishing, and add a test for that interruption. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:122, .plans/20261124-123513-bootstrap-upgrade-run.md:131)
4. Apply the existing default for an omitted git.base and add a test for a valid answers file without that field. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:119, skills/bootstrap-project/references/contracts.md)
5. Specify submodule initialization, failure handling and safe cleanup for the upgrade worktree, and add a test with a submodule. (evidence: .claude/scripts/auto-pipeline.sh:773, .plans/20261124-123513-bootstrap-upgrade-run.md:124)

SHOULD FIX:
1. Initialize a fresh status for each run so fields from an earlier run cannot persist. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:113, .plans/20261124-123513-bootstrap-upgrade-run.md:118)
2. Specify controlled integration evidence for real Claude permission behavior and GitHub recovery; fake executables cannot establish either. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md)

ADD THESE EDGE CASES:
- A lock file is empty or malformed because its creator died before writing the PID.
- A PR is created but the process exits before recording it or completing the label action.
- The remote branch exists but its local tracking ref has not been fetched.
- Concurrent stale-lock recovery overlaps with a new lock holder.

Do not change anything the validation did not flag.
```