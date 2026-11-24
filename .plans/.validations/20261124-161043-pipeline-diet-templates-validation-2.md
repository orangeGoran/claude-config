**Validation round:** 2

## Plan validation: 20261124-161043-pipeline-diet-templates.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round-1 edits fit the templates. Decision 3B (the sheet moves before the Commit phase with `--fix`) matches the current `skill-auto-pipeline` structure, and its tests can fail. One rule in `run-usage.mjs` is built on a stream shape that the real log does not have: the compaction segment has no `assistant` lines, so the `compaction` row gets 0 tokens and its cost goes to the other rows. Some smaller gaps remain in the subagent join, the folder lookup, and a few skill lines that the plan does not update.

### Blocking issues

- [Edge cases / wrong data] The compaction rule assumes that the compaction stream has assistant messages with `usage`. It does not. — Evidence: in the local log `.plans/auto-runs/20261123-102654-event-watcher-and-waits-for.log` (gitignored; field names counted only, no content read), line 1860 is the `-> compacting session` text line. Lines 1861–1868 are only `system`, `rate_limit_event` and `user` lines (one `compact_boundary`), and no `assistant` line. Line 1869 is a `result` line with `model_usage_since_last_result` and `total_cost_usd` but no `"usage":{"input_tokens"` match. The plan's rules are at plan:175, plan:182 and plan:209. — Why it breaks: the `compaction` row has 0 weighted tokens. Its real cost (in the line-1869 `result`) goes into the run total, and plan:182 then spreads that cost over the other rows by weight, so every other row shows too much cost. The self-test fixture (plan:209, "then a stream with the same `session_id`") models a shape that does not occur, so the test passes while the real output is wrong. — Fix: add a rule that the cost of a `result` line inside a compaction segment (`model_usage_since_last_result` of that line) goes directly to the `compaction` row and is not split by weight. Its tokens come from that `result` line when it has them, else `n/a`. The other rows split only the remaining cost. Change the plan:209 fixture to the real shape (`system` init, `compact_boundary`, `user`, then `result`, with no `assistant` line). Assert the compaction row's cost and that the other rows' costs do not change.

### Non-blocking concerns (should fix)

