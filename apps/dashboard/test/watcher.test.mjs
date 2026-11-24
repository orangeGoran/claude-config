// End-to-end tests of the dashboard's event watcher (apps/dashboard/server.mjs, "event watcher").
// Every server runs with a throwaway HOME, throwaway repos, a fake gh, a fake claude and a fake
// notifier, so GitHub, the real registry and real notifications are never touched.
//
//   node --test apps/dashboard/test/watcher.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync, realpathSync,
  utimesSync, statSync, readdirSync, unlinkSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TICK = 300;
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// a stand-in for gh: answers per repo (the folder name of its cwd) from files in FAKE_GH_DIR/<repo>/
//   list.json      the PR list (also the sort=updated list when there is no updated.json)
//   updated.json   the sort=updated list, in pages of 100
//   pr-<n>.json    one PR (merged_at, baseRefName, headRefName)
//   fail-list, fail-pr-<n>, fail-merge   that call fails with the file's text
//   delay-pr-<n>   the single-PR call answers after that many milliseconds
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const dir = path.join(process.env.FAKE_GH_DIR, path.basename(process.cwd()));
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, 'calls.log'), a.join(' ') + '\\n');
const f = (n) => path.join(dir, n);
const read = (n, d) => fs.existsSync(f(n)) ? fs.readFileSync(f(n), 'utf8') : d;
const fail = (n) => { process.stderr.write(read(n, 'failed') + '\\n'); process.exit(1); };
if (a[0] === 'api' && /\\/pulls\\?/.test(a[1])) {
  if (fs.existsSync(f('fail-list'))) fail('fail-list');
  const upd = /sort=updated/.test(a[1]) && fs.existsSync(f('updated.json'));
  const rows = JSON.parse(read(upd ? 'updated.json' : 'list.json', '[]'));
  const page = +((a[1].match(/[?&]page=(\\d+)/) || [])[1] || 1);
  process.stdout.write(JSON.stringify(rows.slice((page - 1) * 100, page * 100)));
} else if (a[0] === 'api' && /\\/pulls\\/\\d+$/.test(a[1])) {
  const n = a[1].match(/(\\d+)$/)[1];
  if (fs.existsSync(f('fail-pr-' + n))) fail('fail-pr-' + n);
  if (fs.existsSync(f('delay-pr-' + n))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, +read('delay-pr-' + n, '0'));
  process.stdout.write(read('pr-' + n + '.json', JSON.stringify({ merged_at: null, baseRefName: 'main', headRefName: 'auto/x' })));
} else if (a[0] === 'pr' && a[1] === 'merge') {
  if (fs.existsSync(f('fail-merge'))) fail('fail-merge');
} else process.stdout.write('{}');
`;
// a stand-in for claude in stream-json mode: a message starts a turn that ends only on an interrupt
const FAKE_CLAUDE = `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let held = false, buf = '';
const handle = (j) => {
  if (j.type === 'control_request') {
    if (j.request.subtype === 'interrupt' && held) { held = false; out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'ses-w' }); }
    return out({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id,
      response: j.request.subtype === 'get_context_usage' ? { totalTokens: 1, maxTokens: 200000 } : {} } });
  }
  if (j.type === 'user') { held = true; out({ type: 'stream_event', session_id: 'ses-w', parent_tool_use_id: null, event: { type: 'message_start' } }); }
};
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) handle(JSON.parse(l)); } });
process.stdin.on('end', () => process.exit(0));
`;
const MODES = { modes: [
  { id: 'verify', flag: '--stop-at-verify', label: 'stop at verify' },
  { id: 'pr', flag: '--to-pr', label: 'to PR' },
] };
const PIPE_SCRIPT = `case "$1" in\n  --describe) echo '${JSON.stringify(MODES)}'; exit 0 ;;\nesac\necho "$*" >> "$(dirname "$0")/args.log"\n`;
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let tmp, bin, ghDir, home, port, qaPort, server, notifyLog;
const extraServers = [];

const envFor = (h, p, q, extra = {}) => ({
  ...process.env, HOME: h, DASH_PORT: String(p), QA_REPORTS_PORT: String(q), QA_HOME: '',
  CLAUDE_TMP: path.join(tmp, 'claude-tmp'), DASH_NO_OPEN: '1', DASH_NO_SUMMARY: '1', SCOUT_NO_NOTIFY: '1',
  PATH: bin + ':' + process.env.PATH, FAKE_GH_DIR: ghDir, DASH_WATCH_MS: String(TICK),
  DASH_NO_NOTIFY: '1', DASH_NOTIFIER: '', ...extra,
});
// starts a server and waits until it answers; out() is what it printed
const startServer = async (env, script = SCRIPT) => {
  const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (c) => (text += c));
  child.stderr.on('data', (c) => (text += c));
  child.out = () => text;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('server exited: ' + text);
    try { if ((await fetch(`http://127.0.0.1:${env.DASH_PORT}/api/state`)).ok) return child; } catch {}
    await sleep(100);
  }
  child.kill('SIGKILL');
  throw new Error('server never came up: ' + text);
};
const stop = async (child) => {
  if (!child || child.exitCode != null) return;
  child.kill('SIGKILL');
  await new Promise((r) => child.once('exit', r));
};
const mainEnv = () => envFor(home, port, qaPort, { DASH_NO_NOTIFY: '', DASH_NOTIFIER: path.join(bin, 'notifier'), NOTIFY_LOG: notifyLog });

const until = async (fn, what, ms = 15000) => {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(150);
  }
  throw new Error('timed out waiting for ' + what + (last instanceof Error ? ': ' + last.message : ''));
};

// ---- worlds: repos, registry, fake PRs ----
const regFile = (h = home) => path.join(h, '.claude', 'pipeline-projects.json');
const registry = (h = home) => { try { return JSON.parse(readFileSync(regFile(h), 'utf8')).projects; } catch { return []; } };
const register = (entries, h = home) => writeFileSync(regFile(h), JSON.stringify({ projects: [...registry(h), ...entries] }));
const unregister = (names, h = home) => writeFileSync(regFile(h), JSON.stringify({ projects: registry(h).filter((e) => !names.includes(e.name)) }));
const ghData = (name) => { const d = path.join(ghDir, name); mkdirSync(d, { recursive: true }); return d; };
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const prRow = (n, state, extra = {}) => ({
  number: n, state, isDraft: false, title: 'PR ' + n, url: 'https://example.test/pull/' + n,
  headRefName: 'auto/pr-' + n, headRefOid: 'a'.repeat(40), baseRefName: 'main', baseRefOid: 'b'.repeat(40),
  mergedAt: state === 'MERGED' ? new Date().toISOString() : null, createdAt: ago(86400000), updatedAt: new Date().toISOString(), ...extra,
});
// writes the PR list of a repo and one pr-<n>.json per row
const setPrs = (name, rows, file = 'list.json') => {
  const d = ghData(name);
  writeFileSync(path.join(d, file), JSON.stringify(rows));
  for (const r of rows) writeFileSync(path.join(d, 'pr-' + r.number + '.json'),
    JSON.stringify({ merged_at: r.mergedAt, baseRefName: r.baseRefName, headRefName: r.headRefName }));
};
const planText = (waits, body = 'Do the thing.') =>
  '# Plan: test\n\n- **Base**: main\n' + waits.map((w) => '- **Waits for**: ' + w + '\n').join('') + '\n## Goal\n\n' + body + '\n';
