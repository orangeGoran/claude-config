// Smoke tests for plans-dashboard.mjs. Every run happens against a throwaway HOME
// and a throwaway repo, so the real registry and the real ~/.claude are never touched.
//
//   node --test 'scripts/test/*.test.mjs'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync, realpathSync, utimesSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameNameIn, writeVersioned } from '../page-versions.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plans-dashboard.mjs');
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
if (a[1] === 'list') process.stdout.write(fs.existsSync(path.join(dir, 'list.json')) ? fs.readFileSync(path.join(dir, 'list.json')) : '[]');
else if (a[1] === 'view') process.stdout.write(JSON.stringify({ body: fs.existsSync(body) ? fs.readFileSync(body, 'utf8') : '',
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
    // a new step starts streaming and nothing else happens for a while
    if (/^step/.test(q)) {
      out({ type: 'stream_event', session_id: id, parent_tool_use_id: null, event: { type: 'message_start' } });
      return setTimeout(() => out({ type: 'result', subtype: 'success', is_error: false, session_id: id, total_cost_usd: 0.01 }), 2000);
    }
    out({ type: 'system', subtype: 'init', session_id: id, permissionMode: mode });
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
           PATH: path.join(ghDir, 'bin') + ':' + process.env.PATH, FAKE_GH_DIR: ghDir },
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
  // chats outlive the server on purpose (scripts/chat-relay.mjs): end the ones this run left
  const chatDir = path.join(home, '.claude', 'pipeline-dashboard', 'chats', String(port));
  for (const f of existsSync(chatDir) ? readdirSync(chatDir) : []) {
    try { execFileSync('pkill', ['-f', JSON.parse(readFileSync(path.join(chatDir, f), 'utf8')).sock]); } catch {}
  }
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
    ['| a | b |\n|---|-', '<table><tr><th>a</th><th>b</th></tr></table>'],
    ['**done** and ' + BT + 'ok' + BT, '<p><b>done</b> and <code>ok</code></p>'],
  ]) assert.equal(render(partial).trim(), html, partial);
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
  assert.equal(byName['ready-repo'].level, 'green');
  assert.equal(byName['ready-repo'].client, 'Acme');
  const b = byName['bare-repo'];
  assert.equal(b.level, 'red');
  const failing = b.checks.filter((c) => !c.ok).map((c) => c.id).sort();
  assert.deepEqual(failing, ['allow', 'claudemd', 'launch', 'plans', 'plansDir', 'skills']);
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
  assert.equal(s.find((p) => p.name === 'ready-repo').setupLevel, 'green');
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
  assert.match(calls().split('\n').slice(-3).join('\n'), /^pr list /m, 'the action re-reads the PR list');
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
  assert.match(list, /href="\/solver\/2026-11-01-cases-report\.html" download="2026-11-01-cases-report\.html"/, 'each report has a Download button');
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
  assert.ok(list.indexOf('solver · artifacts') > list.indexOf('<h2>solver ') && list.indexOf('solver · artifacts') < list.indexOf('Other artifacts'),
    "a project's artifacts come right after its reports, the rest at the end");
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