- [Edge cases] The subagent join leaves out meta files that have no `toolUseId`. — Evidence: in `~/.claude/projects/<worktree folder>/<main session>/subagents/`, 3 of 5 `agent-*.meta.json` files have `toolUseId`, and 2 have only `agentType`, `isBuiltIn`, `spawnDepth`, `requestShape`, `requestNonInteractive`, `model` and `pickedEffortModel` (grep counts and key names only). The main log has exactly 3 `Agent` tool_use ids, and they match the 3 `toolUseId` values. The plan's "Field evidence" (plan:173) names only the `{agentType, toolUseId, …}` shape, and plan:179 covers only "a transcript without a matching meta file". — Suggestion: say "no meta file, or a meta file without a `toolUseId` that matches an `Agent` call → `unattributed`" (or put such a transcript in the main row active at its first timestamp). Correct the Field evidence line. Add a fixture for a meta file without `toolUseId`.
- [Edge cases] The folder lookup by "folder name contains the log slug" fails for long paths. — Evidence: `ls ~/.claude/projects` shows that long project paths get a cut name with a random suffix (for example `…-pdca-close-lessons-foll-4cu4on`), so the full slug is not in the name. Plan:176. — Suggestion: look for `<projects-dir>/*/<session id>/subagents/` (session ids are UUIDs and unique). Keep the slug match only as a fast first try.
- [Edge cases] A VS Code copy duplicates the subagent files. — Evidence: the same worktree folder has two session folders, the main session (in 1869 log lines) and the `vscode-session-copy` fork (named only in text line 1870), with the same 5 `agent-*` files. Plan:176 reads only the session ids of the log's JSON lines, so this works today. — Suggestion: state that session ids come only from JSON lines (never from text lines such as the `vscode-session-copy:` line), and add a test for it.
- [Edge cases] A text marker has no timestamp. — Evidence: plan:175 and plan:183. The `-> compacting session` line is plain text. — Suggestion: say that a row that a text line starts begins at the first main-session timestamp after that line, and that the row before it ends at the last timestamp before it.
- [Discrepancy] The stop-reason list in the verify report does not include the new third reason. — Evidence: `skill-4-verify/SKILL.md:195` and `:198` say "converged, only deferrals left, hit the cap, or escalated". Plan step 8 adds **No behaviour fix** but does not update these lines. — Suggestion: add "no behaviour fix" to both lines in step 8, and extend the "Diet texts" test.
- [Discrepancy] `skill-2-implement` still runs the full suite with `--unattended`. — Evidence: `skill-2-implement/SKILL.md:35` says that when "Test (one file)" is "not available yet", it runs "Test (full)" at the end of the plan. Plan step 11 changes only Step 4 item 4. — Suggestion: say in step 11 whether `--unattended` also skips this fallback (`/skill-3-test` Step 3 runs it anyway).
- [3B] The plan does not name the phase that fails when the sheet's fixes break a test. — Evidence: plan:158 says "a failure counts toward the failure budget" and also "It never blocks". `skill-auto-pipeline/SKILL.md:61` allows only `FAILED: <phase>`, and `:88` defines the budget per phase. — Suggestion: name `FAILED: document` after 2 fix rounds, and say that a sheet that fails without fixes still never blocks.
- [3B] After the sheet's Codex fixes, the audit and `/code-review` do not run again. — Evidence: the sheet runs after `/skill-4-verify` (plan:158). `decision-sheet/SKILL.md:66` re-runs only the scoped tests and lint. — Suggestion: this follows the owner's "fix it now" decision, so it is not blocking. Add one Breaking-changes line that says the fixes are not audited, and that the sheet lists each one with `file:line` (step 14) so the reviewer sees them first.
- [3B / consumers] The ship-time sheet rebuilds run Codex again after the commit. — Evidence: `skill-5-ship/SKILL.md:191` and `:195` rebuild the sheet "with the same `--out`", without `--no-codex`. Only `:124` passes `--no-codex`. — Suggestion: in step 12 or step 14, add `--no-codex` (copy the Codex line from the old sheet, as `:124` does) to the rebuilds at `:191` and `:195`. Otherwise a second Codex run without `--fix` can turn findings into kind-6 items after the commit. This defect exists today, but 3B makes the first sheet the place where fixes happen.
- [Docs] The hand-off still describes Codex as checking "the code" in every run. — Evidence: `references/checklist.md:227` "Codex: a second check of the plan and the code with another AI". Plan step 16 updates question 2 (`:61`) and `:78` only. — Suggestion: also update `:227`.
- [Docs] With the default answers, the rendered AGENTS.md has no line about the verify loop. — Evidence: `templates/core/AGENTS.md.tmpl:52-54` is the only `/skill-4-verify` loop line, and plan step 15 puts it under `CODEX_IN_VERIFY` with no `IFNOT` variant. — Suggestion: add an `IFNOT CODEX_IN_VERIFY` line ("max 2 rounds of `/code-review`; round 2 only after a behaviour fix, then the rule audit").
- [Edge cases] `git.keepTracked` breaks the commit path check. — Evidence: `render.mjs:182` lets a project commit `.plans/.code-reviews/` or `.plans/.test-review/`. `skill-auto-pipeline/SKILL.md:123` fails the commit on any path that is not in its list. `decision-sheet/SKILL.md:62` writes Codex output to an undefined `<out-dir>`. — Suggestion: in step 12, add the sheet's Codex report and the test-review report (when tracked) to the paths that belong to the plan, or name `<out-dir>` as the report dir.
- [Calculation] The per-row cost is an estimate. The weights (plan:182) ignore 1-hour cache writes and model price differences. — Suggestion: print one caveat line that says the row costs are split by token weight and only the total is exact.

### Checked and correct (round-1 edits)

- 3B order: the Document list (`skill-auto-pipeline/SKILL.md:110-121`) and item 5 Commit (`:122`) exist as the plan says. pr item 6 (`:146-152`) is the block that moves. Ship `:153` and Next `:162` renumber to 6 and 7. The sheet reads the working tree (`decision-sheet/SKILL.md:36-40`, with `git status --short` for untracked files). `skill-5-ship/SKILL.md:124` "its fixes are in the plan's commit already" becomes true.
- `chain` (`render.mjs:520-523`) and `AGENTS.md.tmpl:49,66` match step 15. The test "`/decision-sheet` before `one commit for the whole plan`" fails today, because the chain at `:49` comes first and lists the sheet after the commit.
- Main-session rule, `model_usage_since_last_result` and `timestamp`: the local log has 5 `result` lines, each with `model_usage_since_last_result` and `total_cost_usd`. Several `init` and `result` lines share one session id, so summing per `result` line is right. The `Skill` markers have the exact form `"name":"Skill","input":{"skill":"skill-2-implement"` (also `skill-3-test`, `skill-4-verify`, `code-review`, `test-review`), and the subagent tool is named `Agent` (no `Task`).
- `renderText()` (`render.mjs:693-724`): a partial with `@@IF@@` blocks renders as a value, like `REPORTING_RULES` (`:683`). A leftover `@@…@@` fails, so plan:189 is needed and right.
- `isExecutable` (`render.mjs:737`) gives both new `.mjs` files mode 755. `verify.mjs:176-195` exec-bits, node-check and placeholders cover them.
- `test-review` accepts `--max-checks` (`test-review/SKILL.md:4,19`). Step 4 item 3 is at `:64`.
- The quoted texts of steps 8–11 exist: `skill-4-verify/SKILL.md:48,50,67,85,87,91,106,112,156`, `skill-3-test/SKILL.md:33,36,90,141,143`, `skill-2-implement/SKILL.md:4,20,67`.
- `npm test` globs `test/*.test.mjs` (package.json), so `run-usage.selftest.mjs` runs only through `test/bootstrap-project.test.mjs`, as planned.
- No private data: the plan names no client, path or cost. "A private project" names nothing.

