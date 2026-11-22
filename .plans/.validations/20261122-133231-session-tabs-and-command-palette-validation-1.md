**Validation round:** 1

## Plan validation: 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The plan is sound and almost every reference is correct. Two gaps would give broken work: `paletteMatch(q, plans, actions)` cannot sort "open tabs first" without a tabs argument, so the sliced-out test cannot run it, and `#stabs { display:flex }` overrides the `hidden` attribute, because this page has no global `[hidden]` rule. Both are one-line fixes.

### Blocking issues

- [Signatures / Tests] `paletteMatch(q, plans, actions)` must put "open tabs first" and, for an empty query, "the open tabs, then the actions" (plan Step 9, Tests bullet "paletteMatch"). The signature has no tabs input, so the function must read the global `sessionTabs`. The palette test cuts out only `// --- command palette ---` to `// --- end palette match ---` plus `squash` / `matchesFields` / `matchesQ` (plan Tests, Unit tests intro). `sessionTabs` is declared in the other block (Step 4), so the cut-out function throws a ReferenceError, or the test has to fake a global. It is also not a pure function, which goes against the Hard rule "the palette match are pure functions". Evidence: plan lines 92 and 106. Fix: change the signature to `paletteMatch(q, plans, actions, tabs)` and pass `sessionTabs` from `paletteDraw()`.
- [CSS / Wiring] Step 14 gives `#stabs` the rule `display:flex`, and Step 5 hides `#stabs` when the list is empty (the element starts with `hidden`, Step 2). An ID rule with `display:flex` overrides the browser's `[hidden] { display:none }`. `app.css` has no global `[hidden]` rule. The repo instead adds a rule per element: `app.css:600` `#chat[hidden], .csplit[hidden] { display:none; }`, `app.css:772` `section#detail[hidden], section#board[hidden] { display:none; }`, and `:669`, `:670`, `:768`. Without this rule an empty strip (a bordered, padded row) shows on every page with no tabs, and also at first load. The same risk applies to `#palette` if `.palette` gets a `display` value. Fix: add `#stabs[hidden], #palette[hidden] { display:none; }` to Step 14.

### Non-blocking concerns

- [Tests / Discrepancy] The Unit tests intro calls `const squash =`, `const matchesFields =` and `const matchesQ =` "one-line helpers". `matchesFields` spans `app.js:250-253` and `matchesQ` spans `app.js:255-256`. The test's `line()` helper (`plans-dashboard.test.mjs:278`) cuts one line only, so it gives a syntax error. Suggestion: cut from `const squash =` to `function visiblePlans(` (`app.js:249-256`, one block). Also say that the plan fixtures need `tags: []` (`matchesQ` spreads `...p.tags`) and a `slug` (the archived sort uses `slug.localeCompare`, `app.js:266`).
- [Breaking changes / Discrepancy] The section says that `grep -n "ctrlKey"` shows "only the Monaco zoom and the chat history check". The real hits are `app.js:1535` (chat history), `app.js:2317` (the Mermaid full-screen wheel zoom, not Monaco) and `app.js:3470` (Ctrl/⌘-click on the home link). The conclusion still holds, because no keydown handler uses Ctrl. Suggestion: correct the text.
- [Edge / Key conflicts] The global capture listener is registered at load. The Mermaid viewer's capture `onKey` (`app.js:2405-2424`) is registered later, when the viewer opens, so Ctrl+digit or Ctrl+W reach `switchSession` / `closeSession` while the full-screen viewer, the image viewer (`app.js:3460-3463`) or `#seldlg` (`showModal`, `app.js:3420`) is open. The tab changes behind the overlay. Suggestion: skip the tab keys while one of these overlays is open, as Step 12 already does for the guide and the tour.
- [Behavior] `openSession(key)` mirrors the sidebar click (`renderList(); renderDetail(true)`). On the board, `openFromBoard()` (`app.js:4120-4123`) also calls `renderBoard()`, and `renderDetail` does not call it. So a tab switch or a palette pick on the board leaves the old card highlighted. Suggestion: call `renderBoard()` in `openSession` when `boardOn` is true.
- [Edge] `closeSession(key = selected)` with no plan open (`selected === null`, for example Ctrl+W on the home screen) pushes `null` to `closedTabs`. Suggestion: return early when `key` is not in `sessionTabs`. Also state what `tabsClose` returns as `next` for a key that is not in the list. The tests cover "keeps the list" but not `next`.
- [Tests] `nextSession(d)` (wrap-around) is in `window.dashboard`, but it is not a pure function and has no test. Suggestion: add a pure `tabStep(tabs, key, d)` to the session-tabs block, with a test for wrap at both ends.
- [Docs] Off macOS, Chrome and Firefox reserve Ctrl+1–8, Ctrl+W and Ctrl+Shift+T for their own tabs, and a page cannot intercept them. The owner chose Ctrl, which is fine on macOS. Step 16 should say that the tab keys work on macOS and that elsewhere the palette and the strip are the way to switch tabs. Also say how the page tells macOS from other systems for ⌘K versus Ctrl+K (for example `navigator.platform` / `userAgentData`).
- [Docs] `docs/plans-dashboard.md:10` says that the screenshots must be made again after a UI change (`node scripts/docs-media.mjs`). The strip changes the screen and the plan does not mention this. Suggestion: add the step, or say why it is skipped.
- [Owner decisions] Step 1 writes "Open decisions: none" in `docs/PLAN.md`. The plan's own Context (line 20) leaves the ⌘N sheet (plan 3) and the native work (plan 2) open. Suggestion: list those as open decisions instead of "none".
- [Verify] "How to verify" has no changelog check. `changelog.d/AGENTS.md:7` requires `node .claude/scripts/changelog-validate.mjs --base origin/main` to print `PASS`. Suggestion: add it.
- [Edge] `saveTabs()` runs on every `renderDetail()` call, which includes each repaint of a poll. That works, but Step 7 could save only when `tabsOpen` changed the list.

