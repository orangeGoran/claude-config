---
name: hand-review
description: Guide a human through a diff one unit at a time — bundling files into themed groups for large changes — waiting for confirmation between each. Follows one real request end to end through the change, in the order the code runs, one stop per message, opening each in words a twelve-year-old could follow. Criticisms are collected and delivered at the end rather than interrupting the story. Use when the user asks to be walked through changes, guided through a review by hand, or says "guide me file by file" / "bundle these" / invokes /hand-review. This is a human-led guided tour, not the automated audit that /code-review performs.
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

## Rule 1 — the register (this is the skill)

The most common failure is not being wrong. It is being **unreadable** — dense, jargon-stacked
paragraphs that are individually accurate and collectively useless. Assume the reviewer is a
capable engineer who does not know **this codebase**.

- **Headline the consequence, not the mechanism.** *"Saving a form with nothing changed logged
  people out"* — then explain that the database counts a rewritten row as affected. Never the
  other way round. This is the single biggest lever in this skill.
- **Short sentences, one idea each.** If a sentence has three clauses and two pieces of jargon,
  split it.
- **Define the domain fact before you lean on it.** One or two sentences, then use the term.
- **Plain words on first use, precise term second.** *"kick them out of every device they are
  logged into"* before *"revoke the session"*.
- **Concrete numbers beat adjectives.** *"waited 32 seconds, not the 5 it claimed"*, not
  *"a significant discrepancy"*.
- **Never make them hold two new concepts at once.**
- **Bold the load-bearing sentence** in a long section so a skim still lands.
- If a paragraph needs two readings, rewrite it. Litmus test before sending: *could someone
  who knows programming but not this repo follow this on one pass?*

**When the reviewer says they do not understand: do not add detail.** Stop, throw the
explanation away, and re-explain from the top in fewer, simpler words. Adding more is the
wrong instinct and makes it worse.

Do not lecture. They lack context, not ability. Skip language basics unless the construct is
genuinely load-bearing.

## Rule 2 — plain words open everything; the hard version is on request

**Every stop opens in words a twelve-year-old could follow, carrying a concrete everyday
example.** That opening is not a summary and not optional. It is how the reviewer gets their
footing before a single real name appears.

**Do not then repeat the same point in senior register.** An earlier version of this skill
required both halves inline, every time. It doubled the length of every message and the reviewer
got lost *faster*. More words is the wrong fix for confusion.

So:

- **Inline:** plain words first, then let the real names arrive *inside the same explanation* as
  it goes on. One pass, one rising altitude — never two copies of one idea.
- **On request:** when the reviewer says **"senior version"**, **"harder"**, or asks how they
  would have written it themselves, give that same point again in full engineering register —
  real types, the mechanism, `file:line`, the trade-off that was made. This is the comparison
  they learn from, and it lands when they asked for it rather than when you decided they needed it.
- **At the wrap-up:** the findings list is written in engineering register by default. By then
  they have the whole story and want precision.

### Rules for the plain opening

- **The example is mandatory.** An abstraction restated in short words is still an abstraction.
  Doors, keys, luggage tags, a bakery queue, a signed permission slip, a sealed envelope.
- **Zero jargon in the opening.** If the word would not appear in a children's book, hold it
  back a paragraph — *cache*, *token*, *async*, *interface*, *inject*, *middleware* all fail.
- **Never write "basically" or "essentially".** Say the thing instead.
- **One metaphor per mechanism, per review.** Reusing doors-and-bouncers for two different
  things fuses them in the reader's head.
- **It has to be true.** A simplification that misleads is worse than jargon. If the metaphor
  breaks down somewhere load-bearing, say where, in one clause.

## Step 0 — scope and calibration (one short message, then start)

1. **Resolve the target.** No argument → uncommitted working tree (staged + unstaged +
   untracked). Otherwise a branch, commit range, or PR number as given. If the working tree
   is clean and no argument was passed, diff the branch against its base and say so.
2. **Detect the languages** in the diff.
3. **Pick the bridge language.** Default to **Node.js / TypeScript / NestJS** unless the user
   has said otherwise or the diff is already in it. State it in one line and move on — do not
   ask and wait. Bridge only where a construct is load-bearing; never analogise for its own sake.
4. **Measure the comment-to-code ratio** before writing anything (see **How big it
   really is**, Step 2). In a
   comment-heavy repo this reframes the whole review.
5. Mention they can say "terser", "bundle the rest", "skip to N" or "wrap up" at any point.

