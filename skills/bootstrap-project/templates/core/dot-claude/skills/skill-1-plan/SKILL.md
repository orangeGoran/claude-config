---
name: skill-1-plan
description: Plan step of the workflow (step 1 of plan → validate → implement → test → verify → ship). Explores the repo and @@PARENT_PLAN@@, asks the owner one decision at a time, proposes approaches, saves a structured plan to .plans/, then validates it. Use when starting a feature, a fix, a phase or any significant change.
argument-hint: "<what to plan>"
---

Plan: $ARGUMENTS

You start the **Plan** step of the workflow: `/skill-1-plan` → `/skill-auto-validate-plan` → dashboard run (`/skill-auto-pipeline`: `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`). You write a plan file. You do not write product code.

Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs.

## Step 0 — Quick presentation

- Root `AGENTS.md` is already in context through `CLAUDE.md`. Do not read it again.
- Read the parts of `@@PARENT_PLAN@@` that `$ARGUMENTS` touches, and its open decisions. Read every nested `AGENTS.md` in the folders the work touches.
- Give the owner a short overview: what exists in the repo today, what the parent plan already decides, and which open decisions this work touches. A few bullets.

## Step 1 — Explore and understand the problem

- Explore the real repo: files, `git log`, existing patterns, the scripts in @@MANIFESTS@@. Never describe the repo from memory.
- **Scope.** One plan is one change that one PR can carry. If `$ARGUMENTS` is bigger, say so and ask which part to plan first.
- If the requirement is unclear, ask. Do not guess. Use the **Question queue** below.

## Question queue — one question at a time

Steps 1, 1.5 and 2 all raise questions, and so do the open decisions this plan needs. Put them in one queue.

1. **Show the queue first.** Before the first question, send one short message with a numbered list of plain-words titles, no options. Then ask question 1 in the same message.
2. **One question per message**, with the heading `## Question N of M: <title>`.
3. **Stop after the question.** End with the reply line and wait. Do not explore further, draft the plan or ask the next question in the same turn.
4. **Confirm, then move on.** Start the next message with one line that records the answer, for example `Question 2 of 4 — recorded: B (keep the old endpoint for one release).` Then ask N+1.
5. **Tangents.** Answer a side question in full, then ask the same question again with the same N of M.
6. **Change the queue openly.** If an answer adds or removes a question, say so in one line and update M.
7. **Close the queue.** After the last answer, list all answers (`1A, 2B, 3A`) with their titles.

### Decision question format

- Never use AskUserQuestion for a design question. Use it only for a trivial pick that needs no background.
- Write in ASD-STE100: short sentences, one topic per sentence, active voice.

```markdown
## Question N of M: <short title in plain words>

**The facts.** 2–4 sentences: what the parent plan and the repo say today, and why a decision is necessary. Cite the file or section.

**Example, step by step:**
1. <@@QUESTION_ACTOR@@ does something, with real values>.
2. ...
3. <the event the decision affects>.

**Option A: <name> (recommended)**
- What happens at each step of the example (status codes, the data the user sees, what is stored).

**Option B: <name>**
- The same, for this option.

**Why I recommend A:**
- 2–3 bullets.
```

- Use one example for all options. Put the technical term in parentheses after the plain words.
- End with: Please reply with **A** or **B**. Next: question N+1 of M, <title>. (For the last question: "This is the last question.")
- When the owner answers an open decision of the parent plan, the plan records it, and one plan step moves it into the right section of `@@PARENT_PLAN@@`.

## Step 1.25 — Anchor to a pattern

- Find the closest existing pattern in this repo and read it end to end. List the files you read.
- Flag each deviation with a one-line reason.
- If nothing close exists, say so in the plan. Do not invent a pattern silently.

## Step 1.5 — Propose approaches

- Propose 2–3 approaches. For each: what it does, pros, cons, size (low / medium / high).
- Recommend one. Ask the owner to pick, as one question in the queue.

## Step 2 — Hard-rule check

For everything the plan adds, answer these and put the answers in the plan (section **Hard rules**):

@@PLAN_RULE_CHECKS@@

If an answer is not clear from the parent plan or the code, it is a question for the queue.

## Step 3 — Check contracts and breaking changes

- @@CONTRACTS_RULE@@ List every contract type, schema or endpoint the plan adds or changes.
- Search for consumers of anything the plan changes. List the affected ones, or write "None".

## Step 3.5 — Ground the plan in facts

