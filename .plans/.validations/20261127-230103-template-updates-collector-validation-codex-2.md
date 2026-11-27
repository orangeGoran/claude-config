## Plan validation (codex): 20261127-230103-template-updates-collector.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Retry and data loss] The upgrade retry creates a new `runId` and `templatesHash` before recovering the saved wave lines. The existing runner replaces the status at startup, and some resume paths return without calling `publish()` — [upgrade-run.mjs:456](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/upgrade-run.mjs:456), [upgrade-run.mjs:521](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/upgrade-run.mjs:521), [plan:141](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:141) — a retry can lose `waveWritten`, append saved lines under the wrong wave, or never flush them. Persist and recover the original run identity and wave hash, and flush on every applicable resume path, including an already-open PR and `--no-push`.
- [Concurrency and data loss] The reader treats the run of a repo’s last appended line as its newest run — [plan:139](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:139) — a delayed retry or interleaved append from an older run can replace a newer run and discard its pending updates. Define a stable run ordering and a completion protocol that cannot expose partial runs; test interleaved writers and delayed retries.
- [Privacy] The collector sends `path`, `repoPath`, `feature`, `why` and `excerpt` to Claude, but only `feature`, `why` and `excerpt` are redacted, and the redactor does not remove project names or home paths — [plan:141](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:141), [plan:148](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:148), [upgrade-run.mjs:67](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/upgrade-run.mjs:67) — private names and paths can reach the session despite the plan’s stated boundary. Specify and test sanitization of every session-bound field before writing `task.json`, including names, paths and secrets.
- [Privacy] The output check exempts a private name if it appears *anywhere* in the original templates, and checks added lines only — [plan:149](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:149), [AGENTS.md:11](/Users/gorantubic/Workspace/claude-config/AGENTS.md:11) — a client name that happens to occur in a template can be added to public output unchecked. Replace the blanket exemption with a check that prevents new disclosure, including existing-line moves and output paths; test a private name that also occurs in the original tree.
- [Retry and duplicate side effects] Collector recovery derives the next branch from the count of `collected` lines, but appending a `collected` line is not idempotent. A crash after the append but before a retry can add it again, advance the round and create an extra branch or PR; the single status file also needs to retain the correct IDs for the recovered branch — [plan:29](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:29), [plan:147](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:147) — define a durable collector-run identity and idempotent recovery for each branch, including crashes before and after the append.
- [Release note] The collector writes a date-and-hash filename and runs the changelog validator without `--base` — [plan:150](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:150), [changelog-validate.mjs:160](/Users/gorantubic/Workspace/claude-config/.claude/scripts/changelog-validate.mjs:160) — a later round on the same day can overwrite an existing entry, and the validation does not enforce a new entry relative to the base. Use a unique filename per collector PR, never overwrite an existing entry, and run the required base-aware check.
- [Test harness] The collector test fixture copies only the bootstrap skill and one test file — [plan:152](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:152), [bootstrap-project.test.mjs:409](/Users/gorantubic/Workspace/claude-config/test/bootstrap-project.test.mjs:409) — the copied test also exercises generated scripts and other repository-dependent behavior, so the proposed fixture does not establish that the real verification command can pass. Supply the complete required fixture or use a faithful disposable repository, and exercise the changelog validator in it.

### Non-blocking concerns

- [References] The documented template mapping omits special mappings such as `gitignore.fragment`, `editorconfig` and the parent plan — [plan:145](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:145), [render.mjs:786](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/render.mjs:786) — document how the collector handles these paths.
- [Verification] The dashboard end-to-end cases cover 403 and validation errors but do not specify a 404 case for the new endpoint — [plan:181](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:181) — add the applicable missing-resource or unknown-route case, or explain why it is not applicable.
- [Documentation] The plan’s `DASH_COLLECT_REPO` override is added to help text but not explicitly to the dashboard environment table — [plan:153](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:153) — add it to the current-state documentation.

### Edge cases the plan should address

- A partial append followed by another run and a retry — updates must remain associated with the correct completed run.
- Templates change between an upgrade commit and its publish retry — saved updates must retain their original wave hash.
- A collector crashes immediately before or after recording its collected IDs — retry must neither lose IDs nor create a duplicate collection.
- A generated template path or feature text contains a private name already present elsewhere in the template tree — it must not reach a public PR.
- A second collector round occurs on the same day for the same wave — its changelog entry must not replace the earlier entry.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [ ] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [ ] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail
- [ ] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Persist and recover the original upgrade run ID, templates hash and wave-written state, and flush saved lines on every applicable resume path, including an already-open PR and --no-push. Add retry tests. (evidence: skills/bootstrap-project/scripts/upgrade-run.mjs:456, skills/bootstrap-project/scripts/upgrade-run.mjs:521, .plans/20261127-230103-template-updates-collector.md:141)
2. Replace last-appended-line run selection with stable run ordering and a completion protocol that handles partial and interleaved writes without losing newer updates. Add concurrent and delayed-retry tests. (evidence: .plans/20261127-230103-template-updates-collector.md:139)
3. Sanitize every session-bound field, including paths and excerpts, for private project names, home paths and secrets before writing task.json. Add tests for each field. (evidence: .plans/20261127-230103-template-updates-collector.md:141, .plans/20261127-230103-template-updates-collector.md:148, skills/bootstrap-project/scripts/upgrade-run.mjs:67)
4. Replace the blanket exemption for names already present in templates with a check that prevents new disclosure in file contents and paths, including moved lines. Test a private name that also exists in the original tree. (evidence: .plans/20261127-230103-template-updates-collector.md:149, AGENTS.md:11)
5. Define a durable collector-run identity and idempotent collected-line and branch recovery, retaining the IDs for the correct branch across crashes before and after the append. Add crash-retry tests. (evidence: .plans/20261127-230103-template-updates-collector.md:29, .plans/20261127-230103-template-updates-collector.md:147)
6. Give every collector PR a unique changelog filename, refuse to overwrite an existing entry, and run the validator with the fetched base reference so it checks for a new entry. (evidence: .plans/20261127-230103-template-updates-collector.md:150, .claude/scripts/changelog-validate.mjs:160, changelog.d/AGENTS.md:6)
7. Make the collector test fixture include all files needed by the real bootstrap test and changelog validator, or use a faithful disposable repository. Prove the verification commands pass in the fixture. (evidence: .plans/20261127-230103-template-updates-collector.md:152, test/bootstrap-project.test.mjs:409)

SHOULD FIX:
1. Describe how the collector maps special rendered paths, including gitignore.fragment, editorconfig and the parent plan. (evidence: skills/bootstrap-project/scripts/render.mjs:786)
2. Add an applicable 404 end-to-end case for the new endpoint, or explain why it is not applicable. (evidence: .plans/20261127-230103-template-updates-collector.md:181)
3. Add DASH_COLLECT_REPO to the dashboard environment documentation. (evidence: .plans/20261127-230103-template-updates-collector.md:153)

ADD THESE EDGE CASES:
- A partial append, a newer run, then a retry of the older run.
- Templates change between an upgrade commit and its publish retry.
- A collector crashes immediately before or after recording collected IDs.
- A private name already present elsewhere in the templates appears in generated content or a path.
- A second collector round for the same wave occurs on the same day.

Do not change anything the validation did not flag.
```