## Step 1 — the journey (the default flow)

**Follow one request end to end, in the order the code actually runs.** Not file by file, not
bundle by bundle. A file-ordered tour is a parts list, and nobody learns a machine from a parts
list — they learn it by watching it run once. This is the single biggest change you can make to
whether the review lands.

1. **Pick one real thing a person does**, and name it the way that person would: *"someone
   clicks Wink — the button that flashes the LED so you can tell which device you are looking
   at."* Prefer the action the change exists for. Verify the endpoint or handler is real, and
   link it.
2. **List the stops** — 6 to 12, one line each, in execution order. Title each in plain words
   (*"the doorman who waits inside, not at the door"*), never with a filename.
3. **Say what is deferred.** No criticisms, no shell checks, no findings along the way. They all
   arrive as one list at the final stop. Say this up front so the reviewer stops bracing for it.
4. **Name the one pretend thing, once.** If the story needs something not yet true — an
   annotation a later stage adds, a flag that ships off — say so plainly at the stop where it
   first matters, then carry on. Never let the narrative quietly assume it.
5. Mention they can say "terser", "skip to N", **"senior version"** or "wrap up" at any point.

6. **Publish a coverage ledger with the stop list.** A journey visits some files more than
   once, which costs the reviewer the one thing a file-ordered tour gave them for free: knowing
   when a file is *done*. So print a table — stop number against the files that are **finished**
   after it — before stop 1. Some stops finish nothing, and saying so is the point.
7. **Say how the change will be split into commits**, if the file count or the repo's own rules
   mean it cannot be one. Check the count against any commit-size rule the project states, and
   name the split as falling out of the ledger. Propose the actual messages at the wrap-up.

**Every file appears at the moment the request first touches it, and never before.** Files the
request never reaches — tests, fixtures, lock files, pipeline — get their own stops at the end,
once the journey is complete.

### When there is no single request to follow

Some diffs have no runtime path: a docs change, a dependency bump, a pure refactor, a CI change.
Then use the themed-bundle map in **Step 1b**. Say in one line why the journey does not apply
rather than forcing a fake one.

## Step 1b — the map (fallback: when there is no request to follow)

Show the whole shape as a table before any code: number, unit, real size, and a few words on
**why it is in that position**.

**Order by narrative, never alphabetically or by path.** Usually: the heart of the change →
deleted files → contracts → wiring/config → callers → tests → housekeeping.

### Bundling — the default above ~10 files

Group files into **themed units of 1–6 files** and number the units, not the files. Bundle by
*subject*, not by directory: the thing being changed, plus the interface it moves through, plus
its test. Say why each bundle is a bundle.

**Then tell them which bundles actually matter.** Something like: *"Bundles 2, 3 and 5 are where
every judgement call lives — about 45 minutes. Skip 7 outright. Skim 8 by test name."* Naming
what to skip is as valuable as naming what to read, and it is what makes a 40-file review
happen at all.

Then start unit 1, in the per-unit shape at the end of Step 2. Do not dump several at once.

## Step 2 — per stop

Head each one **"Stop N of M — <plain-words title>"**. Then these four parts, in this order, and
nothing else:

1. **What happens.** Three to six short sentences. What the request is doing here, in plain
   words, carrying Rule 2's everyday example if the stop needs one.
2. **The lines that actually run.** A handful — 3 to 10. Not the file. If the file is 200 lines
   and 6 of them execute on this path, show the 6 and say so.
3. **Why it is built that way.** Two to four sentences on the design choice, and what would go
   wrong with the obvious alternative. This is where the real names arrive.
4. **The link.** Clickable `file:line`.
5. **Done after this stop.** One line naming the files now fully covered — *"safe to stage:
   `x.cs`, `y.cs`"* — or *"nothing finishes here; the filter comes back at stop 6"*. Never
   leave it out, and never let it drift from the ledger. **Do not stage anything yourself**;
   this line tells the reviewer what they may stage, it is not permission to run `git add`.

**Hard limits, because the failure mode here is volume, not inaccuracy:**

- **One idea per stop.** A stop containing two design choices is two stops.
- **No tables, no shell checks, no findings, no "consequences" block inline.** Each of those
  breaks the narrative, and stacking them is exactly what makes a reviewer lose the thread.
- **One code block per stop**, unless the second is three lines showing a contrast.
- **If a stop runs past roughly 40 lines of prose, split it.**

End with: *"say **next** for stop N+1 — <one plain-words line on what it holds>"*. **Then stop
and wait.** One stop per turn unless asked for more.

