## Plan validation (codex): 20261124-123513-bootstrap-upgrade-run.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] Stale-lock recovery can remove a new holder’s empty lock. After one process removes the stale lock, another can create a new empty lock before the first process renames it; the first process then treats the empty renamed file as stale and removes it. Two runs can proceed concurrently — `.plans/20261124-123513-bootstrap-upgrade-run.md:114`–`117` — use a lock protocol that verifies ownership without moving or deleting a replacement lock, and test this interleaving.
- [Data safety] Recovery removes every unregistered `bootstrap-upgrade-pending-*` folder, and can recursively remove an unregistered worktree-path folder, without proving the run created it or checking for user files — `.plans/20261124-123513-bootstrap-upgrade-run.md:120`, `.plans/20261124-123513-bootstrap-upgrade-run.md:124` — preserve unknown folders and fail with a recovery instruction; test folders containing user data.
- [Recovery] The plan treats an empty `git ls-remote` result as “no branch” without requiring that the command succeeded — `.plans/20261124-123513-bootstrap-upgrade-run.md:120`; the proposed `run()` returns a status separately at `.plans/20261124-123513-bootstrap-upgrade-run.md:113` — a network or authentication failure can be mistaken for a missing remote branch and send recovery down the wrong path. Require successful execution before interpreting its output, and test failure.
- [Integration] The dashboard opens the log under `<root>/.plans/auto-runs/` before spawning the script, but only the script creates that directory — `.plans/20261124-123513-bootstrap-upgrade-run.md:114`, `.plans/20261124-123513-bootstrap-upgrade-run.md:141` — a project without the directory cannot start its first run. Create the directory in the launcher and handle file-open and spawn errors; test a missing directory.
- [Security] The session boundary depends on the owner’s current global settings, while the plan acknowledges that the real boundary is unverified and tests only a fake Claude — `.plans/20261124-123513-bootstrap-upgrade-run.md:77`, `.plans/20261124-123513-bootstrap-upgrade-run.md:195`–`196` — inherited permissions can vary across projects and time, so the plan does not establish its claimed read/write restriction before an unattended run. Specify an enforceable isolation boundary or fail-closed permission configuration, and verify it before enabling the route.
- [Recovery] A single saved PR-body file is shared by all hashes. A later run can overwrite it while an earlier committed branch still needs recovery — `.plans/20261124-123513-bootstrap-upgrade-run.md:53`, `.plans/20261124-123513-bootstrap-upgrade-run.md:126` — the earlier run can no longer resume. Store the body per branch or hash and test overlapping failed runs.
- [Security] The plan redacts only the status error while appending raw Claude output to a persistent log and placing unvalidated Claude-produced questions and template updates in a PR body — `.plans/20261124-123513-bootstrap-upgrade-run.md:128`–`134`; the reference redactor is limited to patterns at `apps/scout/scout.mjs:48`–`52` — secrets or private project content can reach the log or GitHub. Define what data may leave the machine, validate and redact each output sink, and test the policy with fake sensitive data.

### Non-blocking concerns

- [Reference implementation] The plan uses `gh pr list`, whereas the dashboard deliberately uses the REST API because GraphQL can fail for the account — `apps/dashboard/server.mjs:1326`–`1340`. Consider using the existing REST approach or explain the operational tradeoff.
- [Verification] The real Claude permission boundary and GitHub behavior are **not verified** by the specified fake-based tests — `.plans/20261124-123513-bootstrap-upgrade-run.md:193`–`196`. A controlled test of the actual boundary and a draft PR against a disposable repository would provide evidence.

### Edge cases the plan should address

- A stale-lock contender pauses between checking and renaming while another process creates a replacement lock — mutual exclusion must survive the interleaving.
- A previous failed branch remains while a different template hash starts another run — both recovery bodies must remain available.
- The log directory is absent or cannot be created, and the child process cannot start — the route must return a useful failure.
- Remote branch lookup fails or returns malformed output — it must not be interpreted as an absent branch.
- An unregistered pending or worktree folder contains unrelated files — recovery must preserve them.
- Global Claude permissions differ from those assumed by the plan — an unattended run must fail closed.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected
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
1. Replace stale-lock recovery with a protocol that cannot rename or remove a replacement holder’s lock, and add a test for the interleaving where a new empty lock appears between the stale check and rename. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:114-117)
2. Preserve unregistered pending and worktree folders unless ownership and safe removal are established; otherwise fail with recovery instructions. Test folders containing user files. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:120,124)
3. Require git ls-remote to succeed and validate its output before treating an empty result as an absent branch; test network or authentication failure. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:113,120)
4. Create the log directory in the dashboard launcher before opening the log, handle file-open and spawn failures, and test a project with no auto-runs directory. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:114,141)
5. Specify an enforceable isolation boundary or fail-closed permission configuration for the real unattended Claude session, independent of assumed global settings, and verify it before enabling the route. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:77,195-196)
6. Store the saved PR body per branch or hash so a later run cannot overwrite the recovery data of an earlier committed branch; test overlapping failed runs. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:53,126)
7. Define and enforce the data allowed in persistent logs and GitHub PR bodies; validate and redact each output sink and add tests with fake sensitive data. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:128-134; apps/scout/scout.mjs:48-52)

SHOULD FIX:
1. Consider the dashboard’s REST PR-list approach, or explain why gh pr list and its GraphQL dependency are suitable for this runner. (evidence: apps/dashboard/server.mjs:1326-1340)
2. Add a controlled real-session and disposable-repository check to establish the Claude permission boundary and GitHub behavior that fake-based tests cannot prove. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:193-196)

ADD THESE EDGE CASES:
- A replacement empty lock appears while stale-lock recovery is in progress.
- Two different hashes have committed branches awaiting recovery.
- The log directory is absent or cannot be created, or the child cannot start.
- Remote branch lookup fails or returns malformed output.
- An unregistered pending or worktree folder contains unrelated files.
- Global Claude permissions differ from the assumed settings.

Do not change anything the validation did not flag.
```