// Smoke tests for apps/dashboard/server.mjs. Every run happens against a throwaway HOME
// and a throwaway repo, so the real registry and the real ~/.claude are never touched.
//
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync, realpathSync, utimesSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameNameIn, writeVersioned } from '../../../scripts/page-versions.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let tmp, home, repo, plansDir, port, qaPort, server, ghDir;

// a stand-in for the gh CLI: answers from files in ghDir and logs every call, so no
// test ever talks to GitHub
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = process.env.FAKE_GH_DIR, a = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), a.join(' ') + '\\n');
const body = path.join(dir, 'body.md');
if (a[0] === 'api' && /^repos\\/\\{owner\\}\\/\\{repo\\}\\/pulls\\?/.test(a[1])) process.stdout.write(fs.existsSync(path.join(dir, 'list.json')) ? fs.readFileSync(path.join(dir, 'list.json')) : '[]');
else if (a[1] === 'view' || (a[0] === 'api' && /^repos\\/\\{owner\\}\\/\\{repo\\}\\/pulls\\/\\d+$/.test(a[1]))) process.stdout.write(JSON.stringify({ body: fs.existsSync(body) ? fs.readFileSync(body, 'utf8') : '',
  baseRefName: 'main', headRefName: 'auto/demo-plan' }));
else if (a[1] === 'edit') fs.writeFileSync(body, fs.readFileSync(0));
else if (a[0] === 'api') process.stdout.write('whole file\\n');
`;

// stands in for `claude -p` in stream-json mode: answers the protocol's first question, then
// each message, writes its own transcript, and asks permission before `git merge`
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const note = (l) => fs.appendFileSync(path.join(process.env.FAKE_GH_DIR, 'claude-calls.log'), l + '\\n');
note(a.join(' '));
const r = a.indexOf('--resume');
const id = r < 0 ? 'ses-probe' : a.includes('--fork-session') ? 'ses-copy' : a[r + 1];
const dir = path.join(process.env.HOME, '.claude', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const log = (o) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, id + '.jsonl'), JSON.stringify(o) + '\\n'); };
let q = '', slow = null, held = null, contextUsed = 150000;
let mode =a.includes('--permission-mode') ? a[a.indexOf('--permission-mode') + 1] : 'default';
const answer = (text) => {
  out({ type: 'stream_event', session_id: id, parent_tool_use_id: null, event: { type: 'message_start' } });
  out({ type: 'stream_event', session_id: id, parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  log({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }],
    usage: { input_tokens: 2, cache_creation_input_tokens: 8, cache_read_input_tokens: 139990, output_tokens: 10000 } } });
  out({ type: 'assistant', session_id: id, parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: false, session_id: id, total_cost_usd: 0.01 });
};
const handle = (j) => {
  if (j.type === 'control_request' && j.request.subtype === 'initialize')
    return out({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id, response: {
      commands: [{ name: 'code-review', description: 'Review the diff', argumentHint: '[level]' }],
      models: [{ value: 'default', displayName: 'Default' }, { value: 'haiku', displayName: 'Haiku' }] } } });
  // like claude, an interrupt ends the turn, and the messages queued in it start the next turn at once
  if (j.type === 'control_request' && j.request.subtype === 'interrupt' && held) {
    const queued = held;
    held = null;
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: id });
    out({ type: 'stream_event', session_id: id, parent_tool_use_id: null, event: { type: 'message_start' } });
    setTimeout(() => answer('answer: ' + queued.join(' + ')), 9500);
  }
  if (j.type === 'control_request') {
    note('control ' + j.request.subtype + ' ' + (j.request.mode || j.request.model || ''));
    if (j.request.subtype === 'set_permission_mode') mode = j.request.mode;
    return out({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id,
      response: j.request.subtype === 'get_context_usage' ? { totalTokens: contextUsed, maxTokens: 200000 } : {} } });
  }
  if (j.type === 'control_response') {
    const res = j.response.response, ok = res.behavior === 'allow';
    note('answer ' + res.behavior + ' ' + JSON.stringify(res.updatedPermissions || null));
    if (j.response.request_id === 'perm-3') { if (ok) mode = 'default'; return answer('answer: ' + q + (ok ? ' (approved)' : '')); }
    log({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: ok ? 'merged' : 'refused', is_error: !ok }] } });
    return answer('answer: ' + q + (ok ? ' (merged)' : ' (not merged)'));
  }
  if (j.type === 'user') {
    const c = j.message.content;
    // like claude, a message that comes during a turn is answered in that turn: one result for both
    if (slow) { slow.push(c[c.length - 1].text); return; }
    if (held) { held.push(c[c.length - 1].text); return; }
    q = c[c.length - 1].text;
    if (/^hold/.test(q)) { held = []; return; }
    if (/^hang/.test(q)) return;   // a turn that never ends, even on an interrupt
    // like claude with a background agent: the turn ends while the task runs, and its end starts a new turn
    if (/^background/.test(q)) {
      out({ type: 'system', subtype: 'task_started', task_id: 'bg-1', tool_use_id: 'tb1', is_backgrounded: true, session_id: id });
      out({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'bg-1', task_type: 'local_agent' }], session_id: id });
      answer('started');
      return setTimeout(() => {
        out({ type: 'system', subtype: 'task_notification', task_id: 'bg-1', tool_use_id: 'tb1', status: 'completed', session_id: id });
        out({ type: 'system', subtype: 'background_tasks_changed', tasks: [], session_id: id });
        answer('finished');
      }, 2500);
    }
    // a new step starts streaming and nothing else happens for a while
    if (/^step/.test(q)) {
      out({ type: 'stream_event', session_id: id, parent_tool_use_id: null, event: { type: 'message_start' } });
      return setTimeout(() => out({ type: 'result', subtype: 'success', is_error: false, session_id: id, total_cost_usd: 0.01 }), 2000);
    }
    out({ type: 'system', subtype: 'init', session_id: id, permissionMode: mode });
    // like claude: every request reports the plan limit
    const resetsAt = Math.floor(Date.now() / 1000) + 86400;
    out({ type: 'rate_limit_event', session_id: id, rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day', utilization: 0.42, resetsAt,
      unifiedWindows: { seven_day: { utilization: 0.42, resetsAt, status: 'allowed' } } } });
    if (q === '/compact') {
      contextUsed = 30000;
      log({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: 150000, postTokens: 8000 } });
      log({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'The summary' } });
      return out({ type: 'result', subtype: 'success', is_error: false, session_id: id, total_cost_usd: 0.01 });
    }
    // like claude after a long tool input: stdout says the text at once, the log has it later
    if (/late/.test(q)) {
      const text = 'answer: ' + q, msg = { id: 'msg-late', role: 'assistant', content: [{ type: 'text', text }] };
      log({ type: 'user', message: { role: 'user', content: c } });
      out({ type: 'stream_event', session_id: id, parent_tool_use_id: null, event: { type: 'message_start' } });
      out({ type: 'stream_event', session_id: id, parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
      out({ type: 'assistant', session_id: id, parent_tool_use_id: null, message: msg });
      setTimeout(() => log({ type: 'assistant', message: msg }), 1500);
      return setTimeout(() => out({ type: 'result', subtype: 'success', is_error: false, session_id: id, total_cost_usd: 0.01 }), 2500);
    }
    if (/slow/.test(q)) {
      slow = [q];
      return setTimeout(() => { const all = slow; slow = null; log({ type: 'user', message: { role: 'user', content: c } }); answer('answer: ' + all.join(' + ')); }, 700);
    }
    if (/plan/.test(q))
      return out({ type: 'control_request', request_id: 'perm-3', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode',
        input: { plan: '# Plan\\n1. edit a.txt' }, permission_suggestions: [] } });
    log({ type: 'user', message: { role: 'user', content: c }, timestamp: new Date().toISOString() });
    if (/edit/.test(q))
      return out({ type: 'control_request', request_id: 'perm-2', request: { subtype: 'can_use_tool', tool_name: 'Edit',
        input: { file_path: process.cwd() + '/a.txt', old_string: 'a', new_string: 'b' }, description: 'a.txt',
        permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] } });
    if (!/merge/.test(q)) return answer('answer: ' + q);
    log({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git merge main' } }] } });
    out({ type: 'control_request', request_id: 'perm-1', request: { subtype: 'can_use_tool', tool_name: 'Bash',
      input: { command: 'git merge main' }, permission_suggestions: [{ type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'git merge main' }], behavior: 'allow', destination: 'localSettings' }] } });
  }
};
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) handle(JSON.parse(l)); }
});
process.stdin.on('end', () => process.exit(0));
`;

const start = async () => {
  const child = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, HOME: home, DASH_PORT: String(port), DASH_NO_OPEN: '1', DASH_NO_SUMMARY: '1',
           QA_REPORTS_PORT: String(qaPort), QA_HOME: '', CLAUDE_TMP: path.join(tmp, 'claude-tmp'),
           PATH: path.join(ghDir, 'bin') + ':' + process.env.PATH, FAKE_GH_DIR: ghDir, SCOUT_NO_NOTIFY: '1',
           // the watcher has its own test (watcher.test.mjs): its gh calls would change the counts here
           DASH_WATCH_MS: '0', DASH_NO_NOTIFY: '1' },
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
  // the real path (/private/var on macOS): the fake claude names its transcript folder after its cwd
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'plans-dash-test-')));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  plansDir = path.join(repo, '.plans');
  ghDir = path.join(tmp, 'gh');
  mkdirSync(path.join(ghDir, 'bin'), { recursive: true });
  writeFileSync(path.join(ghDir, 'bin', 'gh'), FAKE_GH, { mode: 0o755 });
  writeFileSync(path.join(ghDir, 'bin', 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  // written before the server starts: it caches the PR list for a minute
  writeFileSync(path.join(ghDir, 'list.json'), JSON.stringify([
    { number: 7, headRefName: 'auto/demo-plan', headRefOid: 'abc', isDraft: true, state: 'OPEN', title: 'Demo', url: 'https://github.com/o/r/pull/7' },
    { number: 3, headRefName: 'auto/demo-plan', headRefOid: 'old', isDraft: false, state: 'CLOSED', title: 'Older', url: 'https://github.com/o/r/pull/3' },
    { number: 9, headRefName: 'feature/x', headRefOid: 'x', isDraft: false, state: 'OPEN', title: 'By hand', url: 'https://github.com/o/r/pull/9' },
  ]));  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(path.join(plansDir, 'demo-plan.md'), '# Plan: Demo the dashboard\n\nDo the thing.\n');
  writeFileSync(path.join(home, '.claude', 'pipeline-projects.json'), JSON.stringify({
    projects: [{ name: 'demo', client: 'Test', root: repo, plansDir, launchers: [] }],
  }));
  port = await freePort();
  qaPort = await freePort();
  server = await start();
});

