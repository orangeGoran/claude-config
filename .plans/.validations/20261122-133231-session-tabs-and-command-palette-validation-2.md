**Validation round:** 2

## Plan validation: 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues
- [Edge cases / wrong behavior] The strip draws only the tabs that `find(key)` returns (step 5), but the keys and the close logic use the full `sessionTabs` list (`tabAt(sessionTabs, n)` in step 6 `switchSession`, `tabStep(sessionTabs, …)` in `nextSession`, `tabsClose(sessionTabs, …).next` in `closeSession`). Step 8 keeps keys on purpose when their project is not in the state (`!state.some((s) => k.startsWith(s.name + '/'))`), and `tabsLoad` restores keys before the first `/api/state` answer, so hidden keys can stay in the list for a long time (for example, a project removed from the registry). Example: `sessionTabs = ['old/x', 'demo/a', 'demo/b']`, where project `old` is gone. The strip shows `demo/a` as ⌃1 and `demo/b` as ⌃2. Ctrl+1 opens `old/x`: `renderDetail()` finds no item and shows the empty pane (`scripts/plans-dashboard/app.js:607-608`). Closing `demo/a` when `old/x` is to its left and `demo/b` is closed already gives `next = 'old/x'`, which again shows the empty pane instead of going home. — evidence: `scripts/plans-dashboard/app.js:128` (`find` reads `plans` and `wts` only), `app.js:604-608`, plan steps 5, 6, 8 — the key hints and the keys point at different tabs; ⌘1–9 in the Mac app inherits the defect. — fix: compute one list of shown keys (`const shownTabs = () => sessionTabs.filter((k) => find(k))`) and use it in `drawSessionTabs()` (hints), `switchSession()`, `nextSession()` and the `next` of `closeSession()`; add a browser-test or unit check with one stale key in front.

### Non-blocking concerns
- [Discrepancies] Step 2 says "right after `</header>`", but `page.html` has two: `header.mainhd` ends on line 18 and the log pane header ends on line 46. — evidence: `scripts/plans-dashboard/page.html:18`, `:46` — say "after the `</header>` of `header.mainhd` (line 18), before `<div class="wrap">`" (Affected files already says so).
- [Edge cases] `.palette` gets `z-index:40`, the same as `#toasts` (`app.css:729`), and step 2 puts `#palette` before `#toasts` in the DOM, so a toast paints over the palette when they overlap. — evidence: `scripts/plans-dashboard/app.css:729`, plan step 14 — use `z-index:41`, or put `#palette` after `#toasts`.
- [Reference implementation] `chatMenu()` calls `e.preventDefault()` in the row mousedown so the input keeps its focus (`app.js:1503`). Step 11 mirrors the mousedown but does not say this. — suggestion: say "mousedown with `preventDefault()`, as `chatMenu()` does".
- [Edge cases] Step 11 does not give the order of "run the row" and `closeSearch()`. When the focus comes back after the action (for example, `openSettings()` or `openGuide(1)` focuses its own element), the restore takes the focus away from the new dialog. — suggestion: close first (with focus restore), then run the action, or skip the restore when the action moved the focus.
- [Edge cases] Step 12 gives "Ctrl (without ⌘, Alt or Shift)" only for the digits. Ctrl+W and Ctrl+Shift+T do not say "without ⌘", and the plan does not say if the tab keys work while the focus is in a text box (the chat input, `#q`, the tag box). — suggestion: write the exact modifier check for each key, and state that the tab keys work in text boxes too (or not).
- [Edge cases] Worktree tabs: step 5 uses `dotClass(p)` for every tab, but the sidebar draws a worktree dot from `w.agent === 'working' ? 'live' : ''` (`app.js:357`), not from `dotClass` (`app.js:216`). A worktree tab never shows the working dot. Also `paletteMatch` gets `plans` only, so an empty query does not list open worktree tabs. — suggestion: use the same dot rule as the sidebar for `p.kind === 'wt'`, and say that the palette does not list worktree tabs.
- [Tests] The step 8 rule "keep a tab when its project is not in the state" is an inline lambda in `refreshOnce()`, so no unit test covers it; `tabsPrune` is tested only with a given `exists`. — suggestion: make the predicate a pure function in the session-tabs block (for example `tabKept(key, has, projects)`) and test both cases.
- [Tests] The `paletteMatch` test checks a match by `#<PR number>`, but the fixture field list (`key`, `file`, `title`, `project`, `client`, `slug`, `tags`, `archived`) has no `pr`. `matchesQ` reads `p.pr.number` (`app.js:255-256`). — suggestion: add `pr: { number, title }` to one fixture.
- [Edge cases] `reopenSession()` can pop a key that is already open again (closed, then reopened from the sidebar). Then Ctrl+Shift+T only switches to it. — suggestion: skip keys that are in `sessionTabs`, as stale keys are skipped.
- [Scope] Step 1 fills `docs/PLAN.md` (Goals, Architecture, Phases, Open decisions) in the run of this child plan. `docs/PLAN.md:5` says to fill it "before the first feature plan", and the validators read it. — suggestion: fill `docs/PLAN.md` in the same commit that pushes this plan to `main`, or keep step 1 and say why.
- [Docs] The key hints `⌃1`–`⌃9` show on Windows and Linux too, where the plan says the browser keeps those keys. — suggestion: show the hints only when `IS_MAC`, or state this in the known limits.
- [Steps] Step 9 does not say where the palette block goes. Step 12 does not say where the global keydown listener goes. Every first call is after line 4079 (`app.js:4475-4478`), so no TDZ problem exists for any place, but the plan should name one place (for example, right after the session-tabs block).

