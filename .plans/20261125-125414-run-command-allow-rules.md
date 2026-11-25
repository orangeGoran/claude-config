# Plan: Run-command allow rules — a project command that runs may use gets its rule, and the launch checks it

- **Base**: main

## Goal

A headless pipeline run must never be refused a project command after an hour of work. Today a repo's own rows of the Commands table (`stack.extraCommands`, for example "Run a test dashboard by hand") get no allow rule, and the launch preflight does not check them. The run `20261123-111046-validation-report-names` stopped as `BLOCKED — browser test` after implement and test (about an hour), because `DASH_PORT=4911 DASH_NO_OPEN=1 DASH_WATCH_MS=0 node apps/dashboard/server.mjs` matched no rule.

After this plan:

1. A command row can say `"run": true`. Its command then gets an allow rule in the run overlay (`RUN_EXTRA_ALLOW` of `auto-pipeline.sh`), and the launch preflight checks that rule before the session starts. The preflight never runs that command.
2. A row without `run: true` gets no rule, as today. "Restart the dashboard service" must never run from a pipeline run.
3. Both plan validators and `/skill-1-plan` check that each command in a plan's How to verify and Browser test sections has an allow rule for a headless run.

## Context

- Parent plan sections: none. This is a template fix of `skills/bootstrap-project/` (roadmap: Architecture → Skills).
- Decisions taken for this plan (owner, 2026-11-25, in the request): opt-in per row (`run: true`); a row like "Restart the dashboard service" is never allowed in runs.
- Engineering choices taken in this plan (listed so the owner can object):
  - The rule goes into the run overlay only (`RUN_EXTRA_ALLOW`), not into `.claude/settings.json`. An interactive session asks the owner; only a headless run needs the rule.
  - The rule is the prefix form `Bash(<cmd>*)`, the same form `allowCmds` uses for the standard commands (`render.mjs` → the `allowCmds` line), so extra arguments still match.
  - The preflight reads the `run: true` commands from `"$REPO/.claude/bootstrap.json"` with `jq` at each launch (checked, never run), not from a copy in the CONFIG block. A CONFIG copy goes stale when the owner keeps a CONFIG block on upgrade (`keepConfig()` keeps every existing setting; `newSettings()` adds only missing names), so an added or changed row would skip the check. The script already reads repo JSON with `jq` at launch (the allow and deny rules of `settings.json`), and the launch exits when `jq` is missing (`command -v jq >/dev/null || { echo "jq not found"; exit 1; }` in the launch section). The commands stay separate from `PREFLIGHT_CMDS` (run once in the worktree by `worktree_problem()`): a dev server there would block the launch.
  - A `run: true` command must be one bare command, the same rule as `pipeline.preflight` (`checkParams()` bare-command check). An env prefix such as `DASH_PORT=4911 …` is allowed: it has no shell operator. A `run: true` command with a `<…>` placeholder is rejected: the bare check removes placeholders before it tests, so the rule would never match the real command.
  - The rule is a prefix rule, the same form the standard commands get: `Bash(pnpm start:dev --port 3999*)` also matches extra arguments after that text, and never a command that differs inside that text (for example `pnpm start:prod`). A run must use the row text as written.
  - The allow rule lives in `RUN_EXTRA_ALLOW` of the CONFIG block, like every run rule today. After a row is added, changed or removed, an upgrade of a repo with a kept CONFIG block shows `auto-pipeline.sh` as `config` with the `- RUN_EXTRA_ALLOW=…` / `+ RUN_EXTRA_ALLOW=…` lines (`configDiff()`); `/bootstrap-project` Step 2 asks the owner, and `--reset-config --apply .claude/scripts/auto-pipeline.sh` takes the answers. When the owner keeps the old block, the preflight (which reads the rows fresh) refuses an added or changed row that no rule matches, with the command named: the run fails at minute 0, not after an hour. A removed row leaves its old rule in a kept block until the owner takes the answers, the same as any other kept rule today. A row that an existing wider rule already matches passes the preflight: the run is allowed to use it.
- Open decisions this plan does not take: None.

## Hard rules

