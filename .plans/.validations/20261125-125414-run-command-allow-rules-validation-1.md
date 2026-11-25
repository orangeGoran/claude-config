**Validation round:** 1

## Plan validation: 20261125-125414-run-command-allow-rules.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues
- [Tests / edge case] The test "The preflight never runs a run row" cannot pass as written. It calls `worktree_problem "<tmp dir>" "<tmp dir>/log" fresh; echo DONE` through `pipelineBash()`. — Evidence: `test/bootstrap-project.test.mjs:107` (`pipelineBash` runs `bash -c "set -euo pipefail\n…"`); `skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:353-355` (with `$3 = fresh` it runs `dirty="$(git -C "$1" status --porcelain | head -n 5 | tr '\n' ' ')"`); `test/bootstrap-project.test.mjs:17` (the `dir` from `mkdtempSync(os.tmpdir())` is not a git repo; only `repo` gets `git init`). — Why it breaks: in a folder that is not a git repo, `git -C` exits 128. With `pipefail` the command substitution fails, so the assignment fails, and `set -e` stops the script before `echo DONE`. The test then fails for the wrong reason, and it cannot prove the check-only contract. If `<tmp dir>` is `repo` instead, `fresh` sees the untracked rendered files and prints "the preflight changed files…". `DONE` still prints, but the assertion does not show that. — Fix: drop the `fresh` argument (the function needs only `$1` and `$2` for this check). Name the folder exactly: use `repo` as `$1`, because `run-row-ran` is a relative path and `worktree_problem` runs commands with `cd "$1"`. Assert that stdout is `DONE` with no problem line before it, and that `<repo>/run-row-ran` does not exist. To show that the test can fail, put the same row in `pipeline.preflight` (or assert in a second call that a `PREFLIGHT_CMDS` entry `touch preflight-ran` does create its file). The other dependencies are fine: `worktree_problem` calls no other script function, `PREFLIGHT_CMDS` is `()` in the example answers (`bootstrap.example.json:143`), and `BROWSER_TEST_PROJECT` is empty because the example has `role: backend` and `appUrl: ""` (`bootstrap.example.json:160-161`, `render.mjs:429`, `render.mjs:696`).

### Non-blocking concerns
- [Discrepancy] "Not changed, checked: `scripts/verify.mjs` … its `deny-overlay` check reads `RUN_EXTRA_ALLOW` as a whole" is wrong. — `skills/bootstrap-project/scripts/verify.mjs:145-149`: `deny-overlay` checks a fixed list of overlay commands (git fetch/merge/push, gh pr …, git add/commit/mv) against the deny rules. It does not read `RUN_EXTRA_ALLOW`. — The conclusion (no change to verify.mjs) is still right, because `check_run_permissions()` already refuses a run command that a deny rule matches (`auto-pipeline.sh:309-310`). Correct the reason in the plan.
- [Tests] The plan says the existing test "the launch preflight refuses a command that no allow rule matches …" covers "a repo without run rows". After step 11, that is not true. — `test/bootstrap-project.test.mjs:137` uses `bootstrapRepo(webUi)` on the example answers, and step 11 adds `"run": true` to `pnpm start:dev` (`bootstrap.example.json:41-46`). The test still passes: the rule `Bash(pnpm start:dev*)` is in `RUN_EXTRA_ALLOW`, and `noTheme` removes only the theme rule. — Change the description, or make a real "no run rows" case: `p.stack.extraCommands` without `run`, then `R=` is empty and `RUN_EXTRA_ALLOW` is the same as today.
- [Edge case / checkParams] A `run: true` command with a placeholder such as `<port>` passes the bare check, because the check removes `<[a-z-]+>` before the test (`render.mjs:134`). It then renders the rule `Bash(node x <port>*)` and the `RUN_CMDS` entry `node x <port>`. The preflight passes, but the real command never matches the rule. — Reject a placeholder in a `run: true` command, or strip it the way `allowCmds` does (`render.mjs:373-374`), and add one test line for it.
- [Open items] Removing the hand rule `Bash(DASH_PORT=* node apps/dashboard/server.mjs*)` (`.claude/bootstrap.json:177-178`) makes the rule narrower: `Bash(DASH_PORT=4911 DASH_NO_OPEN=1 DASH_WATCH_MS=0 node apps/dashboard/server.mjs*)` (row at `.claude/bootstrap.json:117`) does not match a run that uses another port or another order of the env prefixes. — Say in the Open items that a run must use the row text exactly as written, or keep the hand rule.
- [Tests] The test "an older CONFIG block gets `RUN_CMDS`" has a second half ("A script with no `RUN_CMDS` line at all and the default line runs `run_commands` with no error"). `pipelineBash()` reads `<repo>/.claude/scripts/auto-pipeline.sh` (`test/bootstrap-project.test.mjs:104`). Write in the plan that the test first writes the script without the `RUN_CMDS` lines back to the repo, then calls `pipelineBash(repo, ['run_commands'], 'run_commands; echo OK')`.
- [Steps] Step 1 is safe against a bad `extraCommands` value: `arr()` returns `[]` for a value that is not an array (`render.mjs:66`), `x?.run` is safe on a number or a string item, and the type check at `render.mjs:157` runs `x && …` before it reads `x.run`. Each problem goes into `errs` and nothing is thrown. The bare check (`render.mjs:132-135`) uses `String(c)`, so a non-string `cmd` does not crash either. No change needed.

