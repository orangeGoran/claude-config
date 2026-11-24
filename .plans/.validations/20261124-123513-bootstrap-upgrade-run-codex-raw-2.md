## Plan validation (codex): 20261124-123513-bootstrap-upgrade-run.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Recovery] A pushed branch is resumed by removing the pending worktree and jumping to PR creation, but the plan does not establish a worktree or working directory for `gh pr create`. It also skips pushing solely because the remote branch exists, without checking that it contains the local commit. — [.plans/20261124-123513-bootstrap-upgrade-run.md:111](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:111>), [.plans/20261124-123513-bootstrap-upgrade-run.md:122](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:122>) — Retry can fail or open a PR for an older commit. Define the working directory and compare local and remote commit IDs before deciding whether to push.
- [Data safety] The stale-lock procedure treats every `process.kill(pid, 0)` error as a dead process and removes the lock; it also removes a lock without checking that it is still the one inspected. — [.plans/20261124-123513-bootstrap-upgrade-run.md:109](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:109>) — Permission errors or concurrent stale-lock recovery can admit two writers. Treat only `ESRCH` as a dead PID and use ownership-safe stale-lock recovery and removal.
- [Isolation] A run-folder working directory and no `--add-dir` do not establish that Claude can read and write **only** that folder. The proposed check sees tracked and untracked worktree changes, but does not protect other paths or ignored worktree files. — [.plans/20261124-123513-bootstrap-upgrade-run.md:73](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:73>), [.plans/20261124-123513-bootstrap-upgrade-run.md:117](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:117>) — The safety boundary on which unattended execution depends is unverified. Specify an enforceable filesystem boundary and test it, or explicitly remove the isolation claim and obtain an appropriate design for unattended writes.
- [Path safety] The encoding maps both `.claude` and `dot-claude` to `dot-claude`, and checking only the final merged file with `lstatSync` does not reject symlinked parent directories. — [.plans/20261124-123513-bootstrap-upgrade-run.md:56](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:56>), [.plans/20261124-123513-bootstrap-upgrade-run.md:118](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:118>) — Collisions or traversal through a parent symlink can select the wrong content or read outside the run folder. Use an injective encoding and validate every path component and destination containment.
- [Failure reporting] `must()` throws command stderr, while the plan writes errors into the status consumed by the dashboard and appends Claude output to a persistent log. It specifies no redaction. — [.plans/20261124-123513-bootstrap-upgrade-run.md:108](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:108>), [.plans/20261124-123513-bootstrap-upgrade-run.md:117](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:117>), [.plans/20261124-123513-bootstrap-upgrade-run.md:128](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:128>) — Tool errors or session output can expose credentials or URL queries. Specify sanitized status errors and redaction before persistent logging, with tests.
- [Commit] A hash change can produce no file changes besides `bootstrap.json`, while a missing saved hash can produce no changed files and no change to `bootstrap.json` after apply in some retry states. The plan unconditionally commits and treats a failed commit as failure. — [.plans/20261124-123513-bootstrap-upgrade-run.md:116](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:116>), [.plans/20261124-123513-bootstrap-upgrade-run.md:121](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:121>) — An empty staged diff cannot produce the promised commit or PR. Define and test the no-staged-change outcome before committing.

### Non-blocking concerns

- [Verification] The real Claude execution and its permissions are explicitly unverified; the proposed post-merge manual check is necessary to establish that behavior. — [.plans/20261124-123513-bootstrap-upgrade-run.md:168](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:168>) — Record the result and failure procedure as an open item.
- [Endpoint tests] The route tests cover a successful launch and unknown project but do not specify cross-origin or invalid-host rejection tests for the new entry point. — [.plans/20261124-123513-bootstrap-upgrade-run.md:157](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:157>) — Add coverage using the existing server access checks.
- [UI recovery] A status of `pr` is treated as open without rechecking GitHub in the route; a closed PR for the same hash can therefore leave the chip unable to retry. — [.plans/20261124-123513-bootstrap-upgrade-run.md:127](</Users/gorantubic/Workspace/claude-config/.plans/20261124-123513-bootstrap-upgrade-run.md:127>) — Define how closed PRs are detected and retried.

### Edge cases the plan should address

- Two processes recover the same stale lock concurrently — only one may own the run and write status.
- A branch exists remotely at an older commit than the local branch — retry must not open a PR with stale content.
- A merged output has a symlink in an ancestor directory or an encoded-path collision — validation must reject it before any worktree write.
- The upgrade stages no changes — it needs a successful, explicit outcome rather than an empty commit failure.
- The PR is closed without merging — the owner needs a way to start or recover the upgrade.

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
Update the plan at .plans/20261124-123513-bootstrap-upgrade-run.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Define a valid working directory for PR creation on a pushed-branch retry, and compare the remote and local commit IDs before skipping a push. Test a remote branch that is behind the local branch. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:111, .plans/20261124-123513-bootstrap-upgrade-run.md:122)
2. Treat only ESRCH as proof that a lock PID is dead, and make stale-lock recovery and lock removal ownership-safe under concurrent retries. Add concurrency and permission-error tests. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:109)
3. Specify and test an enforceable filesystem boundary for unattended Claude, including ignored worktree files and paths outside the worktree; otherwise revise the isolation claim and design the unattended write boundary explicitly. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:73, .plans/20261124-123513-bootstrap-upgrade-run.md:117)
4. Replace the ambiguous dot-prefix encoding with an injective encoding, and validate all path components and containment against symlink traversal before reading or writing files. Add collision and parent-symlink tests. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:56, .plans/20261124-123513-bootstrap-upgrade-run.md:118)
5. Specify sanitized status errors and redaction before persistent logging of command and Claude output, including credentials and URL queries; add tests. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:108, .plans/20261124-123513-bootstrap-upgrade-run.md:117, .plans/20261124-123513-bootstrap-upgrade-run.md:128)
6. Define and test the successful outcome when applying the upgrade leaves no staged changes, before attempting a commit. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:116, .plans/20261124-123513-bootstrap-upgrade-run.md:121)

SHOULD FIX:
1. Keep the real Claude permissions check as an explicit open item and state how to report failure. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:168)
2. Add invalid-host and cross-origin rejection coverage for the new route. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:157)
3. Define how the dashboard detects a closed, unmerged PR and permits recovery. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:127)

ADD THESE EDGE CASES:
- Concurrent recovery of one stale lock.
- A remote upgrade branch behind the local branch.
- An encoded-path collision or a symlink in a merged file's parent directory.
- No staged changes after apply.
- An upgrade PR closed without merging.

Do not change anything the validation did not flag.
```