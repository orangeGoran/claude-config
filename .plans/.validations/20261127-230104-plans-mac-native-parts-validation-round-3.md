# Validation round 3 — 20261127-230104-plans-mac-native-parts

- Claude (plan-validator): ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-claude-3.md` (NEEDS REWORK)
- Codex: ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-codex-3.md` (NEEDS REWORK)
- Regressions from round 2 edits (diff pre-round-2 → pre-round-3): 0 found by the self-check. Claude F1 (typing nearly always true) and Claude F2 (redact cuts at 500) are defects in round 2 text; they are counted as findings below, not as regressions of a correct part.

## Findings

| ID | Source | Finding | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| F1 | Claude B1 | `typing` counts prefilled fields (`#notetext`, Settings rows, `#scandir`, `#bq`), so reload and relaunch never run | VALID | `page.html` `#notetext`; Settings rows drawn with `value=` in app.js | Count a field only when `value !== defaultValue`; leave out `#q` and `#notetext` (kept in `localStorage` `dash-note`); tests with a prefilled field |
| F2 | Claude B2 | `redact()` cuts at 500 chars, so the bar shows old middle lines | VALID | `redact()` in `watch.mjs` ends with `.slice(0, 500)` | Redact line by line, then `.slice(-4000)`; long-output test |
| F3 | Claude B3 + Codex B3 | Buttons for tools with no shown target; newline / bidi can hide a part of a Bash command | VALID | `notifyParts()` does not join lines | Buttons only for Bash, Edit, Write, MultiEdit, NotebookEdit with a 1–120 char printable-ASCII target, no URL, unchanged by `redact()`; every other ask has no buttons; tests with a new line and `WebFetch` |
| F4 | Claude B4 + Codex NB2 | `psCommand()` null read as stale; `app-build` marker can be cut in `ps` | VALID | `psCommand()`; `lockState()` treats null as "says nothing" | null = live; `argv0: 'app-build'` so the marker starts the command line; `pidGone()` as `bootstrapUpgrade()` |
| F5 | Codex B1 + Claude SF | Stale-lock removal races between servers | VALID | `takeLock()` rename trick | Move the stale lock with rename, re-read text and mtime, `linkSync` back on a mismatch; race test |
| F6 | Codex B2 | Text typed during the fresh GET can be lost | VALID | step 19 | Second `appStatus()` call after the GET; reload in that callback; `reloading` flag |
| F7 | Codex B4 | `SERVER_RINGS.runs` can be wrong on a second server; watcher events are at most once | PARTIALLY VALID | `watchProject()` saves state before notifications (existing design); the lock holder reads every run from disk | Kept static; known limit written in Decisions and the docs step; no new mechanism (the page cannot see the lock holder) |
| F8 | Codex B5 | Relaunch impossible when the page has no hook or is off origin | VALID | step 19 | A null `appStatus()` answer and an off-origin page allow the relaunch; only `typing: true` holds it |
| F9 | Claude SF | Step 15 and its test disagree on which calls pass `p` | VALID | step 15 / Unit tests | Test text aligned |
| F10 | Claude SF | No positive `SERVER_RINGS` test | VALID | — | Watcher test: the main server page has `{"asks":true,"runs":true}` |
| F11 | Claude SF | "Lock holds a live PID" can read an empty lock | VALID | — | Poll with `until` |
| F12 | Claude SF | Docs: Allow on Edit / Write shows only the path | VALID | — | Docs step says which asks get buttons |
| F13 | Codex NB1 | Native delivery stays manual | RAISED BEFORE (round 2, F16) | no new evidence | No change |

Found by one validator only: F1, F2, F9–F12 (Claude); F6–F8 (Codex). Both: F3, F4, F5.

## Validation response

```text
Round 3: 13 findings, 11 VALID, 1 PARTIALLY VALID, 1 RAISED BEFORE. Applied: typing by value !== defaultValue (not #q, #notetext); line-by-line redaction of the build log; Allow / Deny only for five tools with a short printable-ASCII target; psCommand null = live and argv0 'app-build'; stale-lock move with the takeLock() rename; a second appStatus() check right before reload; relaunch allowed for pages without the hook; test fixes and new tests (long output, stale-lock race, positive SERVER_RINGS). Known limit recorded for run-outcome notifications on a second server with the watcher off.
No owner question raised.
```
