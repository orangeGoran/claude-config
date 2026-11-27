**Validation round:** 4

## Plan validation: 20261127-230101-contracts-jump-autopilot.md

**Verdict:** APPROVE WITH CHANGES

Round 3 fixes checked: F1 (step 15 keeps "Never run a fifth round." as its own sentence; step 17 keeps the test string), F2 (step 6 resolves the branch, then fetches with the explicit refspec), F3 (`redact(ghProblem(output))`), F4 (unknown folder → exit 2), F5, F6 (`~` rule for `-C`), F7 (`|| true` in `common()`), F8 (`QA-tool` is its own repo, expect 0), F9 (stubs named), F10 (`subPath`), F11 (`path.relative(proj.root, file)`), F12, F13 (start from the hook input's `cwd`), F14, F15 (D15 fallback). All landed. One of them (F13) is only half applied, see B1. No other regression found.

### Blocking issues

- [Guard / internal contradiction, D13 vs step 16] A plain `git commit` (no `cd`, no `-C`) still ignores the hook input's `cwd`. Step 16 prints line 2 only "when a `cd` or a `-C` was found", so `COMMIT_DIR` stays empty and the Bash side runs `git -C "${COMMIT_DIR:-.}"` (`skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:71`), which is the hook process's own folder. D13 (plan line 55) says the folder is found "from the hook input's `cwd`". The hook command is `bash "$CLAUDE_PROJECT_DIR/.claude/scripts/workflow-guard.sh"` (`skills/bootstrap-project/scripts/render.mjs:416`, `.claude/settings.json:54`). The plan's own Harness constraints (line 282) say it cannot prove that the hook process's folder follows the Bash tool's `cd`. Why it breaks: the most common commit form keeps the defect this plan fixes. A plain commit from a Bash shell that is in `wt2` can be checked against the main checkout's branch and index. That gives a false block, or a false pass when the main checkout is on `auto/*` or has only `.plans/` files staged. The planned tests cannot catch this when the helper gives the same folder to `spawnSync` and to the JSON `cwd`. Fix: when the input has a `cwd` field, step 16 prints the resolved `dir` as line 2 even with no `cd` or `-C`. Add two guard cases with `spawnSync` cwd = repo and JSON `cwd` = `wt2`, plain commit → 2, and JSON `cwd` = `wt`, plain commit → 0. Both fail without the fix.

### Non-blocking concerns

- [Reference implementation, stale after round 3 F2] Mirror (line 120) says `checkSubmodule()` uses "the same git calls and the same `once()` keys, so a tick fetches each repo once". After F2 that is false. `checkCondition()` uses `once(cache, 'subfetch ' + sub, () => gitIn(sub, ['fetch', '-q', 'origin']))` (`apps/dashboard/server.mjs:2001`), and step 6 uses the key `'subfetch ' + sub + ' ' + branch` with a refspec. A project with a `submodule … contains` wait and a watched path fetches the submodule twice per tick. Suggestion: list this under Deviations with its reason (the refspec), or fix the Mirror line.
- [Guard, Harness constraints claim] Line 281 says "The guard keeps its old 'another repo' exit when the call fails". Step 16 replaces that block. When `--path-format=absolute` fails, `common()` gives `''`, so no `exit 0` happens and a commit in another repo is checked by this guard's rules. Suggestion: follow the server's `gitCommonDir()` pattern (`apps/dashboard/server.mjs:2017-2023`: plain `--git-common-dir`, resolved against the folder, real path), which works on every git. Or correct the sentence.
- [Step 5 insertion point] "In `cleanEntry()`, after the `group` lines" is ambiguous. In 2a, `let warning;` comes after the group lines (`server.mjs:943-945` in the 2a worktree). An assignment to `warning` before that line throws a TDZ ReferenceError. Suggestion: say "after the group warning (2a `server.mjs:951-952`), before `return { entry, warning }`".
- [2a reference] The 2a branch head is now `a31cc98` (sidebar group fold), not `297b2bf`. I checked `git diff 297b2bf a31cc98 -- apps/dashboard/page/app.js`: `checklistHtml(d)`, `renderChecklist(byUser)`, `showChecklist(group)`, `ckPick()` and the `[data-sopen]` binding did not change. Suggestion: name `a31cc98` in Context and step 10. The "map to the merged code" rule already covers later changes.
- [Test flake, cj3] The cj3 case POSTs `{ prs: [44] }` and expects the output to name #44. `jumpConfirm()` checks `card.state` first, and before the first watcher tick the state is `unchecked`, which gives another reason. Suggestion: start cj3 with `until()` `contracts[0].state === 'batch'`, as cj2 does.
- [Jump plan headings vs `rules.planSections`] Projects can rename the plan headings (`skills/bootstrap-project/scripts/render.mjs:59`, `:357`, test `test/bootstrap-project.test.mjs:800-804`: "Implementation steps", "Final verification"). `jumpPlanText()` always writes `## Steps` and `## How to verify` (D10), and the skills of such a project look for the renamed sections. Suggestion: the jump plan's Context says that its own headings are the steps and the checks. Or the `contracts-jump` module skill says so.
- [Breaking changes, guard] Breaking changes (line 176) does not name that a commit whose folder the guard cannot read is now blocked in every bootstrapped project with the step gate. Before, `cd "$X" && git commit` was checked or passed. Suggestion: add one line.
- [Step 11 wording] "the `line('const BT =')` pattern of 2a": the 2a `checklistHtml` test uses `pick(/^const BT = .*$/m)` (2a `apps/dashboard/test/dashboard.test.mjs:2634`). `line()` is from an older test (`:323`). Trivial.

### Edge cases the plan should address

- The Bash tool's folder is a linked worktree and the hook process runs in the main checkout (B1). Without the fix, the plain commit is judged by the wrong worktree.
- A jump plan whose PR merged while the main checkout was not pulled: the main checkout is on another branch (`pullRoot()` refuses, `server.mjs:1685-1686`), or it is the dashboard's own repo (`ownRepo()`, never pulled). The plan stays in `.plans/` and blocks new recommendations. The card's "Archive the plan" line covers it, but the docs section "Contracts jump" should name this case.
- `?checklist=<group>` stores an unknown group in `localStorage` through `showChecklist()` (2a `app.js:5372`). `ckPick()` falls back, so nothing breaks. No change is needed. It is noted for the browser test.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (2a symbols checked in the 2a worktree; head moved to `a31cc98` with no change to them)
- [ ] Reference implementation mirrored, deviations justified (the `subfetch` key and call deviation is not listed)
- [x] Breaking changes for changed symbols listed (consumer search done: `moduleOn` in render.mjs, verify.mjs:162, upgrade-run.mjs:143; `checklistHtml`/`renderChecklist` harness tests; round-cap tests)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no login; 403 cross-site, 400s, ok:false cases)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261127-230101-contracts-jump-autopilot.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 16 (and D13), make a plain commit use the hook input's cwd. When the input has a `cwd` field, print the resolved start folder as line 2 even when no `cd` or `-C` was found, so the Bash side never falls back to `git -C .` (the hook process's folder). In Tests -> Bootstrap tests, add two guard cases where the spawnSync cwd is the repo and the JSON `cwd` differs: a plain `git commit -m "feat: x"` with JSON cwd = wt2 -> 2, and with JSON cwd = wt -> 0. Both fail without the fix. (evidence: skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:71 `git -C "${COMMIT_DIR:-.}"`; skills/bootstrap-project/scripts/render.mjs:416 hook command; plan line 55 D13 vs step 16 "print it as line 2 (when a cd or a -C was found)")

