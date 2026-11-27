# Validation round 1: 20261127-230101-contracts-jump-autopilot

- Claude (`plan-validator`): ON — APPROVE WITH CHANGES (`-validation-claude-1.md`)
- Codex: ON — NEEDS REWORK (`-validation-codex-1.md`)
- Regressions from step a: none (first round of the run)
- Owner: not available; owner-level choices are recorded in the plan under `## Decisions taken for the owner`.

## Findings

| # | Source | Finding | Verdict | Action |
| --- | --- | --- | --- | --- |
| F1 | Claude B1 | The 2a page code is being reworked in its worktree (uncommitted): `checklistHtml(d)`, `showChecklist(group)`, `.ck-box`; the plan's page steps fit only commit 169b888 | VALID (checked: `git status` in the 2a worktree shows 8 modified files; `app.js` has `function checklistHtml(d)` and `function showChecklist(group)`) | Step 10 now starts with "Map to the merged 2a page first"; the card is a separate `jumpCardHtml(items, off)` and `bindJumpCard(body)`, called once from the merged functions; the opener uses `showChecklist(ckq)` (fallback named) |
| F2 | Claude B2 | The 2a `renderChecklist` harness test would throw | VALID | Step 11: `bindJumpCard` stub in that test; `jumpCardHtml` + `ckJumpOff` in the `checklistHtml` harness test; Affected files updated |
| F3 | Claude B3 | `test/bootstrap-project.test.mjs` report-names test checks `` `k` < 4 `` | VALID (lines with `stopRule`) | Step 17 updates both checks |
| F4 | Claude B4 | `cj5-bad` uses the default `PIPE_SCRIPT` → "no BASE_BRANCH" error, not "not initialized" | VALID | The case now uses a script with `BASE_BRANCH="main"` |
| F5 | Claude B5 | `base` undefined in `jumpConfirm()` | VALID | `checkSubmodule()` returns `base`, stored in `subs`; `jumpConfirm()` uses `card.base` and refuses when null |
| F6 | Codex B1 + Claude S1 | `once()`/`gitIn()`/`gitRaw()` results read without `await` | VALID (`once` caches the promise; `checkCondition()` awaits) | Step 6 says every call is awaited, with the form |
| F7 | Codex B2 | Confirm output is discarded | PARTIALLY VALID (`post()` alerts `output`, `app.js` `post()`), but the commands vanish after the alert | Step 10 states that `post()` shows output; the blocked card keeps the push commands (`blockers[].push`) while not pushed |
| F8 | Codex B3 | A batch is offered when the pin is ahead or diverged; checkout can move it backwards | VALID | `relation` (`equal`/`behind`/`ahead`/`diverged`) in step 6; state `diverged` with no Confirm in step 2; the jump plan checks ancestry before checkout (step 3); D5, D7 updated |
| F9 | Codex B4 + Claude S7 | The 200-PR cache with one PR per branch is not a complete open-PR list; no PR read yet looks like "jump now" | VALID (`listPrs()` 2 pages, `allByBranch` keeps the newest per head) | Step 6 reads open PRs of the upstream in full (`state=open&base=`, ≤5 pages) into `subs.prs`; `recommendJump(sub, blockers)` returns `unchecked` before the first read; D19 |
| F10 | Codex B5 + Claude S8 | Guard: multiple `-C`, chained `cd`, quoted separators | VALID | Step 16 resolves in shell order, restores quoted words, and treats an unreadable `cd` as unknown → checked by the guard's own rules; D13; new tests |
| F11 | Claude S2 | Branch name from `.gitmodules` unchecked into the plan text | VALID | Step 6 validates the branch with `/^[\w.][\w./-]*$/` |
| F12 | Claude S3 | `references/contracts.md` module list and `docs/roadmap.md` go stale | VALID / roadmap out of scope | Step 14 edits the `modules.<name>` row; Breaking changes notes the roadmap line is the caller's |
| F13 | Claude S4 | `upgrade-run.mjs` uses `moduleOn` | VALID | Added to Breaking changes |
| F14 | Claude S5 | Cut pattern differs between Affected files and step 11 | VALID | Both now describe the `jumpCardHtml` harness change |
| F15 | Claude S6 | Interview row 2 quote does not match `checklist.md:62` | VALID | Step 14 quotes "Default: all on, Codex on" |
| F16 | Claude S9 | Repeated PR numbers not removed | VALID | `jumpConfirm()` and `recommendJump()` remove repeats; unit case |
| F17 | Codex S1 | Owner-copy `diff` check exits 1 for the expected result | VALID | Replaced with four `grep` checks |
| F18 | Codex S2 | Recheck 2a signatures after merge | VALID | Covered by F1 |
| F19 | Both, edge | Unpushed jump plan when PRs merge; closed PR blocks for ever | VALID | D20; the card text "Archive the plan to get a new recommendation." |
| F20 | Codex edge | `.gitmodules` of the main checkout vs `origin/<base>` | VALID | Step 6 reads `.gitmodules` from `origin/<base>` |
| F21 | Codex edge | More than 50 PRs / empty selection | VALID | Step 10: Confirm refuses more than 50; empty selection = jump now only when behind (already in step 8) |
| F22 | Claude edge | A watched project without a group gets a notification that opens nothing | INVALID as a defect — D11 already accepts it (the dashboard opens; no checklist exists) | none |
| F23 | Claude edge | A private submodule with no credentials gives "cannot fetch the submodule" | INVALID as a plan change — that is the error the card shows | none |

Found by one validator only: F1–F5, F11–F16, F22, F23 (Claude); F7, F17, F20, F21 (Codex). Both: F6, F8 (Codex only, blocking), F9, F10.

## Validation response

Accepted and applied: F1–F21. Rejected: F22, F23 (behavior already chosen and documented). No owner question raised: each choice fits a recorded decision or is a safety fix.
