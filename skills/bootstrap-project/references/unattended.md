# Unattended upgrade

`scripts/upgrade-run.mjs` runs this part of the upgrade with no person in the chat. Nobody answers a question: write it down instead.

## Rules

- Everything you need is in your working folder (the run folder). Read nothing outside it, and write only there.
- Write only the `merged/<n>` files and `decisions.json`. Write nothing else.
- Never try to edit `templates/` or a repo file. The script writes the repo after it checks your decisions.
- Do not run shell commands. You do not need them.

## Steps

1. Read `task.json` and `refs/lessons.md`. `task.json` has `changed` (one entry per file: `n`, `path`, `current`, `stage`, `merged`, `note`, `diff`) and `orphans`. All its paths are relative to the run folder.
2. For each `changed` entry, read `current` (the repo file now) and `stage` (what the templates make) in full. Compare them feature by feature, not line by line, and list: (a) features the template has and the repo file lacks, (b) project content the template does not know, (c) template text that is wrong for this repo.
3. Decide one of:
   - **merge** (the default): the repo file stays the base, and each feature from (a) moves in, adapted to the project. Content from (b) stays. Text from (c) is left out. Write the result to the entry's `merged` path (`merged/<n>`).
   - **keep**: only when (a) is empty, for example only comments or wording differ.
   - **replace**: only when (b) is empty. The script writes the `stage` file.
   "The repo file has project text" is never on its own a reason to keep a file.
4. A merged file has no template placeholder (`@@NAME@@`). Keep the `CONFIG (<project>)` block of a script as the `current` file has it; `diff` lists the CONFIG lines that differ from the answers, and the owner decides about them.
5. A feature that every project needs and the template lacks: put it in `templateUpdates` (`path`, `feature`, `why`). Do not write it anywhere else.
6. Each item that only the owner can decide: put it in `questions`, one plain sentence each. Never stop to ask.
7. Write `decisions.json` last, in this shape:

```json
{
  "files": [{ "path": "<the changed path>", "decision": "merge", "added": ["<feature that moved in>"], "kept": ["<project text kept>"], "dropped": ["<template text left out>"] }],
  "templateUpdates": [{ "path": "<template path>", "feature": "<what>", "why": "<why every project needs it>" }],
  "questions": ["<one question for the owner>"]
}
```

`files` has exactly one entry for each `changed` path, and nothing else. A `merge` entry must have its `merged/<n>` file; `merged/` holds no other file.

8. End with one line: `DONE <n> files`.
