// Unit tests of apps/dashboard/watch.mjs, the pure helpers of the event watcher.
//
//   node --test apps/dashboard/test/watch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWaitsFor, prMap, prEvents, outcomeEvents, runningCount, canAutoLaunch, capLines, redact } from '../watch.mjs';

test('watch.mjs has no imports: pure helpers, no npm dependency (AGENTS.md hard rule)', () => {
  const src = readFileSync(new URL('../watch.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\brequire\(|\bimport\(/);
});

const head = (...lines) => ['# Plan: x', '', '- **Base**: main', ...lines, '', '## Goal', '', 'Body.'].join('\n');

test('parseWaitsFor: no line gives null', () => {
  assert.equal(parseWaitsFor(head()), null);
  assert.equal(parseWaitsFor(''), null);
});

test('parseWaitsFor: the three forms, with and without backticks', () => {
  assert.deepEqual(parseWaitsFor(head('- **Waits for**: api PR #7 merged')),
    [{ kind: 'pr', project: 'api', number: 7, text: 'api PR #7 merged' }]);
  assert.deepEqual(parseWaitsFor(head('- **Waits for**: `api PR #7 merged`')),
    [{ kind: 'pr', project: 'api', number: 7, text: 'api PR #7 merged' }]);
  assert.deepEqual(parseWaitsFor(head('* **Waits for**: web plan 20261123-100000-other merged')),
    [{ kind: 'plan', project: 'web', slug: '20261123-100000-other', text: 'web plan 20261123-100000-other merged' }]);
  assert.deepEqual(parseWaitsFor(head('- **Waits for**: `submodule contracts contains abc1234`')),
    [{ kind: 'submodule', path: 'contracts', sha: 'abc1234', text: 'submodule contracts contains abc1234' }]);
});

test('parseWaitsFor: a ## line inside a fence of the header does not end the header', () => {
  const t = '# Plan: x\n\n```\n## Example\n```\n- **Waits for**: api PR #7 merged\n\n## Goal\n';
  assert.deepEqual(parseWaitsFor(t), [{ kind: 'pr', project: 'api', number: 7, text: 'api PR #7 merged' }]);
});

test('parseWaitsFor: two lines give two conditions', () => {
  const c = parseWaitsFor(head('- **Waits for**: api PR #7 merged', '- **Waits for**: submodule libs/contracts contains abc1234def'));
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => x.kind), ['pr', 'submodule']);
  assert.equal(c[1].path, 'libs/contracts');
});

test('parseWaitsFor: a line in a fence of the header, or after the first ## heading, does not count', () => {
  assert.equal(parseWaitsFor(head('```', '- **Waits for**: api PR #7 merged', '```')), null);
  assert.equal(parseWaitsFor('# Plan: x\n\n## Goal\n\n- **Waits for**: api PR #7 merged\n'), null);
  assert.equal(parseWaitsFor('# Plan: x\n\n## Goal\n\n```\n- **Waits for**: api PR #7 merged\n```\n'), null);
});

test('parseWaitsFor: unsafe or unknown conditions are bad', () => {
  for (const t of ['submodule ../x contains abc1234', 'submodule -x contains abc1234', 'submodule /x contains abc1234',
    'api plan ../x merged', 'api plan a..b merged', 'api PR #x merged', 'api PR #12345678 merged', 'when it rains',
    'submodule x contains xyz1234'])
    assert.deepEqual(parseWaitsFor(head('- **Waits for**: ' + t)), [{ kind: 'bad', text: t }], t);
});

test('redact: removes query strings, bearer tokens, key=value secrets and known tokens, and cuts to 500', () => {
  assert.doesNotMatch(redact('HTTP 401 https://x.test/a?token=abc'), /abc/);
  assert.equal(redact("fatal: unable to access 'https://ana:hunter2@git.example.test/r.git/'"),
    "fatal: unable to access 'https://[redacted]@git.example.test/r.git/'");
  for (const s of ['Bearer abc', 'password=abc', 'ghp_abc123', 'github_pat_abc', 'sk-test-0000']) {
    const r = redact('see ' + s + ' here');
    assert.match(r, /\[redacted\]/, s);
    assert.doesNotMatch(r, /abc|0000/, s);
  }
  assert.equal(redact('plain text, nothing secret'), 'plain text, nothing secret');
  assert.equal(redact('x'.repeat(2000)).length, 500);
  assert.equal(redact(null), '');
});

const row = (number, state, extra = {}) => ({ number, state, isDraft: false, title: 'PR ' + number,
  url: 'https://example.test/pr/' + number, headRefName: 'auto/p' + number, baseRefName: 'main',
  mergedAt: state === 'MERGED' ? '2026-11-23T10:05:00Z' : null, createdAt: '2026-11-23T10:01:00Z',
  updatedAt: '2026-11-23T10:05:00Z', ...extra });
const SINCE = '2026-11-23T10:00:00.000Z';

