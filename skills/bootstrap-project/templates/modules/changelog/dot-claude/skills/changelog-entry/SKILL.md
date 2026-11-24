---
name: changelog-entry
@@IF CHANGELOG_SUMMARY@@
description: Write the changelog.d/ entry that the Changelog Gate check needs on each PR to @@BASE_BRANCH@@ — one YAML file with a plain summary for the team, a developer note and, when customers see the change, a customer note in @@CHANGELOG_LOCALES@@ — and check it with the changelog validator, or say that the PR needs the no-changelog label instead. Use when a PR is opened, when the Changelog Gate check failed, or when the owner asks for a changelog entry or a release note.
@@END@@
@@IFNOT CHANGELOG_SUMMARY@@
description: Write the changelog.d/ entry that the Changelog Gate check needs on each PR to @@BASE_BRANCH@@ — one YAML file with a developer note and, when customers see the change, a customer note in @@CHANGELOG_LOCALES@@ — and check it with the changelog validator, or say that the PR needs the no-changelog label instead. Use when a PR is opened, when the Changelog Gate check failed, or when the owner asks for a changelog entry or a release note.
@@END@@
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

## Step 2 — Choose the audience

Ask: **can a user, or a customer's agent or app, do or see something new or different?** That includes a new or changed screen, endpoint, error message, limit or behavior, also when the screen for a new endpoint does not exist yet.

| Answer | `audience` | What you write |
| --- | --- | --- |
@@IF CHANGELOG_SUMMARY@@
| No | `internal` | `summary` and `internal` |
| Yes | `both` | `summary`, `internal` and `customer` in @@CHANGELOG_LOCALES@@ |
@@END@@
@@IFNOT CHANGELOG_SUMMARY@@
| No | `internal` | `internal` |
| Yes | `both` | `internal` and `customer` in @@CHANGELOG_LOCALES@@ |
@@END@@

`customer` alone is rare: use it only when there is nothing for a developer to note. When unsure, use `both`.

## Step 3 — Write the file

Read `changelog.d/README.md` for the format. Then write one new file with the Write tool: `changelog.d/<pr-number-or-date>-<slug>.yaml`. Use the PR number when it is known; else today's date as `YYYYMMDD`. `<slug>` is `$ARGUMENTS` if given, else a short kebab-case name for the change. Never edit an existing entry.

```yaml
kind: added # added | changed | fixed | removed | security | performance
audience: both # internal | customer | both
scope: orders # kebab-case area of the change
pr: 12 # leave this line out when the PR number is not known yet
@@IF CHANGELOG_SUMMARY@@
summary: |
  A user can now add a note to an order. The note shows on the order page and
  in the order email.
@@END@@
internal: |
  `PATCH /v1/orders/{id}` takes an optional `note` (max 500 characters).
  New column `orders.note`. A longer note gives 422 `note_too_long`.
customer:
@@CHANGELOG_LOCALES_YAML@@
```

Rules:

@@IF CHANGELOG_SUMMARY@@
- `summary`: always. One short paragraph (2–4 sentences) in plain words, written in ASD-STE100. The owner reads it in place of the `internal` note: what changed, for whom, and any limit or catch. No code names unless the reader needs one.
@@END@@
- `internal`: always. The developer details: endpoints, fields, error codes, migrations, settings, and anything surprising.
- `customer`: only for `customer` and `both`, with every language (@@CHANGELOG_LOCALES@@) filled. With `audience: internal`, leave the `customer` key out completely (no empty block). Translate it yourself; never leave a placeholder. Write for a person who uses the product: what they can now do, not which endpoint changed. No field names, no status codes.
- Use made-up values when an example helps. Never put real customer data, credentials or unshipped security details in the entry.
@@IF HAS_VERSION_BUMP@@

## Step 3b — Raise the version

Raise `version` in `@@CHANGELOG_VERSION_FILE@@` by exactly one step from the version on `origin/@@BASE_BRANCH@@`:

- **patch** (`1.4.2` → `1.4.3`): a fix.
- **minor** (`1.4.2` → `1.5.0`): a feature, or a new optional field.
- **major** (`1.4.2` → `2.0.0`): a breaking change: a removed or renamed endpoint or field, a new required request field, a changed status code, a stricter access rule.
- **While the version is `0.x`**, a breaking change raises **minor** (`0.7.3` → `0.8.0`), never `1.0.0`. Then the `internal` note starts with `BREAKING:` and says what callers must change. Only the owner decides when the version becomes `1.0.0`.

The branch has raised it already when `git diff origin/@@BASE_BRANCH@@...HEAD -- @@CHANGELOG_VERSION_FILE@@` shows a `version` line. Do not raise it twice.
@@END@@

## Step 4 — Check

Run `@@CHANGELOG_VALIDATE@@`. It must print `PASS`. Fix each problem it names and run it again.

## Step 5 — Output

@@IF CHANGELOG_SUMMARY@@
- The path of the new file, on its own line, and the `summary` text, so the owner can check the tone.
@@END@@
@@IFNOT CHANGELOG_SUMMARY@@
- The path of the new file, on its own line, and the English `customer` text (or "internal only"), so the owner can check the tone.
@@END@@
- Do not run `git add` or `git commit`. `/skill-auto-pipeline` commits it in a run. In an interactive session, give the owner a copy-paste `git add -- <path>` command for the new file and every other file this skill changed.
