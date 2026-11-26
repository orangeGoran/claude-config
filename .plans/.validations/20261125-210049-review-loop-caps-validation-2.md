**Validation round:** 2

## Plan validation: 20261125-210049-review-loop-caps.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues

- [Tests / discrepancy] Step 7 sets `"codexInVerify": true` in `bootstrap.example.json`, but four existing tests render the example with `p.modules.codex = false` and do not touch the field. `checkParams()` then rejects the answers, so `bootstrapRepo()` fails its `assert.equal(r.status, 0, r.stderr)` — evidence: `skills/bootstrap-project/references/bootstrap.example.json:141` (today `false`), `skills/bootstrap-project/scripts/render.mjs:122` (`civ === true && p.modules?.codex === false` → "pipeline.codexInVerify needs modules.codex"), `test/bootstrap-project.test.mjs:24` (status assert in `bootstrapRepo`), and the codex-off renders at `test/bootstrap-project.test.mjs:57` (upgrade test, `JSON.parse` of the stdout of a failed render), `:346` (`off` in "codexInVerify: verify runs the Codex code review, …", which the plan says to "keep as they are"), `:821` (`noCodex` in "decision 3B: …", not named in the plan), `:896` (`noCodex` in "plan validation runs max 2 rounds", which becomes the new "max 4 rounds" test with its `modules.codex: false` render) — why it breaks: `node --test test/bootstrap-project.test.mjs` and `npm test` fail in 4 tests that the plan does not list, and the plan's new test has the same defect — fix: in each codex-off edit, also remove the field (`delete p.pipeline.codexInVerify`, or set it to `false`). List the four tests (lines 57, 346, 821, 896) in **Tests**, and write the new "max 4 rounds" test's `modules.codex: false` render with the field removed. (`apps/dashboard/test/dashboard.test.mjs:1704` and `test/bootstrap-upgrade-run.test.mjs:737` also load the example, but they keep `modules.codex` on, so they are not affected.)

### Non-blocking concerns

- [Step d consistency] The shared bullet "**No accepted blocking finding** and no open `REGRESSION` → the loop ends" contradicts status rule 1, where an unresolved step e problem with `n` < 4 runs round `n+1` ("step e does not end the loop"). A reader who stops at the bullet ends the loop with an open problem. The status list also mixes an action ("run round `n+1`") into a list of statuses — evidence: plan Step 3 (bullet "Shared: … the loop ends" and rule 1) — suggestion: write the bullet as "→ when this round edited the plan, do the final edits check (step e). Then take the status below; rule 1 can start one more round." and name the list "Stop or continue, in this order".
- [Step d completeness] "Open `REGRESSION`" is not defined, and the new rules depend on it. A `REGRESSION` that step a of round 4 finds and that round 4 fixes is either "open" (rule 1 → `OPEN ITEMS`, even though it is fixed) or "not open" and not a blocking finding (rule 4 → plain `READY`, although no validator read that round 4 fix). The second reading is a path that ends with a plain `READY` and a round 4 fix that only the self-check read — evidence: plan Step 3 rules 1 and 3; template `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:74` (regressions are tagged, not defined as open or closed) — suggestion: define "open" (a `REGRESSION` that this round did not fix, or whose fix step e did not confirm), and make rule 3 "Round 4 edited the plan for an accepted blocking finding or a `REGRESSION`".
- [Step d completeness] Owner decisions inside the loop: the plan does not say whether a blocking finding that went to the owner and that the owner **answered** (the plan is edited with the answer) is an "accepted blocking finding". When it is not, the loop can end with the answer's edit read only by step e. A blocking finding that the owner **deferred** also matches "VALID … → run round `n+1`" in the first bullet, which starts one more round only for step c to mark it `RAISED BEFORE` — evidence: plan Step 3 first bullet and rule 2; template `SKILL.md:114` (Owner decisions) — suggestion: one sentence: "An edit from an owner's answer to a blocking finding counts as an accepted blocking finding; a deferred one does not (rule 2 gives `OPEN ITEMS`)."
- [Test assertion] The new test asserts `the first rule that matches wins`, but in Step 3 that text is in the plan's own description ("Shared, the status, in this order (the first rule that matches wins):"), not clearly in a quoted template text. An implementer can leave it out of the skill and the test fails for a wording reason — evidence: plan Step 3 and Tests ("plan validation runs max 4 rounds …") — suggestion: quote the heading line of the status list as the exact text to put into the template.
- [Breaking changes] The consumer list of `unusedParts` / `--unused` misses `skills/bootstrap-project/references/checklist.md`, which also names `--unused` (`grep -rln -E "unusedParts|--unused" skills apps` lists `SKILL.md`, `render.mjs`, `checklist.md`) — suggestion: add it; it is a reader of the list only, so no edit is needed.
- [Interview edge] Step 8 changes the `pipeline.*` row to "`codexInVerify` true unless the owner says no". When the owner turns the Codex module off and the answers keep `true` (copied from the example), the render fails at `render.mjs:122` — suggestion: add "leave it unset when the Codex module is off" to the same row.