- **Open every symbol you name** (file, function, schema, table, script, section). Never write a name you have not seen in this session.
- **Cite by symbol or section, not by line.** Add `:line` only when the line itself matters, and check it again after each edit to the plan.
- **Never state a count or size you did not measure.** Put the command next to the number.
- **Owner-only files.** A headless run cannot write `.claude/` or `.vscode/` (Claude Code protects them). A step that changes them is marked "(owner, by hand)" and is not part of the run.
- **Commands must exist.** A "How to verify" command must be in AGENTS.md **Commands** or the manifest when it runs, or be a plain tool (`grep`, `git`). If the plan adds the script, the step that adds it comes first. A command that is "not available yet" cannot be a check.

## Step 4 — Write the plan

Save to `.plans/<YYYYMMDD-HHMMSS>-<kebab-slug>.md` (local time now, for example `20261112-091500-add-health-endpoint.md`). Template:

````markdown
# Plan: <title>

- **Base**: @@BASE_BRANCH@@

## Goal

<What this plan delivers and why. Name the part of the parent plan it serves.>

## Context

- Parent plan sections: <list>
- Decisions taken for this plan: <1A — title, ...> (or "None")
- Open decisions this plan does not take: <list> (or "None")
- Pattern followed: <files read end to end>; deviations: <list or "None">

## Hard rules

<The Step 2 answers, one line per rule. "Not touched" is a valid answer, with the reason.>

## Contracts

<Contract types, schemas or endpoints added or changed. Or "None".>

## Affected files

- `path/to/file` — <new | modified | deleted>: <what changes>

> Every file a step or test edits is listed here, including lock files, `AGENTS.md` (Commands section) and `@@PARENT_PLAN@@`.

## Breaking changes

<List, or "None">

## Steps

1. <one concrete action with exact paths; small enough for one commit>
2. ...

> `/skill-2-implement --commit-per-step` makes one commit per step. Order the steps so the tree builds after each one.

## Tests

- <tests this plan adds, and what each one proves>

> For every test ask: would it still pass if the feature were not built? If yes, rewrite it.

## How to verify

```bash
<exact commands, one per line, each able to fail>
```
````

## Step 5 — Self-check

Before you show the plan, check it. Fix the plan if any item fails.

- [ ] The scope is one change that one PR can carry
- [ ] No open decision is taken without the owner's answer in this session
- [ ] The Hard rules section answers every rule
- [ ] The Contracts section is filled
- [ ] Each step has exact paths and is one commit; the tree builds after each step
- [ ] Affected files lists every file the steps and tests touch
- [ ] Every symbol, path and section was opened in this session
- [ ] Every number has the command that measured it
- [ ] Every "How to verify" command exists when it runs, and can fail
- [ ] No "TBD" or "decide later" is left; each one was raised in the queue
- [ ] No two steps conflict, and no step contradicts Tests or Affected files

## Step 6 — Validate

Run `/skill-auto-validate-plan` on the saved plan yourself. Do not ask first.

- Use the Skill tool: `skill: "skill-auto-validate-plan"`, `args: ".plans/<plan-file>.md"`. Always pass the plan path, so it cannot pick a different plan.
- Follow it to the end: all rounds (max 4), the owner questions, and its final report.
- Ask its owner questions through the question queue, in the decision format. Do not guess.
- Skip this step only if the owner said "draft only" or "skip validation", or the Skill tool is not available. Then say in one line why, and tell the owner to run `/skill-auto-validate-plan .plans/<plan-file>.md`.

## Step 7 — Present and wait

- Show the validation status (`READY`, `OPEN ITEMS` or `BLOCKED`) and its open items, then a short plan summary (after the validation edits).
- Show the affected files as an ASCII tree grouped by folder, each marked `(new)`, `(modified)` or `(deleted)`.
- Give a copy-paste staging command for this session's files only (keep the quotes):

  ```bash
  git add -- .plans/<plan-file>.md '.plans/.validations/<plan-base>-*'
  ```

- Then a copy-paste commit message: `docs(plans): add <slug> plan`.
- Do not run `git add`, `git commit` or `git push`. Push only when the owner says "push".
- Tell the owner the next step: push the plan to `@@BASE_BRANCH@@`, then launch it in the plans dashboard (mode "to PR" for a draft PR). The work starts only after the owner's explicit "go".
- **Stop.** Do not write product code or tests in this step.
