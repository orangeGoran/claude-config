---
name: plans-parallel
description: Survey every plan in .plans/ and report which ones can run at the same time as background auto-pipeline worktrees, which must wait because they touch the same files, which are already running, and which are not machine-runnable. Ends with a recommended launch batch and copy-paste auto-pipeline.sh commands. Use when asked "what can we work on in parallel", "what is left in .plans", "what should I run in the background", or on /plans-parallel.
argument-hint: "[optional: --json | a lane or area to focus on]"
allowed-tools: Bash, Read, Grep, Glob
---

Survey the plan backlog for parallel work: $ARGUMENTS

## What this skill is

A **read-only scheduling report**. It answers one question: *of all plans in `.plans/`, which plans can I launch now as background pipelines at the same time, without two runs editing the same files?*

**This skill never implements anything, never launches a pipeline, and never edits a plan.** It ends with commands that the owner runs.

Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs.

## Step 1 — Run the analyzer

```
node .claude/scripts/plan-lanes.mjs
```

Add `--json` if the owner asked for machine-readable output, or if you need the full `hardFiles` lists to explain one conflict.

The script does all the mechanical work. It reads every top-level `.plans/*.md`, takes the repo paths from the plan's **`## Affected files`** section, and calculates the conflicts. The repo-specific settings (folders, shared files) are in its `CONFIG` block. A plan with no `## Affected files` section falls back to the full text and is marked `(!approx)`: treat its footprint as an upper limit and say so. **Do not calculate its results again by hand.** Read its output and explain it.

| Section | Meaning |
| --- | --- |
| `IN FLIGHT / AWAITING REVIEW` | A run that is still going, or that waits for the owner's review. **Never launch these again.** Its lane is **occupied**: a plan that touches the same files must wait. |
| `DONE — NEEDS CLEANUP` | Shipped on the base branch, but the worktree is still on disk. The lane is **free**. The plan needs `--cleanup`, not a review. |
| `RECOMMENDED PARALLEL BATCH` | One plan per lane, ranked by `ready` status, then validation rounds, then the smallest footprint. This is the answer to "what can run together". A `~` line names another plan in the batch that shares 1–2 code files (expect a small merge conflict). A `!!` line means the plan also touches files that a running or waiting run holds: finish or review that run first. |
| `LANES` | Groups of plans that are joined by file overlap. Plans in one lane run one after the other. |
| `NOT SCHEDULABLE` | Parent or roadmap plans (split them into subplans first), trackers, manual runbooks, and plans that name no code files. |
| `MINOR OVERLAPS` | Two plans share 1–2 code files. They can run at the same time. The second one to merge fixes a small conflict by hand. |
| `SOFT OVERLAPS` | Both plans append to a shared file (a registration list, a lock file). They can run at the same time. |

The JSON has the same data: `inFlight`, `awaitingReview`, `needsCleanup`, `staleReports`, `recommendedBatch`, `lanes`, `overlaps`, `excluded`, `plans`.

## Step 2 — Check the classification

The "not schedulable" groups come from heuristics. Check them before you report, and correct the report in words where they are wrong:

- **Parent or roadmap plan** — open the plan and make sure that it points to subplans and does not specify code. If it has a phase that can be implemented, say so and treat it as schedulable.
- **Manual runbook** — make sure that it really is work on a host or a cloud console. Such plans must **never** go through `auto-pipeline.sh`: the pipeline runs headless, with no way to approve a step.

The run state is **not** a heuristic. The analyzer gets it from the worktree, `.plans/done/` and git. Do **not** calculate it again, and never use these two signals:

- the `## Status:` line of an old report — it does not change after the session ends, so a run that shipped long ago can still say `VERIFIED`;
- `git branch --merged` — it is wrong in both directions: a branch with no commits of its own looks "merged", and a squash-merged branch never shows.

Also run `git status` and look for uncommitted edits to a plan that you want to recommend. A plan that is being edited is not ready to launch.

## Step 3 — Pick the plan for now

Apart from the parallel batch, name **one plan to do now in the foreground**, with the evidence, in this order:

1. `status: ready` in `.plans/plan-meta.json` (if the file exists).
2. Validation rounds in `.plans/.validations/` (`Nc/Mx` in the digest: Claude rounds / Codex rounds). A validated plan comes before a plan with no validation.
3. It unblocks other work (another plan, another team, the last item of a parent plan).
4. A small footprint (`files=` count).

