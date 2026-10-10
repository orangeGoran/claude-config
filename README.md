# claude-config

A Claude Code setup in one repo: a local dashboard that runs plan files in the background, plus global rules and skills linked into `~/.claude/`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/plans-dashboard-dark.png">
  <img alt="Plans dashboard: running, in-progress and awaiting-review strips down the left, the selected plan with its plain-language summary, status, tags and rendered markdown on the right" src="docs/plans-dashboard-light.png">
</picture>

## Quick start

```bash
git clone git@github.com:orangeGoran/claude-config.git ~/Workspace/claude-config
cd ~/Workspace/claude-config
scripts/setup.sh            # asks what to set up; --yes sets up everything
```

It asks before each change and is safe to re-run. Details: [docs/setup.md](docs/setup.md).

## What's inside

- **Plans dashboard**: lists the plan files of your projects and runs them with Claude Code, several at once. [Guide](docs/plans-dashboard.md) · [Add a project](docs/add-project.md)
- **`CLAUDE.md`**: global rules, loaded in every project.
- **Skills**: each one is optional. A project skill with the same name wins over the global one.

| Skill | What it does |
| --- | --- |
| [`/commit-message`](skills/commit-message/SKILL.md) | Writes a Conventional Commits message for your changes. Never commits. |
| [`/pr`](skills/pr/SKILL.md) | Opens a pull request from one branch into another. |
| [`/hand-review`](skills/hand-review/SKILL.md) | Walks you through a diff one stop at a time. |

## License

[MIT](LICENSE)