after(async () => {
  await stop(server);
  // chats outlive the server on purpose (apps/dashboard/chat-relay.mjs): end the ones this run left
  const chatDir = path.join(home, '.claude', 'pipeline-dashboard', 'chats', String(port));
  for (const f of existsSync(chatDir) ? readdirSync(chatDir) : []) {
    try { execFileSync('pkill', ['-f', JSON.parse(readFileSync(path.join(chatDir, f), 'utf8')).sock]); } catch {}
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('keeps idle connections open longer than the Caddy proxy does, so a proxied POST never gets a 502', async () => {
  const res = await new Promise((resolve, reject) =>
    http.get({ host: '127.0.0.1', port, path: '/api/state', agent: new http.Agent({ keepAlive: true }) }, resolve).on('error', reject));
  res.resume();
  // Caddy keeps an idle upstream connection for 120 s; the server must keep it longer
  const timeout = +(/timeout=(\d+)/.exec(res.headers['keep-alive'] || '') || [])[1];
  assert.ok(timeout > 120, `keep-alive timeout is ${timeout} s`);
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

test('a repo without bootstrap.json shows "needs bootstrap"; a broken one shows the render error', async () => {
  assert.equal((await state())[0].bootstrap, 'missing');
  assert.match((await state())[0].bootstrapPrompt, /^Run \/bootstrap-project in this repository\./);
  const ws = path.join(tmp, 'bootstrap-ws');
  const plain = path.join(ws, 'plain'), broken = path.join(ws, 'broken');
  for (const d of [path.join(plain, '.git'), path.join(broken, '.git'), path.join(broken, '.claude')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(broken, '.claude', 'bootstrap.json'), '{"version": 1}');
  const checks = async () => Object.fromEntries((await (await get('/api/scan?dir=' + encodeURIComponent(ws))).json())
    .candidates.map((c) => [path.basename(c.root), c.checks.find((k) => k.id === 'bootstrap')]));
  // render.mjs --status runs in the background: until it ends, the broken repo has no bootstrap check
  let c = await checks();
  for (let i = 0; i < 50 && !c.broken; i++) { await sleep(100); c = await checks(); }
  assert.equal(c.plain.state, 'missing');
  assert.match(c.plain.fixPrompt, /^Run \/bootstrap-project in this repository\./);
  assert.equal(c.broken.state, 'error');
  assert.match(c.broken.detail, /^render\.mjs --status failed: .*project\.name/);
  assert.match(c.broken.fixPrompt, /--upgrade/);
  rmSync(ws, { recursive: true, force: true });
});

test('the all-projects batch is refused with a fix prompt until every project has a lane checker', async () => {
  const r = await get('/api/lanes-all');
  assert.equal(r.status, 409);
  const d = await r.json();
  assert.deepEqual(d.missing.map((m) => m.name), ['demo']);
  assert.match(d.prompt, /create \.claude\/scripts\/plan-lanes\.mjs/);
  assert.ok(d.prompt.includes(repo), 'the prompt names the repo to fix');
  // the checker it asks for gives the same validation shape as the bootstrap template
  assert.match(d.prompt, /validation: \{ claude, codex, rounds \}/);

  const lanes = path.join(repo, '.claude', 'scripts', 'plan-lanes.mjs');
  mkdirSync(path.dirname(lanes), { recursive: true });
  writeFileSync(lanes, 'console.log(JSON.stringify({ schedulableCount: 1, laneCount: 1, maxParallel: 1,' +
    ' recommendedBatch: [{ slug: "demo-plan" }], lanes: [], inFlight: [] }));\n');
  try {
    const ok = await get('/api/lanes-all');
    assert.equal(ok.status, 200);
    const all = await ok.json();
    assert.equal(all.projects.length, 1);
    assert.equal(all.projects[0].name, 'demo');
    assert.deepEqual(all.projects[0].recommendedBatch.map((p) => p.slug), ['demo-plan']);
  } finally { rmSync(path.join(repo, '.claude', 'scripts'), { recursive: true, force: true }); }
});

test('serves plan markdown and rejects slugs that are not plain names', async () => {
  assert.match(await (await get('/api/plan?project=demo&slug=demo-plan')).text(), /Do the thing/);
  assert.equal((await get('/api/plan?project=demo&slug=../../etc/passwd')).status, 400);
  assert.equal((await get('/api/plan?project=nope&slug=demo-plan')).status, 400);
});

test('an answer still arriving shows as Markdown, with no raw marks', async () => {
  const page = await (await get('/')).text();
  const line = (start) => page.slice(page.indexOf(start), page.indexOf('\n', page.indexOf(start)));
  const render = new Function(line('const BT =') + '\n' + line('const esc =') + '\nconst CUR_ISSUES = "";\n' +
    page.slice(page.indexOf('function inline('), page.indexOf('// --- rendering ---')) + 'return mdLive;')();
  const BT = '`', FENCE = BT.repeat(3);
  for (const [partial, html] of [
    ['## Title\nSome text', '<h2>Title</h2>\n<p>Some text</p>'],
    ['Done\n##', '<p>Done</p>'],
    ['Done\n- ', '<p>Done</p>'],
    ['A **bold wor', '<p>A <b>bold wor</b></p>'],
    ['A **bold wor*', '<p>A <b>bold wor</b></p>'],
    ['A **', '<p>A</p>'],
    ['Run ' + BT + 'npm te', '<p>Run <code>npm te</code></p>'],
    ['Say ' + BT + '**' + BT + ' now', '<p>Say <code>**</code> now</p>'],
    [FENCE + 'js\nconst a = 1', '<pre><code>const a = 1\n</code></pre>'],
    // a mermaid block keeps its code in a .mmd box, where the page draws it
    [FENCE + 'mermaid\nerDiagram\n  a ||--o{ b : has\n' + FENCE, '<div class="mmd"><pre><code>erDiagram\n  a ||--o{ b : has\n</code></pre></div>'],
    ['| a | b |\n|---|-', '<table><tr><th>a</th><th>b</th></tr></table>'],
    ['**done** and ' + BT + 'ok' + BT, '<p><b>done</b> and <code>ok</code></p>'],
  ]) assert.equal(render(partial).trim(), html, partial);
});

// the page's pure functions between two marker lines, run outside the page
const pageBlock = (page, from, to) => {
  const a = page.indexOf(from), b = page.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `the page has ${from} … ${to}`);
  return page.slice(a, b);
};

test('session tabs: open, close, number, step, prune, load and the closed stack', async () => {
  const page = await (await get('/')).text();
  const t = new Function(pageBlock(page, '// --- session tabs ---', '// --- end session tabs ---') +
    'return { tabsOpen, tabsPreview, tabsClose, tabAt, tabStep, tabsPrune, tabsShown, tabsLoad, closedPush, tabsMove };')();
  // a dragged tab goes before or after the tab it is dropped on
  const abcd = ['a', 'b', 'c', 'd'];
  assert.deepEqual(t.tabsMove(abcd, 'd', 'a', false), ['d', 'a', 'b', 'c'], 'tab 4 to the first place');
  assert.deepEqual(t.tabsMove(abcd, 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepEqual(t.tabsMove(abcd, 'a', 'c', false), ['b', 'a', 'c', 'd']);
  assert.deepEqual(t.tabsMove(abcd, 'b', 'd', true), ['a', 'c', 'd', 'b'], 'to the end');
  assert.equal(t.tabsMove(abcd, 'b', 'b', true), abcd, 'onto itself: no change');
  assert.equal(t.tabsMove(abcd, 'x', 'a', false), abcd, 'unknown key: no change');

  const ab = ['a', 'b'];
  // browsing the list reuses one preview tab; a kept tab or an open key changes nothing
  assert.deepEqual(t.tabsPreview(ab, null, 'c'), { tabs: ['a', 'b', 'c'], preview: 'c' });
  assert.deepEqual(t.tabsPreview(['a', 'c', 'b'], 'c', 'd'), { tabs: ['a', 'd', 'b'], preview: 'd' }, 'the next look takes the preview place');
  const same = t.tabsPreview(ab, 'b', 'a');
  assert.equal(same.tabs, ab, 'a key in the list keeps the same list');
  assert.equal(same.preview, 'b');
  assert.deepEqual(t.tabsPreview(ab, 'gone', 'c'), { tabs: ['a', 'b', 'c'], preview: 'c' }, 'a closed preview: the key goes at the end');
  assert.deepEqual(t.tabsOpen(ab, 'c'), ['a', 'b', 'c']);
  assert.equal(t.tabsOpen(ab, 'a'), ab, 'a key in the list keeps the same list');
  assert.deepEqual(t.tabsOpen(['b', 'a'], 'b'), ['b', 'a'], 'no reorder');

  assert.deepEqual(t.tabsClose(['a', 'b', 'c'], 'b'), { tabs: ['a', 'c'], next: 'c' });
  assert.deepEqual(t.tabsClose(['a', 'b', 'c'], 'c'), { tabs: ['a', 'b'], next: 'b' });
  assert.deepEqual(t.tabsClose(['a'], 'a'), { tabs: [], next: null });
  assert.deepEqual(t.tabsClose(ab, 'x'), { tabs: ab, next: null });

  assert.equal(t.tabAt(['a', 'b', 'c'], 2), 'b');
  assert.equal(t.tabAt(['a', 'b', 'c'], 9), 'c');
  assert.equal(t.tabAt(ab, 5), null);
  assert.equal(t.tabAt([], 1), null);
  assert.equal(t.tabAt([], 9), null);

  assert.equal(t.tabStep(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(t.tabStep(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(t.tabStep(['a', 'b', 'c'], 'a', 1), 'b');
  assert.equal(t.tabStep(['a', 'b', 'c'], 'gone', 1), 'a');
  assert.equal(t.tabStep([], 'a', 1), null);

  const known = new Set(['demo/a', 'demo/b']);
  assert.deepEqual(t.tabsPrune(['demo/gone', 'old/x', 'demo/a'], (k) => known.has(k), ['demo']), ['old/x', 'demo/a']);

  const shown = t.tabsShown(['old/x', 'demo/a', 'demo/b'], (k) => known.has(k));
  assert.deepEqual(shown, ['demo/a', 'demo/b']);
  assert.equal(t.tabAt(shown, 1), 'demo/a', 'a hidden key gets no number');
  assert.equal(t.tabsClose(shown, 'demo/a').next, 'demo/b');

  assert.deepEqual(t.closedPush(['a', 'b'], 'a'), ['b', 'a']);
  const many = Array.from({ length: 12 }, (_, i) => 'k' + i).reduce(t.closedPush, []);
  assert.deepEqual(many, Array.from({ length: 10 }, (_, i) => 'k' + (i + 2)), 'the newest 10 keys');

  assert.deepEqual(t.tabsLoad('["a","b","a",3]'), ['a', 'b']);
  for (const bad of ['{"a":1}', 'nope', null]) assert.deepEqual(t.tabsLoad(bad), [], String(bad));
});

test('the palette finds actions and plans, open tabs first, archived last, at most 50 plans', async () => {
  const page = await (await get('/')).text();
  const match = new Function('const projLook = () => ({ short: "" });\n' +
    pageBlock(page, 'const squash =', 'function visiblePlans() {') +
    pageBlock(page, '// --- command palette ---', '// --- end palette match ---') + 'return paletteMatch;')();
  const plan = (slug, more = {}) => ({ key: 'demo/' + slug, file: slug + '.md', title: 'Plan ' + slug, project: 'demo',
    client: 'Example Co', slug, tags: [], archived: false, ...more });
  const plans = [
    plan('20260101-000000-alpha'),
    plan('20260101-000001-beta', { pr: { number: 12, title: 'Fix login', url: 'https://github.com/example/demo/pull/12' } }),
    plan('20250101-000000-old-alpha', { archived: true }),
    plan('20250601-000000-newer-alpha', { archived: true }),
    plan('20260101-000002-gamma'),
    { key: 'demo/wt.side-fix', kind: 'wt', file: 'side-fix', title: 'side branch', project: 'demo', client: 'Example Co',
      slug: 'wt.side-fix', branch: 'claude/quick-patch', tags: [], pr: null },
  ];
  const actions = [{ id: 'board', label: 'Board' }, { id: 'scout', label: 'Scout' }, { id: 'theme', label: 'Theme light/dark' }];
  const keys = (rows) => rows.map((r) => r.kind === 'plan' ? r.key : '!' + r.id);

  assert.deepEqual(keys(match('boa', plans, actions, [])), ['!board']);
  assert.deepEqual(keys(match('gamma', plans, actions, [])), ['demo/20260101-000002-gamma']);
  assert.deepEqual(keys(match('#12', plans, actions, [])), ['demo/20260101-000001-beta']);
  // a typed PR number puts that PR first, before an open tab and before a file name with the same digits
  const nums = [plan('20260101-000012-twelve'), ...plans];
  assert.deepEqual(keys(match('12', nums, actions, ['demo/20260101-000012-twelve'])), ['demo/20260101-000001-beta', 'demo/20260101-000012-twelve']);
  assert.deepEqual(keys(match('pr 12', nums, actions, [])), ['demo/20260101-000001-beta']);
  // a pasted PR link finds exactly that PR: not #120, not the same number in another repo
  const more = [...plans, plan('20260101-000003-delta', { pr: { number: 120, title: 'Other', url: 'https://github.com/example/demo/pull/120' } })];
  assert.deepEqual(keys(match('https://github.com/example/demo/pull/12', more, actions, [])), ['demo/20260101-000001-beta']);
  assert.deepEqual(keys(match('https://github.com/example/demo/pull/12/files#diff-1', more, actions, [])), ['demo/20260101-000001-beta']);
  assert.deepEqual(keys(match('https://github.com/example/other/pull/12', more, actions, [])), []);
  // "demo" is only in the project name: every item matches, not archived first (list order), then archived newest first
  assert.deepEqual(keys(match('demo', plans, actions, [])), ['demo/20260101-000000-alpha', 'demo/20260101-000001-beta',
    'demo/20260101-000002-gamma', 'demo/wt.side-fix', 'demo/20250601-000000-newer-alpha', 'demo/20250101-000000-old-alpha'],
  'a plan matches by its project');
  assert.deepEqual(keys(match('side fix', plans, actions, [])), ['demo/wt.side-fix'], 'a worktree item matches by its file');
  assert.deepEqual(keys(match('quick patch', plans, actions, [])), ['demo/wt.side-fix'], 'a worktree item matches by its branch');
  // open tabs first, then not archived, then archived newest first
  assert.deepEqual(keys(match('alpha', plans, actions, ['demo/20250101-000000-old-alpha'])),
    ['demo/20250101-000000-old-alpha', 'demo/20260101-000000-alpha']
      .concat(['demo/20250601-000000-newer-alpha']));
  assert.deepEqual(keys(match('alpha', plans, actions, [])),
    ['demo/20260101-000000-alpha', 'demo/20250601-000000-newer-alpha', 'demo/20250101-000000-old-alpha']);
  // an empty query: the open tabs in tab order (a stale key is skipped), then every action
  assert.deepEqual(keys(match('', plans, actions, ['demo/20260101-000002-gamma', 'demo/gone', 'demo/20260101-000000-alpha'])),
    ['demo/20260101-000002-gamma', 'demo/20260101-000000-alpha', '!board', '!scout', '!theme']);
  const sixty = Array.from({ length: 60 }, (_, i) => plan('20260201-0000' + String(i).padStart(2, '0') + '-p'));
  const rows = match('', sixty, actions, sixty.map((p) => p.key));
  assert.equal(rows.filter((r) => r.kind === 'plan').length, 50);
  assert.equal(rows.filter((r) => r.kind === 'action').length, actions.length);
  const found = match('p', sixty, [{ id: 'prefs', label: 'Prefs' }], []);
  assert.equal(found.filter((r) => r.kind === 'plan').length, 50, 'the cap counts plan rows only');
  assert.equal(found.filter((r) => r.kind === 'action').length, 1);
});

test('the page has the tab strip, the palette and the window.dashboard hooks', async () => {
  const page = await (await get('/')).text();
  assert.match(page, /<nav id="stabs"[^>]* hidden><\/nav>/);
  assert.match(page, /id="palette"[^>]* hidden/);
  assert.match(page, /#stabs\[hidden\], #palette\[hidden\] \{ display:none; \}/);
  assert.match(page, /body\.review #stabs \{ display:none; \}/);
  const hooks = /window\.dashboard = \{([^}]*)\}/.exec(page);
  assert.ok(hooks, 'window.dashboard = { … }');
  // each hook calls its own function, and each goes through the gate that the keyboard path uses
  const body = hooks[1].replace(/\s+/g, ' ');
  for (const [name, target] of [['switchSession', 'tabHook(switchSession)'], ['nextSession', 'tabHook(nextSession)'],
    ['closeSession', 'tabHook(() => closeSession())'], ['reopenSession', 'tabHook(reopenSession)'], ['openSearch', 'searchHook']])
    assert.ok(body.includes(name + ': ' + target), `${name}: ${target}`);
  // the gates: tab hooks do nothing under an overlay or the open palette; the palette hook only under an overlay
  assert.match(page, /const tabHook = \(f\) => \(\.\.\.a\) => \{ if \(!keysOwned\(\) && !paletteOpen\(\)\) f\(\.\.\.a\); \};/);
  assert.match(page, /const searchHook = \(\) => \{ if \(!keysOwned\(\)\) openSearch\(\); \};/);
  // a tab or palette pick shows the plan in the side list, as an alert does (folded project, hiding search)
  assert.match(page, /function openSession\(key\) \{[^}]*revealInSide\(key\); renderList\(\); renderDetail\(true\); scrollToSelected\(\);/);
});

test('stores status and tags', async () => {
  assert.deepEqual(await post('/api/meta', { project: 'demo', slug: 'demo-plan', status: 'in review', tags: ['api', 'api'] }), { ok: true });
  const p = await onlyPlan();
  assert.equal(p.status, 'in review');
  assert.deepEqual(p.tags, ['api', 'api']);
});

test('the validated count is the number of rounds, with old and new report names', async () => {
  const vdir = path.join(plansDir, '.validations');
  mkdirSync(vdir, { recursive: true });
  const reports = ['demo-plan-validation-claude-1.md', 'demo-plan-validation-codex-1.md', 'demo-plan-validation-round-1.md',
    'demo-plan-validation-2.md', 'demo-plan-codex-raw-2.md', 'demo-plan-round-2.md', 'demo-plan-pre-round-3.md',
    'demo-plan-external-1.md',
    // rounds with one report form each (6, 7, 8), and round 9 with only a decision log
    'demo-plan-validation-claude-6.md', 'demo-plan-validation-codex-7.md', 'demo-plan-validation-8.md', 'demo-plan-validation-round-9.md',
    'demo-plan-validation-codex-raw-5.md'];
  const empties = ['demo-plan-validation-codex-10.md', 'demo-plan-validation-claude-11.md'];
  const secondPlan = path.join(plansDir, 'demo-plan-validation.md');
  const bySlug = async (slug) => (await state())[0].plans.find((p) => p.slug === slug);
  try {
    for (const f of reports.slice(0, -1)) writeFileSync(path.join(vdir, f), '# report\n');
    // empty reports (a Codex run that stopped early, or only blank lines) do not count
    writeFileSync(path.join(vdir, empties[0]), '');
    writeFileSync(path.join(vdir, empties[1]), '\n  \n');
    assert.equal((await bySlug('demo-plan')).validations, 5, 'rounds 1, 2, 6, 7 and 8; logs, snapshot, external and empty reports do not count');
    // one owner per name: -validation-codex-1 stays with demo-plan, -codex-raw-5 belongs to demo-plan-validation
    writeFileSync(secondPlan, '# Plan: Demo validation\n');
    writeFileSync(path.join(vdir, reports.at(-1)), '# report\n');
    assert.equal((await bySlug('demo-plan')).validations, 5);
    assert.equal((await bySlug('demo-plan-validation')).validations, 1);
  } finally {
    for (const f of [...reports, ...empties]) rmSync(path.join(vdir, f), { force: true });
    rmSync(secondPlan, { force: true });
  }
});

test('the docs demo writes validation reports with the new names, one round for split-inventory-reads', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), '..', '..', 'scripts', 'docs-media.mjs'), 'utf8');
  const reports = [...src.matchAll(/'\.plans\/\.validations\/([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(reports, ['checkout-idempotency-keys-validation-claude-1.md',
    'split-inventory-reads-validation-claude-1.md', 'split-inventory-reads-validation-codex-1.md']);
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

test('the log serves a run as chat rows: tools, errors, subagents, plain output, pages', async () => {
  const dir = path.join(home, '.claude', 'pipeline-dashboard', 'logs', 'demo');
  mkdirSync(dir, { recursive: true });
  const cwd = '/work/tree';
  const call = (id, command, parent = null) => JSON.stringify({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const done = (id, content, extra = {}, parent = null) => JSON.stringify({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] } });
  const file = path.join(dir, 'log-demo.log');
  writeFileSync(file, [
    'Packages: +962',
    'Done in 7.1s',
    JSON.stringify({ type: 'system', subtype: 'init', model: 'opus', cwd }),
    JSON.stringify({ type: 'system', subtype: 'task_progress' }),
    JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Running **tests**' }, { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: cwd + '/src/a.ts' } }] } }),
    done('r1', 'line one\nline two'),
    call('b1', 'grep x', null),
    done('b1', 'This command requires approval', { is_error: true }),
    JSON.stringify({ type: 'user', parent_tool_use_id: null, isSynthetic: true, message: { content: [{ type: 'text', text: 'Base directory for this skill: /s/review' }] } }),
    JSON.stringify({ type: 'user', parent_tool_use_id: 'task1', message: { content: [{ type: 'text', text: 'You are reviewing' }] } }),
    JSON.stringify({ type: 'assistant', parent_tool_use_id: 'task1', message: { content: [{ type: 'text', text: 'Subagent words' }] } }),
    call('s1', 'ls', 'task1'),
    done('s1', 'a.ts', {}, 'task1'),
    call('open', 'sleep 60'),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'All done', is_error: false }),
    'no line end yet',
  ].join('\n'));
  const q = 'project=demo&slug=log-demo';
  const r = await (await get('/api/log?' + q)).json();
  const items = r.items;
  assert.deepEqual(items.map((it) => it.k), ['raw', 'note', 'agent', 'tool', 'tool', 'note', 'note', 'tool', 'tool', 'note', 'raw']);
  assert.equal(items[0].text, 'Packages: +962\nDone in 7.1s');
  assert.equal(items[3].sum, 'src/a.ts', 'paths are relative to the run folder');
  assert.equal(items[3].out, 'line one\nline two', 'output keeps its line breaks');
  assert.equal(items[4].err, true);
  assert.match(items[5].text, /^Skill loaded: review/);
  assert.equal(items[6].sub, true);
  assert.equal(items[6].body, 'Subagent words');
  assert.equal(items[7].sub, true);
  assert.equal(items[7].out, 'a.ts');
  assert.equal(items[8].done, false, 'a call without a result is still running');
  assert.equal(items[9].body, 'All done');
  assert.equal(items.at(-1).text, 'no line end yet', 'output without its line end still shows');
  assert.ok(!JSON.stringify(items).includes('You are reviewing'), "a subagent's prompt is left out");

  // pages: the end first, then what comes before it
  const page = await (await get('/api/log?' + q + '&limit=4')).json();
  assert.deepEqual([page.total, page.first, page.items.length], [11, 7, 4]);
  const older = await (await get('/api/log?' + q + '&before=7&limit=4')).json();
  assert.deepEqual([older.first, older.items[0].i], [3, 3]);

  // what the run writes next is read on the next look
  writeFileSync(file, readFileSync(file, 'utf8') + ' and now it has\n');
  assert.equal((await (await get('/api/log?' + q + '&from=10')).json()).items[0].text, 'no line end yet and now it has');
  assert.deepEqual(await (await get('/api/log?project=demo&slug=no-such-run')).json(), { total: 0, first: 0, items: [] });
});

test('a launcher can report its own status, outcome and links via $PLAN_REPORT', async () => {
  const run = async (cmd) => {
    assert.deepEqual(await post('/api/launchers', { project: 'demo', launchers: [{ label: 'reports', cmd }] }), { ok: true });
    assert.deepEqual(await post('/api/launch-generic', { project: 'demo', slug: 'demo-plan', launcher: 0 }), { ok: true });
    const deadline = Date.now() + 20000;
    let p;
    do { await sleep(200); p = await onlyPlan(); } while (Date.now() < deadline && (!p.run || p.live));
    return p.run;
  };
  const pr = await run(`printf '## Status: PR OPEN — 2 DECISIONS WAITING\\n- **Outcome**: needs-you\\n` +
    `- **Link**: Open PR | https://github.com/acme/api/pull/7\\n' > "$PLAN_REPORT"`);
  assert.equal(pr.status, 'PR OPEN — 2 DECISIONS WAITING');
  assert.equal(pr.outcome, 'needs-you');
  assert.deepEqual(pr.links, [{ label: 'Open PR', url: 'https://github.com/acme/api/pull/7' }]);

  // a run that dies after writing "running" is judged by its exit code; a new run
  // also starts without the last run's report
  const died = await run(`echo '- **Outcome**: running' > "$PLAN_REPORT"; exit 4`);
  assert.equal(died.status, 'FAILED: exit 4');
  assert.equal(died.outcome, 'failed');
  assert.deepEqual(died.links, []);

  // no report at all: as before
  const plain = await run('true');
  assert.equal(plain.status, 'FINISHED — review the result');
  assert.equal(plain.outcome, 'needs-you');
  assert.equal((await post('/api/clear-run', { project: 'demo', slug: 'demo-plan' })).ok, true);
});

test("counts only the plan's own sessions, not every session in the repo", async () => {
  // claude writes transcripts to one dir per working directory, shared by every plan
  // in a generic project — the plan's own captured log is what tells them apart
  const transcripts = path.join(home, '.claude', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(path.join(transcripts, 'ses-unrelated.jsonl'), '{}\n');
  writeFileSync(path.join(transcripts, 'ses-mine.jsonl'), '{}\n');

  assert.deepEqual(await post('/api/launchers', {
    project: 'demo',
    launchers: [{ label: 'emits a session id', cmd: `echo '{"type":"system","session_id":"ses-mine"}'` }],
  }), { ok: true });
  assert.deepEqual(await post('/api/launch-generic', { project: 'demo', slug: 'demo-plan', launcher: 0 }), { ok: true });

  const deadline = Date.now() + 20000;
  let p;
  do { await sleep(200); p = await onlyPlan(); } while (Date.now() < deadline && (!p.run || p.live));
  assert.deepEqual(p.sessions.map((x) => x.id), ['ses-mine'], 'the unrelated session is not attributed to this plan');
});

test('the chat follows its session to the VS Code copy once the copy is continued', async () => {
  const q = 'project=demo&slug=demo-plan';
  const transcripts = path.join(home, '.claude', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  const askFile = path.join(home, '.claude', 'pipeline-dashboard', 'state', 'demo', 'ask', 'demo-plan.json');
  const index = path.join(transcripts, '.vscode-copies.json');
  const copy = path.join(transcripts, 'ses-copy.jsonl');
  mkdirSync(path.dirname(askFile), { recursive: true });
  const pinned = { current: { id: 'ses-mine', base: 'ses-mine', copy: false } };
  writeFileSync(askFile, JSON.stringify(pinned));
  writeFileSync(index, JSON.stringify({ 'ses-mine': 'ses-copy' }));
  try {
    // a copy older than the pinned session was not continued: the pin stays
    writeFileSync(copy, '{}\n');
    const old = new Date(Date.now() - 60000);
    utimesSync(copy, old, old);
    assert.equal((await (await get('/api/chat?' + q)).json()).session, 'ses-mine');
    // continued in VS Code: the copy is newer, and the panel and the pin move to it
    utimesSync(copy, new Date(), new Date(Date.now() + 60000));
    const st = await (await get('/api/chat?' + q)).json();
    assert.equal(st.session, 'ses-copy');
    assert.deepEqual(st.current, { id: 'ses-copy', base: 'ses-mine', copy: false });
    assert.equal((await (await get('/api/chat/history?' + q)).json()).session, 'ses-copy');
    assert.equal(JSON.parse(readFileSync(askFile, 'utf8')).current.id, 'ses-copy');
  } finally {
    for (const f of [askFile, index, copy]) rmSync(f, { force: true });
  }
});

test("the chat continues the plan's session live: history, permission prompts, selected lines, fork", async () => {
  const q = 'project=demo&slug=demo-plan', who = { project: 'demo', slug: 'demo-plan' };
  const chat = async () => (await get('/api/chat?' + q)).json();
  const history = async () => (await get('/api/chat/history?' + q)).json();
  const until = async (fn, what) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const v = await fn(); if (v) return v; await sleep(100); }
    assert.fail('timed out waiting for ' + what);
  };
  const calls = () => readFileSync(path.join(ghDir, 'claude-calls.log'), 'utf8').trim().split('\n');
  const spawns = () => calls().filter((l) => l.startsWith('-p ') && l.includes('--resume'));
  const send = (data) => post('/api/chat/send', { ...who, ...data });

  // the / menu and the model picker come from the protocol's first answer; pages asking at
  // the same time share one lookup
  const [meta, meta2] = await Promise.all([1, 2].map(async () => (await get('/api/chat/meta?' + q)).json()));
  assert.deepEqual(meta2, meta);
  assert.equal(calls().filter((l) => l.startsWith('-p ') && !l.includes('--resume')).length, 1, 'one lookup for both pages');
  assert.deepEqual(meta.commands, [{ name: 'code-review', description: 'Review the diff', hint: '[level]' }]);
  assert.deepEqual(meta.models.map((m) => m.value), ['default', 'haiku']);
  assert.equal(meta.contextMax, 200000, 'the window size is known before the first message');
  const ev = await get('/api/chat/events?' + q);
  const reader = ev.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /^event: state\ndata: \{"live":false/);
  await reader.cancel();

  assert.deepEqual(await send({ text: 'why the service?',
    selection: { file: 'src/a.ts', side: 'new', start: 3, end: 4, text: 'x\ny' } }), { ok: true });
  let h = await until(async () => { const r = await history(); return r.items.some((i) => i.k === 'agent') && r; }, 'the answer');
  assert.equal(h.session, 'ses-mine');
  assert.deepEqual(h.items.map((i) => i.k + ':' + i.text), ['you:why the service?', 'agent:answer: why the service?']);
  assert.deepEqual(h.items[0].sel, ['a.ts:3-4']);
  assert.deepEqual(h.items[0].selText, ['x\ny'], 'the chip can show the text that went with the message');
  assert.equal((await chat()).startedAt, h.items[0].at, 'the header shows when the session started');
  assert.match(readFileSync(path.join(home, '.claude', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'), 'ses-mine.jsonl'), 'utf8'),
    /<ide_selection>The user selected the lines 3 to 4 from [^:]*\/src\/a\.ts:\\nx\\ny/);
  assert.equal(spawns().length, 1);
  assert.match(spawns()[0], /--setting-sources user,project,local --permission-prompt-tool stdio --permission-mode default --resume ses-mine$/);

  // the same claude answers the next message, and asks before the merge
  await until(async () => !(await chat()).busy, 'the end of the turn');
  assert.equal((await chat()).live, true, 'the session stays open between messages');
  // the open session reports its own context size
  await until(async () => (await chat()).context?.used === 150000, 'the context size');
  assert.deepEqual((await chat()).context, { used: 150000, max: 200000 });
  // a finished answer stays in the live area until the log has it, and the log's copy comes by itself
  const events = [];
  const stream = (await get('/api/chat/events?' + q)).body.getReader();
  (async () => { for (;;) { const { value, done } = await stream.read(); if (done) return;
    for (const m of new TextDecoder().decode(value).matchAll(/^event: (\w+)\ndata: (.*)$/gm)) events.push([m[1], JSON.parse(m[2]), Date.now()]); } })().catch(() => {});
  assert.deepEqual(await send({ text: 'late answer' }), { ok: true });
  const waiting = await until(async () => { const s = await chat(); return s.landing.length && s; }, 'the finished answer');
  const sentAt = Date.now(), lateItem = (r) => r.items.find((i) => i.text === 'answer: late answer');
  assert.deepEqual([waiting.partial, waiting.landing[0].text], ['', 'answer: late answer']);
  const early = await history();
  assert.ok(!lateItem(early) && early.landed < waiting.landing[0].id, 'not in the log yet');
  assert.ok(events.some(([e, d]) => e === 'delta' && d.reset && d.landing?.[0]?.text === 'answer: late answer'));
  await until(async () => events.some(([e, , at]) => e === 'history' && at - sentAt > 1200), 'a look at the log once it has the answer');
  const landed = await history();
  assert.ok(lateItem(landed) && landed.landed >= waiting.landing[0].id, 'in the log, out of the live area');
  assert.ok((await chat()).busy, 'the log told the page before the turn ended');
  assert.deepEqual((await chat()).landing, []);
  await until(async () => !(await chat()).busy, 'the end of the turn');
  await stream.cancel();
  assert.deepEqual(await send({ text: 'merge main please', mode: 'acceptEdits' }), { ok: true });
  let st = await until(async () => { const s = await chat(); return s.waits.length && s; }, 'the permission card');
  assert.deepEqual(st.waits.map((w) => [w.tool, w.what, w.always]), [['Bash', 'git merge main', true]]);
  assert.equal((await onlyPlan()).chatWaits, 1);
  assert.deepEqual(await post('/api/chat/answer', { ...who, id: st.waits[0].id, allow: true, always: true }), { ok: true });
  h = await until(async () => { const r = await history(); return r.items.some((i) => i.text === 'answer: merge main please (merged)') && r; }, 'the merge');
  assert.deepEqual(h.items.filter((i) => i.k === 'tool').map((i) => [i.name, i.sum, i.done, i.out]), [['Bash', 'git merge main', true, 'merged']]);
  assert.equal(spawns().length, 1, 'one claude for the whole chat');
  assert.ok(calls().includes('control set_permission_mode acceptEdits'));
  // "for this chat" keeps the rule in the session, never in the repo's settings
  assert.ok(calls().some((l) => l.startsWith('answer allow') && l.includes('"destination":"session"')));
  assert.equal((await post('/api/chat/answer', { ...who, id: 'perm-1', allow: true })).ok, false);

  // an edit can be allowed for the whole chat: the session switches to acceptEdits
  await until(async () => !(await chat()).busy, 'the end of the turn');
  assert.deepEqual(await send({ text: 'edit a.txt', mode: 'default' }), { ok: true });
  st = await until(async () => { const s = await chat(); return s.waits.length && s; }, 'the edit card');
  assert.deepEqual(st.waits.map((w) => [w.tool, w.edits, w.always]), [['Edit', true, false]]);
  assert.deepEqual(await post('/api/chat/answer', { ...who, id: st.waits[0].id, allow: true, edits: true }), { ok: true });
  assert.equal((await chat()).mode, 'acceptEdits');
  await until(async () => calls().some((l) => l === 'answer allow [{"type":"setMode","mode":"acceptEdits","destination":"session"}]'), 'the setMode answer');
  await until(async () => !(await chat()).busy, 'the end of the turn');

  // a message sent while the agent works can share its turn and its one result; the chat
  // must still end up idle
  assert.deepEqual(await send({ text: 'slow one', mode: 'acceptEdits' }), { ok: true });
  assert.deepEqual(await send({ text: 'and two', mode: 'acceptEdits' }), { ok: true });
  await until(async () => (await history()).items.some((i) => i.text === 'answer: slow one + and two'), 'the shared answer');
  await until(async () => !(await chat()).busy, 'idle after one result for two messages');
  assert.equal((await onlyPlan()).chatting, false);

  // an approved plan ends Plan mode; picking Plan mode again is sent again
  assert.deepEqual(await send({ text: 'plan it', mode: 'plan' }), { ok: true });
  st = await until(async () => { const s = await chat(); return s.waits.length && s; }, 'the plan card');
  assert.deepEqual(st.waits.map((w) => [w.plan, w.detail]), [[true, '# Plan\n1. edit a.txt']]);
  assert.deepEqual(await post('/api/chat/answer', { ...who, id: st.waits[0].id, allow: true }), { ok: true });
  await until(async () => !(await chat()).busy, 'the end of the turn');
  assert.equal((await chat()).mode, 'default');
  const sets = () => calls().filter((l) => l === 'control set_permission_mode plan').length;
  const before = sets();
  assert.deepEqual(await post('/api/chat/mode', { ...who, mode: 'plan', model: 'default' }), { ok: true });
  await until(async () => sets() === before + 1, 'Plan mode sent again');
  // the next turn reports the mode claude is in, and the page follows it
  assert.deepEqual(await send({ text: 'what now?', mode: 'plan' }), { ok: true });
  await until(async () => !(await chat()).busy && (await history()).items.some((i) => i.text === 'answer: what now?'), 'the answer');
  assert.equal((await chat()).mode, 'plan');

  // Closed, the size comes from the transcript's last answer; a compact makes that out of date,
  // so the size claude reported after the compact is what stays
  await until(async () => !(await chat()).busy, 'the end of the turn');
  await post('/api/chat/fork', who);
  await post('/api/chat/new', who);
  assert.deepEqual((await chat()).context, { used: 150000, max: 200000 });
  assert.deepEqual(await send({ text: '/compact' }), { ok: true });
  await until(async () => (await chat()).context?.used === 30000, 'the size after the compact');
  await post('/api/chat/new', who);
  st = await chat();
  assert.deepEqual([st.live, st.context], [false, { used: 30000, max: 200000 }]);
  assert.ok((await history()).items.some((i) => i.text === 'The earlier conversation was compacted'));

  // Fork: the next message goes on in a copy, which is not one of the plan's sessions
  await until(async () => !(await chat()).busy, 'the end of the turn');
  assert.deepEqual(await post('/api/chat/fork', who), { ok: true });
  assert.equal((await chat()).live, false);
  assert.deepEqual(await send({ text: 'and in a copy?' }), { ok: true });
  h = await until(async () => { const r = await history(); return r.session === 'ses-copy' && r.items.some((i) => i.text === 'answer: and in a copy?') && r; }, 'the copy');
  assert.match(spawns().at(-1), /--resume ses-mine --fork-session$/);
  st = await chat();
  assert.deepEqual([st.current, st.fork], [{ id: 'ses-copy', base: 'ses-mine', copy: true }, false]);
  assert.deepEqual((await onlyPlan()).sessions.map((s) => s.id), ['ses-mine']);

  // New chat: back to the run's latest session
  await until(async () => !(await chat()).busy, 'the end of the turn');
  assert.deepEqual(await post('/api/chat/new', who), { ok: true });
  st = await chat();
  assert.deepEqual([st.live, st.session], [false, 'ses-mine']);
  assert.equal((await onlyPlan()).asked, true);
  assert.equal((await send({ text: '  ' })).ok, false);
});

test('Stop ends the running turn only: the turn its queued messages start stays alive', async () => {
  const q = 'project=demo&slug=demo-plan', who = { project: 'demo', slug: 'demo-plan' };
  const chat = async () => (await get('/api/chat?' + q)).json();
  const history = async () => (await get('/api/chat/history?' + q)).json();
  const until = async (fn, what) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { const v = await fn(); if (v) return v; await sleep(100); }
    assert.fail('timed out waiting for ' + what);
  };

  assert.deepEqual(await post('/api/chat/send', { ...who, text: 'hold this turn' }), { ok: true });
  assert.deepEqual(await post('/api/chat/send', { ...who, text: 'queued note' }), { ok: true });
  assert.deepEqual(await post('/api/chat/stop', who), { ok: true });
  await sleep(8500);   // past the wait for a turn that does not end on the interrupt
  const st = await chat();
  assert.deepEqual([st.live, st.busy, st.error], [true, true, ''], 'the new turn is still working');
  await until(async () => (await history()).items.some((i) => i.text === 'answer: queued note'), 'the answer to the queued message');
  await until(async () => !(await chat()).busy, 'the end of the turn');

  // a turn that ignores the interrupt still ends with the process
  assert.deepEqual(await post('/api/chat/send', { ...who, text: 'hang here' }), { ok: true });
  assert.deepEqual(await post('/api/chat/stop', who), { ok: true });
  await until(async () => !(await chat()).live, 'the process to be closed');
  assert.deepEqual(await post('/api/chat/new', who), { ok: true });
});

test('a chat with a background task still running counts as working, not as your turn', async () => {
  const q = 'project=demo&slug=demo-plan', who = { project: 'demo', slug: 'demo-plan' };
  const chat = async () => (await get('/api/chat?' + q)).json();
  const until = async (fn, what) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { const v = await fn(); if (v) return v; await sleep(100); }
    assert.fail('timed out waiting for ' + what);
  };
  assert.deepEqual(await post('/api/chat/send', { ...who, text: 'background check' }), { ok: true });
  const mid = await until(async () => { const st = await chat(); return !st.busy && st.bg === 1 && st; }, 'the end of the first turn');
  assert.equal(mid.bg, 1, 'the turn ended, the background task runs');
  assert.equal((await onlyPlan()).chatting, true, 'the plan shows working while the task runs');
  await until(async () => { const st = await chat(); return !st.busy && st.bg === 0; }, 'the end of the background task');
  assert.equal((await onlyPlan()).chatting, false, 'done: the plan is idle again');
  assert.deepEqual(await post('/api/chat/new', who), { ok: true });
});

test('the header usage shows the Claude limit from a chat and the Codex limit from its newest session file', async () => {
  const who = { project: 'demo', slug: 'demo-plan' };
  const day = path.join(home, '.codex', 'sessions', '2026', '11', '20');
  mkdirSync(day, { recursive: true });
  const resets = Math.floor(Date.now() / 1000) + 3600;
  const tc = (primary, limitId = 'codex') => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    limit_id: limitId, primary, secondary: { used_percent: 9, window_minutes: 10080, resets_at: resets }, plan_type: 'prolite' } } });
  writeFileSync(path.join(day, 'rollout-a.jsonl'), [
    tc({ used_percent: 10, window_minutes: 300, resets_at: resets }),
    tc({ used_percent: 31.6, window_minutes: 300, resets_at: resets }),
    tc({ used_percent: 99, window_minutes: 300, resets_at: resets }, 'other-model'),   // another limit: skipped
    '{"type":"event_msg","payload":{"type":"agent_message"}}',
  ].join('\n') + '\n');
  try {
    let u = await (await get('/api/usage')).json();
    assert.deepEqual(u.codex.windows.map((w) => [w.name, w.pct]), [['five_hour', 32], ['seven_day', 9]]);
    assert.equal(u.codex.plan, 'prolite');

    assert.deepEqual(await post('/api/chat/send', { ...who, text: 'usage check' }), { ok: true });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !(u = await (await get('/api/usage')).json()).claude.windows.length) await sleep(100);
    assert.deepEqual(u.claude.windows.map((w) => [w.name, w.pct]), [['seven_day', 42]]);
    assert.ok(u.claude.windows[0].resetsAt > Date.now());
  } finally {
    rmSync(path.join(home, '.codex'), { recursive: true, force: true });
    // let the turn end before the next test, like the other chat tests
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && (await (await get('/api/chat?project=demo&slug=demo-plan')).json()).busy) await sleep(100);
    await sleep(1500);
    await post('/api/chat/new', who);
  }
});

test('a chat outlives a server restart: the new server shows its question and the same claude answers', async () => {
  const q = 'project=demo&slug=demo-plan', who = { project: 'demo', slug: 'demo-plan' };
  const chat = async () => (await get('/api/chat?' + q)).json();
  const history = async () => (await get('/api/chat/history?' + q)).json();
  const until = async (fn, what) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const v = await fn(); if (v) return v; await sleep(100); }
    assert.fail('timed out waiting for ' + what);
  };
  const spawns = () => readFileSync(path.join(ghDir, 'claude-calls.log'), 'utf8').trim().split('\n')
    .filter((l) => l.startsWith('-p ') && l.includes('--resume')).length;

  assert.deepEqual(await post('/api/chat/send', { ...who, text: 'merge main after the restart' }), { ok: true });
  await until(async () => (await chat()).waits.length, 'the permission card');
  const before = spawns();

  // launchctl kickstart -k ends the server at once, as SIGKILL does here
  await stop(server);
  server = await start();
  const st = await until(async () => { const s = await chat(); return s.waits.length && s; }, 'the question after the restart');
  assert.deepEqual([st.live, st.busy, st.waits.map((w) => w.what)], [true, true, ['git merge main']]);
  assert.equal((await onlyPlan()).chatWaits, 1);

  assert.deepEqual(await post('/api/chat/answer', { ...who, id: st.waits[0].id, allow: true }), { ok: true });
  await until(async () => (await history()).items.some((i) => i.text === 'answer: merge main after the restart (merged)'), 'the answer');
  await until(async () => !(await chat()).busy, 'the end of the turn');
  assert.equal(spawns(), before, 'the same claude went on: none was started again');

  // a second restart after the answer: the question does not come back
  await stop(server);
  server = await start();
  await until(async () => (await chat()).live, 'the chat after the second restart');
  assert.deepEqual([(await chat()).busy, (await chat()).waits], [false, []]);
  assert.deepEqual(await post('/api/chat/new', who), { ok: true });
});