### Fallback: the per-unit shape (use with Step 1b only)

Head each **"Bundle N of M — <theme>"** or *"File N of M — `path`"*, with clickable links and
real sizes, then adapt these parts to what the unit deserves:

| Part | What it does |
|---|---|
| **The one thing to understand first** ⭐ | A short primer on the domain fact the change rests on, when there is one. *"Accounts and login sessions live in the same file — that is what makes this work."* Often the most valuable paragraph in the bundle |
| **What it is** | One paragraph, plain language. What this code is for |
| **How big it really is** | *"324 lines, 124 of them run."* Required opening line in comment-heavy code — never let prose inflate the apparent size |
| **The changes, numbered** ⭐ | For each: **headline the user-visible consequence**, then *what went wrong*, then *the fix*, with `file:line` links. This narrative shape is what makes a bundle readable; prefer it over "read the file in this order" |
| **Consequences to know about** | Behaviour changes that fall out of the change and were not the point of it — a precedence flip, a shortened timeout, a restore that no longer carries data. A small before/now table. **Reviewers forgive these; they do not forgive finding them later** |
| **A concrete trace** | One realistic case end to end, real values, as a table. Use the case the change exists for |
| **Check me** | 2–4 runnable checks — **each with the answer you expect**, so they can catch you being wrong. Prefer checks that would actually fail if the change were broken. If you showed a test red, say so here with the exact failure text |
| **Where you could push back on me** ⭐ | The weakest points, named by you: judgement calls, things left undone, places you were unsure, anything a reasonable reviewer would want changed. **If you did not write the code, this becomes "questions to ask the author"** |
| **Honesty markers** | Pre-existing vs introduced here · deliberately not fixed and why · verified by reading vs by running · **and which findings were caught by someone else rather than by you** |

**Attribute your misses.** If a reviewer, a test or a later pass caught something, say so
plainly — *"this was a reviewer's catch, not mine"*. It tells the reviewer where your blind
spots are, which is the most useful thing they can learn about a change.

**Name near-misses.** If following the task literally would have caused harm and you did
something else, that is a headline, not a footnote.

**Verify live rather than from memory.** Run the greps and reads while writing the section.
Claims of absence ("nothing else references this") must be checked — and say so when a check
nearly misled you.

End with: *"say **next** for bundle N+1 — <one line on what it holds>"*. **Then stop and wait.**
One unit per turn unless asked for more.

## Step 3 — when the reviewer flags something

Fix it immediately, then continue the tour:

1. Confirm what you understood them to mean, in one sentence.
2. Make the change. If it is behavioural and the repo has tests, add or update one — and if it
   is a bug fix, **make the test fail first and show the red output**.
3. Say in one line what you changed, and add it to the running findings list.
4. Resume where you left off.

**Do not silently widen scope.** If the fix is larger than it looked, or touches files outside
this review, stop and say so before editing. If they interrupt mid-fix, report exactly what is
applied and what is not.

**If the change would reverse a decision the user made earlier, do not just make it.** Put the
choice back to them with the new evidence, and say plainly that it reverses their own call.

## Step 4 — tangents

They will ask things that are not about the current unit — how a subsystem works, where some
other piece of work lives, what happens in a scenario. **Answer properly, verified against
source**, then return and restate which bundle is next. A good tangent is the review working.

If the answer is a shorthand you used earlier and the shorthand was incomplete, **say so and
correct it** rather than defending it.

## Step 5 — wrap-up

- **The findings list** — everything you held back during the journey, in engineering
  register, most serious first. This is the payoff for keeping the stops clean; do not
  shorten it
- **What the reviewer raised**, and what you did about each, in a table
- **Still open** — deliberately not addressed, and who owns it
- **What the tour did not cover** — bundles skipped, checks not run, claims resting on reading
  rather than execution
- Offer the next step: run the tests, produce a commit message, write findings into a plan

## Rules

1. **One stop per turn. Wait.** The pacing is the point.
1b. **Follow a request, not a file listing** (Step 1) unless the diff has no runtime path.
2. **Track position** — "Stop 4 of 10" in every heading, so a long review survives a break.
   Above ~8 units, offer once to write the map and findings to a scratch file so the tour can
   resume in a later session.
3. **Link everything clickable** as relative `file:line` paths.
4. **Never claim a test passes without running it.** If you cannot run the suite, say so.
5. **Do not stage or commit** unless explicitly asked. Fixes go in the working tree.
