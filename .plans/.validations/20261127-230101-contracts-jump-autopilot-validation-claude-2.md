**Validation round:** 2

## Plan validation: 20261127-230101-contracts-jump-autopilot.md

**Verdict:** APPROVE WITH CHANGES

The round 1 fixes F1–F21 are in the plan, and I found no regression from them. Checked: the step 10 mapping to the merged 2a page, the step 11 harness stubs, the step 17 `stopRule` checks, the `cj5-bad` script, `card.base`, the awaited `once()` calls, `relation` and `diverged`, the full open-PR read, the guard in shell order, the branch regex, `.gitmodules` from `origin/<base>`, and the four `grep` owner checks. One new defect remains: a field name in `recommendJump()`. The other findings are small.

### Blocking issues
- [Discrepancy / wrong data] `recommendJump()` filters `sub.prs.rows` on `base === sub.branch`, but those rows come straight from `gh … --jq PR_JQ` (step 6: `{ error: '', rows }`). `PR_JQ` gives the field `baseRefName`, not `base`. The `base` field exists only in the `allByBranch` shape that `refreshPrList()` builds. — `apps/dashboard/server.mjs:1517-1518` (`PR_JQ` … `baseRefName: .base.ref`), `apps/dashboard/server.mjs:1538-1539` (`base: p.baseRefName`, only in the cache); plan step 2 (line 197) and step 6 (line 204). — As written, no row ever matches: every open upstream PR is left out, the card says `now` ("jump now") while PRs are open, and Confirm writes a plan with no `Waits for:` line. Unit tests written with `base` would pass and hide this. Only the `cj2` end-to-end case would catch it. — Fix: in step 2, filter on `baseRefName === sub.branch` (and say that the rows have the `PR_JQ` shape: `number`, `title`, `url`, `isDraft`, `state`, `baseRefName`, `headRefName`). Write the unit-test rows with `baseRefName` too, for example by reusing the `prRow()` shape of `apps/dashboard/test/watcher.test.mjs:131-135`.

