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
| `scripts/setup-claude.sh` | Links `CLAUDE.md` and your chosen skills into `~/.claude/`, and optionally keeps session history |
| `scripts/plans-dashboard.mjs` | The plans dashboard server |
| `scripts/launcher-template.sh` | Starting point for a repo's dashboard launcher |
| `scripts/worktree-run.sh` | Runs a plan in its own git worktree, so plans can run in parallel |
| `scripts/setup-macos.sh` | Runs the dashboard at login, served at `https://plans.test` |

## Setup on a new machine

```bash
git clone git@github.com:orangeGoran/claude-config.git ~/Workspace/claude-config
cd ~/Workspace/claude-config
scripts/setup-claude.sh         # asks before each step; --yes does them all
```

The script asks before each step:

- symlink `CLAUDE.md` into `~/.claude/`
- symlink each skill into `~/.claude/skills/`, one question per skill
- set `cleanupPeriodDays` to `99999` in `~/.claude/settings.json`, so Claude Code keeps
  session transcripts instead of deleting them after 30 days

A real file already in the way is moved aside to `<name>.bak-<timestamp>`, and
`settings.json` is merged, never replaced.

Project-level skills with the same name take precedence over these global ones.

## Plans dashboard

A local web page that lists the plan files of every project you register and launches
them. Full guide: [docs/plans-dashboard.md](docs/plans-dashboard.md).

![Plans dashboard: running, in-progress and awaiting-review strips down the left, the selected plan with its plain-language summary, status, tags and rendered markdown on the right](docs/plans-dashboard.png)

```bash
node scripts/plans-dashboard.mjs   # try it → http://127.0.0.1:4899
scripts/setup-macos.sh             # run it at login → https://plans.test
```

## License

[MIT](LICENSE)
