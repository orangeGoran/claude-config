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

1. **Show the queue first.** Before the first question, send one short message with a numbered list of plain-words titles, no options. Then ask question 1 in the same message. Example:

   ```markdown
   I have 4 questions before I can write the plan. We go through them one at a time.

   1. Who can see the old versions of a record
   2. What happens to the link when the owner leaves
   3. Approach: one shared screen or one screen per type
   4. Access for the new endpoints
   ```
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
- Accept a plain-text reply. When the owner asks for more explanation, explain again in this format. Do not open a popup.
- When the owner answers an open decision of the parent plan, the plan records it, and one plan step moves it into the right section of `@@PARENT_PLAN@@`.

## Step 1.25 — Anchor to a reference implementation

- Find the **closest existing implementation** of the same kind of change in this repo (for example an existing endpoint, screen, job or command of the same shape).
- **Read those files end to end**: the entry point, the logic, the data access, the types, and their unit and end-to-end tests. Do not skim.
- Write the **Reference implementation** section of the plan: the closest pattern, the files read end to end, a mirror mapping (`<reference file, function or type>` → `<new file, function or type>`), and the deviations.
- Flag each deviation from the reference with a one-line reason. If you cannot justify a deviation, mirror the reference.
- If nothing close exists, write "No close reference exists" in that section. Do not invent a pattern silently.

## Step 1.5 — Propose approaches

- Propose 2–3 approaches. For each: what it does, pros, cons, size (low / medium / high).
- Recommend one. Ask the owner to pick, as one question in the queue.

## Step 2 — Hard-rule check

For everything the plan adds, answer these and put the answers in the plan (section **Hard rules**):

@@PLAN_RULE_CHECKS@@

If an answer is not clear from the parent plan or the code, it is a question for the queue.

@@IF HAS_HTTP_API@@
**Endpoint access** (when the project has an HTTP API and the plan adds or changes endpoints): for each endpoint, ask who can call it (public, signed in, which role) and whether it needs a rate limit. Never assume access. Ask it through the queue: one question per endpoint, or one for a group of endpoints with the same access. Record the answers in the plan's **Endpoint access** section.
@@END@@

## Step 3 — Check contracts and breaking changes

- @@CONTRACTS_RULE@@ List every contract type, schema or endpoint the plan adds or changes.
- Search for consumers of each function, type, schema or endpoint the plan changes, in every module and app of the repo. List the affected ones in **Breaking changes**, or write "None".

## Step 3.5 — Ground the plan in facts

Each repeated finding of a plan validation comes from a claim written from memory. Before you write the plan:

- **Open every symbol you name** (file, function, type, enum member, schema, table, config key, script, section). Never write a name you have not seen in this session. A name that looks right but does not exist costs a full validation round.
- **Verify every signature you call.** Argument count and order, the return type, and whether the field you read is declared and loaded. Ask for each call in the plan: would it compile? A step that would not compile is a blocking finding.
- **Check the wiring of anything that crosses a module or process boundary.** For each part that a new consumer needs (a service, provider, handler, route, job or plugin): where is it declared, where is it registered or exported, and can the consumer reach it from there? A part that is declared but not registered can stop the app at start or fail only at run time. Write the result in **Wiring & registration**.
- **Cite by symbol or section, not by line.** Write `orders.service.ts` → `createOrder()`, not `orders.service.ts:137`. Add `:line` only when the line itself matters, and open it again after each edit to the plan: the tree moves under it.
- **Never state a count or size you did not measure.** Put the command next to the number.
@@IF HAS_TEST_HARNESS_DOC@@
- **Read the test harness rules first.** Before you write the **Tests** section, read `@@TEST_HARNESS_DOC@@`. It lists what the end-to-end harness can and cannot do.
@@END@@
@@IFNOT HAS_TEST_HARNESS_DOC@@
- **Read the test harness rules first.** Before you write the **Tests** section, read the nested `AGENTS.md` of the end-to-end test folder, when the repo has one (see the **Layout** table of the root `AGENTS.md`). It lists what the harness can and cannot do.
@@END@@
- **Owner-only files.** A headless run cannot write `.claude/` or `.vscode/` (Claude Code protects them). A step that changes them is marked "(owner, by hand)" and is not part of the run.
- **Commands must exist.** A "How to verify" command must be in AGENTS.md **Commands** or the manifest when it runs, or be a plain tool (`grep`, `git`). If the plan adds the script, the step that adds it comes first. A command that is "not available yet" cannot be a check.

