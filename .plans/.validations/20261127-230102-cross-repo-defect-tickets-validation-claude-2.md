**Validation round:** 2

## Plan validation: 20261127-230102-cross-repo-defect-tickets.md

**Verdict:** APPROVE WITH CHANGES

Round 1 fixes are in place: the hard-rule lines of `skill-auto-pipeline` (step 12), resume into "to PR", the redaction rule, the `REPO` and absolute-path fix of the overlay test, the crash-recovery Timeline line, the replaced PR body block, the `self` check, the `tc` name, and one reader per repo. I checked the server, watcher, template, render, verify and test symbols against the 2a worktree and against main. Most claims hold. Three new findings are blocking. Each one has evidence that round 1 did not have.

### Blocking issues

- [Discrepancy / 2a rework] Step 8, the Page-function tests and the Context use the 2a page as it is at commit `169b888`. The 2a worktree has an uncommitted rework, and PR #13 will merge that rework. At `169b888`, `checklistHtml(d, groups, pick)` has a `ck-bar` and a "Goals, holds and notes" `sc-card` (`git grep 169b888 -- apps/dashboard/page/app.js`: lines 5204, 5208, 5212). In the working tree, the function is `checklistHtml(d)` (`app.js:5276`). It has `.ck-box` cards: "Needs you now" (`app.js:5296`), "Tickets", "Goals &amp; rules" (`app.js:5312`) and "Questions". It has no `ck-bar` and no "Goals, holds and notes". `CHECK_TITLE` became `CK_DRAWER` (`app.js:5326`), and `showChecklist()` is new (`app.js:5332`). The page test is now `pick(/^function checklistHtml\(d\) \{…/m)` (`dashboard.test.mjs:2635`). Its default `goal()` has a needs-you plan, so the HTML has "Needs you now" (`dashboard.test.mjs:2661-2663`). The sibling plan does not state the signature `checklistHtml(d, groups, pick, off = new Set())` or the cut pattern that this plan quotes (a grep of `.plans/20261127-230101-contracts-jump-autopilot.md` for `off = new Set` and `groups, pick, off` finds nothing). Instead, its step 10 says "Map to the merged 2a page first" (line 215). — Why it breaks: step 8 has no `ck-bar` or "Goals, holds and notes" anchor to insert after or before. The assertion "`goal()` without `triage` → no `Needs you`" fails, because "Needs you now" contains "Needs you". The assertion that the card comes before "Goals, holds and notes" can never be true. The page would also show two areas with the "Needs you" title. — Fix: add the same "map to the merged 2a page first" rule that the sibling has. Anchor the card in the merged box markup (`.ck-box` + `<h3>`). Either put the triage rows into the existing "Needs you now" box, or give the card a title that does not contain "Needs you now" (for example "Needs triage"). Make the tests assert the `ck-triage` class, not the substring "Needs you". Remove the quoted sibling signature and cut pattern, and say "keep the merged signature".

- [Wrong data] The triage poll reads every open issue with the label `needs-triage`, not only the pipeline's tickets. Step 4 `listTriage()` uses `issues?labels=needs-triage&state=open&per_page=100`. `needs-triage` is a common label that people and issue templates add to ordinary issues. Such issues would get a notification ("A run could not tell which repo has the defect.", step 5) and a row on the checklist card, which describes them wrongly. — Fix: read `labels=from-pipeline,needs-triage` (GitHub ANDs the labels in a comma list). Update the watcher-test `calls.log` assertion (Tests → End-to-end, Harness constraints) and the `/api/ledger` contract text to match.

- [Broken step] Step 16: `skill-1-plan` must "skip the ones that also have the label `needs-triage`". The command it gives is `gh issue list --label from-pipeline --state open --json number,title,url --limit 100`, which returns no labels. — Why it breaks: the skill cannot tell which issues have `needs-triage`, so it can merge a triage ticket into a plan in the wrong repo. That is the case the "`skill-1-plan` leaves `needs-triage` tickets alone" decision is there to stop. — Fix: use `--json number,title,url,labels`. Also update the template-test string if it quotes the full command.

### Non-blocking concerns

