---
name: bootstrap-project
description: Set up the full Claude Code scaffolding for a new or existing project repo in one go — AGENTS.md + CLAUDE.md, README.md, .claude/settings.json, the plan-validator agent, the numbered skill chain (skill-1-plan → skill-5-ship, skill-auto-pipeline, skill-validate-plan, skill-auto-validate-plan, apply-validation), optional modules (Codex, changelog, decision sheet, test review, step gate, post-edit lint, plans-parallel, pr-feedback, run-skill), auto-pipeline.sh, plan-lanes.mjs, the .plans/ folders, .gitignore lines, the plans-dashboard registration and the browser-usability-test profile. Asks a short interview one question at a time, saves the answers to .claude/bootstrap.json, renders the templates, verifies the dashboard readiness checks, and hands off copy-paste git commands. With --upgrade, renders the templates again for a repo that already has the setup and shows the diff of each file. Use when the user says "bootstrap this project", "set up Claude Code for this repo", "new project setup", "add the pipeline/skills like in <other repo>", "make this repo ready for the plans dashboard", "upgrade the project scaffolding", or invokes /bootstrap-project.
argument-hint: "[--upgrade]"
---

Bootstrap this repo: $ARGUMENTS

`SKILL_DIR` is the folder of this file (`~/.claude/skills/bootstrap-project`). The scripts are `node $SKILL_DIR/scripts/<name>.mjs`. Read `references/lessons.md` before step 1: every rule there is a real failure from an earlier setup.

## Rules

- **Never** run `git add`, `git commit`, `git push`, `git stash`, `git reset`, `git add -N` or `git rm --cached`. To preview new files, use `git status --untracked-files=all` and `git diff --no-index`. The hand-off prints the git commands; the owner runs them.
- **Never** create a GitHub repo or branch, and never change GitHub settings. Print the commands.
- **Never** write under `~/.claude` with Edit or Write (Claude Code refuses). `register.mjs` prints shell commands with a backup; run them only after the owner says yes.
- **Never** replace an existing file without showing its diff and getting a yes for that file.
- Never invent a command, a field or a rule. A command that does not exist yet is "not available yet".
- Ask decision questions one per message, in the owner's format (`## Question N of M`, the facts, one example step by step with real values, Option A (recommended) and Option B, why A; ASD-STE100; end with "Please reply with A or B"). Do not use the AskUserQuestion popup for them.
- Run shell commands bare, one command per call.

## Step 0 — Detect

1. `git rev-parse --show-toplevel`. Not a git repo → ask the owner whether to run `git init -b <base branch>` (that is the only git write this skill may do, and only after a yes).
2. Collect the facts that pre-fill the interview: `git remote get-url origin`, `git branch -a`, the manifest (`package.json` scripts, `Package.swift`, `pyproject.toml`, `Cargo.toml`, `go.mod`), lock files, top-level folders, `.env.example`, an existing `AGENTS.md` / `CLAUDE.md` / `README.md` / `PLAN.md` / `docs/ARCHITECTURE.md`, and `.claude/`.
3. Decide the mode and say it in one line:
   - `.claude/bootstrap.json` exists, or `$ARGUMENTS` has `--upgrade` → **upgrade** (Step 1 asks only for missing answers).
   - `.claude/` exists without `bootstrap.json` (a repo that was set up by hand) → **adopt**: full interview, pre-filled from the existing files, then the same diff step as an upgrade.
   - Otherwise → **new**.

## Step 1 — Interview

Follow `references/checklist.md`, section "Interview". Ask only what the owner alone can decide (max 5 questions, one per message). Start each question with one plain sentence that says what you need and why. Never use internal words or field names in a question. In adopt and upgrade mode, also copy each hard rule's detailed checks and tests, and the validator limits, from the repo's existing skills into `bootstrap.json` (`details`, `tests`, `validatorLimits`), so no file needs a hand merge. Find everything else in the repo yourself, and show it once in a short plain summary before the render ("reply OK, or name what is wrong"). Save each answer to `<repo>/.claude/bootstrap.json` at once, in the shape of `references/bootstrap.example.json`. Then run `node $SKILL_DIR/scripts/render.mjs <repo>` once: it checks the answers file and fails with a list of problems.

## Step 2 — Render

1. `node $SKILL_DIR/scripts/render.mjs <repo>` (add `--upgrade` in upgrade mode). It renders into a fresh stage folder and prints `new | same | changed | config | merge | orphan` per file. It writes nothing in the repo, except `firstPlanTs` in `bootstrap.json` on the first render.
2. For each `changed` file, show `diff -u <repo>/<path> <stage>/<path>` and ask: replace, keep, or merge by hand. Recommend "keep" for files with project text the template does not know (`AGENTS.md`, `README.md`), and then copy only the missing parts by hand. A script in `.claude/scripts/` keeps its own CONFIG block. When the answers give other values, the file shows `config` (or `changed` with a note) and the differing CONFIG lines (`-` yours, `+` from the answers). Ask per file: keep yours, take the answers (`render.mjs <repo> --reset-config --apply <path>`), or edit the one line by hand. Never leave a changed base branch or allow rule unasked.
3a. For each `orphan` file (a module that is now off), say that it is no longer used and ask whether the owner deletes it. Never delete it yourself. Ask about all changed files in one message, as a numbered list.
3. Write: `node $SKILL_DIR/scripts/render.mjs <repo> --apply new` (new files and the `.gitignore` merge), then `--apply <path,path>` for the changed files the owner approved.
4. `.claude/settings.json` is a permission file. If the session refuses to write it ("Self-Modification"), print the `--apply .claude/settings.json` command and ask the owner to run it with `!` in front.

## Step 3 — Register

1. `node $SKILL_DIR/scripts/register.mjs <repo>`. It prints the commands for the plans dashboard registry (`~/.claude/pipeline-projects.json`, merge with a backup, `launchers: []`) and the browser-usability-test profile.
2. Show the commands and the entry. Run them one per call after the owner says yes. The dashboard reloads the registry on each request: no restart.

## Step 4 — Verify

`node $SKILL_DIR/scripts/verify.mjs <repo>`. Every required check must pass, and the dashboard level must be green. Fix each failure at its cause (usually the answers file, then render again), not in the rendered file. The tip "Tooling is on origin/<base>" stays open until the owner pushes: that is expected.

## Step 5 — Hand-off

Use the template in `references/checklist.md`, section "Hand-off". It has: the file tree (new / changed / kept), the verify result, one copy-paste block with the git and GitHub commands in order, the Conventional Commits message, the reload note (new skills and agents load only after a session reload), and the next steps: push the tooling to `origin/<base>`, launch the first plan ("Check the pipeline end to end") in "to PR" mode from the dashboard, then `/skill-1-plan <first small task>`.
