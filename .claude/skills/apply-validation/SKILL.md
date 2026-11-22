---
name: apply-validation
description: Reconcile a validation or review report (findings about a plan or an implementation, pasted from another agent, another session or a person) against the real repository — check each finding, apply the valid fixes, reject the invalid ones with evidence, and produce a copyable reply. Use when the owner pastes another agent's findings ("Here is another agent evaluation…", "A validation found the issues below…") or invokes /apply-validation. /skill-auto-validate-plan uses its rules for each round.
argument-hint: "[optional .plans/ path] <pasted report, or leave for the report already in the conversation>"
---

Reconcile this validation report: $ARGUMENTS

The report may be in `$ARGUMENTS`, pasted earlier in the conversation, or about to be pasted. If you cannot find a report anywhere, ask the owner to paste it and stop.

Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs.

## What this skill does

A reviewer (the `plan-validator` agent, Codex, another Claude session, a person) has reviewed either a **plan** in `.plans/` or an **implementation** (working-tree changes or recent commits). Do NOT apply its findings blindly. Reviewers are often wrong about this repo. Check first, then act.

## Steps

### 1. Identify the target

- If `$ARGUMENTS` names a `.plans/` file, that plan is the target.
- Otherwise infer it from the report and the conversation: findings about design or plan wording → the plan most recently discussed; findings about code or tests → the working tree or recent commits.
- A parent plan, roadmap or spec that comes with the report is context only. Do not edit it; the target is the named plan or the code.
- Say the target before you continue.

### 2. Parse the findings

Extract every distinct finding with its severity as given (Blocking / Should fix / Nice to have / suggestion). Number them F1, F2, … Keep a short quote of the reviewer's words.

### 3. Check each finding against the repo

- Read the exact files, lines and sections the finding names. If it names a symbol, search for it.
- Check the rules in `AGENTS.md`, `docs/parent-plan.md`, `docs/plans-dashboard.md` (root and nested `AGENTS.md`). Reviewers often flag a deliberate, documented choice.
- Classify each finding:
  - **VALID:** a real problem. Fix it.
  - **PARTIALLY VALID:** part of it is true, but the proposed fix or scope is wrong. Say what the correct fix is.
  - **INVALID:** the reviewer misread the code, missed a rule, or the case is already handled. Cite the `file:line` or the rule that proves it.
- Give the top priority to **destructive-migration** findings: a dropped table or column, a rename written as drop and add, an enum rebuild that loses values, a cleanup `DELETE`, a `NOT NULL` column without a default or a backfill. Data loss in production cannot be undone.
- Give the same priority to findings about the hard rules in `AGENTS.md` (restart after dashboard changes, no npm dependencies, public repo: no private data, global rules affect every project, never stop processes by name, tests for logic changes, docs: current state only) and about secrets. A reviewer's "fine" is INVALID when the code misses one of these checks:

### 4. Apply the valid fixes

- **Plan target:** edit the `.plans/` file. Resolve every VALID or PARTIALLY VALID blocking item. Keep the plan's structure. Do not rewrite unrelated sections.
- **Implementation target:** fix the code. Follow existing patterns. Run only the tests related to the change (AGENTS.md, **Commands**), as bare commands.
- Do NOT apply an INVALID finding "just to be safe". That is how rules erode.

After you edit, and before you report, run these three checks. They catch the defects that a reconciliation round most often adds:

- **Citations you moved.** Open again each `file:line` and section in or next to a hunk you edited.
- **Cross-references after a renumber.** If steps were added, removed or reordered, search for `step <n>` and confirm each one still points at the step it means.
- **Each fix reached everywhere.** For each fix, find every other place the target mentions that subject (Hard rules, Endpoint access, Contracts, Reference implementation, Affected files, Wiring & registration, Breaking changes, Steps, Migrations, Tests, How to verify, and any doc-update step) and confirm none still states the old version.

### 5. Report and copyable reply

First, a short table for the owner: `F# | severity | verdict | action taken`.

Then one fenced code block the owner can paste back to the reviewer:

```
## Validation response — <target>

Accepted and fixed:
- F1: <what was done, file or section>

Partially accepted:
- F3: <what was valid, what was applied instead of the proposed fix, and why>

Rejected:
- F2: <why it is not a problem — evidence: file:line or rule>

Status: <for example: all blocking items resolved; plan ready for another validation>
```

Keep the reply plain and self-contained. The reviewer has no access to this conversation.

### 6. Save the round (required, last action)

Every reconciliation writes a **new numbered round file**. Never overwrite an earlier round.

- `<base>` is the target plan's basename without `.md`. For an implementation target with no single plan, use the plan that `.plans/.workflow-state/` tracks (its folder name), else the current branch name with `/` replaced by `-`.
- `ls .plans/.validations/` to find the next free `<n>` for `<base>-external-<n>.md`. If the folder does not exist, run `mkdir -p .plans/.validations` and use `<n>` = 1.
- Write the file with the Write tool (no heredoc), with this content:

```markdown
**External validation round:** <n> — reviewer: <as the owner stated it>
**Target:** <plan path or implementation description>

<the F# | severity | verdict | action taken table>

<the full copyable "## Validation response" block>
```

When `/skill-auto-validate-plan` runs this step, it writes its own `-round-<n>.md` decision log instead.

State the file path on its own line in your reply.

## Rules

- Never weaken or delete a rule in `AGENTS.md` or `docs/parent-plan.md` because a reviewer disliked it. Reject the finding with the reference.
- Never run `git add` or `git commit`. The owner commits.
- If a finding needs a scope or design decision, or takes an open decision of the parent plan, do not expand the scope silently. List it under "Needs owner decision" in both the table and the copyable reply.
