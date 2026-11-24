# Round 1 — pipeline-diet-templates

- Claude: ON (`-validation-1.md`, APPROVE WITH CHANGES, 1 blocking, 10 should-fix)
- Codex: ON (`-codex-raw-1.md`, NEEDS REWORK, 3 blocking, 2 non-blocking)

## Regressions from the previous round

None (round 1).

## Findings

| # | Source | Finding | Verdict | Action |
|---|---|---|---|---|
| 1 | Claude B1 | Breaking changes says the decision sheet runs Codex "with `--fix`"; the pipeline calls it without `--fix`, after the commit (`skill-auto-pipeline/SKILL.md` pr step 6) | VALID | Breaking changes corrected. Who fixes the findings is an owner decision → question in the chat; recorded in Context |
| 2 | Codex B1 | Auto-load of nested `AGENTS.md` needs a `CLAUDE.md` shim (`render.mjs` `hasShim()`); no fallback | PARTIALLY VALID | The shim is the rendered convention (AGENTS.md.tmpl intro), but a folder without one exists. Steps 9, 10, 11: read the `AGENTS.md` when no shim sits next to it, or the folder has no other file |
| 3 | Codex B2 | Post-loop fixing lint has no scoped re-test | VALID | Step 8 block runs scoped tests after a lint change; step 12 regression gate names "the lint run after it" |
| 4 | Codex B3 | Timestamp and `model_usage_since_last_result` not established | PARTIALLY VALID | Fields verified in a local gitignored run log (grep counts only). Missing-field rules and tests added anyway |
| 5 | Codex NB1 | `--vars` check is manual | VALID | Test asserts both variables |
| 6 | Codex NB2 | Dropping the after-PR bullet leaves standalone runs | INVALID | The rendered AGENTS.md Git rule "Follow-ups on an open PR" already says to update the PR body (`templates/core/AGENTS.md.tmpl`, Git section) |
| 7 | Claude S1 | Compaction session in the same log | VALID | `-> compacting session` text line starts a `compaction` row (`auto-pipeline.sh` `compact_session()`); test |
| 8 | Claude S2 | Subagent lines in the main log count twice | VALID | 63 lines with non-null `parent_tool_use_id` in a local log (`grep -c`). Main-session rule; test |
| 9 | Claude S3 | Vitest picks up `run-usage.test.mjs` | VALID | Renamed to `run-usage.selftest.mjs` (Vitest default include matches `*.test.mjs`) |
| 10 | Claude S4 | Nested `node --test` inside `npm test` | VALID | Env without `NODE_TEST_CONTEXT`; assert `# fail 0` and `# pass n>0` |
| 11 | Claude S5 | "step 13" should be step 17 | VALID | Fixed |
| 12 | Claude S6 | Decision-sheet output still offers "ran in verify" | VALID | Step 14 switches it; test |
| 13 | Claude S7 | skill-2 cannot tell the pipeline called it | VALID | `--unattended` flag in skill-2, passed by Phase 1; Breaking changes; test |
| 14 | Claude S8 | Infra retry does not name the command | VALID | Step 10 item 2a names "Test (one file)" / the e2e file filter |
| 15 | Claude S9 | After-loop lint block untested | VALID | Test with `lintCheck: ""` |
| 16 | Claude S10 | No `@@` text in the script | VALID | Calculation rules state it |

Only Claude found 1, 7–16. Only Codex found 2–6.

## Validation response

All VALID items applied. One INVALID (#6). Round 2 validates these edits.

## Owner decisions (asked in the chat)

- #1 → 3B: in "to PR" mode the decision sheet runs before the commit with `--fix`; each fixed finding is listed on the Codex line, not asked. Plan steps 12, 14, 15, Breaking changes and Tests updated.
- Follow-up → 4B: a defect whose cause is in another repo becomes a ticket there by itself; the planner, not the run, merges duplicates. Out of this plan: new parent plan `.plans/20261124-225819-pipeline-diet-parent.md`, item 2; roadmap line added; this plan names the parent.
