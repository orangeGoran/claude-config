#!/usr/bin/env node
// insights.mjs — the insights ledger: one JSON line per finished pipeline run of every
// registered project, in ~/.claude/pipeline-dashboard/insights.jsonl.
//
//   node apps/dashboard/insights.mjs --migrate [--dry-run]
//
// Each line holds `v: 1`, the project, the slug, the size and change time of the run's log
// and report (`src`), the launch and end times, the mode, the outcome, the status, the PR, the
// cost, the tokens, and the cost and minutes of each phase. The last line of a project + slug
// pair is the valid one. The dashboard's event watcher (server.mjs, "event watcher") adds the
// line of a new run by itself; the --migrate command adds the lines of all old runs. Both call
// syncLedger(), which holds insights.jsonl.lock while it reads and appends.
// Guide: docs/plans-dashboard.md, "Insights ledger".
import {
  readFileSync, readdirSync, statSync, existsSync, mkdirSync, appendFileSync, writeFileSync,
  linkSync, unlinkSync, renameSync, realpathSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseLog, loadSubagents, phaseRows, applyCosts } from '../../.claude/scripts/run-usage.mjs';

/** The path of the ledger file. */
export const LEDGER = path.join(os.homedir(), '.claude', 'pipeline-dashboard', 'insights.jsonl');
/** A "running" report older than this, with no live process, is a finished (dead) run. The value of STALE_RUN_MS in server.mjs. */
export const DEFAULT_STALE_MS = 30 * 60 * 1000;

const FAILED_RETRY_MS = 10 * 60 * 1000;
const LOCK_UNREADABLE_MS = 10000;
const OUTCOMES = ['running', 'needs-you', 'failed'];
const LAUNCHED_RE = /^- \*\*Launched\*\*:[ \t]*(.+)$/m;
const MODE_RE = /^- \*\*Mode\*\*:\s*([\w-]+)/m;   // the Mode rule of parseReport() in server.mjs
const OUTCOME_RE = /^- \*\*Outcome\*\*:\s*(\S+)/m;
const STATUS_RE = /^## Status:\s*(.+)$/m;
const PR_RE = /^PR: *(https:\/\/\S+\/pull\/(\d+))/gm;
const USAGE_FIELDS = ['results', 'cost', 'costSource', 'tokens', 'phases', 'minutes'];
const CARRIED = ['outcome', 'mode', 'pr', 'launched'];
const defaultProjectsDir = () => path.join(os.homedir(), '.claude', 'projects');

const cents = (x) => (x === null ? null : Math.round(x * 100) / 100);
const tenths = (x) => (x === null ? null : Math.round(x * 10) / 10);
const addNull = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : a + b);

// the status-word rule of outcomeOf() in server.mjs; an unknown status gives null (not 'running')
const statusOutcome = (status) =>
  /^(VERIFIED|REVIEWED|COMMITTED|FINISHED|PR OPEN)/i.test(status) ? 'needs-you'
  : /^(BLOCKED|FAILED|ENDED)/i.test(status) ? 'failed' : null;

// the Outcome value that counts (parseReport()), or null
const reportOutcomeWord = (text) => {
  const raw = ((String(text ?? '').match(OUTCOME_RE) || [])[1] || '').toLowerCase();
  return OUTCOMES.includes(raw) ? raw : null;
};

/** Reads the report fields of a ledger line from the report text. A missing report or field gives null. */
function reportFields(reportText) {
  if (reportText == null) return { launched: null, mode: null, outcome: null, status: null, pr: null };
  const text = String(reportText);
  const status = ((text.match(STATUS_RE) || [])[1] || '').trim() || null;
  const word = reportOutcomeWord(text);
  // a "failed" that the status words do not confirm is stale: a chat fixed the run later (pipelineRunInfo())
  const stale = word === 'failed' && statusOutcome(status || '') !== 'failed';
  const outcome = (!stale && word) || statusOutcome(status || '');
  const lv = ((text.match(LAUNCHED_RE) || [])[1] || '').trim();
  let launched = null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(lv)) {
    const d = new Date(lv.replace(' ', 'T'));   // no offset: local time
    if (!Number.isNaN(d.getTime())) launched = d.toISOString();
  }
  const prs = [...text.matchAll(PR_RE)];
  const last = prs.at(-1);
  return {
    launched,
    mode: (text.match(MODE_RE) || [])[1] || null,
    outcome,
    status: status ? status.slice(0, 80) : null,
    pr: last ? { number: +last[2], url: last[1] } : null,
  };
}

