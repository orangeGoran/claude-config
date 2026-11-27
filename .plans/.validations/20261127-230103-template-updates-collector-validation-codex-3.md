## Plan validation (codex): 20261127-230103-template-updates-collector.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Data safety] A crash after the saved lines are written but before the commit leaves the saved file behind. The next run calls `flushWave()` before checking whether that branch has a commit, so it can publish updates from discarded work — [.plans/20261127-230103-template-updates-collector.md:141](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:141), [upgrade-run.mjs:429](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/upgrade-run.mjs:429) — Gate flushing on durable proof that the corresponding commit succeeded, and test a crash before the commit as well as after it.

- [Data integrity] A later complete upgrade run with zero template updates writes no wave lines, so `readWave()` continues to select an older run’s updates as the newest complete run — [.plans/20261127-230103-template-updates-collector.md:139](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:139), [.plans/20261127-230103-template-updates-collector.md:141](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:141) — Record successful empty runs and make them supersede earlier runs for that repo.

- [Recovery] The dashboard refuses to start a collector when there is no pending wave, but a crash after PR creation can leave a saved status that needs `appendCollected()` even when no pending wave is visible. A `same` run also has no specified recovery if it crashes before its collected line is appended — [.plans/20261127-230103-template-updates-collector.md:29](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:29), [.plans/20261127-230103-template-updates-collector.md:148](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:148), [.plans/20261127-230103-template-updates-collector.md:153](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:153) — Define and test recovery for both outcomes, including when the dashboard has no pending wave to offer.

- [Verification] The plan orders the base-relative changelog validation after the commit but does not require it on the committed-branch resume path. A failed validation can therefore be bypassed by retrying and publishing the retained commit — [.plans/20261127-230103-template-updates-collector.md:147](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:147), [.plans/20261127-230103-template-updates-collector.md:150](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:150) — Require the check to pass on every publish path, including retries, and test a failed check followed by a retry.

- [Project rule] The collector script writes a changelog entry itself even though the applicable folder rule requires `/changelog-entry`; the plan gives an explanation but no authorized exception — [changelog.d/AGENTS.md:10](/Users/gorantubic/Workspace/claude-config/changelog.d/AGENTS.md:10), [.plans/20261127-230103-template-updates-collector.md:35](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:35) — Resolve the conflict with the rule before specifying script-written entries.

### Non-blocking concerns

- [Discrepancy] The plan says every wave text field goes through `redactText()`, but its implementation step lists only `feature`, `why` and `excerpt`. Applying it blindly to every field would also replace UUIDs, including run identifiers — [.plans/20261127-230103-template-updates-collector.md:26](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:26), [upgrade-run.mjs:68](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/upgrade-run.mjs:68) — Specify which structured fields must remain intact and how sensitive free text is cleaned.

- [Scope] The plan describes one collector PR at a time, but the proposed open-PR check examines only the selected wave’s collected lines — [.plans/20261127-230103-template-updates-collector.md:39](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:39), [.plans/20261127-230103-template-updates-collector.md:147](/Users/gorantubic/Workspace/claude-config/.plans/20261127-230103-template-updates-collector.md:147) — Clarify whether that limit is global or per wave and implement the intended check.

### Edge cases the plan should address

- A process terminates between saving wave lines and completing its commit — retry must not collect uncommitted work.
- A newer successful upgrade finds no updates — older updates must not remain pending.
- A collector crashes before recording a `same` outcome, or must recover when the dashboard sees no pending wave.
- A committed collector branch fails its changelog check and is retried — it must not reach a PR until the check passes.
- Two different waves have pending updates while a collector PR is open — enforce the intended PR limit.

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
- [ ] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230103-template-updates-collector.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Gate wave flushing on durable proof that the corresponding upgrade commit succeeded, and test crashes before and after the commit. The current retry flushes saved lines before checking the branch (evidence: .plans/20261127-230103-template-updates-collector.md:141; skills/bootstrap-project/scripts/upgrade-run.mjs:429).
2. Record a successful upgrade run with zero template updates so it supersedes older runs for the same repo, and test that case (evidence: .plans/20261127-230103-template-updates-collector.md:139 and :141).
3. Define and test recovery of a collector’s saved PR or same outcome when its collected line is missing, including when the dashboard sees no pending wave and currently refuses to start (evidence: .plans/20261127-230103-template-updates-collector.md:29, :148 and :153).
4. Require the base-relative changelog validation to pass on every publish path, including a committed-branch retry, and test a failed check followed by retry (evidence: .plans/20261127-230103-template-updates-collector.md:147 and :150).
5. Resolve the script-written collector changelog entry with the applicable requirement to use /changelog-entry before prescribing that implementation (evidence: changelog.d/AGENTS.md:10; .plans/20261127-230103-template-updates-collector.md:35).

SHOULD FIX:
1. Specify which structured wave fields stay intact and how sensitive free text is cleaned; redactText also replaces UUIDs (evidence: .plans/20261127-230103-template-updates-collector.md:26; skills/bootstrap-project/scripts/upgrade-run.mjs:68).
2. Clarify whether the one-open-collector-PR limit applies globally or per wave, and specify the matching check (evidence: .plans/20261127-230103-template-updates-collector.md:39 and :147).

ADD THESE EDGE CASES:
- Process termination after saving update lines but before the upgrade commit.
- A newer successful upgrade with zero template updates.
- Recovery of a same outcome or PR when no pending wave is visible.
- Retry after a committed collector branch fails changelog validation.
- Pending updates in two waves while a collector PR is open.

Do not change anything the validation did not flag.
```