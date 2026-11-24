**Validation round:** 1

## Plan validation: 20261124-161043-pipeline-diet-templates.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The plan's references to the templates, `render.mjs` and the tests match the repo, and the wiring is sound. One claim in Breaking changes is wrong: the pipeline does not pass `--fix` to the decision sheet. So by default, nobody fixes the Codex findings any more, and the sheet turns red with open items. The owner must see that before the plan runs. The other findings are should-fix items: edge cases in `run-usage.mjs`, a test-runner collision risk, and small text gaps.

### Blocking issues

- [Discrepancy / Breaking changes] The plan says that in "to PR" mode "the decision sheet still runs Codex once (its Step 2 items 1–4, with `--fix`)". The pipeline does not pass `--fix`. — `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:147` (args: `--base <base> --plan … --report <report> --out …`, no `--fix`); `skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md:66` ("With `--fix`, fix the VALID findings … A VALID finding that you did not fix becomes an open item (Step 3, kind 6)"); `decision-sheet/SKILL.md:101` (any kind-6 item → 🔴). The sheet also runs after the Commit phase (`skill-auto-pipeline/SKILL.md:122-147`), so a fix there would break "one commit per plan" (`skill-auto-pipeline/SKILL.md:16`). — Why it breaks: the plan's Goal says "the review value stays", and its Breaking changes tell the owner that Codex findings still get fixed. In fact, with the new default, each VALID Codex finding becomes an open kind-6 question, the sheet turns 🔴, and nothing fixes it. The owner decided "Codex leaves verify" with a wrong picture of the result. — Fix: correct the Breaking changes bullet. Say that in "to PR" mode the decision sheet runs Codex without `--fix`, and that its VALID findings become kind-6 open items (status 🔴) in the PR. Then either confirm with the owner that this is acceptable, or write it down as an owner question. Do not silently add `--fix` to pr step 6, because that would change files after the one commit.

### Non-blocking concerns

