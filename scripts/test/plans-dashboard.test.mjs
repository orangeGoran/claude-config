// Smoke tests for plans-dashboard.mjs. Every run happens against a throwaway HOME
// and a throwaway repo, so the real registry and the real ~/.claude are never touched.
//
//   node --test 'scripts/test/*.test.mjs'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
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
