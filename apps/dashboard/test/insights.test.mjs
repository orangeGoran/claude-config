// Tests of the insights ledger (apps/dashboard/insights.mjs) and its --migrate command.
// Every case works in a throwaway folder with made-up projects (demo-api, demo-web), made-up
// sessions and made-up costs. No case reads the real ~/.claude or matches a real run with pgrep.
//
//   node --test apps/dashboard/test/insights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync, utimesSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runRecord, readLedger, syncLedger, takeLedgerLock, releaseLedgerLock, registryProjects, pgrepLive, DEFAULT_STALE_MS,
} from '../insights.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'insights.mjs');
const SID = 'sess-demo-1';
const T = (min) => new Date(Date.UTC(2026, 10, 20, 10, 0) + min * 60000).toISOString();
const init = (sid = SID) => JSON.stringify({ type: 'system', subtype: 'init', session_id: sid, timestamp: T(0) });
const asst = ({ id, min, sid = SID, inp = 0, out = 0, tools = [] }) => JSON.stringify({
  type: 'assistant', session_id: sid, parent_tool_use_id: null, timestamp: T(min),
  message: { id, usage: { input_tokens: inp, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: out }, content: tools },
});
const skill = (name) => ({ type: 'tool_use', id: 'toolu-demo-s-' + name, name: 'Skill', input: { skill: name } });
const agentCall = (id) => ({ type: 'tool_use', id, name: 'Agent', input: { prompt: 'review' } });
const result = ({ min, sid = SID, cost, total, tok = null }) => JSON.stringify({
  type: 'result', session_id: sid, timestamp: T(min),
  ...(cost === undefined ? {} : { model_usage_since_last_result: { 'model-demo': {
    costUSD: cost, inputTokens: tok?.input ?? 0, cacheCreationInputTokens: tok?.cacheWrite ?? 0,
    cacheReadInputTokens: tok?.cacheRead ?? 0, outputTokens: tok?.output ?? 0 } } }),
  ...(total === undefined ? {} : { total_cost_usd: total }),
});
const joinLines = (lines) => lines.join('\n') + '\n';

// two phases, two result lines: 2.5 + 1.25
const TOK1 = { input: 100, cacheWrite: 20, cacheRead: 300, output: 10 };
const TOK2 = { input: 50, cacheWrite: 5, cacheRead: 200, output: 5 };
const LOG_TWO = joinLines([
  init(),
  asst({ id: 'msg-1', min: 1, inp: 1000, out: 200, tools: [skill('skill-2-implement')] }),
  result({ min: 2, cost: 2.5, tok: TOK1 }),
  asst({ id: 'msg-2', min: 3, inp: 800, out: 100, tools: [skill('skill-3-test')] }),
  result({ min: 4, cost: 1.25, tok: TOK2 }),
]);
// a log whose test phase starts a subagent (toolu_demo1)
const LOG_AGENT = (sid = SID) => joinLines([
  init(sid),
  asst({ id: 'msg-a1-' + sid, sid, min: 1, inp: 1000, out: 100, tools: [skill('skill-2-implement')] }),
  asst({ id: 'msg-a2-' + sid, sid, min: 2, inp: 1000, out: 100 }),
  asst({ id: 'msg-a3-' + sid, sid, min: 3, inp: 1000, out: 100, tools: [skill('skill-3-test')] }),
  asst({ id: 'msg-a4-' + sid, sid, min: 4, inp: 1000, out: 100, tools: [agentCall('toolu_demo1')] }),
  result({ min: 5, sid, cost: 4 }),
]);
const transcript = (projectsDir, sid = SID) => {
  const dir = path.join(projectsDir, '-demo-folder', sid, 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'agent-1.jsonl'), joinLines([1, 2].map((i) => JSON.stringify({
    type: 'assistant', message: { id: 'msg-sub-' + sid + '-' + i, usage: { input_tokens: 500000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 100000 } },
  }))));
  writeFileSync(path.join(dir, 'agent-1.meta.json'), JSON.stringify({ toolUseId: 'toolu_demo1' }));
};
const LOG_ONE = (cost = 1.5) => joinLines([init(), asst({ id: 'msg-o1', min: 1, inp: 100, out: 10 }), result({ min: 2, cost })]);

const reportOf = ({ status = 'PR OPEN — https://example.test/o/r/pull/7', outcome = 'needs-you', mode = 'pr',
  launched = '2026-11-20 10:00:00', pr = 'https://example.test/o/r/pull/7' } = {}) => [
  '# Auto-pipeline run: demo',
  '',
  ...(mode === null ? [] : [`- **Mode**: ${mode} (to PR)`]),
  ...(outcome === null ? [] : [`- **Outcome**: ${outcome}`]),
  ...(launched === null ? [] : [`- **Launched**: ${launched}`]),
  '',
  ...(status === null ? [] : [`## Status: ${status}`]),
  '',
  ...(pr === null ? [] : [`PR: ${pr}`]),
  '',
].join('\n');

