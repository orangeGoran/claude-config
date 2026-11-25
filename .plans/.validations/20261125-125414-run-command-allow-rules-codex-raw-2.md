## Plan validation (codex): 20261125-125414-run-command-allow-rules.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Upgrade] A kept CONFIG block receives `RUN_CMDS` only when the setting is absent. After the first upgrade, adding, changing or removing a `run: true` row leaves the existing `RUN_CMDS` unchanged along with `RUN_EXTRA_ALLOW`. The launch can therefore skip the new command and fail to catch its missing permission; it can also retain a removed command’s rule. `newSettings()` adds only missing names, and `keepConfig()` preserves existing settings — [render.mjs:884](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/render.mjs:884), [render.mjs:900](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/render.mjs:900). Define how both settings stay synchronized or how launch detects stale settings, and test a second upgrade that adds, changes and removes rows.
- [Tests] The proposed `worktree_problem()` test passes `cwd: repo`, but `pipelineBash()` accepts its fourth argument as environment variables and does not pass a `cwd` option to `spawnSync` — [bootstrap-project.test.mjs:103](/Users/gorantubic/Workspace/claude-config/test/bootstrap-project.test.mjs:103). The marker is created relative to the test runner’s working directory, so the positive control cannot prove the stated behavior and may write outside the temporary repo. Extend the helper to accept a working directory, or explicitly enter the temporary repo in the test.
- [Tests] The planned first upgrade test expects status `config` and a `+ RUN_CMDS=` diff, but the existing upgrade path first adds missing settings to the kept block, compares that result with the rendered block, and reports `changed` when the file content changes — [render.mjs:903](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/render.mjs:903), [render.mjs:945](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/render.mjs:945). Correct the expected status and diff, and distinguish the first upgrade from later changes to an existing setting.

### Non-blocking concerns

- [Verification] The launcher’s matcher is a local approximation, and the plan correctly marks actual Claude Code matching of an environment-prefixed rule as unverified — [auto-pipeline.sh:273](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:273). The proposed real run is needed to establish that behavior.

### Edge cases the plan should address

- A later upgrade adds, edits or removes a run row after `RUN_CMDS` already exists — stale configuration can omit a permission check or retain an unwanted rule.
- An existing broader allow rule already matches a newly added row — a missing row-specific rule will not necessarily make preflight refuse it.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261125-125414-run-command-allow-rules.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Define how RUN_CMDS and RUN_EXTRA_ALLOW stay synchronized, or how launch detects stale settings, when a kept CONFIG block already contains them and a later upgrade adds, changes or removes a run row. Add tests for all three changes. newSettings() adds only missing setting names and keepConfig() preserves existing ones (evidence: skills/bootstrap-project/scripts/render.mjs:884, skills/bootstrap-project/scripts/render.mjs:900).
2. Fix the worktree_problem() test setup so its shell runs in the temporary repo. Extend pipelineBash() to accept cwd or explicitly enter the repo; its current fourth argument is environment variables and spawnSync receives no cwd (evidence: test/bootstrap-project.test.mjs:103).
3. Correct the first-upgrade test’s expected status and diff. A missing RUN_CMDS is added to the kept block before its diff is calculated, and a changed file reports changed; separately test later changes to an existing setting (evidence: skills/bootstrap-project/scripts/render.mjs:903, skills/bootstrap-project/scripts/render.mjs:945).

SHOULD FIX:
1. Keep actual Claude Code matching of environment-prefixed rules explicitly unverified until a real run checks it; rule_matches() is the launcher's own approximation (evidence: skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:273).

ADD THESE EDGE CASES:
- A later upgrade adds, edits or removes a run row after RUN_CMDS already exists.
- A broader existing allow rule matches a new row, so a missing row-specific rule alone does not make preflight refuse it.

Do not change anything the validation did not flag.
```