# Plan: Pipeline diet — fewer tokens in the unattended pipeline skills (bootstrap templates)

- **Base**: main
- **Parent**: `.plans/20261124-225819-pipeline-diet-parent.md`

## Goal

Cut the Claude tokens and the wall time of an unattended pipeline run in every project that the bootstrap templates set up. The plan removes steps that repeat work on the same tree, makes Codex leave the verify bug hunt by default (it stays in plan validation and in the decision sheet), and adds a read-only script, `run-usage.mjs`, that prints the tokens and the cost of each phase of one run. The review value stays: the Claude `/code-review` loop, every audit row, the secrets scan, the security pass and the test-reviewer behaviour map.

Example, end to end (made-up project `acme-api`, default answers):

1. The owner upgrades `acme-api` with `/bootstrap-project --upgrade`. `bootstrap.json` has no `pipeline.codexInVerify`, so it is false.
2. A "stop at verify" run starts. `/skill-2-implement` runs scoped tests only and leaves the full suites to `/skill-3-test`.
3. `/skill-3-test` Step 3 runs `pnpm test` once. Suite `orders.spec.ts` fails, and each failing test shows `ECONNREFUSED 127.0.0.1:5432` and no `expect(` failure. It runs again alone and passes. The evidence line is `full run: 1 failed; infra: orders.spec.ts (ECONNREFUSED), retried alone: 14 passed`.
4. `/skill-4-verify` round 1 (Claude `/code-review`) fixes one JSDoc comment only. That is no behaviour fix, so round 2 does not run. No Codex runs. `/test-review` runs at most 3 revert checks.
5. The pipeline Phase 3 runs `pnpm test` once as the regression gate. The plan's **How to verify** also lists `pnpm test`; the same run counts for it.
6. The owner runs `node .claude/scripts/run-usage.mjs .plans/auto-runs/<slug>.log` and sees one row per phase (`implement`, `test`, `verify › setup`, `verify › code-review`, `verify › test-review`, …) with tokens, cost, wall and active minutes.

## Context

- Parent plan sections: `.plans/20261124-225819-pipeline-diet-parent.md` → Plans, in order, item 1. Item 2 (tickets for defects of another repo) is a later plan; this plan keeps today's behaviour for such a finding (an open kind-6 item).
- Source: a spec validated in a private project (4 rounds; the round-4 edits were not validated again). This plan ports its skill-text changes to the generic templates. The project-only parts (a text-guard spec in that project, the before/after measurement) stay in that project and are out of scope.
- Decisions taken for this plan (owner, this session):
  - 1A — Infrastructure retry: a fixed generic list of signs in the template, no new answer field.
  - 2A — When a project sets `pipeline.codexInVerify: true`, the diet applies to the Codex variant too (same stop rule, same re-test list).
- Owner requirements from the request (not questions): Codex leaves verify by default; it stays in plan validation; a separate `bootstrap.json` answer with default "off in verify"; `run-usage.mjs` and its test are core template scripts with Commands rows and allow rules.
- Engineering choices taken in this plan (listed so the owner can object):
  - The answer is `pipeline.codexInVerify` (boolean, default `false`). The variable is `CODEX_IN_VERIFY` = `moduleOn(p, 'codex') && p.pipeline?.codexInVerify === true`. `codexInVerify: true` with `modules.codex: false` fails `checkParams()`.
  - The "When the evidence changes after the PR opened" bullet moves from `templates/partials/reporting-rules.md` to a new partial `templates/partials/reporting-rules-after-pr.md` (`@@REPORTING_RULES_AFTER_PR@@`). Only `skill-5-ship`, `decision-sheet` and `pr-feedback` use it. `skill-3-test` and `skill-4-verify` never run after a PR opened.
  - Revert checks in verify: `--max-checks 3` (the standalone default stays 10).
  - With no check-only lint command, verify runs the fixing "Lint" command once after the loop (not in each round), then the scoped tests of the files it changed, and the audit lint row uses that output.
  - The script's own test is `run-usage.selftest.mjs`, not `run-usage.test.mjs` (the name in the request): the Vitest default include (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) matches `*.test.mjs` and would run a `node:test` file inside a project's Vitest suite. `node --test <file>` runs any file name.
  - `/skill-2-implement` gets an `--unattended` flag (Phase 1 passes it), so it can tell that the pipeline called it.
  - 3B (validation round 1) — In "to PR" mode the decision sheet runs before the commit, with `--fix`: its Codex fixes go into the one commit, and the sheet still lists each fixed finding (with `file:line`) on its Codex line. A fixed finding is not a checkbox question (owner: "fix it now"; no follow-up tickets).
- Open decisions this plan does not take: None.
- Coordination with `.plans/20261124-123513-bootstrap-upgrade-run.md`: it changes `render.mjs` exports only (`export const isExecutable`, a new `baseBranch(params)` that `buildVars()` uses for `git.base`). This plan changes `checkParams()`, `unusedParts()`, `MODULE_INFO.codex` and other lines of `buildVars()` (vars, `commandRows`, `allow`). No line overlaps; the plan that merges second merges `main` first.

## Hard rules

- **Restart after dashboard changes:** not touched. No file under `apps/dashboard/` changes.
- **No npm dependencies:** `run-usage.mjs` and its test use only `node:fs`, `node:path`, `node:os`, `node:test`, `node:assert/strict` and `node:child_process`. `package.json` does not change.
- **Public repo: no private data:** fixtures and examples use the made-up project `acme-api`, made-up session ids, message ids, tool-use ids, token counts and costs. No project name, run log, path or cost from the private project goes into a file. The infra signs are generic (decision 1A). The spec's private evidence (transcript paths, run slugs, totals) is not copied.
- **Global rules affect every project:** the templates render into every bootstrapped project on its next upgrade. The changes are generic and keep each skill shorter, not longer. The root `CLAUDE.md` and the global skills in `skills/` other than `bootstrap-project` do not change.
- **Never stop processes by name:** not touched. No step starts or stops a server.
- **Tests for logic changes:** `render.mjs` logic (new answer, new variable, new partial, command rows, allow rules, `unusedParts`) gets tests in `test/bootstrap-project.test.mjs`. `run-usage.mjs` gets its own `run-usage.selftest.mjs` (it ships to each project), and `test/bootstrap-project.test.mjs` runs the rendered copy through `npm test`.
- **Docs: current state only:** `contracts.md`, `checklist.md` and the example answers describe the new answer and the new script as the current state, one line per paragraph, ASD-STE100, no history.

## Contracts

- `bootstrap.json` (`skills/bootstrap-project/references/contracts.md`, table "bootstrap.json"): new optional field `pipeline.codexInVerify` (boolean). Consumers: `render.mjs` `checkParams()`, `buildVars()`, `unusedParts()`. Unset = false.
- Template syntax (`contracts.md`, "Template syntax"): new partial `reporting-rules-after-pr.md` → `@@REPORTING_RULES_AFTER_PR@@`, and new switch `CODEX_IN_VERIFY`.
- Rendered files: two new core files `.claude/scripts/run-usage.mjs` and `.claude/scripts/run-usage.selftest.mjs`; two new rows in the rendered `AGENTS.md` and `README.md` Commands table; two new allow rules in `.claude/settings.json`.
- The dashboard contracts ("Fixed names", run report, plan-lanes JSON) do not change. `plan-lanes.mjs` `RUN_SIDE_REPORTS` keeps `-codex.md` (the decision sheet and a `codexInVerify` project still write that name).

