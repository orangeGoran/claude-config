---
name: hand-review
description: Guide a human reviewer through a diff by hand, one stop at a time, pausing for their answer after each. Use when the user asks to be walked through changes, guided through a review by hand, after a plan's phases have finished, or when they say "guide me file by file" / "bundle these" / invoke /hand-review. This is a human-led guided tour, not the automated audit that /code-review performs.
argument-hint: "[optional target: nothing (working tree), a branch, a commit range, a PR number, or the plan file whose phases just finished]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, AskUserQuestion
---

Walk the user through this diff by hand: $ARGUMENTS

This is a **guided tour for a human reviewer**, not an automated audit. The user reads the code; you orient them, tell them what to check, and make it easy to disagree with you.

## Rule 0 — never invent intent you do not have

Two different situations, and conflating them is the main way this skill goes wrong:

- **You wrote the code in THIS conversation.** You know why. Explain the reasoning, and include the "where you could push back on me" section — you are defending your own work.
- **You did not** (fresh session, someone else's branch, a PR). You know only what the diff and the code say. **Do not reconstruct motives from a plausible story.** Say "the commit message says X", "this comment claims Y", or "I cannot tell why this was done". Replace "where you could push back on me" with **"questions to ask the author"**.

- **A plan file was handed to you** (its phases just ran, in this session or another). The plan is **stated intent, not established fact**: it says what someone meant to build, and the diff says what exists. Quote it as *"phase 3 of the plan asked for X"*, then check the code against it. Where they disagree, that gap is itself a finding — say which side you verified.

Never carry claims from a previous session as if they were established here. If context is missing, say so and read the code.

## Rule 1 — the register: ASD-STE100 Simplified Technical English

The most common failure is not being wrong. It is being **unreadable** — dense, jargon-stacked paragraphs that are individually accurate and collectively useless. Assume the reviewer is a capable engineer who does not know **this codebase**.

**Write all prose to the reviewer in ASD-STE100 style.** This covers the brief, every stop, the gate questions and options, tangents and the wrap-up. Code, identifiers, file paths, commands, error text and quotes from commits or plans are **technical names** — show them exactly, never simplify them.

**Words**

- **One word, one meaning.** Pick one term for a thing and keep it for the whole tour. If the brief says "snapshot", stop 7 does not say "backup".
- **Use simple, common words.** "use", not "leverage" or "utilize". "start", not "initiate". "show", not "surface". "help", not "facilitate".
- **No phrasal verbs.** "remove", not "get rid of". "continue", not "carry on". "examine", not "look into".
- **Technical names and technical verbs are permitted** — `revoke`, `deserialize`, `rebase`, repo-local names. Define a repo-local name once (Rule 2), then use it.
- **Keep the articles.** Write "the guard reads the token", not "guard reads token".
- **No noun clusters longer than three words.** "the retry limit for device sessions", not "device session retry limit value".

**Sentences**

- **Descriptive sentences: 25 words maximum. Instructions: 20 words maximum.**
- **One topic per sentence.** If a sentence has three clauses and two pieces of jargon, split it.
- **Active voice.** "The guard returns 403", not "403 is returned". Use passive voice only when the actor is unknown or not important.
- **Simple tenses only:** simple present, simple past, simple future. "The handler writes the row", not "the handler is going to be writing the row". Use the `-ing` form only in technical names.
- **Instructions use the imperative,** one action per sentence: "Open `rollback.ts`. Read line 42."
- **No contractions, no "basically", no "essentially",** no "simply", no "just".
- **Use "can" and "must", not "be able to" or "should be".**

**Paragraphs and order**

- **One topic per paragraph, six sentences maximum.**
- **Warnings come first.** If a stop holds a risk of data loss or a security gap, say it before the explanation.
- **Use a vertical list** for three or more items that have no order.
- **Use a numbered list for steps that occur in a straight line,** one action per line.
- **Use a flowchart when the steps branch or loop** — a retry, a branch on a condition, a request that can stop at a guard. Do not use a bullet list for a flow. Draw it as text in a fenced code block, so it looks the same in a terminal and in an IDE:

  ```
  ┌──────────────────────────┐
  │ GET /devices/42/wink     │
  └────────────┬─────────────┘
               ▼
  ┌──────────────────────────┐
  │ guard reads role claim   │
  └────────────┬─────────────┘
         role = viewer?
        ┌──────┴──────┐
       yes            no
        ▼             ▼
  ┌───────────┐ ┌────────────────┐
  │ 403       │ │ handler        │
  │ Forbidden │ │ flashes LED    │
  └───────────┘ └────────────────┘
  ```

  - **Top to bottom.** One step per box. Arrows (`▼`, `►`) show the order.
  - **Write the condition on the branch,** with the real value: `role = viewer?`, `retries > 3?`.
  - **Use real names and real values** in the boxes — the endpoint, the function, the status code. The text in each box follows STE.
  - **Twelve boxes maximum, 70 characters wide maximum.** If the flow is longer, draw the part this stop decides and put `…` at the two ends.
  - **Two steps or fewer:** write a sentence. A flowchart is not necessary.

**Content (these were already the rules, now in STE form)**

- **Give the result first, then the mechanism.** *"When a user saved a form with no changes, the system logged the user out."* Then explain: the database counts a rewritten row as a changed row. Do not use the opposite order.
- **Define the domain fact before you use it.** One or two sentences, then use the term.
- **Give the effect first and the precise term second.** *"The user is logged out on all devices"*, then *"the session is revoked"*. This is a description of what occurs, not a substitute story.
- **Use numbers, not adjectives.** *"The call waited 32 seconds, not 5 seconds."*, not *"a significant discrepancy"*.
- **Do not give the reviewer two new concepts in one sentence.**
- **Bold the most important sentence** in a long section. Then a fast reader still gets the point.
- If a paragraph needs two readings, write it again. Test before you send: *can an engineer who does not know this repo understand this in one reading?*

**When the reviewer says they do not understand: do not add detail.** Stop. Discard the explanation. Explain again from the start, with fewer and simpler words, and with stricter STE. More detail makes the problem worse.

Do not lecture. They lack context, not ability. Skip language basics unless the construct is genuinely load-bearing.

## Rule 2 — concrete before abstract; the hard version is on request

**Every stop opens on something concrete from this system: one real request, with real values, moving through the real code in the order it happens.** That opening is not a summary and not optional. It is how the reviewer gets their footing before the abstraction arrives.

**Concrete does not mean invented.** No car shop, no doorman, no bakery queue, no luggage tags. The reviewer is an engineer; a made-up setting gives them a second world to learn and then map back onto the code, and the mapping is where they get lost. Name the real mechanism instead: *"A `GET /devices/42/wink` request arrives with a viewer token. The guard reads the role claim and finds `viewer`. It returns 403 before the handler starts."*, not *"a doorman checks the guest list"*.

**Do not then repeat the same point in senior register.** Saying everything twice doubles every message, and the reviewer gets lost faster, not slower. More words is the wrong fix for confusion.

So:

- **Inline:** the concrete case first, then the general rule it illustrates, *inside the same explanation*. One pass, one rising altitude — never two copies of one idea.
- **On request:** when the reviewer says **"senior version"**, **"harder"**, or asks how they would have written it themselves, give that same point again in full engineering register — real types, the mechanism, `file:line`, the trade-off that was made. This is the comparison they learn from, and it lands when they asked for it rather than when you decided they needed it.
- **At the wrap-up:** the findings list is written in engineering register by default, and still in STE. By then they have the whole story and want precision.
- **Engineering register changes the depth, not the language rules.** The senior version and the findings list still follow STE (Rule 1).

### Rules for the opening

- **The concrete example is mandatory.** An abstraction restated in short words is still an abstraction. Use a real entry point, real input values, and say what comes out the other end.
- **Name the real thing rather than a stand-in for it.** If a reverse proxy checks a role, say *"nginx rejects the request before it reaches the app"*. Comparing to a piece of technology the reviewer already knows — an nginx rule, a database index, a retry with backoff, a work queue — is fine in one clause when the mechanism here is genuinely unusual. Comparing to a shop, a person, a household object or any invented setting is not.
- **Define repo-local terms; do not replace them.** One sentence on what the thing is here, then use its real name from then on: *"a `DeviceClaim` is the row tying a device to the account that owns it."* Inventing a friendlier word for it just adds a second name to track.
- **Assume programming, not this codebase.** Skip explanations of language constructs and standard patterns. Do explain internal acronyms, layer names and repo shorthand — those carry no meaning outside this repo.
- **Never write "basically" or "essentially".** Say the thing instead.
- **It has to be true.** Trace a path you have verified against the code, with values the code would really produce. A tidy example the code does not actually do is worse than no example.

## Rule 3 — the stop gate (this is what makes the pacing hold)

Prose pacing does not hold. "Say **next**" is a request the reviewer can ignore and, worse, one *you* can ignore — running three stops together is the most common way this skill fails. The reliable version is a tool call.

**End every stop, every bundle, the journey plan and the wrap-up with `AskUserQuestion`.** The turn cannot continue until the reviewer answers, so a stop physically cannot run into the next.

The first option is always the next stop, named in plain words — never "Next" alone:

- **`Next — stop 4: is the delete path safe?`** — the teaser (in STE, Rule 1) names what the next stop **decides**, not where it sits, so the reviewer arrives already knowing what to judge
- **`Simpler`** — throw the explanation away and re-tell it from the top in fewer words (Rule 1)
- **`Senior version`** — the same point in full engineering register (Rule 2)
- **`I found a problem`** — go to Step 3
- **`Wrap up`** — jump to Step 5

Pick the first plus the two or three that fit *this* stop; four is the maximum. The harness adds **Other** on its own, which is where "terser", "skip to 7", "bundle the rest" and any real question arrive — treat free text as the answer and follow it, not the options you offered.

- **One gate per turn.** Never ask, answer yourself, and carry on.
- **Never gate a question you should just answer.** A tangent (Step 4) gets a real answer first, then the gate returns, re-stating where the tour is.
- **Fixes gate too.** Before editing anything in Step 3, confirm the change through the gate — it is the last cheap moment to catch a misunderstanding.
- If `AskUserQuestion` is unavailable, fall back to *"say **next** for stop N+1"* and say once that pacing is now on the honour system.

## Step 0 — the brief (one message, then the tour)

**The reviewer did not watch this work happen.** They do not know what problem was in front of the author, what was tried, or what is supposed to be different afterwards. Closing that gap is the job of the first message.

So the first message is a brief, not a scoping report. **The reviewer must be able to scan it.** Long paragraphs one after another look like a wall of text, even when each sentence is clear. Give the brief this shape:

- **A short heading for each part**, on its own line: `### The problem`, `### What changed`, `### Before and after`, `### The tour`.
- **The first line under each heading is the main point, in bold.** A reader who reads only the bold lines still gets the brief.
- **Paragraphs of three sentences maximum.** Put a blank line between parts.
- **A vertical list for parallel items**: the changes, the defects, the new endpoints.
- **A table for before and after**, and **a table for the stop list**.

The four parts, in this order:

1. **The problem.** What was broken, missing or painful before this change. A bold main point, then one concrete instance in two or three sentences. A second, smaller defect is a separate bullet, not a sentence added to the same paragraph.
2. **What changed.** One bullet for each change, one sentence each. Then the one decision that most shaped the change, and what it was chosen over, in one or two sentences.
3. **Before and after.** A table with one row for each thing that a user, operator or caller can see. If something that they expect to change deliberately did not change, put it in the table too. This is the cheapest place to prevent a misunderstanding that would otherwise appear at stop 6.
4. **The tour.** One sentence on the request that the tour follows. Then the stop table from Step 1. Then one line: every stop ends with a question, the first option goes to the next stop, **Other** takes anything ("terser", "skip to 8", a question), and all findings come as one list at the end.

Example of the shape, shortened:

```markdown
### The problem

**A superadmin could not see why an AI question failed.**

The list on `/admin/brain` showed only the question, its status and its owner id. A question
that failed after 41 seconds gave no step, no AI call and no model response.

- Second defect: when the retry of an invalid JSON response also failed, the AI log kept one
  row. The first attempt and its tokens were lost.

### What changed

- The Brain worker writes a **run record** on each question row: step times, AI log ids, the
  failed step and the search hits.
- Three new columns hold the outcome, so the list can filter without JSON queries.
- A thrown AI error carries its failed attempts, and the tracker logs them.

**The main decision:** the run record is on the question row, not read back from the AI log.
The AI log deletes its content after 90 days.

### Before and after

| | Before | After |
|---|---|---|
| Question list | Question, status, owner id; one tenant | Asker, tenant, outcome, latency; all tenants; filter and sort |
| Question detail | No steps | Each step with timing, model, tokens and error |
| Old questions | — | Empty trace, not rebuilt from old data |

### The tour

The tour follows one question: the answerer step fails, then a superadmin opens the list, the
detail and the stats.

| # | What happens | You judge |
|---|---|---|
| 1 | The answerer AI call fails, and the error keeps the failed attempt | **Is it safe to attach data to an error object?** |
| 2 | The tracker logs the attempt row and the final row | Skim: follows from stop 1 |
| … | … | … |
```

**What does not go in this message:** file counts, line counts, comment-to-code ratios, language inventories, a bridge-language announcement, a coverage ledger, a commit plan, or a recap of how you resolved the target. None of it tells the reviewer what the change is for, and it is what makes the opening unreadable. Scope only earns a sentence when the answer is genuinely surprising — someone else's in-flight work sitting in the same tree, a submodule left out — and then it is one clause, not a section.

**When you do not know the intent** (Rule 0 — fresh session, someone else's branch), the brief is still required. Build it from the code and label the source: *"the commit message says X; I found no ticket; from reading the diff, what actually changes is Y."* A brief derived from the diff and marked as such is exactly what the reviewer cannot produce for themselves. Never skip it and never invent the motive.

**Resolve the target quietly.** No argument → uncommitted working tree (staged + unstaged + untracked). Otherwise the branch, commit range, or PR number given. Clean tree and no argument → diff the branch against its base. **A plan file** — the usual case when a plan's phases have just finished — is read for intent and feeds parts 1 and 2 of the brief as *stated* intent (Rule 0); review the diff those phases produced, the working tree if dirty, otherwise the commits back to the plan's base. **Do not let the phase order replace execution order.**

**Calibrations you make but do not announce:** the languages in the diff; whether a construct needs bridging into **Node.js / TypeScript / NestJS** (bridge only where one is genuinely load-bearing, never for its own sake); and the comment-to-code ratio, which matters only if the diff would otherwise look far bigger than the code it contains — then it is one clause at the stop where the size misleads, not an opening statistic.

## Step 1 — the journey (the default flow)

**Follow one request end to end, in the order the code actually runs.** Not file by file, not bundle by bundle. A file-ordered tour is a parts list, and nobody learns a machine from a parts list — they learn it by watching it run once.

1. **Pick one real thing a person does**, and name it the way that person would: *"A user clicks Wink. This button flashes the LED, so the user can identify the device."* Prefer the action the change exists for. Verify the endpoint or handler is real, and link it.
2. **List the stops** — 6 to 12, in execution order, as the table in Step 0: number, what happens, and what the reviewer judges (bold for a decision, "Skim" for mechanical stops). The "what happens" cell says *what happens there*, in the reviewer's terms, carrying over from the brief — *"The rollback selects the snapshot to restore. It rejects three cases that restore the wrong snapshot without an error."* Never a filename, and never a label so short it only makes sense to someone who already read the code (*"the guard"*, *"version selection"*). 2a. **Merge before you publish the list.** Read the neighbours: if a reviewer could not form an opinion on one without the next — the write and the checks that guard it, the parse and the validation of what it parsed — make them one stop now. A stop list built from mechanisms produces halves; a stop list built from judgements produces stops that can be answered. 2b. **Say which stops carry the judgement calls** and which are mechanical — *"3 and 5 are the decisions; 8 to 10 are tests and docs, skim them"*. Naming what to skim is what makes a ten-stop tour get finished.
3. **Say what is deferred.** No criticisms, no shell checks, no findings along the way. They all arrive as one list at the final stop. Say this up front so the reviewer stops bracing for it.
4. **Name the one pretend thing, once.** If the story needs something not yet true — an annotation a later stage adds, a flag that ships off — say so plainly at the stop where it first matters, then carry on. Never let the narrative quietly assume it.
5. **Gate the plan itself** (Rule 3) before stop 1 — offer *start the tour*, *skip to a stop*, *bundle it tighter*. This is where a reviewer redirects a tour that is aimed wrong, and it is much cheaper here than at stop 5.
6. **Keep the coverage ledger to yourself until it is asked for or earned.** Track which files are finished after each stop — a journey revisits files, and the reviewer loses track of when one is done — but do not open the review with the table. The per-stop *"done after this stop"* line carries it, and the full table belongs at the wrap-up or on request.
7. **Commits are a wrap-up topic, not an opening one.** Note whether the repo's own rules force a split, and propose the actual messages at the end.

**Every file appears at the moment the request first touches it, and never before.** Files the request never reaches — tests, fixtures, lock files, pipeline — get their own stops at the end, once the journey is complete.

### When there is no single request to follow

Some diffs have no runtime path: a docs change, a dependency bump, a pure refactor, a CI change. Then use the themed-bundle map in **Step 1b**. Say in one line why the journey does not apply rather than forcing a fake one.

## Step 1b — the map (fallback: when there is no request to follow)

**The Step 0 brief still comes first** — a docs change or a dependency bump still had a reason, and the reviewer still cannot see it. Only then show the shape as a table: number, unit, real size, and a few words on **why it is in that position**.

**Order by narrative, never alphabetically or by path.** Usually: the heart of the change → deleted files → contracts → wiring/config → callers → tests → housekeeping.

### Bundling — the default above ~10 files

Group files into **themed units of 1–6 files** and number the units, not the files. Bundle by *subject*, not by directory: the thing being changed, plus the interface it moves through, plus its test. Say why each bundle is a bundle.

**Then tell them which bundles actually matter.** Something like: *"Bundles 2, 3 and 5 are where every judgement call lives — about 45 minutes. Skip 7 outright. Skim 8 by test name."* Naming what to skip is as valuable as naming what to read, and it is what makes a 40-file review happen at all.

Then start unit 1, in the per-unit shape at the end of Step 2. Do not dump several at once.

## Step 2 — per stop

Head each one `## Stop N of M — <plain-words title>`. **A stop must be easy to scan, like the brief (Step 0).** Paragraphs one after another look like a wall of text, even when each sentence is clear. Give every stop this shape, and nothing else:

1. **Context: one sentence of plain prose.** It connects to the previous stop with the real value that the request carries into this one. At stop 1, it connects to the problem from the brief. State the fact again in a few words. Do not point to "the brief" or "stop 3" alone.
2. **The decision, in a blockquote:** `> **You decide:** <the question>`. One question, or two that cannot be judged apart. Say where it can go wrong.
3. **`### What happens`** — the concrete trace of Rule 2: the real call, the real values, what comes back. Write it as a numbered list, one action per line, three to six lines. Use a flowchart (Rule 1) instead when the flow branches or loops.
4. **The lines that actually run**, directly under the trace. A handful — 3 to 10. Not the file. If the file is 200 lines and 6 of them execute on this path, show the 6 and say so. **Put a clickable link to the first shown line directly above the code block** — the reviewer should jump to the code in one click, not search for it. Code blocks are not clickable, so the link must be outside the block. Use the host's link form: in an IDE extension a markdown link with a line anchor, `[rollback.ts:42](src/rollback.ts#L42)` (a range as `#L42-L51`); in a plain terminal, `src/rollback.ts:42`. If the lines come from two places, one link above each snippet.
5. **`### Why it is built this way`** — three or four bullets, one or two sentences each. **Each bullet starts with a bold phrase that states the point**, not a category name: *"**Hidden from logs.**"*, not *"**Visibility:**"*. Cover the design choice, the obvious alternative and why it is worse, and any weak point that the change accepts.
6. **`### Done after this stop`** — the files now fully covered, as a ready-to-copy staging command for exactly those files, paths relative to the repo root. **One file per line**, each line but the last ending in ` \`, so it reads as a list but still pastes as one command — even for a single file, keep `git add --` on its own line:

   ```bash
   git add -- \
     src/rollback.ts \
     src/snapshot.ts
   ```

   When no file finishes here, write only **"None."** under the heading. Do not explain when the file comes back or at which stop; the reviewer only needs to know there is nothing to stage yet. Never leave the part out, and never let it drift from the ledger. **Do not run the command yourself**; it is for the reviewer to copy, not permission to stage.

**Headings, not labels.** A heading on its own line shows where a part starts, so the eye can jump to it. A label glued to the front of a sentence ("Where we came from: the brief.") makes the reader stop and decode it. Use only the headings above, and never start a sentence with a label.

Example of the shape, shortened:

```markdown
## Stop 1 of 5 — the failed AI call keeps its first attempt

When a JSON call fails twice, the AI log writes one row and loses the first attempt.

> **You decide:** is it safe to carry the attempt data on the error object? Can a caller lose
> that data without any sign?

### What happens

1. Brain calls `executeWithJsonOutput` for the answerer.
2. The first response fails the schema check. The service sends a corrective retry.
3. The second response also fails. The service attaches `{ failedAttempts, lastResponse }` to
   the error and throws `CodedBadRequestException(AiOutputInvalid)`.
4. The tracker reads the data in its `finally` block. It writes the final row with
   `attempt_number = 2` and one linked row for the first attempt.

[ai-thrown-attempt-data.ts:36](src/domains/ai/application/services/ai-thrown-attempt-data.ts#L36)
(the code block)

### Why it is built this way

- **Hidden from logs.** The key is a module-private `Symbol` and the property is not
  enumerable, so `JSON.stringify` and the exception filter do not show the data.
- **Existing handlers still match.** The class, `code` and `message` stay the same. A new
  subclass would break the processors that test `instanceof CodedBadRequestException`.
- **Accepted weak point.** A function that catches the error and throws a different one loses
  the data, and nothing reports the loss.

### Done after this stop

(the git add command)
```

**Hard limits, because the failure mode here is volume, not inaccuracy:**

- **One judgement per stop — and everything that judgement needs.** The unit is the decision the reviewer has to form an opinion on, not the individual mechanism. If two mechanical steps cannot be judged apart — where a file may be written, and the checks that stop it being written wrong — they are **one stop**, even though that stop is longer. Splitting them puts a confirmation between two halves of one thought and asks for an opinion the reviewer cannot form yet. A stop holding two *independent* decisions is still two stops.
- **No tables, no shell checks, no findings, no "consequences" block inside a stop.** Each of those breaks the narrative, and stacking them is exactly what makes a reviewer lose the thread.
- **One code block per stop**, unless the second is three lines showing a contrast. A flowchart (Rule 1) does not count against this limit, but a stop gets one flowchart at most.
- **If a stop runs past roughly 40 lines of prose, split it** — but only where the reviewer could genuinely judge the first half on its own. If there is no such seam, keep it whole and trim the prose instead.

End with the gate (Rule 3), its first option naming stop N+1 in plain words. **The tool call is the last thing in the turn** — no trailing prose after it, and never more than one stop per turn.

### Fallback: the per-unit shape (use with Step 1b only)

Head each **"Bundle N of M — <theme>"** or *"File N of M — `path`"*, with clickable links and real sizes. **The context sentence and the `You decide` blockquote of Step 2 apply here too.** Then adapt these parts to what the unit deserves:

| Part | What it does |
|---|---|
| **The one thing to understand first** ⭐ | A short primer on the domain fact the change rests on, when there is one. *"Accounts and login sessions are in the same file. This change depends on that fact."* Often the most valuable paragraph in the bundle |
| **What it is** | One paragraph, plain language. What this code is for |
| **How big it really is** | *"324 lines, 124 of them run."* Only when the raw diff size would mislead — never as a routine opening statistic |
| **The changes, numbered** ⭐ | For each: **headline the user-visible consequence**, then *what went wrong*, then *the fix*, with `file:line` links. This narrative shape is what makes a bundle readable; prefer it over "read the file in this order" |
| **Consequences to know about** | Behaviour changes that fall out of the change and were not the point of it — a precedence flip, a shortened timeout, a restore that no longer carries data. A small before/now table. **Reviewers forgive these; they do not forgive finding them later** |
| **A concrete trace** | One realistic case end to end, real values, as a table. Use the case the change exists for |
| **Check me** | 2–4 runnable checks — **each with the answer you expect**, so they can catch you being wrong. Prefer checks that would actually fail if the change were broken. If you showed a test red, say so here with the exact failure text |
| **Where you could push back on me** ⭐ | The weakest points, named by you: judgement calls, things left undone, places you were unsure, anything a reasonable reviewer would want changed. **If you did not write the code, this becomes "questions to ask the author"** |
| **Honesty markers** | Pre-existing vs introduced here · deliberately not fixed and why · verified by reading vs by running · **and which findings were caught by someone else rather than by you** |

**Attribute your misses.** If a reviewer, a test or a later pass caught something, say so plainly — *"A reviewer found this. I did not."*. It tells the reviewer where your blind spots are, which is the most useful thing they can learn about a change.

**Name near-misses.** If following the task literally would have caused harm and you did something else, that is a headline, not a footnote.

**Verify live rather than from memory.** Run the greps and reads while writing the section. Claims of absence ("nothing else references this") must be checked — and say so when a check nearly misled you.

End with the gate (Rule 3), its first option naming bundle N+1 in plain words. One unit per turn, and the tool call is the last thing in the turn.

## Step 3 — when the reviewer flags something

Fix it immediately, then continue the tour:

1. Confirm what you understood them to mean, in one sentence — **through the gate** (Rule 3), offering *that is it, fix it* / *not quite, here is what I meant* / *note it, do not fix now*.
2. Make the change. If it is behavioural and the repo has tests, add or update one — and if it is a bug fix, **make the test fail first and show the red output**.
3. Say in one line what you changed, and add it to the running findings list.
4. Resume where you left off.

**Do not silently widen scope.** If the fix is larger than it looked, or touches files outside this review, stop and say so before editing. If they interrupt mid-fix, report exactly what is applied and what is not.

**If the change would reverse a decision the user made earlier, do not just make it.** Put the choice back to them with the new evidence, and say plainly that it reverses their own call.

## Step 4 — tangents

They will ask things that are not about the current unit — how a subsystem works, where some other piece of work lives, what happens in a scenario. **Answer properly, verified against source**, then return and restate which bundle is next. A good tangent is the review working.

If the answer is a shorthand you used earlier and the shorthand was incomplete, **say so and correct it** rather than defending it.

## Step 5 — wrap-up

- **The findings list** — everything you held back during the journey, in engineering register and still in STE (Rule 1), most serious first. This is the payoff for keeping the stops clean; do not shorten it
- **What the reviewer raised**, and what you did about each, in a table
- **Still open** — deliberately not addressed, and who owns it
- **What the tour did not cover** — bundles skipped, checks not run, claims resting on reading rather than execution
- **The coverage ledger**, if it was not asked for earlier — stop against the files finished after it, so the reviewer can stage with confidence. Here it is a checklist; at the opening it was noise. Follow it with one `git add -- …` command covering every file the tour finished (or one per commit, when it splits into several), one file per line as in Step 2, part 6
- **How it splits into commits**, if the repo's rules or the file count mean it cannot be one, with the actual messages
- Offer the next step **through the gate**: run the tests, produce a commit message, write the findings into a plan, or go back to a stop that is still unsettled

## Rules

1. **One stop per turn, ended by an `AskUserQuestion` gate** (Rule 3). The pacing is the point, and the tool call is what makes it hold. 1b. **Follow a request, not a file listing** (Step 1) unless the diff has no runtime path. 1c. **Open with the brief, not with scope mechanics** (Step 0). No file counts, line counts, comment ratios, language lists, ledgers or commit plans in the first message.
2. **Track position** — "Stop 4 of 10" in every heading, so a long review survives a break. Above ~8 units, offer once to write the map and findings to a scratch file so the tour can resume in a later session.
3. **Link everything clickable** as relative paths in the host's link form (Step 2, part 2) — a markdown link with a `#L` anchor in an IDE, `file:line` in a plain terminal.
4. **Never claim a test passes without running it.** If you cannot run the suite, say so.
5. **Do not stage or commit** unless explicitly asked. Fixes go in the working tree.
