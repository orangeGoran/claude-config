## Plan validation (codex): 20261125-125414-run-command-allow-rules.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Upgrade] An upgrade preserves the existing `RUN_EXTRA_ALLOW` setting, so adding a `run: true` row adds `RUN_CMDS` but does not add its generated allow rule to an existing CONFIG block. The launch then refuses the command. This also affects the owner’s proposed upgrade of this repo. — `skills/bootstrap-project/scripts/render.mjs:23`, `skills/bootstrap-project/scripts/render.mjs:877`, `.plans/20261125-125414-run-command-allow-rules.md:146` — Specify how upgrades reconcile generated run-row rules with a kept CONFIG block, including later additions and removals, without losing owner-tuned rules. Test the complete upgraded overlay and preflight.
- [Project rules] The proposed Commands paragraph restricts **every** Commands-table row to `stack.extraCommands` with `run: true`. Standard test, lint and build rows are generated separately and have no such field, so the rule would prohibit normal pipeline checks. — `.plans/20261125-125414-run-command-allow-rules.md:95`, `skills/bootstrap-project/scripts/render.mjs:365`, `skills/bootstrap-project/scripts/render.mjs:373` — Scope the restriction to the repo’s extra command rows and retain the existing rules for standard rows.
- [Tests] Adding `run: true` to the shared example changes the input used by `bootstrapRepo()` and `webUi()`. The existing preflight test sets `ALLOW_RULES` from the overlay and later removes rules to exercise failure; the plan calls that fixture a repo without run rows and does not account for the new command. — `test/bootstrap-project.test.mjs:16`, `test/bootstrap-project.test.mjs:97`, `test/bootstrap-project.test.mjs:136`, `skills/bootstrap-project/references/bootstrap.example.json:41` — Update the existing fixtures and assertions explicitly, including a fixture with no opted-in rows and a passing preflight with the example row enabled.
- [Permission checks] The validators are instructed to accept any matching allow rule without checking matching deny rules. The launcher checks deny rules first, so a plan can pass validation even though its command will be refused. — `.plans/20261125-125414-run-command-allow-rules.md:92`, `skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:303` — Require both validators and the planning skill to account for applicable deny rules and identify sources they cannot verify.

### Non-blocking concerns

- [Verification] The proposed `rule_matches` test verifies the launcher’s Bash matcher, not Claude Code’s permission matcher. The existing `QA_*` rule is not evidence that the exact env-prefixed rule works in Claude Code. — `.plans/20261125-125414-run-command-allow-rules.md:113`, `.plans/20261125-125414-run-command-allow-rules.md:124` — Mark actual Claude Code matching as not verified until the stated first-run check provides evidence.
- [Tests] The marker test calls `worktree_problem()` directly; it does not exercise the permission preflight and cannot by itself prove the complete launch never executes a run row. — `.plans/20261125-125414-run-command-allow-rules.md:111`, `skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:337` — Add coverage of the relevant launch path or narrow the claim.
- [Documentation] The proposed lesson records a past incident, while the plan says documentation contains no history. — `.plans/20261125-125414-run-command-allow-rules.md:34`, `.plans/20261125-125414-run-command-allow-rules.md:99` — State the current rule without the incident history.

### Edge cases the plan should address

- A command with a matching allow rule and a matching deny rule — the launcher refuses it.
- A project adds, changes or removes an opted-in row after `RUN_CMDS` already exists — both the checked list and the effective overlay must reflect the intended upgrade result.
- A command starts with the opted-in text but continues as a different executable or argument — the trailing wildcard grants a broader prefix than the literal command; document and test the intended boundary.

### Checklist

- [x] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [ ] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected
- [ ] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261125-125414-run-command-allow-rules.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Specify how an upgrade reconciles generated run-row allow rules with the existing kept RUN_EXTRA_ALLOW CONFIG setting, including later additions and removals, while preserving owner-tuned rules. Test the effective upgraded overlay and preflight, including this repo’s proposed upgrade. (evidence: skills/bootstrap-project/scripts/render.mjs:23, skills/bootstrap-project/scripts/render.mjs:877, .plans/20261125-125414-run-command-allow-rules.md:146)
2. Scope the proposed Commands-table restriction to extra command rows. Preserve the existing behavior of standard test, lint and build rows, which are generated separately and have no run field. (evidence: .plans/20261125-125414-run-command-allow-rules.md:95, skills/bootstrap-project/scripts/render.mjs:365, skills/bootstrap-project/scripts/render.mjs:373)
3. Update the existing test fixtures and assertions for the example row’s new run flag. Include a fixture without opted-in rows and a passing preflight with the example row enabled. (evidence: test/bootstrap-project.test.mjs:16, test/bootstrap-project.test.mjs:97, test/bootstrap-project.test.mjs:136, skills/bootstrap-project/references/bootstrap.example.json:41)
4. Require both plan validators and the planning skill to consider applicable deny rules as well as allow rules, and to identify permission sources they cannot verify. (evidence: .plans/20261125-125414-run-command-allow-rules.md:92, skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:303)

SHOULD FIX:
1. Mark Claude Code’s actual matching of the env-prefixed rule as not verified until the first real run confirms it; the shell matcher test is not that confirmation. (evidence: .plans/20261125-125414-run-command-allow-rules.md:113, .plans/20261125-125414-run-command-allow-rules.md:124)
2. Cover the relevant launch path in the check-only test, or narrow the claim made for the direct worktree_problem test. (evidence: .plans/20261125-125414-run-command-allow-rules.md:111, skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:337)
3. State the current rule in the lesson without the incident history. (evidence: .plans/20261125-125414-run-command-allow-rules.md:34, .plans/20261125-125414-run-command-allow-rules.md:99)

ADD THESE EDGE CASES:
- A command matches both an allow rule and a deny rule.
- An opted-in row is added, changed or removed after RUN_CMDS already exists in a kept CONFIG block.
- A trailing wildcard matches a different executable or argument that starts with the opted-in command text; document and test the intended boundary.

Do not change anything the validation did not flag.
```