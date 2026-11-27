## Plan validation (codex): 20261127-224222-plan-lanes-waiting-state.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Freshness] Step 4 calculates `stale` but sets `met` solely from `watch.met[slug]`. A stale or invalid timestamp therefore still lets a previously met plan into the batch, contrary to the owner’s decision that an old result counts as not met. The old-result test uses an empty `met` object, so it misses this case. — [.plans/20261127-224222-plan-lanes-waiting-state.md:24](/Users/gorantubic/Workspace/claude-config/.plans/20261127-224222-plan-lanes-waiting-state.md:24), [.plans/20261127-224222-plan-lanes-waiting-state.md:94](/Users/gorantubic/Workspace/claude-config/.plans/20261127-224222-plan-lanes-waiting-state.md:94) — Require a valid, fresh check as well as `met[slug] === true`; test stale, missing, invalid and future timestamps with a stored `true`.
- [State lookup] The template uses the repository directory basename for central state, but the dashboard writes watcher state under the registry project name. Bootstrap registers `project.name`, which need not equal the directory basename. A valid project can therefore remain waiting indefinitely, or read another project’s state. — [apps/dashboard/server.mjs:195](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:195), [skills/bootstrap-project/scripts/register.mjs:54](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/register.mjs:54) — Specify a reliable way to resolve the correct project state without guessing, and test a registry name different from the directory name.
- [Conflict warning] The plan adds the waiting-plan warning to text and JSON, but the dashboard renders batch rows without reading `sharesWithWaiting`. A user launching from the suggested batch can therefore miss the conflict while the watcher starts the waiting plan. — [.plans/20261127-224222-plan-lanes-waiting-state.md:97](/Users/gorantubic/Workspace/claude-config/.plans/20261127-224222-plan-lanes-waiting-state.md:97), [apps/dashboard/page/app.js:3568](/Users/gorantubic/Workspace/claude-config/apps/dashboard/page/app.js:3568) — Include dashboard presentation and verification of the warning, or obtain an owner decision on deferring that protection; account for the dashboard restart rule if its page changes.

### Non-blocking concerns

- [Accuracy] The proposed text says the watcher starts every waiting plan by itself. Auto-launch has guards, including project type, status, existing runs and failed launches. — [.plans/20261127-224222-plan-lanes-waiting-state.md:99](/Users/gorantubic/Workspace/claude-config/.plans/20261127-224222-plan-lanes-waiting-state.md:99), [docs/plans-dashboard.md](/Users/gorantubic/Workspace/claude-config/docs/plans-dashboard.md) — Say the watcher *can* start an eligible plan and direct users to the dashboard for its status.
- [Freshness semantics] `checkedAt` is updated when the PR read succeeds, before the wait conditions are evaluated; `met` is a persistent historical marker. A fresh timestamp does not prove that the current condition was checked successfully. — [apps/dashboard/server.mjs:2059](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:2059), [apps/dashboard/server.mjs:2121](/Users/gorantubic/Workspace/claude-config/apps/dashboard/server.mjs:2121) — Describe this limitation in the contract and user-facing guidance until the watcher stores current per-condition results.

### Edge cases the plan should address

- A stored `met: true` with an old, absent, malformed or future `checkedAt` — it must not bypass the freshness rule.
- A registry name different from the repository basename — state must be read from the correct project.
- An eligible batch plan with a waiting-plan overlap viewed in the dashboard — the warning must be visible at the launch decision.
- A waiting plan that is parked, already launched, or belongs to a generic project — the output must not promise an automatic start.

### Checklist

- [x] All referenced files, functions and types exist, and each call would compile
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
- [ ] Contracts respected
- [x] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261127-224222-plan-lanes-waiting-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make waitStateOf require a valid, fresh timestamp as well as met[slug] === true. Add tests with stored true and stale, missing, invalid and future timestamps. The current calculation does not use stale to determine met. (evidence: .plans/20261127-224222-plan-lanes-waiting-state.md:24 and .plans/20261127-224222-plan-lanes-waiting-state.md:94)
2. Specify a reliable way to locate the correct watcher state when the registry project name differs from the repository directory basename, without guessing, and test that case. The dashboard uses the registry name and bootstrap registers project.name. (evidence: apps/dashboard/server.mjs:195 and skills/bootstrap-project/scripts/register.mjs:54)
3. Make the waiting-plan overlap warning visible when a user chooses a suggested batch in the dashboard, and specify verification and the dashboard restart rule for any page change; alternatively obtain an owner decision on deferring that protection. The current dashboard batch row does not read sharesWithWaiting. (evidence: .plans/20261127-224222-plan-lanes-waiting-state.md:97 and apps/dashboard/page/app.js:3568)

SHOULD FIX:
1. Replace unconditional promises that the watcher starts every waiting plan with accurate wording about eligible plans and dashboard status. (evidence: .plans/20261127-224222-plan-lanes-waiting-state.md:99 and docs/plans-dashboard.md)
2. Explain that checkedAt records a successful PR read before wait evaluation, while met is a historical marker; it does not prove the current condition was checked successfully. (evidence: apps/dashboard/server.mjs:2059 and apps/dashboard/server.mjs:2121)

ADD THESE EDGE CASES:
- A stored met: true with an old, absent, malformed or future checkedAt.
- A registry project name different from the repository directory basename.
- A batch plan overlapping a waiting plan when viewed in the dashboard.
- A waiting plan that is parked, already launched, or belongs to a generic project.

Do not change anything the validation did not flag.
```