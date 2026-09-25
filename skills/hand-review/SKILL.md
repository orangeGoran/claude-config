---
name: hand-review
description: Guide a human reviewer through a diff by hand, one stop at a time, pausing for their answer after each. Use when the user asks to be walked through changes, guided through a review by hand, after a plan's phases have finished, or when they say "guide me file by file" / "bundle these" / invoke /hand-review. This is a human-led guided tour, not the automated audit that /code-review performs.
argument-hint: "[optional target: nothing (working tree), a branch, a commit range, a PR number, or the plan file whose phases just finished]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, AskUserQuestion
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

- **A plan file was handed to you** (its phases just ran, in this session or another). The plan
  is **stated intent, not established fact**: it says what someone meant to build, and the diff
  says what exists. Quote it as *"phase 3 of the plan asked for X"*, then check the code against
  it. Where they disagree, that gap is itself a finding — say which side you verified.

Never carry claims from a previous session as if they were established here. If context is
missing, say so and read the code.

## Rule 1 — the register

The most common failure is not being wrong. It is being **unreadable** — dense, jargon-stacked
paragraphs that are individually accurate and collectively useless. Assume the reviewer is a
capable engineer who does not know **this codebase**.

- **Headline the consequence, not the mechanism.** *"Saving a form with nothing changed logged
  people out"* — then explain that the database counts a rewritten row as affected. Never the
  other way round.
- **Short sentences, one idea each.** If a sentence has three clauses and two pieces of jargon,
  split it.
- **Define the domain fact before you lean on it.** One or two sentences, then use the term.
- **Effect on first use, precise term second.** *"they get logged out on every device"*
  before *"the session is revoked"*. This is a plain description of what happens, not a
  substitute story.
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

## Rule 2 — concrete before abstract; the hard version is on request

**Every stop opens on something concrete from this system: one real request, with real values,
moving through the real code in the order it happens.** That opening is not a summary and not
optional. It is how the reviewer gets their footing before the abstraction arrives.

**Concrete does not mean invented.** No car shop, no doorman, no bakery queue, no luggage tags.
The reviewer is an engineer; a made-up setting gives them a second world to learn and then map
back onto the code, and the mapping is where they get lost. Name the real mechanism instead:
*"a `GET /devices/42/wink` comes in with a viewer's token — the guard reads the role claim,
sees `viewer`, and returns 403 before the handler runs"*, not *"a doorman checks the guest
list"*.

**Do not then repeat the same point in senior register.** Saying everything twice doubles every
message, and the reviewer gets lost faster, not slower. More words is the wrong fix for
confusion.

So:

- **Inline:** the concrete case first, then the general rule it illustrates, *inside the same
  explanation*. One pass, one rising altitude — never two copies of one idea.
- **On request:** when the reviewer says **"senior version"**, **"harder"**, or asks how they
  would have written it themselves, give that same point again in full engineering register —
  real types, the mechanism, `file:line`, the trade-off that was made. This is the comparison
  they learn from, and it lands when they asked for it rather than when you decided they needed it.
- **At the wrap-up:** the findings list is written in engineering register by default. By then
  they have the whole story and want precision.

### Rules for the opening

- **The concrete example is mandatory.** An abstraction restated in short words is still an
  abstraction. Use a real entry point, real input values, and say what comes out the other end.
- **Name the real thing rather than a stand-in for it.** If a reverse proxy checks a role, say
  *"nginx rejects the request before it reaches the app"*. Comparing to a piece of technology
  the reviewer already knows — an nginx rule, a database index, a retry with backoff, a
  work queue — is fine in one clause when the mechanism here is genuinely unusual. Comparing to
  a shop, a person, a household object or any invented setting is not.
- **Define repo-local terms; do not replace them.** One sentence on what the thing is here, then
  use its real name from then on: *"a `DeviceClaim` is the row tying a device to the account
  that owns it."* Inventing a friendlier word for it just adds a second name to track.
- **Assume programming, not this codebase.** Skip explanations of language constructs and
  standard patterns. Do explain internal acronyms, layer names and repo shorthand — those carry
  no meaning outside this repo.