## Step 4 — Write the plan

Save to `.plans/<YYYYMMDD-HHMMSS>-<kebab-slug>.md` (local time now, for example `20261112-091500-add-health-endpoint.md`). Template:

````markdown
# Plan: <title>

- **Base**: @@BASE_BRANCH@@
@@IF HAS_TICKETS@@
- **Tickets**: <#n, #m — the issues this plan works on; "none" for work without a ticket>
@@END@@

## Goal

<What this plan delivers and why. Name the part of the parent plan it serves.>

## Context

- Parent plan sections: <list>
- Decisions taken for this plan: <1A — title, ...> (or "None")
- Open decisions this plan does not take: <list> (or "None")

## Hard rules

<The Step 2 answers, one line per rule. "Not touched" is a valid answer, with the reason.>

@@IF HAS_HTTP_API@@
## Endpoint access

| Endpoint | Method | Access |
| --- | --- | --- |
| `<path>` | <GET, POST, …> | <public or signed in, the role, the rate limit> |

> Only when the project has an HTTP API and the plan adds or changes endpoints; else leave the section out. Every new endpoint has a row. Access is never assumed.
@@END@@

## Contracts

<Contract types, schemas or endpoints added or changed, and their consumers. Or "None".>

## Reference implementation

- Closest existing pattern: <folder or files>
- Files read end to end: `path/a`, `path/b`, …
- Mirror: `<reference file, function or type>` → `<new file, function or type>`
- Deviations: `<deviation>` — <one-line reason> (or "None")

> Write "No close reference exists" when this is a new pattern.

## Affected files

- `path/to/file` — <new | modified | deleted>: <what changes>

> Every file a step or test edits is listed here: specs, test helpers, lock files, release notes, `AGENTS.md` (Commands section), `@@PARENT_PLAN@@` and every doc the plan promises to update. A step that says "document X" with no file here for that edit does not happen.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `<new provider, model, route, module or handler>` | `<module or file>` | `<export>` | `<consumer module>` | `<list or registry file it is added to>` |

> Write "No new wiring — no model, module, route, queue or cross-module provider" when there is none, so the validator sees that it was checked.

## Breaking changes

<Each changed function, type, schema or endpoint with its consumers (from the Step 3 search), or "None">

## Steps

1. <one concrete action with exact paths>
2. ...

> Each step takes 2–5 minutes and names exact paths. Order the steps so the tree builds after each one. Mark a step that changes `.claude/` or `.vscode/` "(owner, by hand)". The whole plan becomes one commit and one PR.
@@IF MOD_CHANGELOG@@
@@IF HAS_VERSION_BUMP@@
> The last code step adds the release note and the version raise (`/changelog-entry`), unless the change qualifies for `no-changelog`.
@@END@@
@@IFNOT HAS_VERSION_BUMP@@
> The last code step adds the release note (`/changelog-entry`), unless the change qualifies for `no-changelog`.
@@END@@
@@END@@

@@IF HAS_MIGRATIONS@@
## Migrations

<"None" when the plan does not change a database schema. Otherwise: the command that generates the migration, a review of the generated file line by line (a rename written as drop and add, changes from another branch), and the command that applies it and checks for drift.>
@@END@@

## Tests

### Unit tests

- <each unit test case, and what it proves>

### End-to-end tests

- <each end-to-end case; mandatory for each new or changed endpoint when the project has an HTTP API: success, validation error, 401/403 per role, 404, and another tenant when the project is multi-tenant>

### Harness constraints

<What the end-to-end tests cannot assert for this feature (a service the harness replaces with a double, a header that only the real server sets, a second process), and where each such assertion goes instead. Take it from the nested `AGENTS.md` of the test folder. "None" when the harness covers everything.>

> For every test ask: would it still pass if the feature were not built? If yes, rewrite it.
@@IF HAS_BROWSER_TEST@@

## Browser test

