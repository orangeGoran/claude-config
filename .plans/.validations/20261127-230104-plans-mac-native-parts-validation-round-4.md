# Validation round 4 — 20261127-230104-plans-mac-native-parts

- Claude (plan-validator): ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-claude-4.md` (APPROVE WITH CHANGES)
- Codex: ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-codex-4.md` (NEEDS REWORK)
- Regressions from round 3 edits (diff pre-round-3 → pre-round-4): 0. Claude confirms the round 3 changes against the code (redaction, five-tool buttons, `psCommand()` null = live, `takeLock()` mirror, `pidGone()`). Claude F2 (step 19 lacked the second `appStatus()` call and the `reloading` flag) is an incomplete propagation of round 3 F6: fixed below.

## Findings

| ID | Source | Finding | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| F1 | Claude B | `typing` counts read-only copy rows (`addCopyRow()`: `readOnly`, value set by script) and the closed palette's `#palq` | VALID | `addCopyRow()` in app.js; `#palq` in page.html | Count only fields that are not read-only or disabled; leave out `#palq`; tests |
| F2 | Codex B | Drafts and images of chats not on screen live only in memory (`chatDraft`, `chatImgs`) | VALID | `const chatDraft = {}, chatImgs = {}` in app.js; `chatBind()` rebuilds `#cin` | `typing` also true for a non-blank `chatDraft[key]` or a non-empty `chatImgs[key]`; tests |
| F3 | Claude SF | Step 19 lacks the second `appStatus()` call, the last `typing` check and `reloading` | VALID (propagation of round 3 F6) | step 19 | Step 19 completed |
| F4 | Claude SF | Step 16 stubs miss `settingsDirty` | VALID | step 16 | Stubs listed (also `chatDraft`, `chatImgs`) |
| F5 | Claude SF | `build.mjs` install line "Quit Shipyard (⌘Q)…" is half wrong now | VALID | `build.mjs` last `console.log` | Step 2 changes the line |
| F6 | Claude SF | `GET /api/app` access row understates its work | VALID | — | Row says it hashes, reads the build files and runs one `ps` while a lock exists |
| F7 | Claude SF | `linkSync` back with `EEXIST` in the stale-lock move | VALID | `takeLock()` | Refuse and keep the newer lock |
| F8 | Codex NB | `NotebookEdit` uses `input.notebook_path` | VALID | `toolSummary()` in server.mjs | Target field fixed in Decisions and step 6 |
| F9 | Codex NB | Breaking changes text contradicts `SERVER_RINGS` | VALID | Breaking changes vs Decisions | Text aligned |
| F10 | Codex NB | Native delivery is manual only | RAISED BEFORE (round 2, F16) | no new evidence | No change |

Found by one validator only: F1, F3–F7 (Claude); F2, F8, F9 (Codex).

## Validation response

```text
Round 4: 10 findings, 9 VALID, 1 RAISED BEFORE. Applied: typing skips read-only, disabled and #palq fields and counts the in-memory chat drafts and images; step 19 has the second appStatus() check and the reloading flag; NotebookEdit target is notebook_path; the stale-lock move refuses on EEXIST; the build.mjs install line, the GET /api/app access row, the step 16 stubs and the Breaking changes text are corrected.
No owner question raised.
```

## Final edits check

`diff -u .plans/.validations/20261127-230104-plans-mac-native-parts-pre-round-4.md .plans/20261127-230104-plans-mac-native-parts.md`: 11 changed paragraphs (Decisions: buttons target fields, typing rule; Endpoint access GET row; Breaking changes alertUser; Steps 2, 6, 11, 14, 16, 19; Unit tests appStatus).

- Each hunk does what its finding asked. The new `typing` rule is the same in Decisions, step 14 and the unit test. The `notebook_path` change is in Decisions and step 6. Step 19 now matches the Decisions bullet and the Swift source check in Tests.
- Citations re-opened: `addCopyRow()`, `#palq`, `chatDraft` / `chatImgs` (and their clearing on send in `chatSend` paths), `toolSummary()`, `takeLock()`, the last `console.log` of `build.mjs`.
- Cross-references: no step was added or removed in round 4; steps 1–27 keep their numbers.
- Propagation: the `#cin` box holds a draft set by script (`inp.value = chatDraft[p.key]`), so its `defaultValue` is `''` and the DOM rule counts it, which is correct. No fix of my own was needed.
- Unresolved problems: none.
