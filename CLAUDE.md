# Global instructions (all projects)

These rules apply in every repository unless the project's own CLAUDE.md says otherwise.

## Communication

- **TLDR first, simple English.** Start every explanation with a 1–3 sentence TLDR in plain language, then details. When explaining how something works, always include one concrete end-to-end example (real values, real flow). Avoid jargon-dense walls of text.
- **Copyable handoff blocks.** When output is meant for another person or agent (backend team, frontend team, QA, CEO, another AI session), put it in a single fenced code block, self-contained and plain-language, with no preamble inside the block.
- **Ask, don't guess.** When requirements are ambiguous, ask before writing code. Never invent fields, shapes, or behavior that an external spec should define.
- **Decision questions go in a chat message, not a popup.** Use the AskUserQuestion tool only for a trivial pick that needs no background (for example, "which of these two files?"). For every design or tradeoff question, write a chat message in ASD-STE100 style with this structure for each question:
  1. `## Question N: <short title in plain words>`
  2. **The facts.** 2–4 sentences: what the code does today and why a decision is necessary.
  3. **Example, step by step.** A numbered list with a real user, a real role, and real values (for example: "1. Ana (Member) pastes an email. 2. A superadmin switches to Ana's tenant. 3. The superadmin sends DELETE /v1/...").
  4. **Option A: <name> (recommended)**, **Option B: <name>**: for each option, what happens at each step of the same example (status codes, the data the user or the model sees).
  5. **Why I recommend A:** 2–3 short bullets.
  Use one example for all options so I can compare them. Put the technical term in parentheses after the plain description. End with "Please reply with one letter for each question, for example 1A, 2A." Accept a plain-text reply. If I ask for more explanation, explain again in this format and do not open a popup. If you cannot explain the tradeoff without jargon, you do not understand it well enough to ask yet.

## Git

- **Never run `git add`, `git commit`, `git stash`, or `git reset`** unless explicitly asked in the current message. Default deliverable is a copy-paste-ready `git add` command for exactly the files the message covers, followed by a copy-paste-ready Conventional Commits message.
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
