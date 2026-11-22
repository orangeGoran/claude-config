**Validation round:** 1

## Plan validation: 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The move plan is mostly accurate. Every path, symbol and relative-path fix it names checks out against the code (`DASH_REPO`, `UI_DIR`, `CHAT_RELAY`, `SCOUT_SCRIPT`, scout `install()`, `setup-macos.sh`, `setup.sh`, the three test heads, `docs-media.mjs` `newHome()`). One verify step fails even when the work is right: its own grep hits the roadmap entry. Some references are missed because they use the bare file name `plans-dashboard.mjs`, so the grep cannot find them. The post-merge guidance should also warn against `npm run restart` before the setup script runs again.

### Blocking issues
- [How to verify] The plan's own grep fails when the work is done correctly. — `docs/roadmap.md:28` names `restart-dashboard.mjs` in the entry text. Step 11 (plan line 91) only adds "built" to the end of that entry. The pattern `restart-dashboard` (plan line 128) matches it, and plan line 132 allows hits only in `changelog.d/`, `.plans/` and `AGENTS.md`. — Correct work then looks like a missed reference, and the run either "fixes" the roadmap or reports a false failure. — Rewrite the roadmap entry in step 11 so it names the new layout (`apps/dashboard/`, `apps/scout/`) and links this plan file in place of "plan not written yet", with no old file names. Or add `docs/roadmap.md` to the allowed hits on line 132.

### Non-blocking concerns
- [Discrepancies / missed references] The bare file name `plans-dashboard.mjs` is stale in several places that the grep cannot catch, because its pattern needs the `scripts/` prefix. — `skills/bootstrap-project/references/contracts.md:9,10,12,13,14` (`plans-dashboard.mjs` `pipelineLive`, `lanesHtml`, `WRAPPER_LAUNCHER`, PR detection, `worktreeOf`). `skills/bootstrap-project/scripts/verify.mjs:84,99`. Step 12 only covers text that says `scripts/plans-dashboard.mjs`. — Extend step 12 to rename the bare `plans-dashboard.mjs` mentions to `server.mjs` (or `apps/dashboard/server.mjs`). Add `plans-dashboard\.mjs` (without the prefix) to the verify grep.
- [Discrepancies] The server header says `pipeline-projects.example.json` is "next to this file". That is no longer true after the move, because the example file stays in `scripts/`. — `scripts/plans-dashboard.mjs:10` and `:86` (the `--help` text). — In step 2, change these lines to name `scripts/pipeline-projects.example.json`, or move the example file too and update `docs/plans-dashboard.md:80` and `docs/add-project.md:102`.
- [Commands / headless run] Step 1 uses plain `mv` (and deletes the empty `scripts/test/`). The run overlay allows `Bash(git mv*)` and `Bash(mkdir*)`, but it has no `mv` or `rmdir` rule. — `.claude/scripts/auto-pipeline.sh:212-220`; `RUN_EXTRA_ALLOW` at `:55`; `.claude/bootstrap.json:168` `"runAllow": []`. The reason the plan gives for not using `git mv` does hold: `.claude/skills/skill-2-implement/SKILL.md:69` forbids index writes. Not verified: whether `--permission-mode acceptEdits` (`auto-pipeline.sh:429,459`) auto-approves `mv` inside the worktree. If it does not, the run stops at step 1. — Confirm that `mv` works in a headless run, or add `Bash(mv *)` to `pipeline.runAllow` (and render it) before the launch. Git does not track an empty `scripts/test/`, so the "remove the empty folder" part can go.
- [Restart after dashboard changes] Between the pull and `scripts/setup-macos.sh`, the running server still holds the old paths. It spawns `scripts/chat-relay.mjs` for new chats (`scripts/plans-dashboard.mjs:1834,1885`) and `scripts/scout.mjs` for Scout runs (`:1189,1258`). Both files are gone after the pull. Worse, the AGENTS.md rule (`AGENTS.md:9`) tells the owner to run `npm run restart`. That command does `launchctl kickstart -k` on the old plist (`scripts/restart-dashboard.mjs:27`), whose `__SCRIPT__` names the missing file. The service then fails to start and loops under `KeepAlive` (`scripts/launchd/com.plans-dashboard.plist.template:40`). — In the Open item (plan line 22) and the release note, say: "run `scripts/setup-macos.sh --domain plans.test` right after the pull; do not run `npm run restart` before it". The `--domain` flag skips the prompt (`scripts/setup-macos.sh:37-40`).
- [Edge / scout install] The post-merge step `node apps/scout/scout.mjs --install` installs the daily job on every Mac, including one that never installed the scout. `install()` does not check for `~/.claude/scout.json` (`scripts/scout.mjs:567-582`), but `setup.sh` installs it only when that file exists (`scripts/setup.sh:74-77`). — Say "only on a Mac where `launchctl print gui/$(id -u)/com.plans-dashboard.scout` succeeds (or `~/.claude/scout.json` exists)".
- [Reference implementation / existing pattern] The `IS_MAIN` guard planned for `docs-media.mjs` (`process.argv[1] === fileURLToPath(import.meta.url)`) differs from the repo's existing main-module check. — `scripts/scout.mjs:624` uses `import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href`. A plain string compare can break when the repo is reached through a symlink, because the ESM URL is the real path. — Mirror the scout check.
- [Tests] The `copyDashboard` test says to set `process.env.CHROME = '/nonexistent'` "first". ES module static imports are hoisted, so this works only with a dynamic `await import('../../../scripts/docs-media.mjs')` after the assignment. — Plan line 103. — Name the dynamic import explicitly. Also put the copy at `<tmp>/Workspace/claude-config`, as `newHome()` does (`scripts/docs-media.mjs:46-47`). The server scans `path.dirname(DASH_REPO)` (`scripts/plans-dashboard.mjs:1059`), and a copy directly in the temp folder would scan the whole system temp folder.
- [Template gaps] Affected files does not list the two new exports: `plistTemplate()` in `scout.mjs` (plan line 102) and `copyDashboard()` in `docs-media.mjs` (plan line 90). The Wiring table does not list them either. Line 55 also does not say whether `newHome()` keeps its `docs/` copy (`scripts/docs-media.mjs:50`). — Add both exports to Affected files and Wiring, and say whether `newHome()` still copies `docs/` itself.
- [Docs: current state only] The new docs line in step 11 ("Moved the repo or pulled a version that moved the server?") points at a past version change, and Hard rules (plan line 28) says no such note goes into the docs. — Write it in the present tense, for example: "When the login service names a script that does not exist (for example after you move the repo), run `scripts/setup-macos.sh` again; it writes the current path."
- [Rule audit during the run] Until the owner's step 14, the rendered rule checks still name the old paths. Rule 3 checks "touches scripts/plans-dashboard.mjs or scripts/plans-dashboard/", and rule 8 checks "changes a file in scripts/test/". — `.claude/skills/skill-4-verify/SKILL.md:79,84`; `.claude/bootstrap.json:16-17,41-44`. The run's `/skill-4-verify` audit can mark rule 8 as failed, because the new tests are in `apps/*/test/`. — Add a line to Hard rules that tells the audit to read these two rows with the new paths for this run (step 14 renders them after the merge).
- [Edge / plan-lanes] Until step 14, `.claude/scripts/plan-lanes.mjs:38` keeps `FOOTPRINT_ROOTS` on `scripts/plans-dashboard/` and `scripts/test/`. Its check at `skills/bootstrap-project/templates/core/dot-claude/scripts/plan-lanes.mjs:135` then reports "root … has no tracked file", and files under `apps/` do not count toward lanes. — Say in Open items that `/plans-parallel` results are wrong until step 14, and do not launch the session-tabs plan in parallel with this one.