// a repo folder with plans; a pipeline repo gets the auto-pipeline.sh that logs its arguments
const makeRepo = (name, { plans = {}, pipeline = true, script = PIPE_SCRIPT } = {}) => {
  const root = path.join(tmp, name);
  mkdirSync(path.join(root, '.plans', 'auto-runs'), { recursive: true });
  for (const [slug, text] of Object.entries(plans)) writeFileSync(path.join(root, '.plans', slug + '.md'), text);
  if (pipeline) {
    mkdirSync(path.join(root, '.claude', 'scripts'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'scripts', 'auto-pipeline.sh'), script);
  }
  ghData(name);
  return root;
};
const argsOf = (root) => { const f = path.join(root, '.claude', 'scripts', 'args.log'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []; };
const report = (root, slug, status) =>
  writeFileSync(path.join(root, '.plans', 'auto-runs', slug + '.md'), '# Auto-run: ' + slug + '\n\n## Status: ' + status + '\n');
const stateDir = (name, h = home) => path.join(h, '.claude', 'pipeline-dashboard', 'state', name);
const watchJson = (name, h = home) => { try { return JSON.parse(readFileSync(path.join(stateDir(name, h), 'watch.json'), 'utf8')); } catch { return null; } };
// the watcher has seen the project and read its PR list once
const seen = (name, h = home) => until(() => watchJson(name, h)?.prs, 'the first tick of ' + name);
const events = async (name, p = port) => (await (await fetch(`http://127.0.0.1:${p}/api/events?project=${name}&limit=1000`)).json()).events;
const ofType = (list, type) => list.filter((e) => e.type === type);
const plan = async (name, slug, p = port) =>
  (await (await fetch(`http://127.0.0.1:${p}/api/state`)).json()).find((x) => x.name === name).plans.find((x) => x.slug === slug);
const notes = () => (existsSync(notifyLog) ? readFileSync(notifyLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const post = (p, data) => fetch(`http://127.0.0.1:${port}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
}).then((r) => r.json());
const ticks = (n) => sleep(n * TICK + 400);

before(async () => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'plans-watch-test-')));
  bin = path.join(tmp, 'bin');
  ghDir = path.join(tmp, 'gh');
  home = path.join(tmp, 'home');
  notifyLog = path.join(tmp, 'notify.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  writeFileSync(path.join(bin, 'notifier'), '#!/bin/sh\necho "$*" >> "$NOTIFY_LOG"\n', { mode: 0o755 });
  register([]);
  port = await freePort();
  qaPort = await freePort();
  server = await startServer(mainEnv());
});

after(async () => {
  await stop(server);
  for (const c of extraServers) await stop(c);
  // chats outlive the server on purpose (chat-relay.mjs): end the ones this run left, by their socket path
  const chatDir = path.join(home, '.claude', 'pipeline-dashboard', 'chats', String(port));
  for (const f of existsSync(chatDir) ? readdirSync(chatDir) : []) {
    try { execFileSync('pkill', ['-f', JSON.parse(readFileSync(path.join(chatDir, f), 'utf8')).sock]); } catch {}
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('a merge starts the waiting plan once, in PR mode; an example in the body never starts a plan', async () => {
  setPrs('api1', [prRow(7, 'OPEN')]);
  const api = makeRepo('api1', { pipeline: false });
  const web = makeRepo('web1', { plans: {
    waiting: planText(['api1 PR #7 merged']),
    'body-example': planText([], '```\n- **Waits for**: api1 PR #7 merged\n```'),
  } });
  register([{ name: 'api1', root: api }, { name: 'web1', root: web }]);
  assert.deepEqual((await plan('web1', 'waiting')).waits, [{ text: 'api1 PR #7 merged', met: false, error: null }]);
  assert.equal((await plan('web1', 'body-example')).waits, null, 'a line under ## Goal is not a condition');
  await seen('api1');
  await seen('web1');
  await ticks(2);
  assert.deepEqual(argsOf(web), [], 'nothing starts before the merge');
  assert.deepEqual((await plan('web1', 'waiting')).waits, [{ text: 'api1 PR #7 merged', met: false, error: null }]);

  setPrs('api1', [prRow(7, 'MERGED')]);
  const lines = await until(() => argsOf(web).length && argsOf(web), 'the launch', 5000);
  assert.deepEqual(lines, ['--to-pr waiting.md']);
  const apiEv = await until(async () => ofType(await events('api1'), 'pr-merged').length && await events('api1'), 'the pr-merged event');
  assert.equal(ofType(apiEv, 'pr-merged')[0].number, 7);
  assert.equal(ofType(apiEv, 'pr-merged')[0].base, 'main');
  const webEv = await events('web1');
  assert.deepEqual(ofType(webEv, 'wait-met').map((e) => [e.slug, e.conditions]), [['waiting', ['api1 PR #7 merged']]]);
  assert.deepEqual(ofType(webEv, 'auto-launch').map((e) => [e.slug, e.mode]), [['waiting', 'pr']]);
  assert.deepEqual(webEv.filter((e) => ['wait-met', 'auto-launch'].includes(e.type)).map((e) => e.type), ['wait-met', 'auto-launch'], 'oldest first');
  await until(() => notes().some((l) => l.includes('-message Started waiting -open') && l.includes('?sel=web1%2Fwaiting')), 'the Started notification');
  await ticks(3);
  assert.equal(notes().filter((l) => l.includes('-message Started waiting')).length, 1, 'one Started notification');
  assert.deepEqual(argsOf(web), ['--to-pr waiting.md'], 'started once');
  assert.equal((await plan('web1', 'waiting')).waits, null, 'a started plan waits no more');
  assert.equal((await plan('web1', 'body-example')).waits, null);
});

