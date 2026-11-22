**Validation round:** 3

## Plan validation: 20261122-133231-session-tabs-and-command-palette.md

**Verdict:** APPROVE WITH CHANGES

The round-2 edits mostly agree with each other across the plan. The strip, the hints, `switchSession`, `nextSession` and the close fallback all use `shownTabs()`. `closedPush` and `reopenSession` match each other and their tests. `IS_MAC` is defined in step 4 and used in steps 5 and 12. `tabsPrune` has the same signature in step 3, step 8 and the test. The `docs-media.mjs` fix appears in Hard rules, Affected files and step 17. Every symbol, line and existing behaviour that the plan names is in the code. No blocking issue remains. Four of the round-2 edits were not carried through everywhere; they are listed below.

### Blocking issues
None.

### Non-blocking concerns
- [Consistency, round-2 edit #16] Step 5 shows key hints only on macOS (`IS_MAC`), because off macOS the browser keeps Ctrl+1–8, Ctrl+W and Ctrl+Shift+T. Step 10 says "Each row shows its key hint where one exists" and has no `IS_MAC` condition. So on Windows or Linux the palette rows "Close tab" and "Reopen closed tab" would show Ctrl+W and Ctrl+Shift+T, which do not work there (Breaking changes, known limits, plan line 80). — Suggestion: in step 10, show a tab-key hint only when `IS_MAC`, and show the palette key as ⌘K or Ctrl+K from `IS_MAC`.
- [Consistency, round-2 edit #12] The Contracts section lists the fields as "existing fields only (`key`, `file`, `project`, `live`, `chatWaits`, `run`, `launch`, `archived`, `pr`)". Step 5 also reads `p.agent` and `p.kind` (the worktree dot, `app.js:351`, `app.js:4049`). Step 9 also reads `slug`, `title`, `client` and `tags` (through `matchesQ`, `app.js:255`, and the archived sort, `app.js:266`). — Suggestion: add these fields to the Contracts list. Add `matchesFields`, `esc` and `hasChat` to the helper list.
- [Browser test] Step 10 says "Open an image or a Mermaid diagram full screen". The fixture plans have only "`# Plan: <name>` and one line" and no chat (plan line 147). The image viewer opens only for `.amsg .cimg img` / `#cimgs .cimg img` (`app.js:3453`), and the Mermaid viewer opens only for a ```` ```mermaid ```` block (`app.js:153`, `app.js:2431`). The step cannot run as written. — Suggestion: put a small Mermaid block in `gamma.md`. Or test the overlay rule with the onboarding guide (`openGuide(0)`, `#onb.open`).
- [Browser test] The Routes line names `/?sel=demo/demo-plan&tab=files`. `demo/demo-plan` is the unit-test fixture (`scripts/test/plans-dashboard.test.mjs:199-201`), not the browser fixture (alpha, beta and gamma in a fake repo). That fixture has no PR, so `tab=files` falls back to the plan (`app.js:615`) and review mode never shows. — Suggestion: name the browser fixture's real key in the route. Say that the review-mode check is the CSS-rule fallback from step 11.
- [Commands] The "How to verify" step `node --check scripts/plans-dashboard/app.js` and the step 17 command `node scripts/docs-media.mjs` are not in the AGENTS.md Commands table (`AGENTS.md:79-90`). They are also not in `.claude/settings.json` `permissions.allow` (lines 4-33). AGENTS.md:92 says "never invent one". With `"type": "module"` (`package.json:4`), `node --check` parses `app.js` as an ES module, but the browser loads it as a classic script. I did not run it, so I did not verify that it passes today. — Suggestion: drop `node --check`, because the served-page tests already parse the cut-out blocks. Or add it to the table and the allow list in this change. Say in step 17 that `docs-media.mjs` can fail because of permissions, as well as because Chrome or Node 22 is missing.
- [Escape ownership] Step 12 says the global capture handler closes the palette on Escape and calls `stopPropagation()`. Step 11 says that `paletteKey(e)` also handles Escape. A capture listener on `document` runs first and stops the event, so the Escape branch of `paletteKey` on `#palq` never runs. — Suggestion: name one owner. The global handler calls `closeSearch(true)`, and `paletteKey` handles only the arrows, Enter and Tab.
- [Placement] Steps 3 and 9 say "before `let boardOn = false;`". The Board comment block sits above that line (`app.js:4075-4078`), so a literal insert splits the comment from its code. — Suggestion: say "before the `// --- Board:` comment".
- [docs-media filter] `filter: (src) => !src.includes(path.join('scripts', 'test'))` drops any path that contains the substring `scripts/test`. This includes a future `scripts/test-*.mjs` and a repo path that contains that text. — Suggestion: compare against the exact folder `path.join(REPO, 'scripts', 'test')` (equal to it, or starts with it plus `path.sep`).
- [Behaviour] `openSession(key)` re-renders with `renderDetail(true)` even when `key === selected`. Ctrl+1 on the open tab then reloads the plan for nothing. `openFromBoard()` returns early in this case (`app.js:4121`). — Suggestion: return early when `key === selected`, except that `drawSessionTabs()` still runs.

### Edge cases the plan should address
- Esc closes the open plan (`goHome()`, `app.js:3449`), but its tab stays in the strip with no mark. The docs section should say this, so the user knows that Esc is not "close tab".
- The empty-query palette lists only plan tabs. Worktree tabs are absent because `plans` holds no worktree items. Say this in the docs next to the "worktree tabs are reached from the strip" note.
- `renderDetail()` now calls `saveTabs()` on every repaint (each state change on the 5-second poll). This is harmless, but it writes `localStorage` while the list has not changed. Writing only when `tabsOpen` returns a new list avoids that.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (`renderDetail` `app.js:604-608`, `renderEmptyDetail` `app.js:3498`, `refreshOnce` repaint branch `app.js:4058-4062`, `let boardOn` `app.js:4079`, `openFromBoard` `app.js:4120`, `chatMenu`/`chatKey` `app.js:1478-1535`, `squash`…`visiblePlans` `app.js:249-257`, the 3 `ctrlKey` uses `app.js:1535,2317,3470`, two `</header>` in `page.html:18,46`, `#toasts` z-index 40 and `#tourpop` 32 `app.css:729,754`, no global `[hidden]` rule, `body.review > header` `app.css:515`, `newHome()` `docs-media.mjs:43-53`, `UI_DIR`/imports/`CHAT_RELAY` `plans-dashboard.mjs:36-37,1834,2936`, `__SCRIPT__` plist template line 29)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (search: no existing `window.dashboard`, `stabs`, `palette`, `.pali`, `IS_MAC`, `dash-tabs` in `scripts/`)
- [x] Wiring & registration matches the code (app.js inlined via `<!--@JS-->`, `plans-dashboard.mjs:2939-2943`)
- [x] Scope stays inside the goal; no open decision is taken silently (filling `docs/PLAN.md` is justified in Context; the `docs-media.mjs` fix is needed for the screenshot rule, `docs/plans-dashboard.md:10`)
- [x] Restart after dashboard changes respected (deferred to after merge with a reason; the service runs the main checkout's script)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected (pure functions cut from the served page, as the `mdLive` test does, `plans-dashboard.test.mjs:276-297`)
- [x] Docs: current state only respected
- [x] Contracts respected (no contract source; the field list is incomplete, see above)
- [ ] "How to verify" commands are real and can fail (`node --check` is not in the Commands table or the allow list)

Commands that touched a service or the database: none.

```
Update the plan at .plans/20261122-133231-session-tabs-and-command-palette.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 10, show the tab-key hints (Ctrl+W, Ctrl+Shift+T) on palette rows only when IS_MAC, as step 5 does for the strip; show the palette key as ⌘K or Ctrl+K from IS_MAC (evidence: plan step 5 vs step 10; Breaking changes known limits).
2. In Contracts, add the fields the steps read: agent, kind (worktree dot, app.js:351, app.js:4049), slug, title, client, tags (matchesQ, app.js:255; archived sort, app.js:266); add matchesFields, esc and hasChat to the helper list.
3. Browser test step 10: give the fixture a way to open a full-screen overlay (a small mermaid block in gamma.md), or use the onboarding guide (#onb.open) as the overlay; today the fixture has no image or Mermaid diagram (app.js:2431, app.js:3453).
4. Browser test Routes: replace /?sel=demo/demo-plan&tab=files with the browser fixture's real key, and say that review mode is checked through the CSS-rule fallback because the fixture has no PR (app.js:615).
5. How to verify: drop `node --check scripts/plans-dashboard/app.js`, or add it to the AGENTS.md Commands table and .claude/settings.json permissions.allow in this change; in step 17, also allow for `node scripts/docs-media.mjs` being blocked by permissions (AGENTS.md:79-92, .claude/settings.json:4-33).
6. Steps 11 and 12: name one owner for Escape in the palette (the global capture handler calls closeSearch(true); paletteKey handles only the arrows, Enter and Tab).
7. Steps 3 and 9: place the blocks before the `// --- Board:` comment (app.js:4075), not between that comment and `let boardOn = false;`.
8. Step 17: filter the exact folder path.join(REPO, 'scripts', 'test') (equal to it, or starts with it plus path.sep), not any src that contains the substring 'scripts/test'.
9. Step 6: openSession returns early (after drawSessionTabs) when key === selected, as openFromBoard does (app.js:4121).

ADD THESE EDGE CASES:
- Esc closes the open plan but leaves its tab in the strip with no mark; say this in the docs section.
- The empty-query palette lists only plan tabs, not worktree tabs; say this in the docs.
- Write dash-tabs only when tabsOpen returns a new list, not on every repaint.

Do not change anything the validation did not flag.
```
