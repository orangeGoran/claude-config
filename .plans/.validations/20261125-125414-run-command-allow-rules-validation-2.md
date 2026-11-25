**Validation round:** 2

## Plan validation: 20261125-125414-run-command-allow-rules.md

**Verdict:** APPROVE WITH CHANGES

Note on the version I validated: the plan file changed while I reviewed it (plan mtime 13:04, after `-pre-round-2.md` at 13:02 and `-codex-raw-2.md` at 13:03). The version I first read (the round-1 text, with a `RUN_CMDS` CONFIG array) is the same as `-pre-round-2.md`. The current plan replaces that array with a `jq` read of `.claude/bootstrap.json` in `run_commands()`. This report covers the current file. Two defects of the round-1 text are already fixed in the current file (see "Superseded findings" below).

### Blocking issues

- [Tests / Breaking changes] `run_commands()` now reads `"$REPO/..."`, but `pipelineBash()` never defines `REPO`, so the existing preflight test breaks. The plan says that this test "still pass[es] unchanged". — `test/bootstrap-project.test.mjs:103-107` (`pipelineBash()` slices the script from `# ===== CONFIG` to `usage() {` and runs it under `set -euo pipefail` with `env: { ...process.env, ...env }`; `REPO` is set at `auto-pipeline.sh:38`, before the CONFIG block, so the slice does not contain it); `test/bootstrap-project.test.mjs:139-148` calls `run_commands` through `check_run_permissions` with no `REPO`; plan Step 4 (`if [ -f "$REPO/.claude/bootstrap.json" ]`) and the Tests line "The existing tests still pass unchanged: "the launch preflight refuses …"". — With `set -u`, `$REPO` is unbound. The `<(run_commands)` subshell then exits after the `PREFLIGHT_CMDS` lines and never prints the browser-test lines (`auto-pipeline.sh:293-299`). The `denied` case (`DENY_RULES=("Bash(curl*)")`, line 146) then finds no curl line, exits 0, and `assert.equal(denied.status, 1)` fails. Under `set -e` a failed process substitution does not stop the parent, so the failure is silent. — Fix: make `pipelineBash()` pass `REPO: repo` by default (`env: { ...process.env, REPO: repo, ...env }`) and list that helper change under Affected files and Tests. Or use `${REPO:-}` in Step 4, so that a missing `REPO` skips the read. The first fix is better: every new test then gets the real repo path, and the "Same repo" bullets cannot forget it.

### Non-blocking concerns

- [Discrepancy] Context says "`jq` is a required tool (verify.mjs `tools`)". But `verify.mjs:243` is `check('tools', 'tip', 'claude and jq on PATH', …)`, a tip, not a required check. The real guard is `auto-pipeline.sh:685` (`command -v jq >/dev/null || { echo "jq not found"; exit 1; }`), which runs before `check_run_permissions` at line 699. — Cite `auto-pipeline.sh:685` instead.
- [Tests] The "A deny rule wins over a run row's rule" bullet says "Same repo." but does not say `{ REPO: repo }`. The bullet before it says that for every call, and this one does not. Without `REPO`, the bullet fails for the reason in the blocking item. — The default `REPO` in `pipelineBash()` fixes this too. If you do not add the default, say `{ REPO: repo }` in this bullet.
- [Edge case / silent skip] Step 4 runs `jq … 2>/dev/null || true`. A `bootstrap.json` that `jq` cannot parse therefore skips every run-row check, with no message. `render.mjs` refuses such a file (`render.mjs:1007`), but an owner can edit it by hand after the render. — Keep the launch going, but print one line, for example `echo "preflight: cannot read .claude/bootstrap.json; run rows not checked" >&2`. Or accept the skip and write the reason in the plan.
- [Edge case / whitespace] `render.mjs` builds the rule from `str(x.cmd)`, which trims (`render.mjs:65`). The `jq` read prints `.cmd` as written. A `cmd` with a space at the start or the end, for example `" pnpm start:dev "`, gets the rule `Bash(pnpm start:dev*)`, but the preflight checks `" pnpm start:dev "`. `rule_matches` (`auto-pipeline.sh:275-287`) then fails, and the preflight refuses a row that has its rule. — Trim in `jq` (`| .cmd // empty | gsub("^\\s+|\\s+$"; "")`), or reject a `run: true` `cmd` with a space at either end in `checkParams()`.
- [Tests] The upgrade cases call `render.mjs --upgrade` several times. When they leave out `--stage`, the default stage is `tmpdir()/bootstrap-acme-api` (`render.mjs:1038`), and other tests can use the same folder at the same time. — Write `--stage stage` in each call, as the existing tests do (`test/bootstrap-project.test.mjs:42,160`).
- [Step 1 detail] The placeholder check ("for each row with `run === true` …") must read the rows through `arr(...)` and `x?.run`, the same as the `cmds` addition does. Otherwise a non-array or a `null` row crashes `checkParams()` before the type error shows. — Say `arr(p.stack?.extraCommands).filter((x) => x?.run === true && typeof x.cmd === 'string' && /<[^>]*>/.test(x.cmd))`.

