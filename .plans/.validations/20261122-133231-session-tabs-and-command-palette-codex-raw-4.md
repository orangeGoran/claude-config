## Plan validation (codex): 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Test harness] Importing `copyDashboard` still runs the top-level Chrome and WebSocket checks, which can call `process.exit(1)` before the test reaches the export. The planned main-module guard covers only the code at the end of the file — [scripts/docs-media.mjs:27](/Users/gorantubic/Workspace/claude-config/scripts/docs-media.mjs:27), [plan:113](/Users/gorantubic/Workspace/claude-config/.plans/20261122-133231-session-tabs-and-command-palette.md:113) — `npm test` can terminate on supported Node versions or machines without Chrome. Move those checks, and other run-only side effects, behind the main-module guard.
- [Project rule] The restart instruction says to run `npm run restart` after `pgrep` without the required condition — [plan:24](/Users/gorantubic/Workspace/claude-config/.plans/20261122-133231-session-tabs-and-command-palette.md:24), [AGENTS.md:9](/Users/gorantubic/Workspace/claude-config/AGENTS.md:9) — the rule permits restart only when the check shows live chats run under the relay. Add that condition to the Open item.
- [Verification] The browser test expects a second Escape to close the plan after palette Escape restores focus, but the existing handler deliberately keeps the plan open when focus is in an input, textarea, select, or editable element — [plan:148](/Users/gorantubic/Workspace/claude-config/.plans/20261122-133231-session-tabs-and-command-palette.md:148), [scripts/plans-dashboard/app.js:3444](/Users/gorantubic/Workspace/claude-config/scripts/plans-dashboard/app.js:3444) — the prescribed test can fail after restoring focus to a search or chat input. Specify a non-input focus target for that assertion and separately check that input focus preserves existing Escape behavior.

### Non-blocking concerns

- [Specification] `paletteMatch` is described both as returning at most 50 rows and as limiting only plan rows while always including actions — [plan:104](/Users/gorantubic/Workspace/claude-config/.plans/20261122-133231-session-tabs-and-command-palette.md:104). State the latter consistently.
- [Verification] The design reference in the owner’s local QA store was not verified within this read-only review. Access to that reference would be needed to compare the proposed visual behavior.

### Edge cases the plan should address

- Import `docs-media.mjs` on Node 18 and on a machine without Chrome — the exported copy helper must remain usable without its screenshot prerequisites.
- Open the palette from an input, dismiss it, and press Escape again — focus restoration must preserve the existing input behavior.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261122-133231-session-tabs-and-command-palette.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Put the Chrome and WebSocket prerequisite checks and other run-only side effects of scripts/docs-media.mjs behind the main-module guard, so importing copyDashboard cannot terminate the test process on Node 18 or a machine without Chrome. (evidence: scripts/docs-media.mjs:27; .plans/20261122-133231-session-tabs-and-command-palette.md:113)
2. Make the restart Open item say to run npm run restart only when pgrep -fl chat-relay.mjs shows that live chats run under the relay. (evidence: AGENTS.md:9; .plans/20261122-133231-session-tabs-and-command-palette.md:24)
3. Give the browser test a non-input focus target before asserting that a second Escape closes the plan, and separately verify that restoring focus to an input preserves the existing Escape behavior. (evidence: scripts/plans-dashboard/app.js:3444; .plans/20261122-133231-session-tabs-and-command-palette.md:148)

SHOULD FIX:
1. State consistently that the 50-row cap applies to plan rows, while matching actions are always included. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:104)

ADD THESE EDGE CASES:
- Import docs-media.mjs on Node 18 and without Chrome installed.
- Dismiss the palette after opening it from an input, then press Escape again.

Do not change anything the validation did not flag.
```