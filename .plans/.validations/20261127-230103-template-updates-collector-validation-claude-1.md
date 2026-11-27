**Validation round:** 1

## Plan validation: 20261127-230103-template-updates-collector.md

**Verdict:** APPROVE WITH CHANGES

The plan is well grounded: every symbol it cites in `upgrade-run.mjs`, `render.mjs`, `server.mjs` and `app.js` exists as described, the mirror of phase 1 is faithful, and the hard rules are addressed. Two blocking gaps are in the "generic / public" check of the collector: the secret check would refuse ordinary template prose, and the text that reaches the public PR body and the committed changelog is never checked for project names.

### Blocking issues

- [Public repo: no private data] The generic check covers only `out/` files, but the collector also publishes Claude-written text from `collect.json` (feature `title`, `why`, `skipped[].reason`, `questions`) in the draft PR body (public as soon as `gh pr create` runs) and in the committed `changelog.d/<date>-bootstrap-collect-<hash>.yaml` (`summary`/`internal` "from the feature titles"). — Plan lines 28, 140 (step 12 checks "for each out file" only), 141 (step 13 body + changelog); `upgrade-run.mjs:68-73` `redactText()` removes emails/tokens/IPs but no project names. The session's input `task.json` carries `excerpt` text copied from project files (plan line 23, step 11), so a project or client name in a title or reason is likely. — A project folder name (possibly a client name) lands in a public PR and in `main`. — Extend `checkCollect()` to run the same name/email/home-path/secret check on every text field of `collect.json` that goes to the PR body, the changelog or the commit, refuse the run on a hit, and add test cases ("a feature title with `acme-web` fails, no PR body file, no commit"; same for a `skipped` reason and a question).

- [Edge cases / broken work] "A secret pattern (the patterns of `redactText()`)" as a refusal rule on added template lines matches plain English. `redactText()` uses `/\b(Bearer|token|key|secret|password)([=: ]+)\S+/gi` (`upgrade-run.mjs:73`): the space is in the separator class, so "a token that stays valid", "a cache key, an event channel", "no password, token, key or other secret" all match. The current templates already hold about 24 such lines (for example `templates/core/dot-claude/skills/skill-4-verify/security-checklist.md:36,50,72,73`, `templates/modules/codex/dot-codex/skills/validate-plan/SKILL.md:22,74`). — Plan lines 28, 140. — A collector run fails on most security or rules features, the kind of text these templates hold. — Define a separate, narrow secret check in `collect-run.mjs` (for example `=`/`:` with no space and a value of 8+ non-space characters, `sk-…`, `ghp_…`, `AKIA…`, credentials in a URL, the `<redacted>`/`<email>`/`<id>`/`<ip>` markers that `redactText()` leaves in excerpts), and add a test that an added line "a token that stays valid after revocation" passes while `token=sk-test-0000` fails.

### Non-blocking concerns

