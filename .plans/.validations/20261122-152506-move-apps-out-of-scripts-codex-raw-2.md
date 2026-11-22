## Plan validation (codex): 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** APPROVE WITH CHANGES

### Blocking issues

- [Project rule] The post-merge instructions substitute `scripts/setup-macos.sh` for the required `npm run restart`. The setup script can leave the service untouched when its plist already matches — [AGENTS.md:9](/Users/gorantubic/Workspace/claude-config/AGENTS.md:9), [scripts/setup-macos.sh:72](/Users/gorantubic/Workspace/claude-config/scripts/setup-macos.sh:72), [plan:23](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:23) — The plan does not satisfy the stated restart rule in every case. After the relay check, update the installed path with setup, then run `npm run restart`; carry that order into the run report and owner checks.
- [Verification] Both proposed `grep` commands return a nonzero status when they find no matches, which the plan defines as success — [plan:132](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:132) — They cannot serve as passing check commands as written. Define a check that exits successfully only when no unwanted references remain, and distinguish search errors from no matches.

### Non-blocking concerns

- [Tests] The proposed scout test checks only that the template exists; it does not check that `install()` uses that same path — [scripts/scout.mjs:574](/Users/gorantubic/Workspace/claude-config/scripts/scout.mjs:574), [plan:106](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:106). Make the connection explicit in the implementation and test.
- [Verification] Compatibility of the proposed quoted test globs with the documented Node 18 minimum was not verified within this read-only review — [README.md:25](/Users/gorantubic/Workspace/claude-config/README.md:25), [plan:52](/Users/gorantubic/Workspace/claude-config/.plans/20261122-152506-move-apps-out-of-scripts.md:52). Verify `npm test` under Node 18 during implementation and use a compatible invocation if needed.

### Edge cases the plan should address

- The login plist already has the new path while the dashboard still runs old code — setup can skip the restart, so the required restart must still run.
- A reference search encounters an unreadable path — its error must not be treated as a clean search.

### Checklist

- [x] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
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
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. After the relay check, instruct the owner to update the installed server path with scripts/setup-macos.sh and then run npm run restart. Carry this order into the run report and owner checks. Setup can leave an already matching service untouched, and the project rule explicitly requires npm run restart. (evidence: AGENTS.md:9, scripts/setup-macos.sh:72, .plans/20261122-152506-move-apps-out-of-scripts.md:23)
2. Replace or wrap the reference-search verification commands so they exit successfully when no unwanted matches exist, fail when matches exist, and report search errors separately. Plain grep exits nonzero when it finds no matches. (evidence: .plans/20261122-152506-move-apps-out-of-scripts.md:132)

SHOULD FIX:
1. Make the scout template test verify that install() uses the tested template path, not only that the path exists. (evidence: scripts/scout.mjs:574, .plans/20261122-152506-move-apps-out-of-scripts.md:106)
2. Verify npm test with the proposed quoted globs on Node 18 during implementation, and choose a compatible invocation if needed. (evidence: README.md:25, .plans/20261122-152506-move-apps-out-of-scripts.md:52)

ADD THESE EDGE CASES:
- The login plist already points to the new path while the running dashboard still has old code.
- A reference search encounters an unreadable path and must fail rather than report a clean result.

Do not change anything the validation did not flag.
```