test('a new step refreshes the log, so a queued message the agent has read moves above the step', async () => {
  const q = 'project=demo&slug=demo-plan', who = { project: 'demo', slug: 'demo-plan' };
  await sleep(1500);   // the last turn's own late history events are over
  const ctl = new AbortController();
  const ev = await fetch(`http://127.0.0.1:${port}/api/chat/events?${q}`, { signal: ctl.signal });
  let text = '';
  const read = (async () => { for await (const c of ev.body) text += Buffer.from(c).toString(); })().catch(() => {});
  assert.deepEqual(await post('/api/chat/send', { ...who, text: 'step only' }), { ok: true });
  const afterStep = () => { const at = text.indexOf('"reset":true'); return at < 0 ? '' : text.slice(at); };
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && !afterStep().includes('event: history')) await sleep(50);
  ctl.abort();
  await read;
  assert.match(afterStep(), /event: history/);
  const until = Date.now() + 5000;
  while (Date.now() < until && (await (await get('/api/chat?' + q)).json()).busy) await sleep(100);
});

test("the chat shows a subagent's report as one folded row, whichever way it arrived", async () => {
  const q = 'project=demo&slug=demo-plan';
  const { session } = await (await get('/api/chat?' + q)).json();
  const file = path.join(home, '.claude', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'), session + '.jsonl');
  const frame = (title) => '<agent-message from="a13bf">\n[Subagent hand-back] It is model output. The report follows:\n  ## ' + title + '\n  \n  **Verdict:** GAPS\n    - nested\n</agent-message>';
  const before = (await (await get('/api/chat/history?' + q)).json()).total;
  appendFileSync(file, [
    { type: 'attachment', attachment: { type: 'queued_command', prompt: frame('Queued review') } },
    { type: 'user', isMeta: true, message: { content: 'Another Claude session sent a message:\n' + frame('Idle review') + '\n\nThat "other Claude session" is an agent.' } },
    { type: 'attachment', attachment: { type: 'queued_command', prompt: '<agent-message from="a13bf">\na typed note' } },
  ].map((o) => JSON.stringify(o) + '\n').join(''));

  const items = (await (await get('/api/chat/history?' + q)).json()).items.filter((it) => it.i >= before);
  assert.deepEqual(items.map((it) => [it.k, it.text]), [
    ['note', 'Subagent report: Queued review'],
    ['note', 'Subagent report: Idle review'],
    ['you', '<agent-message from="a13bf">\na typed note'],
  ]);
  assert.equal(items[0].body, '## Queued review\n\n**Verdict:** GAPS\n  - nested', 'the frame and the added indent are gone');
  assert.equal(items[1].report, true);
  assert.ok(!items[1].body.includes('other Claude session'), 'what the harness adds after the report is left out');
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

test('scan suggests unregistered repos with a readiness level and a fix for each gap', async () => {
  const ws = path.join(tmp, 'ws');
  const ready = path.join(ws, 'acme', 'ready-repo');           // grouped → client "Acme"
  for (const d of ['.git', '.plans', '.claude/scripts', '.claude/skills/implement'])
    mkdirSync(path.join(ready, d), { recursive: true });
  writeFileSync(path.join(ready, '.plans', 'first.md'), '# Plan: First\n');
  writeFileSync(path.join(ready, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
  writeFileSync(path.join(ready, '.claude', 'scripts', 'run-skill.sh'), '#!/usr/bin/env bash\n');
  writeFileSync(path.join(ready, '.claude', 'skills', 'implement', 'SKILL.md'), '---\nname: implement\n---\n');
  writeFileSync(path.join(ready, 'CLAUDE.md'), '# Rules\n');
  const bare = path.join(ws, 'bare-repo');
  mkdirSync(path.join(bare, '.git'), { recursive: true });
  mkdirSync(path.join(bare, 'node_modules', 'dep', '.git'), { recursive: true }); // never descended into

  const scan = await (await get('/api/scan?dir=' + encodeURIComponent(ws))).json();
  const byName = Object.fromEntries(scan.candidates.map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(byName).sort(), ['bare-repo', 'ready-repo']);
  // ready to launch; the one tip left is that it was set up by hand, not with /bootstrap-project
  assert.equal(byName['ready-repo'].level, 'amber');
  assert.deepEqual(byName['ready-repo'].checks.filter((c) => !c.ok).map((c) => c.id), ['bootstrap']);
  assert.equal(byName['ready-repo'].client, 'Acme');
  const b = byName['bare-repo'];
  assert.equal(b.level, 'red');
  const failing = b.checks.filter((c) => !c.ok).map((c) => c.id).sort();
  assert.deepEqual(failing, ['allow', 'bootstrap', 'claudemd', 'launch', 'plans', 'plansDir', 'skills']);
  assert.ok(b.checks.filter((c) => !c.ok).every((c) => c.fixPrompt || c.fixCmd), 'every gap has a fix');
  assert.match(b.fixAll, /^Get this repository ready/);

  // the already-registered fixture repo is not suggested again
  const again = await (await get('/api/scan?dir=' + encodeURIComponent(tmp))).json();
  assert.ok(!again.candidates.some((c) => c.root === repo));
  assert.equal((await get('/api/scan?dir=' + encodeURIComponent(path.join(tmp, 'nope')))).status, 400);
});

test('adding a project keeps existing entries and registers the wrapper launcher', async () => {
  const ready = path.join(tmp, 'ws', 'acme', 'ready-repo');
  const r = await post('/api/add-project', { root: ready, name: 'ready-repo', client: 'Acme', plansDir: path.join(ready, '.plans') });
  assert.equal(r.ok, true);
  assert.equal((await post('/api/add-project', { root: ready, name: 'other' })).ok, false, 'same root twice');
  assert.equal((await post('/api/add-project', { root: path.join(tmp, 'ws', 'bare-repo'), name: 'demo' })).ok, false, 'name taken');

  const reg = JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-projects.json'), 'utf8')).projects;
  assert.deepEqual(reg.map((e) => e.name), ['demo', 'ready-repo']);
  assert.deepEqual(reg[1].launchers, [{ label: 'Implement', cmd: 'bash .claude/scripts/run-skill.sh implement {plan}' }]);

  const s = await state();
  assert.equal(s.find((p) => p.name === 'ready-repo').setupLevel, 'amber');  // only the bootstrap tip
  assert.equal(s.find((p) => p.name === 'ready-repo').bootstrap, 'missing');
  assert.equal(s.find((p) => p.name === 'demo').setupLevel, 'red');  // fixture has no .git, no launcher
});

// fetch() forbids setting Host, so raw http.request plays the hostile browser here
const raw = (method, p, headers, data) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
    res.resume(); res.on('end', () => resolve(res.statusCode));
  });
  r.on('error', reject);
  r.end(data);
});

test('refuses requests from other websites and from unknown host names', async () => {
  const self = `127.0.0.1:${port}`;
  const launchers = JSON.stringify({ project: 'demo', launchers: [{ label: 'x', cmd: 'touch pwned' }] });
  const registry = async () => (await get('/api/registry')).text();
  const before = await registry();
  // a page on another site POSTing a launcher (text/plain → no CORS preflight)
  assert.equal(await raw('POST', '/api/launchers', { Host: self, Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, launchers), 403);
  assert.equal(await raw('POST', '/api/launchers', { Host: self, Origin: 'null' }, launchers), 403);
  assert.equal(await raw('GET', '/api/state', { Host: self, 'Sec-Fetch-Site': 'cross-site' }), 403);
  // DNS rebinding: a public name resolving to 127.0.0.1
  assert.equal(await raw('GET', '/api/state', { Host: `evil.example:${port}` }), 403);
  assert.equal(await registry(), before, 'nothing was saved');

  // the dashboard's own page, under every local name it is served on
  assert.equal(await raw('GET', '/api/state', { Host: self, 'Sec-Fetch-Site': 'same-origin' }), 200);
  assert.equal(await raw('GET', '/api/state', { Host: `localhost:${port}` }), 200);
  assert.equal(await raw('GET', '/', { Host: `plans.localhost:${port}`, 'Sec-Fetch-Site': 'none' }), 200);
  assert.equal(await raw('POST', '/api/meta', { Host: self, Origin: `http://${self}`, 'Content-Type': 'application/json' },
    JSON.stringify({ project: 'demo', slug: 'demo-plan', status: 'todo', tags: [] })), 200);
});

test('a pipeline launch shows as starting, then as failed with the launcher output', async () => {
  const pipe = path.join(tmp, 'pipe-repo');
  mkdirSync(path.join(pipe, '.plans'), { recursive: true });
  mkdirSync(path.join(pipe, '.claude', 'scripts'), { recursive: true });
  writeFileSync(path.join(pipe, '.plans', 'pipe-plan.md'), '# Plan: Pipe\n');
  // stands in for the repo's auto-pipeline.sh stopping during its own setup
  writeFileSync(path.join(pipe, '.claude', 'scripts', 'auto-pipeline.sh'),
    'sleep 1\necho "FATAL: pnpm is not runnable"\nexit 1\n');
  const reg = JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-projects.json'), 'utf8')).projects;
  assert.equal((await post('/api/registry', { projects: [...reg, { name: 'pipe', root: pipe, launchers: [] }] })).ok, true);
  const pipePlan = async () => (await state()).find((p) => p.name === 'pipe').plans[0];

  assert.deepEqual(await post('/api/launch', { project: 'pipe', items: [{ slug: 'pipe-plan', mode: 'verify' }] }), { ok: true });
  assert.equal((await pipePlan()).launch.state, 'starting', 'shown before the launcher has done anything');

  const deadline = Date.now() + 10000;
  let p;
  do { await sleep(200); p = await pipePlan(); } while (Date.now() < deadline && p.launch.state === 'starting');
  assert.equal(p.launch.state, 'failed');
  assert.match(p.launch.output, /FATAL: pnpm is not runnable/);
});

// a pipeline repo whose auto-pipeline.sh only records the arguments it was given;
// `describe` is the JSON its --describe case prints, or null for a script without one
const pipeRepo = async (name, describe, plans) => {
  const root = path.join(tmp, name);
  mkdirSync(path.join(root, '.plans', 'auto-runs'), { recursive: true });
  mkdirSync(path.join(root, '.claude', 'scripts'), { recursive: true });
  for (const slug of plans) writeFileSync(path.join(root, '.plans', slug + '.md'), '# Plan: ' + slug + '\n');
  writeFileSync(path.join(root, '.claude', 'scripts', 'auto-pipeline.sh'),
    (describe ? `case "$1" in\n  --describe) echo '${JSON.stringify(describe)}'; exit 0 ;;\nesac\n` : '') +
    'echo "$*" >> "$(dirname "$0")/args.log"\n');
  const reg = JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-projects.json'), 'utf8')).projects;
  assert.equal((await post('/api/registry', { projects: [...reg, { name, root, launchers: [] }] })).ok, true);
  return root;
};
const report = (root, slug, lines) =>
  writeFileSync(path.join(root, '.plans', 'auto-runs', slug + '.md'), '# Auto-run: ' + slug + '\n\n' + lines.join('\n') + '\n');

test('a plan the launcher skips shows as failed with the reason, though the launcher exits 0', async () => {
  const root = await pipeRepo('skip-pipe', null, ['skip-me', 'skip-me-too']);
  // older output with multi-byte characters must not push the new output out of the slice
  writeFileSync(path.join(root, '.plans', 'auto-runs', '_dashboard.log'), 'old — line\n'.repeat(200));
  const reason = 'SKIP: plan not on origin/develop: .plans/skip-me-too.md — push it first';
  writeFileSync(path.join(root, '.claude', 'scripts', 'auto-pipeline.sh'), `echo "${reason}"\nexit 0\n`);
  const plans = async () => (await state()).find((p) => p.name === 'skip-pipe').plans;

  assert.deepEqual(await post('/api/launch', { project: 'skip-pipe',
    items: [{ slug: 'skip-me', mode: 'verify' }, { slug: 'skip-me-too', mode: 'verify' }] }), { ok: true });
  const deadline = Date.now() + 10000;
  let ps;
  do { await sleep(100); ps = await plans(); } while (Date.now() < deadline && ps.some((p) => p.launch?.state === 'starting'));

  const skipped = ps.find((p) => p.slug === 'skip-me-too');
  assert.equal(skipped.launch.state, 'failed');
  assert.equal(skipped.launch.output, reason);
  assert.equal(ps.find((p) => p.slug === 'skip-me').launch, null, 'the other plan in the batch was not skipped');
});
// waits until the script has recorded `n` calls
const argsLog = async (root, n) => {
  const f = path.join(root, '.claude', 'scripts', 'args.log');
  const deadline = Date.now() + 10000;
  let lines = [];
  while (Date.now() < deadline) {
    lines = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [];
    if (lines.length >= n) return lines;
    await sleep(100);
  }
  return lines;
};
const projState = async (name) => (await state()).find((p) => p.name === name);
const PR_MODES = { modes: [
  { id: 'verify', flag: '--stop-at-verify', label: 'stop at verify' },
  { id: 'commit', flag: '--full', label: 'full' },
  { id: 'pr', flag: '--to-pr', label: 'to PR — draft PR with a decision sheet' },
] };

test('a script without --describe gets the two default modes; one with it lists its own', async () => {
  const plain = await pipeRepo('plain-pipe', null, ['one']);
  const pr = await pipeRepo('pr-pipe', PR_MODES, ['one']);
  assert.deepEqual((await projState('plain-pipe')).modes.map((m) => m.id), ['verify', 'commit']);
  assert.deepEqual((await projState('pr-pipe')).modes.map((m) => m.id), ['verify', 'commit', 'pr']);
  assert.equal((await projState('pr-pipe')).modes[2].label, 'to PR — draft PR with a decision sheet');
  assert.ok(!(await projState('pr-pipe')).modes[0].flag, 'flags stay on the server');
  // --describe was never passed to the script that has no case for it
  assert.ok(!existsSync(path.join(plain, '.claude', 'scripts', 'args.log')));
  assert.ok(!existsSync(path.join(pr, '.claude', 'scripts', 'args.log')));
});

test('launch passes the flag of the picked mode, and the default flags still work', async () => {
  const pr = path.join(tmp, 'pr-pipe');
  assert.deepEqual(await post('/api/launch', { project: 'pr-pipe', items: [{ slug: 'one', mode: 'pr' }] }), { ok: true });
  assert.deepEqual(await argsLog(pr, 1), ['--to-pr one.md']);

  const plain = path.join(tmp, 'plain-pipe');
  assert.deepEqual(await post('/api/launch', { project: 'plain-pipe', items: [{ slug: 'one', mode: 'commit' }] }), { ok: true });
  assert.deepEqual(await post('/api/launch', { project: 'plain-pipe', items: [{ slug: 'one', mode: 'pr' }] }), { ok: true });
  // 'pr' is not a mode of this script: it falls back to the first mode
  assert.deepEqual((await argsLog(plain, 2)).sort(), ['--full one.md', '--stop-at-verify one.md']);
});

test('classifies runs by the Outcome line, else by the status words, and reads Mode and Link', async () => {
  const root = await pipeRepo('outcome-pipe', PR_MODES, ['pr-open', 'pr-verified', 'old-verified', 'old-blocked', 'old-running']);
  report(root, 'pr-open', ['- **Mode**: pr (to PR)', '## Status: PR OPEN — 3 DECISIONS WAITING', '- **Outcome**: needs-you',
    '- **Link**: Open PR | https://github.com/acme/api/pull/42', '- **Link**: no url here']);
  report(root, 'pr-verified', ['- **Mode**: pr (to PR)', '## Status: VERIFIED', '- **Outcome**: running']);
  report(root, 'old-verified', ['- **Mode**: verify (stop at verify)', '## Status: VERIFIED']);
  report(root, 'old-blocked', ['## Status: BLOCKED: tests fail']);
  report(root, 'old-running', ['## Status: IMPLEMENTED']);
  const runs = Object.fromEntries((await projState('outcome-pipe')).plans.map((p) => [p.slug, p.run]));

  assert.equal(runs['pr-open'].outcome, 'needs-you');
  assert.equal(runs['pr-open'].status, 'PR OPEN — 3 DECISIONS WAITING');
  assert.equal(runs['pr-open'].mode, 'pr');
  assert.deepEqual(runs['pr-open'].links, [{ label: 'Open PR', url: 'https://github.com/acme/api/pull/42' }]);
  assert.equal(runs['pr-verified'].outcome, 'running', 'VERIFIED is not the end of a pr run');
  assert.equal(runs['old-verified'].outcome, 'needs-you');
  assert.equal(runs['old-verified'].mode, 'verify');
  assert.equal(runs['old-blocked'].outcome, 'failed');
  assert.equal(runs['old-blocked'].mode, null);
  assert.deepEqual(runs['old-blocked'].links, []);
  assert.equal(runs['old-running'].outcome, 'running');
});

test('resume continues in the mode the run was launched with', async () => {
  const root = await pipeRepo('resume-pipe', PR_MODES, ['pr-run', 'commit-run', 'no-mode']);
  report(root, 'pr-run', ['- **Mode**: pr (to PR)', '## Status: BLOCKED: gate failed', '- **Outcome**: failed']);
  report(root, 'commit-run', ['- **Mode**: commit (full)', '## Status: FAILED: test']);
  report(root, 'no-mode', ['## Status: BLOCKED: x']);

  await post('/api/resume', { project: 'resume-pipe', slug: 'pr-run' });
  assert.deepEqual(await argsLog(root, 1), ['--resume pr-run --to-pr']);
  await post('/api/resume', { project: 'resume-pipe', slug: 'commit-run' });
  assert.deepEqual((await argsLog(root, 2))[1], '--resume commit-run --full');
  // a mode the user picked wins over the report
  await post('/api/resume', { project: 'resume-pipe', slug: 'pr-run', mode: 'verify' });
  assert.deepEqual((await argsLog(root, 3))[2], '--resume pr-run --stop-at-verify');
  // no Mode line and no pick: the first mode, as before
  await post('/api/resume', { project: 'resume-pipe', slug: 'no-mode' });
  assert.deepEqual((await argsLog(root, 4))[3], '--resume no-mode --stop-at-verify');
});

test('the guide suggests --describe for a pipeline script that lacks it', async () => {
  const check = async (name) => {
    const scan = await (await get('/api/scan?dir=' + encodeURIComponent(tmp))).json();
    return (scan.candidates.find((c) => c.name === name) || { checks: [] }).checks.find((c) => c.id === 'modes');
  };
  for (const [name, script] of [['tip-old', 'echo hi\n'], ['tip-new', 'case "$1" in\n  --describe) echo {} ;;\nesac\n']]) {
    mkdirSync(path.join(tmp, name, '.git'), { recursive: true });
    mkdirSync(path.join(tmp, name, '.plans'), { recursive: true });
    mkdirSync(path.join(tmp, name, '.claude', 'scripts'), { recursive: true });
    writeFileSync(path.join(tmp, name, '.claude', 'scripts', 'auto-pipeline.sh'), script);
  }
  const old = await check('tip-old');
  assert.equal(old.ok, false);
  assert.equal(old.required, false, 'a tip, not a blocker');
  assert.match(old.fixPrompt, /--describe/);
  assert.equal((await check('tip-new')).ok, true);
  assert.equal(await check('bare-repo'), undefined, 'generic projects get no such check');
});

test('the project default mode comes from --describe and is used when no mode is sent', async () => {
  const root = await pipeRepo('default-pipe', { ...PR_MODES, default: 'pr' }, ['one']);
  assert.deepEqual((await projState('default-pipe')).modes.filter((m) => m.default).map((m) => m.id), ['pr']);
  assert.deepEqual(await post('/api/launch', { project: 'default-pipe', items: [{ slug: 'one' }] }), { ok: true });
  assert.deepEqual(await argsLog(root, 1), ['--to-pr one.md']);
  // without "default", the first mode is the default; an unknown default is ignored
  assert.deepEqual((await projState('pr-pipe')).modes.filter((m) => m.default).map((m) => m.id), ['verify']);
  await pipeRepo('bad-default-pipe', { ...PR_MODES, default: 'nope' }, ['one']);
  assert.deepEqual((await projState('bad-default-pipe')).modes.filter((m) => m.default).map((m) => m.id), ['verify']);
  assert.deepEqual((await projState('plain-pipe')).modes.filter((m) => m.default).map((m) => m.id), ['verify']);
});

test("shows the PR on the plan's auto/<slug> branch and acts on it through gh", async () => {

  // the list loads in the background on the first /api/state, so it may take a tick
  const deadline = Date.now() + 10000;
  let p;
  while (!(p = await onlyPlan()).pr && Date.now() < deadline) await sleep(200);
  assert.deepEqual(p.pr, { number: 7, state: 'OPEN', isDraft: true, title: 'Demo', url: 'https://github.com/o/r/pull/7', head: 'abc', mergedAt: null });

  const act = (b) => post('/api/pr-action', { project: 'demo', slug: 'demo-plan', number: 7, ...b });
  const calls = () => readFileSync(path.join(ghDir, 'calls.log'), 'utf8');
  assert.deepEqual(await act({ action: 'ready' }), { ok: true });
  // the list is read again before the answer: the plan never shows without its PR in between
  assert.equal((await onlyPlan()).pr?.number, 7, 'the PR stays on the plan right after an action');
  assert.match(calls().split('\n').slice(-3).join('\n'), /^api repos\/\{owner\}\/\{repo\}\/pulls\?state=all/m, 'the action re-reads the PR list');
  assert.deepEqual(await act({ action: 'close', deleteBranch: true }), { ok: true });
  assert.match(calls(), /^pr ready 7$/m);
  assert.match(calls(), /^pr close 7 --delete-branch$/m);
  assert.equal((await act({ action: 'ready', number: '7 --admin' })).ok, false);

  // the whole-file view reads one file at the head commit; odd paths and commits are refused
  const sha = 'a'.repeat(40);
  const file = await (await get('/api/pr-file?project=demo&sha=' + sha + '&path=src/a%20b.ts')).json();
  assert.deepEqual(file, { ok: true, text: 'whole file\n' });
  assert.match(calls(), new RegExp('^api -H Accept: application/vnd.github.raw repos/\\{owner\\}/\\{repo\\}/contents/src/a%20b.ts\\?ref=' + sha + '$', 'm'));
  assert.equal((await get('/api/pr-file?project=demo&sha=' + sha + '&path=src/../../x')).status, 400);
  assert.equal((await get('/api/pr-file?project=demo&sha=HEAD&path=src/a.ts')).status, 400);

  // task boxes: counted outside code fences, written back one at a time
  const body = path.join(ghDir, 'body.md');
  writeFileSync(body, '## Decide\n- [ ] one\n```\n- [ ] not a box\n```\n1. [x] two\n');
  assert.deepEqual(await act({ action: 'task', index: 1, count: 2, was: true }), { ok: true });
  assert.deepEqual(await act({ action: 'task', index: 0, count: 2, was: false }), { ok: true });
  assert.equal(readFileSync(body, 'utf8'), '## Decide\n- [x] one\n```\n- [ ] not a box\n```\n1. [ ] two\n');
  // a page that shows an older body is refused, and nothing is written
  const stale = await act({ action: 'task', index: 0, count: 2, was: false });
  assert.equal(stale.ok, false);
  assert.match(stale.output, /changed on GitHub/);
  assert.equal(readFileSync(body, 'utf8'), '## Decide\n- [x] one\n```\n- [ ] not a box\n```\n1. [ ] two\n');
});

test('merge runs gh pr merge on the reviewed commit, deletes the remote branch, then pulls the main checkout', async () => {
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const act = (b) => post('/api/pr-action', { project: 'demo', slug: 'demo-plan', number: 7, ...b });
  const calls = () => readFileSync(path.join(ghDir, 'calls.log'), 'utf8');
  // the repo's main checkout, and the merge landing on origin
  const origin = path.join(tmp, 'origin.git'), other = path.join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  git(repo, 'remote', 'add', 'origin', origin); git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(tmp, 'clone', '-q', origin, other);
  writeFileSync(path.join(other, 'merged.txt'), 'x');
  git(other, 'add', '-A'); git(other, 'commit', '-qm', 'merged'); git(other, 'push', '-q');

  const head = 'b'.repeat(40);
  const r = await act({ action: 'merge', method: 'squash', deleteBranch: true, head });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(calls(), new RegExp('^pr merge 7 --squash --match-head-commit ' + head + '$', 'm'));
  assert.match(calls(), /^api -X DELETE repos\/\{owner\}\/\{repo\}\/git\/refs\/heads\/auto\/demo-plan$/m);
  assert.ok(existsSync(path.join(repo, 'merged.txt')), 'the main checkout was pulled');
  assert.match(r.notes.join(' '), /Pulled main/);

  // a checkout on another branch is left alone, and says why
  git(repo, 'checkout', '-q', '-b', 'side');
  const r2 = await act({ action: 'merge', method: 'merge', head });
  assert.match(r2.notes.join(' '), /is on side, not main/);
  assert.doesNotMatch(calls().split('\n').filter((l) => l.startsWith('api -X DELETE')).join('\n'), /\n/, 'no branch delete when not asked');

  assert.equal((await act({ action: 'merge', method: 'octopus', head })).ok, false);
  assert.equal((await act({ action: 'merge', method: 'merge', head: 'HEAD' })).ok, false);

  // 📥 Pull on the project header pulls the branch the checkout is on, without a merge
  git(repo, 'checkout', '-q', 'main');
  writeFileSync(path.join(other, 'later.txt'), 'y');
  git(other, 'add', '-A'); git(other, 'commit', '-qm', 'later'); git(other, 'push', '-q');
  const pulled = await post('/api/pull', { project: 'demo' });
  assert.equal(pulled.ok, true, JSON.stringify(pulled));
  assert.match(pulled.output, /^Pulled main in /);
  assert.ok(existsSync(path.join(repo, 'later.txt')), 'the main checkout was pulled');
  assert.match((await post('/api/pull', { project: 'demo' })).output, /already up to date/);
  assert.equal((await post('/api/pull', { project: 'nope' })).error, 'bad project');

  // a local commit that GitHub does not have: the merge still counts, the pull refuses and says what to do
  writeFileSync(path.join(repo, 'local.txt'), 'l');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'local plan commit');
  writeFileSync(path.join(other, 'remote.txt'), 'r');
  git(other, 'add', '-A'); git(other, 'commit', '-qm', 'remote'); git(other, 'push', '-q');
  const localHead = git(repo, 'rev-parse', 'HEAD');
  const r3 = await act({ action: 'merge', method: 'merge', head });
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.match(r3.notes.join(' '), /^Not pulled: git pull --ff-only failed in .* Pull by hand\.$/);
  assert.doesNotMatch(r3.notes.join(' '), /hint:|origin\/main/, 'only the reason, no hints or fetch progress');
  const refused = await post('/api/pull', { project: 'demo' });
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.match(refused.output, /Pull by hand\.$/);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), localHead, 'a refused pull leaves the checkout alone');

  // Files changed reads the PR from the local repo when its commits are here: no GitHub call
  const listFile = path.join(ghDir, 'list.json'), list = readFileSync(listFile, 'utf8');
  const baseSha = git(repo, 'rev-parse', 'HEAD~1').trim(), prHead = localHead.trim();
  writeFileSync(listFile, JSON.stringify([{ number: 7, headRefName: 'auto/demo-plan', headRefOid: prHead, baseRefName: 'main',
    baseRefOid: baseSha, isDraft: false, state: 'OPEN', title: 'Demo', url: 'https://github.com/o/r/pull/7' }]));
  await act({ action: 'ready' });   // re-reads the PR list
  const before = calls().length;
  const d = await (await get('/api/pr-diff?project=demo&number=7')).json();
  assert.equal(d.local, true, JSON.stringify(d));
  assert.match(d.diff, /^diff --git a\/local\.txt b\/local\.txt$/m);
  assert.doesNotMatch(d.diff, /remote\.txt|later\.txt/, 'only the PR\'s own changes, not the base\'s');
  const f = await (await get('/api/pr-file?project=demo&sha=' + prHead + '&path=local.txt')).json();
  assert.deepEqual(f, { ok: true, text: 'l', local: true });
  assert.equal(calls().length, before, 'gh was not called for the diff or the file');
  writeFileSync(listFile, list);
  await act({ action: 'ready' });

  git(repo, 'fetch', '-q'); git(repo, 'reset', '-q', '--hard', 'origin/main');
});

