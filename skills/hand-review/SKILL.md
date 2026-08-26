---
name: hand-review
description: Guide a human through a diff file by file, one file at a time, waiting for confirmation between each. Explains what changed, why, what to check, and where to disagree — bridging from a language the reviewer already knows. Use when the user asks to be walked through changes, guided through a review by hand, or says "guide me file by file" / invokes /hand-review. This is a human-led guided tour, not the automated audit that /code-review performs.
argument-hint: "[optional target: nothing (working tree), a branch, a commit range, or a PR number]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Walk the user through this diff by hand: $ARGUMENTS

This is a **guided tour for a human reviewer**, not an automated audit. The user reads the
code; you orient them, tell them what to check, and make it easy to disagree with you.

## Rule 0 — never invent intent you do not have

Two different situations, and conflating them is the main way this skill goes wrong:

- **You wrote the code in THIS conversation.** You know why. Explain the reasoning, and
  include the "where you could push back on me" section — you are defending your own work.
- **You did not** (fresh session, someone else's branch, a PR). You know only what the diff
  and the code say. **Do not reconstruct motives from a plausible story.** Say "the commit
  message says X", "this comment claims Y", or "I cannot tell why this was done". Replace
  "where you could push back on me" with **"questions to ask the author"**.

Never carry claims from a previous session as if they were established here. If context is
missing, say so and read the code.

## Step 0 — scope and calibration (one short message, then start)

1. **Resolve the target.** No argument → uncommitted working tree (staged + unstaged +
   untracked). Otherwise a branch, commit range, or PR number as given. If the working tree
   is clean and no argument was passed, diff the branch against its base and say so.
2. **Detect the languages** in the diff.
3. **Pick the bridge language.** Default to **Node.js / TypeScript / NestJS** unless the
   user has said otherwise or the diff is already in it. State the assumption in one line —
   *"I'll bridge from NestJS; say the word if you'd rather I didn't"* — and move on. Do not
   ask and wait.
4. If the diff is large, mention that they can say "terser", "bundle the rest", or "skip to
   file N" at any point.

## Step 1 — the map (first message)

Before any file, show the whole shape as a table: number, file, and a few words on **why it
is in that position**.

**Order by narrative, never alphabetically or by path.** Usually:

1. The heart of the change — the file that, once understood, makes the rest follow
2. Deleted files — reviewed as *"what went, and did anything break"*
3. Contracts and interfaces the change moves through
4. Wiring / DI / config
5. Callers and consumers
6. Tests — where the claims are actually proven
7. Docs, lockfiles, housekeeping

**Bundle tightly-coupled files** into one numbered unit when splitting them would hurt
comprehension. Say why they are bundled.

Then start file 1. Do not dump several files at once.

## Step 2 — per file

Head each one **"File N of M — `path` *(new / modified / deleted, size)*"** with a clickable
link. Then, adapting to what the file deserves — a one-line config change does not need all
seven parts:

| Part | What it does |
|---|---|
| **What it is** | One paragraph, plain language. Bridge unfamiliar constructs to the reviewer's language with a short snippet when it genuinely helps. Never analogise for its own sake |
| **How big the change really is** | Separate signal from noise: *"the actual code change is 6 lines; the rest is comments"*. In comment-heavy or doc-heavy code this is the single most useful sentence on the page |
| **Read it in this order** | Numbered steps with `file:line` links. Point at what matters, in the order it makes sense — not top to bottom |
| **A concrete trace** | Walk one realistic case end to end with real values, as a table or short list. Use the case the change exists for. Skip only when the file has no runtime behaviour |
| **Verify yourself** | 2–4 checks the reviewer can run — a grep, a command, a file to open — **each with the answer you expect**, so they can catch you being wrong. Prefer checks that would actually fail if the change were broken |
| **Where you could push back** | The weakest points of the change, named by you. Judgement calls, things left undone, places you were unsure. **If you did not write the code, this becomes "questions to ask the author"** |
| **Honesty markers** | Pre-existing vs introduced here · deliberately not fixed and why · verified by reading vs inferred |

**Verify live rather than from memory.** Run the greps and reads while writing the section.
Claims about absence ("nothing else references this") must be checked, not assumed — and say
so when a check nearly misled you. That is useful to the reviewer.

End with the next step: *"say **next** for file N+1 (`path`) — <one line on what it holds>"*.
**Then stop and wait.** One file per turn unless the user asks for more.

## Step 3 — when the reviewer flags something

Fix it immediately, then continue the tour:

1. Confirm what you understood them to mean, in one sentence.
2. Make the change. If it is behavioural and the repo has tests, add or update one — and if
   it is a bug fix, **make the test fail first and show the red output**.
3. Say in one line what you changed, and add it to the running findings list.
4. Resume where you left off.

**Do not silently widen scope.** If the fix turns out to be larger than it looked, or touches
files outside this review, stop and say so before editing. If they interrupt mid-fix, report
exactly what is applied and what is not — never leave the tree in a state you have not
described.

## Step 4 — tangents

The reviewer will ask questions that are not about the current file — how a subsystem works,
why a convention exists, what happens in some scenario. **Answer them properly**, verifying
against source, then return to the tour and restate which file is next. A good tangent is the
review working, not a derailment.

## Step 5 — wrap-up (after the last file)

- **Findings** — everything they raised, what you did about each, in a table
- **Still open** — anything deliberately not addressed, and who owns it
- **What the tour did not cover** — files skipped, checks not run, claims resting on reading
  rather than execution
- Offer the obvious next step: run the tests, produce a commit message, write the findings
  into a plan or issue

## Rules

1. **One file per turn. Wait.** The pacing is the point — it is what makes it reviewable
   instead of a wall of text.
2. **Track position** — "File 7 of 21" in every heading, so a long review survives a break.
   For reviews over ~8 files, offer once to write the map and findings to a scratch file so
   the tour can resume in a later session.
3. **Link everything clickable** as relative `file:line` paths.
4. **Never claim a test passes without running it.** If you cannot run the suite, say so.
5. **Comment-heavy code:** say what is executable. Do not let prose inflate the apparent
   size of a change.
6. **Do not lecture.** The reviewer is capable; they lack context, not ability. Skip
   language basics unless the construct is genuinely load-bearing for the change.
7. **Do not stage or commit** unless explicitly asked. Fixes go in the working tree.
