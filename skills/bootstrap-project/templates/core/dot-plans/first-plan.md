# Plan: Check the pipeline end to end

- **Base**: @@BASE_BRANCH@@

## Goal

Run the full workflow once on a very small, real change, before the first feature plan. The run proves that the plans dashboard, `auto-pipeline.sh`, the skills, the allow list and the draft PR all work together. The change itself adds a **Development** section to `README.md`.

## Context

- Set up with `/bootstrap-project` on @@TODAY@@. The scaffolding is in `.claude/`, `.plans/`, `AGENTS.md` and `README.md`.
- Decisions taken for this plan: none.
- Pattern followed: the existing `README.md` sections.

## Affected files

- `README.md` — modified: add a **Development** section.

## Breaking changes

None.

## Steps

1. In `README.md`, after the section **How to run it**, add a section `## Development` with two bullets: "Plans live in `.plans/`; see `AGENTS.md`, section **Plans**." and "Run reports live in `.plans/auto-runs/` (local only)."

## Tests

None. The change is documentation only.

## How to verify

```bash
grep -n "^## Development" README.md
grep -n "auto-runs" README.md
```