test('serves browser-usability-test reports read-only on their own port, with a list', async () => {
  const dir = path.join(home, '.claude', 'browser-usability-test', 'projects', 'solver');
  mkdirSync(path.join(dir, 'reports'), { recursive: true });
  writeFileSync(path.join(dir, 'reports', '2026-11-01-cases-report.html'), '<!doctype html><title>D4 &#34;Confirmed by&#34; works</title><p>report</p>');
  writeFileSync(path.join(dir, 'accounts.json'), '{"secret":true}');
  const qa = (p) => fetch(`http://127.0.0.1:${qaPort}${p}`);

  const list = await (await qa('/')).text();
  assert.match(list, /href="\/solver\/2026-11-01-cases-report\.html"[^>]*>D4 &quot;Confirmed by&quot; works</, 'the list links each report by its title');
  assert.match(list, /href="\/solver\/2026-11-01-cases-report\.html\?download" download="2026-11-01-cases-report\.html"/, 'each report has a Download button');
  assert.ok(list.includes(`data-path="${path.join(dir, 'reports', '2026-11-01-cases-report.html')}"`), 'each report has Copy path with its full path');
  const icon = await qa('/favicon.ico');
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml', 'older reports without an icon of their own get one');
  const page = await qa('/solver/2026-11-01-cases-report.html');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store', 'an updated report shows at once');
  for (const p of ['/solver/accounts.json', '/solver/reports/2026-11-01-cases-report.html', '/solver/..%2Faccounts.json', '/.x/a.html', '/solver/nope.html'])
    assert.equal((await qa(p)).status, 404, p);
  // fetch drops a Host header, so this one goes through http.request
  const rebound = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: qaPort, path: '/', headers: { Host: 'evil.example' } },
    (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(rebound, 403, 'a rebound public name is refused');
  assert.equal((await get('/solver/2026-11-01-cases-report.html')).status, 404, 'the dashboard port does not serve reports');
  assert.match(await (await get('/')).text(), new RegExp(`href="http://localhost:${qaPort}/"`), 'the header links the list');
});

