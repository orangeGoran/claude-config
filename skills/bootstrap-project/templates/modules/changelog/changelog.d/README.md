# changelog.d — unreleased entries

One file per pull request. The "Changelog Gate" check fails a PR to `@@BASE_BRANCH@@` that adds no file here, unless the PR has the label `no-changelog`.

Why one file per PR and not one shared `CHANGELOG.md`: two PRs that edit the same file conflict at each merge. Two PRs that add different files never conflict.

## Add an entry

Create `changelog.d/<pr-number-or-date>-<short-slug>.yaml`. Example: `changelog.d/20261112-health-endpoint.yaml`.

```yaml
kind: added # added | changed | fixed | removed | security | performance
scope: api # kebab-case area of the change
pr: 12 # leave this line out when the PR number is not known yet
summary: |
  The API has a health endpoint. A monitor can now check that the service runs.
```

| Field | Required | Meaning |
| --- | --- | --- |
| `kind` | yes | One of `added`, `changed`, `fixed`, `removed`, `security`, `performance`. |
| `scope` | yes | The area of the change, in kebab-case. |
| `pr` | no | The PR number. |
| `summary` | yes | One or two plain sentences: what changed for the reader, not how. |

Use `/changelog-entry` to write the file.

## When no entry is necessary

A change that a reader does not care about (a dependency update, a CI fix, a typo, a refactor with no visible effect) needs no entry. Put the label `no-changelog` on the PR. The check runs again by itself when a label changes.
