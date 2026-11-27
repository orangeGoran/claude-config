## Plan validation (codex): 20261127-230103-template-updates-collector.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data loss] A wave becomes permanently collected after one PR, including when updates arrive after the collector reads the file or when that PR is closed. The claim that the next wave will rediscover those updates is not guaranteed; the relevant project may have no later upgrade run. — `.plans/20261127-230103-template-updates-collector.md:26`, `.plans/20261127-230103-template-updates-collector.md:130` — Track the IDs actually collected and retain later or uncollected updates as pending; define recovery for a closed PR.
- [Data loss] An append failure after the upgrade commit only logs an error, and a retry that resumes publication has no decisions in memory. Updates can therefore disappear permanently, including after a partial append. — `.plans/20261127-230103-template-updates-collector.md:22`, `.plans/20261127-230103-template-updates-collector.md:132` — Persist the update payload before committing and make publication to the wave file idempotent and retryable.
- [Security] The generic-content check covers `out/` files, but Claude-written feature titles, reasons, skipped reasons and questions also reach the public PR body and changelog. These fields can contain project names, private paths or secrets. — `.plans/20261127-230103-template-updates-collector.md:140`, `.plans/20261127-230103-template-updates-collector.md:141` — Validate and redact every public-bound field, including PR and changelog text, before writing or publishing it; test private data in each output channel.
- [Integration] Update IDs use only `<startedAt>#<i>`, although separate repositories can start in the same millisecond. The collector requires every ID to occur exactly once, so concurrent runs can collide and make valid updates impossible to collect. — `.plans/20261127-230103-template-updates-collector.md:59`, `.plans/20261127-230103-template-updates-collector.md:140` — Use a collision-resistant run identifier that is unique across repositories and test simultaneous runs.
- [Wiring] The collector report calls `resumeCommand()` from the upgrade runner, but the plan exports only `branchPrs()` and the new `claudeSession()`. — `.plans/20261127-230103-template-updates-collector.md:114`, `.plans/20261127-230103-template-updates-collector.md:142` — Export and import the helper, or specify an equivalent implementation and its wiring.
- [Project rule] The generated collector PR entry is written by the script, while the applicable changelog rules require `/changelog-entry` to write entries. — `.plans/20261127-230103-template-updates-collector.md:141`, `changelog.d/AGENTS.md:9` — Resolve this rule conflict in the plan before implementing the automatic PR flow.

### Non-blocking concerns

- [Verification] The restart instruction omits the condition that live chats must be running under the relay before restarting. — `.plans/20261127-230103-template-updates-collector.md:38`, `AGENTS.md:9` — Include the condition in the planned Open item.
- [Reference] The plan depends on two preceding plans being merged, so the final integration against their code cannot yet be verified from this checkout. — `.plans/20261127-230103-template-updates-collector.md:16` — Recheck the shared dashboard changes against their merged implementations before execution.
- [Endpoint tests] The endpoint tests cover cross-site refusal and validation, but do not explicitly cover a missing route or a forbidden host/socket request. — `.plans/20261127-230103-template-updates-collector.md:171` — Add the applicable 403 and 404 cases.

### Edge cases the plan should address

- A collector session skips every update or produces no changed template files — define how the run reports the result without creating an empty commit or losing pending updates.
- A project has no `repoPath` or excerpt — define how the collector avoids inventing the missing feature details.
- A wave file contains a valid JSON object with missing or incorrectly typed fields — validate records before counting, joining or collecting them.
- A collector PR is created but the process stops before the collected marker is written — ensure retry reconciles the PR and precisely the IDs it contains.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [ ] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Track the IDs actually collected, retain later or uncollected updates as pending, and define recovery when a collector PR is closed; do not assume a later wave will rediscover them. (evidence: .plans/20261127-230103-template-updates-collector.md:26 and .plans/20261127-230103-template-updates-collector.md:130)
2. Persist the update payload before the upgrade commit and make wave publication idempotent and retryable after an append failure or partial append. (evidence: .plans/20261127-230103-template-updates-collector.md:22 and .plans/20261127-230103-template-updates-collector.md:132)
3. Validate and redact every public-bound field, including feature titles, reasons, skipped reasons and questions in the PR body and changelog; test private data in each output channel. (evidence: .plans/20261127-230103-template-updates-collector.md:140 and .plans/20261127-230103-template-updates-collector.md:141)
4. Give each run a collision-resistant identifier unique across repositories and test simultaneous runs. (evidence: .plans/20261127-230103-template-updates-collector.md:59 and .plans/20261127-230103-template-updates-collector.md:140)
5. Export and import resumeCommand(), or specify an equivalent implementation and its wiring. (evidence: .plans/20261127-230103-template-updates-collector.md:114 and .plans/20261127-230103-template-updates-collector.md:142)
6. Resolve the conflict between script-generated collector changelog entries and the rule requiring /changelog-entry to write entries. (evidence: .plans/20261127-230103-template-updates-collector.md:141 and changelog.d/AGENTS.md:9)

SHOULD FIX:
1. State that the dashboard restarts only when the relay check shows live chats run under it. (evidence: .plans/20261127-230103-template-updates-collector.md:38 and AGENTS.md:9)
2. Recheck the shared dashboard changes against the merged preceding plans before execution. (evidence: .plans/20261127-230103-template-updates-collector.md:16)
3. Add applicable forbidden host/socket and missing-route endpoint tests. (evidence: .plans/20261127-230103-template-updates-collector.md:171)

ADD THESE EDGE CASES:
- Every update is skipped or no template file changes.
- An update has no repoPath or excerpt.
- A wave line is valid JSON but has missing or incorrectly typed fields.
- A PR is created but the process stops before its collected marker is written.

Do not change anything the validation did not flag.
```