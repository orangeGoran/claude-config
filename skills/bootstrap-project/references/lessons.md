# Lessons from earlier setups

TLDR: two projects were set up by hand by copying from the last repo. Most errors were permission errors, and every part that Claude left out by its own choice was asked back within days. Each lesson below says what went wrong and how this skill prevents it. Read it before the interview.

## Permissions and the harness

1. **Never put push or PR commands in `deny`.** A deny rule beats every allow rule, also the per-run `--allowedTools` overlay. A deny `git push*` blocked requested pushes, and a deny `gh pr create*` blocked the first "to PR" run. → `settings.json` denies only destructive commands. Push and PR rules exist only in the "to PR" overlay of `auto-pipeline.sh`. `verify.mjs` fails when a deny rule matches an overlay command, or when the shared allow list has a push or PR rule.
2. **Claude cannot edit its own permission files** in auto mode ("Self-Modification"). → `settings.json` is complete on day one, written in the interactive bootstrap session that the owner approves. When the session refuses, the owner runs the `--apply` command with `!`.
3. **Claude Code refuses edits under `~/.claude/`**, even with an allow rule. → Run reports live in `<repo>/.plans/auto-runs/` (gitignored). Registry and profile changes are shell commands from `register.mjs`, with a backup, after the owner's yes.
4. **Headless runs auto-deny compound commands** (`&&`, `|`, redirection, heredocs). → Every skill says "run bare commands, one per call". `verify.mjs` checks each `SKILL.md`. Commands in `bootstrap.json` must be bare.
5. **Worktrees are untrusted**, so `settings.json` allow rules do not apply there. → `auto-pipeline.sh` replays `settings.json` + `settings.local.json` + the run overlay through `--allowedTools`, and offers to mark the worktree trusted (with a backup of `~/.claude.json`). Do not put a push rule in `settings.local.json`: it is replayed too.
6. **New skills and agents load only after a session reload.** A validator created mid-session was "not found". → The hand-off says to reload. The skill never calls the skills it just wrote. `skill-validate-plan` falls back to a general agent that reads the agent file.
7. **The tooling must be on `origin/<base>`** before the first launch: worktrees start from the remote. → The hand-off prints the push commands first. `verify.mjs` shows it as a tip.
8. **Skill names are functional.** The dashboard live check and the VS Code session copy match `skill-auto-pipeline` as text; the lanes drawer copies `/skill-auto-validate-plan`. → Fixed names (contracts.md); `verify.mjs` checks them. Also do not name a skill `/plan`: it clashes with the built-in command.
9. **zsh does not split words** in `$VAR` loops: a bulk `sed` over `$FILES` silently changed nothing. → Templates are rendered by `render.mjs`, not by shell loops. After any bulk edit, check the result with a search.
10. **Run needs must be in the overlay or the allow list** (services, docker, migrations, `git mv`, every "How to verify" command), or the first headless run is BLOCKED. → Interview question 11 (`pipeline.runAllow`). The first plan uses only `grep`, which is allowed.
10a. **Headless runs cannot write `.claude/` or `.vscode/`**, even with `Edit(./**)` allowed: the first real Phase 0a run could not create `.vscode/settings.json`. → `skill-1-plan` marks such steps "(owner, by hand)", and `skill-auto-pipeline` lists them as Open items instead of failing.

## Process

11. **Build the full chain on day one.** Every part dropped "because the repo has no code yet" (changelog, AGENTS.md split, develop branch, Codex, plan/test/verify skills) was asked back. → All modules are on by default, Codex too. A module whose command is missing says "not available yet" and does nothing.
12. **Run one small real plan end to end on day one.** The first run found three harness bugs. A test run of this skill found two more: install output (`node_modules/`, a new lock file) left the worktree unclean, so ship stopped with `BLOCKED`. → The bootstrap writes "Check the pipeline end to end" and the hand-off says to launch it in "to PR" mode. `.gitignore` has `node_modules/`, and the hand-off commits the lock file with the setup.
13. **Never run `git add`, `commit`, `push`, `stash` or `reset`** in the bootstrap. `git add -N` and `git rm --cached` also write the index. → The hand-off prints one copy-paste block. Previews use `git status --untracked-files=all` and `git diff --no-index`. One final block avoids two near-duplicate setup commits.
14. **Clean up after a merge:** `auto-pipeline.sh --cleanup <slug>`. → The cleanup also runs `git fetch --prune`, so stale `origin/auto/*` refs go away.
15. **Write cross-session decisions to project memory** (the push rule, the run setup), so a new session keeps them. AGENTS.md stays lean: current state only.
16. **claude-config is a public repo with no `.gitignore`.** → Templates hold no client or project names, no private paths and no project rules. Project values come from the interview. Generated `$schema` paths are built at run time, not stored.

## GitHub and content

17. **A free private repo cannot use rulesets** (`POST /rulesets` → 403). → Ask about protection; offer "none" or a local pre-push hook, and say that GitHub Pro is the other way.
18. **Check sensitive content before the first push.** Names of people, machines and clients in the parent plan decided the visibility. → Interview question 1.
19. **The dashboard's own fix prompts ask for less** (a single `implement` skill, plain kebab plan names) than the owner's convention. → Use this skill, not the fix prompts, for a new repo. Plan names keep the `YYYYMMDD-HHMMSS-` prefix.
20. **Copied allow lists collect junk** (one-off `/tmp` files, absolute paths of old checkouts). → The allow list is built from the answers only: repo read/edit, read-only git, the real commands, the module rules, and `rules.extraAllow`.
21. **Copied scripts drift** (four versions of `auto-pipeline.sh` in four repos). → One template source. `--upgrade` shows the diff of every file against the template.
