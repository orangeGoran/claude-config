#!/usr/bin/env node
// Multi-project plans & pipeline dashboard (global, zero deps).
//
//   node ~/Workspace/claude-config/scripts/plans-dashboard.mjs   →  http://127.0.0.1:4899
//
// Projects are registered in ~/.claude/pipeline-projects.json:
//   { "projects": [ { "name": "...", "client": "...", "root": "<repo>",
//                     "plansDir": "<any folder with *.md plans>",
//                     "launchers": [ { "label": "...", "cmd": "... {plan} ..." } ] } ] }
// See pipeline-projects.example.json next to this file, `--help` for the options,
// and docs/plans-dashboard.md for the full field reference.
//
// Two flavors per project, auto-detected:
//  - auto-pipeline: <root>/.claude/scripts/auto-pipeline.sh exists → full solver-style
//    features (modes, resume, worktrees, reports, cleanup, lanes). The script can list
//    its own modes (`--describe`) and say in its report when a run needs you.
//  - generic: plans launch via per-project launcher commands ({plan}/{root}/{slug}
//    placeholders). First launch opens a setup dialog that discovers the repo's
//    .claude/skills and .claude/scripts. Runs are tracked by the dashboard itself
//    (pid + captured log under ~/.claude/pipeline-dashboard/).
//
// State (JSON hybrid): if <plansDir>/plan-meta.json exists (tracked in the repo)
// it stays the source for statuses/tags; otherwise state lives centrally in
// ~/.claude/pipeline-dashboard/state/<project>/. Logs are always central for
// generic runs. Localhost only.
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import {
  readFileSync, readdirSync, existsSync, openSync, mkdirSync, unlinkSync,
  writeFileSync, renameSync, statSync, closeSync, readSync, realpathSync,
} from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { OTHER, inlineHtml, findIssues, readMeta } from './artifact-copies.mjs';
import { olderVersions } from './page-versions.mjs';

const VERSION = '1.0.0';
const HOME = os.homedir();
const REG_FILE = path.join(HOME, '.claude', 'pipeline-projects.json');
const CENTRAL = path.join(HOME, '.claude', 'pipeline-dashboard');
// report pages written by the browser-usability-test skill, one folder per project
const QA_REPORTS = process.env.QA_HOME || path.join(HOME, '.claude', 'browser-usability-test', 'projects');
const QA_PORT = +(process.env.QA_REPORTS_PORT || 4898);
// Claude Code's per-session temp folders; HTML in their scratchpads shows as unpublished drafts
const CLAUDE_TMP = process.env.CLAUDE_TMP ?? `/private/tmp/claude-${process.getuid?.() ?? ''}`;
const PORT = +(process.env.DASH_PORT || 4899);
const NO_SUMMARY = !!process.env.DASH_NO_SUMMARY;
const SUMMARY_MODEL = process.env.DASH_SUMMARY_MODEL || 'haiku';
// the claude-config checkout this script lives in — onboarding points prompts at its
// docs and launcher template, and scans its parent folder for sibling repos
const DASH_REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`plans-dashboard ${VERSION} — local web dashboard for plan files across projects

  node plans-dashboard.mjs            start the server (default http://127.0.0.1:4899)

Options
  -h, --help          show this help
  -v, --version       print the version

Environment
  DASH_PORT=<n>       port to listen on (default 4899). Ports below 1024 bind on
                      0.0.0.0 because macOS forbids binding them on 127.0.0.1;
                      non-loopback connections are still refused per request.
  DASH_NO_OPEN=1      do not open a browser window at startup
  DASH_NO_SUMMARY=1   do not call the claude CLI to summarize plans. Summaries
                      send plan text to the Anthropic API — set this for repos
                      whose contents must not leave the machine.
  DASH_SUMMARY_MODEL=<m>
                      model the claude CLI uses for summaries (default haiku),
                      e.g. sonnet or claude-opus-5-5
  QA_REPORTS_PORT=<n> port for the browser-usability-test report pages
                      (default 4898, http://localhost:<n>/<project>/<file>.html)
  QA_HOME=<dir>       where those reports live (default
                      ~/.claude/browser-usability-test/projects)

Files
  ${REG_FILE}
      the project registry — see pipeline-projects.example.json next to this script
  ${CENTRAL}
      logs, run records and per-project state for projects with no plan-meta.json`);
  process.exit(0);
}
// macOS lets unprivileged processes bind low ports (e.g. 80) only on 0.0.0.0,
// never on 127.0.0.1 — so for low ports we bind wide but enforce loopback-only
// per connection below, keeping the app unreachable from the LAN.
const BIND = PORT < 1024 ? '0.0.0.0' : '127.0.0.1';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// The loopback check keeps other machines out, but the browser on this machine is
// loopback too: any website open in it could POST here and run a launcher. So every
// request must also name a local host (blocks DNS rebinding — a public name pointed
// at 127.0.0.1) and must not come from another site (Origin / Sec-Fetch-Site).
// Local hosts: loopback IPs, localhost, *.localhost, and any name /etc/hosts maps to
// loopback (e.g. plans.test) — a web page cannot add one. /etc/hosts is re-read on a
// miss, at most every 5 s, so a domain added while the server runs still works.
let hostsNames = new Set(), hostsReadAt = 0;
const readHostsFile = () => {
  hostsReadAt = Date.now();
  const names = new Set();
  try {
    for (const line of readFileSync('/etc/hosts', 'utf8').split('\n')) {
      const [ip, ...rest] = line.replace(/#.*/, '').trim().split(/\s+/);
      if (LOOPBACK.has(ip) || ip === '127.0.1.1') rest.forEach((n) => names.add(n.toLowerCase()));
    }
  } catch {}
  hostsNames = names;
};
const isLocalHost = (hostname) => {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]') return true;
  if (hostsNames.has(h)) return true;
  if (Date.now() - hostsReadAt > 5000) { readHostsFile(); return hostsNames.has(h); }
  return false;
};
const hostOf = (s) => { try { return new URL(s).host; } catch { return null; } };
// returns a reason string when the request must be refused, null when it is fine
const crossSiteReason = (req) => {
  let url;
  try { url = new URL('http://' + (req.headers.host || '')); } catch { return 'unknown host'; }
  if (!url.hostname || !isLocalHost(url.hostname)) return 'unknown host';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'cross-site request';
  const origin = req.headers.origin;
  // behind Caddy the Origin is https://plans.test and Host is plans.test — compare host[:port]
  if (origin !== undefined && hostOf(origin) !== url.host) return 'cross-site request';
  return null;
};
readHostsFile();

const expand = (p) => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
// under launchd the PATH is minimal (/usr/bin:/bin:…) — no nvm node, no claude,
// no code. Augment it for every child process this server spawns.
const ENV = {
  ...process.env,
  PATH: [
    process.env.PATH || '',
    path.dirname(process.execPath),        // the node running this server (nvm)
    path.join(HOME, '.local', 'bin'),      // claude CLI
    ...[process.env.PNPM_HOME || path.join(HOME, 'Library', 'pnpm')]
      .flatMap((d) => [path.join(d, 'bin'), d]), // pnpm standalone install (repo launchers)
    '/usr/local/bin', '/opt/homebrew/bin', // code, brew tools
  ].filter(Boolean).join(':'),
};
const loadJson = (f, fallback = {}) => {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; }
};

// ---------- registry ----------

const loadRegistry = () => {
  const reg = loadJson(REG_FILE, null);
  return reg && Array.isArray(reg.projects) ? reg.projects : [];
};
const saveRegistry = (projs) =>
  writeFileSync(REG_FILE, JSON.stringify({ projects: projs }, null, 2) + '\n');

const issuesCache = {};
const issuesUrlFor = (root) => {
  if (!(root in issuesCache)) {
    try {
      const out = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'],
        { timeout: 5000 }).toString();
      const m = out.trim().match(/github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/);
      issuesCache[root] = m ? `https://github.com/${m[1]}/issues/` : '';
    } catch { issuesCache[root] = ''; }
  }
  return issuesCache[root];
};

// resolve one registry entry into full per-project config (paths, flavor, state files)
const resolveProject = (p) => {
  const root = expand(p.root);
  const plansDir = expand(p.plansDir) || path.join(root, '.plans');
  const stateDir = path.join(CENTRAL, 'state', p.name);
  const trackedMeta = path.join(plansDir, 'plan-meta.json');
  const autoRunsDir = path.join(plansDir, 'auto-runs');
  const pipeSummaries = path.join(autoRunsDir, 'plan-summaries.json');
  const launcherScript = path.join(root, '.claude/scripts/auto-pipeline.sh');
  return {
    name: p.name, client: p.client || 'Default', root, plansDir,
    color: /^#[0-9a-f]{3,8}$/i.test(p.color || '') ? p.color : '', short: p.short ? String(p.short).slice(0, 12) : '',
    launchers: Array.isArray(p.launchers) ? p.launchers : [],
    hasPipeline: existsSync(launcherScript), launcherScript,
    hasLanes: existsSync(path.join(root, '.claude/scripts/plan-lanes.mjs')),
    worktrees: path.join(path.dirname(root), 'worktrees', path.basename(root)),
    legacyWorktrees: path.join(path.dirname(root), 'worktrees'),
    doneDir: expand(p.doneDir) || path.join(plansDir, 'done'),
    validDir: path.join(plansDir, '.validations'),
    autoRunsDir,
    metaFile: existsSync(trackedMeta) ? trackedMeta : path.join(stateDir, 'plan-meta.json'),
    summaryFile: existsSync(pipeSummaries) ? pipeSummaries : path.join(stateDir, 'plan-summaries.json'),
    summaryStyleFile: path.join(stateDir, 'summary-style.json'),
    stateDir,
    logsDir: path.join(CENTRAL, 'logs', p.name),
    runsFile: path.join(stateDir, 'runs.json'),
    issuesUrl: issuesUrlFor(root),
  };
};
// Pipeline modes. A script that handles `--describe)` prints its own modes as JSON:
//   { "default": "pr", "modes": [ { "id": "verify", "flag": "--stop-at-verify", "label": "..." }, ... ] }
// `id` is what the report's `**Mode**:` line holds, `flag` what launch and resume pass.
// `default` (optional) is the mode a new plan starts on; without it, the first mode.
// Without it, the two modes every auto-pipeline.sh has. The script is only run when its
// text has the case, so a script that would read --describe as a plan file never sees it.
const DEFAULT_MODES = [
  { id: 'verify', flag: '--stop-at-verify', label: 'stop at verify — I review by hand', default: true },
  { id: 'commit', flag: '--full', label: 'full — through local commit' },
];
const modesCache = {}; // script path -> { key: mtime, modes }
const pipelineModes = (proj) => {
  if (!proj.hasPipeline) return [];
  let key;
  try { key = statSync(proj.launcherScript).mtimeMs; } catch { return DEFAULT_MODES; }
  const hit = modesCache[proj.launcherScript];
  if (hit && hit.key === key) return hit.modes;
  let modes = DEFAULT_MODES;
  try {
    if (/^\s*--describe\)/m.test(readFileSync(proj.launcherScript, 'utf8'))) {
      const out = execFileSync('bash', [proj.launcherScript, '--describe'],
        { cwd: proj.root, env: ENV, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const spec = JSON.parse(out);
      const list = (spec.modes || []).filter((m) => m && safeName(m.id)
        && /^--[a-z0-9-]+$/.test(m.flag || '') && typeof m.label === 'string');
      const def = list.some((m) => m.id === spec.default) ? spec.default : list[0]?.id;
      if (list.length) modes = list.map(({ id, flag, label }) =>
        ({ id, flag, label: label.slice(0, 80), ...(id === def ? { default: true } : {}) }));
    }
  } catch (e) { console.log(`--describe failed for ${proj.name}: ${e.message || e}`); }
  modesCache[proj.launcherScript] = { key, modes };
  return modes;
};
const allProjects = () => loadRegistry().map(resolveProject);
const projByName = (name) => allProjects().find((p) => p.name === name);

// the project's own .claude/scripts/plan-lanes.mjs: which plans can run in parallel
const runLanes = (proj) => new Promise((resolve) =>
  execFile(process.execPath, [path.join(proj.root, '.claude/scripts/plan-lanes.mjs'), '--json'],
    { cwd: proj.root, env: ENV, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ error: String(err) });
      try { resolve(JSON.parse(stdout)); } catch { resolve({ error: 'analyzer returned invalid JSON' }); }
    }));
// a prompt for Claude Code that adds the missing lane checkers; the dashboard reads the fields listed in it
const lanesFixPrompt = (missing, model) => [
  'Add a plan lane checker to ' + (missing.length === 1 ? 'this repo' : 'these repos') +
    ', so the plans dashboard can suggest which plans can run in parallel across all projects:',
  '',
  ...missing.map((p) => '- ' + p.name + ': ' + tilde(p.root) + ' (plans in ' + tilde(p.plansDir) + ')'),
  '',
  'In each repo, create .claude/scripts/plan-lanes.mjs. It reads every plan in the plans folder, finds the repo files each plan says it will touch, and puts plans that share files into one "lane" (they must run one after another). Plans in different lanes can run at the same time in separate worktrees.',
  model
    ? 'Read ' + tilde(path.join(model.root, '.claude/scripts/plan-lanes.mjs')) + ' first and follow it. Adapt it to each repo: its plans folder, its source layout, and its own list of shared files that many plans only append to (registrations, enums, translation files). Those files must not force plans into one lane.'
    : 'Treat shared files that many plans only append to (registrations, enums, translation files) as soft conflicts: they must not force plans into one lane.',
  '',
  '`node .claude/scripts/plan-lanes.mjs --json` must print one JSON object with:',
  '- schedulableCount, laneCount, maxParallel: numbers',
  '- recommendedBatch: [{ slug, file, areas: [string], validation: { claude, codex } }], the plans to start now, at most one per lane',
  '- lanes: [{ lane, label, members: [slug] }]',
  '- inFlight: [{ slug, autoRunStatus }], plans already running or waiting for review',
  '',
  'Run it in each repo and check the lanes against the real plans. Do not commit.',
].join('\n');

// ---------- per-project data ----------

const planFiles = (proj) => {
  try { return readdirSync(proj.plansDir).filter((f) => f.endsWith('.md')).sort(); }
  catch { return []; }
};
const doneFiles = (proj) => {
  try { return readdirSync(proj.doneDir).filter((f) => f.endsWith('.md')).sort(); }
  catch { return []; }
};
const loadMeta = (proj) => loadJson(proj.metaFile);
const saveMeta = (proj, m) => {
  mkdirSync(path.dirname(proj.metaFile), { recursive: true });
  writeFileSync(proj.metaFile, JSON.stringify(m, null, 2) + '\n');
};
const loadSummaries = (proj) => loadJson(proj.summaryFile);
// slug -> SUMMARY_STYLE the summary was written with. Kept apart from plan-summaries.json
// (which can live in the project repo) so that file stays a plain slug -> text map.
const loadSummaryStyles = (proj) => loadJson(proj.summaryStyleFile);
const saveSummaries = (proj, s) => {
  mkdirSync(path.dirname(proj.summaryFile), { recursive: true });
  writeFileSync(proj.summaryFile, JSON.stringify(s, null, 2));
};

