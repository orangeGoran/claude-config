# Validation round 1 — 20261125-125414-run-command-allow-rules

- Claude (plan-validator): ON — APPROVE WITH CHANGES, 1 blocking, 5 should-fix (`-validation-1.md`)
- Codex (validate-plan): ON — NEEDS REWORK, 4 blocking, 3 should-fix, 3 edge cases (`-codex-raw-1.md`)
- Regressions: none (round 1)

| # | Validator | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| 1 | Claude B1 | The `worktree_problem` test stops early: a non-git tmp folder + `fresh` + `set -euo pipefail` | VALID | `auto-pipeline.sh` `worktree_problem()` runs `git -C "$1" status --porcelain | head` with `fresh`. Test rewritten: `repo` as `$1`, no `fresh`, positive control `PREFLIGHT_CMDS=("touch preflight-ran")`. |
| 2 | Codex B1 | An upgrade keeps `RUN_EXTRA_ALLOW` of a kept CONFIG block, so the new rule is missing | PARTIALLY VALID | The flow exists: `configDiff()` shows `auto-pipeline.sh` as `config`, and the bootstrap skill Step 2 asks the owner; `--reset-config` takes the answers. Added: the engineering choice, a test (status `config`, `+ RUN_EXTRA_ALLOW` / `+ RUN_CMDS` lines, reset applies, a kept block fails the preflight at once), and `--reset-config` in Open items. |
| 3 | Codex B2 | The AGENTS.md sentence restricts every Commands row, also the standard ones | VALID | Step 8 now names project rows only; the standard rows keep their rules. |
| 4 | Codex B3, Claude S2 | `run: true` in `bootstrap.example.json` changes the shared fixtures | VALID | Step 11 removed (steps renumbered 12→11, 13→12, 14→13); the example stays unchanged; Affected files and the existing-tests line say so. |
| 5 | Codex B4 | The validators check allow rules but not deny rules | VALID | Steps 5–7 add the deny check and "say so" for sources a validator cannot read (`settings.local.json`, user settings). New test: a deny rule wins over a run row's rule. |
| 6 | Claude S1 | verify.mjs `deny-overlay` does not read `RUN_EXTRA_ALLOW` | VALID | `verify.mjs` checks a fixed overlay list. Affected files text corrected; the conclusion (no change) stays. |
| 7 | Claude S3 | A `<placeholder>` passes the bare check, and the rule never matches | VALID | `render.mjs` `checkParams()` removes `<…>` before the test. Step 1 rejects a placeholder in a `run: true` command; test added. |
| 8 | Claude S4 | The older-CONFIG test must write the edited script back first | VALID | `pipelineBash()` reads the repo file. Test text says so. |
| 9 | Claude S5 | Removing the wide hand rule narrows what runs may use | VALID | Open items keep the `DASH_PORT=*` hand rule. |
| 10 | Codex S1 | `rule_matches` is not Claude Code's matcher | VALID | Harness constraints mark Claude Code matching "not verified"; the first real run checks it. |
| 11 | Codex S2 | The marker test does not prove the whole launch never runs a row | VALID | The claim is narrowed to `worktree_problem()`, the only executing launch function. |
| 12 | Codex S3 | The lesson records history | INVALID | `references/lessons.md` is by design a list of real failures ("Each lesson below says what went wrong and how this skill prevents it", its TLDR). The AGENTS.md rule is about READMEs and docs. |
| 13 | Codex edge | A trailing `*` matches a different command | PARTIALLY VALID | The prefix form is the same as the standard commands (`allowCmds`). Documented in Context; test: no match for `pnpm start:prod` or another port. |
| 14 | Codex edge | Allow and deny both match | VALID | Covered by #5's test. |

Only Claude found: 1, 6, 7, 8, 9. Only Codex found: 2, 3, 5, 10, 11, 12, 13. Both: 4.

## Validation response

```text
Round 1 of .plans/20261125-125414-run-command-allow-rules.md: 13 of 14 findings were valid or partly valid and are fixed in the plan. One was rejected: lessons.md is a list of real failures by design. Main changes: the worktree_problem test works under set -e and has a positive control; the upgrade path for a kept CONFIG block is specified and tested; the AGENTS.md sentence covers project rows only; bootstrap.example.json stays unchanged; the validators also check deny rules; a placeholder in a run command is rejected; Claude Code's own matching is marked not verified. Round 2 validates these edits.
```
