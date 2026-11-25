**Validation round:** 1

## Plan validation: 20261125-210049-review-loop-caps.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues
- [Edge cases / wrong status] The new status rules do not use the result of step e (final edits check) when the loop stops early. Plan step 3 says "The loop ended without an accepted blocking finding → **READY**". It applies the step e result only to round 4 ("`READY (round 4 edits self-checked)` when step e found no problem it could not fix, else `OPEN ITEMS`"). Step e says "Fix a problem you find in the same check", but it does not say what happens when the check finds a problem that it cannot fix in round 1–3. — evidence: `.plans/20261125-210049-review-loop-caps.md:99-101`; the current loop guard it replaces is in `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:124` ("never finish on edits that no round validated while a round remains") — why it breaks: the skill can then report READY for a plan with a known open problem. That is wrong data for the owner, who launches the plan when it says READY. — fix: in the status text, say that when step e finds a problem it cannot fix: with `n` < 4, run round `n+1`; with `n` = 4, the status is `OPEN ITEMS`. Assert this in the "plan validation runs max 4 rounds …" test.

### Non-blocking concerns
- [Scope / owner decision] The `RAISED BEFORE` paragraph (step 2) also covers "a finding … that asks to change an owner decision recorded in the plan", and it does not need an earlier round to have raised that finding. Owner decision 1A(b) (plan line 28) covers only "a finding that an earlier round rejected". The existing "Owner decisions" rule (template `SKILL.md:114`) sends such findings to the owner. The new clause stops them silently, and the plan-author choices (lines 30-34) do not list it. — suggestion: limit the clause to findings that an earlier round's decision log already classified INVALID, or that the owner already answered. Or list it as a plan-author choice.
- [Tests, inaccurate description] The Tests item for "the diet texts: …" says to move the "`^## Step 1 — Bug hunt \(code-review loop`"-style assertions to a `codexInVerify: false` render. That test (`test/bootstrap-project.test.mjs:731-774`) has no such assertion. All its `def` strings (`--max-checks 3`, `**No behaviour fix:**`, `do not read it again`, `no behaviour fix, hit the cap`, `use the output of the lint run after the Step 1 loop`) are also in the Codex variant (`templates/core/dot-claude/skills/skill-4-verify/SKILL.md:68,106,112,156,195`). So the test passes as it is after the flip. — suggestion: say "unchanged; it passes with the Codex variant", or say exactly which assertion to add for the `false` render.
- [Tests, stale comment] `test/bootstrap-project.test.mjs:700` says "pipeline diet: … Codex out of verify by default". After the flip this comment is wrong. — suggestion: add the comment edit to step 9.
- [Breaking changes, inaccurate consumer] The plan says the consumers of `unusedParts()` are "the bootstrap hand-off and the dashboard's upgrade view". `grep -rn "unusedParts\|--unused"` finds readers only in `skills/bootstrap-project/scripts/render.mjs:1012` and `skills/bootstrap-project/SKILL.md:64`, and none in `apps/`. — suggestion: drop the dashboard reader, or name the file.
- [Docs] Entry 1 of the parent plan still names `.plans/20261124-161043-pipeline-diet-templates.md` in its heading (`.plans/20261124-225819-pipeline-diet-parent.md:11`). That plan is now in `.plans/done/`. Step 11 edits entry 1 but keeps the old path. — suggestion: correct the path in the same edit, as step 11 already does for the roadmap.
- [How to verify] Step 12 writes a changelog entry, but "How to verify" does not run the validator that `changelog.d/AGENTS.md:8` asks for. — suggestion: add `node .claude/scripts/changelog-validate.mjs --base origin/main` (it must print `PASS`).
- [Not verified] The claim in Context line 34 that only this repo sets `codexInVerify` (`grep -rl … ~/Workspace`) reads repos outside this one. This review did not check it. This repo's value `true` is confirmed at `.claude/bootstrap.json:176`.

