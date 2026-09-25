# Plans dashboard

A single-file, dependency-free Node server that lists the `*.md` plan files of every
project you register, shows which ones have a run in progress, and launches them.

![Plans dashboard: running, in-progress and awaiting-review strips down the left, the selected plan with its plain-language summary, status, tags and rendered markdown on the right](plans-dashboard.png)

*Screenshots show a demo project set, not real work.*

## Start it

```bash
node scripts/plans-dashboard.mjs          # → http://127.0.0.1:4899
node scripts/plans-dashboard.mjs --help   # options and file locations
```

Requires Node 18+ (developed on 24).

## Add your first project

With no projects registered, a two-step guide opens by itself (**Guide** in the top bar
reopens it): a short demo of the flow you step through, then a repo to pick. It ends with a
four-stop tour of the real screen (plan list, plan pane, launch bar, Guide/Settings); what to
launch is left to you. Machine checks (Node, the `claude` CLI, git, jq, HTTPS) appear only when one fails.
It looks for repos in the folder this one sits in and the usual dev folders (`~/Workspace`,
`~/Projects`, `~/code`, …) up to three levels deep, or any folder you type, and rates each:

| Level | Meaning |
| --- | --- |
| Green | ready — git repo, plans folder with plans, a way to launch, allowlist, skills, CLAUDE.md |
| Amber | launchable; a recommended item is missing (a first plan, skills, CLAUDE.md, a pipeline project's allowlist) |
| Red | a required item is missing: git repo, plans folder, a launcher, or (for generic projects) a permission allowlist |

Every missing item comes with a shell command or a prompt to paste into Claude Code in that
repo, plus one combined prompt that covers them all. **＋ Add** registers the repo; one that
already has `.claude/scripts/run-skill.sh` gets it as its launcher. A registered project that
turns red shows **needs setup** in the sidebar.

To register a repo from Claude Code instead, open Claude Code **inside the repository you want on
the dashboard** and paste this:

```
Register this repository with my plans dashboard.

The dashboard lives at ~/Workspace/claude-config (adjust if I cloned it
elsewhere). Read its docs/plans-dashboard.md, the header comment of
scripts/plans-dashboard.mjs, and scripts/pipeline-projects.example.json so you
know the registry format.

Then look at THIS repository and work out:

1. Which folder holds its plan files (*.md). Common spots are .plans,
   docs/plans, wiki/plans. If there is no such folder, say so and suggest one
   instead of creating it.
2. Whether .claude/scripts/auto-pipeline.sh exists. If it does, this is a
   "pipeline" project and needs no launcher. If not, it is a "generic" project
   and needs a launcher command.
3. For a generic project, one launcher command that would implement a plan in
   this repo. Base it on what this repo actually has — its .claude/skills, its
   .claude/scripts, its real test and build commands. Use {plan} where the plan
   file path goes. Prefer a small wrapper script under .claude/scripts over a
   bare `claude -p` command — copy scripts/launcher-template.sh from the
   dashboard repo and edit its two marked spots. See "How a plan gets launched"
   for why a headless run needs its permissions on the command line.

Show me the proposed registry entry and, in one plain sentence, what the
launcher command would run. Change nothing yet.

Once I approve, MERGE the entry into ~/.claude/pipeline-projects.json, keeping
every project already listed there. Create the file as {"projects": []} first if
it does not exist. Never drop or overwrite an existing entry.
```

Reload the dashboard and the project appears. You can also add projects by hand
(below) or from the dashboard's ⚙ Settings panel.

## The registry

Projects live in `~/.claude/pipeline-projects.json`. Copy
[`scripts/pipeline-projects.example.json`](../scripts/pipeline-projects.example.json) as a
starting point. Paths may start with `~`.

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | unique id; letters, digits, `.`, `_`, `-` |
| `root` | yes | repo root |
| `client` | no | grouping header in the sidebar (default `Default`) |
| `plansDir` | no | folder holding the `*.md` plans (default `<root>/.plans`) |
| `doneDir` | no | where archived plans move (default `<plansDir>/done`) |
| `launchers` | no | shell commands the ▶ Launch button can run — see below |

## How a plan gets launched

Two modes, picked automatically per project:

- **Pipeline** — the repo has `.claude/scripts/auto-pipeline.sh`. The dashboard delegates
  to it and reads back its reports, worktrees and lanes. Nothing to configure.
- **Generic** — everything else. You define one or more launcher commands; the dashboard
  runs the chosen one with `bash -lc` **in the repo root itself — no worktree** — captures
  its output, and tracks it to completion. A second run of the same plan is refused while
  one is live; two different plans launched at once would edit the same tree.
  `{plan}`, `{root}` and `{slug}` are substituted. The ⚙ setup dialog pre-fills commands
  from the repo's own `.claude/skills` and `.claude/scripts`.

A launcher that calls `claude -p` needs its tool permissions **on the command line**. Rules
in `.claude/settings.json` are not honoured in a headless session, and a denied call is not
a pause — it fails, and the run reports problems that never happened (`git status` "failed",
a test suite "missing"). The fix that keeps one source of truth is a wrapper script that
reads the repo's own allowlist and replays it onto `--allowedTools`, so interactive and
launched runs get the same rules from the same file.
[`scripts/launcher-template.sh`](../scripts/launcher-template.sh) is that script with two
spots to edit — copy it to `.claude/scripts/run-skill.sh` in the repo being registered.

![Launcher setup drawer: the project's saved launcher commands, a generic headless-Claude starting point, and the command box where the command is edited before saving](plans-dashboard-launchers.png)

Generic run state (pid, exit code, log) lives under `~/.claude/pipeline-dashboard/`.
Statuses and tags are written to `<plansDir>/plan-meta.json` when the repo already tracks
that file, otherwise centrally.

## AI session history

A plan's panel lists the Claude sessions that belong to that plan, with copy-ready commands
to resume the latest one, or to hand a fresh reviewer the diff and the transcript to
cross-check.

For generic projects the sessions are read out of the plan's own captured log, so the panel
lists **only runs launched from the dashboard**, and only that plan's. Two consequences
worth knowing: a launcher that does not emit `--output-format stream-json` leaves no session
ids behind and the panel stays empty; and sessions you ran by hand in that repo never
appear, because claude stores transcripts per working directory and nothing records which
plan one was about. Pipeline projects give each plan its own worktree, so their transcript
folder is already plan-specific and is listed whole.

## Running several plans at once

Generic launchers run in the repo root, so two plans launched together would edit the same
files. [`scripts/worktree-run.sh`](../scripts/worktree-run.sh) gives each plan its own git
worktree and branch, which is what makes a batch safe: tick several plans, hit ▶, and each
one gets an isolated tree.

Point the project's launcher at it and the dashboard needs no other change:

```json
{
  "label": "Parallel: worktree → implement → review",
  "cmd": "bash ~/Workspace/claude-config/scripts/worktree-run.sh --repo {root} --plan {plan} --prompt \"/implement %PLAN%\""
}
```

Use `%PLAN%` inside `--prompt`, not `{plan}` — the dashboard substitutes `{plan}` in the
command before the script ever runs.

Per plan it creates `<parent-of-repo>/worktrees/<slug>` on branch `auto/<slug>`, forked from
the repo's **current** branch (`--base` overrides), initialises submodules, copies gitignored
local files in (`--copy`, default `.env` — often the credentials a private package feed
needs), marks the new path trusted in `~/.claude.json` so the headless run honours your
allowlist, runs `--setup` if the repo needs an install step, then runs two phases: your
prompt, then `/code-review high --fix` with a re-test (`--review none` to skip). The work is
left uncommitted in the worktree for you to review.

One prerequisite catches people out: **a worktree is a checkout of the base branch, not a
copy of your working tree.** Anything the run needs — the plan, and every skill the prompt
invokes — must be committed there first. The script checks both and refuses rather than
launching a run that fails confusingly.

Clean up after merging:

```bash
scripts/worktree-run.sh --repo <repo> --cleanup <slug>
```

It deinitialises submodules first (they block `git worktree remove`) and refuses to discard
uncommitted work or delete an unmerged branch.

## Running it at login (macOS)

```bash
scripts/setup-macos.sh    # asks for a domain; Enter keeps plans.test
```

`scripts/setup.sh` runs this for you when you pick the dashboard part.

Then open **https://plans.test**. The script installs [Caddy](https://caddyserver.com)
if missing, a launchd agent that keeps the dashboard running on `127.0.0.1:4899`, and a
Caddy site that serves it over HTTPS and drops requests from other machines. It adds the
domain to `/etc/hosts` and trusts Caddy's certificate (both ask for your password). Re-run
it to change the domain or port. A re-run with unchanged settings leaves the running
dashboard and Caddy alone. When a restart is needed, plan runs already in progress keep
going. HTTPS is what lets the browser use the clipboard and notifications; if Firefox
still warns, set `security.enterprise_roots.enabled` in `about:config`.

- Restart after editing the dashboard: `launchctl kickstart -k gui/$(id -u)/com.plans-dashboard`
- Logs: `~/.claude/pipeline-dashboard/server.log`, `$(brew --prefix)/var/log/caddy.log`
- Remove: `launchctl bootout gui/$(id -u)/com.plans-dashboard`, `brew services stop caddy`,
  then delete the plist, the `import` line in `$(brew --prefix)/etc/Caddyfile` and the
  `/etc/hosts` line

## Environment

| Variable | Effect |
| --- | --- |
| `DASH_PORT` | port to listen on (default `4899`) |
| `DASH_NO_OPEN=1` | do not open a browser at startup |
| `DASH_NO_SUMMARY=1` | do not generate plain-language plan summaries |
| `DASH_SUMMARY_MODEL` | model the `claude` CLI uses for summaries (default `haiku`; e.g. `claude-opus-5-5`) |

Summaries are produced by calling the `claude` CLI, which **sends plan text to the
Anthropic API**. Set `DASH_NO_SUMMARY=1` for repos whose contents must not leave the machine.

## Exposure

The server refuses connections that do not come from the loopback interface, but it has no
authentication and no cross-origin checks, and its API can run shell commands. Treat it as
trusted-machine-only software.

## Tests

```bash
node --test 'scripts/test/*.test.mjs'
```

They run against a throwaway `HOME` and a throwaway repo — the real registry is untouched.
