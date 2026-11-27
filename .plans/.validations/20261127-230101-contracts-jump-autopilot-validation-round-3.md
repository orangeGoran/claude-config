# Validation round 3: 20261127-230101-contracts-jump-autopilot

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (`-validation-claude-3.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-3.md`)
- Regressions from step a (round 2 edits): none found (checked: no `base === sub.branch`, no `Q` placeholder, no first-segment-only text left; Claude round 3 also found none).

## Findings

| # | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1 | `'Never run a fifth round'` is not in the new step 15 sentence, so the round-cap test fails | VALID | Step 15: "Never run more than `<max>` rounds. Never run a fifth round."; tests and step 17 updated |
| F2 | Codex B1 | The watcher's plain submodule fetch can leave `origin/<branch>` stale | VALID | Step 6 resolves the branch first, then fetches with the explicit refspec |
| F3 | Codex B2 | `ghProblem()` output is stored and served without `redact()` | VALID (`ghProblem` only cuts the first line) | `redact(ghProblem(output))` |
| F4 | Codex B3 | An unknown commit folder falls back to the guard's own worktree, whose `auto/*` exemption can let it through | VALID | Unknown folder → exit 2 with a message; D13; test from an `auto/*` worktree |
| F5 | Claude S1 | 2a is now committed (`297b2bf`) | VALID (`git log` of the 2a branch) | Context and step 10 name `297b2bf` |
| F6 | Claude S2 | `-C ~/…` no longer expanded → regression | VALID | `~` rule for `-C` too; test |
| F7 | Claude S3 | `set -e` + failing `cd` in `common()` exits 1 → unchecked commit | VALID | `|| true` |
| F8 | Claude S4 | `QA-tool` case cannot fail | VALID | `QA-tool` is its own repo, expect 0 |
| F9 | Claude S5 | `jumpCardHtml` test needs stubs | VALID | Named |
| F10 | Claude S6 | Loop variable `path` shadows `node:path` | VALID | `subPath` |
| F11 | Claude S7 | `git add -- .plans/<slug>.md` wrong for a custom `plansDir` | VALID | `path.relative(proj.root, file)` |
| F12 | Claude S8 | Non-JSON PR page | VALID | `'gh gave no PR data'` |
| F13 | Claude S9 | Hook folder not proven | PARTIALLY VALID | The guard starts from the hook input's `cwd` field, else `process.cwd()`; Harness constraints note |
| F14 | Codex S2 | Exactly 500 PRs called "more than 500" | VALID | "500 or more open PRs" |
| F15 | Claude edge | `?checklist=` of a removed group | VALID | D15 names the fallback |
| F16 | Codex S1 | Recheck 2a after merge | RAISED BEFORE (round 1, F18) | none |

Found by one validator only: F2–F4, F14 (Codex); F1, F5–F13, F15 (Claude).

## Validation response

Accepted and applied: F1–F15. F16 raised before. No owner question.
