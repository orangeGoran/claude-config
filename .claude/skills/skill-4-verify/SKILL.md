---
name: skill-4-verify
description: Verify step of the workflow (step 4). Runs a bug-hunt loop of max 2 rounds; each round is one Claude /code-review and then one Codex review (the repo's validate-implementation skill; skipped when Codex is missing or out of quota), and it fixes and re-tests their valid findings (it stops when it converges or only deferrals are left), then audits the result against the hard rules in AGENTS.md (Restart after dashboard changes; No npm dependencies; Public repo: no private data; Global rules affect every project; Never stop processes by name; Tests for logic changes; Docs: current state only), contracts, doc comments, tests, secrets, security and plan scope, and reports an evidence table. Use after /skill-3-test; /skill-auto-pipeline calls it unattended.
argument-hint: "[plan file | files] [--unattended] [--no-codex]"
---

Verify: $ARGUMENTS

You run the **Verify** step: `/skill-1-plan` → `/skill-2-implement` → `/skill-3-test` → `/skill-4-verify` → `/skill-5-ship`.

`--no-codex` skips the Codex part of each round (Step 1, item 4).

**Order matters.** The bug hunt runs first (each round: Claude, then Codex), the rule audit second. The reviewers' fixes are code too, so the audit must see them.

## Rules

- Run commands bare, one per call: no pipes, `&&`, redirection or heredocs. Commands come from `AGENTS.md` (**Commands**) and `package.json` only; a missing one is "not available yet".
- **Unattended** (`--unattended`): never use AskUserQuestion. Fix rule violations that have one clear fix. Put everything that needs a decision under **Open items**.
- Do not run `git add`, `git commit` or `git push`. The pipeline commits.

## Reporting rules

These rules apply to every summary, report section, PR body, comment and status line that this skill writes. The owner reads them instead of the code, so a wrong "done" costs more than an honest "open".

- **Every claim names its evidence:** a link, a `file:line`, or the command and its result (counts, exit code). A claim without evidence is "not checked", never "done".
- **An odd value is a finding until you prove that it is harmless:** a count of 0, a skipped test, an empty file or section, a link that does not load, a status that does not match the plan. Write what you checked to clear it, or list it as open.
- **Count the real state.** A summary gives the count of the whole, for example "41 passed, 2 skipped". Never write "all done", "everything works" or "complete" unless the count shows it.
- **"Skipped" is not a result** for a check that the plan or this skill requires. A required check that did not run is open, with the reason.
- **When the evidence changes after the PR opened** (a new test result, a fix, a new browser-test report), rebuild the decision sheet and update the PR body. Each line of the sheet (for example "Browser test") must match the PR body.

## Step 0 — Scope

- The changed files, each command in its own call: `git diff --name-only main...HEAD`, `git diff --name-only`, `git diff --cached --name-only`, `git ls-files --others --exclude-standard`.
- A plan file: also read it. Its **Affected files** list is the expected scope, and its **Tests** section feeds the **Tests** row.
- Unclear scope: interactive, ask; unattended, use the plan's **Affected files** plus the changed files, and record the choice under **Open items**.

## Step 1 — Bug hunt (max 2 rounds; each round is one Claude review, then one Codex review)

The rule audit (Step 2) checks compliance, not logic. Run the bug hunt yourself; do not leave "run /code-review next" for the owner. It is a loop, because a fix that rewrites a query or a branch changes the code that the next review reads. Each round has two reviewers in this order: Claude reads the code, then Codex reads the code that Claude's fixes left. Round 2 repeats both on the result of round 1.

### One round

1. **Claude.** Invoke the code-review skill: `Skill(skill: "code-review", args: "high --fix")`. You wrote this code, so do not review it inline yourself.
2. **Re-test Claude's fixes.** They are not checked yet. List the files it touched (`git diff --name-only`). For each one, run the scoped tests (AGENTS.md, **Commands**, "Test (one file)") and the check-only lint and format commands again. When it touched an entry point that an end-to-end test covers (a route, a handler, a public interface), also run the matching end-to-end test ("Test (end to end)"). A command that is "not available yet" is skipped with that reason. Fix a failure before the Codex part.
3. **Record Claude's part:** findings fixed, findings deferred, files touched, re-test result. Number each finding `F1`, `F2`, … in the order found.
4. **Codex** (skip with `--no-codex`, or when Codex is OFF for the run):
   1. **Find the CLI (round 1 only).** `command -v codex`, else `test -x ~/.local/bin/codex` (the Bash tool does not load `~/.zshrc`). Use the one you found as `<codex>`. Write the path exactly as `codex` or `~/.local/bin/codex` (with the `~`, not the expanded home folder): the allow rules match that text. Then run `<codex> login status`. Missing or not logged in → **Codex OFF for the run** ("Codex not available"; the fix for the owner: `npm install -g @openai/codex`, then `codex login`). A command that the session refuses ("requires approval") is not a missing CLI: record `permission denied: <command>`.
   2. **Run it.** `mkdir -p .plans/.code-reviews`. The report has one fixed name per branch, `.plans/.code-reviews/<branch-with-slashes-as-dashes>-codex.md`, because `/skill-5-ship`, `/skill-auto-pipeline`, `plan-lanes.mjs` and the plans dashboard read only that name. Each round overwrites it, so in round 2 first copy the findings of round 1 (with their `F<n>` and states) into the round log. Then, as a background Bash with a 10-minute timeout, run the repo's Codex skill as it is:
      ```bash
      <codex> exec --sandbox read-only -o ".plans/.code-reviews/<branch-with-slashes-as-dashes>-codex.md" "Use the validate-implementation skill from this repository (.codex/skills/validate-implementation/SKILL.md) and follow it exactly. Base: main. Plan: <plan file or none>. Read the skill file first. Your final message must be only the report." </dev/null
      ```
      Keep `</dev/null` (without it, `codex exec` waits for input forever). Do not pipe the output, and never edit the `-o` file. A non-zero exit, a timeout, an empty `-o` file, or output that mentions a quota, a usage limit, a rate limit or billing → **Codex OFF for this round** with that reason in a few words (`quota: usage limit until 14:00`). A quota or a missing CLI keeps it OFF for the rest of the run; after another failure, try again in the next round.
   3. **Codex OFF never fails this step.** Interactive: tell the owner in one line (`Codex is OFF: <reason> — continuing with Claude only`). Write the reason in the round log and in row 1.
   4. **Check each finding** against the code as `/apply-validation` does: VALID, PARTIALLY VALID or INVALID, each with `file:line` evidence. A finding that repeats an earlier finding keeps its `F<n>`. Number the new ones after the last number and mark them `(codex)`.
   5. **Fix the VALID findings.** Then re-test the touched files as item 2 says. A VALID finding without one clear fix is deferred and goes under **Open items**. A finding that argues against an earlier fix is an oscillation: do not change the code, report both versions ("Stop at once").
   6. **Record Codex's part:** VALID, fixed, deferred, files touched, re-test result, and the report path. Codex's "Present but not planned" list goes under **Open items** when a person must decide whether to keep the extra code.

### When to stop

Stop the loop after a round as soon as one of these is true. An early stop is the normal result:

- **Converged:** in this round, neither Claude nor Codex fixed anything or found anything new. A finding that repeats an earlier deferred finding is not new.
- **Only deferrals left:** the round found problems but could fix none of them. They need a person; more rounds do not help.

**Hard cap: 2 rounds** (Claude, Codex, Claude, Codex). Never run a third. If round 2 still fixed something, stop anyway, say that the loop hit the cap, and list what round 2 changed, so the owner looks at it first.

**Stop at once and escalate** (report, do not continue):

- **Oscillation:** a reviewer undoes or argues against an earlier fix (its own or the other reviewer's). Report both versions and which one is in the tree. A person decides.
- **A test keeps failing:** the same test still fails after two fix attempts. Report it; do not keep patching.

## Step 2 — Rule audit

Read the nested `AGENTS.md` files of the touched folders. Then check the post-review tree. Run the Grep and Read checks in parallel subagents if the scope is large; run all Bash commands yourself (subagents do not get the run's Bash permissions).

| # | Check | How |
| --- | --- | --- |
| 2 | Lint and format | The check-only lint and format commands of AGENTS.md, Commands, on the changed files. Never a `--fix` command; with only a fixing command, report "check-only command not available yet". Error and warning counts. |
| 3 | Restart after dashboard changes | After a change to apps/dashboard/server.mjs, the page files in apps/dashboard/page/ or anything they import lands in the main checkout (a merge and git pull, or an edit there), run pgrep -fl chat-relay.mjs, then npm run restart, but only when it shows that the live chats run under the relay. A pipeline run in a worktree does not restart: the service runs the main checkout, so its report lists the restart under Open items. Check: A run that touches apps/dashboard/server.mjs or apps/dashboard/page/ lists "after merge: pgrep -fl chat-relay.mjs, then npm run restart" under Open items; a session in the main checkout shows the pgrep check and the restart, or says why the restart was left to the owner. Name the file:line of each place you checked. |
| 4 | No npm dependencies | The scripts use only Node built-ins; package.json has no dependencies, and the page loads browser libraries (Monaco, Mermaid) from a CDN. Check: The diff adds no dependencies or devDependencies to package.json and no lock file. Name the file:line of each place you checked. |
| 5 | Public repo: no private data | The repo is public: files hold no client names, private paths or secrets, and the templates in skills/bootstrap-project/templates/ stay generic (project values come from the interview). Check: Grep the diff, and every plan in .plans/, for client and project names, absolute home paths and tokens: plans are pushed to the public repo before they run. Name the file:line of each place you checked. |
| 6 | Global rules affect every project | The root CLAUDE.md and the skills/ folders are symlinked into ~/.claude/, so a change there changes every project; keep them short and generic. Check: A change to the root CLAUDE.md or to skills/ says in the plan which projects it affects; the root CLAUDE.md is never replaced by a template. Name the file:line of each place you checked. |
| 7 | Never stop processes by name | Stop a test dashboard or server by its port or PID, never with pkill or killall by name: that once stopped the real dashboard and a live chat. Check: Grep the diff and the run commands for pkill and killall. Name the file:line of each place you checked. |
| 8 | Tests for logic changes | A change to server or script logic gets a test in the app's test/ folder (apps/<app>/test/) or in the root test/, run with npm test. Check: A diff that changes logic in apps/, scripts/ or skills/*/scripts/ also changes a file in apps/<app>/test/ or test/. Name the file:line of each place you checked. |
| 9 | Docs: current state only | READMEs and docs describe the current state in simple English (ASD-STE100), one line per paragraph, no change history. Check: The changed Markdown has no hard-wrapped paragraphs and no history or session notes. Name the file:line of each place you checked. |
| 10 | Contracts | The project has no shared contract source yet. When one exists, add it here and take types and enum values only from it. |
| 11 | JSDoc | Every new or changed public function has a doc comment in ASD-STE100. Report only what the diff added or changed. |
| 12 | Tests | Every test in the plan's **Tests** list exists, and each rule above that the change touches has a test that fails when the rule breaks. |
| 13 | Secrets | No keys, passwords, tokens or private paths in the code or fixtures. Fixtures use made-up data only. Evidence: the secrets scan of Step 2 (files scanned, findings or "clean"). |
| 14 | Security | No `confirmed` finding from the security pass of Step 2. Evidence: the checklists used, the files reviewed, and each finding with its attacker, victim and result. A `needs_validation` item does not fail the row. |
| 15 | Plan scope | Every plan step is done. No file outside **Affected files** changed without a reason in the summary. No open owner decision taken silently. |

- **Lint and format are check-only here.** Use the "Lint (check only)" row of the `AGENTS.md` **Commands** table when it has one, and a format command that only checks. Give them the changed file paths when they take paths. Never run a command with `--fix` (or a script that runs one) in this step: an audit that changes files proves nothing. When the repo has only a fixing command, report "check-only command not available yet" and use the output of the post-review re-run. Judge by the exit code and the error count, never by the last lines of the output; search a long output with the Grep tool for the error marker of the linter.
- **One check, one place.** When a hard-rule row already covers a topic of a later row (for example secrets or contracts), the later row reuses that evidence and says so. Do not run the same check twice.

**Evidence gate.** A row is Pass only when you looked: name the files and lines, or the command and its counts. "Lint passed" does not prove a hard-rule row. An auto-fixed file gets the same audit.

### Secrets scan (subagent, Grep and Read only)

Start it as a background subagent at the start of Step 2, in the same message as the other subagents. Give it the list of changed files from Step 0 and Step 1:

> Search these changed files for secrets: <changed files>. Look for literal values assigned to names such as `password`, `secret`, `token`, `apiKey` or `api_key` (not type definitions); database, cache or service URLs that must come from config or the environment; PEM blocks, base64 key material and credential files; real customer data, real names, real addresses and private paths in fixtures, seeds and tests (fixtures use made-up data only). Ignore example env files that hold only placeholders, and type-only definitions such as `password: string`. Report each finding with its file path and line number, or say "clean" and list the files you searched.

Its result is the evidence of the Secrets row (or of the hard-rule row that covers secrets). Fix a finding that has one clear fix (move the value to config, replace the fixture value with a made-up one); put every other finding under **Open items**.

### Security pass (subagent, Grep and Read only)

Pick the checklists of `.claude/skills/skill-4-verify/security-checklist.md` from the changed paths:

| The change touches | Checklist |
| --- | --- |
| a query, a repository, a cache key, a background job, an export, a delete or a purge | A — Data isolation |
| a prompt, a retrieval query, or code that acts on model output | B — AI and model output |
| sign-in, sessions, tokens, cookies, an access check, a middleware, a rate limit | C — Authentication and access |
| a shell command, a raw query, a file path from the request, a URL that the server fetches, HTML output | D — Injection and files |

No row matches → the Security row is N/A, with "no changed path matches the security table". Otherwise start a background subagent in the same message as the secrets scan:

> You do a security review of a change. Read `.claude/skills/skill-4-verify/security-checklist.md`: the **Rules** section, the checklists <A/B/C/D>, and the **Output** section. Review these files and the code they call: <changed files>. Read the global guards and middleware before you claim that a check is missing, and quote them. Report only what passes the candidate gate (attacker, input, control, gap, victim, result). Return only the Output block.

Do not fix its findings automatically. A `confirmed` finding fails the Security row and goes in the **Violations** list. A finding that cannot name the attacker, the victim and the result is rejected. A `needs_validation` item does not fail the row: put it in the **Security: needs validation** block of the report (Step 3).

### Red flags — stop if you catch yourself doing one of these

- A row is Pass, but you did not read the changed files of that row.
- A hard rule is N/A without a reason, or Pass because lint passed.
- The secrets check is skipped because "this project has no secrets".
- A placement is accepted because "the plan put it there". The plan is not an exception to a rule.
- A file is left out of the audit because the Step 1 reviewer rewrote it. Its fixes are code like any other.
- A security finding is accepted that cannot name the attacker, the victim and the result.
- The Security row is N/A, but you did not check the changed paths against the table of the security pass.
- A test count comes from an earlier run, not from a run in this step.

## Step 2.5 — Test review

Invoke `Skill(skill: "test-review", args: "--fix --base main --plan <plan file>")` (leave out `--plan` when there is no plan file). It writes `.plans/.test-review/<branch-with-slashes-as-dashes>.md`. Carry its `## Summary for the PR` section into your report; `/skill-5-ship` and `/decision-sheet` read the file.

The **Tests** row fails when the summary lists a `POSSIBLE PRODUCTION BUG`, or a SURVIVED or MISSING item that `--fix` did not fix. Each such item also goes under **Open items**. A `Test review: OFF (<reason>)` summary fails the row with that reason.

After its `--fix`, run the scoped tests and the check-only lint again for the test files it changed.

## Step 3 — Report

Start with:

> **TLDR:** 1–3 plain sentences: what changed and the one thing to check first.
>
> **Suggested review order** (most important first):
> 1. `path/file` — why it matters

Rules for the review order:

- List only files in the verified scope: the Step 0 files plus the files Step 1 touched. Do not add other files.
- Rank by importance, not by name or folder: the code that the hard rules protect first, then contracts, data and migrations, then services and queries, then controllers, handlers and UI, then tests, then wiring and registration edits last.
- One line per file, with a short reason. Group closely related files on one line (for example a model and its spec) when it keeps the list short.
- Files that a reviewer's fixes rewrote (Step 1 and later) rank above equal files that the author wrote, because nobody has read them yet. Mark them `(auto-fixed)`.
- Put each file with a Fail in the table at the top.

Then the table:

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Code review | Pass/Fail | rounds, fixed, deferred, re-test result; per round `Codex ON: <n> VALID, <n> fixed, <n> deferred` or `Codex OFF: <reason>`; the Codex report path (`.plans/.code-reviews/<branch-with-slashes-as-dashes>-codex.md`) when a round ran Codex |
| 2–15 | (as above) | Pass/Fail/N/A | files and lines, or command and counts |

Codex OFF does not make row 1 Fail.

Then **Code review rounds** (per round one line for Claude and one line for Codex: ON with its counts and the report path, or OFF with the reason; then why the loop stopped: converged, only deferrals left, hit the cap, or escalated), **Findings**, **Violations** (file, line, what is wrong, the fix, and whether you fixed it), and **Open items**.

- **Findings:** every code-review finding of every round, numbered `F1`, `F2`, … in the order found: `F<n>. file:line — one-line gist — fixed | deferred | decided (<by whom>)`. Keep the numbers when you report again, so that "F3" means the same finding in the report, the PR and a follow-up chat.
- **Security: needs validation:** when the security pass returned `needs_validation` items, one line per item below the table: its title, the missing fact, and who can answer it. These items are questions for a person, not failures. Leave the block out when there are none.
- **Open items:** the deferred findings (by their `F<n>`), the `needs_validation` items and the decisions for the owner. Write each decision as `Question N: <title>` in ASD-STE100: the facts, one example step by step, Option A (recommended) and Option B, and why A. The owner answers with a reply like "1A 2B", so the text must make sense without this session.

After any fix in this step, run the scoped tests and the check-only lint for the touched files again. Do not start the Step 1 loop again for rule fixes.

The step is complete only when rows 1–15 are Pass or N/A, and each N/A has its reason. These rows may be N/A: rows 3–9 (the hard rules), only when the scope has nothing the rule checks, with that reason; row 10 (Contracts), when the change does not touch a contract; row 14 (Security), only when no changed path matches the table of the security pass; row 15 (Plan scope), only when there is no plan file. Rows 1 (Code review), 2 (Lint and format), 11 (JSDoc), 12 (Tests), 13 (Secrets) are never N/A. Otherwise report what is left and stop.

When the step is complete, run `bash .claude/scripts/workflow-complete-step.sh <plan-basename> verify` (`<plan-basename>` without `.md`).

Next: `/skill-5-ship` (only when the owner asks, or in "to PR" mode).
