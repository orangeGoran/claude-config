## Plan validation (codex): 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues

- [Verification] The proposed `npm test` command passes quoted glob patterns to Node, but the repository supports Node 18 and the plan does not establish that this Node version expands them — [AGENTS.md:78](/Users/gorantubic/Workspace/claude-config/AGENTS.md:78), [plan:53](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:53) — the required full test command may fail before running the tests on a supported installation — use a test command compatible with Node 18, and verify that it runs all four files.

- [Restart] The migration preserves a custom dashboard port in setup but calls `npm run restart` without passing that port — [scripts/restart-dashboard.mjs:13](/Users/gorantubic/Workspace/claude-config/scripts/restart-dashboard.mjs:13), [plan:100](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:100) — the restart helper checks port 4899 by default and can report failure after successfully restarting a service configured on another port — pass the Mac’s configured `DASH_PORT` to the restart command and update the release note and owner instructions accordingly.

### Non-blocking concerns

- [Test coverage] The “missing bootstrap.json” assertion returns before the dashboard uses `BOOTSTRAP_SKILL`, so it does not by itself prove that path is correct — [scripts/plans-dashboard.mjs:895](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard.mjs:895), [plan:107](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:107) — add an assertion that a configured fixture runs the copied bootstrap renderer successfully.
- [Verification] The reference commit exists, but its full implementation was not verified in this read-only review. Compare the commit’s server and page changes to the proposed move before relying on it as a complete reference.

### Edge cases the plan should address

- A dashboard installed on a non-default port — the restart health check must use the same port as the launch service.
- Node 18 running the full suite — the test command must discover every moved test on the project’s minimum supported version.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] “How to verify” commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Replace the quoted-glob npm test command with a command that works on the supported Node 18 minimum and runs all four test files; include verification of that compatibility. (evidence: AGENTS.md:78, .plans/20261122-152506-move-apps-out-of-scripts.md:53)
2. Pass the configured DASH_PORT to npm run restart in the post-merge instructions and release note, so the restart helper checks the actual service port. (evidence: scripts/restart-dashboard.mjs:13, .plans/20261122-152506-move-apps-out-of-scripts.md:100)

SHOULD FIX:
1. Add a configured fixture that proves the dashboard can run the bootstrap renderer at BOOTSTRAP_SKILL; the missing-bootstrap case returns before using that path. (evidence: scripts/plans-dashboard.mjs:895, .plans/20261122-152506-move-apps-out-of-scripts.md:107)
2. Compare the full server and page changes in reference commit 72691e7 with the proposed move; the validation confirmed the commit exists but did not verify its full implementation. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:37)

ADD THESE EDGE CASES:
- A dashboard installed on a non-default port.
- The full test suite running on Node 18.

Do not change anything the validation did not flag.
```