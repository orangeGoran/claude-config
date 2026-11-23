// Tests for apps/scout/scout.mjs. The end-to-end runs use a throwaway HOME and fake gh, aws and claude
// commands, so no test talks to GitHub, AWS or the Anthropic API.
//
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeRoute, redact, errorKey, mergeRoutes, slowRoutes, errorSpikes,
  ciRedFindings, flakyFindings, stuckPrFindings, securityFindings, decide, proposalText, learn, outcomeOf,
  plistTemplate,
} from '../scout.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scout.mjs');
const DAY = 864e5;
const NOW = Date.parse('2026-11-20T07:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

test('--install reads the launchd template from scripts/launchd/ of this checkout', () => {
  assert.match(plistTemplate(), /\/scripts\/launchd\/com\.plans-dashboard\.scout\.plist\.template$/);
  assert.ok(existsSync(plistTemplate()), `${plistTemplate()} exists`);
});

test('routes lose their ids, so one endpoint is one row', () => {
  assert.equal(normalizeRoute('/v1/cases/3f2a1b4c-1111-2222-3333-444455556666/report?x=1'), '/v1/cases/:id/report');
  assert.equal(normalizeRoute('/v1/items/42'), '/v1/items/:n');
  assert.equal(normalizeRoute('/v1/invite/ab12cd34ef56gh78ij90'), '/v1/invite/:token');
  assert.equal(normalizeRoute('/v1/users/me'), '/v1/users/me');
});

test('production text loses emails, ids, IPs and secrets before it is written or sent', () => {
  const s = redact('user ana@x.com tenant 3f2a1b4c-1111-2222-3333-444455556666 from 10.0.0.12 token=abc123');
  assert.equal(s, 'user <email> tenant <id> from <ip> token=<redacted>');
  assert.equal(errorKey('Case 3f2a1b4c-1111-2222-3333-444455556666 not found at row 17'), 'Case <id> not found at row N');
});

test('an endpoint is slow when its p95 doubled, is over 500 ms and has enough requests', () => {
  const today = mergeRoutes([
    { method: 'GET', url: '/v1/cases/3f2a1b4c-1111-2222-3333-444455556666/report', n: 200, p95: 2400 },
    { method: 'GET', url: '/v1/cases/9f2a1b4c-1111-2222-3333-444455556666/report', n: 110, p95: 2000 },
    { method: 'GET', url: '/v1/users/me', n: 500, p95: 300 },
    { method: 'POST', url: '/v1/rare', n: 3, p95: 9000 },
  ]);
  const base = mergeRoutes([
    { method: 'GET', url: '/v1/cases/1f2a1b4c-1111-2222-3333-444455556666/report', n: 2000, p95: 600 },
    { method: 'GET', url: '/v1/users/me', n: 4000, p95: 100 },
    { method: 'POST', url: '/v1/rare', n: 30, p95: 100 },
  ]);
  const slow = slowRoutes(today, base);
  assert.deepEqual(slow.map((r) => r.route), ['GET /v1/cases/:id/report'], 'users/me is under the floor; rare has too few requests');
  assert.equal(slow[0].n, 310);
  assert.equal(slow[0].p95, 2400);
  assert.equal(slow[0].baseP95, 600);
});

test('errors: new ones always, known ones at 3× their daily average', () => {
  const r = errorSpikes(
    [{ key: 'new', n: 1 }, { key: 'spike', n: 30 }, { key: 'usual', n: 8 }],
    [{ key: 'spike', n: 14 }, { key: 'usual', n: 56 }]);
  assert.deepEqual(r.map((x) => x.key), ['new', 'spike']);
});

test('GitHub checks: red workflow, flaky test, stuck PRs, security alerts', () => {
  const runs = [
    { databaseId: 3, workflowName: 'CI', conclusion: 'failure', status: 'completed', headSha: 'c'.repeat(40), createdAt: iso(1 * 3600e3), url: 'u3', attempt: 1 },
    { databaseId: 2, workflowName: 'CI', conclusion: 'failure', status: 'completed', headSha: 'b'.repeat(40), createdAt: iso(2 * 3600e3), url: 'u2', attempt: 1 },
    { databaseId: 1, workflowName: 'CI', conclusion: 'success', status: 'completed', headSha: 'a'.repeat(40), createdAt: iso(3 * 3600e3), url: 'u1', attempt: 1 },
    { databaseId: 5, workflowName: 'E2E', conclusion: 'success', status: 'completed', headSha: 'd'.repeat(40), createdAt: iso(DAY), url: 'u5', attempt: 2 },
    { databaseId: 6, workflowName: 'E2E', conclusion: 'success', status: 'completed', headSha: 'e'.repeat(40), createdAt: iso(9 * DAY), url: 'u6', attempt: 2 },
  ];
  const red = ciRedFindings(runs, 'develop');
  assert.deepEqual(red.map((f) => [f.key, f.size]), [['ci-red:CI', 2]]);
  const flaky = flakyFindings(runs, 'develop', NOW);
  assert.deepEqual(flaky.map((f) => [f.key, f.size]), [['flaky:E2E', 1]], 'the run older than 7 days does not count');

  const prs = stuckPrFindings([
    { number: 7, title: 'A', url: 'p7', updatedAt: iso(DAY), mergeable: 'CONFLICTING', isDraft: false, baseRefName: 'develop' },
    { number: 8, title: 'B', url: 'p8', updatedAt: iso(9 * DAY), mergeable: 'MERGEABLE', isDraft: true, baseRefName: 'develop' },
    { number: 9, title: 'C', url: 'p9', updatedAt: iso(DAY), mergeable: 'MERGEABLE', isDraft: false, baseRefName: 'develop' },
  ], NOW);
  assert.deepEqual(prs.map((f) => f.key), ['pr:7:conflicts', 'pr:8:idle']);

  const sec = securityFindings([
    { number: 1, html_url: 'a1', dependency: { package: { ecosystem: 'npm', name: 'axios' } }, security_advisory: { ghsa_id: 'GHSA-1', severity: 'medium', summary: 's' }, security_vulnerability: { first_patched_version: { identifier: '1.2.3' } } },
    { number: 2, html_url: 'a2', dependency: { package: { ecosystem: 'npm', name: 'axios' } }, security_advisory: { ghsa_id: 'GHSA-2', severity: 'high', summary: 's' }, security_vulnerability: {} },
  ]);
  assert.equal(sec.length, 1);
  assert.equal(sec[0].key, 'dep:npm:axios');
  assert.match(sec[0].title, /high/);
});

test('a finding is proposed once; a dismissed one again at 2×; a fixed one again after 14 days', () => {
  assert.equal(decide(undefined, undefined, 5, NOW).propose, true);
  assert.equal(decide({ size: 5 }, 'active', 50, NOW).propose, false);
  assert.equal(decide({ size: 5 }, 'dismissed', 9, NOW).propose, false);
  assert.equal(decide({ size: 5 }, 'dismissed', 10, NOW).propose, true);
  assert.equal(decide({ size: 5 }, 'gone', 5, NOW).propose, true, 'a lost proposal file is proposed again');
  const first = decide({ size: 5 }, 'done', 5, NOW);
  assert.equal(first.propose, false);
  assert.equal(decide({ size: 5, resolvedAt: first.resolvedAt }, 'done', 5, NOW + 14 * DAY).propose, true);
});

test('the proposal names its check and key and leaves out an unknown direction', () => {
  const t = proposalText({ base: 'develop' }, { check: 'ci-red', key: 'ci-red:CI', title: 'Fix CI', evidence: '- red' },
    { summary: 'CI is red.', direction: 'unknown' }, new Date('2026-11-20T07:00:00Z'));
  assert.match(t, /^# Scout: Fix CI\n/);
  assert.match(t, /\*\*Scout key\*\*: `ci-red:CI`/);
  assert.doesNotMatch(t, /Suggested direction/);
});

test('what became of a proposal', () => {
  assert.equal(outcomeOf('proposed', true, false), 'waiting');
  assert.equal(outcomeOf('dismissed', false, true), 'dismissed');
  assert.equal(outcomeOf('resolved', false, true), 'resolved');
  assert.equal(outcomeOf(null, true, false), 'confirmed', 'confirmed: the status was cleared and the plan is there');
  assert.equal(outcomeOf(null, false, false), 'gone');
});

test('the scout learns: 5 dismissals in a row mute a check, 3 proposals without a confirm mute a finding', () => {
  const out = {};
  const state = { findings: {} };
  // five different stuck PRs, all dismissed
  for (let i = 1; i <= 5; i++) {
    state.findings[`pr:${i}:idle`] = { slug: 's' + i, at: `2026-11-0${i}`, check: 'stuck-prs', title: 'PR ' + i };
    out['s' + i] = 'dismissed';
  }
  // one CI finding proposed 3 times: resolved, dismissed, resolved
  state.findings['ci-red:CI'] = { slug: 'c3', check: 'ci-red', title: 'Fix CI', history: [{ slug: 'c1', at: '2026-11-01' }, { slug: 'c2', at: '2026-11-03' }, { slug: 'c3', at: '2026-11-05' }] };
  Object.assign(out, { c1: 'resolved', c2: 'dismissed', c3: 'resolved' });
  let L = learn(state, (slug) => out[slug]);
  assert.match(L.mutedChecks['stuck-prs'], /dismissed its last 5/);
  assert.equal(L.mutedKeys['ci-red:CI'].why, 'proposed 3 times, never confirmed');
  assert.equal(L.mutedChecks['ci-red'], undefined, 'resolved proposals break the row');
  assert.deepEqual(L.stats['stuck-prs'], { waiting: 0, confirmed: 0, dismissed: 5, resolved: 0, gone: 0, proposed: 5 });

  // a confirm in the last five unmutes the check; a confirm of the finding unmutes it
  out.s3 = 'confirmed'; out.c2 = 'confirmed';
  L = learn(state, (slug) => out[slug]);
  assert.equal(L.mutedChecks['stuck-prs'], undefined);
  assert.equal(L.mutedKeys['ci-red:CI'], undefined);

  // Unmute counts only what comes after it
  out.s3 = 'dismissed'; out.c2 = 'dismissed';
  L = learn({ ...state, unmuted: { 'check:stuck-prs': '2026-11-04', 'key:ci-red:CI': '2026-11-04' } }, (slug) => out[slug]);
  assert.equal(L.mutedChecks['stuck-prs'], undefined, 'only one dismissal after Unmute');
  assert.equal(L.mutedKeys['ci-red:CI'], undefined, 'only one proposal after Unmute');
});

// ---------- end to end ----------
let tmp, home, repo, plansDir, bin;
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), a = process.argv.slice(2), d = process.env.FAKE_DIR;
fs.appendFileSync(path.join(d, 'gh.log'), a.join(' ') + '\\n');
const f = a[0] === 'run' ? 'runs.json' : a[0] === 'pr' ? 'prs.json' : 'alerts.json';
process.stdout.write(fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f)) : '[]');
`;
// start-query answers with the query's kind; get-query-results returns the rows saved for it
const FAKE_AWS = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), a = process.argv.slice(2), d = process.env.FAKE_DIR;
fs.appendFileSync(path.join(d, 'aws.log'), a.join(' ') + '\\n');
if (a[1] === 'start-query') {
  const q = a[a.indexOf('--query-string') + 1], from = +a[a.indexOf('--start-time') + 1];
  const kind = (q.includes('responseTime') ? 'routes' : 'errors') + '-' + (Date.now() / 1000 - from < 2 * 86400 ? 'today' : 'base');
  process.stdout.write(JSON.stringify({ queryId: kind }));
} else {
  const id = a[a.indexOf('--query-id') + 1], f = path.join(d, id + '.json');
  const rows = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  process.stdout.write(JSON.stringify({ status: 'Complete', results: rows.map((r) => Object.entries(r).map(([field, value]) => ({ field, value: String(value) }))) }));
}
`;
const FAKE_CLAUDE = `#!/usr/bin/env node
require('fs').appendFileSync(require('path').join(process.env.FAKE_DIR, 'claude.log'), process.argv.slice(2).join(' ') + '\\n');
const n = require('fs').readFileSync(require('path').join(process.env.FAKE_DIR, 'claude.log'), 'utf8').trim().split('\\n').length;
process.stdout.write(JSON.stringify({ type: 'result', session_id: 'ses-scout-' + n,
  result: JSON.stringify({ summary: 'The summary.', direction: 'Look at the report query.' }) }));
`;
const scout = (args = []) => new Promise((resolve) => {
  execFile(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH, FAKE_DIR: tmp, SCOUT_NO_NOTIFY: '1' },
  }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out: String(out), err: String(errOut) }));
});
const meta = () => JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'plan-meta.json'), 'utf8'));
const proposals = () => readdirSync(plansDir).filter((f) => f.includes('-scout-'));

