# Checklist: target state, interview, hand-off

TLDR: this file says what a bootstrapped repo contains, which questions the skill asks (and where each answer goes in `bootstrap.json`), and the exact hand-off message.

## Target state

After the bootstrap, the repo has these files. "Module" files exist only when the module is on (all modules are on by default).

| Path | Source | Notes |
| --- | --- | --- |
| `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`) | core | Status, Hard rules, Layout, Code rules, Plans, Workflow, Git, Commands |
| `README.md` | core | Lean, ASD-STE100 |
| `.editorconfig` | core | Kept when the repo has one |
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
| `changelog.d/{README,AGENTS,CLAUDE}.md`, `.claude/skills/changelog-entry`, `.github/workflows/changelog-gate.yml` | changelog | |
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

One question per message. Pre-fill every answer you can find (Step 0 of SKILL.md) and ask the owner to confirm. Save the answer to `.claude/bootstrap.json` at once.

| # | Question | Fields | Pre-fill from | Notes |
| --- | --- | --- | --- | --- |
| 1 | Name, title, one-sentence summary, client (dashboard group), short label (max 12), GitHub remote `owner/repo`, visibility | `project.*` | folder name, `origin`, README first line | Check the parent plan for names of people, machines or clients before "public": history cannot be un-leaked |
| 2 | Stack and package manager; the real commands: install, test (full), test (one file, with `<file>`), test (end to end), lint, format, type check, build | `stack.summary`, `stack.packageManager`, `stack.manifest`, `stack.lockfiles`, `stack.installCmd`, `stack.commands.*` | manifest scripts, lock files | Leave a command empty when it does not exist yet. Never invent one. One bare command each (no `&&`, `|`) |
| 3 | Post-edit lint: the command that fixes one file, the command that formats one file, the file extensions | `stack.postEditLint.*` | lint and format tools in the manifest | Empty = the hook does nothing |
| 4 | Branch model (decision format): base branch, production branch, staging; merge style | `git.*` | `git branch -a`, `origin/HEAD` | Default: `develop` base + `main`, squash. A free private GitHub repo cannot use rulesets (403): say so |
| 5 | Hard rules: 3–8 rules, each a title + one sentence (+ optional "how to check") | `rules.hard[]` | existing AGENTS.md, parent plan | They feed AGENTS.md, the validator hunt list, the skill-1 rule check and the skill-4 audit rows |
| 6 | Parent plan: `PLAN.md`, `.plans/<file>-parent.md` or `docs/ARCHITECTURE.md` | `rules.parentPlan`, `rules.rulesDocs` | existing files | The skill does not write its content |
| 7 | Contracts (decision format): where types come from (`packages/contracts`, an OpenAPI file, none) and the direction (code → OpenAPI, schema → code) | `rules.contracts.*` | folders, generators in the manifest | |
| 8 | Test data rule and the example actor for decision questions (for example `Ana (Member) on the order portal`) | `rules.testData`, `rules.exampleActor` | roles in the code | Empty = a generic default |
| 9 | Layout: top-level folders with one line each; extra root files; append-only files (registrations, barrels, generated types); env files to copy into worktrees | `layout.*` | top-level folders, `.env.example` | Feeds AGENTS.md Layout and the plan-lanes CONFIG block |
| 10 | Modules (decision format). Default: all on, Codex on | `modules.*` | — | A module the owner turns off is `false`; a missing key is on |
| 11 | Pipeline: default mode (`pr`, `commit`, `verify`) and extra run allow rules (services, migrations, docker) | `pipeline.*` | docker compose files, migration scripts | A command that "How to verify" needs must be allowed, or the first run is BLOCKED |
| 12 | Registrations: dashboard (yes), color, browser-usability-test profile (yes when the project has a web UI or an API), role, app URL | `registry.*` | ports in config | |
| 13 | Protected paths (generated files Claude must not edit) and extra allow rules | `rules.protectedPaths`, `rules.extraAllow` | generated folders | Never a push or PR rule |

## Dashboard readiness checks

`verify.mjs` part 1 copies `projectHealth()` of `scripts/plans-dashboard.mjs` (pipeline mode). The dashboard level is red when a required check fails, amber when only tips fail, and green when all pass. A bootstrapped repo must be green.

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

Part 2 adds what the dashboard does not check, but a run needs: valid `--describe` JSON, the plan-lanes JSON, the fixed skill names, no deny rule over the "to PR" overlay, no push rule in the shared allow list, the `.gitignore` lines, executable bits, `bash -n`, `node --check`, no leftover placeholder, "bare commands" in every skill, the `CLAUDE.md` shims, a valid `bootstrap.json`, and (tips) the tools, the push to `origin/<base>` and the registry entry.

## Hand-off

Write the hand-off in this order. Use real paths and values.

1. **TLDR** (1–3 sentences): what was set up and the one next action.
2. **Files**: an ASCII tree of the written files, each marked `(new)`, `(changed)`, `(kept)` or `(merged)`.
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