test('prEvents: each event carries title, url, branch and base from its row', () => {
  const [e] = prEvents({ 7: { state: 'OPEN' } }, [row(7, 'MERGED')], SINCE);
  assert.deepEqual(e, { type: 'pr-merged', number: 7, title: 'PR 7', url: 'https://example.test/pr/7', branch: 'auto/p7', base: 'main' });
});

test('prEvents: first tick, new, changed and unchanged PRs', () => {
  assert.deepEqual(prEvents(null, [row(7, 'MERGED')], SINCE), []);
  assert.deepEqual(prEvents({}, [row(7, 'OPEN')], SINCE).map((e) => e.type), ['pr-opened']);
  assert.deepEqual(prEvents({}, [row(7, 'OPEN', { createdAt: '2026-11-22T10:00:00Z' })], SINCE), [], 'opened before the watcher saw the project');
  assert.deepEqual(prEvents({ 7: { state: 'OPEN' } }, [row(7, 'MERGED')], SINCE).map((e) => e.type), ['pr-merged']);
  assert.deepEqual(prEvents({ 7: { state: 'OPEN' } }, [row(7, 'CLOSED')], SINCE).map((e) => e.type), ['pr-closed']);
  assert.deepEqual(prEvents({ 7: { state: 'OPEN' } }, [row(7, 'OPEN')], SINCE), []);
  assert.deepEqual(prEvents({}, [row(7, 'MERGED')], SINCE).map((e) => e.type), ['pr-merged']);
});

test('prEvents: an old PR merged before the watcher saw the project makes no event, also on a second call', () => {
  const old = [row(3, 'MERGED', { mergedAt: '2026-11-20T10:00:00Z', createdAt: '2026-11-19T10:00:00Z' })];
  assert.deepEqual(prEvents({}, old, SINCE), []);
  assert.deepEqual(prEvents(prMap(old, {}), old, SINCE), []);
});

test('prEvents: an old PR the watcher never saw open makes pr-closed when it closes after since', () => {
  assert.deepEqual(prEvents({}, [row(4, 'CLOSED', { createdAt: '2026-11-19T10:00:00Z', closedAt: '2026-11-24T10:00:00Z' })], SINCE)
    .map((e) => [e.type, e.number]), [['pr-closed', 4]]);
  assert.deepEqual(prEvents({}, [row(4, 'CLOSED', { createdAt: '2026-11-19T10:00:00Z', closedAt: '2026-11-20T10:00:00Z' })], SINCE), [],
    'closed before the watcher saw the project');
});

test('prEvents: a number in prev that is missing from the rows makes no event', () => {
  assert.deepEqual(prEvents({ 7: { state: 'OPEN' }, 9: { state: 'OPEN' } }, [row(7, 'OPEN')], SINCE), []);
});

test('prEvents: GitHub and toISOString times compare by value', () => {
  assert.deepEqual(prEvents({}, [row(7, 'MERGED', { mergedAt: '2026-11-23T10:00:00Z' })], '2026-11-23T10:00:00.000Z'), [], 'equal is not after');
  assert.equal(prEvents({}, [row(7, 'MERGED', { mergedAt: '2026-11-23T10:00:01Z' })], '2026-11-23T10:00:00.000Z').length, 1);
});

test('prMap: writes the rows as { state } over prev and keeps the other numbers', () => {
  const prev = { 1: { state: 'MERGED' }, 7: { state: 'OPEN' } };
  assert.deepEqual(prMap([row(7, 'MERGED'), row(8, 'OPEN')], prev), { 1: { state: 'MERGED' }, 7: { state: 'MERGED' }, 8: { state: 'OPEN' } });
  assert.deepEqual(prev, { 1: { state: 'MERGED' }, 7: { state: 'OPEN' } }, 'prev is not changed');
  assert.deepEqual(prMap([row(2, 'OPEN')], null), { 2: { state: 'OPEN' } });
});

test('prMap and prEvents: a later tick sees an old number merged after since once', () => {
  let prev = { 7: { state: 'OPEN' } };
  const rows = [row(2, 'MERGED')];
  assert.deepEqual(prEvents(prev, rows, SINCE).map((e) => [e.type, e.number]), [['pr-merged', 2]]);
  prev = prMap(rows, prev);
  assert.deepEqual(prEvents(prev, rows, SINCE), []);
});

test('outcomeEvents: first tick, a change, and no change', () => {
  assert.deepEqual(outcomeEvents(null, { a: { outcome: 'running', status: 'RUNNING' } }), []);
  assert.deepEqual(outcomeEvents({ a: { outcome: 'running', status: 'RUNNING' } }, { a: { outcome: 'needs-you', status: 'PR OPEN — x' } }),
    [{ type: 'run-outcome', slug: 'a', outcome: 'needs-you', status: 'PR OPEN — x', previous: 'running' }]);
  assert.deepEqual(outcomeEvents({ a: { outcome: 'running', status: 'RUNNING' } }, { a: { outcome: 'running', status: 'RUNNING' } }), []);
  assert.deepEqual(outcomeEvents({ a: { outcome: 'running', status: 'RUNNING' } }, { a: { outcome: 'running', status: 'TESTED' } }).length, 1, 'a status change');
  assert.deepEqual(outcomeEvents({}, { b: { outcome: 'running', status: 'RUNNING' } })[0].previous, null, 'a new slug');
});