test('a saved page keeps its link across days and serves its older versions', async () => {
  const qa = (p) => fetch(`http://127.0.0.1:${qaPort}${p}`);
  const reports = path.join(home, '.claude', 'browser-usability-test', 'projects', 'solver', 'reports');
  const first = path.join(reports, '2026-11-01-d4-report.html');
  mkdirSync(reports, { recursive: true });
  writeFileSync(path.join(reports, '2026-11-01-other-d4-report.html'), '<!doctype html><title>Other</title>');
  assert.equal(writeVersioned(first, '<!doctype html><title>D4</title><body>morning</body>'), 1);
  assert.equal(writeVersioned(first, '<!doctype html><title>D4</title><body>morning</body>'), 1, 'the same bytes add no version');
  const once = await (await qa('/solver/2026-11-01-d4-report.html')).text();
  assert.doesNotMatch(once, /id="qa-ver"/, 'a page with one version has no menu');
  assert.match(once, /id="qa-dl"/, 'and still has Download');

  const next = path.join(reports, sameNameIn(reports, '2026-11-02-d4-report.html'));
  assert.equal(next, first, 'a later day on the same route updates the same file');
  assert.equal(sameNameIn(reports, '2026-11-02-new-report.html'), '2026-11-02-new-report.html', 'a new route starts its own file');
  assert.equal(writeVersioned(next, '<!doctype html><title>D4</title><body>evening</body>'), 2);

  const latest = await (await qa('/solver/2026-11-01-d4-report.html')).text();
  assert.match(latest, /evening/, 'the link shows the newest version');
  assert.match(latest, /v2 \(latest\) ▾/, 'the menu names the version shown');
  assert.match(latest, /href="\/solver\/2026-11-01-d4-report\.html\?v=1"/, 'the menu links the older version');
  assert.doesNotMatch(latest, /id="qa-old"/, 'the newest version has no old-version notice');

  const old = await (await qa('/solver/2026-11-01-d4-report.html?v=1')).text();
  assert.match(old, /morning/, '?v=1 shows the page as it was');
  assert.match(old, /id="qa-old" href="\/solver\/2026-11-01-d4-report\.html"/, 'an old version links back to the latest');
  assert.match(old, /href="\?v=1&amp;download"/, 'Download on an old version gives that version');

  const dl = await qa('/solver/2026-11-01-d4-report.html?v=1&download');
  assert.match(dl.headers.get('content-disposition'), /2026-11-01-d4-report-v1\.html/, 'the download names its version');
  assert.doesNotMatch(await dl.text(), /qa-bar/, 'a download is the file as saved');
  for (const v of ['2', '9', '../v1', '1.html', ''])
    assert.equal((await qa(`/solver/2026-11-01-d4-report.html?v=${encodeURIComponent(v)}`)).status, v ? 404 : 200, `v=${v}`);
  assert.equal((await qa('/solver/.versions/2026-11-01-d4-report/v1.html')).status, 404, 'version files have no route of their own');

  const list = await (await qa('/')).text();
  assert.match(list, /2026-11-01-d4-report\.html<\/span> <span class="tk">2 versions</, 'the list has one row with its version count');
  assert.doesNotMatch(list, /v1\.html/, 'older versions have no rows');
});

