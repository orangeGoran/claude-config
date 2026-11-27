## Plan validation (codex): 20261127-230101-contracts-jump-autopilot.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Signatures] Step 6 reads `.out` from `once(...gitIn(...))` and `.code` from `gitRaw(...)` without awaiting them. Both helpers return asynchronous results, and `once()` caches the returned promise — `apps/dashboard/server.mjs:1677`, `apps/dashboard/server.mjs:1963`, `apps/dashboard/server.mjs:2007`, `apps/dashboard/server.mjs:2232`; `.plans/20261127-230101-contracts-jump-autopilot.md:199` — upstream matching and ancestry checks will use `undefined`. Await each result before inspecting it, and test both ancestry outcomes and remote matching.
- [Integration] The Confirm handler discards the successful response and immediately repaints — `.plans/20261127-230101-contracts-jump-autopilot.md:205`, `.plans/20261127-230101-contracts-jump-autopilot.md:211` — the owner never sees the push commands needed before the plan can run. Display the returned output, including errors, and test that the commands remain accessible after Confirm.
- [Data safety] The recommendation allows a batch whenever there are open PRs, even when the pin is ahead of or diverged from the upstream tip; the generated plan then unconditionally checks out that tip — `.plans/20261127-230101-contracts-jump-autopilot.md:49`, `.plans/20261127-230101-contracts-jump-autopilot.md:190`, `.plans/20261127-230101-contracts-jump-autopilot.md:196` — this can move the submodule backwards or onto another history. Distinguish equal, behind, ahead and diverged states, block unsafe recommendations, and recheck ancestry immediately before checkout.
- [PR completeness] The plan uses `allByBranch` as the complete set of upstream PRs and treats a missing cache as an empty successful list — `.plans/20261127-230101-contracts-jump-autopilot.md:203`; `apps/dashboard/server.mjs:1518`, `apps/dashboard/server.mjs:1533` — the cache covers only the newest 200 PRs and retains one PR per head branch. A recommendation can omit open PRs or offer “jump now” before the list loads. Use a complete open-PR query, distinguish loading and errors from an empty result, and test these cases.
- [Workflow guard] The proposed classifier resolves only the last `git -C` against the last `cd` — `.plans/20261127-230101-contracts-jump-autopilot.md:219`; `skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:52` — Git applies multiple `-C` options in sequence, and successive relative `cd` commands also change the working directory. The guard can inspect the wrong worktree and allow a commit without its checks. Resolve the directory changes in shell order, or conservatively block commands whose target cannot be resolved, with tests for both forms.

### Non-blocking concerns

- [Verification] The owner-copy check uses `diff` while expecting a difference in `BASE_BRANCH` — `.plans/20261127-230101-contracts-jump-autopilot.md:318` — `diff` exits nonzero for the expected result and does not establish that the validation-skill copy matches its rendered template. Provide checks that pass only for the intended differences.
- [Dependency] The groups-and-ledger implementation is on a separate branch and is a prerequisite — `.plans/20261127-230101-contracts-jump-autopilot.md:5` — recheck its final merged signatures before implementation; they are not yet part of the current base.

### Edge cases the plan should address

- A previously open PR is closed without merging: a generated wait remains unmet and needs an owner-visible recovery path.
- The upstream branch advances, is force-pushed, or becomes unavailable between Confirm and execution: revalidate ancestry at run time and stop safely.
- More than 50 recommended PRs, or no selected PRs while a batch is offered: make the selection and launch behavior explicit.
- A submodule or its `.gitmodules` configuration differs between the main checkout and `origin/<base>`: avoid combining metadata from different revisions.

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
- [x] Docs: current state only respected
- [x] Contracts respected
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-230101-contracts-jump-autopilot.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Await the cached gitIn results and gitRaw result before reading .out or .code; add tests for remote matching and both ancestry outcomes. (evidence: apps/dashboard/server.mjs:1677, apps/dashboard/server.mjs:1963, apps/dashboard/server.mjs:2007, apps/dashboard/server.mjs:2232; .plans/20261127-230101-contracts-jump-autopilot.md:199)
2. Show the Confirm response and its push commands to the owner, retain access to them after repaint, and test success and error display. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:205, .plans/20261127-230101-contracts-jump-autopilot.md:211)
3. Distinguish equal, behind, ahead and diverged histories; block unsafe jump recommendations and recheck ancestry immediately before checkout. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:49, .plans/20261127-230101-contracts-jump-autopilot.md:190, .plans/20261127-230101-contracts-jump-autopilot.md:196)
4. Obtain a complete list of open upstream PRs, distinguish loading and errors from an empty result, and test incomplete, unavailable and empty lists. Do not use the branch-deduplicated newest-200 cache as a complete list. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:203; apps/dashboard/server.mjs:1518, apps/dashboard/server.mjs:1533)
5. Resolve successive cd and git -C directory changes in shell order, or conservatively block commands whose target cannot be resolved; add tests for both forms. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:219; skills/bootstrap-project/templates/modules/step-gate/dot-claude/scripts/workflow-guard.sh:52)

SHOULD FIX:
1. Replace the owner-copy diff checks with checks that pass only for the intended rendered differences, including the validation-skill copy. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:318)
2. Recheck the groups-and-ledger signatures against the final merged prerequisite before implementation. (evidence: .plans/20261127-230101-contracts-jump-autopilot.md:5)

ADD THESE EDGE CASES:
- A selected PR closes without merging; provide an owner-visible recovery path.
- The upstream branch advances, is force-pushed, or becomes unavailable between confirmation and execution.
- More than 50 recommended PRs, and an empty selection when a batch is offered.
- The submodule or .gitmodules differs between the main checkout and origin/<base>.

Do not change anything the validation did not flag.
```