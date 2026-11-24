## Plan validation (codex): 20261124-123513-bootstrap-upgrade-run.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] The lock is checked before fetch and worktree creation, but `running` is written only afterward. Two launches can pass the check; a losing process can then overwrite the live run’s status with `failed` — `.plans/20261124-123513-bootstrap-upgrade-run.md:103`, `.plans/20261124-123513-bootstrap-upgrade-run.md:111` — acquire an atomic per-project lock before launch work, give its owner sole authority over status, and test simultaneous requests.
- [Data safety] The selected hash and base come from the main checkout, but rendering and `renderHash` use the worktree’s committed answers. Uncommitted or unpushed answer changes can therefore produce a PR for different inputs and a status hash that falsely identifies it — `.plans/20261124-123513-bootstrap-upgrade-run.md:103`, `skills/bootstrap-project/scripts/render.mjs:985`, `skills/bootstrap-project/scripts/render.mjs:1042` — verify the answers and base against the fetched commit before starting, or explicitly define and safely carry the intended inputs.
- [Decision validation] The plan accepts extra decision paths and then copies merged files into the worktree without requiring every entry to belong to the rendered `changed` set or checking path containment and symlinks — `.plans/20261124-123513-bootstrap-upgrade-run.md:106`, `.plans/20261124-123513-bootstrap-upgrade-run.md:107` — reject unknown, duplicate, absolute, traversal and escaping paths before any write, and test these cases.
- [Failure handling] A failed run keeps its worktree and branch, while the failure chip immediately offers a retry that always fails the existing-branch check. A push that succeeds before PR creation fails also has no recovery path — `.plans/20261124-123513-bootstrap-upgrade-run.md:103`, `.plans/20261124-123513-bootstrap-upgrade-run.md:106`, `.plans/20261124-123513-bootstrap-upgrade-run.md:111`, `.plans/20261124-123513-bootstrap-upgrade-run.md:117` — specify safe recovery for each stage, including an already-pushed branch and an already-created PR, without discarding work or duplicating PRs.
- [Integration] The script invokes Claude only when there are `changed` files, but always reads `decisions.json` afterward — `.plans/20261124-123513-bootstrap-upgrade-run.md:105`, `.plans/20261124-123513-bootstrap-upgrade-run.md:106` — a valid run containing only new files, a `.gitignore` merge, or a hash change fails. Define empty decisions for that path and test it.
- [Verification] `verify.mjs` exits with code 1 when required checks fail, while the planned `execFileSync` helper throws on nonzero exit before the specified JSON parsing and failed-check reporting — `.plans/20261124-123513-bootstrap-upgrade-run.md:102`, `.plans/20261124-123513-bootstrap-upgrade-run.md:108`, `skills/bootstrap-project/scripts/verify.mjs:265` — capture and parse stdout on the expected failure exit, distinguish execution errors, and test both.
- [Project rule] The restart instruction omits the condition that live chats must be running under the relay before restarting — `.plans/20261124-123513-bootstrap-upgrade-run.md:33`, `AGENTS.md:10` — include that condition in the worktree report and post-merge instructions.
- [Private data] The plan’s example embeds a project name and private workspace paths in a public repository plan — `.plans/20261124-123513-bootstrap-upgrade-run.md:12`, `AGENTS.md:12` — replace them with generic made-up examples.

### Non-blocking concerns

- [Reference implementation] Cleanup uses `git branch -d`, which can refuse the branch after a squash merge even after the worktree is removed — `.claude/scripts/auto-pipeline.sh:574` — document the safe follow-up and avoid promising that cleanup always deletes the branch.
- [Verification limit] The real headless Claude permissions and merge behavior cannot be verified by this read-only review; the planned fake does not exercise them — `.plans/20261124-123513-bootstrap-upgrade-run.md:148` — retain the planned real-run evidence and verify that the session can write only the intended run artifacts.
- [Release note] A failed `no-changelog` label call is allowed to continue, although a target project’s gate may require the label — `.plans/20261124-123513-bootstrap-upgrade-run.md:28`, `changelog.d/AGENTS.md:5` — surface the missing label as an explicit owner action.

### Edge cases the plan should address

- Two launches arrive before either writes status; one process must not change the other’s status.
- The fetched base differs from the checkout’s answers, or the base advances during a run; the PR and displayed hash must identify the inputs used.
- Only new files or a hash change exist; no Claude decisions are needed.
- Push succeeds but PR creation times out or its response is lost; recovery must detect existing remote state.
- A decision contains an unknown or escaping path, or a merged-file path resolves through a symlink.
- A failed run leaves uncommitted work; retry and cleanup must preserve it.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] “How to verify” commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261124-123513-bootstrap-upgrade-run.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Acquire an atomic per-project lock before fetch or worktree creation, make its owner solely responsible for run status, and test simultaneous launches and a losing process. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:103, .plans/20261124-123513-bootstrap-upgrade-run.md:111)
2. Ensure the selected base, answers, displayed hash and rendered worktree all refer to the same intended inputs; detect uncommitted or unpushed answer changes and a changed fetched base. Add tests. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:103, skills/bootstrap-project/scripts/render.mjs:985, skills/bootstrap-project/scripts/render.mjs:1042)
3. Validate that decisions contain exactly the rendered changed paths, reject absolute, traversal, unknown and duplicate paths, and prevent symlink escapes before reading or writing merged files. Add tests. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:106, .plans/20261124-123513-bootstrap-upgrade-run.md:107)
4. Define safe retry and recovery for failures before and after commit, push and PR creation, preserving uncommitted work and detecting existing remote branches or PRs. Make the failure chip match that recovery. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:103, .plans/20261124-123513-bootstrap-upgrade-run.md:106, .plans/20261124-123513-bootstrap-upgrade-run.md:111, .plans/20261124-123513-bootstrap-upgrade-run.md:117)
5. Define empty decisions when no files have changed status, and test runs with only new files, a merge or a hash change. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:105, .plans/20261124-123513-bootstrap-upgrade-run.md:106)
6. Capture and parse verify.mjs JSON on its expected nonzero failure exit, distinguish execution errors, and test both. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:102, .plans/20261124-123513-bootstrap-upgrade-run.md:108, skills/bootstrap-project/scripts/verify.mjs:265)
7. State that the post-merge dashboard restart runs only when the relay check shows live chats run under the relay. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:33, AGENTS.md:10)
8. Replace the project name and private workspace paths in the example with generic made-up values. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:12, AGENTS.md:12)

SHOULD FIX:
1. Document that cleanup can refuse to delete a branch after a squash merge and give a safe follow-up. (evidence: .claude/scripts/auto-pipeline.sh:574)
2. Verify in the real-run evidence that headless Claude can create the required artifacts with the specified permissions and is confined to the intended writes. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:105, .plans/20261124-123513-bootstrap-upgrade-run.md:148)
3. Surface a failed no-changelog label call as an owner action when the target project requires it. (evidence: .plans/20261124-123513-bootstrap-upgrade-run.md:28, changelog.d/AGENTS.md:5)

ADD THESE EDGE CASES:
- Concurrent launches before status is written.
- Answers differ between the checkout and fetched base, or the base advances during the run.
- No changed files, but new files, a merge or a hash change exists.
- Push succeeds but PR creation times out or its response is lost.
- Unknown or escaping decision paths and symlink escapes.
- Failed runs leave uncommitted work that retry or cleanup must preserve.

Do not change anything the validation did not flag.
```