test('the QA list shows ticket numbers, saved Claude artifacts and scratchpad drafts', async () => {
  const qa = (p) => fetch(`http://127.0.0.1:${qaPort}${p}`);
  const reports = path.join(home, '.claude', 'browser-usability-test', 'projects', 'solver', 'reports');
  mkdirSync(reports, { recursive: true });
  writeFileSync(path.join(reports, '2026-11-01-fs2-report.html'),
    '<!doctype html><title>FS2 works</title><meta name="qa:issues" content="https://github.com/acme/SolveR/issues/435"><p>r</p>');
  const projects = path.join(home, '.claude', 'browser-usability-test', 'projects');
  mkdirSync(path.join(projects, 'solver', 'artifacts'), { recursive: true });
  mkdirSync(path.join(projects, '_other', 'artifacts'), { recursive: true });
  writeFileSync(path.join(projects, 'solver', 'artifacts', '2026-10-29-fs2.html'), '<!doctype html><meta name="qa:title" content="FS2 Before and After">\n'
    + '<meta name="qa:updated" content="2026-10-29">\n<meta name="qa:source" content="https://claude.ai/artifact/abc">\n<meta name="qa:issues" content="#435">\n<p>page');
  writeFileSync(path.join(projects, '_other', 'artifacts', '2026-10-25-sow.html'), '<!doctype html><meta name="qa:title" content="Statement of Work">\n'
    + '<meta name="qa:updated" content="2026-10-25">\n<meta name="qa:source" content="https://claude.ai/artifact/doc">\n<meta name="qa:remote-only" content="1">\n<p>stub');
  const sp = path.join(tmp, 'claude-tmp', '-Users-me-Workspace-shop', 'sess-1', 'scratchpad', 'ba');
  mkdirSync(path.join(sp, 'img'), { recursive: true });
  writeFileSync(path.join(sp, 'img', 'a.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(path.join(sp, 'page.html'), '<title>Draft for #440</title><img src="img/a.png">');
  writeFileSync(path.join(tmp, 'claude-tmp', 'outside.html'), 'secret');

  const list = await (await qa('/')).text();
  assert.match(list, /class="tk" href="https:\/\/github\.com\/acme\/SolveR\/issues\/435"[^>]*>SolveR#435</, 'a report shows its ticket as a link');
  assert.match(list, /data-search="[^"]*solver#435/i, 'the ticket number is searchable');
  assert.match(list, /href="\/solver\/artifacts\/2026-10-29-fs2\.html"[^>]*>FS2 Before and After</, 'a saved artifact opens locally');
  assert.match(list, /href="https:\/\/claude\.ai\/artifact\/doc"[^>]*>Statement of Work ↗</, 'a Docs artifact links to claude.ai');
  const solver = list.indexOf('data-key="solver"'), other = list.indexOf('data-key="_other"');
  const solverArts = list.indexOf('<h2>Artifacts ', solver);
  assert.ok(solver >= 0 && list.indexOf('<h2>Reports ', solver) < solverArts && solverArts < other,
    "a project's artifacts come right after its reports, inside its fold; the rest at the end");
  assert.match(list, /href="\/drafts\/-Users-me-Workspace-shop\/sess-1\/scratchpad\/ba\/page\.html"[^>]*>Draft for #440</, 'a scratchpad draft is listed');
  assert.equal((await qa('/solver/artifacts/2026-10-29-fs2.html')).status, 200);
  const draft = await (await qa('/drafts/-Users-me-Workspace-shop/sess-1/scratchpad/ba/page.html')).text();
  assert.match(draft, /src="data:image\/png;base64,/, 'a draft comes back as one file with its images inside');
  for (const p of ['/drafts/outside.html', '/drafts/-Users-me-Workspace-shop/sess-1/scratchpad/..%2F..%2F..%2Foutside.html',
    '/drafts/-Users-me-Workspace-shop/sess-1/scratchpad/ba/img/a.png', '/solver/artifacts/..%2Freports%2Fx.html', '/solver/artifacts/nope.html'])
    assert.equal((await qa(p)).status, 404, p);
});

test('the worktrees section lists a worktree a session made, with its PR and the session that worked in it', async () => {
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const root = path.join(tmp, 'wtrepo'), wt = path.join(root, '.claude', 'worktrees', 'feat-x');
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(root, 'a.txt'), 'a');
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base');
  git(root, 'remote', 'add', 'origin', 'git@github.com:o/r.git');   // only a GitHub repo has the section
  git(root, 'worktree', 'add', '-q', '-b', 'feature/x', wt);
  git(root, 'worktree', 'add', '-q', '-b', 'auto/some-plan', path.join(tmp, 'wt-auto'));   // a plan's run: not listed
  writeFileSync(path.join(wt, 'b.txt'), 'b');
  // sessions run in the root; one of them moved into the worktree
  const tdir = path.join(home, '.claude', 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(tdir, { recursive: true });
  writeFileSync(path.join(tdir, 'sess-in.jsonl'), JSON.stringify({ type: 'user', cwd: root }) + '\n' + JSON.stringify({ type: 'user', cwd: wt }) + '\n');
  writeFileSync(path.join(tdir, 'sess-out.jsonl'), JSON.stringify({ type: 'user', cwd: root }) + '\n');
  const reg = path.join(home, '.claude', 'pipeline-projects.json'), was = readFileSync(reg, 'utf8');
  writeFileSync(reg, JSON.stringify({ projects: [...JSON.parse(was).projects,
    { name: 'wtdemo', client: 'Test', root, plansDir: path.join(root, '.plans'), launchers: [] }] }));
  try {
    let w, list;
    for (const end = Date.now() + 8000; Date.now() < end; await sleep(200)) {
      list = ((await state()).find((p) => p.name === 'wtdemo') || {}).worktrees || [];
      w = list.find((x) => x.name === 'feat-x');
      if (w && w.pr) break;
    }
    assert.ok(w && w.pr, 'the worktree shows with its PR: ' + JSON.stringify(list));
    assert.equal(list.length, 1, 'the main checkout and the auto/ run are not listed');
    assert.equal(w.slug, 'wt.feat-x');
    assert.equal(w.branch, 'feature/x');
    assert.equal(w.pr.number, 9);
    assert.equal(w.subject, 'base');
    assert.equal(w.dirty, 1);
    assert.deepEqual(w.sessions.map((s) => s.id), ['sess-in']);
    assert.equal(w.agent, 'working');
    // the local-changes view finds the worktree by its slug: the fake PR head is not a real commit here
    assert.equal((await (await get('/api/local?project=wtdemo&slug=wt.feat-x')).json()).none, true);
  } finally { writeFileSync(reg, was); }
});

test("a plan that names its branch shows that branch's PR, and its worktree leaves the worktrees section", async () => {
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const root = path.join(tmp, 'branchrepo'), wt = path.join(root, '.claude', 'worktrees', 'feat-x');
  mkdirSync(path.join(root, '.plans'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(root, 'a.txt'), 'a');
  git(root, 'add', 'a.txt'); git(root, 'commit', '-qm', 'base');
  git(root, 'remote', 'add', 'origin', 'git@github.com:o/r.git');
  git(root, 'worktree', 'add', '-q', '-b', 'feature/x', wt);
  // the PR on feature/x (#9 in the fake list) was opened before this plan was written
  writeFileSync(path.join(root, '.plans', '20261109-120000-feat-x.md'),
    '# Feature X\n\n- **Type**: ticket\n- **Branch**: feature/x\n\nDone by hand.\n');
  writeFileSync(path.join(root, '.plans', '20261111-120000-new-work.md'),
    '# New work\n\n- **Branch**: auto/20261111-120000-new-work\n');
  const reg = path.join(home, '.claude', 'pipeline-projects.json'), was = readFileSync(reg, 'utf8');
  writeFileSync(reg, JSON.stringify({ projects: [...JSON.parse(was).projects,
    { name: 'branchdemo', client: 'Test', root, plansDir: path.join(root, '.plans'), launchers: [] }] }));
  try {
    let proj, plan;
    for (const end = Date.now() + 8000; Date.now() < end; await sleep(200)) {
      proj = (await state()).find((p) => p.name === 'branchdemo') || {};
      plan = (proj.plans || []).find((p) => p.slug === '20261109-120000-feat-x');
      if (plan && plan.pr) break;
    }
    assert.equal(plan?.pr?.number, 9, 'the plan shows the PR of the branch it names: ' + JSON.stringify(plan));
    assert.equal((proj.plans.find((p) => p.slug === '20261111-120000-new-work') || {}).pr, null,
      'a plan on its own auto/<slug> branch is looked up as before');
    assert.deepEqual(proj.worktrees, [], 'the worktree shows as the plan, not twice');
    // the local-changes view finds the worktree through the plan's branch
    assert.equal((await (await get('/api/local?project=branchdemo&slug=20261109-120000-feat-x')).json()).none, true);
  } finally { writeFileSync(reg, was); }
});

test('a scout proposal: Confirm starts /skill-1-plan in a new chat in the repo root, Dismiss archives it', async () => {
  const until = async (fn, what) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const v = await fn(); if (v) return v; await sleep(100); }
    assert.fail('timed out waiting for ' + what);
  };
  const log = path.join(ghDir, 'claude-calls.log');
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  const before = calls().length;
  for (const s of ['20261120-070000-scout-ci-red-fix-ci', '20261120-070001-scout-flaky-e2e']) {
    writeFileSync(path.join(plansDir, s + '.md'), '# Scout: ' + s + '\n\n## Summary\n\nCI is red.\n');
    assert.deepEqual(await post('/api/meta', { project: 'demo', slug: s, status: 'proposed', tags: ['scout'] }), { ok: true });
  }
  const plan = async (s) => (await state())[0].plans.find((p) => p.slug === s);
  try {
    // only a proposal can be confirmed
    assert.equal((await post('/api/scout/confirm', { project: 'demo', slug: 'demo-plan' })).ok, false);

    const a = '20261120-070000-scout-ci-red-fix-ci';
    assert.deepEqual(await post('/api/scout/confirm', { project: 'demo', slug: a }), { ok: true });
    const start = await until(() => calls().slice(before).find((l) => l.startsWith('-p ') && l.includes('--input-format')), 'the chat to start');
    assert.doesNotMatch(start, /--resume/, 'a new session, not one of the repo root');
    const chat = await until(async () => { const c = await (await get('/api/chat?project=demo&slug=' + a)).json(); return c.current && c; }, 'the session id');
    assert.equal(chat.current.id, 'ses-probe');
    const p = await plan(a);
    assert.equal(p.status, null, 'the proposal leaves the Proposed column');
    assert.equal(p.asked, true, 'the plan has a chat now');
    const sent = JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'state', 'demo', 'ask', a + '.json'), 'utf8'));
    assert.equal(sent.root, true);
    assert.deepEqual(sent.own, ['ses-probe']);
    await post('/api/chat/stop', { project: 'demo', slug: a });

    const b = '20261120-070001-scout-flaky-e2e';
    assert.deepEqual(await post('/api/scout/dismiss', { project: 'demo', slug: b }), { ok: true });
    assert.equal(existsSync(path.join(plansDir, 'done', b + '.md')), true);
    assert.equal((await plan(b)).status, 'dismissed');
    assert.equal((await post('/api/scout/dismiss', { project: 'demo', slug: b })).ok, false, 'twice is refused');
  } finally {
    for (const f of [path.join(plansDir, '20261120-070000-scout-ci-red-fix-ci.md'), path.join(plansDir, 'done', '20261120-070001-scout-flaky-e2e.md')])
      rmSync(f, { force: true });
  }
});

test('the Scout drawer lists the missing setup steps, runs the scout and shows its last run and log', async () => {
  const scoutState = async () => (await get('/api/scout')).json();
  let s = await scoutState();
  assert.equal(s.config, false);
  assert.equal(s.installed, false);
  assert.equal((await post('/api/scout/run', {})).ok, false, 'no config, no run');

  writeFileSync(path.join(home, '.claude', 'scout.json'), JSON.stringify({ projects: {
    demo: { base: 'main', checks: ['stuck-prs'], aws: { profile: 'demo-scout', region: 'eu-west-1', logGroups: ['/x'] } },
    ghost: { checks: ['stuck-prs'] } } }));
  s = await scoutState();
  assert.equal(s.config, true);
  assert.deepEqual(s.projects.map((p) => [p.name, p.registered, p.aws && p.aws.ok]), [['demo', true, false], ['ghost', false, null]]);
  mkdirSync(path.join(home, '.aws'), { recursive: true });
  writeFileSync(path.join(home, '.aws', 'config'), '[profile demo-scout]\nregion = eu-west-1\n');
  assert.equal((await scoutState()).projects[0].aws.ok, true, 'the profile is found by name, no key is read');

  // a run of the one project on the dashboard: its failed check shows in the log and in the last run
  writeFileSync(path.join(home, '.claude', 'scout.json'), JSON.stringify({ projects: { demo: { base: 'main', checks: ['stuck-prs'] } } }));
  assert.equal((await post('/api/scout/run', {})).ok, true);
  const deadline = Date.now() + 20000;
  do { await sleep(200); s = await scoutState(); } while (Date.now() < deadline && s.running);
  assert.equal(s.running, false);
  assert.match(s.log, /demo: 0 finding\(s\), 0 new proposal\(s\)/);
  assert.ok(s.projects[0].lastRun, 'the last run is shown');
  assert.match(s.projects[0].lastRun.warnings.join(' '), /gh pr list/, 'the fake gh answers no JSON, so the check is reported as failed');
});

test('the Scout drawer names the scout script and its docs in this checkout, and both files exist', async () => {
  const s = await (await get('/api/scout')).json();
  const real = (p) => p.replace(/^~(?=\/|$)/, home);
  assert.match(s.script, /\/apps\/scout\/scout\.mjs$/);
  assert.match(s.docs, /\/docs\/scout\.md$/);
  assert.ok(existsSync(real(s.script)), `${s.script} exists`);
  assert.ok(existsSync(real(s.docs)), `${s.docs} exists`);
});

test('the Scout drawer counts the daily job as installed only while the script of its plist exists', async () => {
  const plist = path.join(home, 'Library', 'LaunchAgents', 'com.plans-dashboard.scout.plist');
  const xml = (script) => '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>Label</key>\n\t<string>com.plans-dashboard.scout</string>\n'
    + `\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>${process.execPath}</string>\n\t\t<string>${script}</string>\n\t</array>\n</dict>\n</plist>\n`;
  mkdirSync(path.dirname(plist), { recursive: true });
  try {
    writeFileSync(plist, xml(path.join(home, 'Workspace', 'claude-config', 'moved-away', 'scout.mjs')));
    assert.equal((await (await get('/api/scout')).json()).installed, false, 'a plist from before the move shows the --install step again');
    writeFileSync(plist, xml(path.join(path.dirname(SCRIPT), '..', 'scout', 'scout.mjs')));
    assert.equal((await (await get('/api/scout')).json()).installed, true);
    // a plist the dashboard cannot read a script from is still an installed job
    writeFileSync(plist, '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>com.plans-dashboard.scout</string></dict></plist>\n');
    assert.equal((await (await get('/api/scout')).json()).installed, true, 'a plist without ProgramArguments counts as installed');
    rmSync(plist);
    assert.equal((await (await get('/api/scout')).json()).installed, false, 'no plist, no job');
  } finally {
    rmSync(plist, { force: true });
  }
});

test('Unmute lets the scout count a muted check or finding again from now', async () => {
  const f = path.join(home, '.claude', 'pipeline-dashboard', 'state', 'demo', 'scout.json');
  writeFileSync(f, JSON.stringify({ findings: {}, learn: { mutedChecks: { 'stuck-prs': 'you dismissed its last 5 proposals' },
    mutedKeys: { 'ci-red:CI': { title: 'Fix CI', why: 'proposed 3 times, never confirmed' } }, stats: {} }, checkRuns: { 'stuck-prs': { runs: 9, found: 9, quiet: 0 } } }));
  let s = await (await get('/api/scout')).json();
  assert.ok(s.projects.find((p) => p.name === 'demo').learn.mutedChecks['stuck-prs']);
  assert.deepEqual(await post('/api/scout/unmute', { project: 'demo', check: 'stuck-prs' }), { ok: true });
  assert.deepEqual(await post('/api/scout/unmute', { project: 'demo', key: 'ci-red:CI' }), { ok: true });
  assert.equal((await post('/api/scout/unmute', { project: 'nope', check: 'x' })).ok, false);
  const st = JSON.parse(readFileSync(f, 'utf8'));
  assert.deepEqual(Object.keys(st.unmuted).sort(), ['check:stuck-prs', 'key:ci-red:CI']);
  assert.deepEqual(st.learn.mutedChecks, {});
  assert.deepEqual(st.learn.mutedKeys, {});
  s = await (await get('/api/scout')).json();
  assert.equal(s.projects.find((p) => p.name === 'demo').checkRuns['stuck-prs'].runs, 9);
});

test('docs-media copies a dashboard that starts and serves the page, without the test folders', async () => {
  // a dynamic import after CHROME is set: without the IS_MAIN guard the import exits the test run
  const chromeBefore = process.env.CHROME;
  process.env.CHROME = '/nonexistent';
  const { copyDashboard } = await import('../../../scripts/docs-media.mjs');
  if (chromeBefore === undefined) delete process.env.CHROME; else process.env.CHROME = chromeBefore;

  const box = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'plans-dash-copy-')));
  // a node_modules/ folder in the source (git ignores it) must not reach the copy
  const nodeModules = path.join(path.dirname(SCRIPT), '..', '..', 'scripts', 'node_modules');
  const madeNodeModules = !existsSync(nodeModules);
  if (madeNodeModules) { mkdirSync(nodeModules); writeFileSync(path.join(nodeModules, 'marker.txt'), 'test'); }
  let child;
  try {
    const dash = path.join(box, 'Workspace', 'claude-config');
    const script = copyDashboard(dash);
    assert.equal(existsSync(path.join(dash, 'scripts', 'node_modules')), false, 'scripts/node_modules is not copied');
    assert.equal(script, path.join(dash, 'apps', 'dashboard', 'server.mjs'));
    for (const f of ['apps/dashboard/server.mjs', 'apps/dashboard/page/app.js', 'apps/dashboard/chat-relay.mjs',
      'scripts/artifact-copies.mjs', 'scripts/page-versions.mjs', 'skills/bootstrap-project/scripts/render.mjs'])
      assert.ok(existsSync(path.join(dash, f)), `${f} is copied`);
    for (const app of readdirSync(path.join(dash, 'apps')))
      assert.equal(existsSync(path.join(dash, 'apps', app, 'test')), false, `apps/${app}/test is not copied`);

    const copyHome = path.join(box, 'home');
    mkdirSync(path.join(copyHome, '.claude'), { recursive: true });
    const copyPort = await freePort(), copyQaPort = await freePort();
    child = spawn(process.execPath, [script], {
      env: { ...process.env, HOME: copyHome, DASH_PORT: String(copyPort), QA_REPORTS_PORT: String(copyQaPort),
             DASH_NO_OPEN: '1', DASH_NO_SUMMARY: '1', CLAUDE_TMP: path.join(box, 'claude-tmp'), QA_HOME: '',
             DASH_WATCH_MS: '0', DASH_NO_NOTIFY: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (c) => (err += c));
    let res;
    for (const deadline = Date.now() + 15000; Date.now() < deadline && child.exitCode == null; await sleep(100)) {
      try { res = await fetch(`http://127.0.0.1:${copyPort}/`); break; } catch {}
    }
    assert.ok(res, 'the copied server answers: ' + err);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /id="stabs"/, 'the copy serves the page of this checkout');
  } finally {
    await stop(child);
    rmSync(box, { recursive: true, force: true });
    if (madeNodeModules) rmSync(nodeModules, { recursive: true, force: true });
  }
});