test('an old PR and a reused branch: each merge and close is one event, and a wait on the old PR starts', async () => {
  setPrs('api3', [prRow(8, 'OPEN', { headRefName: 'feature/reuse' }), prRow(11, 'OPEN', { headRefName: 'feature/reuse' })]);
  const api = makeRepo('api3', { pipeline: false });
  const web = makeRepo('web3', { plans: { 'old-pr': planText(['api3 PR #2 merged']) } });
  register([{ name: 'api3', root: api }, { name: 'web3', root: web }]);
  await seen('api3');
  setPrs('api3', [prRow(2, 'MERGED', { createdAt: ago(90 * 86400000) }), prRow(11, 'MERGED', { headRefName: 'feature/reuse' }),
    prRow(8, 'CLOSED', { headRefName: 'feature/reuse' })], 'updated.json');
  const ev = await until(async () => { const e = await events('api3'); return e.length >= 3 && e; }, 'three PR events');
  assert.deepEqual(ofType(ev, 'pr-merged').map((e) => e.number).sort((a, b) => a - b), [2, 11]);
  assert.deepEqual(ofType(ev, 'pr-closed').map((e) => e.number), [8]);
  assert.deepEqual(await until(() => argsOf(web).length && argsOf(web), 'the launch'), ['--to-pr old-pr.md']);
  await ticks(2);
  assert.equal((await events('api3')).length, 3, 'no event twice');
  unregister(['api3', 'web3']);
});

test('more than one page of updates: a merge on page 2 is seen, and one on both pages makes one event', async () => {
  setPrs('api4', []);
  const api = makeRepo('api4', { pipeline: false });
  register([{ name: 'api4', root: api }]);
  await seen('api4');
  const rows = Array.from({ length: 150 }, (_, i) => prRow(1000 + i, 'OPEN'));
  rows[130] = prRow(1130, 'MERGED');
  rows[5] = { ...rows[130] };   // updated during the read: on page 1 and on page 2
  rows[140] = prRow(1140, 'MERGED');   // only on page 2
  writeFileSync(path.join(ghData('api4'), 'updated.json'), JSON.stringify(rows));
  const ev = await until(async () => { const e = ofType(await events('api4'), 'pr-merged'); return e.length >= 2 && e; }, 'the pr-merged events');
  await ticks(2);
  assert.deepEqual(ofType(await events('api4'), 'pr-merged').map((e) => e.number).sort(), [1130, 1140], 'page 2 is read; one event per PR');
  for (const e of ev) assert.match(e.pull, /^Not pulled: .* is not a git repository\.$/, 'one pull per merged PR');
  assert.match(readFileSync(path.join(ghData('api4'), 'calls.log'), 'utf8'), /sort=updated.*page=2/);
  unregister(['api4']);
});

test('gh errors: redacted everywhere and no notification; a config error notifies once', async () => {
  const api = makeRepo('api5', { pipeline: false });
  setPrs('api5', [prRow(3, 'OPEN')]);
  writeFileSync(path.join(ghData('api5'), 'fail-pr-3'), 'HTTP 401 https://api.example.test/x?token=abc');
  const web = makeRepo('web5', { plans: { 'gh-down': planText(['api5 PR #3 merged']), 'no-such': planText(['nope PR #1 merged']) } });
  register([{ name: 'api5', root: api }, { name: 'web5', root: web }]);
  const p = await until(async () => { const x = await plan('web5', 'gh-down'); return x.waits[0].error && x; }, 'the gh error');
  assert.match(p.waits[0].error, /HTTP 401/);
  assert.doesNotMatch(JSON.stringify(p.waits), /abc/);
  const ev = await until(async () => { const e = await events('web5'); return ofType(e, 'wait-error').length >= 2 && e; }, 'two wait-error events');
  assert.doesNotMatch(JSON.stringify(ev), /abc/);
  assert.deepEqual(ofType(ev, 'wait-error').find((e) => e.slug === 'no-such').reason, 'unknown project');
  await until(() => notes().some((l) => l.includes('no-such cannot start by itself: unknown project')), 'the config error notification');
  await ticks(3);
  assert.equal(notes().filter((l) => l.includes('no-such')).length, 1, 'notified once');
  assert.equal(notes().filter((l) => l.includes('gh-down')).length, 0, 'a passing gh error does not notify');
  unlinkSync(path.join(ghData('api5'), 'fail-pr-3'));
  await until(async () => (await plan('web5', 'gh-down')).waits[0].error === null, 'the error to go');
  assert.deepEqual(argsOf(web), []);
  unregister(['api5', 'web5']);
});

test('a failed auto-start is reported with redacted text and a notification, and is not retried', async () => {
  const api = makeRepo('api7', { pipeline: false });
  setPrs('api7', [prRow(1, 'MERGED')]);
  const script = PIPE_SCRIPT.replace(/\n$/, '') + `\necho "SKIP: skipped.md is not on origin/main https://x.test/?token=abc ${'x'.repeat(2000)}"\nexit 0\n`;
  const web = makeRepo('web7', { plans: { skipped: planText(['api7 PR #1 merged']) }, script });
  register([{ name: 'api7', root: api }, { name: 'web7', root: web }]);
  const ev = await until(async () => { const e = await events('web7'); return ofType(e, 'auto-launch-failed').length && e; }, 'auto-launch-failed');
  const failed = ofType(ev, 'auto-launch-failed')[0];
  assert.match(failed.output, /^SKIP: skipped\.md is not on origin\/main/);
  assert.doesNotMatch(failed.output, /abc/);
  assert.ok(failed.output.length <= 500);
  await until(() => notes().some((l) => l.includes('skipped did not start')), 'the notification');
  await ticks(3);
  assert.equal(argsOf(web).length, 1, 'no second launch');
  assert.equal(ofType(await events('web7'), 'auto-launch').length, 1);
});

test('a plan parked, or its Waits for line removed, while the watcher checks it does not start', async () => {
  const api = makeRepo('api23', { pipeline: false });
  setPrs('api23', [prRow(1, 'MERGED'), prRow(2, 'MERGED')]);
  writeFileSync(path.join(ghData('api23'), 'delay-pr-1'), '1500');
  writeFileSync(path.join(ghData('api23'), 'delay-pr-2'), '1500');
  const web = makeRepo('web23', { plans: { 'park-me': planText(['api23 PR #1 merged']) } });
  const web2 = makeRepo('web23b', { plans: { 'unwait-me': planText(['api23 PR #2 merged']) } });
  register([{ name: 'api23', root: api }, { name: 'web23', root: web }, { name: 'web23b', root: web2 }]);
  const calls = () => { try { return readFileSync(path.join(ghData('api23'), 'calls.log'), 'utf8'); } catch { return ''; } };
  // while gh answers slowly, the owner parks the first plan and removes the line of the second
  await until(() => /pulls\/1 /.test(calls()), 'the check of PR #1 to start');
  mkdirSync(stateDir('web23'), { recursive: true });
  writeFileSync(path.join(stateDir('web23'), 'plan-meta.json'), JSON.stringify({ 'park-me': { status: 'parked', tags: [] } }));
  await until(() => /pulls\/2 /.test(calls()), 'the check of PR #2 to start');
  writeFileSync(path.join(web2, '.plans', 'unwait-me.md'), planText([]));
  await sleep(4000);
  assert.deepEqual(argsOf(web), [], 'the parked plan did not start');
  assert.deepEqual(argsOf(web2), [], 'the plan without its line did not start');
  unregister(['api23', 'web23', 'web23b']);
});

