# Contracts

TLDR: the plans dashboard (`apps/dashboard/server.mjs` in claude-config) and the files this skill writes depend on each other through fixed names, file paths and text formats. This file lists each one. A template change that breaks a row here breaks the dashboard for every new repo. Line numbers are from 2026-11-11 and move with each dashboard change: search for the quoted text.

## Fixed names

| Name | Where the dashboard or a script needs it | What breaks when it differs |
| --- | --- | --- |
| skill `skill-auto-pipeline`, prompt `/skill-auto-pipeline <slug>.md …` | `apps/dashboard/server.mjs` `pipelineLive` (≈ line 389): `pgrep -f "skill-auto-pipeline <slug>.md"`; `vscode-session-copy.mjs`: `'/skill-auto-pipeline '` | A live run shows as not running; headless sessions do not show in VS Code |
| skill `skill-auto-validate-plan` | `apps/dashboard/server.mjs` `lanesHtml` (≈ line 6199) copies `/skill-auto-validate-plan <file>` | The copied command fails |
| `.claude/skills/skill-auto-pipeline/SKILL.md` on `origin/<base>` | `auto-pipeline.sh` launch preflight | The launch refuses: "push the pipeline system first" |
| `implement` (launcher) | `apps/dashboard/server.mjs` `WRAPPER_LAUNCHER` (≈ line 850) and its fix prompts (≈ 925, 946) | Only for generic mode. The `run-skill` module maps `implement` to `skill-2-implement` |
| branch `auto/<slug>` | `apps/dashboard/server.mjs` (≈ 312, 488, 1369): PR detection | The PR button does not appear. A plan can override it with `- **Branch**: <name>` |
| plan header line `- **Base**: <branch>` (skill-1-plan template) | `apps/dashboard/server.mjs` `planBase`: the `submodule … contains …` condition of a `- **Waits for**:` line | That condition gets the error "no Base line" and the plan never starts by itself |
| plan header line `- **Contracts jump**: <path>` (written by the plans dashboard) | `apps/dashboard/server.mjs` `jumpBlockers()` (`parseJumpLine()`) | The dashboard offers a second jump while one waits |
| worktree `<parent>/worktrees/<repo>/<slug>` | `apps/dashboard/server.mjs` `worktreeOf` | The dashboard does not find the run |
| `.plans/`, `.plans/done/`, `.plans/auto-runs/`, `.plans/.validations/<base>-validation-claude-<n>.md`, `<base>-validation-codex-<n>.md` (older names that still count: `<base>-validation-<n>.md`, `<base>-codex-raw-<n>.md`; the decision log `<base>-validation-round-<n>.md` does not count). `<n>` is 1 plus the highest number at the end of any validator report or decision log of the plan, so a new run never overwrites an earlier round; a file of a longer plan name (`<base>-validation-…`) belongs to that plan, and a writer never takes a name that exists | registry `plansDir` default; `validationRounds` (counts distinct `<n>`; an empty report does not count) | `auto-pipeline.sh` and `plan-lanes.mjs` use `.plans` as fixed text: keep `plansDir` at `<root>/.plans` |
| `/merge-parent <base>` | dashboard conflict button | Global skill; nothing to write |

Rule: the templates follow these names. Do not rename a skill in a template. To change a name, change the dashboard first and then this table.

## `--describe` JSON

`bash .claude/scripts/auto-pipeline.sh --describe` prints one JSON object, read with a 5-second timeout and cached by the file's mtime:

```json
{"default":"pr","modes":[
  {"id":"verify","flag":"--stop-at-verify","label":"stop at verify — I review by hand"},
  {"id":"commit","flag":"--full","label":"full — through local commit"},
  {"id":"pr","flag":"--to-pr","label":"to PR — push auto/* and open a draft PR"}]}
```

- `id`: letters, digits, `.`, `_`, `-`. It is the value of the report's `- **Mode**:` line.
- `flag`: `^--[a-z0-9-]+$`. Launch runs `auto-pipeline.sh <flag> <slug>.md`; resume runs `--resume <slug> <flag>`; cleanup runs `--cleanup <slug>` (60-second timeout).
- `label`: a string; the dashboard cuts it to 80 characters.
- A launch fails on a non-zero exit, or on an output line that starts with `SKIP:` and names the slug.