before(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'scout-test-')));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  plansDir = path.join(repo, '.plans');
  bin = path.join(tmp, 'bin');
  for (const d of [bin, plansDir, path.join(home, '.claude')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  writeFileSync(path.join(bin, 'aws'), FAKE_AWS, { mode: 0o755 });
  writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  writeFileSync(path.join(home, '.claude', 'pipeline-projects.json'), JSON.stringify({ projects: [{ name: 'api', root: repo }] }));
  writeFileSync(path.join(home, '.claude', 'scout.json'), JSON.stringify({ projects: { api: {
    base: 'develop', checks: ['ci-red', 'prod-errors', 'slow-endpoints'],
    aws: { profile: 'api-scout', region: 'eu-west-1', logGroups: ['/api/prod/api'] } } } }));
  const now = Date.now();
  writeFileSync(path.join(tmp, 'runs.json'), JSON.stringify([
    { databaseId: 3, workflowName: 'CI', conclusion: 'failure', status: 'completed', headSha: 'c'.repeat(40), createdAt: new Date(now - 3600e3).toISOString(), url: 'https://github.com/o/r/actions/runs/3', attempt: 1 },
  ]));
  writeFileSync(path.join(tmp, 'errors-today.json'), JSON.stringify([
    { msg: 'request failed', 'err.type': 'TypeError', 'err.message': 'Cannot read x of undefined for ana@x.com', n: 12, stack: 'TypeError: ...\n    at report.service.ts:40', url: '/v1/cases/3f2a1b4c-1111-2222-3333-444455556666/report', sha: 'f'.repeat(40) },
  ]));
  writeFileSync(path.join(tmp, 'routes-today.json'), JSON.stringify([{ 'req.method': 'GET', 'req.url': '/v1/cases/3f2a1b4c-1111-2222-3333-444455556666/report', n: 310, p95: 2400 }]));
  writeFileSync(path.join(tmp, 'routes-base.json'), JSON.stringify([{ 'req.method': 'GET', 'req.url': '/v1/cases/1f2a1b4c-1111-2222-3333-444455556666/report', n: 2000, p95: 600 }]));
});
after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

