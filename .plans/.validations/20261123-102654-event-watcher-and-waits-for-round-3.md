# Round 3 — decision log

- Plan: `.plans/20261123-102654-event-watcher-and-waits-for.md`
- Claude (plan-validator): ON — `-validation-3.md`, APPROVE WITH CHANGES (1 blocking, 9 should-fix)
- Codex: ON — `-codex-raw-3.md`, NEEDS REWORK (6 blocking)
- Regressions of round 2's edits: 2 — the own-repo check compared plain paths (Claude), and the new `sort=updated` list made an old PR with a new comment look like a new merge (Claude + Codex). Both fixed below.

| # | Finding | Raised by | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Own-repo check `proj.root === DASH_REPO` fails on a trailing slash or symlink | Claude | VALID (REGRESSION) | `resolveProject` keeps the typed root; `DASH_REPO` from `import.meta.url` | `realpathSync` on both; a failed `realpathSync` counts as own repo (never pull when unsure) |
| 2 | Lock: an empty new file looks stale; two removers race | both | VALID | `openSync('wx')` then write | Temp file + `linkSync` (never empty); stale lock moved with `renameSync` (one winner); unreadable lock < 10 s counts as held; e2e cases |
| 3 | Manual launch or chat during the `await pipelineLive` | Codex | VALID | `/api/launch` calls `launchPipeline` directly | `pipelineLive` first, then one synchronous block (launches, chat busy/questions, file exists, save, launch) — Node runs no handler inside it |
| 4 | More than 100 updates between ticks | Codex | VALID | one page only | Pages until `updatedAt < checkedAt − 2 min`, max 10; gh/JSON error keeps `checkedAt`; e2e 150-row case; 10-page limit documented |
| 5 | Old merged PR (comment, or past the 2000 cap) → repeated `pr-merged` | both | VALID (REGRESSION) | `sort=updated` brings old PRs back | `prEvents(…, since)`: new numbers make events only when `mergedAt`/`createdAt > since`; unit case with two calls |
| 6 | `plan … merged` slug with `..` | Codex | VALID | slug regex allowed `..` | First char not `.`, `..` → `bad`; unit cases |
| 7 | Redaction of command text | Codex | VALID | `ghProblem()` returns the first error line | `redact()` (query strings, bearer, `*token*=`, GitHub/`sk-` tokens) before events and notifications; unit + e2e cases |
| 8 | Parse `gh().out`, malformed JSON | Codex | VALID | `gh()` returns `{ ok, out }` | `JSON.parse` in `try`; bad JSON = skip PR part, keep `checkedAt` |
| 9 | Document event loss after a crash | Codex | VALID | — | Contracts "Delivery: at-most-once" + docs step |
| 10 | Waits chip on plans that already started | Claude | VALID | started plans are not checked | Page shows the chip only with no run, not live, no launch; browser test after restart |
| 11 | Own-repo e2e needs own HOME and no notifications | Claude | VALID | shared lock and notifier | Own HOME, `DASH_NO_NOTIFY=1` |
| 12 | Notification noise on network drops | Claude | VALID | errors cleared and re-reported | `fix` flag; only `fix: true` errors notify; e2e case |
| 13 | First-tick default object | Claude | VALID | `loadJson(…, null)` | Default object in step 4 |
| 14 | `planBase()` accepts a leading `-` | Claude | VALID | regex `[\w./-]+` | First char `[\w./]` |
| 15 | `/api/events` `limit` 0, NaN, 5000 | Claude | VALID | — | Rule in step 9; e2e cases |
| 16 | Affected files miss `takeLock()`, `holdsLock()` | Claude | VALID | — | Added, with `WATCH_PR_JQ`, `redact()` |
| 17 | A parked plan with a `Waits for:` line | Claude (edge case) | VALID | page statuses `parked`, `proposed` | `canAutoLaunch` refuses them; unit + e2e cases; documented |
| 18 | Re-validate after the move merges | Codex | VALID (note) | — | Unchanged: Context note and step 0 |

Findings only one validator raised: Claude 1, 10–17; Codex 3, 4, 6–9.