- [Breaking-change guard] The `issue-allow` regex in step 18 (`/^Bash\(gh (issue (create|edit|close|delete)|label (create|edit|delete))\b/`) misses broad rules such as `Bash(gh issue *)`, `Bash(gh issue:*)` and `Bash(gh label *)`, which also allow writes. `push-allow` catches every `gh pr` rule except read-only ones (`verify.mjs:151`). — Suggestion: mirror that. Flag every `Bash(gh (issue|label)\b…)` rule except `gh issue (view|list)` and `gh label list`, and add a test case for `Bash(gh issue *)`.
- [Bash `set -e`] `pipelineBash()` and the script run with `set -euo pipefail` (`test/bootstrap-project.test.mjs:122`, `auto-pipeline.sh:31`). If `write_related()` ends with a test such as `[ -f "$2" ] && echo …` and that test is false, the function returns 1 and the launch stops. — Suggestion: end `write_related()` with `return 0`. Set `related_arg=""` at the start of each launch-loop pass.
- [Cleanup] `--cleanup` removes only `$slug-related.json`. The new `<slug>-ticket-D<n>.md` and `<slug>-pr-body-live.md` stay in `.plans/auto-runs/`, and they hold defect evidence. The dashboard's artifact cleanup list does not include them either (`server.mjs:1331`, worktree: `'.md', '.log', '-settings.json', '-pr-body.md'`). — Suggestion: remove them in `--cleanup`, or add them to that list. Note that `-tree.txt` and `-decision-sheet.md` have the same gap today (sibling defect).
- [Status timing] Item 7.5 runs after `skill-5-ship` has set `PR OPEN — <url>`. The dashboard reads `PR OPEN` as "needs you" (`skill-auto-pipeline/SKILL.md:70`), so the owner can get "your turn" and open the PR while the tickets and the PR body edit are still running. — Suggestion: add a Timeline line `tickets: start` / `tickets: done`, or tell the owner in item 8 that the defects block is written last.
- [Recovery] GitHub search is indexed with a delay. When a resume comes soon after a crash, `gh issue list --search "defect=D<n> in:body <PR url>"` can miss an issue that the run just created, and the run opens a duplicate. Also, the `defect=D<n>` token is only in an HTML comment, and that search is not verified. — Suggestion: list `--label from-pipeline --state all --json url,body --limit 100` and look for the marker in the bodies, with no `--search`.
- [Redaction] The issue title (`--title "<one line>"`) is not named in the redaction rule (step 12). Only the `D<n>` line, the body and the error text are. — Suggestion: name the title too.
- [UI count] `groupSummary()` (`groups.mjs:136`) counts only plans with the `needs-you` step. The sidebar group bar says "0 needs you" while triage tickets wait. — Suggestion: add the triage count, or say in the docs that the bar does not count triage tickets.
- [One reader, two groups] When two registry entries on one repo are in different groups, only the first entry's group gets the notification, but both ledgers list the issue. — Suggestion: write this case down, or key the reader by repo and group.
- [Test env] `pipelineBash()` spreads `process.env` (`test/bootstrap-project.test.mjs:122`), so the "variable unset" case cannot unset a `DASH_RELATED_REPOS` that the shell exports. — Suggestion: add `unset DASH_RELATED_REPOS` in that case's body.
- [Docs] `docs/roadmap.md:35` still says "plan 2 is not written yet". — Suggestion: update that line together with this plan.
- [Reference quote] The test that this plan names "the page: checklistHtml escapes every value…" is now "the page: checklistHtml shows what needs you first, escapes every value, …" (`dashboard.test.mjs:2624`).

### Edge cases the plan should address

- An issue that a person labels `needs-triage` in a grouped repo — it must not trigger a notification or a card row (see blocking item 2).
- A resume soon after a crash, before GitHub search has indexed the new issue — a duplicate ticket.
- Two registry entries on one repo in two different groups — which checklist gets the notification.
- The owner opens the PR after `PR OPEN` and before item 7.5 has written the defects block.
- A shared allow-list rule `Bash(gh issue *)` that came from `extraAllow` — the `issue-allow` check does not catch it.

