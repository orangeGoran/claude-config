# claude-config

Version-controlled global Claude Code configuration. Symlinked into `~/.claude/`.

## Contents

- `CLAUDE.md` — global standing rules loaded in every project
- `skills/commit-message/` — `/commit-message`: copy-paste Conventional Commits message
- `skills/pr/` — `/pr`: create a PR against a target branch
- `skills/hand-review/` — `/hand-review`: walk a human through a diff one stop at a
  time, following one request through the code, pausing on a question after each
- `scripts/plans-dashboard.mjs` — local web dashboard for plan files across projects
- `scripts/launcher-template.sh` — starting point for a repo's dashboard launcher
- `scripts/worktree-run.sh` — run a plan in its own git worktree, so plans can run in parallel
- `scripts/setup-macos.sh` — run the dashboard at login, served at `https://plans.test`

## Setup on a new machine

```bash
git clone git@github.com:orangeGoran/claude-config.git ~/Workspace/claude-config
cd ~/Workspace/claude-config
ln -sf "$PWD/CLAUDE.md" ~/.claude/CLAUDE.md
mkdir -p ~/.claude/skills
ln -sfn "$PWD/skills/commit-message" ~/.claude/skills/commit-message
ln -sfn "$PWD/skills/pr" ~/.claude/skills/pr
ln -sfn "$PWD/skills/hand-review" ~/.claude/skills/hand-review
```

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