test('a dry run prints the findings and writes nothing', async () => {
  const r = await scout(['--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /api: 3 finding\(s\), 3 new proposal\(s\)/);
  assert.deepEqual(proposals(), []);
  assert.equal(existsSync(path.join(tmp, 'claude.log')), false);
});

test('a run writes one proposal per finding, marked proposed, with production text redacted', async () => {
  const r = await scout();
  assert.equal(r.code, 0, r.err);
  const files = proposals();
  assert.equal(files.length, 3);
  const m = meta();
  for (const f of files) assert.deepEqual(m[f.replace(/\.md$/, '')].status, 'proposed');
  const err = readFileSync(path.join(plansDir, files.find((f) => f.includes('prod-errors'))), 'utf8');
  assert.match(err, /^# Scout: Fix the production error "TypeError: Cannot read x of undefined for <email>"/);
  assert.match(err, /The summary\./);
  assert.match(err, /Last seen on `\/v1\/cases\/:id\/report`/);
  assert.doesNotMatch(err, /ana@x\.com|3f2a1b4c/);
  assert.match(readFileSync(path.join(tmp, 'aws.log'), 'utf8'), /--profile api-scout --region eu-west-1/);
  // each step says what it checks and what it found, as it goes
  assert.match(r.out, /→ CI on develop: red workflows[^\n]*\n\s+1 run\(s\) read: 1 red workflow\(s\), 0 flaky workflow\(s\) \(\d+\.\d+s\)/);
  assert.match(r.out, /→ Writing 3 proposal\(s\): sonnet writes/);
  assert.match(r.out, /done in \d+\.\d+s/);
  // the summary's session is the proposal's chat on the dashboard
  const slug = files[0].replace(/\.md$/, '');
  const chat = JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'ask', slug + '.json'), 'utf8'));
  assert.equal(chat.root, true);
  assert.match(chat.current.id, /^ses-scout-\d+$/);
  assert.deepEqual(chat.own, [chat.current.id]);
  const last = JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'scout.json'), 'utf8')).lastRun;
  assert.equal(last.made.length, 3);
  assert.equal(existsSync(path.join(home, '.claude', 'pipeline-dashboard', 'scout.lock')), false, 'the lock is gone after the run');
});

