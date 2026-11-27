**Validation round:** 3

## Plan validation: 20261127-195706-groups-ledger-checklist.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round 2 fixes are mostly correct (`planStep(p, now, staleMs)` matches `runningCount()`, the `é` test can now fail, the new E2E cases fit the harness). Two new defects are in the round 2 text itself. First, the new "skip a repaint while `#ckGroup` has focus" guard also blocks the repaint that the group change asks for, so switching groups shows nothing new. Second, the `ledgerOpen()` catch calls `statSync(f)` with no guard, so the plan's own `gl-group4b` case (a file where the group folder should be) gets a 500, not `{ ok: false }`.

### Blocking issues

- [Edge cases / page logic] The focus guard blocks the group switch. Step 11 skips a repaint "when `document.activeElement` is `#ckGroup`". The `#ckGroup` change handler then calls `renderChecklist()`, but the select still has the focus after the user picks an option. So the new group's answer is never painted until the user clicks somewhere else (and only on the next 5 s tick). Example: Ana has groups `acme-product` and `acme-tools`. She picks `acme-tools`. The drawer still shows the `acme-product` tickets. — plan line 161 ("or when `document.activeElement` is `#ckGroup` (the select is open or in use)") and the change binding on the same line ("`#ckGroup` change → save `checkGroup` …, clear `_ck`, `renderChecklist()`"). The existing `refreshOnce()` guard is for repaints that the user did not ask for (`apps/dashboard/page/app.js:4400-4401`). — The checklist's main control does not work. — Fix: give `renderChecklist(force)` a flag. `openChecklist()`, the `#ckGroup` change and the `#ckEdit` click pass `true`, and the focus guard (and the `_ck` equality skip) apply only when the flag is not set (the tick from `refreshOnce()`). Or call `blur()` on the select in the change handler before `renderChecklist()`. Add Browser test step: "pick group B in the select: the drawer shows B at once, without a click elsewhere".
- [Edge cases / server logic] `ledgerOpen()` can still throw into the global catch. Step 6 says "In the `catch`: an `EEXIST` error with `statSync(f).isFile()` true sets `created = false`". In the `gl-group4b` case (plan line 195: a file at `groups/gl-group4b`), `mkdirSync(groups/gl-group4b, { recursive: true })` fails with `EEXIST`, because a recursive mkdir reports `EEXIST` when the last part of the path is a file. Then `statSync('…/gl-group4b/ledger.md')` throws `ENOTDIR` inside the `catch`. That error goes to `server.mjs:3594-3595` (`json(res, 500, { error: String(e) })`). A dangling symlink at `ledger.md` has the same result (`wx` gives `EEXIST`, `statSync` gives `ENOENT`). — plan line 152; `apps/dashboard/server.mjs:3594-3595`. Not verified by running Node (a run would write files outside `.plans/.validations/`). The claim comes from Node's `mkdirSync` recursive behavior: it returns `EEXIST` for an existing non-folder at the last path part. — The plan's own E2E case ("not a 500") fails, and the step text tells the implementer to write the code that fails. — Fix: in step 6, read the file type in its own guard: `let isFile = false; try { isFile = statSync(f).isFile(); } catch {}`, and count `EEXIST` as "file exists" only when `isFile`. Do the same in `ledgerState()`: an `ENOTDIR` or `ENOENT` from `statSync` gives `exists: false`, not `error`.

### Non-blocking concerns

