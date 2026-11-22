**Validation round:** 2

## Plan validation: 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** APPROVE WITH CHANGES

The round-1 edits fit together well. The restart order, the `git mv` steps, the `IS_MAIN` guard, `copyDashboard`, `plistTemplate` and the self-relative paths all check out against the code. One gap is left. Step 0 updates only the `rule` sentence of two hard rules in `.claude/bootstrap.json`. Their `check` and `tests` fields still name the old paths. Those fields are rendered into `.claude/skills/`, and the run cannot write `.claude/`. So the plan's own "must print nothing" grep would fail, and the rule audit would look for `scripts/test/`, a folder the plan deletes.

### Blocking issues
- [Discrepancy / How to verify] Step 0 updates "the hard rule 1 text" and "the rule 'Tests for logic changes'", but not the `check` and `tests` fields of those rules. — `.claude/bootstrap.json:17` (check: "A run that touches scripts/plans-dashboard.mjs or scripts/plans-dashboard/ …"), `.claude/bootstrap.json:42` (check: "A diff that changes logic in scripts/ or skills/*/scripts/ also changes a file in scripts/test/."), `.claude/bootstrap.json:44` (tests: "node --test on the matching scripts/test/*.test.mjs file passes."). These fields are rendered into `.claude/skills/skill-4-verify/SKILL.md:79` and `:84`, and into `.claude/skills/skill-3-test/SKILL.md:45`. — Effects: (1) The How-to-verify grep (`scripts/plans-dashboard\|…\|scripts/test/`) hits those files and fails. The run cannot fix it, because step 0 says a headless run cannot write `.claude/`. (2) The rule audit (check 8) asks for a change in `scripts/test/`, which no longer exists, and it ignores logic in `apps/`. — Fix: in step 0, say that both fields of rule 1 (`rule` and `check`) and all three fields of "Tests for logic changes" (`rule`, `check`, `tests`) name the new paths. For example, check: "A diff that changes logic in apps/, scripts/ or skills/*/scripts/ also changes a file in apps/*/test/ or test/." and tests: "node --test on the matching apps/*/test/*.test.mjs or test/*.test.mjs file passes."

### Non-blocking concerns
- [Consistency] Step 4 says that `install()` reads the template from an inline `path.join(here, '..', '..', 'scripts', 'launchd', …)`. **Affected files** (line 48), **Wiring** (line 72) and **Tests** (line 106) say that the path comes from a new exported `plistTemplate()`. — Suggestion: in step 4, add `export function plistTemplate()`, which returns that path, and have `install()` call it.
- [Missed reference] The dashboard test's first line is `// Smoke tests for plans-dashboard.mjs.` (`scripts/test/plans-dashboard.test.mjs:1`). Step 7 names only the `npm test` header line and the chat-relay comment. The `-w plans-dashboard.mjs` grep catches it, but the step should name it. — Suggestion: add "line 1 names `server.mjs`" to step 7.
- [Docs] The new line for "Install it to run at login" goes next to `docs/plans-dashboard.md:47`, "Re-run it only to change the domain or port, or after switching Node versions…". The word "only" now contradicts the new line. — Suggestion: change line 47 to include the pull or move case, and do not add a second line.
- [Prerequisite] The roadmap entry "Move the apps out of `scripts/`" is only in the main checkout's working tree (`git diff docs/roadmap.md`). It is not on `origin/main`: `git grep -n "Move the apps" origin/main -- docs/roadmap.md` prints nothing. The run's worktree starts from `origin/main`, so step 11 has no entry to rewrite. — Suggestion: in step 0, also push `docs/roadmap.md`, with the entry linking this plan in place of "plan not written yet".
- [Ambiguity] Step 10 does not say where the existing `docs/` copy (`scripts/docs-media.mjs:50`) goes: inside `copyDashboard` or left in `newHome()`. — Suggestion: name it explicitly (keep it in `newHome()` or move it into `copyDashboard`).
- [Ambiguity] Step 0 `layout.folders` lists only the new and changed rows. It does not say that the rows `skills/` and `docs/` stay (`.claude/bootstrap.json:138-143`). `render.mjs:435` adds `docs/` and `scripts/` back by itself, but not `skills/`. If the step is read as a replacement, `skills/` drops out of the AGENTS.md layout table and out of `FOOTPRINT_ROOTS`. — Suggestion: write "keep `skills/` and `docs/`".