### Checklist

- [ ] All referenced files, lines, sections and symbols exist as stated (the 2a page markup and the sibling signature are not as stated)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done: `ticketKey` → `buildChain`; `runLauncher` → launch, resume, auto-launch; `/api/ledger` → `checklistHtml`)
- [x] Wiring & registration matches the code (the `./groups.mjs` import at `server.mjs:41`, `prsFor()` at 1659, `loadWatch()` at 1949, `watchTick()` at 2292, `ledgerState()` at 1380)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Tests cover success / validation error / 401-403 / 404 / another scope per endpoint (no new endpoint; the 403 Origin case is kept; `crossSiteReason()` at `server.mjs:140`)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected (no shared contract source)
- [x] "How to verify" commands are real and can fail (`node --test …`, `grep`, `changelog-validate.mjs` (allowed in `.claude/settings.json:35`), `npm test`)

```
Update the plan at .plans/20261127-230102-cross-repo-defect-tickets.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
1. Make step 8, Tests → Page function and Context match the 2a page that PR #13 will merge, not commit 169b888. The 2a worktree has checklistHtml(d) with .ck-box cards ("Needs you now", "Tickets", "Goals &amp; rules", "Questions"), CK_DRAWER and showChecklist(); it has no ck-bar and no "Goals, holds and notes". Add a "map to the merged 2a page first" rule, as the sibling plan has. Put the card in the merged box markup: either the triage rows go into the existing "Needs you now" box, or the card gets a title that does not contain "Needs you now" (for example "Needs triage"). Make the tests assert the ck-triage class, not the substring "Needs you". Remove the quoted sibling signature checklistHtml(d, groups, pick, off = new Set()) and the cut pattern, because the sibling plan does not state them. (evidence: worktree apps/dashboard/page/app.js:5276, 5296, 5312, 5326, 5332; apps/dashboard/test/dashboard.test.mjs:2635, 2661-2663; .plans/20261127-230101-contracts-jump-autopilot.md:215)
2. Make the triage poll read only the pipeline's triage tickets: labels=from-pipeline,needs-triage in listTriage() (step 4). Update the calls.log assertion, the Harness constraints and the /api/ledger contract text to match. A plain needs-triage label is common in repos and would cause wrong notifications and wrong rows. (evidence: plan step 4, step 5 notification text)
3. In step 16, change the skill-1-plan command to gh issue list --label from-pipeline --state open --json number,title,url,labels --limit 100, so the skill can skip the needs-triage tickets. (evidence: plan step 16; the current --json fields have no labels)

SHOULD FIX:
1. Make the issue-allow check flag every Bash(gh issue …) and Bash(gh label …) rule except gh issue view|list and gh label list, as push-allow does for gh pr. Add a test case for Bash(gh issue *). (evidence: skills/bootstrap-project/scripts/verify.mjs:151)
2. End write_related() with return 0, and set related_arg="" at the start of each launch-loop pass. (evidence: auto-pipeline.sh:31 set -euo pipefail; test/bootstrap-project.test.mjs:122)
3. Remove <slug>-ticket-D<n>.md and <slug>-pr-body-live.md in --cleanup, or add them to the dashboard artifact cleanup list. (evidence: worktree server.mjs:1331)
4. Name the issue title in the redaction rule (step 12).
5. Make the crash recovery list --label from-pipeline --state all --json url,body and look for the marker in the bodies, with no --search, because GitHub search is indexed with a delay.
6. Say what the owner sees between PR OPEN and the end of item 7.5 (a Timeline line, or a note in item 8).
7. In the "variable unset" template test, run unset DASH_RELATED_REPOS in the body. (evidence: test/bootstrap-project.test.mjs:122)
8. Update docs/roadmap.md:35 ("plan 2 is not written yet").

ADD THESE EDGE CASES:
- A person labels an issue needs-triage in a grouped repo: no notification and no card row.
- Two registry entries on one repo in two different groups: which checklist gets the notification.
- The sidebar group bar "needs you" count does not include triage tickets: count them, or document it.

Do not change anything the validation did not flag.
```