- **Restart after dashboard changes:** not touched. No file under `apps/dashboard/` changes.
- **No npm dependencies:** kept. Node built-ins and Bash only.
- **Public repo: no private data:** kept. The templates stay generic, and `bootstrap.example.json` does not change. Tests use made-up values (`acme-api`, `/home/ana`).
- **Global rules affect every project:** the templates render into every bootstrapped project on its next upgrade. The change is opt-in: a project without `run: true` rows renders the same allow rules as today, and its preflight list is the same (the `jq` read finds no `run: true` row).
- **Never stop processes by name:** not touched. The preflight only lists a `run: true` command for the permission check (`run_commands()`); `worktree_problem()` keeps running only `PREFLIGHT_CMDS`, so the preflight never starts or stops a `run: true` command.
- **Tests for logic changes:** `render.mjs` and the `auto-pipeline.sh` template change; the tests are in `test/bootstrap-project.test.mjs` (see Tests).
- **Docs: current state only:** `references/contracts.md`, `references/checklist.md` and `references/lessons.md` describe the new state; no history.

## Contracts

- `bootstrap.json` → `stack.extraCommands[]` gets an optional `run` (boolean). Consumers: `render.mjs` (`checkParams()`, the `runExtra` list), `auto-pipeline.sh` `run_commands()` (reads it with `jq`), `references/contracts.md`, `references/checklist.md`.
- The `auto-pipeline.sh` CONFIG block does not change: no new setting.

## Reference implementation

- Closest existing pattern: `pipeline.preflight` → `PREFLIGHT_CMDS`: an answer list that `render.mjs` turns into allow rules (`runExtra.push(...preflight.map((c) => \`Bash(${c})\`))`) and into a CONFIG array (`PREFLIGHT_BASH: bashWords(preflight)`), which `run_commands()` lists for `check_run_permissions()`.
- Files read end to end for the parts this plan touches: `skills/bootstrap-project/scripts/render.mjs` (`checkParams()`, `commandRows` / `extraRows` / `commandsMd`, `allowCmds`, `runExtra`, the vars `RUN_EXTRA_ALLOW_BASH` and `PREFLIGHT_BASH`); `skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh` (CONFIG block, the older-CONFIG defaults, `rule_matches()`, `run_commands()`, `check_run_permissions()`, `worktree_problem()`); `test/bootstrap-project.test.mjs` (`webUi`, `pipelineBash()`, the tests "a browser-test project gets the full-path, QA_* and curl run rules …", "the launch preflight refuses a command that no allow rule matches, and passes when all match", "an upgrade adds a CONFIG setting that the kept block lacks").
- Mirror:
  - `pipeline.preflight` bare check in `checkParams()` → the same check for each `run: true` command.
  - `runExtra.push(...preflight.map(...))` → `runExtra.push(...runRows.map((c) => \`Bash(${c}*)\`))`.
  - The loop over `PREFLIGHT_CMDS` in `run_commands()` → a second source of lines in `run_commands()`: the `jq` read of the `run: true` commands, in the style of the `jq -r -s '… .permissions.allow …'` read of the settings files in the same script.
- Deviations:
  - The rule is a prefix rule (`Bash(<cmd>*)`), not the exact form `Bash(<cmd>)` that preflight commands get — a dev-server command is often run with extra arguments; a preflight command runs exactly as written.
  - The command list is read from `bootstrap.json` at launch, not rendered into a CONFIG array like `PREFLIGHT_CMDS` — a kept CONFIG block would keep a stale copy (Context).

## Affected files