test('a parked plan never starts by itself', async () => {
  const api = makeRepo('api8', { pipeline: false });
  setPrs('api8', [prRow(1, 'MERGED')]);
  const web = makeRepo('web8', { plans: { parked: planText(['api8 PR #1 merged']) } });
  mkdirSync(stateDir('web8'), { recursive: true });
  writeFileSync(path.join(stateDir('web8'), 'plan-meta.json'), JSON.stringify({ parked: { status: 'parked', tags: [] } }));
  register([{ name: 'api8', root: api }, { name: 'web8', root: web }]);
  await until(async () => ofType(await events('web8'), 'wait-met').length, 'wait-met');
  await ticks(3);
  assert.deepEqual(argsOf(web), []);
  unregister(['api8', 'web8']);
});

test('a removed Waits for line: the plan waits no more', async () => {
  const api = makeRepo('api9', { pipeline: false });
  setPrs('api9', [prRow(1, 'OPEN')]);
  const web = makeRepo('web9', { plans: { gone: planText(['api9 PR #1 merged']) } });
  register([{ name: 'api9', root: api }, { name: 'web9', root: web }]);
  await seen('web9');
  assert.deepEqual((await plan('web9', 'gone')).waits, [{ text: 'api9 PR #1 merged', met: false, error: null }]);
  writeFileSync(path.join(web, '.plans', 'gone.md'), planText([]));
  assert.equal((await plan('web9', 'gone')).waits, null);
  unregister(['api9', 'web9']);
});

test('short names and plan … merged: waits for the PR on auto/<slug>; a short name two projects have is an error', async () => {
  const api = makeRepo('api10', { pipeline: false, plans: { 'other-slug': '# Plan: other\n' } });
  setPrs('api10', [prRow(4, 'OPEN', { headRefName: 'auto/other-slug' })]);
  const d1 = makeRepo('dup10a', { pipeline: false }), d2 = makeRepo('dup10b', { pipeline: false });
  const web = makeRepo('web10', { plans: { 'by-short': planText(['a10 plan other-slug merged']), 'by-dup': planText(['d10 plan x merged']) } });
  register([{ name: 'api10', root: api, short: 'a10' }, { name: 'dup10a', root: d1, short: 'd10' }, { name: 'dup10b', root: d2, short: 'd10' },
    { name: 'web10', root: web }]);
  const ev = await until(async () => { const e = await events('web10'); return ofType(e, 'wait-error').length && e; }, 'wait-error');
  assert.deepEqual(ofType(ev, 'wait-error').map((e) => [e.slug, e.reason]), [['by-dup', 'two projects have this short name']]);
  await ticks(2);
  assert.deepEqual(argsOf(web), [], 'waits while the PR is open');
  setPrs('api10', [prRow(4, 'MERGED', { headRefName: 'auto/other-slug' })]);
  assert.deepEqual(await until(() => argsOf(web).length && argsOf(web), 'the launch'), ['--to-pr by-short.md']);
  await ticks(2);
  assert.deepEqual(argsOf(web), ['--to-pr by-short.md'], 'the short name two projects have never starts');
  unregister(['api10', 'dup10a', 'dup10b', 'web10']);
});

test('plan … merged with a slug that has no plan file and no PR is an error the owner must fix', async () => {
  const api = makeRepo('api10t', { pipeline: false });
  setPrs('api10t', [prRow(4, 'OPEN', { headRefName: 'auto/some-other' })]);
  const web = makeRepo('web10t', { plans: { typo: planText(['api10t plan no-such-slug merged']) } });
  register([{ name: 'api10t', root: api }, { name: 'web10t', root: web }]);
  const ev = await until(async () => { const e = await events('web10t'); return ofType(e, 'wait-error').length && e; }, 'wait-error');
  assert.deepEqual(ofType(ev, 'wait-error').map((e) => [e.slug, e.reason]), [['typo', 'unknown plan']]);
  await until(() => notes().some((l) => l.includes('typo cannot start by itself: unknown plan')), 'the notification');
  assert.deepEqual(argsOf(web), []);
  unregister(['api10t', 'web10t']);
});

test('the 4-run limit: a met plan waits while 4 runs run, and a CLEANED report does not count', async () => {
  const api = makeRepo('api11', { pipeline: false });
  setPrs('api11', [prRow(1, 'MERGED')]);
  const plans = { fifth: planText(['api11 PR #1 merged']), cleaned: '# Plan: cleaned\n' };
  for (const s of ['r1', 'r2', 'r3', 'r4']) plans[s] = '# Plan: ' + s + '\n';
  const web = makeRepo('web11', { plans });
  for (const s of ['r1', 'r2', 'r3', 'r4']) report(web, s, 'RUNNING');
  report(web, 'cleaned', 'CLEANED — worktree removed');
  register([{ name: 'api11', root: api }, { name: 'web11', root: web }]);
  await until(async () => ofType(await events('web11'), 'wait-met').length, 'wait-met');
  await ticks(3);
  assert.deepEqual(argsOf(web), [], 'four runs run');
  report(web, 'r2', 'PR OPEN — https://example.test/pr/1');
  assert.deepEqual(await until(() => argsOf(web).length && argsOf(web), 'the launch'), ['--to-pr fifth.md']);
  unregister(['api11', 'web11']);
});

test('a busy chat delays the start until the chat ends', async () => {
  const api = makeRepo('api12', { pipeline: false });
  setPrs('api12', [prRow(1, 'OPEN')]);
  const web = makeRepo('web12', { plans: { chatty: planText(['api12 PR #1 merged']) } });
  mkdirSync(path.join(stateDir('web12'), 'ask'), { recursive: true });
  writeFileSync(path.join(stateDir('web12'), 'ask', 'chatty.json'), JSON.stringify({ root: true }));
  register([{ name: 'api12', root: api }, { name: 'web12', root: web }]);
  await seen('web12');
  assert.deepEqual(await post('/api/chat/send', { project: 'web12', slug: 'chatty', text: 'hold on' }), { ok: true });
  await until(async () => (await plan('web12', 'chatty')).chatting, 'the chat to be busy');
  setPrs('api12', [prRow(1, 'MERGED')]);
  await until(async () => ofType(await events('web12'), 'wait-met').length, 'wait-met');
  await ticks(3);
  assert.deepEqual(argsOf(web), [], 'no start while the chat works');
  assert.deepEqual(await post('/api/chat/stop', { project: 'web12', slug: 'chatty' }), { ok: true });
  assert.deepEqual(await until(() => argsOf(web).length && argsOf(web), 'the launch'), ['--to-pr chatty.md']);
  unregister(['api12', 'web12']);
});