/** Builds the usage fields of a ledger line from the log text (the calls and order of run-usage.mjs main()). */
function usageFields(logText, projectsDir) {
  const parsed = parseLog(logText ?? '');
  if (!parsed.results.length) return { results: 0, cost: null, costSource: null, tokens: null, phases: {}, minutes: null };
  const subagents = loadSubagents(parsed.sessionIds, projectsDir);
  const rows = phaseRows(parsed, subagents);
  const cost = applyCosts(parsed, rows);
  let tokens = null;
  for (const r of parsed.results) {
    if (!r.usage) continue;
    tokens ??= { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    for (const k of Object.keys(tokens)) tokens[k] += r.usage.tokens[k];
  }
  const phases = {};
  let minutes, timed = 0;
  for (const s of rows.sessions) {
    for (const r of s.rows) {
      const p = phases[r.name];
      phases[r.name] = p ? { cost: addNull(p.cost, r.cost), wall: addNull(p.wall, r.wall), active: addNull(p.active, r.active) }
        : { cost: r.cost ?? null, wall: r.wall ?? null, active: r.active ?? null };
      if (r.name === 'unattributed') continue;
      minutes = timed++ ? addNull(minutes, r.wall) : (r.wall ?? null);
    }
  }
  for (const p of Object.values(phases)) { p.cost = cents(p.cost); p.wall = tenths(p.wall); p.active = tenths(p.active); }
  return {
    results: parsed.results.length,
    cost: cents(cost.total),
    costSource: cost.total === null ? null : cost.source,
    tokens,
    phases,
    minutes: timed ? tenths(minutes) : null,
  };
}

/**
 * Makes one ledger line (an object, `v: 1`) for one run.
 * When `previous` has the same log size and log change time as `src`, the usage fields
 * (results, cost, costSource, tokens, phases, minutes) come from `previous` and the log is
 * not parsed (`logText` can be null). Else the log is parsed with run-usage.mjs, and the
 * subagent transcripts are read from `projectsDir`. The report fields come from `reportText`
 * (null: no report). An outcome, mode, PR or launch time that is null keeps the value of `previous`.
 */
export function runRecord({ project, slug, logText, reportText, src, previous = null, projectsDir = defaultProjectsDir() }) {
  const reuse = previous && previous.src && src
    && previous.src.logSize === src.logSize && previous.src.logMtimeMs === src.logMtimeMs;
  const usage = reuse ? Object.fromEntries(USAGE_FIELDS.map((k) => [k, previous[k] ?? null])) : usageFields(logText, projectsDir);
  const rep = reportFields(reportText);
  for (const k of CARRIED) if (rep[k] == null && previous && previous[k] != null) rep[k] = previous[k];
  return {
    v: 1, project, slug, src,
    launched: rep.launched,
    ended: new Date(src.logMtimeMs).toISOString(),
    mode: rep.mode, outcome: rep.outcome, status: rep.status, pr: rep.pr,
    ...usage,
  };
}

// a Map of "project/slug" -> its last valid line
const parseLedger = (text) => {
  const out = new Map();
  for (const raw of String(text).split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    if (!o || typeof o !== 'object' || o.v == null || !o.project || !o.slug || !o.src || typeof o.src !== 'object') continue;
    out.set(o.project + '/' + o.slug, o);
  }
  return out;
};

/**
 * Reads the ledger. Returns a Map of `project + '/' + slug` to the last line of that pair.
 * Empty lines, unparsable lines and lines without v, project, slug and src are skipped.
 * A missing file gives an empty Map.
 */
export function readLedger(file = LEDGER) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return new Map(); }
  return parseLedger(text);
}

