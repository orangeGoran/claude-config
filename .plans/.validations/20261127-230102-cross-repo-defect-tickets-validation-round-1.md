# Validation round 1 — 20261127-230102-cross-repo-defect-tickets

- Claude (plan-validator): ON — APPROVE WITH CHANGES — `-validation-claude-1.md`
- Codex: ON — NEEDS REWORK — `-validation-codex-1.md`
- Regressions from the previous round: none (first round of this run)

## Findings

| # | Raised by | Finding | Verdict | Evidence / action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1, Codex B1 | The skill's hard rules forbid network writes other than ship and anything outside the worktree | VALID | `skill-auto-pipeline/SKILL.md` lines 17 and 25. Step 12 now changes both lines. |
| F2 | Claude B2, Codex B2 | `would open` lines are never ticketed after a resume into "to PR" | VALID | Item 7.5.1 takes `open`, `would open in`, `failed`, and checks targets against the list of now. New owner-default decision "Resume into to PR mode". |
| F3 | Claude B3 | The sibling plan exists: it adds the `?checklist=` opener, the `off` parameter, and its card after Tickets | VALID | Read `.plans/20261127-230101-contracts-jump-autopilot.md` steps 10/11 and D15. Context rewritten; Step 8 adds no opener; wiring, contracts, mirror and affected files updated. |
| F4 | Claude B4, Codex B5 | No redaction of evidence and errors that go to another repo | VALID | New redaction rule (Decisions; Step 12); rendered-text test checks `<redacted>`. |
| F5 | Claude B5 | The overlay test fails: `$REPO` unbound in `pipelineBash()`, relative output paths | VALID | `auto-pipeline.sh` line 38 sets `REPO`; `pipelineBash()` takes only CONFIG + functions. Test body sets `REPO`, absolute temp paths. |
| F6 | Claude B6 | `bash -n` in How to verify has no allow rule and is not in Commands | VALID | Removed; the template test already runs `bash -n`. |
| F7 | Codex B3, Claude S (resume duplicates) | A crash after `gh issue create` can create a duplicate | VALID | `ticket creating:` Timeline line + recovery search by the hidden marker (item 7.5.2). |
| F8 | Codex B4, Claude S (append twice) | The PR body edit appends and may overwrite later edits | VALID | Item 7.5.6 reads the live body and replaces a marked block; failure handling defined. |
| F9 | Codex B6, Claude S | `self` not checked with the repo-name rule | VALID | `jq -e` now tests `.self`; new test case with a bad `self`. |
| F10 | Codex B7 | Triage events can be lost after an earlier save | PARTIALLY VALID | The watcher's rule is "a crash can lose an event, never repeat one" (`server.mjs` step 7 comment). Step 5 now saves and appends the triage events at once, as step 1 does for PR events, and notifies at once. No extra recovery. |
| F11 | Claude S | `cache` is already the `once()` Map parameter of `watchProject()` | VALID | Renamed to `tc` (`triageLists[proj.root]`). |
| F12 | Claude S | "100+" vs "Only the first 100 are shown." | VALID | One text. |
| F13 | Claude S | Three doc spots missing in `docs/plans-dashboard.md` | VALID | Step 21: parts sentence, `/api/ledger` field list, events table row. |
| F14 | Claude S | Global-rules line: `skills/bootstrap-project/` is in the symlinked `skills/` | VALID | Hard rules line rewritten. |
| F15 | Claude S | `issue-allow` can fail a project with such a rule in `extraAllow`; not listed | VALID | Breaking changes row added. |
| F16 | Claude S | The overlay rules allow any repo | VALID (documented) | New decision: a rule cannot read the run file; the skill text limits the target. |
| F17 | Claude S | `projByName()` per project re-reads the registry | VALID | `allProjects()` once in `ledgerState()`. |
| F18 | Claude S | New template tests need `jq` | VALID | The cases skip with a reason when `jq` is missing. |
| F19 | Claude edge, Codex edge | Group lost and regained; two entries on one repo | VALID | `next.triage = null` without a group; one reader per repo; `repo#number` once in the ledger; new watcher case. |
| F20 | Claude edge, Codex edge | Label creation fails for another reason | VALID | Item 7.5.3: `failed (label: …)`, no issue. |
| F21 | Claude edge | `skill-1-plan` could take a `needs-triage` ticket | VALID | Step 16 skips them. |
| F22 | Codex NB | The ticket search limit of 100 is not visible to the planner | VALID | Step 16 says it in the overview. |
| F23 | Codex NB | Recheck the sibling integration | VALID | Covered by F3; the plan says to follow the merged code. |
| F24 | Codex edge | Issue created, PR body edit fails | VALID | Item 7.5.6 failure handling. |
| F25 | Codex edge | Related list changes on resume | VALID | Item 7.5.1. |

Only Claude found: F3, F5, F6, F11–F18, F21. Only Codex found: F10, F22.

## Validation response

All findings were applied to the plan, except that F10 keeps the watcher's existing loss rule. No finding needed an owner decision; the new defaults are listed under `## Decisions taken for the owner`.
