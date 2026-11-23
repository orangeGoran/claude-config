# Checklist: target state, interview, hand-off

TLDR: this file says what a bootstrapped repo contains, which questions the skill asks (and where each answer goes in `bootstrap.json`), and the exact hand-off message.

## Target state

After the bootstrap, the repo has these files. "Module" files exist only when the module is on (all modules are on by default).

| Path | Source | Notes |
| --- | --- | --- |
| `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`) | core | Hard rules, Layout, Code rules, Plans, Workflow, Git, Commands. No Status or change history. When the root `CLAUDE.md` has another job (for example global rules linked into `~/.claude/`), the shim is `.claude/CLAUDE.md` with `@../AGENTS.md`, and the render leaves the root file alone |
| `README.md` | core | Lean, ASD-STE100 |
| `.editorconfig` | core | Kept when the repo has one. The `[Makefile]` block only when the repo has a Makefile |
| `.gitignore` | core + modules | Merged: missing lines are appended, nothing is removed |
| `.claude/settings.json` | core | `$schema`, allow (repo read/edit, read-only git, real commands), deny (destructive only), hooks (modules), attribution `""` |
| `.claude/bootstrap.json` | interview | The answers, for `--upgrade` |
| `.claude/agents/plan-validator.md` | core | With `## Limits` |
| `.claude/skills/skill-1-plan`, `skill-validate-plan`, `skill-auto-validate-plan`, `apply-validation`, `skill-2-implement`, `skill-3-test`, `skill-4-verify`, `skill-5-ship`, `skill-auto-pipeline` | core | Fixed names (contracts.md) |
| `.claude/scripts/auto-pipeline.sh`, `plan-lanes.mjs`, `vscode-session-copy.mjs` | core | CONFIG blocks with `EDIT n` comments |
| `.plans/.gitkeep`, `.plans/done/.gitkeep`, `.plans/.validations/.gitkeep` | core | |
| `.plans/<timestamp>-check-the-pipeline-end-to-end.md` | core | Only when the repo has no plan yet |
| the parent plan (`rules.parentPlan`) | core | A skeleton (Goals, Architecture, Phases, Open decisions), only when the file does not exist |
| `.codex/skills/validate-plan`, `validate-implementation` | codex | |
| `changelog.d/{README,AGENTS,CLAUDE}.md`, `.claude/skills/changelog-entry`, `.claude/scripts/changelog-validate.mjs`, `.github/workflows/changelog-gate.yml` | changelog | The gate checks each entry (`summary` and `internal` always, `customer` in every language when customers see it) and the one-step version raise. With `changelog.validateCmd`, the project's own validator replaces `changelog-validate.mjs` |
| `.claude/skills/decision-sheet`, `.github/workflows/decision-sheet.yml` | decision-sheet | |
| `.claude/skills/test-review`, `.claude/agents/test-reviewer.md` | test-review | |
| `.claude/scripts/workflow-guard.sh`, `workflow-complete-step.sh` | step-gate | PreToolUse hook in settings.json |
| `.claude/scripts/post-edit-lint.sh` | post-edit-lint | PostToolUse hook in settings.json |
| `.claude/skills/plans-parallel` | plans-parallel | |
| `.claude/skills/pr-feedback` | pr-feedback | |
| `.claude/scripts/run-skill.sh` | run-skill | Manual launcher; the dashboard uses auto-pipeline.sh |