- **Never write "basically" or "essentially".** Say the thing instead.
- **It has to be true.** Trace a path you have verified against the code, with values the code
  would really produce. A tidy example the code does not actually do is worse than no example.

## Rule 3 — the stop gate (this is what makes the pacing hold)

Prose pacing does not hold. "Say **next**" is a request the reviewer can ignore and, worse, one
*you* can ignore — running three stops together is the most common way this skill fails. The
reliable version is a tool call.

**End every stop, every bundle, the journey plan and the wrap-up with `AskUserQuestion`.** The
turn cannot continue until the reviewer answers, so a stop physically cannot run into the next.

The first option is always the next stop, named in plain words — never "Next" alone:

- **`Next — stop 4: is the delete path safe?`** — the teaser names what the next stop
  **decides**, not where it sits, so the reviewer arrives already knowing what to judge
- **`Simpler`** — throw the explanation away and re-tell it from the top in fewer words (Rule 1)
- **`Senior version`** — the same point in full engineering register (Rule 2)
- **`I found a problem`** — go to Step 3
- **`Wrap up`** — jump to Step 5

Pick the first plus the two or three that fit *this* stop; four is the maximum. The harness adds
**Other** on its own, which is where "terser", "skip to 7", "bundle the rest" and any real
question arrive — treat free text as the answer and follow it, not the options you offered.

- **One gate per turn.** Never ask, answer yourself, and carry on.
- **Never gate a question you should just answer.** A tangent (Step 4) gets a real answer first,
  then the gate returns, re-stating where the tour is.
- **Fixes gate too.** Before editing anything in Step 3, confirm the change through the gate —
  it is the last cheap moment to catch a misunderstanding.
- If `AskUserQuestion` is unavailable, fall back to *"say **next** for stop N+1"* and say once
  that pacing is now on the honour system.

## Step 0 — the brief (one message, then the tour)

**The reviewer did not watch this work happen.** They do not know what problem was in front of
the author, what was tried, or what is supposed to be different afterwards. Closing that gap is
the job of the first message.

So the first message is a brief, not a scoping report. Four short parts, in this order:

1. **The problem.** What was broken, missing or painful before this change — two to four
   sentences, with one concrete instance. *"A rolled-back device kept the database from the
   failed version, so the operator had to copy the old file back by hand and usually forgot."*
2. **What was done about it.** The shape of the solution in two to four sentences, plus the one
   decision that most shaped it and what it was chosen over.
3. **What is different when this ships.** Before → after, stated as something observable: what
   an operator, caller or user now sees that they did not before. If something they would expect
   to change deliberately did not, say that here — it is the cheapest place to prevent a
   misunderstanding that would otherwise surface at stop 6.
4. **How the review will go.** Two or three lines: the request the tour follows, how many stops,
   that every stop ends in a question whose first option is the next stop, that **Other** takes
   anything ("terser", "skip to 8", a question of your own), and that findings are held to one
   list at the end.

**What does not go in this message:** file counts, line counts, comment-to-code ratios, language
inventories, a bridge-language announcement, a coverage ledger, a commit plan, or a recap of how
you resolved the target. None of it tells the reviewer what the change is for, and it is what
makes the opening unreadable. Scope only earns a sentence when the answer is genuinely
surprising — someone else's in-flight work sitting in the same tree, a submodule left out — and
then it is one clause, not a section.