test('submodule condition: starts when the pointer on origin/<base> contains the commit; bad ones are errors', async () => {
  const contracts = path.join(tmp, 'contracts.git'), work = path.join(tmp, 'contracts-work');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', contracts);
  git(tmp, 'init', '-q', '-b', 'main', work);
  writeFileSync(path.join(work, 'a.txt'), '1'); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'c1');
  const c1 = git(work, 'rev-parse', 'HEAD');
  writeFileSync(path.join(work, 'a.txt'), '2'); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'c2');
  const c2 = git(work, 'rev-parse', 'HEAD');
  git(work, 'remote', 'add', 'origin', contracts); git(work, 'push', '-q', 'origin', 'main');

  const web = makeRepo('web13', { plans: {
    'sub-wait': planText(['submodule contracts contains ' + c2.slice(0, 9)]),
    'sub-none': planText(['submodule nothere contains ' + c2.slice(0, 9)]),
    'sub-bad': planText(['submodule contracts contains 0000000']),
  } });
  const origin = path.join(tmp, 'web13-origin.git');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(web, 'init', '-q', '-b', 'main');
  git(web, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', contracts, 'contracts');
  git(path.join(web, 'contracts'), 'checkout', '-q', c1);
  git(web, 'add', 'contracts', '.gitmodules'); git(web, 'commit', '-qm', 'pointer at c1');
  git(web, 'remote', 'add', 'origin', origin); git(web, 'push', '-q', '-u', 'origin', 'main');
  setPrs('web13', []);
  register([{ name: 'web13', root: web }]);

  const ev = await until(async () => { const e = await events('web13'); return ofType(e, 'wait-error').length >= 2 && e; }, 'two wait-errors');
  assert.deepEqual(ofType(ev, 'wait-error').map((e) => [e.slug, e.reason]).sort(),
    [['sub-bad', 'commit not found (unknown or ambiguous)'], ['sub-none', 'submodule not initialized in the main checkout']]);
  await until(() => notes().some((l) => l.includes('sub-bad cannot start by itself: commit not found')), 'the notification');
  assert.deepEqual((await plan('web13', 'sub-wait')).waits[0].met, false);
  assert.deepEqual(argsOf(web), []);

  // the pointer moves to c2 on origin/main, from another clone
  const other = path.join(tmp, 'web13-other');
  git(tmp, 'clone', '-q', origin, other);
  git(other, 'update-index', '--cacheinfo', '160000,' + c2 + ',contracts');
  git(other, 'commit', '-qm', 'pointer at c2'); git(other, 'push', '-q');
  assert.deepEqual(await until(() => argsOf(web).length && argsOf(web), 'the launch'), ['--to-pr sub-wait.md']);
  await ticks(2);
  assert.equal(argsOf(web).length, 1, 'the bad conditions never start');
  unregister(['web13']);
});

test('a gh error skips only the PR part: run outcome events still come', async () => {
  const web = makeRepo('web14', { plans: { run: '# Plan: run\n' } });
  writeFileSync(path.join(ghData('web14'), 'fail-list'), 'HTTP 502');
  report(web, 'run', 'RUNNING');
  register([{ name: 'web14', root: web }]);
  await until(() => watchJson('web14')?.outcomes, 'the first tick');
  report(web, 'run', 'PR OPEN — https://example.test/pr/2');
  const ev = await until(async () => { const e = await events('web14'); return ofType(e, 'run-outcome').length && e; }, 'run-outcome');
  assert.deepEqual(ofType(ev, 'run-outcome').map((e) => [e.slug, e.outcome, e.previous]), [['run', 'needs-you', 'running']]);
  assert.equal(watchJson('web14').prs, null, 'no PR state without a PR list');
  unregister(['web14']);
});

test('a generic project: a Waits for line says it needs auto-pipeline.sh and nothing starts', async () => {
  const api = makeRepo('api15', { pipeline: false });
  setPrs('api15', [prRow(1, 'MERGED')]);
  const gen = makeRepo('gen15', { pipeline: false, plans: { generic: planText(['api15 PR #1 merged']) } });
  register([{ name: 'api15', root: api }, { name: 'gen15', root: gen }]);
  const p = await until(async () => { const x = await plan('gen15', 'generic'); return x.waits[0].error && x; }, 'the error');
  assert.match(p.waits[0].error, /auto-pipeline\.sh/);
  assert.equal(p.waits[0].met, false);
  assert.equal(ofType(await events('gen15'), 'auto-launch').length, 0);
  unregister(['api15', 'gen15']);
});

test('a button merge is not pulled twice; a failed button merge leaves the pull to the watcher', async () => {
  const api = makeRepo('api16', { pipeline: false });
  setPrs('api16', [prRow(7, 'OPEN'), prRow(8, 'OPEN')]);
  const web = makeRepo('web16', { plans: { 'after-button': planText(['api16 PR #7 merged']) } });
  register([{ name: 'api16', root: api }, { name: 'web16', root: web }]);
  await seen('api16');
  const r = await post('/api/pr-action', { project: 'api16', slug: 'x', number: 7, action: 'merge', method: 'squash', head: 'b'.repeat(40) });
  assert.equal(r.ok, true, JSON.stringify(r));
  setPrs('api16', [prRow(7, 'MERGED'), prRow(8, 'OPEN')]);   // GitHub now says merged
  const ev = await until(async () => ofType(await events('api16'), 'pr-merged')[0], 'pr-merged #7');
  assert.equal(ev.pull, 'Pull left to the merge button.');
  assert.deepEqual(await until(() => argsOf(web).length && argsOf(web), 'the launch'), ['--to-pr after-button.md']);

  writeFileSync(path.join(ghData('api16'), 'fail-merge'), 'merge refused');
  const r2 = await post('/api/pr-action', { project: 'api16', slug: 'x', number: 8, action: 'merge', method: 'squash', head: 'b'.repeat(40) });
  assert.equal(r2.ok, false);
  unlinkSync(path.join(ghData('api16'), 'fail-merge'));
  setPrs('api16', [prRow(7, 'MERGED'), prRow(8, 'MERGED')]);
  const ev8 = await until(async () => ofType(await events('api16'), 'pr-merged').find((e) => e.number === 8), 'pr-merged #8');
  assert.match(ev8.pull, /^Not pulled: .* is not a git repository\.$/, 'the watcher tried the pull itself');
  unregister(['api16', 'web16']);
});

test('a plan moved back from done/ does not start again', async () => {
  const api = makeRepo('api17', { pipeline: false });
  setPrs('api17', [prRow(1, 'MERGED')]);
  const web = makeRepo('web17', { plans: { again: planText(['api17 PR #1 merged']) } });
  register([{ name: 'api17', root: api }, { name: 'web17', root: web }]);
  await until(() => argsOf(web).length, 'the launch');
  await until(async () => (await plan('web17', 'again')).launch === null, 'the launcher to finish');
  assert.equal((await post('/api/archive', { project: 'web17', slug: 'again' })).ok, true);
  await until(() => watchJson('web17')?.launched?.again?.state === 'started', 'the record to say started');
  assert.equal((await post('/api/unarchive', { project: 'web17', slug: 'again' })).ok, true);
  await ticks(3);
  assert.equal(argsOf(web).length, 1);
  assert.equal((await plan('web17', 'again')).waits, null);
  unregister(['api17', 'web17']);
});

