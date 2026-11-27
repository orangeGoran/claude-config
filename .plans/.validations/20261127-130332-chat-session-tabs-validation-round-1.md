# Validation round 1: 20261127-130332-chat-session-tabs

- Claude: ON (`-validation-claude-1.md`, APPROVE WITH CHANGES)
- Codex: ON (`-validation-codex-1.md`, NEEDS REWORK)
- Regressions from the previous round: none (first round of this run)

## Findings

| ID | Raised by | Section | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Claude (blocking) | Steps 4, Deviations | The run tab sets `a.current = null`; a root chat then starts a new session without `--resume` | VALID | `server.mjs` → `chatStart()`: `const id = a.current ? a.current.id : a.root ? null : …` | Step 4: `a.current = a.root ? { id, base: id, copy: false } : null`; Deviations line; root-chat case in the scout Confirm test |
| F2 | Claude + Codex (blocking) | Step 10 (CSS) | `.ctabs { display:flex }` overrides `hidden` | VALID | `app.css`: `.cctx[hidden]`, `.cidle[hidden]`, `#stabs[hidden] { display:none; }` | `.ctabs[hidden] { display:none; }` added; mirror line |
| F3 | Codex (blocking) | Steps 2, 4 | A VS Code copy tab disappears after a switch away, as it is only a tab while it is `current` | PARTIALLY VALID | `followVscodeCopy()` moves `a.current.id` and does not add to `copies`. In a pipeline worktree the VS Code copy is usually the newest file, so it is the run tab (no loss); in a generic project it is not in `sessionIdsInLog()` and is lost | Step 4: when leaving a tab in neither `sessions` nor `copies`, add it to `copies` + `bases`. The pipeline "listed as a run session" part is today's behaviour, not this plan's |
| F4 | Codex (blocking) | Step 2 | `statSync()` on a missing transcript can make `chatState()` throw | VALID | `readTranscript()` and `chatTranscript()` guard missing files; the plan's `statSync` had no guard | Step 2: `statSync` in `try`/`catch`, no tab for a missing file; test with `ses-gone` |
| F5 | Codex + Claude | Hard rules | Restart line omits the "only when the relay check shows live chats under the relay" condition | VALID | `AGENTS.md` → Hard rules → Restart after dashboard changes | Hard rules line rewritten |
| F6 | Codex + Claude | How to verify | `grep -c 'id="cnew"'` exits 1 when the result is right | VALID | grep exit status on zero matches | grep removed; the page-function test asserts `doesNotMatch(src, /id="cnew"/)` |
| F7 | Codex + Claude | Contracts, Step 2 | `clip(text, 120)` appends a suffix, so `last` can exceed 120 | VALID | `server.mjs` → `clip()` | `String(text).slice(0, 120)` |
| F8 | Codex | Tests, Endpoint access | No cross-site or bad-request case for the new route | VALID | `crossSiteReason()`; shared guard `if (!proj \|\| !safeName(b.slug)) return json(res, 400, …)`; pattern in the `bootstrap-upgrade` refusal test | New refusal test (403, 400); Endpoint access names both and why sign-in / tenants do not apply |
| F9 | Codex | How to verify, Step 12 | The changelog validator is required | VALID | `changelog.d/AGENTS.md`: `node .claude/scripts/changelog-validate.mjs --base origin/main` must print `PASS` | Added to Step 12 and How to verify |
| F10 | Codex + Claude | Step 2 | Each state event reads every tab transcript; the cache keeps 12 files; state is emitted many times per turn | VALID | `TRANSCRIPTS_KEPT = 12`; 13 `chatEmitState(` calls in `server.mjs` | `tabLastCache` keyed on size + mtime (mirrors `sessionIdCache`), bounded to 100 entries |
| F11 | Claude | Tests, Harness constraints | The page has a function-test harness (regex + `new Function`) | VALID | `dashboard.test.mjs` → the `sentLanded` page test | Tab markup moved to a pure `chatTabsHtml()` with its own page test |
| F12 | Claude | Steps 4 | `chatSwitch()` must load through `followVscodeCopy()` as `chatState()` does, or a shown tab is refused | VALID | `chatState()`: `a = followVscodeCopy(proj, slug, loadChat(proj, slug))` | Step 4 loads the same way |
| F13 | Claude | Step 9 | Page should read `st.tabs \|\| []` | VALID | a newer page against an older server throws on `undefined.length` | Step 9 and Contracts |
| F14 | Claude | Affected files | Wording: "after the Fork block" vs "after the New chat block" | VALID | the plan text | Affected files says "after the New chat … block" |
| F15 | Claude | Step 10 | Global `button:hover` accent border applies to `.ctab` | VALID | `app.css`: `button:hover, .hdlink:hover { border-color:var(--accent); }` | `.ctab:hover { border-color:transparent }`; browser-test item (6) |
| F16 | Claude | Step 7 | `role="tab"` without `aria-controls` / arrow keys is a partial tablist | VALID | WAI-ARIA tabs pattern | Plain buttons with `aria-pressed`; Deviations line |
| F17 | Codex + Claude (edge) | Step 4, Tests | A tab click while a Fork is pending; a click on the open tab | VALID | `chatRestart(…, true)` sets only `a.fork` | Step 4: a click on the open tab cancels the Fork and keeps the open `claude`; test case |
| F18 | Codex + Claude (edge) | Contracts | Old `ask/<slug>.json` with no `bases` | VALID | `loadChat()` returns the file as it is | Contracts: base falls back to the run tab's id |
| F19 | Codex (edge) | Step 7 | Two ids share the first 8 characters | PARTIALLY VALID | Claude session ids are UUIDs; a clash in 8 hex characters among 2–3 tabs is very unlikely | Step 7: the `title` carries the full id; no label change |

Found by one validator only: F1, F11, F12, F13, F14, F15, F16 (Claude); F3, F4, F8, F9, F19 (Codex).

## Validation response

```text
Round 1 of .plans/20261127-130332-chat-session-tabs.md: 19 findings, 17 VALID, 2 PARTIALLY VALID, 0 INVALID. All fixes are in the plan.

Blocking fixes:
- Run tab in a root chat pins its session (a.current = { id, base: id, copy: false }) instead of null; root-chat test added.
- .ctabs[hidden] { display:none; } added.
- A VS Code copy tab is added to copies + bases when you switch away from it.
- A tab whose transcript file is missing is skipped (statSync in try/catch); test with ses-gone.

Other fixes: restart rule condition; grep -c replaced by a page test; last cut with slice(0, 120); 403 and 400 tests for /api/chat/switch; changelog validator in verify; tabLastCache for the per-state read cost; chatTabsHtml() page-function test; chatSwitch() loads through followVscodeCopy(); st.tabs || []; wording; .ctab hover; aria-pressed instead of role=tab; open-tab click cancels a pending Fork; no-bases fallback documented; full id in the tab title.

No owner decision was needed.
```
