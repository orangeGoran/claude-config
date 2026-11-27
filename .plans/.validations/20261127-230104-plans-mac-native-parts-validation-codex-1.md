## Plan validation (codex): 20261127-230104-plans-mac-native-parts.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Notification delivery] The plan rings an ask only in the server that receives its chat line, then suppresses the browser notification for every ask. A chat attached to a dashboard without the watcher lock therefore produces no system notification, even when the lock-holding dashboard is running — `.plans/20261127-230104-plans-mac-native-parts.md:31`, `.plans/20261127-230104-plans-mac-native-parts.md:142`, `apps/dashboard/server.mjs:2994` — arrange delivery through the lock holder, or retain a browser fallback when the server cannot ring; test a chat on the non-locking server.
- [Data loss] Reload protection uses a typing value sampled every five seconds, while the server poll can reload independently. Text entered after the last status sample can be lost — `.plans/20261127-230104-plans-mac-native-parts.md:150`, `.plans/20261127-230104-plans-mac-native-parts.md:155`, `.plans/20261127-230104-plans-mac-native-parts.md:156` — check `appStatus().typing` immediately before each reload and retain the pending reload until the check succeeds and returns false.
- [Build concurrency] The build lock exists only in server memory. A server restart can leave its spawned build running while the new server starts another; both can manipulate the same `.new` and `.old` installation paths — `.plans/20261127-230104-plans-mac-native-parts.md:45`, `apps/plans-mac/build.mjs:104` — coordinate builds across server restarts and release the guard only when the build and its installation have ended; test a restart during a build.
- [Build completion] The plan sets the result on `exit`, but child output streams can still have unread data then. Its timeout also sets `failed` while a later exit handler can overwrite that result, and `child.kill()` does not ensure that the synchronous compiler child has stopped — `.plans/20261127-230104-plans-mac-native-parts.md:147`, `apps/plans-mac/build.mjs:180` — define one terminal-state owner, collect output through stream close, and ensure timeout cannot leave installation work running or turn into success. Add failure and timeout tests.
- [Notification completion] The existing notification delegate calls its completion handler on return. The proposed asynchronous `URLSession` answer returns before the answer finishes, leaving the process free to be suspended when launched by a notification action — `apps/plans-mac/src/main.swift:531`, `.plans/20261127-230104-plans-mac-native-parts.md:154` — retain and call the completion handler after the answer or fallback finishes, including the cold-launch path.
- [Verification] The final `grep -c` command exits successfully when a forbidden string is present and fails when none is present; the plan explicitly expects that failing exit — `.plans/20261127-230104-plans-mac-native-parts.md:219` — replace it with a check that exits zero only when no forbidden operation exists.

### Non-blocking concerns

- [Notification persistence] Recording an ID before calling the notifier prevents duplicate rings, but a crash, lost lock, disabled notifier, or delivery failure after the save can lose the notification permanently — `.plans/20261127-230104-plans-mac-native-parts.md:142`, `apps/dashboard/server.mjs:1941` — document the at-most-once tradeoff and test the intended failure behavior.
- [Manual verification] Source checks cannot establish that macOS delivers notification actions or that the relaunch works. The plan includes a manual check, but its cold-launch action and failure fallback are absent — `.plans/20261127-230104-plans-mac-native-parts.md:191`, `.plans/20261127-230104-plans-mac-native-parts.md:203` — add those cases to the owner’s manual check.
- [Reference] The claim that a changed source hash identifies the installed build is not verified when source files change during compilation: the hash is taken at build start, while the compiler reads files later — `.plans/20261127-230104-plans-mac-native-parts.md:72`, `apps/plans-mac/build.mjs:171` — verify a stable source snapshot or reject and retry a build whose source changes.

### Edge cases the plan should address

- A notification action arrives before the window exists or while the server is unavailable — the completion and fallback must survive the cold launch.
- A build times out, the server restarts, or source files change during compilation — the installed bundle and reported build state must remain consistent.
- The user begins typing between status polls — a pending reload must not discard the draft.
- A chat belongs to a dashboard that does not hold the watcher lock — the owner still needs a notification.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Ensure an ask from a chat attached to a dashboard without the watcher lock still gets a system notification, either through the lock holder or a browser fallback, and add a test for that case. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:31, .plans/20261127-230104-plans-mac-native-parts.md:142, apps/dashboard/server.mjs:2994)
2. Check appStatus().typing immediately before reloading, and retain the pending reload until the check succeeds and returns false; test text entered between status polls. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:150, .plans/20261127-230104-plans-mac-native-parts.md:155, .plans/20261127-230104-plans-mac-native-parts.md:156)
3. Coordinate builds across server restarts, keeping the guard until the build and installation end; test a restart during a build. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:45, apps/plans-mac/build.mjs:104)
4. Give build completion one terminal-state owner, collect output through stream close, and ensure timeout stops all installation work and cannot later become success; test failure and timeout. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:147, apps/plans-mac/build.mjs:180)
5. Retain the notification response completion handler until the asynchronous answer or fallback finishes, including a cold launch. (evidence: apps/plans-mac/src/main.swift:531, .plans/20261127-230104-plans-mac-native-parts.md:154)
6. Replace the inverted grep verification with a check that exits zero only when no forbidden operation exists. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:219)

SHOULD FIX:
1. Document the at-most-once notification tradeoff and test notifier failure or loss of the watcher lock after the ID is saved. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:142, apps/dashboard/server.mjs:1941)
2. Add cold-launch notification actions and answer-failure fallback to the manual checks. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:191, .plans/20261127-230104-plans-mac-native-parts.md:203)
3. Build from a stable source snapshot or reject and retry when source changes during compilation, so the reported hash identifies the installed build. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:72, apps/plans-mac/build.mjs:171)

ADD THESE EDGE CASES:
- A notification action arrives before the window exists or while the server is unavailable.
- A build times out, the server restarts, or source changes during compilation.
- Text is entered between status polls while a reload is pending.
- A chat belongs to a dashboard that does not hold the watcher lock.

Do not change anything the validation did not flag.
```