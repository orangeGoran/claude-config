**Validation round:** 1

## Plan validation: 20261127-230101-contracts-jump-autopilot.md

**Verdict:** APPROVE WITH CHANGES

The plan is detailed, and most of its claims match the code. These match: the phase 1 watcher symbols on main, the 2a server symbols, the guard defect, render.mjs, the template strings and the test helpers. Five issues block the run. Four of them are tests or values that would fail or be wrong as the plan is written. The fifth is a big one: the 2a page code that the plan builds on is being reworked right now in the 2a worktree, and the rework has not been committed yet.

### Blocking issues

- [Discrepancy / scope of 2a] The page parts of this plan are written against the committed HEAD of 2a (`169b888`). The 2a worktree has uncommitted changes that remove or change those parts — evidence: `git -C <2a worktree> status` shows `app.js`, `app.css`, `page.html`, `server.mjs`, `groups.mjs` modified. HEAD `apps/dashboard/page/app.js:5192` `CHECK_TITLE`, `:5204` `function checklistHtml(d, groups, pick)`, `:5240` `function openChecklist()` (the drawer in `#logpane`). In the working tree, `apps/dashboard/page/app.js:5273` is `function checklistHtml(d)` (one parameter), there is no `openChecklist`/`CHECK_TITLE`, `:5326` `showChecklist(group)` paints into `#detail` (the big right area, not the drawer), the cards are `.ck-box` (not `.sc-card`), and the order is Needs you / Tickets / Goals & rules / Questions. A group bar in the sidebar and `groupSummary()` are added too (`server.mjs` diff). — Step 10 (`checklistHtml(d, groups, pick, off)`, the `?checklist` opener that calls `openChecklist()`), step 11 (cut pattern `checklistHtml\(d, groups, pick, off = new Set\(\)\)`), Affected files, Breaking changes, Reference implementation ("drawer card", `.sc-card`) and the Browser test ("⋯ → ☑ Checklist", "same `#logpane`") would not fit the merged 2a. The `?checklist=` opener would throw `ReferenceError: openChecklist is not defined`. — Fix: tie the page steps to the 2a shape that is merged. Add a first step that re-reads the merged `checklistHtml`/`renderChecklist`/opener and the 2a page tests and maps each page instruction onto them, or rewrite steps 10–11 and the Browser test after PR #13 merges. Then run this validation again.
- [Breaking changes: consumer not listed] The 2a test "the page: renderChecklist paints only the newest answer …" (`apps/dashboard/test/dashboard.test.mjs:2530-2554`) cuts `renderChecklist` out of `app.js` and runs it with a fixed set of globals: `state`, `checkGroup`, `ckGen`, `ckBusy`, `ckPending`, a stub `checklistHtml = (d, groups, pick) => …` and `querySelectorAll: () => []`. Step 10 makes `renderChecklist()` pass `ckJumpOff` as a fourth argument. The harness does not declare it, so that test throws `ReferenceError: ckJumpOff is not defined`. — The plan says the only callers are `renderChecklist()` and the `checklistHtml` page test. — Fix: in step 11 and Breaking changes, add `let ckJumpOff = new Set()` (and the 4-argument stub) to the renderChecklist harness body.
- [Breaking changes: consumer not listed] `test/bootstrap-project.test.mjs:491-501` (test "the validation skills write the report names of their author") asserts that the `**Continue.**` line matches `` /`k` < 4 → run round `k\+1`/ ``, in the Codex-on and Codex-off renders. Step 15 changes that line (`skill-auto-validate-plan/SKILL.md:132`) to `` `k` < `<max>` ``. Step 17 lists only the round-cap test (`:1044`). — `npm test` fails. — Fix: in step 17, also change both `stopRule` asserts to `` /`k` < `<max>` → run round `k\+1`/ ``.
- [Test is wrong] End-to-end case "Not behind and errors": `cj5-bad` is "a `makeRepo()` with `watchSubmodules: ['nothere']`" and expects `submodule not initialized in the main checkout`. But `makeRepo()` writes the default `PIPE_SCRIPT` (`apps/dashboard/test/watcher.test.mjs:76`, `:146`), and that script has no `BASE_BRANCH` line. Step 6 checks `launcherBase()` before `existsSync(<sub>/.git)`, so the reason is `no BASE_BRANCH in auto-pipeline.sh`, the same reason as `cj5-nobase`. — The case fails, or the two cases test the same branch. — Fix: make `cj5-bad` with `makeRepo('cj5-bad', { script: 'BASE_BRANCH="main"\n' + PIPE_SCRIPT })`.
- [Signature / undefined value] Step 8 `jumpConfirm()` passes `base` to `jumpPlanText({ …, base, … })` and puts `<base>` in the output commands, but no step defines `base` there. `jumpCard()` does not return it, and `jumpCards()` computes it on its own. — The plan file would get `- **Base**: undefined`, `auto-pipeline.sh` would launch from a wrong ref, and the answer would say `git push origin undefined`. — Fix: in `jumpConfirm()`, set `base = launcherBase(readFileSync(proj.launcherScript, 'utf8'))`, and answer `{ ok: false, output: 'no BASE_BRANCH in auto-pipeline.sh' }` when it is null. Or let `jumpCard()` return `base` and use that one value in both places.

