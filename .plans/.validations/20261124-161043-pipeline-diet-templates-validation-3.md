**Validation round:** 3

## Plan validation: 20261124-161043-pipeline-diet-templates.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round 2 edits mostly hold up. The new item 5 "Decision sheet" works for a normal run and for a stop after `DOCUMENTED`. Two edges still need clear text: the resume from "commit" mode, and a pipeline with the decision-sheet module turned off. In `run-usage.mjs`, the compaction row and the cost fallback still give wrong numbers for real logs: the compaction `result` line carries its own token counts, the row before the compaction gets no clear end time, and `total_cost_usd` is a running total for each session. I found no blocking issue. I found no private data in the plan.

### Blocking issues

None.

### Non-blocking concerns (should fix)

- [Edge cases / item 5 vs Resume] Item 5 sub-item 2 always adds `--fix` (inside `@@IF MOD_CODEX@@`), and its done check names only status `DOCUMENTED` (plan:163-164). The rule for a commit-mode run resumed in "to PR" mode ("after the commit, without `--fix`") is only in the Step 0 **Resume** paragraph (plan:168; target `skill-auto-pipeline/SKILL.md:54`). The Commit item's new first sub-item says "without it, do item 5 first" (plan:167). A committed run has no `decision sheet: done` line, so a model that reads item 5 or the Commit check literally runs the sheet with `--fix` after the commit. Its fixes are then uncommitted when Ship pushes, or they need a second commit. — Fix: write the after-commit branch into item 5 itself ("When the one commit exists already (status `COMMITTED — READY TO PUSH`), run the sheet without `--fix` and write `decision sheet: done (after the commit, no fixes)`"). Make the Commit check apply only before the commit.
- [Template switch / module off] Step 12 says that the 3B group is "inside `@@IF MOD_DECISION_SHEET@@`" (plan:160). But it does not say that each separate insertion has its own wrapper: the Commit first sub-item (plan:167), the "the decision sheet's fixes" path, and the Resume sentence (plan:168). These go into text outside item 5 (`skill-auto-pipeline/SKILL.md:54`, `:122-123`). If the Commit sub-item renders with `modules["decision-sheet"]: false`, a "to PR" run looks for a `decision sheet: done` line that nothing writes, and then for an item 5 that does not exist. — Fix: state that each of the three insertions is in its own `@@IF MOD_DECISION_SHEET@@` block. Extend the 3B test (plan:237) so that with the module off, the rendered pipeline has no `decision sheet: done` and no `item 5`.
- [run-usage / wrong data: compaction tokens] Plan:184 says "its tokens come from assistant lines in the segment, if any (usually none)". The test at plan:217 asserts "0 tokens". A local run log (`.plans/auto-runs/20261123-102654-event-watcher-and-waits-for.log:1869`, the compaction `result` line; I read field names only, and I copied no content) has `model_usage_since_last_result.<model>` with `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens` (and `thinkingTokens`) for the compaction. So the row prints 0 tokens next to a real cost. — Fix: take the compaction row's tokens from the `model_usage_since_last_result` of its own `result` line (summed over the model keys). Change the fixture and the assertion to known non-zero counts.
- [run-usage / wrong data: wall end before compaction] The `-> compacting session` marker is a text line with no timestamp (`templates/core/dot-claude/scripts/auto-pipeline.sh:451`). The segment's `user` lines have a `timestamp`, `parent_tool_use_id: null` and the same `session_id` (same log, lines 1867-1868, field names only). Plan:192 says that a row ends "at the timestamp of the next row's marker line, or at the last main-session timestamp". For the row before the compaction, this gives either `n/a` (the marker has no timestamp) or a row that grows into the compaction (its user lines look like main-session lines). The test at plan:217 ("the last phase row does not grow") does not say which value is correct. — Fix: add this rule: "The row before a compaction segment ends at its last timestamped line before the `-> compacting session` line; lines of a compaction segment are never main-session lines of another row." Assert the exact wall minutes of that row in the test.
- [run-usage / wrong data: cost fallback in a multi-session log] Plan:190 and plan:195 use "the last `total_cost_usd`". On the compaction `result` line of the same local log, `total_cost_usd` equals the session's `modelUsage` cost (the running session total), not the cost of the compaction. A resumed pipeline run starts a new `claude -p` session in the same shared log (`auto-pipeline.sh:637` `start_session … --resume — RESUME MODE`, with the comment "where this session starts in the shared log" at about line 473). So the fallback and the cross-check undercount a log with two sessions. — Fix: use "the last `total_cost_usd` of each `session_id`, summed". Add a two-session fixture with only `total_cost_usd`.
- [Edge cases / resume after `FAILED: decision sheet`] The sheet's fixes stay uncommitted (plan:166). The done check names only `DOCUMENTED` (plan:163), and the Commit check sends the run back to item 5 (plan:167). The run then starts a second Codex review with `--fix` on top of the first fixes. The intent may be correct, but the text does not say it. — Suggestion: say what a resume after `FAILED: decision sheet` does. One option: run the item-5 full test gate first, and run the sheet again with `--no-codex`, with the Codex line copied from the Timeline. The other option: say that a second Codex run is intended.

### Non-blocking concerns (style)

