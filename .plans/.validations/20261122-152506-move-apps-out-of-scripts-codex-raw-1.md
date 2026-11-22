## Plan validation (codex): 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Restart rule] The post-merge instructions run `scripts/setup-macos.sh` after checking for relays, but do not make the restart conditional on the result or call for `npm run restart`. Setup itself boots out and restarts the service when the plist changes — `AGENTS.md:9`, `scripts/setup-macos.sh:72`, `scripts/setup-macos.sh:79`, `.plans/20261122-152506-move-apps-out-of-scripts.md:22` — this can interrupt live chats that are not under a relay and does not follow the required restart procedure. Specify the conditional sequence, including how the new plist is installed without restarting before the check permits it.
- [Project rules] The plan removes `scripts/test/` and changes script logic, but defers the rule and generated workflow updates until after merge — `AGENTS.md:14`, `.claude/skills/skill-4-verify/SKILL.md:84`, `.plans/20261122-152506-move-apps-out-of-scripts.md:81`, `.plans/20261122-152506-move-apps-out-of-scripts.md:94` — the implementation and its verification run under rules requiring tests in the deleted folder, and the merged branch retains stale rules. Include the authorized rule-source and generated-file updates in the change before verification, including the rule checks and scoped test command.
- [Verification] The proposed `npm test` passes quoted glob patterns to Node, while the project supports Node 18+ — `AGENTS.md:78`, `.plans/20261122-152506-move-apps-out-of-scripts.md:51` — the plan does not establish that Node 18 expands those patterns, so the required test command may fail before running the tests. Use a test invocation compatible with the supported Node versions and verify that it discovers all three files.
- [Verification] The old-path search allows hits only in changelog entries, plans and `AGENTS.md`, but the moved dashboard test retains an old relay path in a comment that the plan does not instruct the implementer to update — `scripts/test/plans-dashboard.test.mjs:210`, `.plans/20261122-152506-move-apps-out-of-scripts.md:87`, `.plans/20261122-152506-move-apps-out-of-scripts.md:132` — the specified acceptance check cannot pass as written. Include this consumer in the edits and make the search fail when an unexpected hit remains.

### Non-blocking concerns

- [Side effects] Importing `scripts/docs-media.mjs` still registers its process exit handler — `scripts/docs-media.mjs:30` — guard that run-only handler as well as the startup checks and final run.
- [Verification] The required `git ls-files` rule-file listing could not complete in this read-only environment because Git attempted to create a system cache file. `rg --files` found root `AGENTS.md` and `changelog.d/AGENTS.md`; a successful `git ls-files --cached --others --exclude-standard AGENTS.md '*/AGENTS.md'` would confirm whether ignored or untracked circumstances hide another applicable rule file.
- [Evidence] The plan’s claim that existing relay processes reconnect across this move was not verified by live testing, which the review skill prohibits. Exercise a live chat through the approved post-merge service transition when the owner performs it.

### Edge cases the plan should address

- A live chat is not running under `chat-relay.mjs` when setup needs to replace the plist — setup must not restart the service until the rule’s condition is met.
- The copied dashboard starts successfully but later needs bootstrap resources — `scripts/plans-dashboard.mjs:872` and `scripts/plans-dashboard.mjs:901` use `skills/bootstrap-project`; decide whether the throwaway copy must support that path and test the intended behavior.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] “How to verify” commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Specify the required conditional post-merge restart sequence, including how the new plist is installed without restarting the service before the relay check permits it, and include npm run restart as required. Setup currently restarts the service when the plist changes. (evidence: AGENTS.md:9; scripts/setup-macos.sh:72; scripts/setup-macos.sh:79; .plans/20261122-152506-move-apps-out-of-scripts.md:22)
2. Include the authorized bootstrap rule-source and generated workflow updates in the change before verification, including the rule checks and scoped test command, so moving tests does not leave the implementation subject to stale paths or merge stale rules. (evidence: AGENTS.md:14; .claude/skills/skill-4-verify/SKILL.md:84; .plans/20261122-152506-move-apps-out-of-scripts.md:81; .plans/20261122-152506-move-apps-out-of-scripts.md:94)
3. Replace the quoted Node test glob invocation with one compatible with the project's supported Node versions, and verify that it discovers all three test files. (evidence: AGENTS.md:78; .plans/20261122-152506-move-apps-out-of-scripts.md:51)
4. Update the old relay path in the moved dashboard test and make the old-path verification fail on unexpected hits. (evidence: scripts/test/plans-dashboard.test.mjs:210; .plans/20261122-152506-move-apps-out-of-scripts.md:87; .plans/20261122-152506-move-apps-out-of-scripts.md:132)

SHOULD FIX:
1. Guard the docs-media process exit handler when the module is imported for testing. (evidence: scripts/docs-media.mjs:30)
2. Confirm the complete applicable rule-file list with git ls-files --cached --others --exclude-standard AGENTS.md '*/AGENTS.md'; the validation environment could not complete that command. (evidence: .codex/skills/validate-plan/SKILL.md:25)
3. Add an owner check of live chat reconnection through the approved post-merge transition. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:22)

ADD THESE EDGE CASES:
- A live chat is not under chat-relay.mjs when the service plist needs replacement.
- The copied dashboard later needs skills/bootstrap-project for bootstrap status; state and test the intended behavior. (evidence: scripts/plans-dashboard.mjs:872; scripts/plans-dashboard.mjs:901)

Do not change anything the validation did not flag.
```