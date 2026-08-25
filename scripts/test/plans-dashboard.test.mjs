// Smoke tests for plans-dashboard.mjs. Every run happens against a throwaway HOME
// and a throwaway repo, so the real registry and the real ~/.claude are never touched.
//
//   node --test 'scripts/test/*.test.mjs'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plans-dashboard.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let tmp, home, repo, plansDir, port, server;

const start = async () => {
  const child = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, HOME: home, DASH_PORT: String(port), DASH_NO_OPEN: '1', DASH_NO_SUMMARY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (c) => (err += c));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('server exited: ' + err);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/state`)).ok) return child; } catch {}
    await sleep(100);
  }
  child.kill('SIGKILL');
  throw new Error('server never came up: ' + err);
};
const stop = async (child) => {
  if (!child || child.exitCode != null) return;
  child.kill('SIGKILL');
  await new Promise((r) => child.once('exit', r));
};

const get = async (p) => fetch(`http://127.0.0.1:${port}${p}`);
const post = (p, data) => fetch(`http://127.0.0.1:${port}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
}).then((r) => r.json());
const state = async () => (await get('/api/state')).json();
const onlyPlan = async () => (await state())[0].plans[0];

before(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'plans-dash-test-'));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  plansDir = path.join(repo, '.plans');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(path.join(plansDir, 'demo-plan.md'), '# Plan: Demo the dashboard\n\nDo the thing.\n');
  writeFileSync(path.join(home, '.claude', 'pipeline-projects.json'), JSON.stringify({
    projects: [{ name: 'demo', client: 'Test', root: repo, plansDir, launchers: [] }],
  }));
  port = await freePort();
  server = await start();
});

after(async () => {
  await stop(server);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('lists the registered project and parses the plan title', async () => {
  const s = await state();
  assert.equal(s.length, 1);
  assert.equal(s[0].name, 'demo');
  assert.equal(s[0].client, 'Test');
  assert.equal(s[0].hasPipeline, false);          // no auto-pipeline.sh in the fixture
  assert.equal(s[0].plans.length, 1);
  assert.equal(s[0].plans[0].slug, 'demo-plan');
  assert.equal(s[0].plans[0].title, 'Demo the dashboard');
});

test('serves plan markdown and rejects slugs that are not plain names', async () => {
  assert.match(await (await get('/api/plan?project=demo&slug=demo-plan')).text(), /Do the thing/);
  assert.equal((await get('/api/plan?project=demo&slug=../../etc/passwd')).status, 400);
  assert.equal((await get('/api/plan?project=nope&slug=demo-plan')).status, 400);
});

test('stores status and tags', async () => {
  assert.deepEqual(await post('/api/meta', { project: 'demo', slug: 'demo-plan', status: 'in review', tags: ['api', 'api'] }), { ok: true });
  const p = await onlyPlan();
  assert.equal(p.status, 'in review');
  assert.deepEqual(p.tags, ['api', 'api']);
});

test('records a generic run exit code, and keeps it after a restart', async () => {
  assert.deepEqual(await post('/api/launchers', {
    project: 'demo', launchers: [{ label: 'fails on purpose', cmd: 'exit 3' }],
  }), { ok: true });
  assert.deepEqual(await post('/api/launch-generic', { project: 'demo', slug: 'demo-plan', launcher: 0 }), { ok: true });

  const deadline = Date.now() + 20000;
  let p;
  do { await sleep(200); p = await onlyPlan(); } while (Date.now() < deadline && (!p.run || p.live));
  assert.equal(p.run.status, 'FAILED: exit 3', 'exit code observed while the server was up');

  // A restart drops the in-memory exit listener — the old failure mode was every
  // in-flight run degrading to "outcome unknown". Reproduce that by clearing the
  // record the listener wrote; the on-disk .exit file must still answer.
  const runsFile = path.join(home, '.claude', 'pipeline-dashboard', 'state', 'demo', 'runs.json');
  const runs = JSON.parse(readFileSync(runsFile, 'utf8'));
  assert.ok(existsSync(path.join(path.dirname(runsFile), 'demo-plan.exit')), '.exit file was written');
  delete runs['demo-plan'].exitCode;
  delete runs['demo-plan'].finishedAt;
  writeFileSync(runsFile, JSON.stringify(runs));

  await stop(server);
  server = await start();
  const after = await onlyPlan();
  assert.equal(after.run.status, 'FAILED: exit 3', 'exit code survived the restart');
  assert.equal(after.live, false);
});

test('archives a plan and puts it back', async () => {
  assert.equal((await post('/api/clear-run', { project: 'demo', slug: 'demo-plan' })).ok, true);
  assert.equal((await post('/api/archive', { project: 'demo', slug: 'demo-plan' })).ok, true);
  assert.equal(existsSync(path.join(plansDir, 'done', 'demo-plan.md')), true);
  assert.equal((await onlyPlan()).archived, true);

  assert.equal((await post('/api/unarchive', { project: 'demo', slug: 'demo-plan' })).ok, true);
  assert.equal(existsSync(path.join(plansDir, 'demo-plan.md')), true);
  assert.equal((await onlyPlan()).archived, undefined);
});