## Reference implementation

- Closest existing pattern:
  - A switch from an answer that is not a module: `HAS_LINT_CHECK` / `stack.lintCheck` and `HAS_REVIEW_GATE` / `git.tickets.board.reviewStatus` in `render.mjs` `buildVars()`, with its `checkParams()` checks (the `reviewStatus` checks that need `git.staging` and `project.remote`).
  - A shared partial: `REPORTING_RULES` in `buildVars()` (`renderText(readFileSync(path.join(TEMPLATES, 'partials', 'reporting-rules.md'), 'utf8'), vars, …)`).
  - A core script with no CONFIG block: `templates/core/dot-claude/scripts/vscode-session-copy.mjs`.
  - A switch test: `test/bootstrap-project.test.mjs` → "codex on: verify runs the Codex code review, the sheet reuses it, …" and "the reporting rules and the browser-test gate render into the skills that report".
- Files read end to end: `templates/core/dot-claude/skills/skill-4-verify/SKILL.md`, `skill-3-test/SKILL.md`, `skill-2-implement/SKILL.md`, `skill-auto-pipeline/SKILL.md`, `templates/modules/test-review/dot-claude/skills/test-review/SKILL.md`, `templates/partials/reporting-rules.md`, `templates/core/AGENTS.md.tmpl`, `templates/core/dot-claude/settings.json`, `references/contracts.md`, `references/bootstrap.example.json`; `render.mjs` header, `checkParams()`, `moduleOn`, `MODULE_INFO`, `unusedParts()`, `CODEX_ALLOW`, `buildVars()`, `renderText()`, `renderAll()` start; the first part of `decision-sheet/SKILL.md` (Step 0, Step 2); `pr-feedback/SKILL.md` header; `verify.mjs` gitignore, scripts and placeholder checks.
- Mirror:
  - `HAS_LINT_CHECK: Boolean(str(cmd.lintCheck))` → `CODEX_IN_VERIFY: moduleOn(p, 'codex') && p.pipeline?.codexInVerify === true`.
  - `vars.REPORTING_RULES = renderText(…'reporting-rules.md'…)` → `vars.REPORTING_RULES_AFTER_PR = renderText(…'reporting-rules-after-pr.md'…)`.
  - `checkParams()` `changelog.summary` boolean check → `pipeline.codexInVerify` boolean check; the `reviewStatus` "needs git.staging" check → "codexInVerify needs modules.codex".
  - `unusedParts()` `setting` items (`tickets.evidence`, `services`) → a `setting` item `codexInVerify`.
  - `vscode-session-copy.mjs` (core script, no CONFIG) → `run-usage.mjs`; `node:test` style of `test/bootstrap-project.test.mjs` (`mkdtempSync`, `node:assert/strict`, made-up data) → `run-usage.selftest.mjs`.
- Deviations:
  - `run-usage.selftest.mjs` lives next to its script in `.claude/scripts/`, not in a `test/` folder — the rendered project has no fixed test folder, and the file must ship with the script. `test/bootstrap-project.test.mjs` runs it in this repo.
  - Commands rows for `run-usage` are fixed rows, not `stack.commands` answers — the script is part of the core setup, not a project command.

## Affected files

- `skills/bootstrap-project/templates/core/dot-claude/skills/skill-4-verify/SKILL.md` — modified: switch `MOD_CODEX` → `CODEX_IN_VERIFY` in every block; round re-test list without lint and drift; third stop reason; one lint run after the loop (no check-only command); Step 2 intro; Step 2.5 `--max-checks 3`; descriptions.
- `skills/bootstrap-project/templates/core/dot-claude/skills/skill-3-test/SKILL.md` — modified: Step 1 harness bullet; Step 2c item 4; Step 3 items 1–3 and new item 2a; red flag.
- `skills/bootstrap-project/templates/core/dot-claude/skills/skill-2-implement/SKILL.md` — modified: `argument-hint` (`--unattended`); Step 1 bullet; Step 4 item 4.
- `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md` — modified: description; Phase 1 passes `--unattended`; Phase 3 Codex bullet switch; regression-gate bullet; the decision sheet moves before the Commit phase with `--fix` (3B); the `--codex-report` switch; commit paths; pr-mode renumbering.
- `skills/bootstrap-project/templates/modules/test-review/dot-claude/skills/test-review/SKILL.md` — modified: Step 4 item 3.
- `skills/bootstrap-project/templates/modules/decision-sheet/dot-claude/skills/decision-sheet/SKILL.md` — modified: `--codex-report` (argument hint, Step 0 bullet, Step 2 item 0) and the "ran in verify" output text under `CODEX_IN_VERIFY`; `@@REPORTING_RULES_AFTER_PR@@` line.
- `skills/bootstrap-project/templates/modules/codex/dot-codex/skills/validate-implementation/SKILL.md` — modified: Input item 1 lists and reads untracked files (3B runs the review before the commit).
- `skills/bootstrap-project/templates/core/dot-claude/skills/skill-5-ship/SKILL.md` — modified: `@@REPORTING_RULES_AFTER_PR@@` line; the browser-test sheet rebuilds pass `--no-codex`.
- `skills/bootstrap-project/templates/modules/pr-feedback/dot-claude/skills/pr-feedback/SKILL.md` — modified: `@@REPORTING_RULES_AFTER_PR@@` line.
- `skills/bootstrap-project/templates/partials/reporting-rules.md` — modified: the two "after the PR opened" bullets leave.
- `skills/bootstrap-project/templates/partials/reporting-rules-after-pr.md` — new: those two bullets.
- `skills/bootstrap-project/templates/core/AGENTS.md.tmpl` — modified: the `/skill-4-verify` Codex line under `CODEX_IN_VERIFY`; the `/decision-sheet` line (runs before the commit in "to PR" mode).
- `skills/bootstrap-project/templates/core/dot-claude/scripts/run-usage.mjs` — new.
- `skills/bootstrap-project/templates/core/dot-claude/scripts/run-usage.selftest.mjs` — new.
- `skills/bootstrap-project/scripts/render.mjs` — modified: `checkParams()`, `MODULE_INFO.codex`, `unusedParts()`, `buildVars()` (`commandRows` → two fixed rows, `allow`, `chain` order (3B), `CODEX_IN_VERIFY`, `REPORTING_RULES_AFTER_PR`).
- `skills/bootstrap-project/references/contracts.md` — modified: `pipeline.codexInVerify` row; Template syntax (new partial, the switch).
- `skills/bootstrap-project/references/bootstrap.example.json` — modified: `"codexInVerify": false` in `pipeline`.
- `skills/bootstrap-project/references/checklist.md` — modified: Target state row for `run-usage.mjs`; interview question 2 names the Codex-in-verify default; "Find these yourself" `pipeline.*` row names `codexInVerify`.
- `test/bootstrap-project.test.mjs` — modified: the Codex test splits in three cases; new tests (see Tests).
- `changelog.d/20261124-pipeline-diet-templates.yaml` — new.
- Not changed, checked:
  - `templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md`, `skill-1-plan/SKILL.md`, `templates/modules/codex/`: plan validation keeps `MOD_CODEX`.
  - `templates/core/dot-claude/scripts/auto-pipeline.sh`: the `MOD_CODEX` run allow rules stay (the decision sheet and plan validation run Codex).
  - `templates/core/dot-claude/scripts/plan-lanes.mjs` (`RUN_SIDE_REPORTS`), `scripts/verify.mjs` (`.plans/.code-reviews/` gitignore line when `codex` is on), `templates/modules/codex/gitignore.fragment`: harmless when nothing writes the folder.
  - `templates/modules/test-review/dot-claude/agents/test-reviewer.md`: proposes "max 10"; `--max-checks 3` cuts the list.
  - `skill-5-ship/SKILL.md` Step with "Copy the Codex line … from the old sheet": about the decision sheet's Codex, still right.
  - This repo's own `.claude/` (rendered from `.claude/bootstrap.json`): an owner upgrade after the merge (Open items). A headless run cannot write `.claude/`.