### Superseded findings (round-1 text, already fixed in the current file)

- The round-1 `worktree_problem` test said "run with `cwd: repo`", but `pipelineBash()` has no `cwd` option (`test/bootstrap-project.test.mjs:107`). `touch preflight-ran` would then run in the test process cwd (the claude-config checkout), and the positive control would fail. The current text passes the absolute path as `$T_REPO`, and `worktree_problem()` runs each command in `( cd "$1" && … )` (`auto-pipeline.sh:344`). This is correct now.
- The round-1 upgrade test expected a kept block to fail the preflight. But a block rendered by the new template already has `RUN_CMDS=()`, and `newSettings()` adds only names that the block lacks (`render.mjs:884-897`). The kept `RUN_CMDS=()` would therefore stay empty, `check_run_permissions` would exit 0, and the run would fail later. The current design reads the rows from `bootstrap.json` at each launch, so the "Added" and "Changed" cases now hold. I checked them against `plan()` (`render.mjs:941-951`: the kept block gives `content === cur` and a non-empty diff, so the status is `config`) and against `check_run_permissions()` (`auto-pipeline.sh:304-321`).

### Edge cases the plan should address

- `REPO` is unset when only part of the script runs (the test harness). Covered by the blocking item.
- A `bootstrap.json` that `jq` cannot parse makes the run-row check skip with no message.
- A `cmd` with a space at the start or the end: the rule and the checked text differ.
- The same `run: true` command in two rows: `render.mjs` removes the duplicate rule (`new Set`), but `jq` lists the command twice. This is harmless (the command is checked twice), but write it down.
- A `cmd` that holds a newline: the bare check regex (`render.mjs:134`) does not reject `\n`, and `jq -r` prints such a command as two lines. Reject control characters in a `run: true` command.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (except the `verify.mjs` "required" citation, see non-blocking)
- [x] Reference implementation mirrored, deviations justified (the `jq` read is a written deviation with a reason)
- [ ] Breaking changes for changed symbols listed (consumer search done): the change to `run_commands()` breaks its consumer `test/bootstrap-project.test.mjs:136-150`, and the plan does not list that
- [x] Wiring & registration matches the code (no new render var; `REPO` at `auto-pipeline.sh:38`)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope: N/A, no endpoint
- [x] Restart after dashboard changes respected (no `apps/dashboard/` file)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (opt-in; no `run: true` row means no new line)
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail (`grep -n "select(.run == true)"` fails before Step 4; `.claude/scripts/changelog-validate.mjs` exists)

```
Update the plan at .plans/20261125-125414-run-command-allow-rules.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the existing test "the launch preflight refuses a command that no allow rule matches …" keep passing after Step 4. pipelineBash() slices the script from the CONFIG block, so REPO (set at auto-pipeline.sh:38) is unbound under set -u, the <(run_commands) subshell stops before the browser-test lines, and the "denied" curl case exits 0. Change pipelineBash() to pass REPO: repo by default (env: { ...process.env, REPO: repo, ...env }), and list that helper change under Affected files and Tests. Or, as a second choice, write ${REPO:-} in Step 4. Then fix the Tests line that says the existing tests "still pass unchanged". (evidence: test/bootstrap-project.test.mjs:103-107, test/bootstrap-project.test.mjs:139-148, auto-pipeline.sh:38, auto-pipeline.sh:293-299)

SHOULD FIX:
1. Replace "jq is a required tool (verify.mjs tools)" with the real guard: auto-pipeline.sh:685 exits when jq is missing. verify.mjs:243 is only a "tip". (evidence: verify.mjs:243, auto-pipeline.sh:685)
2. In the "A deny rule wins" test, say { REPO: repo }, or rely on the new pipelineBash() default. (evidence: plan Tests, deny-rule bullet)
3. In Step 4, print one line to stderr when jq cannot read .claude/bootstrap.json, instead of a silent "|| true". Or write down why a silent skip is acceptable. (evidence: plan Step 4)
4. Make the checked command and the rule text the same: trim .cmd in the jq read, or reject a run: true cmd with a space at either end in checkParams(). (evidence: render.mjs:65 str() trims; plan Step 4 prints .cmd as written)
5. In Step 1, write the placeholder check through arr(...) and x?.run, with a typeof x.cmd === 'string' guard. (evidence: render.mjs:156-159)
6. In the upgrade test cases, pass --stage stage to each render call, as the existing tests do. (evidence: render.mjs:1038, test/bootstrap-project.test.mjs:42)

ADD THESE EDGE CASES:
- REPO unset when only part of the script runs (the harness).
- A bootstrap.json that jq cannot parse makes the run-row check skip.
- A run: true cmd with a space at the start or the end, or with a newline (the bare check does not reject \n; jq -r prints two lines).
- The same run: true command in two rows (render removes the duplicate; jq lists it twice: harmless).

Do not change anything the validation did not flag.
```
