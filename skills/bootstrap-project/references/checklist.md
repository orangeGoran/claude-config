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

The owner is not a template expert. Ask only what the owner alone can decide. Find everything else yourself and show it once, at the end, in plain words.

### How to ask

- **Max 5 questions.** Skip a question when the repo already answers it (say so in the summary instead).
- **Start each question with one plain sentence: what you need and why.** Example: "I need to know which rules every change in this project must follow, so the reviewer can check them."
- **No internal words in a question.** Never write field names (`rules.hard`, `stack.manifest`), or words like "manifest", "root files", "append-only", "CONFIG block", "hunt list", "audit rows", "parent plan", "post-edit lint". Say what it does for the owner instead ("the big plan of the project", "the command that runs the tests").
- **A real choice uses the decision format** (`## Question N of M`, the facts, one example step by step with real values, Option A (recommended) and Option B, why A; "Please reply with A or B"). Write it for this project, with real names from the repo.
- **A confirmation is not a question.** Do not ask "confirm or change" for values you found. Put them in the summary.
- If the owner says "explain", "what?" or "I do not know": explain in 3 plain sentences with one example, give your recommendation, and offer "reply OK to take my recommendation".
- Save each answer to `.claude/bootstrap.json` at once.

### The questions (in this order, skip when the repo answers them)

| # | Ask in plain words | Fields | Ask only when |
| --- | --- | --- | --- |
| 1 | "Which rules must every change follow? I found these in your files: <list>. Add, remove or OK." (3–8 rules, each a short title + one sentence) | `rules.hard[]` | Always. It is the most important answer: the reviewer and the checks use these rules. |
| 2 | Modules (decision format): which extra parts to add. Default: all on, Codex on. One line per module, in plain words (what it does for the owner) | `modules.*` | Always |
| 3 | Branches and merge (decision format): which branch the work goes to, and squash or merge commit | `git.*` | The repo has no `develop` + `main`, or the merge style is unclear. Mention that a free private GitHub repo cannot protect branches (403). |
| 4 | Contracts (decision format): where shared data shapes come from | `rules.contracts.*` | The repo has more than one app or package that shares data, and the files do not show the answer |
| 5 | Public or private, when the repo has no remote yet | `project.visibility` | No remote. Check the big plan for names of people, machines or clients first: history cannot be un-leaked. |

### Find these yourself (never ask; show in the summary)

| What | Fields | Where to find it |
| --- | --- | --- |
| Name, title, one-sentence summary, dashboard group, short label, GitHub remote | `project.*` | folder name, `origin`, README first line, the dashboard registry (same root) |
| Stack and the real commands (install, test, test one file, lint, format, type check, build) | `stack.*` | the scripts in `package.json` / `Package.swift` / `pyproject.toml`. A command that does not exist is empty ("not available yet"). |
| The lint-on-edit commands and file types | `stack.postEditLint.*` | the lint and format tools in the scripts; empty when there is none |
| The big plan of the project | `rules.parentPlan` | `PLAN.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `.plans/*-parent.md`. None → `docs/ARCHITECTURE.md` (the skill writes a skeleton). Never move or rename the owner's files. |
| Test data rule, example person for decision questions | `rules.testData`, `rules.exampleActor` | the hard rules and the roles in the code; else the defaults |
| Folders, files that plans touch, files many plans only append to, env files for worktrees | `layout.*` | top-level folders, `plan-lanes.mjs` CONFIG when it exists, `.env.example` |
| Default run mode, extra run rules | `pipeline.*` | default `pr`; extra rules from docker compose and migration scripts |
| The project's own checks per hard rule, the tests each rule needs, the validator's extra "never" limits | `rules.hard[].details`, `rules.hard[].tests`, `rules.validatorLimits` | In adopt and upgrade mode: copy them from the repo's existing `plan-validator.md`, `skill-1-plan`, `skill-3-test`, `skill-4-verify` and `apply-validation` (one short line each). Then the render keeps them, and no file needs a hand merge. |
| Registrations | `registry.*` | dashboard yes; browser-usability-test yes when there is a web UI or an API |
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
