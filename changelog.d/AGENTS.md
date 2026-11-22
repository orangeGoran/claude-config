# Changelog entries

Rules for `changelog.d/`. Read this file before you change files here. The entry format is in `changelog.d/README.md`.

- Each PR to `main` adds one new YAML file here. The "Changelog Gate" check (`.github/workflows/changelog-gate.yml`) fails the PR otherwise.
- Every entry has `summary` (one plain paragraph for the team) and `internal` (the developer note). An entry that customers see also has `customer` in `en`.
- `node .claude/scripts/changelog-validate.mjs --base origin/main` must print `PASS`.
- Never edit or delete an entry of another PR. Add a new file.
- A PR that ships nothing a reader cares about gets the label `no-changelog` instead of an entry. Do not write an empty entry to satisfy the check.
- Use `/changelog-entry` to write an entry.