### Non-blocking concerns

- [Signatures] Step 6 calls async helpers as if they were sync. `gitRaw(sub, […]).code === 0`, `gitIn(sub, ['rev-parse', …])`, `repoKey(gitIn(…).out)` and `repoKey(once(cache, 'remote ' + p.root, () => gitIn(…)).out)` all need `await`: `gitIn` (`server.mjs:1677`), `gitRaw` (`:2232`) and the value that `once()` keeps (`:1963`) are Promises. Copied literally, `behind` is always false and `upstream` is always null. — Write `(await gitRaw(…)).code`, `(await gitIn(…)).out`, and so on.
- [Safety] The branch from `.gitmodules` (D3) goes unchecked into the jump plan text, which a headless agent runs as commands (`git -C <path> fetch origin <branch>`, `checkout --detach origin/<branch>`), and into git arguments. A `.gitmodules` change in a PR could inject text there. — Accept the branch only when it matches `/^[\w.][\w./-]*$/` (the `checkParams` branch rule, `render.mjs:96`). Otherwise give the error "bad branch in .gitmodules".
- [Docs] `skills/bootstrap-project/references/contracts.md:113` (`modules.<name>` row: "Missing = on. Names: … run-skill") is not in the plan. It becomes wrong. — Add `contracts-jump` and "missing = on, except `contracts-jump` (missing = off)".
- [Breaking changes] `moduleOn` has a third consumer: `skills/bootstrap-project/scripts/upgrade-run.mjs:40,143`. It is harmless (it only reads `changelog`), but the consumer list says only `render.mjs`, `verify.mjs`.
- [Inconsistency] Affected files quotes the cut pattern `function checklistHtml\(d, groups, pick, off\)`, but step 11 uses `off = new Set\(\)`. — Use one form.
- [Docs] `docs/roadmap.md:31` says "phases 3–5 are not written yet". Once this plan exists, that line is out of date. — Add a step that names phase 5's plan there. Step 18 also changes the root `AGENTS.md`, but Affected files does not list it.
- [Quote] Step 14 says interview row 2 of `references/checklist.md` has "all on by default". The row (`checklist.md:62`) says "Default: all on, Codex on". — Quote the real text and give the new text.
- [Edge / wrong data] `jumpCard()` makes `rows: []` when `prLists[up.root]` is still missing (after a server start, before the first PR read). Then the card shows `now` ("jump now") while the upstream really has open PRs, and Confirm would write a no-wait plan. — When the upstream list has no `at`, treat it as `unchecked` (or as an `error` "PR list not read yet").
- [Guard] Step 16 finds the `cd` segment by its position in `bare`, then applies the regex to "the original command's segments". The two splits do not line up when quoted text holds `;`, `&&` or `|` (for example a commit message). Also, `cd a && cd b && git commit` with relative paths must resolve every `cd` in order, not only the last one. And under `set -euo pipefail`, `COMMIT_COMMON=$(common …)` exits with status 1 when `(cd "$d" && pwd -P)` fails. — Map the segments by index on `bare` and strip only the `Q` placeholders; resolve all `cd`s in order; end `common()` with `|| true`.
- [Edge] `jumpConfirm()` accepts `prs: [41, 41]` and writes two identical `Waits for:` lines. — Remove repeats before the write.

### Edge cases the plan should address

- The owner does not push the jump plan before its PRs merge. The watcher launches it, `auto-pipeline.sh` prints `SKIP: plan not on origin/<base>` (`.claude/scripts/auto-pipeline.sh:718`), the launch is recorded in `launched`, and `canAutoLaunch()` never tries again (`apps/dashboard/watch.mjs:112`). The plan then never starts by itself. The card's "not on origin yet ✗" should say that it will not start by itself after the merges, or the watcher should not record a launch for a plan that is not on origin.
- The jump PR is closed without a merge. The plan stays in `.plans/` of the main checkout, so it blocks new recommendations for ever. The card should tell the owner to delete or archive it.
- `allByBranch` keeps one PR per head branch name (`server.mjs:1537`), so fork PRs that share a branch name such as `main` hide each other. Only the newest 200 PRs are read (`server.mjs:1516-1527`). An old open PR can be missing from `recommended`.
- A watched project without a group gets a notification that opens `?checklist=` (empty), which opens nothing (D11). Open `/` or the project instead.
- The submodule origin is a private https repo with no credentials: `GIT_TERMINAL_PROMPT=0` gives "cannot fetch the submodule" each tick. That is one event, which is fine. Say it in the docs section.