- [Global rules / routing] `skills/bootstrap-project/SKILL.md:11` says: when `$ARGUMENTS` has `--unattended <task.json>`, read `refs/unattended.md` and follow only it. `/bootstrap-project --collect --unattended <task.json>` matches that sentence too, and the collect run folder has no `refs/unattended.md`. Step 9 only adds a sentence. — Rewrite line 11 so `--collect` is checked first ("With `--collect --unattended <task.json>`: read `refs/collect.md`. Else with `--unattended <task.json>`: read `refs/unattended.md`."), not a second sentence that conflicts with the first.
- [Edge cases] Step 16 compares `realpathSync(root)` with `realpathSync(COLLECT_REPO)` in `fullState()`. A registered root that is gone makes `realpathSync` throw, and a throw in `fullState()` fails all of `/api/state` (`server.mjs:676-690`). The precedent `ownRepo()` wraps it in try/catch (`server.mjs:2024-2027`). — Compute the collector root's realpath once, and wrap the per-project realpath in try/catch (a missing root gives `null`).
- [Discrepancy] `bootstrapCollectRunOf()` reads `prState` from `prLists[COLLECT_REPO]`, but `prLists` is keyed by the registered `proj.root` (`server.mjs:569`, `1079`, `1648`). When the registry path and `DASH_REPO` differ (a symlink, `~` form), `prState` stays undefined and the chip shows "collect PR #n" after the merge. — Take `prState` from `prLists[<the matched project's root>]`.
- [Public repo] The name check uses only `project` (the folder basename). A client name from the project's `bootstrap.json` (`project.client`, `project.title`, `project.remote` owner) is not checked. The script, not Claude, can read `<repo>/.claude/bootstrap.json` of each wave repo. — Add those values to the refused-names list (length ≥ 3), and test a client name that is not the folder name.
- [Edge cases] A common folder name (`api`, `web`, `frontend`, `docs`) as a refused word fails many generic features. — Say in the plan what happens then (the run fails with the name, and the owner edits by hand), or skip names that are common template words. Owner choice, so write it down as a question if you do not decide.
- [Reference implementation] Today the upgrade session sees only repo paths (`task.json` `path` is the repo path, `contracts.md:147`; `unattended.md:14`), so `templateUpdates[].path` is in practice a repo path (`.claude/scripts/auto-pipeline.sh`), not a template path (`core/dot-claude/scripts/auto-pipeline.sh`). The fake claude even uses `templates/x` (`test/bootstrap-upgrade-run.test.mjs:50`). — In `references/collect.md` (step 8), say that `path`/`repoPath` are repo paths, and that the session maps them to template paths (`dot-` prefix, `.tmpl` suffix, `render.mjs` `repoPath()` at `render.mjs:760`).
- [Scope / goal] Grouping by exact normalized `(path, feature)` text (step 11) rarely merges the descriptions of two different Claude sessions. The real duplicate removal is the collector session's job (a `features[]` entry can list ids of several groups). — Say this in `collect.md` ("merge updates that describe the same feature, also across groups"), and add a test where two groups with different wording become one feature.
- [Breaking changes] `openUpgradeReport(project, hash)` changes its signature (step 17), and its only caller is the shared `data-bsreport` handler (`app.js:599-600`), which passes `el.dataset.hash`. The prefix `bootstrap-upgrade-` is hard-coded at `app.js:3440,3445,3446`. The plan does not say how the prefix reaches the handler. — Add a `data-prefix` (or `data-slug`) attribute, update the one handler, and list the change under Breaking changes.
- [Browser test] "What to compare" says "the claude-config card shows …", but the test dashboard runs with `DASH_COLLECT_REPO=<temp repo>` and `HOME=<temp home>`. The chip shows on the temp repo's card. — Say "the card of the temp collect repo".
- [Tests] Step 6 adds `FAKE_UPDATE`. The setup clears the fake env keys at `test/bootstrap-upgrade-run.test.mjs:114`. — Add `FAKE_UPDATE` to that list.
- [Tests] The dashboard success case expects the run to fail "at the fetch". That holds only when the `collect-repo` fixture has `.claude/bootstrap.json` and the fetch stays before `branchPrs()` (step 10 order). — Name the fixture file, and assert `step: 'prepare'` and a fetch error. Also add a concurrent double POST case (as for the upgrade, `apps/dashboard/test/dashboard.test.mjs:2114`).
- [Edge cases] The verify step (`node --test test/bootstrap-project.test.mjs`, 54 tests) and the changelog check have no timeout. — Give them a timeout like `INSTALL_TIMEOUT_MS` (`upgrade-run.mjs:331`).
- [Docs] `server.mjs` documents its env overrides in the `--help` text (`QA_HOME` near `server.mjs:94`). — Add `DASH_COLLECT_REPO` there.
- [Edge cases] The wave key is the `templatesHash()` of the dashboard's main checkout at upgrade time. The collector edits the templates of `origin/<base>`, and they can be newer. — Write both hashes in the report and the PR body, so the owner sees when the base moved.
- [Docs] `docs/roadmap.md:33` still says "phase 1 … is planned, phases 2–5 are not written yet". — Optional: update that line in the same change (the parent plan already names this plan).

### Edge cases the plan should address

- A Claude title, reason or question that names a project — it reaches a public PR body and `main` (blocking 1).
- Template prose with "token", "key", "secret" or "password" followed by a word — the run fails with no reason (blocking 2).
- A registered project root that is gone — `fullState()` must not throw.
- Two sessions that describe the same feature in different words — duplicates are the goal of the plan.
- An `out/` file with `<redacted>` or `<email>` markers copied from a redacted excerpt — it must be refused.
- A double click on the chip (two POSTs at once) — only one run.
- A collected wave whose PR the owner closes — documented (the wave stays collected). Say in `docs/plans-dashboard.md` how the owner starts again.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (checked: `upgrade()`, `upgradeInWorktree()`, `checkDecisions()`, `runClaude()`, `branchPrs()`, `prBody()`, `writeReport()`, `resumeCommand()`, `renderHash()`, `MODULES`, `bootstrapRunOf()`, `bootstrapUpgrade()`, `bootstrapCheck()`, `fullState()`, `crossSiteReason()`, `/api/report`, `bootstrapUpgradeChip()`, `bootstrapRunChip()`, `openUpgradeReport()`, the `qa-icon.mjs` import, lesson 16)
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done): `openUpgradeReport()` is missing
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope: no auth, so cross-site 403 is the access case; 400 for a bad hash
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected: blocking 1
- [x] Global rules affect every project respected: but see the SKILL.md routing concern
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; shapes are documented in `contracts.md`)
- [x] "How to verify" commands are real and can fail (`npm test` globs `apps/*/test/*.test.mjs test/*.test.mjs`, `package.json:8`; `changelog-validate.mjs --base` exists)