- `skills/bootstrap-project/scripts/render.mjs` — modified: `checkParams()` (the `run` type and the bare check), `runExtra` (the run rules).
- `skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh` — modified: `run_commands()` (the `jq` read).
- `skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md` — modified: the Commands finding and the checklist line name the allow rule.
- `skills/bootstrap-project/templates/modules/codex/dot-codex/skills/validate-plan/SKILL.md` — modified: step 4 and the checklist line name the allow rule.
- `skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md` — modified: the "Commands must exist" bullet names the allow rule.
- `skills/bootstrap-project/templates/core/AGENTS.md.tmpl` — modified: the Commands paragraph names `run: true`.
- `skills/bootstrap-project/references/contracts.md` — modified: the `stack.extraCommands[]` row.
- `skills/bootstrap-project/references/checklist.md` — modified: the "repo's own command rows" row.
- `skills/bootstrap-project/references/lessons.md` — modified: lesson 31.
- `test/bootstrap-project.test.mjs` — modified: new tests (see Tests).
- `changelog.d/20261125-run-command-allow-rules.yaml` — new.
- Not changed, checked:
  - `.claude/` of this repo and the root `AGENTS.md`: rendered files. The owner upgrades them after the merge (Open items). A headless run cannot write `.claude/`.
  - `skills/bootstrap-project/scripts/verify.mjs`: its `deny-overlay` check tests a fixed list of overlay commands (fetch, merge, push, PR) against the deny rules; it does not read `RUN_EXTRA_ALLOW`. No change is needed: `check_run_permissions()` already refuses a command that a deny rule matches ("a deny rule matches").
  - `skills/bootstrap-project/references/bootstrap.example.json`: unchanged. The shared test answers (`bootstrapRepo()`, `webUi`) keep no `run: true` row, so the existing tests keep their meaning; the new tests add their own rows.

## Wiring & registration

No new wiring — no model, module, route, queue, cross-module provider or render var. `run_commands()` reads `"$REPO/.claude/bootstrap.json"`; `REPO` is set at the top of the script (`REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"`), before the CONFIG block.

## Breaking changes

None. `run` is optional; a `bootstrap.json` without it renders the same `RUN_EXTRA_ALLOW` as today, and `run_commands()` adds no line. A repo with no `.claude/bootstrap.json` (set up by hand) adds no line either.

## Steps

1. `render.mjs` `checkParams()`: in the `stack.extraCommands` check, also accept `x.run === undefined || typeof x.run === 'boolean'`, and change the message to `stack.extraCommands must be a list of {label, cmd, note?, run?}` (run: true or false). After it, for each row of `arr(p.stack?.extraCommands)` with `x?.run === true` and `typeof x.cmd === 'string'`: when `cmd` matches `/<[^>]*>/`, push `stack.extraCommands: the run command "<cmd>" has a placeholder; give the command exactly as a run types it`; when it has a line break (`/[\r\n]/`), push `stack.extraCommands: the run command "<cmd>" must be one line`. Then add the `run: true` commands to the `cmds` list that the bare-command check reads: `...arr(p.stack?.extraCommands).filter((x) => x?.run === true).map((x) => x.cmd)`. Keep the order: the type check of `extraCommands` stays where it is; build `cmds` from `arr(...)` so a bad `extraCommands` value adds no crash.
2. `render.mjs` `buildVars()`: after `const preflight = …` and its `runExtra.push(...)`, add `const runRows = [...new Set(arr(st.extraCommands).filter((x) => x?.run === true).map((x) => str(x.cmd)).filter(Boolean))];` and `runExtra.push(...runRows.map((c) => \`Bash(${c}*)\`));`.
3. `templates/core/dot-claude/scripts/auto-pipeline.sh`, the comment above `run_commands()`: add "The repo's own commands with "run": true come from .claude/bootstrap.json at each launch, so a kept CONFIG block cannot hide a new one. They are checked, never run."
4. Same file, `run_commands()`: after the `PREFLIGHT_CMDS` loop, add
   ```bash
   if [ -f "${REPO:-}/.claude/bootstrap.json" ]; then
     jq -r '.stack.extraCommands[]? | select(.run == true) | .cmd // empty | gsub("^\\s+|\\s+$"; "")' "${REPO:-}/.claude/bootstrap.json" 2>/dev/null \
       || echo "(.claude/bootstrap.json cannot be read, so its run commands were not checked)"
   fi
   ```
   `${REPO:-}` keeps `set -u` safe when a caller has no `REPO` (the test helper `pipelineBash()` slices the script from the CONFIG block, below the `REPO=` line), so the existing tests stay unchanged. The `gsub` trims the command like `render.mjs` `str()` does, so the read text equals the rendered rule. When `jq` cannot parse the file, the echoed line matches no allow rule, so `check_run_permissions()` refuses the launch and names the problem (fail closed, not a silent skip).
   Do not change `worktree_problem()`: it keeps running only `PREFLIGHT_CMDS`.
