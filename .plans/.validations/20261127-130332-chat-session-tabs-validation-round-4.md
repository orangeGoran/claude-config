# Validation round 4: 20261127-130332-chat-session-tabs

- Claude: ON (`-validation-claude-4.md`, APPROVE WITH CHANGES, no blocking findings)
- Codex: ON (`-validation-codex-4.md`, NEEDS REWORK)
- Regressions from round 3 (diff `-pre-round-3.md` → `-pre-round-4.md`): none. Claude round 4 checked each round-3 change against the fake `claude` and the harness state at its place in the test file; all hold. No `:line` citations; step references still correct.

## Findings

| ID | Raised by | Section | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Codex (blocking) | Steps 2, 4 | A VS Code copy in a pipeline worktree is listed as the run's latest session, so it becomes the run tab | RAISED BEFORE (round 1, F3) | Round 1 classified the pipeline part as today's behaviour: `planSessions()` lists the whole worktree folder, and New chat today opens that same latest session. No new `file:line` or fact | None |
| F2 | Codex (blocking) | Step 7 | A pending Fork cannot be cancelled when the run is the only tab | INVALID (as blocking) | Today's page has no cancel either: `cfork` is disabled while `st.fork`, and `cnew` is hidden when `current.id === latest` (`app.js` → `chatState()`). The plan adds cancel only where the row shows | Docs step 11 says "while the tab row shows" (see F4) |
| F3 | Codex | Tests | The tab preview relies on the stale-cache behaviour of `readTranscript()` | RAISED BEFORE (round 3, F11) | The defect exists today and was reported to the owner; the plan's test text already documents it | None |
| F4 | Claude | Step 11 | The doc says a click on the open tab cancels a pending Fork, but with no copy the row is hidden | VALID | Step 7 hides a one-tab row when it is open | Step 11: "while the tab row shows" |
| F5 | Claude | Tests | The root-chat test closes `claude` only at the end of its body | VALID | a failed assertion leaves it open; a late refresh can write the ask file again | `finally` calls `/api/chat/new` first |
| F6 | Claude | Step 7 | `esc` throws on a number | VALID | `app.js`: `const esc = (x) => (x \|\| '').replace(…)` | Step 7: values go in as strings |
| F7 | Codex | Browser test | The browser test should use disposable data | PARTIALLY VALID | the test dashboard uses the real `~/.claude` state | A throwaway scratch project only; no separate `HOME` (the dashboard reads its registry from `HOME`) |
| F8 | Claude (edge) | — | A switch while `chatMessage()` waits for a closing chat sends the message to the new session; Fork and New chat have the same gap | ACCEPTED AS IS | the same as `chatRestart()` today | None |
| F9 | Claude (edge) | Step 7 | Zero tabs → `''` | VALID (already true) | `tabs.some(…)` is false, the map gives `''` | None |

No accepted blocking fix in this round. Found by one validator only: F1, F2, F3, F7 (Codex); F4, F5, F6, F8, F9 (Claude).

## Final edits check

Diff `-pre-round-4.md` → plan: 5 hunks (Step 7 `esc` strings, Step 11 doc wording, root-chat test `finally` and its last bullet, Browser test data). Each does what its finding asked. Citations: none added. Cross-references: none changed. Propagation: the `finally` change reached both bullets of the root-chat test; the Fork-cancel wording is in Step 11 only, the one doc step, and Deviations already says the row hides with one open tab. No problem found, no fix made, nothing unresolved.

## Validation response

```text
Round 4 of .plans/20261127-130332-chat-session-tabs.md: 9 findings. No accepted blocking fix.
- Codex blocking F1 (VS Code copy as run tab in a worktree): raised before in round 1 (today's behaviour), no new evidence.
- Codex blocking F2 (cancel a pending Fork with one tab): not a regression; today's page has no cancel either. The doc now says the cancel works while the tab row shows.
- Small fixes: doc wording, root-chat test closes claude in finally, esc gets strings only, browser test uses a throwaway project.
Status: READY.
```
