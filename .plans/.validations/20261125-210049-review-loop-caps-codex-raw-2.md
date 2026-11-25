## Plan validation (codex): 20261125-210049-review-loop-caps.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Control flow] The proposed stop rules can issue conflicting instructions after a round accepts a blocking finding: step d says to run the next round when `n < 4`, but the status rules then fall through to `READY` when there is no open regression or deferred decision. The plan does not say that the status rules apply only after the loop has decided to stop. — [.plans/20261125-210049-review-loop-caps.md:97](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:97) — An implementation could stop before validating the blocking fix. Make continuation and terminal status mutually exclusive, and specify their order.

- [Review coverage] The final edits check runs only the three checks for citations, cross-references and propagation. Those checks do not require the reviewer to determine whether a fix implements its finding correctly or introduces a functional error, although the existing previous-round check explicitly requires both. — [.plans/20261125-210049-review-loop-caps.md:100](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:100), [skill-auto-validate-plan/SKILL.md:68](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:68) — The loop can report `READY` after an incorrect last-round fix that no validator reviewed. Add the existing per-hunk correctness and regression check to the final edits check.

### Non-blocking concerns

- [Verification] The claim that no other registered project sets `codexInVerify` relies on a workspace search outside the repository. It was not verified within this review’s limits. The breaking-change description already covers projects with the field unset; verify the inventory separately if it is needed for rollout. — [.plans/20261125-210049-review-loop-caps.md:34](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:34)
- [Description] The proposed short descriptions say the loop stops after a round with no accepted blocking finding, while the detailed rules also require no open regression. Include that condition in the descriptions to avoid promising an earlier stop. — [.plans/20261125-210049-review-loop-caps.md:91](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:91)

### Edge cases the plan should address

- A round accepts a blocking finding, has no open regression and has another round available — it must continue rather than report `READY`.
- A final-round fix has correct citations and propagation but changes the intended behavior — the final check must detect and record the problem.
- A deferred owner decision is raised again unchanged — it must remain an open item even when the repeated finding is marked `RAISED BEFORE`.

### Checklist

- [x] All referenced files, functions and types exist, and each call would compile
- [ ] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code
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
Update the plan at .plans/20261125-210049-review-loop-caps.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make continuation and terminal status mutually exclusive. Specify that an accepted blocking finding with a round available starts the next round before any READY status can be assigned. (evidence: .plans/20261125-210049-review-loop-caps.md:97)
2. Add the existing per-hunk checks that each fix does what its finding asked and does not break correct behavior to the final edits check, including recording and handling unresolved problems. (evidence: .plans/20261125-210049-review-loop-caps.md:100; skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:68)

SHOULD FIX:
1. Qualify or separately verify the claim about registered projects setting codexInVerify; the workspace inventory was not verified within the review limits. (evidence: .plans/20261125-210049-review-loop-caps.md:34)
2. Include the open-REGRESSION condition in the short descriptions of the early stop. (evidence: .plans/20261125-210049-review-loop-caps.md:91)

ADD THESE EDGE CASES:
- An accepted blocking finding with another round available and no open regression continues to that round.
- A final-round fix has correct citations and propagation but changes the intended behavior.
- An unchanged repeated deferred owner decision remains an open item when marked RAISED BEFORE.

Do not change anything the validation did not flag.
```