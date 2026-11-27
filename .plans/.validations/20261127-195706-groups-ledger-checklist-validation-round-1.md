# Validation round 1: 20261127-195706-groups-ledger-checklist.md

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (5 blocking, 11 should fix). Report: `20261127-195706-groups-ledger-checklist-validation-claude-1.md`.
- Codex (`validate-plan`): ON — NEEDS REWORK (4 blocking, 3 non-blocking). Report: `20261127-195706-groups-ledger-checklist-validation-codex-1.md`.
- Regressions from the previous round: none (first round of this run).

## Findings

| ID | Raised by | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| F1 | Claude B1, Codex B1 | `POST /api/ledger/open` next to `/api/vscode` is after the project-and-slug guard: always 400 | VALID | `server.mjs` POST block: `if (!proj \|\| !safeName(b.slug)) return json(res, 400, { error: 'bad request' });` comes before `/api/vscode`; `/api/scout/run` is before it | Step 7, Wiring table, Reference mirror: the route goes next to `/api/scout/run`, before the guard |
| F2 | Claude B2, Codex B1 (refresh) | `renderChecklist()` after `renderBoard()` runs only when `/api/state` changed; a ledger edit never shows | VALID | `app.js` `refreshOnce()`: `renderBoard()` is inside `if (raw !== lastStateRaw && …)`; `if (logKey) loadLog();` runs on every good tick | Step 12 and the Deviation: the call goes next to `if (logKey) loadLog();`; Browser test 3 says "no plan or PR changes" |
| F3 | Claude B3, Codex B3 | `_ck` is not cleared on open: the drawer stays on "loading…" after a reopen | VALID | `openScout()` pattern writes "loading…" into `#logbody`; Scout, Settings and the log reuse `#logbody` | Step 11 `openChecklist()` sets `_ck = null`; Browser test 3a |
| F4 | Codex B4, Claude NB3 | No check after the fetch: a stale answer paints over another drawer or group | VALID | `renderScout()` calls `showing()` again after its `await` | Step 11: `showing()` and the pick are checked again after the `await`; Browser test 3b |
| F5 | Claude B4 | E2E merge case posts `/api/pr-refresh` with only `project`: 400, then a 60 s wait | VALID | `/api/pr-refresh` is after the same guard; the page sends `{ project, slug }` | E2E "The chain follows a merge" sends `slug` too |
| F6 | Claude B5 | E2E "Settings keep the group" replaces the whole shared registry | VALID | `POST /api/registry` → `saveRegistry(cleaned)`; `register()` appends | E2E case posts `registry()` plus two new entries and restores `regFile()` in a `finally` |
| F7 | Codex NB1, Claude NB6/NB7 | The ticket regex reads fragments (`abc#41`) as tickets; `acme-api#41` and URLs undefined; key is case-sensitive | VALID | The regex `(?:\b(…\/…))?#(\d{1,7})\b` matches `#41` inside `abc#41` | Step 1 `parseTickets()` splits the value and matches each part whole; step 2 `ticketKey()` lowercases the repo part of the key; unit cases added; docs step names both forms |
| F8 | Claude NB5 | One plan with `#41` and `owner/repo#41` lands twice in one ticket | VALID | `ticketKey()` gives the same key for both | Step 2 `buildChain()`: at most one row per ticket key; unit case added |
| F9 | Codex NB3, Claude edge case | The 256 KB limit mixes bytes and characters; a cut UTF-8 character | VALID | `readSync` reads bytes; `String.length` counts UTF-16 units | Step 6: read bytes, drop one trailing U+FFFD; E2E case with `é` |
| F10 | Claude edge case | `ledger.md` is a folder or unreadable: 500 | VALID | `writeFileSync(…, { flag: 'wx' })` on a folder throws `EISDIR`; the plan threw "any other error" | Step 6: `exists: false` for a non-file, `error` for an unreadable file, `{ ok: false, output }` for a failed write; Contracts updated; E2E case |
| F11 | Codex edge case | Two first opens at the same time | VALID (test only) | `'wx'` already makes it safe | E2E case with two calls at once |
| F12 | Claude NB1 | "No folder `groups/..`" is a fragile assertion | VALID | `path.join(LEDGER_DIR, '..')` is the dashboard folder | E2E "Bad groups" checks `pipeline-dashboard/ledger.md` and `groups/nobody` |
| F13 | Claude NB2 | The page-function case needs `BT` and `CUR_ISSUES` for `inline()` | VALID | `app.js` `const BT = …` and `let CUR_ISSUES = ''` at the top | Page function case: cut the `BT` line, define `CUR_ISSUES` |
| F14 | Claude NB4 | `md()` links `#41` in the ledger to the open plan's repo | VALID | `inline()` uses `CUR_ISSUES`; `boardCard()` uses the `keep` pattern | Step 11 `checklistHtml()` sets `CUR_ISSUES = ''` around `md()`; page-function case checks it |
| F15 | Claude NB8 | A failed or 400 `/api/ledger` answer is not handled | VALID | `checklistHtml()` would read `d.ledger` of `{ error }` | Step 11: one error line, `_ck = null` |
| F16 | Claude NB9 | No 403 case for `POST /api/ledger/open` | VALID | Only GET had an `Origin` case | E2E "Bad groups": POST with `Origin: https://evil.example` → 403, no file |
| F17 | Claude NB10 | `gitRemote()` should reuse `git(cwd, …)` with `GIT_ENV` | VALID | `watcher.test.mjs` `const git = (cwd, ...a) => …` | Step 8 |
| F18 | Claude NB11 | `state-load.mjs compare` of old vs new build shows a difference | VALID | `state-load.mjs` compares bodies | Contracts → Consumers line |
| F19 | Codex NB2 | The `grep` checks pass when only one file matches | VALID | `grep -n x a b c` exits 0 on one match | How to verify: one `grep` per required place |
| F20 | Claude edge cases | Archived ticket leaves the list; a renamed group keeps its old folder | VALID (docs) | Rules of `buildChain()` and `ledgerFile()` | Step 16 docs text |
| F21 | Claude NB12 (public repo) | `scripts/pipeline-projects.example.json` has `"client": "Galileon"` | NO PLAN CHANGE | An existing line; this plan only adds `group` to the other entry. Whether the name may be in the public repo is the owner's call | Reported to the owner in the final report |

Findings raised by one validator only: Claude F5, F6, F8, F10, F12–F18, F20, F21; Codex F11, F19. Both: F1–F4, F7, F9.

## Validation response

Applied: F1–F20 (all VALID). No plan change: F21 (outside the plan; reported to the owner). Rejected: none. No owner decision was needed: every fix follows an existing pattern or a decision of this session.
