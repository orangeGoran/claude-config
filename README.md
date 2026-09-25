# claude-config

Two things in one repo:

- **Plans dashboard** — a local web page that lists the plan files of every project you
  register, shows which are running, and launches them, each in its own git worktree so
  plans run in parallel. See [Plans dashboard](#plans-dashboard).
- **Global Claude Code configuration** — standing rules and skills, version-controlled
  and symlinked into `~/.claude/`.

## Contents

### Skills

Each skill is independent. Symlink only the ones you want (see
[Setup](#setup-on-a-new-machine)).

| Skill | Command | What it does |
| --- | --- | --- |
| [`commit-message`](skills/commit-message/SKILL.md) | `/commit-message` | Writes a copy-paste-ready Conventional Commits message for the current changes. Never stages or commits. |
| [`pr`](skills/pr/SKILL.md) | `/pr [target-branch]` | Creates a pull request from the current branch against a target branch. Only runs when you call it. |
| [`hand-review`](skills/hand-review/SKILL.md) | `/hand-review [target]` | Walks you through a diff one stop at a time, following one request through the code, and pauses for your answer after each. |

### Everything else

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | Global standing rules, loaded in every project |
| `scripts/setup.sh` | First-time setup: asks which parts you want, then runs `setup-claude.sh` and `setup-macos.sh` |
| `scripts/setup-claude.sh` | Links `CLAUDE.md` and your chosen skills into `~/.claude/`, and optionally sets global settings (session history, no AI attribution) |
| `scripts/plans-dashboard.mjs` | The plans dashboard server |
| `scripts/launcher-template.sh` | Starting point for a repo's dashboard launcher |
| `scripts/worktree-run.sh` | Runs a plan in its own git worktree, so plans can run in parallel |
| `scripts/setup-macos.sh` | Runs the dashboard at login, served at `https://plans.test` |

## Setup on a new machine

```bash
git clone git@github.com:orangeGoran/claude-config.git ~/Workspace/claude-config
cd ~/Workspace/claude-config
scripts/setup.sh            # asks what to set up; --yes sets up everything
```

It asks which parts you want, then runs each one:

1. **Claude Code config** ([`scripts/setup-claude.sh`](scripts/setup-claude.sh)), asking
   before each step:
   - symlink `CLAUDE.md` into `~/.claude/`
   - symlink each skill into `~/.claude/skills/`, one question per skill
   - set `cleanupPeriodDays` to `99999` in `~/.claude/settings.json`, so Claude Code keeps
     session transcripts instead of deleting them after 30 days
   - set `attribution` to `{"commit": "", "pr": ""}`, so Claude Code adds no co-author
     line to commits and no footer to PR descriptions
2. **Plans dashboard** ([`scripts/setup-macos.sh`](scripts/setup-macos.sh), macOS): runs the
   dashboard at login on `https://plans.test` (it asks for the domain; `--domain` skips the
   question). It needs Homebrew, and asks for your password the first time: once for
   `/etc/hosts`, once to trust the local certificate.

When it finishes, it opens the dashboard. There, a short guide finds your repos and says what
each one still needs.

Safe to re-run. A real file already in the way is moved aside to `<name>.bak-<timestamp>`,
`settings.json` is merged rather than replaced, and a dashboard that is already set up
with the same settings is left running.

Project-level skills with the same name take precedence over these global ones.

## Plans dashboard

A local web page that lists the plan files of every project you register and launches
them. Full guide: [docs/plans-dashboard.md](docs/plans-dashboard.md).

![Plans dashboard: running, in-progress and awaiting-review strips down the left, the selected plan with its plain-language summary, status, tags and rendered markdown on the right](docs/plans-dashboard.png)

```bash
node scripts/plans-dashboard.mjs   # try it without installing → http://127.0.0.1:4899
```

`scripts/setup.sh` installs it to run at login; see above.

## License

[MIT](LICENSE)
