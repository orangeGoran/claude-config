## Plan validation (codex): 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Project rule] The plan defers the required dashboard restart until after merge. The rule requires a restart after dashboard changes, after confirming that live chats run under the relay — `AGENTS.md:9`, plan line 24 — Deferral leaves the required implementation-run step undone. Specify how the run will satisfy the rule, including what happens if the relay check does not establish that it is safe to restart.
- [Tests] The planned `scripts/docs-media.mjs` logic change has no test in `scripts/test/`; running the media generator is not the required script-logic test — `AGENTS.md:14`, plan lines 29 and 113 — Add a test for the copied dashboard’s required files and include it in `npm test`.
- [Security] The tab markup inserts `<key>` into `data-go-tab` and `data-close-tab` without specifying attribute escaping — plan line 96; existing worktree and board markup uses `escA()` for keys at `scripts/plans-dashboard/app.js:351` and `scripts/plans-dashboard/app.js:4135` — A key containing a quote can break the attribute and inject markup. Require `escA(key)` for both attributes and equivalent escaping for palette data.
- [Verification] The browser scenario expects Ctrl+1 to open alpha after reopening it, but reopening appends alpha after gamma: the earlier steps leave `[gamma]`, then `tabsOpen` adds alpha at the end — plan lines 87, 100 and 148 — The expected result conflicts with the specified tab order. Correct the scenario and assert the resulting order.

### Non-blocking concerns

- [Reference] The plan says the sidebar search does not search worktree items, but `visibleWorktrees()` searches their name, branch, title, project and PR — `scripts/plans-dashboard/app.js:343`; plan line 105 — Correct the rationale for excluding worktrees from palette search.
- [Verification] The referenced local design proposal could not be verified under the skill’s read-only repository review limits. A review of that proposal would establish whether the planned behavior matches it — plan line 19.
- [Accessibility] The palette is marked as a modal dialog, but the plan does not specify an accessible name for its search input or an active-option relationship for keyboard navigation — plan lines 85 and 107 — Add an input label and specify how the selected result is exposed to assistive technology.

### Edge cases the plan should address

- More than 50 open plan tabs with an empty palette query — the row limit can leave actions inaccessible unless their placement or reservation is specified.
- A project that remains in `/api/state` but temporarily returns incomplete plan or worktree data — pruning can permanently remove its saved tabs.
- A palette action or tab switch while settings contain unsaved edits — confirm that the existing unsaved-change guard still applies.

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
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261122-133231-session-tabs-and-command-palette.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Specify how the implementation run satisfies the required dashboard restart after the page changes, including the relay check and the behavior if it cannot establish that restarting is safe. Do not defer the required step solely to after merge. (evidence: AGENTS.md:9; plan line 24)
2. Add a test in scripts/test/ for the scripts/docs-media.mjs copy change and include it in npm test. Running the media generator alone does not meet the script-logic test rule. (evidence: AGENTS.md:14; plan lines 29 and 113)
3. Require attribute escaping with escA(key) for both session-tab data attributes, and equivalent escaping for palette data. (evidence: plan line 96; scripts/plans-dashboard/app.js:351 and scripts/plans-dashboard/app.js:4135)
4. Correct the browser scenario and expected tab order after reopening alpha: the specified append behavior leaves gamma first and alpha second. (evidence: plan lines 87, 100 and 148)

SHOULD FIX:
1. Correct the claim that sidebar search does not search worktree items, and state the actual reason for excluding them from palette search. (evidence: scripts/plans-dashboard/app.js:343; plan line 105)
2. Review the local design proposal when available and record any relevant differences; it was not verified in the repository-only review. (evidence: plan line 19)
3. Give the palette input an accessible name and specify how keyboard selection is exposed to assistive technology. (evidence: plan lines 85 and 107)

ADD THESE EDGE CASES:
- More than 50 open plan tabs with an empty palette query, including access to actions.
- A project present in state with temporarily incomplete plan or worktree data.
- A palette action or tab switch while settings contain unsaved edits.

Do not change anything the validation did not flag.
```