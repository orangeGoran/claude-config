# claude-config

A Claude Code setup in one repo: a local dashboard that runs plan files in the background, plus global rules and skills linked into `~/.claude/`.

## Why



https://github.com/user-attachments/assets/51867778-8650-4512-a50c-2b0b002580b3



Claude Code is good at implementing a well-written plan. Three things got in the way of using it that way:

| Problem                                                                                                                                               | What this repo does                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **You babysit it.** A task runs in your terminal, one at a time, and you sit there approving each step.                                               | The dashboard launches a plan in the background, with its permissions set up front, and runs several plans at once, each in its own git worktree. You come back to a finished diff. |
| **You lose track.** Plan files are spread across many repos and clients. Nothing shows which plans are running, finished, or waiting for your review. | One page lists the plans of every registered project, with what is running and what needs your review pinned to the top.                                                            |
| **Your setup drifts.** Rules and skills get copied by hand to each machine and slowly go out of sync.                                                 | `CLAUDE.md` and the skills live here, under version control, and are symlinked into `~/.claude/`. A `git pull` brings a change to every machine.                                    |

## Quick start

The three commands below download this repo and set it up. Setup asks which parts you want: the global rules and skills, the dashboard, or both. It asks again before each change, so nothing happens without your yes.

You need [Claude Code](https://claude.ai/code), git and Node 18 or newer. The dashboard part also needs macOS and [Homebrew](https://brew.sh). On Linux, you can still run the dashboard by hand: `node scripts/plans-dashboard.mjs`.

```bash
# Download this repo to ~/Workspace/claude-config
git clone https://github.com/orangeGoran/claude-config.git ~/Workspace/claude-config

# Go into it
cd ~/Workspace/claude-config

# Set it up: asks which parts you want and confirms each change (--yes skips the questions)
scripts/setup.sh
```

### After setup

That's it. Setup opens your dashboard in the browser at **[https://plans.test](https://plans.test)** (or the domain you typed). Next:

1. **Add your first project.** The guide on the dashboard finds your repos and walks you through it. Step by step with screenshots: [Add a project to the dashboard](docs/add-project.md).
2. **Write a plan.** Put a Markdown file in the project's plans folder (`.plans` by default) that says what to change and how to check it. It shows up on the dashboard.
3. **Launch it.** Open the plan and click **▶ Launch now**. Come back to a finished diff.
4. **Use the skills.** In Claude Code, in any project, type `/commit-message`, `/pr`, `/hand-review`, `/merge-review` or `/browser-usability-test`.

Skipped the dashboard part? Run `node scripts/plans-dashboard.mjs` and open [http://127.0.0.1:4899](http://127.0.0.1:4899).

To change your choices later, run `scripts/setup.sh` again. Every question it asks: [docs/setup.md](docs/setup.md).

## What's inside

- **Plans dashboard**: lists the plan files of your projects and runs them with Claude Code, several at once. [Guide](docs/plans-dashboard.md) · [Add a project](docs/add-project.md)
- **`CLAUDE.md`**: global rules, loaded in every project.
- **Skills**: each one is optional. A project skill with the same name wins over the global one.

| Skill                                               | What it does                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| [`/commit-message`](skills/commit-message/SKILL.md) | Writes a Conventional Commits message for your changes. Never commits. |
| [`/pr`](skills/pr/SKILL.md)                         | Opens a pull request from one branch into another.                     |
| [`/hand-review`](skills/hand-review/SKILL.md)       | Walks you through a diff one stop at a time.                           |
| [`/merge-review`](skills/merge-review/SKILL.md)     | Explains a merge: what users see, what to check, what changed inside.  |
| [`/browser-usability-test`](skills/browser-usability-test/SKILL.md) | Tests a page of your local app in a real browser and reports bugs with evidence. Needs `npm install --prefix skills/browser-usability-test` once. |

## Author

Goran Tubic ([@orangeGoran](https://github.com/orangeGoran))

## License

[MIT](LICENSE)