## Wiring & registration

| Thing | Declared in | Exported by | Imported by the consumer | Registration points |
| --- | --- | --- | --- | --- |
| `CODEX_IN_VERIFY` switch | `render.mjs` `buildVars()` | the `vars` object | `renderText()` `@@IF@@` blocks in the templates | `node render.mjs --vars` lists it; `contracts.md` |
| `REPORTING_RULES_AFTER_PR` value | `render.mjs` `buildVars()` from `templates/partials/reporting-rules-after-pr.md` | the `vars` object | `skill-5-ship`, `decision-sheet`, `pr-feedback` templates | `contracts.md` Template syntax |
| `pipeline.codexInVerify` answer | `contracts.md`, `bootstrap.example.json` | — | `checkParams()`, `buildVars()`, `unusedParts()` | `checklist.md` interview |
| `run-usage.mjs`, `run-usage.selftest.mjs` | `templates/core/dot-claude/scripts/` | — | rendered by `renderAll()` (walks `core/`); `isExecutable()` makes both 755 | `buildVars()` `commandRows` (AGENTS.md and README.md), `allow` (settings.json); `checklist.md` Target state |

## Breaking changes

- Every project with `modules.codex` on (the default) loses the Codex review in `/skill-4-verify` on its next upgrade, unless it sets `pipeline.codexInVerify: true`. In "to PR" mode the decision sheet still runs Codex once (its Step 2 items 1–4). Today the pipeline calls the sheet after the one commit and without `--fix` (`skill-auto-pipeline/SKILL.md` pr step 6); decision 3B moves it in front of the commit with `--fix` (step 12), so a VALID finding with one clear fix is fixed and listed, and only an unfixed one stays a kind-6 item. In "stop at verify" and "commit" modes, no Codex reviews the code. This is the owner's requirement.
- The sheet's Codex fixes get scoped tests, lint and one full test run, but not the verify audit and not a second review. The reviewer sees each one on the sheet's Codex line (decision 3B).
- Pipeline order in "to PR" mode: Document → Decision sheet → Commit → Ship (was Document → Commit → Decision sheet → Ship). The sheet reads the working tree (`decision-sheet/SKILL.md` Step 1: `git diff <mb>`; `validate-implementation` reads `git diff` and `git diff --cached`), so it sees the uncommitted work. `git log --format=%s <mb>..HEAD` lists no commit yet; the sheet takes the change from the diff. `skill-5-ship`'s re-run after a merge ("its fixes are in the plan's commit already") becomes true as written. `run-usage.mjs` counts the sheet in `ship` (the Document phase already read `skill-5-ship/SKILL.md`). A resumed run: item 5 picks its case from the commit log and the Timeline (not from the Status, which the preflight sets to `RUNNING`). A `decision sheet: done` entry counts only with the tree mark of now, and the Commit item runs that check, so a stop after `DOCUMENTED`, or a tree that changed after the sheet, cannot skip it; a new run overwrites its `--out` file. After `FAILED: decision sheet` a resume runs only the test gate again. A run committed in "commit" mode and resumed in "to PR" mode runs the sheet after the commit without `--fix`, as today. Before the commit, a new file of the plan is untracked: `validate-implementation` now lists and reads untracked files.
- `/skill-4-verify --no-codex` exists only when `CODEX_IN_VERIFY` is on. `grep -rn "no-codex" skills/bootstrap-project/templates`: the other hits pass `--no-codex` to `/decision-sheet` (`skill-5-ship`, `pr-feedback`), never to verify. A person who types it to verify passes harmless extra text.
- `.plans/.code-reviews/<branch>-codex.md` is no longer written by verify by default. Readers: `decision-sheet` `--codex-report` (now only in the `CODEX_IN_VERIFY` variant, and the new item 5 passes it only then), `plan-lanes.mjs` `RUN_SIDE_REPORTS` and the dashboard (optional side report). None fails on a missing file.
- The "after the PR opened" bullet no longer renders in `skill-3-test` and `skill-4-verify`. It still renders in `skill-5-ship`, `decision-sheet` and `pr-feedback`.
- The test "codex on: verify runs the Codex code review, …" in `test/bootstrap-project.test.mjs` expects Codex in verify for the example answers; step 17 changes it.
- `/skill-2-implement` gets an optional `--unattended` flag. Callers: `skill-auto-pipeline` Phase 1 (changed in step 12) and a person (the flag is optional, so an old call still works).

## Steps

1. `templates/partials/reporting-rules-after-pr.md` (new): move the whole `@@IF MOD_DECISION_SHEET@@ … @@END@@` and `@@IFNOT MOD_DECISION_SHEET@@ … @@END@@` blocks of the "When the evidence changes after the PR opened" bullet out of `templates/partials/reporting-rules.md` into it, unchanged. `reporting-rules.md` keeps everything else.
2. `render.mjs` `buildVars()`: after `vars.REPORTING_RULES = …`, add `vars.REPORTING_RULES_AFTER_PR` the same way from `reporting-rules-after-pr.md` (same `.replace(/\n+$/, '')`). In `skill-5-ship/SKILL.md`, `decision-sheet/SKILL.md` and `pr-feedback/SKILL.md`, add the line `@@REPORTING_RULES_AFTER_PR@@` directly under the `@@REPORTING_RULES@@` line (no blank line, so it continues the list).
3. `render.mjs`:
   - `checkParams()`: after the `pipeline.defaultMode` check, `pipeline.codexInVerify` must be `undefined` or a boolean ("pipeline.codexInVerify must be true or false"); `true` with `p.modules?.codex === false` → "pipeline.codexInVerify needs modules.codex".
   - `buildVars()` `vars`: `CODEX_IN_VERIFY: moduleOn(p, 'codex') && p.pipeline?.codexInVerify === true`, next to `MOD_CODEX`, with a one-line comment ("Codex in the verify bug hunt; plan validation and the decision sheet use MOD_CODEX").
   - `MODULE_INFO.codex`: "Codex checks the plan a second time with another AI, and the finished code once in the decision sheet (.codex/skills/validate-plan, validate-implementation)".
   - `unusedParts()`: when `moduleOn(p, 'codex')` and `p.pipeline?.codexInVerify !== true`, push `{ group: 'setting', key: 'codexInVerify', what: 'a Codex review in each verify round, next to the Claude code review (more tokens per run)', turnOn: 'pipeline.codexInVerify = true' }`.