- [Pattern] `**5. Decision sheet**` puts the number inside the bold text. The other items are `4. **Document**` and `5. **Commit**` (`skill-auto-pipeline/SKILL.md:113`, `:122`). When the module is off, the list goes 4 → 6. Suggestion: use `5. **Decision sheet**`, and change the test index strings to match.
- [run-usage] Plan:189 says "The stream lacks thinking tokens". The `result` lines carry `thinkingTokens` for each model in `model_usage_since_last_result` (same log, line 1869, field name only). Suggestion: print the run's thinking-token total from the `result` lines, and keep the caveat only for the split into rows.

### Checked and correct (round 2 edits)

- The Phase 1 call text, the regression-gate text and the Phase 3 Codex bullet match `skill-auto-pipeline/SKILL.md:68`, `:84`, `:76-78`.
- `FAILED: decision sheet` matches the `FAILED: <phase>` stop state (`skill-auto-pipeline/SKILL.md:61`). The dashboard reads it as failed (`apps/dashboard/server.mjs:325`).
- The decision sheet reads the working tree (`decision-sheet/SKILL.md:36-40`). `--fix` runs scoped tests and lint (`:66`). The new item 5.4 builds on that correctly.
- The `skill-5-ship` browser-test rebuild sentences exist at `skill-5-ship/SKILL.md:191` and `:195`. The merge rebuild already passes `--no-codex` (`:124`).
- `AGENTS.md.tmpl:53` and `:66` match the quoted text. The `chain` in `render.mjs:520-523` matches step 15.
- The audit lint row text (`render.mjs:447-450`) and the Step 2 lint bullet (`skill-4-verify/SKILL.md:112`) match step 8. The Codex variant item 2 ends "before the Codex part" (`:48`), and the Claude-only variant ends "before the next round" (`:85`).
- `skill-2-implement/SKILL.md:35` holds the quoted "not available yet" fallback (round 2 step 11 bullet).
- The compaction segment shape (system, rate-limit and user lines, then one `result` line, with no assistant line) matches the local log, lines 1860-1869 (field names only).
- The "How to verify" commands exist (`package.json:7`, `.claude/scripts/changelog-validate.mjs`), and they can fail.

### Edge cases the plan should address

- A run committed in "commit" mode and resumed in "to PR" mode: item 5 must not add `--fix` after the commit.
- `modules["decision-sheet"]: false` in "to PR" mode: the Commit item must not wait for a `decision sheet: done` line.
- A resume after `FAILED: decision sheet`: rerun the gate only, or Codex again.
- A log with two sessions (a fresh run and a resume) that has only `total_cost_usd`.
- The phase row directly before a compaction segment: its exact wall minutes.

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
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261124-161043-pipeline-diet-templates.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 12 item 5, write the after-commit branch into item 5 itself: when the one commit exists already (status COMMITTED — READY TO PUSH), run the sheet without --fix and write "decision sheet: done (after the commit, no fixes)". Make the Commit item's "do item 5 first" check apply only before the commit. (evidence: skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-pipeline/SKILL.md:54, :122-125)
2. In step 12, state that the Commit first sub-item, the "the decision sheet's fixes" path and the Resume sentence are each in their own @@IF MOD_DECISION_SHEET@@ block. In Tests, assert that with modules["decision-sheet"]: false the rendered pipeline has no "decision sheet: done". (evidence: skill-auto-pipeline/SKILL.md:54, :122-123)
3. In the Calculation rules, take the compaction row's tokens from the model_usage_since_last_result of its own result line (inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, summed over the models). Change the compaction fixture and the assertion from "0 tokens" to known non-zero counts. (evidence: the compaction result line of a local .plans/auto-runs/*.log carries these fields)
4. In the Wall minutes rule, add: the row before a compaction segment ends at its last timestamped line before the "-> compacting session" line; lines of a compaction segment are never main-session lines of another row. Assert the exact wall minutes of that row in the compaction test. (evidence: templates/core/dot-claude/scripts/auto-pipeline.sh:451, a text line with no timestamp; the segment's user lines have a timestamp and parent_tool_use_id null)
5. In the Cost total and Missing fields rules, use "the last total_cost_usd of each session_id, summed" for the cross-check and the fallback (total_cost_usd is a running total for each session, and a resume starts a new session in the same log). Add a two-session fixture with only total_cost_usd. (evidence: templates/core/dot-claude/scripts/auto-pipeline.sh:637)
6. Say what a resume after "FAILED: decision sheet" does: run the item-5 full test gate first, and run the sheet again with --no-codex with the Codex line kept, or say that a second Codex run is intended. (evidence: plan Steps 12, item 5.4)
7. Write item 5 as "5. **Decision sheet**", in the pattern of "4. **Document**", and change the test index strings to match. (evidence: skill-auto-pipeline/SKILL.md:113, :122)

ADD THESE EDGE CASES:
- A run committed in "commit" mode and resumed in "to PR" mode: the sheet runs without --fix.
- A "to PR" run with the decision-sheet module off: the Commit item does not wait for the sheet line.
- A resume after FAILED: decision sheet.
- A log with two sessions that has only total_cost_usd.
- The exact wall minutes of the phase row directly before a compaction segment.

Do not change anything the validation did not flag.
```