### Edge cases the plan should address

- Codex OFF for one round, then early stop — today an OFF validator is tried again in the next round (`SKILL.md:45`). With the early stop, a transient Codex failure in round 1 and a clean Claude report end the loop at once as `READY (Codex OFF)`. That is disclosed, but the plan should say whether this is the wanted result or whether one more round runs when a validator was OFF and rounds remain.
- A test run with `modules.codex: false` and the example answers — this is the blocking item above; every future test that turns Codex off must also clear `codexInVerify`.
- An answered owner decision in round 4 — its edit is read only by step e. The status must show that (see the concern above).

### Checklist

- [ ] All referenced files, lines, sections and symbols exist as stated — the quotes, paths and symbols match (`SKILL.md:4,7,50,52,102,109,119-125,130,135,139`, `render.mjs:120-122,192,234-235,664-665`, `AGENTS.md.tmpl:43,46,53`, `checklist.md:62,79,228`, `contracts.md:119`, root `AGENTS.md:54,59`, parent plan line 14, `docs/roadmap.md:34`); but the claim that the listed test changes are complete is wrong (blocking item)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done) — one reader missing (`checklist.md`), non-blocking
- [x] Wiring & registration matches the code (no new wiring; `CODEX_IN_VERIFY` already in `buildVars()` and `--vars`)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope — not applicable (no endpoint)
- [x] Restart after dashboard changes respected (no file under `apps/dashboard/`)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (one `~/Workspace` path in Context; generic)
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected — tests are planned, but four existing tests break (blocking item)
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source; `bootstrap.json` field type unchanged)
- [x] "How to verify" commands are real and can fail (`npm test`, `node --test`, both greps, `.claude/scripts/changelog-validate.mjs --base origin/main` exists and `changelog.d/AGENTS.md:8` names it)

```
Update the plan at .plans/20261125-210049-review-loop-caps.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Step 7 sets "codexInVerify": true in bootstrap.example.json. render.mjs checkParams() then rejects every test render with modules.codex = false ("pipeline.codexInVerify needs modules.codex"). In Tests, add: each codex-off edit also removes the field (delete p.pipeline.codexInVerify) in the tests at test/bootstrap-project.test.mjs lines 57 (upgrade keeps a hand-tuned CONFIG line), 346 ("codexInVerify: verify runs the Codex code review, …", the off case), 821 ("decision 3B: …", noCodex) and in the new "plan validation runs max 4 rounds …" test (today line 896). Change "keep the modules.codex: false case as it is" accordingly. (evidence: skills/bootstrap-project/references/bootstrap.example.json:141, skills/bootstrap-project/scripts/render.mjs:122, test/bootstrap-project.test.mjs:24,57,346,821,896)

SHOULD FIX:
1. In Step 3, rewrite the shared bullet "No accepted blocking finding … → the loop ends" so it does not contradict status rule 1: "→ when this round edited the plan, do the final edits check (step e), then take the rules below; rule 1 can start one more round." Name the ordered list "Stop or continue, in this order (the first rule that matches wins)" and quote it as the exact template text, because the test asserts "the first rule that matches wins". (evidence: plan Step 3, Tests)
2. In Step 3, define an open REGRESSION (not fixed this round, or its fix not confirmed by step e), and make rule 3 "Round 4 edited the plan for an accepted blocking finding or a REGRESSION → READY (round 4 edits self-checked)", so no path ends with a plain READY after a round 4 fix that no validator read. (evidence: skill-auto-validate-plan/SKILL.md:74)
3. In Step 3, add: "An edit from an owner's answer to a blocking finding counts as an accepted blocking finding; a deferred one does not (rule 2 gives OPEN ITEMS)." (evidence: skill-auto-validate-plan/SKILL.md:114)
4. In Breaking changes and Step 6, add skills/bootstrap-project/references/checklist.md to the readers of the unused-parts list (it names --unused); no edit needed there.
5. In Step 8, the pipeline.* row: add "leave it unset when the Codex module is off" (render.mjs:122 rejects true with codex off).

ADD THESE EDGE CASES:
- Codex OFF in round 1 and a clean Claude report: the early stop ends the loop as READY (Codex OFF) without the retry that SKILL.md:45 promises. Say whether that is wanted or whether one more round runs while rounds remain.
- An owner answer applied in round 4: only step e reads it; the status must say so.

Do not change anything the validation did not flag.
```
