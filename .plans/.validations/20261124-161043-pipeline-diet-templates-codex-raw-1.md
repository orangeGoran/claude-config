## Plan validation (codex): 20261124-161043-pipeline-diet-templates.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Project rules] The plan replaces explicit reads of nested `AGENTS.md` files and the configured harness document with an assumption that reading any file in the folder loads them. The renderer recognizes a folder’s `AGENTS.md` as loaded only when a `CLAUDE.md` shim exists; the proposed instructions do not check for that shim, and reading a file in another test folder does not ensure the configured harness document was read. — `skills/bootstrap-project/scripts/render.mjs:887`, `skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:33`, `.plans/20261124-161043-pipeline-diet-templates.md:136` — A run can miss project rules or harness constraints. Retain explicit reads, or specify and test a reliable fallback when automatic loading cannot be established.
- [Test integrity] The proposed post-review lint command may fix files, but the plan does not require scoped tests after those fixes. The existing test step explicitly requires those tests because lint fixes can change behavior. — `.plans/20261124-161043-pipeline-diet-templates.md:131`, `skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:90` — Standalone verify can pass with untested changes. Re-run the relevant scoped tests after a fixing lint command changes files, and include those changes in the pipeline regression gate.
- [Usage calculation] The plan assumes the launcher’s stream-json assistant events contain timestamps and that result events contain `model_usage_since_last_result`, but the repository does not establish either field in the captured stream. Its dashboard test emits assistant and result events without them. — `.plans/20261124-161043-pipeline-diet-templates.md:165`, `apps/dashboard/test/dashboard.test.mjs:60` — The prescribed calculation can produce missing timing or zero cost for otherwise valid logs. Specify handling for missing fields and how timing and cost are obtained or reported as unavailable; add representative tests. The actual fields in a current Claude log are **not verified** by this read-only review; a documented schema or a sanitized captured log would prove them.

### Non-blocking concerns

- [Verification] `render.mjs --vars` exits successfully when the requested variables are absent; the plan asks a person to inspect its output. — `.plans/20261124-161043-pipeline-diet-templates.md:220`, `skills/bootstrap-project/scripts/render.mjs:977` — Add an automated assertion that fails when either variable is missing.
- [Reporting] The claim that test and verify never run after a PR opens is not enforced by those standalone skills. Removing the shared reporting instruction can leave a PR body stale after a manual follow-up. — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:20`, `skills/bootstrap-project/templates/core/dot-claude/skills/skill-4-verify/SKILL.md:32` — Preserve the instruction for standalone follow-ups or define how those runs update the PR.

### Edge cases the plan should address

- A test folder has no existing file, or its `AGENTS.md` has no loading shim — rules still need to be read before creating a test.
- A fixing lint command changes production code after the review loop — test the resulting tree before verify passes.
- A valid log lacks timestamps or per-result model costs, or its subagent metadata is missing — report unavailable values without presenting invented precision.

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
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261124-161043-pipeline-diet-templates.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Retain explicit reads of applicable nested AGENTS.md files and the configured test harness document, or specify and test a reliable fallback when their automatic loading cannot be established. Cover empty test folders and folders without a CLAUDE.md shim. (evidence: skills/bootstrap-project/scripts/render.mjs:887, skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:33, .plans/20261124-161043-pipeline-diet-templates.md:136)
2. Require scoped tests after the post-review fixing lint command changes files, and include those changes in the pipeline regression gate. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:131, skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:90)
3. Specify how run-usage handles valid stream-json events without timestamps or model_usage_since_last_result, including how timing and cost are obtained or reported as unavailable. Add representative tests. Verify the current event fields against documented schema or a sanitized captured log before relying on them. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:165, apps/dashboard/test/dashboard.test.mjs:60)

SHOULD FIX:
1. Add an automated assertion that fails when render.mjs --vars omits either new variable. (evidence: .plans/20261124-161043-pipeline-diet-templates.md:220, skills/bootstrap-project/scripts/render.mjs:977)
2. Preserve PR-body reporting for standalone test and verify runs after a PR opens, or define an equivalent follow-up mechanism. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md:20, skills/bootstrap-project/templates/core/dot-claude/skills/skill-4-verify/SKILL.md:32)

ADD THESE EDGE CASES:
- An empty test folder or an AGENTS.md without a loading shim.
- A fixing lint command changes production code after the review loop.
- Valid logs omit timestamps or per-result model costs, or subagent metadata is missing.

Do not change anything the validation did not flag.
```