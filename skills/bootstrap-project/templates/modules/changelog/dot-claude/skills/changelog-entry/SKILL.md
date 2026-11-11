---
name: changelog-entry
description: Write the changelog.d/ entry that the Changelog Gate check needs on each PR to @@BASE_BRANCH@@ — one YAML file with kind, scope, pr and a plain-words summary — or say that the PR needs the no-changelog label instead. Use when a PR is opened, when the Changelog Gate check failed, or when the owner asks for a changelog entry or a release note.
argument-hint: "[short-slug]"
---

Write the changelog entry for the current change: $ARGUMENTS

Run every shell command bare: one command per call, no pipes, `&&`, redirection or heredocs. Headless runs auto-deny compound commands.

## Step 1 — Is an entry necessary?

Look at what changed. Run each command alone:

- `git diff --stat origin/@@BASE_BRANCH@@...HEAD`
- `git status --short`
- `git diff --name-only --diff-filter=A origin/@@BASE_BRANCH@@...HEAD -- changelog.d`

If the last command lists a file, the branch has an entry already. Show it and stop. Do not add a second one.

If the change ships nothing a reader cares about (a dependency update, a CI fix, a typo, a refactor with no visible effect): **stop**. Tell the owner to put the label `no-changelog` on the PR. The check runs again by itself when a label changes. Do not write an empty entry to satisfy the check.

All other changes need an entry.

## Step 2 — Write the file

Read `changelog.d/README.md` for the format. Then write one new file with the Write tool: `changelog.d/<pr-number-or-date>-<slug>.yaml`. Use the PR number when it is known; else today's date as `YYYYMMDD`. `<slug>` is `$ARGUMENTS` if given, else a short kebab-case name for the change. Never edit an existing entry.

```yaml
kind: fixed # added | changed | fixed | removed | security | performance
scope: orders # kebab-case area of the change
pr: 12 # leave this line out when the PR number is not known yet
summary: |
  A user can now save an order with an empty note. Before, the save failed.
```

Rules for `summary`:

- One or two sentences in plain words, written in ASD-STE100.
- Say what changed for the reader, not how the code changed.
- Use real but made-up values when an example helps. Never put real customer data or secrets in the entry.

## Step 3 — Check

- Read the file again. Confirm that `kind` is one of the six values, that `scope` is kebab-case, and that `summary` is not empty.
- Run `git status --short` and confirm the new file is the only new file under `changelog.d/`.

## Step 4 — Output

- The path of the new file, on its own line.
- Do not run `git add` or `git commit`. `/skill-auto-pipeline` commits it in a run. In an interactive session, give the owner a copy-paste `git add -- <path>` command.
