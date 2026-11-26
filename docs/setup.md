# Setup on a new machine

```bash
# Download this repo to ~/Workspace/claude-config
git clone https://github.com/orangeGoran/claude-config.git ~/Workspace/claude-config

# Go into it
cd ~/Workspace/claude-config

# Set it up: asks which parts you want and confirms each change (--yes skips the questions)
scripts/setup.sh
```

It asks which parts you want, then runs each one:

1. **Claude Code config** ([`scripts/setup-claude.sh`](../scripts/setup-claude.sh)), asking before each step:
   - symlink `CLAUDE.md` into `~/.claude/`
   - symlink each skill into `~/.claude/skills/`, one question per skill
   - set `cleanupPeriodDays` to `99999` in `~/.claude/settings.json`, so Claude Code keeps session transcripts instead of deleting them after 30 days
   - set `attribution` to `{"commit": "", "pr": ""}`, so Claude Code adds no co-author line to commits and no footer to PR descriptions
   - set `idleCompaction` to `false`, so Claude Code does not compact a long conversation while the session is idle
2. **Plans dashboard** ([`scripts/setup-macos.sh`](../scripts/setup-macos.sh), macOS): runs the dashboard at login on `https://shipyard.test` (it asks for the domain; `--domain` skips the question). It needs Homebrew, and asks for your password the first time: once for `/etc/hosts`, once to trust the local certificate. Details: [Install it to run at login](plans-dashboard.md#install-it-to-run-at-login-macos).
   - Then it asks to build and install Shipyard, the Mac app of the dashboard, in `~/Applications/Shipyard.app` (`[Y/n]`; `--yes` says yes). It needs the Swift compiler of the Command Line Tools; without it, setup skips the app and says how to get it (`xcode-select --install`, then `npm run build-app`). A failed build does not stop setup. Details: [Mac app](plans-dashboard.md#mac-app).

When it finishes, it opens the dashboard: in Shipyard when you built it, else in the browser. There, a short guide finds your repos and says what each one still needs. Step by step: [Add a project to the dashboard](add-project.md).

Safe to re-run. A real file already in the way is moved aside to `<name>.bak-<timestamp>`, `settings.json` is merged rather than replaced, and a dashboard that is already set up with the same settings is left running.
