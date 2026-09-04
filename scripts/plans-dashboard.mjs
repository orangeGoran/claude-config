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
// and the README for the full field reference.
//
// Two flavors per project, auto-detected:
//  - auto-pipeline: <root>/.claude/scripts/auto-pipeline.sh exists → full solver-style
//    features (verify/full modes, resume, worktrees, reports, cleanup, lanes).
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
  writeFileSync, renameSync, statSync,
} from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const VERSION = '1.0.0';
const HOME = os.homedir();
const REG_FILE = path.join(HOME, '.claude', 'pipeline-projects.json');
const CENTRAL = path.join(HOME, '.claude', 'pipeline-dashboard');
const PORT = +(process.env.DASH_PORT || 4899);
const NO_SUMMARY = !!process.env.DASH_NO_SUMMARY;

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

const expand = (p) => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
// under launchd the PATH is minimal (/usr/bin:/bin:…) — no nvm node, no claude,
// no code. Augment it for every child process this server spawns.
const ENV = {
  ...process.env,
  PATH: [
    process.env.PATH || '',
    path.dirname(process.execPath),        // the node running this server (nvm)
    path.join(HOME, '.local', 'bin'),      // claude CLI
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
    stateDir,
    logsDir: path.join(CENTRAL, 'logs', p.name),
    runsFile: path.join(stateDir, 'runs.json'),
    issuesUrl: issuesUrlFor(root),
  };
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

// pipeline flavor: report lives in <plansDir>/auto-runs/<slug>.md
const pipelineRunInfo = (proj, slug) => {
  const report = path.join(proj.autoRunsDir, slug + '.md');
  if (!existsSync(report)) return null;
  const content = readFileSync(report, 'utf8');
  const status = (content.match(/^## Status:\s*(.+)$/m) || [])[1] || 'unknown';
  const timeline = [...content.matchAll(/^- (20\d\d[^\n]+)$/gm)].map((m) => m[1]);
  return { status: status.trim(), lastEvent: timeline.at(-1) || '' };
};
const pipelineLive = (slug) =>
  new Promise((resolve) => {
    execFile('pgrep', ['-f', `skill-auto-pipeline ${slug}.md`], (err) => resolve(!err));
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
  return {
    run: { status, lastEvent: (finishedAt ? 'finished ' + finishedAt : 'started ' + r.startedAt) || '' },
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
  const active = await Promise.all(
    planFiles(proj).map(async (f) => {
      const slug = f.replace(/\.md$/, '');
      const key = proj.name + '/' + slug;
      const content = readFileSync(path.join(proj.plansDir, f), 'utf8');
      let run, live, wtPath, transcriptDir, sessionFilter;
      if (proj.hasPipeline) {
        run = pipelineRunInfo(proj, slug);
        live = await pipelineLive(slug);
        wtPath = path.join(proj.worktrees, slug);
        transcriptDir = transcriptDirFor(wtPath);
      } else {
        ({ run, live } = genericRunInfo(proj, slug));
        wtPath = proj.root;
        transcriptDir = transcriptDirFor(proj.root);
        sessionFilter = sessionIdsInLog(proj, slug);
      }
      return {
        slug, file: f, key,
        title: planTitle(content) || slug,
        summary: summaries[slug] || null,
        summarizing: summarizing === key || summaryQueue.some((q) => q.key === key),
        validations: validationRounds(proj, slug),
        run, live,
        worktree: proj.hasPipeline && existsSync(path.join(proj.worktrees, slug)),
        status: meta[slug]?.status || null,
        tags: meta[slug]?.tags || [],
        wtPath, transcriptDir,
        sessions: sessionsIn(transcriptDir, sessionFilter),
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
        wtPath: proj.root, transcriptDir: transcriptDirFor(proj.root), sessions: [],
      };
    });
  return [...active, ...archived];
};

const fullState = async () => {
  const out = [];
  for (const proj of allProjects()) {
    out.push({
      name: proj.name, client: proj.client, root: proj.root, plansDir: proj.plansDir,
      hasPipeline: proj.hasPipeline, hasLanes: proj.hasLanes,
      launchers: proj.launchers, issuesUrl: proj.issuesUrl,
      plans: await listPlans(proj),
    });
  }
  return out;
};

// ---------- background summarizer (auto, sequential, cached per project) ----------

let summarizing = null; // key = "<project>/<slug>"
const summaryQueue = [];
const summaryFailed = new Set();

const explain = (proj, slug) =>
  new Promise((resolve, reject) => {
    const content = readFileSync(path.join(proj.plansDir, slug + '.md'), 'utf8').slice(0, 24000);
    const prompt =
      'Summarize this implementation plan in 3-5 plain-English sentences for someone completely new to the project. ' +
      'No jargon, no file paths. Say WHAT will be built and WHY it matters. Reply with the summary only.\n\n' + content;
    execFile('claude', ['-p', prompt, '--model', 'haiku'],
      { env: ENV, timeout: 180000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        const s = loadSummaries(proj);
        s[slug] = stdout.trim();
        saveSummaries(proj, s);
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
    for (const f of planFiles(proj)) {
      const slug = f.replace(/\.md$/, '');
      const key = proj.name + '/' + slug;
      if (!s[slug] && !summaryFailed.has(key) && summarizing !== key
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
const runLauncher = (proj, args) => {
  const fd = dashLog(proj);
  const child = spawn('bash', [proj.launcherScript, ...args], {
    cwd: proj.root, env: ENV, detached: true, stdio: ['ignore', fd, fd],
  });
  child.unref();
};
const launchPipeline = (proj, items) => {
  const groups = { verify: [], full: [] };
  for (const it of items) groups[it.mode === 'full' ? 'full' : 'verify'].push(it.slug + '.md');
  if (groups.verify.length) runLauncher(proj, ['--stop-at-verify', ...groups.verify]);
  if (groups.full.length) runLauncher(proj, ['--full', ...groups.full]);
};

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
  // an EXIT trap (not a trailing line) so the code is recorded even when the launcher
  // calls exit itself; the path travels via the environment to dodge shell quoting
  const script = `trap 'printf %s $? > "$DASH_EXIT_FILE"' EXIT\n` + cmd + '\n';
  const env = { ...ENV, DASH_EXIT_FILE: exitFile };
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
  const live = proj.hasPipeline ? await pipelineLive(slug) : genericRunInfo(proj, slug).live;
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
          if (!e || !safeName(e.name) || !e.root || typeof e.root !== 'string') {
            warnings.push('Skipped an entry with a missing/invalid name or root.'); continue;
          }
          if (seen.has(e.name)) { warnings.push('Duplicate name skipped: ' + e.name); continue; }
          seen.add(e.name);
          const entry = {
            name: e.name,
            client: String(e.client || 'Default').slice(0, 40),
            root: String(e.root).slice(0, 500),
            launchers: Array.isArray(e.launchers) ? e.launchers : [],
          };
          if (e.plansDir && String(e.plansDir).trim()) entry.plansDir = String(e.plansDir).slice(0, 500);
          if (e.doneDir && String(e.doneDir).trim()) entry.doneDir = String(e.doneDir).slice(0, 500);
          if (!existsSync(expand(entry.root)))
            warnings.push(entry.name + ': root does not exist: ' + entry.root);
          else if (entry.plansDir && !existsSync(expand(entry.plansDir)))
            warnings.push(entry.name + ': plansDir does not exist: ' + entry.plansDir);
          cleaned.push(entry);
        }
        saveRegistry(cleaned);
        return json(res, 200, { ok: true,
          output: warnings.length ? warnings.join('\n') : 'Settings saved — ' + cleaned.length + ' project(s).' });
      }
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
        runLauncher(proj, ['--resume', b.slug, b.mode === 'full' ? '--full' : '--stop-at-verify']);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/cleanup') {
        if (!proj.hasPipeline) return json(res, 400, { error: 'not a pipeline project' });
        return json(res, 200, await cleanup(proj, b.slug, !!b.artifacts));
      }
      if (url.pathname === '/api/archive') return json(res, 200, await archivePlan(proj, b.slug));
      if (url.pathname === '/api/unarchive') return json(res, 200, unarchivePlan(proj, b.slug));
      if (url.pathname === '/api/vscode') return json(res, 200, { ok: true, target: openInVsCode(proj, b.slug) });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

// ---------- page ----------

const PAGE = /* html */ `<!doctype html>
<meta charset="utf-8">
<title>Plans</title>
<link rel="icon" id="favicon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ctext%20x%3D%2232%22%20y%3D%2246%22%20font-size%3D%2256%22%20text-anchor%3D%22middle%22%3E%F0%9F%98%B4%3C%2Ftext%3E%3C%2Fsvg%3E">
<style>
  :root { --bg:#101218; --panel:#151823; --card:#1b1f2c; --line:#2b3040; --fg:#e7eaf1;
          --dim:#98a1b4; --ok:#4ade80; --run:#60a5fa; --warn:#fbbf24; --bad:#f87171;
          --accent:#8b5cf6; --link:#7cb0ff; --input:#0e1016; --hover:#1c2130; --sel:#242b49;
          --btn:#242a3a; --dot:#39415a; --codebg:#0d0f14; --codechip:#262c3d; --thbg:#20263a;
          --logfg:#c8d0e0; --stfg:#c4b5fd; }
  :root[data-theme="light"] { --bg:#f4f5f8; --panel:#ffffff; --card:#ffffff; --line:#d9dde6;
          --fg:#1d2433; --dim:#5f6b81; --ok:#15803d; --run:#2563eb; --warn:#b45309; --bad:#dc2626;
          --accent:#7c3aed; --link:#1d4ed8; --input:#f0f2f7; --hover:#eef1f7; --sel:#e3e7f5;
          --btn:#eef0f6; --dot:#c3c9d8; --codebg:#f6f7fa; --codechip:#e8eaf2; --thbg:#eaedf5;
          --logfg:#333c50; --stfg:#6d28d9; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); height:100vh; display:flex;
         flex-direction:column; font:14px/1.55 -apple-system,"Segoe UI",sans-serif; }
  header { padding:11px 20px; border-bottom:1px solid var(--line); display:flex;
           align-items:center; gap:14px; flex-shrink:0; }
  h1 { font-size:15px; margin:0; }
  .wrap { flex:1; display:flex; min-height:0; }
  aside { width:400px; border-right:1px solid var(--line); background:var(--panel);
          flex-shrink:0; display:flex; flex-direction:column; }
  .filters { padding:10px 12px 6px; display:flex; gap:8px; }
  .filters.sub { padding:0 12px 10px; border-bottom:1px solid var(--line); align-items:center; }
  .filters button { font-size:12px; }
  .tgl.on { border-color:var(--accent); color:var(--stfg); background:rgba(139,92,246,.14); }
  .filters input, .filters select { background:var(--input); color:var(--fg); border:1px solid var(--line);
          border-radius:8px; padding:6px 10px; font-size:13px; }
  .filters input { flex:1; min-width:0; }
  .filters button { padding:5px 9px; flex-shrink:0; }
  .items { flex:1; overflow-y:auto; }
  .ghead { padding:12px 13px 5px; font-size:11px; letter-spacing:.14em; font-weight:800;
           color:var(--accent); text-transform:uppercase;
           border-top:3px solid var(--accent); background:var(--card); }
  .ghead:first-child { border-top:0; }
  .phead { padding:7px 13px; font:600 12px/1.4 ui-monospace,monospace; color:var(--fg);
           border-top:2px solid var(--line); border-bottom:1px solid var(--line);
           background:var(--thbg); display:flex; align-items:center; gap:8px;
           cursor:pointer; user-select:none; position:sticky; top:0; z-index:2; }
  .phead:hover { background:var(--hover); }
  .phead .cnt { font-weight:400; margin-left:auto; color:var(--dim); }
  .phead .chev { color:var(--dim); width:13px; flex-shrink:0; }
  .phead .pbtn { padding:1px 8px; font-size:11px; border-radius:7px; flex-shrink:0; }
  .item { padding:10px 13px; border-bottom:1px solid var(--line); cursor:pointer;
          display:flex; gap:10px; }
  .item:hover { background:var(--hover); }
  .item.sel { background:var(--sel); }
  .item input { transform:scale(1.15); flex-shrink:0; margin-top:3px; }
  .item .t { flex:1; min-width:0; }
  .item .name { font:600 12px/1.4 ui-monospace,monospace; word-break:break-all; }
  .chiprow { display:flex; gap:4px; flex-wrap:wrap; margin-top:5px; align-items:center; }
  .chip { font-size:10px; padding:1px 7px; border-radius:99px; border:1px solid var(--line);
          color:var(--dim); white-space:nowrap; }
  .chip.st { border-color:var(--accent); color:var(--stfg); }
  .chip.live { color:var(--run); border-color:var(--run); }
  .chip.ok { color:var(--ok); border-color:var(--ok); }
  .chip.warn { color:var(--warn); border-color:var(--warn); }
  .chip.bad { color:var(--bad); border-color:var(--bad); }
  .chip.x { cursor:pointer; } .chip.x:hover { border-color:var(--bad); color:var(--bad); }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--dot); flex-shrink:0; margin-top:5px; }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.3 } }
  .dot.live { background:var(--run); box-shadow:0 0 7px var(--run); animation:pulse 1.5s ease-in-out infinite; }
  .item.live { border-left:3px solid var(--run); background:rgba(96,165,250,.08); }
  .item.bad { border-left:3px solid var(--bad); }
  .item.ok { border-left:3px solid var(--ok); background:rgba(74,222,128,.06); }
  .runstrip { padding:8px 12px 10px; border-bottom:2px solid var(--line); display:none; }
  .runstrip.on { display:block; }
  .runstrip .cap { font-size:10px; letter-spacing:.12em; color:var(--run); font-weight:700; margin-bottom:4px; }
  .runstrip .rp { display:flex; align-items:center; gap:9px; padding:7px 10px; border:1px solid var(--run);
                  border-radius:9px; margin:4px 0; cursor:pointer; background:rgba(96,165,250,.12); }
  .runstrip .rp:hover { background:rgba(96,165,250,.22); }
  .runstrip .rp .n { font:600 12px/1.4 ui-monospace,monospace; word-break:break-all; flex:1; }
  .runstrip .rp .n .pfx { color:var(--dim); font-weight:400; }
  .runstrip .rp .mini { padding:3px 9px; font-size:11px; flex-shrink:0; }
  .runstrip .cap.okc { color:var(--ok); margin-top:8px; }
  .runstrip .rp.okp { border-color:var(--ok); background:rgba(74,222,128,.10); }
  .runstrip .rp.okp:hover { background:rgba(74,222,128,.20); }
  .runstrip .cap.wc { color:var(--warn); margin-top:8px; }
  .runstrip .rp.wp { border-color:var(--warn); background:rgba(251,191,36,.10); }
  .runstrip .rp.wp:hover { background:rgba(251,191,36,.18); }
  .hdok { font-size:12px; color:var(--ok); border:1px solid var(--ok); border-radius:99px;
          padding:2px 11px; font-weight:600; }
  .hdrun { font-size:12px; color:var(--run); border:1px solid var(--run); border-radius:99px;
           padding:2px 11px; font-weight:600; }
  .dot.ok { background:var(--ok); } .dot.bad { background:var(--bad); } .dot.warn { background:var(--warn); }
  section { flex:1; overflow-y:auto; padding:22px 30px 60px; }
  .crumb { font-size:12px; color:var(--dim); margin-bottom:4px; }
  h2.fname { margin:0; font:600 17px/1.4 ui-monospace,monospace; word-break:break-all; }
  .subtitle { color:var(--dim); margin:4px 0 0; }
  .badges { display:flex; gap:6px; margin:12px 0; flex-wrap:wrap; }
  .summary { padding:12px 15px; background:var(--card); border:1px solid var(--line);
             border-radius:10px; margin:12px 0; }
  .metabox, .modes { display:flex; gap:12px; margin:12px 0; padding:11px 14px; background:var(--card);
           border:1px solid var(--line); border-radius:10px; align-items:center; flex-wrap:wrap; }
  .metabox select, .metabox input { background:var(--input); color:var(--fg); border:1px solid var(--line);
           border-radius:7px; padding:5px 9px; font-size:13px; }
  .modes label { display:flex; gap:6px; align-items:center; color:var(--dim); cursor:pointer; }
  .btns { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
  button { background:var(--btn); color:var(--fg); border:1px solid var(--line); border-radius:8px;
           padding:7px 13px; cursor:pointer; font-size:13px; }
  button:hover { border-color:var(--accent); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button.danger:hover { border-color:var(--bad); color:var(--bad); }
  .planview { margin-top:18px; border-top:1px solid var(--line); padding-top:14px; }
  .mdc { max-width:820px; }
  .mdc h1, .mdc h2, .mdc h3, .mdc h4 { margin:20px 0 8px; line-height:1.3; }
  .mdc h1 { font-size:20px; } .mdc h2 { font-size:17px; border-bottom:1px solid var(--line); padding-bottom:5px; }
  .mdc h3 { font-size:15px; } .mdc p { margin:8px 0; } .mdc ul, .mdc ol { margin:8px 0; padding-left:24px; }
  .mdc li { margin:3px 0; }
  .mdc code { background:var(--codechip); border-radius:5px; padding:1px 6px; font:12px ui-monospace,monospace; }
  .mdc pre { background:var(--codebg); border:1px solid var(--line); border-radius:10px; padding:13px;
             overflow-x:auto; font:12px/1.5 ui-monospace,monospace; }
  .mdc pre code { background:none; padding:0; }
  .mdc a { color:var(--link); }
  .mdc blockquote { border-left:3px solid var(--accent); margin:8px 0; padding:2px 14px; color:var(--dim); }
  .mdc table { border-collapse:collapse; margin:10px 0; display:block; overflow-x:auto; }
  .mdc th, .mdc td { border:1px solid var(--line); padding:5px 11px; font-size:13px; text-align:left; }
  .mdc th { background:var(--thbg); }
  .mdc hr { border:0; border-top:1px solid var(--line); margin:16px 0; }
  .plink { cursor:pointer; color:var(--link); }
  .plink:hover { text-decoration:underline; }
  .hdwarn { font-size:12px; color:var(--warn); }
  .copycmd { cursor:pointer; color:var(--warn); font-weight:700;
             text-decoration:underline dotted; text-underline-offset:2px; }
  .copycmd:hover { text-decoration:underline; }
  .launchbar { border-top:1px solid var(--line); background:var(--panel); padding:10px 20px;
               display:flex; gap:14px; align-items:center; flex-shrink:0; }
  .dim { color:var(--dim); } .laststep { font-size:12px; color:var(--dim); margin-top:6px; }
  #logpane { position:fixed; top:0; right:0; bottom:0; width:46%; min-width:430px;
             background:var(--codebg); border-left:1px solid var(--line);
             box-shadow:-10px 0 34px rgba(0,0,0,.3);
             display:none; flex-direction:column; z-index:10; }
  #logpane.open { display:flex; }
  #logbody { flex:1; overflow:auto; padding:16px; white-space:pre-wrap;
             font:12px/1.5 ui-monospace,monospace; color:var(--logfg); }
  .setup { font-family:-apple-system,sans-serif; font-size:13px; line-height:1.7; white-space:normal; color:var(--fg); }
  .setup .opt { display:flex; gap:8px; align-items:flex-start; margin:5px 0; }
  .setup textarea { width:100%; min-height:74px; background:var(--input); color:var(--fg);
             border:1px solid var(--line); border-radius:8px; padding:8px 10px;
             font:12px/1.5 ui-monospace,monospace; }
  .setup input[type=text] { background:var(--input); color:var(--fg); border:1px solid var(--line);
             border-radius:7px; padding:5px 9px; font-size:13px; }
  .setup .lrow { display:flex; gap:8px; align-items:center; margin:4px 0;
             font:12px/1.5 ui-monospace,monospace; }
  .setup .hint { color:var(--dim); font-size:12px; margin:0 0 12px; }
  .setup code { background:var(--codechip); border-radius:5px; padding:1px 5px;
             font:11px ui-monospace,monospace; }
  .pcard { border:1px solid var(--line); border-radius:12px; margin:12px 0;
             background:var(--card); overflow:hidden; }
  .pcard-head { display:flex; gap:10px; align-items:center; padding:10px 14px;
             border-bottom:1px solid var(--line); background:var(--thbg); }
  .pcard-head input { font-weight:600; }
  .pcard-body { padding:12px 14px 4px; display:grid; grid-template-columns:96px 1fr;
             gap:10px 12px; align-items:center; }
  .flabel { font-size:12px; color:var(--dim); text-align:right; }
  .pcard input[type=text] { width:100%; background:var(--input); border:1px solid var(--line);
             border-radius:8px; padding:7px 10px; font-size:13px; color:var(--fg); }
  .pcard-head input[type=text] { width:auto; }
  .pcard input.mono { font:12px/1.4 ui-monospace,monospace; }
  .pcard-foot { padding:8px 14px 12px; font-size:11px; color:var(--dim); }
  .rmbtn { margin-left:auto; background:none; border:none; color:var(--dim); font-size:12px;
             cursor:pointer; padding:4px 10px; border-radius:7px; }
  .rmbtn:hover { color:var(--bad); background:rgba(248,113,113,.12); }
  .setupbar { display:flex; gap:10px; align-items:center; margin-top:16px; padding-top:14px;
             border-top:1px solid var(--line); }
  input, select, textarea, button { transition:border-color .15s, background .15s, color .15s; }
  input:focus-visible, select:focus-visible, textarea:focus-visible {
             outline:2px solid var(--accent); outline-offset:-1px; }
</style>
<header><h1>🗂 Plans</h1><span class="hdrun" id="hdrun" style="display:none"></span>
  <span class="hdok" id="hdok" style="display:none"></span>
  <span class="dim" id="clock"></span>
  <span class="hdwarn" id="connmsg" style="display:none"></span>
  <span class="dim" style="margin-left:auto">auto-refresh 5s · summaries generate in background</span>
  <button id="settingsbtn" title="projects & settings">⚙ Settings</button>
  <button id="themeBtn" title="toggle light/dark">🌙</button></header>
<div class="wrap">
  <aside>
    <div class="filters">
      <input id="q" placeholder="search name / tag / project…">
      <select id="statusFilter"><option value="">all statuses</option></select>
    </div>
    <div class="filters sub">
      <button id="showDoneBtn" class="tgl"
              title="show or hide plans that were archived to the done folder">📦 Show archived</button>
      <span style="flex:1"></span>
      <button id="collapseAll" title="collapse or expand all project sections">Collapse all</button>
    </div>
    <div class="runstrip" id="runstrip"></div>
    <div class="items" id="side"></div>
  </aside>
  <section id="detail"><span class="dim">Select a plan on the left.</span></section>
</div>
<div class="launchbar">
  <span id="selcount" class="dim">0 queued</span>
  <span class="dim" id="selmodes" style="font-size:12px"></span>
  <span style="flex:1"></span>
  <button class="primary" id="launchbtn">▶ Launch queued in parallel</button>
</div>
<div id="logpane">
  <header><h1 id="logtitle"></h1><span style="margin-left:auto"></span>
    <button id="backBtn" style="display:none">‹ Back</button>
    <button onclick="closeLog()">✕ close</button></header>
  <div id="logbody"></div>
</div>
<script>
// theme: remembered per browser, defaults to system preference
const applyTheme = (t) => {
  document.documentElement.dataset.theme = t;
  document.getElementById('themeBtn').textContent = t === 'light' ? '🌙' : '☀️';
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
let showDone = false;
const modes = {};         // per key: 'verify'|'full' (pipeline) or launcher index (generic)
const modeOf = (p) => modes[p.key] ?? (p.hasPipeline ? 'verify' : 0);
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
const OKRE = /^(VERIFIED|REVIEWED|COMMITTED|FINISHED)/i;
const BADRE = /^(BLOCKED|FAILED|ENDED)/i;

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
function md(src) {
  const fences = [];
  const fenceRe = new RegExp(BT + BT + BT + '[^\\n]*\\n([\\s\\S]*?)' + BT + BT + BT, 'g');
  src = src.replace(fenceRe, (m, code) => {
    fences.push('<pre><code>' + esc(code) + '</code></pre>');
    return '\\u0001' + (fences.length - 1) + '\\u0001';
  });
  const out = []; let list = null, para = [], tbl = null;
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
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
const dotClass = (p) => p.live ? 'live'
  : !p.run ? ''
  : OKRE.test(p.run.status) ? 'ok'
  : BADRE.test(p.run.status) ? 'bad' : 'warn';

const autoChips = (p) => {
  let c = '';
  if (p.live) c += '<span class="chip live">● running</span>';
  else if (p.run) c += '<span class="chip ' +
    (OKRE.test(p.run.status) ? 'ok' : BADRE.test(p.run.status) ? 'bad' : 'warn') +
    '">' + esc(p.run.status.split(/[.—]/)[0].slice(0, 42)) + '</span>';
  if (p.validations) c += '<span class="chip ok">validated ×' + p.validations + '</span>';
  if (p.worktree) c += '<span class="chip">worktree</span>';
  if (p.archived) c += '<span class="chip">📦 archived</span>';
  return c;
};

function visiblePlans() {
  const q = byId('q').value.toLowerCase();
  const st = byId('statusFilter').value;
  return plans.filter((p) =>
    (!q || p.file.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)
      || p.project.toLowerCase().includes(q) || p.client.toLowerCase().includes(q)
      || p.tags.some((t) => t.toLowerCase().includes(q)))
    && (!st || p.status === st)
    && (!p.archived || showDone || selected === p.key));
}
const itemHtml = (p) => \`
    <div class="item \${selected === p.key ? 'sel' : ''} \${dotClass(p)}" data-key="\${p.key}">
      <input type="checkbox" data-check="\${p.key}" \${picked.has(p.key) ? 'checked' : ''}
             \${p.live || p.worktree || p.archived ? 'disabled' : ''}>
      <div class="t">
        <div class="name">\${p.file}</div>
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
  const inflight = plans.filter((p) =>
    !p.live && p.run && !OKRE.test(p.run.status) && !BADRE.test(p.run.status));
  const ready = plans.filter((p) => !p.live && p.run && OKRE.test(p.run.status));
  const bad = plans.filter((p) => !p.live && p.run && BADRE.test(p.run.status));
  setMood({ live: live.length, inflight: inflight.length, bad: bad.length, ready: ready.length });
  const rs = byId('runstrip');
  rs.className = 'runstrip' + (live.length || inflight.length || ready.length ? ' on' : '');
  let sh = '';
  const stripName = (p) => '<span class="pfx">[' + esc(p.project) + ']</span> ' + p.file;
  if (live.length) sh += '<div class="cap">● RUNNING NOW — ' + live.length + '</div>' +
    live.map((p) => '<div class="rp" data-go="' + p.key + '"><span class="dot live"></span><span class="n">' +
      stripName(p) + '</span><button class="mini" data-log="' + p.key + '">📜 log</button></div>').join('');
  if (inflight.length) sh += '<div class="cap wc">⏳ LAUNCHED — IN PROGRESS — ' + inflight.length + '</div>' +
    inflight.map((p) => '<div class="rp wp" data-go="' + p.key + '"><span class="dot warn"></span><span class="n">' +
      stripName(p) + '</span><button class="mini" data-rep="' + p.key + '">' +
      (p.hasPipeline ? '📋 report' : '📜 log') + '</button></div>').join('');
  if (ready.length) sh += '<div class="cap okc">✓ AWAITING YOUR REVIEW — ' + ready.length + '</div>' +
    ready.map((p) => '<div class="rp okp" data-go="' + p.key + '"><span class="dot ok"></span><span class="n">' +
      stripName(p) + '</span><button class="mini" data-rep="' + p.key + '">' +
      (p.hasPipeline ? '📋 report' : '📜 log') + '</button></div>').join('');
  rs.innerHTML = sh;
  rs.querySelectorAll('[data-go]').forEach((el) =>
    el.addEventListener('click', () => { selected = el.dataset.go; renderList(); renderDetail(true); }));
  rs.querySelectorAll('[data-log]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openLog(el.dataset.log, 'log'); }));
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
  const clients = [...new Set(vis.map((p) => p.client))];
  byId('side').innerHTML = clients.map((c) => {
    const projNames = [...new Set(vis.filter((p) => p.client === c).map((p) => p.project))];
    return '<div class="ghead">' + esc(c) + '</div>' + projNames.map((pr) => {
      const items = vis.filter((p) => p.project === pr);
      const closed = collapsedProjects.has(pr);
      const hasLanes = (state.find((s) => s.name === pr) || {}).hasLanes;
      // run counters for the whole project (not just filtered-visible plans)
      const projPlans = plans.filter((p) => p.project === pr);
      const liveN = projPlans.filter((p) => p.live).length;
      const flightN = projPlans.filter((p) =>
        !p.live && p.run && !OKRE.test(p.run.status) && !BADRE.test(p.run.status)).length;
      const runBadges =
        (liveN ? '<span class="chip live">● ' + liveN + ' running</span>' : '') +
        (flightN ? '<span class="chip warn">⏳ ' + flightN + '</span>' : '');
      return '<div class="phead" data-toggle="' + esc(pr) + '"><span class="chev">' +
        (closed ? '▸' : '▾') + '</span>📁 ' + esc(pr) +
        (hasLanes ? '<button class="pbtn" data-suggest="' + esc(pr) +
          '" title="suggest a parallel launch batch">🧭 Suggest</button>' : '') + runBadges +
        '<span class="cnt">' + items.length + ' plan' + (items.length === 1 ? '' : 's') +
        '</span></div>' + (closed ? '' : items.map(itemHtml).join(''));
    }).join('');
  }).join('');
  byId('side').querySelectorAll('[data-suggest]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openSuggest(el.dataset.suggest); }));
  const allProjNames = [...new Set(plans.map((p) => p.project))];
  byId('collapseAll').textContent =
    allProjNames.length && allProjNames.every((n) => collapsedProjects.has(n))
      ? 'Expand all' : 'Collapse all';
  const archCount = plans.filter((p) => p.archived).length;
  byId('showDoneBtn').textContent =
    (showDone ? '📦 Hide archived' : '📦 Show archived') + (archCount ? ' (' + archCount + ')' : '');
  byId('side').querySelectorAll('.phead[data-toggle]').forEach((el) =>
    el.addEventListener('click', () => {
      const pr = el.dataset.toggle;
      collapsedProjects.has(pr) ? collapsedProjects.delete(pr) : collapsedProjects.add(pr);
      saveCollapsed(); renderList();
    }));
  byId('side').querySelectorAll('.item').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.dataset.check) return;
      selected = el.dataset.key; renderList(); renderDetail(true);
    }));
  byId('side').querySelectorAll('input[data-check]').forEach((el) =>
    el.addEventListener('change', () => {
      el.checked ? picked.add(el.dataset.check) : picked.delete(el.dataset.check);
      renderBar(); renderList();
    }));
}

async function renderDetail(loadPlan) {
  const p = find(selected);
  if (!p) { byId('detail').innerHTML = '<span class="dim">Select a plan on the left.</span>'; return; }
  CUR_ISSUES = p.issuesUrl || '';
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
    ((!p.run && !p.live) || (p.run && !p.live && BADRE.test(p.run.status))) ? \`
    <div class="modes"><b>Where to stop:</b>
      <label><input type="radio" name="m" value="verify" \${modeOf(p) === 'verify' ? 'checked' : ''}>
        stop at verify — I review by hand</label>
      <label><input type="radio" name="m" value="full" \${modeOf(p) === 'full' ? 'checked' : ''}>
        full — through local commit</label></div>\` : '';
  byId('detail').innerHTML = \`
    <div class="crumb">\${esc(p.client)} / 📁 \${esc(p.project)}</div>
    <h2 class="fname">\${p.file}</h2>
    <div class="subtitle">\${inline(p.title)}</div>
    <div class="badges">\${autoChips(p)}</div>
    \${p.summary ? '<div class="summary">💡 ' + esc(p.summary) + '</div>'
      : p.summarizing ? '<div class="summary dim">💭 plain-language summary is being generated…</div>' : ''}
    \${p.run && p.run.lastEvent ? '<div class="laststep">last: ' + esc(p.run.lastEvent.slice(0, 200)) + '</div>' : ''}
    <div class="metabox"><b>Status:</b>
      <select id="stSel"><option value="">—</option>
        \${STATUSES.map((s) => '<option ' + (p.status === s ? 'selected' : '') + '>' + s + '</option>').join('')}
      </select>
      <b>Tags:</b><span id="tagRow" class="chiprow">
        \${p.tags.map((t) => '<span class="chip x" data-del="' + esc(t) + '">' + esc(t) + ' ✕</span>').join('')}</span>
      <input id="tagIn" list="tagOpts" placeholder="+ add tag ⏎" size="12">
      <datalist id="tagOpts">\${TAG_SUGGESTIONS.map((t) => '<option>' + t + '</option>').join('')}</datalist>
    </div>
    \${p.live ? '' : launcherModes}\${pipelineModes}
    <div class="btns" id="actions"></div>
    <div id="sessbox"></div>
    <div class="planview"><div class="mdc" id="planmd">loading plan…</div></div>\`;
  byId('stSel').addEventListener('change', () => saveMetaFor(p, byId('stSel').value || null, p.tags));
  byId('tagIn').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim())
      saveMetaFor(p, p.status, [...p.tags, e.target.value.trim()]);
  });
  byId('detail').querySelectorAll('[data-del]').forEach((el) =>
    el.addEventListener('click', () => saveMetaFor(p, p.status, p.tags.filter((t) => t !== el.dataset.del))));
  byId('detail').querySelectorAll('input[name=m]').forEach((el) =>
    el.addEventListener('change', () => { modes[p.key] = el.value; renderBar(); renderList(); }));
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
    : p.run ? (OKRE.test(p.run.status) ? 'review' : 'stuck')
    : 'fresh';
  const rep = () => openLog(p.key, 'report');
  const log = () => openLog(p.key, 'log');
  const vsc = () => post('/api/vscode', { project: p.project, slug: p.slug });
  const clean = () => p.hasPipeline ? cleanupRun(p) : clearRun(p);
  const launchNow = () => post('/api/launch-generic',
    { project: p.project, slug: p.slug, launcher: +modeOf(p) }, true);
  if (p.archived) {
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
      btn('⟳ Resume', () => post('/api/resume', { project: p.project, slug: p.slug, mode: modeOf(p) }, true));
      btn('🖥 Open in VS Code', vsc, null, moreWrap);
      btn('🗑 Clean up run', clean, 'danger', moreWrap);
    } else { // fresh: primary action is the queue checkbox + mode above
      if (p.worktree) { btn('🖥 Open in VS Code', vsc); btn('🗑 Clean up run', clean, 'danger', moreWrap); }
      else btn('📦 Archive plan → done/', () => archive(p), 'danger', moreWrap);
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
  if (moreWrap.childElementCount) {
    const mb = btn('⋯ more', () => {
      const shown = moreWrap.style.display !== 'none';
      moreWrap.style.display = shown ? 'none' : 'inline-flex';
      mb.textContent = shown ? '⋯ more' : '⋯ less';
    });
    A.appendChild(moreWrap);
  }
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
  // full plan, always visible, rendered as markdown
  if (loadPlan || !planCache[p.key])
    planCache[p.key] = await (await fetch('/api/plan?project=' + p.project + '&slug=' + p.slug)).text();
  byId('planmd').innerHTML = md(planCache[p.key]);
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
  setTimeout(refresh, 1200);
});
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
async function openLauncherSetup(projName, fromSettings) {
  logKey = null;
  setBack(fromSettings ? openSettings : null);
  byId('logtitle').textContent = '⚙ launchers — ' + projName;
  byId('logpane').classList.add('open');
  byId('logbody').innerHTML = '<div class="setup">scanning ' + esc(projName) + ' .claude folder…</div>';
  const d = await (await fetch('/api/discover?project=' + projName)).json();
  const proj = state.find((s) => s.name === projName) || { launchers: [] };
  const HEADLESS = ' --permission-mode acceptEdits --verbose --output-format stream-json';
  const tplSkill = (s) => 'claude -p "/' + s + ' {plan}"' + HEADLESS;
  const tplScript = (s) => (s.endsWith('.sh') ? 'bash' : 'node') + ' .claude/scripts/' + s + ' {plan}';
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
      '(stop-at-verify / full modes), and launchers here are <b>ignored</b>. ' +
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
      await refresh(); openLauncherSetup(projName, fromSettings);
    }));
  byId('lsave').addEventListener('click', async () => {
    const cmd = byId('lcmd').value.trim();
    if (!cmd) return alert('Pick a template or write a command first.');
    const ls = [...(proj.launchers || []),
      { label: byId('llabel').value.trim() || 'launcher', cmd }];
    await post('/api/launchers', { project: projName, launchers: ls });
    await refresh();
    if (fromSettings) openSettings();
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
      'that project\\u2019s plans through it (⚡ stop-at-verify / full, worktrees, reports) — nothing to ' +
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
          ? '⚡ launches via its own auto-pipeline.sh (stop-at-verify / full) — launchers not needed'
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
      el.addEventListener('click', () => openLauncherSetup(el.dataset.lset, true)));
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
      const vcmd = '/skill-auto-validate ' + (p.file || '.plans/' + p.slug + '.md');
      h += '<li><code class="plink" data-open="' + esc(K(p.slug)) + '">' + esc(p.slug) + '</code><br><span class="dim">areas: ' +
        esc((p.areas || []).join(', ') || '—') +
        ((v.claude || v.codex)
          ? ' · validated ' + (v.claude || 0) + '×claude / ' + (v.codex || 0) + '×codex'
          : ' · <b class="copycmd" data-copy="' + escA(vcmd) + '" title="click to copy: ' + escA(vcmd) + '">'
            + 'not validated — click to copy /skill-auto-validate</b>') +
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
  if (e.key !== 'Escape') return;
  if (drawerBack) drawerBack(); else closeLog();
});
byId('q').addEventListener('input', renderList);
byId('statusFilter').addEventListener('change', renderList);
byId('showDoneBtn').addEventListener('click', () => {
  showDone = !showDone;
  byId('showDoneBtn').classList.toggle('on', showDone);
  renderList();
});
byId('collapseAll').addEventListener('click', () => {
  const names = [...new Set(plans.map((p) => p.project))];
  if (names.every((n) => collapsedProjects.has(n))) collapsedProjects.clear();
  else names.forEach((n) => collapsedProjects.add(n));
  saveCollapsed(); renderList();
});
STATUSES.forEach((s) => {
  const o = document.createElement('option'); o.textContent = s; byId('statusFilter').appendChild(o);
});
let lastStateRaw = '', firstPaint = false, ticking = false;
const connMsg = (m) => {
  const el = byId('connmsg');
  el.textContent = m || '';
  el.style.display = m ? '' : 'none';
};
// A cold /api/state builds every plan in every project and can take ~9s — far longer
// than the 5s tick. Without this guard the ticks pile up and their responses can land
// out of order, repainting the list from a stale payload.
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
      hasPipeline: proj.hasPipeline, launchers: proj.launchers, issuesUrl: proj.issuesUrl,
    })));
    // don't clobber the pane (and steal focus) while the user is typing in it
    const typing = byId('detail').contains(document.activeElement)
      && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    renderList();
    if (selected && !typing) renderDetail(false);
    renderBar();
    lastStateRaw = raw;   // only once a full repaint has actually landed
    firstPaint = true;
  }
  connMsg('');
  if (logKey) loadLog();
}
selected = new URLSearchParams(location.search).get('sel') || null;
byId('side').innerHTML = '<div class="dim" style="padding:14px">loading plans…</div>';
refresh(); setInterval(refresh, 5000);
if (new URLSearchParams(location.search).get('settings')) openSettings();
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
