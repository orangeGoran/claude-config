---
name: skill-2-implement
description: Implement one saved .plans/ plan in this repository step by step — production code and its unit tests together, with a scoped test run after each step — update the registration points, run lint and the related checks with the repo's real commands, and end with a short summary. Use when given a plan file path; also called by /skill-auto-pipeline. It never commits.
argument-hint: "<plan file>"
---

Plan: $ARGUMENTS

You run the **Implement** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

## Step 0: Select the plan

- The first argument is the plan file path. If it is only a name, look for it in `.plans/`.
- If no plan matches, or the plan is in `.plans/done/`, stop and say so. Do not pick another plan.

## Step 1: Read the rules

- Root `AGENTS.md` is already in context through `CLAUDE.md`. Follow it, especially **Hard rules**.
- Read the parts of `@@PARENT_PLAN@@` that the plan cites, and every nested `AGENTS.md` in the folders the plan touches.

## Step 2: Check the plan against the code

- Before you edit, check that each file, line, symbol and signature in the plan exists as the plan says. Read the files of the plan's **Reference implementation** section: the new code mirrors them.
- If the plan does not match the code, or a step needs an owner decision, do not guess. Write the question down (Step 6), skip the steps that depend on it, and continue with the rest.

## Step 3: Implement, one step at a time

Do the plan's **Steps** in order. Change only what the plan asks for. **Run shell commands bare:** one command per call, no pipes, `&&`, redirection or heredocs. Headless runs auto-deny compound commands.

For each step, do this loop, then go to the next step:

1. **Code.** Write the production code of the step.
2. **Unit test.** Write the unit tests for that code, for the cases in the plan's **Tests** section. Follow the specs next to it.
3. **Scoped run.** Run only the tests of this step (AGENTS.md, **Commands**, "Test (one file)"; when that row is "not available yet", say so once and run "Test (full)" at the end of the plan instead). Never run the full suite here. A failure → fix it before the next step.

**What gets unit tests:** code with logic — services and use cases, data access with queries, request handlers and controllers, models with validation or mapping, and UI components and hooks with logic.

**What does not:** wiring with no logic — module imports, registration lists, decorator-only files, re-exports, config registration. End-to-end tests are written in `/skill-3-test`, not here.

Also:

- Follow existing patterns. @@CONTRACTS_RULE@@
- Write doc comments for new public functions as `AGENTS.md` says.
- After each fix, search sibling code for the same defect, and fix it or report it.
- Install packages with the package manager at their latest version. Never type a version by hand.
- If you find something the plan does not cover, do not deviate. Write it as an open question (Step 6) and continue with the steps that do not depend on it.

## Step 3.5: Registration points

Some files are lists that many plans append to: a registry of models or modules, a route table, an error code list, a list of env values, a translation file, a dependency manifest. The plan's **Wiring & registration** section names the ones this plan needs; the root `AGENTS.md` and the nested `AGENTS.md` files name the lists of this repo.

- Add each new item to every list the plan names, in the list's order and format.
@@IF HAS_SOFT_FILES@@
- The shared lists of this repo (many plans append to them; keep each append small and in order):
@@SOFT_FILES_MD@@
@@END@@
- Check the wiring: each new part (service, provider, handler, route, job, plugin) is registered where the framework looks for it, and each consumer can reach it (for example: exported by its module, and that module imported by the consumer's module).
- A generated file (a contract, a client, types, a migration) comes from its generator, never from a hand edit. Run the generator that `AGENTS.md` names, and read the result. A new migration is read line by line.

## Step 4: Lint and the related checks

1. **Lint.** After all code changes, run the "Lint" and "Format" commands (AGENTS.md, **Commands**) on the changed files, @@LINT_CHECK_STEP@@ **Judge by the exit code and the error count, never by the last lines of the output**; search a long output with the Grep tool for the error marker of the linter. Fix lint errors in the code, never in the lint config. After a lint fix, run the scoped tests of the touched files again.
2. Run the other checks related to the change (type check, build), from `AGENTS.md`, **Commands**, and @@MANIFESTS@@.
3. If a check has no command yet ("not available yet"), say so. Do not invent one.
4. Run every command in the plan's **How to verify** section that this step can run, and record the result.
@@IF MOD_STEP_GATE@@
5. **Step gate.** When the plan's steps are done and the related checks pass, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> implement` (`<plan-basename>` without `.md`). The commit guard (`workflow-guard.sh`) reads this mark.
@@END@@

## Step 5: Never

- `git add`, `git commit`, `git push`, `git reset`, `git stash`, or opening a PR. The work stays uncommitted: `/skill-auto-pipeline` makes one commit for the whole plan, or the owner commits.
- Edits outside this repository.
- Weakening a hard rule, a lint rule or a test to make a check pass.

## Step 6: Summary

End with a short summary:

- the files changed, with one line each,
- the checks run, with the result of each one (command, exit code, counts),
- the deviations from the plan, and the sibling defects found,
- **Open questions**: "none", or each question in ASD-STE100: the facts, one example step by step with real values (@@QUESTION_ACTOR@@), Option A (recommended) and Option B, and why you recommend A.