### Checklist

- [ ] All referenced files, lines, sections and symbols exist as stated (main: yes; 2a page symbols: only in the committed HEAD, not in the 2a working tree)
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done): missing the renderChecklist harness, the `stopRule` asserts and `upgrade-run.mjs`
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (403 cross-origin, 400 bad project, path, prs; no login in this project)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [ ] Docs: current state only respected (`contracts.md:113` and `docs/roadmap.md:31` stay out of date)
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230101-contracts-jump-autopilot.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Tie the page steps to the 2a page code that is merged. The 2a worktree has uncommitted rework: checklistHtml(d) with one parameter, no openChecklist()/CHECK_TITLE, showChecklist(group) painting into #detail, .ck-box cards, the order Needs you/Tickets/Goals/Questions. Add a first step that re-reads the merged checklistHtml/renderChecklist/opener and the 2a page tests and maps steps 10-11, Affected files, Breaking changes, Reference implementation and the Browser test onto them, or rewrite those parts after PR #13 merges. (evidence: 2a worktree apps/dashboard/page/app.js:5273, :5326, :5338 vs HEAD app.js:5192, :5204, :5240)
2. In step 11 and Breaking changes, update the 2a renderChecklist harness test: declare ckJumpOff and accept the 4-argument checklistHtml stub. (evidence: apps/dashboard/test/dashboard.test.mjs:2530-2554)
3. In step 17, also change the two stopRule asserts of the test "the validation skills write the report names of their author" from `k` < 4 to `k` < `<max>`. (evidence: test/bootstrap-project.test.mjs:491-501)
4. Build cj5-bad with makeRepo('cj5-bad', { script: 'BASE_BRANCH="main"\n' + PIPE_SCRIPT }), so its reason is "submodule not initialized in the main checkout". (evidence: apps/dashboard/test/watcher.test.mjs:76, :146; step 6 order)
5. Define base in jumpConfirm(): launcherBase(readFileSync(proj.launcherScript, 'utf8')), and answer { ok: false, output: 'no BASE_BRANCH in auto-pipeline.sh' } when it is null, or return base from jumpCard(). Use it in jumpPlanText() and in the push commands. (evidence: plan step 8)

SHOULD FIX:
1. Add await to the async calls in step 6: (await gitRaw(...)).code, (await gitIn(...)).out, and the value of once(...). (evidence: apps/dashboard/server.mjs:1677, :1963, :2232)
2. Accept the .gitmodules branch only when it matches /^[\w.][\w./-]*$/; otherwise give the error "bad branch in .gitmodules". (evidence: skills/bootstrap-project/scripts/render.mjs:96)
3. Update the modules.<name> row of references/contracts.md: add contracts-jump and "missing = off" for it. (evidence: skills/bootstrap-project/references/contracts.md:113)
4. Add upgrade-run.mjs to the moduleOn consumers in Breaking changes. (evidence: skills/bootstrap-project/scripts/upgrade-run.mjs:40,143)
5. Use one checklistHtml cut pattern in Affected files and step 11.
6. Add docs/roadmap.md (the orchestrator line names phase 5's plan) and the root AGENTS.md (step 18) to Affected files. (evidence: docs/roadmap.md:31)
7. Quote the real interview row 2 text, "Default: all on, Codex on", and give its new text. (evidence: skills/bootstrap-project/references/checklist.md:62)
8. In jumpCard(), treat an upstream PR list that has not been read yet (no prLists[up.root].at) as unchecked or as an error, never as "jump now". (evidence: apps/dashboard/server.mjs:1531)
9. Guard: match the cd segments by index on the quote-stripped command; resolve every cd in order; end common() with || true under set -e. (evidence: workflow-guard.sh:20, :46-48)
10. Remove repeated PR numbers in jumpConfirm() before the write.

ADD THESE EDGE CASES:
- The jump plan is not pushed when its PRs merge: the launcher SKIPs, launched[slug] is recorded, and canAutoLaunch() never tries again (watch.mjs:112). Warn on the card, or do not record the launch.
- The jump PR is closed without a merge: the plan in .plans/ blocks for ever; the card tells the owner to delete or archive it.
- One PR per head branch and only the newest 200 PRs (server.mjs:1516-1537): an open upstream PR can be missing.
- A watched project without a group: the notification opens ?checklist= (empty).
- A private submodule origin with no credentials: "cannot fetch the submodule" (one event).

Do not change anything the validation did not flag.
```
