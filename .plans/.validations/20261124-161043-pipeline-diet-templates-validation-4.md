**Validation round:** 4

## Plan validation: 20261124-161043-pipeline-diet-templates.md

**Verdict:** APPROVE WITH CHANGES

Scope of this round: the round-3 edits (diff pre-round-3 → pre-round-4). Items that earlier rounds answered with evidence are not raised again.

### Blocking issues

- [Edge cases / Discrepancy] Step 12 item 5 "Which case" picks the case from the report's Status, but on every resumed run the Status is no longer `DOCUMENTED`, `COMMITTED — READY TO PUSH` or `FAILED: decision sheet` when item 5 runs. Cases 5 and 6 occur only on a resume, so they can never match as written. — Evidence: `skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:52` (the preflight sets the status to `RUNNING` on every run; only line 44 is "fresh runs only"), `:54` (Resume reads the Status after that); `skills/bootstrap-project/templates/core/dot-claude/scripts/auto-pipeline.sh:169-175` (a session that exits while `DOCUMENTED`, for example in the middle of the sheet, gets `ENDED — session exited before finishing; Resume`); plan line 164. — Why it breaks: a run that is resumed after `FAILED: decision sheet` runs the sheet a second time with `--fix` (case 3), not case 6. A run that is resumed in "to PR" mode after a commit-mode run can run the sheet with `--fix` after the commit, which breaks the one-commit rule (the R3 regression returns through the Status lookup). — Fix: take the case from facts that survive a resume: (a) `git log --format=%s <base>..HEAD` has the plan's commit, or the Timeline has a `COMMITTED` entry → item 5 (After the commit); (b) else the Timeline has a `decision sheet: gate failed` entry (item 4 writes it when it sets `FAILED: decision sheet`) → item 6; (c) else → item 3. Name `RUNNING` and `ENDED` in the text, so the reader knows that the Status is not the source. Add a test for the new `decision sheet: gate failed` entry text.

### Non-blocking concerns

- [Tests / Discrepancy] The 3B test looks for `**5. Decision sheet**`, but round 3 changed step 12 to the style `5. **Decision sheet**`. `indexOf` of a missing string is -1, so "lower than the index of `6. **Commit**`" passes even when the item is missing (a check that cannot fail). — Evidence: plan line 240 vs plan line 162. — Use `5. **Decision sheet**` and assert that the index is >= 0.
- [Tests / Discrepancy] The 3B test expects `Do not commit.` in item 5, but the step 12 item 4 text says "…under `## Diagnosis`; do not commit, and end the session." The rendered pipeline has no `Do not commit.` today (`skill-auto-pipeline/SKILL.md:73` "Do not commit or ship without it.", `:113` "Do not commit yet."). — Evidence: plan line 166 vs plan line 240. — Make the test string match the step text (for example `do not commit, and end the session`), or change the step text.
- [Edge cases] Case 6 (After a failed gate) runs only item 4's "Test (full)" again. When the gate failed because "a scoped check of the sheet failed" (item 4), that scoped test or lint never runs again, so the run can pass with the same lint failure in the commit. — Evidence: plan lines 166 and 168. — In item 6, run the scoped tests and the lint of the files the sheet named again, then "Test (full)".
- [Edge cases] Item 3 routes "the sheet failed before it changed a file" to No fix, and "Fixes (the sheet names the files)" to item 4. A sheet that failed after it changed a file (it names no files) has no case. — Evidence: plan line 165. — Take the changed files from `git status --porcelain` before and after the sheet, not only from the sheet's message; changed files → item 4.

### Checked and correct (round-3 edits)

- Done check: the skill writes Timeline entries as `- HH:MM:SS — <one line>` (`skill-auto-pipeline/SKILL.md:60`); the launcher writes `- YYYY-MM-DD HH:MM:SS — ` (`auto-pipeline.sh:93`), but it never writes a `decision sheet:` entry. Correct.
- `MOD_DECISION_SHEET` blocks: item 5, the Commit sub-item, the commit-paths variants and the Resume sentence each have their own block; the module-off test asserts the absence of the three texts and the presence of `6. **Commit**` and `7. **Ship**`. Today's pr-mode list (`skill-auto-pipeline/SKILL.md:146-153`) already skips 6 with the module off. Correct.
- skill-3-test full e2e condition: `@@PLAN_TESTS@@` and `@@PLAN_VERIFY@@` exist (`render.mjs:577-578`), and the old text matches `skill-3-test/SKILL.md:141`. The test string `lists end-to-end tests` is in the new text. Correct.
- run-usage compaction tokens: a local run log has `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `outputTokens`, `thinkingTokens` and `costUSD` under its `result` lines (5 `model_usage_since_last_result`, 5 `"subtype":"init"`; field names counted only, no content read). The compaction is the last stream of a session (`auto-pipeline.sh:490-492`), and a pipeline resume starts a new `claude -p` (new session id, its own table), so no main-session lines follow a compaction in the same session. Correct.
- Stream cost fallback: one `init` per `claude -p` (5 inits, 5 results in the log) fits the "last `total_cost_usd` per stream" rule. Correct.
- Wall minutes: the exception "the row before the compaction ends at its own last timestamp" agrees with the general rule. Correct.
- Private data: none found in the plan (no client name, private path or cost; "a private project" only).

### Edge cases the plan should address

- A session that exits in the middle of item 3 (status `ENDED`) — the resume must not run `--fix` again on top of half-applied fixes without the gate.
- A resume after `FAILED: decision sheet` where the failure was a scoped lint — the lint must run again.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected (two 3B assertions do not match the step text; one cannot fail)
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261124-161043-pipeline-diet-templates.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In step 12 item 5, item 2 "Which case": do not take the case from the report's Status. On a resume the preflight sets the Status to RUNNING (skill-auto-pipeline/SKILL.md:52), and the launcher writes ENDED for a session that exited (auto-pipeline.sh:169-175), so cases 5 and 6 never match. Take the case from facts that survive a resume: the plan's commit exists (git log --format=%s <base>..HEAD, or a COMMITTED Timeline entry) -> item 5; else a "decision sheet: gate failed" Timeline entry (item 4 writes it when it sets FAILED: decision sheet) -> item 6; else -> item 3. Add the new entry text to the 3B test. (evidence: plan line 164; skill-auto-pipeline/SKILL.md:52,54; auto-pipeline.sh:169-175)

SHOULD FIX:
1. In the 3B test, look for `5. **Decision sheet**` (the round-3 style), not `**5. Decision sheet**`, and assert that its index is >= 0 before the order check. (evidence: plan lines 162, 240)
2. Make the 3B test string `Do not commit.` match the item 4 text ("do not commit, and end the session"), or change the item 4 text. (evidence: plan lines 166, 240)
3. In item 5, item 6 (After a failed gate): run the scoped tests and the lint of the files the sheet named again before "Test (full)", so a failed scoped check of the sheet cannot pass. (evidence: plan lines 166, 168)
4. In item 5, item 3: take the changed files from git status --porcelain before and after the sheet; a sheet that failed after it changed a file goes to item 4. (evidence: plan line 165)

ADD THESE EDGE CASES:
- A session that exits in the middle of the sheet (status ENDED): the resume must not run --fix again without the test gate.
- A resume after FAILED: decision sheet caused by a scoped lint failure: the lint runs again.

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
