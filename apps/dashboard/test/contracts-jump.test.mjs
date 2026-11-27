// Unit tests of apps/dashboard/contracts-jump.mjs, the pure helpers of the contracts jump.
//
//   node --test apps/dashboard/test/contracts-jump.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  safeSubPath, parseSubPaths, launcherBase, submoduleBranch, repoKey, parseJumpLine,
  jumpSlug, planStamp, recommendJump, jumpPlanText,
} from '../contracts-jump.mjs';
import { parseWaitsFor } from '../watch.mjs';

test('contracts-jump.mjs has no imports: pure helpers, no npm dependency (AGENTS.md hard rule)', () => {
  const src = readFileSync(new URL('../contracts-jump.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\brequire\(|\bimport\(/);
});

test('safeSubPath: good and bad paths', () => {
  for (const s of ['contracts', 'libs/contracts', '.contracts', 'a'.repeat(200)]) assert.equal(safeSubPath(s), true, s);
  for (const s of ['', '/abs', '-x', 'a/../b', '..', 'contracts..old', 'a//b', 'a/./b', 'a b', 'a'.repeat(201), null, 7])
    assert.equal(safeSubPath(s), false, String(s));
});

test('parseSubPaths: string and array input, drops bad items, max 8', () => {
  assert.deepEqual(parseSubPaths('contracts, libs/api  contracts'), { paths: ['contracts', 'libs/api'], dropped: [] });
  assert.deepEqual(parseSubPaths(['contracts/', '../x', 'a b']), { paths: ['contracts'], dropped: ['../x', 'a b'] });
  const ten = Array.from({ length: 10 }, (_, i) => 'p' + i);
  const r = parseSubPaths(ten);
  assert.deepEqual(r.paths, ten.slice(0, 8));
  assert.deepEqual(r.dropped, ['p8', 'p9']);
  assert.deepEqual(parseSubPaths(undefined), { paths: [], dropped: [] });
});

test('launcherBase: reads BASE_BRANCH, rejects placeholders and bad names', () => {
  assert.equal(launcherBase('#!/bin/bash\nBASE_BRANCH="develop"\n'), 'develop');
  assert.equal(launcherBase('BASE_BRANCH="@@BASE_BRANCH@@"\n'), null);
  assert.equal(launcherBase('BASE_BRANCH="-x"\n'), null);
  assert.equal(launcherBase('#!/bin/bash\necho hi\n'), null);
});

test('submoduleBranch: the branch of the section whose path matches', () => {
  const gm = '[submodule "contracts"]\n\tpath = contracts\n\turl = https://example.test/c.git\n\tbranch = release\n'
    + '[submodule "other"]\n\tpath = libs/other\n\turl = https://example.test/o.git\n'
    + '[submodule "dot"]\n\tpath = dot\n\turl = https://example.test/d.git\n\tbranch = .\n';
  assert.equal(submoduleBranch(gm, 'contracts'), 'release');
  assert.equal(submoduleBranch(gm, 'libs/other'), null);
  assert.equal(submoduleBranch(gm, 'nope'), null);
  assert.equal(submoduleBranch(gm, 'dot'), '.');
  // git config quoting and comments
  const q = '[submodule "c"]\n\tpath = "contracts"\n\tbranch = "release"\n[submodule "d"]\n\tpath = libs/d ; the d lib\n\tbranch = main # newest\n';
  assert.equal(submoduleBranch(q, 'contracts'), 'release');
  assert.equal(submoduleBranch(q, 'libs/d'), 'main');
});

test('repoKey: one key for each GitHub form; local paths stay', () => {
  for (const u of ['https://github.com/Acme/API.git', 'git@github.com:acme/api.git', 'ssh://git@github.com/acme/api/'])
    assert.equal(repoKey(u), 'github.com/acme/api', u);
  assert.equal(repoKey('https://user:sk-test-0000@github.com/acme/api.git'), 'github.com/acme/api');
  assert.equal(repoKey('/tmp/x/contracts.git'), '/tmp/x/contracts');
  assert.equal(repoKey(''), '');
});

test('parseJumpLine: header only, outside fences, good paths only', () => {
  const head = (...l) => ['# Plan: x', '', '- **Base**: main', ...l, '', '## Goal', '', 'Body.'].join('\n');
  assert.equal(parseJumpLine(head('- **Contracts jump**: `contracts`')), 'contracts');
  assert.equal(parseJumpLine(['# Plan: x', '', '## Goal', '- **Contracts jump**: contracts'].join('\n')), null);
  assert.equal(parseJumpLine(head('```', '- **Contracts jump**: contracts', '```')), null);
  assert.equal(parseJumpLine(head('- **Contracts jump**: ../x')), null);
});

test('jumpSlug and planStamp', () => {
  assert.equal(planStamp(new Date(2026, 10, 27, 9, 5, 7)), '20261127-090507');
  assert.equal(jumpSlug('libs/Contracts', '20261127-090507'), '20261127-090507-contracts-jump-libs-contracts');
});

const prRow = (number, state, extra) => ({ number, title: 'PR ' + number, url: 'https://example.test/pull/' + number,
  isDraft: false, headRefName: 'f/' + number, baseRefName: 'main', state, ...(extra || {}) });
const sub = (extra) => ({ checkedAt: '2026-11-28T09:14:00.000Z', branch: 'main', relation: 'behind', behind: true,
  upstream: 'acme-api', error: null, prs: { error: '', rows: [] }, ...(extra || {}) });

test('recommendJump: one case per state, in rule order', () => {
  const open = { error: '', rows: [prRow(41, 'OPEN')] };
  assert.equal(recommendJump(null, []).state, 'unchecked');
  assert.equal(recommendJump({ branch: 'main' }, []).state, 'unchecked');
  const e = recommendJump(sub({ error: 'boom' }), []);
  assert.equal(e.state, 'error'); assert.equal(e.error, 'boom');
  assert.equal(recommendJump(sub({ relation: 'ahead', prs: open }), []).state, 'diverged');
  assert.equal(recommendJump(sub({ relation: 'diverged' }), []).state, 'diverged');
  const b = recommendJump(sub({ prs: open }), [{ slug: 'x', archived: false, pr: null }]);
  assert.equal(b.state, 'blocked'); assert.equal(b.blockers.length, 1);
  assert.equal(recommendJump(sub({ prs: null }), []).state, 'unchecked');
  const pe = recommendJump(sub({ prs: { error: 'HTTP 502', rows: [] } }), []);
  assert.equal(pe.state, 'error'); assert.match(pe.error, /acme-api/);
  const rows = [prRow(41, 'OPEN'), prRow(42, 'OPEN'), prRow(41, 'OPEN'), prRow(44, 'OPEN', { isDraft: true }),
    prRow(45, 'OPEN', { baseRefName: 'other' }), prRow(46, 'MERGED'),
    { number: 47, title: 'x', url: 'u', state: 'OPEN', isDraft: false, base: 'main' }];
  const r = recommendJump(sub({ prs: { error: '', rows } }), []);
  assert.equal(r.state, 'batch');
  assert.deepEqual(r.recommended.map((p) => p.number), [41, 42]);
  assert.deepEqual(r.drafts.map((p) => p.number), [44]);
  assert.deepEqual(r.recommended[0], { number: 41, title: 'PR 41', url: 'https://example.test/pull/41' });
  assert.equal(recommendJump(sub({ relation: 'equal', behind: false, prs: { error: '', rows } }), []).state, 'batch');
  assert.equal(recommendJump(sub(), []).state, 'now');
  assert.equal(recommendJump(sub({ upstream: null, prs: null }), []).state, 'now');
  assert.equal(recommendJump(sub({ relation: 'equal', behind: false }), []).state, 'up-to-date');
});

test('jumpPlanText: header lines that parseWaitsFor and parseJumpLine read, and the steps', () => {
  const pin = 'a'.repeat(40), tip = 'b'.repeat(40);
  const text = jumpPlanText({ subPath: 'contracts', branch: 'main', base: 'main', upstream: 'acme-api', prs: [41, 42], pin, tip, date: '2026-11-28' });
  const w = parseWaitsFor(text);
  assert.deepEqual(w.map((x) => [x.kind, x.project, x.number]), [['pr', 'acme-api', 41], ['pr', 'acme-api', 42]]);
  assert.equal(parseJumpLine(text), 'contracts');
  assert.match(text.split('\n## ')[0], /^- \*\*Base\*\*: main$/m);
  for (const s of ['## Goal', '## Steps', '## How to verify', 'fetch origin +refs/heads/main:refs/remotes/origin/main',
    'merge-base --is-ancestor HEAD origin/main', 'checkout --detach origin/main', '.claude/skills/contracts-jump/SKILL.md'])
    assert.ok(text.includes(s), s);
  const none = jumpPlanText({ subPath: 'contracts', branch: 'main', base: 'main', upstream: 'acme-api', prs: [], pin, tip, date: '2026-11-28' });
  assert.equal(parseWaitsFor(none), null);
  const noUp = jumpPlanText({ subPath: 'contracts', branch: 'main', base: 'main', upstream: null, prs: [], pin, tip, date: '2026-11-28' });
  assert.doesNotMatch(noUp, /Waits for/);
});
