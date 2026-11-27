# Validation round 3: 20261127-230103-template-updates-collector.md

- Claude (plan-validator): ON — APPROVE WITH CHANGES (`-validation-claude-3.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-3.md`)

## Regressions from round 2 (step a)

- REGRESSION R1 (Claude B1): round 2 named the report `bootstrap-collect-<slug>.md`, which doubles the prefix and does not match `/api/report?slug=<slug>`. Fixed (F1).
- REGRESSION R2 (Claude B4): step 14 still listed "names left out as common vocabulary" after round 2 removed the exemption. Fixed (F4).
- REGRESSION R3 (fixed by me before the snapshot): step 2 still said `round: <collected lines + 1>`.

## Findings

| ID | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1 | Report name vs `/api/report` slug | VALID | Report `<slug>.md`, PR body `<slug>-pr-body.md` |
| F2 | Claude B2 | Added-line check could compare with the session-editable copy | VALID | Compare with the worktree file; refuse when the run-folder copy changed |
| F3 | Claude B3, Codex S2 | Resume and open-PR check only in the current wave | VALID | Resume in the status's own wave first; open-PR check across all waves; one collector PR globally |
| F4 | Claude B4 | Step 14 contradicts "no exemption" | VALID | Item replaced by the real leave-outs |
| F5 | Codex B1, Claude S | Saved lines of a run killed before its commit get flushed | VALID | `flushWave()` appends only when the saved branch has a commit ahead of base; else deletes the file |
| F6 | Claude S | `flushWave` reads only the current render hash's saved file | VALID | It handles every saved file of the repo |
| F7 | Codex B2 | A newer run with zero updates does not supersede older updates | VALID | Every run saves a `run` line with `of` (also 0); reader takes the newest complete run |
| F8 | Codex B3 | No recovery when no wave is pending; `same` crash order | VALID | Dashboard allows a start when the status needs a resume; `collected` line first, then status |
| F9 | Codex B4 | Base-aware changelog check skipped on a resumed publish | VALID | `publish()` runs it before every push; retry test |
| F10 | Codex B5 | Script-written changelog vs `/changelog-entry` rule | RAISED BEFORE (round 1, F7) | No new evidence; no edit |
| F11 | Codex S1 | Which fields `redactText()` covers; UUIDs | VALID | Only free-text fields; structured fields stay |
| F12 | Claude S | Test cannot change the real templates | VALID | Simulated by editing the saved `templatesHash` |
| F13 | Claude S | Clone fixture has no `main` on an `auto/` branch | VALID | `git checkout -B main` in the clone |
| F14 | Claude S | `Default`/`Personal` names block every edit; regex escaping | VALID | Leave-outs and escaping |
| F15 | Claude S | Redaction markers copied into templates | VALID | Refused by `privateHits()` |
| F16 | Claude S (small) | Secret regex flags; `templatesHash` outside `try`; `wavesDir` import; `FAKE_UPDATE` feature; changelog name vs README; browser test registry | VALID | All applied |

Only Claude found F1, F2, F4, F6, F12–F16. Only Codex found F7–F11.

## Validation response

Applied: F1–F9, F11–F16. Raised before: F10. No owner question.