### Edge cases the plan should address
- Round 4 accepts a blocking finding while one validator is OFF in round 4. The status text does not say how `READY (round 4 edits self-checked)` and `READY (<Codex|Claude> OFF)` combine (for example `READY (Codex OFF; round 4 edits self-checked)`).
- Step e fixes a problem in the plan. Those fixes are not checked by anyone. Say that step e logs each of its own edits in `## Final edits check`, so the owner can read them.
- A finding that an earlier round classified PARTIALLY VALID comes back unchanged (the fix did not land). Say whether it is `RAISED BEFORE` or a new accepted finding.
- A later round raises again a finding that an earlier round sent to the owner, and the owner deferred it. Say whether it is `RAISED BEFORE` or a new question.

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated (render.mjs:120-122, 192, 234-235, 664-665; template SKILL.md:4, 7, 50, 52, 102, 109, 119-125, 130, 135, 139; AGENTS.md.tmpl:43, 46, 53, 56; skill-1-plan SKILL.md:320; contracts.md:119; checklist.md:62, 79, 228; bootstrap.example.json:141; root AGENTS.md:54, 59; roadmap.md:34; parent plan:14; all test names exist)
- [x] Reference implementation mirrored, deviations justified (done plan step 19, line 188)
- [ ] Breaking changes for changed symbols listed (consumer search done): the consumers are listed, but the dashboard reader is wrong (non-blocking)
- [x] Wiring & registration matches the code (no new wiring; `CODEX_IN_VERIFY` exists at render.mjs:665)
- [ ] Scope stays inside the goal; no open decision is taken silently: the `RAISED BEFORE` owner-decision clause goes beyond 1A(b) (non-blocking)
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (N/A: no endpoint)
- [x] Restart after dashboard changes respected (no file under apps/dashboard/)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected (templates only; root CLAUDE.md untouched)
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no contract source; `codexInVerify` type unchanged)
- [x] "How to verify" commands are real and can fail (the `node --test` assertions fail on today's text; the grep commands find matches today: template SKILL.md:4,7,125 and render.mjs:665)

```
Update the plan at .plans/20261125-210049-review-loop-caps.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 3 (status after step e), cover the case where the final edits check finds a problem that it cannot fix after an early stop: with n < 4, run round n+1; with n = 4, the status is OPEN ITEMS. READY must never follow an unfixed step e problem. Add an assertion for this text to the "plan validation runs max 4 rounds with an early stop" test. (evidence: .plans/20261125-210049-review-loop-caps.md:99-101; skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:124)

SHOULD FIX:
1. Limit the RAISED BEFORE clause "or that asks to change an owner decision recorded in the plan" to findings that an earlier round already logged (INVALID, or answered by the owner), or list it as a plan-author choice. Owner decision 1A(b) covers only rejected findings, and SKILL.md:114 sends owner-decision findings to the owner. (evidence: plan lines 28, 95; template SKILL.md:114)
2. Correct the Tests item for "the diet texts": it has no "code-review loop" assertion, and all its def strings are also in the Codex variant, so it passes unchanged. (evidence: test/bootstrap-project.test.mjs:731-774; templates/core/dot-claude/skills/skill-4-verify/SKILL.md:68,106,112,156,195)
3. In step 9, update the test comment "Codex out of verify by default". (evidence: test/bootstrap-project.test.mjs:700)
4. In Breaking changes, remove "the dashboard's upgrade view" as an unusedParts reader. The only readers are render.mjs:1012 and skills/bootstrap-project/SKILL.md:64. (evidence: grep of apps/ finds none)
5. In step 11, also correct the entry 1 heading path to .plans/done/20261124-161043-pipeline-diet-templates.md. (evidence: .plans/20261124-225819-pipeline-diet-parent.md:11)
6. Add `node .claude/scripts/changelog-validate.mjs --base origin/main` (must print PASS) to How to verify. (evidence: changelog.d/AGENTS.md:8)

ADD THESE EDGE CASES:
- Round 4 accepts a blocking finding while a validator is OFF: give the combined status text.
- Step e edits the plan: log each of its edits under "## Final edits check".
- A PARTIALLY VALID finding from an earlier round comes back unchanged: say whether it is RAISED BEFORE.
- A finding that the owner deferred comes back: say whether it is RAISED BEFORE or a new question.

Do not change anything the validation did not flag.
```