**When you do not know the intent** (Rule 0 — fresh session, someone else's branch), the brief
is still required. Build it from the code and label the source: *"the commit message says X; I
found no ticket; from reading the diff, what actually changes is Y."* A brief derived from the
diff and marked as such is exactly what the reviewer cannot produce for themselves. Never
skip it and never invent the motive.

**Resolve the target quietly.** No argument → uncommitted working tree (staged + unstaged +
untracked). Otherwise the branch, commit range, or PR number given. Clean tree and no argument →
diff the branch against its base. **A plan file** — the usual case when a plan's phases have
just finished — is read for intent and feeds parts 1 and 2 of the brief as *stated* intent
(Rule 0); review the diff those phases produced, the working tree if dirty, otherwise the
commits back to the plan's base. **Do not let the phase order replace execution order.**

**Calibrations you make but do not announce:** the languages in the diff; whether a construct
needs bridging into **Node.js / TypeScript / NestJS** (bridge only where one is genuinely
load-bearing, never for its own sake); and the comment-to-code ratio, which matters only if the
diff would otherwise look far bigger than the code it contains — then it is one clause at the
stop where the size misleads, not an opening statistic.

## Step 1 — the journey (the default flow)

**Follow one request end to end, in the order the code actually runs.** Not file by file, not
bundle by bundle. A file-ordered tour is a parts list, and nobody learns a machine from a parts
list — they learn it by watching it run once.

1. **Pick one real thing a person does**, and name it the way that person would: *"someone
   clicks Wink — the button that flashes the LED so you can tell which device you are looking
   at."* Prefer the action the change exists for. Verify the endpoint or handler is real, and
   link it.
2. **List the stops** — 6 to 12, one line each, in execution order. Each line says *what
   happens there*, in the reviewer's terms, carrying over from the brief — *"the rollback picks
   which snapshot to restore, and refuses three cases that would silently restore the wrong
   one"*. Never a filename, and never a label so short it only makes sense to someone who
   already read the code (*"the guard"*, *"version selection"*).
2a. **Merge before you publish the list.** Read the neighbours: if a reviewer could not form an
   opinion on one without the next — the write and the checks that guard it, the parse and the
   validation of what it parsed — make them one stop now. A stop list built from mechanisms
   produces halves; a stop list built from judgements produces stops that can be answered.
2b. **Say which stops carry the judgement calls** and which are mechanical — *"3 and 5 are the
   decisions; 8 to 10 are tests and docs, skim them"*. Naming what to skim is what makes a
   ten-stop tour get finished.
3. **Say what is deferred.** No criticisms, no shell checks, no findings along the way. They all
   arrive as one list at the final stop. Say this up front so the reviewer stops bracing for it.
4. **Name the one pretend thing, once.** If the story needs something not yet true — an
   annotation a later stage adds, a flag that ships off — say so plainly at the stop where it
   first matters, then carry on. Never let the narrative quietly assume it.
5. **Gate the plan itself** (Rule 3) before stop 1 — offer *start the tour*, *skip to a stop*,
   *bundle it tighter*. This is where a reviewer redirects a tour that is aimed wrong, and it
   is much cheaper here than at stop 5.
6. **Keep the coverage ledger to yourself until it is asked for or earned.** Track which files
   are finished after each stop — a journey revisits files, and the reviewer loses track of when
   one is done — but do not open the review with the table. The per-stop *"done after this
   stop"* line carries it, and the full table belongs at the wrap-up or on request.
7. **Commits are a wrap-up topic, not an opening one.** Note whether the repo's own rules force
   a split, and propose the actual messages at the end.

**Every file appears at the moment the request first touches it, and never before.** Files the
request never reaches — tests, fixtures, lock files, pipeline — get their own stops at the end,
once the journey is complete.

### When there is no single request to follow

Some diffs have no runtime path: a docs change, a dependency bump, a pure refactor, a CI change.
Then use the themed-bundle map in **Step 1b**. Say in one line why the journey does not apply
rather than forcing a fake one.

## Step 1b — the map (fallback: when there is no request to follow)

**The Step 0 brief still comes first** — a docs change or a dependency bump still had a reason,
and the reviewer still cannot see it. Only then show the shape as a table: number, unit, real
size, and a few words on **why it is in that position**.

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

Head each one **"Stop N of M — <plain-words title>"**. **Then two lines of handrail before any
mechanism** — landing straight in *what happens* is a cold start, and the reviewer spends the
first half of the stop working out why they are here:

- **Where we came from.** One sentence naming what the previous stop established and **what is
  carried into this one**, as a real value where there is one. *"Stop 3 left us holding the
  string `iriis.db`, read from the device's own config."* At stop 1 this line instead connects
  back to the brief.
- **What this stop decides.** One **bold** sentence: the judgement made here and where it could
  go wrong. *"This stop turns that name into an absolute path — and it is where a broken config
  could aim the delete outside the backup folder."* Not a summary of the code; the reason the
  stop exists.

Two lines, never more. If the recap needs a paragraph, the previous stop did not land and the
fix is to re-tell that one, not to prefix this one.

Then these parts, in this order, and nothing else:

1. **What happens.** Three to six short sentences. What the request is doing here, opening on
   the concrete trace of Rule 2 — real call, real values, what comes back.
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

- **One judgement per stop — and everything that judgement needs.** The unit is the decision
  the reviewer has to form an opinion on, not the individual mechanism. If two mechanical steps
  cannot be judged apart — where a file may be written, and the checks that stop it being
  written wrong — they are **one stop**, even though that stop is longer. Splitting them puts a
  confirmation between two halves of one thought and asks for an opinion the reviewer cannot
  form yet. A stop holding two *independent* decisions is still two stops.
- **No tables, no shell checks, no findings, no "consequences" block inline.** Each of those
  breaks the narrative, and stacking them is exactly what makes a reviewer lose the thread.
- **One code block per stop**, unless the second is three lines showing a contrast.
- **If a stop runs past roughly 40 lines of prose, split it** — but only where the reviewer
  could genuinely judge the first half on its own. If there is no such seam, keep it whole and
  trim the prose instead.

End with the gate (Rule 3), its first option naming stop N+1 in plain words. **The tool call is
the last thing in the turn** — no trailing prose after it, and never more than one stop per turn.

### Fallback: the per-unit shape (use with Step 1b only)

Head each **"Bundle N of M — <theme>"** or *"File N of M — `path`"*, with clickable links and
real sizes. **The two-line handrail of Step 2 applies here too** — where we came from, and what
this bundle decides — then adapt these parts to what the unit deserves:

| Part | What it does |
|---|---|
| **The one thing to understand first** ⭐ | A short primer on the domain fact the change rests on, when there is one. *"Accounts and login sessions live in the same file — that is what makes this work."* Often the most valuable paragraph in the bundle |
| **What it is** | One paragraph, plain language. What this code is for |
| **How big it really is** | *"324 lines, 124 of them run."* Only when the raw diff size would mislead — never as a routine opening statistic |
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

End with the gate (Rule 3), its first option naming bundle N+1 in plain words. One unit per
turn, and the tool call is the last thing in the turn.

## Step 3 — when the reviewer flags something

Fix it immediately, then continue the tour:

1. Confirm what you understood them to mean, in one sentence — **through the gate** (Rule 3),
   offering *that is it, fix it* / *not quite, here is what I meant* / *note it, do not fix now*.
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
- **The coverage ledger**, if it was not asked for earlier — stop against the files finished
  after it, so the reviewer can stage with confidence. Here it is a checklist; at the opening it
  was noise
- **How it splits into commits**, if the repo's rules or the file count mean it cannot be one,
  with the actual messages
- Offer the next step **through the gate**: run the tests, produce a commit message, write the
  findings into a plan, or go back to a stop that is still unsettled

## Rules

1. **One stop per turn, ended by an `AskUserQuestion` gate** (Rule 3). The pacing is the point,
   and the tool call is what makes it hold.
1b. **Follow a request, not a file listing** (Step 1) unless the diff has no runtime path.
1c. **Open with the brief, not with scope mechanics** (Step 0). No file counts, line counts,
   comment ratios, language lists, ledgers or commit plans in the first message.
2. **Track position** — "Stop 4 of 10" in every heading, so a long review survives a break.
   Above ~8 units, offer once to write the map and findings to a scratch file so the tour can
   resume in a later session.
3. **Link everything clickable** as relative `file:line` paths.
4. **Never claim a test passes without running it.** If you cannot run the suite, say so.
5. **Do not stage or commit** unless explicitly asked. Fixes go in the working tree.
