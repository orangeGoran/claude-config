# Validation round 2: 20261127-130332-chat-session-tabs

- Claude: ON (`-validation-claude-2.md`, APPROVE WITH CHANGES)
- Codex: ON (`-validation-codex-2.md`, NEEDS REWORK)
- Regressions from round 1 (diff `-pre-round-1.md` → `-pre-round-2.md`): none. No `:line` citations in the plan; step cross-references (step 1, step 4) still point at the right steps; each round-1 fix reached Steps, Tests, Affected files, Wiring and Browser test. Round 2 found that one round-1 addition (the root-chat case in the scout Confirm test) cannot run — counted as finding F1 below, not as a regression of the edit's intent.

## Findings

| ID | Raised by | Section | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Claude (blocking) + Codex (blocking, test coverage) | Tests | The root-chat case in the scout Confirm test never goes idle, has no `ses-probe` transcript, and only clicks the open tab (early return), so it tests nothing | VALID | `server.mjs` → `scoutConfirmPrompt()` contains "plan"; `FAKE_CLAUDE` `if (/plan/.test(q))` sends an ExitPlanMode request and no `result` | New test "a root chat's run tab resumes its own session" with a hand-made root chat (`root`, `own`, copy current, `bases`): switch to `ses-root`, `current` stays pinned, next spawn `--resume ses-root$`. Harness constraints line |
| F2 | Codex (blocking) | Step 4 | `a.bases[that id] = …` throws on an old chat file without `bases` | VALID | `loadChat()` returns the file as it is; the VS Code copy test's pinned file has no `bases` | Step 4 uses spreads for `copies` and `bases`; new case in the VS Code copy test (switch away, copy keeps its tab, no throw) |
| F3 | Codex (blocking) | Steps 2, 4 | `followVscodeCopy()` uses the worktree folder for a pipeline project's root chat, while `planSessions()` uses the repo root | INVALID for this plan | `followVscodeCopy()` → `transcriptDirFor(proj.hasPipeline ? worktreeOf(proj, slug) : proj.root)` — a defect that exists today, outside this plan's scope (the plan does not change `followVscodeCopy()`); reported to the owner separately | None |
| F4 | Codex (blocking) | Step 4 | `tabs[0]` is taken as the run tab even when the run transcript is missing | VALID | Step 2 skips a missing file, so `tabs[0]` can be a copy | Step 4 finds the run tab by `kind`; base fallback `bases[id] \|\| run?.id \|\| id`; Harness constraints line (not testable without breaking later tests) |
| F5 | Codex | Contracts | No 404 case | PARTIALLY VALID | `/api/chat/*` refusals answer 200 `ok: false` (`chatRestart()`); no 404 exists for chat routes | Contracts documents it; no new test |
| F6 | Codex | Step 9 | The page ignores a refusal | INVALID | `app.js` → `post()`: `if (r.output) alert(…)` | Step 9 notes that `post()` shows it |
| F7 | Codex (edge) | Step 2 | A root chat moved to a worktree keeps root-folder copy ids | VALID (already handled) | Step 2 skips an id with no file in the current transcript folder | Step 2 names this case |
| F8 | Claude | Steps | No step writes the `chatTabsHtml()` page test | VALID | Step 6 listed only server cases | Step 9 adds the page test and runs the file |
| F9 | Claude | Tests | "Refused while busy" can flake without an idle wait before `'step one'` | VALID | the other sends in the chat test wait for `!busy` | Wait-for-idle added |
| F10 | Claude | Step 2, Deviations | An older run session as `current` is labelled "copy" | PARTIALLY VALID | `current.copy` is `false` for a VS Code copy too (VS Code copy test), so it cannot drive the label | Deviations line accepts it |
| F11 | Claude | Steps 2–4 | `chatTabs()` scans the transcript folder again on each state | VALID | `chatState()` already calls `planSessions()` | `chatTabs(a, ps)` takes the caller's `planSessions()` result; `chatState()` and `chatSwitch()` call it once |
| F12 | Claude | Tests | `ses-gone` stays in `demo-plan.json` | VALID | the later tests read the same file | Test takes it out again |

Found by one validator only: F2, F3, F4, F5, F6, F7 (Codex); F8, F9, F10, F11, F12 (Claude). F1 by both.

## Validation response

```text
Round 2 of .plans/20261127-130332-chat-session-tabs.md: 12 findings, 8 VALID, 2 PARTIALLY VALID, 2 INVALID.

Blocking fixes:
- The root-chat case moved to its own test with a hand-made root chat (the Confirm prompt hits the fake's plan branch and never ends); it now switches from a copy back to the root session and checks --resume ses-root.
- chatSwitch() spreads copies and bases (an old file has no bases); the VS Code copy test checks switching away.
- The run tab is found by kind, not tabs[0]; base fallback defined.

Rejected: followVscodeCopy() folder for pipeline root chats (a defect that exists today, outside this plan; reported to the owner); page refusal (post() already alerts).

Other fixes: page-test step; idle wait before 'step one'; "copy" label accepted in Deviations; one planSessions() per state; ses-gone cleanup; 404 note in Contracts; moved-root-chat case named in Step 2.

No owner decision was needed.
```
