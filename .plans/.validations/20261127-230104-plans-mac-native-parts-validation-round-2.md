# Validation round 2 — 20261127-230104-plans-mac-native-parts

- Claude (plan-validator): ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-claude-2.md` (APPROVE WITH CHANGES)
- Codex: ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-codex-2.md` (NEEDS REWORK)
- Regressions from round 1 edits (diff pre-round-1 → pre-round-2): 0. Citations re-opened (`server.listen` → `chatReattach()`, `startWatcher()`, `launchGeneric()`, `readExit()`, `pidAlive()`, the `PAGE` fill chain); step numbers 1–27 checked; stale names (`SERVER_RINGS` as a Set, `holdsLock`, `10-minute`, `child.kill`) swept. Claude confirms the round 1 fixes against the code.

## Findings

| ID | Source | Finding | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| F1 | Claude B | Allow can run a command the notification does not show in full (URLs removed by `notifyParts()`, cut at 120) | VALID | `notifyParts()` → `.replace(/\s*[—–-]?\s*https?:\/\/\S+/g, '')` | Buttons only when the target is ≤120 chars, has no URL and `redact(target) === target`; else tool name only, no buttons; watcher test with a URL, a 130-char and a key command |
| F2 | Codex B3 | Ask text can expose secrets; plan step did not name `redact()` | PARTIALLY VALID | `notifyMac()` already redacts `message`; `redact()` in `watch.mjs` knows only some patterns | Same rule as F1: a target that `redact()` changes is never shown; residual risk (unknown secret formats) written in Decisions and docs (lock-screen previews) |
| F3 | Codex B1 | No atomic build guard across servers; 30-min rule allows a second live build | VALID | old Decisions / step 11; `installApp()` `.new`/`.old` | Atomic `openSync(lock, 'wx')`; the build shell writes its PID into the lock and its EXIT trap removes it; stale only for a dead or non-build PID (`psCommand`) or an empty lock older than 60 s (as `bootstrapUpgrade()`); 30-min rule removed; two-server test |
| F4 | Codex B2 | Build starts before its PID is on disk | VALID | old step 11 | Lock taken and JSON written before the spawn; the build writes its own PID first; an empty lock stays live for 60 s; a throw or spawn error removes the lock |
| F5 | Codex B4 | Typing misses whitespace drafts and unfocused fields | VALID | old step 14 | `typing` = any textarea/text input except `#q` with a non-empty value, or dirty open Settings (`settingsDirty()`); tests |
| F6 | Claude SF1 | Page drops its notification when the server cannot ring (`DASH_NO_NOTIFY`, no macOS, watcher off) | VALID | `notifyMac()` returns on `DASH_NO_NOTIFY` / platform; `WATCH_MS` 0 | Server fills `/*@RINGS*/{}` = `{ asks, runs }`; `serverRings()` uses it; test of the served value |
| F7 | Claude SF2 | Second reload still possible with a stale `serverBoot` | VALID | old steps 19/20 | Fresh `GET /api/app` before each reload; a failed GET clears `serverBoot` |
| F8 | Claude SF3 | Docs sentence "two notifications" and `DASH_NO_NOTIFY` row/usage become false | VALID | `docs/plans-dashboard.md` server notification paragraph and env table; `server.mjs` usage | Step 25 and Affected files name them |
| F9 | Claude SF4 | Spawn error with no listener can stop the server | VALID | `bootstrapUpgrade()` → `child.on('error')`, `!child.pid` | Step 11 adds both and removes the lock |
| F10 | Claude SF5 | Fake claude ids collide across plans; second server lacks `NOTIFY_LOG`; hash test names the temp repo; race with the 0.5 s build | VALID | `FAKE_CLAUDE`, `mainEnv()`, `repo` in dashboard.test.mjs | Ids `req-<tool>-<n>`; `NOTIFY_LOG` passed; hash from `path.dirname(SCRIPT)`; `slow` mode for the at-once POST |
| F11 | Claude edge | An ask in a running or failed plan does not count on the badge | VALID | `boardCol()` order | `needs` also counts `p.chatWaits > 0`; test |
| F12 | Claude edge | Unsaved Settings lost on reload | VALID | `settingsDirty` in app.js | Part of `typing` (F5) |
| F13 | Claude edge | Ask from a dashboard on another port: the answer fails | VALID | `answerAsk` uses `appURL` | Recorded as a decision: safe fallback opens the plan |
| F14 | Claude edge | Only the run and ask calls need the plan argument | VALID | `checkAlerts()` | Step 15 says so |
| F15 | Codex NB1 | No tests for malformed state files or a wrong method | VALID | — | Tests: invalid JSON, empty old lock, non-build PID lock, `GET /api/app/build` → 404 |
| F16 | Codex NB2 | Native delivery stays manual | VALID (no change) | plan Browser test | Already in the manual check and Open items |

Found by one validator only: F1, F6–F14 (Claude); F3–F5, F15, F16 (Codex). Both (different angle): F1/F2.

## Validation response

```text
Round 2: 16 findings, 15 VALID (one with no change needed), 1 PARTIALLY VALID, 0 INVALID. All applied.
Main changes: Allow / Deny only when the notification shows the full, unredacted target; an atomic lock file that the build process itself holds and releases; typing covers every text field and dirty Settings; the server tells the page which events it rings (/*@RINGS*/); a fresh boot check before each reload; spawn error checks; test fixes (ids, NOTIFY_LOG, checkout path, slow mode) and new state-file and two-server tests.
No owner question raised.
```