### Edge cases the plan should address

- Two browser windows on the dashboard share `dash-tabs`. Each window overwrites the other's list on its next save. Say that the last writer wins, or listen to `storage` as the alert cards do (`app.js:3945`).
- The tab list has no cap. Every plan you open becomes a tab, and Back/Forward (`popstate`, `app.js:603`) adds tabs again. Say if a cap (for example 20) applies, or that `overflow-x:auto` is the only limit.
- `tabsPrune` drops a tab when the plan leaves `/api/state`. A short glitch (a project briefly missing from the registry) removes its tabs for good. That is acceptable, but say so.
- On macOS, Ctrl+1–9 can be taken by Mission Control ("Switch to Desktop N"), so they never reach the page. Say this in the docs.
- ⌘K inside Monaco is a chord prefix in Monaco. The capture listener takes it first. Say that this is intended.
- The palette's z-index must be above `#onb`, the toasts and `#tourpop` (`app.css:754`, `z-index:32`). Otherwise it opens behind the alert cards.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (except the "one-line helpers" and the ctrlKey grep text)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code (declared, exported, imported, registered) — the `[hidden]` CSS rule is missing
- [x] Scope stays inside the goal; no open decision is taken silently (but "Open decisions: none" should list plans 2 and 3)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected — `paletteMatch` cannot be tested as written; `nextSession` has no test
- [x] Docs: current state only respected
- [x] Contracts respected (none)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261122-133231-session-tabs-and-command-palette.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Give paletteMatch the open tabs as an argument: paletteMatch(q, plans, actions, tabs), called with sessionTabs from paletteDraw(), so the cut-out test can run it without the session-tabs block (evidence: plan Step 9 and Tests intro; sessionTabs is declared in Step 4's block).
2. In Step 14 add "#stabs[hidden], #palette[hidden] { display:none; }": "#stabs { display:flex }" overrides the hidden attribute, and app.css has no global [hidden] rule (evidence: scripts/plans-dashboard/app.css:600, :772 use per-element [hidden] rules).

SHOULD FIX:
1. In Tests, cut the match helpers as one block from "const squash =" to "function visiblePlans(", not as one-line helpers; say that the fixtures need tags: [] and a slug (evidence: scripts/plans-dashboard/app.js:249-256, :266; scripts/test/plans-dashboard.test.mjs:278).
2. Correct the ctrlKey claim in Breaking changes: the hits are app.js:1535 (chat history), :2317 (Mermaid wheel zoom) and :3470 (home link click) (evidence: scripts/plans-dashboard/app.js:1535, 2317, 3470).
3. In Step 12, skip the tab keys while the Mermaid full-screen viewer, the image viewer or #seldlg is open (evidence: scripts/plans-dashboard/app.js:2405-2424, 3460-3463, 3420).
4. In Step 6, call renderBoard() in openSession when boardOn is true, as openFromBoard does (evidence: scripts/plans-dashboard/app.js:4120-4123).
5. In Step 6, make closeSession return early when the key is not in sessionTabs (for example selected === null); in Step 3, say what tabsClose returns as next for a missing key.
6. Add a pure tabStep(tabs, key, d) for nextSession's wrap-around to the session-tabs block, and test it.
7. In Step 16, say that the Ctrl tab keys work on macOS (other systems' browsers reserve Ctrl+1–8, Ctrl+W, Ctrl+Shift+T), and name how the page detects macOS for ⌘K versus Ctrl+K.
8. Add a step to make the screenshots again with node scripts/docs-media.mjs, or say why it is skipped (evidence: docs/plans-dashboard.md:10).
9. In Step 1, list the ⌘N sheet (plan 3) and the native work (plan 2) under Open decisions instead of "none" (evidence: plan Context line 20).
10. Add "node .claude/scripts/changelog-validate.mjs --base origin/main" to How to verify (evidence: changelog.d/AGENTS.md:7).

ADD THESE EDGE CASES:
- Two browser windows share dash-tabs: the last writer wins, or sync through the storage event (as app.js:3945 does).
- No cap on the number of tabs; Back/Forward re-adds closed tabs.
- tabsPrune drops tabs for good when a project is briefly missing from /api/state.
- macOS Mission Control can take Ctrl+1–9.
- ⌘K inside Monaco: the capture listener wins.
- The palette z-index must be above #onb, the toasts and #tourpop (app.css:754).

Do not change anything the validation did not flag.
```