```
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Extend checkCollect() (step 12) so it runs the same checks (project names, emails, home paths, secrets) on every collect.json text field that reaches the PR body, the changelog entry or the commit message: features[].title, features[].why, skipped[].reason, questions[]. A hit fails the run before any write. Add tests: a title with acme-web, a skipped reason with acme-web and a question with ana@example.test each fail with no PR body file and no commit. Update the decision at line 28 and the Public repo hard rule to match. (evidence: plan lines 28, 140, 141; upgrade-run.mjs:68-73 removes no project names)
2. Replace "a secret pattern (the patterns of redactText())" in the out/ check with a narrow secret check of its own: a key=value or key:value with no space and a value of 8+ non-space characters, sk-/ghp_/AKIA prefixes, credentials in a URL, and the <redacted>/<email>/<id>/<ip> markers. redactText() matches plain English ("a token that stays valid", "a cache key") because its separator class holds a space. Add a test: the added line "a token that stays valid after revocation" passes, and "token=sk-test-0000" fails. (evidence: upgrade-run.mjs:73; templates/core/dot-claude/skills/skill-4-verify/security-checklist.md:36,50,72,73)

SHOULD FIX:
1. Step 9: rewrite SKILL.md "Unattended mode" so --collect is checked first (collect -> refs/collect.md, else -> refs/unattended.md). Do not add a second sentence that conflicts with line 11. (evidence: skills/bootstrap-project/SKILL.md:11)
2. Step 16: wrap the per-project realpathSync in try/catch (a missing root gives null), as ownRepo() does. (evidence: apps/dashboard/server.mjs:2024-2027, 676-690)
3. Step 16: read prState from prLists[<the matched project's root>], not prLists[COLLECT_REPO]. (evidence: apps/dashboard/server.mjs:569, 1079)
4. Steps 10/12: add project.name, project.client, project.title and the project.remote owner from each wave repo's .claude/bootstrap.json to the refused-names list. Add a test with a client name that is not the folder name. (evidence: skills/bootstrap-project/references/contracts.md:86-88)
5. Step 8: in collect.md, say that path and repoPath are repo paths, and that the session maps them to template paths (dot- prefix, .tmpl suffix, render.mjs repoPath()). Also say that the session merges updates that describe the same feature across groups. Add a test where two different wordings become one feature. (evidence: references/unattended.md:14,22; render.mjs:760; test/bootstrap-upgrade-run.test.mjs:50)
6. Step 17: say how the report prefix reaches the shared data-bsreport handler (for example a data-prefix attribute). List the openUpgradeReport() signature change under Breaking changes. (evidence: apps/dashboard/page/app.js:599-600, 3437-3446)
7. Browser test: replace "the claude-config card" with "the card of the temp collect repo". (evidence: plan lines 191-192)
8. Step 6: add FAKE_UPDATE to the cleared env keys in setup(). (evidence: test/bootstrap-upgrade-run.test.mjs:114)
9. Dashboard E2E: name the collect-repo fixture (.claude/bootstrap.json with git.base) and assert a failure at step prepare (the fetch). Add a concurrent double-POST case. (evidence: apps/dashboard/test/dashboard.test.mjs:2114)
10. Step 13: give the verify test run and the changelog check a timeout. (evidence: skills/bootstrap-project/scripts/upgrade-run.mjs:331)
11. Step 16: add DASH_COLLECT_REPO to the server --help text. (evidence: apps/dashboard/server.mjs:94)
12. Steps 13/14: write the wave hash and the templatesHash() of the worktree in the PR body and the report. (evidence: plan line 20)
13. Say what happens when a wave repo's folder name is a common word (api, web, docs): the run fails and names the word. Or ask the owner. (evidence: plan line 140)

ADD THESE EDGE CASES:
- A Claude title, reason or question that names a project or client.
- Template prose with "token", "key", "secret" or "password" followed by a word.
- A registered project root that no longer exists.
- Two sessions that describe the same feature in different words.
- An out/ file that holds <redacted> or <email> markers copied from an excerpt.
- Two POST /api/bootstrap-collect requests at the same time.
- The owner closes a collector PR: how to start that wave again (docs).

Do not change anything the validation did not flag.
```
