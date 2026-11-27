# Validation round 1: 20261127-230103-template-updates-collector.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-claude-1.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-1.md`)
- Regressions from the previous round: none (first round)

## Findings

| ID | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1, Codex B3 | Claude-written texts in `collect.json` (titles, reasons, questions) reach the public PR body and changelog unchecked | VALID | `privateHits()` runs on every `collect.json` text and on `out/` lines; PR body and changelog are built only from checked texts; tests per channel (step 12, 13, Tests) |
| F2 | Claude B2 | The `redactText()` secret pattern matches normal prose ("a token that stays valid"); `upgrade-run.mjs` `redactText()` uses `([=: ]+)` | VALID | Own narrow secret pattern (Decisions taken for the owner), test that prose passes |
| F3 | Codex B1 | A wave is collected once; later or closed-PR updates are lost; re-discovery is not guaranteed | PARTIALLY VALID | `collected` lines list exact ids; later ids stay pending; follow-up branch `auto/bootstrap-collect-<hash>-<k>`; closed PR ids count as the owner's no, with a documented way back |
| F4 | Codex B2 | A failed append after the commit loses the updates; a resumed publish has no decisions | VALID | Lines saved to `bootstrap-upgrade-updates-<hash>.json` before the commit; `flushWave()` after the commit and at the start of `publish()`; `waveWritten` flag; duplicate ids read once |
| F5 | Codex B4 | Line ids from `startedAt` can collide across repos | VALID | `runId` = `randomUUID()` |
| F6 | Codex B5 | `resumeCommand()` not exported | INVALID | `upgrade-run.mjs` already has `export const resumeCommand`; the Wiring row now names it as an existing export |
| F7 | Codex B6 | `changelog.d/AGENTS.md` says use `/changelog-entry`; the script writes the entry | PARTIALLY VALID | Kept the script entry (no chat session in the run), justified as a deviation; validator runs before the commit |
| F8 | Claude S | `SKILL.md` "Unattended mode" sends every `--unattended` run to `unattended.md` | VALID | Step 9: `--collect` checked first |
| F9 | Claude S | `realpathSync` in `fullState()` can throw | VALID | try/catch as `ownRepo()` |
| F10 | Claude S | `prLists` keyed by `proj.root`, not `COLLECT_REPO` | VALID | `bootstrapCollectRunOf(root)` reads `prLists[proj.root]` |
| F11 | Claude S | Check client, title, remote owner too, not only the folder name | VALID | `names` in each update line, from the project's `bootstrap.json` |
| F12 | Claude S | `templateUpdates[].path` is often a repo path; dedupe by exact text rarely works | VALID | `collect.md` maps paths and merges by meaning (step 8, decision) |
| F13 | Claude S | `openUpgradeReport()` change missing in Breaking changes, handler wiring | VALID | Breaking changes row, `data-kind` |
| F14 | Claude S (small) | Browser test card name; `FAKE_UPDATE` env; fixture names and double POST; timeouts; `--help`; both hashes in report; common names | VALID | All applied (Browser test, step 6, Tests, step 13, step 16, step 14, decision on common names) |
| F15 | Codex S1 | Restart open item omits the relay condition | VALID | Hard rules line now has the condition |
| F16 | Codex S2 | Recheck against the merged earlier plans | INVALID | The Context already says the run starts from `origin/main` after both merged and cites by symbol |
| F17 | Codex S3 | 403 host and missing-route tests | PARTIALLY VALID | `Host: evil.example` 403 added; a missing route is not part of this change |
| F18 | Codex edge cases | All skipped / no change; no excerpt; malformed lines; crash before `collected` | VALID | state `same` + `collected` with `pr: null`; skip rule for no excerpt; type checks in `readWave()`; status `ids` and retry append |

Only Claude found F2, F8–F14. Only Codex found F3–F7, F15–F18.

## Validation response

Applied: F1–F5, F7 (as a justified deviation), F8–F15, F17 (partly), F18. Rejected: F6 (export exists), F16 (already covered). No owner question: each fix follows the owner decisions 9A and 10A, and the new defaults are in "Decisions taken for the owner".