- Routes: <the screens to open, for example `/orders/:id`>
- Siblings: <other screens that use the same component or flow, to check for the same defect>
- Account and data: <role, and the test data to make, as the browser-test profile notes allow>
- What to compare: <the old app on @@APP_URL@@ against the new code, step by step, with what must differ>

> A change with no screen change writes `None — <reason>` here, and the test step skips the browser test.
@@END@@

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
@@IF HAS_HTTP_API@@
- [ ] Every new or changed endpoint has an Endpoint access row (when the project has an HTTP API)
@@END@@
- [ ] The Contracts and Breaking changes sections are filled (even if "None")
- [ ] The Reference implementation section names the closest pattern, the files read end to end, the mirror mapping and the deviations (or "No close reference exists")
- [ ] The Wiring & registration section is filled, or says "No new wiring"
- [ ] Each step takes 2–5 minutes, names exact paths, and is a concrete action (no "set up the module"); the tree builds after each step
- [ ] Affected files lists every file the steps and tests touch
@@IF HAS_MIGRATIONS@@
- [ ] The Migrations section is filled (even if "None")
@@END@@
@@IF HAS_HTTP_API@@
- [ ] The Tests section covers each endpoint case
@@END@@
- [ ] The Tests section has a Harness constraints subsection: what the end-to-end tests cannot assert, and where it goes instead
- [ ] No test would still pass with the feature not built
- [ ] Every symbol, path and section was opened in this session, and every signature the plan calls was checked against the source (it would compile)
- [ ] No `:line` citation is left that you did not open again after the last edit to the plan
- [ ] Every number has the command that measured it
- [ ] No step that edits `.claude/` or `.vscode/` lacks the "(owner, by hand)" mark
@@IF HAS_BROWSER_TEST@@
- [ ] The Browser test section names real routes and siblings, or says `None` with a reason
@@END@@
@@IF HAS_TICKETS@@
- [ ] The Tickets line lists each ticket the plan works on, and each "Done when" line of those tickets is a step or a test
@@END@@
- [ ] Every "How to verify" command exists when it runs, and can fail
- [ ] No "TBD" or "decide later" is left; each one was raised in the queue
- [ ] No two steps conflict, and no step contradicts Tests or Affected files

## Step 6 — Validate

Run `/skill-auto-validate-plan` on the saved plan yourself. Do not ask first.

- Use the Skill tool: `skill: "skill-auto-validate-plan"`, `args: ".plans/<plan-file>.md"`. Always pass the plan path, so it cannot pick a different plan.
- Follow it to the end: all rounds (max 4), the owner questions, and its final report.
- Ask its owner questions through the question queue, in the decision format: show the list first, then one question per message. Never use AskUserQuestion for them. Do not guess.
- Skip this step only in these cases, and say in one line why:
  - The owner said "draft only" or "skip validation".
  - The Skill tool is not available, or `skill-auto-validate-plan` is not in the skill list (for example, when you run as a subagent).
- When you skip it, tell the owner to run `/skill-auto-validate-plan .plans/<plan-file>.md` before the implementation starts.

## Step 7 — Present and wait

@@IF MOD_CODEX@@
- Show the validation status (`READY`, `READY (<Codex|Claude> OFF)`, `OPEN ITEMS` or `BLOCKED`) and its open items, then a short plan summary (after the validation edits).
@@END@@
@@IFNOT MOD_CODEX@@
- Show the validation status (`READY`, `OPEN ITEMS` or `BLOCKED`) and its open items, then a short plan summary (after the validation edits).
@@END@@
- Show the affected files as an ASCII tree grouped by folder, each marked `(new)`, `(modified)` or `(deleted)`.
- Give a copy-paste staging command for this session's files only (keep the quotes):

  ```bash
  git add -- .plans/<plan-file>.md '.plans/.validations/<plan-base>-*'
  ```

- Then a copy-paste commit message: `docs(plans): add <slug> plan`.
- Do not run `git add`, `git commit` or `git push`. Push only when the owner says "push".
- Tell the owner the next step: push the plan to `@@BASE_BRANCH@@`, then launch it in the plans dashboard (mode "to PR" for a draft PR). The work starts only after the owner's explicit "go".
- **Stop.** Do not write product code or tests in this step.
