#!/usr/bin/env node
// run-usage.selftest.mjs — tests of run-usage.mjs, with made-up logs only.
//
//   node --test .claude/scripts/run-usage.selftest.mjs
//
// Every fixture is made up (project acme-api, sessions sess-acme-*, messages msg-*,
// tool uses toolu-acme-*). Each test writes its files to a new temp folder.
// The same in every repo that has this script (template: claude-config skills/bootstrap-project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog, phaseRows, loadSubagents, applyCosts, allocateCost, formatTables } from './run-usage.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-usage.mjs');
const S1 = 'sess-acme-1', S2 = 'sess-acme-2';
const T = (min) => new Date(Date.UTC(2026, 10, 20, 10, 0) + min * 60000).toISOString();

const init = (sid = S1, min = null) => JSON.stringify({ type: 'system', subtype: 'init', session_id: sid, ...(min === null ? {} : { timestamp: T(min) }) });
const asst = ({ id, min = null, sid = S1, parent = null, inp = 0, cw = 0, cr = 0, out = 0, tools = [] }) => JSON.stringify({
  type: 'assistant', session_id: sid, parent_tool_use_id: parent, ...(min === null ? {} : { timestamp: T(min) }),
  message: { id, usage: { input_tokens: inp, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out }, content: tools },
});
const skill = (name, id = 'toolu-acme-s-' + name) => ({ type: 'tool_use', id, name: 'Skill', input: { skill: name } });
const read = (p, id = 'toolu-acme-r') => ({ type: 'tool_use', id, name: 'Read', input: { file_path: p } });
const agent = (id) => ({ type: 'tool_use', id, name: 'Agent', input: { prompt: 'review' } });
const result = ({ sid = S1, min = null, models = null, total = undefined }) => JSON.stringify({
  type: 'result', session_id: sid, ...(min === null ? {} : { timestamp: T(min) }),
  ...(models ? { model_usage_since_last_result: models } : {}), ...(total === undefined ? {} : { total_cost_usd: total }),
});
const cost = (c) => ({ 'model-a': { costUSD: c } });

function tmp() { return mkdtempSync(path.join(os.tmpdir(), 'run-usage-test-')); }

