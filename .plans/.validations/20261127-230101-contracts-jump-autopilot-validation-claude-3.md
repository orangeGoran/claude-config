**Validation round:** 3

## Plan validation: 20261127-230101-contracts-jump-autopilot.md

**Verdict:** APPROVE WITH CHANGES

Round 1 and round 2 fixes checked: F1–F17 of round 2 and F1–F21 of round 1 are in the plan text (baseRefName filter, `(sub.prs && sub.prs.rows) || []`, explicit refspec, per-segment guard folders, `..` rule, `String()` before `esc()`, JS key compare, `\u0001` sentinel, raw `fetch` for the 403, `{ projects: [...] }` body, `repoKey()` strips credentials, "on branch <base>", `pushed: null`, owner-copy `render.mjs --upgrade` check). No regression from those edits found, except the one below in step 17.

### Blocking issues

- [Tests / How to verify] Step 17 says "`'Never run a fifth round'` stays (it is in the new sentence)". It is not. Step 15 replaces "Never run a fifth round." with "Never run more than `<max>` rounds, and never a fifth round." The new sentence holds "never a fifth round" (lower case, no "run"). The round-cap test checks `v.includes(want)` with the exact string `'Never run a fifth round'` — `test/bootstrap-project.test.mjs:1051` (list) and `:1060` (`assert.ok(v.includes(want), ...)`), so `node --test test/bootstrap-project.test.mjs` and `npm test` fail after steps 15 and 17. Fix: keep "Never run a fifth round." as its own sentence in step 15 (for example "Never run more than `<max>` rounds. Never run a fifth round."), and update the **Bootstrap tests** `--max-rounds` string to match; or change the test string in step 17. Pick one and say it.

### Non-blocking concerns

- [Discrepancy, 2a] Context and step 10 call the 2a rework "uncommitted". The 2a worktree is now clean, and the rework is commit `297b2bf` ("checklist in the main area, group box in the sidebar, one-click group form") on top of `169b888` (`git -C <2a worktree> status --short` gave no output; `git log --oneline -5`). At `297b2bf`: `function checklistHtml(d)` (app.js:5276), `function showChecklist(group)` (:5332), `async function renderChecklist(byUser)` (:5352), `.ck-box` with `<h3>Tickets</h3>` (:5297), `ckGroups`/`ckPick` (:5241, :5243). The plan's names fit that commit. Suggestion: name `297b2bf` and keep the "map to the merged code" rule.
- [Guard regression] Step 16 resolves each `-C <folder>` with `path.resolve(dir, folder)` and names the `~` rule only for `cd`. Today the Bash side expands a leading `~` of the `-C` folder (`workflow-guard.sh:70`). After the change, `git -C ~/other-repo commit` resolves to `<cwd>/~/other-repo`, `common()` gives nothing, and the commit is checked by this guard's rules (blocked) instead of passing as another repo. Suggestion: apply the leading-`~` rule to `-C` folders too, drop line 70 or keep it consistent, and add one test case.
- [Guard, set -e] The script runs with `set -euo pipefail` (`workflow-guard.sh:20`). In `common()`, `(cd "$d" 2>/dev/null && pwd -P)` returns non-zero when `cd` fails; then `GUARD_COMMON=$(common …)` stops the script with exit 1, which a PreToolUse hook treats as a non-blocking error (the commit runs unchecked). Suggestion: end `common()` with `|| true`.
- [Guard, not verified] The classifier uses `process.cwd()` as the start folder, like today's `git -C "${COMMIT_DIR:-.}"`. The hook input JSON from Claude Code also carries a `cwd` field. I cannot prove here which folder the hook process runs in after a persistent `cd` in the Bash tool. Proof: one hook log line with `process.cwd()` and the JSON `cwd`. Suggestion: prefer the JSON `cwd` when it is present.
- [Test that cannot fail] Bootstrap test "`cd QA-tool && git commit -m x` with an unquoted `QA-tool` folder inside the repo → resolves to that folder" names no exit code. A folder inside the same repo gives the same exit (2) whether it resolves right or not. Suggestion: make `QA-tool` its own git repo (another repo) and expect 0.
- [Page test harness] The new `jumpCardHtml` case "cuts `jumpCardHtml` alone", but the function uses `esc`, `escA` and `projPill` (step 10). `projPill` calls `projStyle` (app.js:351 at `297b2bf`), so the cut needs a `projPill` stub, as the 2a `checklistHtml` test passes it as a `new Function` parameter (`dashboard.test.mjs:2637`). Suggestion: say so in step 11.
- [Naming hazard] Step 7 uses `path` as the loop variable (`(saved.subs || {})[path]`, `{ type: 'submodule-error', path, … }`). In `server.mjs`, `path` is the `node:path` import. Inside that loop, a later `path.join` would break. Suggestion: name the variable `subPath` and write `path: subPath` in the events.
- [Push commands] Step 8's commands use `git add -- .plans/<slug>.md`. A project with a custom `plansDir` (`server.mjs:194`) writes the plan elsewhere. Suggestion: use `path.relative(proj.root, file)` (the same value `jumpCards()` already computes for `pushed`), and give no commands when `plansDir` is outside the root.
- [Robustness] Step 6 does not say what happens when `JSON.parse` of a `gh` page fails. The step 7 `try` would turn it into an error for the whole submodule record instead of `prs.error`. Suggestion: a parse failure → `{ error: 'gh gave no PR data', rows: [] }` (the `checkCondition()` wording, `server.mjs:1979`).