### Edge cases the plan should address
- The main checkout has an uncommitted edit to `scripts/plans-dashboard/app.js` (`git diff`). If that edit is committed to `main` while the run works, the merge must carry it across the rename to `apps/dashboard/page/app.js`. Commit or discard it before launch.
- The session-tabs plan (`.plans/20261122-133231-…`) touches the same page files. Do not run it at the same time as this plan (the Context only says to update its paths after the merge).

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (the roadmap entry exists only uncommitted)
- [x] Reference implementation mirrored, deviations justified (commit `72691e7` exists; the `UI_DIR` and `DASH_REPO` changes match)
- [x] Breaking changes for changed symbols listed (consumer search done: `grep -rn` over the repo; `page-versions.mjs` consumers unchanged)
- [x] Wiring & registration matches the code
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected (setup-macos.sh is the restart; `scripts/setup-macos.sh:72-91` boots out and bootstraps when the plist changes)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail (they are real and can fail, but the grep cannot pass until step 0 covers the `check` and `tests` fields)

```
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 0, update every field that names an old path, not only the rule sentences: hard rule 1 "rule" and "check" (.claude/bootstrap.json:16-17), and "Tests for logic changes" "rule", "check" and "tests" (.claude/bootstrap.json:41-44). Example: check "A diff that changes logic in apps/, scripts/ or skills/*/scripts/ also changes a file in apps/*/test/ or test/."; tests "node --test on the matching apps/*/test/*.test.mjs or test/*.test.mjs file passes." Without this, the rendered .claude/skills/skill-4-verify/SKILL.md:79,84 and .claude/skills/skill-3-test/SKILL.md:45 keep the old paths, the How-to-verify grep fails, and the run cannot write .claude/ to fix it. (evidence: .claude/bootstrap.json:17, :42, :44)

SHOULD FIX:
1. In step 4, add the exported plistTemplate() that returns the template path, and have install() call it, so step 4 agrees with Affected files, Wiring and Tests. (evidence: plan lines 48, 72, 88, 106)
2. In step 7, also change line 1 of the dashboard test ("Smoke tests for plans-dashboard.mjs") to name server.mjs. (evidence: scripts/test/plans-dashboard.test.mjs:1)
3. In step 11, change docs/plans-dashboard.md:47 ("Re-run it only to …") so it includes the after-pull or after-move case, and do not add a second line that contradicts it. (evidence: docs/plans-dashboard.md:47)
4. In step 0, also push docs/roadmap.md with the "Move the apps out of scripts/" entry (linking this plan); today the entry is only uncommitted in the main checkout, and the run's worktree from origin/main would not have it for step 11. (evidence: git diff docs/roadmap.md; git grep "Move the apps" origin/main -- docs/roadmap.md prints nothing)
5. In step 10, say whether the docs/ copy (scripts/docs-media.mjs:50) stays in newHome() or moves into copyDashboard. (evidence: scripts/docs-media.mjs:50)
6. In step 0, say that the layout.folders rows skills/ and docs/ stay. (evidence: .claude/bootstrap.json:138-143, skills/bootstrap-project/scripts/render.mjs:435)

ADD THESE EDGE CASES:
- Commit or discard the uncommitted scripts/plans-dashboard/app.js edit in the main checkout before launch, so the merge does not have to carry it across the rename.
- Do not run the session-tabs plan at the same time as this plan: both touch the page files.

Do not change anything the validation did not flag.
```