5. `templates/core/dot-claude/agents/plan-validator.md`: in step 4 ("Run the plan's "@@PLAN_VERIFY@@" commands in your head …"), add the sentence: "Also check that each command in "@@PLAN_VERIFY@@" and in the Browser test section has an allow rule for a headless run: a rule in `.claude/settings.json` `permissions.allow` or in `RUN_EXTRA_ALLOW` of `.claude/scripts/auto-pipeline.sh` (`*` is any text), and that no rule in `.claude/settings.json` `permissions.deny` matches it (a deny rule wins). A command with no allow rule, or with a matching deny rule, is a blocking finding: the run stops as BLOCKED when it reaches it. You cannot read `.claude/settings.local.json` or the owner's user settings: when a command depends on them, say so." In the checklist line `- [ ] "@@PLAN_VERIFY@@" commands are real and can fail`, append ", and each has an allow rule for a headless run".
6. `templates/modules/codex/dot-codex/skills/validate-plan/SKILL.md`: the same sentence at the end of step 4 ("Check the "@@PLAN_VERIFY@@" commands. …"), and the same append to its checklist line.
7. `templates/core/dot-claude/skills/skill-1-plan/SKILL.md`, the "Commands must exist" bullet: append "Each such command, and each command the Browser test section starts (a dev server, a test server), needs an allow rule for a headless run: in `.claude/settings.json` or in `RUN_EXTRA_ALLOW` of `.claude/scripts/auto-pipeline.sh`, and no matching rule in `.claude/settings.json` `permissions.deny`. A repo's own Commands row gets that rule with `"run": true` in `.claude/bootstrap.json` (owner, by hand, then `/bootstrap-project --upgrade`)."
8. `templates/core/AGENTS.md.tmpl`, the Commands paragraph ("Skills take commands from this table …"): after "in the same change that adds it.", add "A pipeline run may use a project row of this table (a row after the standard rows Install to Build and the run-usage rows) only when its row in `.claude/bootstrap.json` `stack.extraCommands` has `"run": true`; the launch then checks its allow rule. The standard rows keep their rules."
9. `references/contracts.md`, row `stack.extraCommands[]`: type `{label, cmd, note?, run?}`; replace "No allow rule: add one to `rules.extraAllow` when skills run it" with "`run: true`: a headless run may use the command; it gets the run rule `Bash(<cmd>*)`, and the launch preflight checks that rule (it never runs the command). The command must be one bare command. Leave `run` out for a command that a run must never use (a restart of a real service, a deploy)."
10. `references/checklist.md`, row "The repo's own command rows": append "Set `run: true` on a row that a plan's How to verify or Browser test runs (a dev server, a test server), never on a row that restarts or deploys a real service; name each `run: true` row in the summary."
11. `references/lessons.md`: add lesson 31 as the last item of the file, after 30 (renumber nothing): "**31. A project command had no run rule.** A run stopped as `BLOCKED — browser test` after an hour: the test-dashboard command was a row of the Commands table, and those rows got no allow rule, and the launch did not check them. → A row with `"run": true` gets a run rule, and the preflight reads it from `bootstrap.json` at each launch and checks that rule; the plan validators check the rule of each How to verify and Browser test command."
12. `test/bootstrap-project.test.mjs`: the tests in **Tests**.
13. `changelog.d/20261125-run-command-allow-rules.yaml` (new, `/changelog-entry`): `kind: fixed`, `audience: internal`, `scope: bootstrap-project`, a plain `summary` and an `internal` note.

## Tests

### Unit tests

`test/bootstrap-project.test.mjs` (made-up values: `acme-api`, `/home/ana`, `pnpm start:dev --port 3999`):

