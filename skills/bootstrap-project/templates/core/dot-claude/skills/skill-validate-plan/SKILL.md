---
name: skill-validate-plan
description: Plan-validation gate between writing a plan and /skill-2-implement. Dispatches the plan-validator subagent to check a .plans/ file against the real repository and @@PARENT_PLAN@@, and reports APPROVE / APPROVE WITH CHANGES / NEEDS REWORK. One round, no edits. Use right after a plan is saved.
argument-hint: "[plan file]"
---

Validate plan: $ARGUMENTS

Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs.

## Step 0: Resolve the plan file

- If `$ARGUMENTS` names a plan file, use it.
- Otherwise use the most recently modified `.plans/*.md` outside `.plans/done/`.
- Say which plan you resolved.

## Step 1: Dispatch the plan-validator agent (required)

Do not validate the plan yourself. The gate exists to get a review from an agent that did not write the plan. Call the Agent tool with:

- `subagent_type: "plan-validator"`
- `description: "Validate plan"`
- `prompt`: the plan path, and the instruction to follow its full process: read the plan, @@RULES_DOCS@@, then check every claim against the repository.

If the agent type is not found (it was created in this session and the session was not reloaded yet), use a general-purpose agent and tell it: "Act as the plan-validator agent. Read `.claude/agents/plan-validator.md` first and follow it exactly." Tell the owner to reload the session.

## Step 2: Present the verdict

- Relay the verdict, the blocking issues, the concerns, the edge cases, the checklist and the copy-paste block **as the agent wrote them**. Do not soften findings.
- Show the artifact path `.plans/.validations/<plan-basename>-validation-<n>.md` on its own line. If the agent's reply has no path, say that the agent did not complete, and run Step 1 again.

## Step 3: Next action

- **NEEDS REWORK:** fix the plan, then run `/skill-validate-plan` again. Do not implement.
- **APPROVE WITH CHANGES:** list the changes to put into the plan (`/apply-validation` does this), then the plan can run.
- **APPROVE:** the plan is ready for the dashboard or `/skill-2-implement`.

Do not write code in this step.