/**
 * Tells if the pipeline of a slug runs now: true when
 * `pgrep -f '[s]kill-auto-pipeline <slug>\.md'` exits 0 (the pattern of pipelineLive() in server.mjs).
 * Every error (no match, no pgrep, a timeout) gives false.
 */
export function pgrepLive(slug) {
  const pattern = `[s]kill-auto-pipeline ${String(slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md`;
  try { execFileSync('pgrep', ['-f', pattern], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; }
}

// ---------- the ledger lock (the algorithm of the watcher lock in server.mjs) ----------
const psCommand = (pid) => {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
};
// only ESRCH means dead: a live holder that this process cannot signal (EPERM) keeps the lock
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
let ownCommand = null;
// link() fails when the file exists, so only one process gets it, and the lock is never half written
const linkLock = (lockFile) => {
  ownCommand ||= psCommand(process.pid);
  if (!ownCommand) return 'no-ps';
  const tmp = lockFile + '.' + process.pid;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, cmd: ownCommand, startedAt: new Date().toISOString() }));
  try { linkSync(tmp, lockFile); return 'ok'; } catch { return 'busy'; } finally { try { unlinkSync(tmp); } catch {} }
};
// stale: unreadable and older than 10 s, a dead PID, or a PID that another program has now
const lockState = (lockFile) => {
  let raw;
  try { raw = readFileSync(lockFile, 'utf8'); } catch { return { gone: true }; }
  let l = null;
  try { l = JSON.parse(raw); } catch {}
  if (!l || typeof l !== 'object') {
    try { return { stale: Date.now() - statSync(lockFile).mtimeMs > LOCK_UNREADABLE_MS, pid: null }; } catch { return { gone: true }; }
  }
  const pid = l.pid ?? null;
  if (!pid || !pidAlive(pid)) return { stale: true, pid };
  // a ps call that fails says nothing: a live holder is never judged stale on it
  const cmd = psCommand(pid);
  if (cmd != null && cmd !== l.cmd) return { stale: true, pid };
  return { stale: false };
};

/**
 * Takes the ledger lock file when it is free or stale.
 * Returns 'ok' (this process holds it now), 'busy' (another live process holds it) or
 * 'no-ps' (ps gave no command line for this process, so the lock cannot name it).
 */
export function takeLedgerLock(lockFile) {
  const first = linkLock(lockFile);
  if (first !== 'busy') return first;
  const s = lockState(lockFile);
  if (s.gone) return linkLock(lockFile);
  if (!s.stale) return 'busy';
  // only one process can move the stale file away; the others get ENOENT and stop
  const moved = lockFile + '.stale.' + process.pid;
  try { renameSync(lockFile, moved); } catch { return 'busy'; }
  let m = null;
  try { m = JSON.parse(readFileSync(moved, 'utf8')); } catch {}
  const movedPid = m && typeof m === 'object' ? m.pid ?? null : null;
  if (movedPid !== s.pid) {   // another process replaced the lock in between: put it back
    try { linkSync(moved, lockFile); } catch {}
    try { unlinkSync(moved); } catch {}
    return 'busy';
  }
  try { unlinkSync(moved); } catch {}
  return linkLock(lockFile);
}

/** Removes the ledger lock file, only when it holds the pid of this process. */
export function releaseLedgerLock(lockFile) {
  try { if (JSON.parse(readFileSync(lockFile, 'utf8')).pid === process.pid) unlinkSync(lockFile); } catch {}
}

// ---------- sync ----------
const sameSrc = (a, b) => !!a && !!b && a.logSize === b.logSize && a.logMtimeMs === b.logMtimeMs
  && a.reportSize === b.reportSize && a.reportMtimeMs === b.reportMtimeMs;