### Non-blocking concerns
- [Edge case / page] `esc` is `(x) => (x || '').replace(…)`, so `esc(41)` throws a TypeError, and then the whole checklist does not paint. — 2a worktree `apps/dashboard/page/app.js:60`; 2a `checklistHtml()` uses `esc(String(r.pr.number))` (`app.js:5282`). — In step 10, say "PR numbers go through `String()` before `esc()` / `escA()`".
- [Edge case / page] Confirm must find the checked boxes "with the same `data-jkey`". That key holds a `\n`, so an attribute selector `[data-jkey="…"]` built by hand breaks. — Plan step 10 (line 217). — Say: take `body.querySelectorAll('[data-jpr]')` and filter by `el.dataset.jkey === key`.
- [Guard / step 16] The plan keeps the `Q` placeholder and turns `bare` back into words "in order". An unquoted capital Q in the command (for example `cd ~/x/QA-tool && git commit`) would then be read as a placeholder, and the folder would come out wrong. — `workflow-guard.sh:46` (`… "Q")`). — Use a sentinel that cannot be in the input (for example `\u0000`) for the restore, or split the words with a small tokenizer.
- [Tests / claim] Step 17 says "Each case would fail without step 16", but two cases pass today. The plain commit with cwd = `wt` gives 0 today (`REPO_ROOT` ≠ `GUARD_ROOT` → `exit 0`, `workflow-guard.sh:72-73`). `git -C <dir> -C wt2 commit` gives 2 today by chance: the last `-C` is `wt2`, read from the hook's folder, so it does not exist, and the guard falls back to its own repo (`workflow-guard.sh:54-55,71,75`). — Plan Tests → Bootstrap tests (line 273). — Name those two as regression guards and do not count them as fail-first.
- [Tests] The `cj3` "Origin: https://evil.example → 403" case cannot use the `post()` helper of `watcher.test.mjs`: it calls `.json()`, and the 403 body is plain text (`server.mjs:3355-3356`). — Say "a raw `fetch` that checks `status === 403`".
- [Tests] The `cj6` case writes "POST /api/registry with { name: 'cj6-set', … }", but the route needs `{ projects: [...] }`, and it answers the warnings in `output` (`server.mjs:3512-3525`). — Write the body as `{ projects: [...registry(), entry] }` and check `output` (or `warnings`, if the merged 2a changes the answer; the reworked 2a page reads `r.warnings`, `app.js:5430`).
- [Contract ambiguity] `parseSubPaths().dropped` is "the non-empty items that were not kept". The plan does not say whether a repeat, or the 9th and later good paths, count as dropped. The unit case `'contracts, libs/api  contracts'` → `dropped: []` says repeats do not count. — Plan step 1 (line 183), Tests (line 241). — State it: only paths that fail `safeSubPath()`, plus the paths beyond 8 (so that Settings warns about the cut).
- [Edge case / secrets] `repoKey()` keeps "any other value" as it is, and `https://<user>:<token>@github.com/o/r` is not one of the listed forms. A token in a submodule URL then goes into `watch.json` (`subs.<path>.remote`), and the upstream match fails. — Plan step 1 (line 186), Contracts (line 84). — Remove `user[:pass]@` from https URLs in `repoKey()`, or pass `remote` through `redact()` before it is stored.
- [Edge case / push commands] The Confirm output says `git push origin <base>` in the main checkout. When the main checkout is on another branch, the commit goes to that branch, and the push sends the old `<base>`. The card then shows "not on origin yet ✗" for ever, and gives no reason. — Plan step 8 (line 210). — Add "on branch `<base>`" to the output (the server knows the branch: `git rev-parse --abbrev-ref HEAD`, as `/api/pull` does at `server.mjs:3537`), or warn when the checkout is not on `<base>`.
- [Edge case] `pushed` uses `path.relative(proj.root, <plan file>)`. A registry `plansDir` outside the root gives a `../` path, so `pushed` is always false. — `server.mjs:194` (`plansDir` can be set). — Say that a `plansDir` outside the root shows "cannot check the push".
- [Docs] Step 13 says "a fourth part 'Contracts jump'". The 2a checklist has Needs you (only when there is something), Tickets, Goals & rules and Questions (2a `app.js:5296-5321`), so the new card is not "the fourth". — Write "a part 'Contracts jump' after Tickets".
- [Changelog] Step 19 uses `audience: both` but lists only `summary` and `internal`. An entry that customers see also needs `customer.en` (`changelog.d/AGENTS.md:6`, example `changelog.d/20261123-event-watcher.yaml:8-9`). — Add `customer.en` to step 19, or use `audience: internal`.