### Edge cases the plan should address
- The owner runs `npm run restart` after the pull, as the current hard rule says, before `setup-macos.sh`. The dashboard does not come back, because the plist names a deleted file.
- The owner starts a new chat or a Scout run in the window between the pull and `setup-macos.sh`. The spawn fails silently (detached, `stdio: 'ignore'`).
- A Mac without the scout runs `node apps/scout/scout.mjs --install` and gets an unwanted daily job.
- The session-tabs plan (`.plans/20261122-133231-session-tabs-and-command-palette.md:78` names `scripts/plans-dashboard/app.js`) runs at the same time as this plan, and plan-lanes cannot see the overlap.
- The repo is reached through a symlinked path, so the `IS_MAIN` compare fails and `node scripts/docs-media.mjs` does nothing.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (verified: `scripts/plans-dashboard.mjs:36-37,53,872,1189,1227-1228,1834,2936`; `scripts/scout.mjs:568,574,624`; `scripts/setup-macos.sh:52,68`; `scripts/setup.sh:27,34,77,84`; `scripts/docs-media.mjs:22,27-28,43-53,571-578`; test heads `plans-dashboard.test.mjs:14,16`, `scout.test.mjs:15,17` (still correct after the move, unchanged), `bootstrap-project.test.mjs:11`; `docs/plans-dashboard.md` sections all exist)
- [x] Reference implementation mirrored, deviations justified (commit 72691e7 moved the page into `scripts/plans-dashboard/` with `UI_DIR`. The `mv` deviation is justified by `skill-2-implement/SKILL.md:69`, but see the headless-permission concern. `IS_MAIN` differs from the scout pattern.)
- [ ] Breaking changes for changed symbols listed (consumer search done: bare `plans-dashboard.mjs` in `contracts.md` and `verify.mjs` is missed; the `npm run restart` trap is not listed)
- [x] Wiring & registration matches the code (except that the new exports `plistTemplate`, `copyDashboard` are not listed)
- [x] Scope stays inside the goal; no open decision is taken silently (the docs-media fix is named in the Goal; the roadmap has no open decisions)
- [x] Restart after dashboard changes respected (Open items replace the restart with `setup-macos.sh`; add the warning against `npm run restart`)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (the profile notes path is under `~/.claude`, outside the repo, and is mentioned only as an Open item)
- [x] Global rules affect every project respected (root `CLAUDE.md` unchanged; `skills/` gets comment and doc changes only)
- [x] Never stop processes by name respected (tests stop servers by PID; the existing `pkill -f <sock path>` in `plans-dashboard.test.mjs:213` is unchanged)
- [x] Tests for logic changes respected
- [ ] Docs: current state only respected (the step 11 line refers to a past version)
- [x] Contracts respected (none)
- [ ] "How to verify" commands are real and can fail (they are real and can fail, but the grep's allowed-hit list is wrong for `docs/roadmap.md`)

Commands that touched a service or the database: none.

```
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 11, rewrite the docs/roadmap.md entry "Move the apps out of scripts/" so it no longer names restart-dashboard.mjs or other old file names: name apps/dashboard/ and apps/scout/, and link this plan file in place of "plan not written yet". Or add docs/roadmap.md to the allowed grep hits in "How to verify". Today the verify grep (pattern restart-dashboard) hits it even after correct work. (evidence: docs/roadmap.md:28, plan lines 91, 128, 132)

SHOULD FIX:
1. Extend step 12 to rename the bare "plans-dashboard.mjs" mentions to server.mjs / apps/dashboard/server.mjs, and add the bare pattern plans-dashboard\.mjs to the verify grep. (evidence: skills/bootstrap-project/references/contracts.md:9,10,12,13,14; skills/bootstrap-project/scripts/verify.mjs:84,99)
2. In step 2, fix the two "pipeline-projects.example.json next to this file/script" lines: they should name scripts/pipeline-projects.example.json. (evidence: scripts/plans-dashboard.mjs:10,86)
3. Confirm that plain mv is allowed in a headless run, or add Bash(mv *) to pipeline.runAllow before launch. Drop "remove the empty scripts/test/", because git does not track empty folders. (evidence: .claude/scripts/auto-pipeline.sh:55,212-220; .claude/bootstrap.json:168)
4. In the Open item and the release note, say: run "scripts/setup-macos.sh --domain plans.test" right after the pull, and do not run "npm run restart" before it (kickstart of the old plist starts a deleted file). (evidence: scripts/restart-dashboard.mjs:27; scripts/setup-macos.sh:37-40,68; AGENTS.md:9)
5. Make "node apps/scout/scout.mjs --install" conditional on the scout being installed on that Mac (launchctl print gui/$(id -u)/com.plans-dashboard.scout, or ~/.claude/scout.json exists). (evidence: scripts/scout.mjs:567-582; scripts/setup.sh:74-77)
6. In step 10, write IS_MAIN as the scout does: import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href. (evidence: scripts/scout.mjs:624)
7. In Tests, say that the copyDashboard test uses a dynamic await import() after it sets process.env.CHROME, and that it copies into <tmp>/Workspace/claude-config. (evidence: plan line 103; scripts/docs-media.mjs:46-47; scripts/plans-dashboard.mjs:1059)
8. Add plistTemplate() (scout.mjs) and copyDashboard() (docs-media.mjs) to Affected files and Wiring & registration, and say whether newHome() still copies docs/. (evidence: plan lines 55, 90, 102; scripts/docs-media.mjs:50)
9. Reword the new docs/plans-dashboard.md line in step 11 in the present tense, with no reference to a version that moved the server. (evidence: plan lines 28, 91)
10. Add a Hard-rules note that the run's rule audit reads rows 3 and 8 with the new paths (apps/dashboard/, apps/*/test/, test/) until step 14 renders them. (evidence: .claude/skills/skill-4-verify/SKILL.md:79,84; .claude/bootstrap.json:16-17,41-44)

ADD THESE EDGE CASES:
- npm run restart after the pull and before setup-macos.sh: the dashboard does not come back.
- A new chat or Scout run between the pull and setup-macos.sh: the spawn of the deleted script fails silently.
- A Mac without the scout runs --install and gets an unwanted daily job.
- The session-tabs plan runs in parallel; plan-lanes (FOOTPRINT_ROOTS at .claude/scripts/plan-lanes.mjs:38) cannot see the overlap until step 14.
- The repo is reached through a symlink: the IS_MAIN compare must still detect the main module.

Do not change anything the validation did not flag.
```

.plans/.validations/20261122-152506-move-apps-out-of-scripts-validation-1.md