test('runningCount: counts live, starting and fresh running reports only', () => {
  const now = 1_000_000_000, stale = 30 * 60 * 1000;
  const run = (outcome, status) => ({ outcome, status });
  const plans = [
    { live: true, run: run('running', 'RUNNING'), reportAt: now - 2 * stale },   // live, old report
    { live: false, launch: { state: 'starting' }, run: null },
    { live: false, run: run('running', 'RUNNING'), reportAt: now - 1000 },
    { live: false, run: run('needs-you', 'PR OPEN — x'), reportAt: now },
    { live: false, run: run('failed', 'FAILED: test'), reportAt: now },
    { live: false, run: run('running', 'CLEANED — worktree removed'), reportAt: now },
    { live: false, run: run('running', 'unknown'), reportAt: now },
    { live: false, run: run('running', 'RUNNING'), reportAt: now - 2 * stale },
    { live: false, launch: { state: 'failed' }, run: null },
  ];
  assert.equal(runningCount(plans, now, stale), 3);
  assert.equal(runningCount([], now, stale), 0);
});

test('canAutoLaunch: true only when all conditions hold', () => {
  const plan = { slug: 's', run: null, live: false, launch: null, worktree: false, chatting: false, chatWaits: 0, status: null };
  const met = [{ met: true }, { met: true }];
  assert.equal(canAutoLaunch(plan, met, {}, 0, 4), true);
  assert.equal(canAutoLaunch({ ...plan, status: 'next' }, met, {}, 3, 4), true);
  const no = {
    'one not met': [plan, [{ met: true }, { met: false }], {}, 0],
    'empty waits': [plan, [], {}, 0],
    'no waits': [plan, null, {}, 0],
    'already launched': [plan, met, { s: { state: 'started' } }, 0],
    'a run report': [{ ...plan, run: { outcome: 'running' } }, met, {}, 0],
    live: [{ ...plan, live: true }, met, {}, 0],
    launching: [{ ...plan, launch: { state: 'starting' } }, met, {}, 0],
    'a worktree': [{ ...plan, worktree: true }, met, {}, 0],
    chatting: [{ ...plan, chatting: true }, met, {}, 0],
    'a permission question': [{ ...plan, chatWaits: 1 }, met, {}, 0],
    parked: [{ ...plan, status: 'parked' }, met, {}, 0],
    proposed: [{ ...plan, status: 'proposed' }, met, {}, 0],
    'at the limit': [plan, met, {}, 4],
  };
  for (const [why, [p, w, l, r]] of Object.entries(no)) assert.equal(canAutoLaunch(p, w, l, r, 4), false, why);
});

// the page's autoChips() from app.js, with its helpers: the sidebar rows and the board cards use it
const autoChips = (() => {
  const src = readFileSync(new URL('../page/app.js', import.meta.url), 'utf8');
  const pick = (re) => { const m = src.match(re); assert.ok(m, 'app.js has ' + re); return m[0]; };
  const body = [
    pick(/^const esc = .*$/m), pick(/^const outOf = .*$/m), pick(/^const OUT_CLASS = .*$/m),
    pick(/^const starting = .*$/m), pick(/^const notStarted = .*$/m), pick(/^const escA = .*$/m),
    pick(/^const autoChips = \(p\) => \{[\s\S]*?\n\};$/m),
  ].join('\n');
  return new Function('chatChip', 'prChip', body + '\nreturn autoChips;')(() => '', () => '');
})();
const chipPlan = (extra = {}) => ({ waits: [{ text: 'api PR #7 merged', met: false, error: null }], run: null, live: false, launch: null, ...extra });

test('the page: a waiting plan shows ⏳ waits with each condition and its error in the title', () => {
  const html = autoChips(chipPlan({ waits: [{ text: 'api PR #7 merged', met: true, error: null }, { text: 'nope PR #1 merged', met: false, error: 'unknown <project>' }] }));
  assert.match(html, /⏳ waits/);
  assert.match(html, /title="Starts by itself when: api PR #7 merged ✓; nope PR #1 merged ✗ \(unknown &lt;project&gt;\)"/);
});

test('the page: no waits chip without waits, when all are met, or once the plan started', () => {
  for (const [why, p] of Object.entries({
    'no Waits for line': chipPlan({ waits: null }),
    'all met': chipPlan({ waits: [{ text: 'api PR #7 merged', met: true, error: null }] }),
    'a run': chipPlan({ run: { outcome: 'running', status: 'RUNNING' } }),
    live: chipPlan({ live: true }),
    starting: chipPlan({ launch: { state: 'starting' } }),
  })) assert.doesNotMatch(autoChips(p), /⏳ waits/, why);
});

test('capLines: keeps the last max lines', () => {
  assert.equal(capLines('a\nb\nc\n', 2), 'b\nc\n');
  assert.equal(capLines('a\nb\nc', 2), 'b\nc');
  assert.equal(capLines('a\nb\n', 5), 'a\nb\n');
  assert.equal(capLines('', 5), '');
});