Outside the repo (through `register.mjs`, after the owner's yes):

- `~/.claude/pipeline-projects.json`: one entry `{name, client, root, plansDir, launchers: [], short?, color?}`.
- `~/.claude/browser-usability-test/projects/<name>/project.json` (when `registry.browserTest` is true).

Not made by the skill (the owner adds them in the first plans): CI workflow, dependabot, husky, `.nvmrc`, the content of the parent plan, nested `AGENTS.md` per folder.

## Interview

The owner is not a template expert. Ask only what the owner alone can decide. Find everything else yourself and show it once, at the end, in plain words.

### How to ask

- **Max 5 questions.** Skip a question when the repo already answers it (say so in the summary instead).
- **Start each question with one plain sentence: what you need and why.** Example: "I need to know which rules every change in this project must follow, so the reviewer can check them."
- **No internal words in a question.** Never write field names (`rules.hard`, `stack.manifest`), or words like "manifest", "root files", "append-only", "CONFIG block", "hunt list", "audit rows", "parent plan", "post-edit lint". Say what it does for the owner instead ("the big plan of the project", "the command that runs the tests").
- **A real choice uses the decision format** (`## Question N of M`, the facts, one example step by step with real values, Option A (recommended) and Option B, why A; "Please reply with A or B"). Write it for this project, with real names from the repo.
- **Upgrade and adopt: show before and after in a table.** When the repo already has a value for the question (rules in `AGENTS.md` and the old skills, modules that are on, the base branch), put one table under "The facts" with one row per item: `| Item | Now (where it is today) | After | Change |`. "Now" quotes the current text in short and names the file; "After" is the proposed text; "Change" is one of `same`, `new`, `reworded`, `stricter`, `removed`, `moved`. Example row: `| Tenant scoping | AGENTS.md: "filter by tenant" | + item queries also filter by owner; e2e from another tenant | stricter |`. List removed items too, with "After" empty. Each option then says which rows it changes. In new mode there is no "Now", so a plain list is enough.
- **A confirmation is not a question.** Do not ask "confirm or change" for values you found. Put them in the summary.
- If the owner says "explain", "what?" or "I do not know": explain in 3 plain sentences with one example, give your recommendation, and offer "reply OK to take my recommendation".
- Save each answer to `.claude/bootstrap.json` at once.

### The questions (in this order, skip when the repo answers them)

| # | Ask in plain words | Fields | Ask only when |
| --- | --- | --- | --- |
| 1 | "Which rules must every change follow? I found these in your files: <list>. Add, remove or OK." (3–8 rules, each a short title + one sentence). Upgrade and adopt: the before/after table, one row per rule, including the checks and tests copied from the old skills | `rules.hard[]` | Always. It is the most important answer: the reviewer and the checks use these rules. |
| 2 | Modules (decision format): which extra parts to add. Default: all on, Codex on. One line per module, in plain words (what it does for the owner) | `modules.*` | Always |
| 3 | Branches and merge (decision format): which branch the work goes to, and squash or merge commit | `git.*` | The repo has no `develop` + `main`, or the merge style is unclear. Mention that a free private GitHub repo cannot protect branches (403). |
| 4 | Contracts (decision format): where shared data shapes come from | `rules.contracts.*` | The repo has more than one app or package that shares data, and the files do not show the answer |
| 5 | Public or private, when the repo has no remote yet | `project.visibility` | No remote. Check the big plan for names of people, machines or clients first: history cannot be un-leaked. |

### Find these yourself (never ask; show in the summary)

| What | Fields | Where to find it |
| --- | --- | --- |
| Name, title, one-sentence summary, dashboard group, short label, GitHub remote | `project.*` | folder name, `origin`, README first line, the dashboard registry (same root) |
| Stack and the real commands (install, test, test one file, lint, lint check only, format, type check, build) | `stack.*` | the scripts in `package.json` / `Package.swift` / `pyproject.toml`. A command that does not exist is empty ("not available yet"). `lintCheck` only when a check-only script exists (for example `lint:check`). `nodeVersionFile`: `.nvmrc` or `.node-version` when it exists |
| The repo's own command rows | `stack.extraCommands[]` | upgrade and adopt: the rows of the current AGENTS.md Commands table that the standard rows lack (dev server, services, contract export, preview), one `{label, cmd, note?}` each. Without them an upgrade drops these rows |
| The lint-on-edit commands and file types | `stack.postEditLint.*` | the lint and format tools in the scripts; empty when there is none. The render adds `--no-error-on-unmatched-pattern` to an `oxfmt` or `prettier` format command |
| The big plan of the project | `rules.parentPlan` | an existing `.plans/*-parent.md` first (the newest), then `PLAN.md`, `docs/PLAN.md`. Never `docs/ARCHITECTURE.md`: it holds the stack and folders, not the plan (add it to `rules.rulesDocs` instead). None → `docs/PLAN.md` (the skill writes a skeleton). Never move or rename the owner's files. |
| Test data rule, example person for decision questions | `rules.testData`, `rules.exampleActor` | the hard rules and the roles in the code; else the defaults |
| Folders, files that plans touch, files many plans only append to, env files for worktrees, migration generator words, the test harness rules | `layout.*` | top-level folders, `plan-lanes.mjs` CONFIG when it exists, `.env.example`. `softFiles`: also the registration lists (entity list, error codes, module registry, i18n). `migrationHints`: the migration generator script (for example `migration:generate`); default `["migration:generate"]`. `testHarnessDoc`: the `AGENTS.md` of the end-to-end test folder (for example `test/AGENTS.md`), when it exists |
| HTTP API and database migrations | `stack.httpApi`, `stack.migrations` | `false` only when the repo clearly has none (no routes or controllers; no migrations folder or migration script). Unset keeps the generic text |
| Default run mode, extra run rules | `pipeline.*` | default `pr`; extra rules from docker compose and migration scripts |
| Commands every run needs first | `pipeline.preflight[]` | a generator whose output is gitignored and that the checks or the browser test read (for example a `theme:generate` script that `predev` / `prebuild` runs, but `vite` alone does not). Never a command that changes tracked files (`generate:types` on committed types): the preflight stops when the tree is not clean |
| The project's own checks per hard rule, the tests each rule needs, the validator's extra "never" limits | `rules.hard[].details`, `rules.hard[].tests`, `rules.validatorLimits` | In adopt and upgrade mode: copy them from the repo's existing `plan-validator.md`, `skill-1-plan`, `skill-3-test`, `skill-4-verify` and `apply-validation` (one short line each). Then the render keeps them, and no file needs a hand merge. `validatorLimits`: only what the generic validator limits lack (for example "load a page", "change a storage object"); never restate the generic lines, which stay in every validator |
| Changelog languages, version file, validator and summary | `changelog.locales`, `changelog.versionFile`, `changelog.validateCmd`, `changelog.summary` | the existing `changelog.d/README.md` or validator (`LOCALES`), else the product's launch languages in the big plan or SoW, else `["en"]`. `versionFile`: the manifest when it has a `version` (`package.json`, `Cargo.toml`, `pyproject.toml`), else empty. `validateCmd`: the project's own validator when it has one (a `changelog:validate` script or similar in the manifest, or the command the current gate runs); else empty, and the render writes `.claude/scripts/changelog-validate.mjs`. `summary`: `true` when the project validator accepts a `summary` field (it is in its allowed-field list); leave it out without `validateCmd` |
| Registrations | `registry.*` | dashboard yes; browser-usability-test yes when there is a web UI or an API. Check `~/.claude/browser-usability-test/projects/` for an existing profile of this repo (its `project.json` lists the repo path or remote): when its name differs from `project.name`, set `registry.browserTestProject` to it, so runs and `register.mjs` use that profile and no second one is made. A web UI with `browserTest` also gets the browser-test step, the ship gate and the run allow rules for the skill's scripts (full path and `QA_*=` forms, `curl -s -o /dev/null -w *`): the render adds them, never write them by hand. `appUrl` is the dev server the owner runs; how to start the new code beside it belongs in the profile's `notes.md` |
| Ticket evidence and board | `git.tickets.*` | the old skills or scripts that comment on issues or move them on a project board (`gh issue comment`, `gh project item-edit`); else leave it out |
| Services a run needs | `pipeline.services[]` | the old skills' preflight checks, docker compose, the ports in `.env.example`; else leave it out |
| Protected files, extra allow rules | `rules.protectedPaths`, `rules.extraAllow` | generated files; the old `settings.json` allow rules that are still useful |

### The summary (one message, after the questions)

Before the render, show what you found as a short list in plain words, for example:

```
What I found (reply OK, or name what is wrong):
- Project: Tracebook, private, GitHub orangeGoran/tracebook, dashboard group "Personal"
- Commands: none yet (no package.json). I fill them in later with /bootstrap-project --upgrade.
- Big plan: docs/PLAN.md
- Folders: native/, packages/, apps/, scripts/, docs/
- Runs copy apps/api/.env into each worktree (when the file exists)
```

## Dashboard readiness checks

`verify.mjs` part 1 copies `projectHealth()` of `apps/dashboard/server.mjs` (pipeline mode). The dashboard level is red when a required check fails, amber when only tips fail, and green when all pass. A bootstrapped repo must be green.

| id | Required (dashboard) | Pass when |
| --- | --- | --- |
| `git` | yes | `<root>/.git` exists |
| `plansDir` | yes | `.plans/` exists |
| `plans` | tip | `.plans/` has at least one `*.md` (the first plan) |
| `launch` | yes | `.claude/scripts/auto-pipeline.sh` exists |
| `modes` | tip | the script has a `--describe)` case |
| `allow` | tip (pipeline) | `permissions.allow` has at least one rule |
| `skills` | tip | at least one `.claude/skills/*/SKILL.md` |
| `claudemd` | tip | `CLAUDE.md` exists |

Part 2 adds what the dashboard does not check, but a run needs: valid `--describe` JSON, the plan-lanes JSON, the fixed skill names, no deny rule over the "to PR" overlay, no push rule in the shared allow list, the `.gitignore` lines, executable bits, `bash -n`, `node --check`, no leftover placeholder, "bare commands" in every skill, the `CLAUDE.md` shims, a valid `bootstrap.json`, and (tips) the layout paths and env files of `bootstrap.json`, CONFIG blocks that differ from it, the tools, the push to `origin/<base>` and the registry entry.

## Hand-off

Write the hand-off in this order. Use real paths and values.

1. **TLDR** (1–3 sentences): what was set up and the one next action.
2. **Files**: an ASCII tree of the written files, each marked `(new)`, `(changed)`, `(kept)` or `(merged)`. Under each `(merged)` file, one line with the template features that moved in. Under each `(kept)` file, the reason the template adds nothing.
2a. **Template updates**: the project features that went back into `templates/` (file and feature), or "none". These are claude-config changes, so they get their own `git add` line and commit message, run in the claude-config repo.
3. **Verify**: the dashboard level and the count of passed required checks. List any tip that is still open.
4. **Git and GitHub commands**, one copy-paste block, in this order. Leave out the lines that are already done (remote exists, branch exists):

   ```bash
   gh repo create <owner>/<repo> --private --source . --remote origin
   git add -- <every written file, one path each; never "git add .">
   git commit -m "<message below>"
   git push -u origin <prod branch>
   git switch -c <base branch>
   git push -u origin <base branch>
   gh repo edit <owner>/<repo> --default-branch <base branch>
   ```

   **Lock file first.** When the repo has a manifest (`stack.manifest`) but no lock file, run the install command (`stack.installCmd`) once before this block and add the lock file to `git add`. Without it, each worktree install creates an untracked lock file, and `/skill-5-ship` stops with `BLOCKED` because the tree is not clean.

   When the repo already has commits on the base branch, the block is only `git add`, `git commit` and `git push origin <base branch>` (on the base branch). Note: branch protection on a private repo needs GitHub Pro (the API returns 403 on a free account).

5. **Commit message**: `chore(claude): bootstrap the project workflow` + a short body that lists the parts (skills, pipeline, dashboard, modules). No AI attribution.
6. **Reload**: "New skills and agents load only after a session reload. Reload VS Code or start a new Claude Code session before `/skill-1-plan`."
7. **Next steps**:
   1. Push (step 4). The pipeline refuses to start until `.claude/skills/skill-auto-pipeline/SKILL.md` and the plan are on `origin/<base>`.
   2. Open the plans dashboard, find the project, launch "Check the pipeline end to end" in "to PR" mode. Review and merge the draft PR, then run `bash .claude/scripts/auto-pipeline.sh --cleanup <slug>`.
   3. Run `/skill-1-plan <first small task>` (suggest one from the parent plan).
8. **Not used**: the numbered list from `render.mjs <repo> --unused`, grouped as it prints, one line per item in plain words (what it does for the owner, not the field name). Under it, the template features that a **Keep** decision left out (file and feature), numbered after the script's list. Leave out a group with no items. When nothing is unused, write one line: "Everything the skill can set up is in use." End with: "Reply with the numbers you want to add, or 'none'." Example:

   ```text
   Not used (reply with the numbers you want to add, or "none"):
   Modules that are off
     1. Codex: a second check of the plan and the code with another AI
   Commands not found
     2. End-to-end tests: the skills say "not available yet"
   Settings left empty
     3. Issue comment: a comment with the run evidence on the GitHub issue of each PR
   Not made by this skill (I suggest a plan)
     4. CI workflow that runs the tests and lint on each PR
   ```
