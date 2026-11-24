---
name: staging-review
description: After a release to the @@STAGING_BRANCH@@ branch, move each ticket in "@@BOARD_STATUS@@" whose PRs (this repo and other repos) are all on @@STAGING_BRANCH@@ to "@@BOARD_REVIEW_STATUS@@", with one comment that names the staging versions. Tickets with a PR that is open or not on @@STAGING_BRANCH@@ stay, with the reason. Use after a staging release, when the owner says "staging review", "move the tickets to @@BOARD_REVIEW_STATUS@@", "what can QA test now", or invokes /staging-review.
argument-hint: "[#n ...] [--yes]"
---

Staging review: $ARGUMENTS

QA works only on the "@@BOARD_REVIEW_STATUS@@" column. A ticket gets there only when its change **and all its parts in other repos** are on the `@@STAGING_BRANCH@@` branch, and its comment names the staging versions. `/skill-5-ship` puts a complete ticket in "@@BOARD_STATUS@@"; this skill does the next move.

## Rules

- Run shell commands bare: one command per call, no pipes, `&&`, redirection or heredocs.
- Change only the Status of tickets that are in "@@BOARD_STATUS@@" now. Never move a ticket to another column, never close a ticket, never edit a ticket body.
- Never move a ticket when one of its PRs is open, or merged but not on `@@STAGING_BRANCH@@`. When in doubt, the ticket stays and the report says why.
- Never hard-code a field id or an option id. Read them each run.
- Interactive: show the table of Step 4 and wait for the owner's "yes" before Step 5. With `--yes` (or when the owner already said "move them"), go on without asking.

## Step 1 — Read the board

1. `gh project field-list @@BOARD_NUMBER@@ --owner @@BOARD_OWNER@@ --format json`: the id of the Status field and of the options "@@BOARD_STATUS@@" and "@@BOARD_REVIEW_STATUS@@". An option is missing → stop and tell the owner to add the column in the board UI (never through the API: an edit of the Status options replaces all of them, and items lose their Status).
2. `gh project view @@BOARD_NUMBER@@ --owner @@BOARD_OWNER@@ --format json`: the project id and `items.totalCount`.
3. `gh project item-list @@BOARD_NUMBER@@ --owner @@BOARD_OWNER@@ --format json --limit 5000`. When the count read is lower than `items.totalCount`, raise `--limit` and read again. Never work from a partial list.
4. Keep the issue items with Status "@@BOARD_STATUS@@". With `#n` arguments, keep only those tickets; a named ticket that is not in "@@BOARD_STATUS@@" goes to the report as "not in @@BOARD_STATUS@@ (<its Status>)".

## Step 2 — Find the PRs of each ticket

For each ticket `<n>`, read the PRs that mention it, in any repo (`<owner>` and `<repo>` from `@@GITHUB_REMOTE@@`):

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){title timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT,CONNECTED_EVENT]){nodes{... on CrossReferencedEvent{source{... on PullRequest{url number state isDraft mergedAt baseRefName mergeCommit{oid} repository{nameWithOwner}}}} ... on ConnectedEvent{subject{... on PullRequest{url number state isDraft mergedAt baseRefName mergeCommit{oid} repository{nameWithOwner}}}}}}}}}' -f o=<owner> -f r=<repo> -F n=<n>
```

- Leave out release PRs: a PR whose base is `@@STAGING_BRANCH@@` or the production branch (they promote work; they do not carry it).
- Leave out PRs that are `CLOSED` and not merged.
- An `OPEN` PR (draft or not) → the ticket stays. Reason: "open PR <url>". When the PR only mentions the ticket and carries no work for it, the owner moves the ticket by hand; this skill does not judge that.
- A PR in another repo often does not link back to the ticket, so the query above misses it. Read the ticket body and all comments too (`gh issue view <n> --comments`), and add every PR they name: `<owner>/<repo>#<number>`, `<repo>#<number>` or a `github.com/<owner>/<repo>/pull/<number>` link. Read each added PR with `gh pr view <PR url> --json state,isDraft,baseRefName,mergeCommit,url`, and apply the rules above to it.
- The body or comments name a follow-up ticket that this ticket waits for (for example "Backend follow-up: #719"). Find that ticket's PRs the same way, one level deep (not the follow-ups of the follow-up), and check them in Step 3 with the others. It has no merged PR → the ticket stays. Reason: "waits for <ticket link>, no merged PR". A follow-up ticket can stay open until QA closes it, so its open state alone does not block.

## Step 3 — Check each merged PR against @@STAGING_BRANCH@@

For each merged PR, in its own repo:

```bash
gh api repos/<repo of the PR>/compare/@@STAGING_BRANCH@@...<mergeCommit oid> --jq .status
```

- `behind` or `identical` → the PR is on `@@STAGING_BRANCH@@`.
- `ahead` or `diverged` → not on `@@STAGING_BRANCH@@` yet. The ticket stays. Reason: "<PR url> not on @@STAGING_BRANCH@@".
- 404 (the repo has no `@@STAGING_BRANCH@@` branch) → the ticket stays. Reason: "<repo> has no @@STAGING_BRANCH@@ branch".

This check needs promotions that keep the commits (a merge commit or a fast-forward). A squash promotion makes every PR look "not on staging": then say so in the report and stop.

Then read the version on `@@STAGING_BRANCH@@` of each repo that has a PR of a ready ticket, once per repo:

```bash
gh api "repos/<repo>/contents/package.json?ref=@@STAGING_BRANCH@@" --jq '.content | @base64d | fromjson | .version'
```

When the repo has no `package.json`, use the short commit: `gh api repos/<repo>/commits/@@STAGING_BRANCH@@ --jq .sha`, and write its first 7 signs.

## Step 4 — Table

| Ticket | Title | PRs (repo#number) | Result |
| --- | --- | --- | --- |
| #<n> | <title> | <web#12, api#34> | move / stays: <reason> |

A ticket with no PR at all stays. Reason: "no PR found".

## Step 5 — Move and comment

For each ticket marked "move":

1. `gh project item-edit --id <item id> --project-id <project id> --field-id <field id> --single-select-option-id <"@@BOARD_REVIEW_STATUS@@" option id>`.
2. `gh issue comment <n> --body-file <scratchpad file>` with this text:

   ```markdown
   **On staging, ready for QA.** <repo> <version> (<PR links>), <other repo> <version> (<PR links>).
   ```

   Example: `**On staging, ready for QA.** web 1.128.0 (#873), api 0.150.0 (api#283).`
3. Read the board back (the full read of Step 1.3) and check the new Status. A failure → the report names the ticket.

## Step 6 — Report

1. Moved: `#<n>` with the versions, one line each.
2. Stayed: `#<n>` with the reason, one line each.
3. Not in "@@BOARD_STATUS@@" (only with `#n` arguments).
4. The last line: "<k> moved to @@BOARD_REVIEW_STATUS@@, <m> stay in @@BOARD_STATUS@@."
