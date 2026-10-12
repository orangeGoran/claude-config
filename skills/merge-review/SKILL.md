---
name: merge-review
description: Review a merge before it is committed or shipped. Use when the user is merging a branch (in-progress merge with or without conflicts, a merge just made, or a branch about to go into another), says "I'm merging X", "another merge", "recheck", "what should I check", or asks to explain merge conflicts. Explains what changes for the end user and in the architecture, gives a concrete checklist, resolves conflicts only when asked, and never stages or commits.
argument-hint: "[optional: the branch being merged, e.g. origin/site/foo]"
---

Review this merge: $ARGUMENTS

Explain a merge so the user knows exactly what changed, what to click through, and what could go wrong. You are the user's second pair of eyes, not the one pressing the button.

## Hard rules

- Never run `git add`, `git commit`, `git stash`, `git reset`, `git merge --abort` or `git checkout --theirs/--ours` on a file the user has already staged, unless the user asks in the current message. The deliverable is understanding plus a resolved working tree when asked. The user stages and commits.
- Verify before you claim. Every "nothing uses X", "both sides are identical", "this builds" is backed by a command you ran in this session. Cite `file:line` for code claims.
- Never paste a whole conflicting file from one side. Work out what each side changed relative to the merge base, and combine the changes.
- Keep each file's existing format byte for byte (minified one-line JSON stays one line, no trailing newline added or removed, same key order). A rewrite that changes only formatting creates a phantom conflict in the next merge.
- The user's editor may reformat on save. If a file has to stay in a special format, say so and tell them how to save without formatting.
- Shell is often zsh: quote globs (`--include='*.html'`, `"$ref:path"`), or results silently come back empty. If a search returns 0 where you expected hits, suspect the shell before you trust the zero.
- Put temporary files in the session scratchpad, never in the repo.

## Step 1: find out what state the merge is in

Run in parallel:
- `git status --short`
- `cat .git/MERGE_MSG 2>/dev/null | head` (in-progress merge and its source branch)
- `git log --oneline -5`
- `git diff --name-only --diff-filter=U` (files still in conflict)

Then:
- In-progress merge: the incoming side is `MERGE_HEAD`. Compare with `HEAD...MERGE_HEAD` (three dots: changes on the incoming branch since the merge base).
- Merge already committed: the incoming side is `HEAD^2`.
- Branch not merged yet: compare `HEAD...origin/<branch>` after `git fetch origin`.
- If `git merge-base` reports several bases, say so; it can make diffs look larger than they are.

Collect:
- `git log --format='%h %s%n%b' HEAD..<incoming>`: read every commit message in full. Teams often write the why there.
- `git diff --stat HEAD...<incoming>`
- The diff of the project's agent or contributor docs (CLAUDE.md, AGENTS.md, CONTRIBUTING, README) on the incoming side. It usually describes the intended design and is the fastest way to understand the change.

## Step 2: conflicts (only when there are any)

For each conflicted file:
1. Show what each side did relative to the base: `git show <commit> -- <file>` for the incoming commits, and `git log --oneline <base>..HEAD -- <file>` for ours.
2. Classify each conflicting hunk:
   - **Real change on both sides:** combine them.
   - **Stale context:** one side deleted something and the other side only shows it as unchanged surrounding lines (it looks like the incoming branch "brings back" old code). Keep the deletion. Explain this explicitly, because it is the most common confusion.
   - **Format-only:** the content is identical and only whitespace, newlines or key order differ. Prove it (parse both sides and compare, or `cmp` and report the byte difference), then take the side that matches the repo's usual format.
3. Large one-line files (minified JSON, generated data) can't be merged by hand. Rebuild them with a short script that loads both sides with `git show <ref>:<path>`, applies the intended change, keeps the order, and writes the original format.
4. After resolving: no conflict markers left, nothing references removed names (grep for them), and the type check and build pass.
5. If the user asks for a plain-language or controlled-language explanation (for example ASD-STE100), follow its rules: short sentences, active voice, one instruction per step, a summary first, numbered procedure.

Tell the user if a previous fix of yours caused this conflict. Own it.

## Step 3: verify

Read the project's docs for its verification commands (CLAUDE.md "Verify", README, package.json scripts) and run the relevant ones on the merged tree. Typically: install if the lockfile changed, the type check, lint or i18n checks, the build. Report exact outcomes (counts, pass or fail), and compare page or route counts with the previous merge. Don't run slow full-suite or browser audits unless asked; list them in the checklist instead.

For claims about removals or leaks, grep the build output, not only the source.

## Step 4: read for meaning, not only for code

Go beyond "what files changed" to "what a visitor or user now sees and what it promises":
- **Copy and claims:** read the changed text in the source language. Flag new numbers, comparisons ("2x more"), legal or privacy promises ("data stays in the EU", "never", "100%"), and wording that is stronger than what the rest of the site or product supports. Say exactly what would have to be true for the claim to hold, and who can confirm it. You often can't confirm it from the repo; say that.
- **Disclosure:** internal names, file paths, version labels, customer details, NDA material or implementation details that end up in shipped files.
- **Behaviour:** changed links, CTAs, analytics event names, redirects, timings, URLs that printed material or emails depend on.

## Step 5: write the answer in this shape

Plain language. No wall of jargon. Use tables where there is a before and after.

1. **Summary** (1 to 3 sentences): what the merge does, whether it went in cleanly, whether checks pass, and the one thing that needs a decision if there is one.
2. **What changes**: grouped by what the user would notice. A before and after table for copy or behaviour changes, with real strings and values.
3. **What to check** (the user's checklist): numbered by page or feature, each item concrete:
   - the exact URL, and the locale or variant (e.g. `/de/security`)
   - the viewport widths or devices
   - the action (click Play, switch language, view source)
   - the expected result, including what must *not* happen (no height jump, no sideways scroll)
   Put the riskiest item first and say why it's risky. Start with the commands to run (install, build, preview).
4. **Architecture changes**: a table (What / Before / Now). Cover new dependencies and why they're needed (check whether they were already installed transitively), build or deploy steps, routing, shared data sources, rules now enforced by checks, removed files or keys, and the side effects for debugging or future upgrades. If nothing structural changed, say so in one line.
5. **Still open**: decisions or risks from earlier merges in this session that are still unresolved. Carry them forward until the user closes them.
6. **Next command**: what the user runs to finish (e.g. `git add <files>` then `git commit --no-edit`), noting anything they already staged that now differs.

Length matches the merge: a three-line text change gets a short answer; a new feature gets the full structure.

## Follow-ups

- "Why was X added?": answer the why (the problem it solves, why simpler options don't work, the alternatives not taken), then the cost and anything to watch later.
- "Are we disclosing too much?": read the built output as an outsider or competitor would. Separate public-standard knowledge from real implementation detail, check whether the repository itself is public, and list concrete items with a must, should or optional priority.
- "Do it": apply exactly the resolution you proposed, verify, and stop before staging.
