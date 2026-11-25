#!/usr/bin/env node
// run-usage.mjs — print the tokens, the cost and the minutes of each phase of one pipeline run.
//
//   node .claude/scripts/run-usage.mjs <run .log> [--projects-dir <dir>]
//
// Reads the stream-json log that auto-pipeline.sh writes (.plans/auto-runs/<slug>.log) and
// the subagent transcripts of its sessions (<projects-dir>/*/<session id>/subagents/,
// default ~/.claude/projects). Prints one table per session: one row per phase (preflight,
// implement, test, verify › setup, verify › code-review, verify › test-review, ship), plus
// "compaction" and "unattributed" when the run has them. Writes nothing.
//
// The total cost is exact (the result lines); the cost of each row is an estimate from token
// weights. A value that the log does not give prints "n/a".
//
// The same in every repo that has this script (template: claude-config skills/bootstrap-project).
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// token weights relative to one uncached input token (the same for every model)
export const WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };
const GAP_CAP_MS = 10 * 60 * 1000;
const SKILL_PHASES = { 'skill-2-implement': 'implement', 'skill-3-test': 'test', 'skill-4-verify': 'verify' };
const VERIFY_SUBS = { 'code-review': 'verify › code-review', 'test-review': 'verify › test-review' };
const SHIP_READS = ['.claude/skills/skill-5-ship/SKILL.md', '.claude/skills/changelog-entry/SKILL.md', '.claude/skills/decision-sheet/SKILL.md'];
const AGENT_TOOLS = new Set(['Agent', 'Task']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const tsOf = (o) => {
  if (typeof o?.timestamp !== 'string') return null;
  const t = Date.parse(o.timestamp);
  return Number.isNaN(t) ? null : t;
};
const usageTokens = (u) => ({
  input: num(u?.input_tokens), cacheWrite: num(u?.cache_creation_input_tokens),
  cacheRead: num(u?.cache_read_input_tokens), output: num(u?.output_tokens),
});
const emptyTokens = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const addTokens = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k]; };
/** Returns the weighted token count of one token set (WEIGHTS). */
export const weightOf = (t) => t.input * WEIGHTS.input + t.cacheWrite * WEIGHTS.cacheWrite + t.cacheRead * WEIGHTS.cacheRead + t.output * WEIGHTS.output;

/** Sums the cost and the tokens of a model_usage_since_last_result object over its model keys. */
function sumModelUsage(mu) {
  if (!mu || typeof mu !== 'object') return null;
  const out = { cost: 0, hasCost: false, tokens: emptyTokens(), thinking: 0, hasThinking: false };
  for (const m of Object.values(mu)) {
    if (!m || typeof m !== 'object') continue;
    if (typeof m.costUSD === 'number') { out.cost += m.costUSD; out.hasCost = true; }
    out.tokens.input += num(m.inputTokens);
    out.tokens.cacheWrite += num(m.cacheCreationInputTokens);
    out.tokens.cacheRead += num(m.cacheReadInputTokens);
    out.tokens.output += num(m.outputTokens);
    if (typeof m.thinkingTokens === 'number') { out.thinking += m.thinkingTokens; out.hasThinking = true; }
  }
  return out;
}

/**
 * Parses the text of a run log. Returns the main-session events in order, the session ids,
 * the result lines, the streams, the compaction segments and the count of unparsable lines.
 * A line that does not start with "{" is launcher text: it is not unparsable, and it gives no
 * session id. A "-> compacting session" text line starts a compaction segment that ends with
 * the next result line. A line with a parent_tool_use_id is a subagent line and is skipped.
 */