### Edge cases the plan should address

- A compaction segment with no `assistant` lines (the real shape) — the row cost must come from its own `result` line.
- A meta file without `toolUseId` — in 2 of 5 cases in a real run.
- A cut project folder name (long worktree path) — the slug match finds nothing.
- A ship marker read in an early phase (for example when `/skill-2-implement` reads `.claude/skills/decision-sheet/SKILL.md`) — consider counting `ship` markers only after the `verify` marker.
- The sheet's `--fix` breaks a test after the Document phase — which status, and what a resume does.
- `git.keepTracked` with `.plans/.code-reviews/` — the commit path check.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done) — `skill-5-ship:191,195` rebuilds and `checklist.md:227` are missing
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected (not touched)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected — the compaction fixture models a stream shape that does not occur
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261124-161043-pipeline-diet-templates.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. In "Calculation rules", add a rule for the compaction segment. Its stream has no assistant lines: only system (init, compact_boundary), user and one result line. The cost of a result line inside a compaction segment (its model_usage_since_last_result) goes directly to the "compaction" row and is not split by weight. Its tokens come from that result line when it has them, else n/a. The other rows split only the remaining cost. Change the self-test fixture (Tests, compaction case) to this real shape, and assert the compaction row's cost and that the other rows' costs do not change. (evidence: plan:175, plan:182, plan:209; a local run log has lines 1861-1868 with no assistant line and result line 1869 with model_usage_since_last_result)

SHOULD FIX:
1. Subagent join: say that a transcript with no meta file, or with a meta file that has no toolUseId matching an Agent call, goes to "unattributed" (or to the main row active at its first timestamp). Correct the "Field evidence" line: 2 of 5 real meta files have no toolUseId. Add a fixture. (evidence: plan:173, plan:179)
2. Sessions: find subagent folders with <projects-dir>/*/<session id>/subagents/, because long project folder names are cut and get a random suffix. Keep the slug match only as a first try. Take session ids only from JSON lines, never from text lines such as the vscode-session-copy line, and test it. (evidence: plan:176)
3. Say that a row that a text line starts begins at the first main-session timestamp after that line. (evidence: plan:175, plan:183)
4. Step 8: also add "no behaviour fix" to the stop-reason lists of the report at skill-4-verify/SKILL.md:195 and :198, and to the Diet texts test.
5. Step 11: say whether --unattended also skips the "Test (full)" fallback at skill-2-implement/SKILL.md:35.
6. Step 12 (3B): name the status when the sheet's fixes break a test after 2 fix rounds (FAILED: document). Say that a sheet that fails without fixes still never blocks. (evidence: skill-auto-pipeline/SKILL.md:61, :88; plan:158)
7. Breaking changes: add one line that the sheet's Codex fixes are not audited again (no /code-review, no audit rows), and that the sheet lists each one with file:line.
8. Add --no-codex (and "copy the Codex line from the old sheet", as skill-5-ship/SKILL.md:124 does) to the sheet rebuilds at skill-5-ship/SKILL.md:191 and :195, and list skill-5-ship in Affected files for this change.
9. Step 16: also update references/checklist.md:227 ("a second check of the plan and the code") to the new Codex scope.
10. Step 15: add an IFNOT CODEX_IN_VERIFY line for /skill-4-verify in AGENTS.md.tmpl (Claude /code-review loop, max 2 rounds, round 2 only after a behaviour fix, then the rule audit). (evidence: AGENTS.md.tmpl:52-54)
11. Step 12: when git.keepTracked holds .plans/.code-reviews/ or .plans/.test-review/, the commit path list must accept those reports. (evidence: render.mjs:182, skill-auto-pipeline/SKILL.md:123)
12. Calculation rules: print one caveat line that the row costs are estimates split by token weight and only the total is exact.

ADD THESE EDGE CASES:
- A compaction segment with no assistant lines.
- A meta file without toolUseId.
- A cut project folder name for a long worktree path.
- A ship marker read before the verify marker.
- The sheet's --fix breaks a test after the Document phase, and a resume after that.
- git.keepTracked with .plans/.code-reviews/.

Do not change anything the validation did not flag.
```

Commands that touched a service or the database: none.