4. `render.mjs` `buildVars()`: add two fixed rows after `commandRows` and before `extraRows` in `commandsMd`: `| Run usage (one pipeline run) | \`node .claude/scripts/run-usage.mjs <run .log>\` |` and `| Test run-usage.mjs | \`node --test .claude/scripts/run-usage.selftest.mjs\` |`. Add `'Bash(node .claude/scripts/run-usage.mjs *)'` and `'Bash(node --test .claude/scripts/run-usage.selftest.mjs)'` to `allow` after `'Bash(gh issue view*)', 'Bash(gh run view*)'`.
5. `templates/core/dot-claude/scripts/run-usage.mjs` (new): write it to the **Calculation rules** below. Header comment in the style of `plan-lanes.mjs` (usage line, what it reads, that it writes nothing, "template: claude-config skills/bootstrap-project"). Doc comments on each exported function in ASD-STE100. Export the pure functions (`parseLog`, `phaseRows`, `allocateCost`, `formatTables`) and run `main()` only when the file is the entry point (the `realpathSync` check of `render.mjs`).
6. `templates/core/dot-claude/scripts/run-usage.selftest.mjs` (new): `node:test`, made-up fixtures written to a `mkdtempSync` folder, `--projects-dir` pointed at it, the script run with `spawnSync(process.execPath, [script, …])` for the exit-code cases and imported for the rest. The cases are in **Tests**.
7. `skill-4-verify/SKILL.md` — the switch: replace every `@@IF MOD_CODEX@@` / `@@IFNOT MOD_CODEX@@` with `@@IF CODEX_IN_VERIFY@@` / `@@IFNOT CODEX_IN_VERIFY@@` (frontmatter, the `--no-codex` and "Order matters" blocks, Step 1, row 1, the rounds block).
8. `skill-4-verify/SKILL.md` — the rounds (both variants, decision 2A):
   - Re-test item (Claude-only item 2; Codex variant item 2, which item 4.5 points to): delete "and the check-only lint and format commands again", and delete the `@@IF HAS_MIGRATIONS@@` drift block under it (the audit's **Migration drift** row runs the check after the last fix). In the Codex variant, item 2 ends "Fix a failure before the Codex part." as today.
   - Stop rules: change "as soon as one of these is true" (Claude-only) and "as soon as one of these is true" (Codex variant, "When to stop") to "any of these", and add a third bullet in both: "**No behaviour fix:** round 1 applied no finding that changed production behaviour: each applied fix changed only tests, comments or doc comments. Judge each fix from its diff hunk, not from its file name. A hunk that mixes a comment and code is a behaviour fix. When unsure, it is a behaviour fix."
   - After the stop rules and before `## Step 2`, outside both variants, add `@@IFNOT HAS_LINT_CHECK@@` … `@@END@@` with: "**After the loop:** when the Commands table has no "Lint (check only)" row and the loop changed a file, run the "Lint" command once on the files the loop touched. When it changed a file, run the scoped tests of those files again ("Test (one file)"); a failure → fix it, as in the re-test item. The Step 2 lint row uses this lint output."
   - Step 2, lint bullet: replace "and use the output of the post-review re-run" with "and use the output of the lint run after the Step 1 loop". With a check-only lint row, nothing else changes: the audit's **Lint and format** row (`AUDIT_ROWS` row 2: the check-only lint and a check-only format command on the changed files) runs on the post-loop tree, so the final tree is checked once instead of once per round.
   - Step 3 report, both variants of the **Code review rounds** sentence: "why the loop stopped: converged, only deferrals left, hit the cap, or escalated" becomes "why the loop stopped: converged, only deferrals left, no behaviour fix, hit the cap, or escalated".
   - Descriptions (frontmatter): the `IFNOT CODEX_IN_VERIFY` text says "Runs a /code-review bug-hunt loop (max 2 rounds; round 2 only after a behaviour fix)"; the `IF CODEX_IN_VERIFY` text says "max 2 rounds; round 2 only after a behaviour fix" after "max 2 rounds".
9. `skill-4-verify/SKILL.md` — Step 2 intro: replace "Read the nested `AGENTS.md` files of the touched folders. Then check the post-review tree." with "A nested `AGENTS.md` loads by itself when you read a file in its folder and a `CLAUDE.md` with `@AGENTS.md` sits next to it; do not read it again. Read only a nested `AGENTS.md` of a touched folder that has no such `CLAUDE.md`. Check the post-review tree." (The shim rule is the one `render.mjs` `hasShim()` checks.) Step 2.5: change the args to `"--fix --max-checks 3 --base @@BASE_BRANCH@@ --plan <plan file>"`.
10. `skill-3-test/SKILL.md`:
    - Step 1 harness bullet, `HAS_TEST_HARNESS_DOC` variant: replace "Read `@@TEST_HARNESS_DOC@@` before you write or debug an end-to-end test, and the nested `AGENTS.md` of any other test folder: they list the traps of the test harness." with "`@@TEST_HARNESS_DOC@@` lists the traps of the test harness. It loads by itself when you read a file in its folder and a `CLAUDE.md` with `@AGENTS.md` sits next to it: before you write or debug an end-to-end test, read one file in that folder. When no such `CLAUDE.md` sits next to it, or the folder has no other file, read `@@TEST_HARNESS_DOC@@` itself." The `IFNOT` variant: replace "Read the nested `AGENTS.md` of the test folder first, if it has one: it lists the traps of the test harness." with "A nested `AGENTS.md` of the test folder, if there is one, lists the traps of the test harness. It loads by itself when you read a file in its folder and a `CLAUDE.md` with `@AGENTS.md` sits next to it: before you create a test file there, read one file in that folder. When no such `CLAUDE.md` sits next to it, or the folder has no other file, read the `AGENTS.md` itself."
    - Step 2c item 4: append "Step 3 runs the full suites."
    - Step 3 item 1: replace "Run each full test command once, not scoped" with "Run each full test command once per tree state, not scoped", and "and "Test (end to end)" when the scope has end-to-end tests" with "and "Test (end to end)" when the plan's **@@PLAN_TESTS@@** section lists end-to-end tests, the plan's **@@PLAN_VERIFY@@** lists the command, or the change adds or changes an end-to-end test or an entry point that one covers".
    - New item 2a after item 2 (decision 1A): "A fix in this step changes the tree: after it, run the full commands of item 1 again. A failed full run stays in the evidence: write its counts. A failed suite gets one retry alone (its file with "Test (one file)", or with the file filter of "Test (end to end)") in three cases only: (1) every failing test in it shows a connection sign (`ECONNREFUSED`, `ECONNRESET`, `socket hang up`, a timeout while it connects to a service), and none shows an assertion failure (`expect(`, `Expected`, `Received`, `AssertionError`); (2) the suite crashed with a signal (`SIGSEGV`, `SIGKILL`) before it reported any test; (3) in the same full run, the suite failed after a suite of case 1, with the same connection sign and no assertion failure. Any other failure gets no retry. The gate passes only when each failed suite qualified and its retry passed; write `full run: <counts>; infra: <suite> (<sign>), retried alone: <counts>`. Any other failure, a failed retry, or a retry that cannot start keeps the gate failed: fix it (or report it as open), then run the full command again. Take the counts from the saved output (search it with the Grep tool). Never run a suite again only to read its counts."
    - Item 3: after "Check for 0 failed" add "(or only infra failures that item 2a cleared)".
    - Red flags: add "- A partial run reported as the full run (a retry under item 2a is not a partial run; it adds to the full run)."
11. `skill-2-implement/SKILL.md`:
    - Frontmatter `argument-hint`: `"<plan file> [--unattended]"`.
    - Step 3 item 3 (scoped run): "when that row is "not available yet", say so once and run "Test (full)" at the end of the plan instead" gets "(with `--unattended`, skip that run too: `/skill-3-test` Step 3 runs it)".
    - Step 1, second bullet: delete ", and every nested `AGENTS.md` in the folders the plan touches" and add a third bullet: "A nested `AGENTS.md` loads by itself when you read a file in its folder and a `CLAUDE.md` with `@AGENTS.md` sits next to it. Before you create a file in a folder where you read no file yet, read one file there (for example a neighbouring test), so its rules load first. Read the `AGENTS.md` itself only when no such `CLAUDE.md` sits next to it, or the folder has no other file."
    - Step 4 item 4: replace with "Run every command in the plan's **@@PLAN_VERIFY@@** section that this step can run, and record the result. With `--unattended` (set by `/skill-auto-pipeline`), skip the full "Test (full)" and "Test (end to end)" runs: `/skill-3-test` Step 3 runs them after the test phase changes the tree. Without it, run them."
12. `skill-auto-pipeline/SKILL.md`, Phase 1: change "invoke `/skill-2-implement <plan-file>`" to "invoke `/skill-2-implement <plan-file> --unattended`". Phase 3:
    - The `@@IF MOD_CODEX@@` bullet becomes `@@IF CODEX_IN_VERIFY@@` (text unchanged).
    - Move the regression-gate bullet ("If its code-review loop, its Codex fixes or its test review changed a file, …") above the "Run every command in the plan's …" bullet, and replace "its code-review loop, its Codex fixes or its test review" with "its review loop (with the lint run after it) or its test review". Append to it: "When the plan's "@@PLAN_VERIFY@@" also lists the "Test (full)" command, this run counts for it: do not run it twice on the same tree. A fix round of this phase changes the tree: run it again after that round."
    - The "Run every command in the plan's "@@PLAN_VERIFY@@" yourself" bullet: append "(except a "Test (full)" command that the regression gate already ran on the same tree)."
    - pr step 6 (moves to item 5 below): its inner `@@IF MOD_CODEX@@` block with `--codex-report` becomes `@@IF CODEX_IN_VERIFY@@`.
    - Decision 3B — the sheet moves in front of the commit, inside `@@IF MOD_DECISION_SHEET@@`:
      - Delete item 6 **Decision sheet** from the "pr mode" list. Add a new item `5. **Decision sheet**` (the style of `4. **Document**`) between item 4 and the commit item, which becomes `6. **Commit**`; the pr-mode items `7. **Ship**` and `8.` keep their numbers. Everything of item 5, and each sheet line in other items below, is inside `@@IF MOD_DECISION_SHEET@@`. With the module off, the list goes 4 → 6, as the pr-mode list goes today without its item 6. Item 5 text:
        "5. **Decision sheet** — `--stop-after=pr` only.
           1. **Tree mark.** The tree mark is the output of `git diff --shortstat` plus the number of lines of `git status --porcelain` (two bare commands). Each `decision sheet: done` entry ends with `tree: <mark>`.
           2. **Which case.** Decide from facts that survive a resume (the preflight sets the Status to `RUNNING`, so the Status does not tell). In this order:
              - `git log --format=%s <base>..HEAD` lists the plan's commit → item 6 (after the commit).
              - Else a Timeline entry, after its `- HH:MM:SS — ` prefix, starts with `decision sheet: done` and its `tree:` mark equals the mark now → done; go to the Commit item.
              - Else a Timeline entry starts (after the prefix) with `decision sheet: gate failed` and no `decision sheet: done` entry follows it → item 7 (after a failed gate).
              - Else → item 3 (before the commit; this also covers a tree that changed after an earlier `done` entry).
           3. **Before the commit.** Run `git status --porcelain` and keep the list. Read `.claude/skills/decision-sheet/SKILL.md` and follow it with `--base <base> --plan .plans/done/<plan-file> --report <report> --out <report dir>/<slug>-decision-sheet.md`" + (inside `@@IF MOD_CODEX@@`) " and `--fix`, so its fixes are part of the one commit" + the existing `@@IF CODEX_IN_VERIFY@@` `--codex-report` block + ". Then run `git status --porcelain` and `git diff --shortstat` again.
           4. **No change** (the tree mark and the list are the same as before the sheet: its Codex part was OFF, found nothing to fix, or the sheet failed before it changed a file) → write `decision sheet: done (<status>, <n> questions, <path>; tree: <mark>)`, or `decision sheet: done (failed: <reason>; tree: <mark>)`. A sheet failure without a changed file never blocks the run. Any change (also from a sheet that failed after it changed a file) → item 5.
           5. **Test gate.** Run "Test (one file)" and the check-only lint (or "Lint") for each file that changed, then the "Test (full)" command once (a row that is "not available yet" is skipped with that reason). A failure → fix it, at most the failure budget. Still failing → write `decision sheet: gate failed (<files>)`, set status `FAILED: decision sheet`, put the files and the output under `## Diagnosis`; do not commit, and end the session. Passed → write `decision sheet: done (<status>, <n> questions, <n> fixed, <path>; tree: <mark>)`.
           6. **After the commit** (a run resumed from "commit" mode into "to PR" mode). Follow the sheet as in item 3, without `--fix` (its VALID Codex findings stay open items for the reviewer, so the one commit stays one commit), and write `decision sheet: done (after the commit, no fixes; tree: <mark>)`.
           7. **After a failed gate.** Do not run the sheet again (its sheet file and its fixes are there). Run item 5 again on the files that `decision sheet: gate failed` names."
      - Item 6 **Commit**: a first sub-item in its own `@@IF MOD_DECISION_SHEET@@` block: "In `--stop-after=pr` mode, before the commit, do item 5, item 2 (Which case); it goes on to the commit only when a `decision sheet: done` entry has the tree mark of now." In the list of paths that belong to the plan (today's sub-item 1), add the phrase "the decision sheet's fixes" through a split of that sentence into two `MOD_DECISION_SHEET` variants (with and without the phrase).
      - Step 0 **Resume** paragraph: add, in its own `@@IF MOD_DECISION_SHEET@@` block, "In "to PR" mode, a resumed run that has its commit runs item 5 (Which case → After the commit) before it ships."
      - Frontmatter `description`: "→ plan to done/ and one commit for the whole plan →" becomes "→ plan to done/ (and in "to PR" mode the decision sheet) → one commit for the whole plan →".
13. `test-review/SKILL.md` Step 4 item 3: replace "Run the matching revert check again (Step 3). It must now be KILLED." with "Run the matching revert check again (Step 3), when one exists. It must now be KILLED."
14. `decision-sheet/SKILL.md`: inside the `@@IF MOD_CODEX@@` frontmatter block, split the `argument-hint` line into `@@IF CODEX_IN_VERIFY@@` (today's line) and `@@IFNOT CODEX_IN_VERIFY@@` (the same without ` [--codex-report <path>]`). Put the Step 0 `--codex-report` bullet and Step 2 item 0 ("Verify already ran Codex") each in an `@@IF CODEX_IN_VERIFY@@` block (nested in the `MOD_CODEX` block). In the output block, the Codex line "(or, when Codex ran: `✅ Codex: <n> findings fixed, <n> open`, or `✅ Codex: ran in verify, <n> fixed, <n> open`)" gets two variants: `@@IF CODEX_IN_VERIFY@@` keeps it, `@@IFNOT CODEX_IN_VERIFY@@` drops the "ran in verify" part. Decision 3B: the "findings fixed" form becomes `✅ Codex: <n> findings fixed (<file:line> — <one-line gist>, …), <n> open`, and Step 2 item 4 adds after the `--fix` sentence: "A fixed finding is not a question: it is listed on the Codex line with its `file:line`, so the reviewer sees it without a checkbox. Name the files your fixes touched in your final message, and say whether their scoped tests and lint passed." `skill-5-ship/SKILL.md`: the two "build the sheet again first" sentences of the browser-test check (`HAS_TICKETS` and `IFNOT HAS_TICKETS` variants) get "with the same `--out` and `--no-codex`, and copy the Codex line from the old sheet", as the merge rebuild in its Step 3 already does, so a rebuild does not run Codex a second time. `templates/modules/codex/dot-codex/skills/validate-implementation/SKILL.md` Input item 1: add a sixth command line "- `git ls-files --others --exclude-standard`" and the sentence "Read each untracked file it lists in full: before the pipeline's commit, a new file of the plan is untracked, and the diffs above do not show it." (Decision 3B runs this review before the commit.)
15. `AGENTS.md.tmpl`: the `@@IF MOD_CODEX@@` block with the `/skill-4-verify` Codex line becomes `@@IF CODEX_IN_VERIFY@@`, and a new `@@IFNOT CODEX_IN_VERIFY@@` block after it holds "- `/skill-4-verify` runs a `/code-review` loop of max 2 rounds (round 2 only after a behaviour fix), then the rule audit." Decision 3B: the `/decision-sheet` line "The pipeline runs it after the commit, before `/skill-5-ship`, which adds it to the PR." becomes "In "to PR" mode the pipeline runs it before the commit (its fixes go into the one commit); `/skill-5-ship` adds it to the PR." `render.mjs` `buildVars()` `chain`: move the `/decision-sheet` item in front of the commit item, as "`/decision-sheet` ("to PR" mode)", and split "plan to `.plans/done/` and one commit for the whole plan" into "plan to `.plans/done/`" and "one commit for the whole plan".
16. `references/contracts.md`: a `pipeline.codexInVerify` row after `pipeline.defaultMode` ("boolean, no. `true`: each `/skill-4-verify` round also runs the Codex review, and the decision sheet reuses its report (`CODEX_IN_VERIFY`). Needs `modules.codex`. Unset or `false`: Codex checks the plan, and the code only in the decision sheet"). Template syntax: name `reporting-rules-after-pr.md` → `@@REPORTING_RULES_AFTER_PR@@` (in `skill-5-ship`, `decision-sheet`, `pr-feedback`). `references/bootstrap.example.json`: `"codexInVerify": false` after `"defaultMode": "pr"`. `references/checklist.md`: Target state row `.claude/scripts/run-usage.mjs`, `run-usage.selftest.mjs` | core | "Per-phase tokens and cost of one run; reads the run log and `~/.claude/projects`, writes nothing"; question 2 text "Default: all on, Codex on (plan validation and the decision sheet; Codex in verify off: `pipeline.codexInVerify`)"; the `pipeline.*` row of "Find these yourself" adds "`codexInVerify` false unless the owner asks"; the hand-off example "1. Codex: a second check of the plan and the code with another AI" becomes "1. Codex: a second check of the plan, and of the finished code in the decision sheet, with another AI".
17. `test/bootstrap-project.test.mjs`: change and add the tests in **Tests**.
18. `changelog.d/20261124-pipeline-diet-templates.yaml` (new, `/changelog-entry`): `kind: changed`, `audience: internal`, `scope: bootstrap-project`, a plain `summary` and an `internal` note.

## Calculation rules for `run-usage.mjs`

- Command: `node .claude/scripts/run-usage.mjs <run .log> [--projects-dir <dir>]`. `--projects-dir` defaults to `~/.claude/projects` (`os.homedir()`).
- Input lines (stream-json, one JSON object per line): `type: "assistant"` lines with `message.id`, `message.usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`), `message.content[]` (`tool_use` items with `id`, `name`, `input`), `session_id` and `timestamp`; `type: "result"` lines with `model_usage_since_last_result.<model>.costUSD` and `total_cost_usd`.
- Field evidence: a local run log of this repo (`.plans/auto-runs/*.log`, gitignored) has `timestamp` on each `assistant` line, `model_usage_since_last_result.<model>.costUSD` on its `result` line, and `assistant` lines with a non-null `parent_tool_use_id` (checked with `grep -c` and `grep -o`; no content copied). The meta file shape `{"agentType", "toolUseId", …}` was checked in `~/.claude/projects/<folder>/<session>/subagents/agent-*.meta.json`. The rules below still handle a log that lacks a field.
- Main-session lines: only lines with `parent_tool_use_id` null or missing count for the main session. A line with a non-null `parent_tool_use_id` is a subagent message: it is skipped, because the subagent transcript counts it (else its tokens count twice).
- Text lines: a line that does not start with `{` is launcher text, not counted as unparsable, and never a source of session ids. A text line that starts with `-> compacting session` starts a `compaction` segment (the launcher writes it before `claude -p "/compact …" --resume <id>`, whose stream goes into the same log with the same `session_id`). The segment ends with the next `result` line (included). In a real log this segment has system, user and rate-limit lines and a `result` line, and no assistant line (validation round 2, field names counted only). A line that starts with `{` and does not parse is unparsable.
- Compaction row: a top row `compaction`. Its cost and its tokens come from the `model_usage_since_last_result` of its own `result` line, summed over the model keys (`costUSD`, `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `outputTokens`), given to it directly (not by weight). It starts at the first timestamp in its segment and ends at the last one; without a timestamp its minutes are `n/a`. The lines of the segment (also its user lines) are never main-session lines of another row. The row before the compaction ends at its own last timestamp before the marker. The weighted split (below) shares only the rest of the total (total − compaction cost) over the other leaf rows.
- Sessions: the script collects the `session_id` values of the JSON lines of the log. For each, it finds subagent folders with `<projects-dir>/*/<session id>/subagents/` (any project folder: long folder names are cut and get a suffix, so the log slug is not a safe match). Each `agent-*.jsonl` file name is read once, also when the session id is in more than one folder (for example the VS Code copy of a session); a session id in more than one folder prints a warning. No subagent folder → a warning line, main session only.
- Top phases (main-session markers, in order of appearance): a `Skill` tool_use with `input.skill` `skill-2-implement` → `implement`, `skill-3-test` → `test`, `skill-4-verify` → `verify`. A `Read` tool_use of `.claude/skills/skill-5-ship/SKILL.md`, `.claude/skills/changelog-entry/SKILL.md` or `.claude/skills/decision-sheet/SKILL.md` (path ends with it) → `ship`. Before the first marker: `preflight`.
- Sub-phases of `verify`: a `Skill` tool_use `code-review` or `test-review` starts `verify › code-review` or `verify › test-review`. A sub-row runs until the next marker of any kind. The part before the first sub-marker is `verify › setup`. Leaf rows are the top rows other than `verify`, plus the `verify ›` rows; they do not overlap. Allocation and sums use leaf rows only. The `verify` line is a subtotal of its sub-rows and is never allocated itself.
- A subagent counts in the row where its `Agent` tool_use started. Join key: `subagents/agent-*.meta.json` → `toolUseId` equals the `Agent` tool_use `id` in the main session. A transcript without a meta file, a meta file without `toolUseId` (2 of 5 real meta files, validation round 2), or a `toolUseId` with no matching `Agent` call goes in an `unattributed` row.
- Tokens: the `usage` of each assistant message, counted once per `message.id` (the stream repeats one message on several lines with the same `usage`). The assistant `usage` lacks thinking tokens: the script prints that caveat, and the total table shows the sum of `thinkingTokens` from the `result` lines' `model_usage_since_last_result` (per row it is not known).
- Cost total: the sum over all `result` lines of `model_usage_since_last_result[<model>].costUSD`, over every model key (it includes subagents). The script also prints a cross-check: the sum over the streams of the log of the last `total_cost_usd` of each stream (a stream starts at a `system` `init` line; `total_cost_usd` is a running total of one `claude -p` process, and a resumed run or a compaction starts a new stream in the same log). It never uses `modelUsage` (a running session total).
- Cost per row: the total split by weighted tokens. Weights per token, relative to one uncached input token: input 1, cache write 1.25, cache read 0.1, output 5 (the same for every model, so an unknown model needs no rate). Row cost = (total − compaction cost) × row weight ÷ weight of the weighted rows, rounded to cents; the rounding difference goes to the largest row, so the rows add up to the total exactly. When the weighted rows hold no tokens at all (weight 0) and cost is left, no row gets a share: the whole rest goes to the `unattributed` row, and the other rows show cost `n/a`. The output says that the row costs are estimates from token weights, and that only the total and the compaction cost are exact.
- Wall minutes: main session only. A row starts at the timestamp of its marker line and ends at the timestamp of the next row's marker line, or at the last main-session timestamp; so a row with one message still gets its span. Wall minutes are `n/a` only when the start or the end has no timestamp. Subagent timestamps never change wall minutes. Active minutes: the sum of the gaps between consecutive timestamped main-session lines of the row, each gap capped at 10 minutes (one message → 0).
- Max context: the largest input + cache read + cache write of one turn in the row.
- Output: one table per session (row, input, cache write, cache read, output, cost, wall min, active min, max context), then a total table when there is more than one session; then the caveat lines and the footer (`<n> unparsable lines skipped`).
- Missing fields: no `model_usage_since_last_result` on any `result` line → the total is the cross-check sum above (last `total_cost_usd` per stream) and a caveat line says so; neither field → cost is `n/a` in every row (tokens still print). An assistant line without `timestamp` adds no gap and cannot start or end a row's span (the rule above). A subagent folder or meta file that is missing → the warnings above. The script never invents a value: a missing value prints `n/a`.
- Errors: a missing or unreadable file → exit 1 with a message. No `result` line → exit 1 ("no result line: incomplete log"). An unparsable line is skipped and counted in the footer. No marker → one `whole run` row and a warning line.
- It writes nothing.
- The script and its self-test hold no `@@NAME@@` text: `renderAll()` renders every template file and fails on an unknown `@@…@@`, and `verify.mjs` (placeholders check) fails on a leftover one.

## Tests

### Unit tests

`templates/core/dot-claude/scripts/run-usage.selftest.mjs` (made-up fixtures only: session ids like `sess-acme-1`, message ids like `msg-1`, tool-use ids like `toolu-acme-1`):

- Three top phases with known token counts → exact row values (input, cache write, cache read, output).
- `code-review`, then `test-review` inside verify, then a `ship` Read marker → three `verify ›` rows sum to the `verify` subtotal, the leaf rows sum to the run total, and `ship` starts a new row.
- A subagent that starts in `verify › code-review` and whose transcript ends after the `ship` marker → its tokens stay in `verify › code-review`, and the wall minutes of `verify › code-review` and `ship` do not overlap.
- A subagent transcript joins its `Agent` call through `toolUseId`; a transcript without a meta file lands in `unattributed`.
- One `message.id` on three lines counts once.
- Two `result` lines with `model_usage_since_last_result` for two models → the exact total; exact per-row costs from the weights; the rows add up to the total after rounding.
- A row with one 30-minute gap → 30 wall minutes, 10 active minutes plus the other gaps.
- Two session ids → two tables and a total table.
- A missing file → exit 1; no `result` line → exit 1 with "no result line"; one unparsable line → footer count 1.
- No marker → one `whole run` row and the warning.
- A subagent line (`parent_tool_use_id` set) in the main log next to its transcript → its tokens count once (from the transcript).
- A `-> compacting session sess-acme-1 (180000 tokens)` text line, then the real segment shape (system, user and rate-limit lines with `session_id: "sess-acme-1"`, no assistant line, one `result` line with `model_usage_since_last_result` cost 0.40, `inputTokens` 12, `cacheReadInputTokens` 900, `outputTokens` 300) → a `compaction` row with cost exactly 0.40 and exactly those tokens; the other rows share only the rest of the total; the row before it ends at its last timestamp before the marker (exact wall minutes asserted) and does not grow; text lines are not counted as unparsable and add no session id.
- `result` lines with only `total_cost_usd`, in two streams (two `init` lines: 1.10 then 0.30) → the total is 1.40, not 0.30.
- A meta file without `toolUseId` → its transcript lands in `unattributed`.
- One session id with subagent folders in two project folders, with the same `agent-*.jsonl` file name in both → that transcript counts once, and the warning prints.
- A one-message row between two markers with timestamps 10:00 and 10:07 → 7 wall minutes, 0 active minutes.
- A `result` line with cost 0.50 and no assistant line with `usage` (weight 0) → `unattributed` gets 0.50, the other rows show `n/a`, exit 0, no division by zero.
- `result` lines with only `total_cost_usd` → the total is that value and the caveat prints; `result` lines with neither → cost `n/a`, tokens print, exit 0.
- Assistant lines without `timestamp` → wall and active minutes `n/a`, exit 0.

`test/bootstrap-project.test.mjs`:

- **Codex, three cases** (replaces "codex on: verify runs the Codex code review, …"):
  - Default example answers (`codexInVerify: false`): rendered `skill-4-verify` has no `Codex` and no `@@`, and has `^## Step 1 — Bug hunt \(code-review loop, max 2 rounds\)$`; `skill-auto-pipeline` has no `codex-report` and no "Codex OFF (missing"; `decision-sheet` still has `## Step 2 — Codex review` and has no `Verify already ran Codex` and no `--codex-report`; `skill-auto-validate-plan` still names Codex; `AGENTS.md` has no `--no-codex`.
  - `codexInVerify: true`: today's assertions (Step 1 heading with "then one Codex review", `--no-codex`, the `-o ".plans/.code-reviews/<branch-with-slashes-as-dashes>-codex.md"` line, `--codex-report` in the pipeline and the sheet, `Verify already ran Codex`, the `.gitignore` line).
  - `modules.codex: false`: no `Codex` in `skill-4-verify`, no `codex-report` in the pipeline (as today).
- `checkParams`: `codexInVerify: "yes"` → "must be true or false"; `codexInVerify: true` with `modules.codex: false` → "needs modules.codex"; render exits 1 for both.
- **Diet texts** (default answers, migrations on): `skill-4-verify` contains `--max-checks 3`, `**No behaviour fix:**` and `do not read it again`, and its Step 1 (text between `## Step 1` and `## Step 2`) has no `check-only lint` and no `migration drift check`; the audit still has the `Migration drift` row; `skill-2-implement`, `skill-3-test`, `skill-4-verify` have no `Read every nested`, `Read the nested` and no ``Read `test/AGENTS.md` ``; `skill-3-test` has `once per tree state`, `ECONNREFUSED`, `SIGSEGV`, `retried alone`; `skill-2-implement` has `skip the full "Test (full)"`; `test-review` has `(Step 3), when one exists`; `skill-auto-pipeline` has `this run counts for it`. A render with `codexInVerify: true` has `**No behaviour fix:**` in its Codex variant too (decision 2A).
- **Reporting split:** `skill-3-test` and `skill-4-verify` have no `after the PR opened`; `skill-5-ship`, `decision-sheet` and `pr-feedback` have it. The existing "the reporting rules and the browser-test gate render into the skills that report" test still passes (the pictures bullet stays shared).
- **After-loop lint block:** a render with `stack.commands.lintCheck: ""` has `**After the loop:**` in `skill-4-verify`; the example answers (with `lintCheck`) do not.
- **`--unattended` signal:** `skill-auto-pipeline` has `/skill-2-implement <plan-file> --unattended`, and `skill-2-implement` has `With \`--unattended\``.
- **Variables:** `node render.mjs --vars` output contains `CODEX_IN_VERIFY` and `REPORTING_RULES_AFTER_PR`.
- **Decision-sheet line:** the default render has no `ran in verify`; a `codexInVerify: true` render has it. The sheet has `A fixed finding is not a question`.
- **Sheet before the commit (3B):** in the rendered `skill-auto-pipeline`, the index of `5. **Decision sheet**` is >= 0 and lower than the index of `6. **Commit**` (also >= 0), the sheet call has `--fix`, the item has `decision sheet: done`, `tree: <mark>`, `decision sheet: gate failed`, `FAILED: decision sheet` and `do not commit`, its Which-case list names `git log --format=%s <base>..HEAD`, the Commit item has `do item 5, item 2 (Which case)`, the commit paths name "the decision sheet's fixes", item 5 has `**After the commit**` with `without \`--fix\``, and the Resume paragraph has `Which case → After the commit`. A default render has `git ls-files --others --exclude-standard` in `.codex/skills/validate-implementation/SKILL.md`; with `modules.codex: false` the call has no `--fix`; with `modules["decision-sheet"]: false` the rendered pipeline has no `Decision sheet`, no `decision sheet: done` and no `decision sheet's fixes` text, and still has `6. **Commit**` and `7. **Ship**`. Item 5 has its three cases (`DOCUMENTED`, `COMMITTED — READY TO PUSH`, `FAILED: decision sheet`), and its done check names the `- HH:MM:SS — ` prefix.
- **Full e2e scope:** `skill-3-test` Step 3 item 1 names the plan's Tests section (`lists end-to-end tests`) next to the How to verify condition. The rendered `skill-5-ship` browser-test rebuild sentences have `--no-codex`.
- **Verify texts:** `skill-4-verify` has `no behaviour fix, hit the cap`; the default `AGENTS.md` has `round 2 only after a behaviour fix`; both renders (with and without `lintCheck`) keep the audit row `| 2 | Lint and format |`. `AGENTS.md` names `/decision-sheet` before `one commit for the whole plan` in the pipeline chain.
- **run-usage:** a fresh render has `.claude/scripts/run-usage.mjs` and `run-usage.selftest.mjs`, both executable; `spawnSync(process.execPath, ['--test', <repo>/.claude/scripts/run-usage.selftest.mjs], { env: <process.env without NODE_TEST_CONTEXT> })` exits 0, its output has `# fail 0` and a `# pass <n>` with n > 0 (inside `npm test`, `NODE_TEST_CONTEXT` would change how the child reports); `AGENTS.md` and `README.md` have the `node .claude/scripts/run-usage.mjs <run .log>` row; `settings.json` `permissions.allow` has `Bash(node .claude/scripts/run-usage.mjs *)` and `Bash(node --test .claude/scripts/run-usage.selftest.mjs)`. The first test ("a fresh render passes every required verify check …") still passes, so `node-check`, `exec-bits` and `placeholders` accept the new files.
- **unusedParts:** default answers list `setting:codexInVerify`; with `codexInVerify: true` or `modules.codex: false` it is not listed.

Each of these fails on today's templates: the diet texts and the new rows do not exist, and the default render has Codex in verify.

### End-to-end tests

- None. The project has no HTTP API, and the change adds no endpoint.

### Harness constraints

- A real headless pipeline run with the new skills cannot run inside `npm test` (it needs `claude`, a worktree and tokens). The tests prove the rendered text and the script logic; a real before/after measurement is an owner step after the merge (Open items).

### AI output

None.

## Browser test

None — no screen changes; the change is template text, `render.mjs` and a CLI script.

## How to verify

```bash
node --test test/bootstrap-project.test.mjs
node skills/bootstrap-project/scripts/render.mjs --vars
npm test
node .claude/scripts/changelog-validate.mjs --base origin/main
```

- `render.mjs --vars` must list `CODEX_IN_VERIFY` and `REPORTING_RULES_AFTER_PR` (the test file asserts it too, so the first command fails when one is missing).
- `changelog-validate.mjs` must print `PASS`.

## Open items (owner, after the merge)

- Upgrade this repo's own `.claude/` from `.claude/bootstrap.json` with `/bootstrap-project --upgrade` (owner, by hand: a headless run cannot write `.claude/`).
- Measure one "stop at verify" run before and after the upgrade in one project with `run-usage.mjs` (the private project does this as its own plan).
- Run `node .claude/scripts/run-usage.mjs` on one real local run log after the upgrade (a run log is gitignored and is not in a pipeline worktree): it must exit 0, and its total must equal the sum of the `costUSD` values of the log's `result` lines. Copy no log content into a repo.