export function parseLog(text) {
  const events = [], sessionIds = [], results = [], streams = [], compactions = [];
  let unparsable = 0, lastSid = null, comp = null;
  const addSid = (sid) => { if (!sessionIds.includes(sid)) sessionIds.push(sid); };
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (!trimmed.startsWith('{')) {
      if (trimmed.startsWith('-> compacting session')) {
        const m = trimmed.match(/^-> compacting session (\S+)/);
        comp = { sessionId: m ? m[1] : null, ts: [], result: null };
        compactions.push(comp);
        events.push({ kind: 'compaction', comp });
      }
      continue;
    }
    let o;
    try { o = JSON.parse(trimmed); } catch { unparsable++; continue; }
    if (!o || typeof o !== 'object') { unparsable++; continue; }
    // a compaction without a result line ends where the next session starts (an assistant line or a second init)
    if (comp && (o.type === 'assistant' || (o.type === 'system' && o.subtype === 'init' && comp.sawInit))) comp = null;
    if (comp && o.type === 'system' && o.subtype === 'init') comp.sawInit = true;
    if (typeof o.session_id === 'string' && o.session_id) { addSid(o.session_id); lastSid = o.session_id; }
    const ts = tsOf(o);
    if (o.type === 'system' && o.subtype === 'init') streams.push({ sid: null, firstTotal: null, lastTotal: null });
    if (o.type === 'result') {
      if (!streams.length) streams.push({ sid: null, firstTotal: null, lastTotal: null });
      const st = streams[streams.length - 1];
      if (typeof o.total_cost_usd === 'number') {
        if (st.sid === null && typeof o.session_id === 'string' && o.session_id) st.sid = o.session_id;
        if (st.firstTotal === null) st.firstTotal = o.total_cost_usd;
        st.lastTotal = o.total_cost_usd;
      }
      const r = { usage: sumModelUsage(o.model_usage_since_last_result), totalCost: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null, compaction: Boolean(comp) };
      results.push(r);
      if (comp) {
        if (ts !== null) comp.ts.push(ts);
        comp.result = r;
        if (!comp.sessionId) comp.sessionId = typeof o.session_id === 'string' ? o.session_id : lastSid;
        comp = null;
        continue;
      }
    }
    if (comp) { if (ts !== null) comp.ts.push(ts); continue; }
    if (o.parent_tool_use_id !== null && o.parent_tool_use_id !== undefined) continue;
    const sid = typeof o.session_id === 'string' && o.session_id ? o.session_id : (lastSid ?? '(none)');
    const ev = { kind: 'line', type: o.type, sid, ts };
    if (o.type === 'assistant' && o.message && typeof o.message === 'object') {
      const content = Array.isArray(o.message.content) ? o.message.content : [];
      ev.msgId = typeof o.message.id === 'string' ? o.message.id : null;
      ev.usage = o.message.usage ? usageTokens(o.message.usage) : null;
      ev.toolUses = content.filter((c) => c && c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, input: c.input || {} }));
    }
    events.push(ev);
  }
  return { events, sessionIds, results, streams, compactions, unparsable };
}

/**
 * Finds and reads the subagent transcripts of the given sessions:
 * <projectsDir>/<any folder>/<session id>/subagents/agent-*.jsonl, each file name once.
 * Returns {transcripts: [{sessionId, file, toolUseId, messages: [{id, tokens}]}], warnings, unparsable}.
 */
export function loadSubagents(sessionIds, projectsDir) {
  const transcripts = [], warnings = [];
  let unparsable = 0;
  const folders = existsSync(projectsDir) ? readdirSync(projectsDir).filter((d) => {
    try { return statSync(path.join(projectsDir, d)).isDirectory(); } catch { return false; }
  }) : [];
  for (const sid of sessionIds) {
    const dirs = folders.map((d) => path.join(projectsDir, d, sid, 'subagents')).filter((d) => existsSync(d));
    if (!dirs.length) { warnings.push(`no subagent folder for session ${sid}: main session only`); continue; }
    if (dirs.length > 1) warnings.push(`session ${sid} is in ${dirs.length} project folders: each transcript name counts once`);
    const seen = new Set();
    for (const dir of dirs) {
      for (const name of readdirSync(dir).sort()) {
        if (!/^agent-.*\.jsonl$/.test(name) || seen.has(name)) continue;
        seen.add(name);
        let toolUseId = null;
        const metaPath = path.join(dir, name.replace(/\.jsonl$/, '.meta.json'));
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
            if (typeof meta?.toolUseId === 'string' && meta.toolUseId) toolUseId = meta.toolUseId;
          } catch { /* an unreadable meta file: the transcript is unattributed */ }
        }
        const messages = [];
        for (const raw of readFileSync(path.join(dir, name), 'utf8').split('\n')) {
          const t = raw.trim();
          if (!t) continue;
          if (!t.startsWith('{')) continue;
          let o;
          try { o = JSON.parse(t); } catch { unparsable++; continue; }
          if (o?.type === 'assistant' && o.message?.usage) {
            messages.push({ id: typeof o.message.id === 'string' ? o.message.id : null, tokens: usageTokens(o.message.usage) });
          }
        }
        transcripts.push({ sessionId: sid, file: name, toolUseId, messages });
      }
    }
  }
  return { transcripts, warnings, unparsable };
}

