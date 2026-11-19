# Scout

The scout looks for work once a day and proposes it on the plans dashboard. Nothing gets planned or built until you confirm it.

For each project in `~/.claude/scout.json`, it runs a few checks. Each new finding becomes a short proposal file in the project's plans folder. On the dashboard's **Board**, proposals wait in the **Proposed** column:

- **✓ Confirm** opens a new chat in the repo root that runs `/skill-1-plan` on the proposal. The plan replaces the proposal in the same file, then follows your usual flow: validation, Ready, ▶ Launch.
- **✕ Dismiss** archives the proposal to `done/`. The scout proposes it again only when it gets 2× worse.

A finding is proposed once. While its proposal or plan is open, the scout stays quiet about it. When its plan is archived without a dismiss (it was fixed), the scout waits 14 days before it proposes the finding again, so a fix that waits for its deploy does not come straight back.

Proposals do not pile up while you are away:

- **Resolved on their own.** A proposal you have not confirmed yet, whose problem is gone (the PR was merged, the alert closed, CI is green again), is archived with status `resolved`. This happens only when its check ran without failing. If the problem comes back, it is proposed again.
- **At most `maxOpen` wait** (default 15 per project). Findings that do not fit wait for a later run, the most urgent kinds first: red CI, production errors, slow endpoints, security, flaky tests, stuck PRs.
- **A lost proposal comes back.** When a proposal file is deleted without **Dismiss**, the next run proposes the finding again.

## It learns from your answers

- **A check is muted** after you dismiss its last 5 proposals in a row.
- **A finding is muted** after it was proposed 3 times and you never confirmed it, for example CI that keeps going red and green.
- A confirm, or a proposal that resolved on its own, breaks the row. A muted check still runs, and its step says what it found; it only writes no proposals.
- The **Checks** card in the 🔭 Scout drawer shows, per check, its runs, what it found, and how many proposals you confirmed (✓), dismissed (✕) or that resolved on their own (↻). A muted check or finding has **Unmute**: the count starts again from that moment.
- A check that finds nothing keeps running; the card says "0 found in N runs". The GitHub checks are free and a log query costs well under a cent, so turn a check off in `checks` only when you decide it never helps.
- Change the limits per project with `"learn": { "checkRun": 5, "keyRepeat": 3 }` in `~/.claude/scout.json`.

## Checks

| Check | Source | A proposal when |
|---|---|---|
| `ci-red` | `gh run list` on the base branch | the latest run of a workflow failed |
| `flaky` | `gh run list` on the base branch | in the last 7 days, a workflow failed and then passed on the same commit |
| `stuck-prs` | `gh pr list` | an open PR has conflicts, or no activity for `idleDays` (default 5) |
| `security` | Dependabot alerts | a package has open alerts (one proposal per package) |
| `prod-errors` | CloudWatch Logs Insights, `level >= 50` | an error is new, or happens 3× more often than its daily average over the 7 days before |
| `slow-endpoints` | CloudWatch Logs Insights, lines with `responseTime` and `req.url` | an endpoint's p95 doubled against the 7 days before, is over 500 ms, and both periods have 20+ requests |

The two log checks expect pino JSON logs (`level`, `msg`, `err`, `req.url`, `responseTime`). URLs are grouped by endpoint: ids, numbers and long tokens in the path become `:id`, `:n` and `:token`. The endpoint p95 is estimated from per-URL percentiles. It shows a trend, not an exact number.

Production text is written into the repo and sent to the Anthropic API for the summary. The scout first replaces emails, UUIDs, IP addresses and `token=`/`password=` values.

## Set it up

1. The project must be on the dashboard (`~/.claude/pipeline-projects.json`).
2. Copy [`scripts/scout.example.json`](../scripts/scout.example.json) to `~/.claude/scout.json`. Key each project by its dashboard name. Remove the `aws` block and the two log checks if the project has no CloudWatch logs.
3. For the log checks, give the scout its own read-only AWS access (below).
4. Try it: `node scripts/scout.mjs --dry-run`. It prints the findings and writes nothing.
5. Run it every day at 07:00: `node scripts/scout.mjs --install` (macOS). When the Mac sleeps at 07:00, it runs when the Mac wakes. The log is `~/.claude/pipeline-dashboard/logs/scout.log`.

The **🔭 Scout** button in the dashboard header shows the run: while it runs, each step with what it checks, why, what it found and how long it took; after it, the proposals it wrote and the ones that resolved on their own. A click on a step opens the Board filtered to that check's proposals. The last 60 runs per project are kept (`state/<project>/scout-runs.json`), a page at a time. Below them: each setup step on this Mac (✓ done, or the command to copy), **▶ Run now**, and the raw log, which the scout trims to its last 256 KB once it passes 1 MB. The button shows ○ while a setup step is missing and ⚠ when a check failed in the last run.

### A new Mac

The config (`~/.claude/scout.json`) and the AWS keys stay on each Mac; they are not in this repo. `scripts/setup.sh` installs the daily job when the config is already there. Otherwise, open **🔭 Scout** and follow its steps: copy the config from your other Mac, run `aws configure --profile <profile>` with the scout user's keys, then `--install`. Run the scout on one Mac only, or each Mac proposes the same findings.

Run the install again after you change your `PATH` or your node version. The job keeps the `PATH` of the shell that installed it, because it calls `gh`, `aws` and `claude`.

| Setting | Default | Meaning |
|---|---|---|
| `base` | `main` | the branch the CI checks look at |
| `checks` | all | which checks run |
| `model` | `sonnet` | the model that writes each proposal's summary |
| `idleDays` | `5` | days without activity before a PR counts as stuck |
| `maxOpen` | `15` | how many proposals may wait for you at a time |
| `aws.profile`, `aws.region` | none | the AWS CLI profile and region for Logs Insights |
| `aws.logGroups` | none | the log groups the error check reads |
| `aws.requestLogGroups` | the first of `logGroups` | the log groups with the request lines |
| `aws.slow` | `{ "factor": 2, "floorMs": 500, "minRequests": 20 }` | the slow-endpoint thresholds |

## Read-only AWS access

The scout runs with nobody at the keyboard, so it needs credentials that do not expire every few hours and that can do nothing but read logs. Create an IAM user (or a role you assume from one) with only this policy, then put its keys in `~/.aws/credentials` under the profile name you set in `aws.profile`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "logs:StartQuery",
      "Resource": ["arn:aws:logs:<region>:<account-id>:log-group:<log-group>:*"] },
    { "Effect": "Allow", "Action": ["logs:GetQueryResults", "logs:StopQuery"], "Resource": "*" }
  ]
}
```

List each log group from `aws.logGroups` under `Resource`. `GetQueryResults` and `StopQuery` cannot be limited to a log group, which is why their resource is `*`.

Never point the scout at a root or admin profile. When a check fails (for example, expired credentials), the other checks still run, the log says why, and a notification says that a check failed.

## Proposal files

A proposal is `<plansDir>/<date>-<time>-scout-<check>-<title>.md`, with status `proposed` and the tags `scout` and the check name. When the plans folder is tracked in git, a proposal shows as an untracked file until you confirm it (the plan is then committed as usual) or dismiss it.

What the scout has proposed is in `~/.claude/pipeline-dashboard/state/<project>/scout.json`. Delete an entry there to make the scout forget a finding.