### Edge cases the plan should address
- A saved tab key whose project is gone, or a key restored before the first `/api/state` answer — the key hints and Ctrl+digit must use the same list (blocking item).
- Two keydown handlers for Escape in the palette (the capture handler in step 12 and `paletteKey()` in step 11) — only one runs, because the capture handler calls `stopPropagation()`; say which one owns Escape.
- A state repaint while the palette is open — `refreshOnce()` runs `renderDetail(false)` because the `typing` check looks only inside `#detail` (`app.js:4056-4060`); confirm that it does not take the focus from `#palq`.
- The tour opens the first plan (`app.js:3773`), so it adds a tab — fine, but say so in the docs.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (one ambiguous `</header>`)
- [x] Reference implementation mirrored, deviations justified (mousedown `preventDefault()` not stated)
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (the step 8 keep rule has no test)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261122-133231-session-tabs-and-command-palette.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Use one list of shown tabs (the keys that find() returns) for the key hints in drawSessionTabs(), for tabAt() in switchSession(), for tabStep() in nextSession(), and for the next tab in closeSession(). Today the strip hides keys that find() does not return, but the keys use the full sessionTabs list, so Ctrl+1 can open a hidden stale key and show an empty pane. Add a test with one stale key in front of the list. (evidence: scripts/plans-dashboard/app.js:128, app.js:604-608; plan steps 5, 6, 8)

SHOULD FIX:
1. In step 2, name the </header> of header.mainhd (page.html line 18); the log pane has a second </header> on line 46. (evidence: scripts/plans-dashboard/page.html:18, :46)
2. Give .palette z-index:41, or put #palette after #toasts; #toasts also has z-index:40 and comes later in the DOM. (evidence: scripts/plans-dashboard/app.css:729)
3. In step 11, say that the row mousedown calls preventDefault(), as chatMenu() does. (evidence: scripts/plans-dashboard/app.js:1503)
4. In step 11, give the order: close the palette (and restore the focus), then run the action, so an action that focuses its own dialog keeps the focus.
5. In step 12, write the exact modifier check for Ctrl+W and Ctrl+Shift+T (no ⌘, no Alt), and say if the tab keys work while the focus is in a text box.
6. For a worktree tab, use the sidebar's dot rule (w.agent === 'working' ? 'live' : ''), not dotClass(); say that the palette does not list worktree tabs. (evidence: scripts/plans-dashboard/app.js:357, app.js:216)
7. Move the step 8 keep rule into a pure function in the session-tabs block and unit-test both cases (project in the state, project missing).
8. Add pr: { number, title } to one paletteMatch fixture, so the #<PR number> case can pass. (evidence: scripts/plans-dashboard/app.js:255-256)
9. In reopenSession(), skip keys that are already in sessionTabs.
10. Fill docs/PLAN.md before the run (with the plan commit), or say in step 1 why the run fills it. (evidence: docs/PLAN.md:5)
11. Show the ⌃1–⌃9 hints only on macOS, or list this under the known limits.
12. Name the place of the palette block and of the global keydown listener (for example, right after the session-tabs block).

ADD THESE EDGE CASES:
- A saved tab whose project is gone, or tabs restored before the first /api/state answer.
- Escape in the open palette: say which handler owns it (the capture handler stops the event, so paletteKey() never sees it).
- A state repaint while the palette is open must not take the focus from #palq (the typing check looks only inside #detail, app.js:4056-4060).
- The tour opens the first plan (app.js:3773) and so adds a tab.

Do not change anything the validation did not flag.
```