// ---------- the unattended bootstrap upgrade (skills/bootstrap-project/scripts/upgrade-run.mjs) ----------

const deadPid = async () => {
  const c = spawn(process.execPath, ['-e', '']);
  await new Promise((r) => c.once('exit', r));
  return c.pid;
};
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('the upgrade run status shows in /api/state, and a running run whose PID is gone shows as failed', async () => {
  const runs = path.join(repo, '.plans', 'auto-runs'), file = path.join(runs, 'bootstrap-upgrade.json');
  mkdirSync(runs, { recursive: true });
  try {
    writeFileSync(file, JSON.stringify({ state: 'pr', hash: 'abc', branch: 'auto/bootstrap-upgrade-abc',
      pr: { number: 41, url: 'https://github.com/o/r/pull/41' } }));
    const demo = (await state()).find((p) => p.name === 'demo');
    assert.equal(demo.bootstrapRun.pr.number, 41);
    assert.equal(demo.bootstrapRun.state, 'pr');
    assert.ok('bootstrapHash' in demo);
    const pid = await deadPid();
    writeFileSync(file, JSON.stringify({ state: 'running', step: 'claude', pid }));
    const run = (await state()).find((p) => p.name === 'demo').bootstrapRun;
    assert.equal(run.state, 'failed');
    assert.match(run.error, new RegExp(`pid ${pid} is gone`));
    // a live PID in a run that started 3 hours ago is another process that reused the number
    writeFileSync(file, JSON.stringify({ state: 'running', step: 'claude', pid: process.pid, startedAt: new Date(Date.now() - 3 * 3600e3).toISOString() }));
    const old = (await state()).find((p) => p.name === 'demo').bootstrapRun;
    assert.equal(old.state, 'failed');
    assert.match(old.error, /more than 2 hours ago/);
    writeFileSync(file, JSON.stringify({ state: 'running', step: 'claude', pid: process.pid, startedAt: new Date().toISOString() }));
    assert.equal((await state()).find((p) => p.name === 'demo').bootstrapRun.state, 'running');
    // the demo repo is shared with other tests: remove only the status file
  } finally { rmSync(file, { force: true }); }
});

test('POST /api/bootstrap-upgrade refuses a project with nothing to upgrade, an unknown project and another site', async () => {
  const r = await post('/api/bootstrap-upgrade', { project: 'demo' });
  assert.equal(r.ok, false);
  assert.match(r.output, /nothing to upgrade/);
  const unknown = await fetch(`http://127.0.0.1:${port}/api/bootstrap-upgrade`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'no-such-project' }) });
  assert.equal(unknown.status, 400);
  assert.equal(await raw('POST', '/api/bootstrap-upgrade', { Host: `127.0.0.1:${port}`, Origin: 'https://evil.example',
    'Content-Type': 'text/plain' }, JSON.stringify({ project: 'demo' })), 403);
});

test('POST /api/bootstrap-upgrade starts a run, removes a stale lock and refuses a live one', async () => {
  const root = path.join(tmp, 'upgrade-repo');
  mkdirSync(path.join(root, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'acme-api', private: true }));
  const example = JSON.parse(readFileSync(path.join(path.dirname(SCRIPT), '../../skills/bootstrap-project/references/bootstrap.example.json'), 'utf8'));
  example.git.base = 'main';
  writeFileSync(path.join(root, '.claude/bootstrap.json'), JSON.stringify(example, null, 2));
  execFileSync(process.execPath, [path.join(path.dirname(SCRIPT), '../../skills/bootstrap-project/scripts/render.mjs'), root,
    '--stage', path.join(tmp, 'upgrade-stage'), '--apply', 'new'], { stdio: 'ignore' });
  // one answer changes after the apply: the saved hash no longer matches
  const params = JSON.parse(readFileSync(path.join(root, '.claude/bootstrap.json'), 'utf8'));
  params.stack.commands.lint = 'node --check index.mjs';
  writeFileSync(path.join(root, '.claude/bootstrap.json'), JSON.stringify(params, null, 2) + '\n');
  const runs = path.join(root, '.plans', 'auto-runs');
  const lock = path.join(runs, 'bootstrap-upgrade.lock'), file = path.join(runs, 'bootstrap-upgrade.json');
  const reg = path.join(home, '.claude', 'pipeline-projects.json'), was = readFileSync(reg, 'utf8');
  writeFileSync(reg, JSON.stringify({ projects: [...JSON.parse(was).projects,
    { name: 'upgdemo', client: 'Test', root, plansDir: path.join(root, '.plans'), launchers: [] }] }));
  // the project has no origin, so each run fails at the fetch and ends at once
  const ran = async (prev) => {
    for (const end = Date.now() + 10000; Date.now() < end; await sleep(100)) {
      let s = null;
      try { s = JSON.parse(readFileSync(file, 'utf8')); } catch {}
      if (s && s.pid && s.pid !== prev && !pidAlive(s.pid) && s.state !== 'running') return s;
    }
    assert.fail('the upgrade run did not end in 10 s');
  };
  try {
    let p;
    for (const end = Date.now() + 15000; Date.now() < end; await sleep(200)) {
      p = (await state()).find((x) => x.name === 'upgdemo');
      if (p && p.bootstrap === 'outdated') break;
    }
    assert.equal(p.bootstrap, 'outdated');
    assert.match(p.bootstrapHash, /^[0-9a-f]{16}$/);
    assert.equal(existsSync(runs), false, 'no auto-runs folder before the first run');
    assert.deepEqual(await post('/api/bootstrap-upgrade', { project: 'upgdemo' }), { ok: true });
    let s = await ran(null);
    assert.equal(s.state, 'failed');
    assert.equal(existsSync(path.join(runs, 'bootstrap-upgrade.log')), true);

    // a lock with a dead PID is stale: removed, and the run starts
    writeFileSync(lock, String(await deadPid()));
    assert.deepEqual(await post('/api/bootstrap-upgrade', { project: 'upgdemo' }), { ok: true });
    s = await ran(s.pid);
    // a lock of a live process, and an empty young lock, are live
    writeFileSync(lock, String(process.pid));
    assert.match((await post('/api/bootstrap-upgrade', { project: 'upgdemo' })).output, /already live/);
    writeFileSync(lock, '');
    assert.match((await post('/api/bootstrap-upgrade', { project: 'upgdemo' })).output, /already live/);
    // an empty lock older than 60 s is stale
    const old = (Date.now() - 120000) / 1000;
    utimesSync(lock, old, old);
    assert.deepEqual(await post('/api/bootstrap-upgrade', { project: 'upgdemo' }), { ok: true });
    s = await ran(s.pid);
    // a live PID in a lock older than 2 hours is a reused number: stale
    writeFileSync(lock, String(process.pid));
    const veryOld = (Date.now() - 3 * 3600e3) / 1000;
    utimesSync(lock, veryOld, veryOld);
    assert.deepEqual(await post('/api/bootstrap-upgrade', { project: 'upgdemo' }), { ok: true });
    s = await ran(s.pid);
    // two clicks at once, before the child takes its lock: only one starts a run
    const both = await Promise.all([post('/api/bootstrap-upgrade', { project: 'upgdemo' }), post('/api/bootstrap-upgrade', { project: 'upgdemo' })]);
    assert.equal(both.filter((x) => x.ok).length, 1, JSON.stringify(both));
    assert.match(both.find((x) => !x.ok).output, /already live/);
    s = await ran(s.pid);
    // after the child exits, a click starts a run again
    for (const end = Date.now() + 5000; Date.now() < end; await sleep(100)) {
      const r = await post('/api/bootstrap-upgrade', { project: 'upgdemo' });
      if (r.ok) break;
    }
    s = await ran(s.pid);
    // a running status with a live PID refuses a second run
    writeFileSync(file, JSON.stringify({ state: 'running', step: 'claude', pid: process.pid }));
    assert.equal(existsSync(lock), false);
    const r = await post('/api/bootstrap-upgrade', { project: 'upgdemo' });
    assert.equal(r.ok, false);
    assert.match(r.output, /already live/);
    assert.equal((await state()).find((x) => x.name === 'upgdemo').bootstrapRun.state, 'running');
    // the refusal came from the status file: the same status, failed, lets a click start a run
    writeFileSync(file, JSON.stringify({ state: 'failed', step: 'claude', pid: process.pid }));
    assert.deepEqual(await post('/api/bootstrap-upgrade', { project: 'upgdemo' }), { ok: true });
    s = await ran(process.pid);
    // an open upgrade PR for the hash the templates make now refuses a new run
    writeFileSync(file, JSON.stringify({ state: 'pr', hash: p.bootstrapHash, branch: `auto/bootstrap-upgrade-${p.bootstrapHash}`,
      pr: { number: 41, url: 'https://github.com/o/r/pull/41' } }));
    const open = await post('/api/bootstrap-upgrade', { project: 'upgdemo' });
    assert.equal(open.ok, false);
    assert.match(open.output, /upgrade PR #41 is open/);
    // a PR for an older hash does not: the templates changed since
    writeFileSync(file, JSON.stringify({ state: 'pr', hash: '0000000000000000', branch: 'auto/bootstrap-upgrade-0000000000000000',
      pr: { number: 40, url: 'https://github.com/o/r/pull/40' } }));
    assert.deepEqual(await post('/api/bootstrap-upgrade', { project: 'upgdemo' }), { ok: true });
    await ran(process.pid);
  } finally { writeFileSync(reg, was); }
});

test("the dashboard's own repo has no upgrade run: no run fields, and POST refuses", async () => {
  const root = path.resolve(path.dirname(SCRIPT), '..', '..');
  const reg = path.join(home, '.claude', 'pipeline-projects.json'), was = readFileSync(reg, 'utf8');
  writeFileSync(reg, JSON.stringify({ projects: [...JSON.parse(was).projects,
    { name: 'dashself', client: 'Test', root, plansDir: path.join(root, '.plans'), launchers: [] }] }));
  try {
    const p = (await state()).find((x) => x.name === 'dashself');
    assert.equal(p.bootstrapRun, null);
    assert.equal(p.bootstrapHash, null);
    const r = await post('/api/bootstrap-upgrade', { project: 'dashself' });
    assert.equal(r.ok, false);
    assert.match(r.output, /this dashboard repo has no bootstrap upgrade/);
  } finally { writeFileSync(reg, was); }
});

// the page's bootstrapUpgradeChip() from app.js, with its escape helpers
const upgradeChip = (() => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const pick = (re) => { const m = src.match(re); assert.ok(m, 'app.js has ' + re); return m[0]; };
  const body = [pick(/^const esc = .*$/m), pick(/^const escA = .*$/m),
    pick(/^function bootstrapUpgradeChip\(project, sp\) \{[\s\S]*?\n\}$/m)].join('\n');
  return new Function(body + '\nreturn bootstrapUpgradeChip;')();
})();

test('the page: the upgrade chip shows the run state, and only an open PR for the current hash', () => {
  const sp = (run) => ({ bootstrap: 'outdated', bootstrapHash: 'abc', bootstrapRun: run });
  const pr = (extra) => ({ state: 'pr', hash: 'abc', pr: { number: 41, url: 'https://github.com/o/r/pull/41' }, ...extra });
  assert.match(upgradeChip('acme', sp(null)), /data-bsupgrade="acme"[^>]*>bootstrap update ▶</);
  assert.match(upgradeChip('acme', sp({ state: 'running', step: 'claude' })), />upgrading…</);
  assert.ok(!/data-bsupgrade/.test(upgradeChip('acme', sp({ state: 'running' }))), 'a live run has no click');
  const open = upgradeChip('acme', sp(pr()));
  assert.match(open, /href="https:\/\/github\.com\/o\/r\/pull\/41"[^>]*>upgrade PR #41</);
  for (const other of [pr({ prState: 'CLOSED' }), pr({ hash: 'old' }), pr({ hash: 'old', prState: 'MERGED' })])
    assert.match(upgradeChip('acme', sp(other)), />bootstrap update ▶</, JSON.stringify(other));
  // merged on GitHub but not pulled yet: no click, a run would fail at the answers check
  const merged = upgradeChip('acme', sp(pr({ prState: 'MERGED' })));
  assert.match(merged, />upgrade merged — pull</);
  assert.ok(!/data-bsupgrade/.test(merged), 'no click before the pull');
  const failed = upgradeChip('acme', sp({ state: 'failed', error: 'git fetch "origin" <failed>' }));
  assert.match(failed, /data-bsupgrade="acme"[^>]*>upgrade failed</);
  assert.match(failed, /title="git fetch &quot;origin&quot; &lt;failed&gt; — click to start again"/);
});

test('the page: a sent slash command with args on new lines leaves the live area when the log has it', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const m = src.match(/^function sentLanded\(s, it\) \{[\s\S]*?\n\}$/m);
  assert.ok(m, 'app.js has sentLanded');
  const sentLanded = new Function(m[0] + '\nreturn sentLanded;')();
  const sent = { text: '/merge-parent\n\nFix findings from the report.', from: 10 };
  // the server writes a command as "<command-name> <command-args>"
  assert.equal(sentLanded(sent, { i: 12, text: '/merge-parent Fix findings from the report.' }), true);
  assert.equal(sentLanded({ text: 'plain text', from: 3 }, { i: 3, text: 'plain text\n' }), true);
  assert.equal(sentLanded(sent, { i: 9, text: '/merge-parent Fix findings from the report.' }), false, 'an older message with the same text');
  assert.equal(sentLanded(sent, { i: 12, text: '/merge-parent Something else' }), false);
});

