#!/usr/bin/env node
// Multi-project plans & pipeline dashboard (global, zero deps).
//
//   node ~/Workspace/claude-config/apps/dashboard/server.mjs   →  http://127.0.0.1:4899
//
// Projects are registered in ~/.claude/pipeline-projects.json:
//   { "projects": [ { "name": "...", "client": "...", "root": "<repo>",
//                     "plansDir": "<any folder with *.md plans>",
//                     "launchers": [ { "label": "...", "cmd": "... {plan} ..." } ] } ] }
// See scripts/pipeline-projects.example.json, `--help` for the options,
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
// State: statuses and tags live centrally in ~/.claude/pipeline-dashboard/state/<project>/
// for every project, never in the repo. Logs are always central for generic runs. Localhost only.
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import {
  readFileSync, readdirSync, existsSync, openSync, mkdirSync, unlinkSync,
  writeFileSync, renameSync, statSync, closeSync, readSync, realpathSync, appendFileSync, linkSync,
} from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { OTHER, inlineHtml, findIssues, readMeta } from '../../scripts/artifact-copies.mjs';
import { olderVersions } from '../../scripts/page-versions.mjs';
import { plistScript } from './restart.mjs';
import { parseWaitsFor, prMap, prEvents, outcomeEvents, runningCount, canAutoLaunch, capLines, redact } from './watch.mjs';
import { NOTIFIERS, notifyFirst } from '../scout/scout.mjs';
import { QA_ICON, QA_ICON_URI } from '../../skills/browser-usability-test/scripts/qa-icon.mjs';

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
const DASH_REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`plans-dashboard ${VERSION} — local web dashboard for plan files across projects

  node server.mjs                     start the server (default http://127.0.0.1:4899)

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
  DASH_WATCH_MS=<n>   how often the event watcher runs, in ms (default 60000;
                      0 turns it off — set it for a test dashboard with the real HOME)
  DASH_STATE_CACHE_MS=<n>
                      how long, from the start of a build, all clients share that
                      /api/state build and its answer, in ms (default 1000; 0 turns
                      the sharing off). Each request that is not a GET clears it
  DASH_NO_NOTIFY=1    the watcher sends no macOS notifications
  DASH_NOTIFIER=<f>   the notifier program the watcher calls (default
                      Shipyard, then terminal-notifier, else osascript)
  QA_REPORTS_PORT=<n> port for the browser-usability-test report pages
                      (default 4898, http://localhost:<n>/<project>/<file>.html)
  QA_HOME=<dir>       where those reports live (default
                      ~/.claude/browser-usability-test/projects)

Files
  ${REG_FILE}
      the project registry — see scripts/pipeline-projects.example.json
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
// loopback (e.g. shipyard.test) — a web page cannot add one. /etc/hosts is re-read on a
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
  // behind Caddy the Origin is https://shipyard.test and Host is shipyard.test — compare host[:port]
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
    metaFile: path.join(stateDir, 'plan-meta.json'),
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
  '- recommendedBatch: [{ slug, file, areas: [string], validation: { claude, codex, rounds } }], the plans to start now, at most one per lane',
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
// The base branch a plan names ("- **Base**: main"). A value that starts with "-" does not
// match, so it can never reach `git fetch` as an option.
const planBase = (content) => {
  const m = content.match(/^\s*[-*]\s*\*\*Base\*\*:\s*`?([\w./][\w./-]*)`?\s*$/m);
  return m ? m[1] : null;
};
// root -> { slug: branch named in the plan }. listPlans() fills its own map and puts it here only at its end,
// so two builds that overlap never read a map that the other build has only started.
const planBranches = {};
// the branch a plan names, when it is not the pipeline's own auto/<slug>
const ownBranch = (proj, slug, map = planBranches[proj.root] || {}) => {
  const b = map[slug];
  return b && b !== 'auto/' + slug ? b : null;
};
// Counts the rounds of a plan that have at least one validator report, with the new
// (`validation-claude`, `validation-codex`) and old (`validation`, `codex-raw`) names.
// A report name belongs to one plan only, so no list of plans is needed.
// An empty report (only blank lines, for example a Codex run that stopped early) does not count.
// The folder is read once for each change of its mtime, and each report once for each change of its mtime or size
// (only after the mtime is RACY_MS old; before that, each build reads them again, the folder once per build).
const VALIDATOR_REPORT = /^(?:validation-claude|validation-codex|validation|codex-raw)-(\d+)\.md$/;
// A file system can keep the same mtime for two changes in a short time (1 s on HFS+, 2 s on FAT, a few ms on ext4).
// So a cache keeps a result only when the mtime is RACY_MS or more in the past: a later change then gets a new mtime.
const RACY_MS = 2000;
const settled = (mtimeMs) => Date.now() - mtimeMs >= RACY_MS;
// goes up at the start of each listPlans(): a folder index that is not settled holds for that pass only
let indexPass = 0;
// file path -> { key: 'mtimeMs:size', text }; the same pattern as sessionIdCache
const textCache = new Map();
const hasText = (file) => {
  try {
    const st = statSync(file);
    const key = st.mtimeMs + ':' + st.size;
    const hit = textCache.get(file);
    if (hit && hit.key === key) return hit.text;
    const text = readFileSync(file, 'utf8').trim() !== '';
    if (settled(st.mtimeMs)) textCache.set(file, { key, text });
    else textCache.delete(file);
    return text;
  } catch { return false; }
};
// folder path -> { mtime, bySlug: Map(slug -> [{ file, round }]) }
const validIndexes = new Map();
/**
 * Gives the validator reports of a project, grouped by the plan slug that owns them.
 * It reads the folder again only when the folder mtime changes. A missing folder gives an empty Map.
 */
const validationIndex = (proj) => {
  const dir = proj.validDir;
  let st;
  try { st = statSync(dir); } catch {
    // only a folder that had an index can have cached files: no scan of the cache for each plan of a project with no folder
    if (validIndexes.delete(dir)) for (const f of textCache.keys()) if (path.dirname(f) === dir) textCache.delete(f);
    return new Map();
  }
  const hit = validIndexes.get(dir);
  // a settled index holds until the folder changes; one that is not settled holds for the rest of this
  // listPlans() pass only (validationIndex runs once for each plan), so the next pass reads the folder again
  if (hit && hit.mtime === st.mtimeMs && (hit.settled || hit.pass === indexPass)) return hit.bySlug;
  let names;
  try { names = readdirSync(dir); } catch { return new Map(); }
  const bySlug = new Map();
  for (const f of names) {
    for (let i = f.indexOf('-', 1); i > 0; i = f.indexOf('-', i + 1)) {
      const m = f.slice(i + 1).match(VALIDATOR_REPORT);
      if (!m) continue;
      const slug = f.slice(0, i);
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push({ file: f, round: m[1] });
    }
  }
  const present = new Set(names);
  for (const f of textCache.keys()) if (path.dirname(f) === dir && !present.has(path.basename(f))) textCache.delete(f);
  validIndexes.set(dir, { mtime: st.mtimeMs, bySlug, settled: settled(st.mtimeMs), pass: indexPass });
  return bySlug;
};
const validationRounds = (proj, slug) => {
  const rounds = new Set();
  for (const { file, round } of validationIndex(proj).get(slug) || []) {
    if (!rounds.has(round) && hasText(path.join(proj.validDir, file))) rounds.add(round);
  }
  return rounds.size;
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
    // "[s]kill" matches the run but not another pgrep for the same plan: two checks at
    // the same moment (the page's poll and a chat send) would otherwise find each other
    execFile('pgrep', ['-f', `[s]kill-auto-pipeline ${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md`], (err) =>
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
  indexPass++;
  const summaries = loadSummaries(proj);
  const meta = loadMeta(proj);
  const prs = prsFor(proj);
  const allPrs = (prLists[proj.root] || {}).allByBranch || {};
  const branches = {};
  const prOf = (slug) => { const b = ownBranch(proj, slug, branches); return (b ? allPrs[b] : prs['auto/' + slug]) || null; };
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
      let reportAt = null;
      try { reportAt = statSync(proj.hasPipeline ? path.join(proj.autoRunsDir, slug + '.md') : runReportFile(proj, slug)).mtimeMs; } catch {}
      return {
        reportAt, waits: planWaits(key, content),
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
        chatting: !!(chats.get(key)?.busy || chats.get(key)?.bg.size),
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
        run: null, live: false, worktree: !!proj.hasPipeline && existsSync(worktreeOf(proj, slug)), archived: true, reportAt: null, waits: null,
        status: meta[slug]?.status || null, tags: meta[slug]?.tags || [],
        ...planSessions(proj, slug),
        asked: existsSync(chatFile(proj, slug)),
        chatting: !!(chats.get(key)?.busy || chats.get(key)?.bg.size),
        chatWaits: chats.get(key)?.waits.size || 0,
        pr: prOf(slug),
      };
    });
  planBranches[proj.root] = branches;
  return [...active, ...archived];
};

const fullState = async () => {
  const out = [];
  for (const entry of loadRegistry()) {
    const proj = resolveProject(entry);
    const health = projectHealth(proj.root, entry);
    const boot = health.checks.find((c) => c.id === 'bootstrap');
    out.push({
      name: proj.name, client: proj.client, root: proj.root, plansDir: proj.plansDir,
      color: proj.color, short: proj.short,
      hasPipeline: proj.hasPipeline, hasLanes: proj.hasLanes,
      modes: pipelineModes(proj).map(({ flag, ...m }) => m),
      launchers: proj.launchers, issuesUrl: proj.issuesUrl,
      // only a repo on GitHub can have PRs, so only there is a gh failure worth saying
      prError: proj.issuesUrl ? (prLists[proj.root] || {}).error || '' : '',
      setupLevel: health.level,
      bootstrap: boot && !boot.ok ? boot.state : '',
      // the chip copies this prompt on click, the same text the setup guide shows
      bootstrapPrompt: boot && !boot.ok ? boot.fixPrompt : '',
      // the unattended upgrade run (upgrade-run.mjs) and the hash the templates make now
      bootstrapRun: proj.root === DASH_REPO ? null : bootstrapRunOf(proj.root),
      bootstrapHash: proj.root === DASH_REPO ? null : bootstrapStatus(proj.root)?.hash ?? null,
      plans: await listPlans(proj),
      // a worktree on a branch that a plan names shows as that plan, not twice
      worktrees: proj.issuesUrl ? worktreesFor(proj)
        .filter((w) => !Object.values(planBranches[proj.root] || {}).includes(w.branch)) : [],
    });
  }
  return out;
};

// One shared /api/state build: stateGen goes up on each change request, stateBuilds counts the builds.
let stateGen = 0, stateBuilds = 0, stateBuild = null;
/** Marks the shared /api/state build as old. The next GET /api/state starts a new build. */
const invalidateState = () => { stateGen++; };
/**
 * Gives the answer of GET /api/state as { n, body }: n is the build number, body is the JSON text.
 * All requests share one build while it is less than STATE_CACHE_MS old, from the start of the build,
 * while it runs and after it ended. The window starts at the start because the build reads the files from that time on.
 * A request that is not a GET clears the shared build (invalidateState). A failed build is not kept.
 * A newer build (after a clear) is never replaced by an older one (the check stateBuild === b).
 */
const buildStateBody = () => {
  // performance.now() is monotonic: a clock set back cannot keep an old build for the length of the jump
  if (stateBuild && stateBuild.gen === stateGen && performance.now() - stateBuild.at < STATE_CACHE_MS) return stateBuild.promise;
  const b = { gen: stateGen, n: ++stateBuilds, at: performance.now() };
  stateBuild = b;
  b.promise = (async () => {
    try {
      enqueueMissingSummaries();
      const body = JSON.stringify(await fullState());
      return { n: b.n, body };
    } catch (e) {
      if (stateBuild === b) stateBuild = null;
      throw e;
    }
  })();
  return b.promise;
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
  for (const s of slugs) chatEnd(proj, s);
  for (const k of keys) { launches.set(k, { state: 'starting', at: Date.now() }); }
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
  chatEnd(proj, slug);
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

// Bootstrap status: is the /bootstrap-project scaffolding there, and do the templates still
// make the files it last applied? render.mjs --status takes ~70 ms, so it runs in the
// background, one repo at a time. A result is kept until bootstrap.json or the skill changes,
// or 10 minutes pass (an edit in the repo changes the file counts only).
const BOOTSTRAP_SKILL = path.join(DASH_REPO, 'skills/bootstrap-project');
const newestMtime = (dir) => {
  let m = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      m = Math.max(m, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
    }
  } catch {}
  return m;
};
let skillStamp = { at: 0, m: 0 };
const bootstrapSkillMtime = () => {
  if (Date.now() - skillStamp.at > 5000) skillStamp = { at: Date.now(),
    m: Math.max(newestMtime(path.join(BOOTSTRAP_SKILL, 'templates')), newestMtime(path.join(BOOTSTRAP_SKILL, 'scripts'))) };
  return skillStamp.m;
};
const bootstrapCache = new Map();   // root -> { key, at, busy, result }
let bootstrapQueue = Promise.resolve();
const BOOTSTRAP_TTL = 10 * 60 * 1000;
// { state: 'missing' | 'ok' | 'outdated' | 'error', differ, saved, hash, error }, or null while the first check runs
const bootstrapStatus = (root) => {
  let mtime;
  try { mtime = statSync(path.join(root, '.claude', 'bootstrap.json')).mtimeMs; } catch { return { state: 'missing' }; }
  const key = mtime + ':' + bootstrapSkillMtime();
  const c = bootstrapCache.get(root);
  if (c && (c.busy || (c.key === key && Date.now() - c.at < BOOTSTRAP_TTL))) return c.result;
  bootstrapCache.set(root, { key, at: Date.now(), busy: true, result: c ? c.result : null });
  bootstrapQueue = bootstrapQueue.then(() => new Promise((resolve) => {
    execFile(process.execPath, [path.join(BOOTSTRAP_SKILL, 'scripts/render.mjs'), root, '--status'],
      { env: ENV, timeout: 20000 }, (err, out, errOut) => {
        let result;
        try {
          if (err) throw new Error(String(errOut || err.message).trim().replace(/^render: /, '').split('\n').slice(0, 3).join(' '));
          const s = JSON.parse(out), n = s.counts || {};
          // config = only a hand-tuned CONFIG block differs, orphan = a turned-off module: neither needs an upgrade
          const differ = (n.changed || 0) + (n.new || 0) + (n.merge || 0);
          // with a saved hash, only a change in the templates or the answers counts, not the repo's own edits
          // hash: the page compares it with the hash of an upgrade PR (bootstrapRun)
          result = { state: (s.saved ? s.saved !== s.hash : differ > 0) ? 'outdated' : 'ok', differ, saved: !!s.saved, hash: s.hash };
        } catch (e) { result = { state: 'error', error: e.message }; }
        bootstrapCache.set(root, { key, at: Date.now(), busy: false, result });
        resolve();
      });
  }));
  return c ? c.result : null;
};
const bootstrapCheck = (root) => {
  const bs = root === DASH_REPO ? null : bootstrapStatus(root);
  if (!bs) return null;
  const files = (n) => n + ' file' + (n === 1 ? '' : 's');
  const detail = bs.state === 'missing' ? 'no .claude/bootstrap.json — never set up with /bootstrap-project'
    : bs.state === 'error' ? 'render.mjs --status failed: ' + bs.error
    : bs.state === 'ok' ? 'up to date with the bootstrap-project templates'
    : bs.saved ? 'the templates or the answers changed since the last apply' + (bs.differ ? ' · ' + files(bs.differ) + ' differ' : '')
    : files(bs.differ) + ' differ from the templates';
  return { id: 'bootstrap', label: 'Bootstrap scaffolding', required: false, ok: bs.state === 'ok', state: bs.state, detail,
    why: 'The skills, the pipeline script and the allow list come from the bootstrap-project templates. ' +
      'Running it brings this repo the fixes made to them since.',
    fixPrompt: bs.state === 'missing' ? 'Run /bootstrap-project in this repository. Do not commit.'
      : bs.state === 'error' ? 'Run /bootstrap-project --upgrade in this repository and fix what render.mjs reports ' +
        'about .claude/bootstrap.json. Do not commit.'
      : 'Run /bootstrap-project --upgrade in this repository. Do not commit.' };
};

// The unattended upgrade (skills/bootstrap-project/scripts/upgrade-run.mjs): its lock and
// status file in the repo's .plans/auto-runs/ (references/contracts.md, "Upgrade run status").
const bootstrapRunFile = (root) => path.join(root, '.plans', 'auto-runs', 'bootstrap-upgrade.json');
const bootstrapLockFile = (root) => path.join(root, '.plans', 'auto-runs', 'bootstrap-upgrade.lock');
const pidGone = (pid) => {
  try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
};
// a run ends in well under this time (the Claude session times out after 45 minutes), so an
// older live PID is another process that got the number after the run was killed
const BOOTSTRAP_RUN_MAX_MS = 2 * 60 * 60 * 1000;

/** Reads the upgrade run status of a repo: null when there is none; a running run whose PID is gone, or that is older than 2 hours, reads as failed. */
const bootstrapRunOf = (root) => {
  let s;
  try { s = JSON.parse(readFileSync(bootstrapRunFile(root), 'utf8')); } catch { return null; }
  if (!s || typeof s !== 'object') return null;
  if (s.state === 'running' && Number.isInteger(s.pid) && pidGone(s.pid))
    return { ...s, state: 'failed', error: `the run stopped (pid ${s.pid} is gone)` };
  if (s.state === 'running' && Date.now() - Date.parse(s.startedAt) > BOOTSTRAP_RUN_MAX_MS)
    return { ...s, state: 'failed', error: 'the run stopped (it started more than 2 hours ago)' };
  if (s.state === 'pr') return { ...s, prState: prLists[root]?.allByBranch?.[s.branch]?.state };
  return s;
};

// root -> the upgrade child this server started and that has not exited: between the spawn and
// the moment the child takes its lock, a second click must not report "started" too
const bootstrapChildren = new Map();

/** Starts the unattended upgrade of one project in the background. Gives { ok } or { ok: false, output }. */
const bootstrapUpgrade = (proj) => {
  if (proj.root === DASH_REPO) return { ok: false, output: 'this dashboard repo has no bootstrap upgrade' };
  const bs = bootstrapStatus(proj.root);
  if (bs?.state !== 'outdated') return { ok: false, output: 'nothing to upgrade' };
  if (bootstrapChildren.has(proj.root)) return { ok: false, output: 'an upgrade run is already live' };
  const run = bootstrapRunOf(proj.root);
  if (run?.state === 'running') return { ok: false, output: 'an upgrade run is already live' };
  if (run?.state === 'pr' && run.hash === bs.hash && run.prState !== 'CLOSED' && run.prState !== 'MERGED')
    return { ok: false, output: `upgrade PR #${run.pr?.number} is open` };
  const lock = bootstrapLockFile(proj.root);
  if (existsSync(lock)) {
    let text = '', age = 0;
    try { text = readFileSync(lock, 'utf8').trim(); age = Date.now() - statSync(lock).mtimeMs; } catch {}
    const pid = /^\d+$/.test(text) ? Number(text) : null;
    const stale = pid ? pidGone(pid) || age > BOOTSTRAP_RUN_MAX_MS : age > 60000;
    if (!stale) return { ok: false, output: 'an upgrade run is already live' };
    try { unlinkSync(lock); } catch {}
  }
  let fd = null;
  try {
    mkdirSync(path.dirname(lock), { recursive: true });
    fd = openSync(path.join(path.dirname(lock), 'bootstrap-upgrade.log'), 'a');
    const args = [path.join(BOOTSTRAP_SKILL, 'scripts/upgrade-run.mjs'), proj.root];
    const argv = process.platform === 'darwin'
      ? ['caffeinate', ['-i', process.execPath, ...args]]   // keep the mac awake while it runs
      : [process.execPath, args];
    const child = spawn(argv[0], argv[1], { cwd: proj.root, env: ENV, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', (e) => { bootstrapChildren.delete(proj.root); console.error(`bootstrap upgrade of ${proj.name}: ${e.message}`); });
    child.unref();
    if (!child.pid) return { ok: false, output: 'the upgrade run could not start' };
    bootstrapChildren.set(proj.root, child);
    child.on('exit', () => { if (bootstrapChildren.get(proj.root) === child) bootstrapChildren.delete(proj.root); });
  } catch (e) {
    return { ok: false, output: 'the upgrade run could not start: ' + e.message };
  } finally {
    // the child holds its own copy; a spawn that throws must not leak it
    if (fd != null) try { closeSync(fd); } catch {}
  }
  return { ok: true };
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
  const boot = bootstrapCheck(root);
  if (boot) checks.push(boot);
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
// --- scout proposals (apps/scout/scout.mjs writes them with status "proposed") ---
// Confirm: a new chat in the repo root runs /skill-1-plan, which writes the plan over the proposal,
// so the plan keeps its card. Dismiss: archived with status "dismissed"; the scout reads that and
// proposes the finding again only when it gets worse.
const scoutConfirmPrompt = (rel) => `/skill-1-plan Turn the scout proposal in ${rel} into a plan.

Read that file first: it says what the scout found, with the evidence. Save the finished plan to that same file and replace the proposal, so the plan keeps its place on the dashboard. Keep the evidence in the plan's Context section.`;
const scoutProposal = (proj, slug) => {
  if (loadMeta(proj)[slug]?.status !== 'proposed') return 'This plan is not a scout proposal that waits for you.';
  if (!existsSync(path.join(proj.plansDir, slug + '.md'))) return 'Plan file not found.';
  return '';
};
const scoutConfirm = async (proj, slug) => {
  const why = scoutProposal(proj, slug);
  if (why) return { ok: false, output: why };
  const before = loadChat(proj, slug);
  // the scout's own session (its summary of the finding) goes on; otherwise a new one
  saveChat(proj, slug, { ...before, root: true, current: before.root ? before.current || null : null, fork: false });
  const rel = path.relative(proj.root, path.join(proj.plansDir, slug + '.md'));
  const r = await chatMessage(proj, slug, { text: scoutConfirmPrompt(rel), mode: 'default', model: 'default' });
  if (!r.ok) { saveChat(proj, slug, before); return r; }
  const m = loadMeta(proj);
  m[slug] = { ...m[slug], status: null };
  saveMeta(proj, m);
  return { ok: true };
};
const scoutDismiss = async (proj, slug) => {
  const why = scoutProposal(proj, slug);
  if (why) return { ok: false, output: why };
  const r = await archivePlan(proj, slug);
  if (!r.ok) return r;
  const m = loadMeta(proj);
  m[slug] = { ...m[slug], status: 'dismissed' };
  saveMeta(proj, m);
  return { ok: true };
};
// --- the 🔭 Scout drawer: what is set up on this Mac, each project's last run, the log, Run now ---
const SCOUT_CFG = path.join(HOME, '.claude', 'scout.json');
const SCOUT_LOG = path.join(CENTRAL, 'logs', 'scout.log');
const SCOUT_SCRIPT = path.join(DASH_REPO, 'apps', 'scout', 'scout.mjs');
const SCOUT_PLIST = path.join(HOME, 'Library', 'LaunchAgents', 'com.plans-dashboard.scout.plist');
const SCOUT_LOCK = path.join(CENTRAL, 'scout.lock');
let scoutChild = null;
// a run in progress, started here or by launchd: the scout writes its pid to scout.lock
const scoutRunning = () => {
  const l = loadJson(SCOUT_LOCK, null);
  if (!l || !l.pid) return scoutChild ? { startedAt: null } : null;
  try { process.kill(l.pid, 0); return { startedAt: l.startedAt || null }; } catch { return scoutChild ? { startedAt: null } : null; }
};
// the profile names in ~/.aws/config and ~/.aws/credentials, without reading any key
const awsProfiles = () => {
  const names = new Set();
  for (const f of ['config', 'credentials']) {
    let t = '';
    try { t = readFileSync(path.join(HOME, '.aws', f), 'utf8'); } catch {}
    for (const m of t.matchAll(/^\[(?:profile\s+)?([^\]\s]+)\s*\]/gm)) names.add(m[1]);
  }
  return names;
};
// the daily job counts as installed only while the script its plist starts exists: a plist from
// before the scout moved to apps/scout/ fails every day, so the drawer shows the --install step again
const scoutInstalled = () => {
  let xml;
  try { xml = readFileSync(SCOUT_PLIST, 'utf8'); } catch { return false; }
  const script = plistScript(xml);
  return !script || existsSync(script);
};
const logTail = (f, lines) => {
  try {
    const st = statSync(f), n = Math.min(st.size, 64 * 1024), buf = Buffer.alloc(n), fd = openSync(f, 'r');
    try { readSync(fd, buf, 0, n, st.size - n); } finally { closeSync(fd); }
    return buf.toString('utf8').split('\n').slice(-lines).join('\n').trim();
  } catch { return ''; }
};
const scoutStatus = () => {
  const cfg = loadJson(SCOUT_CFG, null), profiles = awsProfiles();
  const projects = Object.entries((cfg && cfg.projects) || {}).map(([name, c]) => ({
    name, registered: !!projByName(name), checks: c.checks || null,
    aws: c.aws && c.aws.profile ? { profile: c.aws.profile, ok: profiles.has(c.aws.profile) } : null,
    ...(({ lastRun, learn, checkRuns }) => ({ lastRun: lastRun || null, learn: learn || null, checkRuns: checkRuns || {} }))(loadJson(path.join(CENTRAL, 'state', name, 'scout.json'))),
    checksOn: c.checks || null,
    runs: loadJson(path.join(CENTRAL, 'state', name, 'scout-runs.json'), []),
  }));
  const running = scoutRunning();
  return {
    config: !!cfg, configPath: tilde(SCOUT_CFG), example: tilde(path.join(DASH_REPO, 'scripts', 'scout.example.json')),
    script: tilde(SCOUT_SCRIPT), docs: tilde(path.join(DASH_REPO, 'docs', 'scout.md')),
    installed: scoutInstalled(), mac: process.platform === 'darwin',
    notifier: NOTIFIERS.some((f) => existsSync(f)),
    running: !!running, startedAt: (running || {}).startedAt || null,
    current: running ? loadJson(path.join(CENTRAL, 'scout-current.json'), null) : null,
    projects, logPath: tilde(SCOUT_LOG), log: logTail(SCOUT_LOG, 200),
  };
};
// Unmute a check or one finding: the scout counts only what happens after this moment
const scoutUnmute = (b) => {
  if (!safeName(b.project) || !projByName(b.project)) return { ok: false, output: 'Unknown project.' };
  const what = b.check ? 'check:' + String(b.check) : b.key ? 'key:' + String(b.key) : '';
  if (!what || what.length > 300) return { ok: false, output: 'Say which check or finding to unmute.' };
  const f = path.join(CENTRAL, 'state', b.project, 'scout.json'), st = loadJson(f, null);
  if (!st) return { ok: false, output: 'The scout has not run for this project yet.' };
  st.unmuted = { ...(st.unmuted || {}), [what]: new Date().toISOString() };
  if (st.learn) {
    if (b.check) delete (st.learn.mutedChecks || {})[b.check];
    if (b.key) delete (st.learn.mutedKeys || {})[b.key];
  }
  writeFileSync(f, JSON.stringify(st, null, 2) + '\n');
  return { ok: true };
};
// ▶ Run now: the same run as the 07:00 job, into the same log
const scoutRun = () => {
  if (scoutRunning()) return { ok: false, output: 'The scout is already running.' };
  if (!existsSync(SCOUT_CFG)) return { ok: false, output: 'Set up ' + tilde(SCOUT_CFG) + ' first.' };
  mkdirSync(path.dirname(SCOUT_LOG), { recursive: true });
  const fd = openSync(SCOUT_LOG, 'a');
  // its own process group: a dashboard restart does not stop the run, and scout.lock shows it again
  const child = spawn(process.execPath, [SCOUT_SCRIPT], { env: ENV, stdio: ['ignore', fd, fd], detached: true });
  child.unref();
  closeSync(fd);
  scoutChild = child;
  const done = () => { if (scoutChild === child) scoutChild = null; };
  child.on('exit', done);
  child.on('error', done);
  return { ok: true };
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
  ' baseRefName: .base.ref, baseRefOid: .base.sha, mergedAt: .merged_at, state: (if .merged_at then "MERGED" elif .state == "open" then "OPEN" else "CLOSED" end)}]';
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
        url: p.url, head: p.headRefOid, base: p.baseRefName, baseSha: p.baseRefOid, mergedAt: p.mergedAt || null };
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
// The same fields as `gh pr view --json`, read with the REST API. Used when GitHub refuses
// GraphQL (its rate limit is shared with other tools and agents), so the PR tab still opens.
// REST has no "review required": reviewDecision is only APPROVED, CHANGES_REQUESTED or null.
const prViewRest = async (proj, n) => {
  const p = await gh(proj, ['api', 'repos/{owner}/{repo}/pulls/' + n]);
  if (!p.ok) return p;
  const d = JSON.parse(p.out), sha = d.head.sha;
  const [runs, status, reviews] = await Promise.all([
    gh(proj, ['api', '--paginate', 'repos/{owner}/{repo}/commits/' + sha + '/check-runs?per_page=100',
      '--jq', '.check_runs[] | {__typename: "CheckRun", name, status: (.status | ascii_upcase), conclusion: ((.conclusion // "") | ascii_upcase)}']),
    gh(proj, ['api', 'repos/{owner}/{repo}/commits/' + sha + '/status',
      '--jq', '.statuses[] | {__typename: "StatusContext", context, state: (.state | ascii_upcase)}']),
    gh(proj, ['api', '--paginate', 'repos/{owner}/{repo}/pulls/' + n + '/reviews?per_page=100', '--jq', '.[] | {user: .user.login, state}'])]);
  const rows = (r) => r.ok ? r.out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const last = {};   // each reviewer's newest approve or change request counts, as on GitHub
  for (const v of rows(reviews)) if (v.state === 'APPROVED' || v.state === 'CHANGES_REQUESTED') last[v.user] = v.state;
  const votes = Object.values(last);
  return { ok: true, pr: {
    number: d.number, title: d.title, body: d.body || '', url: d.html_url, isDraft: d.draft,
    state: d.merged_at ? 'MERGED' : d.state === 'open' ? 'OPEN' : 'CLOSED',
    baseRefName: d.base.ref, headRefName: d.head.ref, headRefOid: sha,
    mergeable: d.mergeable === true ? 'MERGEABLE' : d.mergeable === false ? 'CONFLICTING' : 'UNKNOWN',
    mergeStateStatus: String(d.mergeable_state || 'unknown').toUpperCase(),
    additions: d.additions, deletions: d.deletions, changedFiles: d.changed_files, commits: d.commits,
    reviewDecision: votes.includes('CHANGES_REQUESTED') ? 'CHANGES_REQUESTED' : votes.includes('APPROVED') ? 'APPROVED' : null,
    statusCheckRollup: [...rows(runs), ...rows(status)] } };
};
const prDetail = async (proj, number) => {
  const r = await gh(proj, ['pr', 'view', String(number), '--json',
    'number,title,body,state,isDraft,url,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,additions,deletions,changedFiles,commits,reviewDecision,statusCheckRollup']);
  let pr;
  if (r.ok) pr = JSON.parse(r.out);
  else {
    const rest = await prViewRest(proj, String(number));
    if (!rest.ok) return r;
    pr = rest.pr;
  }
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
  return { ok: true, pr: { ...rest, commits: typeof commits === 'number' ? commits : (commits || []).length, checks, merge, behindBy } };
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
    // marked before the merge: the watcher then leaves the pull to this button (no two pulls at once)
    const mark = proj.root + '#' + n;
    buttonMerged.set(mark, Date.now());
    const m = await gh(proj, ['pr', 'merge', n, '--' + b.method, '--match-head-commit', b.head, ...(b.admin ? ['--admin'] : [])]);
    if (!m.ok) { buttonMerged.delete(mark); return m; }
    const v = await gh(proj, ['api', 'repos/{owner}/{repo}/pulls/' + n, '--jq', '{baseRefName: .base.ref, headRefName: .head.ref}']);
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
    const r = await gh(proj, ['api', 'repos/{owner}/{repo}/pulls/' + n, '--jq', '{body: (.body // "")}']);
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

// ---------- event watcher ----------
// Every WATCH_MS, with no page open, the server reads the PRs and the runs of each project,
// writes what changed as events (<stateDir>/events.jsonl), starts a plan when the
// `- **Waits for**:` lines of its header became true, pulls the main checkout after a merge
// on GitHub, and sends a macOS notification when something needs the owner. One server per
// HOME runs it (watcher.lock). Guide: docs/plans-dashboard.md, "Waits for and the event watcher".
const WATCH_MS = process.env.DASH_WATCH_MS == null ? 60000 : +process.env.DASH_WATCH_MS;   // 0: off
// how long all clients share one /api/state build, from its start (0: no sharing); empty or not a number: 1000
const STATE_CACHE_MS = (() => {
  const raw = String(process.env.DASH_STATE_CACHE_MS ?? '').trim();
  const v = raw === '' ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 1000;
})();
const WATCH_LIMIT = 4;                     // runs at the same time per project (orchestrator parent plan, Q6)
const STALE_RUN_MS = 30 * 60 * 1000;       // a "running" report older than this and no process: a dead run
const WATCH_LOCK = path.join(CENTRAL, 'watcher.lock');
const EVENTS_KEPT = 5000;
const PENDING_MS = 10 * 60 * 1000;         // an auto-start that shows no run after this has failed
const BUTTON_MARK_MS = 60 * 60 * 1000;
// PR_JQ plus the times the watcher compares
const WATCH_PR_JQ = PR_JQ.replace(/\}\]$/, ', createdAt: .created_at, closedAt: .closed_at, updatedAt: .updated_at}]');
const OWN_REPO_NOTE = "Not pulled: this is the dashboard's own repo. Pull and restart by hand (AGENTS.md).";
const waitStatus = new Map();     // plan key -> [{ text, met, error }] of the last tick
const launchedNow = new Map();    // plan key -> its `launched` record in watch.json
const buttonMerged = new Map();   // "<root>#<number>" -> when the merge button merged it

const watchFile = (proj) => path.join(proj.stateDir, 'watch.json');
const eventsFile = (proj) => path.join(proj.stateDir, 'events.jsonl');
const loadWatch = (proj) => {
  const w = loadJson(watchFile(proj), null);
  const blank = { prs: null, outcomes: null, launched: {}, met: {}, errors: {}, since: new Date().toISOString(), checkedAt: null };
  return w && typeof w === 'object' ? { ...blank, ...w, since: w.since || blank.since } : blank;
};

// The lock: one JSON file that names the server that runs the watcher. Each side effect of a
// tick checks it first (fence), so a server that lost the lock stops at once.
const LOST_LOCK = new Error('lost the watcher lock');
const psCommand = (pid) => {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
};
let ownCommand = null;
const holdsLock = () => { try { return JSON.parse(readFileSync(WATCH_LOCK, 'utf8')).pid === process.pid; } catch { return false; } };
const fence = () => { if (!holdsLock()) throw LOST_LOCK; };
// link() fails when the file exists, so only one server gets it, and the lock is never half written
const linkLock = () => {
  const tmp = WATCH_LOCK + '.' + process.pid;
  ownCommand ??= psCommand(process.pid);
  // a lock with no command line could be judged stale by a server whose ps works: try next tick
  if (!ownCommand) return false;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, port: PORT, startedAt: new Date().toISOString(), cmd: ownCommand }));
  try { linkSync(tmp, WATCH_LOCK); return true; } catch { return false; } finally { try { unlinkSync(tmp); } catch {} }
};
// stale: unreadable and older than 10 s, a dead PID, or a PID that another program has now
const lockState = () => {
  let raw;
  try { raw = readFileSync(WATCH_LOCK, 'utf8'); } catch { return { gone: true }; }
  let l = null;
  try { l = JSON.parse(raw); } catch {}
  if (!l || typeof l !== 'object') {
    try { return { stale: Date.now() - statSync(WATCH_LOCK).mtimeMs > 10000, pid: null }; } catch { return { gone: true }; }
  }
  const pid = l.pid ?? null;
  if (!pid || !pidAlive(pid)) return { stale: true, pid };
  // a ps call that fails (load, timeout) says nothing: a live holder is never judged stale on it
  const cmd = psCommand(pid);
  if (cmd != null && cmd !== l.cmd) return { stale: true, pid };
  return { stale: false };
};
/** Takes the watcher lock when it is free or stale. Returns true when this server holds it now. */
const takeLock = () => {
  mkdirSync(CENTRAL, { recursive: true });
  if (linkLock()) return true;
  const s = lockState();
  if (s.gone) return linkLock();
  if (!s.stale) return false;
  // only one server can move the stale file away; the others get ENOENT and stop
  const moved = WATCH_LOCK + '.stale.' + process.pid;
  try { renameSync(WATCH_LOCK, moved); } catch { return false; }
  let m = null;
  try { m = JSON.parse(readFileSync(moved, 'utf8')); } catch {}
  const movedPid = m && typeof m === 'object' ? m.pid ?? null : null;
  if (movedPid !== s.pid) {   // another server replaced the lock in between: put it back
    try { linkSync(moved, WATCH_LOCK); } catch {}
    try { unlinkSync(moved); } catch {}
    return false;
  }
  try { unlinkSync(moved); } catch {}
  return linkLock();
};
const saveWatch = (proj, w) => {
  fence();
  mkdirSync(proj.stateDir, { recursive: true });
  const f = watchFile(proj);
  writeFileSync(f + '.tmp', JSON.stringify(w, null, 2) + '\n');
  renameSync(f + '.tmp', f);
};
/** Appends events to the project's events.jsonl, one JSON line each. The file keeps its last 5000 lines. */
const addEvents = (proj, list) => {
  if (!list.length) return;
  fence();
  mkdirSync(proj.stateDir, { recursive: true });
  const f = eventsFile(proj), at = new Date().toISOString();
  appendFileSync(f, list.map((e) => JSON.stringify({ at, project: proj.name, ...e }) + '\n').join(''));
  let t = '';
  try { t = readFileSync(f, 'utf8'); } catch {}
  if (t.split('\n').length - 1 > EVENTS_KEPT) {
    writeFileSync(f + '.tmp', capLines(t, EVENTS_KEPT));
    renameSync(f + '.tmp', f);
  }
};
// the address a click opens: the domain setup-macos.sh gave Caddy, else the local port (the scout's dashUrl)
const dashUrl = () => {
  let host = '';
  try { host = (readFileSync(path.join(CENTRAL, 'caddy-site.caddy'), 'utf8').match(/^([^\s{]+)\s*\{/m) || [])[1] || ''; } catch {}
  return host ? 'https://' + host : 'http://127.0.0.1:' + PORT;
};
/**
 * Gives { title, subtitle, message } of a plan notification, read like a dashboard tab: the project
 * label, what happened and the PR number in the title, the plan title under it, and the detail
 * without links (a click on the notification opens the plan).
 */
const notifyParts = (proj, slug, plan, what, detail) => {
  const pr = plan && plan.pr && plan.pr.number;
  const name = String(plan && plan.title && plan.title !== slug ? plan.title : slug).replace(/^\d{8}-\d{6}-/, '');
  const msg = String(detail || '').replace(/\s*[—–-]?\s*https?:\/\/\S+/g, '').trim();
  return { title: [proj.short || proj.name, what, pr ? 'PR #' + pr : ''].filter(Boolean).join(' · '), subtitle: name, message: msg || what };
};
/**
 * Shows a macOS notification of notifyParts() with the first notifier that works (NOTIFIERS: Shipyard with its icon,
 * then terminal-notifier), else osascript. A click opens `query` on the dashboard (not with osascript).
 */
const notifyMac = ({ title, subtitle, message }, query) => {
  if (process.env.DASH_NO_NOTIFY) return;
  const custom = process.env.DASH_NOTIFIER;
  if (!custom && process.platform !== 'darwin') return;
  fence();
  const msg = redact(message);
  const args = ['-title', title, '-subtitle', subtitle, '-message', msg, '-open', dashUrl() + '/' + query, '-group', 'plans-' + query];
  notifyFirst(custom ? [custom] : NOTIFIERS, args).then((sent) => {
    if (!sent) execFile('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title ${JSON.stringify(title)} subtitle ${JSON.stringify(subtitle)}`], () => {});
  });
};
const selQuery = (proj, slug) => '?sel=' + encodeURIComponent(proj.name + '/' + slug);

// a condition names its project by `name`, else by a `short` that only one project has
const findProject = (ref, projects) => {
  const named = projects.find((p) => p.name === ref);
  if (named) return { proj: named };
  const shorts = projects.filter((p) => p.short && p.short === ref);
  if (shorts.length === 1) return { proj: shorts[0] };
  return { reason: shorts.length ? 'two projects have this short name' : 'unknown project' };
};
// one git or gh call per key per tick, shared by every plan that asks
const once = (cache, key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
/**
 * Checks one `Waits for:` condition of a plan. Returns `{ met, error, fix }`: `error` is a short,
 * redacted reason or null; `fix` is true when the owner must change something.
 */
const checkCondition = async (proj, planText, cond, cache, projects) => {
  const fail = (error, fix) => ({ met: false, error: redact(error), fix });
  if (cond.kind === 'bad') return fail('cannot read this condition', true);
  if (cond.kind === 'pr' || cond.kind === 'plan') {
    const f = findProject(cond.project, projects);
    if (!f.proj) return fail(f.reason, true);
    const other = f.proj;
    if (cond.kind === 'pr') {
      const r = await once(cache, 'pr ' + other.root + ' ' + cond.number,
        () => gh(other, ['api', 'repos/{owner}/{repo}/pulls/' + cond.number, '--jq', '{merged_at}']));
      if (!r.ok) return fail(ghProblem(r.output), false);
      try { return { met: !!JSON.parse(r.out).merged_at, error: null }; } catch { return fail('gh gave no PR data', false); }
    }
    let branch = null, found = false;
    for (const d of [other.plansDir, other.doneDir])
      try { branch = planBranch(readFileSync(path.join(d, cond.slug + '.md'), 'utf8')); found = true; break; } catch {}
    const list = prLists[other.root] || {};
    if (list.error) return fail(list.error, false);
    const pr = (list.allByBranch || {})[branch || 'auto/' + cond.slug];
    // a slug with a typo has no plan file and no PR: say so, or the plan waits for ever in silence
    if (!found && !pr) return fail('unknown plan', true);
    return { met: !!pr && pr.state === 'MERGED', error: null };
  }
  // submodule <path> contains <sha>: the pointer on origin/<base> of this plan's own project
  const base = planBase(planText);
  if (!base) return fail('no Base line', true);
  const sub = path.join(proj.root, cond.path);
  if (!existsSync(path.join(sub, '.git'))) return fail('submodule not initialized in the main checkout', true);
  if (!(await once(cache, 'fetch ' + proj.root + ' ' + base, () => gitIn(proj.root, ['fetch', '-q', 'origin', base]))).ok)
    return fail('cannot fetch origin/' + base, false);
  const tree = await gitIn(proj.root, ['ls-tree', 'origin/' + base, '--', cond.path]);
  const ptr = (tree.out.match(/^160000 commit ([0-9a-f]{40})\t/) || [])[1];
  if (!tree.ok || !ptr) return fail('not a submodule', true);
  if (!(await once(cache, 'subfetch ' + sub, () => gitIn(sub, ['fetch', '-q', 'origin']))).ok)
    return fail('cannot fetch the submodule', false);
  if (!(await gitIn(sub, ['cat-file', '-e', cond.sha + '^{commit}'])).ok) return fail('commit not found (unknown or ambiguous)', true);
  const r = await gitRaw(sub, ['merge-base', '--is-ancestor', cond.sha, ptr]);
  if (r.code === 0) return { met: true, error: null };
  if (r.code === 1) return { met: false, error: null };
  return fail('cannot compare the commits', false);
};
// an auto-start only merges with the owner: "to PR" when the project has it, else its default mode
const autoMode = (proj) => {
  const modes = pipelineModes(proj);
  return modes.some((m) => m.id === 'pr') ? 'pr' : (modes.find((m) => m.default) || modes[0] || {}).id;
};
// the watcher never pulls the checkout it runs from: that needs the restart check of AGENTS.md.
// A dashboard that runs from a worktree of its repo shares the main checkout's git folder
// (--git-common-dir), so it does not pull the main checkout (the service's code) either.
const gitCommonDir = (dir) => {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out ? realpathSync(path.resolve(dir, out)) : null;
  } catch { return null; }
};
const ownRepo = (proj) => {
  try {
    if (realpathSync(proj.root) === realpathSync(DASH_REPO)) return true;
  } catch { return true; }
  const own = gitCommonDir(DASH_REPO);
  return own != null && own === gitCommonDir(proj.root);
};
// the PRs updated since the last tick, newest update first (a merge updates a PR, also an old one)
const readUpdatedPrs = async (proj, saved) => {
  const floor = Date.parse(saved.checkedAt || saved.since) - 2 * 60 * 1000;
  const rows = [], seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const r = await gh(proj, ['api', 'repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=' + page,
      '--jq', WATCH_PR_JQ]);
    if (!r.ok) return null;
    let list;
    try { list = JSON.parse(r.out); } catch { return null; }
    if (!Array.isArray(list)) return null;
    for (const x of list) if (x && !seen.has(x.number)) { seen.add(x.number); rows.push(x); }
    if (list.length < 100 || Date.parse((list.at(-1) || {}).updatedAt) < floor) break;
  }
  return rows;
};
const isRunning = (p, now) => runningCount([p], now, STALE_RUN_MS) === 1;
/** One watcher tick for one project: PR events, run outcomes, waits and auto-starts. */
const watchProject = async (proj, projects, cache) => {
  const tickAt = new Date().toISOString();
  const saved = loadWatch(proj);
  const next = { ...saved, launched: { ...saved.launched }, met: { ...saved.met }, errors: { ...saved.errors } };
  const events = [];
  // 1. PRs: saved before any pull, so a crash never pulls twice
  const rows = await readUpdatedPrs(proj, saved);
  if (rows) {
    const prEv = prEvents(saved.prs, rows, saved.since);
    next.prs = prMap(rows, saved.prs);
    next.checkedAt = tickAt;
    saveWatch(proj, next);
    for (const e of prEv) {
      if (e.type === 'pr-merged') {
        const mark = proj.root + '#' + e.number;
        if (buttonMerged.has(mark)) { buttonMerged.delete(mark); e.pull = 'Pull left to the merge button.'; }
        else if (ownRepo(proj)) e.pull = OWN_REPO_NOTE;
        else { fence(); e.pull = redact(await pullRoot(proj, e.base)); }
      }
      events.push(e);
    }
    // written now: the PR state is saved already, so an error in a later step must not lose them
    addEvents(proj, events.splice(0));
  }
  // 2. plans, 3. run outcomes
  const plans = (await listPlans(proj)).filter((p) => !p.archived);
  const bySlug = new Map(plans.map((p) => [p.slug, p]));
  if (proj.hasPipeline) {
    next.outcomes = Object.fromEntries(plans.filter((p) => p.run).map((p) => [p.slug, { outcome: p.run.outcome, status: p.run.status }]));
    events.push(...outcomeEvents(saved.outcomes ?? null, next.outcomes));
  }
  // 4. what became of the plans the watcher started
  for (const [slug, rec] of Object.entries(next.launched)) {
    const inPlans = existsSync(path.join(proj.plansDir, slug + '.md')), inDone = existsSync(path.join(proj.doneDir, slug + '.md'));
    if (!inPlans && !inDone) { delete next.launched[slug]; continue; }
    if (rec.state !== 'pending') continue;
    const p = bySlug.get(slug);
    if (!p) { if (inDone) next.launched[slug] = { ...rec, state: 'started' }; continue; }
    if (p.run || p.live) next.launched[slug] = { ...rec, state: 'started' };
    else if (p.launch && p.launch.state === 'failed') {
      next.launched[slug] = { ...rec, state: 'failed' };
      events.push({ type: 'auto-launch-failed', slug, output: redact(p.launch.output || 'the launcher failed') });
    } else if (!p.launch && Date.now() - Date.parse(rec.at) > PENDING_MS) {
      next.launched[slug] = { ...rec, state: 'failed' };
      events.push({ type: 'auto-launch-failed', slug, output: 'no run started' });
    }
  }
  for (const slug of Object.keys(next.met)) if (!bySlug.has(slug)) delete next.met[slug];
  // 5. waits
  const waitsOf = new Map(), errorsNow = new Set(), newErrors = [];
  for (const p of plans) {
    const key = proj.name + '/' + p.slug;
    let text = '';
    try { text = readFileSync(path.join(proj.plansDir, p.file), 'utf8'); } catch { continue; }
    const conds = parseWaitsFor(text);
    if (!conds) { waitStatus.delete(key); continue; }
    if (next.launched[p.slug] || p.run) continue;   // started: not checked again
    const waits = [];
    for (const c of conds) {
      const r = proj.hasPipeline ? await checkCondition(proj, text, c, cache, projects)
        : { met: false, error: 'auto-start needs .claude/scripts/auto-pipeline.sh', fix: true };
      waits.push({ text: c.text, met: !r.error && !!r.met, error: r.error || null });
      if (!r.error) continue;
      const ek = p.slug + '\n' + c.text;
      errorsNow.add(ek);
      if (next.errors[ek]) continue;
      next.errors[ek] = { reason: r.error, fix: !!r.fix };
      events.push({ type: 'wait-error', slug: p.slug, text: c.text, reason: r.error });
      if (r.fix) newErrors.push({ slug: p.slug, reason: r.error });
    }
    waitStatus.set(key, waits);
    waitsOf.set(p.slug, waits);
    if (waits.every((w) => w.met) && !next.met[p.slug]) {
      next.met[p.slug] = true;
      events.push({ type: 'wait-met', slug: p.slug, conditions: waits.map((w) => w.text) });
    }
  }
  for (const ek of Object.keys(next.errors)) if (!errorsNow.has(ek)) delete next.errors[ek];
  // 6. auto-starts, at most WATCH_LIMIT runs at the same time
  if (proj.hasPipeline) {
    const now = Date.now(), running = runningCount(plans, now, STALE_RUN_MS), startedNow = new Set();
    for (const p of plans) {
      if (!canAutoLaunch(p, waitsOf.get(p.slug), next.launched, running + startedNow.size, WATCH_LIMIT)) continue;
      if (await pipelineLive(proj, p.slug)) continue;
      // from here to the launch no await: no request handler can start the plan in between
      fence();
      const key = proj.name + '/' + p.slug, ch = chats.get(key);
      if (launches.get(key) || (ch && (ch.busy || ch.waits.size))) continue;
      // the owner may have parked the plan or changed its Waits for lines during the awaits
      let nowText;
      try { nowText = readFileSync(path.join(proj.plansDir, p.file), 'utf8'); } catch { continue; }
      const nowConds = parseWaitsFor(nowText), checked = waitsOf.get(p.slug);
      if (!nowConds || nowConds.length !== checked.length || nowConds.some((c, i) => c.text !== checked[i].text)) continue;
      if (['parked', 'proposed'].includes(loadMeta(proj)[p.slug]?.status)) continue;
      if (!existsSync(path.join(proj.plansDir, p.file))) continue;
      if (existsSync(path.join(proj.autoRunsDir, p.slug + '.md')) || existsSync(worktreeOf(proj, p.slug))) continue;
      // manual launches that started during the awaits of this tick
      const manualNew = [...launches].filter(([k, l]) => {
        if (l.state !== 'starting' || !k.startsWith(proj.name + '/')) return false;
        const s = k.slice(proj.name.length + 1), snap = bySlug.get(s);
        return !startedNow.has(s) && !(snap && ((snap.launch && snap.launch.state === 'starting') || isRunning(snap, now)));
      }).length;
      if (running + startedNow.size + manualNew >= WATCH_LIMIT) continue;
      const mode = autoMode(proj);
      next.launched[p.slug] = { at: new Date().toISOString(), mode, state: 'pending' };
      saveWatch(proj, next);   // saved before the launch: a crash never starts a plan twice
      launchPipeline(proj, [{ slug: p.slug, mode }]);
      events.push({ type: 'auto-launch', slug: p.slug, mode });
      startedNow.add(p.slug);
    }
  }
  // 7. state, then events, then notifications: a crash can lose an event, never repeat one
  saveWatch(proj, next);
  for (const k of [...launchedNow.keys()]) if (k.startsWith(proj.name + '/')) launchedNow.delete(k);
  for (const [slug, rec] of Object.entries(next.launched)) launchedNow.set(proj.name + '/' + slug, rec);
  addEvents(proj, events);
  const note = (slug, what, detail) => notifyMac(notifyParts(proj, slug, bySlug.get(slug), what, detail), selQuery(proj, slug));
  for (const e of events) {
    if (e.type === 'auto-launch') note(e.slug, 'started', 'Started by the plans watcher');
    else if (e.type === 'auto-launch-failed') note(e.slug, 'did not start', e.output);
    else if (e.type === 'run-outcome' && (e.outcome === 'needs-you' || e.outcome === 'failed')) {
      const was = (saved.outcomes || {})[e.slug];
      const prOpen = (s) => /^PR OPEN/i.test(String(s || ''));
      if (e.previous !== e.outcome || (prOpen(e.status) && !prOpen(was && was.status)))
        note(e.slug, e.outcome === 'failed' ? 'run failed' : 'your turn', e.status);
    }
  }
  for (const n of newErrors) note(n.slug, 'cannot start by itself', n.reason);
};
let watching = false, lockNoted = false;
/** One watcher tick over every project. Only the server that holds watcher.lock does the work. */
const watchTick = async () => {
  if (watching) return;
  watching = true;
  try {
    if (!holdsLock() && !takeLock()) {
      if (!lockNoted) console.log('watcher: another dashboard runs the watcher');
      lockNoted = true;
      return;
    }
    lockNoted = false;
    for (const [k, at] of buttonMerged) if (Date.now() - at > BUTTON_MARK_MS) buttonMerged.delete(k);
    const projects = allProjects();
    // every PR list is read after the tick started, so no condition reads an old one
    await Promise.all(projects.map(async (p) => {
      const c = prLists[p.root];
      if (c && c.loading) await c.loading;
      await refreshPrList(p);
    }));
    const cache = new Map();
    for (const p of projects) {
      try { await watchProject(p, projects, cache); }
      catch (e) { if (e === LOST_LOCK) throw e; console.log(`watcher: ${p.name}: ${redact(e.message || e)}`); }
    }
  } catch (e) {
    console.log(e === LOST_LOCK ? 'watcher: lost the lock, tick stopped' : `watcher: ${redact(e.message || e)}`);
  } finally { watching = false; }
};
/** Starts the watcher: a first tick after 2 s, then one every WATCH_MS. DASH_WATCH_MS=0 turns it off. */
const startWatcher = () => {
  for (const p of allProjects()) {
    const w = loadJson(watchFile(p), null);
    for (const [slug, rec] of Object.entries((w && w.launched) || {})) launchedNow.set(p.name + '/' + slug, rec);
  }
  if (!(WATCH_MS > 0)) return;
  process.on('exit', () => { if (holdsLock()) try { unlinkSync(WATCH_LOCK); } catch {} });
  setTimeout(() => { watchTick(); setInterval(watchTick, WATCH_MS).unref(); }, 2000).unref();
};
// what /api/state shows for a plan's `Waits for:` lines: the last tick's result, or "not met yet"
const planWaits = (key, content) => {
  const conds = parseWaitsFor(content);
  if (!conds || launchedNow.has(key)) return null;
  const last = waitStatus.get(key);
  if (last && last.length === conds.length && last.every((w, i) => w.text === conds[i].text)) return last;
  return conds.map((c) => ({ text: c.text, met: false, error: null }));
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
// Files changed from the local repo: the PR's commits are usually here already (the pipeline
// made them), and git answers in milliseconds where the GitHub diff took seconds. null when a
// commit is missing here: the caller asks GitHub. The base is the newer of GitHub's base commit
// and origin/<base> (merge-base of all three), so a base merged into the branch since adds nothing.
const SHA = /^[0-9a-f]{40}$/;
const hasCommit = async (root, sha) => SHA.test(sha || '') && (await gitRaw(root, ['cat-file', '-e', sha + '^{commit}'])).ok;
// a PR made elsewhere is not here yet: fetch it in the background (GitHub answers this time,
// git every time after), at most once a minute per PR head so an offline Mac does not retry each poll
const prFetchAt = new Map();
const fetchPr = (proj, pr) => {
  const k = proj.root + ' ' + pr.head;
  if (Date.now() - (prFetchAt.get(k) || 0) < 60000) return;
  prFetchAt.set(k, Date.now());
  gitRaw(proj.root, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin',
    'refs/pull/' + pr.number + '/head', pr.base]);
};
const localPrDiff = async (proj, n) => {
  const pr = Object.values((prLists[proj.root] || {}).allByBranch || {}).find((x) => String(x.number) === n);
  if (!pr) return null;
  if (!(await hasCommit(proj.root, pr.head)) || !(await hasCommit(proj.root, pr.baseSha))) { fetchPr(proj, pr); return null; }
  const tip = await gitRaw(proj.root, ['rev-parse', '--verify', '--quiet', 'origin/' + pr.base + '^{commit}']);
  const mb = await gitRaw(proj.root, ['merge-base', pr.head, pr.baseSha, ...(tip.ok ? [tip.out.trim()] : [])]);
  if (!mb.ok) return null;
  const d = await gitRaw(proj.root, ['diff', '--no-color', '--no-ext-diff', '-M', mb.out.trim(), pr.head]);
  return d.ok ? { ok: true, diff: d.out, local: true } : null;
};
const localPrFile = async (proj, sha, file) => {
  if (!(await hasCommit(proj.root, sha))) return null;
  const r = await gitRaw(proj.root, ['show', sha + ':' + file]);
  return r.ok ? { ok: true, text: r.out, local: true } : null;
};
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
// ---- plan usage (Claude and Codex) ----
// How much of each plan limit is used. Claude has no file for it: every claude request
// streams a rate_limit_event, so the chats' newest one is kept in USAGE_FILE (a restart
// keeps it). Codex writes its limits into each session file under ~/.codex/sessions.
// A window: { name: 'five_hour' | 'seven_day' | …, pct: 0–100, resetsAt: ms }.
const USAGE_FILE = path.join(CENTRAL, 'usage-claude.json');
const usageClaudeSave = (info) => {
  const wins = info?.unifiedWindows || (info?.rateLimitType && { [info.rateLimitType]: info });
  if (!wins) return;
  let old = {};
  try { old = JSON.parse(readFileSync(USAGE_FILE, 'utf8')).windows || {}; } catch {}
  const at = Date.now();
  for (const [name, w] of Object.entries(wins))
    if (typeof w?.utilization === 'number') old[name] = { pct: Math.round(w.utilization * 100), resetsAt: (w.resetsAt || 0) * 1000, at };
  try { mkdirSync(CENTRAL, { recursive: true }); writeFileSync(USAGE_FILE, JSON.stringify({ windows: old })); } catch {}
};
const usageWindows = (wins) => Object.entries(wins).map(([name, w]) => ({ name, ...w,
  // past its reset the number is old: the window starts again from 0
  ...(w.resetsAt && w.resetsAt < Date.now() ? { pct: 0, reset: true } : {}) }));
const usageClaude = () => {
  try { return { windows: usageWindows(JSON.parse(readFileSync(USAGE_FILE, 'utf8')).windows || {}) }; }
  catch { return { windows: [] }; }
};
// the newest session files first: sessions/YYYY/MM/DD/*.jsonl, newest days first
const codexSessionFiles = (max) => {
  const root = path.join(HOME, '.codex', 'sessions'), out = [];
  const desc = (d) => { try { return readdirSync(d).sort().reverse(); } catch { return []; } };
  for (const y of desc(root)) for (const m of desc(path.join(root, y))) for (const d of desc(path.join(root, y, m))) {
    const dir = path.join(root, y, m, d);
    out.push(...desc(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f))
      .map((f) => ({ f, t: statSync(f).mtimeMs })).sort((a, b) => b.t - a.t));
    if (out.length >= max) return out.slice(0, max);
  }
  return out;
};
const codexWinName = (min) => min === 300 ? 'five_hour' : min === 10080 ? 'seven_day' : min + '_minutes';
const usageCodex = () => {
  for (const { f, t } of codexSessionFiles(5)) {
    // the limits are in the token_count events; read the end of the file only
    let text = '';
    try {
      const fd = openSync(f, 'r'), size = statSync(f).size, len = Math.min(size, 512 * 1024), buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len); closeSync(fd);
      text = buf.toString('utf8');
    } catch { continue; }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      let r;
      try { const j = JSON.parse(lines[i]); r = j.payload?.rate_limits || j.rate_limits; } catch { continue; }
      if (!r || (r.limit_id && r.limit_id !== 'codex') || !(r.primary || r.secondary)) continue;
      const wins = {};
      for (const w of [r.primary, r.secondary]) if (w && typeof w.used_percent === 'number')
        wins[codexWinName(w.window_minutes)] = { pct: Math.round(w.used_percent), resetsAt: (w.resets_at || 0) * 1000, at: t };
      return { windows: usageWindows(wins), plan: r.plan_type || null };
    }
  }
  return { windows: [] };
};
const usageState = () => ({ claude: usageClaude(), codex: usageCodex() });

