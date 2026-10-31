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
import {
  readFileSync, readdirSync, existsSync, openSync, mkdirSync, unlinkSync,
  writeFileSync, renameSync, statSync, closeSync,
} from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const HOME = os.homedir();
const REG_FILE = path.join(HOME, '.claude', 'pipeline-projects.json');
const CENTRAL = path.join(HOME, '.claude', 'pipeline-dashboard');
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
    launchers: Array.isArray(p.launchers) ? p.launchers : [],
    hasPipeline: existsSync(launcherScript), launcherScript,
    hasLanes: existsSync(path.join(root, '.claude/scripts/plan-lanes.mjs')),
    worktrees: path.join(path.dirname(root), 'worktrees'),
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
  /^(VERIFIED|REVIEWED|COMMITTED|FINISHED)/i.test(status) ? 'needs-you'
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
  return { ...r, status, lastEvent: timeline.at(-1) || '', outcome: r.outcome || outcomeOf(status) };
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
const pipelineLive = (proj, slug) =>
  new Promise((resolve) => {
    execFile('pgrep', ['-f', `skill-auto-pipeline ${slug}.md`], (err) =>
      // the Ask tab's own claude runs there too, and asking is not running the plan
      resolve(!err || (!askRuns.has(proj.name + '/' + slug) && chatActiveIn(path.join(proj.worktrees, slug)))));
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
  const active = await Promise.all(
    planFiles(proj).map(async (f) => {
      const slug = f.replace(/\.md$/, '');
      const key = proj.name + '/' + slug;
      const content = readFileSync(path.join(proj.plansDir, f), 'utf8');
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
        worktree: proj.hasPipeline && existsSync(path.join(proj.worktrees, slug)),
        status: meta[slug]?.status || null,
        tags: meta[slug]?.tags || [],
        ...planSessions(proj, slug),
        asked: existsSync(askLogFile(proj, slug)),
        asking: askRuns.has(proj.name + '/' + slug),
        pr: prs['auto/' + slug] || null,
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
      try { title = planTitle(readFileSync(path.join(proj.doneDir, slug + '.md'), 'utf8')) || slug; } catch {}
      return {
        slug, file: slug + '.md', key: proj.name + '/' + slug, title,
        summary: summaries[slug] || null, summarizing: false,
        validations: validationRounds(proj, slug),
        run: null, live: false, worktree: false, archived: true,
        status: meta[slug]?.status || null, tags: meta[slug]?.tags || [],
        ...planSessions(proj, slug),
        asked: existsSync(askLogFile(proj, slug)),
        asking: askRuns.has(proj.name + '/' + slug),
        pr: prs['auto/' + slug] || null,
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
      hasPipeline: proj.hasPipeline, hasLanes: proj.hasLanes,
      modes: pipelineModes(proj).map(({ flag, ...m }) => m),
      launchers: proj.launchers, issuesUrl: proj.issuesUrl,
      // only a repo on GitHub can have PRs, so only there is a gh failure worth saying
      prError: proj.issuesUrl ? (prLists[proj.root] || {}).error || '' : '',
      setupLevel: projectHealth(proj.root, entry).level,
      plans: await listPlans(proj),
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
  for (const k of keys) launches.set(k, { state: 'starting', at: Date.now() });
  const child = spawn('bash', [proj.launcherScript, ...args], {
    cwd: proj.root, env: ENV, detached: true, stdio: ['ignore', fd, fd],
  });
  closeSync(fd); // the child holds its own copy
  child.on('exit', (code) => {
    if (code === 0) { for (const k of keys) launches.delete(k); return; }
    // the launcher stopped early: keep what it printed, so the list can say why
    let output = '';
    try { output = readFileSync(logFile, 'utf8').slice(from).trim().split('\n').slice(-20).join('\n'); } catch {}
    for (const k of keys)
      launches.set(k, { state: 'failed', at: Date.now(), output: output || 'launcher exited with code ' + code });
  });
  child.unref();
};
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
const openInVsCode = (proj, slug) => {
  const wt = path.join(proj.worktrees, slug);
  const target = proj.hasPipeline && existsSync(wt) ? wt : proj.root;
  execFile('code', [target], { env: ENV }, (err) => {
    if (err) execFile('open', ['-a', 'Visual Studio Code', target], () => {});
  });
  return target;
};
const archivePlan = async (proj, slug) => {
  const live = proj.hasPipeline ? await pipelineLive(proj, slug) : genericRunInfo(proj, slug).live;
  if (live) return { ok: false, output: 'A session for this plan is still running.' };
  if (proj.hasPipeline && existsSync(path.join(proj.worktrees, slug)))
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
const ghProblem = (out) => /ENOENT/.test(out) ? 'gh is not installed'
  : /auth login|not logged/i.test(out) ? 'gh is not logged in' : out.split('\n')[0].slice(0, 160);
const refreshPrList = (proj) => {
  const c = prLists[proj.root] = prLists[proj.root] || { at: 0, byBranch: {} };
  if (c.loading) return c.loading;
  return c.loading = gh(proj, ['pr', 'list', '--state', 'all', '--limit', '200',
    '--json', 'number,headRefName,headRefOid,isDraft,state,title,url,changedFiles,baseRefName,mergedAt']).then((r) => {
    const byBranch = {};
    if (r.ok) try {
      for (const p of JSON.parse(r.out))   // newest first: keep the first PR per branch
        if (p.headRefName.startsWith('auto/') && !byBranch[p.headRefName])
          byBranch[p.headRefName] = { number: p.number, state: p.state, isDraft: p.isDraft, title: p.title,
            url: p.url, head: p.headRefOid, changedFiles: p.changedFiles, base: p.baseRefName, mergedAt: p.mergedAt || null };
    } catch {}
    Object.assign(c, { at: Date.now(), byBranch: r.ok ? byBranch : c.byBranch, loading: null,
      error: r.ok ? '' : ghProblem(r.output) });
  });
};
const prsFor = (proj) => {
  const c = prLists[proj.root];
  if (!c || Date.now() - c.at > PR_TTL) refreshPrList(proj);
  return (c && c.byBranch) || {};
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
    return 'Not pulled: ' + where + ' is on ' + br.out + ', not ' + (base || 'the base branch') + '.';
  const r = await gitIn(proj.root, ['pull', '--ff-only']);
  if (!r.ok) return 'Not pulled: git pull --ff-only failed in ' + where + ': ' + r.err.split('\n').slice(-2).join(' ');
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
  return { ok: true, pr: { ...rest, commits: (commits || []).length, checks, merge: await mergeSettings(proj) } };
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
const prAction = async (proj, b) => {
  const n = String(b.number);
  if (!/^\d{1,7}$/.test(n)) return { ok: false, output: 'Bad PR number.' };
  delete prLists[proj.root];   // the list chip should change on the next poll, not in a minute
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

// ---------- ask: talk to a plan's Claude session from the browser ----------
// The Ask tab resumes the plan's latest run session (`claude -p --resume`) in the
// plan's own folder: claude finds a transcript by its cwd. With "ask in a copy" the
// first question forks it (--fork-session) and the chat goes on in the copy, so the
// run's own transcript keeps only what the run did. A headless session cannot ask for
// permission: a refused call comes back in the result's permission_denials, and the
// tab offers to allow exactly that call for the rest of the chat and ask again.
const askRuns = new Map();   // plan key -> the claude answering now
const askFile = (proj, slug) => path.join(proj.stateDir, 'ask', slug + '.json');
const askLogFile = (proj, slug) => path.join(proj.logsDir, slug + '.ask.log');
const loadAsk = (proj, slug) => {
  try { return JSON.parse(readFileSync(askFile(proj, slug), 'utf8')); } catch { return {}; }
};
const saveAsk = (proj, slug, a) => {
  mkdirSync(path.dirname(askFile(proj, slug)), { recursive: true });
  writeFileSync(askFile(proj, slug), JSON.stringify(a, null, 2));
};
// the sessions a plan's runs made; the Ask tab's copies are its own and not listed
const planSessions = (proj, slug) => {
  const wtPath = proj.hasPipeline ? path.join(proj.worktrees, slug) : proj.root;
  const transcriptDir = transcriptDirFor(wtPath);
  const copies = new Set(loadAsk(proj, slug).copies || []);
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
// one refused call -> the rules that allow just that call. claude checks each part of
// `a && b` on its own, so a shell command gets a rule per part.
const rulesFor = (d) => {
  const i = d.tool_input || {};
  if (d.tool_name === 'Bash') {
    const cmd = String(i.command || '').trim();
    return [...new Set([cmd, ...cmd.split(/\s*(?:&&|\|\||;|\|)\s*/)].filter(Boolean))].map((c) => 'Bash(' + c + ')');
  }
  if (typeof i.file_path === 'string' && i.file_path.startsWith('/')) return [d.tool_name + '(/' + i.file_path + ')'];
  return [d.tool_name];
};
const askStart = async (proj, slug, b) => {
  const key = proj.name + '/' + slug;
  const q = String(b.text || '').trim().slice(0, 20000);
  if (!q) return { ok: false, output: 'Type a question first.' };
  if (askRuns.has(key)) return { ok: false, output: 'The agent is still answering.' };
  const { wtPath, sessions } = planSessions(proj, slug);
  if (!existsSync(wtPath)) return { ok: false, output: 'The folder ' + tilde(wtPath) + ' is gone, so the session cannot run there.' };
  if (existsSync(path.join(proj.plansDir, slug + '.md'))
    && (proj.hasPipeline ? await pipelineLive(proj, slug) : genericRunInfo(proj, slug).live))
    return { ok: false, output: 'A run or chat is working in this plan right now. Ask when it has stopped.' };
  const a = loadAsk(proj, slug);
  if (b.fresh) a.current = null;
  // allow: only what the agent was refused last time
  const offered = new Set((a.denied || []).flatMap(rulesFor));
  const allow = (Array.isArray(b.allow) ? b.allow : []).filter((r) => offered.has(r));
  const fresh = !a.current;
  let resume;
  if (a.current) {
    resume = ['--resume', a.current.id];
    a.current.allowed = [...new Set([...(a.current.allowed || []), ...allow])];
  } else {
    const base = sessions[sessions.length - 1];
    if (!base) return { ok: false, output: 'This plan has no Claude session to ask yet.' };
    resume = ['--resume', base.id, ...(b.copy ? ['--fork-session'] : [])];
    a.current = { id: base.id, base: base.id, copy: !!b.copy, allowed: [] };
  }
  a.denied = [];
  saveAsk(proj, slug, a);
  const rules = [...new Set([...repoAllowRules([wtPath, proj.root]), ...a.current.allowed])];
  mkdirSync(proj.logsDir, { recursive: true });
  const logF = askLogFile(proj, slug);
  writeFileSync(logF, JSON.stringify({ type: 'ask', text: q, at: new Date().toISOString(), fresh,
    copy: a.current.copy, session: a.current.base, allowed: allow.length ? allow : undefined }) + '\n', { flag: 'a' });
  const fd = openSync(logF, 'a');
  // the question goes in on stdin: --allowedTools takes every word after it
  const child = spawn('claude', ['-p', ...resume, '--permission-mode', 'acceptEdits',
    '--verbose', '--output-format', 'stream-json', ...(rules.length ? ['--allowedTools', ...rules] : [])],
  { cwd: wtPath, env: ENV, stdio: ['pipe', fd, fd] });
  closeSync(fd);
  askRuns.set(key, child);
  child.stdin.on('error', () => {});
  child.stdin.end(q);
  const done = (code) => {
    if (askRuns.get(key) !== child) return;
    askRuns.delete(key);
    let result = null;
    try {
      const lines = readFileSync(logF, 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0 && !lines[i].includes('"type":"ask"'); i--)
        if (lines[i].includes('"type":"result"')) { try { result = JSON.parse(lines[i]); } catch {} break; }
    } catch {}
    const s = loadAsk(proj, slug);
    if (result && s.current) {
      if (s.current.copy && result.session_id && result.session_id !== s.current.base)
        s.copies = [...new Set([...(s.copies || []), result.session_id])];
      if (result.session_id) s.current.id = result.session_id;
      s.denied = result.permission_denials || [];
    }
    saveAsk(proj, slug, s);
    writeFileSync(logF, JSON.stringify({ type: 'ask-end', code, at: new Date().toISOString() }) + '\n', { flag: 'a' });
  };
  child.on('exit', done);
  child.on('error', (e) => {
    writeFileSync(logF, 'Could not start claude: ' + e.message + '\n', { flag: 'a' });
    done(-1);
  });
  return { ok: true };
};
const askStop = (proj, slug) => {
  const c = askRuns.get(proj.name + '/' + slug);
  if (c) c.kill('SIGINT');
  return { ok: true };
};
// the chat as the tab shows it: questions, answer text, one line per tool call, outcomes
const askState = (proj, slug) => {
  const items = [];
  let raw = '';
  try { raw = readFileSync(askLogFile(proj, slug), 'utf8'); } catch {}
  for (const line of raw.split('\n').slice(-4000)) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { items.push({ who: 'err', text: line.slice(0, 500) }); continue; }
    if (j.type === 'ask') items.push({ who: 'you', text: j.text, at: j.at, allowed: j.allowed,
      fresh: j.fresh, copy: j.copy, session: j.session });
    else if (j.type === 'assistant')
      for (const c of j.message?.content || []) {
        if (c.type === 'text' && c.text?.trim()) items.push({ who: 'agent', text: c.text.trim() });
        if (c.type === 'tool_use') {
          const i = c.input || {};
          const arg = i.command || i.file_path || i.path || i.pattern || i.url || i.description || '';
          items.push({ who: 'tool', text: c.name + '  ' + String(arg).replace(/\s+/g, ' ').slice(0, 200) });
        }
      }
    else if (j.type === 'result')
      items.push({ who: 'end', ok: !j.is_error && j.subtype === 'success', subtype: j.subtype,
        cost: j.total_cost_usd, blocked: (j.permission_denials || []).length });
    else if (j.type === 'ask-end' && items.length && items[items.length - 1].who !== 'end')
      items.push({ who: 'end', ok: j.code === 0, subtype: j.code === 0 ? 'success' : 'stopped (exit ' + j.code + ')' });
  }
  const a = loadAsk(proj, slug);
  const running = askRuns.has(proj.name + '/' + slug);
  return {
    running, items, current: a.current || null,
    denied: running ? [] : (a.denied || []).map((d) => ({
      tool: d.tool_name, what: String(d.tool_input?.command || d.tool_input?.file_path || d.tool_input?.url || ''),
      rules: rulesFor(d),
    })),
  };
};

// ---------- http ----------

// render stream-json session output as a human-readable activity feed
const prettyLog = (raw) => raw.split('\n').filter((l) => l.trim()).map((line) => {
  if (!line.startsWith('{')) return line;
  try {
    const j = JSON.parse(line);
    if (j.type === 'system' && j.subtype === 'init')
      return '⚙️  session started — model ' + (j.model || '?');
    if (j.type === 'assistant') {
      const out = [];
      for (const c of j.message?.content || []) {
        if (c.type === 'text' && c.text?.trim()) out.push('🤖 ' + c.text.trim());
        if (c.type === 'tool_use') {
          const i = c.input || {};
          const arg = i.command || i.file_path || i.path || i.pattern || i.skill || i.description || '';
          out.push('🔧 ' + c.name + '  ' + String(arg).replace(/\s+/g, ' ').slice(0, 170));
        }
      }
      return out.join('\n');
    }
    if (j.type === 'user') {
      const out = [];
      for (const c of j.message?.content || []) {
        if (c.type === 'tool_result') {
          let t = typeof c.content === 'string' ? c.content
            : (c.content || []).map((x) => x.text || '').join(' ');
          t = String(t).replace(/\s+/g, ' ').trim();
          if (t) out.push('   ↳ ' + t.slice(0, 220));
        }
      }
      return out.join('\n');
    }
    if (j.type === 'result')
      return '🏁 ' + (j.subtype || 'done') + (j.result ? '\n\n' + String(j.result).slice(0, 4000) : '');
    return '';
  } catch { return line; }
}).filter(Boolean).join('\n');

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
      return execFile(process.execPath, [path.join(proj.root, '.claude/scripts/plan-lanes.mjs'), '--json'],
        { cwd: proj.root, env: ENV, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
          if (err) return json(res, 500, { error: String(err) });
          try { json(res, 200, JSON.parse(stdout)); }
          catch { json(res, 500, { error: 'analyzer returned invalid JSON' }); }
        });
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
      const f = proj.hasPipeline
        ? path.join(proj.autoRunsDir, slug + '.log')
        : path.join(proj.logsDir, slug + '.log');
      const raw = existsSync(f)
        ? readFileSync(f, 'utf8').split('\n').slice(-800).join('\n') : '';
      return text(res, raw.trim() ? prettyLog(raw) : 'No output yet.');
    }
    if (url.pathname === '/api/report') {
      const proj = getProj();
      if (!proj || !safeName(slug)) return json(res, 400, { error: 'bad request' });
      const f = path.join(proj.autoRunsDir, slug + '.md');
      return text(res, existsSync(f) ? readFileSync(f, 'utf8') : '(no report yet)');
    }
    if (url.pathname === '/api/ask' && req.method === 'GET') {
      const proj = getProj();
      if (!proj || !safeName(slug)) return json(res, 400, { error: 'bad request' });
      return json(res, 200, askState(proj, slug));
    }
    if (url.pathname === '/api/pr' || url.pathname === '/api/pr-diff') {
      const proj = getProj();
      const n = url.searchParams.get('number') || '';
      if (!proj || !/^\d{1,7}$/.test(n)) return json(res, 400, { error: 'bad request' });
      if (url.pathname === '/api/pr') return json(res, 200, await prDetail(proj, n));
      const r = await gh(proj, ['pr', 'diff', n]);
      return json(res, 200, r.ok ? { ok: true, diff: r.out } : r);
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
      if (url.pathname === '/api/launchers') {
        if (!proj) return json(res, 400, { error: 'bad project' });
        return json(res, 200, saveLaunchers(proj.name, Array.isArray(b.launchers) ? b.launchers : []));
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
      if (url.pathname === '/api/ask') return json(res, 200, await askStart(proj, b.slug, b));
      if (url.pathname === '/api/ask-stop') return json(res, 200, askStop(proj, b.slug));
      // ⟳ in the PR bar: read the PR list now, not at the next minute (a push changes the head)
      if (url.pathname === '/api/pr-refresh') { await refreshPrList(proj); return json(res, 200, { ok: true }); }
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

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Plans</title>
<link rel="icon" id="favicon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ctext%20x%3D%2232%22%20y%3D%2246%22%20font-size%3D%2256%22%20text-anchor%3D%22middle%22%3E%F0%9F%98%B4%3C%2Ftext%3E%3C%2Fsvg%3E">
<style>
  /* dark = Nord (nordtheme.com); --bg, --input, --codebg, --dim are in-between shades Nord lacks */
  :root { --bg:#292e39; --panel:#2e3440; --card:#3b4252; --line:#434c5e; --fg:#eceff4;
          --dim:#a5afc0; --ok:#a3be8c; --run:#81a1c1; --warn:#ebcb8b; --bad:#bf616a;
          --accent:#88c0d0; --accentfg:#2e3440; --link:#88c0d0; --input:#272c36; --hover:#3b4252; --sel:#434c5e;
          --btn:#3b4252; --dot:#4c566a; --codebg:#272c36; --codechip:#3b4252; --thbg:#3b4252;
          --logfg:#d8dee9; --stfg:#88c0d0; --addbg:#36453c; --delbg:#4a363c;
          --gitM:#8ec8ff; --gitA:#84d6a0; --gitD:#ffa69c; --merge:#c9a6c2; --mergefg:#1b1e25; }
  :root[data-theme="light"] { --bg:#f4f5f8; --panel:#ffffff; --card:#ffffff; --line:#d9dde6;
          --fg:#1d2433; --dim:#5f6b81; --ok:#15803d; --run:#2563eb; --warn:#b45309; --bad:#dc2626;
          --accent:#7c3aed; --accentfg:#fff; --link:#1d4ed8; --input:#f0f2f7; --hover:#eef1f7; --sel:#e3e7f5;
          --btn:#eef0f6; --dot:#c3c9d8; --codebg:#f6f7fa; --codechip:#e8eaf2; --thbg:#eaedf5;
          --logfg:#333c50; --stfg:#6d28d9; --addbg:#e3f5e8; --delbg:#fde6e8;
          --gitM:#0969da; --gitA:#1a7f37; --gitD:#cf222e; --merge:#8250df; --mergefg:#fff; }
  /* --fs scales text and reading widths up on wide screens, where fixed px text gets tiny */
  :root { --fs:1; }
  @media (min-width:1800px) { :root { --fs:1.08; } }
  @media (min-width:2200px) { :root { --fs:1.18; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); height:100vh; display:flex;
         flex-direction:column; font:calc(14px * var(--fs))/1.55 -apple-system,"Segoe UI",sans-serif; }
  header { padding:11px 20px; border-bottom:1px solid var(--line); display:flex;
           align-items:center; gap:14px; flex-shrink:0; }
  h1 { font-size:calc(15px * var(--fs)); margin:0; }
  .wrap { flex:1; display:flex; min-height:0; }
  aside { width:calc(400px * var(--fs)); border-right:1px solid var(--line); background:var(--panel);
          flex-shrink:0; display:flex; flex-direction:column; }
  .filters { padding:10px 12px; display:flex; gap:8px; align-items:center; border-bottom:1px solid var(--line); }
  .filters button { font-size:calc(12px * var(--fs)); }
  .filters input { background:var(--input); color:var(--fg); border:1px solid var(--line);
          border-radius:8px; padding:6px 10px; font-size:calc(13px * var(--fs)); }
  .filters input { flex:1; min-width:0; }
  .filters button { padding:5px 9px; flex-shrink:0; }
  .items { flex:1; overflow-y:auto; }
  .ghead { padding:12px 13px 5px; font-size:calc(11px * var(--fs)); letter-spacing:.14em; font-weight:800;
           color:var(--accent); text-transform:uppercase;
           border-top:3px solid var(--accent); background:var(--card); }
  .ghead:first-child { border-top:0; }
  .phead { padding:7px 13px; font:600 calc(12px * var(--fs))/1.4 ui-monospace,monospace; color:var(--fg);
           border-top:2px solid var(--line); border-bottom:1px solid var(--line);
           background:var(--thbg); display:flex; align-items:center; gap:8px;
           cursor:pointer; user-select:none; position:sticky; top:0; z-index:2; }
  .phead:hover { background:var(--hover); }
  .phead .cnt { font-weight:400; margin-left:auto; color:var(--dim); }
  .phead .chev { color:var(--dim); width:13px; flex-shrink:0; }
  .phead .pbtn { padding:1px 8px; font-size:calc(11px * var(--fs)); border-radius:7px; flex-shrink:0; }
  .item { padding:10px 13px; border-bottom:1px solid var(--line); cursor:pointer;
          display:flex; gap:10px; }
  .item:hover { background:var(--hover); }
  .item.sel { background:var(--sel); }
  .item input { transform:scale(1.15); flex-shrink:0; margin-top:3px; }
  .item .t { flex:1; min-width:0; }
  .item .name { font:600 calc(12px * var(--fs))/1.4 ui-monospace,monospace; word-break:break-all; }
  .item.arch .name { color:var(--dim); }
  .chiprow { display:flex; gap:4px; flex-wrap:wrap; margin-top:5px; align-items:center; }
  .chip { font-size:calc(10px * var(--fs)); padding:1px 7px; border-radius:99px; border:1px solid var(--line);
          color:var(--dim); white-space:nowrap; }
  .chip.st { border-color:var(--accent); color:var(--stfg); }
  .chip.live { color:var(--run); border-color:var(--run); }
  .chip.ok { color:var(--ok); border-color:var(--ok); }
  .chip.warn { color:var(--warn); border-color:var(--warn); }
  .chip.bad { color:var(--bad); border-color:var(--bad); }
  .chip.merged { background:var(--merge); border-color:var(--merge); color:var(--mergefg); font-weight:600; }
  .mergedline { display:flex; align-items:center; gap:8px; margin:10px 0 0; padding:8px 12px; border-radius:10px;
                border:1px solid var(--merge); background:color-mix(in srgb, var(--merge) 14%, transparent); }
  .mergedline a { margin-left:auto; color:var(--link); text-decoration:none; white-space:nowrap; }
  .chip.x { cursor:pointer; } .chip.x:hover { border-color:var(--bad); color:var(--bad); }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--dot); flex-shrink:0; margin-top:5px; }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.3 } }
  .dot.live { background:var(--run); box-shadow:0 0 7px var(--run); animation:pulse 1.5s ease-in-out infinite; }
  .item.live { border-left:3px solid var(--run); background:color-mix(in srgb, var(--run) 8%, transparent); }
  .item.bad { border-left:3px solid var(--bad); }
  .item.ok { border-left:3px solid var(--ok); background:color-mix(in srgb, var(--ok) 6%, transparent); }
  .runstrip { padding:8px 12px 10px; border-bottom:2px solid var(--line); display:none; }
  .runstrip.on { display:block; }
  .runstrip .cap { font-size:calc(10px * var(--fs)); letter-spacing:.12em; color:var(--run); font-weight:700; margin-bottom:4px; }
  .runstrip .rp { display:flex; flex-wrap:wrap; align-items:center; gap:9px; padding:7px 10px; border:1px solid var(--run);
                  border-radius:9px; margin:4px 0; cursor:pointer; background:color-mix(in srgb, var(--run) 12%, transparent); }
  .runstrip .rp:hover { background:color-mix(in srgb, var(--run) 22%, transparent); }
  .runstrip .rp .n { font:600 calc(12px * var(--fs))/1.4 ui-monospace,monospace; word-break:break-all; flex:1 1 170px; min-width:0; }
  .runstrip .rp .n .rst { display:block; font:400 calc(11px * var(--fs))/1.4 system-ui,sans-serif; color:var(--dim);
    word-break:normal; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .runstrip .rp .n .pfx { color:var(--dim); font-weight:400; }
  .runstrip .rp .mini { padding:3px 9px; font-size:calc(11px * var(--fs)); flex-shrink:0; }
  .runstrip .rp .acts { display:flex; gap:6px; margin-left:auto; }
  .runstrip .cap.okc { color:var(--ok); margin-top:8px; }
  .runstrip .rp.okp { border-color:var(--ok); background:color-mix(in srgb, var(--ok) 10%, transparent); }
  .runstrip .rp.okp:hover { background:color-mix(in srgb, var(--ok) 20%, transparent); }
  .runstrip .cap.wc { color:var(--warn); margin-top:8px; }
  .runstrip .rp.wp { border-color:var(--warn); background:color-mix(in srgb, var(--warn) 10%, transparent); }
  .runstrip .rp.wp:hover { background:color-mix(in srgb, var(--warn) 18%, transparent); }
  .runstrip .cap.bc { color:var(--bad); margin-top:8px; }
  .runstrip .cap:first-child { margin-top:0; }
  .runstrip .rp.bp { border-color:var(--bad); background:color-mix(in srgb, var(--bad) 10%, transparent); }
  .runstrip .rp.bp:hover { background:color-mix(in srgb, var(--bad) 18%, transparent); }
  .hdok { font-size:calc(12px * var(--fs)); color:var(--ok); border:1px solid var(--ok); border-radius:99px;
          padding:2px 11px; font-weight:600; }
  .hdrun { font-size:calc(12px * var(--fs)); color:var(--run); border:1px solid var(--run); border-radius:99px;
           padding:2px 11px; font-weight:600; }
  .dot.ok { background:var(--ok); } .dot.bad { background:var(--bad); } .dot.warn { background:var(--warn); }
  section { flex:1; overflow-y:auto; padding:22px 30px 60px; }
  .crumb { font-size:calc(12px * var(--fs)); color:var(--dim); margin-bottom:4px; }
  h2.fname { margin:0; font:600 calc(17px * var(--fs))/1.4 ui-monospace,monospace; word-break:break-all; }
  .subtitle { color:var(--dim); margin:4px 0 0; }
  .badges { display:flex; gap:6px; margin:12px 0; flex-wrap:wrap; }
  .summary { padding:10px 13px; background:var(--card); border:1px solid var(--line);
             border-radius:10px; margin:12px 0; max-width:calc(820px * var(--fs)); font-size:calc(13px * var(--fs)); line-height:1.55; }
  .metabox, .modes { display:flex; gap:9px; margin:8px 0; padding:6px 11px; background:var(--card);
           border:1px solid var(--line); border-radius:9px; align-items:center; flex-wrap:wrap;
           max-width:calc(820px * var(--fs)); font-size:calc(12px * var(--fs)); }
  .metabox select, .metabox input { background:var(--input); color:var(--fg); border:1px solid var(--line);
           border-radius:6px; padding:3px 7px; font-size:calc(12px * var(--fs)); }
  .metabox button, .modes button { padding:4px 9px; font-size:calc(12px * var(--fs)); border-radius:6px; }
  .modes label { display:flex; gap:5px; align-items:center; color:var(--dim); cursor:pointer; }
  .modes input[type=radio] { margin:0; }
  .btns { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
  button { background:var(--btn); color:var(--fg); border:1px solid var(--line); border-radius:8px;
           padding:7px 13px; cursor:pointer; font-size:calc(13px * var(--fs)); }
  button:hover { border-color:var(--accent); }
  button.primary { background:var(--accent); border-color:var(--accent); color:var(--accentfg); font-weight:600; }
  button.danger:hover { border-color:var(--bad); color:var(--bad); }
  .planview { margin-top:18px; border-top:1px solid var(--line); padding-top:14px; }
  .mdc { max-width:calc(820px * var(--fs)); }
  .mdc h1, .mdc h2, .mdc h3, .mdc h4 { margin:20px 0 8px; line-height:1.3; }
  .mdc h1 { font-size:calc(20px * var(--fs)); } .mdc h2 { font-size:calc(17px * var(--fs)); border-bottom:1px solid var(--line); padding-bottom:5px; }
  .mdc h3 { font-size:calc(15px * var(--fs)); } .mdc p { margin:8px 0; } .mdc ul, .mdc ol { margin:8px 0; padding-left:24px; }
  .mdc li { margin:3px 0; }
  .mdc code { background:var(--codechip); border-radius:5px; padding:1px 6px; font:calc(12px * var(--fs)) ui-monospace,monospace; }
  .mdc pre { background:var(--codebg); border:1px solid var(--line); border-radius:10px; padding:13px;
             overflow-x:auto; font:calc(12px * var(--fs))/1.5 ui-monospace,monospace; }
  .mdc pre code { background:none; padding:0; }
  a { color:var(--link); }   /* every link, not only plan text: the browser's blue is unreadable on the dark theme */
  .mdc a { color:var(--link); }
  .mdc blockquote { border-left:3px solid var(--accent); margin:8px 0; padding:2px 14px; color:var(--dim); }
  .mdc table { border-collapse:collapse; margin:10px 0; display:block; overflow-x:auto; }
  .mdc th, .mdc td { border:1px solid var(--line); padding:5px 11px; font-size:calc(13px * var(--fs)); text-align:left; }
  .mdc th { background:var(--thbg); }
  .mdc hr { border:0; border-top:1px solid var(--line); margin:16px 0; }
  .plink { cursor:pointer; color:var(--link); }
  .plink:hover { text-decoration:underline; }
  .hdwarn { font-size:calc(12px * var(--fs)); color:var(--warn); }
  .copycmd { cursor:pointer; color:var(--warn); font-weight:700;
             text-decoration:underline dotted; text-underline-offset:2px; }
  .copycmd:hover { text-decoration:underline; }
  .launchbar { border-top:1px solid var(--line); background:var(--panel); padding:10px 12px;
               display:flex; flex-wrap:wrap; gap:4px 10px; align-items:center; flex-shrink:0; }
  .launchbar #selmodes { flex-basis:100%; order:3; font-size:calc(11px * var(--fs)); }
  .launchbar #selmodes:empty { display:none; }
  .dim { color:var(--dim); } .laststep { font-size:calc(12px * var(--fs)); color:var(--dim); margin-top:6px; }
  #logpane { position:fixed; top:0; right:0; bottom:0; width:36%; min-width:400px;
             background:var(--codebg); border-left:1px solid var(--line);
             box-shadow:-10px 0 34px rgba(0,0,0,.3);
             display:none; flex-direction:column; z-index:10; }
  #logpane.open { display:flex; }
  #logbody { flex:1; overflow:auto; padding:16px; white-space:pre-wrap;
             font:calc(12px * var(--fs))/1.5 ui-monospace,monospace; color:var(--logfg); }
  .setup { font-family:-apple-system,sans-serif; font-size:calc(13px * var(--fs)); line-height:1.7; white-space:normal; color:var(--fg); }
  .setup .opt { display:flex; gap:8px; align-items:flex-start; margin:5px 0; }
  .setup textarea { width:100%; min-height:74px; background:var(--input); color:var(--fg);
             border:1px solid var(--line); border-radius:8px; padding:8px 10px;
             font:calc(12px * var(--fs))/1.5 ui-monospace,monospace; }
  .setup input[type=text] { background:var(--input); color:var(--fg); border:1px solid var(--line);
             border-radius:7px; padding:5px 9px; font-size:calc(13px * var(--fs)); }
  .setup .lrow { display:flex; gap:8px; align-items:center; margin:4px 0;
             font:calc(12px * var(--fs))/1.5 ui-monospace,monospace; }
  .setup .hint { color:var(--dim); font-size:calc(12px * var(--fs)); margin:0 0 12px; }
  .setup code { background:var(--codechip); border-radius:5px; padding:1px 5px;
             font:calc(11px * var(--fs)) ui-monospace,monospace; }
  .pcard { border:1px solid var(--line); border-radius:12px; margin:12px 0;
             background:var(--card); overflow:hidden; }
  .pcard-head { display:flex; gap:10px; align-items:center; padding:10px 14px;
             border-bottom:1px solid var(--line); background:var(--thbg); }
  .pcard-head input { font-weight:600; }
  .pcard-body { padding:12px 14px 4px; display:grid; grid-template-columns:96px 1fr;
             gap:10px 12px; align-items:center; }
  .flabel { font-size:calc(12px * var(--fs)); color:var(--dim); text-align:right; }
  .pcard input[type=text] { width:100%; background:var(--input); border:1px solid var(--line);
             border-radius:8px; padding:7px 10px; font-size:calc(13px * var(--fs)); color:var(--fg); }
  .pcard-head input[type=text] { width:auto; }
  .pcard input.mono { font:calc(12px * var(--fs))/1.4 ui-monospace,monospace; }
  .pcard-foot { padding:8px 14px 12px; font-size:calc(11px * var(--fs)); color:var(--dim); }
  .rmbtn { margin-left:auto; background:none; border:none; color:var(--dim); font-size:calc(12px * var(--fs));
             cursor:pointer; padding:4px 10px; border-radius:7px; }
  .rmbtn:hover { color:var(--bad); background:color-mix(in srgb, var(--bad) 12%, transparent); }
  .setupbar { display:flex; gap:10px; align-items:center; margin-top:16px; padding-top:14px;
             border-top:1px solid var(--line); }
  input, select, textarea, button { transition:border-color .15s, background .15s, color .15s; }
  input:focus-visible, select:focus-visible, textarea:focus-visible {
             outline:2px solid var(--accent); outline-offset:-1px; }
  .emptyproj { padding:10px 14px 12px 34px; font-size:calc(12px * var(--fs)); color:var(--dim); border-bottom:1px solid var(--line); }
  .emptyproj code, .welcome code { background:var(--codechip); border-radius:5px; padding:1px 5px; font:calc(11px * var(--fs)) ui-monospace,monospace; }
  .welcome { max-width:560px; margin:8vh auto 0; text-align:center; }
  .welcome h2 { font-size:calc(22px * var(--fs)); margin:0 0 8px; }
  .welcome p { color:var(--dim); margin:0 0 20px; }
  .welcome button { font-size:calc(14px * var(--fs)); padding:10px 20px; }
  /* setup guide overlay — deliberately plain: type, rules and small marks, no emoji */
  #onb { position:fixed; inset:0; background:rgba(5,7,12,.62); display:none; z-index:20;
         align-items:center; justify-content:center; padding:16px; }
  #onb.open { display:flex; }
  .onb-box { width:min(900px,100%); height:min(680px,100%); background:var(--panel);
             border:1px solid var(--line); border-radius:14px; display:flex; flex-direction:column;
             box-shadow:0 24px 70px rgba(0,0,0,.45); overflow:hidden; }
  .onb-top { display:flex; align-items:center; gap:18px; padding:14px 22px; border-bottom:1px solid var(--line); }
  .steps { display:flex; gap:22px; font-size:calc(13px * var(--fs)); }
  .steps span { color:var(--dim); cursor:pointer; padding:4px 0; border-bottom:2px solid transparent; }
  .steps span b { font-weight:600; margin-right:6px; font-variant-numeric:tabular-nums; }
  .steps span.on { color:var(--fg); border-bottom-color:var(--accent); }
  .steps span.done { color:var(--fg); }
  .onb-x { background:none; border:0; color:var(--dim); font-size:calc(13px * var(--fs)); padding:4px 6px; }
  .onb-x:hover { color:var(--fg); }
  .onb-body { flex:1; overflow-y:auto; padding:30px 34px; }
  .onb-body h2 { font-size:calc(24px * var(--fs)); line-height:1.25; margin:0 0 8px; letter-spacing:-.01em; font-weight:650; }
  .onb-body .lead { color:var(--dim); margin:0 0 24px; max-width:640px; font-size:calc(14px * var(--fs)); }
  .onb-body h3 { font-size:calc(12px * var(--fs)); font-weight:600; margin:26px 0 8px; color:var(--dim); }
  .onb-foot { display:flex; gap:12px; align-items:center; padding:14px 22px; border-top:1px solid var(--line); }
  .onb-foot .primary { padding:9px 18px; }
  .linkbtn { background:none; border:0; color:var(--dim); padding:4px 2px; font-size:calc(13px * var(--fs)); }
  .linkbtn:hover { color:var(--fg); text-decoration:underline; }
  /* status marks */
  .mk { width:16px; height:16px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; margin-top:2px; }
  .mk svg { width:14px; height:14px; }
  .mk.ok { color:var(--ok); }
  .mk.bad::before, .mk.warn::before { content:''; width:8px; height:8px; border-radius:50%; }
  .mk.bad::before { background:var(--bad); }
  .mk.warn::before { border:2px solid var(--warn); width:5px; height:5px; }
  /* demo */
  .demo > * { min-width:0; }
  .demo { display:grid; grid-template-columns:1.35fr 1fr; gap:22px; align-items:stretch; }
  .win { border:1px solid var(--line); border-radius:10px; background:var(--codebg); overflow:hidden;
         height:250px; display:flex; flex-direction:column; }
  .win-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--line);
             font:calc(12px * var(--fs)) ui-monospace,monospace; color:var(--dim); }
  .win-bar .st { margin-left:auto; display:flex; align-items:center; gap:6px; }
  .win-bar .st i { width:7px; height:7px; border-radius:50%; background:var(--dot); }
  .scene { display:none; padding:14px 16px; font:calc(12.5px * var(--fs))/1.75 ui-monospace,monospace; color:var(--logfg); }
  .scene.on { display:block; }
  .scene .ln { white-space:pre; overflow:hidden; text-overflow:ellipsis; }
  .scene.on .ln { animation:lnIn .3s both; }
  .scene.on .ln:nth-child(2) { animation-delay:.35s } .scene.on .ln:nth-child(3) { animation-delay:.7s }
  .scene.on .ln:nth-child(4) { animation-delay:1.05s } .scene.on .ln:nth-child(5) { animation-delay:1.4s }
  .scene.on .ln:nth-child(6) { animation-delay:1.75s } .scene.on .ln:nth-child(7) { animation-delay:2.1s }
  @keyframes lnIn { from { opacity:0; transform:translateY(3px) } to { opacity:1; transform:none } }
  .scene .h { color:var(--fg); font-weight:600; }
  .scene .m { color:var(--dim); }
  .scene .add { color:var(--ok); } .scene .del { color:var(--bad); }
  .scene .pass { color:var(--ok); }
  .win.s1 .win-bar .st i { background:var(--run); animation:pulse 1.2s ease-in-out infinite; }
  .win.s2 .win-bar .st i { background:var(--ok); }
  .caps { display:flex; flex-direction:column; gap:4px; }
  .caps button { text-align:left; background:none; border:0; border-left:2px solid var(--line); border-radius:0;
                 padding:10px 0 10px 16px; color:var(--dim); position:relative; }
  .caps button b { display:block; color:var(--dim); font-size:calc(14px * var(--fs)); font-weight:600; margin-bottom:2px; }
  .caps button span { font-size:calc(13px * var(--fs)); line-height:1.5; display:block; }
  .caps button.on { color:var(--fg); }
  .caps button.on b { color:var(--fg); }
  .caps button.on::before { content:''; position:absolute; left:-2px; top:0; width:2px; height:100%;
                            background:var(--accent); }
  .caps button:not(.on):hover b { color:var(--fg); }
  .demo-nav { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:calc(12px * var(--fs)); color:var(--dim); }
  .demo-nav button { padding:4px 10px; font-size:calc(12px * var(--fs)); }
  .demo-nav .nx { margin-left:auto; }
  @media (prefers-reduced-motion: reduce) { .scene.on .ln { animation:none; } }
  @media (max-width:760px) { .demo { grid-template-columns:1fr; } }
  @media (max-width:600px) {
    #onbtitle { display:none; }
    .steps { gap:14px; }
    .steps span:not(.on) { font-size:0; }          /* just the number for steps you're not on */
    .steps span:not(.on) b { font-size:calc(13px * var(--fs)); margin:0; }
    .onb-x { white-space:nowrap; }
    .onb-body { padding:22px 18px; }
  }
  .alert { border:1px solid var(--line); border-left:3px solid var(--bad); border-radius:8px; padding:12px 14px;
           margin-top:24px; background:var(--card); }
  .alert.soft { border-left-color:var(--warn); }
  .alert p { margin:0 0 6px; font-size:calc(13px * var(--fs)); }
  /* check rows */
  .ck { display:flex; gap:10px; align-items:flex-start; padding:9px 0; border-top:1px solid var(--line); font-size:calc(13px * var(--fs)); }
  .ck:first-child { border-top:0; }
  .ck .bd { flex:1; min-width:0; }
  .ck .lb { font-weight:600; }
  .ck .dt { color:var(--dim); font-size:calc(12px * var(--fs)); margin-left:8px; word-break:break-all; }
  .ck .why { color:var(--dim); font-size:calc(12px * var(--fs)); margin-top:1px; }
  .ck .fix { margin-top:7px; display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
  .ck .opt-tag { font-size:calc(11px * var(--fs)); color:var(--dim); margin-left:6px; font-weight:400; }
  .cmdrow { display:flex; gap:6px; align-items:center; width:100%; }
  .cmdrow code { flex:1; min-width:0; background:var(--codebg); border:1px solid var(--line); border-radius:6px;
                 padding:5px 9px; font:calc(12px * var(--fs)) ui-monospace,monospace; overflow-x:auto; white-space:nowrap; }
  .onb-body button.sm { padding:4px 10px; font-size:calc(12px * var(--fs)); flex-shrink:0; }
  .promptbox { background:var(--codebg); border:1px solid var(--line); border-radius:6px; padding:9px 11px;
               font:calc(12px * var(--fs))/1.5 ui-monospace,monospace; white-space:pre-wrap; max-height:160px; overflow:auto;
               margin:6px 0 0; color:var(--logfg); width:100%; }
  details.pr summary { font-size:calc(12px * var(--fs)); color:var(--dim); cursor:pointer; }
  /* project rows */
  .prow { border:1px solid var(--line); border-radius:10px; margin:8px 0; background:var(--card); }
  .prow-head { display:flex; gap:12px; align-items:center; padding:12px 14px; cursor:pointer; }
  .prow-head:hover { background:var(--hover); border-radius:10px; }
  .prow-name { font-weight:600; font-size:calc(14px * var(--fs)); }
  .prow-path { color:var(--dim); font:calc(12px * var(--fs)) ui-monospace,monospace; margin-top:1px; word-break:break-all; }
  .prow-state { font-size:calc(12px * var(--fs)); white-space:nowrap; display:flex; align-items:center; gap:6px; }
  .prow-state.green { color:var(--ok); } .prow-state.amber { color:var(--warn); } .prow-state.red { color:var(--bad); }
  .prow-body { padding:0 14px 12px 14px; border-top:1px solid var(--line); }
  .prow-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding-top:10px; }
  .prow-actions input { background:var(--input); color:var(--fg); border:1px solid var(--line); border-radius:6px;
                        padding:4px 8px; font-size:calc(12px * var(--fs)); width:150px; }
  .scanrow { display:flex; gap:8px; margin:14px 0 0; }
  .scanrow input { flex:1; background:var(--input); color:var(--fg); border:1px solid var(--line); border-radius:8px;
                   padding:7px 10px; font:calc(12px * var(--fs)) ui-monospace,monospace; }
  /* pull request tabs */
  .prtabs { display:flex; gap:2px; border-bottom:1px solid var(--line); margin:12px 0; }
  .prtabs button { background:none; border:0; border-bottom:2px solid transparent; border-radius:0;
                   padding:7px 13px; color:var(--dim); }
  .prtabs button.on { color:var(--fg); border-bottom-color:var(--accent); }
  .prtabs .n { font:calc(11px * var(--fs)) ui-monospace,monospace; background:var(--btn); border-radius:10px;
               padding:1px 6px; margin-left:4px; }
  .prhead { display:grid; gap:8px; padding:12px 14px; border:1px solid var(--line); border-radius:10px;
            background:var(--card); margin-bottom:14px; }
  .prhead .row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .prhead .btns { margin:0; }
  .prtitle { font-size:calc(15px * var(--fs)); }
  .add, .del { font:600 calc(12px * var(--fs)) ui-monospace,monospace; }
  .add { color:var(--ok); } .del { color:var(--gitD); }
  .prbody li.task { list-style:none; margin-left:-20px; }
  .prbody li.task input { margin-right:6px; accent-color:var(--accent); }
  .prfiles { display:flex; border:1px solid var(--line); border-radius:10px; overflow:hidden;
             height:calc(100vh - 230px); min-height:360px; }
  .ptree { width:360px; min-width:200px; max-width:60%; flex-shrink:0; overflow:auto; border-right:1px solid var(--line); background:var(--bg);
           padding:4px 0; font-size:calc(12.5px * var(--fs)); }
  .pf { display:flex; align-items:center; gap:6px; padding:2px 10px 2px calc(10px + var(--d) * 14px);
        cursor:pointer; white-space:nowrap; }
  .pf:hover { background:var(--hover); } .pf.on { background:var(--sel); }
  .pf .chev { width:10px; color:var(--dim); flex-shrink:0; }
  .pf .nm { flex:1; overflow:hidden; text-overflow:ellipsis; }
  .pf input { margin:0; accent-color:var(--accent); }
  .pf .flag { background:none; border:0; padding:0 2px; color:var(--dim); font-size:calc(12px * var(--fs)); line-height:1;
              cursor:pointer; opacity:0; }
  .pf:hover .flag, .pf:focus .flag, .pf .flag:focus-visible { opacity:.6; }
  .pf .flag[aria-pressed="true"] { opacity:1; color:var(--warn); }
  .pf.rk .nm { text-decoration:underline wavy var(--warn); text-underline-offset:3px; }
  .flagbtn[aria-pressed="true"] { border-color:var(--warn); color:var(--warn); }
  /* git colors, as VS Code paints changed files: name and letter alike */
  .pf.M .nm, .fst.M { color:var(--gitM); }
  .pf.A .nm, .fst.A, .pf.R .nm, .fst.R { color:var(--gitA); }
  .pf.D .nm, .fst.D { color:var(--gitD); }
  .fst { font:600 calc(11px * var(--fs)) ui-monospace,monospace; }
  .pdiff { flex:1; min-width:0; display:flex; flex-direction:column; }
  .pdhead { display:flex; align-items:center; gap:8px; padding:7px 12px; border-bottom:1px solid var(--line);
            font:calc(12px * var(--fs)) ui-monospace,monospace; }
  .pdpath { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pdhead label { white-space:nowrap; }
  .pdhead button { white-space:nowrap; padding:3px 9px; font-size:calc(12px * var(--fs)); }
  .pdhead button.on { border-color:var(--accent); color:var(--accent); }
  .pdmain { flex:1; min-height:0; display:flex; }
  .pdbody.monoon { overflow:hidden; }
  .mono { width:100%; height:100%; }
  .pdbody { flex:1; overflow:auto; }
  .druler { width:14px; flex-shrink:0; position:relative; border-left:1px solid var(--line); background:var(--bg); cursor:pointer; touch-action:none; }
  .druler i { position:absolute; width:50%; }
  .druler i.d { left:0; background:var(--gitD); } .druler i.a { right:0; background:var(--gitA); }
  .druler .dview { position:absolute; left:0; right:0; background:color-mix(in srgb, var(--fg) 18%, transparent);
                   border:1px solid color-mix(in srgb, var(--fg) 30%, transparent); pointer-events:none; }
  .pdbody .dim { padding:14px; }
  .dtab { width:100%; border-collapse:collapse; table-layout:fixed; font:calc(12px * var(--fs))/1.5 ui-monospace,monospace; }
  .dtab td { padding:0 8px; white-space:pre-wrap; word-break:break-all; vertical-align:top; }
  .dtab col.lnc { width:calc(46px * var(--fs)); }
  .dtab td.ln { text-align:right; color:var(--dim); user-select:none; padding:0 6px; }
  .dtab.split td:nth-child(3) { border-left:1px solid var(--line); }
  .dwrap { position:relative; }
  .dsplit, .tsplit { position:absolute; top:0; bottom:0; width:9px; margin-left:-4px; cursor:col-resize; z-index:1; }
  .tsplit { position:relative; flex-shrink:0; margin:0 -4px; }
  .dsplit:hover, .dsplit:focus-visible, .tsplit:hover, .tsplit:focus-visible, body.dragging .dsplit.on, body.dragging .tsplit.on { background:color-mix(in srgb, var(--accent) 45%, transparent); outline:none; }
  body.dragging { cursor:col-resize; user-select:none; }
  .dtab tr.hk td { background:var(--thbg); color:var(--dim); padding:3px 8px; }
  .dtab td.a { background:var(--addbg); } .dtab td.d { background:var(--delbg); } .dtab td.e { background:var(--codebg); }
  /* review mode: the PR tabs take the whole window; one thin bar holds the plan name, tabs and next step */
  body.review > header, body.review aside { display:none; }
  body.review #detail { padding:0; display:flex; flex-direction:column; }
  .rbar { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:12px; padding:7px 16px;
          background:var(--panel); border-bottom:1px solid var(--line); flex-shrink:0; }
  .rbar .rname { font:600 calc(13px * var(--fs)) ui-monospace,monospace; min-width:0; overflow:hidden;
                 text-overflow:ellipsis; white-space:nowrap; }
  .rbar .prtabs { margin:0; border:0; flex-shrink:0; }
  .rbar .prtabs button { padding:5px 11px; border-radius:7px; border-bottom:0; }
  .rbar .prtabs button.on { background:var(--sel); }
  .rbar .seen { font:calc(12px * var(--fs)) ui-monospace,monospace; color:var(--dim); white-space:nowrap; }
  .rbar .btns { margin:0; flex-wrap:nowrap; }
  #prview.pvpr { max-width:calc(1000px * var(--fs)); }
  .prtabsrow { display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--line); margin:12px 0 16px; }
  .prtabsrow .prtabs { flex:1; margin:0; border:0; }
  .prtabsrow .btns { margin:0; }
  #prview.pvfiles { flex:1; min-height:0; display:flex; }
  #prview.pvfiles .prfiles { flex:1; height:auto; border:0; border-radius:0; }
  button.merge { background:var(--merge); border-color:var(--merge); color:var(--mergefg); font-weight:600; }
  .mbox { border:1px solid var(--line); border-radius:10px; overflow:hidden; margin-bottom:16px; }
  .mline { display:flex; gap:10px; align-items:center; padding:8px 14px; border-bottom:1px solid var(--line); }
  .mline .ic { width:16px; text-align:center; font-weight:700; }
  .mline.ok .ic { color:var(--ok); } .mline.bad .ic { color:var(--bad); } .mline.warn .ic { color:var(--warn); }
  .mline.dim .ic { color:var(--dim); }
  .mfoot { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px 14px; background:var(--card); }
  .mfoot select { background:var(--input); color:var(--fg); border:1px solid var(--line); border-radius:7px; padding:4px 8px; }
  .mfoot label { display:flex; gap:6px; align-items:center; }
  .mbox.flash { outline:2px solid var(--merge); }
  .mergednote { border:1px solid var(--merge); border-radius:10px; padding:10px 14px; margin-bottom:16px; }
  .mergednote b { color:var(--merge); }
  .mergednote div { color:var(--dim); font-size:calc(12.5px * var(--fs)); }
  .askwho { margin-left:auto; font-size:calc(12px * var(--fs)); }
  #askview { display:flex; flex-direction:column; gap:10px; max-width:calc(900px * var(--fs)); }
  .asklog { max-height:calc(100vh - 360px); min-height:120px; overflow:auto; display:flex; flex-direction:column; gap:8px; padding-right:4px; }
  .amsg { padding:9px 13px; border-radius:10px; line-height:1.55; }
  .amsg.you { align-self:flex-end; max-width:80%; background:color-mix(in srgb, var(--accent) 16%, var(--card)); white-space:pre-wrap; }
  .amsg.agent { background:var(--card); border:1px solid var(--line); }
  .amsg.agent > :first-child { margin-top:0; } .amsg.agent > :last-child { margin-bottom:0; }
  .aallow { font-size:calc(11px * var(--fs)); margin-top:4px; white-space:normal; }
  .atool { font:calc(11.5px * var(--fs)) ui-monospace,monospace; color:var(--dim); padding:0 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .aend { font-size:calc(11px * var(--fs)); color:var(--dim); padding:0 4px; }
  .aend.bad { color:var(--bad); }
  .anew { text-align:center; font-size:calc(11px * var(--fs)); color:var(--dim); border-top:1px dashed var(--line); padding-top:6px; margin-top:6px; }
  .askempty { padding:14px 4px; line-height:1.6; }
  .askdeny { border:1px solid var(--warn); border-radius:10px; padding:10px 13px; display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
  .askdeny code { font:calc(12px * var(--fs)) ui-monospace,monospace; word-break:break-all; }
  .askbox { border:1px solid var(--line); border-radius:10px; background:var(--card); padding:8px; }
  .askbox textarea { width:100%; resize:vertical; background:var(--input); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:inherit; }
  .askrow { display:flex; align-items:center; gap:8px; margin-top:6px; font-size:calc(12.5px * var(--fs)); flex-wrap:wrap; }
  .rbar kbd { font:calc(10px * var(--fs)) ui-monospace,monospace; border:1px solid var(--line); border-radius:4px; padding:0 4px; margin-left:4px; color:var(--dim); }
  #ract { align-items:center; }
  .merr { border:1px solid var(--bad); color:var(--bad); background:color-mix(in srgb, var(--bad) 10%, transparent);
          border-radius:10px; padding:10px 13px; margin:0 0 12px; white-space:pre-wrap; }
  .merr b { color:var(--fg); }
  #ract .chip { white-space:nowrap; font-size:calc(11.5px * var(--fs)); padding:3px 9px; }
  .ghbtn { display:inline-flex; align-items:center; line-height:calc(15px * var(--fs)); padding:7px 13px; border:1px solid var(--line); border-radius:8px;
           background:var(--btn); color:var(--fg); text-decoration:none; font-size:calc(13px * var(--fs)); white-space:nowrap; }
  .ghbtn:hover { border-color:var(--accent); }
  .rfbtn { line-height:calc(15px * var(--fs)); }
  .ghhint { color:var(--dim); font-size:calc(12.5px * var(--fs)); border-top:1px dashed var(--line); padding-top:10px; margin-top:6px; }
  details.planfold > summary { cursor:pointer; color:var(--dim); margin-top:14px; }
  .pf:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  /* tour: a transparent blocker, a spotlight hole, and a card beside it */
  #tour { display:none; }
  #tour.open { display:block; }
  #tourblock { position:fixed; inset:0; z-index:30; }
  #tourhole { position:fixed; z-index:31; border-radius:10px; pointer-events:none;
              box-shadow:0 0 0 9999px rgba(5,7,12,.66); outline:2px solid var(--accent);
              transition:left .25s, top .25s, width .25s, height .25s; }
  #tourpop { position:fixed; z-index:32; width:320px; background:var(--panel); border:1px solid var(--line);
             border-radius:12px; padding:14px 16px 12px; box-shadow:0 18px 50px rgba(0,0,0,.45);
             transition:left .25s, top .25s; }
  #tourpop b { font-size:calc(15px * var(--fs)); display:block; margin:2px 0 4px; }
  #tourpop p { margin:0 0 12px; font-size:calc(13px * var(--fs)); color:var(--dim); line-height:1.55; }
  .tp-count { font-size:calc(11px * var(--fs)); color:var(--dim); }
  .tp-foot { display:flex; gap:8px; align-items:center; }
  @media (prefers-reduced-motion: reduce) { #tourhole, #tourpop { transition:none; } }
</style>
<header><h1>🗂 Plans</h1><span class="hdrun" id="hdrun" style="display:none"></span>
  <span class="hdok" id="hdok" style="display:none"></span>
  <span class="dim" id="clock"></span>
  <span class="hdwarn" id="connmsg" style="display:none"></span>
  <span class="dim" style="margin-left:auto">auto-refresh 5s · summaries generate in background</span>
  <button id="guidebtn" title="how it works, add a repo, start a run">Guide</button>
  <button id="settingsbtn" title="projects & settings">⚙ Settings</button>
  <button id="alertBtn" aria-pressed="false" title="Sound and notification when a run stops or the agent answers">🔕</button>
  <button id="themeBtn" title="toggle light/dark">🌙</button></header>
<div class="wrap">
  <aside>
    <div class="filters">
      <input id="q" placeholder="search plans, archived too…">
      <button id="collapseAll" title="collapse or expand all project sections">Collapse all</button>
    </div>
    <div class="runstrip" id="runstrip"></div>
    <div class="items" id="side"></div>
    <div class="launchbar">
      <span id="selcount" class="dim">0 queued</span>
      <span class="dim" id="selmodes"></span>
      <span style="flex:1"></span>
      <button class="primary" id="launchbtn">▶ Launch queued in parallel</button>
    </div>
  </aside>
  <section id="detail"><span class="dim">Select a plan on the left.</span></section>
</div>
<div id="logpane">
  <header><h1 id="logtitle"></h1><span style="margin-left:auto"></span>
    <button id="backBtn" style="display:none">‹ Back</button>
    <button onclick="closeLog()">✕ close</button></header>
  <div id="logbody"></div>
</div>
<div id="onb" role="dialog" aria-modal="true" aria-labelledby="onbtitle">
  <div class="onb-box">
    <div class="onb-top"><h1 id="onbtitle" style="font-size:14px">Plans</h1><div class="steps" id="onbsteps"></div>
      <span style="flex:1"></span><button class="onb-x" id="onbskip" title="close (Esc)">Skip for now</button></div>
    <div class="onb-body" id="onbbody"></div>
    <div class="onb-foot"><button class="linkbtn" id="onbback">Back</button><span style="flex:1"></span>
      <button class="primary" id="onbnext">Continue</button></div>
  </div>
</div>
<div id="tour"><div id="tourblock"></div><div id="tourhole"></div>
  <div id="tourpop" role="dialog" aria-live="polite"></div></div>
<script>
// theme: remembered per browser, defaults to system preference
const applyTheme = (t) => {
  document.documentElement.dataset.theme = t;
  document.getElementById('themeBtn').textContent = t === 'light' ? '🌙' : '☀️';
  if (window.monaco && typeof monoTheme === 'function') monoTheme();
};
let theme;
try { theme = localStorage.getItem('dash-theme'); } catch {}
theme = theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
applyTheme(theme);
document.getElementById('themeBtn').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('dash-theme', theme); } catch {}
  applyTheme(theme);
});
const STATUSES = ['ready', 'in-refinement', 'needs-validation', 'waiting-on-external', 'parked', 'done'];
const TAG_SUGGESTIONS = ['small', 'big', 'db-migration', 'frontend-needed', 'ai', 'risky', 'tech-debt'];
const BT = String.fromCharCode(96); // backtick, kept out of this template literal

let state = [], plans = [], selected = null, logKey = null, logKind = 'log', planCache = {};
let CUR_ISSUES = '';
const picked = new Set(); // keys: "<project>/<slug>"
// collapsed project sections, remembered per browser
let collapsedProjects;
try { collapsedProjects = new Set(JSON.parse(localStorage.getItem('dash-collapsed') || '[]')); }
catch { collapsedProjects = new Set(); }
const saveCollapsed = () => {
  try { localStorage.setItem('dash-collapsed', JSON.stringify([...collapsedProjects])); } catch {}
};
const modes = {};         // per key: a mode id from the project's modes (pipeline) or launcher index (generic)
// per project: the last mode picked in this browser, so a new plan starts on it
let lastModes = {};
try { lastModes = JSON.parse(localStorage.getItem('dash-modes') || '{}'); } catch {}
const pickMode = (p, v) => {
  modes[p.key] = v;
  lastModes[p.project] = v;
  try { localStorage.setItem('dash-modes', JSON.stringify(lastModes)); } catch {}
};
// a run that was launched keeps its mode, so Resume continues the same way; otherwise
// the last pick for the project, then the project's default (--describe), then the first
const modeOf = (p) => {
  if (modes[p.key] != null) return modes[p.key];
  const last = lastModes[p.project];
  if (!p.hasPipeline) return last != null && +last < (p.launchers || []).length ? last : 0;
  const ms = p.modes || [];
  const known = (id) => ms.some((m) => m.id === id);
  return p.run && known(p.run.mode) ? p.run.mode : known(last) ? last
    : (ms.find((m) => m.default) || ms[0] || {}).id;
};
const esc = (x) => (x || '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const byId = (i) => document.getElementById(i);
// Every repaint assigns innerHTML, which replaces the nodes a selection is
// anchored in and so silently drops whatever the user had highlighted. These
// let a repaint hold off until the selection is released.
const selectionIn = (el) => {
  const s = window.getSelection();
  if (!el || !s || !s.rangeCount || s.isCollapsed) return false;
  return !!s.anchorNode && el.contains(s.anchorNode);
};
const selectionLive = () =>
  ['detail', 'side', 'logbody', 'runstrip'].some((id) => selectionIn(byId(id)));
// navigator.clipboard exists only in a secure context. 127.0.0.1 and *.localhost
// qualify; a vanity domain like http://plans.test does not — and that is the URL
// this server prefers when /etc/hosts has it. Fall back to the legacy path there.
async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
const find = (key) => plans.find((p) => p.key === key);
// the server sets run.outcome: 'running' | 'needs-you' | 'failed'
const outOf = (p) => p.run ? p.run.outcome : null;
const OUT_CLASS = { 'needs-you': 'ok', failed: 'bad', running: 'warn' };

// --- tiny markdown renderer (headings, lists, tables, fences, links, #issues) ---
function inline(s) {
  s = esc(s);
  const codeRe = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
  const parts = []; // protect inline code from further replacement
  s = s.replace(codeRe, (m, c) => { parts.push('<code>' + c + '</code>'); return '\\u0000' + (parts.length - 1) + '\\u0000'; });
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>');
  s = s.replace(/\\[([^\\]]+)\\]\\((https?:[^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
  s = s.replace(/(^|[^"'>=\\w])(https?:\\/\\/[^\\s<]+)/g, '$1<a href="$2" target="_blank">$2</a>');
  if (CUR_ISSUES) s = s.replace(/(^|[\\s(>])#(\\d{1,6})\\b/g,
    '$1<a href="' + CUR_ISSUES + '$2" target="_blank">#$2</a>');
  return s.replace(/\\u0000(\\d+)\\u0000/g, (m, i) => parts[+i]);
}
// breaks: a single newline is a line break, as GitHub shows PR and issue text
function md(src, breaks) {
  const fences = [];
  const fenceRe = new RegExp(BT + BT + BT + '[^\\n]*\\n([\\s\\S]*?)' + BT + BT + BT, 'g');
  src = src.replace(fenceRe, (m, code) => {
    fences.push('<pre><code>' + esc(code) + '</code></pre>');
    return '\\u0001' + (fences.length - 1) + '\\u0001';
  });
  const out = []; let list = null, para = [], tbl = null;
  const flushPara = () => {
    if (para.length) out.push('<p>' + (breaks ? para.map(inline).join('<br>') : inline(para.join(' '))) + '</p>');
    para = [];
  };
  const flushList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const flushTbl = () => {
    if (!tbl) return;
    const rows = tbl.filter((r) => !/^\\s*\\|?[\\s:|-]+\\|?\\s*$/.test(r));
    out.push('<table>' + rows.map((r, i) => {
      const cells = r.replace(/^\\s*\\|/, '').replace(/\\|\\s*$/, '').split('|');
      const tag = i === 0 ? 'th' : 'td';
      return '<tr>' + cells.map((c) => '<' + tag + '>' + inline(c.trim()) + '</' + tag + '>').join('') + '</tr>';
    }).join('') + '</table>');
    tbl = null;
  };
  for (const raw of src.split('\\n')) {
    const line = raw.replace(/\\s+$/, '');
    let m;
    if (/^\\s*\\|/.test(line)) { flushPara(); flushList(); (tbl = tbl || []).push(line); continue; }
    flushTbl();
    if ((m = line.match(/^(#{1,4})\\s+(.*)$/))) {
      flushPara(); flushList();
      out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>');
    } else if (/^\\s*(---+|\\*\\*\\*+)\\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>');
    } else if ((m = line.match(/^\\s*[-*]\\s+(.*)$/))) {
      flushPara(); if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + inline(m[1]) + '</li>');
    } else if ((m = line.match(/^\\s*\\d+[.)]\\s+(.*)$/))) {
      flushPara(); if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + inline(m[1]) + '</li>');
    } else if ((m = line.match(/^>\\s?(.*)$/))) {
      flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>');
    } else if (!line.trim()) { flushPara(); flushList();
    } else if (/^\\u0001\\d+\\u0001$/.test(line.trim())) { flushPara(); flushList(); out.push(line.trim());
    } else { para.push(line.trim()); }
  }
  flushPara(); flushList(); flushTbl();
  return out.join('\\n').replace(/\\u0001(\\d+)\\u0001/g, (m, i) => fences[+i]);
}

// --- rendering ---
const starting = (p) => !p.live && p.launch && p.launch.state === 'starting';
const notStarted = (p) => !p.live && p.launch && p.launch.state === 'failed';
const dotClass = (p) => p.live ? 'live'
  : starting(p) ? 'warn' : notStarted(p) ? 'bad'
  : !p.run ? '' : OUT_CLASS[outOf(p)];

const autoChips = (p) => {
  let c = '';
  if (p.live) c += '<span class="chip live">● running</span>';
  else if (starting(p)) c += '<span class="chip warn">⏳ starting…</span>';
  else if (notStarted(p)) c += '<span class="chip bad">⚠ didn’t start</span>';
  else if (p.run) c += '<span class="chip ' + OUT_CLASS[outOf(p)] +
    '">' + esc(String(p.run.status || outOf(p) || 'run').split(/[.—]/)[0].slice(0, 42)) + '</span>';
  if (p.validations) c += '<span class="chip ok">validated ×' + p.validations + '</span>';
  if (p.worktree) c += '<span class="chip">worktree</span>';
  if (p.archived) c += '<span class="chip">📦 archived</span>';
  if (p.pr) c += prChip(p.pr);
  return c;
};

const matchesQ = (p, q) => p.file.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)
  || p.project.toLowerCase().includes(q) || p.client.toLowerCase().includes(q)
  || p.tags.some((t) => t.toLowerCase().includes(q));
function visiblePlans() {
  const q = byId('q').value.toLowerCase();
  return plans.filter((p) => !p.archived && (!q || matchesQ(p, q)));
}
// Archived plans stay out of the list until a search asks for them — nobody browses
// hundreds of finished plans, they look one up. An open one stays listed.
function archivedMatches() {
  const q = byId('q').value.toLowerCase();
  return plans.filter((p) => p.archived && (q ? matchesQ(p, q) : selected === p.key))
    .sort((a, b) => b.slug.localeCompare(a.slug));   // slugs start with their date: newest first
}
let lastItemClick = {};
const itemHtml = (p, withProject) => \`
    <div class="item \${selected === p.key ? 'sel' : ''} \${p.archived ? 'arch' : ''} \${dotClass(p)}" data-key="\${p.key}">
      <input type="checkbox" aria-label="queue this plan" data-check="\${p.key}" \${picked.has(p.key) ? 'checked' : ''}
             \${p.live || starting(p) || p.worktree || p.archived ? 'disabled' : ''}>
      <div class="t">
        <div class="name">\${withProject ? '[' + esc(p.project) + '] ' : ''}\${p.file}</div>
        <div class="chiprow">
          \${p.status ? '<span class="chip st">' + esc(p.status) + '</span>' : ''}
          \${p.tags.map((t) => '<span class="chip">' + esc(t) + '</span>').join('')}
          \${autoChips(p)}
          \${picked.has(p.key) ? '<span class="chip st">▶ ' + esc(modeLabel(p)) + '</span>' : ''}
        </div>
      </div>
      <div class="dot \${dotClass(p)}"></div>
    </div>\`;
function modeLabel(p) {
  if (p.hasPipeline) return modeOf(p);
  const l = (p.launchers || [])[+modeOf(p)];
  return l ? (l.label || 'launcher ' + (+modeOf(p) + 1)) : 'no launcher';
}
// ---- favicon mood ring ----
// the 16px tab should answer "is the fleet working, or does it want me?" on its own.
// running/waiting = machine's turn; dead/done = your turn, most urgent first.
const MOODS = [['live', '\u{1F3C3}'], ['inflight', '\u{23F3}'], ['bad', '\u{1F480}'],
               ['ready', '\u2705'], ['idle', '\u{1F634}']];
let lastMood = '';
function setMood(counts) {
  const [key, face] = MOODS.find(([k]) => k === 'idle' || counts[k]);
  const n = counts[key] || 0;
  const mood = face + n;
  if (mood === lastMood) return;   // the 5s poll must not churn the DOM
  lastMood = mood;
  byId('favicon').href = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<text x="32" y="46" font-size="56" text-anchor="middle">' + face + '</text></svg>');
  document.title = (n ? '(' + n + ') ' : '') + 'Plans';
}
function renderList() {
  // pinned "running now" strip + header counters — running must be unmissable
  const live = plans.filter((p) => p.live);
  // launched but between sessions: report/run exists, neither done nor failed, no live process
  const inflight = plans.filter((p) => !p.live && !p.launch && outOf(p) === 'running');
  const ready = plans.filter((p) => !p.live && !p.launch && outOf(p) === 'needs-you');
  const launching = plans.filter(starting);
  const failed = plans.filter(notStarted);
  const bad = plans.filter((p) => !p.live && !p.launch && outOf(p) === 'failed');
  setMood({ live: live.length, inflight: inflight.length, bad: bad.length, ready: ready.length });
  const rs = byId('runstrip');
  rs.className = 'runstrip' +
    (live.length || inflight.length || ready.length || bad.length || launching.length || failed.length ? ' on' : '');
  let sh = '';
  const stripName = (p) => '<span class="pfx">[' + esc(p.project) + ']</span> ' + p.file;
  if (failed.length) sh += '<div class="cap bc">⚠ DIDN’T START — ' + failed.length + '</div>' +
    failed.map((p) => '<div class="rp bp" data-go="' + p.key + '"><span class="dot bad"></span><span class="n">' +
      stripName(p) + '</span><button class="mini" data-why="' + p.key + '">why?</button></div>').join('');
  if (launching.length) sh += '<div class="cap wc">⏳ STARTING — ' + launching.length + '</div>' +
    launching.map((p) => '<div class="rp wp" data-go="' + p.key + '"><span class="dot warn"></span><span class="n">' +
      stripName(p) + '</span><span class="dim mini">setting up…</span></div>').join('');
  if (live.length) sh += '<div class="cap">● RUNNING NOW — ' + live.length + '</div>' +
    live.map((p) => '<div class="rp" data-go="' + p.key + '"><span class="dot live"></span><span class="n">' +
      stripName(p) + '</span><button class="mini" data-log="' + p.key + '">📜 log</button></div>').join('');
  if (inflight.length) sh += '<div class="cap wc">⏳ LAUNCHED — IN PROGRESS — ' + inflight.length + '</div>' +
    inflight.map((p) => '<div class="rp wp" data-go="' + p.key + '"><span class="dot warn"></span><span class="n">' +
      stripName(p) + '</span><button class="mini" data-rep="' + p.key + '">' +
      (p.hasPipeline ? '📋 report' : '📜 log') + '</button></div>').join('');
  // the run's own status says what it waits for ("VERIFIED", "PR OPEN — 3 DECISIONS WAITING",
  // "BLOCKED: step 10 …"); a run that stopped blocked or failed needs you as much as a finished one
  const doneRow = (p, cls, dot) => '<div class="rp ' + cls + '" data-go="' + p.key + '"><span class="dot ' + dot + '"></span><span class="n">' +
      stripName(p) + '<span class="rst" title="' + escA(p.run.status || '') + '">' + esc(p.run.status || '') + '</span></span>' +
      '<span class="acts">' + (p.run.links || []).map((l) => '<button class="mini" data-url="' + escA(l.url) + '">🔗 ' +
        esc(l.label) + '</button>').join('') +
      '<button class="mini" data-rep="' + p.key + '">' +
      (p.hasPipeline ? '📋 report' : '📜 log') + '</button></span></div>';
  if (bad.length) sh += '<div class="cap bc">✕ STOPPED — BLOCKED OR FAILED — ' + bad.length + '</div>' +
    bad.map((p) => doneRow(p, 'bp', 'bad')).join('');
  if (ready.length) sh += '<div class="cap okc">✓ WAITING ON YOU — ' + ready.length + '</div>' +
    ready.map((p) => doneRow(p, 'okp', 'ok')).join('');
  rs.innerHTML = sh;
  rs.querySelectorAll('[data-go]').forEach((el) =>
    el.addEventListener('click', () => { selected = el.dataset.go; renderList(); renderDetail(true); }));
  rs.querySelectorAll('[data-why]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); showLaunchError(find(el.dataset.why)); }));
  rs.querySelectorAll('[data-log]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openLog(el.dataset.log, 'log'); }));
  rs.querySelectorAll('[data-url]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation(); openRunLink(find(el.closest('[data-go]').dataset.go), el.dataset.url);
    }));
  rs.querySelectorAll('[data-rep]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = find(el.dataset.rep);
      openLog(el.dataset.rep, p && p.hasPipeline ? 'report' : 'log');
    }));
  const hd = byId('hdrun');
  hd.style.display = live.length ? '' : 'none';
  hd.textContent = '● ' + live.length + ' running';
  const ho = byId('hdok');
  ho.style.display = ready.length ? '' : 'none';
  ho.textContent = '✓ ' + ready.length + ' to review';
  // grouped list: client → project → plans; project sections collapse on header click
  const vis = visiblePlans();
  // Unfiltered, every registered project shows — an empty one included, so a project
  // added a moment ago doesn't look like it failed to register.
  const filtering = byId('q').value;
  const arch = archivedMatches();
  const shownProjs = state.filter((s) => !filtering || vis.some((p) => p.project === s.name));
  const clients = [...new Set(shownProjs.map((s) => s.client))];
  byId('side').innerHTML = !state.length
    ? '<div class="emptyproj" style="padding:18px 16px">No projects on the dashboard yet.<br><br>' +
      '<button class="primary" data-guide="">Get started</button></div>'
    : clients.map((c) => {
    const projNames = shownProjs.filter((s) => s.client === c).map((s) => s.name);
    return '<div class="ghead">' + esc(c) + '</div>' + projNames.map((pr) => {
      const items = vis.filter((p) => p.project === pr);
      const closed = collapsedProjects.has(pr);
      const sp = state.find((s) => s.name === pr) || {};
      const hasLanes = sp.hasLanes;
      // run counters for the whole project (not just filtered-visible plans)
      const projPlans = plans.filter((p) => p.project === pr);
      const liveN = projPlans.filter((p) => p.live).length;
      const flightN = projPlans.filter((p) => !p.live && outOf(p) === 'running').length;
      const runBadges =
        (liveN ? '<span class="chip live">● ' + liveN + ' running</span>' : '') +
        (flightN ? '<span class="chip warn">⏳ ' + flightN + '</span>' : '');
      return '<div class="phead" data-toggle="' + esc(pr) + '"><span class="chev">' +
        (closed ? '▸' : '▾') + '</span>📁 ' + esc(pr) +
        (hasLanes ? '<button class="pbtn" data-suggest="' + esc(pr) +
          '" title="suggest a parallel launch batch">🧭 Suggest</button>' : '') + runBadges +
        (sp.setupLevel === 'red' ? '<span class="chip bad x" data-guide="' + escA(sp.root) +
          '" title="something required is missing — open the guide">needs setup</span>' : '') +
        '<span class="cnt">' + items.length + ' plan' + (items.length === 1 ? '' : 's') +
        '</span></div>' + (closed ? '' : items.length ? items.map((p) => itemHtml(p)).join('')
          : '<div class="emptyproj">' + (projPlans.length ? 'All plans are archived.'
            : 'No plans yet — add a <code>.md</code> file to <code>' + esc(sp.plansDir) + '</code>.') + '</div>');
    }).join('');
  }).join('') + (arch.length ? '<div class="ghead">📦 Archived' + (filtering ? ' — ' + arch.length + ' match' +
    (arch.length === 1 ? '' : 'es') : '') + '</div>' + arch.map((p) => itemHtml(p, true)).join('') : '');
  byId('side').querySelectorAll('[data-guide]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.dataset.guide) onbOpenCards.add(el.dataset.guide);
      openGuide(el.dataset.guide ? 1 : 0);
    }));
  byId('side').querySelectorAll('[data-suggest]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openSuggest(el.dataset.suggest); }));
  const allProjNames = [...new Set(plans.map((p) => p.project))];
  byId('collapseAll').textContent =
    allProjNames.length && allProjNames.every((n) => collapsedProjects.has(n))
      ? 'Expand all' : 'Collapse all';
  byId('side').querySelectorAll('.phead[data-toggle]').forEach((el) =>
    el.addEventListener('click', () => {
      const pr = el.dataset.toggle;
      collapsedProjects.has(pr) ? collapsedProjects.delete(pr) : collapsedProjects.add(pr);
      saveCollapsed(); renderList();
    }));
  byId('side').querySelectorAll('.item').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.dataset.check) return;
      const key = el.dataset.key, now = Date.now();
      // double-click queues the plan, same as ticking its box. Timed by hand because
      // the first click re-renders the list, so the browser's dblclick never fires.
      if (lastItemClick.key === key && now - lastItemClick.at < 400) {
        lastItemClick = {};
        getSelection().removeAllRanges();
        if (el.querySelector('input[data-check]').disabled) return;
        picked.has(key) ? picked.delete(key) : picked.add(key);
        renderBar(); renderList();
        return;
      }
      lastItemClick = { key, at: now };
      selected = key; renderList(); renderDetail(true);
    }));
  byId('side').querySelectorAll('input[data-check]').forEach((el) =>
    el.addEventListener('change', () => {
      el.checked ? picked.add(el.dataset.check) : picked.delete(el.dataset.check);
      renderBar(); renderList();
    }));
}

// The address bar follows the open plan, tab and file, so a reload reopens them and Back
// goes to the previous plan or tab. A new plan or tab is a history entry; a file is not.
function syncUrl() {
  const q = new URLSearchParams(location.search);
  const want = { sel: selected, tab: selected && prTab[selected] !== 'plan' ? prTab[selected] : null,
    file: selected && prTab[selected] === 'files' ? prFile[selected] : null };
  const same = (k) => (q.get(k) || null) === (want[k] || null);
  if (same('sel') && same('tab') && same('file')) return;
  const push = !same('sel') || !same('tab');
  for (const [k, v] of Object.entries(want)) v ? q.set(k, v) : q.delete(k);
  const url = location.pathname + (q.toString() ? '?' + q : '');
  push ? history.pushState(null, '', url) : history.replaceState(null, '', url);
}
function readUrl() {
  const q = new URLSearchParams(location.search);
  selected = q.get('sel') || null;
  if (selected) {
    prTab[selected] = q.get('tab') || 'plan';
    if (q.get('file')) prFile[selected] = q.get('file');
  }
  lastPrDraw = null;
}
window.addEventListener('popstate', () => { readUrl(); renderList(); renderDetail(true); });
async function renderDetail(loadPlan) {
  syncUrl();
  const p = find(selected);
  if (!p) return renderEmptyDetail();
  CUR_ISSUES = p.issuesUrl || '';
  let tab = prTab[p.key] || 'plan';
  if (tab === 'ask' ? !hasAsk(p) : tab !== 'plan' && !p.pr) tab = 'plan';
  if (tab === 'ask') return renderAskTab(p, loadPlan);
  if (tab !== 'plan') return renderPrTab(p, tab, loadPlan);
  lastPrDraw = null;
  const launcherModes = !p.hasPipeline && !p.archived
    ? ((p.launchers || []).length ? \`
    <div class="modes"><b>Launcher:</b>
      \${p.launchers.map((l, i) => '<label><input type="radio" name="m" value="' + i + '" ' +
        (String(modeOf(p)) === String(i) ? 'checked' : '') + '>' +
        esc(l.label || 'launcher ' + (i + 1)) + '</label>').join('')}
      <button id="editL">⚙ edit launchers</button></div>\` : \`
    <div class="modes"><b>No launcher configured for \${esc(p.project)} yet.</b>
      <button id="editL" class="primary">⚙ Set up launcher</button></div>\`)
    : '';
  const pipelineModes = p.hasPipeline && !p.archived &&
    ((!p.run && !p.live) || (!p.live && outOf(p) === 'failed')) ? \`
    <div class="modes"><b>Where to stop:</b>
      \${(p.modes || []).map((m) => '<label><input type="radio" name="m" value="' + escA(m.id) + '" ' +
        (modeOf(p) === m.id ? 'checked' : '') + '>' + esc(m.label) + '</label>').join('')}</div>\` : '';
  byId('detail').innerHTML = \`
    <div class="crumb">\${esc(p.client)} / 📁 \${esc(p.project)}</div>
    <h2 class="fname">\${p.file}</h2>
    <div class="subtitle">\${inline(p.title)}</div>
    \${prTabs(p, 'plan')}
    <div class="badges">\${autoChips(p)}</div>
    \${p.pr && p.pr.state === 'MERGED' ? '<div class="mergedline"><span>✓ PR #' + p.pr.number +
      ' was merged into <code>' + esc(p.pr.base || '?') + '</code>' + (p.pr.mergedAt ? ' on ' + esc(new Date(p.pr.mergedAt).toLocaleString()) : '') +
      '</span><a href="' + escA(p.pr.url) + '" target="_blank" rel="noopener">↗ GitHub</a></div>' : ''}
    \${p.summary ? '<div class="summary">💡 ' + esc(p.summary) + '</div>'
      : p.summarizing ? '<div class="summary dim">💭 plain-language summary is being generated…</div>' : ''}
    \${p.run && p.run.lastEvent ? '<div class="laststep">last: ' + esc(p.run.lastEvent.slice(0, 200)) + '</div>' : ''}
    \${p.live ? '' : launcherModes}\${pipelineModes}
    <div class="btns" id="actions"></div>
    \${!p.pr && p.prError ? '<div class="ghhint">PRs are not shown: ' + esc(p.prError) + '. Run <code>' +
      (/not installed/.test(p.prError) ? 'brew install gh &amp;&amp; gh auth login' : 'gh auth login') + '</code> in a terminal.</div>' : ''}
    <div id="morebox" \${moreOpen.has(p.key) ? '' : 'hidden'}>
    <div class="metabox"><b>Status:</b>
      <select id="stSel"><option value="">—</option>
        \${STATUSES.map((s) => '<option ' + (p.status === s ? 'selected' : '') + '>' + s + '</option>').join('')}
      </select>
      <b>Tags:</b><span id="tagRow" class="chiprow">
        \${p.tags.map((t) => '<span class="chip x" data-del="' + esc(t) + '">' + esc(t) + ' ✕</span>').join('')}</span>
      <input id="tagIn" list="tagOpts" placeholder="+ add tag ⏎" size="12">
      <datalist id="tagOpts">\${TAG_SUGGESTIONS.map((t) => '<option>' + t + '</option>').join('')}</datalist>
    </div>
    <div id="sessbox"></div>
    </div>
    <details class="planfold" id="planfold" \${planOpen.has(p.key) ? 'open' : ''}><summary>Show the full plan</summary>
      <div class="planview"><div class="mdc" id="planmd">loading plan…</div></div></details>\`;
  document.body.classList.remove('review');
  bindPrTabs(p);
  byId('planfold').addEventListener('toggle', () =>
    byId('planfold').open ? planOpen.add(p.key) : planOpen.delete(p.key));
  byId('stSel').addEventListener('change', () => saveMetaFor(p, byId('stSel').value || null, p.tags));
  byId('tagIn').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim())
      saveMetaFor(p, p.status, [...p.tags, e.target.value.trim()]);
  });
  byId('detail').querySelectorAll('[data-del]').forEach((el) =>
    el.addEventListener('click', () => saveMetaFor(p, p.status, p.tags.filter((t) => t !== el.dataset.del))));
  byId('detail').querySelectorAll('input[name=m]').forEach((el) =>
    el.addEventListener('change', () => { pickMode(p, el.value); renderBar(); renderList(); }));
  const editL = byId('editL');
  if (editL) editL.addEventListener('click', () => openLauncherSetup(p.project));
  // state-aware actions: primary buttons only; the rest behind "⋯ more"
  const A = byId('actions');
  const moreWrap = document.createElement('span');
  moreWrap.style.cssText = 'display:none;gap:8px;flex-wrap:wrap';
  const btn = (label, fn, cls, parent) => {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls;
    b.addEventListener('click', fn); (parent || A).appendChild(b);
    return b;
  };
  const stt = p.live ? 'live'
    : starting(p) ? 'starting'
    : p.run ? (outOf(p) === 'needs-you' ? 'review' : 'stuck')
    : 'fresh';
  const rep = () => openLog(p.key, 'report');
  const log = () => openLog(p.key, 'log');
  const vsc = () => post('/api/vscode', { project: p.project, slug: p.slug });
  const clean = () => p.hasPipeline ? cleanupRun(p) : clearRun(p);
  const launchNow = () => post('/api/launch-generic',
    { project: p.project, slug: p.slug, launcher: +modeOf(p) }, true);
  if (notStarted(p)) btn('⚠ Why it didn’t start', () => showLaunchError(p), 'danger');
  for (const l of (p.run && p.run.links) || []) {
    btn('🔗 ' + l.label, () => openRunLink(p, l.url), 'primary');
    // the button above opens the PR tab here; this one is for the page on GitHub
    if (p.pr && l.url.replace(/[/]+$/, '') === p.pr.url.replace(/[/]+$/, ''))
      btn('↗ GitHub', () => window.open(p.pr.url, '_blank', 'noopener'));
  }
  if (stt === 'starting') {
    btn('⏳ Starting… setting up the worktree', () => {}).disabled = true;
  } else if (p.archived) {
    btn('↩ Unarchive plan', () => post('/api/unarchive', { project: p.project, slug: p.slug }, true));
    btn('🖥 Open in VS Code', vsc, null, moreWrap);
  } else if (p.hasPipeline) {
    if (stt === 'live') {
      btn('📋 Report', rep); btn('📜 Log', log);
    } else if (stt === 'review') {
      btn('📋 Report', rep); btn('🖥 Open in VS Code', vsc);
      btn('📜 Log', log, null, moreWrap);
      btn('🗑 Clean up run', clean, 'danger', moreWrap);
    } else if (stt === 'stuck') {
      btn('📋 Report', rep); btn('📜 Log', log);
      btn('⟳ Resume', () => post('/api/resume', { project: p.project, slug: p.slug, mode: modeOf(p) }).then(afterLaunch));
      btn('🖥 Open in VS Code', vsc, null, moreWrap);
      btn('🗑 Clean up run', clean, 'danger', moreWrap);
    } else { // fresh: launch this one now, or queue it with others via the checkbox
      if (p.worktree) { btn('🖥 Open in VS Code', vsc); btn('🗑 Clean up run', clean, 'danger', moreWrap); }
      else {
        btn('▶ Launch now', () => {
          picked.delete(p.key); renderBar();
          post('/api/launch', { project: p.project, items: [{ slug: p.slug, mode: modeOf(p) }] }).then(afterLaunch);
        }, 'primary');
        btn('📦 Archive plan → done/', () => archive(p), 'danger', moreWrap);
      }
    }
  } else {
    if (stt === 'live') {
      btn('📜 Log', log);
    } else if (stt === 'review') {
      btn('📜 Log', log); btn('🖥 Open in VS Code', vsc);
      btn('🗑 Clear run record', clean, 'danger', moreWrap);
      btn('📦 Archive plan → done/', () => archive(p), 'danger', moreWrap);
    } else if (stt === 'stuck') {
      btn('📜 Log', log);
      if ((p.launchers || []).length) btn('▶ Launch again', launchNow);
      btn('🖥 Open in VS Code', vsc, null, moreWrap);
      btn('🗑 Clear run record', clean, 'danger', moreWrap);
    } else { // fresh
      if ((p.launchers || []).length) btn('▶ Launch now', launchNow, 'primary');
      btn('🖥 Open in VS Code', vsc, null, moreWrap);
      btn('📦 Archive plan → done/', () => archive(p), 'danger', moreWrap);
    }
  }
  // "⋯ more" also unfolds status, tags and session history: the plan tab opens on the summary
  const showMore = (on) => {
    moreWrap.style.display = on ? 'inline-flex' : 'none';
    byId('morebox').hidden = !on;
    mb.textContent = on ? '⋯ less' : '⋯ more';
  };
  const mb = btn('⋯ more', () => {
    moreOpen.has(p.key) ? moreOpen.delete(p.key) : moreOpen.add(p.key);
    showMore(moreOpen.has(p.key));
  });
  A.appendChild(moreWrap);
  showMore(moreOpen.has(p.key));
  // AI session history: reopen-the-chat + independent-evaluation commands
  if (p.sessions && p.sessions.length) {
    const box = document.createElement('div');
    box.className = 'metabox';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'stretch';
    const last = p.sessions[p.sessions.length - 1];
    const addCmd = (label, cmd) => {
      const l = document.createElement('div'); l.className = 'dim'; l.style.marginTop = '6px';
      l.textContent = label; box.appendChild(l);
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.gap = '8px';
      const inp = document.createElement('input');
      inp.readOnly = true; inp.value = cmd; inp.style.flex = '1';
      inp.style.font = '12px ui-monospace,monospace';
      inp.addEventListener('focus', () => inp.select());
      const b = document.createElement('button'); b.textContent = 'copy';
      b.addEventListener('click', async () => {
        const ok = await copyText(cmd);
        b.textContent = ok ? '✓' : 'press ⌘C';
        if (!ok) { inp.focus(); inp.select(); }   // leave it selected to copy by hand
        setTimeout(() => (b.textContent = 'copy'), 1600);
      });
      row.appendChild(inp); row.appendChild(b); box.appendChild(row);
    };
    addCmd('Reopen the latest session with its full history (ask it why it did things):',
      'cd ' + p.wtPath + ' && claude --resume ' + last.id);
    addCmd('Independent evaluation of what it produced (fresh reviewer, diff + transcript cross-check):',
      'cd ' + p.wtPath + ' && claude "Critically evaluate the uncommitted work here, produced '
      + 'by an automated session for the plan ' + p.file + '. Review the full diff for correctness, '
      + 'convention compliance, and test honesty (do the claimed tests exist and pass?). Then '
      + 'cross-check the transcript at ' + p.transcriptDir + '/' + last.id + '.jsonl for skipped '
      + 'steps, unverified claims, or decisions that deviate from the plan. Report findings ranked by severity."');
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = '🧠 AI session history — ' + p.sessions.length + ' session(s), latest '
      + new Date(last.mtime).toLocaleString();
    det.appendChild(sum);
    det.appendChild(box);
    byId('sessbox').appendChild(det);
  }
  // full plan, folded under "Show the full plan", rendered as markdown
  if (loadPlan || !planCache[p.key])
    planCache[p.key] = await (await fetch('/api/plan?project=' + p.project + '&slug=' + p.slug)).text();
  const pm = byId('planmd');   // gone when another plan or tab opened while the text loaded
  if (pm && selected === p.key) pm.innerHTML = md(planCache[p.key]);
}

// --- pull request tabs: the PR on the plan's branch (auto/<slug>), its text and its diff ---
const prTab = {}, prData = {}, prDiff = {}, prFile = {}, prClosedDirs = {}, prNotes = {};
const moreOpen = new Set(), planOpen = new Set();   // plan tab: what the user unfolded, kept across repaints
// a run report's link to its own PR opens the PR tab here; any other link opens on the web
function openRunLink(p, url) {
  const same = (a, b) => String(a).replace(/\\/+$/, '') === String(b).replace(/\\/+$/, '');
  if (p && p.pr && same(p.pr.url, url)) {
    selected = p.key; prTab[p.key] = 'pr'; lastPrDraw = null;
    renderList(); renderDetail(true);
  } else window.open(url, '_blank', 'noopener');
}
let mergeMethod = null;
try { mergeMethod = localStorage.getItem('dash-merge-method'); } catch {}
// what the PR tab was last drawn from: a 5s poll with nothing new for it must not
// throw away the open file and the scroll position
let lastPrDraw = null;
const PR_CHIP = { OPEN: 'ok', MERGED: 'merged', CLOSED: 'bad' };
const prChip = (pr) => {
  const draft = pr.isDraft && pr.state === 'OPEN';
  return '<span class="chip ' + (draft ? '' : PR_CHIP[pr.state] || '') + '">' + (pr.state === 'MERGED' ? '✓ ' : '') + 'PR #' + pr.number + ' · ' +
    (draft ? 'draft' : String(pr.state).toLowerCase()) + '</span>';
};
let prViewed = {};   // PR url -> { path: hash of its diff } — a file changed since is unviewed again
try { prViewed = JSON.parse(localStorage.getItem('dash-pr-viewed') || '{}'); } catch {}
const saveViewed = () => { try { localStorage.setItem('dash-pr-viewed', JSON.stringify(prViewed)); } catch {} };
const isViewed = (p, f) => (prViewed[p.pr.url] || {})[f.path] === f.hash;
// a third mark next to viewed: "recheck" (⚑), a file to come back to. One file is unmarked,
// viewed or to recheck: flagging takes the viewed tick off, ticking viewed takes the flag off.
let prRecheck = {};   // PR url -> { path: true }
try { prRecheck = JSON.parse(localStorage.getItem('dash-pr-recheck') || '{}'); } catch {}
const saveRecheck = () => { try { localStorage.setItem('dash-pr-recheck', JSON.stringify(prRecheck)); } catch {} };
const isRecheck = (p, f) => !!(prRecheck[p.pr.url] || {})[f.path];
const marksText = (p, files) => {
  const k = files.filter((x) => isRecheck(p, x)).length;
  return files.filter((x) => isViewed(p, x)).length + ' / ' + files.length + ' viewed' + (k ? ' · ⚑ ' + k + ' to recheck' : '');
};
let diffSplit = true, diffFull = true;
try { diffSplit = localStorage.getItem('dash-diff-split') !== '0'; } catch {}
try { diffFull = localStorage.getItem('dash-diff-full') !== '0'; } catch {}

const prTabs = (p, tab) => !p.pr && !hasAsk(p) ? '' : '<div class="prtabs">' + [
  ['plan', 'Plan'],
  hasAsk(p) && ['ask', 'Ask'],
  p.pr && ['pr', 'Pull request <span class="n">#' + p.pr.number + '</span>'],
  p.pr && ['files', 'Files changed' + ((n) => n != null ? ' <span class="n">' + n + '</span>' : '')(
    prData[p.key] && prData[p.key].changedFiles != null ? prData[p.key].changedFiles : p.pr.changedFiles)],
].filter(Boolean).map(([id, label]) => '<button class="' + (id === tab ? 'on' : '') + '" data-tab="' + id + '">' + label + '</button>').join('') +
  '</div>';
function bindPrTabs(p) {
  byId('detail').querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => {
    prTab[p.key] = el.dataset.tab; lastPrDraw = null; renderDetail(false);
  }));
}
// --- Ask tab: talk to the Claude session that ran the plan (the server resumes it) ---
const hasAsk = (p) => !!((p.sessions && p.sessions.length) || p.asked);
let askCopy = false;   // "ask in a copy": remembered for every new chat
try { askCopy = localStorage.getItem('dash-ask-copy') === '1'; } catch {}
const askDraft = {}, askFresh = new Set(), askSeen = {};
async function renderAskTab(p, force) {
  const sig = p.key + 'ask';
  if (!force && lastPrDraw === sig && byId('askview')) return;
  lastPrDraw = sig;
  document.body.classList.remove('review');
  byId('detail').innerHTML =
    '<div class="crumb">' + esc(p.client) + ' / 📁 ' + esc(p.project) + '</div>' +
    '<h2 class="fname">' + p.file + '</h2><div class="subtitle">' + inline(p.title) + '</div>' +
    '<div class="prtabsrow">' + prTabs(p, 'ask') + '<span class="dim askwho" id="askwho"></span></div>' +
    '<div id="askview">' +
      '<div class="asklog" id="asklog" aria-live="polite"></div>' +
      '<div id="askdeny"></div>' +
      '<div class="askbox">' +
        '<textarea id="askin" rows="3" aria-label="Message for the agent" placeholder="Ask what it did and why, or tell it what to do next. Enter sends, Shift+Enter starts a new line."></textarea>' +
        '<div class="askrow">' +
          '<label title="The first question of a new chat makes a copy of the session and the chat goes on in the copy. The session the run wrote keeps only what the run did."><input type="checkbox" id="askcopy"' + (askCopy ? ' checked' : '') + '> Ask in a copy of the session</label>' +
          '<span style="flex:1"></span>' +
          '<button id="asknew" title="The next message starts again from the run’s latest session">New chat</button>' +
          '<button id="askstop" hidden>Stop</button>' +
          '<button id="askgo" class="primary">Send</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  bindPrTabs(p);
  const inp = byId('askin');
  inp.value = askDraft[p.key] || '';
  inp.addEventListener('input', () => { askDraft[p.key] = inp.value; });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askSend(p); }
  });
  byId('askgo').addEventListener('click', () => askSend(p));
  byId('askstop').addEventListener('click', () => post('/api/ask-stop', { project: p.project, slug: p.slug }));
  byId('askcopy').addEventListener('change', (e) => {
    askCopy = e.target.checked;
    try { localStorage.setItem('dash-ask-copy', askCopy ? '1' : '0'); } catch {}
    drawAskWho(p);
  });
  byId('asknew').addEventListener('click', () => { askFresh.add(p.key); drawAskWho(p); inp.focus(); });
  askSeen[p.key] = null;
  await drawAsk(p);
  if (lastPrDraw === sig) inp.focus();
}
async function askSend(p, text, allow) {
  const inp = byId('askin');
  const q = (text || inp.value).trim();
  if (!q) return;
  const r = await post('/api/ask', { project: p.project, slug: p.slug, text: q, allow,
    copy: askCopy, fresh: askFresh.has(p.key) });
  if (!r.ok) return;
  askFresh.delete(p.key);
  if (!text) { inp.value = ''; delete askDraft[p.key]; }
  drawAsk(p);
}
let askLast = {};   // plan key -> the last /api/ask answer
function drawAskWho(p) {
  const el = byId('askwho');
  if (!el) return;
  const st = askLast[p.key] || {}, cur = st.current;
  const latest = (p.sessions || []).slice(-1)[0];
  const short = (id) => String(id || '').slice(0, 8);
  el.textContent = cur && !askFresh.has(p.key)
    ? (cur.copy ? 'Chat in a copy of session ' + short(cur.base) : 'Chat in the run’s session ' + short(cur.id))
    : latest ? 'The next message starts a chat in ' + (askCopy ? 'a copy of ' : '') + 'session ' + short(latest.id)
    : 'No session to resume';
}
async function drawAsk(p) {
  const sig = lastPrDraw;
  let st;
  try { st = await (await fetch('/api/ask?project=' + p.project + '&slug=' + p.slug)).json(); }
  catch { st = null; }
  if (lastPrDraw !== sig || !byId('askview')) return;
  if (st) {
    askLast[p.key] = st;
    const raw = JSON.stringify(st);
    if (askSeen[p.key] !== raw) {
      askSeen[p.key] = raw;
      paintAsk(p, st);
    }
  }
  drawAskWho(p);
  if (st && st.running) setTimeout(() => { if (lastPrDraw === sig) drawAsk(p); }, 1500);
}
function paintAsk(p, st) {
  const L = byId('asklog');
  const atEnd = L.scrollHeight - L.scrollTop - L.clientHeight < 60;
  const out = [];
  for (const it of st.items) {
    if (it.who === 'you') {
      if (it.fresh) out.push('<div class="anew">New chat in ' + (it.copy ? 'a copy of ' : 'the run’s ') +
        'session ' + esc(String(it.session || '').slice(0, 8)) + (it.at ? ' · ' + new Date(it.at).toLocaleString() : '') + '</div>');
      out.push('<div class="amsg you">' + esc(it.text) +
        (it.allowed ? '<div class="dim aallow">allowed: ' + it.allowed.map(esc).join(', ') + '</div>' : '') + '</div>');
    } else if (it.who === 'agent') out.push('<div class="amsg agent mdc">' + md(it.text) + '</div>');
    else if (it.who === 'tool') out.push('<div class="atool">' + esc(it.text) + '</div>');
    else if (it.who === 'end') out.push('<div class="aend' + (it.ok ? '' : ' bad') + '">' +
      (it.ok ? '' : esc(it.subtype || 'stopped') + ' · ') +
      (it.blocked ? it.blocked + ' blocked · ' : '') + (it.cost != null ? '$' + it.cost.toFixed(2) : '') + '</div>');
    else out.push('<div class="aend bad">' + esc(it.text) + '</div>');
  }
  if (st.running) out.push('<div class="aend">working…</div>');
  L.innerHTML = out.join('') || '<div class="dim askempty">Ask the agent that ran this plan. It remembers the plan, ' +
    'the files it read and what it decided, so you can ask why it did something. It can also work here, for ' +
    'example: <i>merge develop into this branch</i>. A command it is not allowed to run shows up below, ' +
    'and you choose whether to allow it.</div>';
  if (atEnd || st.running) L.scrollTop = L.scrollHeight;
  byId('askgo').hidden = st.running;
  byId('askstop').hidden = !st.running;
  const D = byId('askdeny');
  D.innerHTML = '';
  if (st.denied && st.denied.length) {
    D.innerHTML = '<div class="askdeny"><b>The agent was not allowed to run:</b>' +
      st.denied.map((d) => '<div><code>' + esc(d.what || d.tool) + '</code></div>').join('') +
      '<button id="askallow" class="primary">Allow for this chat and ask again</button></div>';
    byId('askallow').addEventListener('click', () => askSend(p,
      'I allowed what was blocked. Please try again.', st.denied.flatMap((d) => d.rules)));
  }
}
async function loadPr(p) {
  const r = await (await fetch('/api/pr?project=' + p.project + '&number=' + p.pr.number)).json();
  prData[p.key] = r.ok ? { ...r.pr, from: JSON.stringify(p.pr) } : { error: r.output || r.error, from: JSON.stringify(p.pr) };
}
async function renderPrTab(p, tab, force) {
  // a new PR or a new commit redraws the tab; a state change (draft, ready, merged) only the bar
  // and the PR text, so Ready for review does not reload the diff
  const sig = p.key + tab + p.pr.number + p.pr.head;
  if (!force && lastPrDraw === sig && byId('prview')) {
    if (prData[p.key] && prData[p.key].from !== JSON.stringify(p.pr)) {
      // after an action here the tab already shows the new state: draw only what GitHub changed since
      const was = JSON.stringify({ ...prData[p.key], from: 0 });
      await loadPr(p);
      if (lastPrDraw !== sig || JSON.stringify({ ...prData[p.key], from: 0 }) === was) return;
      drawBarAction(p, tab);
      if (tab === 'pr' && byId('prbody')) drawPr(p);
    }
    return;
  }
  lastPrDraw = sig;
  // only Files changed needs the whole window; the Pull request tab keeps the normal layout
  const review = tab === 'files';
  document.body.classList.toggle('review', review);
  byId('detail').innerHTML = (review ? \`
    <div class="rbar"><button id="rback" title="back to the plan and the plan list (Esc)">‹ Plan <kbd>Esc</kbd></button>
      <span class="rname" title="\${escA(p.client + ' / ' + p.project + ' / ' + p.file)}">\${esc(p.slug)}</span>
      \${prTabs(p, tab)}<span class="seen" id="rseen"></span><span style="flex:1"></span>
      <span class="btns" id="ract"></span></div>\` : \`
    <div class="crumb">\${esc(p.client)} / 📁 \${esc(p.project)}</div>
    <h2 class="fname">\${p.file}</h2>
    <div class="subtitle">\${inline(p.title)}</div>
    <div class="prtabsrow">\${prTabs(p, tab)}<span class="btns" id="ract"></span></div>\`) + \`
    <div id="prview" class="dim" style="padding:16px 24px">loading PR #\${p.pr.number}…</div>\`;
  if (review) byId('rback').addEventListener('click', () => { prTab[p.key] = 'plan'; renderDetail(false); });
  bindPrTabs(p);
  const d = prData[p.key];
  if (force || !d || d.from !== JSON.stringify(p.pr)) await loadPr(p);
  if (lastPrDraw !== sig) return;   // another plan or tab was opened meanwhile
  drawBarAction(p, tab);
  if (tab === 'pr') drawPr(p);
  else await drawFiles(p, force);
}
// the one next step, always on the right of the bar: Ready for review, then Merge
function drawBarAction(p, tab) {
  const d = prData[p.key], R = byId('ract');
  if (!R || !d || d.error) return;
  // the PR's state, then GitHub, then the one next step
  R.innerHTML = prChip(d) + '<a class="ghbtn" href="' + escA(d.url) + '" target="_blank" rel="noopener" ' +
    'title="Open the PR on GitHub">↗ GitHub</a>';
  // the PR list is read once a minute; after a push this reads it, the PR and the diff now
  const rf = document.createElement('button');
  rf.textContent = '⟳'; rf.className = 'rfbtn'; rf.title = 'Reload the PR from GitHub, for example after a push';
  rf.setAttribute('aria-label', 'Reload the PR from GitHub');
  rf.addEventListener('click', async () => {
    rf.disabled = true; rf.textContent = '⟳ …';
    await fetch('/api/pr-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: p.project, slug: p.slug }) }).catch(() => {});
    while (ticking) await new Promise((r) => setTimeout(r, 100));
    const before = lastPrDraw;
    await refresh();   // a new head commit redraws the tab from here already
    if (lastPrDraw === before) { lastPrDraw = null; renderDetail(true); }
  });
  R.appendChild(rf);
  if (d.state !== 'OPEN') return;
  const b = document.createElement('button');
  if (d.isDraft) {
    b.textContent = 'Ready for review'; b.className = 'primary';
    b.addEventListener('click', () => { b.disabled = true; prAct(p, { action: 'ready' }); });
  } else {
    b.textContent = 'Merge…'; b.className = 'merge';
    b.addEventListener('click', () => {
      const go = () => { const m = byId('mbox'); if (m) { m.scrollIntoView({ block: 'center' }); m.classList.add('flash'); byId('mmethod')?.focus(); } };
      if (tab === 'pr') return go();
      prTab[p.key] = 'pr'; lastPrDraw = null;
      renderDetail(false).then(go);
    });
  }
  R.appendChild(b);
}
// what GitHub said when it refused, shown in the PR tab until the next action
const prErr = {};
async function prAct(p, data) {
  let r;
  try {
    r = await (await fetch('/api/pr-action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: p.project, slug: p.slug, number: p.pr.number, ...data }) })).json();
  } catch (e) { r = { output: String((e && e.message) || e) }; }
  prErr[p.key] = r.ok ? null : { action: data.action, text: r.output || r.error || 'no message from gh' };
  if (!r.ok && !byId('prbody')) alert('⚠️ GitHub refused: ' + prErr[p.key].text);
  if (r.notes) prNotes[p.key] = r.notes;
  await loadPr(p);
  drawBarAction(p, prTab[p.key]);
  if (byId('prbody')) drawPr(p);
  refresh();
}
async function closePr(p) {
  const d = prData[p.key];
  if (!confirm('Close PR #' + d.number + ' without merging?\\n\\n' + d.title)) return;
  const deleteBranch = p.worktree
    ? (alert('The branch ' + d.headRefName + ' stays: the run\\u2019s worktree still uses it. Clean up run removes both.'), false)
    : confirm('Also delete the branch ' + d.headRefName + ' on GitHub and on this Mac?\\n\\nOK = delete · Cancel = keep the branch');
  await prAct(p, { action: 'close', deleteBranch });
}
function drawPr(p) {
  const d = prData[p.key], v = byId('prview');
  if (!v) return;
  if (d.error) { v.innerHTML = '<div class="metabox">⚠️ ' + esc(d.error) + '</div>'; return; }
  const open = d.state === 'OPEN', c = d.checks;
  v.className = 'pvpr';
  v.style.padding = '';
  // what GitHub checks before a merge, one plain line each; only draft and conflicts block here
  const lines = [], warns = [];
  const line = (cls, ic, html, warn) => { lines.push('<div class="mline ' + cls + '"><span class="ic">' + ic + '</span><span>' + html + '</span></div>'); if (warn) warns.push(warn); };
  if (open) {
    if (d.isDraft) line('warn', '!', '<b>Draft</b> · mark it ready for review first');
    if (c.failed.length) line('bad', '✕', '<b>' + c.failed.length + ' check' + (c.failed.length > 1 ? 's' : '') + ' failed:</b> ' +
      esc(c.failed.join(', ')) + (c.passed ? ' <span class="dim">· ' + c.passed + ' passed</span>' : ''), c.failed.join(', ') + ' failed');
    else if (c.running) line('warn', '●', '<b>' + c.running + ' check' + (c.running > 1 ? 's' : '') + ' still running</b>' +
      (c.passed ? ' <span class="dim">· ' + c.passed + ' passed</span>' : ''), c.running + ' checks still running');
    else if (c.passed) line('ok', '✓', 'All ' + c.passed + ' checks passed');
    if (d.reviewDecision === 'APPROVED') line('ok', '✓', 'Approved');
    else if (d.reviewDecision === 'CHANGES_REQUESTED') line('bad', '✕', '<b>Changes requested</b>', 'changes were requested');
    else if (d.reviewDecision === 'REVIEW_REQUIRED') line('warn', '!', '<b>Review required</b> <span class="dim">· nobody has approved yet</span>', 'nobody has approved');
    if (d.mergeable === 'CONFLICTING') line('bad', '✕', '<b>Conflicts with ' + esc(d.baseRefName) + '</b> · resolve them in the worktree, then push');
    else if (d.mergeable === 'MERGEABLE') line('ok', '✓', 'No conflicts with <code>' + esc(d.baseRefName) + '</code>');
    else line('dim', '…', 'GitHub is still checking for conflicts');
  }
  // GitHub's own verdict: BLOCKED means a branch rule is not met (usually a required approval)
  const rules = open && !d.isDraft && d.mergeable !== 'CONFLICTING' && d.mergeStateStatus === 'BLOCKED';
  const admin = !!(d.merge && d.merge.admin);
  if (rules) line('bad', '✕', '<b>GitHub blocks the merge</b> · ' + (d.reviewDecision === 'REVIEW_REQUIRED'
    ? 'the branch rules need an approving review' : c.failed.length || c.running ? 'the branch rules need the checks to pass'
    : 'a branch rule is not met yet') + (admin ? '' : '. Ask someone to approve it on GitHub.'));
  const blocked = d.isDraft || d.mergeable === 'CONFLICTING';
  const methods = (d.merge && d.merge.methods.length) ? d.merge.methods : ['merge'];
  const pick = methods.includes(mergeMethod) ? mergeMethod : methods.includes(d.merge && d.merge.default) ? d.merge.default : methods[0];
  const LABEL = { merge: 'Merge commit', squash: 'Squash and merge', rebase: 'Rebase and merge' };
  const notes = prNotes[p.key], err = prErr[p.key];
  v.innerHTML =
    (err ? '<div class="merr" role="alert"><b>GitHub refused' + (err.action === 'merge' ? ' the merge' : '') + ':</b> ' +
      esc(err.text) + '</div>' : '') +
    (d.state === 'MERGED' && notes ? '<div class="mergednote"><b>Merged into ' + esc(d.baseRefName) + '.</b>' +
      notes.map((n) => '<div>' + esc(n) + '</div>').join('') + '</div>' : '') +
    '<div class="prhead">' +
    '<div class="row">' + prChip(d) + '<b class="prtitle">' + esc(d.title) + '</b><span class="dim">#' + d.number + '</span></div>' +
    '<div class="row dim"><span><code>' + esc(d.baseRefName) + '</code> ← <code>' + esc(d.headRefName) + '</code></span>' +
      '<span class="add">+' + d.additions + '</span><span class="del">−' + d.deletions + '</span>' +
      '<span>' + d.changedFiles + ' files · ' + d.commits + ' commits</span>' +
      '<span style="flex:1"></span><span class="btns" id="practs"></span></div></div>' +
    (open ? '<div class="mbox" id="mbox">' + lines.join('') + '<div class="mfoot">' + (blocked
      ? '<span class="dim">' + (d.isDraft ? 'A draft cannot be merged. Use Ready for review in the bar above.' : 'Fix the conflicts first.') + '</span>'
      : rules && !admin ? '<span class="dim">It can be merged once GitHub allows it.</span>'
      : '<select id="mmethod" aria-label="merge method">' + methods.map((m) => '<option value="' + m + '"' + (m === pick ? ' selected' : '') + '>' + LABEL[m] + '</option>').join('') + '</select>' +
        '<label><input type="checkbox" id="mdel" checked> Delete the branch on GitHub</label><span style="flex:1"></span>' +
        (rules ? '<label title="You are an admin of this repo: gh pr merge --admin"><input type="checkbox" id="madmin"> Merge as admin, past the branch rules</label>' : '') +
        '<button class="merge" id="mgo"' + (rules ? ' disabled' : '') + '>Merge into ' + esc(d.baseRefName) + '</button>') + '</div></div>' : '') +
    '<div class="mdc prbody" id="prbody"></div>';
  const A = byId('practs');
  const btn = (label, fn, cls, parent) => {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls;
    b.addEventListener('click', () => { A.querySelectorAll('button').forEach((x) => (x.disabled = true)); fn(); });
    (parent || A).appendChild(b);
    return b;
  };
  btn('↗ Open on GitHub', () => { window.open(d.url, '_blank', 'noopener'); drawPr(p); }, 'linkbtn');
  if (open) {
    // rarely needed: behind "⋯"
    const more = document.createElement('span');
    more.style.cssText = 'display:none;gap:8px';
    const mb = btn('⋯', () => { more.style.display = 'inline-flex'; mb.remove(); A.querySelectorAll('button').forEach((x) => (x.disabled = false)); });
    mb.title = 'Close PR, back to draft';
    if (!d.isDraft) btn('Back to draft', () => prAct(p, { action: 'draft' }), null, more);
    btn('Close PR', () => closePr(p).then(() => drawPr(p)), 'danger', more);
    A.appendChild(more);
  }
  const go = byId('mgo'), adm = byId('madmin');
  if (adm) adm.addEventListener('change', () => { go.disabled = !adm.checked; });
  if (go) go.addEventListener('click', async () => {
    const method = byId('mmethod').value, del = byId('mdel').checked, asAdmin = !!(adm && adm.checked);
    if (!confirm('Merge PR #' + d.number + ' into ' + d.baseRefName + ' (' + LABEL[method].toLowerCase() + ')' +
      (asAdmin ? ' as admin, past the branch rules' : '') + '?' +
      (warns.length ? '\\n\\nWarnings: ' + warns.join('; ') + '.' : '') +
      '\\n\\nAfter the merge, ' + d.baseRefName + ' is pulled in ' + p.project + ' (fast-forward only, not in the worktree).')) return;
    mergeMethod = method;
    try { localStorage.setItem('dash-merge-method', method); } catch {}
    go.disabled = true; go.textContent = 'Merging…';
    await prAct(p, { action: 'merge', method, deleteBranch: del, head: d.headRefOid, admin: asAdmin });
  });
  // GitHub task lists: each box writes the description back, like ticking it on github.com
  let n = 0;
  // drop HTML comments, e.g. the decision-sheet markers
  const src = (d.body || '').replace(/<!-{2}[\\s\\S]*?-{2}>/g, '');
  byId('prbody').innerHTML = src.trim()
    ? md(src, true).replace(/<li>\\[([ xX])\\] /g, (m, x) => '<li class="task"><input type="checkbox" aria-label="I agree" data-task="' + (n++) + '"' +
        (x === ' ' ? '' : ' checked') + (open ? '' : ' disabled') + '>')
    : '<p class="dim">No description.</p>';
  byId('prbody').querySelectorAll('[data-task]').forEach((el) => el.addEventListener('change', () => {
    byId('prbody').querySelectorAll('[data-task]').forEach((x) => (x.disabled = true));
    prAct(p, { action: 'task', index: +el.dataset.task, count: n, was: !el.checked });
  }));
}
// unified diff (gh pr diff) -> [{ path, st: M|A|D|R, hunks: [{ head, lines: [[kind, old, new, text]] }] }]
function parseDiff(txt) {
  const files = []; let f = null, h = null, o = 0, nn = 0, body = [];
  const done = () => { if (f) { f.hash = hashStr(body.join('\\n')); body = []; } };
  for (const line of txt.split('\\n')) {
    if (line.startsWith('diff --git ')) {
      done();
      f = { path: line.slice(line.lastIndexOf(' b/') + 3), st: 'M', hunks: [], add: 0, del: 0, n: 0 };
      files.push(f); h = null; continue;
    }
    if (!f) continue;
    if (!h) {
      if (line.startsWith('new file mode')) f.st = 'A';
      else if (line.startsWith('deleted file mode')) f.st = 'D';
      else if (line.startsWith('rename to ')) { f.st = 'R'; f.path = line.slice(10); }
      else if (line.startsWith('Binary files')) f.binary = true;
    }
    const m = line.match(/^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@/);
    if (m) { h = { head: line, lines: [], o: +m[1], n: +m[2] }; f.hunks.push(h); o = +m[1]; nn = +m[2]; body.push(line); continue; }
    if (!h) continue;
    const k = line[0];
    if (k === '+') { h.lines.push(['+', null, nn++, line.slice(1)]); f.add++; }
    else if (k === '-') { h.lines.push(['-', o++, null, line.slice(1)]); f.del++; }
    else if (k === ' ') h.lines.push([' ', o++, nn++, line.slice(1)]);
    else continue;   // "\\ No newline at end of file"
    f.n++; body.push(line);
  }
  done();
  return files;
}
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const KIND = { '+': 'a', '-': 'd', ' ': '' };
// the whole file: the head version's unchanged lines around the hunks, as one hunk with no header
function fullHunks(f, text) {
  const lines = text.split('\\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out = [];
  let nn = 1, delta = 0;   // delta = old line number minus new, for unchanged lines
  const same = (upTo) => { for (; nn < upTo; nn++) out.push([' ', nn + delta, nn, lines[nn - 1]]); };
  for (const hk of f.hunks) {
    // a side with 0 lines ("-10,0" or "+12,0") names the line before the change, not the first one
    const oldN = hk.lines.filter((l) => l[1] != null).length, newN = hk.lines.filter((l) => l[2] != null).length;
    same(newN ? hk.n : hk.n + 1);
    out.push(...hk.lines);
    nn = newN ? hk.n + newN : hk.n + 1;
    delta = (oldN ? hk.o + oldN : hk.o + 1) - nn;
  }
  same(lines.length + 1);
  return [{ head: null, lines: out }];
}
function diffHtml(f) {
  const cell = (cls, num, t) => '<td class="ln ' + cls + '">' + (num == null ? '' : num) + '</td><td class="' + cls + '">' +
    esc(t == null ? '' : t) + '</td>';
  // fixed layout takes its widths from the first row, a colspan hunk header — so set them here
  let h = (diffSplit ? '<div class="dwrap">' : '') +
    '<table class="dtab' + (diffSplit ? ' split' : '') + '"><colgroup>' +
    (diffSplit ? '<col class="lnc"><col class="dlc"><col class="lnc"><col>' : '<col class="lnc"><col class="lnc"><col>') + '</colgroup>';
  for (const hk of f.hunks) {
    if (hk.head) h += '<tr class="hk"><td colspan="' + (diffSplit ? 4 : 3) + '">' + esc(hk.head) + '</td></tr>';
    if (!diffSplit) {
      for (const [k, o, nw, t] of hk.lines)
        h += '<tr><td class="ln ' + KIND[k] + '">' + (o == null ? '' : o) + '</td>' + cell(KIND[k], nw, t) + '</tr>';
      continue;
    }
    // side by side: a run of removed lines sits next to the run of added lines after it
    let dels = [], adds = [];
    const flush = () => {
      for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
        const a = dels[j], b = adds[j];
        h += '<tr>' + (a ? cell('d', a[1], a[3]) : cell('e')) + (b ? cell('a', b[2], b[3]) : cell('e')) + '</tr>';
      }
      dels = []; adds = [];
    };
    for (const l of hk.lines) {
      if (l[0] === '-') { if (adds.length) flush(); dels.push(l); }
      else if (l[0] === '+') adds.push(l);
      else { flush(); h += '<tr>' + cell('', l[1], l[3]) + cell('', l[2], l[3]) + '</tr>'; }
    }
    flush();
  }
  return h + '</table>' + (diffSplit ? '<div class="dsplit" role="separator" aria-orientation="vertical" tabindex="0" ' +
    'aria-label="Divider between the two sides" title="Drag to resize the two sides. Double-click: equal halves."></div></div>' : '');
}
// Two dividers in Files changed, both dragged, both remembered in this browser: the file
// list's right edge (its width in px) and the line between the two sides of a diff (the
// share of the width the old side gets). A fixed-layout table ignores a calc() column
// width, so the diff's columns are sized in px here and again whenever its box resizes.
let diffRatio = 0.5, treeWidth = 0;
try { diffRatio = Math.min(0.85, Math.max(0.15, +localStorage.getItem('dash-diff-ratio') || 0.5)); } catch {}
try { treeWidth = +localStorage.getItem('dash-tree-w') || 0; } catch {}
const layoutSplit = (w) => {
  const ln = w.querySelector('td.ln'), col = w.querySelector('col.dlc'), bar = w.querySelector('.dsplit');
  if (!col || !bar) return;
  const g = ln ? ln.offsetWidth : 46, room = w.clientWidth - 2 * g;
  col.style.width = Math.round(room * diffRatio) + 'px';
  bar.style.left = Math.round(g + room * diffRatio) + 'px';
};
const splitObs = new ResizeObserver((es) => es.forEach((e) => layoutSplit(e.target)));
new MutationObserver(() => document.querySelectorAll('.dwrap:not([data-obs])').forEach((w) => {
  w.dataset.obs = '1'; splitObs.observe(w);
})).observe(document.body, { childList: true, subtree: true });
const setDiffRatio = (r, save) => {
  diffRatio = Math.round(Math.min(0.85, Math.max(0.15, r)) * 1000) / 1000;
  document.querySelectorAll('.dwrap').forEach(layoutSplit);
  if (save) try { localStorage.setItem('dash-diff-ratio', diffRatio); } catch {}
};
const setTreeWidth = (px, save) => {
  const t = byId('ptree');
  if (!t) return;
  t.style.width = px ? Math.round(Math.max(200, Math.min(px, window.innerWidth * 0.6))) + 'px' : '';
  treeWidth = px ? t.offsetWidth : 0;
  if (save) try { treeWidth ? localStorage.setItem('dash-tree-w', treeWidth) : localStorage.removeItem('dash-tree-w'); } catch {}
};
const dividerOf = (el) => el && el.closest && el.closest('.dsplit, .tsplit');
document.addEventListener('pointerdown', (e) => {
  const bar = dividerOf(e.target);
  if (!bar) return;
  e.preventDefault();
  const diff = bar.classList.contains('dsplit');
  const move = diff ? (ev) => {
    const w = bar.parentElement, r = w.getBoundingClientRect(), ln = w.querySelector('td.ln');
    const g = ln ? ln.offsetWidth : 46;
    setDiffRatio((ev.clientX - r.left - g) / (r.width - 2 * g));
  } : (ev) => setTreeWidth(ev.clientX - byId('ptree').getBoundingClientRect().left);
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.body.classList.remove('dragging'); bar.classList.remove('on');
    diff ? setDiffRatio(diffRatio, true) : setTreeWidth(treeWidth, true);
  };
  document.body.classList.add('dragging'); bar.classList.add('on');
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
});
document.addEventListener('dblclick', (e) => {
  const bar = dividerOf(e.target);
  if (bar) bar.classList.contains('dsplit') ? setDiffRatio(0.5, true) : setTreeWidth(0, true);
});
document.addEventListener('keydown', (e) => {
  const bar = dividerOf(e.target);
  if (!bar || !/^Arrow(Left|Right)$/.test(e.key)) return;
  e.preventDefault();
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  bar.classList.contains('dsplit') ? setDiffRatio(diffRatio + d * 0.05, true)
    : setTreeWidth(byId('ptree').offsetWidth + d * 40, true);
});
async function drawFiles(p, force) {
  const sig = lastPrDraw;
  let df = prDiff[p.key];
  if (force || !df || df.from !== JSON.stringify(p.pr)) {
    const r = await (await fetch('/api/pr-diff?project=' + p.project + '&number=' + p.pr.number)).json();
    df = prDiff[p.key] = r.ok ? { files: parseDiff(r.diff), from: JSON.stringify(p.pr) }
      : { error: r.output || r.error, from: JSON.stringify(p.pr) };
  }
  if (lastPrDraw !== sig) return;
  drawFilesView(p);
}
// --- VS Code's diff view: Monaco, the editor inside VS Code, loaded from a CDN the first time
// Files changed opens. It gets the whole file at both sides, rebuilt from the head version and
// the diff (fullHunks), so no second gh call. Offline it fails once and the table above stays.
const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
let monaco = null, monacoLoad = null, monacoFailed = false, monoEd = null;
function loadMonaco() {
  if (monacoLoad) return monacoLoad;
  // the workers come from the CDN too; a data: URL lets them start from this page's origin
  window.MonacoEnvironment = { getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(
    'self.MonacoEnvironment={baseUrl:"' + MONACO + '/"};importScripts("' + MONACO + '/vs/base/worker/workerMain.js");') };
  monacoLoad = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('timeout')), 20000);
    const sc = document.createElement('script');
    sc.src = MONACO + '/vs/loader.js';
    sc.onerror = reject;
    sc.onload = () => {
      window.require.config({ paths: { vs: MONACO + '/vs' } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    document.head.appendChild(sc);
  }).then((m) => {
    monaco = m;
    // a lone file has no project around it: type errors would be false alarms
    for (const d of [m.languages.typescript.typescriptDefaults, m.languages.typescript.javascriptDefaults])
      d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
    monoTheme();
    return m;
  }, (e) => { monacoFailed = true; throw e; });
  return monacoLoad;
}
// VS Code's Dark+ / Light+ colours on the dashboard's own background
function monoTheme() {
  const css = getComputedStyle(document.documentElement), light = document.documentElement.dataset.theme === 'light';
  const bg = css.getPropertyValue('--codebg').trim();
  monaco.editor.defineTheme('dash', { base: light ? 'vs' : 'vs-dark', inherit: true, rules: [],
    colors: bg ? { 'editor.background': bg, 'editorGutter.background': bg } : {} });
  monaco.editor.setTheme('dash');
}
const monoLang = (file) => {
  const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const l = monaco.languages.getLanguages().find((x) =>
    (x.filenames || []).some((f) => f.toLowerCase() === name) || (ext && (x.extensions || []).includes(ext)));
  return l ? l.id : 'plaintext';
};
function mountMonaco(cur, keepTop) {
  const rows = (cur.full || cur.hunks).flatMap((h) => h.lines);
  const text = (skip) => rows.filter((l) => l[0] !== skip).map((l) => l[3]).join('\\n');
  const lang = monoLang(cur.path);
  const models = [monaco.editor.createModel(text('+'), lang), monaco.editor.createModel(text('-'), lang)];
  const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1;
  const ed = monaco.editor.createDiffEditor(byId('mono'), {
    readOnly: true, originalEditable: false, automaticLayout: true, renderSideBySide: diffSplit,
    useInlineViewWhenSpaceIsLimited: false, hideUnchangedRegions: { enabled: !diffFull },
    wordWrap: 'on', diffWordWrap: 'on', scrollBeyondLastLine: false, fontSize: Math.round(12 * fs),
    minimap: { enabled: true }, renderOverviewRuler: true, ignoreTrimWhitespace: false,
  });
  ed.setModel({ original: models[0], modified: models[1] });
  monoEd = { dispose: () => ed.dispose(), models, getModifiedEditor: () => ed.getModifiedEditor() };
  // first diff: a new file opens at its first change, a repaint where it was
  const once = ed.onDidUpdateDiff(() => {
    once.dispose();
    const m = ed.getModifiedEditor();
    if (keepTop != null) return m.setScrollTop(keepTop);
    const c = (ed.getLineChanges() || [])[0];
    if (c) m.revealLineNearTop(Math.max(1, c.modifiedStartLineNumber || c.modifiedEndLineNumber || 1));
  });
}
// Overview ruler at the right of a diff, like VS Code's scrollbar: a mark for every run of
// removed (left half) and added (right half) lines at its place in the file, and a box for
// the part on screen. Click or drag on it to scroll there.
const diffShown = {};   // plan key -> the file and layout last opened, so a repaint keeps the scroll
const rulerObs = new ResizeObserver((es) => es.forEach((e) => e.target._ruler && e.target._ruler()));
function bindRuler(body, ruler) {
  const tab = body.querySelector('.dtab');
  const view = document.createElement('div');
  view.className = 'dview';
  const paint = () => {
    if (!ruler.isConnected) return;
    const H = ruler.clientHeight, total = body.scrollHeight;
    const t0 = body.getBoundingClientRect().top - body.scrollTop;   // where the content's top is now
    const marks = [];
    let last = {};
    for (const td of tab.querySelectorAll('td.ln.a, td.ln.d')) {
      const side = td.classList.contains('a') ? 'a' : 'd';
      const r = td.getBoundingClientRect();
      const top = (r.top - t0) / total * H, h = Math.max(2, r.height / total * H);
      const m = last[side];
      if (m && top <= m.top + m.h + 1) m.h = Math.max(m.h, top + h - m.top);
      else marks.push(last[side] = { side, top, h });
    }
    ruler.innerHTML = marks.map((m) => '<i class="' + m.side + '" style="top:' + m.top.toFixed(1) + 'px;height:' +
      m.h.toFixed(1) + 'px"></i>').join('');
    ruler.appendChild(view);
    place();
  };
  const place = () => {
    const H = ruler.clientHeight, total = body.scrollHeight;
    view.style.top = (body.scrollTop / total * H) + 'px';
    view.style.height = Math.max(8, body.clientHeight / total * H) + 'px';
  };
  const go = (e) => {
    const r = ruler.getBoundingClientRect();
    body.scrollTop = (e.clientY - r.top) / r.height * body.scrollHeight - body.clientHeight / 2;
  };
  body.addEventListener('scroll', place, { passive: true });
  ruler.addEventListener('pointerdown', (e) => {
    e.preventDefault(); go(e);
    ruler.setPointerCapture(e.pointerId);
    const mv = (ev) => go(ev);
    ruler.addEventListener('pointermove', mv);
    ruler.addEventListener('pointerup', () => ruler.removeEventListener('pointermove', mv), { once: true });
  });
  tab._ruler = paint; body._ruler = paint;
  rulerObs.observe(tab); rulerObs.observe(body);
  paint();
}
function drawFilesView(p) {
  const v = byId('prview'), df = prDiff[p.key];
  if (!v || !df) return;
  v.className = 'pvfiles';
  v.style.padding = '';
  if (df.error) {
    v.innerHTML = '<div class="metabox">⚠️ ' + esc(df.error) + '</div>';
    return;
  }
  const files = df.files;
  const cur = files.find((f) => f.path === prFile[p.key]) || files[0];
  if (!cur) { v.innerHTML = '<span class="dim">No changed files.</span>'; return; }
  prFile[p.key] = cur.path;
  syncUrl();
  const treeTop = byId('ptree') ? byId('ptree').scrollTop : 0;
  const treeW = byId('ptree') ? byId('ptree').style.width : '';   // a width dragged by hand
  // folder tree like VS Code's: folders first, a folder with one subfolder and no files
  // shares its row ("domains/ai"), and a folder's box ticks every file under it
  const closed = prClosedDirs[p.key] = prClosedDirs[p.key] || new Set();
  const root = { dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (const d of parts.slice(0, -1)) node = node.dirs[d] = node.dirs[d] || { dirs: {}, files: [] };
    node.files.push(f);
  }
  const under = (node) => [...node.files, ...Object.values(node.dirs).flatMap(under)];
  let tree = '';
  const walk = (node, prefix, depth) => {
    for (let name of Object.keys(node.dirs).sort()) {
      let d = node.dirs[name];
      while (!d.files.length && Object.keys(d.dirs).length === 1) {
        const only = Object.keys(d.dirs)[0];
        name += '/' + only; d = d.dirs[only];
      }
      const full = prefix + name, all = under(d), nSeen = all.filter((f) => isViewed(p, f)).length;
      tree += '<div class="pf" tabindex="0" style="--d:' + depth + '" data-dir="' + escA(full) + '">' +
        '<span class="chev">' + (closed.has(full) ? '▸' : '▾') + '</span>' +
        '<input type="checkbox" tabindex="-1" aria-label="mark the folder as viewed" data-seendir="' + escA(full) + '"' + (nSeen === all.length ? ' checked' : '') +
        (nSeen && nSeen < all.length ? ' data-some="1"' : '') + ' title="mark everything in this folder as viewed">' +
        '<span class="nm">' + esc(name) + '</span></div>';
      if (!closed.has(full)) walk(d, full + '/', depth + 1);
    }
    for (const f of node.files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
      const seen = isViewed(p, f);
      tree += '<div class="pf ' + f.st + (f === cur ? ' on' : '') + (isRecheck(p, f) ? ' rk' : '') + '" tabindex="0" style="--d:' + depth + '" data-file="' +
        escA(f.path) + '" title="' + escA(f.path) + '"><span class="chev"></span>' +
        '<input type="checkbox" tabindex="-1" aria-label="viewed" data-seen="' + escA(f.path) + '"' + (seen ? ' checked' : '') + ' title="viewed">' +
        '<span class="nm">' + esc(f.path.slice(f.path.lastIndexOf('/') + 1)) + '</span>' +
        '<button class="flag" tabindex="-1" data-flag="' + escA(f.path) + '" aria-pressed="' + isRecheck(p, f) + '" ' +
          'title="Recheck this file later (F)" aria-label="recheck later">⚑</button>' +
        '<span class="fst ' + f.st + '">' + f.st + '</span></div>';
    }
  };
  walk(root, '', 0);
  const nSeen = files.filter((f) => isViewed(p, f)).length;
  // VS Code's diff view (Monaco) when it loads; our own table is the fallback (offline, binary)
  const mono = !monacoFailed && !cur.binary && cur.hunks.length > 0 && !(cur.full === null && cur.fullErr);
  if (mono && !monaco) loadMonaco().then(() => {}, () => {}).then(() => { if (prFile[p.key] === cur.path && byId('ptree')) drawFilesView(p); });
  const big = !mono && cur.n > 3000 && !cur.show;
  // whole file: added and deleted files are whole in the diff already; others need the head version
  const wantFull = (mono || diffFull) && cur.hunks.length && !big && (cur.st === 'M' || cur.st === 'R');
  if (wantFull && cur.full === undefined && !cur.loading) {
    cur.loading = true;
    fetch('/api/pr-file?project=' + p.project + '&sha=' + p.pr.head + '&path=' + encodeURIComponent(cur.path))
      .then((r) => r.json()).catch((e) => ({ output: String(e) })).then((r) => {
        cur.loading = false;
        cur.full = r.ok ? fullHunks(cur, r.text) : null;
        cur.fullErr = r.ok ? '' : r.output || r.error;
        if (prFile[p.key] === cur.path && byId('ptree')) drawFilesView(p);
      });
  }
  if (byId('rseen')) byId('rseen').textContent = marksText(p, files);
  // a repaint of the same view keeps the diff where it was; a new file opens at its first change
  const view = cur.path + '|' + diffSplit + '|' + (wantFull && !!cur.full) + '|' + diffFull;
  const oldBody = v.querySelector('.pdbody');
  const keepTop = diffShown[p.key] !== view ? null : monoEd ? monoEd.getModifiedEditor().getScrollTop()
    : oldBody ? oldBody.scrollTop : null;
  const showMono = mono && monaco && !(wantFull && cur.full === undefined);
  const focusKey = document.activeElement && document.activeElement.closest && document.activeElement.closest('.pf')
    ? document.activeElement.closest('.pf').dataset.file || document.activeElement.closest('.pf').dataset.dir : null;
  v.innerHTML = '<div class="prfiles"><div class="ptree" id="ptree">' + tree + '</div>' +
    '<div class="tsplit" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Divider between the file list and the diff" ' +
    'title="Drag to resize the file list. Double-click: default width."></div>' +
    '<div class="pdiff"><div class="pdhead"><span class="pdpath" title="' + escA(cur.path) + '">' + esc(cur.path) + '</span>' +
      '<span class="add">+' + cur.add + '</span><span class="del">−' + cur.del + '</span>' +
      '<button data-full="1" class="' + (diffFull ? 'on' : '') + '">Whole file</button>' +
      '<button data-full="0" class="' + (diffFull ? '' : 'on') + '">Changes only</button>' +
      '<button data-split="1" class="' + (diffSplit ? 'on' : '') + '">Side by side</button>' +
      '<button data-split="0" class="' + (diffSplit ? '' : 'on') + '">One column</button>' +
      '<button class="flagbtn" data-flag="' + escA(cur.path) + '" aria-pressed="' + isRecheck(p, cur) + '" title="Come back to this file later (F)">⚑ Recheck</button>' +
      '<label><input type="checkbox" data-seen="' + escA(cur.path) + '"' + (isViewed(p, cur) ? ' checked' : '') + '> Viewed</label></div>' +
    '<div class="pdmain"><div class="pdbody' + (showMono ? ' monoon' : '') + '" tabindex="0" aria-label="diff">' +
      (showMono ? '<div class="mono" id="mono"></div>'
      : cur.binary ? '<div class="dim">Binary file — no diff to show.</div>'
      : !cur.hunks.length ? '<div class="dim">' + (cur.st === 'R' ? 'Renamed, no content changes.' : 'No content changes.') + '</div>'
      : mono && !monaco ? '<div class="dim">Loading VS Code\u2019s diff view…</div>'
      : big ? '<div class="dim">Large diff (' + cur.n + ' lines). <button id="showbig">Show it</button></div>'
      : wantFull && cur.full === undefined ? '<div class="dim">Loading the whole file…</div>'
      : (wantFull && cur.fullErr ? '<div class="dim">⚠️ Could not load the whole file (' + esc(cur.fullErr) +
          '). Showing the changes only.</div>' : '') +
        diffHtml(wantFull && cur.full ? { hunks: cur.full } : cur)) + '</div>' +
      (showMono ? '' : '<div class="druler" aria-hidden="true" title="Where the changes are. Click or drag to move there."></div>') + '</div></div></div>';
  if (monoEd) { monoEd.dispose(); monoEd.models.forEach((m) => m.dispose()); monoEd = null; }
  if (showMono) { mountMonaco(cur, keepTop); diffShown[p.key] = view; }
  byId('ptree').style.width = treeW || (treeWidth ? treeWidth + 'px' : '');
  const body = v.querySelector('.pdbody'), tab = body.querySelector('.dtab');
  // size the two sides now: done later by the observer, the rewrap moves the lines after the jump
  body.querySelectorAll('.dwrap').forEach((w) => { w.dataset.obs = '1'; splitObs.observe(w); layoutSplit(w); });
  if (tab) {
    if (keepTop != null) body.scrollTop = keepTop;
    else {
      diffShown[p.key] = view;
      const first = tab.querySelector('td.a, td.d');
      if (first) body.scrollTop += first.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 4;
    }
    bindRuler(body, v.querySelector('.druler'));
  }
  byId('ptree').scrollTop = treeTop;
  // keyboard: ↑/↓ move, Enter opens a file or folds a folder, Space marks it viewed
  const rows = [...v.querySelectorAll('.pf')];
  const back = focusKey && rows.find((r) => (r.dataset.file || r.dataset.dir) === focusKey);
  if (back) back.focus({ preventScroll: true });
  byId('ptree').addEventListener('keydown', (e) => {
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const r = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (r) r.focus();
    } else if (e.key === 'Enter') { e.preventDefault(); rows[i].click(); }
    else if (e.key === ' ') {
      e.preventDefault();
      const cb = rows[i].querySelector('input');
      cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));
    } else if ((e.key === 'f' || e.key === 'F') && rows[i].dataset.file) {
      e.preventDefault(); rows[i].querySelector('.flag').click();
    }
  });
  v.querySelectorAll('[data-file]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.matches('input')) return;
    prFile[p.key] = el.dataset.file; drawFilesView(p);
  }));
  const markSeen = (list, on) => {
    const m = prViewed[p.pr.url] = prViewed[p.pr.url] || {}, r = prRecheck[p.pr.url] = prRecheck[p.pr.url] || {};
    for (const f of list) { if (on) { m[f.path] = f.hash; delete r[f.path]; } else delete m[f.path]; }
    saveViewed(); saveRecheck(); paintMarks();
  };
  const markRecheck = (f, on) => {
    const m = prViewed[p.pr.url] = prViewed[p.pr.url] || {}, r = prRecheck[p.pr.url] = prRecheck[p.pr.url] || {};
    if (on) { r[f.path] = true; delete m[f.path]; } else delete r[f.path];
    saveViewed(); saveRecheck(); paintMarks();
  };
  // only the marks and the count change: rebuilding the tree and the diff made the screen flicker
  const paintMarks = () => {
    v.querySelectorAll('[data-flag]').forEach((b) => {
      const f = files.find((x) => x.path === b.dataset.flag), on = !!f && isRecheck(p, f);
      b.setAttribute('aria-pressed', String(on));
      if (b.classList.contains('flag')) b.closest('.pf').classList.toggle('rk', on);
    });
    v.querySelectorAll('[data-seen]').forEach((cb) => {
      const f = files.find((x) => x.path === cb.dataset.seen);
      if (f) cb.checked = isViewed(p, f);
    });
    v.querySelectorAll('[data-seendir]').forEach((cb) => {
      const all = files.filter((x) => x.path.startsWith(cb.dataset.seendir + '/')), n = all.filter((x) => isViewed(p, x)).length;
      cb.checked = n === all.length; cb.indeterminate = n > 0 && n < all.length;
    });
    if (byId('rseen')) byId('rseen').textContent = marksText(p, files);
  };
  v.querySelectorAll('[data-flag]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const f = files.find((x) => x.path === el.dataset.flag);
    if (f) markRecheck(f, !isRecheck(p, f));
  }));
  v.querySelectorAll('[data-seen]').forEach((el) => el.addEventListener('change', () =>
    markSeen(files.filter((x) => x.path === el.dataset.seen), el.checked)));
  v.querySelectorAll('[data-seendir]').forEach((el) => {
    el.indeterminate = !!el.dataset.some;
    el.addEventListener('change', () =>
      markSeen(files.filter((x) => x.path.startsWith(el.dataset.seendir + '/')), el.checked));
  });
  v.querySelectorAll('[data-dir]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.matches('input')) return;
    const d = el.dataset.dir;
    closed.has(d) ? closed.delete(d) : closed.add(d);
    drawFilesView(p);
  }));
  v.querySelectorAll('[data-split]').forEach((el) => el.addEventListener('click', () => {
    diffSplit = el.dataset.split === '1';
    try { localStorage.setItem('dash-diff-split', diffSplit ? '1' : '0'); } catch {}
    drawFilesView(p);
  }));
  v.querySelectorAll('[data-full]').forEach((el) => el.addEventListener('click', () => {
    diffFull = el.dataset.full === '1';
    try { localStorage.setItem('dash-diff-full', diffFull ? '1' : '0'); } catch {}
    drawFilesView(p);
  }));
  if (byId('showbig')) byId('showbig').addEventListener('click', () => { cur.show = true; drawFilesView(p); });
}

async function saveMetaFor(p, status, tags) {
  p.status = status; p.tags = [...new Set(tags)];
  await post('/api/meta', { project: p.project, slug: p.slug, status: p.status, tags: p.tags });
  renderList(); renderDetail(false);
}
function renderBar() {
  byId('selcount').textContent = picked.size + ' queued';
  byId('selmodes').textContent = [...picked].map((k) => {
    const p = find(k);
    return (p ? p.slug.slice(0, 18) : k.slice(0, 18)) + '…(' + (p ? modeLabel(p) : '?') + ')';
  }).join('  ');
}
async function post(url, data, thenRefresh) {
  const r = await (await fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  if (r.output) alert((r.ok ? '✅ ' : '⚠️ ') + r.output);
  if (thenRefresh) setTimeout(refresh, 1200);
  return r;
}
byId('launchbtn').addEventListener('click', async () => {
  if (!picked.size) return alert('Tick at least one plan in the left list.');
  const byProj = {};
  for (const k of picked) { const p = find(k); if (p) (byProj[p.project] = byProj[p.project] || []).push(p); }
  for (const [proj, items] of Object.entries(byProj)) {
    if (items[0].hasPipeline)
      await post('/api/launch', { project: proj,
        items: items.map((p) => ({ slug: p.slug, mode: modeOf(p) })) });
    else
      for (const p of items) {
        if (!(p.launchers || []).length) { alert('No launcher configured for ' + proj + ' — set one up first.'); continue; }
        await post('/api/launch-generic', { project: proj, slug: p.slug, launcher: +modeOf(p) });
      }
  }
  picked.clear(); renderBar();
  afterLaunch();
});
// show the launch at once, then check every second while anything is still starting
let fastUntil = 0;
function afterLaunch() { fastUntil = Date.now() + 15000; refresh(); }
function showLaunchError(p) {
  if (!p || !p.launch) return;
  logKey = null;
  setBack(null);
  byId('logtitle').textContent = '⚠ didn’t start — ' + p.slug;
  byId('logpane').classList.add('open');
  byId('logbody').textContent = p.launch.output +
    '\\n\\n(the launcher’s full output is in ' + p.project + '/.plans/auto-runs/_dashboard.log)';
}
async function cleanupRun(p) {
  if (!confirm('Clean up "' + p.slug + '"?\\n\\nRemoves its worktree and auto/ branch.\\n(Automatically refused if the worktree has uncommitted changes or the branch is unmerged — nothing can be lost.)')) return;
  const artifacts = confirm('Also delete its breadcrumbs — report, log and settings in auto-runs/?\\n\\nOK = delete too · Cancel = keep for history');
  await post('/api/cleanup', { project: p.project, slug: p.slug, artifacts }, true);
}
async function clearRun(p) {
  if (!confirm('Clear the run record and log for "' + p.slug + '"?\\n\\nThe repo itself is untouched — this only deletes the dashboard\\u2019s tracking of this run.')) return;
  await post('/api/clear-run', { project: p.project, slug: p.slug }, true);
}
async function archive(p) {
  if (!confirm('Archive "' + p.slug + '" to done/ ?\\n\\nThe plan file moves out of the active list. You commit the move yourself if the folder is tracked.')) return;
  await post('/api/archive', { project: p.project, slug: p.slug }, true);
  if (selected === p.key) selected = null;
}
// drawer back-navigation: set when a drawer view was opened from another one
let drawerBack = null;
const setBack = (fn) => {
  drawerBack = fn || null;
  byId('backBtn').style.display = drawerBack ? '' : 'none';
};
byId('backBtn').addEventListener('click', () => { const f = drawerBack; if (f) f(); });
function openLog(key, kind) {
  setBack(null);
  logKey = key; logKind = kind; byId('logpane').classList.add('open'); loadLog();
}
function closeLog() { setBack(null); logKey = null; byId('logpane').classList.remove('open'); }
async function loadLog() {
  const p = find(logKey);
  if (!p) return;
  byId('logtitle').textContent = logKind + ': [' + p.project + '] ' + p.slug;
  const t = await (await fetch('/api/' + logKind + '?project=' + p.project + '&slug=' + p.slug)).text();
  const el = byId('logbody');
  if (el.textContent === t || selectionIn(el)) return;
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  el.textContent = t;
  if (stick) el.scrollTop = el.scrollHeight;
}
// --- launcher setup dialog (generic projects): pick a skill/script or write a command ---
// back: where ‹ Back and a save return to (the settings panel, the setup guide), or null
async function openLauncherSetup(projName, back) {
  logKey = null;
  setBack(back || null);
  byId('logtitle').textContent = '⚙ launchers — ' + projName;
  byId('logpane').classList.add('open');
  byId('logbody').innerHTML = '<div class="setup">scanning ' + esc(projName) + ' .claude folder…</div>';
  const d = await (await fetch('/api/discover?project=' + projName)).json();
  const proj = state.find((s) => s.name === projName) || { launchers: [] };
  const HEADLESS = ' --permission-mode acceptEdits --verbose --output-format stream-json';
  const tplSkill = (s) => 'claude -p "/' + s + ' {plan}"' + HEADLESS;
  const tplScript = (s) => s === 'run-skill.sh' ? 'bash .claude/scripts/run-skill.sh implement {plan}'
    : (s.endsWith('.sh') ? 'bash' : 'node') + ' .claude/scripts/' + s + ' {plan}';
  const tplGeneric = 'claude -p "Read the plan at {plan} and implement it in this repository. '
    + 'Follow the repo conventions and existing patterns. Run the relevant tests. '
    + 'Do not push, do not create PRs." ' + HEADLESS.trim();
  let h = '<div class="setup">';
  h += '<p class="hint"><b>What is a launcher?</b> The exact shell command the ▶ Launch button runs ' +
    'for a plan of this project — nothing runs until you launch a plan. Picking an option below only ' +
    '<b>pre-fills the command box</b> at the bottom; review or edit it there, give it a label, then save. ' +
    'You can save several (e.g. “Implement only”, “Implement + test”) and choose one per plan at launch time.</p>';
  if (d.hasPipeline)
    h += '<p style="border:1px solid var(--warn);border-radius:9px;padding:8px 12px;color:var(--warn)">' +
      '⚡ <b>This project has auto-pipeline.sh</b> — its plans launch through the pipeline ' +
      '(in the modes the script offers), and launchers here are <b>ignored</b>. ' +
      'You only need launchers for projects without the pipeline.</p>';
  h += '<p style="margin-top:10px"><b>Existing launchers</b> — what ▶ Launch currently offers (✕ deletes immediately):</p>';
  h += (proj.launchers || []).length
    ? (proj.launchers || []).map((l, i) =>
        '<div class="lrow"><span class="chip x" data-dl="' + i + '">✕</span><b>' +
        esc(l.label || 'launcher ' + (i + 1)) + '</b> — ' + esc(l.cmd) + '</div>').join('')
    : '<p class="dim">none yet — plans of this project cannot be launched until one is saved</p>';
  h += '<p style="margin-top:14px"><b>Add a launcher</b> — pick a starting point, then edit the command:</p>';
  const opt = (val, lab, desc) => '<div class="opt"><input type="radio" name="tpl" value="' +
    esc(val).replace(/"/g, '&quot;') + '" id="o' + (oid++) + '"><label for="o' + (oid - 1) + '">' + lab +
    (desc ? '<br><span class="dim" style="font-size:11px">' + desc + '</span>' : '') + '</label></div>';
  let oid = 0;
  if ((d.skills || []).length) {
    h += '<p class="dim">Skills in this repo — each runs headless as <code>claude -p "/skill {plan}"</code>:</p>';
    for (const s of d.skills) h += opt(tplSkill(s.name), '<code>/' + esc(s.name) + '</code>', esc(s.desc));
  }
  if ((d.scripts || []).length) {
    h += '<p class="dim">Scripts in this repo — run directly with the plan path as argument:</p>';
    for (const s of d.scripts) h += opt(tplScript(s.name), '<code>' + esc(s.name) + '</code>', esc(s.desc));
  }
  h += '<p class="dim">Or, for a repo with no skills at all:</p>';
  h += opt(tplGeneric, 'Generic headless Claude',
    'Plain claude session: reads the plan, implements it following repo conventions, runs tests, never pushes.');
  h += '<p style="margin-top:10px" class="dim">Command ({plan} = absolute plan path, {root} = repo root, {slug} = plan name):</p>';
  h += '<textarea id="lcmd"></textarea>';
  h += '<p style="margin-top:8px"><input type="text" id="llabel" placeholder="label, e.g. Implement headless" size="30"> ';
  h += '<button class="primary" id="lsave">💾 Save launcher</button></p>';
  h += '</div>';
  byId('logbody').innerHTML = h;
  byId('logbody').querySelectorAll('input[name=tpl]').forEach((el) =>
    el.addEventListener('change', () => { byId('lcmd').value = el.value; }));
  byId('logbody').querySelectorAll('[data-dl]').forEach((el) =>
    el.addEventListener('click', async () => {
      const ls = (proj.launchers || []).filter((_, i) => i !== +el.dataset.dl);
      await post('/api/launchers', { project: projName, launchers: ls });
      await refresh(); openLauncherSetup(projName, back);
    }));
  byId('lsave').addEventListener('click', async () => {
    const cmd = byId('lcmd').value.trim();
    if (!cmd) return alert('Pick a template or write a command first.');
    const ls = [...(proj.launchers || []),
      { label: byId('llabel').value.trim() || 'launcher', cmd }];
    await post('/api/launchers', { project: projName, launchers: ls });
    await refresh();
    if (back) back();
    else { closeLog(); renderDetail(false); }
  });
}
// --- settings panel: edit the project registry from the app ---
const escA = (x) => esc(x).replace(/"/g, '&quot;');
async function openSettings() {
  logKey = null;
  setBack(null);
  byId('logtitle').textContent = '⚙ settings — projects';
  byId('logpane').classList.add('open');
  byId('logbody').innerHTML = '<div class="setup">loading registry…</div>';
  const reg = await (await fetch('/api/registry')).json();
  // _orig remembers the saved name so "Edit launchers" works even mid-rename
  const rows = reg.map((e) => ({ ...e, _orig: e.name }));
  const render = () => {
    let h = '<div class="setup">';
    h += '<p class="hint">Stored in <code>~/.claude/pipeline-projects.json</code> · paths may start with ~ · ' +
      'changes appear in the list within seconds.</p>';
    h += '<p class="hint"><b>How launching works:</b> if a repo contains ' +
      '<code>.claude/scripts/auto-pipeline.sh</code>, the dashboard detects it automatically and launches ' +
      'that project\\u2019s plans through it (⚡ the script\\u2019s own modes, worktrees, reports) — nothing to ' +
      'configure. Repos without it launch plans via the launcher commands you set up per project ' +
      '(⚙ Edit launchers below).</p>';
    rows.forEach((e, i) => {
      const ln = (e.launchers || []).length;
      h += '<div class="pcard">';
      h += '<div class="pcard-head">' +
        '<input type="text" data-f="name" data-i="' + i + '" value="' + escA(e.name || '') +
          '" placeholder="Project name" size="20" aria-label="project name">' +
        '<input type="text" data-f="client" data-i="' + i + '" value="' + escA(e.client || '') +
          '" placeholder="Client" size="12" aria-label="client">' +
        '<button class="rmbtn" data-rm="' + i + '">Remove</button></div>';
      h += '<div class="pcard-body">' +
        '<span class="flabel">Repo root</span>' +
        '<input type="text" class="mono" data-f="root" data-i="' + i + '" value="' + escA(e.root || '') +
          '" placeholder="~/Workspace/client/repo">' +
        '<span class="flabel">Plans folder</span>' +
        '<input type="text" class="mono" data-f="plansDir" data-i="' + i + '" value="' + escA(e.plansDir || '') +
          '" placeholder="default: &lt;repo root&gt;/.plans">' +
        '<span class="flabel">Done folder</span>' +
        '<input type="text" class="mono" data-f="doneDir" data-i="' + i + '" value="' + escA(e.doneDir || '') +
          '" placeholder="default: &lt;plans folder&gt;/done">' +
        '</div>';
      h += '<div class="pcard-foot">' +
        (e._hasPipeline
          ? '⚡ launches via its own auto-pipeline.sh, in the modes it offers — launchers not needed'
          : ln + ' launcher' + (ln === 1 ? '' : 's') +
            (e._orig ? ' · <button class="pbtn" data-lset="' + escA(e._orig) + '">⚙ Edit launchers</button>'
                     : ' · save the project first, then configure launchers')) + '</div>';
      h += '</div>';
    });
    h += '<div class="setupbar"><button id="addProj">＋ Add project</button>' +
      '<span style="flex:1"></span><button class="primary" id="saveReg">Save changes</button></div></div>';
    byId('logbody').innerHTML = h;
    byId('logbody').querySelectorAll('input[data-f]').forEach((el) =>
      el.addEventListener('input', () => { rows[+el.dataset.i][el.dataset.f] = el.value; }));
    byId('logbody').querySelectorAll('[data-rm]').forEach((el) =>
      el.addEventListener('click', () => {
        const nm = rows[+el.dataset.rm].name || 'this project';
        if (!confirm('Remove "' + nm + '" from the dashboard?\\n\\nThe repo and its plans are untouched — only the registry entry goes away.')) return;
        rows.splice(+el.dataset.rm, 1); render();
      }));
    byId('addProj').addEventListener('click', () => {
      rows.push({ name: '', client: '', root: '', plansDir: '', launchers: [] }); render();
    });
    byId('logbody').querySelectorAll('[data-lset]').forEach((el) =>
      el.addEventListener('click', () => openLauncherSetup(el.dataset.lset, openSettings)));
    byId('saveReg').addEventListener('click', async () => {
      const r = await post('/api/registry', { projects: rows });
      if (r.ok) { closeLog(); refresh(); }
    });
  };
  render();
}
byId('settingsbtn').addEventListener('click', openSettings);
// suggest-batch: deterministic lane analysis (plan-lanes.mjs), rendered in the drawer
async function openSuggest(projName) {
  if (!projName) return;
  logKey = null;
  setBack(null);
  byId('logtitle').textContent = '🧭 suggested launch batch — ' + projName;
  byId('logpane').classList.add('open');
  byId('logbody').textContent = 'analyzing plan backlog…';
  const d = await (await fetch('/api/lanes?project=' + projName)).json();
  if (d.error) { byId('logbody').textContent = '⚠️ ' + d.error; return; }
  const K = (s) => projName + '/' + s;
  let h = '<div style="font-family:-apple-system,sans-serif;font-size:13px;line-height:1.7;white-space:normal;color:var(--fg)">';
  h += '<p><b>' + d.schedulableCount + '</b> schedulable · <b>' + d.laneCount +
       '</b> independent lanes · up to <b>' + d.maxParallel + '</b> safely in parallel</p>';
  if (d.recommendedBatch && d.recommendedBatch.length) {
    h += '<p><b>Recommended batch:</b></p><ul>';
    for (const p of d.recommendedBatch) {
      const v = p.validation || {};
      // the skill takes the plan file as its argument, so bake it into the copied command
      const vcmd = '/skill-auto-validate-plan ' + (p.file || '.plans/' + p.slug + '.md');
      h += '<li><code class="plink" data-open="' + esc(K(p.slug)) + '">' + esc(p.slug) + '</code><br><span class="dim">areas: ' +
        esc((p.areas || []).join(', ') || '—') +
        ((v.claude || v.codex)
          ? ' · validated ' + (v.claude || 0) + '×claude / ' + (v.codex || 0) + '×codex'
          : ' · <b class="copycmd" data-copy="' + escA(vcmd) + '" title="click to copy: ' + escA(vcmd) + '">'
            + 'not validated — click to copy /skill-auto-validate-plan</b>') +
        '</span></li>';
    }
    h += '</ul><button class="primary" id="queueBatch">✓ Queue this batch</button>';
  } else h += '<p>No launchable batch right now.</p>';
  const multi = (d.lanes || []).filter((l) => (l.members || []).length > 1);
  if (multi.length) {
    h += '<p style="margin-top:16px"><b>Serialize — same-file conflicts, one at a time:</b></p><ul>';
    for (const l of multi)
      h += '<li>' + esc(l.label || 'lane ' + l.lane) + ': ' +
        (l.members || []).map((m) => '<code class="plink" data-open="' + esc(K(m.slug || m)) + '">' + esc(m.slug || m) + '</code>').join(' → ') + '</li>';
    h += '</ul>';
  }
  if (d.inFlight && d.inFlight.length) {
    h += '<p style="margin-top:16px"><b>In flight / awaiting review:</b></p><ul>' +
      d.inFlight.map((p) => '<li><code class="plink" data-open="' + esc(K(p.slug)) + '">' + esc(p.slug) + '</code> — ' +
        esc((p.autoRunStatus || '').split(/[.—]/)[0].trim()) + '</li>').join('') + '</ul>';
  }
  byId('logbody').innerHTML = h + '</div>';
  byId('logbody').querySelectorAll('[data-open]').forEach((el) =>
    el.addEventListener('click', () => {
      const k = el.dataset.open;
      if (!find(k)) return; // e.g. archived plans no longer listed
      selected = k; renderList(); renderDetail(true); // drawer stays open for browsing
    }));
  byId('logbody').querySelectorAll('[data-copy]').forEach((el) =>
    el.addEventListener('click', async () => {
      if (el.dataset.busy) return;
      const was = el.textContent, cmd = el.dataset.copy;
      el.dataset.busy = '1';
      const ok = await copyText(cmd);
      if (ok) el.textContent = '✓ copied';
      else {
        el.textContent = cmd;               // show the real command so ⌘C grabs it
        const r = document.createRange(); r.selectNodeContents(el);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
      setTimeout(() => { el.textContent = was; delete el.dataset.busy; }, 1600);
    }));
  const qb = document.getElementById('queueBatch');
  if (qb) qb.addEventListener('click', () => {
    for (const p of d.recommendedBatch) {
      const pl = find(K(p.slug));
      if (pl && !pl.live && !pl.worktree) picked.add(pl.key);
    }
    renderBar(); renderList(); closeLog();
  });
}
document.addEventListener('keydown', (e) => {
  if (tourStep >= 0) {
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight') tourGo(1);
    else if (e.key === 'ArrowLeft') tourGo(-1);
    return;
  }
  if (byId('demohost') && byId('onb').classList.contains('open') && /^Arrow(Left|Right)$/.test(e.key)) {
    demoScene = Math.min(2, Math.max(0, demoScene + (e.key === 'ArrowRight' ? 1 : -1)));
    return paintDemo();
  }
  if (e.key !== 'Escape') return;
  if (e.target.closest && e.target.closest('.monaco-editor') && document.querySelector('.monaco-editor .find-widget.visible')) return;
  if (byId('onb').classList.contains('open')) return closeGuide();
  // Files changed fills the window; Esc goes back to the plan, as ‹ Plan does
  if (document.body.classList.contains('review') && !byId('logpane').classList.contains('open'))
    return byId('rback')?.click();
  if (drawerBack) drawerBack(); else closeLog();
});
byId('q').addEventListener('input', renderList);
byId('collapseAll').addEventListener('click', () => {
  const names = [...new Set(plans.map((p) => p.project))];
  if (names.every((n) => collapsedProjects.has(n))) collapsedProjects.clear();
  else names.forEach((n) => collapsedProjects.add(n));
  saveCollapsed(); renderList();
});
// --- setup guide: what it does (demo) → pick a project; then a tour of the real screen ---
// Machine checks stay out of sight unless one fails: a list of green ticks is a screen
// with nothing to do on it.
const ONB_STEPS = ['How it works', 'Pick a project'];
let onbStep = 0, onbData = null, onbScan = null, onbScanDir = '', onbScanErr = '', onbCopies = [];
let demoScene = 0, onbPaintedStep = -1;
const onbOpenCards = new Set();   // project roots whose row is expanded
const CHECK_SVG = '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const mark = (c) => '<span class="mk ' + (c.ok ? 'ok' : c.required ? 'bad' : 'warn') + '">' + (c.ok ? CHECK_SVG : '') + '</span>';
function renderEmptyDetail() {
  syncUrl();
  document.body.classList.remove('review');
  byId('detail').innerHTML = state.length ? '<span class="dim">Select a plan on the left.</span>'
    : '<div class="welcome"><h2>Hand off the work. Review the result.</h2><p>Describe a change in a plan ' +
      'file. Claude Code implements and tests it in the background. You come back to a diff.</p>' +
      '<button class="primary" data-guide="">Get started</button></div>';
  byId('detail').querySelectorAll('[data-guide]').forEach((el) => el.addEventListener('click', () => openGuide(0)));
}
function openGuide(step) {
  onbStep = step || 0; onbPaintedStep = -1;
  demoScene = 0;
  byId('onb').classList.add('open');
  renderGuide();
  loadGuide(false);
}
function closeGuide() {
  byId('onb').classList.remove('open');
  try { sessionStorage.setItem('dash-guide-closed', '1'); } catch {}
  refresh();
}
// quiet: a background re-check — repaint only when a check changed, and never while
// the user is typing in one of the guide's inputs
async function loadGuide(rescan, quiet) {
  const scanUrl = '/api/scan' + (onbScanDir ? '?dir=' + encodeURIComponent(onbScanDir) : '');
  const before = JSON.stringify([onbData, onbScan, onbScanErr]);
  try {
    const [o, sc] = await Promise.all([
      fetch('/api/onboarding').then((r) => r.json()),
      rescan || !onbScan ? fetch(scanUrl).then((r) => r.json()) : null,
    ]);
    onbData = o;
    if (sc && sc.error) onbScanErr = sc.error;
    else if (sc) { onbScan = sc; onbScanErr = ''; }
  } catch (e) { if (!quiet) onbScanErr = 'Could not reach the server: ' + e; }
  if (!byId('onb').classList.contains('open')) return;
  if (quiet && (before === JSON.stringify([onbData, onbScan, onbScanErr])
    || byId('onbbody').contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) return;
  renderGuide();
}
// A fix made in another window (a pasted prompt, an edited settings.json) has to show
// up here without a click on "Check again".
let guideBusy = false;
async function recheckGuide() {
  if (guideBusy || onbStep !== 1 || document.hidden || !byId('onb').classList.contains('open')) return;
  guideBusy = true;
  try { await loadGuide(true, true); } finally { guideBusy = false; }
}
setInterval(recheckGuide, 5000);
addEventListener('focus', recheckGuide);
// every copyable string goes through an index, so no text has to survive an attribute
const cp = (t) => { onbCopies.push(t); return onbCopies.length - 1; };
const cmdRow = (t) => '<div class="cmdrow"><code>' + esc(t) + '</code><button class="sm" data-cp="' + cp(t) + '">Copy</button></div>';
function checkHtml(c, projName, root) {
  let h = '<div class="ck">' + mark(c) + '<div class="bd"><span class="lb">' + esc(c.label) + '</span>' +
    (c.required ? '' : '<span class="opt-tag">optional</span>') +
    (c.detail ? '<span class="dt">' + esc(c.detail) + '</span>' : '');
  if (!c.ok) {
    h += '<div class="why">' + esc(c.why || '') + '</div><div class="fix">';
    if (c.fixCmd) h += cmdRow(c.fixCmd);
    if (c.fixPrompt) h += '<details class="pr" data-pk="' + escA((root || '') + '|' + c.label) + '"><summary>Prompt for Claude Code, run in this repo ' +
      '<button class="sm" data-cp="' + cp(c.fixPrompt) + '">Copy prompt</button></summary>' +
      '<div class="promptbox">' + esc(c.fixPrompt) + '</div></details>';
    if (c.action === 'launchers' && projName)
      h += '<button class="sm" data-lset="' + escA(projName) + '">Set up a launcher by hand</button>';
    h += '</div>';
  }
  return h + '</div></div>';
}
function projRow(p, registered) {
  const open = onbOpenCards.has(p.root);
  const missing = p.checks.filter((c) => !c.ok);
  const req = missing.filter((c) => c.required);
  const stateTxt = p.level === 'green' ? 'Ready'
    : p.level === 'amber' ? 'Ready · ' + missing.length + ' tip' + (missing.length === 1 ? '' : 's')
    : 'Needs ' + req.length + ' thing' + (req.length === 1 ? '' : 's');
  let h = '<div class="prow"><div class="prow-head" data-card="' + escA(p.root) + '">' +
    '<div style="flex:1;min-width:0"><div class="prow-name">' + esc(p.name) + '</div>' +
    '<div class="prow-path">' + esc(p.display) + '</div></div>' +
    '<span class="prow-state ' + p.level + '">' + (p.level === 'green' ? CHECK_SVG.replace('<svg', '<svg width="13" height="13"') : '') +
    stateTxt + '</span>' +
    (registered ? '<span class="dim" style="font-size:12px">added</span>'
      : '<button class="sm ' + (p.level === 'red' ? '' : 'primary') + '" data-add="' + escA(p.root) + '">Add</button>') +
    '<span class="dim" style="width:12px">' + (open ? '−' : '+') + '</span></div>';
  if (!open) return h + '</div>';
  h += '<div class="prow-body">' + p.checks.map((c) => checkHtml(c, registered ? p.name : null, p.root)).join('');
  h += '<div class="prow-actions">';
  if (!registered)
    h += '<input data-nm="' + escA(p.root) + '" value="' + escA(p.name) + '" aria-label="project name" title="project name">' +
      '<input data-cl="' + escA(p.root) + '" value="' + escA(p.client) + '" aria-label="client" title="client — groups projects in the sidebar">';
  if (p.fixAll)
    h += '<button class="sm" data-cp="' + cp(p.fixAll) + '" title="one prompt covering every item above that Claude can fix">' +
      'Copy one prompt that fixes all of it</button>';
  if (registered) h += '<button class="sm" data-recheck="1">Check again</button>';
  return h + '</div></div></div>';
}
const DEMO = [
  ['You write a plan', 'A markdown file in the repo that says what to change and how to check it.'],
  ['Claude does the work', 'In the background: it edits, runs the tests and reviews itself. No prompts, no babysitting.'],
  ['You review the diff', 'You come back to finished code, ready for you to check and commit.'],
];
const demoHtml = () =>
  '<div class="demo"><div><div class="win s' + demoScene + '"><div class="win-bar">' +
  ['.plans/rate-limit-login.md', 'rate-limit-login', 'rate-limit-login'][demoScene] +
  '<span class="st"><i></i>' + ['draft', 'running', 'ready for review'][demoScene] + '</span></div>' +
  '<div class="scene' + (demoScene === 0 ? ' on' : '') + '">' +
    '<div class="ln h"># Plan: Rate-limit the login endpoint</div>' +
    '<div class="ln m">## Goal</div><div class="ln">Five attempts per minute per IP, then 429.</div>' +
    '<div class="ln m">## Steps</div><div class="ln">1. Add a guard in src/auth/</div>' +
    '<div class="ln">2. Apply it to POST /login</div><div class="ln">3. Test the 6th attempt fails</div></div>' +
  '<div class="scene' + (demoScene === 1 ? ' on' : '') + '">' +
    '<div class="ln m">reading the plan</div><div class="ln">create  src/auth/rate-limit.guard.ts</div>' +
    '<div class="ln">edit    src/auth/login.controller.ts</div><div class="ln">create  test/auth/rate-limit.spec.ts</div>' +
    '<div class="ln">run     pnpm test <span class="pass">48 passed</span></div>' +
    '<div class="ln">review  <span class="pass">no findings</span></div></div>' +
  '<div class="scene' + (demoScene === 2 ? ' on' : '') + '">' +
    '<div class="ln m">src/auth/login.controller.ts</div>' +
    '<div class="ln del">-  @Post("login")</div><div class="ln add">+  @Post("login") @UseGuards(RateLimitGuard)</div>' +
    '<div class="ln m">src/auth/rate-limit.guard.ts  (new)</div>' +
    '<div class="ln add">+  const LIMIT = 5, WINDOW_MS = 60_000;</div>' +
    '<div class="ln add">+  if (hits(ip) > LIMIT) throw new TooManyRequests();</div></div>' +
  '</div><div class="demo-nav"><button class="sm" data-scene="' + (demoScene + 2) % 3 + '"' +
    (demoScene === 0 ? ' disabled' : '') + ' aria-label="previous">‹</button>' + (demoScene + 1) + ' of 3' +
    (demoScene < 2 ? '<button class="sm nx" data-scene="' + (demoScene + 1) + '">Next: ' +
      DEMO[demoScene + 1][0] + ' ›</button>' : '') + '</div>' +
  '</div><div class="caps">' + DEMO.map((d, i) => '<button data-scene="' + i + '" class="' +
    (i === demoScene ? 'on' : '') + '"><b>' + (i + 1) + '. ' + d[0] + '</b><span>' + d[1] + '</span></button>').join('') +
  '</div></div>';
function paintDemo() {
  const host = byId('demohost');
  if (!host) return;
  host.innerHTML = demoHtml();
  host.querySelectorAll('[data-scene]').forEach((el) => el.addEventListener('click', () => {
    demoScene = +el.dataset.scene; paintDemo();
  }));
}
// the reader moves the demo on — an autoplay kept turning the page before it was read
function startDemo() { paintDemo(); }
function renderGuide() {
  onbCopies = [];
  byId('onbsteps').innerHTML = ONB_STEPS.map((t, i) => '<span data-step="' + i + '" class="' +
    (i === onbStep ? 'on' : i < onbStep ? 'done' : '') + '"><b>' + (i + 1) + '</b>' + t + '</span>').join('');
  const d = onbData;
  const regd = d ? d.projects : [];
  let h = '', next = 'Continue', nextOff = false;
  if (onbStep === 0) {
    h += '<h2>Hand off the work. Review the result.</h2><p class="lead">Plans runs your Claude Code setup ' +
      'without you at the keyboard. You write down what to change, it does the work in the background, ' +
      'and you come back to code that is ready for review.</p><div id="demohost"></div>';
    const bad = d ? d.system.filter((c) => !c.ok) : [];
    if (bad.length) {
      const hard = bad.some((c) => c.required);
      h += '<div class="alert' + (hard ? '' : ' soft') + '"><p><b>' +
        (hard ? 'Fix this before your first run' : 'Optional, but worth doing') + '</b></p>' +
        bad.map((c) => checkHtml(c)).join('') + '</div>';
    }
    next = 'Get started';
  } else if (onbStep === 1) {
    h += '<h2>Which repo should Claude work in?</h2><p class="lead">These are the repos found next to this ' +
      'one. <b>Ready</b> ones can run plans now. For the others, open the row: each missing piece comes ' +
      'with a prompt you paste into Claude Code, and it sets it up for you.</p>';
    if (regd.length) h += '<h3>Added</h3>' + regd.map((p) => projRow(p, true)).join('');
    h += '<h3>Found in ' + (onbScan ? esc(onbScan.roots.join(', ')) : '…') + '</h3>';
    if (onbScanErr) h += '<p style="color:var(--bad)">' + esc(onbScanErr) + '</p>';
    if (!onbScan) h += '<p class="dim">Looking for repos…</p>';
    else if (!onbScan.candidates.length) h += '<p class="dim">Nothing new here.</p>';
    else h += onbScan.candidates.map((p) => projRow(p, false)).join('');
    h += '<div class="scanrow"><input id="scandir" placeholder="Look somewhere else, e.g. ~/code" value="' +
      escA(onbScanDir) + '"><button class="sm" id="scanbtn">Look</button></div>';
    nextOff = !regd.length;
    next = 'Show me around';
  }
  // a repaint must not close an open prompt, drop a typed name or jump the scroll
  const B0 = byId('onbbody'), top = onbStep === onbPaintedStep ? B0.scrollTop : 0;
  const openPk = new Set([...B0.querySelectorAll('details[open][data-pk]')].map((x) => x.dataset.pk));
  const typed = ['data-nm', 'data-cl'].flatMap((a) =>
    [...B0.querySelectorAll('[' + a + ']')].map((x) => [a, x.getAttribute(a), x.value]));
  B0.innerHTML = h;
  B0.querySelectorAll('details[data-pk]').forEach((x) => { if (openPk.has(x.dataset.pk)) x.open = true; });
  typed.forEach(([a, k, v]) => {
    const x = [...B0.querySelectorAll('[' + a + ']')].find((i) => i.getAttribute(a) === k);
    if (x) x.value = v;
  });
  B0.scrollTop = top;
  onbPaintedStep = onbStep;
  byId('onbback').style.visibility = onbStep ? '' : 'hidden';
  byId('onbnext').textContent = next;
  byId('onbnext').disabled = nextOff;
  byId('onbnext').title = nextOff ? 'Add a repo first' : '';
  if (onbStep === 0) startDemo();
  const B = byId('onbbody');
  B.querySelectorAll('[data-cp]').forEach((el) => el.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const was = el.textContent, ok = await copyText(onbCopies[+el.dataset.cp]);
    el.textContent = ok ? 'Copied' : 'Copy failed — select it by hand';
    setTimeout(() => (el.textContent = was), 1600);
  }));
  B.querySelectorAll('[data-card]').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.card;
    onbOpenCards.has(k) ? onbOpenCards.delete(k) : onbOpenCards.add(k);
    renderGuide();
  }));
  B.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', async (e) => {
    e.stopPropagation();   // the button sits in the row header, which toggles on click
    const root = el.dataset.add;
    const cand = onbScan.candidates.find((c) => c.root === root);
    // a collapsed row has no inputs — add it under the suggested name and client
    const val = (attr, dflt) => {
      const inp = [...B.querySelectorAll('[' + attr + ']')].find((x) => x.getAttribute(attr) === root);
      return inp ? inp.value.trim() : dflt;
    };
    el.disabled = true; el.textContent = 'Adding…';
    const r = await (await fetch('/api/add-project', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, name: val('data-nm', cand.name), client: val('data-cl', cand.client),
        plansDir: cand.plansDir }) })).json();
    if (!r.ok) { alert(r.output); el.disabled = false; el.textContent = 'Add'; return; }
    onbScan.candidates = onbScan.candidates.filter((c) => c.root !== root);
    await loadGuide(false);
    refresh();
  }));
  B.querySelectorAll('[data-lset]').forEach((el) => el.addEventListener('click', () => {
    byId('onb').classList.remove('open');
    openLauncherSetup(el.dataset.lset, () => { closeLog(); openGuide(onbStep); });
  }));
  B.querySelectorAll('[data-recheck]').forEach((el) => el.addEventListener('click', () => loadGuide(true)));
  const sb = byId('scanbtn');
  if (sb) {
    const go = () => { onbScanDir = byId('scandir').value.trim(); onbScan = null; renderGuide(); loadGuide(true); };
    sb.addEventListener('click', go);
    byId('scandir').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
}
byId('onbsteps').addEventListener('click', (e) => {
  const s = e.target.closest('[data-step]');
  if (s) { onbStep = +s.dataset.step; renderGuide(); }
});
byId('onbback').addEventListener('click', () => { onbStep = Math.max(0, onbStep - 1); renderGuide(); });
byId('onbnext').addEventListener('click', () => {
  if (onbStep === ONB_STEPS.length - 1) { closeGuide(); return startTour(); }
  onbStep++; renderGuide();
});
byId('onbskip').addEventListener('click', closeGuide);
byId('onb').addEventListener('click', (e) => { if (e.target === byId('onb')) closeGuide(); });
byId('guidebtn').addEventListener('click', () => openGuide(0));
// --- tour: after the guide, spotlight the real screen one region at a time ---
// What to do next stays the user's call; the tour only says what each part is for.
const TOUR = [
  { el: () => document.querySelector('aside'), title: 'Your plans',
    body: 'Every .md file in each repo’s plans folder, grouped by client and project. Click one to open it. ' +
      'Plans that are running, or finished and waiting for your review, pin to the top of this list.' },
  { el: () => byId('detail'), title: 'The open plan',
    body: 'A plain-language summary, its status and tags, the controls to launch it, and the full plan text. ' +
      'A launched plan runs in the background; you can close the tab.' },
  { el: () => document.querySelector('.launchbar'), title: 'Run several at once',
    body: 'Tick plans in the list (or double-click them) and they queue down here. One press starts them all.' },
  { el: () => [byId('guidebtn'), byId('settingsbtn')], title: 'Guide and Settings',
    body: 'Guide brings back the walkthrough and the list of repos found on this machine. ' +
      'Settings is where you rename projects, change folders and edit launchers.' },
];
let tourStep = -1;
function startTour() {
  // open a plan first, so the plan pane shows something real rather than "Select a plan"
  if (!selected) {
    const first = plans.find((p) => !p.archived);
    if (first) { selected = first.key; renderList(); renderDetail(true); }
  }
  tourStep = 0;
  byId('tour').classList.add('open');
  setTimeout(paintTour, 150);
}
function endTour() {
  tourStep = -1;
  byId('tour').classList.remove('open');
}
function paintTour() {
  if (tourStep < 0) return;
  const s = TOUR[tourStep];
  const els = [].concat(s.el()).filter(Boolean);
  if (!els.length) return endTour();
  const rs = els.map((e) => e.getBoundingClientRect());
  const pad = 6;
  const r = { left: Math.min(...rs.map((x) => x.left)) - pad, top: Math.min(...rs.map((x) => x.top)) - pad,
              right: Math.max(...rs.map((x) => x.right)) + pad, bottom: Math.max(...rs.map((x) => x.bottom)) + pad };
  const hole = byId('tourhole');
  hole.style.left = Math.max(0, r.left) + 'px'; hole.style.top = Math.max(0, r.top) + 'px';
  hole.style.width = (Math.min(innerWidth, r.right) - Math.max(0, r.left)) + 'px';
  hole.style.height = (Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) + 'px';
  const pop = byId('tourpop');
  pop.innerHTML = '<div class="tp-count">' + (tourStep + 1) + ' of ' + TOUR.length + '</div><b>' + s.title +
    '</b><p>' + esc(s.body) + '</p><div class="tp-foot"><button class="linkbtn" id="tourskip">' +
    (tourStep === TOUR.length - 1 ? '' : 'Skip tour') + '</button><span style="flex:1"></span>' +
    (tourStep ? '<button class="sm" id="tourprev">Back</button>' : '') +
    '<button class="sm primary" id="tournext">' + (tourStep === TOUR.length - 1 ? 'Done' : 'Next') + '</button></div>';
  // beside the region if it fits (right, left, below, above), else inside its top-left corner
  const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 14, W = innerWidth, H = innerHeight;
  const spots = [
    [r.right + gap, r.top], [r.left - gap - pw, r.top],
    [r.right - pw, r.bottom + gap], [r.right - pw, r.top - gap - ph],
  ];
  const fits = ([x, y]) => x >= 8 && x + pw <= W - 8 && y + ph <= H - 8 && y >= 8;
  let [x, y] = spots.find(fits) || [r.left + 24, r.top + 24];
  x = Math.min(Math.max(8, x), W - pw - 8); y = Math.min(Math.max(8, y), H - ph - 8);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  byId('tourskip').addEventListener('click', endTour);
  byId('tournext').addEventListener('click', () => tourGo(1));
  if (byId('tourprev')) byId('tourprev').addEventListener('click', () => tourGo(-1));
  byId('tournext').focus();
}
function tourGo(d) {
  const n = tourStep + d;
  if (n >= TOUR.length) return endTour();
  tourStep = Math.max(0, n);
  paintTour();
}
addEventListener('resize', paintTour);
let lastStateRaw = '', firstPaint = false, ticking = false;
const connMsg = (m) => {
  const el = byId('connmsg');
  el.textContent = m || '';
  el.style.display = m ? '' : 'none';
};
// A cold /api/state builds every plan in every project and can take ~9s — far longer
// than the 5s tick. Without this guard the ticks pile up and their responses can land
// out of order, repainting the list from a stale payload.
// --- alerts: a sound, and a desktop notification when this tab is not in front, when a run
// stops (needs you, failed, finished) or the Ask agent finishes. Off until 🔔 is clicked,
// which is also the click the browser wants before it allows sound and notifications.
let alertsOn = false, audio = null;
try { alertsOn = localStorage.getItem('dash-alerts') === '1'; } catch {}
const wasBusy = {};   // plan key -> 'run' / 'ask' flags at the last state
function paintAlertBtn() {
  const b = byId('alertBtn');
  b.textContent = alertsOn ? '🔔' : '🔕';
  b.setAttribute('aria-pressed', String(alertsOn));
  b.title = alertsOn ? 'Alerts on: sound and notification when a run stops or the agent answers. Click to turn off.'
    : 'Alerts off. Click for a sound and a notification when a run stops or the agent answers.';
}
function chime() {
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    [[660, 0], [880, 0.16]].forEach(([f, at]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
      o.connect(g).connect(audio.destination);
      o.start(t + at); o.stop(t + at + 0.4);
    });
  } catch {}
}
function alertUser(title, body, key, tab) {
  if (!alertsOn) return;
  chime();
  if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, tag: key + title });
  n.onclick = () => {
    window.focus(); n.close();
    selected = key; if (tab) prTab[key] = tab;
    lastPrDraw = null; renderList(); renderDetail(true);
  };
}
function checkAlerts() {
  for (const p of plans) {
    const run = !!(p.live || starting(p)), ask = !!p.asking, was = wasBusy[p.key];
    if (was && was.run && !run) {
      const o = outOf(p);
      alertUser(o === 'failed' ? 'Run failed' : o === 'needs-you' ? 'Run needs you' : 'Run finished',
        p.project + ' / ' + p.file, p.key);
    }
    if (was && was.ask && !ask) alertUser('The agent answered', p.project + ' / ' + p.file, p.key, 'ask');
    wasBusy[p.key] = { run, ask };
  }
}
byId('alertBtn').addEventListener('click', async () => {
  alertsOn = !alertsOn;
  try { localStorage.setItem('dash-alerts', alertsOn ? '1' : '0'); } catch {}
  paintAlertBtn();
  if (alertsOn) {
    chime();   // a sample, and it unlocks sound for this tab
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    if ('Notification' in window && Notification.permission === 'denied')
      alert('Notifications are blocked for this site, so you will only hear the sound. Allow them in the browser’s site settings.');
  }
});
// a browser keeps sound locked until the page gets a click; the first click anywhere unlocks it
document.addEventListener('pointerdown', () => { if (alertsOn && !audio) { try { audio = new AudioContext(); } catch {} } }, { once: true });
paintAlertBtn();
async function refresh() {
  if (ticking) return;
  ticking = true;
  try { await refreshOnce(); } finally { ticking = false; }
}
async function refreshOnce() {
  // This used to be a bare unguarded await on fetch('/api/state'). A rejected
  // fetch (the server restarts under launchd --watch) or any non-200 made the very
  // first refresh() throw, so renderList() never ran even once and the page sat on
  // its static markup — an empty sidebar that looks exactly like "no plans".
  let raw;
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    raw = await res.text();
  } catch (e) {
    connMsg('⚠️ reconnecting… ' + String((e && e.message) || e));
    if (!firstPaint) byId('side').innerHTML =
      '<div class="dim" style="padding:14px">waiting for the server…</div>';
    return; // leave lastStateRaw alone: a failed tick must not suppress the next good one
  }
  byId('clock').textContent = new Date().toLocaleTimeString();
  // Most ticks carry a byte-identical payload, and repainting one of those is
  // pure destruction: it rebuilds the whole list and detail pane and throws away
  // the user's selection. Repaint only on a real change, and if something is
  // selected right now, leave it alone and take the change on a later tick.
  // The very first paint always goes through — there is nothing to protect yet,
  // and a stray selection must not be able to leave the dashboard blank.
  if (raw !== lastStateRaw && (!firstPaint || !selectionLive())) {
    let next;
    try {
      next = JSON.parse(raw);
      if (!Array.isArray(next)) throw new Error('expected an array of projects');
    } catch (e) {
      // e.g. the 500 path returning {error}. Report it and keep lastStateRaw unset,
      // so a later good payload still repaints instead of being deduped away.
      connMsg('⚠️ bad /api/state payload — ' + String((e && e.message) || e));
      return;
    }
    state = next;
    plans = state.flatMap((proj) => proj.plans.map((p) => ({
      ...p, project: proj.name, client: proj.client,
      hasPipeline: proj.hasPipeline, modes: proj.modes, launchers: proj.launchers, issuesUrl: proj.issuesUrl,
      prError: proj.prError,
    })));
    // don't clobber the pane (and steal focus) while the user is typing in it
    const typing = byId('detail').contains(document.activeElement)
      && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    checkAlerts();
    renderList();
    if (selected && !typing) renderDetail(false);
    else if (!selected) renderEmptyDetail();
    if (!firstPaint && !state.length && !byId('onb').classList.contains('open')) {
      let closed = null;
      try { closed = sessionStorage.getItem('dash-guide-closed'); } catch {}
      if (!closed) openGuide(0);
    }
    renderBar();
    lastStateRaw = raw;   // only once a full repaint has actually landed
    firstPaint = true;
  }
  connMsg('');
  if (logKey) loadLog();
}
readUrl();
byId('side').innerHTML = '<div class="dim" style="padding:14px">loading plans…</div>';
refresh();
let lastTick = Date.now();
setInterval(() => {
  const fast = Date.now() < fastUntil || plans.some(starting);
  if (!fast && Date.now() - lastTick < 5000) return;
  lastTick = Date.now(); refresh();
}, 1000);
if (new URLSearchParams(location.search).get('settings')) openSettings();
if (new URLSearchParams(location.search).get('tour')) {
  const tourWhenPainted = () => (firstPaint ? startTour() : setTimeout(tourWhenPainted, 200));
  tourWhenPainted();
}
if (new URLSearchParams(location.search).get('guide')) openGuide(+new URLSearchParams(location.search).get('guide') - 1 || 0);
</script>`;

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