const planTitle = (content) => {
  const m = content.match(/^#\s*(?:Plan:\s*)?(.+)$/m);
  return m ? m[1].trim() : null;
};
// A plan may name its branch ("- **Branch**: fix/case-overview") when its PR is not on the
// pipeline's auto/<slug>, for example a PR opened before the plan was written. Such a plan
// gets that branch's PR and the worktree on that branch.
const planBranch = (content) => {
  const m = content.match(/^\s*[-*]\s*\*\*Branch\*\*:\s*`?([\w./-]+)`?\s*$/m);
  return m ? m[1] : null;
};
const planBranches = {};   // root -> { slug: branch named in the plan }
// the branch a plan names, when it is not the pipeline's own auto/<slug>
const ownBranch = (proj, slug) => {
  const b = (planBranches[proj.root] || {})[slug];
  return b && b !== 'auto/' + slug ? b : null;
};
const validationRounds = (proj, slug) => {
  try {
    return readdirSync(proj.validDir).filter(
      (f) => f.startsWith(slug + '-validation-') || f.startsWith(slug + '-codex-'),
    ).length;
  } catch { return 0; }
};

// Where a run stands, for the strips and buttons: 'running' | 'needs-you' | 'failed'.
// A report that has no `**Outcome**:` line is judged by its status words.
const OUTCOMES = ['running', 'needs-you', 'failed'];
const outcomeOf = (status) =>
  /^(VERIFIED|REVIEWED|COMMITTED|FINISHED|PR OPEN)/i.test(status) ? 'needs-you'
  : /^(BLOCKED|FAILED|ENDED)/i.test(status) ? 'failed' : 'running';

// The run-report lines both flavors read: `## Status:`, `- **Outcome**:`, `- **Mode**:`
// and `- **Link**: <label> | <url>` (one button each in the strip and the plan view).
// Missing lines come back as null / [].
const parseReport = (content) => {
  const outcome = ((content.match(/^- \*\*Outcome\*\*:\s*(\S+)/m) || [])[1] || '').toLowerCase();
  return {
    status: ((content.match(/^## Status:\s*(.+)$/m) || [])[1] || '').trim() || null,
    outcome: OUTCOMES.includes(outcome) ? outcome : null,
    mode: (content.match(/^- \*\*Mode\*\*:\s*([\w-]+)/m) || [])[1] || null,
    links: [...content.matchAll(/^- \*\*Link\*\*:\s*(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/gm)]
      .map((m) => ({ label: m[1].slice(0, 40), url: m[2] })).slice(0, 5),
  };
};

// pipeline flavor: report lives in <plansDir>/auto-runs/<slug>.md
const pipelineRunInfo = (proj, slug) => {
  const report = path.join(proj.autoRunsDir, slug + '.md');
  if (!existsSync(report)) return null;
  const content = readFileSync(report, 'utf8');
  const r = parseReport(content);
  const status = r.status || 'unknown';
  const timeline = [...content.matchAll(/^- (20\d\d[^\n]+)$/gm)].map((m) => m[1]);
  // the launcher writes Outcome only after its own sessions; a chat that later fixes
  // the run moves the status on (e.g. to "PR OPEN") and leaves a stale "failed" behind
  const stale = r.outcome === 'failed' && outcomeOf(status) !== 'failed';
  return { ...r, status, lastEvent: timeline.at(-1) || '',
    outcome: !stale && r.outcome || outcomeOf(status) };
};
// An interactive claude chat (VS Code, terminal) can continue a run inside the
// worktree after the headless pipeline exits. pgrep does not see that chat, so the
// card showed the report's frozen status. A chat counts as live when a claude
// process has the worktree as its cwd and its transcript changed in the last
// CHAT_ACTIVE_MS. The time check skips a chat that is open but idle.
const CHAT_ACTIVE_MS = 10 * 60 * 1000;
let claudeCwds = { at: 0, set: new Set() };
const claudeProcessCwds = () => {
  if (Date.now() - claudeCwds.at < 4000) return claudeCwds.set;
  let out = '';
  try { out = execFileSync('lsof', ['-a', '-c', 'claude', '-d', 'cwd', '-Fn'], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; } // lsof exits 1 when it cannot read one process
  const set = new Set(out.split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1)));
  claudeCwds = { at: Date.now(), set };
  return set;
};
const chatActiveIn = (wtPath) => {
  if (!claudeProcessCwds().has(wtPath)) return false;
  const dir = transcriptDirFor(wtPath);
  try {
    return readdirSync(dir).some((f) => f.endsWith('.jsonl')
      && Date.now() - statSync(path.join(dir, f)).mtimeMs < CHAT_ACTIVE_MS);
  } catch { return false; }
};
// a run's worktree: the per-project folder, or the flat folder older runs still live in
const worktreeOf = (proj, slug) => {
  const wt = path.join(proj.worktrees, slug), legacy = path.join(proj.legacyWorktrees, slug);
  return !existsSync(wt) && existsSync(legacy) ? legacy : wt;
};
const pipelineLive = (proj, slug) =>
  new Promise((resolve) => {
    execFile('pgrep', ['-f', `skill-auto-pipeline ${slug}.md`], (err) =>
      // the chat panel's own claude runs there too, and chatting is not running the plan
      resolve(!err || (!chats.has(proj.name + '/' + slug) && chatActiveIn(worktreeOf(proj, slug)))));
  });

// generic flavor: runs tracked by this dashboard in <stateDir>/runs.json
const loadRuns = (proj) => loadJson(proj.runsFile);
const saveRuns = (proj, r) => {
  mkdirSync(proj.stateDir, { recursive: true });
  writeFileSync(proj.runsFile, JSON.stringify(r, null, 2));
};
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// Each run also records its own exit code to <stateDir>/<slug>.exit (see launchGeneric).
// The in-memory 'exit' listener is lost whenever this server restarts — under launchd
// it restarts on every edit of this file — so the file is the durable source of truth,
// and it is also immune to the pid having been recycled by an unrelated process.
const runExitFile = (proj, slug) => path.join(proj.stateDir, slug + '.exit');
// A launcher may write the same report lines as a pipeline run to $PLAN_REPORT
// (see launchGeneric). Without them, the exit code decides, as it always has.
const runReportFile = (proj, slug) => path.join(proj.stateDir, slug + '.report.md');
const readExit = (proj, slug) => {
  try {
    const f = runExitFile(proj, slug);
    const raw = readFileSync(f, 'utf8').trim();
    if (!raw) return null;
    const code = Number(raw);
    return { code: Number.isFinite(code) ? code : -1, at: new Date(statSync(f).mtimeMs).toISOString() };
  } catch { return null; }
};
const genericRunInfo = (proj, slug) => {
  const r = loadRuns(proj)[slug];
  if (!r) return { run: null, live: false };
  const onDisk = r.exitCode == null ? readExit(proj, slug) : null;
  const code = r.exitCode != null ? r.exitCode : onDisk ? onDisk.code : null;
  const finishedAt = r.finishedAt || (onDisk ? onDisk.at : null);
  const live = code == null && pidAlive(r.pid);
  let status;
  if (live) status = 'RUNNING — ' + (r.label || 'launcher');
  else if (code === 0) status = 'FINISHED — review the result';
  else if (code != null) status = 'FAILED: exit ' + code;
  else status = 'ENDED — process is gone and recorded no exit code';
  let rep = { links: [] };
  try { rep = parseReport(readFileSync(runReportFile(proj, slug), 'utf8')); } catch {}
  // a report's needs-you or failed wins once the process is gone; its "running" does
  // not, or a launcher that dies mid-run would stay in progress for ever
  const told = !live && (rep.outcome === 'needs-you' || rep.outcome === 'failed');
  return {
    run: { status: told && rep.status || status, outcome: told ? rep.outcome : outcomeOf(status),
      links: rep.links,
      lastEvent: (finishedAt ? 'finished ' + finishedAt : 'started ' + r.startedAt) || '' },
    live,
  };
};

// claude stores headless transcripts under ~/.claude/projects/<encoded-cwd>/
const transcriptDirFor = (cwd) =>
  path.join(HOME, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
// Every generic run of every plan shares one transcript dir — the repo root's —
// so listing it whole attributed all 92 sessions ever run in that repo, the
// interactive ones included, to each individual plan, and pointed the "reopen
// the latest session" command at whatever the user happened to do there last.
// A plan's own captured log names the sessions that really belong to it: claude
// stamps session_id on every stream-json event, and the log is appended across
// runs, so a second run adds to the list rather than replacing it.
// Cached on the log's size+mtime — /api/state is polled every 5s per plan.
const sessionIdCache = {};
const sessionIdsInLog = (proj, slug) => {
  const f = path.join(proj.logsDir, slug + '.log');
  try {
    const st = statSync(f);
    const key = st.mtimeMs + ':' + st.size;
    const hit = sessionIdCache[f];
    if (hit && hit.key === key) return hit.ids;
    const ids = new Set(
      [...readFileSync(f, 'utf8').matchAll(/"session_id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    sessionIdCache[f] = { key, ids };
    return ids;
  } catch { return new Set(); }
};
// `only` limits the listing to those ids. Omitted for the auto-pipeline flavor,
// whose transcript dir is the plan's own worktree and so is already per-plan.
const sessionsIn = (dir, only) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace(/\.jsonl$/, ''))
      .filter((id) => !only || only.has(id))
      .map((id) => {
        const st = statSync(path.join(dir, id + '.jsonl'));
        return { id, mtime: st.mtimeMs, size: st.size };
      }).sort((a, b) => a.mtime - b.mtime);
  } catch { return []; }
};

const listPlans = async (proj) => {
  const summaries = loadSummaries(proj);
  const meta = loadMeta(proj);
  const prs = prsFor(proj);
  const allPrs = (prLists[proj.root] || {}).allByBranch || {};
  const branches = planBranches[proj.root] = {};
  const prOf = (slug) => { const b = ownBranch(proj, slug); return (b ? allPrs[b] : prs['auto/' + slug]) || null; };
  const active = await Promise.all(
    planFiles(proj).map(async (f) => {
      const slug = f.replace(/\.md$/, '');
      const key = proj.name + '/' + slug;
      const content = readFileSync(path.join(proj.plansDir, f), 'utf8');
      branches[slug] = planBranch(content);
      let run, live;
      if (proj.hasPipeline) {
        run = pipelineRunInfo(proj, slug);
        live = await pipelineLive(proj, slug);
      } else ({ run, live } = genericRunInfo(proj, slug));
      return {
        slug, file: f, key,
        title: planTitle(content) || slug,
        summary: summaries[slug] || null,
        summarizing: summarizing === key || summaryQueue.some((q) => q.key === key),
        launch: live ? null : launches.get(key) || null,
        validations: validationRounds(proj, slug),
        run, live,
        worktree: proj.hasPipeline && existsSync(worktreeOf(proj, slug)),
        status: meta[slug]?.status || null,
        tags: meta[slug]?.tags || [],
        ...planSessions(proj, slug),
        asked: existsSync(chatFile(proj, slug)),
        chatting: !!chats.get(key)?.busy,
        chatWaits: chats.get(key)?.waits.size || 0,
        pr: prOf(slug),
      };
    }),
  );
  // archived plans (doneDir): read-only rows — no run state, no summarizer cost
  const activeSlugs = new Set(active.map((p) => p.slug));
  const archived = doneFiles(proj)
    .map((f) => f.replace(/\.md$/, ''))
    .filter((slug) => !activeSlugs.has(slug))
    .map((slug) => {
      let title = slug;
      try {
        const content = readFileSync(path.join(proj.doneDir, slug + '.md'), 'utf8');
        title = planTitle(content) || slug;
        branches[slug] = planBranch(content);
      } catch {}
      const key = proj.name + '/' + slug;
      return {
        slug, file: slug + '.md', key, title,
        summary: summaries[slug] || null, summarizing: false,
        validations: validationRounds(proj, slug),
        run: null, live: false, worktree: false, archived: true,
        status: meta[slug]?.status || null, tags: meta[slug]?.tags || [],
        ...planSessions(proj, slug),
        asked: existsSync(chatFile(proj, slug)),
        chatting: !!chats.get(key)?.busy,
        chatWaits: chats.get(key)?.waits.size || 0,
        pr: prOf(slug),
      };
    });
  return [...active, ...archived];
};

const fullState = async () => {
  const out = [];
  for (const entry of loadRegistry()) {
    const proj = resolveProject(entry);
    out.push({
      name: proj.name, client: proj.client, root: proj.root, plansDir: proj.plansDir,
      color: proj.color, short: proj.short,
      hasPipeline: proj.hasPipeline, hasLanes: proj.hasLanes,
      modes: pipelineModes(proj).map(({ flag, ...m }) => m),
      launchers: proj.launchers, issuesUrl: proj.issuesUrl,
      // only a repo on GitHub can have PRs, so only there is a gh failure worth saying
      prError: proj.issuesUrl ? (prLists[proj.root] || {}).error || '' : '',
      setupLevel: projectHealth(proj.root, entry).level,
      plans: await listPlans(proj),
      // a worktree on a branch that a plan names shows as that plan, not twice
      worktrees: proj.issuesUrl ? worktreesFor(proj)
        .filter((w) => !Object.values(planBranches[proj.root] || {}).includes(w.branch)) : [],
    });
  }
  return out;
};

// ---------- background summarizer (auto, sequential, cached per project) ----------

let summarizing = null; // key = "<project>/<slug>"
const summaryQueue = [];
const summaryFailed = new Set();

// bump when the prompt below changes: every summary written with an older style is remade
const SUMMARY_STYLE = 2;
const explain = (proj, slug) =>
  new Promise((resolve, reject) => {
    const content = readFileSync(path.join(proj.plansDir, slug + '.md'), 'utf8').slice(0, 24000);
    const prompt =
      'Summarize this implementation plan in 3-5 sentences for someone completely new to the project. ' +
      'Say WHAT will be built and WHY it matters. No jargon, no file paths.\n' +
      'Write in ASD-STE100 Simplified Technical English: ' +
      'one word for one meaning; simple, common words ("use", not "leverage"); no phrasal verbs ("remove", not "get rid of"); ' +
      'keep the articles; no noun clusters longer than three words; ' +
      'one topic per sentence, 25 words maximum; active voice; simple present, past or future tense only; ' +
      '"can" and "must", not "be able to" or "should be"; no contractions, no "basically", "simply" or "just". ' +
      'Reply with the summary only.\n\n' + content;
    execFile('claude', ['-p', prompt, '--model', SUMMARY_MODEL],
      { env: ENV, timeout: 180000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        const s = loadSummaries(proj);
        s[slug] = stdout.trim();
        saveSummaries(proj, s);
        const v = loadSummaryStyles(proj);
        v[slug] = SUMMARY_STYLE;
        mkdirSync(path.dirname(proj.summaryStyleFile), { recursive: true });
        writeFileSync(proj.summaryStyleFile, JSON.stringify(v, null, 2));
        resolve(s[slug]);
      });
  });
const pumpSummaries = () => {
  if (summarizing || !summaryQueue.length) return;
  const job = summaryQueue.shift();
  summarizing = job.key;
  console.log(`summarizing ${job.key} …`);
  const proj = projByName(job.project);
  (proj ? explain(proj, job.slug) : Promise.reject(new Error('project gone')))
    .then(() => console.log(`summary ready: ${job.key}`))
    .catch((e) => { summaryFailed.add(job.key); console.log(`summary failed: ${job.key} (${e.code || e})`); })
    .finally(() => { summarizing = null; setTimeout(pumpSummaries, 1000); });
};
const enqueueMissingSummaries = () => {
  if (NO_SUMMARY) return;
  for (const proj of allProjects()) {
    const s = loadSummaries(proj);
    const v = loadSummaryStyles(proj);
    for (const f of planFiles(proj)) {
      const slug = f.replace(/\.md$/, '');
      const key = proj.name + '/' + slug;
      if ((!s[slug] || v[slug] !== SUMMARY_STYLE) && !summaryFailed.has(key) && summarizing !== key
          && !summaryQueue.some((q) => q.key === key))
        summaryQueue.push({ key, project: proj.name, slug });
    }
  }
  pumpSummaries();
};

// ---------- actions ----------

// pipeline flavor: delegate to the repo's auto-pipeline.sh
const dashLog = (proj) => {
  mkdirSync(proj.autoRunsDir, { recursive: true });
  return openSync(path.join(proj.autoRunsDir, '_dashboard.log'), 'a');
};
// "<project>/<slug>" -> { state: 'starting' | 'failed', at, output }. The launcher sets up
// a worktree and runs pnpm install for each plan in turn before the run appears, so this
// is what the list shows in between. In memory only: a restart forgets it, which is fine.
const launches = new Map();
const runLauncher = (proj, args, slugs) => {
  const logFile = path.join(proj.autoRunsDir, '_dashboard.log');
  const fd = dashLog(proj);
  const from = statSync(logFile).size;
  const keys = slugs.map((s) => proj.name + '/' + s);
  for (const k of keys) { chatEnd(k); launches.set(k, { state: 'starting', at: Date.now() }); }
  const child = spawn('bash', [proj.launcherScript, ...args], {
    cwd: proj.root, env: ENV, detached: true, stdio: ['ignore', fd, fd],
  });
  closeSync(fd); // the child holds its own copy
  child.on('exit', (code) => {
    // `from` counts bytes, so cut the bytes: the log holds multi-byte characters
    let lines = [];
    try { lines = readFileSync(logFile).subarray(from).toString('utf8').trim().split('\n'); } catch {}
    for (const slug of slugs) {
      const key = proj.name + '/' + slug;
      // a launcher exits 0 even when it skipped a plan, and names the plan on the SKIP line
      const skip = lines.find((l) => l.startsWith('SKIP:') && skipNames(l, slug));
      if (skip) launches.set(key, { state: 'failed', at: Date.now(), output: skip });
      else if (code === 0) launches.delete(key);
      // the launcher stopped early: keep what it printed, so the list can say why
      else launches.set(key, { state: 'failed', at: Date.now(),
        output: lines.slice(-20).join('\n') || 'launcher exited with code ' + code });
    }
  });
  child.unref();
};
// whole words only: a skip of plan "foo-2" says nothing about plan "foo"
const skipNames = (line, slug) => line.split(/[\s/]+/).some((w) => w === slug || w === slug + '.md');
// an unknown or missing mode id falls back to the project's default mode
const modeFlag = (proj, id) => {
  const modes = pipelineModes(proj);
  return (modes.find((m) => m.id === id) || modes.find((m) => m.default) || modes[0]).flag;
};
const launchPipeline = (proj, items) => {
  const groups = {}; // flag -> slugs
  for (const it of items) (groups[modeFlag(proj, it.mode)] ||= []).push(it.slug);
  for (const [flag, slugs] of Object.entries(groups))
    runLauncher(proj, [flag, ...slugs.map((s) => s + '.md')], slugs);
};
// The plan view preselects the mode the run was launched with (the report's `**Mode**:`
// line), so `picked` is that mode unless the user changed it. Without a pick, the line.
const resumeFlag = (proj, slug, picked) =>
  modeFlag(proj, pipelineModes(proj).some((m) => m.id === picked)
    ? picked : (pipelineRunInfo(proj, slug) || {}).mode);

// generic flavor: spawn the configured launcher command, capture log, track pid
const launchGeneric = (proj, slug, launcherIdx) => {
  const l = proj.launchers[launcherIdx];
  if (!l || !l.cmd) return { ok: false, output: 'No launcher configured for this project yet.' };
  const existing = genericRunInfo(proj, slug);
  if (existing.live) return { ok: false, output: 'A run for this plan is already live.' };
  chatEnd(proj.name + '/' + slug);
  const planPath = path.join(proj.plansDir, slug + '.md');
  const cmd = l.cmd
    .replaceAll('{plan}', planPath)
    .replaceAll('{root}', proj.root)
    .replaceAll('{slug}', slug);
  mkdirSync(proj.logsDir, { recursive: true });
  mkdirSync(proj.stateDir, { recursive: true });
  const exitFile = runExitFile(proj, slug);
  try { unlinkSync(exitFile); } catch {}   // a stale code would read as "already finished"
  const reportFile = runReportFile(proj, slug);
  try { unlinkSync(reportFile); } catch {} // and a stale report as the last run's outcome
  // an EXIT trap (not a trailing line) so the code is recorded even when the launcher
  // calls exit itself; the path travels via the environment to dodge shell quoting
  const script = `trap 'printf %s $? > "$DASH_EXIT_FILE"' EXIT\n` + cmd + '\n';
  const env = { ...ENV, DASH_EXIT_FILE: exitFile, PLAN_REPORT: reportFile };
  const fd = openSync(path.join(proj.logsDir, slug + '.log'), 'a');
  const argv = process.platform === 'darwin'
    ? ['caffeinate', ['-i', 'bash', '-lc', script]]   // keep the mac awake overnight
    : ['bash', ['-lc', script]];
  const child = spawn(argv[0], argv[1], {
    cwd: proj.root, env, detached: true, stdio: ['ignore', fd, fd],
  });
  child.unref();
  const runs = loadRuns(proj);
  runs[slug] = { pid: child.pid, label: l.label || 'launcher', cmd,
    startedAt: new Date().toISOString(), exitCode: null };
  saveRuns(proj, runs);
  child.on('exit', (code) => {
    const r = loadRuns(proj);
    if (r[slug] && r[slug].pid === child.pid) {
      r[slug].exitCode = code == null ? -1 : code;
      r[slug].finishedAt = new Date().toISOString();
      saveRuns(proj, r);
    }
  });
  return { ok: true };
};
const clearGenericRun = (proj, slug) => {
  const info = genericRunInfo(proj, slug);
  if (info.live) return { ok: false, output: 'Run is still live — not clearing.' };
  const runs = loadRuns(proj);
  delete runs[slug];
  saveRuns(proj, runs);
  try { unlinkSync(path.join(proj.logsDir, slug + '.log')); } catch {}
  try { unlinkSync(runExitFile(proj, slug)); } catch {}
  try { unlinkSync(runReportFile(proj, slug)); } catch {}
  return { ok: true, output: 'Run record and log cleared.' };
};

// launcher discovery for the setup dialog: the repo's skills and scripts
const discover = (proj) => {
  // each option ships with a one-line description scraped from its own docs,
  // so the setup dialog can explain what the user is picking
  const skillDesc = (d) => {
    try {
      const raw = readFileSync(path.join(proj.root, '.claude/skills', d, 'SKILL.md'), 'utf8').slice(0, 2000);
      const m = raw.match(/^description:\s*(.+)$/m);
      return m ? m[1].trim().replace(/^["']|["']$/g, '').slice(0, 180) : '';
    } catch { return ''; }
  };
  const scriptDesc = (f) => {
    try {
      const lines = readFileSync(path.join(proj.root, '.claude/scripts', f), 'utf8').split('\n').slice(0, 12);
      for (const l of lines) {
        if (l.startsWith('#!')) continue;
        const m = l.match(/^\s*(?:#|\/\/)\s*(.+)$/);
        if (m && m[1].trim()) return m[1].trim().slice(0, 180);
      }
      return '';
    } catch { return ''; }
  };
  const skills = [];
  try {
    for (const d of readdirSync(path.join(proj.root, '.claude/skills')).sort())
      if (existsSync(path.join(proj.root, '.claude/skills', d, 'SKILL.md')))
        skills.push({ name: d, desc: skillDesc(d) });
  } catch {}
  const scripts = [];
  try {
    for (const f of readdirSync(path.join(proj.root, '.claude/scripts')).sort())
      if (/\.(sh|mjs|js)$/.test(f)) scripts.push({ name: f, desc: scriptDesc(f) });
  } catch {}
  return { skills, scripts, hasPipeline: proj.hasPipeline };
};
const saveLaunchers = (name, launchers) => {
  const reg = loadRegistry();
  const entry = reg.find((p) => p.name === name);
  if (!entry) return { ok: false, output: 'Unknown project.' };
  entry.launchers = launchers
    .filter((l) => l && typeof l.cmd === 'string' && l.cmd.trim())
    .map((l) => ({ label: String(l.label || '').slice(0, 60), cmd: String(l.cmd).slice(0, 2000) }))
    .slice(0, 12);
  saveRegistry(reg);
  return { ok: true };
};

// one registry entry as the settings panel and onboarding submit it → stored shape
const cleanEntry = (e) => {
  if (!e || !safeName(e.name) || !e.root || typeof e.root !== 'string')
    return { warning: 'Skipped an entry with a missing/invalid name or root.' };
  const entry = {
    name: e.name,
    client: String(e.client || 'Default').slice(0, 40),
    root: String(e.root).slice(0, 500),
    launchers: Array.isArray(e.launchers) ? e.launchers : [],
  };
  if (e.plansDir && String(e.plansDir).trim()) entry.plansDir = String(e.plansDir).slice(0, 500);
  if (e.doneDir && String(e.doneDir).trim()) entry.doneDir = String(e.doneDir).slice(0, 500);
  // optional look: a CSS hex color and a short tag; without them the dashboard picks both
  if (/^#[0-9a-f]{3,8}$/i.test(e.color || '')) entry.color = e.color;
  if (e.short && String(e.short).trim()) entry.short = String(e.short).trim().slice(0, 12);
  let warning;
  if (!existsSync(expand(entry.root)))
    warning = entry.name + ': root does not exist: ' + entry.root;
  else if (entry.plansDir && !existsSync(expand(entry.plansDir)))
    warning = entry.name + ': plansDir does not exist: ' + entry.plansDir;
  return { entry, warning };
};

// ---------- onboarding: system check, repo discovery, readiness ----------

const tilde = (p) => (p && p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);
const toolVersion = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { env: ENV, timeout: 8000 }, (err, out) =>
      resolve(err ? null : String(out).trim().split('\n')[0]));
  });
const systemCheck = async () => {
  const [claude, git, jq, gh] = await Promise.all([
    toolVersion('claude', ['--version']), toolVersion('git', ['--version']), toolVersion('jq', ['--version']),
    toolVersion('gh', ['--version']),
  ]);
  const ghAuth = gh && await new Promise((resolve) =>
    execFile('gh', ['auth', 'status'], { env: ENV, timeout: 8000 }, (err) => resolve(!err)));
  const nodeMajor = +process.versions.node.split('.')[0];
  return [
    { id: 'node', label: 'Node.js 18 or newer', ok: nodeMajor >= 18, required: true,
      detail: 'v' + process.versions.node, why: 'Runs this dashboard.', fixCmd: 'brew install node' },
    { id: 'claude', label: 'Claude Code CLI', ok: !!claude, required: true,
      detail: claude || 'not found on PATH',
      why: 'Every launched plan runs through it, and it writes the plain-language plan summaries.',
      fixCmd: 'curl -fsSL https://claude.ai/install.sh | bash' },
    { id: 'git', label: 'git', ok: !!git, required: true, detail: git || 'not found on PATH',
      why: 'Runs are reviewed as diffs, and parallel runs each get their own git worktree.',
      fixCmd: 'xcode-select --install' },
    { id: 'gh', label: 'GitHub CLI', ok: !!ghAuth, required: false,
      detail: !gh ? 'not found on PATH' : ghAuth ? gh : 'not logged in',
      why: 'Shows each plan\u2019s pull request, its files and the Merge button. The pipeline also opens PRs with it.',
      fixCmd: gh ? 'gh auth login' : 'brew install gh && gh auth login' },
    { id: 'jq', label: 'jq', ok: !!jq, required: false, detail: jq || 'not found on PATH',
      why: 'The launcher template uses it to copy a repo’s permission allowlist into headless runs.',
      fixCmd: 'brew install jq' },
  ];
};

// the registration scripts/launcher-template.sh documents for a repo that copied it
const WRAPPER_LAUNCHER = { label: 'Implement', cmd: 'bash .claude/scripts/run-skill.sh implement {plan}' };
// where plan folders usually live, most common first
const PLAN_DIR_CANDIDATES = ['.plans', 'docs/plans', 'wiki/plans', 'plans'];
const countMd = (dir) => {
  try { return readdirSync(dir).filter((f) => f.endsWith('.md')).length; } catch { return 0; }
};
const allowRuleCount = (root) =>
  ((loadJson(path.join(root, '.claude', 'settings.json')).permissions || {}).allow || []).length;
const skillNames = (root) => {
  try {
    return readdirSync(path.join(root, '.claude', 'skills'))
      .filter((d) => existsSync(path.join(root, '.claude', 'skills', d, 'SKILL.md')));
  } catch { return []; }
};

// What a repo needs before its plans can be launched from here. Every failing check
// carries its own fix: a shell command, or a prompt to paste into Claude Code there.
const projectHealth = (root, entry) => {
  const plansDir = entry ? resolveProject(entry).plansDir
    : PLAN_DIR_CANDIDATES.map((d) => path.join(root, d)).find((d) => existsSync(d)) || null;
  const hasPipeline = existsSync(path.join(root, '.claude/scripts/auto-pipeline.sh'));
  const hasWrapper = existsSync(path.join(root, '.claude/scripts/run-skill.sh'));
  const launchers = entry && Array.isArray(entry.launchers) ? entry.launchers.length : 0;
  const plans = plansDir ? countMd(plansDir) : 0;
  const rules = allowRuleCount(root);
  const skills = skillNames(root);
  const docs = path.join(DASH_REPO, 'docs/plans-dashboard.md');
  const checks = [
    { id: 'git', label: 'Git repository', required: true, ok: existsSync(path.join(root, '.git')),
      why: 'You review what a run changed as a git diff; parallel runs need git worktrees.',
      fixCmd: 'cd ' + tilde(root) + ' && git init' },
    { id: 'plansDir', label: 'Plans folder', required: true, ok: !!plansDir && existsSync(plansDir),
      detail: plansDir ? tilde(plansDir) : 'none of ' + PLAN_DIR_CANDIDATES.join(', '),
      why: 'The dashboard lists the *.md files in this folder as plans.',
      fixPrompt: 'Create a .plans/ folder in this repository for implementation plans: one markdown file ' +
        'per piece of work, kebab-case names such as add-login-rate-limit.md, and a .plans/done/ folder ' +
        'for finished ones. Do not commit.' },
    { id: 'plans', label: 'At least one plan', required: false, ok: plans > 0,
      detail: plans + ' plan' + (plans === 1 ? '' : 's'),
      why: 'Nothing shows on the dashboard until the folder holds a plan.',
      fixPrompt: 'Write a first implementation plan for a small, real improvement you find in this ' +
        'codebase and save it as ' + (plansDir ? path.relative(root, plansDir) || '.' : '.plans') +
        '/<kebab-case-name>.md. Start with "# Plan: <title>", then sections Goal, Context (the files ' +
        'involved), Steps, and How to verify. Keep it short. Do not implement it and do not commit.' },
  ];
  if (hasPipeline) {
    checks.push({ id: 'launch', label: 'A way to launch plans', required: true, ok: true,
      detail: 'auto-pipeline.sh — pipeline mode, nothing to configure' });
    let describes = false;
    try { describes = /^\s*--describe\)/m.test(readFileSync(path.join(root, '.claude/scripts/auto-pipeline.sh'), 'utf8')); } catch {}
    checks.push({ id: 'modes', label: 'Modes and run state for the dashboard', required: false, ok: describes,
      detail: describes ? 'auto-pipeline.sh --describe lists its modes'
        : 'the dashboard offers only stop-at-verify and full',
      why: 'With --describe the script lists its own launch modes; with Outcome and Link lines in its ' +
        'report, the dashboard knows when a run waits for you and shows its links.',
      fixPrompt: 'Read ' + tilde(docs) + ' (section "Pipeline modes and run reports"). Then change ' +
        '.claude/scripts/auto-pipeline.sh: add a --describe case that prints the modes this script really ' +
        'supports as that JSON (ask me which mode should be the "default"), and make each run report keep its "- **Outcome**:" line correct whenever ' +
        'no session runs, plus a "- **Link**:" line for each URL a reviewer needs. Do not commit.' });
  } else {
    // an unregistered repo with the wrapper is ready: adding it saves WRAPPER_LAUNCHER
    checks.push({ id: 'launch', label: 'A way to launch plans', required: true,
      ok: launchers > 0 || (!entry && hasWrapper),
      detail: launchers ? launchers + ' launcher' + (launchers === 1 ? '' : 's') + ' configured'
        : hasWrapper ? (entry ? 'run-skill.sh is in the repo — save it as a launcher'
          : 'run-skill.sh — becomes the launcher when you add the project')
        : 'no launcher script and no launcher configured',
      why: 'The ▶ Launch button runs a launcher command for the plan.',
      action: entry ? 'launchers' : undefined,
      fixPrompt: hasWrapper ? undefined
        : 'Set up a headless launcher so my plans dashboard can run plans in this repository. ' +
          'Read ' + tilde(docs) + ' (section "How a plan gets launched") first. Copy ' +
          tilde(path.join(DASH_REPO, 'scripts/launcher-template.sh')) + ' to .claude/scripts/run-skill.sh ' +
          'and make it executable. Edit its two marked spots: (1) the skills it may run — use the skills ' +
          'in .claude/skills that implement or review a plan; if there is none, create ' +
          '.claude/skills/implement/SKILL.md, a skill that takes a plan file path as its argument, ' +
          'implements the plan following this repo’s conventions, and runs the relevant tests; ' +
          '(2) extra permissions a run needs. Then run it once with --dry-run on a plan and show me the ' +
          'output. Do not commit.' });
  }
  checks.push(
    { id: 'allow', label: 'Permission allowlist', required: !hasPipeline, ok: rules > 0,
      detail: rules ? rules + ' allow rule' + (rules === 1 ? '' : 's') + ' in .claude/settings.json'
        : 'no permissions.allow in .claude/settings.json',
      why: 'A launched run cannot ask you for permission — any command not on the list fails, and the ' +
        'run reports problems that never happened.',
      fixPrompt: 'Create or extend .claude/settings.json in this repository with a permissions.allow list ' +
        'that lets a headless Claude session do routine work here without asking: read and edit files in ' +
        'the repo, run this repo’s real test, lint, type-check and build commands (find them in ' +
        'package.json, Makefile, pyproject.toml or similar), and read-only git commands (git status, git ' +
        'diff, git log). Do not allow push, deploy, or destructive commands. Keep any existing rules. ' +
        'Show me the final list. Do not commit.' },
    { id: 'skills', label: 'Project skills', required: false, ok: skills.length > 0,
      detail: skills.length ? skills.slice(0, 4).map((s) => '/' + s).join(', ') +
        (skills.length > 4 ? ' +' + (skills.length - 4) : '') : 'no .claude/skills',
      why: 'Skills give launched runs this repo’s own workflow (implement, test, review).',
      fixPrompt: 'Create a skill at .claude/skills/implement/SKILL.md for this repository. It takes the ' +
        'path of a plan file as its argument, implements the plan following the conventions in this ' +
        'repo, runs the relevant tests with this repo’s real test command, and ends with a short ' +
        'summary of what changed. It never pushes or opens PRs. Do not commit.' },
    { id: 'claudemd', label: 'CLAUDE.md', required: false, ok: existsSync(path.join(root, 'CLAUDE.md')),
      why: 'Tells every run how this repo is built, tested and structured.',
      fixCmd: 'cd ' + tilde(root) + ' && claude "/init"' },
  );
  const failing = checks.filter((c) => !c.ok);
  const level = failing.some((c) => c.required) ? 'red' : failing.length ? 'amber' : 'green';
  // one prompt that fixes everything that can be fixed from inside Claude Code
  const prompts = failing.filter((c) => c.fixPrompt).map((c) => c.fixPrompt);
  const fixAll = prompts.length > 1
    ? 'Get this repository ready for my plans dashboard. Do these steps in order, show me what you ' +
      'changed after each, and do not commit:\n\n' +
      prompts.map((p, i) => (i + 1) + '. ' + p.replace(/\s*Do not commit\.$/, '')).join('\n\n')
    : prompts[0] || null;
  return { root, display: tilde(root), plansDir, hasPipeline, level, checks, fixAll };
};

// A folder is a candidate project when it is a git repo or already has Claude/plan
// folders. Descent stops at a candidate, so submodules and nested packages don't appear.
const SCAN_SKIP = new Set(['node_modules', 'worktrees', 'vendor', 'dist', 'build', 'Library', 'Applications']);
const findRepos = (dir, depth, out, budget) => {
  if (budget.n-- <= 0) return;
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const names = new Set(ents.map((e) => e.name));
  if (['.git', '.claude', '.plans'].some((n) => names.has(n))) {
    // a .git FILE marks a linked worktree or submodule checkout, not a project of its own
    if (!names.has('.git') || ents.find((e) => e.name === '.git').isDirectory()) out.push(dir);
    return;
  }
  if (depth <= 0) return;
  for (const e of ents)
    if (e.isDirectory() && !e.name.startsWith('.') && !SCAN_SKIP.has(e.name))
      findRepos(path.join(dir, e.name), depth - 1, out, budget);
};
// where to look when the user hasn't said: next to this checkout, then the usual dev folders
const defaultScanRoots = () =>
  [...new Set([path.dirname(DASH_REPO),
    ...['Workspace', 'Projects', 'Developer', 'code', 'dev', 'src', 'repos', 'GitHub']
      .map((d) => path.join(HOME, d))])].filter((d) => existsSync(d));
const suggestName = (root, taken) => {
  const base = path.basename(root).replace(/[^A-Za-z0-9._-]/g, '-') || 'project';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = base + '-' + i;
  return name;
};
const scanProjects = (dirs) => {
  const reg = loadRegistry();
  const registered = new Set(reg.map((e) => expand(e.root)));
  const taken = new Set(reg.map((e) => e.name));
  const seen = new Set(), candidates = [];
  for (const scanRoot of dirs) {
    const found = [];
    findRepos(scanRoot, 3, found, { n: 600 });
    for (const root of found) {
      if (seen.has(root) || registered.has(root)) continue;
      seen.add(root);
      const h = projectHealth(root, null);
      const parent = path.dirname(root);
      h.name = suggestName(root, taken);
      taken.add(h.name);
      // a repo grouped under a folder (~/Workspace/acme/api) suggests that folder as the client
      const group = parent !== scanRoot && parent.startsWith(scanRoot) ? path.basename(parent) : '';
      h.client = group ? group[0].toUpperCase() + group.slice(1) : 'Default';
      h.self = root === DASH_REPO;
      candidates.push(h);
    }
  }
  const rank = { green: 0, amber: 1, red: 2 };
  candidates.sort((a, b) => a.self - b.self || rank[a.level] - rank[b.level] || a.root.localeCompare(b.root));
  return { roots: dirs.map(tilde), candidates };
};
const addProject = (b) => {
  const root = expand(String(b.root || '').trim());
  if (!root || !existsSync(root)) return { ok: false, output: 'That folder does not exist.' };
  const reg = loadRegistry();
  if (reg.some((e) => expand(e.root) === root)) return { ok: false, output: 'Already on the dashboard.' };
  const { entry, warning } = cleanEntry({
    name: b.name, client: b.client, root: tilde(root),
    plansDir: b.plansDir ? tilde(expand(b.plansDir)) : undefined,
    color: b.color, short: b.short,
    launchers: existsSync(path.join(root, '.claude/scripts/run-skill.sh'))
      && !existsSync(path.join(root, '.claude/scripts/auto-pipeline.sh')) ? [WRAPPER_LAUNCHER] : [],
  });
  if (!entry) return { ok: false, output: warning };
  if (reg.some((e) => e.name === entry.name)) return { ok: false, output: 'A project named ' + entry.name + ' already exists.' };
  mkdirSync(path.dirname(REG_FILE), { recursive: true });
  saveRegistry([...reg, entry]);
  return { ok: true, name: entry.name, warning };
};

const cleanup = (proj, slug, artifacts) =>
  new Promise((resolve) => {
    execFile('bash', [proj.launcherScript, '--cleanup', slug], { cwd: proj.root, env: ENV, timeout: 60000 },
      (err, stdout, stderr) => {
        const output = ((stdout || '') + (stderr || '')).trim();
        if (err) return resolve({ ok: false, output });
        if (artifacts) {
          for (const ext of ['.md', '.log', '-settings.json', '-pr-body.md'])
            try { unlinkSync(path.join(proj.autoRunsDir, slug + ext)); } catch {}
          const s = loadSummaries(proj); delete s[slug]; saveSummaries(proj, s);
        }
        resolve({ ok: true, output });
      });
  });
const openFolderInVsCode = (target) => {
  execFile('code', [target], { env: ENV }, (err) => {
    if (err) execFile('open', ['-a', 'Visual Studio Code', target], () => {});
  });
  return target;
};
// with no slug (the project header's button) it opens the project's main checkout
const openInVsCode = (proj, slug) => {
  const ext = extWorktree(proj, slug);
  const wt = ext ? ext.path : slug ? worktreeOf(proj, slug) : '';
  return openFolderInVsCode((ext || proj.hasPipeline) && wt && existsSync(wt) ? wt : proj.root);
};
const archivePlan = async (proj, slug) => {
  const live = proj.hasPipeline ? await pipelineLive(proj, slug) : genericRunInfo(proj, slug).live;
  if (live) return { ok: false, output: 'A session for this plan is still running.' };
  if (proj.hasPipeline && existsSync(worktreeOf(proj, slug)))
    return { ok: false, output: 'Worktree still exists — run Clean up first, then archive.' };
  const src = path.join(proj.plansDir, slug + '.md');
  if (!existsSync(src)) return { ok: false, output: 'Plan file not found.' };
  mkdirSync(proj.doneDir, { recursive: true });
  renameSync(src, path.join(proj.doneDir, slug + '.md'));
  return { ok: true, output: `Moved to ${path.join(proj.doneDir, slug + '.md')} — commit the move if the folder is tracked.` };
};
const unarchivePlan = (proj, slug) => {
  const src = path.join(proj.doneDir, slug + '.md');
  if (!existsSync(src)) return { ok: false, output: 'Archived plan not found.' };
  const dst = path.join(proj.plansDir, slug + '.md');
  if (existsSync(dst)) return { ok: false, output: 'An active plan with this name already exists.' };
  renameSync(src, dst);
  return { ok: true, output: 'Moved back to active plans.' };
};

// ---------- pull requests (gh CLI) ----------

// A plan's PR is the newest one on its pipeline branch, auto/<slug>. One `gh pr list`
// per project, at most once a minute and never on the 5s poll's critical path:
// /api/state serves what is cached and the refresh lands on a later tick.
const PR_TTL = 60000;
const prLists = {}; // root -> { at, byBranch, loading }
const gh = (proj, args, input) =>
  new Promise((resolve) => {
    const child = execFile('gh', args, { cwd: proj.root, env: ENV, timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => resolve(err
        ? { ok: false, output: String(stderr || err.message).trim() || 'gh failed' }
        : { ok: true, out: stdout }));
    if (input != null) child.stdin.end(input);
  });
// GitHub refuses the whole-PR diff above 300 files (HTTP 406). The files list goes up to 3000
// files, each with its own patch (none for binary or very large files), so the page gets the
// same unified diff text, put together file by file.
async function prDiffFromFiles(proj, n) {
  const r = await gh(proj, ['api', '--paginate', 'repos/{owner}/{repo}/pulls/' + n + '/files?per_page=100',
    '--jq', '.[] | {filename, previous_filename, status, patch, changes}']);
  if (!r.ok) return r;
  const out = [];
  for (const line of r.out.split('\n')) {
    if (!line.trim()) continue;
    const f = JSON.parse(line), old = f.previous_filename || f.filename;
    out.push('diff --git a/' + old + ' b/' + f.filename);
    if (f.status === 'added') out.push('new file mode 100644');
    else if (f.status === 'removed') out.push('deleted file mode 100644');
    else if (f.status === 'renamed') out.push('rename from ' + old, 'rename to ' + f.filename);
    if (f.patch) out.push('--- a/' + old, '+++ b/' + f.filename, f.patch);
    else if (f.changes) out.push('GitHub sends no patch for this file');
  }
  return { ok: true, diff: out.join('\n') + '\n' };
}
const ghProblem = (out) => /ENOENT/.test(out) ? 'gh is not installed'
  : /auth login|not logged/i.test(out) ? 'gh is not logged in' : out.split('\n')[0].slice(0, 160);
// The REST API, not `gh pr list`/`gh pr diff`: those use GraphQL, and when GitHub refuses
// GraphQL for the account (other tools and agents share it) the PR tabs went blank.
// The newest 200 PRs, newest first, in the shape `gh pr list --json` gave.
const PR_JQ = '[.[] | {number, title, url: .html_url, isDraft: .draft, headRefName: .head.ref, headRefOid: .head.sha,' +
  ' baseRefName: .base.ref, mergedAt: .merged_at, state: (if .merged_at then "MERGED" elif .state == "open" then "OPEN" else "CLOSED" end)}]';
const listPrs = async (proj) => {
  const all = [];
  for (const page of [1, 2]) {
    const r = await gh(proj, ['api', 'repos/{owner}/{repo}/pulls?state=all&sort=created&direction=desc&per_page=100&page=' + page, '--jq', PR_JQ]);
    if (!r.ok) return r;
    const rows = JSON.parse(r.out);
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return { ok: true, prs: all };
};
const refreshPrList = (proj) => {
  const c = prLists[proj.root] = prLists[proj.root] || { at: 0, byBranch: {} };
  if (c.loading) return c.loading;
  return c.loading = listPrs(proj).catch((e) => ({ ok: false, output: String(e.message) })).then((r) => {
    // byBranch: the plans' auto/ branches; allByBranch: every branch, for the worktrees section
    const byBranch = {}, allByBranch = {};
    if (r.ok) for (const p of r.prs) {   // newest first: keep the first PR per branch
      if (allByBranch[p.headRefName]) continue;
      const pr = allByBranch[p.headRefName] = { number: p.number, state: p.state, isDraft: p.isDraft, title: p.title,
        url: p.url, head: p.headRefOid, base: p.baseRefName, mergedAt: p.mergedAt || null };
      if (p.headRefName.startsWith('auto/')) byBranch[p.headRefName] = pr;
    }
    Object.assign(c, { at: Date.now(), byBranch: r.ok ? byBranch : c.byBranch,
      allByBranch: r.ok ? allByBranch : c.allByBranch || {}, loading: null,
      error: r.ok ? '' : ghProblem(r.output) });
  });
};
const prsFor = (proj) => {
  const c = prLists[proj.root];
  if (!c || Date.now() - c.at > PR_TTL) refreshPrList(proj);
  return (c && c.byBranch) || {};
};

// ---------- worktrees outside the plan pipeline ----------
// A Claude Code session can make its own worktree (EnterWorktree, claude --worktree), work
// there and open a PR on any branch. No plan names it, so the plan list never showed it. This
// lists every worktree of the repo except the main checkout and the pipeline's auto/ runs (those
// are plans already), with its PR and the sessions that worked in it. Such a session usually
// runs with the repo root as its cwd and only moves into the worktree, so its transcript is in
// the root's transcript dir: every event carries the cwd, and a session belongs to each
// worktree it had as its cwd. Served from a cache like the PR list: the 5s poll never waits for git.
const WT_TTL = 15000;
const WT_SESSION_DAYS = 14;        // older transcripts are not read
const WT_WORKING_MS = 2 * 60 * 1000;   // a transcript written this recently: the agent is working
const wtLists = {};   // root -> { at, list, loading }
const wtSlug = (name) => 'wt.' + name;
// the cwds a transcript had, read on from where the last read stopped (a live one grows each second)
const transcriptCwds = {};   // file -> { size, cwds: Set, rest }
const cwdsOf = (file, size) => {
  const t = transcriptCwds[file] = transcriptCwds[file] && transcriptCwds[file].size <= size
    ? transcriptCwds[file] : { size: 0, cwds: new Set(), rest: '' };
  if (t.size === size) return t.cwds;
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(size - t.size);
    readSync(fd, buf, 0, buf.length, t.size);
    const text = t.rest + buf.toString('utf8');
    const cut = text.lastIndexOf('\n') + 1;   // a half-written last line is read next time
    for (const m of text.slice(0, cut).matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) t.cwds.add(JSON.parse('"' + m[1] + '"'));
    t.rest = text.slice(cut);
    t.size = size;
  } catch {} finally { if (fd != null) try { closeSync(fd); } catch {} }
  return t.cwds;
};
// session id -> { id, mtime, dir (where claude --resume finds it) } for each worktree path
const worktreeSessions = (root, paths) => {
  const out = Object.fromEntries(paths.map((p) => [p, []]));
  const since = Date.now() - WT_SESSION_DAYS * 86400000;
  for (const cwd of [root, ...paths]) {
    const dir = transcriptDirFor(cwd);
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      let st;
      try { st = statSync(path.join(dir, f)); } catch { continue; }
      if (st.mtimeMs < since) continue;
      const cwds = cwdsOf(path.join(dir, f), st.size);
      for (const p of paths)
        if ([...cwds].some((c) => c === p || c.startsWith(p + path.sep)))
          out[p].push({ id: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, dir: cwd });
    }
  }
  for (const p of paths) out[p].sort((a, b) => a.mtime - b.mtime);
  return out;
};
const parseWorktrees = (out) => out.split('\n\n').map((block) => {
  const w = {};
  for (const line of block.split('\n')) {
    const [k, ...v] = line.split(' ');
    if (k) w[k] = v.join(' ') || true;
  }
  return w;
}).filter((w) => w.worktree);
// a plan's run worktree whose branch is no longer auto/<slug>: the plan's card shows it already
const planRunWorktree = (proj, wtPath) => {
  const name = path.basename(wtPath);
  return [proj.worktrees, proj.legacyWorktrees].includes(path.dirname(wtPath))
    && [proj.plansDir, proj.doneDir].some((d) => existsSync(path.join(d, name + '.md')));
};
const refreshWorktrees = (proj) => {
  const c = wtLists[proj.root] = wtLists[proj.root] || { at: 0, list: [] };
  if (c.loading) return c.loading;
  return c.loading = (async () => {
    const r = await gitRaw(proj.root, ['worktree', 'list', '--porcelain']);
    if (!r.ok) return Object.assign(c, { at: Date.now(), loading: null });
    const wts = parseWorktrees(r.out).slice(1)   // the first one is the main checkout
      .map((w) => ({ path: w.worktree, head: w.HEAD || '', branch: typeof w.branch === 'string' ? w.branch.replace(/^refs\/heads\//, '') : '' }))
      .filter((w) => !w.branch.startsWith('auto/') && existsSync(w.path) && !planRunWorktree(proj, w.path));
    const sessions = worktreeSessions(proj.root, wts.map((w) => w.path));
    const list = await Promise.all(wts.map(async (w) => {
      const [log, st] = await Promise.all([gitRaw(w.path, ['log', '-1', '--format=%s%x00%cI']),
        gitRaw(w.path, ['status', '--porcelain'])]);
      const [subject = '', committedAt = ''] = log.ok ? log.out.trim().split('\0') : [];
      const ss = sessions[w.path];
      const last = ss.at(-1);
      return { name: path.basename(w.path), path: w.path, branch: w.branch, head: w.head, subject, committedAt,
        dirty: st.ok ? st.out.split('\n').filter(Boolean).length : 0,
        sessions: ss.map((s) => ({ ...s, dir: tilde(s.dir) })),
        agent: !last ? null : Date.now() - last.mtime < WT_WORKING_MS ? 'working' : 'idle',
        lastActive: last ? new Date(last.mtime).toISOString() : null };
    }));
    Object.assign(c, { at: Date.now(), list, loading: null });
  })();
};
const worktreesFor = (proj) => {
  const c = wtLists[proj.root];
  if (!c || Date.now() - c.at > WT_TTL) refreshWorktrees(proj);
  const prs = (prLists[proj.root] || {}).allByBranch || {};
  return ((c && c.list) || []).map((w) => ({ ...w, slug: wtSlug(w.name), pr: (w.branch && prs[w.branch]) || null }));
};
// a worktree item's slug ("wt.<name>") -> that worktree; a plan that names its own branch ->
// the worktree on that branch, so its PR tab, push and chat work in it; else null
const extWorktree = (proj, slug) => {
  const s = String(slug || '');
  if (s.startsWith('wt.')) return worktreesFor(proj).find((w) => w.slug === s) || null;
  const b = ownBranch(proj, s);
  return b ? worktreesFor(proj).find((w) => w.branch === b) || null : null;
};
// the merge methods a repo allows and the viewer's default, read once per server run
const repoMerge = {};
const mergeSettings = async (proj) => {
  if (!repoMerge[proj.root]) {
    const r = await gh(proj, ['repo', 'view', '--json',
      'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,viewerDefaultMergeMethod,viewerPermission']);
    if (!r.ok) return { methods: ['merge'], default: 'merge' };
    const m = JSON.parse(r.out);
    repoMerge[proj.root] = {
      methods: [m.mergeCommitAllowed && 'merge', m.squashMergeAllowed && 'squash', m.rebaseMergeAllowed && 'rebase'].filter(Boolean),
      default: String(m.viewerDefaultMergeMethod || 'MERGE').toLowerCase(),
      admin: m.viewerPermission === 'ADMIN',   // may merge past the branch rules (--admin)
    };
  }
  return repoMerge[proj.root];
};
// After a merge, bring the main checkout (never a worktree) up to date, so the merged plan
// shows in done/ and the local code matches. Fast-forward only, and only on the base branch.
const gitIn = (root, args) =>
  new Promise((resolve) => execFile('git', ['-C', root, ...args],
    { env: { ...ENV, GIT_TERMINAL_PROMPT: '0' }, timeout: 120000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() })));
const pullRoot = async (proj, base) => {
  const where = tilde(proj.root);
  const br = await gitIn(proj.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!br.ok) return 'Not pulled: ' + where + ' is not a git repository.';
  if (!base || br.out !== base)
    return 'Not pulled: ' + where + ' is on ' + br.out + ', not ' + (base || 'the base branch') + '. Pull by hand.';
  const r = await gitIn(proj.root, ['pull', '--ff-only']);
  if (!r.ok) {
    // stderr also holds fetch progress and hints: keep git's own reason
    const lines = r.err.split('\n'), why = lines.filter((l) => /^(fatal|error):/.test(l));
    return 'Not pulled: git pull --ff-only failed in ' + where + ': ' + (why.length ? why : lines.slice(-1)).join(' ') + ' Pull by hand.';
  }
  return 'Pulled ' + base + ' in ' + where + (/Already up to date/i.test(r.out) ? ' (it was already up to date).' : '.');
};
const prDetail = async (proj, number) => {
  const r = await gh(proj, ['pr', 'view', String(number), '--json',
    'number,title,body,state,isDraft,url,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,additions,deletions,changedFiles,commits,reviewDecision,statusCheckRollup']);
  if (!r.ok) return r;
  const pr = JSON.parse(r.out);
  const checks = { passed: 0, failed: [], running: 0 };
  for (const c of pr.statusCheckRollup || []) {
    const st = c.__typename === 'StatusContext'
      ? (c.state === 'SUCCESS' ? 'passed' : /PENDING|EXPECTED/.test(c.state) ? 'running' : 'failed')
      : (c.status !== 'COMPLETED' ? 'running' : /SUCCESS|NEUTRAL|SKIPPED/.test(c.conclusion) ? 'passed' : 'failed');
    if (st === 'failed') checks.failed.push(c.name || c.context);
    else checks[st]++;
  }
  const { statusCheckRollup, commits, ...rest } = pr;
  // commits on the base that the PR does not have yet: the "Merge <base> in" button shows when > 0
  const [merge, behind] = await Promise.all([mergeSettings(proj), pr.state !== 'OPEN' ? null
    : gh(proj, ['api', 'repos/{owner}/{repo}/compare/' + pr.headRefOid + '...' + pr.baseRefName, '--jq', '.ahead_by'])]);
  const behindBy = behind && behind.ok ? (parseInt(behind.out, 10) || 0) : null;
  return { ok: true, pr: { ...rest, commits: (commits || []).length, checks, merge, behindBy } };
};
// task-list boxes ("- [ ] …") in order, skipping fenced code — the same ones the page draws
const taskLines = (body) => {
  const out = []; let fence = false;
  body.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    else if (!fence && /^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/.test(line)) out.push(i);
  });
  return out;
};
// After an action the PR list is read again before the answer goes back, so the next poll
// already has the new state. The old list stays meanwhile: deleting it left every plan of the
// repo without its PR for a few seconds, and an open PR tab jumped to the plan and back.
const prAction = async (proj, b) => {
  const r = await runPrAction(proj, b);
  const c = prLists[proj.root];
  if (c && c.loading) await c.loading;   // a read that started before the action is stale
  await refreshPrList(proj);
  return r;
};
const runPrAction = async (proj, b) => {
  const n = String(b.number);
  if (!/^\d{1,7}$/.test(n)) return { ok: false, output: 'Bad PR number.' };
  if (b.action === 'ready') return gh(proj, ['pr', 'ready', n]);
  if (b.action === 'draft') return gh(proj, ['pr', 'ready', n, '--undo']);
  if (b.action === 'close')
    return gh(proj, ['pr', 'close', n, ...(b.deleteBranch ? ['--delete-branch'] : [])]);
  if (b.action === 'merge') {
    if (!['merge', 'squash', 'rebase'].includes(b.method)) return { ok: false, output: 'Unknown merge method.' };
    if (!/^[0-9a-f]{40}$/.test(String(b.head))) return { ok: false, output: 'Bad head commit.' };
    // GitHub refuses when someone pushed after the page loaded, so what you reviewed is what merges
    const m = await gh(proj, ['pr', 'merge', n, '--' + b.method, '--match-head-commit', b.head, ...(b.admin ? ['--admin'] : [])]);
    if (!m.ok) return m;
    const v = await gh(proj, ['pr', 'view', n, '--json', 'baseRefName,headRefName']);
    const { baseRefName: base, headRefName: head } = v.ok ? JSON.parse(v.out) : {};
    const notes = [];
    // not `gh pr merge --delete-branch`: it also deletes the local branch, which the run's worktree has checked out
    if (b.deleteBranch && head) {
      const d = await gh(proj, ['api', '-X', 'DELETE',
        'repos/{owner}/{repo}/git/refs/heads/' + head.split('/').map(encodeURIComponent).join('/')]);
      notes.push(d.ok ? 'Deleted the branch on GitHub.' : 'Could not delete the branch on GitHub: ' + d.output);
    }
    notes.push(await pullRoot(proj, base));
    return { ok: true, notes };
  }
  if (b.action === 'task') {
    // read the body fresh, so a tick never overwrites an edit made on GitHub since the page loaded
    const r = await gh(proj, ['pr', 'view', n, '--json', 'body']);
    if (!r.ok) return r;
    const lines = JSON.parse(r.out).body.split('\n');
    const tasks = taskLines(lines.join('\n'));
    const i = tasks[+b.index];
    if (tasks.length !== +b.count || i == null || /\[[xX]\]/.test(lines[i]) !== !!b.was)
      return { ok: false, output: 'The PR description changed on GitHub since this page loaded it. It is reloaded now — tick the box again.' };
    lines[i] = lines[i].replace(/\[[ xX]\]/, b.was ? '[ ]' : '[x]');
    return gh(proj, ['pr', 'edit', n, '--body-file', '-'], lines.join('\n'));
  }
  return { ok: false, output: 'Unknown action.' };
};

// ---------- local changes: what the worktree has that the PR on GitHub does not ----------
// The chat's agent edits, commits and merges in the plan's worktree, and Files changed read
// only the PR from GitHub, so none of it showed until a push. This is the worktree (uncommitted
// and untracked files too) against the PR's head commit, and against the base for the
// whole-branch view. GIT_OPTIONAL_LOCKS=0: a status or diff every few seconds must never hold
// index.lock while the agent commits.
const gitRaw = (wt, args, timeout = 60000) =>
  new Promise((resolve) => execFile('git', ['-C', wt, ...args],
    { env: { ...ENV, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, timeout, maxBuffer: 64 * 1024 * 1024 },
    (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, out: String(stdout || ''),
      err: String(stderr || (err && err.message) || '').trim() })));
const UNTRACKED_MAX = 100, UNTRACKED_AT_ONCE = 8;
const localFetchAt = new Map();   // worktree -> when it last fetched the PR's head
// a plan whose Push or Discard runs now: the chat does not start a turn meanwhile
const localLocks = new Set();
const localTarget = (proj, slug) => {
  const ext = extWorktree(proj, slug);
  if (ext) {   // a worktree from the worktrees section: its own branch and its PR
    if (!ext.pr || ext.pr.state !== 'OPEN' || !/^[0-9a-f]{40}$/.test(ext.pr.head || '')) return null;
    return { pr: ext.pr, wt: ext.path, branch: ext.branch };
  }
  const branch = 'auto/' + slug, pr = prsFor(proj)[branch];
  const wt = proj.hasPipeline ? worktreeOf(proj, slug) : null;
  if (!pr || pr.state !== 'OPEN' || !/^[0-9a-f]{40}$/.test(pr.head || '') || !wt || !existsSync(wt)) return null;
  return { pr, wt, branch };
};
const localState = async (proj, slug) => {
  const t = localTarget(proj, slug);
  if (!t) return { ok: true, none: true };
  const { pr, wt } = t;
  // pushed from elsewhere (GitHub, another Mac): the PR's head is not here yet. At most one
  // fetch a minute, so a fetch that fails (offline) is not tried again at every poll.
  if (!(await gitRaw(wt, ['cat-file', '-e', pr.head + '^{commit}'])).ok && Date.now() - (localFetchAt.get(wt) || 0) > 60000) {
    localFetchAt.set(wt, Date.now());
    await gitRaw(wt, ['fetch', '--quiet', 'origin', t.branch]);
  }
  const [br, head, ahead, behind, st, un, mb] = await Promise.all([
    gitRaw(wt, ['rev-parse', '--abbrev-ref', 'HEAD']), gitRaw(wt, ['rev-parse', 'HEAD']),
    gitRaw(wt, ['rev-list', '--count', pr.head + '..HEAD']), gitRaw(wt, ['rev-list', '--count', 'HEAD..' + pr.head]),
    gitRaw(wt, ['status', '--porcelain']), gitRaw(wt, ['ls-files', '--others', '--exclude-standard', '-z']),
    gitRaw(wt, ['merge-base', 'origin/' + pr.base, 'HEAD'])]);
  if (!ahead.ok) return { ok: false, output: 'The PR head ' + pr.head.slice(0, 7) + ' is not in ' + tilde(wt) + '.' };
  // git diff leaves out untracked files: each one is a diff against /dev/null (exit 1 = they differ)
  const news = un.out.split('\0').filter(Boolean).slice(0, UNTRACKED_MAX), parts = [];
  for (let i = 0; i < news.length; i += UNTRACKED_AT_ONCE)
    parts.push(...await Promise.all(news.slice(i, i + UNTRACKED_AT_ONCE).map((f) =>
      gitRaw(wt, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', f]).then((r) => r.out))));
  const untracked = parts.join('');
  const diff = async (from) => {
    const d = await gitRaw(wt, ['diff', '--no-color', '--no-ext-diff', from]);
    return d.ok ? d.out + untracked : null;
  };
  const [vsPr, vsBase] = await Promise.all([diff(pr.head), mb.ok ? diff(mb.out.trim()) : null]);
  const ch = chats.get(proj.name + '/' + slug);
  return { ok: true, branch: br.out.trim(), wanted: t.branch, head: head.out.trim(), prHead: pr.head, number: pr.number,
    ahead: +ahead.out || 0, behind: +behind.out || 0, dirty: st.out.split('\n').filter(Boolean).length,
    agentBusy: !!(ch && ch.busy), vsPr: vsPr ?? '', vsBase: vsBase ?? '',
    baseError: !mb.ok ? 'The worktree has no origin/' + pr.base + ' to compare with.' : vsBase == null ? 'git diff against ' + pr.base + ' failed.' : '' };
};
// the page asks every few seconds; an unchanged answer is one line, not the whole diff again
const localFor = async (proj, slug, since) => {
  const r = await localState(proj, slug);
  const sig = createHash('sha1').update(JSON.stringify(r)).digest('hex');
  return sig === since ? { ok: true, same: true, sig } : { ...r, sig };
};
// Push and Discard act only on what the page showed: a commit or an edit made since stops them
const localGuard = async (proj, slug, b) => {
  const t = localTarget(proj, slug);
  if (!t) return { error: 'This plan has no worktree with an open PR.' };
  if ((await localFor(proj, slug, '')).sig !== b.sig)
    return { error: 'The worktree changed since the page showed it. Look at the new changes first, then try again.' };
  const ch = chats.get(proj.name + '/' + slug);
  if (ch && ch.busy) return { error: 'The agent is working. Try again when it has stopped.' };
  if (await pipelineLive(proj, slug)) return { error: 'A run is working in this plan. Try again when it has stopped.' };
  const [br, head] = await Promise.all([gitRaw(t.wt, ['rev-parse', '--abbrev-ref', 'HEAD']), gitRaw(t.wt, ['rev-parse', 'HEAD'])]);
  if (br.out.trim() !== t.branch) return { error: 'The worktree is on ' + br.out.trim() + ', not ' + t.branch + '.' };
  if (head.out.trim() !== b.head) return { error: 'The worktree has a new commit since the page showed it. Look at it first, then try again.' };
  if (b.prHead && b.prHead !== t.pr.head) return { error: 'The PR changed on GitHub since the page loaded it. Reload, then try again.' };
  return t;
};
// the lock is taken before the checks: a chat message in between waits for the answer
const localLocked = async (proj, slug, b, act) => {
  const key = proj.name + '/' + slug;
  if (localLocks.has(key)) return { ok: false, output: 'A Push or Discard is running in this plan already.' };
  localLocks.add(key);
  try {
    const t = await localGuard(proj, slug, b);
    return t.error ? { ok: false, output: t.error } : await act(t);
  } finally { localLocks.delete(key); }
};
const localPush = (proj, slug, b) => localLocked(proj, slug, b, async (t) => {
  // the commit that was on screen, not whatever HEAD is by now; no force: GitHub refuses a non-fast-forward
  const r = await gitRaw(t.wt, ['push', 'origin', b.head + ':refs/heads/' + t.branch], 300000);
  const c = prLists[proj.root];
  if (c && c.loading) await c.loading;
  await refreshPrList(proj);
  return r.ok ? { ok: true } : { ok: false, output: 'git push failed: ' + r.err.split('\n').slice(-4).join(' ') };
});
const localDiscard = (proj, slug, b) => localLocked(proj, slug, b, async (t) => {
  // back to the PR's head: unpushed commits, edits and new files go; ignored files (.env, node_modules) stay
  const r = await gitRaw(t.wt, ['reset', '--hard', t.pr.head]);
  if (!r.ok) return { ok: false, output: 'git reset failed: ' + r.err };
  const c = await gitRaw(t.wt, ['clean', '-fd']);
  return c.ok ? { ok: true } : { ok: false, output: 'git clean failed: ' + c.err };
});
// one worktree file as it is on disk: the whole-file view of a local change
const localFile = (proj, slug, file) => {
  const t = localTarget(proj, slug);
  if (!t) return { ok: false, output: 'This plan has no worktree with an open PR.' };
  try {
    const root = realpathSync(t.wt), f = realpathSync(path.join(t.wt, file));
    if (!f.startsWith(root + path.sep)) return { ok: false, output: 'outside the worktree' };
    if (statSync(f).size > 8 * 1024 * 1024) return { ok: false, output: 'file too large' };
    return { ok: true, text: readFileSync(f, 'utf8') };
  } catch (e) { return { ok: false, output: e.code === 'ENOENT' ? 'not in the worktree' : e.message }; }
};

// ---------- chat: talk to a plan's Claude session from the browser ----------
// The chat panel (beside Files changed and the plan) keeps one `claude -p` per plan open and
// talks to it in stream-json both ways, the protocol the VS Code extension uses: messages and
// Stop go in, the answer streams out word by word, and a call that needs permission comes to
// the page as Allow / Deny (--permission-prompt-tool stdio). It resumes the plan's latest run
// session in the plan's own folder (claude finds a transcript by its cwd); Fork goes on in a
// copy (--fork-session), so the run's transcript keeps only what the run did. The history the
// panel shows is that session's transcript: the run and the chat in one list. A chat with no
// message for CHAT_IDLE_MS stops; the next message resumes the same session.
const CHAT_IDLE_MS = 15 * 60 * 1000;
const CHAT_MODES = ['default', 'acceptEdits', 'plan', 'auto'];
const chats = new Map();         // plan key -> the open claude
const chatClients = new Map();   // plan key -> the pages listening (server-sent events)
const chatNotes = new Map();     // plan key -> how the last claude ended, when it failed
// Each chat's claude runs under scripts/chat-relay.mjs, detached, so a restart of this server
// (launchctl kickstart -k ends its whole process group) does not end it. The relay listens on
// a socket in CHAT_SOCKS; a .json in CHAT_DIR says whose chat it is and where its socket is,
// and a restarted server reads those and connects again (chatReattach). One folder per port:
// a test server on another port never takes the live server's chats. The sockets sit in a
// short folder because macOS allows a socket path of 104 characters at most.
const CHAT_RELAY = fileURLToPath(new URL('./chat-relay.mjs', import.meta.url));
const CHAT_DIR = path.join(CENTRAL, 'chats', String(PORT));
const CHAT_SOCKS = '/tmp/plans-chat-' + (process.getuid?.() ?? 'u');
// the relay as the child process the chat code talks to: stdin, stdout, stderr, kill, exit
const relayChild = (sockPath) => {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  let sock = null, queue = [], ended = false, tries = 0;
  const end = (code) => { if (!ended) { ended = true; c.emit('exit', code); } };
  c.stdin = { write: (s) => { if (sock) sock.write(s); else if (!ended) queue.push(s); return true; }, on: () => {} };
  c.kill = () => c.stdin.write('{"relay":"kill"}\n');
  const connect = () => {
    const s = net.connect(sockPath);
    let buf = '', open = false;
    s.on('connect', () => { open = true; sock = s; for (const q of queue) s.write(q); queue = []; });
    s.on('error', () => {});
    s.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        const t = line[0], v = line.slice(2);
        if (t === 'o') c.stdout.emit('data', v + '\n');
        else if (t === 'e') { try { c.stderr.emit('data', JSON.parse(v)); } catch {} }
        else if (t === 'p') c.pid = +v;
        else if (t === 'b') c.emit('busy');
        else if (t === 'x') {
          let x = {};
          try { x = JSON.parse(v); } catch {}
          if (x.spawnError) { if (!ended) { ended = true; c.emit('error', new Error(x.spawnError)); } }
          else end(x.code);
        }
      }
    });
    s.on('close', () => {
      sock = null;
      // the relay is still starting: try again for a few seconds
      if (!open && !ended && ++tries < 100) return setTimeout(connect, 50);
      end(1);   // the relay went without saying how: claude is gone with it
    });
  };
  connect();
  return c;
};
// a chat's files: <hash>-<start>.json in CHAT_DIR (whose chat, for chatReattach) and the relay's socket in CHAT_SOCKS
const chatRelayStart = (key, meta, argv, cwd) => {
  mkdirSync(CHAT_DIR, { recursive: true });
  mkdirSync(CHAT_SOCKS, { recursive: true, mode: 0o700 });
  const base = path.join(CHAT_DIR, createHash('sha1').update(key).digest('hex').slice(0, 12) + '-' + Date.now().toString(36));
  const metaFile = base + '.json', sockPath = path.join(CHAT_SOCKS, createHash('sha1').update(base).digest('hex').slice(0, 16) + '.sock');
  writeFileSync(metaFile, JSON.stringify({ ...meta, sock: sockPath }));
  spawn(process.execPath, [CHAT_RELAY, sockPath, ...argv], { cwd, env: ENV, detached: true, stdio: 'ignore' }).unref();
  return { child: relayChild(sockPath), metaFile };
};
// after a restart: the chats still running come back, with the turn that runs now replayed
const chatReattach = () => {
  let files = [];
  try { files = readdirSync(CHAT_DIR).filter((f) => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    const metaFile = path.join(CHAT_DIR, f);
    let m = null;
    try { m = JSON.parse(readFileSync(metaFile, 'utf8')); } catch {}
    if (!m || !m.sock || !existsSync(m.sock)) { try { unlinkSync(metaFile); } catch {} continue; }
    const proj = projByName(m.project), key = proj && proj.name + '/' + m.slug;
    // a chat of a project no longer registered, or a second one for a plan: nobody can talk to it
    if (!proj || chats.has(key)) { relayChild(m.sock).kill(); try { unlinkSync(metaFile); } catch {} continue; }
    chatAttach(proj, m.slug, relayChild(m.sock), { ...m, metaFile, fresh: false });
    console.log('Chat ' + key + ' reconnected.');
  }
};
// a background shell (Bash run_in_background) is a zsh/bash/sh child of claude; its MCP servers are not shells
const shellsRunning = (pid) => new Promise((resolve) => {
  if (!pid) return resolve(false);
  execFile('pgrep', ['-lP', String(pid)], (e, out) => resolve(/^\d+\s+-?(zsh|bash|sh)$/m.test(out || '')));
});
const chatFile = (proj, slug) => path.join(proj.stateDir, 'ask', slug + '.json');
const loadChat = (proj, slug) => {
  try { return JSON.parse(readFileSync(chatFile(proj, slug), 'utf8')); } catch { return {}; }
};
const saveChat = (proj, slug, a) => {
  mkdirSync(path.dirname(chatFile(proj, slug)), { recursive: true });
  writeFileSync(chatFile(proj, slug), JSON.stringify(a, null, 2));
};
// The pinned session moves to its VS Code copy once you continue the copy there.
// A project's vscode-session-copy.mjs forks headless sessions into copies the extension
// lists, and records old id -> copy id in .vscode-copies.json in the transcript dir.
// Without this the panel kept showing the old session and the next message went on in it.
// Not while the chat is open: its claude is on the pinned session.
const followVscodeCopy = (proj, slug, a) => {
  if (!a.current || chats.has(proj.name + '/' + slug)) return a;
  const dir = transcriptDirFor(proj.hasPipeline ? worktreeOf(proj, slug) : proj.root);
  let to;
  try { to = JSON.parse(readFileSync(path.join(dir, '.vscode-copies.json'), 'utf8'))[a.current.id]; } catch { return a; }
  if (!to || to === a.current.id) return a;
  const mtime = (id) => { try { return statSync(path.join(dir, id + '.jsonl')).mtimeMs; } catch { return -1; } };
  const copyAt = mtime(to);
  if (copyAt < 0 || copyAt <= mtime(a.current.id)) return a;
  a.current = { ...a.current, id: to };
  saveChat(proj, slug, a);
  return a;
};
// the sessions a plan's runs made; the chat's copies are its own and not listed
const planSessions = (proj, slug) => {
  const wtPath = proj.hasPipeline ? worktreeOf(proj, slug) : proj.root;
  const transcriptDir = transcriptDirFor(wtPath);
  const copies = new Set(loadChat(proj, slug).copies || []);
  const sessions = sessionsIn(transcriptDir, proj.hasPipeline ? null : sessionIdsInLog(proj, slug))
    .filter((s) => !copies.has(s.id));
  return { wtPath, transcriptDir, sessions };
};
// headless runs ignore .claude/settings.json, so its allow rules travel on the command line
const repoAllowRules = (dirs) => {
  const rules = new Set();
  for (const d of new Set(dirs))
    for (const f of ['settings.json', 'settings.local.json'])
      try {
        for (const r of JSON.parse(readFileSync(path.join(d, '.claude', f), 'utf8')).permissions?.allow || [])
          rules.add(String(r));
      } catch {}
  return [...rules];
};
const planPathOf = (proj, slug) => {
  const f = path.join(proj.plansDir, slug + '.md');
  return existsSync(f) ? f : path.join(proj.doneDir, slug + '.md');
};

// --- the history: a transcript read as the panel shows it ---
// The transcript is append-only JSONL, a few MB after a long run, so each look reads only
// what was added since the last one. A tool call is one item; its result joins it later.
const transcripts = new Map();   // file -> { size, rest, items, tools }; the 12 last read
const TRANSCRIPTS_KEPT = 12;
const clip = (s, n) => (s = String(s ?? ''), s.length > n ? s.slice(0, n) + '\n… (' + (s.length - n) + ' more characters)' : s);
const toolSummary = (name, i, cwd) => {
  const rel = (f) => (cwd && String(f).startsWith(cwd + '/') ? String(f).slice(cwd.length + 1) : String(f));
  const v = i.command || (i.file_path && rel(i.file_path)) || (i.notebook_path && rel(i.notebook_path))
    || i.pattern || i.url || i.query || i.skill || i.description || i.prompt || '';
  return String(v).replace(/\s+/g, ' ').slice(0, 240);
};
const toolInput = (name, i) => {
  if (name === 'Bash') return clip(i.command, 3000);
  if (name === 'Edit') return clip((i.old_string || '').split('\n').map((l) => '- ' + l).join('\n') + '\n' +
    (i.new_string || '').split('\n').map((l) => '+ ' + l).join('\n'), 3000);
  if (name === 'Write') return clip(i.content, 3000);
  if (name === 'Read') return '';
  const rest = { ...i };
  delete rest.file_path; delete rest.description;
  return Object.keys(rest).length ? clip(JSON.stringify(rest, null, 2), 3000) : '';
};
const resultText = (c) => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((x) => x.type === 'text' ? x.text : x.type === 'image' ? '[image]' : '').join('\n') : '';
// <ide_selection> is the VS Code extension's way to send selected lines; the chat sends the same
const SEL_RE = /^<ide_selection>The user selected (?:the lines (\d+) to (\d+)|this text) (?:from|in) (?:the version before this pull request of )?(.*?):\n/;
const selLabel = (t, cwd) => {
  const m = SEL_RE.exec(t);
  if (!m) return null;
  const f = m[3].startsWith(cwd + '/') ? m[3].slice(cwd.length + 1) : m[3];
  const name = f.slice(f.lastIndexOf('/') + 1) || 'selected text';
  return name + (m[1] ? ':' + m[1] + (m[2] !== m[1] ? '-' + m[2] : '') : '') + (t.includes('before this pull request') ? ' (before)' : '');
};
// the selected text itself, so a click on the chip shows what went with the message
const selBody = (t) => clip(t.slice((SEL_RE.exec(t) || [''])[0].length)
  .replace(/(?:\n\nThis may or may not be related to the current task\.)?<\/ide_selection>\s*$/, ''), 20000);
const tagText = (s, tag) => ((s.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>')) || [])[1] || '').trim();
// A subagent's report reaches the session as a message: queued during a turn, or as a meta line
// between turns. The frame is for the model, and the harness indents each line of the report.
const HAND_BACK_RE = /^(?:Another Claude session sent a message:\n)?<agent-message from="[^"]*">\n\[Subagent hand-back\][^\n]*\n([\s\S]*?)\n<\/agent-message>/;
const handBackItem = (s) => {
  const m = HAND_BACK_RE.exec(s);
  if (!m) return null;
  const body = m[1].replace(/^ {2}/gm, '');
  const title = (body.split('\n').find((l) => l.trim()) || '').replace(/^[#\s]+/, '').replace(/\*\*/g, '');
  return { k: 'note', text: 'Subagent report' + (title ? ': ' + title : ''), body, report: true };
};
const userItems = (t, j, cwd) => {
  const c = j.message?.content;
  const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  const you = [], sel = [], selText = [], n0 = t.items.length;
  let imgs = 0;
  for (const b of blocks) {
    if (b.type === 'tool_result') {
      const it = t.tools.get(b.tool_use_id);
      if (it) { it.out = clip(resultText(b.content), 4000); it.err = !!b.is_error; it.done = true; it.end = j.timestamp; }
      continue;
    }
    if (b.type === 'image') { imgs++; continue; }
    if (b.type !== 'text' || !b.text) continue;
    const s = b.text;
    if (s.startsWith('<ide_selection>')) { const l = selLabel(s, cwd); if (l) { sel.push(l); selText.push(selBody(s)); } continue; }
    if (s.startsWith('<ide_opened_file>') || s.includes('<local-command-caveat>')) continue;
    if (j.isCompactSummary) { t.items.push({ k: 'note', text: 'The earlier conversation was compacted', body: clip(s, 6000) }); continue; }
    const report = handBackItem(s);
    if (report) { t.items.push(report); continue; }
    if (j.isMeta) {
      const m = /^Base directory for this skill: (.*)/.exec(s);
      if (m) t.items.push({ k: 'note', text: 'Skill loaded: ' + m[1].slice(m[1].lastIndexOf('/') + 1), body: clip(s, 6000) });
      continue;
    }
    if (s.includes('<command-name>')) {
      you.push(tagText(s, 'command-name') + (tagText(s, 'command-args') ? ' ' + tagText(s, 'command-args') : ''));
      continue;
    }
    if (s.includes('<local-command-stdout>') || s.includes('<local-command-stderr>')) {
      const out = tagText(s, 'local-command-stdout') || tagText(s, 'local-command-stderr');
      if (out) t.items.push({ k: 'note', text: 'Command output', body: clip(out, 6000) });
      continue;
    }
    if (s.startsWith('<task-notification>')) {
      t.items.push({ k: 'note', text: 'Background task: ' + (tagText(s, 'summary') || tagText(s, 'status') || 'finished'), body: clip(s, 4000) });
      continue;
    }
    if (/^\[Request interrupted by user/.test(s)) { t.items.push({ k: 'note', text: 'Stopped' }); continue; }
    you.push(s);
  }
  // notes (task notices, command output) get the line's time too: the page shows it on hover
  for (const it of t.items.slice(n0)) if (!it.at) it.at = j.timestamp;
  // A slash command sent with a selection reaches the transcript as two entries of one prompt:
  // the command, then the selection alone. Put the selection on the command's bubble.
  if (!you.length && !imgs && sel.length) {
    let i = t.items.length - 1;
    while (i >= 0 && t.items[i].k === 'note') i--;
    const prev = t.items[i];
    if (prev && prev.k === 'you' && !prev.sel.length && (!prev.pid || !j.promptId || prev.pid === j.promptId)) {
      prev.sel = sel; prev.selText = selText;
      return;
    }
  }
  if (you.length || sel.length || imgs) t.items.push({ k: 'you', text: you.join('\n\n'), sel, selText, imgs,
    ...(imgs && j.imgLine ? { img: j.imgLine } : {}), at: j.timestamp, pid: j.promptId });
};
const assistantItems = (t, j, cwd) => {
  for (const b of j.message?.content || []) {
    const at = j.timestamp;
    if (b.type === 'text' && b.text?.trim()) t.items.push({ k: 'agent', text: b.text.trim(), mid: j.message.id, at });
    else if (b.type === 'thinking' && b.thinking?.trim()) t.items.push({ k: 'think', text: clip(b.thinking.trim(), 6000), at });
    else if (b.type === 'tool_use') {
      const i = b.input || {};
      const it = { k: 'tool', name: b.name, sum: toolSummary(b.name, i, cwd), input: toolInput(b.name, i), done: false, at };
      t.tools.set(b.id, it);
      t.items.push(it);
    }
  }
};
const usageTokens = (u) => u ? (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0) : 0;
const transcriptLine = (t, line, cwd) => {
  // most lines are request copies and attachments; only messages are worth parsing, and
  // a slash command's output (/context, /cost) is a system line of its own, and a message
  // sent during a turn (or a background task's notice) is a queued_command attachment
  if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('"subtype":"compact_boundary"')
    && !line.includes('"subtype":"local_command"') && !line.includes('"type":"queued_command"')) return;
  let j;
  try { j = JSON.parse(line); } catch { return; }
  if (j.isSidechain) return;
  if (j.type === 'system' && j.subtype === 'local_command') userItems(t, { message: { content: j.content }, timestamp: j.timestamp }, cwd);
  // t.used: the context size the last answer reported. A compact makes it out of date, and
  // the transcript has no size to replace it: its post_tokens leaves out the system prompt and tools.
  else if (j.type === 'system' && j.subtype === 'compact_boundary') t.used = null;
  else if (j.type === 'attachment' && j.attachment?.type === 'queued_command') {
    userItems(t, { message: { content: j.attachment.prompt }, timestamp: j.attachment.timestamp || j.timestamp, imgLine: j.uuid }, cwd);
  }
  else if (j.type === 'user') userItems(t, { ...j, imgLine: j.uuid }, cwd);
  else if (j.type === 'assistant') {
    t.used = usageTokens(j.message?.usage) || t.used;   // an API error's line reports zero tokens
    assistantItems(t, j, cwd);
  }
};
const readTranscript = (file, cwd, parseLine = transcriptLine) => {
  let st;
  try { st = statSync(file); } catch { return { items: [] }; }
  let t = transcripts.get(file);
  if (!t || st.size < t.size) t = { size: 0, rest: '', items: [], tools: new Map() };
  transcripts.delete(file);
  transcripts.set(file, t);   // last read goes last; the first one is the oldest
  if (transcripts.size > TRANSCRIPTS_KEPT) transcripts.delete(transcripts.keys().next().value);
  if (st.size > t.size) {
    const fd = openSync(file, 'r');
    const buf = Buffer.alloc(st.size - t.size);
    readSync(fd, buf, 0, buf.length, t.size);
    closeSync(fd);
    t.size = st.size;
    const lines = (t.rest + buf.toString('utf8')).split('\n');
    t.rest = lines.pop();
    for (const line of lines) parseLine(t, line, cwd);
  }
  return t;
};
// the transcript the panel shows: the live chat's, the chat's last, or the run's latest
const chatTranscript = (proj, slug) => {
  const { wtPath, transcriptDir, sessions } = planSessions(proj, slug);
  const a = followVscodeCopy(proj, slug, loadChat(proj, slug)), ch = chats.get(proj.name + '/' + slug);
  const ids = [ch && ch.session, a.current && a.current.id, a.current && a.current.base, (sessions.at(-1) || {}).id];
  for (const id of ids.filter(Boolean)) {
    const file = path.join(transcriptDir, id + '.jsonl');
    if (existsSync(file)) return { id, file, wtPath };
  }
  return null;
};
// a page of items: the last `limit`, the `limit` before index `before`, or all from index `from`
const itemsPage = (all, q) => {
  const limit = Math.min(500, Math.max(1, +q.limit || 150));
  let lo, hi = all.length;
  if (q.from != null && q.from !== '') lo = Math.max(0, Math.min(all.length, +q.from || 0));
  else if (q.before != null && q.before !== '') { hi = Math.max(0, Math.min(all.length, +q.before || 0)); lo = Math.max(0, hi - limit); }
  else lo = Math.max(0, hi - limit);
  return { total: all.length, first: lo, items: all.slice(lo, hi).map((it, n) => ({ ...it, i: lo + n })) };
};
const chatHistory = (proj, slug, q) => {
  const tr = chatTranscript(proj, slug);
  if (!tr) return { session: null, total: 0, first: 0, items: [], landed: chatLandSeq };
  const items = readTranscript(tr.file, tr.wtPath).items, ch = chats.get(proj.name + '/' + slug);
  if (ch) chatLanded(ch, items);
  // landed goes with these items: the page takes an answer out of the live area as it adds it to the list
  return { session: tr.id, landed: ch ? ch.landed : chatLandSeq, ...itemsPage(items, q) };
};
// a pasted picture of a message in the chat's transcript: the transcript keeps it as an image
// block of the line with this uuid (a message sent during a turn keeps it in its attachment)
const chatImage = (proj, slug, uuid, n) => {
  const tr = chatTranscript(proj, slug);
  if (!tr || !/^[0-9a-f-]{36}$/.test(uuid) || !/^\d{1,2}$/.test(n)) return null;
  let all;
  try { all = readFileSync(tr.file, 'utf8'); } catch { return null; }
  const at = all.indexOf('"uuid":"' + uuid + '"');
  if (at < 0) return null;
  let j;
  try { j = JSON.parse(all.slice(all.lastIndexOf('\n', at) + 1, (all.indexOf('\n', at) + 1 || all.length + 1) - 1)); } catch { return null; }
  const c = j.message?.content || j.attachment?.prompt;
  const b = (Array.isArray(c) ? c : []).filter((x) => x.type === 'image')[+n];
  const type = b?.source?.media_type;
  if (b?.source?.type !== 'base64' || !CHAT_IMG_TYPES.has(type)) return null;
  return { type, data: Buffer.from(b.source.data, 'base64') };
};

// --- the live session ---
const chatSend = (ch, o) => { try { ch.child.stdin.write(JSON.stringify(o) + '\n'); } catch {} };
const chatControl = (ch, request) => new Promise((resolve) => {
  const id = 'dash-' + Math.random().toString(36).slice(2);
  ch.pending.set(id, resolve);
  chatSend(ch, { type: 'control_request', request_id: id, request });
  setTimeout(() => { if (ch.pending.delete(id)) resolve(null); }, 20000);
});
const chatEmit = (key, event, data) => {
  for (const res of chatClients.get(key) || []) res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
};
const chatEmitState = (proj, slug) => {
  const key = proj.name + '/' + slug;
  if ((chatClients.get(key) || new Set()).size) chatEmit(key, 'state', chatState(proj, slug));
};
// the transcript is written around the time stdout says so: look a little later, and again
const chatHistorySoon = (ch) => {
  clearTimeout(ch.histTimer);
  clearTimeout(ch.histAgain);
  ch.histTimer = setTimeout(() => chatEmit(ch.key, 'history', {}), 250);
  ch.histAgain = setTimeout(() => chatEmit(ch.key, 'history', {}), 1000);
};
// claude prints a finished text block at once but logs it with the whole message, so after a
// long tool input the log has it seconds later. Until then the block stays in the live area.
// Ids grow across restarts, so a page never takes a new block for one that has landed.
let chatLandSeq = Date.now();
const chatLanded = (ch, items) => {
  while (ch.landing.length) {
    const l = ch.landing[0];
    if (!items.some((it) => it.k === 'agent' && it.mid === l.mid && it.text === l.text)) return;
    ch.landing.shift();
    ch.landed = l.id;
  }
};
const chatLandWatch = (ch) => {
  if (ch.landTimer) return;
  ch.landTimer = setInterval(() => {
    const was = ch.landing.length;
    const tr = was && chats.get(ch.key) === ch && chatTranscript(ch.proj, ch.slug);
    if (tr) chatLanded(ch, readTranscript(tr.file, tr.wtPath).items);
    if (ch.landing.length < was) chatEmit(ch.key, 'history', {});
    if (!ch.landing.length || chats.get(ch.key) !== ch) { clearInterval(ch.landTimer); ch.landTimer = null; }
  }, 200);
};
// closing marks the chat at once: a message sent before its exit opens a new session
const chatKill = (ch) => { ch.closing = true; ch.child.kill(); };
const chatIdle = (ch) => {
  clearTimeout(ch.idleTimer);
  ch.idleTimer = setTimeout(async () => {
    if (ch.busy || ch.waits.size || await shellsRunning(ch.child.pid)) return chatIdle(ch);
    if (chats.get(ch.key) !== ch || ch.busy) return;
    chatKill(ch);
  }, CHAT_IDLE_MS);
};
// 4, 8: the mode and the model the page asks for. The mode is sent only when it differs from
// the session's, which claude reports at each turn (it leaves Plan mode on its own), unless the
// person picked it just now.
const MODEL_RE = /^[A-Za-z0-9.[\]-]{1,60}$/;
const chatModel = (m) => (MODEL_RE.test(m || '') ? m : 'default');
const applyModeModel = (ch, b, picked) => {
  if (CHAT_MODES.includes(b.mode) && (picked || b.mode !== ch.mode)) {
    ch.mode = b.mode;
    chatControl(ch, { subtype: 'set_permission_mode', mode: b.mode });
  }
  const model = chatModel(b.model);
  if (model !== ch.model) { ch.model = model; chatControl(ch, { subtype: 'set_model', model }).then(() => chatContextRefresh(ch)); }
  chatMetaSave(ch);
};
const chatMetaSave = (ch) => {
  if (!ch.metaFile || !existsSync(ch.metaFile)) return;
  try {
    const m = JSON.parse(readFileSync(ch.metaFile, 'utf8'));
    writeFileSync(ch.metaFile, JSON.stringify({ ...m, session: ch.session, fork: ch.fork, mode: ch.mode, model: ch.model }));
  } catch {}
};
// how full the session's context is, asked of claude itself: the count includes the system
// prompt and tools. It is asked when the session opens, at the end of each turn (a /compact is
// a turn), after a model change (the window can differ), and at most every CHAT_CONTEXT_MS
// during a long turn. The last answer is saved for the time the session is closed.
const CHAT_CONTEXT_MS = 15000;
const chatContextRefresh = async (ch) => {
  ch.contextAt = Date.now();
  const r = await chatControl(ch, { subtype: 'get_context_usage' });
  const u = r && r.subtype === 'success' && r.response;
  if (!u || !Number.isFinite(u.totalTokens) || chats.get(ch.key) !== ch) return;
  ch.context = { used: u.totalTokens, max: u.maxTokens || 0 };
  const a = loadChat(ch.proj, ch.slug);
  saveChat(ch.proj, ch.slug, { ...a, context: { ...ch.context, session: ch.session } });
  chatEmitState(ch.proj, ch.slug);
};
// closed session: the last answer's size from the transcript, or after a compact the saved one
const chatContext = (proj, slug, ch, a) => {
  if (ch && ch.context) return ch.context;
  const tr = chatTranscript(proj, slug);
  if (!tr) return null;
  const saved = a.context || {};
  const used = readTranscript(tr.file, tr.wtPath).used || (saved.session === tr.id ? saved.used : 0);
  return used ? { used, max: saved.max || 0 } : null;
};
// the commands, skills and models a session in that folder offers: from the open chat, or a
// claude started only to answer the first question of the protocol (no message is sent)
const chatMetaCache = new Map();   // cwd -> { at, commands, models }
const metaOf = (r) => r && r.subtype === 'success' && r.response ? {
  at: Date.now(),
  commands: (r.response.commands || []).map((c) => ({ name: c.name, description: String(c.description || '').slice(0, 300), hint: c.argumentHint || '' })),
  models: (r.response.models || []).map((m) => ({ value: m.value, name: m.displayName || m.value, description: m.description || '' })),
} : null;
const chatMetaLookups = new Map();   // cwd -> the lookup running now, shared by every page asking
const chatMeta = (proj, slug) => {
  const { wtPath } = planSessions(proj, slug);
  const hit = chatMetaCache.get(wtPath);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve({ ok: true, ...hit });
  if (!chatMetaLookups.has(wtPath))
    chatMetaLookups.set(wtPath, chatMetaProbe(wtPath).finally(() => chatMetaLookups.delete(wtPath)));
  return chatMetaLookups.get(wtPath);
};
const chatMetaProbe = async (wtPath) => {
  if (!existsSync(wtPath)) return { ok: false, commands: [], models: [] };
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--permission-prompt-tool', 'stdio'], { cwd: wtPath, env: ENV, stdio: ['pipe', 'pipe', 'ignore'] });
  const probe = { child, pending: new Map() };
  const ended = () => { for (const f of probe.pending.values()) f(null); probe.pending.clear(); };
  child.on('error', ended);
  child.on('exit', ended);
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try {
        const j = JSON.parse(line), f = j.type === 'control_response' && probe.pending.get(j.response?.request_id);
        if (f) { probe.pending.delete(j.response.request_id); f(j.response); }
      } catch {}
    }
  });
  child.stdin.on('error', () => {});
  const m = metaOf(await chatControl(probe, { subtype: 'initialize' }));
  // the window size, so a session never chatted with can already show its percent
  const u = m && await chatControl(probe, { subtype: 'get_context_usage' });
  child.kill('SIGTERM');
  if (!m) return { ok: false, commands: [], models: [] };
  m.contextMax = u?.response?.maxTokens || 0;
  chatMetaCache.set(wtPath, m);
  return { ok: true, ...m };
};
const chatOnLine = (ch, j) => {
  const { proj, slug } = ch;
  if (j.session_id && j.session_id !== ch.session && !j.parent_tool_use_id) {
    ch.session = j.session_id;
    const a = loadChat(proj, slug);
    if (ch.fork && a.current && j.session_id !== a.current.id) {
      a.copies = [...new Set([...(a.copies || []), j.session_id])];
      a.current = { id: j.session_id, base: a.current.base, copy: true };
      a.fork = false;
      ch.fork = false;
    } else if (a.current) a.current.id = j.session_id;
    saveChat(proj, slug, a);
    chatMetaSave(ch);
    chatEmitState(proj, slug);
  }
  if (j.type === 'system' && j.subtype === 'init' && CHAT_MODES.includes(j.permissionMode) && j.permissionMode !== ch.mode) {
    ch.mode = j.permissionMode;
    chatEmitState(proj, slug);
  }
  // a message sent during a turn may be answered in that turn or in a turn of its own, so
  // busy is "a turn is running": on when one starts, off at its result
  if (!j.parent_tool_use_id && !ch.busy && (j.type === 'assistant' || (j.type === 'stream_event' && j.event?.type === 'message_start'))) {
    ch.busy = true;
    chatEmitState(proj, slug);
  }
  if (j.type === 'stream_event') {
    if (j.parent_tool_use_id) return;   // a subagent's words: its tool line says enough
    const e = j.event || {};
    if (e.type === 'message_start') {
      ch.partial = ''; chatEmit(ch.key, 'delta', { reset: true });
      chatHistorySoon(ch);   // a queued message the agent has just read moves up, above this new step
    }
    else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
      ch.partial += e.delta.text;
      chatEmit(ch.key, 'delta', { text: e.delta.text });
    }
  } else if (j.type === 'control_request' && j.request?.subtype === 'can_use_tool') {
    ch.waits.set(j.request_id, j.request);
    chatEmitState(proj, slug);
  } else if (j.type === 'control_cancel_request') {
    ch.waits.delete(j.request_id);
    chatEmitState(proj, slug);
  } else if (j.type === 'control_response') {
    const f = ch.pending.get(j.response?.request_id);
    if (f) { ch.pending.delete(j.response.request_id); f(j.response); }
  } else if (j.type === 'assistant' || j.type === 'user') {
    if (!j.parent_tool_use_id) {
      if (j.type === 'assistant') for (const b of j.message?.content || [])
        if (b.type === 'text' && b.text?.trim()) ch.landing.push({ id: ++chatLandSeq, mid: j.message.id, text: b.text.trim() });
      ch.partial = ''; chatEmit(ch.key, 'delta', { reset: true, landing: ch.landing });
      if (ch.landing.length) chatLandWatch(ch);
      if (Date.now() - (ch.contextAt || 0) > CHAT_CONTEXT_MS) chatContextRefresh(ch);
    }
    chatHistorySoon(ch);
  } else if (j.type === 'result') {
    ch.turnsEnded++;
    ch.busy = false;
    ch.partial = '';
    ch.waits.clear();
    ch.last = { ok: !j.is_error && j.subtype === 'success', subtype: j.subtype, cost: j.total_cost_usd };
    chatEmitState(proj, slug);
    chatContextRefresh(ch);
    chatHistorySoon(ch);
    const upTo = chatLandSeq;
    setTimeout(() => {
      // the turn is over and the log is written: a block still waiting will not come
      if (ch.landing.some((l) => l.id <= upTo)) { ch.landing = ch.landing.filter((l) => l.id > upTo); ch.landed = Math.max(ch.landed, upTo); }
      chatEmit(ch.key, 'history', {});
    }, 1200);
    chatIdle(ch);
  }
};
const chatStart = (proj, slug, b) => {
  const key = proj.name + '/' + slug;
  const { wtPath, sessions } = planSessions(proj, slug);
  const a = followVscodeCopy(proj, slug, loadChat(proj, slug));
  const id = a.current ? a.current.id : (sessions.at(-1) || {}).id;
  if (!id) return { error: 'This plan has no Claude session to continue yet.' };
  if (!a.current) a.current = { id, base: id, copy: false };
  const fork = !!a.fork;
  saveChat(proj, slug, a);
  const mode = CHAT_MODES.includes(b.mode) ? b.mode : 'default';
  const model = chatModel(b.model) === 'default' ? '' : b.model;
  const rules = repoAllowRules([wtPath, proj.root]);
  // the flags the VS Code extension starts its sessions with; --allowedTools takes every word
  // after it, so it comes last
  const meta = { project: proj.name, slug, session: fork ? null : id, fork, mode, model: model || 'default' };
  const { child, metaFile } = chatRelayStart(key, meta, ['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--setting-sources', 'user,project,local', '--permission-prompt-tool', 'stdio', '--permission-mode', mode,
    ...(model ? ['--model', model] : []), '--resume', id, ...(fork ? ['--fork-session'] : []),
    ...(rules.length ? ['--allowedTools', ...rules] : [])], wtPath);
  return chatAttach(proj, slug, child, { ...meta, metaFile, fresh: true });
};
// the chat's state around its claude. fresh: claude has just started; otherwise this is a
// reconnect after a restart, and the relay replays the turn running now through chatOnLine.
const chatAttach = (proj, slug, child, { session, fork, mode, model, metaFile, fresh }) => {
  const key = proj.name + '/' + slug, { wtPath } = planSessions(proj, slug);
  const ch = { key, proj, slug, child, metaFile, session, fork: !!fork, mode, model: model || 'default', busy: false,
    closing: false, turnsEnded: 0, partial: '', landing: [], landed: 0, waits: new Map(), pending: new Map(), err: '', last: null };
  chats.set(key, ch);
  chatNotes.delete(key);
  const gone = () => { try { unlinkSync(metaFile); } catch {} };
  child.on('exit', gone);
  child.on('error', gone);
  // a reconnect: the relay says a turn is running before it replays it
  child.on('busy', () => { ch.busy = true; });
  child.stdin.on('error', () => {});
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      chatOnLine(ch, j);
    }
  });
  child.stderr.on('data', (d) => { ch.err = (ch.err + d).slice(-2000); });
  const done = (code) => {
    if (chats.get(key) !== ch) return;
    chats.delete(key);
    clearTimeout(ch.idleTimer);
    for (const f of ch.pending.values()) f(null);
    if (code && ch.busy) chatNotes.set(key, (ch.err.trim() || 'claude stopped (exit ' + code + ')').slice(-600));
    chatEmitState(proj, slug);
    chatEmit(key, 'history', {});
  };
  child.on('exit', done);
  child.on('error', (e) => { ch.err = 'Could not start claude: ' + e.message; ch.busy = true; done(-1); });
  if (fresh) chatControl(ch, { subtype: 'initialize' }).then((r) => {
    const m = metaOf(r);
    if (m) chatMetaCache.set(wtPath, { ...chatMetaCache.get(wtPath), ...m });
    chatContextRefresh(ch);
  });
  else chatContextRefresh(ch);
  chatIdle(ch);
  return ch;
};
// a message from the page; it starts the session when none is open
const chatMessage = async (proj, slug, b) => {
  const key = proj.name + '/' + slug;
  const q = String(b.text || '').trim().slice(0, 20000);
  const imgs = chatImages(b.images);
  if (imgs.error) return { ok: false, output: imgs.error };
  if (!q && !imgs.length) return { ok: false, output: 'Type a message first.' };
  if (localLocks.has(key)) return { ok: false, output: 'A Push or Discard is running in this plan. Send it when that has finished.' };
  const { wtPath } = planSessions(proj, slug);
  let ch = chats.get(key);
  if (ch && ch.closing) {
    // it is being closed (idle, a run starting, Stop): let it go, then open the session again
    await new Promise((r) => { ch.child.once('exit', r); setTimeout(r, 5000); });
    if (chats.get(key) === ch) chats.delete(key);
    ch = chats.get(key);
  }
  if (!ch) {
    if (!existsSync(wtPath)) return { ok: false, output: 'The folder ' + tilde(wtPath) + ' is gone, so the session cannot run there.' };
    if (existsSync(path.join(proj.plansDir, slug + '.md'))
      && (proj.hasPipeline ? await pipelineLive(proj, slug) : genericRunInfo(proj, slug).live))
      return { ok: false, output: 'A run or another chat is working in this plan right now. Send it when that has stopped.' };
    ch = chatStart(proj, slug, b);
    if (ch.error) return { ok: false, output: ch.error };
  } else applyModeModel(ch, b, false);   // the pickers change the open session, as the extension's do
  const content = [];
  const sel = selectionTag(proj, slug, wtPath, b.selection);
  if (sel) content.push({ type: 'text', text: sel });
  content.push(...imgs);
  if (q) content.push({ type: 'text', text: q });
  chatSend(ch, { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content } });
  ch.busy = true;
  ch.partial = '';
  chatIdle(ch);
  chatEmitState(proj, slug);
  return { ok: true };
};
// pasted pictures, as the image blocks the VS Code extension sends; the page scales them down first
const CHAT_IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const chatImages = (list) => {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > 10) return { error: 'Send at most 10 images in one message.' };
  const out = [];
  for (const x of list) {
    const type = String(x?.media_type || ''), data = String(x?.data || '');
    if (!CHAT_IMG_TYPES.has(type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      return { error: 'An image is not a PNG, JPEG, GIF or WebP picture.' };
    if (data.length > 7e6) return { error: 'An image is larger than 5 MB.' };
    out.push({ type: 'image', source: { type: 'base64', media_type: type, data } });
  }
  return out;
};
// lines picked in the diff or the plan, in the words the VS Code extension uses for them
const selectionTag = (proj, slug, wtPath, s) => {
  if (!s || typeof s.text !== 'string' || !s.text.trim()) return '';
  const file = String(s.file || '');
  if (file && (file.startsWith('/') || file.split('/').some((x) => x === '..'))) return '';
  const abs = s.side === 'plan' ? planPathOf(proj, slug) : file ? path.join(wtPath, file) : '';
  const where = !abs ? 'the dashboard' : s.side === 'old' ? 'the version before this pull request of ' + abs : abs;
  const lines = +s.start > 0 && +s.end >= +s.start ? 'the lines ' + +s.start + ' to ' + +s.end + ' from ' : 'this text ' + (abs ? 'from ' : 'in ');
  return '<ide_selection>The user selected ' + lines + where + ':\n' + s.text.slice(0, 20000) +
    '\n\nThis may or may not be related to the current task.</ide_selection>';
};
const chatAnswer = (proj, slug, b) => {
  const ch = chats.get(proj.name + '/' + slug), req = ch && ch.waits.get(b.id);
  if (!req) return { ok: false, output: 'The agent no longer waits for this answer.' };
  ch.waits.delete(b.id);
  // "for this chat": the rules claude suggested, kept for this session only
  const rules = (req.permission_suggestions || []).filter((s) => s.type === 'addRules')
    .map((s) => ({ ...s, destination: 'session' }));
  // "all edits": the session switches to acceptEdits, as the extension's "allow all edits" does
  const edits = b.edits && (req.permission_suggestions || []).some((s) => s.type === 'setMode' && s.mode === 'acceptEdits');
  if (edits) ch.mode = 'acceptEdits';
  // an approved plan ends Plan mode; the next turn's init says which mode claude went on in
  if (b.allow && req.tool_name === 'ExitPlanMode' && ch.mode === 'plan') ch.mode = 'default';
  // AskUserQuestion: the answers go into the tool's input, keyed by the question text, as the
  // extension's question form sends them
  let input = req.input || {};
  if (b.allow && req.tool_name === 'AskUserQuestion' && b.answers && typeof b.answers === 'object') {
    const asked = new Set((input.questions || []).map((q) => q.question));
    const answers = Object.fromEntries(Object.entries(b.answers)
      .filter(([q, a]) => asked.has(q) && typeof a === 'string' && a.trim()).map(([q, a]) => [q, a.trim().slice(0, 4000)]));
    if (!Object.keys(answers).length) { ch.waits.set(b.id, req); return { ok: false, output: 'Pick an answer first.' }; }
    input = { ...input, answers };
  }
  const response = b.allow
    ? { behavior: 'allow', updatedInput: input, ...(edits ? { updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }
      : b.always && rules.length ? { updatedPermissions: rules } : {}) }
    : { behavior: 'deny', message: String(b.message || 'The user said no. Wait for their next message.').slice(0, 2000) };
  chatSend(ch, { type: 'control_response', response: { subtype: 'success', request_id: b.id, response } });
  chatEmitState(proj, slug);
  return { ok: true };
};
const chatStop = (proj, slug) => {
  const ch = chats.get(proj.name + '/' + slug);
  if (!ch) return { ok: true };
  for (const id of ch.waits.keys())
    chatSend(ch, { type: 'control_response', response: { subtype: 'success', request_id: id,
      response: { behavior: 'deny', message: 'The user stopped this.', interrupt: true } } });
  ch.waits.clear();
  chatControl(ch, { subtype: 'interrupt' });
  // a turn that does not end on the interrupt ends with the process. A turn that did end may
  // be followed at once by a new one for the queued messages, and that one stays.
  const turns = ch.turnsEnded;
  setTimeout(() => { if (chats.get(ch.key) === ch && ch.busy && ch.turnsEnded === turns) chatKill(ch); }, 8000);
  return { ok: true };
};
// a run is starting in this folder: the chat gives way (its transcript stays)
const chatEnd = (key) => { const ch = chats.get(key); if (ch) chatKill(ch); };
// Fork: the next message goes on in a copy of this session. New chat: the next message
// starts again from the run's latest session. Both close the open claude.
const chatRestart = (proj, slug, fork) => {
  const key = proj.name + '/' + slug, ch = chats.get(key);
  if (ch && ch.busy) return { ok: false, output: 'The agent is still working. Stop it or wait for the answer first.' };
  if (ch) { chats.delete(key); ch.child.kill(); }
  const a = loadChat(proj, slug);
  if (fork) a.fork = true;
  else { a.current = null; a.fork = false; }
  saveChat(proj, slug, a);
  chatNotes.delete(key);
  chatEmitState(proj, slug);
  chatEmit(key, 'history', {});
  return { ok: true };
};
const chatSetMode = (proj, slug, b) => {
  const ch = chats.get(proj.name + '/' + slug);
  if (!ch || ch.closing) return { ok: true };   // the next message starts the session with them
  applyModeModel(ch, b, true);
  chatEmitState(proj, slug);
  return { ok: true };
};
// what the panel shows around the history: who it talks to, what it waits for
const waitView = (id, r) => {
  const i = r.input || {};
  return {
    id, tool: r.display_name || r.tool_name, description: r.description || i.description || '',
    what: clip(i.command || i.file_path || i.url || i.pattern || i.skill || '', 2000),
    detail: r.tool_name === 'ExitPlanMode' ? clip(i.plan, 20000) : r.tool_name === 'Bash' || r.tool_name === 'Read' ? '' : toolInput(r.tool_name, i),
    plan: r.tool_name === 'ExitPlanMode',
    // AskUserQuestion: the page shows the questions with their options instead of Allow / Deny
    ask: r.tool_name === 'AskUserQuestion' && Array.isArray(i.questions) ? i.questions.slice(0, 8).map((q) => ({
      question: clip(q.question, 2000), header: clip(q.header, 60), multi: !!q.multiSelect,
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 12).map((o) => ({ label: clip(o.label, 200), description: clip(o.description, 1000) })),
    })) : null,
    always: (r.permission_suggestions || []).some((s) => s.type === 'addRules'),
    edits: (r.permission_suggestions || []).some((s) => s.type === 'setMode' && s.mode === 'acceptEdits'),
  };
};
const chatState = (proj, slug) => {
  const key = proj.name + '/' + slug, ch = chats.get(key), a = followVscodeCopy(proj, slug, loadChat(proj, slug));
  const latest = (planSessions(proj, slug).sessions.at(-1) || {}).id || null;
  return {
    live: !!ch, busy: !!(ch && ch.busy), mode: ch ? ch.mode : null, model: ch ? ch.model : null,
    session: ch && ch.session ? ch.session : a.current ? a.current.id : latest,
    current: a.current || null, latest, fork: !!a.fork,
    waits: ch ? [...ch.waits].map(([id, r]) => waitView(id, r)) : [],
    partial: ch ? ch.partial : '', landing: ch ? ch.landing : [], last: ch ? ch.last : null, error: chatNotes.get(key) || '',
    context: chatContext(proj, slug, ch, a),
    idleFrom: chatIdleFrom(proj, slug),
  };
};
// when the session last wrote to its transcript: the composer counts the idle time from it,
// because the prompt cache usually expires after an hour without a request
const chatIdleFrom = (proj, slug) => {
  const tr = chatTranscript(proj, slug);
  try { return tr ? statSync(tr.file).mtimeMs : null; } catch { return null; }
};
const chatEvents = (req, res, proj, slug) => {
  const key = proj.name + '/' + slug;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  if (!chatClients.has(key)) chatClients.set(key, new Set());
  chatClients.get(key).add(res);
  res.write('event: state\ndata: ' + JSON.stringify(chatState(proj, slug)) + '\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); chatClients.get(key)?.delete(res); });
};

// ---------- http ----------

// a run's log is stream-json mixed with plain launcher output; both become the chat's items.
// A subagent's steps are marked, and its prompt is left out: the Agent call already shows it.
const logLine = (t, line) => {
  if (!line.trim()) return;
  const raw = () => {
    const last = t.items.at(-1);
    if (last?.k === 'raw' && last.lines < 200) { last.text += '\n' + line; last.lines++; }
    else t.items.push({ k: 'raw', text: line, lines: 1 });
  };
  if (!line.startsWith('{')) return raw();
  let j;
  try { j = JSON.parse(line); } catch { return raw(); }
  if (j.type === 'system' && j.subtype === 'init') {
    t.cwd = j.cwd;
    t.items.push({ k: 'note', text: '⚙️ Session started, model ' + (j.model || '?') });
  } else if (j.type === 'assistant') {
    const n = t.items.length;
    assistantItems(t, j, t.cwd);
    if (j.parent_tool_use_id) t.items.slice(n).forEach((it, k) => {
      t.items[n + k] = it.k === 'agent' ? { k: 'note', text: 'Subagent message', body: clip(it.text, 6000), sub: true, at: it.at } : Object.assign(it, { sub: true });
    });
  } else if (j.type === 'user') {
    const c = j.message?.content;
    if (j.parent_tool_use_id) userItems(t, { message: { content: Array.isArray(c) ? c.filter((b) => b.type === 'tool_result') : [] }, timestamp: j.timestamp }, t.cwd);
    else userItems(t, { ...j, isMeta: j.isMeta || j.isSynthetic }, t.cwd);
  } else if (j.type === 'result') {
    t.items.push({ k: 'note', text: '🏁 ' + (j.subtype || 'done'), body: j.result ? clip(j.result, 4000) : '', err: !!j.is_error });
  }
};
const logHistory = (proj, slug, q) => {
  const file = path.join(proj.hasPipeline ? proj.autoRunsDir : proj.logsDir, slug + '.log');
  const t = readTranscript(file, null, logLine);
  const all = [...t.items];
  // plain output without its line end yet (a launcher's last words) still shows
  if (t.rest?.trim() && !t.rest.startsWith('{')) {
    const last = all.at(-1);
    if (last?.k === 'raw') all[all.length - 1] = { ...last, text: last.text + '\n' + t.rest };
    else all.push({ k: 'raw', text: t.rest });
  }
  return itemsPage(all, q);
};

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const text = (res, t) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(t);
};
const body = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
const safeName = (s) => /^[A-Za-z0-9._-]+$/.test(s || '');

const server = http.createServer(async (req, res) => {
  if (BIND !== '127.0.0.1' && !LOOPBACK.has(req.socket.remoteAddress)) {
    res.writeHead(403); return res.end('local access only');
  }
  const refused = crossSiteReason(req);
  if (refused) { res.writeHead(403); return res.end('refused: ' + refused); }
  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug');
  const pname = url.searchParams.get('project');
  const getProj = () => (safeName(pname) ? projByName(pname) : null);
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (url.pathname === '/api/state') {
      enqueueMissingSummaries();
      return json(res, 200, await fullState());
    }
    if (url.pathname === '/api/lanes') {
      const proj = getProj();
      if (!proj || !proj.hasLanes) return json(res, 400, { error: 'no lane analyzer for this project' });
      const r = await runLanes(proj);
      return json(res, r.error ? 500 : 200, r);
    }
    // one batch across every project; refused until each project has its own lane checker
    if (url.pathname === '/api/lanes-all') {
      const all = allProjects(), missing = all.filter((p) => !p.hasLanes);
      if (missing.length)
        return json(res, 409, {
          error: missing.length + ' of ' + all.length + ' projects have no lane checker',
          missing: missing.map((p) => ({ name: p.name, root: tilde(p.root) })),
          prompt: lanesFixPrompt(missing, all.find((p) => p.hasLanes)),
        });
      const runs = await Promise.all(all.map(runLanes));
      return json(res, 200, { projects: all.map((p, i) => ({ name: p.name, ...runs[i] })) });
    }
    if (url.pathname === '/api/registry' && req.method === 'GET')
      return json(res, 200, loadRegistry().map((e) => ({
        ...e, _hasPipeline: resolveProject(e).hasPipeline,
      })));
    if (url.pathname === '/api/onboarding')
      return json(res, 200, {
        system: await systemCheck(),
        dashRepo: tilde(DASH_REPO),
        registryFile: tilde(REG_FILE),
        projects: loadRegistry().map((e) => ({
          ...projectHealth(expand(e.root), e), name: e.name, client: e.client || 'Default',
        })),
      });
    if (url.pathname === '/api/scan') {
      const dir = (url.searchParams.get('dir') || '').trim();
      if (dir && !existsSync(expand(dir))) return json(res, 400, { error: 'Folder not found: ' + dir });
      return json(res, 200, scanProjects(dir ? [path.resolve(expand(dir))] : defaultScanRoots()));
    }
    if (url.pathname === '/api/discover') {
      const proj = getProj();
      if (!proj) return json(res, 400, { error: 'bad project' });
      return json(res, 200, discover(proj));
    }
    if (url.pathname === '/api/plan') {
      const proj = getProj();
      if (!proj || !safeName(slug)) return json(res, 400, { error: 'bad request' });
      const f = path.join(proj.plansDir, slug + '.md');
      const fd = path.join(proj.doneDir, slug + '.md');
      return text(res, existsSync(f) ? readFileSync(f, 'utf8')
        : existsSync(fd) ? readFileSync(fd, 'utf8') : '(plan not found)');
    }
    if (url.pathname === '/api/log') {
      const proj = getProj();
      if (!proj || !safeName(slug)) return json(res, 400, { error: 'bad request' });
      return json(res, 200, logHistory(proj, slug,
        Object.fromEntries(['from', 'before', 'limit'].map((k) => [k, url.searchParams.get(k)]))));
    }
    if (url.pathname === '/api/report') {
      const proj = getProj();
      if (!proj || !safeName(slug)) return json(res, 400, { error: 'bad request' });
      const f = path.join(proj.autoRunsDir, slug + '.md');
      return text(res, existsSync(f) ? readFileSync(f, 'utf8') : '(no report yet)');
    }
    if (url.pathname.startsWith('/api/chat') && req.method === 'GET') {
      const proj = getProj();
      if (!proj || !safeName(slug)) return json(res, 400, { error: 'bad request' });
      if (url.pathname === '/api/chat') return json(res, 200, chatState(proj, slug));
      if (url.pathname === '/api/chat/history') return json(res, 200, chatHistory(proj, slug,
        Object.fromEntries(['from', 'before', 'limit'].map((k) => [k, url.searchParams.get(k)]))));
      if (url.pathname === '/api/chat/meta') return json(res, 200, await chatMeta(proj, slug));
      if (url.pathname === '/api/chat/image') {
        const im = chatImage(proj, slug, url.searchParams.get('uuid') || '', url.searchParams.get('n') || '');
        if (!im) return json(res, 404, { error: 'image not found' });
        res.writeHead(200, { 'Content-Type': im.type, 'Cache-Control': 'private, max-age=604800' });
        return res.end(im.data);
      }
      if (url.pathname === '/api/chat/events') return chatEvents(req, res, proj, slug);
    }
    if (url.pathname === '/api/pr' || url.pathname === '/api/pr-diff') {
      const proj = getProj();
      const n = url.searchParams.get('number') || '';
      if (!proj || !/^\d{1,7}$/.test(n)) return json(res, 400, { error: 'bad request' });
      if (url.pathname === '/api/pr') return json(res, 200, await prDetail(proj, n));
      const r = await gh(proj, ['api', '-H', 'Accept: application/vnd.github.diff', 'repos/{owner}/{repo}/pulls/' + n]);
      if (r.ok || !/HTTP 406|maximum number of files|too_large/i.test(r.output)) return json(res, 200, r.ok ? { ok: true, diff: r.out } : r);
      return json(res, 200, await prDiffFromFiles(proj, n));
    }
    if (url.pathname === '/api/local' || url.pathname === '/api/local-file') {
      const proj = getProj(), file = url.searchParams.get('path') || '';
      if (!proj || !safeName(slug)) return json(res, 400, { error: 'bad request' });
      if (url.pathname === '/api/local') return json(res, 200, await localFor(proj, slug, url.searchParams.get('since') || ''));
      if (!file || file.split('/').some((s) => !s || s === '..' || s === '.')) return json(res, 400, { error: 'bad request' });
      return json(res, 200, localFile(proj, slug, file));
    }
    if (url.pathname === '/api/pr-file') {
      // one file at the PR's head commit: the whole-file view fills the lines between hunks from it
      const proj = getProj();
      const sha = url.searchParams.get('sha') || '', file = url.searchParams.get('path') || '';
      if (!proj || !/^[0-9a-f]{40}$/.test(sha) || !file || file.split('/').some((s) => !s || s === '..' || s === '.'))
        return json(res, 400, { error: 'bad request' });
      const r = await gh(proj, ['api', '-H', 'Accept: application/vnd.github.raw',
        'repos/{owner}/{repo}/contents/' + file.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha]);
      return json(res, 200, r.ok ? { ok: true, text: r.out } : r);
    }
    if (req.method === 'POST') {
      const b = await body(req);
      const proj = safeName(b.project) ? projByName(b.project) : null;
      if (url.pathname === '/api/launch') {
        if (!proj || !proj.hasPipeline) return json(res, 400, { error: 'not a pipeline project' });
        if (!Array.isArray(b.items) || !b.items.length || !b.items.every((i) => safeName(i.slug)))
          return json(res, 400, { error: 'no valid plans' });
        launchPipeline(proj, b.items);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/registry') {
        if (!Array.isArray(b.projects)) return json(res, 400, { error: 'bad registry' });
        const seen = new Set(); const cleaned = []; const warnings = [];
        for (const e of b.projects) {
          const { entry, warning } = cleanEntry(e);
          if (!entry) { warnings.push(warning); continue; }
          if (seen.has(entry.name)) { warnings.push('Duplicate name skipped: ' + entry.name); continue; }
          seen.add(entry.name);
          if (warning) warnings.push(warning);
          cleaned.push(entry);
        }
        saveRegistry(cleaned);
        return json(res, 200, { ok: true,
          output: warnings.length ? warnings.join('\n') : 'Settings saved — ' + cleaned.length + ' project(s).' });
      }
      if (url.pathname === '/api/add-project') return json(res, 200, addProject(b));
      // 🖥 Code in the page header: this dashboard's own repo
      if (url.pathname === '/api/vscode-dash') return json(res, 200, { ok: true, target: openFolderInVsCode(DASH_REPO) });
      if (url.pathname === '/api/launchers') {
        if (!proj) return json(res, 400, { error: 'bad project' });
        return json(res, 200, saveLaunchers(proj.name, Array.isArray(b.launchers) ? b.launchers : []));
      }
      // 📥 Pull on a project header: the same fast-forward pull, on the branch the main checkout is on
      if (url.pathname === '/api/pull') {
        if (!proj) return json(res, 400, { error: 'bad project' });
        const br = await gitIn(proj.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const note = await pullRoot(proj, br.out);
        return json(res, 200, { ok: !note.startsWith('Not pulled'), output: note });
      }
      // 🖥 VS Code on a project header: the main checkout, not a plan's worktree
      if (url.pathname === '/api/vscode-project') {
        if (!proj) return json(res, 400, { error: 'bad project' });
        return json(res, 200, { ok: true, target: openInVsCode(proj) });
      }
      if (!proj || !safeName(b.slug)) return json(res, 400, { error: 'bad request' });
      if (url.pathname === '/api/launch-generic')
        return json(res, 200, launchGeneric(proj, b.slug, +b.launcher || 0));
      if (url.pathname === '/api/clear-run')
        return json(res, 200, clearGenericRun(proj, b.slug));
      if (url.pathname === '/api/meta') {
        const m = loadMeta(proj);
        m[b.slug] = {
          status: typeof b.status === 'string' && b.status ? b.status.slice(0, 40) : null,
          tags: Array.isArray(b.tags) ? b.tags.map((t) => String(t).slice(0, 30)).slice(0, 12) : [],
        };
        saveMeta(proj, m);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/resume') {
        if (!proj.hasPipeline) return json(res, 400, { error: 'not a pipeline project' });
        runLauncher(proj, ['--resume', b.slug, resumeFlag(proj, b.slug, b.mode)], [b.slug]);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/cleanup') {
        if (!proj.hasPipeline) return json(res, 400, { error: 'not a pipeline project' });
        return json(res, 200, await cleanup(proj, b.slug, !!b.artifacts));
      }
      if (url.pathname === '/api/archive') return json(res, 200, await archivePlan(proj, b.slug));
      if (url.pathname === '/api/unarchive') return json(res, 200, unarchivePlan(proj, b.slug));
      if (url.pathname === '/api/vscode') return json(res, 200, { ok: true, target: openInVsCode(proj, b.slug) });
      if (url.pathname === '/api/chat/send') return json(res, 200, await chatMessage(proj, b.slug, b));
      if (url.pathname === '/api/chat/answer') return json(res, 200, chatAnswer(proj, b.slug, b));
      if (url.pathname === '/api/chat/stop') return json(res, 200, chatStop(proj, b.slug));
      if (url.pathname === '/api/chat/mode') return json(res, 200, chatSetMode(proj, b.slug, b));
      if (url.pathname === '/api/chat/fork') return json(res, 200, chatRestart(proj, b.slug, true));
      if (url.pathname === '/api/chat/new') return json(res, 200, chatRestart(proj, b.slug, false));
      // ⟳ in the PR bar: read the PR list now, not at the next minute (a push changes the head)
      if (url.pathname === '/api/pr-refresh') { await refreshPrList(proj); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/local-push' || url.pathname === '/api/local-discard') {
        if (!/^[0-9a-f]{40}$/.test(String(b.head)) || !/^[0-9a-f]{40}$/.test(String(b.sig))) return json(res, 400, { error: 'bad request' });
        return json(res, 200, await (url.pathname === '/api/local-push' ? localPush : localDiscard)(proj, b.slug, b));
      }
      if (url.pathname === '/api/pr-action') {
        const r = await prAction(proj, b);
        return json(res, 200, r.ok ? { ok: true, notes: r.notes } : r);
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

// ---------- page ----------

// The browser page lives in plans-dashboard/: page.html is the shell, app.css and app.js are inlined into it at
// startup, so the page stays one request. The server fills in the two values the page needs from it.
const UI_DIR = fileURLToPath(new URL('./plans-dashboard/', import.meta.url));
const uiFile = (f) => readFileSync(path.join(UI_DIR, f), 'utf8');
const fill = (s, mark, value) => s.split(mark).join(value); // split/join: no $-patterns as in String.replace
const PAGE = fill(fill(fill(fill(uiFile('page.html'),
  '<!--@CSS-->', uiFile('app.css')),
  '<!--@JS-->', uiFile('app.js')),
  '{{QA_PORT}}', String(QA_PORT)),
  '/*@CHAT_MODES*/[]', JSON.stringify(CHAT_MODES));

// Report pages of the browser-usability-test skill, read-only, so a chat link can open
// them: http://localhost:4898/<project>/<file>.html, and the list of all of them at /. A separate port is a separate
// origin: a report runs its own scripts, and the dashboard's crossSiteReason refuses
// its calls, while localStorage and the clipboard (localhost is secure) still work.
const htmlText = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// 📊 as the tab icon of the list and the reports (reports written before they had one ask /favicon.ico)
const QA_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="50" font-size="52" text-anchor="middle">📊</text></svg>`;
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// every report page, grouped by project, the project with the newest report first
// every project's report pages and artifacts (single-file pages, see scripts/artifact-copies.mjs),
// the project with the newest page first. What the list shows comes from <title> and the
// qa:* meta tags in the first KB: a page can be MBs of embedded screenshots.
const qaPages = (project, folder) => {
  const dir = path.join(QA_REPORTS, project, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.html') && safeName(f) && !f.startsWith('.')).map((f) => {
    const file = path.join(dir, f), st = statSync(file), meta = readMeta(file);
    const remote = !!meta['remote-only'];
    return { file: f, path: file, title: meta.title ? htmlText(meta.title) : f, size: remote ? 0 : st.size,
      mtime: meta.updated ? Date.parse(meta.updated) : st.mtimeMs, day: !!meta.updated,
      href: remote ? null : `/${encodeURIComponent(project)}/${folder === 'reports' ? '' : 'artifacts/'}${encodeURIComponent(f)}`,
      // a downloaded Claude artifact: its claude.ai link; Docs, Slides and Design open only there
      url: meta.source, live: !!meta.live, guessed: meta['project-from'] === 'content',
      versions: olderVersions(file).length + 1,
      issues: (meta.issues || '').split(/\s+/).filter(Boolean) };
  }).sort((a, b) => b.mtime - a.mtime);
};
const qaReports = () => (existsSync(QA_REPORTS) ? readdirSync(QA_REPORTS) : [])
  .filter((p) => safeName(p) && !p.startsWith('.'))
  .map((project) => ({ project, rows: qaPages(project, 'reports'), arts: qaPages(project, 'artifacts') }))
  .filter((g) => g.rows.length || g.arts.length)
  .sort((a, b) => (a.project === OTHER) - (b.project === OTHER)
    || Math.max(...[...b.rows, ...b.arts].map((r) => r.mtime)) - Math.max(...[...a.rows, ...a.arts].map((r) => r.mtime)));
// HTML pages Claude wrote to a session scratchpad and never published. macOS empties
// /private/tmp now and then, so these can disappear.
const DRAFT_SKIP = new Set(['node_modules', 'artifact-files', '.git']);
const draftFile = (rel) => {
  try {
    // checked after .. and symlinks are resolved: only <project>/<session>/scratchpad/…/*.html
    const root = realpathSync(CLAUDE_TMP), f = realpathSync(path.resolve(root, decodeURIComponent(rel)));
    return /^[^/]+\/[^/]+\/scratchpad\/.+\.html$/.test(path.relative(root, f)) ? f : null;
  } catch { return null; }
};
const draftRows = () => {
  if (!CLAUDE_TMP || !existsSync(CLAUDE_TMP)) return [];
  const walk = (dir, depth) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.') || DRAFT_SKIP.has(d.name)) return [];
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return depth < 4 ? walk(p, depth + 1) : [];
    return d.name.endsWith('.html') ? [p] : [];
  });
  const rows = [];
  for (const proj of readdirSync(CLAUDE_TMP, { withFileTypes: true })) for (const sess of proj.isDirectory() ? readdirSync(path.join(CLAUDE_TMP, proj.name)) : []) {
    const sp = path.join(CLAUDE_TMP, proj.name, sess, 'scratchpad');
    if (!existsSync(sp)) continue;
    for (const f of walk(sp, 0)) {
      const st = statSync(f), rel = path.relative(CLAUDE_TMP, f);
      const text = st.size < 4194304 ? readFileSync(f, 'utf8') : '';
      const title = text.match(/<title>([^<]*)<\/title>/i)?.[1];
      rows.push({ title: title ? htmlText(title) : path.basename(f), file: `${proj.name.replace(/^-Users-[^-]+-(Workspace-)?/, '')} · ${path.relative(sp, f)}`,
        path: f, size: st.size, mtime: st.mtimeMs, href: `/drafts/${rel.split(path.sep).map(encodeURIComponent).join('/')}`,
        download: path.basename(f), issues: findIssues(text) });
    }
  }
  return rows.sort((a, b) => b.mtime - a.mtime);
};
const qaListPage = () => {
  const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  // "https://github.com/o/r/issues/435" → "r#435"
  const issueLabel = (i) => { const m = i.match(/github\.com\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/); return m ? `${m[1]}#${m[2]}` : i; };
  const issueChip = (i) => (/^https?:/.test(i) ? `<a class="tk" href="${escH(i)}" target="_blank" rel="noopener">${escH(issueLabel(i))}</a>` : `<span class="tk">${escH(i)}</span>`);
  const row = (r) => {
    const search = [r.title, r.file, r.project, ...r.issues.map(issueLabel)].join(' ').toLowerCase();
    const open = r.href ? `<a href="${r.href}" target="_blank" rel="noopener">${escH(r.title)}</a>`
      : `<a href="${escH(r.url)}" target="_blank" rel="noopener">${escH(r.title)} ↗</a>`;
    const sub = [...r.issues.map(issueChip), r.file && `<span>${escH(r.file)}</span>`,
      r.versions > 1 && `<span class="tk">${r.versions} versions</span>`,
      r.url && r.href && `<a class="tk" href="${escH(r.url)}" target="_blank" rel="noopener">claude.ai ↗</a>`,
      r.live && '<span class="warn">saved data and comments work only on claude.ai</span>',
      !r.href && '<span>Docs, Slides or Design: opens on claude.ai only</span>',
      r.guessed && '<span>project guessed from the page text</span>'].filter(Boolean).join(' ');
    const dl = r.download || r.file;
    return `<tr data-search="${escH(search)}"><td>${open}<div class="file">${sub}</div></td><td>${r.day ? day(r.mtime) : when(r.mtime)}</td><td>${r.size ? size(r.size) : ''}</td>
<td><div class="act">${r.href ? `<a class="btn" href="${r.href}?download" download="${escH(dl)}" aria-label="Download ${escH(dl)}">Download</a><button class="btn" type="button" data-path="${escH(r.path)}" aria-label="Copy the path of ${escH(dl)}">Copy path</button><button class="btn" type="button" data-reveal="${r.href}" aria-label="Show ${escH(dl)} in Finder">Show in Finder</button>` : `<button class="btn" type="button" data-path="${escH(r.url)}" aria-label="Copy the link of ${escH(r.title)}">Copy link</button>`}</div></td></tr>`;
  };
  const section = (name, rows, note = '') => `<section><h2>${escH(name)} <span>${rows.length}</span></h2>${note}
<table><thead><tr><th>Page</th><th>Updated</th><th>Size</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
${rows.map(row).join('\n')}
</tbody></table></section>`;
  const groups = qaReports(), drafts = draftRows();
  const artNote = `<p class="dim">Pages as single files, images included, in ${escH(QA_REPORTS)}/&lt;project&gt;/artifacts/. Claude artifacts downloaded from claude.ai link back there.</p>`;
  // one fold per project; which ones are closed is remembered in this browser (script below)
  const fold = (key, name, n, inner) => `<details class="proj" data-key="${escH(key)}" open><summary>${escH(name)} <span>${n} page${n === 1 ? '' : 's'}</span></summary>${inner}</details>`;
  const reports = groups.map(({ project, rows, arts }) => fold(project, project === OTHER ? 'Other' : project, rows.length + arts.length, [
    rows.length && section('Reports', rows),
    arts.length && section('Artifacts', arts.map((r) => ({ ...r, project })), artNote),
  ].filter(Boolean).join('\n'))).join('\n')
    || `<p class="dim">No reports yet. The browser-usability-test skill writes them to ${escH(QA_REPORTS)}/&lt;project&gt;/reports/.</p>`;
  const body = `${reports}
${drafts.length ? fold('drafts', 'Unpublished drafts', drafts.length, section('Drafts', drafts, `<p class="dim">HTML that Claude wrote to a session scratchpad in ${escH(CLAUDE_TMP)}. macOS empties that folder now and then. Download gives one file with the images inside; Copy path gives the raw file.</p>`)) : ''}
<p class="dim" id="none" hidden>Nothing matches.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA reports</title><link rel="icon" href="data:image/svg+xml,${encodeURIComponent(QA_ICON)}"><style>
:root { --bg:#f4f5f8; --panel:#fff; --line:#d9dde6; --fg:#1d2433; --dim:#5f6b81; --link:#1d4ed8; color-scheme:light; }
@media (prefers-color-scheme: dark) { :root { --bg:#292e39; --panel:#2e3440; --line:#434c5e; --fg:#eceff4; --dim:#a3abbd; --link:#88c0d0; color-scheme:dark; } }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
main { max-width:1100px; margin:0 auto; padding:28px 16px 64px; }
h1 { font-size:20px; margin:0 0 4px; } .dim, h2 span, .file, th { color:var(--dim); }
h2 { font-size:16px; margin:28px 0 8px; } h2 span { font-weight:400; font-size:13px; }
table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
th, td { text-align:left; vertical-align:top; padding:9px 12px; border-bottom:1px solid var(--line); }
th { font-size:12px; font-weight:500; } tr:last-child td { border-bottom:0; }
td:nth-child(n+2) { white-space:nowrap; } a { color:var(--link); text-decoration:none; font-weight:500; } a:hover { text-decoration:underline; }
.file { font:12px ui-monospace, Menlo, monospace; overflow-wrap:anywhere; }
.act { display:flex; gap:6px; justify-content:flex-end; }
.btn { font:inherit; font-size:12.5px; font-weight:400; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:4px 10px; cursor:pointer; white-space:nowrap; }
.btn:hover { border-color:var(--link); text-decoration:none; } .btn:focus-visible, a:focus-visible { outline:2px solid var(--link); outline-offset:2px; }
.tk { font:12px ui-monospace, Menlo, monospace; margin-right:8px; } .warn { color:#d08770; }
.search { width:100%; box-sizing:border-box; font:inherit; padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); margin:14px 0 0; }
.proj { margin-top:22px; } .proj > summary { font-size:17px; font-weight:600; cursor:pointer; padding:4px 0; }
.proj > summary span { color:var(--dim); font-weight:400; font-size:13px; } .proj > summary:focus-visible { outline:2px solid var(--link); outline-offset:2px; }
.proj h2 { margin-top:12px; } .folds { display:flex; gap:6px; margin-top:10px; }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
@media (max-width:600px) { th:nth-child(3), td:nth-child(3) { display:none; } .act { flex-direction:column; } th, td { padding:9px 8px; } td:nth-child(2) { white-space:normal; } }
</style></head><body><main><h1>QA reports</h1>
<p class="dim">Report pages of the browser-usability-test skill, newest first. Saved in ${escH(QA_REPORTS)}.</p>
<input class="search" type="search" placeholder="Search by ticket number or title, e.g. 435" aria-label="Search by ticket number or title" autofocus>
<div class="folds"><button class="btn" type="button" id="fold-all">Collapse all</button><button class="btn" type="button" id="open-all">Expand all</button></div>
${body}
<p class="dim">Download saves the file to your Downloads folder, ready to drag into a chat or an issue. Copy path copies where it is saved, for a file picker (⌘⇧G) or Finder (Go → Go to Folder). Show in Finder opens its folder with the file selected.</p></main>
<script>
const q = document.querySelector('.search');
const folds = document.querySelectorAll('details.proj');
let closed = new Set();
try { closed = new Set(JSON.parse(localStorage.getItem('qa-closed') || '[]')); } catch {}
const saveFolds = () => { try { localStorage.setItem('qa-closed', JSON.stringify([...closed])); } catch {} };
folds.forEach((d) => {
  if (closed.has(d.dataset.key)) d.open = false;
  d.addEventListener('toggle', () => { if (q.value.trim()) return; d.open ? closed.delete(d.dataset.key) : closed.add(d.dataset.key); saveFolds(); });
});
const setAll = (open) => { folds.forEach((d) => { d.open = open; open ? closed.delete(d.dataset.key) : closed.add(d.dataset.key); }); saveFolds(); };
document.getElementById('fold-all').addEventListener('click', () => setAll(false));
document.getElementById('open-all').addEventListener('click', () => setAll(true));
q.addEventListener('input', () => {
  const words = q.value.toLowerCase().replace(/#/g, ' ').split(/\\s+/).filter(Boolean);
  let any = false;
  document.querySelectorAll('section').forEach((s) => {
    let n = 0;
    s.querySelectorAll('tbody tr').forEach((tr) => { const hit = words.every((w) => tr.dataset.search.includes(w)); tr.hidden = !hit; n += hit; });
    s.hidden = !n; any ||= n > 0;
  });
  // while searching, show every project with a hit opened; after, back to the saved folds
  folds.forEach((d) => {
    d.hidden = !!words.length && !d.querySelector('section:not([hidden])');
    d.open = words.length ? true : !closed.has(d.dataset.key);
  });
  document.getElementById('none').hidden = any || !words.length;
});
document.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', async () => {
  const label = b.textContent;
  try { await navigator.clipboard.writeText(b.dataset.path); b.textContent = 'Copied'; }
  catch { window.prompt('Copy the path:', b.dataset.path); }
  setTimeout(() => { b.textContent = label; }, 1500);
}));
document.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', async () => {
  const label = b.textContent;
  const r = await fetch('/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ href: b.dataset.reveal }) }).catch(() => null);
  b.textContent = r && r.ok ? 'Opened' : 'Not found';
  setTimeout(() => { b.textContent = label; }, 1500);
}));
</script></body></html>`;
};
// a bar at the top right of every page served here: Download, and a version menu on a page
// with older versions (scripts/page-versions.mjs). ?download gives the file as saved, without the bar
const QA_BAR_ITEM = 'all:initial;display:block;box-sizing:border-box;font:500 12.5px system-ui,-apple-system,sans-serif;color:#eceff4;background:rgb(46,52,64);border:1px solid #4c566a;border-radius:6px;padding:5px 11px;cursor:pointer;white-space:nowrap';
const QA_BAR_STYLE = `<style>#qa-bar{all:initial;position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:calc(100vw - 20px)}
#qa-dl,#qa-old,#qa-ver>summary,#qa-ver a{${QA_BAR_ITEM}}#qa-dl,#qa-ver>summary{opacity:.75}
#qa-old{background:#b35c00;color:#fff;border-color:#b35c00;text-decoration:underline}
#qa-ver{all:initial;display:block;position:relative;z-index:1}#qa-ver>div{all:initial;display:block;position:absolute;top:calc(100% + 4px);right:0;max-height:60vh;overflow:auto}
#qa-ver a{border-radius:0;margin-top:-1px}#qa-ver a[aria-current]{background:#434c5e;font-weight:700}
#qa-dl:hover,#qa-dl:focus-visible,#qa-ver>summary:hover,#qa-ver>summary:focus-visible,#qa-ver[open]>summary{opacity:1}
#qa-dl:hover,#qa-dl:focus-visible,#qa-old:focus-visible,#qa-ver>summary:focus-visible,#qa-ver a:hover,#qa-ver a:focus-visible{outline:2px solid #88c0d0;outline-offset:-2px}@media print{#qa-bar{display:none}}</style>`;
// versions: [{ n, mtime, latest, href, current }], newest first; one entry means no menu
const qaBar = (versions) => {
  const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const current = versions.find((v) => v.current), latest = versions[0];
  const old = current && !current.latest;
  const menu = versions.length > 1 ? `<details id="qa-ver"><summary aria-label="Versions of this page">v${current.n}${current.latest ? ' (latest)' : ''} ▾</summary><div>
${versions.map((v) => `<a href="${escH(v.href)}"${v.current ? ' aria-current="page"' : ''}>v${v.n}${v.latest ? ' (latest)' : ''} · ${escH(when(v.mtime))}</a>`).join('\n')}</div></details>` : '';
  return `${QA_BAR_STYLE}<div id="qa-bar">${old ? `<a id="qa-old" href="${escH(latest.href)}">Old version from ${escH(when(current.mtime))}. Go to latest</a>` : ''}${menu}
<a id="qa-dl" href="?${old ? `v=${current.n}&amp;` : ''}download" download title="Download this page as one HTML file">⬇ Download</a></div>`;
};
const sendPage = (req, res, html, name, versions = []) => {
  const dl = new URL(req.url, 'http://x').searchParams.has('download');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    ...(dl && { 'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"` }) });
  if (dl) return res.end(html);
  const s = String(html), at = s.lastIndexOf('</body>'), bar = qaBar(versions);
  res.end(at < 0 ? s + bar : s.slice(0, at) + bar + s.slice(at));
};
// a saved page, or with ?v=<n> one of its older versions, downloaded as <name>-v<n>.html
const sendSaved = (req, res, file, name) => {
  const { pathname, searchParams } = new URL(req.url, 'http://x');
  const older = olderVersions(file), v = searchParams.get('v');
  const old = v && older.find((o) => String(o.n) === v);
  if (v && !old) { res.writeHead(404); return res.end('version not found'); }
  const versions = [...older.map((o) => ({ n: o.n, mtime: o.mtime, href: `${pathname}?v=${o.n}`, current: o === old })),
    { n: (older.at(-1)?.n || 0) + 1, mtime: statSync(file).mtimeMs, href: pathname, current: !old, latest: true }].reverse();
  sendPage(req, res, readFileSync(old ? old.path : file), old ? name.replace(/\.html$/, `-v${old.n}.html`) : name, versions);
};
// the file behind a page link of the list: an artifact, a scratchpad draft or a report
const qaPageFile = (pathname) => {
  const art = pathname.match(/^\/([A-Za-z0-9_-][A-Za-z0-9._-]*)\/artifacts\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.html)$/);
  if (art) return { kind: 'artifact', file: path.join(QA_REPORTS, art[1], 'artifacts', art[2]), name: art[2] };
  const draft = pathname.startsWith('/drafts/') && draftFile(pathname.slice(8));
  if (draft) return { kind: 'draft', file: draft };
  const m = pathname.match(/^\/([A-Za-z0-9_-][A-Za-z0-9._-]*)\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.html)$/);
  return m ? { kind: 'report', file: path.join(QA_REPORTS, m[1], 'reports', m[2]), name: m[2] } : null;
};
const reportServer = http.createServer((req, res) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  // a rebound public name must not read the reports (they hold test data)
  if (!['localhost', '127.0.0.1'].includes(host)) { res.writeHead(403); return res.end('local access only'); }
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname === '/favicon.ico' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
    return res.end(QA_ICON);
  }
  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(qaListPage());
  }
  // Show in Finder: only for a page this server lists, and only from its own list page
  if (pathname === '/reveal' && req.method === 'POST') {
    const why = crossSiteReason(req);
    if (why) { res.writeHead(403); return res.end(why); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    return req.on('end', () => {
      let href = '';
      try { href = new URL(JSON.parse(body).href, 'http://x').pathname; } catch {}
      const pg = qaPageFile(href);
      if (!pg || !existsSync(pg.file)) { res.writeHead(404); return res.end('page not found'); }
      execFile('open', ['-R', pg.file], (err) => { res.writeHead(err ? 500 : 204); res.end(); });
    });
  }
  const pg = req.method === 'GET' && qaPageFile(pathname);
  if (!pg || !existsSync(pg.file)) { res.writeHead(404); return res.end('page not found'); }
  if (pg.kind === 'draft')
    // a draft's images sit next to it: packed in, so a download is one file
    return sendPage(req, res, inlineHtml(readFileSync(pg.file, 'utf8'), path.dirname(pg.file), { page: pg.file }), path.basename(pg.file));
  sendSaved(req, res, pg.file, pg.name);
});
reportServer.on('error', (e) => console.error(`QA reports server on port ${QA_PORT}: ${e.code || e}`));
reportServer.listen(QA_PORT, '127.0.0.1');

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE')
    console.error(`Port ${PORT} is already taken — another dashboard instance or a web `
      + `server has it.\nStop that process, or pick another port: DASH_PORT=4899 node ${process.argv[1]}`);
  else if (e.code === 'EACCES')
    console.error(`Not allowed to bind port ${PORT}. Pick a port above 1023: DASH_PORT=4899 node ${process.argv[1]}`);
  else console.error(String(e));
  process.exit(1);
});

server.listen(PORT, BIND, () => {
  chatReattach();
  // prefer the /etc/hosts vanity domain when the user has added it
  let host = 'plans.localhost';
  try {
    if (/^\s*127\.0\.0\.1\s+.*\bplans\.test\b/m.test(readFileSync('/etc/hosts', 'utf8')))
      host = 'plans.test';
  } catch {}
  const sfx = PORT === 80 ? '' : `:${PORT}`;
  const url = `http://${host}${sfx}`;
  const n = allProjects().length;
  console.log(`Plans dashboard → ${url}  (also http://127.0.0.1${sfx})`);
  console.log(`${n} project${n === 1 ? '' : 's'} from ${REG_FILE}`);
  if (!n) console.log(`No projects registered yet — create ${REG_FILE} (see header of this file).`);
  if (NO_SUMMARY) console.log('DASH_NO_SUMMARY=1 — plan summaries are off.');
  enqueueMissingSummaries();
  if (process.platform === 'darwin' && !process.env.DASH_NO_OPEN)
    spawn('open', [url], { stdio: 'ignore' }).unref();
});
