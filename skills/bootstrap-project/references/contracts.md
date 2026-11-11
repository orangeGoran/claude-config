# Contracts

TLDR: the plans dashboard (`scripts/plans-dashboard.mjs` in claude-config) and the files this skill writes depend on each other through fixed names, file paths and text formats. This file lists each one. A template change that breaks a row here breaks the dashboard for every new repo. Line numbers are from 2026-11-11 and move with each dashboard change: search for the quoted text.

## Fixed names

| Name | Where the dashboard or a script needs it | What breaks when it differs |
| --- | --- | --- |
| skill `skill-auto-pipeline`, prompt `/skill-auto-pipeline <slug>.md …` | `plans-dashboard.mjs` `pipelineLive` (≈ line 389): `pgrep -f "skill-auto-pipeline <slug>.md"`; `vscode-session-copy.mjs`: `'/skill-auto-pipeline '` | A live run shows as not running; headless sessions do not show in VS Code |
| skill `skill-auto-validate-plan` | `plans-dashboard.mjs` `lanesHtml` (≈ line 6199) copies `/skill-auto-validate-plan <file>` | The copied command fails |
| `.claude/skills/skill-auto-pipeline/SKILL.md` on `origin/<base>` | `auto-pipeline.sh` launch preflight | The launch refuses: "push the pipeline system first" |
| `implement` (launcher) | `plans-dashboard.mjs` `WRAPPER_LAUNCHER` (≈ line 850) and its fix prompts (≈ 925, 946) | Only for generic mode. The `run-skill` module maps `implement` to `skill-2-implement` |
| branch `auto/<slug>` | `plans-dashboard.mjs` (≈ 312, 488, 1369): PR detection | The PR button does not appear. A plan can override it with `- **Branch**: <name>` |
| worktree `<parent>/worktrees/<repo>/<slug>` | `plans-dashboard.mjs` `worktreeOf` | The dashboard does not find the run |
| `.plans/`, `.plans/done/`, `.plans/auto-runs/`, `.plans/.validations/<base>-validation-<n>.md` | registry `plansDir` default; `validationRounds` (≈ 314) | `auto-pipeline.sh` and `plan-lanes.mjs` use `.plans` as fixed text: keep `plansDir` at `<root>/.plans` |
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
- Statuses the skill uses: `RUNNING`, `IMPLEMENTED`, `TESTED`, `VERIFIED`, `VERIFIED — AWAITING REVIEW`, `DOCUMENTED`, `COMMITTED — READY TO PUSH`, `PR OPEN — <url>`, `FAILED: <phase>`, `BLOCKED: <reason>`, `NEEDS DECISION — <n> questions`. The script adds `ENDED — …` and `CLEANED — …`.

## plan-lanes JSON

`node .claude/scripts/plan-lanes.mjs --json` (cwd = repo root, 30-second timeout) prints:

- `schedulableCount`, `laneCount`, `maxParallel`: numbers
- `recommendedBatch`: `[{ slug, file, areas: [string], validation: { claude, codex } }]`
- `lanes`: `[{ lane, label, members: [slug] }]`
- `inFlight`: `[{ slug, autoRunStatus }]`
- also `awaitingReview`, `needsCleanup`, `staleReports` (read by `auto-pipeline.sh --status`)

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

`register.mjs` prints `node <claude-config>/skills/browser-usability-test/scripts/profile.mjs init <name> <role>`, run in the repo. It writes `~/.claude/browser-usability-test/projects/<name>/project.json` with the repo's path and normalized remote. `artifact-copies.mjs --save` and `/browser-usability-test` find the project by it. When the profile exists, it prints `add-repo` instead.

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
| `stack.commands.{test,testScoped,testE2e,lint,format,typecheck,build}` | string | no | One bare command each; `<file>` allowed; empty = "not available yet" |
| `stack.postEditLint.{fix,format,extensions[]}` | string / list | no | The post-edit hook |
| `git.base`, `git.prod`, `git.staging`, `git.mergeStyle` | string | no | Defaults `develop`, `main`, none, `squash` |
| `rules.hard[]` | `{title, rule, check?}` | at least 1 | Hard rules |
| `rules.parentPlan` | string | yes | Path of the parent plan |
| `rules.rulesDocs[]` | list | no | More rule documents the validator reads |
| `rules.contracts.{source,direction}` | string | no | Contract source path and direction |
| `rules.testData`, `rules.exampleActor` | string | no | Empty = generic default |
| `rules.protectedPaths[]`, `rules.extraAllow[]` | list | no | Deny `Edit`/`Write` paths; extra allow rules (never push/PR) |
| `layout.folders[]` | `{path, what}` | no | AGENTS.md Layout and plan-lanes roots |
| `layout.rootFiles[]`, `layout.softFiles[]`, `layout.envFiles[]` | list | no | plan-lanes CONFIG; env files copied into worktrees (default `.env`) |
| `modules.<name>` | boolean | no | Missing = on. Names: `codex`, `changelog`, `decision-sheet`, `test-review`, `step-gate`, `post-edit-lint`, `plans-parallel`, `pr-feedback`, `run-skill` |
| `pipeline.defaultMode` | `verify`/`commit`/`pr` | no | Default `pr` |
| `pipeline.runAllow[]` | list | no | Extra allow rules for every headless run |
| `registry.{dashboard,color,browserTest,role,appUrl}` | mixed | no | Registrations |

## Template syntax

Only in `templates/`. `render.mjs` fails on an unknown name, an unclosed block, or any leftover `@@…@@` in the output.

- `@@NAME@@`: a value. `node scripts/render.mjs --vars` lists every name.
- `@@IF NAME@@` / `@@IFNOT NAME@@` … `@@END@@`: whole-line blocks on switches (`MOD_*`, `HAS_*`). The directive line may start with `#`, `//` or `<!--`.
- Paths: a `dot-` segment prefix becomes `.` (`dot-claude` → `.claude`); a `.tmpl` suffix is removed (`AGENTS.md.tmpl` → `AGENTS.md`). This stops Claude Code from loading the templates as live skills or instructions inside claude-config.
- `gitignore.fragment` (core and each module) merges into `.gitignore`. `editorconfig` → `.editorconfig`. `dot-plans/first-plan.md` → `.plans/<timestamp>-check-the-pipeline-end-to-end.md`, only when the repo has no plan. `parent-plan.md` → the `rules.parentPlan` path, a skeleton written only when that file does not exist.
- `.claude/settings.json` is rendered, then parsed: invalid JSON fails the render.
- In the output, the project spots are marked the way the repo scripts mark them: a `CONFIG (<project>)` block with `EDIT n` comments.
- A re-render keeps the CONFIG block of a script that already exists in `.claude/scripts/` (the owner may have tuned it) and replaces only the generic code. `--reset-config` renders the block from the answers again.