## Run report

`.plans/auto-runs/<slug>.md`. The script writes the header lines; the skill writes the status and the sections.

- `## Status: <text>`: shown as written. Without an Outcome line, the words decide: `VERIFIED|REVIEWED|COMMITTED|FINISHED|PR OPEN` → needs you, `BLOCKED|FAILED|ENDED` → failed, else running.
- `- **Outcome**: running|needs-you|failed` — only `auto-pipeline.sh` writes it (`sync_report_outcome`).
- `- **Mode**: <id> (<label>)` — Resume preselects this mode.
- `- **Link**: <label> | <https url>` — max 5 buttons. The script adds `Open PR | <url>` from the `PR: <url>` line.
- Timeline lines `- <time> — <text>`.
- After each session the script adds one compaction line: `compacting session <id> (<n>k) before the VS Code copy`, then `session compacted <before>k -> <after>k (session <id>)`, `compaction failed (exit code <n>): …` or `compaction skipped: <reason>`. It never changes the status.
- Statuses the skill uses: `RUNNING`, `IMPLEMENTED`, `TESTED`, `VERIFIED`, `VERIFIED — AWAITING REVIEW`, `DOCUMENTED`, `COMMITTED — READY TO PUSH`, `PR OPEN — <url>`, `FAILED: <phase>`, `BLOCKED: <reason>`, `BLOCKED — browser test (<reason>)` (the ship gate: no PR), `NEEDS DECISION — <n> questions`. The script adds `ENDED — …`, `CLEANED — …` and `BLOCKED: preflight — see Diagnosis`.

## plan-lanes JSON

`node .claude/scripts/plan-lanes.mjs --json` (cwd = repo root, 30-second timeout) prints:

- `schedulableCount`, `laneCount`, `maxParallel`: numbers
- `recommendedBatch`: `[{ slug, file, areas: [string], validation: { claude, codex, rounds } }]`
- `lanes`: `[{ lane, label, members: [slug] }]`
- `inFlight`: `[{ slug, autoRunStatus }]`
- also `awaitingReview`, `needsCleanup`, `staleReports` (read by `auto-pipeline.sh --status`), `excluded` (`[{ slug, reason, unresolvedNames }]`, read by the launch preflight) and `configWarnings` (CONFIG roots and files with no tracked file)

The dashboard's "⚡ All" refuses until every registered project has this script.

## Registry entry

`~/.claude/pipeline-projects.json` is `{ "projects": [entry] }`. `register.mjs` merges one entry and never drops another.

| Field | Required | Value from this skill |
| --- | --- | --- |
| `name` | yes | `project.name` (letters, digits, `.`, `_`, `-`; unique) |
| `root` | yes | the repo path, with `~` |
| `client` | no | `project.client` (sidebar group, max 40, default `Default`) |
| `plansDir` | no | `<root>/.plans` |
| `launchers` | no | `[]` (pipeline mode ignores launchers) |
| `short` | no | `project.short` (max 12) |
| `color` | no | `registry.color` (CSS hex) |

## browser-usability-test profile

`register.mjs` prints `node <claude-config>/skills/browser-usability-test/scripts/profile.mjs init <name> <role>` (`<name>` is `registry.browserTestProject`, default `project.name`), run in the repo. It writes `~/.claude/browser-usability-test/projects/<name>/project.json` with the repo's path and normalized remote. `artifact-copies.mjs --save` and `/browser-usability-test` find the project by it. When the profile exists, it prints `add-repo` instead.

## bootstrap.json