- [Edge cases] `inline(title)` in `checklistHtml()` still links `#41` to the wrong repo. Round 1 F14 sets `CUR_ISSUES = ''` only around `md(d.ledger.text)`. But `inline()` (`app.js:183-184`) also links `#<n>` from `CUR_ISSUES`, and step 11 renders each plan title with `inline(title)`. A title such as "Invoice screen for #41" in an `acme-web` row links to the issues of the plan that is open in the detail pane (`app.js:697`), which can be another repo. — Suggestion: set `CUR_ISSUES = ''` for the whole `checklistHtml()` body (one `keep` around everything), or use `esc(title)` as `scoutRunCard()` does (`app.js:5016`). Add a page-function case: a title with `#41` gives no `issues/41` link.
- [Tests] Two E2E cases do not say which projects they register. "An untracked plan and a project outside the group" (plan line 194) adds "a third plan in `gl-api`". But `gl-api` belongs to the first case, which unregisters it in its `finally` (plan line 190). "Ledger text" (line 195) uses group `gl-group`, but the intro list gives no project of its own for `gl-group` in that case. This conflicts with "does not depend on another case". — Suggestion: give each case its own repos and groups (for example `gl-unt` in `gl-group7` with `gl-other` outside, and `gl-led` in `gl-group8` for the ledger text). Add them to the intro list.
- [Tests] `openFolderInVsCode()` calls `execFile('code', …)` asynchronously (`server.mjs:1320-1325`). The response can come back before the fake `code` writes `code.log`. — Suggestion: read `code.log` inside `until()` in the "makes the file once" case. The "no new line" checks (`gl-group4`) need a short wait (for example `ticks(1)`) before they read the file, or they cannot fail.
- [Correctness] `planStep()` gives `failed` for an active plan whose report says `CLEANED …` (status set by `auto-pipeline.sh --cleanup`, `.claude/scripts/auto-pipeline.sh:580`) or has no `## Status:` line (`unknown`, `server.mjs:429`). `outcomeOf()` gives `running` for both (`server.mjs:405-407`). A plan that was cleaned up after an abandoned run, with no PR, shows a red "failed" chip. — Suggestion: give `CLEANED` reports `planned` (or `closed`), and keep `failed` only for a stale `running` report. Add one unit case.
- [Sibling] The guide tour text lists the ⋯ menu items: "Board, Scout, Sticky Note, QA Reports, …" and "Board, Scout, QA reports, alerts and the theme are here." (`app.js:4072-4073`). Step 9 updates the `#hdmenuBtn` title, but not this text. — Suggestion: add "Checklist" there in step 11 or 12, and list `app.js` (guide text) in Affected files.
- [Clarity] The page-function case says "the real `const BT =`, `esc`, `escA` and `inline` lines (the `line('const BT =')` pattern)". `inline` is a 12-line function (`app.js:175-186`), not one line. — Suggestion: say "cut `function inline(` up to `// breaks:` (the line before `function md(`)".

### Edge cases the plan should address

- Group switch while the select has focus. This is the normal case after a pick (blocking item 1).
- A file at `groups/<group>` or a dangling symlink at `ledger.md` gives `statSync` errors inside `ledgerOpen()` and `ledgerState()` (blocking item 2).
- A plan title with `#<n>` in the checklist (non-blocking item 1).

### Round 2 fixes checked

- R1 (`é` test): correct. `'a' + 'é'.repeat(150000)` is 300001 bytes. The 262144-byte cut leaves the lead byte of an `é` at byte 262143. With the trailing U+FFFD removed, the text is 262143 bytes.
- F1 (`ledgerOpen` one `try`, `EEXIST` on a folder): the folder case is correct (exclusive create on a folder gives `EEXIST`, `isFile()` is false). The `mkdirSync` case is not complete (blocking item 2).
- F2 (`ckGen`): correct for A → B → A and close/reopen. Every call takes a new number, and only the newest one paints.
- F3 (first read inside `until()`): correct. `prsFor()` returns `{}` and loads in the background (`server.mjs:1547-1551`).
- F4 (repaint key with groups): correct.
- F5 (`planStep(p, now, staleMs)`): the `running` rule mirrors `runningCount()` (`apps/dashboard/watch.mjs:97-102`). `STALE_RUN_MS` exists (`server.mjs:1823`) and is defined before any request runs. See the `CLEANED` concern above.
- F6, F7, F8, F9, F10, F11, F13: applied as the log says. F12 (focus guard): applied, but it causes blocking item 1.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`resolveProject` `server.mjs:192`, `cleanEntry` `:916`, `listPlans` `:564`, `fullState` `:635`, `buildStateBody` `:676`, `openFolderInVsCode` `:1320`, `/api/events` `:3438`, `/api/scout/run` and the guard `:3546-3548`, `/api/pr-refresh` after the guard `:3583`; `app.js` `openScout` `:4991`, `renderScout` `:5041`, `scoutBtn` handler `:5184`, `PALETTE_ACTIONS` `:4683`, `window.dashboard` `:4809`, `if (logKey) loadLog();` `:4426`, `data-f="client"` `:3486`; `page.html:18` `#scoutBtn`, `:7` `#hdmenuBtn` title; `main.swift:314`, `:375`; `build.test.mjs:67-78`; `watcher.test.mjs` helpers `:78-172`; template `Tickets:` line `skills/bootstrap-project/templates/core/dot-claude/skills/skill-1-plan/SKILL.md:138`)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `saveRegistry` callers `server.mjs:911,1302,3523`; `saveLaunchers` keeps unknown fields; `/api/state` consumers)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [ ] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (covered, but two cases are not independent, and `code.log` reads need `until()`)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (the existing `"client"` line in the example registry was raised before, round 1 F21)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail (`changelog-validate.mjs` exits 1 on FAIL, `:201`)

