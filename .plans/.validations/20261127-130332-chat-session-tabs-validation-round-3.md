# Validation round 3: 20261127-130332-chat-session-tabs

- Claude: ON (`-validation-claude-3.md`, APPROVE WITH CHANGES)
- Codex: ON (`-validation-codex-3.md`, NEEDS REWORK)

## Regressions from round 2 (diff `-pre-round-2.md` → `-pre-round-3.md`)

- REGRESSION (fixed before the validators ran): the round-2 fix "base fallback `bases[id] || run?.id || id`" in Step 4 did not reach **Contracts**, which still said only "takes the run tab's id". Contracts now adds "or its own id when there is no run tab". The snapshot `-pre-round-3.md` was taken again after this fix.
- Citations: the plan has no `:line` citations. Cross-references: step 1, step 4 still correct.

## Findings

| ID | Raised by | Section | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Claude (blocking) | Tests | The copy tab's `last` reads `''`, not `'and in a copy?'` | VALID | `readTranscript()` resets a cache entry only when `st.size < t.size`; the VS Code copy test leaves a 3-byte entry for `ses-copy.jsonl`; the fork's new file is read from byte 3 | `last` checked after `'back in the copy'` instead; reason noted in the test text |
| F2 | Claude (blocking) | Tests | The root-chat test's place is not named; before the chat test it breaks that test's first checks | VALID | the root chat shares the repo-root folder and the commands/models cache with `demo-plan` | Test placed after "a chat outlives a server restart…", with its own helpers |
| F3 | Codex (blocking) | Step 4 | `a.root` stays true after the plan gets a worktree; the run-tab pin then uses the wrong rule | PARTIALLY VALID | `chatStart()` resets `root` only on the next message; `rootChat()` checks the worktree. Copies made in the root folder get no tab in the worktree (Step 2), so "a selected worktree copy is lost" cannot happen; the run-tab rule is the real issue | Step 4 and Deviations use `rootChat(proj, slug, a)`; Harness constraints line (no pipeline project in the harness) |
| F4 | Codex (blocking) | Step 7, Tests | An open copy whose transcript is gone leaves one run tab, and the row hides: no way back | VALID | Step 7 hid the row at `tabs.length < 2`; New chat showed while `current.id !== latest` | Row shows when the open id has no tab; page-test case and chat-test case (`current` = `ses-gone`) |
| F5 | Codex | Step 2 | Summary reads can evict the open transcript from the 12-file cache | PARTIALLY VALID | `tabLastCache` misses only for files whose size or mtime changed; a copy that is not open does not change | Step 2 explains why no eviction loop happens; no new code |
| F6 | Codex | Tests | No bad-slug or 404 case | PARTIALLY VALID | shared guard `if (!proj \|\| !safeName(b.slug))`; chat routes have no 404 | Bad-slug `400` case added; "no 404" line |
| F7 | Claude | Tests | End the root-chat test with `/api/chat/new`, not Stop | VALID | Stop leaves `claude` open; a late refresh can write the ask file again | Changed |
| F8 | Claude | Tests | The `chatTabsHtml` regex needs the `m` flag | VALID | the `sentLanded` test uses `/…/m` | Regex written with `/m` |
| F9 | Claude | Step 2 | "scanned once per state" is wrong: `chatTranscript()` also scans | VALID | `chatState()` → `chatContext()` / `chatStartedAt()` → `chatTranscript()` → `planSessions()` | Wording: "the tabs add no extra scan" |
| F10 | Claude | Step 4 | A switch while a background task runs kills it | PARTIALLY VALID | `chatRestart()` refuses on `busy` only, so Fork and New chat do the same today | Deviations line: same as Fork / New chat |
| F11 | Claude | — | The `readTranscript()` cache drops the first line of a file that was deleted and written again (also in today's chat test) | VALID, outside this plan | `readTranscript()`: `if (!t \|\| st.size < t.size)` | Not in the plan; reported to the owner as a separate defect |

Found by one validator only: F1, F2, F7, F8, F9, F10, F11 (Claude); F3, F4, F5, F6 (Codex).

## Validation response

```text
Round 3 of .plans/20261127-130332-chat-session-tabs.md: 11 findings, 6 VALID, 4 PARTIALLY VALID, 1 VALID but outside the plan.

Blocking fixes:
- The copy's last text is checked after a line appended later (the transcript cache keeps a stale 3-byte entry from the VS Code copy test).
- The root-chat test goes after the restart test, with its own helpers, and ends with /api/chat/new.
- Step 4 uses rootChat() for the run-tab pin.
- The tab row shows when the open session has no tab, so the run tab stays reachable.

Other fixes: bad-slug 400 case, no-404 note, m flag, "no extra scan" wording, background-task note, cache-eviction note.

Outside the plan, reported to the owner: readTranscript() keeps a stale cache entry for a file that was deleted and written again with more bytes.

No owner decision was needed.
```
