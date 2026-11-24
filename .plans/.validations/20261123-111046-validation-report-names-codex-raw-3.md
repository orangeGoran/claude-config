## Plan validation (codex): 20261123-111046-validation-report-names.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Counting] The `/plans-parallel` status takes the larger per-validator count, which can be less than the number of distinct rounds — [.plans/20261123-111046-validation-report-names.md:48](.plans/20261123-111046-validation-report-names.md) and [.plans/20261123-111046-validation-report-names.md:96](.plans/20261123-111046-validation-report-names.md) — Claude-only round 1 and Codex-only round 2 produce counts of 1 and 1 but represent two rounds. Expose the union count in the digest and use it for the status cell; test partially overlapping validator rounds.
- [Integration] The two readers assign ambiguous filenames differently — [.plans/20261123-111046-validation-report-names.md:97](.plans/20261123-111046-validation-report-names.md) and [.plans/20261123-111046-validation-report-names.md:98](.plans/20261123-111046-validation-report-names.md) — `ana-plan-validation-codex-3.md` belongs to the longer slug `ana-plan-validation` under step 7, but step 8 also counts it for `ana-plan` as a `validation-codex` report. Apply the same known-slug ownership rule in both readers and test both plans in the dashboard.
- [Project rules] The proposed test uses `git add -A` — [.plans/20261123-111046-validation-report-names.md:101](.plans/20261123-111046-validation-report-names.md) and [AGENTS.md:73](AGENTS.md) — the repository rule says never to use that command. Stage the specific fixture paths in the temporary repository instead.

### Non-blocking concerns

- [Dependency] The move plan has not landed in this checkout: the proposed `apps/dashboard/` paths and archived move plan are absent, and [package.json:7](package.json) still runs `scripts/test/*.test.mjs`. Step 0 correctly stops the run, but post-move signatures, tests, and verification commands remain unverified. Revalidate against the merged move before implementation.
- [Documentation] The plan knowingly leaves screenshots showing the old count — [.plans/20261123-111046-validation-report-names.md:104](.plans/20261123-111046-validation-report-names.md) — update the screenshots with the change, or resolve how the current-state documentation rule applies.

### Edge cases the plan should address

- Validator reports with disjoint or partially overlapping round numbers — per-validator totals cannot determine the union.
- Two plan slugs for which one report name matches both — both readers must attribute the file to the same plan.
- A missing `.validations` directory and a missing `done` directory — the readers should still return zero or count available reports.

### Checklist

- [ ] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [ ] Breaking changes for changed symbols listed (consumer search done)
- [ ] Wiring & registration matches the code
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [ ] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261123-111046-validation-report-names.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Expose the distinct union of Claude and Codex round numbers in the plan-lanes digest and use that count for the /plans-parallel status. Add a test with disjoint or partially overlapping validator rounds; the larger per-validator count can undercount the union. (evidence: .plans/20261123-111046-validation-report-names.md:48, .plans/20261123-111046-validation-report-names.md:96)
2. Make dashboard validation counting use the same known-slug ownership rule as plan-lanes, and test both plans when an ambiguous report name matches a shorter and a longer slug. (evidence: .plans/20261123-111046-validation-report-names.md:97, .plans/20261123-111046-validation-report-names.md:98)
3. Replace git add -A in the temporary-repository test with staging of specific fixture paths. (evidence: .plans/20261123-111046-validation-report-names.md:101, AGENTS.md:73)

SHOULD FIX:
1. Revalidate the post-move paths, signatures, test harnesses and verification commands after the move plan merges; they are not present in the current checkout. (evidence: .plans/20261123-111046-validation-report-names.md:25, package.json:7)
2. Update the screenshots with the new count, or resolve how leaving the old count meets the current-state documentation rule. (evidence: .plans/20261123-111046-validation-report-names.md:104, AGENTS.md:20)

ADD THESE EDGE CASES:
- Claude and Codex reports have disjoint or partially overlapping round numbers.
- One report filename matches two known plan slugs.
- The validations or done directory is missing.

Do not change anything the validation did not flag.
```