test('a second run makes no duplicates; a dismissed finding returns only at 2×', async () => {
  const second = (await scout()).out;
  assert.match(second, /api: 3 finding\(s\), 0 new proposal\(s\)/);
  assert.match(second, /· skip "Fix the red "CI" workflow on develop": already waits as /);

  // Dismiss on the dashboard: status "dismissed", file moved to done/
  const slow = proposals().find((f) => f.includes('slow-endpoints')).replace(/\.md$/, '');
  const metaFile = path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'plan-meta.json');
  const m = meta(); m[slow].status = 'dismissed'; writeFileSync(metaFile, JSON.stringify(m));
  mkdirSync(path.join(plansDir, 'done'), { recursive: true });
  renameSync(path.join(plansDir, slow + '.md'), path.join(plansDir, 'done', slow + '.md'));
  assert.match((await scout()).out, /0 new proposal\(s\)/, '2400 ms is not 2× the 2400 ms it was dismissed at');

  writeFileSync(path.join(tmp, 'routes-today.json'), JSON.stringify([{ 'req.method': 'GET', 'req.url': '/v1/cases/3f2a1b4c-1111-2222-3333-444455556666/report', n: 400, p95: 5000 }]));
  const r = await scout();
  assert.match(r.out, /1 new proposal\(s\)/);
  const again = proposals().find((f) => f.includes('slow-endpoints'));
  assert.match(readFileSync(path.join(plansDir, again), 'utf8'), /got 2× worse after it was dismissed/);
});

