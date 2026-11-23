# Validation round 1 — 20261123-111046-validation-report-names

- Claude (plan-validator): ON — `-validation-1.md`, APPROVE WITH CHANGES (2 blocking, 7 should-fix)
- Codex: ON — `-codex-raw-1.md`, NEEDS REWORK (3 blocking, 2 should-fix)
- Regressions from the previous round: none (round 1)

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | `/apply-validation` template still names `-round-<n>.md`; the git grep check fails on it | Claude B1, Codex B3 | VALID | `templates/core/dot-claude/skills/apply-validation/SKILL.md` "When `/skill-auto-validate-plan` runs this step, it writes its own `-round-<n>.md`" | New step 4, Affected files, step 10 render list |
| 2 | Claude's "next free `-validation-claude-` number" restarts at 1 for plans with old reports, so the round count does not grow | Claude B2 | VALID | `ls .plans/.validations`: event-watcher has `-validation-1..7` | One round number rule in Contracts: 1 + highest number over all old and new names |
| 3 | Two numbering rules (loop starts at 1, agent takes next free); a second run overwrites round 1 | Codex B1 | VALID | template skill-auto-validate-plan "For round `n` = 1"; plan-validator "next free number"; event-watcher has `-codex-raw-1..8` | Same rule as #2; the loop takes `<n>` each round and gives it to the agent; step 2 |
| 4 | Count per file double-counts old and new names of the same validator and round | Codex B2 | VALID | proposed plan-lanes step counted `++` per file | plan-lanes counts distinct numbers per validator (`Set`); test 9b adds `-codex-raw-2` + `-codex-2` |
| 5 | The `git grep` check has inverted exit status and is not in the headless allow list | Codex B3, Claude S | VALID | `.claude/settings.json` allow list | Removed; replaced by test 9c on the rendered skill text |
| 6 | Breaking changes misses the lanes chip and `score` | Claude S | VALID | `scripts/plans-dashboard/app.js` lanes row chip; `plan-lanes.mjs` `score` | Added both |
| 7 | Browser-test numbers wrong (×8 → ×4) | Claude S | VALID | `ls .plans/.validations`: 7 Claude + 8 Codex reports | ×15 → ×8; lanes 7×/0× → 7×/8× |
| 8 | Step 7 updates a comment that does not exist | Claude S | VALID | `scripts/plans-dashboard.mjs` `validationRounds` has no comment | "Add a comment" |
| 9 | Step 0 merge check by commit title is unreliable | Claude S, Codex S2 | VALID | squash merge title | Check `apps/dashboard/server.mjs`, the done plan file and the `package.json` test glob |
| 10 | Step 9 (render) has no apply command | Claude S, Codex S1 | VALID | `render.mjs` usage: preview without `--apply` | Step 10 gives `--upgrade --apply <5 paths>` |
| 11 | Test 8a cleanup must be in `finally` | Claude S | VALID | — | Added |

Findings found by one validator only: #2, #6, #7, #8, #11 (Claude); #3, #4 (Codex).