`<repo>/.claude/bootstrap.json`. Committed with the repo, so `--upgrade` can render again. Full example: `bootstrap.example.json`. `render.mjs` (`checkParams`) checks it.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | `1` | yes | Format version |
| `project.name` | string | yes | Registry name and worktree folder; safe name |
| `project.title`, `project.summary` | string | summary yes | Title (default: name) and one sentence |
| `project.client`, `project.short`, `project.remote`, `project.visibility` | string | no | Dashboard group, short tag (max 12), `owner/repo`, `private`/`public` |
| `stack.summary`, `stack.packageManager`, `stack.manifest`, `stack.manifests[]`, `stack.lockfiles[]` | string / list | no | `manifest` default `package.json` |
| `stack.installCmd` | string | no | Worktree install step; empty = none |
| `stack.commands.{test,testScoped,testE2e,lint,lintCheck,format,typecheck,build}` | string | no | One bare command each; `<file>` allowed; empty = "not available yet". `lintCheck` (for example a `lint:check` script) adds a "Lint (check only)" row only when set, names it in `skill-2-implement`, `skill-3-test` and `skill-4-verify` (`HAS_LINT_CHECK`), and is the check-only command of the verify audit's lint row |
| `stack.extraCommands[]` | `{label, cmd, note?}` | no | The repo's own rows of the AGENTS.md and README Commands table (dev server, services, contract export), kept on every upgrade. `cmd` shows as code, `note` as plain text after it. No allow rule: add one to `rules.extraAllow` when skills run it |
| `stack.httpApi` | boolean | no | `false`: the project has no HTTP API, so the plan template, the plan check and the validators leave out the Endpoint access section and the per-endpoint end-to-end mandate, and the verify audit leaves out its E2E type safety row (`HAS_HTTP_API`). Unset or `true` = today's text ("when the project has an HTTP API") |
| `stack.migrations` | boolean | no | `false`: no database migrations, so the Migrations plan section, its checklist line, the validators' schema checks, the Codex migration audit and the verify audit's Migrations and Migration drift rows are left out (`HAS_MIGRATIONS`). Unset or `true` = they stay |
| `stack.nodeVersionFile` | string | no | For example `.nvmrc`: the Node version of the changelog gate's setup steps (with `changelog.validateCmd`). Empty = `lts/*` |
| `stack.postEditLint.{fix,format,extensions[]}` | string / list | no | The post-edit hook, and the per-file lint and format commands that `/test-review` runs on the test files it changed (`FILE_LINT_HINT`). An `oxfmt` or `prettier` format command gets `--no-error-on-unmatched-pattern` (an ignored file otherwise fails the hook) |
| `git.base`, `git.prod`, `git.staging`, `git.mergeStyle` | string | no | Defaults `develop`, `main`, none, `squash` |
| `git.tickets.evidence` | boolean | no | `true`: plans carry a **Tickets** line, and `skill-5-ship` posts an evidence comment on each ticket and writes a `To be closed after staging QA: #<n>` or `Refs #<n>` line per ticket (never a GitHub closing keyword, so tickets stay open until QA closes them after the staging check) |
| `git.tickets.board.{owner,number,status}` | string / number / string | no | GitHub project board: `skill-5-ship` moves every ticket of the PR to `status` and reopens a ticket that is already closed. Also turns on the Tickets line |
| `pipeline.services[]` | `{name, url}` or `{name, container}` | no | Local services a run needs; `skill-auto-pipeline` checks them first (`curl -sf -o /dev/null <url>`, `docker inspect -f {{.State.Running}} <container>`) and stops with `BLOCKED: start <name>` |
| `rules.hard[]` | `{title, rule, check?, details?[], tests?[]}` | at least 1 | Hard rules. `details`: the project's own checks (validator, plan check, verify audit, apply-validation). `tests`: the tests a change that touches the rule needs (skill-3-test) |
| `rules.validatorLimits[]` | list | no | Extra limits for the plan validators (`plan-validator`, Codex `validate-plan`), extras only (for example "load a page", "start a capture"). Each validator keeps its own generic "Never" and secrets lines (in an `@@IFNOT HAS_VALIDATOR_LIMITS@@` block). The render drops an extra that is a duplicate or whose words those lines already hold, then appends the rest to them as "Also never: …": a secret, token, password, key or credential limit to the secrets line, the others to the "Never" line. So each validator prints one list of two lines, with or without extras |
| `rules.parentPlan` | string | yes | Path of the parent plan (an existing `.plans/*-parent.md` first; never `docs/ARCHITECTURE.md`, which holds the stack and folders) |
| `rules.rulesDocs[]` | list | no | More rule documents the validator reads |
| `rules.planSections.{goal,context,steps,tests,verify}` | string | no | The plan headings that the plan template, the step skills, the validators and `plan-lanes.mjs` use. Default: `Goal`, `Context`, `Steps`, `Tests`, `How to verify`. In adopt and upgrade mode, copy them from the repo's `skill-1-plan` plan template, so an upgrade does not rename them |
| `rules.contracts.{source,direction}` | string | no | Contract source path and direction |
| `rules.testData`, `rules.exampleActor` | string | no | Empty = generic default |
| `rules.protectedPaths[]`, `rules.extraAllow[]` | list | no | Deny `Edit`/`Write` paths; extra allow rules (never push/PR) |
| `layout.folders[]` | `{path, what}` | no | AGENTS.md Layout and plan-lanes roots |
| `layout.rootFiles[]`, `layout.softFiles[]`, `layout.envFiles[]` | list | no | plan-lanes CONFIG; env files copied into worktrees (default `.env`). `softFiles` is also the list of shared registration files in `skill-2-implement` Step 3.5 (`SOFT_FILES_MD`) |
| `layout.testHarnessDoc` | string | no | The `AGENTS.md` of the end-to-end test harness (for example `apps/api/test/AGENTS.md`). `skill-1-plan`, `skill-3-test` and the `test-reviewer` agent name it; unset = "the nested `AGENTS.md` of the test folder, if there is one" |
| `layout.migrationHints[]` | list | no | plan-lanes `MIGRATION_HINTS`: words in a plan's text that mark it as adding a migration whose file a generator writes (default `["migration:generate"]`) |
| `modules.<name>` | boolean | no | Missing = on, except `contracts-jump` (missing = off). Names: `codex`, `changelog`, `decision-sheet`, `test-review`, `step-gate`, `post-edit-lint`, `plans-parallel`, `pr-feedback`, `run-skill`, `contracts-jump` |
| `changelog.locales[]` | list | no | Languages of the customer note (default `["en"]`). Every entry that customers see has all of them |
| `changelog.versionFile` | string | no | The file whose `version` each PR raises by one step (for example `package.json`). Empty = no version check |
| `changelog.validateCmd` | string | no | The project's own changelog validator, one bare command (for example `pnpm changelog:validate`). When set: no `.claude/scripts/changelog-validate.mjs` (an existing one shows as orphan), the gate, `changelog.d/README.md`, `changelog.d/AGENTS.md` and `/changelog-entry` run this command, and the allow list gets `Bash(<cmd>)`. The gate runs it on every PR, also with the `no-changelog` label, with `CHANGELOG_BASE_REF=origin/<base>` and `CHANGELOG_SKIP=true` when the label is on. A `pnpm`/`npm`/`yarn` command gets setup steps first (package manager, `actions/setup-node`, the frozen install). Empty = the rendered script |
| `changelog.summary` | boolean | no | `true`: every new entry has `summary` (one plain paragraph for the team), and `changelog.d/README.md`, `changelog.d/AGENTS.md` and `/changelog-entry` say so. Missing = `true` without `validateCmd`, `false` with it. Set `true` with `validateCmd` only when the project validator accepts `summary`, or it rejects every new entry |
| `pipeline.defaultMode` | `verify`/`commit`/`pr` | no | Default `pr` |
| `pipeline.codexInVerify` | boolean | no | Unset or `true` (with `modules.codex` on): each `/skill-4-verify` round also runs the Codex review, and the decision sheet reuses its report (`CODEX_IN_VERIFY`). `true` needs `modules.codex`. `false`: Codex checks the plan, and the code only in the decision sheet ("to PR" mode). With `modules.decision-sheet` off and `false`, no Codex review of the code runs |
| `pipeline.runAllow[]` | list | no | Extra allow rules for every headless run |
| `pipeline.preflight[]` | list | no | Bare commands every run needs (for example `pnpm theme:generate`, a generator whose output is gitignored). Each gets an allow rule, and the launch preflight runs each once in the new worktree |
| `registry.browserTestProject` | string | no | The browser-usability-test profile name (safe name). Default `project.name`. Set it when the repo already has a profile under another name (`~/.claude/browser-usability-test/projects/<name>/`): `BROWSER_TEST_PROJECT` in `auto-pipeline.sh` and the `register.mjs` profile commands use it |
| `registry.{dashboard,color,browserTest,role,appUrl}` | mixed | no | Registrations. `browserTest: true` with a role other than `backend` and an `appUrl` (the app the owner runs, the "old code" side) also turns on the browser-test step (`skill-1-plan` section, `skill-3-test` Step 2.5), the ship gate (`skill-5-ship` Step 5.5), the run allow rules for the skill's scripts by full path (`$HOME`, expanded by bash) and `curl -s -o /dev/null -w *`, and the profile check of the launch preflight. Without `appUrl` all of it stays off |
| `renderHash` | string | no | Written by `render.mjs --apply`, never by hand: a fingerprint of the template output for these answers. The plans dashboard compares it with `render.mjs --status` and shows "bootstrap update" when the templates or the answers changed since the last apply. Missing = the dashboard counts the files that differ instead |