const newRow = (name) => ({ name, tokens: emptyTokens(), maxContext: 0, spans: [], active: 0, lines: 0, cost: null, fixedCost: null });

/** Returns the row name a tool_use starts, or null when it is no marker. */
function markerOf(tu, current) {
  if (tu.name === 'Skill') {
    const s = String(tu.input?.skill ?? '').replace(/^\//, '');
    if (SKILL_PHASES[s]) return SKILL_PHASES[s] === 'verify' ? 'verify › setup' : SKILL_PHASES[s];
    if (VERIFY_SUBS[s] && current.startsWith('verify ›')) return VERIFY_SUBS[s];
    return null;
  }
  if (tu.name === 'Read') {
    const p = String(tu.input?.file_path ?? '');
    if (SHIP_READS.some((s) => p === s || p.endsWith('/' + s))) return 'ship';
  }
  return null;
}

/**
 * Splits a parsed log into phase rows per session and adds the subagent tokens to the row
 * where their Agent call started. Returns {sessions: [{id, rows}], warnings}. Each row has
 * tokens, maxContext, wall (minutes or null), active (minutes or null) and lines.
 */
export function phaseRows(parsed, subagents = { transcripts: [], warnings: [] }) {
  const warnings = [];
  const state = new Map(); // sid -> {rows: Map, order: [], current, lastTs}
  const sess = (sid) => {
    if (!state.has(sid)) state.set(sid, { rows: new Map(), order: [], current: null, lastTs: null });
    return state.get(sid);
  };
  const rowIn = (s, name) => {
    if (!s.rows.has(name)) { s.rows.set(name, newRow(name)); s.order.push(name); }
    return s.rows.get(name);
  };
  const openSpan = (row, ts, fromFirst) => row.spans.push({ start: fromFirst ? null : ts, end: null, last: null, open: true, fromFirst });
  const curSpan = (row) => { const sp = row.spans[row.spans.length - 1]; return sp && sp.open ? sp : null; };
  const timed = (row, ts) => {
    row.lines++;
    let sp = curSpan(row);
    if (!sp) { openSpan(row, ts, true); sp = curSpan(row); }
    if (ts === null) return;
    if (sp.fromFirst && sp.start === null && sp.last === null) sp.start = ts;
    if (sp.last !== null) row.active += Math.min(Math.max(ts - sp.last, 0), GAP_CAP_MS);
    sp.last = ts;
  };
  const closeSpan = (row, end) => { const sp = curSpan(row); if (sp) { sp.end = end; sp.open = false; } };
  const agentRow = new Map(); // tool-use id -> {sid, name}
  const seenMsg = new Set();
  let anyMarker = false;

  for (const ev of parsed.events) {
    if (ev.kind === 'compaction') {
      const sid = ev.comp.sessionId ?? parsed.sessionIds[parsed.sessionIds.length - 1] ?? '(none)';
      const s = sess(sid);
      if (s.current) { const sp = curSpan(s.current); if (sp) closeSpan(s.current, sp.last); }
      const row = rowIn(s, 'compaction');
      const ts = ev.comp.ts;
      const r = ev.comp.result;
      if (r?.usage) { addTokens(row.tokens, r.usage.tokens); if (r.usage.hasCost) row.fixedCost = (row.fixedCost ?? 0) + r.usage.cost; }
      row.spans.push({ start: ts.length ? ts[0] : null, end: ts.length ? ts[ts.length - 1] : null, open: false });
      for (let i = 1; i < ts.length; i++) row.active += Math.min(Math.max(ts[i] - ts[i - 1], 0), GAP_CAP_MS);
      row.lines++;
      continue;
    }
    const s = sess(ev.sid);
    if (!s.current) { s.current = rowIn(s, 'preflight'); openSpan(s.current, null, true); }
    for (const tu of ev.toolUses || []) {
      const name = markerOf(tu, s.current.name);
      if (name) {
        anyMarker = true;
        if (name !== s.current.name) {
          closeSpan(s.current, ev.ts);
          s.current = rowIn(s, name);
          openSpan(s.current, ev.ts, false);
        }
      }
      if (AGENT_TOOLS.has(tu.name) && typeof tu.id === 'string') agentRow.set(tu.id, { sid: ev.sid, name: s.current.name });
    }
    timed(s.current, ev.ts);
    if (ev.ts !== null) s.lastTs = ev.ts;
    if (ev.usage && !(ev.msgId && seenMsg.has(ev.msgId))) {
      if (ev.msgId) seenMsg.add(ev.msgId);
      addTokens(s.current.tokens, ev.usage);
      s.current.maxContext = Math.max(s.current.maxContext, ev.usage.input + ev.usage.cacheRead + ev.usage.cacheWrite);
    }
  }
  for (const s of state.values()) if (s.current) closeSpan(s.current, curSpan(s.current) ? s.lastTs : null);

  for (const t of subagents.transcripts) {
    const target = t.toolUseId ? agentRow.get(t.toolUseId) : null;
    const s = sess(target ? target.sid : t.sessionId);
    const row = rowIn(s, target ? target.name : 'unattributed');
    for (const m of t.messages) {
      if (m.id && seenMsg.has(m.id)) continue;
      if (m.id) seenMsg.add(m.id);
      addTokens(row.tokens, m.tokens);
      // a subagent turn is a turn of the row too (Max context: one turn in the row)
      row.maxContext = Math.max(row.maxContext, m.tokens.input + m.tokens.cacheRead + m.tokens.cacheWrite);
    }
  }
  warnings.push(...(subagents.warnings || []));
  if (!anyMarker) {
    warnings.push('no phase marker in the log: one "whole run" row');
    for (const s of state.values()) {
      const r = s.rows.get('preflight');
      if (r) { r.name = 'whole run'; s.rows.delete('preflight'); s.rows.set('whole run', r); s.order[s.order.indexOf('preflight')] = 'whole run'; }
    }
  }

  const minutes = (ms) => ms / 60000;
  const sessions = [];
  for (const [id, s] of state) {
    const rows = s.order.map((n) => s.rows.get(n)).filter((r) => !(r.name === 'preflight' && r.lines === 0 && weightOf(r.tokens) === 0));
    for (const r of rows) {
      const ok = r.spans.length > 0 && r.spans.every((sp) => sp.start !== null && sp.end !== null && sp.end !== undefined);
      r.wall = ok ? minutes(r.spans.reduce((a, sp) => a + (sp.end - sp.start), 0)) : null;
      r.active = ok ? minutes(r.active) : null;
      if (r.name === 'unattributed') { r.wall = null; r.active = null; }
      delete r.spans;
    }
    sessions.push({ id, rows });
  }
  return { sessions, warnings };
}

/**
 * Splits `rest` dollars over the given weights, in cents. The rounding difference goes to the
 * largest weight, so the parts add up to round(rest × 100) exactly. Returns null when the
 * weights sum to 0.
 */
export function allocateCost(weights, rest) {
  const total = weights.reduce((a, w) => a + w, 0);
  if (!(total > 0)) return null;
  const restCents = Math.round(rest * 100);
  const cents = weights.map((w) => Math.round((restCents * w) / total));
  const diff = restCents - cents.reduce((a, c) => a + c, 0);
  if (diff) {
    let big = 0;
    weights.forEach((w, i) => { if (w > weights[big]) big = i; });
    cents[big] += diff;
  }
  return cents;
}

/**
 * Adds the total_cost_usd of the streams and returns the sum, or null when no stream has one.
 * A resumed session (--resume) continues its running total: when a stream of a session starts
 * at or above the last total of an earlier stream of the same session, only the difference
 * counts. A stream that starts lower is a new total and counts in full.
 */
export function streamCostSum(streams) {
  const prevLast = new Map();
  let sum = null;
  for (const s of streams) {
    if (s.lastTotal === null) continue;
    const key = s.sid ?? '(none)';
    const prev = prevLast.get(key);
    const add = prev !== undefined && s.firstTotal !== null && s.firstTotal >= prev ? s.lastTotal - prev : s.lastTotal;
    sum = (sum ?? 0) + add;
    prevLast.set(key, s.lastTotal);
  }
  return sum;
}

/**
 * Computes the run cost (total, cross-check, thinking tokens) and sets the cost of each row:
 * the compaction rows get their own exact cost, the other rows share the rest by token weight.
 * Returns the cost facts for formatTables.
 */
export function applyCosts(parsed, report) {
  const withUsage = parsed.results.filter((r) => r.usage?.hasCost);
  const crossCheck = streamCostSum(parsed.streams);
  let total = null, source = null;
  if (withUsage.length) { total = withUsage.reduce((a, r) => a + r.usage.cost, 0); source = 'model_usage'; }
  else if (crossCheck !== null) { total = crossCheck; source = 'total_cost_usd'; }
  const thinkingResults = parsed.results.filter((r) => r.usage?.hasThinking);
  const thinking = thinkingResults.length ? thinkingResults.reduce((a, r) => a + r.usage.thinking, 0) : null;
  const rows = report.sessions.flatMap((s) => s.rows);
  if (total === null) return { total, source, crossCheck, thinking };
  let fixed = 0;
  for (const r of rows) if (r.name === 'compaction' && r.fixedCost !== null) { r.cost = r.fixedCost; fixed += r.fixedCost; }
  const shared = rows.filter((r) => r.name !== 'compaction');
  const rest = total - fixed;
  const cents = allocateCost(shared.map((r) => weightOf(r.tokens)), rest);
  if (cents) shared.forEach((r, i) => { r.cost = cents[i] / 100; });
  else if (Math.round(rest * 100) !== 0) {
    let un = shared.find((r) => r.name === 'unattributed');
    if (!un) {
      if (!report.sessions.length) report.sessions.push({ id: '(none)', rows: [] });
      un = newRow('unattributed');
      un.wall = null; un.active = null;
      report.sessions[0].rows.push(un);
    }
    un.cost = Math.round(rest * 100) / 100;
  } else shared.forEach((r) => { r.cost = 0; });
  return { total, source, crossCheck, thinking };
}

const fmtInt = (n) => String(Math.round(n));
const fmtMin = (m) => (m === null || m === undefined ? 'n/a' : String(Math.round(m * 10) / 10));
const fmtCost = (c) => (c === null || c === undefined ? 'n/a' : c.toFixed(2));
const sumRows = (name, rows) => {
  const t = emptyTokens();
  rows.forEach((r) => addTokens(t, r.tokens));
  const all = (k, of = rows) => (of.length && of.every((r) => r[k] !== null && r[k] !== undefined) ? of.reduce((a, r) => a + r[k], 0) : null);
  // the unattributed row has no minutes by definition: the minute sums skip it
  const timed = rows.filter((r) => r.name !== 'unattributed');
  return { name, tokens: t, cost: all('cost'), wall: all('wall', timed), active: all('active', timed), maxContext: Math.max(0, ...rows.map((r) => r.maxContext)) };
};
const HEAD = '| row | input | cache write | cache read | output | cost | wall min | active min | max context |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
const line = (r) => `| ${r.name} | ${fmtInt(r.tokens.input)} | ${fmtInt(r.tokens.cacheWrite)} | ${fmtInt(r.tokens.cacheRead)} | ${fmtInt(r.tokens.output)} | ${fmtCost(r.cost)} | ${fmtMin(r.wall)} | ${fmtMin(r.active)} | ${r.maxContext ? fmtInt(r.maxContext) : 'n/a'} |`;

/**
 * Formats the report as text: one table per session (with the verify subtotal above its
 * sub-rows and a total line), a total table when there is more than one session, then the
 * warnings, the caveats and the unparsable-line footer.
 */
export function formatTables(report, cost, unparsable) {
  const out = [];
  const totals = [];
  for (const s of report.sessions) {
    out.push(`## Session ${s.id}`, '', HEAD);
    const subs = s.rows.filter((r) => r.name.startsWith('verify ›'));
    let verifyDone = false;
    for (const r of s.rows) {
      if (r.name.startsWith('verify ›') && !verifyDone) { out.push(line(sumRows('verify', subs))); verifyDone = true; }
      out.push(line(r));
    }
    const tot = sumRows('total', s.rows);
    out.push(line(tot), '');
    totals.push({ ...tot, name: s.id });
  }
  if (report.sessions.length > 1) {
    out.push('## Total', '', HEAD, ...totals.map(line), line(sumRows('all sessions', totals)), '');
  }
  for (const w of report.warnings) out.push(`warning: ${w}`);
  out.push(`total cost: ${fmtCost(cost.total)}${cost.source === 'total_cost_usd' ? ' (from total_cost_usd)' : ''}`);
  out.push(`cross-check (total_cost_usd of each stream, summed; a resumed session adds only its new cost): ${fmtCost(cost.crossCheck)}`);
  if (cost.source === 'total_cost_usd') out.push('caveat: no result line has model_usage_since_last_result; the total is the total_cost_usd of each stream, summed (a resumed session adds only its new cost).');
  if (cost.total === null) out.push('caveat: the result lines have no cost field; every cost is n/a.');
  out.push('caveat: the row costs are estimates from token weights (input 1, cache write 1.25, cache read 0.1, output 5); only the total and the compaction cost are exact.');
  out.push(`caveat: the assistant usage has no thinking tokens; thinking tokens of the whole run (result lines): ${cost.thinking === null ? 'n/a' : fmtInt(cost.thinking)}.`);
  out.push('caveat: wall and active minutes count the main session only; active minutes cap each gap at 10 minutes.');
  out.push(`${unparsable} unparsable lines skipped`);
  return out.join('\n');
}

/** Runs the command line. Returns the exit code. */
export function main(argv, { log = console.log, error = console.error } = {}) {
  let file = null, projectsDir = path.join(os.homedir(), '.claude', 'projects');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--projects-dir') {
      projectsDir = argv[++i];
      if (!projectsDir) { error('run-usage: --projects-dir needs a folder'); return 1; }
    } else if (argv[i].startsWith('--')) { error(`run-usage: unknown option ${argv[i]}`); return 1; }
    else if (!file) file = argv[i];
    else { error(`run-usage: one run log only (got ${file} and ${argv[i]})`); return 1; }
  }
  if (!file) { error('usage: node .claude/scripts/run-usage.mjs <run .log> [--projects-dir <dir>]'); return 1; }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { error(`run-usage: cannot read ${file}: ${e.code || e.message}`); return 1; }
  const parsed = parseLog(text);
  if (!parsed.results.length) { error('run-usage: no result line: incomplete log'); return 1; }
  const subagents = loadSubagents(parsed.sessionIds, projectsDir);
  const report = phaseRows(parsed, subagents);
  const cost = applyCosts(parsed, report);
  log(formatTables(report, cost, parsed.unparsable + subagents.unparsable));
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