### Edge cases the plan should address
- Two jump plans for two paths whose slugs are the same (`libs/contracts` and `libs-contracts` both give `…-contracts-jump-libs-contracts`): `wx` refuses the second one in the same second. The text "Try again in one second" covers this. Nothing to change, but a unit case would document it.
- A path such as `_` slugs to an empty tail (`…-contracts-jump-`). Fall back to `sub` when the slug part is empty.
- A second dashboard server on the same HOME (a test dashboard) can also write a jump plan, in another second. `jumpBlockers()` sees it only after the write, so two plans can come from two servers at almost the same time. This is low risk; the docs can say "one dashboard per HOME".
- The card's `checkedAt` changes on each tick, so the checklist repaints once a minute. D17 keeps the ticks. Check that a repaint during a click on Confirm does not drop the click (the browser test, step 2, covers part of this).

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (main: `checkCondition()` `server.mjs:1968-2008`, `once()` 1963, `loadWatch()` 1837-1841, `watchProject()` steps 1–7 2049-2177, `gh()` 1484, `PR_JQ` 1517, `gitIn()` 1677, `gitRaw()` 2232, `planBranch`/`planBase` 314-323, POST block 3498-3548, `auto-pipeline.sh` `BASE_BRANCH` and "plan not on"; 2a worktree: `safeGroup` import 41, `group` in `resolveProject()` 204 and `cleanEntry()` 942-952, `ledgerState()`/`ledgerOpen()` 1380-1443, `/api/ledger/open` 3669, `checklistHtml(d)` 5276, `showChecklist(group)` 5332, `renderChecklist(byUser)` 5352, the Settings `data-f="group"` 3510; the harness tests in `dashboard.test.mjs` 2530-2637). Exception: the `base` field (blocking item).
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `moduleOn` in `render.mjs`, `verify.mjs`, `upgrade-run.mjs` only; the `--unused` test at `test/bootstrap-project.test.mjs:653` still sees `codex` first, because `contracts-jump` is last in `MODULES`)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently (the parent's two open decisions are left alone; D1–D20 fit decisions 1A–7)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no login: 403 cross-site; 400 for an unknown project or path; there is no tenant)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (module off by default; the guard and `--max-rounds` reach projects only through `--upgrade`)
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source yet)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230101-contracts-jump-autopilot.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 2 (recommendJump), filter the open-PR rows on `baseRefName === sub.branch`, not `base === sub.branch`, and state that `sub.prs.rows` has the PR_JQ shape (number, title, url, isDraft, state, baseRefName, headRefName). Write the unit-test rows (Tests → Unit tests, recommendJump) with `baseRefName`. (evidence: apps/dashboard/server.mjs:1517-1518 PR_JQ gives baseRefName; `base` exists only in the allByBranch cache, server.mjs:1538-1539)

SHOULD FIX:
1. Step 10: PR numbers go through String() before esc()/escA() (esc(41) throws). (evidence: 2a app.js:60, app.js:5282)
2. Step 10: Confirm finds its boxes with querySelectorAll('[data-jpr]') filtered by dataset.jkey === key, not with an attribute selector (the key holds "\n").
3. Step 16: restore the quoted words with a sentinel that cannot be in the input (for example \u0000), not the letter Q. (evidence: workflow-guard.sh:46)
4. Tests → Bootstrap tests: say that "plain commit with cwd = wt → 0" and "git -C <dir> -C wt2 commit → 2" already pass today (regression guards), and do not count them as fail-first. (evidence: workflow-guard.sh:54-55,71-75)
5. Tests → End-to-end, cj3: check the cross-site 403 with a raw fetch (the body is plain text, not JSON). (evidence: server.mjs:3355-3356)
6. Tests → End-to-end, cj6: POST /api/registry with { projects: [...registry(), entry] } and read the warning from `output` (or `warnings` in the merged 2a). (evidence: server.mjs:3512-3525)
7. Step 1: define parseSubPaths().dropped exactly: the items that fail safeSubPath(), plus the good paths beyond 8; repeats are not dropped.
8. Step 1: repoKey() removes `user[:password]@` from https URLs (or store `remote` through redact()), so a token never goes into watch.json.
9. Step 8: the Confirm output says the commands run on branch <base> in the main checkout, and warns when the checkout is on another branch. (evidence: server.mjs:3537 reads the branch)
10. Step 8: a plansDir outside the root gives pushed: false with a note "cannot check the push". (evidence: server.mjs:194)
11. Step 13: write "a part 'Contracts jump' after Tickets", not "a fourth part". (evidence: 2a app.js:5296-5321)
12. Step 19: add customer.en for audience: both, or use audience: internal. (evidence: changelog.d/AGENTS.md:6)

ADD THESE EDGE CASES:
- A path that slugs to an empty tail (for example `_`): fall back to `sub` in jumpSlug().
- Two dashboard servers on one HOME can each write a jump plan in different seconds; document "one dashboard per HOME".
- The once-a-minute repaint (checkedAt changes) must not drop a Confirm click or the unticked boxes.

Do not change anything the validation did not flag.
```
