// Unit tests of apps/dashboard/groups.mjs, the pure helpers of the group ledger and the checklist.
//
//   node --test apps/dashboard/test/groups.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeGroup, parseTickets, ticketKey, planStep, buildChain, groupSummary, ledgerTemplate } from '../groups.mjs';

test('groups.mjs has no imports: pure helpers, no npm dependency (AGENTS.md hard rule)', () => {
  const src = readFileSync(new URL('../groups.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\brequire\(|\bimport\(/);
});

test('safeGroup: good and bad names', () => {
  for (const s of ['acme-product', 'a.b_c', 'a'.repeat(40)]) assert.equal(safeGroup(s), true, s);
  for (const s of ['', '.', '..', 'a/b', 'a b', 'a'.repeat(41), null, 7]) assert.equal(safeGroup(s), false, String(s));
});

const head = (...lines) => ['# Plan: x', '', '- **Base**: main', ...lines, '', '## Goal', '', 'Body.'].join('\n');

test('parseTickets: reads the header line', () => {
  assert.deepEqual(parseTickets(head('- **Tickets**: #41, example/acme-api#7')),
    [{ repo: null, number: 41 }, { repo: 'example/acme-api', number: 7 }]);
  assert.deepEqual(parseTickets(head('* **Tickets**: #41 #41')), [{ repo: null, number: 41 }]);
  assert.deepEqual(parseTickets(head('- **Tickets**: none')), []);
  assert.deepEqual(parseTickets(head()), []);
  assert.deepEqual(parseTickets(''), []);
});

test('parseTickets: skips fragments, removes backticks', () => {
  assert.deepEqual(parseTickets(head('- **Tickets**: abc#41, #12345678, acme-api#41, https://github.com/example/acme-api/issues/41, #7')),
    [{ repo: null, number: 7 }]);
  assert.deepEqual(parseTickets(head('- **Tickets**: `#41`')), [{ repo: null, number: 41 }]);
});

test('parseTickets: ignores the body and fences', () => {
  assert.deepEqual(parseTickets('# Plan: x\n\n## Goal\n\n- **Tickets**: #41\n'), []);
  assert.deepEqual(parseTickets('# Plan: x\n\n```\n- **Tickets**: #41\n```\n\n## Goal\n'), []);
  assert.deepEqual(parseTickets('# Plan: x\n\n```\n## Example\n```\n- **Tickets**: #41\n\n## Goal\n'), [{ repo: null, number: 41 }]);
});

test('ticketKey: repo, issues URL, neither, and case', () => {
  assert.deepEqual(ticketKey({ repo: 'example/acme-api', number: 41 }, '', 'acme-web'),
    { key: 'example/acme-api#41', url: 'https://github.com/example/acme-api/issues/41' });
  assert.deepEqual(ticketKey({ repo: null, number: 41 }, 'https://github.com/example/acme-api/issues/', 'acme-api'),
    { key: 'example/acme-api#41', url: 'https://github.com/example/acme-api/issues/41' });
  assert.deepEqual(ticketKey({ repo: null, number: 41 }, '', 'acme-api'), { key: 'acme-api#41', url: null });
  assert.equal(ticketKey({ repo: 'example/acme-api', number: 41 }, '', 'acme-web').key,
    ticketKey({ repo: null, number: 41 }, 'https://github.com/example/acme-api/issues/', 'acme-api').key);
  assert.deepEqual(ticketKey({ repo: 'Example/Acme-API', number: 41 }, '', 'x'),
    { key: 'example/acme-api#41', url: 'https://github.com/Example/Acme-API/issues/41' });
});

const NOW = Date.parse('2026-11-27T12:00:00Z');
const MIN = 60 * 1000;
const STALE = 30 * MIN;
const step = (p) => planStep(p, NOW, STALE);
const fresh = (status = 'RUNNING') => ({ run: { outcome: 'running', status }, reportAt: NOW - MIN });
const old = (status = 'RUNNING') => ({ run: { outcome: 'running', status }, reportAt: NOW - 31 * MIN });
const PR = (state) => ({ pr: { number: 7, state, url: 'https://example.test/pull/7' } });

test('planStep: one case per step and per rule order', () => {
  assert.equal(step({ archived: true }), 'done');
  assert.equal(step({ ...PR('MERGED'), run: { outcome: 'failed', status: 'FAILED: test' } }), 'done');
  assert.equal(step({ ...PR('CLOSED') }), 'closed');
  assert.equal(step({ ...PR('CLOSED'), live: true }), 'running');
  assert.equal(step({ ...PR('CLOSED'), launch: { state: 'starting' } }), 'running');
  assert.equal(step({ ...PR('CLOSED'), ...fresh() }), 'running');
  assert.equal(step(fresh()), 'running');
  assert.equal(step(old()), 'failed');
  assert.equal(step(fresh('CLEANED (worktree removed)')), 'planned');
  assert.equal(step(old('CLEANED (worktree removed)')), 'planned');
  assert.equal(step(old('unknown')), 'planned');
  assert.equal(step({ ...fresh('CLEANED'), ...PR('OPEN') }), 'needs-you');
  assert.equal(step({ ...old('CLEANED'), ...PR('OPEN') }), 'needs-you');
  assert.equal(step({ launch: { state: 'starting' } }), 'running');
  assert.equal(step({ run: { outcome: 'failed', status: 'FAILED: test' } }), 'failed');
  assert.equal(step({ launch: { state: 'failed' } }), 'failed');
  assert.equal(step({ run: { outcome: 'needs-you', status: 'VERIFIED' } }), 'needs-you');
  assert.equal(step({ chatWaits: 1 }), 'needs-you');
  assert.equal(step(PR('OPEN')), 'needs-you');
  assert.equal(step({ waits: [{ text: 'a PR #1 merged', met: true }, { text: 'b PR #2 merged', met: false }] }), 'waiting');
  assert.equal(step({ waits: [{ text: 'a PR #1 merged', met: true }] }), 'planned');
  assert.equal(step({}), 'planned');
});

const plan = (slug, extra = {}) => ({ slug, title: slug.slice(16), tickets: [], ...extra });

test('buildChain: groups one ticket across two repos (the Goal example)', () => {
  const projects = [
    { name: 'acme-api', issuesUrl: 'https://github.com/example/acme-api/issues/', plans: [
      plan('20261127-100000-invoice-export', { tickets: [{ repo: null, number: 41 }], ...PR('OPEN') }),
    ] },
    { name: 'acme-web', issuesUrl: '', plans: [
      plan('20261127-110000-invoice-screen', { tickets: [{ repo: 'example/acme-api', number: 41 }],
        waits: [{ text: 'acme-api PR #7 merged', met: false, kind: 'pr' }, { text: 'nope PR #1 merged', met: false, error: 'unknown project' }] }),
    ] },
  ];
  const c = buildChain(projects, NOW, STALE);
  assert.equal(c.tickets.length, 1);
  const t = c.tickets[0];
  assert.equal(t.key, 'example/acme-api#41');
  assert.equal(t.url, 'https://github.com/example/acme-api/issues/41');
  assert.equal(t.done, false);
  assert.deepEqual(t.plans.map((r) => [r.project, r.slug, r.step]), [
    ['acme-api', '20261127-100000-invoice-export', 'needs-you'],
    ['acme-web', '20261127-110000-invoice-screen', 'waiting'],
  ]);
  assert.deepEqual(t.plans[0].pr, { number: 7, state: 'OPEN', url: 'https://example.test/pull/7' });
  assert.equal(t.plans[0].waits, null);
  assert.deepEqual(t.plans[1].waits, [
    { text: 'acme-api PR #7 merged', met: false, error: null },
    { text: 'nope PR #1 merged', met: false, error: 'unknown project' },
  ]);
  assert.equal(t.plans[1].pr, null);
  assert.equal(t.plans[1].archived, false);
  assert.deepEqual(c.untracked, []);
});

test('groupSummary: open tickets, and each plan that needs you once', () => {
  const row = (slug, step, extra = {}) => ({ project: 'acme-api', slug, step, archived: false, ...extra });
  assert.deepEqual(groupSummary({ tickets: [], untracked: [] }), { tickets: 0, needsYou: 0 });
  assert.deepEqual(groupSummary({
    tickets: [
      { key: 'a#41', done: false, plans: [row('s1', 'needs-you'), row('s2', 'waiting')] },
      { key: 'a#52', done: false, plans: [row('s1', 'needs-you')] },          // the same plan in a second ticket
      { key: 'a#60', done: true, plans: [row('s3', 'done')] },                // a done ticket is not counted
      { key: 'a#61', done: false, plans: [row('s4', 'needs-you', { archived: true }), row('s5', 'planned')] },
    ],
    untracked: [row('s6', 'needs-you'), { ...row('s1', 'needs-you'), project: 'acme-web' }],
  }), { tickets: 3, needsYou: 3 });
});

test('buildChain: archived and untracked rules', () => {
  const T = (n) => ({ repo: null, number: n });
  const projects = [{ name: 'acme-api', issuesUrl: 'https://github.com/example/acme-api/issues/', plans: [
    plan('20261127-100000-active-41', { tickets: [T(41)] }),
    plan('20261120-100000-old-41', { tickets: [T(41)], archived: true }),
    plan('20261120-110000-old-50', { tickets: [T(50)], archived: true }),
    plan('20261127-120000-no-ticket'),
    plan('20261120-120000-old-no-ticket', { archived: true }),
    plan('20261127-130000-two-tickets', { tickets: [T(60), T(61)] }),
    plan('20261127-140000-same-twice', { tickets: [T(70), { repo: 'example/acme-api', number: 70 }] }),
    plan('20261127-150000-merged-80', { tickets: [T(80)], ...PR('MERGED') }),
    plan('20261120-150000-old-80', { tickets: [T(80)], archived: true }),
  ] }];
  const c = buildChain(projects, NOW, STALE);
  const by = Object.fromEntries(c.tickets.map((t) => [t.key, t]));
  const p = 'example/acme-api#';
  assert.deepEqual(by[p + 41].plans.map((r) => [r.slug, r.step, r.archived]),
    [['20261120-100000-old-41', 'done', true], ['20261127-100000-active-41', 'planned', false]]);
  assert.equal(by[p + 41].done, false);
  assert.equal(by[p + 50], undefined);
  assert.deepEqual(c.untracked.map((r) => r.slug), ['20261127-120000-no-ticket']);
  assert.ok(!JSON.stringify(c).includes('old-no-ticket'));
  assert.deepEqual(by[p + 60].plans.map((r) => r.slug), ['20261127-130000-two-tickets']);
  assert.deepEqual(by[p + 61].plans.map((r) => r.slug), ['20261127-130000-two-tickets']);
  assert.equal(by[p + 70].plans.length, 1);
  assert.equal(by[p + 80].done, true);
  // Tickets sort by their first row's slug: #41 and #80 start with an archived 20261120 row.
  assert.deepEqual(c.tickets.map((t) => t.key), [p + 41, p + 80, p + 60, p + 61, p + 70]);
});

test('ledgerTemplate: title and three sections, no questions section', () => {
  const t = ledgerTemplate('acme-product');
  for (const s of ['# Ledger: acme-product', '## Goals', '## Holds', '## Notes']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('## PO questions'));
});