A plan with `status: needs-validation`, or with zero validation rounds, needs `/skill-auto-validate-plan` **first**, not a background run. Say that clearly.

## Step 4 — Report

The report is **one lane table and short bullet lists**. Do not write a section for each plan, and do not copy the raw digest.

### TLDR

At most three sentences: how many plans, how many can run at the same time now, and what to start now.

### Running or waiting for review

Only for the plans in `IN FLIGHT / AWAITING REVIEW`: a small table of plan and state, and for each one, the lane it occupies. `DONE — NEEDS CLEANUP` gets one line, not a row. **Never list old reports of shipped runs** (`staleReports`) as work in progress. Leave out the section when there is nothing to show.

### The lane table

Give it the heading `## The N parallel lanes` and put this rule before it:

> A lane is a chain of file overlap. A plan waits until the plan it overlaps is done.

Do **not** write "plans in one lane cannot run together". A lane is a chain: two plans in one lane can be free of conflict with each other and only joined by a third plan.

Use this table shape:

```
| Lane | Plan | Status | Touches |
| --- | --- | --- | --- |
| **A — <short label>** | [<slug without date>](.plans/<file>.md) | ✅ ready, validated ×2 | `<area>/`, `<area>/` |
| | [<slug>](.plans/<file>.md) | ready, not validated | **5 files overlap** with <slug> |
| | [<slug>](.plans/<file>.md) | no status | `<area>/` — ✅ **runs alongside <slug>** |
| **B — <short label>** | [<slug>](.plans/<file>.md) | 2 validation rounds | `<area>/` — **zero overlap with A** |
```

Rules for the table:

- **Lane cell** — only on the first row of the lane, in bold, as `A — <short label>`. Use letters, not numbers. Put the lane of your Step 3 pick first. Make the label from the lane's main `areas`, in words a person knows.
- **Plan cell** — a relative Markdown link, with the date prefix removed from the link text.
- **Rows in a lane** — the readiest plan first, then the plans that it blocks.
- **Status cell** — plain words: `✅ ready, validated ×2`, `ready, not validated`, `no status, large`, `needs-validation`. Use ✅ only for a plan that is `ready` **and** has validation rounds. Take `×N` from the count in `.validations/`. Never guess it.
- **Touches cell** — area paths in backticks, cut to the part a person knows. Then, by row:
  - **blocked** — the overlap count in bold and the plan it overlaps: `**8 files overlap** with <slug>`. Take the count from `overlaps[].files` in `--json`. Always name the plan.
  - **free of conflict with an earlier row of its lane** — keep the areas and add `— ✅ **runs alongside <plan>**`.
  - **alone in its lane** — add `— **zero overlap with the other lanes**`.

### The bullet lists

After the table, in this order, each one a **bold lead-in with bullets**, no subheadings:

- **Cannot run in parallel with anything:** plans whose footprint touches every lane. One bullet each: the link, the area count, and `Run it alone.`
- **Not machine-runnable:** one bullet per manual runbook, with the one detail that makes it manual.
- **Roadmap only, nothing to implement:** one line, with the links separated by commas.
- **Friction to expect:** minor overlaps by file (name both plans and say which one merges second), soft overlaps by file, and plans in the batch that both add database migrations. Leave this out when there is none.

### The plan for now

Two or three sentences after the lists: the Step 3 choice and its evidence. If no candidate is validated, say so and send the owner to `/skill-auto-validate-plan`.

### Style

Short. Inline code for paths, areas and flags. Bold only for what changes a decision. No emoji other than the ✅ in the table.

## Step 5 — Give the commands

End with one fenced block that the owner can paste. Never run these commands yourself.

```
# launch the recommended batch (one worktree and one auto/<slug> branch each)
bash .claude/scripts/auto-pipeline.sh --stop-at-verify <plan-file> <plan-file> ...

# watch them
bash .claude/scripts/auto-pipeline.sh --status

# after a run is merged, free its lane
bash .claude/scripts/auto-pipeline.sh --cleanup <slug>
```

The plans dashboard shows the same runs and can launch the batch too. Suggest `--stop-at-verify` by default, so the owner reviews before anything is pushed. Suggest `--full` or `--to-pr` only when the owner asked for it.

## Guardrails

- Read-only. No `git add`, `git commit` or `git stash`, no plan edits, no launches.
- Never recommend more runs at the same time than `can launch in parallel now` says.
- Never put a plan with a live worktree into the batch.
- Never send a manual runbook through the pipeline.