## Upgrade run status

`scripts/upgrade-run.mjs <repo>` writes these files in `<repo>/.plans/auto-runs/` (gitignored). The plans dashboard reads them.

- `bootstrap-upgrade.lock`: one line `<pid>`, made with `openSync(…, 'wx')`. Only the lock holder writes the status file. The script removes only its own lock. The dashboard removes a stale lock (a dead PID, a PID in a lock older than 2 hours, or a file with no PID that is older than 60 s) right before it starts a run.
- `bootstrap-upgrade.json`: the run status, `{ state, step, hash, base, branch, worktree, runDir, pid, pr, error, startedAt, endedAt, replaces, session }`.
  - `session`: `{ id, runDir, hash }` of the last Claude session, or `null`. The script starts Claude with `--session-id <id>` and keeps the run folder after the session, so `mkdir -p <runDir> && cd <runDir> && claude --resume <id>` continues it. A retry that only pushes or opens the PR keeps the session of the earlier run.
  - `replaces`: `{ number, hash }` of the PR of an earlier run, or `null`. A run keeps it across failed runs; a PR for another hash gets the owner checkbox "close #<number> without a merge".
  - `state`: `running` | `pr` | `committed` | `same` | `failed`.
  - `step`: the last step that started: `prepare`, `render`, `claude`, `apply`, `verify`, `install`, `commit`, `push`, `pr`. `install` runs `stack.installCmd` in the worktree, so the project's git hooks find their tools; it is skipped when `installCmd` is empty or the worktree has no `stack.manifest`.
  - `pr`: `{ number, url }` or `null`. `error`: redacted, at most 500 characters; a failure in the render to commit steps starts with the run folder path. In state `pr`, `error` is `null`, or a note when the owner must add the label `no-changelog` by hand (gh could not add it, and could not put the checkbox into the PR body).
