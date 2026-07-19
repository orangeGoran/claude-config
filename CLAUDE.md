# Global instructions (all projects)

These rules apply in every repository unless the project's own CLAUDE.md says otherwise.

## Communication

- **TLDR first, simple English.** Start every explanation with a 1–3 sentence TLDR in plain language, then details. When explaining how something works, always include one concrete end-to-end example (real values, real flow). Avoid jargon-dense walls of text.
- **Copyable handoff blocks.** When output is meant for another person or agent (backend team, frontend team, QA, CEO, another AI session), put it in a single fenced code block, self-contained and plain-language, with no preamble inside the block.
- **Ask, don't guess.** When requirements are ambiguous, ask clarifying questions using the AskUserQuestion tool with a recommended option — before writing code. Never invent fields, shapes, or behavior that an external spec should define.

## Git

- **Never run `git add`, `git commit`, `git stash`, or `git reset`** unless explicitly asked in the current message. Default deliverable is a copy-paste-ready Conventional Commits message.
- No AI attribution in commit messages or PR bodies (no "Generated with Claude Code", no Co-Authored-By lines).

## Code

- **Never hardcode values that exist in a contract.** If an enum, OpenAPI-generated type, config, or API response provides the value, import and use it. No string literals for enum values, no duplicated types, no hardcoded data the backend provides.
- **Consistency sweep after every fix.** After fixing a bug in one place, search sibling implementations for the same defect (other steps, other methods — e.g. 8D/FS/PDCA — other dialogs/pages/components) and either fix them or report them before declaring done.
- **Follow existing patterns.** Before designing something new, check how the same problem is solved elsewhere in the codebase and match it. If diverging, say why.
- Scoped verification during development: run only tests related to the change; full suite only at final verification.

## Verification before claims

- **Verify against source before asserting.** Before claiming code is missing, unimplemented, unchanged, or behaves a certain way, check the actual source and generated types (Read/Grep) and cite the file:line verified against. Never assert absence of a handler/field without checking parent components, callers, and type definitions.
- **No security reasoning from assumptions.** Never give a security or authorization justification without first reading the relevant guard/middleware/auth code and quoting it.

## Documentation hygiene

- Keep READMEs and CLAUDE.md files lean: current state only, no change history, no session logs.
- Don't add sections "for completeness" — only what a new developer actually needs.

## Frontend debugging

- For "still not fixed" visual issues (favicons, colors, assets), check browser/CDN caching as a hypothesis before rewriting code.