SHOULD FIX:
1. Correct the Mirror line "the same git calls and the same once() keys, so a tick fetches each repo once", or list the subfetch key and refspec as a Deviation with its reason. (evidence: apps/dashboard/server.mjs:2001 vs step 6)
2. Correct Harness constraints "The guard keeps its old 'another repo' exit when the call fails", or make common() work on every git as server.mjs gitCommonDir() does: plain --git-common-dir, resolved against the folder, then realpath. (evidence: apps/dashboard/server.mjs:2017-2023)
3. In step 5, put the watchSubmodules warning after the 2a group warning and before `return { entry, warning }`, not "after the group lines": `let warning` is declared after them. (evidence: 2a server.mjs:943-953)
4. Name the 2a head a31cc98 in Context and step 10. The checklist symbols did not change. (evidence: git diff 297b2bf a31cc98 -- apps/dashboard/page/app.js)
5. In the cj3 end-to-end case, wait with until() for contracts[0].state === 'batch' before the first POST. (evidence: step 8 jumpConfirm checks card.state first)
6. Say in the jump plan text, or in the contracts-jump module skill, that the jump plan's own headings (## Steps, ## How to verify) hold the steps and checks also in a project with renamed rules.planSections. (evidence: skills/bootstrap-project/scripts/render.mjs:59, :357)
7. Add to Breaking changes: a commit whose folder the guard cannot read (for example `cd $X && git commit`) is now blocked in every project with the step gate.
8. In step 11, name the pick(/^const BT = .*$/m) pattern of the 2a checklistHtml test, not line('const BT ='). (evidence: 2a dashboard.test.mjs:2634)

ADD THESE EDGE CASES:
- The Bash tool's folder is a linked worktree while the hook process runs in the main checkout: a plain commit is judged by the worktree of the input cwd.
- A merged jump plan whose main checkout is not pulled (another branch, or the dashboard's own repo) stays in .plans/ and blocks. Name it in docs "Contracts jump" next to "Archive the plan".

Do not change anything the validation did not flag.
```