- [Edge case / run-usage] The compaction session writes into the same log. `start_session()` appends `compact_session` output to the same log (`claude -p "/compact …" --resume <id> --output-format stream-json`), and that output has its own assistant and `result` lines. — `templates/core/dot-claude/scripts/auto-pipeline.sh:453-455,492,496`. — Suggestion: name a rule for it. For example, a `compact` row that starts at the first line after the last pipeline `result`. As written, the compaction tokens, cost and wall minutes go into the last phase row (`ship` or `verify › test-review`). Add a test case for it.
- [Edge case / run-usage] Subagent lines in the stream. The plan counts every `type: "assistant"` line and also reads the subagent transcripts. If a CLI version streams subagent messages (`parent_tool_use_id` not null), the same tokens are counted twice. — I checked one local run log with `grep -c` and `grep -o`: the main assistant lines have `"parent_tool_use_id":null`, and the non-null values seen were on other line types (I did not print any content). — Suggestion: count only lines with `parent_tool_use_id === null` as main-session lines, and add a test case with a non-null line.
- [Test-runner collision] `run-usage.test.mjs` goes to `.claude/scripts/` in every project. A project runner whose default glob matches `*.test.mjs` and that walks into dot folders (Vitest's default include `**/*.{test,spec}.?(c|m)[jt]s?(x)`; the example stack uses Vitest, `references/bootstrap.example.json:24`) could pick up a `node:test` file and fail with "no test suite found". — Not verified: I cannot run Vitest here. A render into a Vitest repo, then `pnpm test`, would prove it either way. — Suggestion: give the file a name that the common runners do not match (for example `run-usage.check.mjs`), or state why the risk does not apply. The plan's deviation note (`plan:66`) does not cover this risk.
- [Test harness] Nested `node --test`. The new test runs `spawnSync(process.execPath, ['--test', …/run-usage.test.mjs])` from inside `npm test` (`node --test`), and the child inherits `NODE_TEST_CONTEXT`. No existing test does this (`grep "'--test'"` in `test/` and `apps/`: no hits). — Suggestion: pass `env` without `NODE_TEST_CONTEXT`, and assert on the exit code and on a pass count in stdout, so the check can fail.
- [Discrepancy] Breaking changes says "step 13 changes it" about the Codex test, but Step 13 is the `test-review` edit. The test change is Step 17. — `plan:113`, `plan:150`, `plan:154`.
- [Residue] The decision-sheet output block still has `` `✅ Codex: ran in verify, <n> fixed, <n> open` `` inside `@@IF MOD_CODEX@@`, so the default render keeps a variant that can no longer happen. — `decision-sheet/SKILL.md:131-134`. — Suggestion: move the "ran in verify" alternative into an `@@IF CODEX_IN_VERIFY@@` line, as Step 14 does for Step 0 and Step 2 item 0.
- [Vague step] Step 11 item 4 says "When `/skill-auto-pipeline` calls this skill, skip the full runs". `/skill-2-implement` gets no flag that says so (`skill-auto-pipeline/SKILL.md:68`: `/skill-2-implement <plan-file>`; `skill-2-implement/SKILL.md:4`: `argument-hint: "<plan file>"`). — Suggestion: pass `--unattended` (or a similar flag) in Phase 1 and key the skip on it, as `/skill-3-test` and `/skill-4-verify` do.
- [Vague step] Step 10 item 2a says "one retry alone" but does not name the command. — Suggestion: say "with the "Test (one file)" command (or the runner's file filter of "Test (end to end)")". When that row is "not available yet", the retry "cannot start" and the gate stays failed (the plan already covers this case).
- [Coverage] The new `@@IFNOT HAS_LINT_CHECK@@` "After the loop" block (Step 8) has no test: the example answers have `lintCheck` (`bootstrap.example.json:27`), so the default render never shows the block. — Suggestion: add one render with `stack.commands.lintCheck: ""` and assert the block text and the new Step 2 lint wording.
- [Premise] "A nested `AGENTS.md` loads by itself when you read a file in its folder" holds through the `CLAUDE.md` → `@AGENTS.md` shim, which `verify.mjs` requires next to each `AGENTS.md` (`skills/bootstrap-project/scripts/verify.mjs:203-209`). — Suggestion: name the shim in the skill text or in Context, so a reader knows why the rule is safe. I could not verify from here that a headless session loads nested memory on a Read.
- [Template safety] `run-usage.mjs` and its test go through `renderText()` (`render.mjs:783`), and `verify.mjs` scans `.claude/` for `@@…@@` (`verify.mjs:194`). — Suggestion: add a Hard-rules or Steps note that the script and its fixtures contain no `@@NAME@@` text.
- [Scope] The plan is standalone (no `- **Parent**:` line), and `docs/roadmap.md` does not list it. That is allowed, because the roadmap has no open decision on pipeline cost (`docs/roadmap.md:34-36`). It does not contradict the fleet parent plan's open decisions (`.plans/20261124-123512-bootstrap-fleet-upgrade-parent.md:35-39`).

### Edge cases the plan should address

- The compaction session in the same log (see above). Without a rule, the last phase looks too expensive and too long.
- A resumed run appends a second pipeline session to the same log. The plan handles two session ids with two tables, but a resume with the same session id (`--resume`) would merge the timelines. Name the rule.
- A Claude Code project folder whose name the CLI shortened (long worktree paths): "folder name contains the log slug" may not match. The plan already defines the warning and the "main session only" fallback, which is fine. Name this cause in the warning text.
- `pipeline.codexInVerify: true` with `modules.codex` missing (not `false`). That is valid, because `moduleOn` treats missing as on (`render.mjs:185`). Add it to the checkParams test as a pass case.
- The default "to PR" run where Codex finds a VALID defect: the sheet goes 🔴 and the PR shows an open question (see the blocking issue). Add a test or a Breaking-changes line for it.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (checked: `render.mjs` `checkParams` 84-176, `moduleOn` 185, `MODULE_INFO` 188-198, `unusedParts` 209-250, `commandRows`/`extraRows`/`commandsMd` 348-358, `allow` 365-378 with `'Bash(gh issue view*)', 'Bash(gh run view*)'` at 372, `HAS_LINT_CHECK` 612, `MOD_CODEX` 649, `REPORTING_RULES` 683-684, `isExecutable` 737, `--vars` 977-980; every quoted sentence in skill-4-verify 48, 67, 85, 91, 106, 112, 156; skill-3-test 33, 36, 90, 141, 143; skill-2-implement 20, 67; skill-auto-pipeline 76-78, 83-84, 148-150; test-review 64; decision-sheet 3-6, 23-26, 58; AGENTS.md.tmpl 52-54; reporting-rules.md 14-19; contracts.md 117, 129; checklist.md 19, 61, 78)
- [x] Reference implementation mirrored, deviations justified (except that the test-runner risk of the `run-usage.test.mjs` location is not covered)
- [ ] Breaking changes for changed symbols listed (consumer search done: `--no-codex`, `--codex-report`, "after the PR opened"; the `--fix` claim is wrong, and the step number is wrong)
- [x] Wiring & registration matches the code (`renderAll` walks `core/`, `isExecutable` matches `.claude/scripts/*.mjs`, `COMMANDS_TABLE` feeds `AGENTS.md.tmpl:90` and `README.md:17`, the `--vars` listing comes from `buildVars`)
- [x] Scope stays inside the goal; no open decision is taken silently (the roadmap lists none; the plan lists its own decisions 1A and 2A)
- [x] Restart after dashboard changes respected (no `apps/dashboard/` file)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (the plan names no project, path or cost; it uses `acme-api` and made-up ids)
- [x] Global rules affect every project respected (only `skills/bootstrap-project/`; the templates reach projects on upgrade)
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected (gaps: the compaction case, the `parent_tool_use_id` case, the no-lint-check render)
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; `bootstrap.json` is documented in `contracts.md`)
- [x] "How to verify" commands are real and can fail (`node --test`, `render.mjs --vars`, `npm test` = `node --test apps/*/test/*.test.mjs test/*.test.mjs`, `.claude/scripts/changelog-validate.mjs` exists)

