## Plan validation (codex): 20261127-230104-plans-mac-native-parts.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Concurrency] The build guard is shared through files but has no atomic acquisition across dashboard servers. Two servers can both see no running build and spawn one before either writes `app-build.json`. The 30-minute rule also permits a second build while the first PID is still alive. Both cases can make builds concurrently replace the same `.new` and `.old` paths — [plan:47](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:47), [plan:144](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:144), [build.mjs:105](/Users/gorantubic/Workspace/claude-config/apps/plans-mac/build.mjs:105) — Specify an atomic, cross-server build lock and recovery that cannot release ownership while the original build may still install. Test simultaneous requests from separate servers and a long-running live build.
- [Recovery] The build starts before its PID is written to disk. A server exit between `spawn()` and the JSON write leaves a live build undiscoverable, so a restarted server can start another against the same install paths — [plan:144](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:144), [build.mjs:107](/Users/gorantubic/Workspace/claude-config/apps/plans-mac/build.mjs:107) — Define durable ownership before the build can reach installation, including spawn and metadata-write failures, and test a restart at that boundary.
- [Secrets] The plan says ask details pass through `redact()`, but the implementation step sends the command or file path without that call. The existing redactor also recognizes only certain secret formats, so an arbitrary command can expose credentials in a system notification — [plan:34](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:34), [plan:139](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:139), [scout.mjs:48](/Users/gorantubic/Workspace/claude-config/apps/scout/scout.mjs:48) — Specify a notification-safe detail policy that does not expose arbitrary command secrets, apply it before every notifier and fallback, and test representative secret-bearing inputs.
- [Data loss] The typing check ignores whitespace-only chat drafts and text in unfocused inputs or textareas. A pending reload or relaunch can therefore discard unsent text, contrary to the stated guarantee — [plan:44](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:44), [plan:147](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:147) — Define and test draft detection for all relevant unsent text, including whitespace and unfocused fields, before allowing either action.

### Non-blocking concerns

- [Verification] The endpoint tests cover success and cross-site refusal but do not specify method/unknown-route handling or failure cases for inaccessible or malformed build-state files — [plan:186](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:186) — Add cases that establish the intended responses and confirm failures cannot start an untracked build.
- [Verification] Native notification delivery, cold-launch actions and the unlock prompt remain unverified by the planned automated tests. The plan correctly assigns them to the owner’s manual check — [plan:201](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230104-plans-mac-native-parts.md:201) — Keep those checks as open items and record their results after merge.

### Edge cases the plan should address

- Two servers start a build at the same time, or the server exits immediately after spawning it — both must preserve one build owner.
- A build remains alive beyond 30 minutes — another build must not enter the install swap concurrently.
- A permission command contains a credential outside the existing redactor’s patterns — notification text must not disclose it.
- An unfocused field or whitespace-only chat draft contains unsent text — automatic reload and relaunch must preserve it.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230104-plans-mac-native-parts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Specify an atomic cross-server build lock and recovery that cannot release ownership while the original build may still install. Test simultaneous starts from separate servers and a live build older than 30 minutes. The current file check and age cutoff can permit concurrent installs. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:47, .plans/20261127-230104-plans-mac-native-parts.md:144, apps/plans-mac/build.mjs:105)
2. Establish durable build ownership before the spawned build can reach installation, including recovery from server exit, spawn failure and metadata-write failure. Test a restart at that boundary. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:144, apps/plans-mac/build.mjs:107)
3. Define and apply a notification-safe detail policy that cannot expose arbitrary command secrets, including for every notifier and fallback. Test representative secret-bearing inputs. The implementation step omits the stated redaction, and the existing redactor covers only certain formats. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:34, .plans/20261127-230104-plans-mac-native-parts.md:139, apps/scout/scout.mjs:48)
4. Preserve all relevant unsent text before automatic reload or relaunch, including whitespace-only chat drafts and drafts in unfocused fields. Add tests for those cases. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:44, .plans/20261127-230104-plans-mac-native-parts.md:147)

SHOULD FIX:
1. Specify endpoint method and unknown-route tests, plus inaccessible or malformed build-state failure tests, including proof that failures cannot start an untracked build. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:186)
2. Keep the native notification, cold-launch and unlock checks as post-merge open items and record their results. (evidence: .plans/20261127-230104-plans-mac-native-parts.md:201)

ADD THESE EDGE CASES:
- Simultaneous build requests from two servers and server exit immediately after spawn.
- A build still alive after 30 minutes.
- A permission command containing a credential outside the existing redactor's patterns.
- Whitespace-only chat text and unsent text in an unfocused field during a pending reload or relaunch.

Do not change anything the validation did not flag.
```