test('a merge on GitHub pulls the main checkout, and the run worktrees stay', async () => {
  const api = makeRepo('api18', { pipeline: false });
  const origin = path.join(tmp, 'api18-origin.git'), other = path.join(tmp, 'api18-other');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(api, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(api, 'README.md'), 'api\n');
  git(api, 'add', 'README.md'); git(api, 'commit', '-qm', 'base');
  git(api, 'remote', 'add', 'origin', origin); git(api, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', origin, other);
  writeFileSync(path.join(other, 'merged.txt'), 'x');
  git(other, 'add', '-A'); git(other, 'commit', '-qm', 'merged'); git(other, 'push', '-q');
  const wt = path.join(tmp, 'worktrees', 'api18', 'some-plan');
  mkdirSync(wt, { recursive: true });
  setPrs('api18', [prRow(7, 'OPEN', { headRefName: 'auto/some-plan' })]);
  register([{ name: 'api18', root: api }]);
  await seen('api18');
  setPrs('api18', [prRow(7, 'MERGED', { headRefName: 'auto/some-plan' })]);
  const ev = await until(async () => ofType(await events('api18'), 'pr-merged')[0], 'pr-merged');
  assert.match(ev.pull, /^Pulled main/);
  assert.ok(existsSync(path.join(api, 'merged.txt')), 'the main checkout was pulled');
  assert.ok(existsSync(wt), 'the worktree is not removed');
  unregister(['api18']);
});

test('run outcome events, and one notification per outcome change with a link to the plan', async () => {
  const web = makeRepo('web19', { plans: { a: '# Plan: a\n', b: '# Plan: b\n' } });
  setPrs('web19', []);
  report(web, 'a', 'RUNNING');
  report(web, 'b', 'RUNNING');
  register([{ name: 'web19', root: web }]);
  await until(() => watchJson('web19')?.outcomes, 'the first tick');
  const lines = (slug) => notes().filter((l) => l.includes('?sel=web19%2F' + slug));
  report(web, 'a', 'PR OPEN — https://example.test/pr/3');
  await until(async () => ofType(await events('web19'), 'run-outcome').some((e) => e.slug === 'a' && e.outcome === 'needs-you'), 'needs-you');
  await until(() => lines('a').length === 1, 'the first notification');
  assert.match(lines('a')[0], new RegExp('-message a: PR OPEN — https://example.test/pr/3 -open http://127.0.0.1:' + port + '/\\?sel=web19%2Fa'));
  report(web, 'a', 'FAILED: test');
  await until(async () => ofType(await events('web19'), 'run-outcome').some((e) => e.slug === 'a' && e.outcome === 'failed'), 'failed');
  await until(() => lines('a').length === 2, 'the second notification');

  report(web, 'b', 'COMMITTED — READY TO PUSH');
  await until(() => lines('b').length === 1, 'the COMMITTED notification');
  report(web, 'b', 'PR OPEN — https://example.test/pr/4');
  await until(() => lines('b').length === 2, 'the PR OPEN notification');
  await ticks(3);
  assert.equal(lines('a').length, 2);
  assert.equal(lines('b').length, 2, 'never two for one change');
  unregister(['web19']);
});

test('no flood on the first tick: a PR merged before the watcher saw the project makes no event', async () => {
  const api = makeRepo('api20', { pipeline: false });
  setPrs('api20', [prRow(1, 'MERGED', { mergedAt: ago(60000) }), prRow(2, 'OPEN')]);
  register([{ name: 'api20', root: api }]);
  await seen('api20');
  await ticks(3);
  assert.deepEqual(await events('api20'), []);
  unregister(['api20']);
});

test('events.jsonl keeps its last 5000 lines; /api/events gives 200 by default and 1000 at most', async () => {
  const web = makeRepo('cap22', { plans: { r: '# Plan: r\n' } });
  report(web, 'r', 'RUNNING');
  mkdirSync(stateDir('cap22'), { recursive: true });
  const f = path.join(stateDir('cap22'), 'events.jsonl');
  writeFileSync(f, Array.from({ length: 5000 }, (_, n) => JSON.stringify({ at: ago(60000), project: 'cap22', type: 'fake', n }) + '\n').join(''));
  register([{ name: 'cap22', root: web }]);
  await until(() => watchJson('cap22')?.outcomes, 'the first tick');
  report(web, 'r', 'PR OPEN — https://example.test/pr/9');
  await until(() => readFileSync(f, 'utf8').includes('run-outcome'), 'the run-outcome event');
  const lines = readFileSync(f, 'utf8').trim().split('\n');
  assert.equal(lines.length, 5000, 'the file is cut to 5000 lines');
  assert.equal(JSON.parse(lines[0]).n, 1, 'the oldest line went');
  const get = async (q) => (await (await fetch(`http://127.0.0.1:${port}/api/events?project=cap22${q}`)).json()).events;
  for (const q of ['', '&limit=0', '&limit=abc']) assert.equal((await get(q)).length, 200, 'default for "' + q + '"');
  const most = await get('&limit=5000');
  assert.equal(most.length, 1000, 'at most 1000');
  assert.equal(most[0].n, 4001, 'oldest first');
  assert.equal(most.at(-1).type, 'run-outcome', 'the newest last');
  assert.deepEqual((await get('&limit=1')).map((e) => e.type), ['run-outcome']);
  unregister(['cap22']);
});

test('an auto-start that shows no run after 10 minutes is reported as failed, once', async () => {
  const web = makeRepo('web27', { plans: { stuck: planText(['api1 PR #7 merged']) } });
  setPrs('web27', []);
  // a start recorded 11 minutes ago whose run never came (a restart lost the launch)
  mkdirSync(stateDir('web27'), { recursive: true });
  writeFileSync(path.join(stateDir('web27'), 'watch.json'), JSON.stringify({ prs: {}, outcomes: {}, met: {}, errors: {},
    launched: { stuck: { at: ago(11 * 60000), mode: 'pr', state: 'pending' } }, since: ago(3600000), checkedAt: null }));
  register([{ name: 'web27', root: web }]);
  const ev = await until(async () => ofType(await events('web27'), 'auto-launch-failed')[0], 'auto-launch-failed');
  assert.deepEqual([ev.slug, ev.output], ['stuck', 'no run started']);
  await until(() => notes().some((l) => l.includes('stuck did not start: no run started')), 'the notification');
  await ticks(3);
  assert.equal(ofType(await events('web27'), 'auto-launch-failed').length, 1, 'reported once');
  assert.equal(watchJson('web27').launched.stuck.state, 'failed');
  assert.deepEqual(argsOf(web), [], 'not started again');
  unregister(['web27']);
});

test('an auto-start uses the default mode when the project has no "to PR" mode', async () => {
  const api = makeRepo('api24', { pipeline: false });
  setPrs('api24', [prRow(1, 'MERGED')]);
  const web = makeRepo('web24', { plans: { plain: planText(['api24 PR #1 merged']) }, script: 'echo "$*" >> "$(dirname "$0")/args.log"\n' });
  register([{ name: 'api24', root: api }, { name: 'web24', root: web }]);
  assert.deepEqual(await until(() => argsOf(web).length && argsOf(web), 'the launch'), ['--stop-at-verify plain.md']);
  assert.deepEqual(ofType(await events('web24'), 'auto-launch').map((e) => e.mode), ['verify']);
  unregister(['api24', 'web24']);
});

test('DASH_WATCH_MS=0 turns the watcher off: no lock, no state, no start', async () => {
  const h = path.join(tmp, 'home-off');
  mkdirSync(path.join(h, '.claude'), { recursive: true });
  const api = makeRepo('api26', { pipeline: false });
  setPrs('api26', [prRow(1, 'MERGED')]);
  const web = makeRepo('web26', { plans: { off: planText(['api26 PR #1 merged']) } });
  register([{ name: 'api26', root: api }, { name: 'web26', root: web }], h);
  const p = await freePort(), q = await freePort();
  const s = await startServer(envFor(h, p, q, { DASH_WATCH_MS: '0' }));
  extraServers.push(s);
  await sleep(2000);
  await ticks(3);
  assert.deepEqual(argsOf(web), []);
  assert.equal(watchJson('web26', h), null);
  assert.equal(existsSync(path.join(h, '.claude', 'pipeline-dashboard', 'watcher.lock')), false);
  await stop(s);
});

test('/api/events: oldest first, limits, bad lines, bad projects and cross-site requests', async () => {
  const quiet = makeRepo('quiet21', { pipeline: false });
  register([{ name: 'quiet21', root: quiet }]);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/events?project=quiet21`)).json(), { events: [] });
  unregister(['quiet21']);
  const get = (q) => fetch(`http://127.0.0.1:${port}/api/events?project=web1${q}`);
  const all = (await (await get('&limit=1000')).json()).events;
  assert.ok(all.length >= 2);
  assert.deepEqual([...all].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).map((e) => e.at), all.map((e) => e.at), 'oldest first');
  assert.deepEqual((await (await get('&limit=1')).json()).events, all.slice(-1));
  assert.equal((await (await get('&limit=0')).json()).events.length, all.length);
  assert.equal((await (await get('&limit=abc')).json()).events.length, all.length);
  assert.equal((await (await get('&limit=5000')).json()).events.length, all.length);
  appendFileSync(path.join(stateDir('web1'), 'events.jsonl'), 'not json\n');
  assert.equal((await (await get('')).json()).events.length, all.length, 'a bad line is skipped');
  for (const q of ['nope', '../x']) {
    const r = await fetch(`http://127.0.0.1:${port}/api/events?project=${q}`);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'bad project' });
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/events?project=web1`, { headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('a restart keeps the state: no repeated events or launches, and started plans show no waits', async () => {
  const count = async () => {
    const out = {};
    for (const n of ['api1', 'web1', 'web7'])
      for (const e of await events(n)) if (['pr-merged', 'wait-met', 'wait-error', 'auto-launch', 'auto-launch-failed'].includes(e.type))
        out[n + ' ' + e.type] = (out[n + ' ' + e.type] || 0) + 1;
    return out;
  };
  const before = await count();
  await stop(server);
  server = await startServer(mainEnv());
  assert.equal((await plan('web1', 'waiting')).waits, null, 'an auto-launched plan shows no waits chip');
  assert.equal((await plan('web7', 'skipped')).waits, null, 'a failed auto-start shows no chip');
  await sleep(2000);
  await ticks(4);
  assert.deepEqual(await count(), before);
  assert.deepEqual(argsOf(path.join(tmp, 'web1')), ['--to-pr waiting.md']);
  assert.equal(argsOf(path.join(tmp, 'web7')).length, 1);
});

test("the dashboard's own repo is not pulled", async () => {
  const chromeBefore = process.env.CHROME;
  process.env.CHROME = '/nonexistent';   // docs-media exits on import without a Chrome unless it is not the main module
  const { copyDashboard } = await import('../../../scripts/docs-media.mjs');
  if (chromeBefore === undefined) delete process.env.CHROME; else process.env.CHROME = chromeBefore;
  const box = path.join(tmp, 'own');
  const ownHome = path.join(box, 'home');
  mkdirSync(path.join(ownHome, '.claude'), { recursive: true });
  const dash = path.join(box, 'Workspace', 'claude-config');
  const script = copyDashboard(dash);
  const origin = path.join(box, 'origin.git'), other = path.join(box, 'other');
  git(box, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dash, 'init', '-q', '-b', 'main');
  git(dash, 'add', '-A'); git(dash, 'commit', '-qm', 'copy');
  git(dash, 'remote', 'add', 'origin', origin); git(dash, 'push', '-q', '-u', 'origin', 'main');
  git(box, 'clone', '-q', origin, other);
  writeFileSync(path.join(other, 'new.txt'), 'n'); git(other, 'add', '-A'); git(other, 'commit', '-qm', 'new'); git(other, 'push', '-q');
  const headBefore = git(dash, 'rev-parse', 'HEAD');
  setPrs('claude-config', [prRow(5, 'OPEN')]);
  register([{ name: 'dash', root: dash }], ownHome);
  const p = await freePort(), q = await freePort();
  const own = await startServer(envFor(ownHome, p, q), script);
  extraServers.push(own);
  await seen('dash', ownHome);
  setPrs('claude-config', [prRow(5, 'MERGED')]);
  const ev = await until(async () => ofType(await events('dash', p), 'pr-merged')[0], 'pr-merged');
  assert.match(ev.pull, /^Not pulled: this is the dashboard's own repo/);
  assert.equal(git(dash, 'rev-parse', 'HEAD'), headBefore, 'HEAD did not move');
  assert.equal(existsSync(path.join(dash, 'new.txt')), false);
  await stop(own);
});

test("a dashboard that runs from a worktree does not pull its repo's main checkout", async () => {
  const chromeBefore = process.env.CHROME;
  process.env.CHROME = '/nonexistent';
  const { copyDashboard } = await import('../../../scripts/docs-media.mjs');
  if (chromeBefore === undefined) delete process.env.CHROME; else process.env.CHROME = chromeBefore;
  const box = path.join(tmp, 'own-wt');
  const wtHome = path.join(box, 'home');
  mkdirSync(path.join(wtHome, '.claude'), { recursive: true });
  const dash = path.join(box, 'Workspace', 'claude-config');
  copyDashboard(dash);
  const origin = path.join(box, 'origin.git'), other = path.join(box, 'other'), wt = path.join(box, 'wt');
  git(box, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dash, 'init', '-q', '-b', 'main');
  git(dash, 'add', '-A'); git(dash, 'commit', '-qm', 'copy');
  git(dash, 'remote', 'add', 'origin', origin); git(dash, 'push', '-q', '-u', 'origin', 'main');
  git(dash, 'worktree', 'add', '-q', '-b', 'side', wt);
  git(box, 'clone', '-q', origin, other);
  writeFileSync(path.join(other, 'new.txt'), 'n'); git(other, 'add', '-A'); git(other, 'commit', '-qm', 'new'); git(other, 'push', '-q');
  const headBefore = git(dash, 'rev-parse', 'HEAD');
  setPrs('claude-config', [prRow(6, 'OPEN')]);
  register([{ name: 'dash', root: dash }], wtHome);
  const p = await freePort(), q = await freePort();
  const own = await startServer(envFor(wtHome, p, q), path.join(wt, 'apps', 'dashboard', 'server.mjs'));
  extraServers.push(own);
  await seen('dash', wtHome);
  setPrs('claude-config', [prRow(6, 'MERGED')]);
  const ev = await until(async () => ofType(await events('dash', p), 'pr-merged')[0], 'pr-merged');
  assert.match(ev.pull, /^Not pulled: this is the dashboard's own repo/);
  assert.equal(git(dash, 'rev-parse', 'HEAD'), headBefore, 'HEAD did not move');
  await stop(own);
});

test('one watcher per HOME: one launch from two servers, a takeover after the holder stops, and fencing', async () => {
  const h = path.join(tmp, 'home-two');
  mkdirSync(path.join(h, '.claude'), { recursive: true });
  const api = makeRepo('api25', { pipeline: false });
  setPrs('api25', [prRow(1, 'MERGED'), prRow(2, 'OPEN'), prRow(3, 'OPEN')]);
  const web = makeRepo('web25', { plans: { once: planText(['api25 PR #1 merged']) } });
  register([{ name: 'api25', root: api }, { name: 'web25', root: web }], h);
  const [p1, q1, p2, q2] = [await freePort(), await freePort(), await freePort(), await freePort()];
  const [s1, s2] = await Promise.all([startServer(envFor(h, p1, q1)), startServer(envFor(h, p2, q2))]);
  extraServers.push(s1, s2);
  await until(() => argsOf(web).length, 'the launch');
  await sleep(2500);
  assert.equal(argsOf(web).length, 1);
  assert.equal(ofType(await events('web25', p1), 'auto-launch').length, 1);
  const lock = path.join(h, '.claude', 'pipeline-dashboard', 'watcher.lock');
  const holderPid = JSON.parse(readFileSync(lock, 'utf8')).pid;
  const [holder, waiter] = holderPid === s1.pid ? [s1, s2] : [s2, s1];
  const waiterPort = waiter === s1 ? p1 : p2;
  assert.ok([s1.pid, s2.pid].includes(holderPid));
  assert.match(waiter.out(), /another dashboard runs the watcher/);
  assert.doesNotMatch(holder.out(), /another dashboard runs the watcher/);

  // the holder stops: the other server takes the lock and sees the next merge
  await stop(holder);
  setPrs('api25', [prRow(1, 'MERGED'), prRow(2, 'MERGED'), prRow(3, 'OPEN')]);
  await until(async () => ofType(await events('api25', waiterPort), 'pr-merged').some((e) => e.number === 2), 'pr-merged #2');
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, waiter.pid);

  // fencing: the lock names another live program now, so the server writes nothing
  const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  try {
    await sleep(300);
    const cmd = execFileSync('ps', ['-p', String(helper.pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    // the lock changes hands in the middle of a tick: while gh answers slowly for a waiting plan.
    // The rest of that tick must not write watch.json (the fence before each side effect).
    writeFileSync(path.join(ghData('api25'), 'delay-pr-4'), '1500');
    writeFileSync(path.join(web, '.plans', 'slow-check.md'), planText(['api25 PR #4 merged']));
    const calls = () => { try { return readFileSync(path.join(ghData('api25'), 'calls.log'), 'utf8'); } catch { return ''; } };
    await until(() => /pulls\/4 /.test(calls()), 'the slow check of PR #4');
    writeFileSync(lock, JSON.stringify({ pid: helper.pid, cmd }));
    const webWatch = path.join(stateDir('web25', h), 'watch.json');
    const midTick = statSync(webWatch).mtimeMs;
    await sleep(2500);
    assert.equal(statSync(webWatch).mtimeMs, midTick, 'the tick that lost the lock wrote no watch.json');
    assert.match(waiter.out(), /watcher: lost the lock, tick stopped/);
    await ticks(2);
    const files = ['api25', 'web25'].map((n) => path.join(stateDir(n, h), 'watch.json'));
    const mtimes = files.map((f) => statSync(f).mtimeMs);
    const evCount = (await events('api25', waiterPort)).length;
    setPrs('api25', [prRow(1, 'MERGED'), prRow(2, 'MERGED'), prRow(3, 'MERGED')]);
    await ticks(4);
    assert.deepEqual(files.map((f) => statSync(f).mtimeMs), mtimes, 'no watch.json written');
    assert.equal((await events('api25', waiterPort)).length, evCount, 'no event written');
    assert.equal(argsOf(web).length, 1, 'no launch');
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, helper.pid, 'a live, unchanged holder is not judged stale');
  } finally {
    // also on a failed assertion: a server or helper left running keeps the test run open
    helper.kill();
    await stop(waiter);
  }
});

test('a stale lock is taken: a PID of another program, and an unreadable file older than 10 s', async () => {
  const h = path.join(tmp, 'home-stale');
  mkdirSync(path.join(h, '.claude', 'pipeline-dashboard'), { recursive: true });
  register([], h);
  const lock = path.join(h, '.claude', 'pipeline-dashboard', 'watcher.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  let p = await freePort(), q = await freePort();
  let s = await startServer(envFor(h, p, q));
  extraServers.push(s);
  await until(() => JSON.parse(readFileSync(lock, 'utf8')).pid === s.pid, 'the takeover of a live non-dashboard PID');
  await stop(s);

  writeFileSync(lock, 'not json');
  p = await freePort(); q = await freePort();
  s = await startServer(envFor(h, p, q));
  extraServers.push(s);
  await sleep(2000);
  await ticks(3);
  assert.equal(readFileSync(lock, 'utf8'), 'not json', 'a fresh unreadable lock is held');
  const old = (Date.now() - 20000) / 1000;
  utimesSync(lock, old, old);
  await until(() => { try { return JSON.parse(readFileSync(lock, 'utf8')).pid === s.pid; } catch { return false; } }, 'the takeover of an old unreadable lock');
  await stop(s);
});
