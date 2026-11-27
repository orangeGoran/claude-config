## Plan validation (codex): 20261127-230101-contracts-jump-autopilot.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Correctness] The watcher uses an ordinary submodule fetch, then reads `origin/<branch>`. A submodule whose fetch configuration excludes that branch can retain a stale tip or report that the branch is missing. The generated jump plan already uses an explicit refspec for this reason — [.plans/20261127-230101-contracts-jump-autopilot.md:202](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:202), [.plans/20261127-230101-contracts-jump-autopilot.md:205](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:205) — Resolve the branch first, fetch it with an explicit refspec, and test a restricted fetch configuration.
- [Security] The PR-list failure is stored as `ghProblem(output)` and returned through the ledger, but `ghProblem()` only truncates the first line; it does not redact credentials or URL queries — [.plans/20261127-230101-contracts-jump-autopilot.md:205](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:205), [apps/dashboard/server.mjs:1512](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:1512), [apps/dashboard/watch.mjs:133](/Users/gorantubic/Workspace/claude-config/apps/dashboard/watch.mjs:133) — Redact command errors before storing or returning them, and test a failure containing a credential and query string.
- [Workflow guard] An unknown commit folder falls back to the guard’s own worktree, whose `auto/*` branch and staged-file exemptions can allow the command. A commit targeting another worktree can therefore pass without that worktree’s rules being checked — [.plans/20261127-230101-contracts-jump-autopilot.md:225](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:225), [workflow-guard.sh:80](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:80) — Block an unknown target or otherwise check every possible target without applying an unrelated worktree’s exemptions; test an unknown target when the guard runs from `auto/*`.

### Non-blocking concerns

- [Verification] The plan depends on the still-unmerged 2a checklist and ledger implementation. Its final signatures and wiring cannot be verified from this checkout — [.plans/20261127-230101-contracts-jump-autopilot.md:23](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:23) — Recheck those references against the merged 2a code before implementation.
- [Pagination] Five full pages produce “more than 500 open PRs” even when there are exactly 500 — [.plans/20261127-230101-contracts-jump-autopilot.md:205](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230101-contracts-jump-autopilot.md:205) — Check one additional page or use wording that includes exactly 500.

### Edge cases the plan should address

- A watched branch excluded by the submodule’s configured fetch refspec — the displayed tip must still be current.
- A command error containing credentials or a URL query — persisted state and API responses must be redacted.
- An unknown commit target while the guard’s own branch is `auto/*` — the target must not inherit that branch’s exemption.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [ ] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] “How to verify” commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230101-contracts-jump-autopilot.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Resolve the watched branch before fetching it, fetch that branch with an explicit refspec, and test a submodule whose fetch configuration excludes it. The generated plan already uses an explicit refspec for this case. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:202 and :205)
2. Redact PR-list command errors before they are stored or returned, and test an error containing credentials and a URL query. ghProblem() truncates but does not redact. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:205; apps/dashboard/server.mjs:1512; apps/dashboard/watch.mjs:133)
3. Block an unknown commit target or check every possible target without applying an unrelated worktree's exemptions. Add a test where the target is unknown and the guard's own branch is auto/*. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:225; skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:80)

SHOULD FIX:
1. Recheck the checklist and ledger references and wiring against the merged 2a implementation before implementation begins. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:23)
2. Distinguish exactly 500 open PRs from more than 500, or change the error wording. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:205)

ADD THESE EDGE CASES:
- A watched branch excluded by the submodule's configured fetch refspec.
- A command failure containing credentials or a URL query.
- An unknown commit target while the guard's own branch is auto/*.

Do not change anything the validation did not flag.
```