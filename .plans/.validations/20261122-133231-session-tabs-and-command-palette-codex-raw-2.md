## Plan validation (codex): 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Project rule] The plan defers the required dashboard restart until after merge, but the rule requires it after dashboard changes and only after checking that live chats run under the relay — `AGENTS.md:9`, `.plans/20261122-133231-session-tabs-and-command-palette.md:24` — the proposed run skips a required step. Specify the relay check and conditional restart during the implementation run; record any inability to satisfy the prerequisite as an open item.
- [Reference integration] Screenshot regeneration copies only `plans-dashboard.mjs` and `docs/` into its throwaway dashboard, while the server reads the page files from `scripts/plans-dashboard/` — `scripts/docs-media.mjs:45`, `scripts/plans-dashboard.mjs:1` — the planned command cannot serve the changed page from that copy. Add the page directory and any other required server imports to the copied fixture, and test or verify screenshot generation.
- [Edge case] The plan deliberately retains tabs for a missing project but hides them when `find()` fails; keyboard navigation and closing the selected tab still use the unfiltered list — `.plans/20261122-133231-session-tabs-and-command-palette.md:93`, `.plans/20261122-133231-session-tabs-and-command-palette.md:96`, `.plans/20261122-133231-session-tabs-and-command-palette.md:101` — a shortcut or close can select an invisible, unavailable tab and show an empty detail pane. Define navigation and close fallback over available tabs while retaining unavailable keys for later recovery, and test the behavior.

### Non-blocking concerns

- [Browser test] The fixture contains only three inactive plan files, but the test requires opening a run-strip row and an alert card — `.plans/20261122-133231-session-tabs-and-command-palette.md:141`, `scripts/plans-dashboard/app.js:3970` — add safe fixture state or a specific way to produce those rows.
- [Verification] The local design reference cannot be verified from the repository — `.plans/20261122-133231-session-tabs-and-command-palette.md:19` — provide an accessible, generic reference or record which design claims remain unverified.

### Edge cases the plan should address

- A saved tab’s project temporarily disappears, then returns: visible numbering and navigation must remain consistent, and the saved tab must recover.
- Closing an active tab when its nearest saved neighbor is unavailable: choose an available neighbor or return home.
- Reopening a previously closed tab that has already been opened again: do not create a duplicate or leave surprising entries in the closed-tab stack.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
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
1. Specify the relay check and conditional dashboard restart during the implementation run, and record any inability to satisfy the prerequisite as an open item. Do not defer the rule solely until after merge. (evidence: AGENTS.md:9; .plans/20261122-133231-session-tabs-and-command-palette.md:24)
2. Update the screenshot fixture to copy scripts/plans-dashboard/ and any other server imports needed by the throwaway dashboard, and verify screenshot generation against the changed page. (evidence: scripts/docs-media.mjs:45; scripts/plans-dashboard.mjs:1)
3. Define tab switching and close fallback over available tabs while retaining unavailable project keys for later recovery; add tests for the behavior. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:93; .plans/20261122-133231-session-tabs-and-command-palette.md:96; .plans/20261122-133231-session-tabs-and-command-palette.md:101)

SHOULD FIX:
1. Add safe fixture state or explicit setup for the run-strip row and alert card required by the browser test. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:141; scripts/plans-dashboard/app.js:3970)
2. Provide an accessible, generic design reference or identify the design claims that remain unverified. (evidence: .plans/20261122-133231-session-tabs-and-command-palette.md:19)

ADD THESE EDGE CASES:
- A saved tab’s project temporarily disappears and returns; visible numbering and navigation remain consistent, and the tab recovers.
- Closing an active tab whose nearest saved neighbor is unavailable selects an available neighbor or returns home.
- Reopening a closed tab that has already been opened again does not create a duplicate or leave surprising closed-tab entries.

Do not change anything the validation did not flag.
```