### Edge cases the plan should address
- A `run: true` command that a deny rule matches (for example `rm -rf dist`). `check_run_permissions` refuses it (`auto-pipeline.sh:309-310`). One test line would lock that in.
- The same command in `pipeline.preflight` and in a `run: true` row. `runExtra` gets `Bash(c)` and `Bash(c*)`, and the final `new Set(runExtra)` (`render.mjs:583`) keeps both. `run_commands` lists it twice. This is harmless, but say that it is expected.
- A `run: true` command with a placeholder (`<port>`, `<file>`) passes the bare check but never matches (see above).

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (except the verify.mjs reason, non-blocking)
- [x] Reference implementation mirrored, deviations justified (the prefix rule instead of the exact rule has a reason)
- [x] Breaking changes for changed symbols listed (consumer search done: `extraCommands` appears only in render.mjs, contracts.md, checklist.md, bootstrap.example.json)
- [x] Wiring & registration matches the code (the `@@NAME@@` render loop; `newSettings()` at render.mjs:884-898 adds `RUN_CMDS` with its EDIT 8 comment lines to a kept block)
- [x] Scope stays inside the goal; no open decision is taken silently (roadmap: "None at the repo level")
- [x] Tests cover success / validation error / 401-403 / 404 / another scope: not applicable (no endpoint)
- [x] Restart after dashboard changes respected (nothing under apps/dashboard/)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (opt-in; `RUN_CMDS=()` by default)
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (the worktree_problem test fails as written)
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail (each has an allow rule in .claude/settings.json:16, 24, 25, 33; the two greps fail before the change)

Checked and correct: the AGENTS.md test assertion "has `"run": true`" matches the step 8 sentence ("… `stack.extraCommands` has `"run": true`; …"). The validator and skill-1-plan assertions match the step 5/6/7 texts. `kind: fixed` is a valid kind (`changelog.d/README.md:28`). Lesson 30 is the last item of lessons.md (line 49 of 49).

```
Update the plan at .plans/20261125-125414-run-command-allow-rules.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In Tests, "The preflight never runs a run row": remove the "fresh" argument. With "fresh", worktree_problem runs `dirty="$(git -C "$1" status --porcelain | …)"`, and in a temp folder that is not a git repo, git exits 128. pipefail plus set -e then stops the script before "echo DONE". Call `worktree_problem "<repo>" "<dir>/log"; echo DONE` with the git-initialised `repo` from bootstrapRepo() (the marker path is relative to $1), assert that stdout is only "DONE" and that <repo>/run-row-ran does not exist, and add a positive control: a PREFLIGHT_CMDS entry `touch preflight-ran` does create its file (evidence: skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:353-355, test/bootstrap-project.test.mjs:17 and :107)

SHOULD FIX:
1. In Affected files, "Not changed, checked": correct the verify.mjs reason. deny-overlay checks a fixed overlay command list against the deny rules and does not read RUN_EXTRA_ALLOW. A deny-matched run command is refused by check_run_permissions() instead (evidence: skills/bootstrap-project/scripts/verify.mjs:145-149, auto-pipeline.sh:309-310)
2. In Tests, the last bullet: the existing preflight test no longer uses "a repo without run rows", because step 11 adds "run": true to the example row. Fix the text, or add a real no-run-rows case that asserts `R=` is empty (evidence: test/bootstrap-project.test.mjs:137, skills/bootstrap-project/references/bootstrap.example.json:41-46)
3. In Steps (step 1): reject a placeholder (<…>) in a run: true command, or strip it like allowCmds does, and add a test line. Otherwise the rule `Bash(cmd <port>*)` never matches (evidence: skills/bootstrap-project/scripts/render.mjs:134, :373-374)
4. In Tests, "An older CONFIG block gets RUN_CMDS": write that the second half first writes the script without the RUN_CMDS lines back to <repo>/.claude/scripts/auto-pipeline.sh, then calls pipelineBash(repo, ['run_commands'], 'run_commands; echo OK') (evidence: test/bootstrap-project.test.mjs:104)
5. In Open items: say that removing the hand rule Bash(DASH_PORT=* node apps/dashboard/server.mjs*) makes the rule narrower, so a run must use the row text exactly (evidence: .claude/bootstrap.json:117, :177-178)

ADD THESE EDGE CASES:
- A run: true command that a deny rule matches is refused by the preflight (one test line).
- The same command in pipeline.preflight and in a run: true row gives two rules and is listed twice by run_commands; say that this is expected.

Do not change anything the validation did not flag.
```