- `bootstrap-upgrade-pr-body-<hash>.md`: the PR body, one file per hash, written right before the commit. Its first line is `<!-- bootstrap-upgrade <hash> -->`. A resumed run uses it only for the same hash. The text from Claude is redacted.
- `bootstrap-upgrade.log`: the output of the script and of the Claude session.
- `bootstrap-upgrade-<hash>.md`: the run report, written when a run with a hash ends: the result, the branch, the worktree, the command that continues the Claude session (only when `session.hash` is this hash), and the saved PR body. The dashboard reads it through `GET /api/report?slug=bootstrap-upgrade-<hash>`.
- The worktree is `<parent of repo>/worktrees/<repo name>/bootstrap-upgrade-<hash>` on the branch `auto/bootstrap-upgrade-<hash>`, so `auto-pipeline.sh --cleanup bootstrap-upgrade-<hash>` removes it after the merge.
- The dashboard adds `bootstrapRun` (this status, with `prState` from its PR cache for state `pr`, and `failed` for a `running` run whose PID is gone or that started more than 2 hours ago) and `bootstrapHash` (the `--status` hash) to each project in `/api/state`. `POST /api/bootstrap-upgrade { project }` starts a run.

## Upgrade task and decisions

The run folder (`runDir`, a temp folder) is the only working folder of the Claude session. It holds only `task.json`, `current/<n>`, `stage/<n>`, `refs/unattended.md`, `refs/lessons.md`, and what Claude writes: `merged/<n>` and `decisions.json`. `<n>` is the 1-based index of the file in `task.json` `changed`. The render stages stay in a separate work folder that Claude does not see.