test('a failed check is reported, and the other checks still run', async () => {
  writeFileSync(path.join(bin, 'aws'), '#!/bin/sh\necho "Token has expired" >&2\nexit 255\n', { mode: 0o755 });
  const r = await scout(['--dry-run']);
  assert.equal(r.code, 0);
  assert.match(r.out, /! prod-errors: .*Token has expired/);
  assert.match(r.out, /! slow-endpoints: .*Token has expired/);
});

test('a waiting proposal whose problem is gone is archived as resolved, and comes back if the problem does', async () => {
  // the log checks fail from here on (the test before broke aws): only CI ran fine, so only CI resolves
  const state = () => JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'scout.json'), 'utf8'));
  const ci = state().findings['ci-red:CI'].slug;
  const red = readFileSync(path.join(tmp, 'runs.json'), 'utf8');
  writeFileSync(path.join(tmp, 'runs.json'), '[]');
  let r = await scout();
  assert.match(r.out, /✓ resolved on its own: "Fix the red "CI" workflow on develop"/);
  assert.equal(existsSync(path.join(plansDir, 'done', ci + '.md')), true);
  assert.equal(meta()[ci].status, 'resolved');
  assert.ok(proposals().some((f) => f.includes('prod-errors')), 'the error proposal stays: its check failed this time');

  writeFileSync(path.join(tmp, 'runs.json'), red);
  r = await scout();
  assert.match(r.out, /1 new proposal\(s\)/);
  const again = proposals().find((f) => f.includes('ci-red'));
  assert.match(readFileSync(path.join(plansDir, again), 'utf8'), /came back after it went away on its own/);

  // each run is kept as data for the dashboard, newest first, with its steps
  const runs = JSON.parse(readFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'scout-runs.json'), 'utf8'));
  assert.equal(runs[0].made.length, 1);
  assert.equal(runs[1].resolved[0].check, 'ci-red');
  assert.deepEqual(runs[0].steps[0].tags, ['ci-red']);
  assert.equal(runs[0].steps.find((x) => x.what === 'Production errors').failed, true);
  assert.equal(existsSync(path.join(home, '.claude', 'pipeline-dashboard', 'scout-current.json')), false, 'the live file is gone after the run');
});

