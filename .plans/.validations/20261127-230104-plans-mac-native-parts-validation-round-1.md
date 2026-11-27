# Validation round 1 — 20261127-230104-plans-mac-native-parts

- Claude (plan-validator): ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-claude-1.md` (APPROVE WITH CHANGES)
- Codex: ON — `.plans/.validations/20261127-230104-plans-mac-native-parts-validation-codex-1.md` (NEEDS REWORK)
- Regressions from the previous round: none (first round of this run)

## Findings

| ID | Source | Finding | Verdict | Evidence | Action |
| --- | --- | --- | --- | --- | --- |
| F1 | Claude B1 | A replayed ask after a restart never rings: `chatReattach()` runs before the first watcher tick takes the lock; the restart test passes without `rung` | VALID | `server.listen` → `chatReattach(); startWatcher();`; `startWatcher()` → `setTimeout(… watchTick …, 2000)`; `watchTick()` → `takeLock()` | Ask no longer gated by the lock: the owning server rings (`notifySend()` without fence). Restart test now removes `rung` and expects a second ring, so it proves the `rung` check |
| F2 | Codex B1 | A chat on a server without the watcher lock gets no system notification | VALID | same as F1; each chat belongs to one server (`chats` map) | Same fix as F1; new test "a server without the watcher lock rings the asks of its own chat" |
| F3 | Claude B2 | `SERVER_RINGS` drops the only notification of generic-launcher run outcomes | VALID | `watchProject()` → `if (proj.hasPipeline)` before `outcomeEvents`; `genericRunInfo()` gives `failed` / `needs-you` | `serverRings(title, p)`: run titles only when `p.hasPipeline`; tests updated |
| F4 | Codex B2 | Typing sampled 5 s before an independent reload can lose text | VALID | plan steps 19/20 (old) | Reload and relaunch run only inside the callback of one fresh `appStatus()` call with `typing: false`; pending otherwise |
| F5 | Codex B3 | In-memory build guard: a restart allows a second build on the same `.new`/`.old` paths | VALID | `installApp()` in `build.mjs` | Build state on disk (`CENTRAL/app-build.json/.log/.exit`), detached `bash -lc` with EXIT trap as `launchGeneric()`; restart-during-build test |
| F6 | Codex B4 | One terminal-state owner; output complete; timeout must not turn into success | VALID | old step 11 | The exit file owns the end state; the log file is the output; no timeout / no kill; a PID older than 30 min reads as failed (as `BOOTSTRAP_RUN_MAX_MS`); dead-PID test |
| F7 | Codex B5 | Completion handler called before the async answer ends | VALID | `userNotificationCenter(_:didReceive:…)` → `defer { completionHandler() }` | `answerAsk(…, done:)` calls the handler on each path after the answer or fallback; source check |
| F8 | Codex B6 | `grep -c` verify command passes when the forbidden text exists | VALID | old How to verify | Removed; the check is a `build.test.mjs` assertion |
| F9 | Claude NB | Second-server test cannot fail (`envFor` sets `DASH_NO_NOTIFY=1`) | VALID | `envFor()` in watcher.test.mjs | Replaced by the F2 test with `DASH_NO_NOTIFY: ''`, plus the `'1'` case |
| F10 | Claude NB | Ask shares the plan's notification group; a later notification replaces it | VALID | `notifyMac()` → `'-group', 'plans-' + query` | Own group `plans-ask-<id>`; test checks it |
| F11 | Claude NB + Codex SF3 | `done` build with a changed source hash | VALID | `build.mjs` reads sources at compile time | `build.mjs` checks `shellHash` again after codesign and refuses to install; the new app shows the bar again when the source moved on |
| F12 | Claude NB | Double reload after the waiting page loads the new page | VALID | `showWaiting()` timer loads the URL | Page carries its server's boot (`/*@BOOT*/''` fill, as `/*@CHAT_MODES*/[]`); reload only when page boot ≠ server boot |
| F13 | Claude NB | Timer cleanup / single end state | VALID (moot) | — | No timer any more (F6) |
| F14 | Claude NB | `relaunch()` ignores unsent text | VALID | — | Relaunch waits for `typing: false` (F4) |
| F15 | Claude NB | `docs/roadmap.md` 2b line not in the plan | PARTIALLY VALID | `docs/roadmap.md` Shipyard line | The caller updates the roadmap for "planned"; the plan adds a step to mark 2b built in the parent plan and the roadmap |
| F16 | Claude NB | "The 5 notifications" can be 6 after plan 230102 | VALID | Context | Context says "5 today; plan 230102 can add one" |
| F17 | Claude NB | `audience: both` needs `customer.en` | VALID | `changelog.d/AGENTS.md` | Step 27 names `customer.en` |
| F18 | Claude NB | "about a minute" is not measured | VALID | — | Removed |
| F19 | Claude NB | Bash command on the lock screen | PARTIALLY VALID | — | Kept (Allow needs the target), cut to 120 chars, redacted; docs note on "Show previews: When unlocked"; recorded as a decision |
| F20 | Claude NB | Pipeline runs already `caffeinate -i` | VALID | `auto-pipeline.sh`, `launchGeneric()` | Docs step says so |
| F21 | Claude NB | `server.mjs` importing `build.mjs` → restart after a `build.mjs` change | VALID | — | Hard rules line added |
| F22 | Codex SF1 | At-most-once tradeoff not documented | VALID | — | Decision text says the id is saved before the notifier; a lost ring still shows on the page and the badge |
| F23 | Codex SF2 | Manual check lacks cold launch and answer-failure fallback | VALID | — | Manual steps 2 and 3 added; Harness constraints name cold launch |

Found by one validator only: F1, F3, F9–F21 (Claude); F2, F4–F8, F22, F23 (Codex). Both: F11.

## Validation response

```text
Round 1: 23 findings, 21 VALID, 2 PARTIALLY VALID, 0 INVALID. All applied to the plan.
Design changes: the ask rings from the server that owns the chat (no lock gate), with its own group and a rung list in the chat file; the page keeps run-outcome notifications for generic projects; reload and relaunch are decided inside one fresh appStatus() call and compare the page's own boot id; the build runs detached with its state on disk (exit file, log, JSON), no timeout and no kill; build.mjs refuses to install when the source changed during the compile; the notification completion handler waits for the answer.
No owner question raised: each fix follows an owner decision (11A, 12A, "nothing rings twice") or an existing repo pattern (launchGeneric, BOOTSTRAP_RUN_MAX_MS, the PAGE fill chain).
```