const SRC = { logSize: 100, logMtimeMs: Date.UTC(2026, 10, 20, 11, 0), reportSize: 50, reportMtimeMs: Date.UTC(2026, 10, 20, 11, 0) };
const tmpDir = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), 'insights-test-')));
const sumCost = (phases) => Math.round(Object.values(phases).reduce((a, p) => a + p.cost, 0) * 100) / 100;
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()) : []);

// a world: a ledger file and a subagent folder in a throwaway folder
const world = () => {
  const dir = tmpDir();
  return { dir, file: path.join(dir, 'dash', 'insights.jsonl'), projectsDir: path.join(dir, 'projects') };
};
const project = (w, name, sub = '') => {
  const autoRunsDir = path.join(w.dir, name + sub, '.plans', 'auto-runs');
  mkdirSync(autoRunsDir, { recursive: true });
  return { name, autoRunsDir };
};
const putRun = (proj, slug, { log = LOG_ONE(), report = reportOf() } = {}) => {
  writeFileSync(path.join(proj.autoRunsDir, slug + '.log'), log);
  if (report !== null) writeFileSync(path.join(proj.autoRunsDir, slug + '.md'), report);
};
const opts = (w, extra = {}) => ({ file: w.file, projectsDir: w.projectsDir, isLive: () => false, ...extra });

// ---------- runRecord ----------

test('runRecord: cost, tokens, phases and the report fields of a finished run', () => {
  const r = runRecord({ project: 'demo-api', slug: 'run-a', logText: LOG_TWO, reportText: reportOf(), src: SRC, projectsDir: '/nonexistent' });
  assert.equal(r.v, 1);
  assert.equal(r.project, 'demo-api');
  assert.equal(r.slug, 'run-a');
  assert.deepEqual(r.src, SRC);
  assert.equal(r.results, 2);
  assert.equal(r.cost, 3.75);
  assert.equal(r.costSource, 'model_usage');
  assert.equal(r.mode, 'pr');
  assert.equal(r.outcome, 'needs-you');
  assert.deepEqual(r.pr, { number: 7, url: 'https://example.test/o/r/pull/7' });
  assert.equal(r.launched, new Date(2026, 10, 20, 10, 0, 0).toISOString(), 'local time, as ISO');
  assert.equal(r.ended, new Date(SRC.logMtimeMs).toISOString());
  assert.equal(r.status, 'PR OPEN — https://example.test/o/r/pull/7');
  assert.deepEqual(r.tokens, { input: 150, cacheWrite: 25, cacheRead: 500, output: 15 });
  assert.deepEqual(Object.keys(r.phases).sort(), ['implement', 'preflight', 'test']);
  assert.equal(sumCost(r.phases), 3.75);
  assert.equal(r.minutes, 4, 'wall minutes of all rows: 0..1 preflight, 1..3 implement, 3..4 test');
});

test('runRecord: a log with only total_cost_usd, and a mixed log', () => {
  const only = runRecord({ project: 'demo-api', slug: 'x', logText: joinLines([init(), asst({ id: 'msg-t', min: 1, inp: 10 }), result({ min: 2, total: 5 })]),
    reportText: null, src: SRC, projectsDir: '/nonexistent' });
  assert.equal(only.cost, 5);
  assert.equal(only.costSource, 'total_cost_usd');
  assert.equal(only.tokens, null);

  const mixed = runRecord({ project: 'demo-api', slug: 'x', src: SRC, reportText: null, projectsDir: '/nonexistent',
    logText: joinLines([init(), asst({ id: 'msg-m', min: 1, inp: 10 }), result({ min: 2, cost: 2, tok: TOK1 }), result({ min: 3, total: 5 })]) });
  assert.equal(mixed.cost, 2, 'applyCosts sums the model-usage lines only (the known limit)');
  assert.equal(mixed.costSource, 'model_usage');
  assert.deepEqual(mixed.tokens, TOK1, 'only the line with usage gives tokens');
});

test('runRecord: no report gives null report fields; no result line gives results 0', () => {
  const r = runRecord({ project: 'demo-api', slug: 'x', logText: LOG_TWO, reportText: null, src: SRC, projectsDir: '/nonexistent' });
  for (const k of ['launched', 'mode', 'outcome', 'status', 'pr']) assert.equal(r[k], null, k);
  assert.equal(r.cost, 3.75);

  const empty = runRecord({ project: 'demo-api', slug: 'x', logText: joinLines([init(), asst({ id: 'msg-e', min: 1, inp: 10 })]),
    reportText: reportOf(), src: SRC, projectsDir: '/nonexistent' });
  assert.equal(empty.results, 0);
  assert.equal(empty.cost, null);
  assert.equal(empty.costSource, null);
  assert.equal(empty.tokens, null);
  assert.deepEqual(empty.phases, {});
});