```
Update the plan at .plans/20261124-161043-pipeline-diet-templates.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Correct the Breaking changes bullet about "to PR" mode. The pipeline's pr step 6 calls the decision sheet without --fix, so its Codex review fixes nothing. Each VALID Codex finding becomes a kind-6 open item, and the sheet status becomes red. State this consequence, and record that the owner accepts it, or add it as an owner question. Do not add --fix to pr step 6: the sheet runs after the one commit. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:147, skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md:66 and :101, skill-auto-pipeline/SKILL.md:16)

SHOULD FIX:
1. Add a run-usage rule and a test for the compaction session that auto-pipeline.sh appends to the same log (its own assistant and result lines), for example a separate "compact" row. (evidence: templates/core/dot-claude/scripts/auto-pipeline.sh:453-455, :492, :496)
2. Count only main-session assistant lines (parent_tool_use_id null) from the log, so that subagent tokens are not counted twice next to the transcripts. Add a test case with one non-null line.
3. Address the risk that a project test runner (Vitest default glob) picks up .claude/scripts/run-usage.test.mjs. Rename the file to a name that the runners do not match, or state why the risk does not apply. (evidence: references/bootstrap.example.json:24, plan Deviations)
4. In the bootstrap test that spawns node --test on the rendered run-usage test, pass an env without NODE_TEST_CONTEXT, and assert on a pass count as well as the exit code.
5. Fix the step number in Breaking changes: the Codex test changes in Step 17, not Step 13.
6. Move the "ran in verify" alternative in the decision-sheet output block (decision-sheet/SKILL.md:133) under @@IF CODEX_IN_VERIFY@@.
7. Make Step 11 item 4 testable: pass a flag (for example --unattended) from skill-auto-pipeline Phase 1 to /skill-2-implement, and key the skip of the full runs on that flag. (evidence: skill-auto-pipeline/SKILL.md:68, skill-2-implement/SKILL.md:4)
8. In Step 10 item 2a, name the command for "retry alone" ("Test (one file)", or the file filter of "Test (end to end)").
9. Add a render test with stack.commands.lintCheck empty, which asserts the new "After the loop" block and the new Step 2 lint text.
10. Write that run-usage.mjs and its test hold no @@NAME@@ text (renderText and the verify placeholder check read them).

ADD THESE EDGE CASES:
- A resumed run that appends a second session (or the same session id) to the same log.
- A Claude Code project folder whose name the CLI shortened, so no folder contains the slug (name the cause in the warning).
- pipeline.codexInVerify true with modules.codex missing: valid (moduleOn treats missing as on). Add it as a pass case in the checkParams test.
- A default "to PR" run in which Codex finds a VALID defect: the sheet is red and the PR shows an open question.

Do not change anything the validation did not flag.
```
