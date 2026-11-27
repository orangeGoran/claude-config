# Validation round 2: 20261127-230103-template-updates-collector.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-claude-2.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-2.md`)

## Regressions from round 1 (step a)

- REGRESSION R1 (found by me before the validators ran, fixed before the round-2 snapshot): the round-1 follow-up rounds `-<k>` let a new collector run open a second PR while an older round's PR was still open. Step 10 now checks the newest `collected` line's PR first.
- REGRESSION R2 (Claude B1, Codex B1): the round-1 `flushWave()` ran only after the commit and in `publish()`; three resume paths in `upgrade()` skip `publish()`, and `waveWritten` was lost because `upgrade()` writes a fresh status. Fixed (F1).
- REGRESSION R3 (Claude B4): the round-1 take-back ("delete the `collected` line") lowered `k` and re-collected the closed round. Fixed (F5).

## Findings

| ID | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1, Codex B1 | Wave flush misses resume paths; retry recomputes run id and templates hash | VALID | Saved file holds `runId`, `runAt`, `templatesHash`; `flushWave()` appends missing ids, runs after the commit and before every resume branch; no `waveWritten` flag |
| F2 | Claude B2 | Stale saved lines after a failed commit hook | VALID | Saved file deleted on a fresh worktree and on a failure before the commit; test |
| F3 | Codex B2 | "Last appended line" run selection loses newer runs and exposes partial runs | VALID | Lines carry `runAt` and `of`; reader takes the complete run with the newest `runAt` |
| F4 | Claude B3, Codex B5 | Collector loses `ids` on retry; `collected` append not idempotent; round from line count | VALID | `collectId`, `ids`, `round`, `branch` carried over; resume previous branch first; one `collected` line per branch; `round` stored, next = max + 1 |
| F5 | Claude B4 | Take-back undoes itself | VALID | Take-back = set `ids` to `[]`; round stays |
| F6 | Claude B5 | Refusal status names the new branch, chip stuck | VALID | Status gets the open PR's branch |
| F7 | Claude B6, Codex B4 | `out/` paths unchecked; blanket exemption for names in templates; moved lines | VALID | Paths checked; no exemption; a line not in the replaced file counts as added; tests |
| F8 | Codex B3 | Session-bound fields not cleaned of names and home paths | VALID | `<project>` / `<home>` replacement plus `redactText()` before `task.json`; test |
| F9 | Claude S, Codex B6 | Changelog name collides for round 2 on the same day; no `--base` check | VALID | `changelog.d/<slug>.yaml`, refuse when it exists, `--base origin/<base>` after the commit |
| F10 | Codex B7 | Test fixture is not faithful | VALID | `git clone --no-hardlinks` of HEAD as the fixture |
| F11 | Claude S | `data-bsreport` holds the project, not the slug | VALID | Step 17 uses `data-bsreport`, `data-hash`, `data-kind` |
| F12 | Claude S | Dashboard `collect-repo` needs `.claude/bootstrap.json` | VALID | Step 18 |
| F13 | Claude S | `acme` names occur in the templates | VALID | Fixtures use `nimbus-*`; `grep -ri nimbus skills/bootstrap-project/templates` is empty |
| F14 | Claude S | `/api/state` reads every wave file each time | VALID | Cache keyed by names, sizes, mtimes |
| F15 | Claude S | `docs/roadmap.md:33` out of date | INVALID for this plan | The caller updates `docs/roadmap.md`; this session must not edit it |
| F16 | Codex S1 | Special template path mappings | VALID | `collect.md` lists them (step 8) |
| F17 | Codex S2 | 404 case | INVALID | No resource id in the route; stated in Tests |
| F18 | Codex S3 | `DASH_COLLECT_REPO` in docs | VALID | Step 19 |

Only Claude found F2, F5, F6, F11–F15. Only Codex found F3, F8, F10, F16–F18.

## Validation response

Applied: F1–F14, F16, F18. Rejected: F15 (out of this session's scope; caller edits the roadmap), F17 (not applicable). No owner question; new defaults are in "Decisions taken for the owner".
