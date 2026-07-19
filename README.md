# claude-config

Version-controlled global Claude Code configuration. Symlinked into `~/.claude/`.

## Contents

- `CLAUDE.md` — global standing rules loaded in every project
- `skills/commit-message/` — `/commit-message`: copy-paste Conventional Commits message
- `skills/pr/` — `/pr`: create a PR against a target branch

## Setup on a new machine

```bash
git clone git@github.com:orangeGoran/claude-config.git ~/Workspace/claude-config
ln -sf ~/Workspace/claude-config/CLAUDE.md ~/.claude/CLAUDE.md
mkdir -p ~/.claude/skills
ln -sfn ~/Workspace/claude-config/skills/commit-message ~/.claude/skills/commit-message
ln -sfn ~/Workspace/claude-config/skills/pr ~/.claude/skills/pr
```

Project-level skills with the same name (e.g. in galileon-solver-api) take precedence over these global ones.

## License

[MIT](LICENSE)