test('the page: revealInSide opens the folds and clears a search that hide a plan or a worktree item', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const m = src.match(/^function revealInSide\(key\) \{[\s\S]*?\n\}$/m);
  assert.ok(m, 'app.js has revealInSide');
  const plan = { key: 'acme/20260101-000000-demo', project: 'acme', title: 'Demo' };
  const wt = { key: 'acme/wt.fix', kind: 'wt', project: 'acme', name: 'fix' };
  const make = (q) => {
    const env = { collapsedProjects: new Set(['acme', 'wt:acme', 'other']), saved: 0, box: { value: q } };
    const reveal = new Function('find', 'collapsedProjects', 'saveCollapsed', 'byId', 'matchesQ', 'visibleWts',
      m[0] + '\nreturn revealInSide;')(
      (k) => [plan, wt].find((x) => x.key === k), env.collapsedProjects, () => env.saved++, () => env.box,
      (p, s) => p.title.toLowerCase().includes(s), () => (env.box.value ? [] : [wt]));
    return { env, reveal };
  };
  let { env, reveal } = make('');
  reveal(plan.key);
  assert.deepEqual([...env.collapsedProjects], ['wt:acme', 'other'], 'a plan opens its project only');
  assert.equal(env.saved, 1);
  ({ env, reveal } = make('nomatch'));
  reveal(wt.key);
  assert.deepEqual([...env.collapsedProjects], ['other'], 'a worktree item opens the project and its Worktrees fold');
  assert.equal(env.box.value, '', 'a search that hides the worktree item is cleared');
  ({ env, reveal } = make('demo'));
  reveal(plan.key);
  assert.equal(env.box.value, 'demo', 'a search that shows the plan stays');
  reveal('acme/unknown');
  assert.equal(env.saved, 1, 'an unknown key changes nothing');
});

test('the page: a tab shows a readable title and a status word', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const pick = (re) => { const m = src.match(re); assert.ok(m, 'app.js has ' + re); return m[0]; };
  const body = [pick(/^function tabStatus\(p\) \{[\s\S]*?\n\}$/m), pick(/^const tabTitle = .*$/m)].join('\n');
  const answered = new Set(['acme/b']);
  const { tabStatus, tabTitle } = new Function('starting', 'notStarted', 'outOf', 'chatAnswered', body + '\nreturn { tabStatus, tabTitle };')(
    (p) => !!p.starting, (p) => !!p.failedLaunch, (p) => (p.run ? p.run.outcome : null), answered);
  const word = (p) => tabStatus({ key: 'acme/a', ...p })[1];
  assert.equal(word({ chatWaits: 1, live: true }), 'asks you', 'a question beats a live run');
  assert.equal(word({ chatting: true }), 'working');
  assert.equal(word({ run: { outcome: 'running' } }), 'working');
  assert.equal(word({ failedLaunch: true }), 'failed');
  assert.equal(word({ run: { outcome: 'needs-you' } }), 'your turn');
  assert.equal(word({ key: 'acme/b' }), 'answered');
  assert.equal(word({ pr: { state: 'MERGED' } }), 'merged');
  assert.equal(word({}), 'idle');
  assert.equal(word({ kind: 'wt', agent: 'working' }), 'working');
  assert.equal(word({ kind: 'wt', agent: 'idle' }), 'idle');
  assert.equal(tabTitle({ title: 'Contracts: cancelled D3 state', slug: '20261123-120428-contracts' }), 'Contracts: cancelled D3 state');
  assert.equal(tabTitle({ title: '20261123-120428-contracts', slug: '20261123-120428-contracts' }), 'contracts', 'no title: the slug without its date');
});

test('the page: a double-click on a sidebar row keeps its tab and does not queue the plan', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const m = src.match(/^function sideDoubleClick\(last, key, now\) \{.*\}$/m);
  assert.ok(m, 'app.js has sideDoubleClick');
  const dbl = new Function(m[0] + '\nreturn sideDoubleClick;')();
  assert.equal(dbl({ key: 'acme/a', at: 1000 }, 'acme/a', 1300), true);
  assert.equal(dbl({ key: 'acme/a', at: 1000 }, 'acme/a', 1400), false, '400 ms or more: two clicks');
  assert.equal(dbl({ key: 'acme/a', at: 1000 }, 'acme/b', 1100), false, 'another row');
  assert.equal(dbl({}, 'acme/a', 1100), false);
  const handler = src.match(/if \(sideDoubleClick\(lastItemClick, key, now\)\) \{[\s\S]*?return;\n\s*\}/);
  assert.ok(handler, 'the row click handler uses sideDoubleClick');
  assert.match(handler[0], /keepTab\(key\)/);
  assert.ok(!/picked/.test(handler[0]), 'only the box queues a plan');
});

test('the page: an alert names the plan like its tab, not by its file name', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const pick = (re) => { const m = src.match(re); assert.ok(m, 'app.js has ' + re); return m[0]; };
  const body = [pick(/^const tabTitle = .*$/m), pick(/^const alertBody = .*$/m)].join('\n');
  const alertBody = new Function('projLook', body + '\nreturn alertBody;')(() => ({ short: 'acme-web' }));
  assert.equal(alertBody({ project: 'acme-web', title: 'Claim type: empty and clear fields', slug: '20261123-204723-claim', pr: { number: 903 } }),
    'acme-web · PR #903 / Claim type: empty and clear fields');
  assert.equal(alertBody({ project: 'acme-web', title: '20261123-204723-claim', slug: '20261123-204723-claim' }), 'acme-web / claim');
  const calls = src.split('\n').filter((l) => /alertUser\('/.test(l) || /^\s+alertBody\(p\)|p\.project \+ ' \/ ' \+ p\.file, p\.key/.test(l));
  assert.ok(calls.length >= 4 && calls.every((l) => !/p\.file/.test(l)), 'no alert uses the file name');
});

test('the page: the merged card shows for a fresh merge or a worktree left on disk, until you close it', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const pick = (re) => { const m = src.match(re); assert.ok(m, 'app.js has ' + re); return m[0]; };
  const shows = new Function(pick(/^const MERGED_CARD_DAYS = .*$/m) + '\n' +
    pick(/^function mergedCardShows\(p, closed, now\) \{[\s\S]*?\n\}$/m) + '\nreturn mergedCardShows;')();
  const now = Date.parse('2026-11-25T12:00:00Z'), day = 86400000;
  const merged = (daysAgo, more = {}) => ({ key: 'acme/a', pr: { state: 'MERGED', mergedAt: new Date(now - daysAgo * day).toISOString() }, ...more });
  const none = new Set();
  assert.equal(shows(merged(1), none, now), true, 'merged yesterday');
  assert.equal(shows(merged(30), none, now), false, 'an old merge stays quiet');
  assert.equal(shows(merged(30, { worktree: true }), none, now), true, 'an old merge with its worktree still on disk');
  assert.equal(shows(merged(1), new Set(['acme/a']), now), false, 'closed with Okay, close');
  assert.equal(shows({ key: 'acme/a', pr: { state: 'OPEN' } }, none, now), false);
  assert.equal(shows({ key: 'acme/a' }, none, now), false);
  assert.equal(shows(null, none, now), false);
  // – hides the card without closing the plan; the merged line has a button that shows it again
  assert.match(src, /if \(small\) \{ M\.hidden = true; return; \}/);
  assert.match(src, /const mergedCardButton = \(p\) => mergedCardShows\(p, mergedClosed, Date\.now\(\)\)/);
  assert.equal((src.match(/'<\/span>' \+ mergedCardButton\(p\) \+ '<a href="'/g) || []).length, 2, 'both merged lines (plan and worktree) have the button');
});

test('the page: the tab label takes a PR number that is a number', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const pick = (re) => { const m = src.match(re); assert.ok(m, 'app.js has ' + re); return m[0]; };
  const body = [pick(/^const esc = .*$/m), pick(/^const escA = .*$/m), pick(/^const tabTitle = .*$/m), pick(/^function tabLabelHtml\(p\) \{[\s\S]*?\n\}$/m)].join('\n');
  const label = new Function('projPill', 'tabStatus', body + '\nreturn tabLabelHtml;')(
    (name) => '<span class="ppill">' + name + '</span>', () => ['live', 'working']);
  const html = label({ project: 'acme', title: 'Fix <b> login', slug: '20260101-000000-fix', pr: { number: 873 } });
  assert.match(html, /<span class="stabpr">#873<\/span>/);
  // a tab with a PR shows its number, not its title, so more tabs fit in the header row
  assert.ok(!/stabn|login/.test(html), 'PR: no title');
  assert.match(html, /<span class="dot stabdot live" title="working"><\/span><span class="srt">working<\/span>/);
  const noPr = label({ project: 'acme', title: 'Fix <b> login', slug: '20260101-000000-fix' });
  assert.ok(!/stabpr/.test(noPr), 'no PR: no number');
  assert.match(noPr, /<span class="stabn">Fix &lt;b&gt; login<\/span>/, 'no PR: the title');
});

test('the page: the big PR number starts the palette, sidebar, run-strip and worktree rows', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const pick = (re) => { const m = src.match(re); assert.ok(m, 'app.js has ' + re); return m[0]; };
  const body = [pick(/^const esc = .*$/m), pick(/^const prStateWord = .*$/m), pick(/^const prNumChip = \(pr\) => \{[\s\S]*?\n\};$/m)].join('\n');
  const chip = new Function(body + '\nreturn prNumChip;')();
  assert.equal(chip({ number: 900, state: 'OPEN', isDraft: true }), '<span class="chip palpr">#900 <small>draft</small></span>');
  assert.equal(chip({ number: 7, state: 'OPEN' }), '<span class="chip palpr ok">#7 <small>open</small></span>');
  assert.equal(chip({ number: 182, state: 'MERGED' }), '<span class="chip palpr merged">#182 <small>merged</small></span>');
  // each row puts the number first and does not show the small PR chip again
  assert.match(src, /<div class="name">\$\{p\.pr \? prNumChip\(p\.pr\) : ''\}/, 'sidebar plan row');
  assert.match(src, /\$\{autoChips\(\{ \.\.\.p, pr: null \}\)/, 'sidebar plan row: no second PR chip');
  assert.match(src, /const stripName = \(p\) => \(p\.pr \? prNumChip\(p\.pr\) : ''\)/, 'run strip');
  assert.ok(!/const stripName = .*prChip\(/.test(src), 'run strip: no second PR chip');
  assert.match(src, /<div class="name">\$\{w\.pr \? prNumChip\(w\.pr\) : ''\}/, 'worktree row');
  assert.match(src, /\$\{wtChips\(w, true\)\}/, 'worktree row: no second PR chip');
  assert.match(src, /\(p\.pr \? prNumChip\(p\.pr\) : ''\) \+\n\s*projPill\(p\.project\)/, 'palette row');
});

test('the page: the chat is always open for a plan with a session, with no button to open or close it', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  assert.match(src, /function syncChat\(p\) \{\n\s*const show = hasChat\(p\);/, 'shown whenever the plan has a session');
  assert.ok(!/id="cclose"|data-chat=|dash-chat-open|chatBtn\(/.test(src), 'no Chat button, no close button, no saved on/off');
});

test('the page: the sticky note stays inside the window, and the page has its menu button and note', async () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const m = src.match(/^function noteClamp\([\s\S]*?\n\}$/m);
  assert.ok(m, 'app.js has noteClamp');
  const noteClamp = new Function(m[0] + '\nreturn noteClamp;')();
  assert.deepEqual(noteClamp(100, 50, 240, 180, 1440, 900), { x: 100, y: 50 }, 'inside: unchanged');
  assert.deepEqual(noteClamp(1400, 880, 240, 180, 1440, 900), { x: 1200, y: 720 }, 'past the right and bottom edges');
  assert.deepEqual(noteClamp(-30, -10, 240, 180, 1440, 900), { x: 0, y: 0 }, 'past the left and top edges');
  assert.deepEqual(noteClamp(10, 10, 240, 180, 200, 100), { x: 0, y: 0 }, 'a window smaller than the note keeps its top bar visible');
  // checkboxes in the note text
  const e = src.match(/^function noteEdit\([\s\S]*?\n\}$/m);
  assert.ok(e, 'app.js has noteEdit');
  const noteEdit = new Function(e[0] + '\nreturn noteEdit;')();
  assert.deepEqual(noteEdit('API:\n-', 6, ' '), { text: 'API:\n☐ ', pos: 7 }, '"-" and a space at a line start make a box');
  assert.equal(noteEdit('a-', 2, ' '), null, 'a "-" inside a line stays');
  assert.equal(noteEdit('--', 2, ' '), null, 'two dashes stay');
  assert.deepEqual(noteEdit('☐ merge', 7, 'Enter'), { text: '☐ merge\n☐ ', pos: 10 }, 'Enter continues the list');
  assert.deepEqual(noteEdit('☐ merge\n☐ ', 10, 'Enter'), { text: '☐ merge\n', pos: 8 }, 'Enter on an empty box ends the list');
  assert.equal(noteEdit('merge', 5, 'Enter'), null, 'Enter on a plain line is a plain Enter');
  assert.deepEqual(noteEdit('x\n☐ merge', 3, 'click'), { text: 'x\n☑ merge', pos: 3 }, 'a click on the box checks it');
  assert.deepEqual(noteEdit('☑ merge', 1, 'click'), { text: '☐ merge', pos: 1 }, 'a second click unchecks it');
  assert.equal(noteEdit('☐ merge', 5, 'click'), null, 'a click on the words does not toggle');
  const mm = src.match(/^function noteMirrorHtml\([\s\S]*?\n\}$/m);
  assert.ok(mm, 'app.js has noteMirrorHtml');
  const noteMirrorHtml = new Function(mm[0] + '\nreturn noteMirrorHtml;')();
  assert.equal(noteMirrorHtml('☑ merge #236\n☐ open <PR>\nplain'), '<s>☑ merge #236</s>\n☐ open &lt;PR&gt;\nplain\n', 'a ticked line is struck through, the text is escaped');
  const page = await (await get('/')).text();
  assert.match(page, /id="noteBtn"/);
  assert.match(page, /id="note" class="note"[^>]*hidden/);
  assert.match(page, /id="notetext"/);
  // – minimizes the note to a round button; the button starts hidden and opens the note again
  assert.match(page, /id="notemin"/);
  assert.match(page, /id="notefab" class="notefab"[^>]*hidden/);
  assert.match(src, /el\.hidden = !note\.open \|\| note\.min;\n\s*fab\.hidden = !note\.open \|\| !note\.min;/);
  // the round button drags (past 5 px) and keeps its place; a click without a drag opens the note
  assert.match(src, /byId\('notefab'\)\.addEventListener\('pointerdown'[\s\S]{0,400}?< 5\) return;[\s\S]{0,200}?note\.x = ev\.clientX - dx; note\.y = ev\.clientY - dy; placeFab\(\);[\s\S]{0,300}?if \(fabDragged\) saveNote\(\);/);
  assert.match(src, /byId\('notefab'\)\.addEventListener\('click', \(\) => \{ if \(fabDragged\) \{ fabDragged = false; return; \} showNote\(true\); \}\);/);
});

test('the page: the first paint and Back reveal and scroll to the open plan', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  assert.match(src, /const reveal = !firstPaint && selected;\n\s*if \(reveal\) revealInSide\(selected\);\n\s*renderList\(\);\n\s*if \(reveal\) scrollToSelected\(\);/);
  // a plan in the run strip is shown there, not in its project section; a click on a strip row does not scroll
  assert.match(src, /function scrollToSelected\(\) \{\n[^\n]*\n\s*const strip = byId\('runstrip'\)\.querySelector\('\.rp\.sel'\);\n\s*if \(strip\) \{[\s\S]{0,300}?strip\.scrollIntoView\(\{ block: 'nearest' \}\); return;\n\s*\}/);
  // each run-strip group is a section, so its caption sticks while its rows scroll
  assert.match(src, /const stripGroup = \(cls, cap, list, row\) => list\.length \? '<div class="sgsec"><div class="cap '/);
  assert.match(src, /selected = el\.dataset\.go; revealInSide\(selected\); renderList\(\); renderDetail\(true\);\n/, 'strip click: no scroll');
  // the row lands below its project's sticky header, measured each time
  assert.match(src, /function scrollToSelected\(\) \{[\s\S]*?querySelector\('\.phead'\);\n\s*el\.style\.scrollMarginTop = \(head \? head\.offsetHeight/);
  assert.match(src, /addEventListener\('popstate', \(\) => \{\n\s*readUrl\(\); if \(selected\) revealInSide\(selected\);[^\n]*\n[^\n]*scrollToSelected\(\);/);
});

test('the page: an outdated project with no GitHub origin keeps the copy-prompt chip', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  assert.match(src, /sp\.bootstrap === 'outdated' && sp\.issuesUrl \? bootstrapUpgradeChip\(pr, sp\)/);
});

test('the page: the chat pins the last message that scrolled above the view', () => {
  const src = readFileSync(path.join(path.dirname(SCRIPT), 'page', 'app.js'), 'utf8');
  const m = src.match(/^function pinnedAsk\(boxes, viewTop\) \{[\s\S]*?\n\}$/m);
  assert.ok(m, 'app.js has pinnedAsk');
  const pinnedAsk = new Function(m[0] + '\nreturn pinnedAsk;')();
  const asks = [{ top: -400, bottom: -350 }, { top: -120, bottom: -60 }, { top: 300, bottom: 340 }];
  assert.equal(pinnedAsk(asks, 0), 1, 'the newest message above the view, not the one still on screen');
  assert.equal(pinnedAsk(asks, -380), -1, 'nothing pinned while every message is in or below the view');
  assert.equal(pinnedAsk([{ top: -40, bottom: 20 }], 0), -1, 'a message cut at the top is still in view');
  assert.equal(pinnedAsk([], 0), -1);
  // the chat panel calls it on its log
  assert.match(src, /jumpToBottom\(L\);\n\s*pinLastAsk\(L\);/);
});
