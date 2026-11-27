**Validation round:** 3

## Plan validation: 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** APPROVE WITH CHANGES

Round 1 and round 2 fixes are in the plan and match the code. I checked the 2a symbols in the worktree `20261127-195706-groups-ledger-checklist` (uncommitted rework) and the templates on `main`. One new blocking item: a 2a CSS rule hides the "needs triage" chip that step 8 adds.

### Blocking issues

- [Discrepancy / screen] The "needs triage" chip of each triage row will not show. Step 8 puts `<span class="chip warn">needs triage</span>` into the "Needs you now" box (`ck-box ck-you`). The 2a CSS hides every warn chip in that box — worktree `apps/dashboard/page/app.css:998` `.ck-you .chip.warn { display:none; }` (2a does this because every plan row there is `needs-you`). The page-function test only reads the HTML, so it passes, and the plan has no browser test, so nothing catches it. The row then shows only the project pill, `#89` and the title, without the "needs triage" label from Goal step 8. — Fix: in step 9, add `.ck-you .ck-triage .chip.warn { display:inline-block; }` (or give the chip its own class, for example `chip warn ck-tri-chip`, that the 2a rule does not match). Add one line under Harness constraints: CSS visibility is not tested, so the owner's check after the restart must look for the chip.

### Non-blocking concerns

- [Edge case / owner decision 5A] A hand launch can pick up an old `-related.json`. In step 11, `write_related()` keeps the file when `DASH_RELATED_REPOS` is unset, and the launch loop calls it the same way as resume. The launch loop's SKIP checks (`auto-pipeline.sh:713-718`) look only at the worktree and the branch. So when the owner removed a worktree and branch by hand, without `--cleanup`, a later hand launch keeps the old file and gets `--related=`. Parent 5A (`.plans/20261124-225819-pipeline-diet-parent.md:20`) says a run started by hand gets no list. — Suggestion: in the launch loop, `rm -f "$RUNS_DIR/$slug-related.json"` before `write_related`, or give `write_related` a third argument `launch` so that an unset variable removes the file. Only resume keeps it. Add the case to the `write_related` template test.
- [Discrepancy] `usage()` prints a fixed line range: `auto-pipeline.sh:91` `sed -n '2,30p'`, and the header comment ends at line 30. The new header line from step 11 pushes the last line ("A failure stops the launch with the reason…") out of `usage`. — Suggestion: change it to `2,31p` in the same step, or put the new line in place of an existing one.
- [Edge case / resume] Item 7.5 runs after `skill-5-ship` sets `PR OPEN` (a final, "needs you" status). If the session crashes inside 7.5, the report still says `PR OPEN` and no ENDED mark is set. The dashboard shows a finished run, so the owner may never resume it, and the recovery of item 7.5.2 never runs. — Suggestion: in the "Next — your part" block of item 8, list every `D<n>` line that still has `ticket: open` or `failed (…)`, with "Resume in to PR mode to open them". Or add a Timeline line `tickets: done` that the owner can look for. At least say this in the "Tickets land after PR OPEN" decision.
- [Screen] The sidebar group bar does not count triage tickets. `groupSummary()` (worktree `apps/dashboard/groups.mjs`, "needsYou") counts only `needs-you` plans, so with only a triage ticket the bar says no "needs you" while the checklist shows a "Needs you now" box. — Suggestion: write this limit in step 21 (docs), or say that phase 3 adds it.
- [Safety] Step 8 renders `inline(i.title)`. `inline()` (worktree `app.js:175-186`) turns `[text](https://…)` and bare URLs into links. A GitHub issue title can come from anyone who can open an issue in the repo (a maintainer adds the labels). — Suggestion: use `esc(i.title)` for the triage title. The test's `&lt;b&gt;` check still passes.

### Edge cases the plan should address

- `skill-5-ship` stops with `BLOCKED` and no PR: the `D<n>` lines keep `ticket: open`. Say that this is the intended state for a later resume, and that the PR body block is not written.
- A `needs-triage` issue that is closed and opened again makes a second notification (its number leaves the baseline and comes back). This is acceptable, but write it in the docs sentence on the notification.
- Hand launch after a worktree was removed by hand: see the first non-blocking item.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (worktree: `groups.mjs` `ISSUES_RE`/`ticketKey()`; `server.mjs` `runLauncher()` :777, `launchGeneric()` env :845, `PR_TTL`/`prLists`/`refreshPrList()`/`prsFor()` :1594-1663, `ghProblem()` :1624, `loadWatch()` blank :1951, `watchProject()` step 1 :2166-2184 and the `cache` parameter :2161, `watchTick()` :2292-2318, `cleanup()` artifacts :1331, `ledgerState()` :1380, `allProjects()` :255; `app.js` `checklistHtml(d)` :5276 with the `ck-you` box :5296; templates `write_run_settings()` `pr_rules` :226-231, both `start_session` calls :637/:814, `--cleanup` :578, `render.mjs` allow :397, `verify.mjs` overlay/`push-allow` :145-152)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `ticketKey` → `buildChain`; `runLauncher` → launch, resume, watcher; `checklistHtml` → page and its test)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope (no new endpoint; the 403 Origin case is kept; the group scope is covered by the `ct-group*` cases)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail (`node --test …`, `npm test`, `grep` and `changelog-validate.mjs` are all in AGENTS.md Commands or `.claude/settings.json`)

```
Update the plan at .plans/20261127-230102-cross-repo-defect-tickets.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 9, make the triage chip visible inside the "Needs you now" box. The 2a rule `.ck-you .chip.warn { display:none; }` hides it. Add `.ck-you .ck-triage .chip.warn { display:inline-block; }`, or give the chip a class that the 2a rule does not match. Under Harness constraints, write that the page-function test cannot see CSS, and that the owner's check after the restart looks for the "needs triage" chip. (evidence: worktree apps/dashboard/page/app.css:998; plan step 8)

SHOULD FIX:
1. In step 11, make a launch (not a resume) remove `$RUNS_DIR/$slug-related.json` when DASH_RELATED_REPOS is unset. For example, run `rm -f` before `write_related` in the launch loop, or give `write_related` a `launch` argument. Add the case to the write_related template test. (evidence: auto-pipeline.sh:713-718 checks only the worktree and the branch; parent plan 5A at .plans/20261124-225819-pipeline-diet-parent.md:20)
2. In step 11, change `usage()` from `sed -n '2,30p'` to `2,31p` when you add the header line, or put the new line in place of an existing one. (evidence: auto-pipeline.sh:91, the header ends at line 30)
3. In item 8 of the skill-auto-pipeline template (step 12), list every D<n> line that still has `ticket: open` or `failed (…)` in the "Next — your part" block, with "Resume in to PR mode to open them". Or state the crash-after-PR-OPEN limit in the decision "Tickets land after PR OPEN". (evidence: skill-auto-pipeline/SKILL.md:183-199)
4. In step 21, write that the sidebar group bar's "needs you" count does not include triage tickets, or plan the count. (evidence: worktree apps/dashboard/groups.mjs groupSummary())
5. In step 8, render the triage title with `esc(i.title)` instead of `inline(i.title)`: a GitHub issue title can come from anyone who can open an issue. (evidence: worktree apps/dashboard/page/app.js:175-186)

ADD THESE EDGE CASES:
- skill-5-ship stops with BLOCKED and no PR: the D<n> lines keep `ticket: open` for a later resume, and no PR body block is written.
- A needs-triage issue that is closed and opened again makes a second notification; write it in the docs.

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
