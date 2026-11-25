## Plan validation (codex): 20261125-210049-review-loop-caps.md

**Verdict:** NEEDS REWORK

### Blocking issues

- [Owner decisions] The proposed `RAISED BEFORE` rule also suppresses a finding that challenges an owner decision even if no earlier round considered it, but requires a prior round and finding number in the verdict. It can bypass the existing instruction to ask the owner about findings that need a design decision. — [.plans/20261125-210049-review-loop-caps.md:95](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:95), [skill-auto-validate-plan/SKILL.md:114](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:114) — Restrict `RAISED BEFORE` to a matching finding actually rejected in an earlier round, and preserve the owner-decision question process for new findings.
- [Stop rules] When round 4 has an open `REGRESSION` but no accepted blocking report finding, step d invokes the final check; the status rules then say both that a loop without an accepted blocking finding is `READY` and that `OPEN ITEMS` applies only to an unresolved problem after a round-4 blocking finding. An unresolved regression can therefore be reported as ready. — [.plans/20261125-210049-review-loop-caps.md:97](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:97), [.plans/20261125-210049-review-loop-caps.md:101](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:101) — Define status precedence so any unresolved regression yields `OPEN ITEMS`, including when it is the only reason round 4 reaches the cap.
- [Validator availability] A round-4 blocking fix is assigned `READY (round 4 edits self-checked)` even when a validator was OFF. That loses the existing rule that the status must identify an unavailable validator. — [.plans/20261125-210049-review-loop-caps.md:101](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:101), [skill-auto-validate-plan/SKILL.md:119](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:119) — Define and report a combined status for the self-check and the OFF validator, and cover it in the final report.

### Non-blocking concerns

- [Verification] The two negative `grep` commands return a nonzero exit status when they find nothing, which the plan describes as success. — [.plans/20261125-210049-review-loop-caps.md:151](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:151) — State the expected exit status and distinguish a match from a command error.
- [Evidence] The claim about registered projects outside this repository was not verified: the review is limited to reading the repository. — [.plans/20261125-210049-review-loop-caps.md:34](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:34) — Treat it as unverified unless a permitted inventory supports it.
- [Accuracy] The proposed Codex module description says code is reviewed in each verify round even when the owner explicitly sets `codexInVerify: false`. — [.plans/20261125-210049-review-loop-caps.md:107](/Users/gorantubic/Workspace/claude-config/.plans/20261125-210049-review-loop-caps.md:107), [render.mjs:191](/Users/gorantubic/Workspace/claude-config/skills/bootstrap-project/scripts/render.mjs:191) — Make the description account for the setting.

### Edge cases the plan should address

- A new challenge to an owner decision in round 2 or later — it needs the owner-decision process even if it resembles an earlier topic.
- An unresolved regression at the round-4 cap with no accepted blocking report finding — it must remain visible as an open item.
- A validator OFF during a round-4 blocking fix — the status must disclose both the missing validator and the self-check.
- A final-check fix that itself introduces another issue — define when the check is complete and when the issue remains open.

### Checklist

- [x] All referenced files, functions and types exist, and each call would compile
- [x] Reference implementation mirrored, deviations justified
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
- [ ] "How to verify" commands are real and can fail
- [x] Release note step present (or `no-changelog` justified)

## Copy-paste to the planning agent

```text
Update the plan at .plans/20261125-210049-review-loop-caps.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Restrict RAISED BEFORE to a matching finding actually rejected in an earlier round. Preserve the owner-decision question process for a new finding that challenges an owner decision. (evidence: .plans/20261125-210049-review-loop-caps.md:95; skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:114)
2. Define status precedence so any unresolved REGRESSION yields OPEN ITEMS, including at the round-4 cap when no blocking report finding was accepted. (evidence: .plans/20261125-210049-review-loop-caps.md:97,101)
3. Define and report a combined status for a round-4 self-check when a validator was OFF, preserving disclosure of the unavailable validator. (evidence: .plans/20261125-210049-review-loop-caps.md:101; skills/bootstrap-project/templates/core/dot-claude/skills/skill-auto-validate-plan/SKILL.md:119)

SHOULD FIX:
1. State the expected exit status for the negative grep checks and distinguish a match from a command error. (evidence: .plans/20261125-210049-review-loop-caps.md:151)
2. Treat the claim about registered projects outside the repository as unverified unless an inventory supports it. (evidence: .plans/20261125-210049-review-loop-caps.md:34)
3. Make the Codex module description account for codexInVerify: false. (evidence: .plans/20261125-210049-review-loop-caps.md:107; skills/bootstrap-project/scripts/render.mjs:191)

ADD THESE EDGE CASES:
- A new challenge to an owner decision in round 2 or later.
- An unresolved regression at the round-4 cap with no accepted blocking report finding.
- A validator OFF during a round-4 blocking fix.
- A final-check fix that itself introduces another issue: define completion and open-item handling.

Do not change anything the validation did not flag.
```