- **Run rows get a rule and a preflight entry; other rows get neither.** `bootstrapRepo()` with `p.stack.extraCommands = [{ label: 'Run the app', cmd: 'pnpm start:dev --port 3999', run: true }, { label: 'Restart the service', cmd: 'pnpm restart:service' }]`. With `pipelineBash(repo, ['run_commands'], 'printf "%s\\n" "${RUN_EXTRA_ALLOW[@]}"; echo ---; run_commands', { REPO: repo })` (`pipelineBash()` slices from the CONFIG block, so `REPO` comes from the env): the rules include `Bash(pnpm start:dev --port 3999*)` and no rule contains `restart:service`; after `---`, stdout lists `pnpm start:dev --port 3999` and not `pnpm restart:service`. `.claude/settings.json` `permissions.allow` has no rule with `start:dev` (run overlay only). Fails today: no rule is rendered and `run_commands()` does not list the row.
- **The preflight refuses a run row with no rule.** Same repo, every call with `{ REPO: repo }`. `pipelineBash(repo, ['rule_matches', 'run_commands', 'check_run_permissions'], …)`: with `ALLOW_RULES=("${RUN_EXTRA_ALLOW[@]}")` → exit 0 and `PASSED`; with `ALLOW_RULES` = `RUN_EXTRA_ALLOW` without the `start:dev` rule → exit 1 and stdout matches `/FATAL: preflight[\s\S]*pnpm start:dev --port 3999/`. Fails today: `run_commands()` does not list the row.
- **A deny rule wins over a run row's rule.** Same repo, with `{ REPO: repo }`. `ALLOW_RULES=("${RUN_EXTRA_ALLOW[@]}"); DENY_RULES=("Bash(pnpm start:dev*)"); check_run_permissions` → exit 1 and stdout matches `/pnpm start:dev --port 3999 .*a deny rule matches/`.
- **`worktree_problem()` runs only `PREFLIGHT_CMDS`, never a run row.** Same repo, with a second row `{ label: 'Make marker', cmd: 'touch run-row-ran', run: true }`. `pipelineBash(repo, ['worktree_problem'], 'PREFLIGHT_CMDS=("touch preflight-ran"); worktree_problem "$T_REPO" "$T_REPO/preflight.log"; echo DONE', { T_REPO: repo })` (`pipelineBash()` has no `cwd` option; `worktree_problem()` runs each command in `( cd "$1" && … )`, so the absolute repo path is enough; no `fresh` argument, so the git-clean check does not run; `BROWSER_TEST_PROJECT` is empty in these answers: role `backend`, no `appUrl`) → stdout has `DONE`, `repo/preflight-ran` exists (positive control: the function does run its own list) and `repo/run-row-ran` does not exist. The claim is narrow on purpose: `worktree_problem()` is the only launch function that executes commands; `check_run_permissions()` only lists them (the test above).
- **`checkParams`.** `run: "yes"` → render exits 1, stderr has `stack.extraCommands must be a list of {label, cmd, note?, run?}`; `{ cmd: 'pnpm build && pnpm start', run: true }` → exit 1, stderr has `has a shell operator`; `{ cmd: 'pnpm start:dev --port <port>', run: true }` → exit 1, stderr has `has a placeholder`; the same two commands without `run` → render passes (a display row may hold any text, as today).
- **An env prefix passes, and the prefix rule has its boundary.** `{ cmd: 'DASH_PORT=4911 node apps/dashboard/server.mjs', run: true }` renders; with `rule_matches`, `Bash(DASH_PORT=4911 node apps/dashboard/server.mjs*)` matches `DASH_PORT=4911 node apps/dashboard/server.mjs` and `DASH_PORT=4911 node apps/dashboard/server.mjs --verbose` (exit 0), and does not match `DASH_PORT=4912 node apps/dashboard/server.mjs` (exit 1). The rule `Bash(pnpm start:dev --port 3999*)` does not match `pnpm start:prod` (exit 1).
- **A kept CONFIG block: added, changed and removed rows.** `bootstrapRepo()` with no run row (the repo script is rendered by this plan's template). Each case edits the repo's `.claude/bootstrap.json`, then renders `--upgrade --stage <stage> --json` without `--reset-config` (the test's own `stage` folder from `bootstrapRepo()`; the default stage folder is shared between tests), and the checks use `{ REPO: repo }`:
  - **Added:** add `{ label: 'Run the app', cmd: 'pnpm start:dev --port 3999', run: true }` → `.claude/scripts/auto-pipeline.sh` has status `config`, and its `diff` has a `+ RUN_EXTRA_ALLOW=` line with `Bash(pnpm start:dev --port 3999*)`. With the kept repo script, `check_run_permissions` (`ALLOW_RULES=("${RUN_EXTRA_ALLOW[@]}")`) exits 1 and names `pnpm start:dev --port 3999`: the fresh `jq` read finds the new row although the block is old. After `--upgrade --reset-config --apply .claude/scripts/auto-pipeline.sh`, the same check exits 0.
  - **Changed:** change that row's `cmd` to `pnpm start:dev --port 4000` (the script still has the 3999 rule) → `check_run_permissions` exits 1 and names `pnpm start:dev --port 4000`.
  - **Removed:** delete the row → `run_commands` no longer lists any `start:dev` command, and the upgrade `diff` has a `- RUN_EXTRA_ALLOW=` line with the old rule (the owner sees it to take the answers).
- **No `bootstrap.json`, no `REPO`, a broken `bootstrap.json`, spaces.** Remove the repo's `.claude/bootstrap.json` → `pipelineBash(repo, ['run_commands'], 'run_commands; echo OK', { REPO: repo })` exits 0 with `OK`; the same call with no `REPO` in the env exits 0 with `OK` (`set -euo pipefail` is safe). Write `{ not json` into `.claude/bootstrap.json` → `check_run_permissions` exits 1 and its FATAL lists `.claude/bootstrap.json cannot be read`. A row `{ cmd: ' pnpm start:dev --port 3999 ', run: true }` → `run_commands` lists `pnpm start:dev --port 3999` with no spaces at either end, and `check_run_permissions` with the rendered rules exits 0. A `run: true` cmd with a line break → render exits 1 with `must be one line`.
- **The validator and plan texts.** A default render (codex on): `.claude/agents/plan-validator.md` and `.codex/skills/validate-plan/SKILL.md` contain `has an allow rule for a headless run`; `.claude/skills/skill-1-plan/SKILL.md` contains `"run": true`; `AGENTS.md` contains `has \`"run": true\``.
- The existing tests still pass unchanged: "the launch preflight refuses a command that no allow rule matches …" (the example answers have no `run: true` row, because this plan leaves `bootstrap.example.json` as it is), and the first test ("a fresh render passes every required verify check …").

### End-to-end tests

- None. The project has no HTTP API, and the change adds no endpoint.

### Harness constraints

- A real headless run cannot run inside `npm test` (it needs `claude`, a worktree and tokens). The tests prove the rendered rules, the preflight list and that `worktree_problem()` does not run a run row, through `pipelineBash()`. `rule_matches()` is the launcher's own matcher, not Claude Code's: that Claude Code itself accepts an env-prefixed rule such as `Bash(DASH_PORT=4911 … node …*)` is **not verified** by these tests. The first real run with a Browser test after the owner's upgrade checks it (Open items).

### AI output

None. No line is about text an AI model writes.

## Browser test

None — the change has no screen: it changes a render script, a shell template and skill texts.

## How to verify

```bash
node --test test/bootstrap-project.test.mjs
npm test
grep -n "select(.run == true)" skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh
grep -n "has an allow rule for a headless run" skills/bootstrap-project/templates/core/dot-claude/agents/plan-validator.md
node .claude/scripts/changelog-validate.mjs --base origin/main
```

## Open items (owner, after the merge)

- In this repo's `.claude/bootstrap.json`: add `"run": true` to the "Run a test dashboard by hand" row, then `/bootstrap-project --upgrade` and take the answers for `auto-pipeline.sh` (`--reset-config --apply .claude/scripts/auto-pipeline.sh`; it renders `.claude/` and `AGENTS.md`). Keep the wider hand rule `Bash(DASH_PORT=* node apps/dashboard/server.mjs*)` in `pipeline.runAllow` for now: the row rule matches only the row text, and a run that adds another env value (for example `QA_REPORTS_PORT=4912`) needs the wider rule.
- The first run with a Browser test after that upgrade: check in its log that the test dashboard started with no "requires approval" (this is the check of Claude Code's own rule matching).
