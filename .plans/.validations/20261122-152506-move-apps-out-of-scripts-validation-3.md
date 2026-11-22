**Validation round:** 3

## Plan validation: 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** APPROVE WITH CHANGES

The round-2 edits mostly fit together. Step 0 now covers every old-path hit in `.claude/bootstrap.json`. `test/old-paths.test.mjs` covers every tracked hit that `git grep` finds today, and each hit is assigned to a step. `plistTemplate()` fits `install()`. The step 10 copy has the files that the copied server needs. No blocking issue. Four small cross-section mismatches remain, listed below.

### Blocking issues
- None.

### Non-blocking concerns
- [Consistency / restart order] Step 14 drops `npm run restart`. Hard rules (plan line 23) say: pgrep, then `scripts/setup-macos.sh`, then `npm run restart`, then the scout install. Step 14 (plan line 100) gives the same order as "`pgrep`, then `scripts/setup-macos.sh`, then the scout install", with no restart. This causes no harm here: the `__SCRIPT__` path changes, so `cmp -s` fails at `scripts/setup-macos.sh:72` and setup does bootout and bootstrap itself (lines 76-90). Still, an owner who reads only step 14 gets an order that differs from the rule. Suggestion: write step 14 as "pgrep, then setup-macos.sh, then npm run restart, then the scout install", or only point to Hard rules.
- [Consistency / step 10 docs copy] The two descriptions of `copyDashboard` do not match. Affected files (plan line 57) says it copies "`apps/`, `scripts/` and `skills/`". Step 10 (plan line 96) also moves the `docs/` copy into it (today at `scripts/docs-media.mjs:50`). The copied server needs `docs/` (`scripts/plans-dashboard.mjs:947`, `:1228`). Suggestion: add `docs/` to the Affected files line. Step 10 also has a comma splice: "`copyDashboard(dest)`, The copy of `docs/`…".
- [Consistency / README note] The plan says two different things about the one-time re-run note. Context (line 14) and Breaking changes (line 78) say the README says to re-run setup. Hard rules → Docs (line 29) puts the one-time note only in the release note. Step 11 (line 97) gives `README.md` only "the new paths" and puts the generic re-run sentence only in `docs/plans-dashboard.md`. Suggestion: drop `README.md` from line 78 and line 14, or tell step 11 what generic sentence the README gets.
- [Consistency / step 0 check scope] Step 0 does not say to add `apps/` to the logic scope of the rule check. The "Tests for logic changes" `check` reads "A diff that changes logic in scripts/ or skills/*/scripts/ also changes a file in scripts/test/" (`.claude/bootstrap.json:42`). After the move, the server and the scout live in `apps/`. Step 0 (plan line 85) says to change the `check` to name the new test folders, but it does not say to change the logic scope. If the owner changes only the test folder, the rule audit no longer covers changes to `apps/`. Suggestion: in step 0, say the `check` names "logic in `apps/`, `scripts/` or `skills/*/scripts/`".
- [Consistency / step 4 form] The plan names two forms for `plistTemplate`. Step 4 (line 90) writes `export const plistTemplate = () => …`. Affected files (line 48) says `export function plistTemplate()`. Both forms work. Suggestion: use one form. After the change, `here` in `install()` (`scripts/scout.mjs:568`) has no use: remove it in step 4.
- [Tests / old-paths] Step 1b does not say how the test skips binary files or which folder it runs from. The test "reads each text file" (line 110), but `git ls-files` also lists the PNG files and the video in `docs/`. Suggestion: skip files that contain a NUL byte. Run `git ls-files` with `cwd` set to the repo root, built from `import.meta.url`, so the test does not depend on the folder `node --test` starts in.

### Edge cases the plan should address
- A Mac where the login service uses a different domain or port. `scripts/setup-macos.sh` asks for the domain and uses port 4899 when no `--port` is given (`scripts/setup-macos.sh:19`, `:37-40`). If the owner presses Enter on a Mac set up with `--port 4900`, the port changes. The Open items should say: re-run setup with the same `--domain` and `--port` as before.
- The time between `git pull` and `setup-macos.sh`. The old server is still running. It starts new chats from `scripts/chat-relay.mjs` (`CHAT_RELAY`, `scripts/plans-dashboard.mjs:1834`) and the scout from `scripts/scout.mjs` (`:1258`). After the pull, both paths are gone. The Open items should say: do not start a chat or a scout run until setup has run.
- The new docs-media test copies `docs/` (7.7 MB) and `skills/` without `node_modules/` on every `npm test` run. This is acceptable, but the test must delete its temp folder when it ends.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [ ] Restart after dashboard changes respected (step 14 summary drops `npm run restart`)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

Evidence for the checked items:
- I ran `git grep` for the old-path patterns, without `.plans/` and `changelog.d/`. Every hit is in a file that the plan changes: step 0 (the `.claude/` and `.codex/` files and `AGENTS.md`), step 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 or 12.
- The scout test import `'../scout.mjs'` still resolves after the move. `skills/browser-usability-test/scripts/compare.mjs:59` imports `../../../scripts/page-versions.mjs`, which stays.
- The run's allow list has `git mv*` and `mkdir*` (`.claude/scripts/auto-pipeline.sh:215`, `:218`).
- `render.mjs:435` builds the `plan-lanes.mjs` roots from `layout.folders`.
- `/api/scout` is at `scripts/plans-dashboard.mjs:2723`. `DASH_NO_SUMMARY`, `QA_REPORTS_PORT` and `CLAUDE_TMP` exist (`:45-49`).
- `changelog-validate.mjs` exists in `.claude/scripts/`.

```
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 14, write the full order from Hard rules: pgrep -fl chat-relay.mjs, then scripts/setup-macos.sh, then npm run restart, then node apps/scout/scout.mjs --install where ~/.claude/scout.json exists. Or point only to Hard rules → Restart, without a shorter list (evidence: plan line 23 vs line 100).
2. In Affected files, add docs/ to the folders that copyDashboard(dest) copies, to match step 10. In step 10, fix the comma splice "copyDashboard(dest)`, The copy" (evidence: plan lines 57, 96; scripts/docs-media.mjs:50).
3. Make the README re-run note match in all sections. Drop README.md from the re-run note in Context and Breaking changes, or tell step 11 which generic present-tense sentence README.md gets (evidence: plan lines 14, 29, 78, 97).
4. In step 0, say that the "Tests for logic changes" check names "logic in apps/, scripts/ or skills/*/scripts/", so the rule audit covers apps/ (evidence: .claude/bootstrap.json:42).
5. Use one form for plistTemplate in step 4 and in Affected files. In step 4, remove the `here` variable that install() no longer uses (evidence: plan lines 48, 90; scripts/scout.mjs:568).
6. In the old-paths test, skip binary files (for example, files that contain a NUL byte). Run git ls-files with cwd set to the repo root, built from import.meta.url (evidence: plan line 110).

ADD THESE EDGE CASES:
- Open items: re-run scripts/setup-macos.sh with the same --domain and --port that the Mac uses. Otherwise the defaults (plans.test, 4899) replace a custom setting (scripts/setup-macos.sh:19, 37-40).
- Open items: between git pull and setup-macos.sh, do not start a new chat or a scout run. The old server spawns scripts/chat-relay.mjs and scripts/scout.mjs, and both paths are gone after the pull (scripts/plans-dashboard.mjs:1258, 1834).
- The docs-media copy test deletes its temp folder when it ends. It copies docs/ (7.7 MB) and skills/ on each npm test run.

Do not change anything the validation did not flag.
```