const chats = new Map();         // plan key -> the open claude
const chatClients = new Map();   // plan key -> the pages listening (server-sent events)
const chatNotes = new Map();     // plan key -> how the last claude ended, when it failed
// Each chat's claude runs under apps/dashboard/chat-relay.mjs, detached, so a restart of this server
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
/**
 * Keeps bg, the set of the chat's background tasks (agents and shells) that still run, up to date from
 * one stream message j. claude sends the whole list in background_tasks_changed; task_started and
 * task_notification add and remove one. While bg has one, the agent is not done: the plan shows
 * "working", and the idle close waits. Gives true when bg changed.
 */
const bgTrack = (bg, j) => {
  if (j.type !== 'system') return false;
  const was = [...bg].join();
  if (j.subtype === 'background_tasks_changed' && Array.isArray(j.tasks)) { bg.clear(); for (const t of j.tasks) if (t && t.task_id) bg.add(t.task_id); }
  else if (j.subtype === 'task_started' && j.is_backgrounded && j.task_id) bg.add(j.task_id);
  else if (j.subtype === 'task_notification' && j.task_id) bg.delete(j.task_id);
  return [...bg].join() !== was;
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
// A confirmed scout proposal plans in a chat in the repo root (a.root), because it has no worktree
// yet. Once a pipeline run makes the worktree, the plan's sessions are the worktree's again.
const rootChat = (proj, slug, a) => !!a.root && !(proj.hasPipeline && existsSync(worktreeOf(proj, slug)));
// the sessions a plan's runs made; the chat's copies are its own and not listed. A root chat shares
// the repo root's transcript dir with every other session there, so only its own sessions (a.own) count.
const planSessions = (proj, slug) => {
  const a = loadChat(proj, slug), root = rootChat(proj, slug, a);
  const wtPath = proj.hasPipeline && !root ? worktreeOf(proj, slug) : proj.root;
  const transcriptDir = transcriptDirFor(wtPath);
  const copies = new Set(a.copies || []);
  const only = root ? new Set([...(proj.hasPipeline ? [] : sessionIdsInLog(proj, slug)), ...(a.own || [])])
    : proj.hasPipeline ? null : sessionIdsInLog(proj, slug);
  const sessions = sessionsIn(transcriptDir, only).filter((s) => !copies.has(s.id));
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
    if (ch.busy || ch.waits.size || ch.bg.size || await shellsRunning(ch.child.pid)) return chatIdle(ch);
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
  if (j.type === 'rate_limit_event') usageClaudeSave(j.rate_limit_info);
  if (j.session_id && j.session_id !== ch.session && !j.parent_tool_use_id) {
    ch.session = j.session_id;
    const a = loadChat(proj, slug);
    if (ch.fork && a.current && j.session_id !== a.current.id) {
      a.copies = [...new Set([...(a.copies || []), j.session_id])];
      a.current = { id: j.session_id, base: a.current.base, copy: true };
      a.fork = false;
      ch.fork = false;
    } else if (a.current) a.current.id = j.session_id;
    else if (a.root) a.current = { id: j.session_id, base: j.session_id, copy: false };
    if (a.root) a.own = [...new Set([...(a.own || []), j.session_id])];
    saveChat(proj, slug, a);
    chatMetaSave(ch);
    chatEmitState(proj, slug);
  }
  if (bgTrack(ch.bg, j)) chatEmitState(proj, slug);
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
  let a = loadChat(proj, slug);
  // the run made the worktree: the root chat's session stays in the repo root, so the chat moves on
  if (a.root && !rootChat(proj, slug, a)) { a = { ...a, root: false, current: null, fork: false }; saveChat(proj, slug, a); }
  const { wtPath, sessions } = planSessions(proj, slug);
  a = followVscodeCopy(proj, slug, a);
  // a root chat with no session yet starts a new one; chatOnLine records its id
  const id = a.current ? a.current.id : a.root ? null : (sessions.at(-1) || {}).id;
  if (!id && !a.root) return { error: 'This plan has no Claude session to continue yet.' };
  if (!a.current && id) a.current = { id, base: id, copy: false };
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
    ...(model ? ['--model', model] : []), ...(id ? ['--resume', id, ...(fork ? ['--fork-session'] : [])] : []),
    ...(rules.length ? ['--allowedTools', ...rules] : [])], wtPath);
  return chatAttach(proj, slug, child, { ...meta, metaFile, fresh: true });
};
// the chat's state around its claude. fresh: claude has just started; otherwise this is a
// reconnect after a restart, and the relay replays the turn running now through chatOnLine.
const chatAttach = (proj, slug, child, { session, fork, mode, model, metaFile, fresh }) => {
  const key = proj.name + '/' + slug, { wtPath } = planSessions(proj, slug);
  const ch = { key, proj, slug, child, metaFile, session, fork: !!fork, mode, model: model || 'default', busy: false,
    closing: false, turnsEnded: 0, partial: '', landing: [], landed: 0, waits: new Map(), pending: new Map(), bg: new Set(), err: '', last: null };
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
// a run is starting in this folder: the chat gives way (its transcript stays) and lets go of
// its pinned session, because a launch or resume starts a new session that reads the report.
// Kept pinned, the panel showed the session from before the resume and never the new one.
const chatEnd = (proj, slug) => {
  const ch = chats.get(proj.name + '/' + slug);
  if (ch) chatKill(ch);
  const a = loadChat(proj, slug);
  if (a.root || (!a.current && !a.fork)) return;   // a root chat moves on by itself in chatStart
  a.current = null; a.fork = false;
  saveChat(proj, slug, a);
};
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
    live: !!ch, busy: !!(ch && ch.busy), bg: ch ? ch.bg.size : 0, mode: ch ? ch.mode : null, model: ch ? ch.model : null,
    session: ch && ch.session ? ch.session : a.current ? a.current.id : latest,
    current: a.current || null, latest, fork: !!a.fork,
    waits: ch ? [...ch.waits].map(([id, r]) => waitView(id, r)) : [],
    partial: ch ? ch.partial : '', landing: ch ? ch.landing : [], last: ch ? ch.last : null, error: chatNotes.get(key) || '',
    context: chatContext(proj, slug, ch, a),
    idleFrom: chatIdleFrom(proj, slug),
    startedAt: chatStartedAt(proj, slug),
  };
};
// when the session began: the time of the first item in its transcript (a copy keeps its base's start)
const chatStartedAt = (proj, slug) => {
  const tr = chatTranscript(proj, slug);
  if (!tr) return null;
  try { return (readTranscript(tr.file, tr.wtPath).items.find((it) => it.at) || {}).at || null; } catch { return null; }
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
  // a request that is not a GET can change the state: clear the shared /api/state build before and after it
  const changes = req.method !== 'GET';
  if (changes) invalidateState();
  const url = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug');
  const pname = url.searchParams.get('project');
  const getProj = () => (safeName(pname) ? projByName(pname) : null);
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (url.pathname === '/api/scout' && req.method === 'GET') return json(res, 200, scoutStatus());
    if (url.pathname === '/api/usage') return json(res, 200, usageState());
    if (url.pathname === '/api/state') {
      const { n, body } = await buildStateBody();
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-State-Build': String(n) });
      return res.end(body);
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
    // the watcher's events of one project, oldest first: the last `limit` (default 200, max 1000)
    if (url.pathname === '/api/events') {
      const proj = getProj();
      if (!proj) return json(res, 400, { error: 'bad project' });
      let limit = parseInt(url.searchParams.get('limit') || '', 10);
      if (!(limit >= 1)) limit = 200;
      limit = Math.min(limit, 1000);
      const events = [];
      let t = '';
      try { t = readFileSync(eventsFile(proj), 'utf8'); } catch {}
      for (const line of t.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch {}
      }
      return json(res, 200, { events: events.slice(-limit) });
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
      const local = await localPrDiff(proj, n);
      if (local) return json(res, 200, local);
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
      const local = await localPrFile(proj, sha, file);
      if (local) return json(res, 200, local);
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
      if (url.pathname === '/api/bootstrap-upgrade') {
        if (!proj) return json(res, 400, { error: 'unknown project' });
        return json(res, 200, bootstrapUpgrade(proj));
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
      // the Code button in the page header: this dashboard's own repo
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
      // the VS Code button on a project header: the main checkout, not a plan's worktree
      if (url.pathname === '/api/vscode-project') {
        if (!proj) return json(res, 400, { error: 'bad project' });
        return json(res, 200, { ok: true, target: openInVsCode(proj) });
      }
      if (url.pathname === '/api/scout/run') return json(res, 200, scoutRun());
      if (url.pathname === '/api/scout/unmute') return json(res, 200, scoutUnmute(b));
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
      if (url.pathname === '/api/scout/confirm') return json(res, 200, await scoutConfirm(proj, b.slug));
      if (url.pathname === '/api/scout/dismiss') return json(res, 200, await scoutDismiss(proj, b.slug));
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
  } finally {
    if (changes) invalidateState();
  }
});

// ---------- page ----------

// The browser page lives in page/: page.html is the shell, app.css and app.js are inlined into it at
// startup, so the page stays one request. The server fills in the two values the page needs from it.
const UI_DIR = fileURLToPath(new URL('./page/', import.meta.url));
const uiFile = (f) => readFileSync(path.join(UI_DIR, f), 'utf8');
const fill = (s, mark, value) => s.split(mark).join(value); // split/join: no $-patterns as in String.replace
// The Shipyard icon (page/icon.svg, also the Mac app icon) as a data: URI, cut to its square: the 100 px margin of
// the macOS icon grid would only make the 16 px tab icon smaller.
const ICON_URI = 'data:image/svg+xml,' + encodeURIComponent(uiFile('icon.svg').replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"'));
const PAGE = fill(fill(fill(fill(fill(uiFile('page.html'),
  '<!--@CSS-->', uiFile('app.css')),
  '<!--@JS-->', uiFile('app.js')),
  '{{QA_PORT}}', String(QA_PORT)),
  '{{ICON}}', ICON_URI),
  '/*@CHAT_MODES*/[]', JSON.stringify(CHAT_MODES));

// Report pages of the browser-usability-test skill, read-only, so a chat link can open
// them: http://localhost:4898/<project>/<file>.html, and the list of all of them at /. A separate port is a separate
// origin: a report runs its own scripts, and the dashboard's crossSiteReason refuses
// its calls, while localStorage and the clipboard (localhost is secure) still work.
const htmlText = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// QA_ICON (the skill's qa-icon.svg, a clipboard with a check mark) is the tab icon of the list, and /favicon.ico
// gives it to reports written before they had an icon of their own.
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
<title>QA reports</title><link rel="icon" href="${QA_ICON_URI}"><style>
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
// a bar at the top right of every page served here: Copy HTML, Copy file, Download, and a version menu
// on a page with older versions (scripts/page-versions.mjs). ?download gives the file as saved, without
// the bar; Copy HTML puts that same file on the clipboard as text (for a Claude chat), Copy file puts
// the file itself there (POST /copy-file), so Cmd+V attaches it in a chat that limits pasted text (Teams)
const QA_BAR_ITEM = 'all:initial;display:block;box-sizing:border-box;font:500 12.5px system-ui,-apple-system,sans-serif;color:#eceff4;background:rgb(46,52,64);border:1px solid #4c566a;border-radius:6px;padding:5px 11px;cursor:pointer;white-space:nowrap';
const QA_BAR_STYLE = `<style>#qa-bar{all:initial;position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:calc(100vw - 20px)}
#qa-dl,#qa-cp,#qa-cf,#qa-old,#qa-ver>summary,#qa-ver a{${QA_BAR_ITEM}}#qa-dl,#qa-cp,#qa-cf,#qa-ver>summary{opacity:.75}
#qa-old{background:#b35c00;color:#fff;border-color:#b35c00;text-decoration:underline}
#qa-ver{all:initial;display:block;position:relative;z-index:1}#qa-ver>div{all:initial;display:block;position:absolute;top:calc(100% + 4px);right:0;max-height:60vh;overflow:auto}
#qa-ver a{border-radius:0;margin-top:-1px}#qa-ver a[aria-current]{background:#434c5e;font-weight:700}
#qa-dl:hover,#qa-dl:focus-visible,#qa-cp:hover,#qa-cp:focus-visible,#qa-cf:hover,#qa-cf:focus-visible,#qa-ver>summary:hover,#qa-ver>summary:focus-visible,#qa-ver[open]>summary{opacity:1}
#qa-dl:hover,#qa-dl:focus-visible,#qa-cp:hover,#qa-cp:focus-visible,#qa-cf:hover,#qa-cf:focus-visible,#qa-old:focus-visible,#qa-ver>summary:focus-visible,#qa-ver a:hover,#qa-ver a:focus-visible{outline:2px solid #88c0d0;outline-offset:-2px}@media print{#qa-bar{display:none}}</style>`;
// versions: [{ n, mtime, latest, href, current }], newest first; one entry means no menu
const qaBar = (versions) => {
  const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const current = versions.find((v) => v.current), latest = versions[0];
  const old = current && !current.latest;
  const menu = versions.length > 1 ? `<details id="qa-ver"><summary aria-label="Versions of this page">v${current.n}${current.latest ? ' (latest)' : ''} ▾</summary><div>
${versions.map((v) => `<a href="${escH(v.href)}"${v.current ? ' aria-current="page"' : ''}>v${v.n}${v.latest ? ' (latest)' : ''} · ${escH(when(v.mtime))}</a>`).join('\n')}</div></details>` : '';
  return `${QA_BAR_STYLE}<div id="qa-bar">${old ? `<a id="qa-old" href="${escH(latest.href)}">Old version from ${escH(when(current.mtime))}. Go to latest</a>` : ''}${menu}
<button id="qa-cp" type="button" title="Copy this page's HTML as text, to paste into a Claude chat">⧉ Copy HTML</button>
<button id="qa-cf" type="button" title="Copy this page as a file, to paste as an attachment (Teams, Slack, email)">📎 Copy file</button>
<a id="qa-dl" href="?${old ? `v=${current.n}&amp;` : ''}download" download title="Download this page as one HTML file">⬇ Download</a></div>
<script>(() => {
  const b = document.getElementById('qa-cp'), f = document.getElementById('qa-cf'), src = document.getElementById('qa-dl').href;
  [b, f].forEach((el) => { el.dataset.label = el.textContent; });
  const show = (t, el = b) => { el.textContent = t; setTimeout(() => { el.textContent = el.dataset.label; }, 1500); };
  f.addEventListener('click', async () => {
    const r = await fetch('/copy-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ href: src }) }).catch(() => null);
    show(r && r.ok ? 'Copied, paste with ⌘V' : 'Copy failed', f);
  });
  b.addEventListener('click', async () => {
    const text = () => fetch(src, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
    try {
      // a ClipboardItem holding a promise keeps the click's permission while the file loads (Safari needs this)
      if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text().then((t) => new Blob([t], { type: 'text/plain' })) })]);
      else await navigator.clipboard.writeText(await text());
      show('Copied');
    } catch { show('Copy failed'); }
  });
})();</script>`;
};
const sendPage = (req, res, html, name, versions = []) => {
  const dl = new URL(req.url, 'http://x').searchParams.has('download');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    ...(dl && { 'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"` }) });
  if (dl) return res.end(html);
  const s = String(html), at = s.lastIndexOf('</body>'), bar = qaBar(versions);
  res.end(at < 0 ? s + bar : s.slice(0, at) + bar + s.slice(at));
};
// what ?download gives for a page link (with ?v=<n>, that older version): { html, name } or null
const pageDownload = (pathname, v) => {
  const pg = qaPageFile(pathname);
  if (!pg || !existsSync(pg.file)) return null;
  // a draft's images sit next to it: packed in, so a download is one file
  if (pg.kind === 'draft') return { html: inlineHtml(readFileSync(pg.file, 'utf8'), path.dirname(pg.file), { page: pg.file }), name: path.basename(pg.file) };
  if (!v) return { html: readFileSync(pg.file), name: pg.name };
  const old = olderVersions(pg.file).find((o) => String(o.n) === v);
  return old ? { html: readFileSync(old.path), name: pg.name.replace(/\.html$/, `-v${old.n}.html`) } : null;
};
// Copy file: the download is written to a temp folder and that file is put on the macOS clipboard
// the way Finder's Copy does (a file URL), so pasting attaches it. Teams reads it on paste, so it stays
const COPY_DIR = path.join(os.tmpdir(), 'qa-copy-file');
const CLIPBOARD_FILE_JXA = `function run(argv) { ObjC.import('AppKit'); const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents; if (!pb.writeObjects($([$.NSURL.fileURLWithPath(argv[0])]))) throw new Error('clipboard refused'); }`;
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
  // Copy file: from a page's own bar, for a page this server lists
  if (pathname === '/copy-file' && req.method === 'POST') {
    const why = crossSiteReason(req);
    if (why) { res.writeHead(403); return res.end(why); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    return req.on('end', () => {
      let dl = null;
      try { const u = new URL(JSON.parse(body).href, 'http://x'); dl = pageDownload(u.pathname, u.searchParams.get('v')); } catch {}
      if (!dl) { res.writeHead(404); return res.end('page not found'); }
      const file = path.join(COPY_DIR, dl.name.replace(/[^A-Za-z0-9._-]/g, '_'));
      try { mkdirSync(COPY_DIR, { recursive: true }); writeFileSync(file, dl.html); }
      catch { res.writeHead(500); return res.end('could not write the file'); }
      execFile('osascript', ['-l', 'JavaScript', '-e', CLIPBOARD_FILE_JXA, file], (err) => { res.writeHead(err ? 500 : 204); res.end(); });
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

// Caddy keeps an idle connection to the dashboard open for 2 minutes, but Node closes it
// after 5 seconds. When Caddy sends a request on a connection that Node just closed, the
// request gets "connection reset" and Caddy answers 502 (it does not retry a POST). Keep
// idle connections open longer than Caddy does, so Caddy always closes them first.
server.keepAliveTimeout = 130_000;
server.headersTimeout = 131_000;

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
  startWatcher();
  // the domain setup-macos.sh gave Caddy, else the local port
  const sfx = PORT === 80 ? '' : `:${PORT}`;
  const n = allProjects().length;
  console.log(`Plans dashboard → ${dashUrl()}  (also http://127.0.0.1${sfx})`);
  console.log(`${n} project${n === 1 ? '' : 's'} from ${REG_FILE}`);
  if (!n) console.log(`No projects registered yet — create ${REG_FILE} (see header of this file).`);
  if (NO_SUMMARY) console.log('DASH_NO_SUMMARY=1 — plan summaries are off.');
  enqueueMissingSummaries();
  if (process.platform === 'darwin' && !process.env.DASH_NO_OPEN)
    spawn('open', [url], { stdio: 'ignore' }).unref();
});
