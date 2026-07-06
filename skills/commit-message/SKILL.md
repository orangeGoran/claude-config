---
name: commit-message
description: Generate a copy-paste-ready Conventional Commits message for the current changes — nothing else. No tests, no lint, no workflow gates, no staging. Use whenever the user asks for a commit message (e.g. "give me a commit message", "commit message for your changes") or invokes /commit-message.
argument-hint: "[optional focus, e.g. a file/topic to describe]"
allowed-tools: Bash(git *)
---

Generate a commit message for the current changes: $ARGUMENTS

**IMPORTANT: Never run `git add`, `git reset`, `git commit`, or any command that modifies the staging area or creates commits. Only output the message. This skill runs no tests, no lint, and no workflow checks.**

## Steps

1. Inspect the changes (run in parallel):
   - `git status --short`
   - `git diff --stat` and `git diff --cached --stat`
   - `git log --oneline -10` (to match the repo's message style)
2. If `$ARGUMENTS` names a focus (a file, topic, or subset), describe only that subset; otherwise cover all pending changes (staged + unstaged + untracked).
3. If the changes were made earlier in this conversation, use that context for the **why** — the diff alone rarely explains intent.
4. If there are no changes at all, say so and stop.

## Message format

Use **Conventional Commits**:

```
<type>(<scope>): <short summary>

<optional body — what and why, not how>
```

- **Type**: `feat` | `fix` | `refactor` | `test` | `docs` | `chore` | `style` | `perf`
- **Scope** (optional but preferred): the domain, module, or feature area touched, matching how recent commits in this repo scope things. If changes span multiple scopes, omit it or use the most relevant one.
- Summary line: imperative mood, lowercase, no period, max 72 chars.
- Body: wrap at 72 chars; explain **why** when not obvious from the summary. Omit the body for trivial changes.
- Do **not** include `Co-Authored-By` lines or any AI attribution.

## Output

Output **only** the commit message in a single fenced code block so the user can copy it — no preamble, no "let me know if..." closers. If the changes are genuinely unrelated bundles, you may offer 2–3 alternative messages (one per bundle), each in its own fenced block, with a one-line label above each.
