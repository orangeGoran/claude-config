# changelog.d — unreleased entries

One file per pull request. The "Changelog Gate" check fails a PR to `@@BASE_BRANCH@@` that adds no file here, unless the PR has the label `no-changelog`.

Why one file per PR and not one shared `CHANGELOG.md`: two PRs that edit the same file conflict at each merge. Two PRs that add different files never conflict.

## Add an entry

Run `/changelog-entry`, or create `changelog.d/<pr-number-or-date>-<short-slug>.yaml`. Example: `changelog.d/20261112-order-notes.yaml`.

```yaml
kind: added # added | changed | fixed | removed | security | performance
audience: both # internal | customer | both
scope: orders # kebab-case area of the change
pr: 12 # leave this line out when the PR number is not known yet
summary: |
  A user can now add a note to an order. The note shows on the order page and
  in the order email.
internal: |
  `PATCH /v1/orders/{id}` takes an optional `note` (max 500 characters).
  New column `orders.note`. A longer note gives 422 `note_too_long`.
customer:
@@CHANGELOG_LOCALES_YAML@@
```

| Field | Required | Meaning |
| --- | --- | --- |
| `kind` | yes | One of `added`, `changed`, `fixed`, `removed`, `security`, `performance`. |
| `audience` | yes | `internal`, `customer` or `both` (see below). |
| `scope` | yes | The area of the change, in kebab-case. |
| `pr` | no | The PR number, a positive number. |
| `summary` | yes | One short paragraph in plain words for the team: what changed and why it matters. Read this one first; it replaces reading the `internal` note. |
| `internal` | yes | The developer note: endpoints, fields, error codes, migrations, anything surprising. |
| `customer` | with `customer` or `both` | The text customers see, in each language: @@CHANGELOG_LOCALES@@. Left out for `internal`. |

@@IF HAS_VERSION_BUMP@@
Then raise `version` in `@@CHANGELOG_VERSION_FILE@@` by exactly one step: **patch** for a fix, **minor** for a feature, **major** for a breaking change (a removed or renamed endpoint or field, a new required request field, a changed status code, a stricter access rule). A new optional field is minor.

@@END@@
Check it locally: `@@CHANGELOG_VALIDATE@@` must print `PASS`.

## Choose an audience

| Audience | Who reads `customer` | Use it for |
| --- | --- | --- |
| `internal` | Nobody | Nothing changes for any user or any customer's agent: refactors, build changes, ops notes |
| `customer` | Customers | Rare: a visible change with nothing for developers to note |
| `both` | Customers | Most work: a new or changed screen, endpoint, error message, limit or behavior |

A new API route that a customer's agent or app can call is visible, also when the screen for it does not exist yet. When unsure, use `both`.

Write `customer` for a person who uses the product: what they can now do, not which endpoint changed. Keep credentials and unshipped security details out of every field.

## When no entry is necessary

A change that a reader does not care about (a dependency update, a CI fix, a typo, a refactor with no visible effect) needs no entry. Put the label `no-changelog` on the PR. The check runs again by itself when a label changes.