- `task.json` (written by the script): `{ changed: [{ n, path, current: 'current/<n>', stage: 'stage/<n>', merged: 'merged/<n>', note, diff }], orphans: [path] }`. All its paths are relative to the run folder; `path` is the repo path.
- Before the Claude session, the script stops the run when a file it would write (changed, new or merge) is a symlink or lies under a symlinked folder: a write through a symlink can land outside the worktree.
- `decisions.json` (written by Claude): `{ files: [{ path, decision: 'merge' | 'keep' | 'replace', added: [string], kept: [string], dropped: [string] }], templateUpdates: [{ path, feature, why }], questions: [string] }`.
- The script refuses the decisions (and writes nothing) when the file is missing or not JSON, the `files` paths are not exactly the `changed` paths, a decision is unknown, `merged/` or a `merged/<n>` is a symlink, a `merge` entry has no `merged/<n>`, `merged/` holds another file, or a merged file has a `@@NAME@@` placeholder.

## Template syntax

Only in `templates/`. `render.mjs` fails on an unknown name, an unclosed block, or any leftover `@@…@@` in the output.

- `@@NAME@@`: a value. `node scripts/render.mjs --vars` lists every name.
- `templates/partials/`: shared blocks, rendered once and used as a value. `reporting-rules.md` → `@@REPORTING_RULES@@` (in `skill-3-test`, `skill-4-verify`, `skill-5-ship`, `decision-sheet`, `pr-feedback`). `reporting-rules-after-pr.md` → `@@REPORTING_RULES_AFTER_PR@@` (in `skill-5-ship`, `decision-sheet`, `pr-feedback`: the skills that run after a PR opened).
- `@@IF NAME@@` / `@@IFNOT NAME@@` … `@@END@@`: whole-line blocks on switches (`MOD_*`, `HAS_*`, `CODEX_IN_VERIFY`). The directive line may start with `#`, `//` or `<!--`.
- Paths: a `dot-` segment prefix becomes `.` (`dot-claude` → `.claude`); a `.tmpl` suffix is removed (`AGENTS.md.tmpl` → `AGENTS.md`). This stops Claude Code from loading the templates as live skills or instructions inside claude-config.
- `gitignore.fragment` (core and each module) merges into `.gitignore`. `editorconfig` → `.editorconfig` (the `[Makefile]` block only when the repo has a Makefile: `HAS_MAKEFILE`). `dot-plans/first-plan.md` → `.plans/<timestamp>-check-the-pipeline-end-to-end.md`, only when the repo has no plan. `parent-plan.md` → the `rules.parentPlan` path, a skeleton written only when that file does not exist.
- `.claude/settings.json` is rendered, then parsed: invalid JSON fails the render.
- A repo with a `.gitmodules` file gets allow rules in `.claude/settings.json` for each submodule path: `git -C <path>` with `fetch`, `status`, `rev-parse`, `log`, `show`, `diff`, `merge-base`, `cat-file`, `ls-tree`, `grep`, `checkout` (with or without `--detach`) and `switch --detach`. A path with a space or another special character gets no rules.
- `@@IFNOT HAS_VALIDATOR_LIMITS@@` in a validator holds its generic limit lines; the render reads them from the template and merges `rules.validatorLimits` into `@@VALIDATOR_LIMITS@@` (see the table above).
- The `skill-4-verify` audit leaves out the generic Contracts row when a hard-rule title matches `/contract/i`, and the generic Secrets row when one matches `/secret/i`.
- In the output, the project spots are marked the way the repo scripts mark them: a `CONFIG (<project>)` block with `EDIT n` comments.
- A re-render keeps the CONFIG block of a script that already exists in `.claude/scripts/` (the owner may have tuned it) and replaces only the generic code. A setting that the template has and the kept block lacks (a template update added it) is added at the end of the block, with its comments. `--reset-config` renders the block from the answers again. `verify.mjs` shows a kept block that differs from the answers as the tip `config-drift`.