test('at most maxOpen proposals wait; the rest waits for room', async () => {
  const cfg = path.join(home, '.claude', 'scout.json'), was = readFileSync(cfg, 'utf8');
  const c = JSON.parse(was);
  c.projects.api.maxOpen = 1;
  c.projects.api.checks = ['ci-red'];
  writeFileSync(cfg, JSON.stringify(c));
  // a second red workflow is a new finding, but a proposal already waits
  writeFileSync(path.join(tmp, 'runs.json'), JSON.stringify([...JSON.parse(readFileSync(path.join(tmp, 'runs.json'), 'utf8')),
    { databaseId: 9, workflowName: 'Lint', conclusion: 'failure', status: 'completed', headSha: 'd'.repeat(40), createdAt: new Date().toISOString(), url: 'u9', attempt: 1 }]));
  try {
    const r = await scout();
    assert.match(r.out, /· 1 finding\(s\) wait for room: \d+ proposal\(s\) already wait for you \(maxOpen 1\)/);
    assert.match(r.out, /0 new proposal\(s\)/);
  } finally { writeFileSync(cfg, was); }
});

test('a muted check still runs, but proposes nothing', async () => {
  const stateFile = path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'scout.json');
  const st = JSON.parse(readFileSync(stateFile, 'utf8'));
  // pretend you dismissed five red-CI proposals in a row, after the last one that resolved itself
  const m = meta();
  for (let i = 1; i <= 5; i++) { st.findings['ci-red:Old' + i] = { slug: 'old' + i, at: '2027-01-0' + i, check: 'ci-red', title: 'Old ' + i }; m['old' + i] = { status: 'dismissed' }; }
  writeFileSync(stateFile, JSON.stringify(st));
  writeFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'state', 'api', 'plan-meta.json'), JSON.stringify(m));
  // resolve the waiting CI proposal first, so the red CI is a fresh finding
  for (const f of proposals().filter((x) => x.includes('ci-red'))) rmSync(path.join(plansDir, f));
  const r = await scout();
  assert.match(r.out, /· muted "Fix the red "CI" workflow on develop": the ci-red check is muted: you dismissed its last 5 proposals/);
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.ok(saved.learn.mutedChecks['ci-red']);
  assert.equal(saved.checkRuns['ci-red'].runs >= 1, true);
});