/** Writes a subagent transcript (and its meta file unless meta is null). */
function subagent(projects, folder, sid, name, messages, meta) {
  const dir = path.join(projects, folder, sid, 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.jsonl`), messages.join('\n') + '\n');
  if (meta !== null) writeFileSync(path.join(dir, `${name}.meta.json`), JSON.stringify(meta));
}

/** Runs the pure functions on a log. Returns {report, cost, text, parsed}. */
function analyze(lines, projects) {
  const parsed = parseLog(lines.join('\n') + '\n');
  const subs = loadSubagents(parsed.sessionIds, projects);
  const report = phaseRows(parsed, subs);
  const c = applyCosts(parsed, report);
  return { parsed, report, cost: c, text: formatTables(report, c, parsed.unparsable + subs.unparsable) };
}
const rowsOf = (r, sid = S1) => Object.fromEntries(r.report.sessions.find((s) => s.id === sid).rows.map((x) => [x.name, x]));

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('three top phases get exact token counts', () => {
  const dir = tmp();
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 10, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 1, inp: 5, out: 7 }),
    asst({ id: 'msg-3', min: 2, cw: 100, tools: [skill('skill-3-test')] }),
    asst({ id: 'msg-4', min: 3, cr: 1000, out: 3, tools: [skill('skill-4-verify')] }),
    result({ min: 4, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.deepEqual(rows.implement.tokens, { input: 15, cacheWrite: 0, cacheRead: 0, output: 7 });
  assert.deepEqual(rows.test.tokens, { input: 0, cacheWrite: 100, cacheRead: 0, output: 0 });
  assert.deepEqual(rows['verify › setup'].tokens, { input: 0, cacheWrite: 0, cacheRead: 1000, output: 3 });
  assert.equal(rows.implement.maxContext, 10);
  rmSync(dir, { recursive: true, force: true });
});

test('verify sub-rows sum to the verify subtotal, leaf rows sum to the total, ship starts a new row', () => {
  const dir = tmp();
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 1, tools: [skill('skill-4-verify')] }),
    asst({ id: 'msg-2', min: 1, inp: 20, tools: [skill('code-review')] }),
    asst({ id: 'msg-3', min: 2, out: 4, tools: [skill('test-review')] }),
    asst({ id: 'msg-4', min: 3, cr: 300, tools: [read('/tmp/wt/.claude/skills/skill-5-ship/SKILL.md')] }),
    asst({ id: 'msg-5', min: 4, out: 2 }),
    result({ min: 5, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.equal(rows['verify › setup'].tokens.input, 1);
  assert.equal(rows['verify › code-review'].tokens.input, 20);
  assert.equal(rows['verify › test-review'].tokens.output, 4);
  assert.deepEqual(rows.ship.tokens, { input: 0, cacheWrite: 0, cacheRead: 300, output: 2 });
  // verify subtotal: input 21, cache read 0, output 4
  assert.match(r.text, /^\| verify \| 21 \| 0 \| 0 \| 4 \| /m);
  // leaf total: input 21, cache read 300, output 6
  assert.match(r.text, /^\| total \| 21 \| 0 \| 300 \| 6 \| 1\.00 \| /m);
  rmSync(dir, { recursive: true, force: true });
});

test('a subagent counts in the row where its Agent call started; wall minutes do not overlap', () => {
  const dir = tmp();
  subagent(dir, '-tmp-acme-api', S1, 'agent-a1', [
    asst({ id: 'msg-sub-1', min: 20, parent: null, out: 40 }),
    asst({ id: 'msg-sub-2', min: 60, parent: null, out: 2 }),
  ], { agentType: 'general-purpose', toolUseId: 'toolu-acme-1' });
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-4-verify')] }),
    asst({ id: 'msg-2', min: 10, tools: [skill('code-review'), agent('toolu-acme-1')] }),
    asst({ id: 'msg-3', min: 25, tools: [read('.claude/skills/decision-sheet/SKILL.md')] }),
    asst({ id: 'msg-4', min: 40 }),
    result({ min: 41, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.equal(rows['verify › code-review'].tokens.output, 42);
  assert.equal(rows.ship.tokens.output, 0);
  assert.equal(rows['verify › code-review'].wall, 15);
  assert.equal(rows.ship.wall, 16);
  rmSync(dir, { recursive: true, force: true });
});

test('a transcript joins its Agent call by toolUseId; one without a meta file is unattributed', () => {
  const dir = tmp();
  subagent(dir, '-tmp-acme-api', S1, 'agent-joined', [asst({ id: 'msg-sub-1', inp: 7 })], { toolUseId: 'toolu-acme-2' });
  subagent(dir, '-tmp-acme-api', S1, 'agent-nometa', [asst({ id: 'msg-sub-2', inp: 9 })], null);
  const r = analyze([
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-2-implement'), agent('toolu-acme-2')] }),
    result({ min: 1, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.equal(rows.implement.tokens.input, 7);
  assert.equal(rows.unattributed.tokens.input, 9);
  // the subagent turn (7) is larger than the main turn (0): it sets the row's max context
  assert.equal(rows.implement.maxContext, 7);
  assert.equal(rows.unattributed.maxContext, 9);
  rmSync(dir, { recursive: true, force: true });
});

test('one message id on three lines counts once', () => {
  const dir = tmp();
  const r = analyze([
    asst({ id: 'msg-1', min: 0, inp: 100, out: 5, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-1', min: 0, inp: 100, out: 5 }),
    asst({ id: 'msg-1', min: 0, inp: 100, out: 5 }),
    result({ min: 1, models: cost(1) }),
  ], dir);
  assert.deepEqual(rowsOf(r).implement.tokens, { input: 100, cacheWrite: 0, cacheRead: 0, output: 5 });
  rmSync(dir, { recursive: true, force: true });
});

test('two result lines with two models give the exact total and weighted row costs', () => {
  const dir = tmp();
  const r = analyze([
    asst({ id: 'msg-1', min: 0, inp: 100, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 1, out: 60, tools: [skill('skill-3-test')] }),
    result({ min: 2, models: { 'model-a': { costUSD: 0.30 }, 'model-b': { costUSD: 0.20 } } }),
    result({ min: 3, models: { 'model-a': { costUSD: 0.50 } } }),
  ], dir);
  assert.equal(r.cost.total, 1);
  const rows = rowsOf(r);
  // weights: implement 100 × 1 = 100, test 60 × 5 = 300
  assert.equal(rows.implement.cost, 0.25);
  assert.equal(rows.test.cost, 0.75);
  assert.equal(Object.values(rows).reduce((a, x) => a + Math.round(x.cost * 100), 0), 100);
  rmSync(dir, { recursive: true, force: true });
});

test('allocateCost gives the rounding difference to the largest row', () => {
  // 100 cents over three equal rows: 33 each, the 1-cent difference to the first largest row
  assert.deepEqual(allocateCost([1, 1, 1], 1), [34, 33, 33]);
  assert.deepEqual(allocateCost([1, 2, 1], 1), [25, 50, 25]);
  // 7.5 and 2.5 round to 8 and 3 (11 cents): the largest row gives the extra cent back
  assert.deepEqual(allocateCost([3, 1], 0.1), [7, 3]);
  assert.equal(allocateCost([0, 0], 1), null);
});

test('a row with one 30-minute gap: 30 wall minutes, the gap counts as 10 active minutes', () => {
  const dir = tmp();
  const r = analyze([
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 2 }),
    asst({ id: 'msg-3', min: 30 }),
    asst({ id: 'msg-4', min: 30, tools: [skill('skill-3-test')] }),
    result({ min: 31, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.equal(rows.implement.wall, 30);
  assert.equal(rows.implement.active, 12);
  rmSync(dir, { recursive: true, force: true });
});

test('two session ids give two tables and a total table', () => {
  const dir = tmp();
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 1, tools: [skill('skill-2-implement')] }),
    result({ min: 1, models: cost(0.5), total: 0.5 }),
    init(S2, 2),
    asst({ id: 'msg-2', sid: S2, min: 2, inp: 1, tools: [skill('skill-3-test')] }),
    result({ sid: S2, min: 3, models: cost(0.5), total: 0.5 }),
  ], dir);
  assert.match(r.text, /^## Session sess-acme-1$/m);
  assert.match(r.text, /^## Session sess-acme-2$/m);
  assert.match(r.text, /^## Total$/m);
  assert.match(r.text, /^\| all sessions \| 2 \| /m);
  rmSync(dir, { recursive: true, force: true });
});

test('exit codes: a missing file and a log without a result line exit 1; an unparsable line is counted', () => {
  const dir = tmp();
  const missing = runCli([path.join(dir, 'missing.log'), '--projects-dir', dir]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cannot read/);
  const noResult = path.join(dir, 'no-result.log');
  writeFileSync(noResult, asst({ id: 'msg-1', min: 0 }) + '\n');
  const nr = runCli([noResult, '--projects-dir', dir]);
  assert.equal(nr.status, 1);
  assert.match(nr.stderr, /no result line/);
  const bad = path.join(dir, 'bad.log');
  writeFileSync(bad, [asst({ id: 'msg-1', min: 0, tools: [skill('skill-2-implement')] }), '{"type": "assistant", broken', result({ min: 1, models: cost(1) })].join('\n') + '\n');
  const b = runCli([bad, '--projects-dir', dir]);
  assert.equal(b.status, 0);
  assert.match(b.stdout, /^1 unparsable lines skipped$/m);
  const unknown = runCli([bad, '--help']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown option --help/);
  const two = runCli([bad, noResult]);
  assert.equal(two.status, 1);
  assert.match(two.stderr, /one run log only/);
  rmSync(dir, { recursive: true, force: true });
});

test('no marker gives one "whole run" row and a warning', () => {
  const dir = tmp();
  const r = analyze([asst({ id: 'msg-1', min: 0, inp: 3 }), result({ min: 1, models: cost(1) })], dir);
  const rows = rowsOf(r);
  assert.deepEqual(Object.keys(rows), ['whole run']);
  assert.match(r.text, /warning: no phase marker in the log/);
  rmSync(dir, { recursive: true, force: true });
});

test('a subagent line in the main log counts once, from its transcript', () => {
  const dir = tmp();
  subagent(dir, '-tmp-acme-api', S1, 'agent-a1', [asst({ id: 'msg-sub-transcript', inp: 50 })], { toolUseId: 'toolu-acme-3' });
  const r = analyze([
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-2-implement'), agent('toolu-acme-3')] }),
    asst({ id: 'msg-sub-stream', min: 1, parent: 'toolu-acme-3', inp: 50 }),
    result({ min: 2, models: cost(1) }),
  ], dir);
  assert.equal(rowsOf(r).implement.tokens.input, 50);
  rmSync(dir, { recursive: true, force: true });
});

test('a compaction segment gets its own exact row; the row before it does not grow', () => {
  const dir = tmp();
  const r = analyze([
    'launcher: pipeline session started',
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 100, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 5, out: 10 }),
    result({ min: 6, models: cost(1), total: 1 }),
    '-> compacting session sess-acme-1 (180000 tokens)',
    init(S1, 20),
    JSON.stringify({ type: 'user', session_id: S1, timestamp: T(21), message: { role: 'user', content: '/compact' } }),
    JSON.stringify({ type: 'rate_limit_event', session_id: S1, timestamp: T(22) }),
    result({ min: 23, models: { 'model-a': { costUSD: 0.40, inputTokens: 12, cacheReadInputTokens: 900, outputTokens: 300 } }, total: 0.4 }),
  ], dir);
  const rows = rowsOf(r);
  assert.equal(rows.compaction.cost, 0.40);
  assert.deepEqual(rows.compaction.tokens, { input: 12, cacheWrite: 0, cacheRead: 900, output: 300 });
  assert.equal(rows.compaction.wall, 3);
  assert.equal(r.cost.total, 1.4);
  assert.equal(rows.implement.cost, 1);
  assert.equal(rows.implement.wall, 6);
  assert.equal(r.parsed.unparsable, 0);
  assert.deepEqual(r.parsed.sessionIds, [S1]);
  rmSync(dir, { recursive: true, force: true });
});

test('lines after a compaction reopen the row: the compaction gap is not wall time', () => {
  const dir = tmp();
  const r = analyze([
    asst({ id: 'msg-1', min: 0, inp: 1, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 6 }),
    result({ min: 6, models: cost(1) }),
    '-> compacting session sess-acme-1 (180000 tokens)',
    result({ min: 20, models: cost(0.2) }),
    asst({ id: 'msg-3', min: 30 }),
    asst({ id: 'msg-4', min: 32 }),
    result({ min: 32, models: cost(0.5) }),
  ], dir);
  // 0 → 6 before the compaction, 30 → 32 after it: 8 minutes, not 32
  assert.equal(rowsOf(r).implement.wall, 8);
  rmSync(dir, { recursive: true, force: true });
});

test('the cache weights split the cost: cache read 0.1, cache write 1.25 per token', () => {
  const dir = tmp();
  const r = analyze([
    asst({ id: 'msg-1', min: 0, cr: 1000, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 1, cw: 80, tools: [skill('skill-3-test')] }),
    asst({ id: 'msg-3', min: 2, out: 40, tools: [skill('skill-4-verify')] }),
    result({ min: 3, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  // weights: 1000 × 0.1 = 100, 80 × 1.25 = 100, 40 × 5 = 200
  assert.equal(rows.implement.cost, 0.25);
  assert.equal(rows.test.cost, 0.25);
  assert.equal(rows['verify › setup'].cost, 0.5);
  rmSync(dir, { recursive: true, force: true });
});

test('the cross-check line sums total_cost_usd per stream; the thinking-token caveat shows the sum', () => {
  const dir = tmp();
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 1, tools: [skill('skill-2-implement')] }),
    result({ min: 1, models: { 'model-a': { costUSD: 0.6, thinkingTokens: 40 } }, total: 0.6 }),
    init(S1, 2),
    result({ min: 3, models: { 'model-b': { costUSD: 0.4, thinkingTokens: 2 } }, total: 0.4 }),
  ], dir);
  assert.match(r.text, /^cross-check \(total_cost_usd of each stream, summed; a resumed session adds only its new cost\): 1\.00$/m);
  assert.match(r.text, /thinking tokens of the whole run \(result lines\): 42\./);
  rmSync(dir, { recursive: true, force: true });
});

test('a Read of changelog-entry starts ship; code-review outside verify starts no row', () => {
  const dir = tmp();
  const r = analyze([
    asst({ id: 'msg-1', min: 0, inp: 1, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 1, inp: 2, tools: [skill('code-review')] }),
    asst({ id: 'msg-3', min: 2, inp: 4, tools: [read('/tmp/wt/.claude/skills/changelog-entry/SKILL.md')] }),
    result({ min: 3, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.deepEqual(Object.keys(rows).filter((k) => k !== 'preflight'), ['implement', 'ship']);
  assert.equal(rows.implement.tokens.input, 3);
  assert.equal(rows.ship.tokens.input, 4);
  rmSync(dir, { recursive: true, force: true });
});

test('a compaction without a result line ends at the next session: its rows and tokens stay', () => {
  const dir = tmp();
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 100, tools: [skill('skill-2-implement')] }),
    result({ min: 1, models: cost(1), total: 1 }),
    '-> compacting session sess-acme-1 (180000 tokens)',
    init(S1, 2),
    init(S1, 10),
    asst({ id: 'msg-2', min: 10, inp: 7, tools: [skill('skill-3-test')] }),
    asst({ id: 'msg-3', min: 12, out: 5 }),
    result({ min: 13, models: cost(0.5), total: 0.5 }),
  ], dir);
  const rows = rowsOf(r);
  assert.deepEqual(rows.test.tokens, { input: 7, cacheWrite: 0, cacheRead: 0, output: 5 });
  assert.equal(rows.test.wall, 3);
  assert.equal(rows.compaction.cost, null);
  assert.equal(r.cost.total, 1.5);
  rmSync(dir, { recursive: true, force: true });
});

test('an unattributed row keeps the total minutes; --projects-dir without a folder exits 1', () => {
  const dir = tmp();
  subagent(dir, '-tmp-acme-api', S1, 'agent-a1', [asst({ id: 'msg-sub-1', out: 8 })], { agentType: 'Explore' });
  const r = analyze([
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-2-implement')] }),
    asst({ id: 'msg-2', min: 4 }),
    result({ min: 5, models: cost(1) }),
  ], dir);
  assert.ok(rowsOf(r).unattributed);
  assert.match(r.text, /^\| total \| 0 \| 0 \| 0 \| 8 \| 1\.00 \| 5 \| 5 \| /m);
  const log = path.join(dir, 'run.log');
  writeFileSync(log, result({ min: 1, models: cost(1) }) + '\n');
  const noDir = runCli([log, '--projects-dir']);
  assert.equal(noDir.status, 1);
  assert.match(noDir.stderr, /--projects-dir needs a folder/);
  rmSync(dir, { recursive: true, force: true });
});

test('a resumed session continues its running total: the cross-check adds only the new cost of each resume', () => {
  const dir = tmp();
  // one session, resumed three times; total_cost_usd keeps counting across the resumes
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 1, tools: [skill('skill-2-implement')] }),
    result({ min: 1, models: cost(8.74), total: 8.74 }),
    init(S1, 2),
    result({ min: 3, models: cost(3.36), total: 12.10 }),
    init(S1, 4),
    result({ min: 5, models: cost(10.59), total: 22.69 }),
    result({ min: 6, total: 22.69 }),
    init(S1, 7),
    result({ min: 8, models: cost(0.25), total: 22.94 }),
  ], dir);
  assert.match(r.text, /^total cost: 22\.94$/m);
  assert.match(r.text, /a resumed session adds only its new cost\): 22\.94$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('only total_cost_usd in two streams: the total sums the last value of each stream', () => {
  const dir = tmp();
  const r = analyze([
    init(S1, 0),
    asst({ id: 'msg-1', min: 0, inp: 1, tools: [skill('skill-2-implement')] }),
    result({ min: 1, total: 0.5 }),
    result({ min: 2, total: 1.10 }),
    init(S1, 3),
    result({ min: 4, total: 0.30 }),
  ], dir);
  assert.equal(Math.round(r.cost.total * 100), 140);
  assert.match(r.text, /caveat: no result line has model_usage_since_last_result/);
  rmSync(dir, { recursive: true, force: true });
});

test('a meta file without toolUseId puts its transcript in unattributed', () => {
  const dir = tmp();
  subagent(dir, '-tmp-acme-api', S1, 'agent-a1', [asst({ id: 'msg-sub-1', out: 8 })], { agentType: 'Explore' });
  const r = analyze([
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-2-implement'), agent('toolu-acme-4')] }),
    result({ min: 1, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.equal(rows.unattributed.tokens.output, 8);
  assert.equal(rows.implement.tokens.output, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('one session in two project folders: the same transcript name counts once, with a warning', () => {
  const dir = tmp();
  const msgs = [asst({ id: 'msg-sub-1', inp: 11 })];
  subagent(dir, '-tmp-acme-api', S1, 'agent-a1', msgs, { toolUseId: 'toolu-acme-5' });
  subagent(dir, '-tmp-acme-api-vscode-copy', S1, 'agent-a1', msgs, { toolUseId: 'toolu-acme-5' });
  const r = analyze([
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-2-implement'), agent('toolu-acme-5')] }),
    result({ min: 1, models: cost(1) }),
  ], dir);
  assert.equal(rowsOf(r).implement.tokens.input, 11);
  assert.match(r.text, /warning: session sess-acme-1 is in 2 project folders/);
  rmSync(dir, { recursive: true, force: true });
});

test('a one-message row between markers at 10:00 and 10:07: 7 wall minutes, 0 active', () => {
  const dir = tmp();
  const r = analyze([
    asst({ id: 'msg-1', min: 0, tools: [skill('skill-3-test')] }),
    asst({ id: 'msg-2', min: 7, tools: [skill('skill-4-verify')] }),
    result({ min: 8, models: cost(1) }),
  ], dir);
  const rows = rowsOf(r);
  assert.equal(rows.test.wall, 7);
  assert.equal(rows.test.active, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('cost with no weighted tokens goes to unattributed; the other rows show n/a', () => {
  const dir = tmp();
  const log = path.join(dir, 'zero.log');
  writeFileSync(log, [init(S1, 0), result({ min: 1, models: cost(0.5) })].join('\n') + '\n');
  const out = runCli([log, '--projects-dir', dir]);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^\| unattributed \| 0 \| 0 \| 0 \| 0 \| 0\.50 \| /m);
  assert.match(out.stdout, /^\| whole run \| 0 \| 0 \| 0 \| 0 \| n\/a \| /m);
  rmSync(dir, { recursive: true, force: true });
});

test('only total_cost_usd gives that total with a caveat; no cost field gives n/a and still tokens', () => {
  const dir = tmp();
  const only = analyze([asst({ id: 'msg-1', min: 0, inp: 4, tools: [skill('skill-2-implement')] }), result({ min: 1, total: 0.75 })], dir);
  assert.equal(only.cost.total, 0.75);
  assert.match(only.text, /caveat: no result line has model_usage_since_last_result/);
  const log = path.join(dir, 'none.log');
  writeFileSync(log, [asst({ id: 'msg-1', min: 0, inp: 4, tools: [skill('skill-2-implement')] }), result({ min: 1 })].join('\n') + '\n');
  const out = runCli([log, '--projects-dir', dir]);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^\| implement \| 4 \| 0 \| 0 \| 0 \| n\/a \| /m);
  assert.match(out.stdout, /total cost: n\/a/);
  rmSync(dir, { recursive: true, force: true });
});

test('assistant lines without timestamp give n/a minutes and exit 0', () => {
  const dir = tmp();
  const log = path.join(dir, 'nots.log');
  writeFileSync(log, [asst({ id: 'msg-1', inp: 2, tools: [skill('skill-2-implement')] }), asst({ id: 'msg-2', out: 1 }), result({ models: cost(1) })].join('\n') + '\n');
  const out = runCli([log, '--projects-dir', dir]);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^\| implement \| 2 \| 0 \| 0 \| 1 \| 1\.00 \| n\/a \| n\/a \| /m);
  rmSync(dir, { recursive: true, force: true });
});
