## Plan validation (codex): 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Project rule] The plan defers the dashboard restart until after merge, but the rule requires it after dashboard changes and only after `pgrep -fl chat-relay.mjs` shows that live chats run under the relay — `AGENTS.md:9`, `.plans/20261122-133231-session-tabs-and-command-palette.md:24` — The planned run does not satisfy the required restart condition. Revise the run procedure to satisfy the rule, or record the conflict for an owner decision.
- [State management] Closing a background tab is specified to call `openSession(next)` whenever a neighbour exists — `.plans/20261122-133231-session-tabs-and-command-palette.md:84`, `.plans/20261122-133231-session-tabs-and-command-palette.md:89` — Closing an inactive tab can unexpectedly switch the open plan. Only choose a neighbour when the closed tab was selected; otherwise preserve selection and redraw. Add coverage for both cases.
- [HTML and visibility] The plan nests a close button inside each tab button and gives `#stabs` `display:flex` while relying on `hidden` — `.plans/20261122-133231-session-tabs-and-command-palette.md:81`, `.plans/20261122-133231-session-tabs-and-command-palette.md:88`, `.plans/20261122-133231-session-tabs-and-command-palette.md:97` — Nested buttons are invalid interactive markup, and an author `display` rule can override the hidden state. Use separate, valid controls and an explicit `#stabs[hidden] { display:none }` rule; test closing and the empty strip.
- [Test harness] The browser test requires three plans and a board card, but the cited fixture creates one plan — `scripts/test/plans-dashboard.test.mjs:182`, `scripts/test/plans-dashboard.test.mjs:199`, `.plans/20261122-133231-session-tabs-and-command-palette.md:127` — The stated scenario cannot run against that fixture as described. Specify a separate, reproducible fixture with enough fake plans and the necessary board and alert state.
- [Test wiring] `paletteMatch(q, plans, actions)` is described as pure but must order open tabs without receiving them as an argument — `.plans/20261122-133231-session-tabs-and-command-palette.md:92`, `.plans/20261122-133231-session-tabs-and-command-palette.md:106` — Its specified isolated test cannot supply that state through the stated signature. Pass the open tab keys explicitly and define their ordering in the test.

### Non-blocking concerns

- [Reference] `matchesFields` and `matchesQ` span multiple lines, rather than being one-line helpers — `scripts/plans-dashboard/app.js:250`, `scripts/plans-dashboard/app.js:255` — Specify extraction of their complete declarations.
- [Coverage] `find()` also returns worktree items, while the palette is specified in terms of `plans` — `scripts/plans-dashboard/app.js:128`, `scripts/plans-dashboard/app.js:4047` — State whether worktrees belong in session tabs and palette results, and test the chosen behavior.
- [Verification] The visual proposal in the owner’s local QA store was not verified within this read-only review — `.plans/20261122-133231-session-tabs-and-command-palette.md:19` — Reading that proposal would establish whether the specified design matches it.
- [Verification] The changelog folder requires its validator to print `PASS` — `changelog.d/AGENTS.md:7` — Include that check in the run’s verification.

### Edge cases the plan should address

- A deleted or unavailable last-closed plan — reopening should define whether it skips stale entries and tries earlier ones.
- Duplicate or malformed saved tab keys — restoring browser storage should not produce duplicate controls or lose valid tabs.
- Switching sessions while the board is open — update board selection as well as the detail panel; the existing board opener redraws the board (`scripts/plans-dashboard/app.js:4120`).
- Keyboard use in the palette — define focus restoration, empty results, and how modal keyboard focus stays inside the dialog.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
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
1. Revise the dashboard restart procedure to meet the rule requiring a restart after dashboard changes, conditional on confirming that live chats run under the relay; if the worktree restriction prevents this, record the conflict for an owner decision. (evidence: AGENTS.md:9; .plans/20261122-133231-session-tabs-and-command-palette.md:24)
2. Preserve the current selection when closing an inactive tab; choose a neighbour only when closing the selected tab. Add tests for both cases. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:84; .plans/20261122-133231-session-tabs-and-command-palette.md:89)
3. Replace nested tab and close buttons with valid separate controls, and explicitly hide #stabs when it has the hidden attribute despite its flex display rule. Test closing and the empty strip. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:81; .plans/20261122-133231-session-tabs-and-command-palette.md:88; .plans/20261122-133231-session-tabs-and-command-palette.md:97)
4. Specify a reproducible browser fixture with at least three fake plans and the board and alert state needed by the scenarios. The cited test fixture creates only one plan. (evidence: scripts/test/plans-dashboard.test.mjs:182; scripts/test/plans-dashboard.test.mjs:199; .plans/20261122-133231-session-tabs-and-command-palette.md:127)
5. Pass open tab keys explicitly to the pure palette matching function and test the specified ordering using that input. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:92; .plans/20261122-133231-session-tabs-and-command-palette.md:106)

SHOULD FIX:
1. Extract complete helper declarations for the palette test; matchesFields and matchesQ span multiple lines. (evidence: scripts/plans-dashboard/app.js:250; scripts/plans-dashboard/app.js:255)
2. Decide and test whether worktree items appear in session tabs and palette results. (evidence: scripts/plans-dashboard/app.js:128; scripts/plans-dashboard/app.js:4047)
3. Verify the visual specification against the owner's local QA proposal when it is available. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:19)
4. Include the required changelog validator in verification. (evidence: changelog.d/AGENTS.md:7)

ADD THESE EDGE CASES:
- Reopening when the most recently closed plan no longer exists.
- Duplicate or malformed tab keys restored from browser storage.
- Switching sessions while the board is open, including board selection redraw. (evidence: scripts/plans-dashboard/app.js:4120)
- Palette focus restoration, empty results and keyboard focus containment.

Do not change anything the validation did not flag.
```