```
Update the plan at .plans/20261127-195706-groups-ledger-checklist.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 11, stop the "#ckGroup has focus" guard from blocking the user's own group change. Give renderChecklist a force flag: openChecklist(), the #ckGroup change handler and the #ckEdit click pass true, and the focus guard and the _ck equality skip apply only to the refreshOnce() tick (or blur the select in the change handler before renderChecklist()). Add a Browser test step: pick group B in the select and the drawer shows B at once, with no click elsewhere. (evidence: plan line 161; apps/dashboard/page/app.js:4400-4401)
2. In step 6, read the file type inside its own guard in ledgerOpen(): `let isFile = false; try { isFile = statSync(f).isFile(); } catch {}`, and count EEXIST as "the ledger exists" only when isFile. A mkdirSync EEXIST (a file at groups/<group>) and a dangling symlink then give { ok: false, output }, not a 500 from the global catch. In ledgerState(), an ENOTDIR or ENOENT from statSync gives exists: false. (evidence: plan line 152 and the gl-group4b case on line 195; apps/dashboard/server.mjs:3594-3595)

SHOULD FIX:
1. In step 11, keep CUR_ISSUES at '' for the whole checklistHtml() body (or render titles with esc(title), as scoutRunCard does), so a "#41" in a plan title is not linked to the open plan's repo. Add a page-function case for it. (evidence: apps/dashboard/page/app.js:183-184, 697, 5016)
2. In Tests -> End-to-end, give the "untracked plan" case and the "Ledger text" case their own projects and groups, and add them to the intro list, so no case depends on gl-api or gl-group from the first case. (evidence: plan lines 190, 194, 195)
3. In Tests -> End-to-end, read code.log inside until() for the "line with the file path" check, and wait one tick before each "no new line" check: openFolderInVsCode() runs code asynchronously. (evidence: apps/dashboard/server.mjs:1320-1325)
4. In step 2 planStep(), do not show a CLEANED report (auto-pipeline.sh --cleanup) as failed: give it planned (or closed), and add a unit case. (evidence: .claude/scripts/auto-pipeline.sh:580; apps/dashboard/server.mjs:405-407)
5. Add "Checklist" to the guide tour text of the ⋯ menu in app.js, and list it in Affected files. (evidence: apps/dashboard/page/app.js:4072-4073)
6. In Tests -> Page function, say that inline is cut from `function inline(` to the line before `function md(`, not as one line. (evidence: apps/dashboard/page/app.js:175-188)

ADD THESE EDGE CASES:
- A group switch while the select has focus (the normal case after a pick).
- A file at groups/<group>, or a dangling symlink at ledger.md, in ledgerOpen() and ledgerState().
- A plan title with #<n> in the checklist.

Do not change anything the validation did not flag.
```