test('runRecord: a subagent transcript moves cost to the phase that started it', () => {
  const w = world();
  try {
    const base = runRecord({ project: 'demo-api', slug: 'x', logText: LOG_AGENT(), reportText: null, src: SRC, projectsDir: path.join(w.dir, 'empty') });
    transcript(w.projectsDir);
    const r = runRecord({ project: 'demo-api', slug: 'x', logText: LOG_AGENT(), reportText: null, src: SRC, projectsDir: w.projectsDir });
    assert.ok(r.phases.test.cost > base.phases.test.cost, `test ${r.phases.test.cost} > ${base.phases.test.cost}`);
    assert.ok(r.phases.implement.cost < base.phases.implement.cost);
    assert.equal(sumCost(r.phases), 4);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('runRecord: the outcome rules of the dashboard, and the Launched format check', () => {
  const rec = (report) => runRecord({ project: 'demo-api', slug: 'x', logText: '', reportText: report, src: SRC });
  assert.equal(rec(reportOf({ outcome: 'failed', status: 'PR OPEN — fixed later' })).outcome, 'needs-you', 'a stale failed');
  assert.equal(rec(reportOf({ outcome: 'failed', status: 'FAILED: verify' })).outcome, 'failed');
  assert.equal(rec(reportOf({ outcome: 'Needs-You', status: 'RUNNING' })).outcome, 'needs-you', 'any case');
  assert.equal(rec(reportOf({ outcome: 'maybe', status: 'BLOCKED: no tests' })).outcome, 'failed');
  assert.equal(rec(reportOf({ outcome: null, status: 'PR OPEN — x' })).outcome, 'needs-you');
  assert.equal(rec(reportOf({ outcome: null, status: 'pr open — x' })).outcome, 'needs-you', 'status words in any case');
  assert.equal(rec(reportOf({ outcome: null, status: 'FAILED: test' })).outcome, 'failed');
  assert.equal(rec(reportOf({ outcome: null, status: 'CLEANED — shipped' })).outcome, null);
  assert.equal(rec(reportOf({ outcome: 'running', status: 'RUNNING' })).outcome, 'running');
  assert.equal(rec(reportOf({ launched: 'soon' })).launched, null);
  assert.equal(rec(reportOf({ status: 'X'.repeat(100) })).status.length, 80);
  const twoPrs = reportOf() + 'PR: https://example.test/o/r/pull/9\n';
  assert.equal(rec(twoPrs).pr.number, 9, 'the last PR line');
});

test('runRecord: a cleanup keeps the outcome and the PR of the previous line', () => {
  const previous = runRecord({ project: 'demo-api', slug: 'x', logText: LOG_TWO, reportText: reportOf(), src: SRC, projectsDir: '/nonexistent' });
  const cleaned = reportOf({ outcome: null, mode: null, launched: null, pr: null,
    status: 'CLEANED — shipped in abc1234, worktree and branch removed 2026-11-26' });
  const src = { ...SRC, reportSize: 99, reportMtimeMs: SRC.reportMtimeMs + 1000 };
  const r = runRecord({ project: 'demo-api', slug: 'x', logText: null, reportText: cleaned, src, previous });
  assert.equal(r.outcome, 'needs-you');
  assert.equal(r.pr.number, 7);
  assert.equal(r.mode, 'pr');
  assert.equal(r.launched, previous.launched);
  assert.match(r.status, /^CLEANED/);
  assert.equal(r.cost, 3.75, 'the usage comes from the previous line: the log did not change');
  assert.deepEqual(r.phases, previous.phases);
});

// ---------- readLedger ----------

test('readLedger: the last line of a pair; bad lines are skipped; a missing file is empty', () => {
  const dir = tmpDir();
  try {
    const f = path.join(dir, 'insights.jsonl');
    assert.equal(readLedger(f).size, 0);
    const line = (cost, extra = {}) => JSON.stringify({ v: 1, project: 'demo-api', slug: 'a', src: SRC, cost, ...extra });
    writeFileSync(f, [line(1), 'not json', JSON.stringify({ v: 1, project: 'demo-api', src: SRC }), '', line(2),
      JSON.stringify({ v: 1, project: 'demo-api', slug: 'b', src: SRC }).slice(0, 20)].join('\n'));
    const m = readLedger(f);
    assert.deepEqual([...m.keys()], ['demo-api/a']);
    assert.equal(m.get('demo-api/a').cost, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- syncLedger ----------

test('syncLedger: two projects, then a second call adds nothing', async () => {
  const w = world();
  try {
    putRun(project(w, 'demo-api'), 'run-a');
    putRun(project(w, 'demo-web'), 'run-b', { log: LOG_TWO });
    const projects = [project(w, 'demo-api'), project(w, 'demo-web')];
    const r = await syncLedger(opts(w, { projects }));
    assert.equal(r.added, 2);
    assert.equal(lines(w.file).length, 2);
    assert.equal(readLedger(w.file).get('demo-web/run-b').cost, 3.75);
    const again = await syncLedger(opts(w, { projects }));
    assert.equal(again.added, 0);
    assert.equal(again.unchanged, 2);
    assert.equal(lines(w.file).length, 2);
    assert.equal(existsSync(w.file + '.lock'), false, 'the lock is removed at the end');
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a new result line and a report-only change each add one line', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a', { report: reportOf({ outcome: 'running', status: 'RUNNING', pr: null }) });
    const now = Date.now() + DEFAULT_STALE_MS + 1000;
    assert.equal((await syncLedger(opts(w, { projects: [p], now }))).added, 1);
    appendFileSync(path.join(p.autoRunsDir, 'run-a.log'), result({ min: 9, cost: 2 }) + '\n');
    assert.equal((await syncLedger(opts(w, { projects: [p], now }))).added, 1);
    assert.equal(readLedger(w.file).get('demo-api/run-a').cost, 3.5);
    assert.equal(readLedger(w.file).get('demo-api/run-a').outcome, 'running');
    writeFileSync(path.join(p.autoRunsDir, 'run-a.md'), reportOf());
    assert.equal((await syncLedger(opts(w, { projects: [p], now }))).added, 1);
    const last = readLedger(w.file).get('demo-api/run-a');
    assert.equal(last.outcome, 'needs-you');
    assert.equal(last.pr.number, 7);
    assert.equal(last.cost, 3.5);
    assert.equal(lines(w.file).length, 3);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: live runs wait; a stale running run and a run with no report count after staleMs', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'live-one');
    putRun(p, 'running-one', { report: reportOf({ outcome: 'running', status: 'RUNNING' }) });
    putRun(p, 'no-report', { report: null });
    const live = await syncLedger(opts(w, { projects: [p], isLive: (name, slug) => name === 'demo-api' && slug === 'live-one' }));
    assert.equal(live.added, 0);
    assert.equal(live.live, 3);
    const later = await syncLedger(opts(w, { projects: [p], now: Date.now() + DEFAULT_STALE_MS + 1000, isLive: (n, s) => s === 'live-one' }));
    assert.equal(later.added, 2);
    assert.equal(later.live, 1, 'a live process wins over any outcome');
    assert.equal(readLedger(w.file).get('demo-api/no-report').outcome, null);
    assert.equal(readLedger(w.file).get('demo-api/running-one').outcome, 'running');
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: limit and maxBytes defer the rest', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    putRun(p, 'run-b');
    const r = await syncLedger(opts(w, { projects: [p], limit: 1 }));
    assert.equal(r.added, 1);
    assert.equal(r.deferred, 1);
    const w2 = world();
    try {
      const q = project(w2, 'demo-api');
      putRun(q, 'run-a');
      putRun(q, 'run-b');
      const s = await syncLedger(opts(w2, { projects: [q], maxBytes: 10 }));
      assert.equal(s.added, 1, 'one log larger than maxBytes is still read when it is the first');
      assert.equal(s.deferred, 1);
    } finally { rmSync(w2.dir, { recursive: true, force: true }); }
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a beforeWrite that throws stops the call and writes nothing', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    const lost = new Error('lost the lock');
    await assert.rejects(syncLedger(opts(w, { projects: [p], beforeWrite: () => { throw lost; } })), (e) => e === lost);
    assert.equal(lines(w.file).length, 0);
    assert.equal(existsSync(w.file + '.lock'), false);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: an append that fails stops the call and is no run error', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    mkdirSync(w.file, { recursive: true });   // a folder in place of the ledger: the append fails
    const failed = new Map();
    await assert.rejects(syncLedger(opts(w, { projects: [p], failed })), (e) => e.code === 'EISDIR');
    assert.equal(failed.size, 0, 'the run is not marked as failed');
    assert.equal(existsSync(w.file + '.lock'), false);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: an unreadable log and a missing folder; a failed run is not tried again at once', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    mkdirSync(path.join(p.autoRunsDir, 'x.log'));
    writeFileSync(path.join(p.autoRunsDir, 'x.md'), reportOf());   // finished, so the log is read
    putRun(p, 'run-a');
    writeFileSync(path.join(p.autoRunsDir, '_launcher.log'), 'not a run');
    const gone = { name: 'demo-web', autoRunsDir: path.join(w.dir, 'nothing-here') };
    const failed = new Map();
    const r = await syncLedger(opts(w, { projects: [p, gone], failed }));
    assert.deepEqual(r.errors, [path.join(p.autoRunsDir, 'x.log')]);
    assert.equal(r.missing, 1);
    assert.equal(r.added, 1);
    const again = await syncLedger(opts(w, { projects: [p, gone], failed }));
    assert.deepEqual(again.errors, []);
    assert.equal(again.added, 0);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a log that is gone after the folder read is no error; a failed run names its log', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    // a dangling link: readdir lists it, stat gives ENOENT (a log deleted after the folder read)
    symlinkSync(path.join(w.dir, 'no-such.log'), path.join(p.autoRunsDir, 'gone.log'));
    mkdirSync(path.join(p.autoRunsDir, 'x.log'));
    writeFileSync(path.join(p.autoRunsDir, 'x.md'), reportOf());
    putRun(p, 'run-a', { report: reportOf({ mode: 'to-pr' }) });
    const failed = new Map();
    const r = await syncLedger(opts(w, { projects: [p], failed }));
    assert.deepEqual(r.errors, [path.join(p.autoRunsDir, 'x.log')]);
    assert.equal(r.changing, 1);
    assert.equal(r.added, 1);
    assert.equal(failed.get('demo-api/x').log, path.join(p.autoRunsDir, 'x.log'));
    assert.equal(readLedger(w.file).get('demo-api/run-a').mode, 'to-pr', 'the Mode rule of parseReport()');
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a read error is retried after 10 minutes; a report read error is no missing report', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    putRun(p, 'run-b');
    let thrown = false;
    const readFile = (f, enc) => {
      if (!thrown && f.endsWith('run-a.log')) { thrown = true; throw Object.assign(new Error('denied'), { code: 'EACCES' }); }
      return readFileSync(f, enc);
    };
    const failed = new Map(), now = Date.now();
    const r1 = await syncLedger(opts(w, { projects: [p], failed, now, readFile }));
    assert.equal(r1.errors.length, 1);
    assert.equal(r1.added, 1, 'the next run of the same project is still added');
    const r2 = await syncLedger(opts(w, { projects: [p], failed, now, readFile }));
    assert.equal(r2.added, 0);
    const r3 = await syncLedger(opts(w, { projects: [p], failed, now: now + 11 * 60 * 1000, readFile }));
    assert.equal(r3.added, 1);
    assert.ok(readLedger(w.file).has('demo-api/run-a'));

    const w2 = world();
    try {
      const q = project(w2, 'demo-api');
      putRun(q, 'run-a');
      const denyReport = (f, enc) => {
        if (f.endsWith('run-a.md')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return readFileSync(f, enc);
      };
      const s = await syncLedger(opts(w2, { projects: [q], readFile: denyReport, now: Date.now() + DEFAULT_STALE_MS + 1000 }));
      assert.equal(s.errors.length, 1);
      assert.equal(s.added, 0);
      assert.equal(lines(w2.file).length, 0);
    } finally { rmSync(w2.dir, { recursive: true, force: true }); }
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a ledger whose last line has no line end', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    mkdirSync(path.dirname(w.file), { recursive: true });
    writeFileSync(w.file, '{"v":1,"project":"demo-a');
    await syncLedger(opts(w, { projects: [p] }));
    assert.ok(readLedger(w.file).has('demo-api/run-a'), 'after a partial line');

    const w2 = world();
    try {
      const q = project(w2, 'demo-api');
      putRun(q, 'run-a');
      mkdirSync(path.dirname(w2.file), { recursive: true });
      writeFileSync(w2.file, JSON.stringify({ v: 1, project: 'demo-old', slug: 'old', src: SRC }));
      await syncLedger(opts(w2, { projects: [q] }));
      const m = readLedger(w2.file);
      assert.ok(m.has('demo-old/old'), 'the old valid line stays');
      assert.ok(m.has('demo-api/run-a'));
    } finally { rmSync(w2.dir, { recursive: true, force: true }); }
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a cleanup edit keeps the outcome; two entries with one folder count once', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    assert.equal((await syncLedger(opts(w, { projects: [p, { ...p, name: 'demo-web' }] }))).added, 1);
    writeFileSync(path.join(p.autoRunsDir, 'run-a.md'), reportOf({ outcome: null,
      status: 'CLEANED — shipped in abc1234, worktree and branch removed 2026-11-26' }));
    const r = await syncLedger(opts(w, { projects: [p], now: Date.now() + DEFAULT_STALE_MS + 1000 }));
    assert.equal(r.added, 1);
    const last = readLedger(w.file).get('demo-api/run-a');
    assert.equal(last.outcome, 'needs-you');
    assert.match(last.status, /^CLEANED/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a report-only change after the transcript was deleted keeps the phases', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    transcript(w.projectsDir);
    putRun(p, 'run-a', { log: LOG_AGENT(), report: reportOf({ outcome: 'failed', status: 'FAILED: verify' }) });
    await syncLedger(opts(w, { projects: [p] }));
    const first = readLedger(w.file).get('demo-api/run-a');
    rmSync(w.projectsDir, { recursive: true, force: true });
    writeFileSync(path.join(p.autoRunsDir, 'run-a.md'), reportOf());
    assert.equal((await syncLedger(opts(w, { projects: [p] }))).added, 1);
    const last = readLedger(w.file).get('demo-api/run-a');
    assert.deepEqual(last.phases, first.phases);
    assert.equal(first.outcome, 'failed');
    assert.equal(last.outcome, 'needs-you');
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: a ledger that cannot be read stops the call and writes nothing', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    mkdirSync(w.file, { recursive: true });   // a folder where the ledger is: reads fail with EISDIR
    await assert.rejects(syncLedger(opts(w, { projects: [p] })), /EISDIR/);
    assert.equal(existsSync(w.file + '.lock'), false, 'the lock is released');
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('syncLedger: creates the ledger folder in a fresh place; a dry run writes nothing', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    const dry = await syncLedger(opts(w, { projects: [p], dryRun: true }));
    assert.equal(dry.added, 1);
    assert.equal(existsSync(path.dirname(w.file)), false, 'a dry run makes no folder');
    await syncLedger(opts(w, { projects: [p] }));
    assert.equal(lines(w.file).length, 1);
    assert.equal(existsSync(w.file + '.lock'), false);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

const psOf = (pid) => execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
const waitChild = () => {
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  return c;
};
const stopChild = async (c) => { if (c.exitCode == null && c.signalCode == null) { c.kill('SIGKILL'); await new Promise((r) => c.once('exit', r)); } };

test('syncLedger lock: a live holder makes it busy; a dead holder is replaced; release keeps a lock of another pid', async () => {
  const w = world();
  const child = waitChild();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    mkdirSync(path.dirname(w.file), { recursive: true });
    const lock = w.file + '.lock';
    for (let i = 0; i < 50 && !psOf(child.pid).includes('setInterval'); i++) await new Promise((r) => setTimeout(r, 50));
    writeFileSync(lock, JSON.stringify({ pid: child.pid, cmd: psOf(child.pid) }));
    assert.deepEqual(await syncLedger(opts(w, { projects: [p] })), { busy: true, reason: 'busy' });
    assert.equal(existsSync(w.file), false);
    releaseLedgerLock(lock);
    assert.ok(existsSync(lock), 'release keeps a lock that holds another pid');
    const dead = child.pid;
    await stopChild(child);
    writeFileSync(lock, JSON.stringify({ pid: dead, cmd: 'node -e old' }));
    const r = await syncLedger(opts(w, { projects: [p] }));
    assert.equal(r.added, 1);
    assert.equal(existsSync(lock), false);
  } finally { await stopChild(child); rmSync(w.dir, { recursive: true, force: true }); }
});

test('takeLedgerLock: a stale lock is taken; a second process then gets busy', async () => {
  const dir = tmpDir();
  const lock = path.join(dir, 'insights.jsonl.lock');
  try {
    const c = waitChild();
    const dead = c.pid;
    await stopChild(c);
    writeFileSync(lock, JSON.stringify({ pid: dead, cmd: 'node -e old' }));
    assert.equal(takeLedgerLock(lock), 'ok');
    const code = `import { takeLedgerLock } from ${JSON.stringify(pathToFileURL(SCRIPT).href)}; console.log(takeLedgerLock(process.argv[1]));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code, lock], { encoding: 'utf8' }).trim();
    assert.equal(out, 'busy');
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
  } finally { releaseLedgerLock(lock); rmSync(dir, { recursive: true, force: true }); }
});

test('takeLedgerLock: a live pid with another command line, and an unreadable lock older than 10 s, are stale', async () => {
  const dir = tmpDir();
  const lock = path.join(dir, 'insights.jsonl.lock');
  const child = waitChild();
  try {
    // the pid runs, but another program has it now (pid reuse)
    writeFileSync(lock, JSON.stringify({ pid: child.pid, cmd: 'some-other-program --flag' }));
    assert.equal(takeLedgerLock(lock), 'ok');
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
    releaseLedgerLock(lock);
    // a half-written lock: young is busy, older than 10 s is stale
    writeFileSync(lock, '{"pid": 12');
    assert.equal(takeLedgerLock(lock), 'busy', 'a young unreadable lock may still be in the middle of a write');
    const old = (Date.now() - 60000) / 1000;
    utimesSync(lock, old, old);
    assert.equal(takeLedgerLock(lock), 'ok');
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, process.pid);
  } finally { releaseLedgerLock(lock); await stopChild(child); rmSync(dir, { recursive: true, force: true }); }
});

// ---------- registryProjects, pgrepLive ----------

test('registryProjects: only the pipeline projects', () => {
  const dir = tmpDir();
  try {
    const pipe = path.join(dir, 'demo-api'), generic = path.join(dir, 'demo-web');
    mkdirSync(path.join(pipe, '.claude', 'scripts'), { recursive: true });
    writeFileSync(path.join(pipe, '.claude', 'scripts', 'auto-pipeline.sh'), '');
    mkdirSync(path.join(generic, '.plans', 'auto-runs'), { recursive: true });
    writeFileSync(path.join(generic, '.plans', 'auto-runs', 'x.log'), 'x');
    const reg = path.join(dir, 'pipeline-projects.json');
    writeFileSync(reg, JSON.stringify({ projects: [{ name: 'demo-api', root: pipe }, { name: 'demo-web', root: generic }, { name: 'demo-none' },
      { name: 'demo-own-plans', root: pipe, plansDir: path.join(dir, 'elsewhere', 'plans') }] }));
    assert.deepEqual(registryProjects(reg), [
      { name: 'demo-api', autoRunsDir: path.join(pipe, '.plans', 'auto-runs') },
      { name: 'demo-own-plans', autoRunsDir: path.join(dir, 'elsewhere', 'plans', 'auto-runs') },
    ], 'a plansDir moves the auto-runs folder');
    assert.deepEqual(registryProjects(path.join(dir, 'missing.json')), []);
    const broken = path.join(dir, 'broken.json');
    writeFileSync(broken, '{"projects": [');
    assert.throws(() => registryProjects(broken), SyntaxError, 'a registry that is not JSON is no empty registry');
    assert.throws(() => registryProjects(dir), /EISDIR/, 'a registry that cannot be read is no empty registry');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pgrepLive: the pattern, and every exit code but 0 gives false', () => {
  const dir = tmpDir();
  const oldPath = process.env.PATH;
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'pgrep'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$PGREP_LOG"\nexit "$PGREP_CODE"\n', { mode: 0o755 });
    process.env.PATH = bin + ':' + oldPath;
    process.env.PGREP_LOG = path.join(dir, 'args.log');
    process.env.PGREP_CODE = '0';
    assert.equal(pgrepLive('demo.run'), true);
    assert.deepEqual(readFileSync(process.env.PGREP_LOG, 'utf8').trim().split('\n'), ['-f', '[s]kill-auto-pipeline demo\\.run\\.md']);
    process.env.PGREP_CODE = '1';
    assert.equal(pgrepLive('demo.run'), false);
    process.env.PGREP_CODE = '2';
    assert.equal(pgrepLive('demo.run'), false);
  } finally {
    process.env.PATH = oldPath;
    delete process.env.PGREP_LOG;
    delete process.env.PGREP_CODE;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the command ----------

test('--migrate: one line per run, the default projects folder, --dry-run, errors and unknown options', () => {
  const home = tmpDir();
  try {
    const roots = ['demo-api', 'demo-web'].map((n) => {
      const root = path.join(home, 'Workspace', n);
      mkdirSync(path.join(root, '.claude', 'scripts'), { recursive: true });
      writeFileSync(path.join(root, '.claude', 'scripts', 'auto-pipeline.sh'), '');
      mkdirSync(path.join(root, '.plans', 'auto-runs'), { recursive: true });
      return root;
    });
    mkdirSync(path.join(home, '.claude'), { recursive: true });
    writeFileSync(path.join(home, '.claude', 'pipeline-projects.json'),
      JSON.stringify({ projects: [{ name: 'demo-api', root: roots[0] }, { name: 'demo-web', root: '~/Workspace/demo-web' }] }));
    const runs = (root) => path.join(root, '.plans', 'auto-runs');
    writeFileSync(path.join(runs(roots[0]), 'agent-run.log'), LOG_AGENT());
    writeFileSync(path.join(runs(roots[0]), 'agent-run.md'), reportOf());
    writeFileSync(path.join(runs(roots[1]), 'one-run.log'), LOG_ONE(1.5));
    writeFileSync(path.join(runs(roots[1]), 'one-run.md'), reportOf());
    transcript(path.join(home, '.claude', 'projects'));
    const ledger = path.join(home, '.claude', 'pipeline-dashboard', 'insights.jsonl');
    const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } });

    const dry = cli('--migrate', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /would add: 2/);
    assert.equal(existsSync(ledger), false, '--dry-run writes no file');

    const r = cli('--migrate');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /added: 2/);
    assert.match(r.stdout, /unchanged: 0/);
    assert.ok(r.stdout.includes(ledger));
    const m = readLedger(ledger);
    assert.equal(m.size, 2);
    assert.equal(lines(ledger).length, 2);
    const base = runRecord({ project: 'demo-api', slug: 'x', logText: LOG_AGENT(), reportText: null, src: SRC, projectsDir: path.join(home, 'none') });
    assert.ok(m.get('demo-api/agent-run').phases.test.cost > base.phases.test.cost, 'the default projects folder is read');
    assert.equal(m.get('demo-web/one-run').cost, 1.5);

    mkdirSync(path.join(runs(roots[1]), 'broken.log'));
    writeFileSync(path.join(runs(roots[1]), 'broken.md'), reportOf());
    const bad = cli('--migrate');
    assert.equal(bad.status, 1);
    assert.ok(bad.stdout.includes(path.join(runs(roots[1]), 'broken.log')));

    const unknown = cli('--bogus');
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /usage/);

    writeFileSync(path.join(home, '.claude', 'pipeline-projects.json'), '{"projects": [');
    const broken = cli('--migrate');
    assert.equal(broken.status, 1, 'a broken registry is no migration of zero projects');
    assert.match(broken.stderr, /^insights: /);

    const link = path.join(home, 'insights-link.mjs');
    symlinkSync(SCRIPT, link);
    const viaLink = spawnSync(process.execPath, [link, '--bogus'], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(viaLink.status, 1, 'the command also runs through a symlink');
    assert.match(viaLink.stderr, /usage/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('--migrate waits while another process holds the ledger lock, then writes', async () => {
  const home = tmpDir();
  const holder = waitChild();
  try {
    const root = path.join(home, 'Workspace', 'demo-api');
    mkdirSync(path.join(root, '.claude', 'scripts'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'scripts', 'auto-pipeline.sh'), '');
    mkdirSync(path.join(root, '.plans', 'auto-runs'), { recursive: true });
    writeFileSync(path.join(root, '.plans', 'auto-runs', 'run-a.log'), LOG_ONE(2));
    writeFileSync(path.join(root, '.plans', 'auto-runs', 'run-a.md'), reportOf());
    const dash = path.join(home, '.claude', 'pipeline-dashboard');
    mkdirSync(dash, { recursive: true });
    writeFileSync(path.join(home, '.claude', 'pipeline-projects.json'), JSON.stringify({ projects: [{ name: 'demo-api', root }] }));
    for (let i = 0; i < 50 && !psOf(holder.pid).includes('setInterval'); i++) await new Promise((r) => setTimeout(r, 50));
    const lock = path.join(dash, 'insights.jsonl.lock');
    writeFileSync(lock, JSON.stringify({ pid: holder.pid, cmd: psOf(holder.pid) }));
    const cli = spawn(process.execPath, [SCRIPT, '--migrate'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    cli.stdout.on('data', (c) => (out += c));
    const exited = new Promise((r) => cli.once('exit', r));
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(existsSync(path.join(dash, 'insights.jsonl')), false, 'nothing is written while the lock is held');
    assert.equal(cli.exitCode, null, 'the command still waits');
    await stopChild(holder);   // the holder ends: its lock is stale now
    const code = await exited;
    assert.equal(code, 0, out);
    assert.match(out, /added: 1/);
    assert.equal(lines(path.join(dash, 'insights.jsonl')).length, 1);
  } finally { await stopChild(holder); rmSync(home, { recursive: true, force: true }); }
});

test('syncLedger: a log that changes while it is read gives changing and no line', async () => {
  const w = world();
  try {
    const p = project(w, 'demo-api');
    putRun(p, 'run-a');
    const logPath = path.join(p.autoRunsDir, 'run-a.log');
    // the run writes one more line while the ledger reads the log
    const readFile = (f, enc) => {
      const text = readFileSync(f, enc);
      if (f === logPath) appendFileSync(logPath, result({ min: 9, cost: 1 }) + '\n');
      return text;
    };
    const r = await syncLedger(opts(w, { projects: [p], readFile }));
    assert.equal(r.changing, 1);
    assert.equal(r.added, 0);
    assert.equal(lines(w.file).length, 0);
    assert.equal((await syncLedger(opts(w, { projects: [p] }))).added, 1, 'the next call adds it');
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('runRecord: a phase with no wall minutes gives null minutes', () => {
  // assistant lines without timestamps: run-usage gives no wall minutes for the row
  const noTimes = joinLines([
    JSON.stringify({ type: 'system', subtype: 'init', session_id: SID }),
    JSON.stringify({ type: 'assistant', session_id: SID, parent_tool_use_id: null,
      message: { id: 'msg-nt', usage: { input_tokens: 10, output_tokens: 1 }, content: [skill('skill-2-implement')] } }),
    JSON.stringify({ type: 'result', session_id: SID, model_usage_since_last_result: { 'model-demo': { costUSD: 1 } } }),
  ]);
  const r = runRecord({ project: 'demo-api', slug: 'x', logText: noTimes, reportText: null, src: SRC, projectsDir: '/nonexistent' });
  assert.equal(r.cost, 1);
  assert.equal(r.phases.implement.wall, null);
  assert.equal(r.minutes, null, 'one null wall value makes the sum null');
});

test('runRecord: mtime-based reuse needs the same log size and change time', () => {
  const previous = runRecord({ project: 'demo-api', slug: 'x', logText: LOG_TWO, reportText: reportOf(), src: SRC, projectsDir: '/nonexistent' });
  const changed = runRecord({ project: 'demo-api', slug: 'x', logText: LOG_ONE(9), reportText: reportOf(), previous,
    src: { ...SRC, logMtimeMs: SRC.logMtimeMs + 1 }, projectsDir: '/nonexistent' });
  assert.equal(changed.cost, 9, 'a changed log is parsed again');
});