### Edge cases the plan should address

- A submodule clone with a narrow fetch refspec (`--single-branch`, or a branch other than the configured one): the watcher's `git fetch -q origin` (the shared `subfetch` key) may not update `origin/<branch>`, so the card shows an old tip or "no origin/<branch> in the submodule". The jump plan uses an explicit refspec; the watcher does not. Say it in the docs, or fetch the branch with the explicit refspec under its own `once()` key.
- `?checklist=<group>` for a group that no longer exists: `ckPick()` falls back to the first group (`app.js:5243` at `297b2bf`). That is acceptable, but the browser test could check it.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (main: `checkCondition`, `once`, `gitIn`, `gitRaw`, `gh`, `ghProblem`, `PR_JQ`, `loadWatch`, `notifyMac`, `LOST_LOCK`, `watchProject` steps 1–7, `planBase`, `planBranch`; 2a at `297b2bf`: `ledgerState`, `ledgerOpen`, `cleanEntry` group lines, `resolveProject` `group`, `checklistHtml(d)`, `showChecklist(group)`, `renderChecklist(byUser)`, `data-f="group"`); only the "uncommitted" wording is out of date
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `moduleOn` in `render.mjs`, `verify.mjs:19,162`, `upgrade-run.mjs`; `--unused` order test `bootstrap-project.test.mjs:653` still passes because `contracts-jump` goes at the end of `MODULES`)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently (parent plan phase 5 lists this exact scope; roadmap has no repo-level open decision)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no login; 403 cross-site; 400s; unknown project and path; no tenant model)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (module off by default; guard and `--max-rounds` reach projects only through `--upgrade`)
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; values come from `PR_JQ` and the plan's own module)
- [ ] "How to verify" commands are real and can fail — the commands exist (`npm test` script `node --test apps/*/test/*.test.mjs test/*.test.mjs`; `changelog-validate.mjs` exists), but `node --test test/bootstrap-project.test.mjs` cannot pass with step 17 as written (blocking item)

```
Update the plan at .plans/20261127-230101-contracts-jump-autopilot.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make the round-cap test pass after step 15. The new sentence "Never run more than `<max>` rounds, and never a fifth round." does not contain the string 'Never run a fifth round' that the test checks with v.includes() (evidence: test/bootstrap-project.test.mjs:1051 and :1060). Either keep "Never run a fifth round." as its own sentence in step 15 (for example "Never run more than `<max>` rounds. Never run a fifth round."), or change that test string in step 17. Remove the wrong claim "'Never run a fifth round' stays (it is in the new sentence)" from step 17, and make the --max-rounds string in Tests → Bootstrap tests match the new step 15 text.

SHOULD FIX:
1. Say that the 2a rework is now commit 297b2bf (not uncommitted) in Context and step 10; keep the "map to the merged code" rule (evidence: 2a worktree git status is clean; git log shows 297b2bf).
2. In step 16, apply the leading-~ rule (process.env.HOME) to -C folders too, and add a test `git -C ~/<other repo> commit` → 0 or say why not (evidence: skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:70 expands ~ today).
3. In step 16, end common() with `|| true` so a failed cd cannot stop the script under set -e with exit 1 (evidence: workflow-guard.sh:20).
4. Give the QA-tool guard case an exit code that can fail: make QA-tool its own git repo and expect 0.
5. In step 11, give the new jumpCardHtml harness case a projPill stub (as the 2a checklistHtml test does, apps/dashboard/test/dashboard.test.mjs:2637 in the 2a worktree), plus esc and escA.
6. In step 7, name the loop variable subPath (not path, which is the node:path import in server.mjs) and write `path: subPath` in the two events.
7. In step 8, build the git add path with path.relative(proj.root, file), not a fixed .plans/<slug>.md (evidence: apps/dashboard/server.mjs:194, custom plansDir).
8. In step 6, a gh page that is not JSON → { error: 'gh gave no PR data', rows: [] } (evidence: apps/dashboard/server.mjs:1979 wording).
9. Note in step 16 that the start folder is process.cwd(), and consider the hook JSON `cwd` field when present (not verified which folder the hook runs in).

ADD THESE EDGE CASES:
- A submodule clone whose fetch refspec does not cover the followed branch: the watcher's shared `git fetch -q origin` may leave origin/<branch> old or missing; document it or fetch with the explicit refspec under its own once() key.
- ?checklist=<group> for a group that no longer exists: ckPick() opens the first group.

Do not change anything the validation did not flag.
```
