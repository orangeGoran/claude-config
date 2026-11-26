# Validation round 4: 20261126-125107-fast-api-state.md

- Claude: ON (`-validation-claude-4.md`, APPROVE WITH CHANGES, no blocking issue)
- Codex: ON (`-validation-codex-4.md`, NEEDS REWORK, 1 blocking issue)
- Regressions from round 3 (diff `pre-round-3` → `pre-round-4`): one. Round 3 F1 changed step 4 and Contracts, but the Reference deviation and two Breaking changes bullets still described a rule that differs from step 4 (F2 below). Fixed this round.

## Findings

| ID | Validator | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| F1 | Codex B1 | A request joins a build that still runs, whatever its age, so a slow build can give data older than one poll | VALID | Step 4 `!stateBuild.done`; planner measurement 2.57–2.78 s for one build before fix A | Step 4: reuse only while `Date.now() - at < STATE_CACHE_MS` (no `done`); Contracts, Reference (Mirror, deviation), Breaking changes |
| F2 | Claude main | The Reference deviation and Breaking changes do not match step 4 (REGRESSION of round 3) | VALID | Plan Reference deviation and Breaking changes against step 4 | Solved by F1: one rule in every section |
| F3 | Codex S2 | "One build at a time" is not true after a clear or for a slow build | VALID | `invalidateState()` lets a new build start while the old one runs | Reference deviation: at most one new build in each window; the old build answers only its own requests and never becomes shared again |
| F4 | Codex S1 | Responsiveness during a build is not proved until the measurement passes | RAISED BEFORE (round 1, F3) | Steps 13–14 | No change |
| F5 | Codex S3 | `finally` does not run when `body()` never ends | RAISED BEFORE (round 3, F2) | No new evidence | No change |
| F6 | Codex edge | A validations folder replaced with the same mtime | RAISED BEFORE (round 1, F19) | The same limit as `sessionIdCache`, in Breaking changes | No change |
| F7 | Claude | The docs row and the roadmap sentence say "keeps it for 1 s" | VALID | Step 10 | Step 10 (shared for 1 s from the start of a build; `0` turns sharing off) |
| F8 | Claude | The cache test PATH lacks the system PATH (`sleep`, `node`, `lsof`) | VALID | `start()` adds `process.env.PATH` | Step 8 |
| F9 | Claude | The 4911 server starts with a relative script path, so `ps` cannot prove it | VALID | How to verify | How to verify (absolute paths from `git worktree list`) |
| F10 | Claude | `skills/bootstrap-project/references/contracts.md` documents `/api/state` fields | VALID (no code change) | `contracts.md` line about `bootstrapRun` and `bootstrapHash` | Contracts |
| F11 | Claude | The allow rule belongs in the same change (AGENTS.md) | VALID | AGENTS.md → Commands | Step 12 (the owner adds it to the same PR before the merge) |
| F12 | Claude | The private-data test checks only `demo-plan` | VALID | Tests 7 | Tests 7 (also `/\bdemo\b/` and the test's `tmp` path) |
| F13 | Claude | `clients=0` or `seconds=0` must exit 2; `<box>/gh` must exist before the start | VALID | Step 9; the fake `gh` appends to `calls.log` | Step 9, Tests 7, step 8 |

Found by one validator only: F1, F3, F4, F5, F6 (Codex); F2, F7–F13 (Claude). Raised before: F4, F5, F6.

## Final edits check

`diff -u .plans/.validations/20261126-125107-fast-api-state-pre-round-4.md .plans/20261126-125107-fast-api-state.md`, each hunk read against its finding, then the citation, cross-reference and propagation checks:

- Fixed: Breaking changes, `/api/state` bullet still said "Requests that come during one build". Now: "less than `STATE_CACHE_MS` after the start of a build (while it runs or after it ended)".
- Fixed: Tests 4 said "Without the shared build (a check that also accepts a build that has not ended)", which described the feature, not its absence. Now: "a reuse check that accepts only a build that has ended".
- Fixed: How to verify said "names the 'info' paths", against the no-paths rule of step 9. Now: "gives the 'info' lines (field names and counts)".
- Fixed: Step 8, a repeated clause about `calls.log` rewritten as two sentences.
- Checked: `grep -n "doneAt\|done\b\|end of the build\|keeps it for\|one build at a time"` gives no stale text; step numbers (4, 6, 7, 8, 9, 10, 13, 14) and unit-test numbers (1–7) still point at the right items; the new `contracts.md` consumer exists (`grep -n "api/state" skills/bootstrap-project/references/contracts.md`).
- Unresolved: none.

## Validation response

```text
Round 4 of .plans/20261126-125107-fast-api-state.md: 13 findings. 10 applied, 3 raised before (round 1 F3, round 3 F2, round 1 F19). The cache rule is now one rule in every section: a request reuses the last build only while it is less than DASH_STATE_CACHE_MS (1 s) old, while it runs or after it ended. The final edits check fixed four wording problems and left none open.
```