const statSrc = (logPath, reportPath) => {
  const ls = statSync(logPath);
  let rs = null;
  try { rs = statSync(reportPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { logSize: ls.size, logMtimeMs: ls.mtimeMs, reportSize: rs ? rs.size : null, reportMtimeMs: rs ? rs.mtimeMs : null };
};

/**
 * Adds a ledger line for each finished run whose log or report changed since its last line.
 * `projects` is `[{ name, autoRunsDir }]`. A run is skipped while `isLive(name, slug)` is true,
 * or while its report says `running` (or has no report or no Outcome line) and its newest file
 * change is less than `staleMs` before `now`. At most `limit` lines, and log reads up to
 * `maxBytes` bytes, per call (the rest counts as deferred). A log that is gone after the folder
 * read counts as changing. A run whose read failed is put in `failed` (`{ src, at, log }`) and
 * tried again when its files change or after 10 minutes. `beforeWrite` runs before
 * each append; its error and an append error go up. With `dryRun`, nothing is written and no lock is taken.
 * Returns `{ busy: true, reason }` when the lock is not free ('busy' or 'no-ps'), else
 * `{ added, unchanged, live, changing, deferred, missing, errors: [log paths] }`.
 */
export async function syncLedger({
  projects, file = LEDGER, projectsDir = defaultProjectsDir(), limit = Infinity, maxBytes = Infinity,
  staleMs = DEFAULT_STALE_MS, now = Date.now(), isLive = (name, slug) => pgrepLive(slug), beforeWrite = () => {},
  failed = new Map(), dryRun = false, readFile = readFileSync,
}) {
  const lockFile = file + '.lock';
  if (!dryRun) {
    mkdirSync(path.dirname(file), { recursive: true });
    const got = takeLedgerLock(lockFile);
    if (got !== 'ok') return { busy: true, reason: got };
  }
  try {
    for (const [k, f] of failed) if (now - f.at > FAILED_RETRY_MS) failed.delete(k);
    let text = '';
    // only a missing ledger is empty: a ledger that cannot be read now must not make new lines
    // without the outcome, PR and phases of the lines before them
    try { text = readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const ledger = parseLedger(text);
    let needNl = text.length > 0 && !text.endsWith('\n');
    const out = { added: 0, unchanged: 0, live: 0, changing: 0, deferred: 0, missing: 0, errors: [] };
    const seenDirs = new Set();
    let made = 0, bytes = 0;
    for (const proj of projects || []) {
      const dir = path.resolve(proj.autoRunsDir);
      if (seenDirs.has(dir)) continue;
      seenDirs.add(dir);
      let names;
      try { names = readdirSync(dir).filter((n) => n.endsWith('.log') && !n.startsWith('_')).sort(); }
      catch { out.missing++; continue; }
      for (const name of names) {
        const slug = name.slice(0, -'.log'.length);
        const key = proj.name + '/' + slug;
        const logPath = path.join(dir, name), reportPath = path.join(dir, slug + '.md');
        let src = null, upErr = null;
        try {
          // a log removed after readdir (a cleanup, a delete) is no run any more, not a read error
          try { src = statSrc(logPath, reportPath); } catch (e) { if (e.code === 'ENOENT') { out.changing++; continue; } throw e; }
          const prev = ledger.get(key) || null;
          if ((prev && sameSrc(prev.src, src)) || sameSrc(failed.get(key)?.src, src)) { out.unchanged++; continue; }
          // the budget check runs before each log, so a first log larger than maxBytes is still read
          if (made >= limit || bytes >= maxBytes) { out.deferred++; continue; }
          let reportText = null;
          try { reportText = readFile(reportPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          const word = reportText == null ? null : ((String(reportText).match(OUTCOME_RE) || [])[1] || '').toLowerCase() || null;
          const fresh = now - Math.max(src.logMtimeMs, src.reportMtimeMs ?? 0) < staleMs;
          if ((await isLive(proj.name, slug)) || (fresh && (word === null || word === 'running'))) { out.live++; continue; }
          const reuse = prev && prev.src && prev.src.logSize === src.logSize && prev.src.logMtimeMs === src.logMtimeMs;
          let logText = null;
          if (!reuse) {
            // the reads and the parse are synchronous: give the event loop (the server's
            // requests) a turn before each log, so one tick does not hold it for all logs
            await new Promise((r) => setImmediate(r));
            logText = readFile(logPath, 'utf8'); bytes += src.logSize;
          }
          if (!sameSrc(src, statSrc(logPath, reportPath))) { out.changing++; continue; }
          const line = runRecord({ project: proj.name, slug, logText, reportText, src, previous: prev, projectsDir });
          made++;
          if (!dryRun) {
            try { beforeWrite(); } catch (e) { upErr = e; throw e; }
            // a failed append is a ledger error, not a run error: it stops the call (the next
            // call reads the file again, so a half-written line gets its line end first)
            try { appendFileSync(file, (needNl ? '\n' : '') + JSON.stringify(line) + '\n'); }
            catch (e) { upErr = e; throw e; }
            needNl = false;
          }
          ledger.set(key, line);
          failed.delete(key);
          out.added++;
        } catch (e) {
          if (upErr && e === upErr) throw e;
          if (src) failed.set(key, { src, at: now, log: logPath });
          out.errors.push(logPath);
        }
      }
    }
    return out;
  } finally {
    if (!dryRun) releaseLedgerLock(lockFile);
  }
}

const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/**
 * Reads the project registry and returns `[{ name, autoRunsDir }]` for the entries with a
 * name and a root whose `<root>/.claude/scripts/auto-pipeline.sh` exists (the auto-pipeline
 * flavor). `autoRunsDir` is `<plansDir or root/.plans>/auto-runs`. A missing registry gives [].
 * A registry that cannot be read or is not JSON throws, so the command does not report a
 * migration of no projects as a success.
 */
export function registryProjects(regFile = path.join(os.homedir(), '.claude', 'pipeline-projects.json')) {
  let text;
  try { text = readFileSync(regFile, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const reg = JSON.parse(text);
  const list = reg && Array.isArray(reg.projects) ? reg.projects : [];
  return list.filter((p) => p && p.name && p.root).flatMap((p) => {
    const root = expandHome(String(p.root));
    if (!existsSync(path.join(root, '.claude', 'scripts', 'auto-pipeline.sh'))) return [];
    const plansDir = expandHome(p.plansDir) || path.join(root, '.plans');
    return [{ name: p.name, autoRunsDir: path.join(plansDir, 'auto-runs') }];
  });
}

// ---------- command ----------
const USAGE = 'usage: node apps/dashboard/insights.mjs --migrate [--dry-run]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async (argv) => {
  let migrate = false, dryRun = false;
  for (const a of argv) {
    if (a === '--migrate') migrate = true;
    else if (a === '--dry-run') dryRun = true;
    else { console.error(`insights: unknown option ${a}\n${USAGE}`); return 1; }
  }
  if (!migrate) { console.error(USAGE); return 1; }
  const projects = registryProjects();
  const deadline = Date.now() + 60000;
  let r;
  for (;;) {
    r = await syncLedger({ projects, dryRun });
    if (!r.busy) break;
    if (r.reason !== 'busy') { console.error('Cannot take the ledger lock: ps gave no command line'); return 1; }
    if (Date.now() >= deadline) { console.error('The dashboard is writing the ledger. Try again later.'); return 1; }
    await sleep(2000);
  }
  console.log(`${dryRun ? 'would add' : 'added'}: ${r.added}`);
  for (const k of ['unchanged', 'live', 'changing', 'deferred', 'missing']) console.log(`${k}: ${r[k]}`);
  console.log(`errors: ${r.errors.length}`);
  for (const p of r.errors) console.log(`error: cannot read ${p}`);
  console.log(`ledger: ${LEDGER}${dryRun ? ' (dry run: nothing written)' : ''}`);
  return r.errors.length ? 1 : 0;
};

// realpath on both sides: node runs a main module that is reached through a symlink by its real path
const isMain = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (process.argv[1] && isMain())
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error('insights: ' + (e.message || e)); process.exitCode = 1; });
