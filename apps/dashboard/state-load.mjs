#!/usr/bin/env node
// Measures GET /api/state of a running plans dashboard, and compares the answers of two dashboards:
//
//   node apps/dashboard/state-load.mjs load <port> [clients=10] [seconds=60] [--max-state-ms=1000] [--max-usage-ms=100]
//   node apps/dashboard/state-load.mjs compare <portA> <portB> [--verbose]
//
// "load" starts <clients> loops. Each loop gets /api/state once every 5 s, like a page.
// One more loop gets /api/usage every 500 ms. At the end the script prints the count, the median
// and the maximum time of each endpoint, and the number of different X-State-Build values.
// It exits 1 when a maximum is at the limit or more, a request failed, an answer is not 200,
// a /api/state body is not a JSON array, or an endpoint has no samples.
// "compare" gets /api/state from each port two times, 6 s apart, and compares the second answers.
// It exits 1 only on a difference in the project names, the plan keys or the validations count.
// Other differences print as "info" lines with a field name and a count.
// The output never names a project, a plan, a title or a path. --verbose adds the JSON paths,
// for the local terminal only.
// Bad arguments print the usage and exit 2. It uses only fetch and Node built-ins.

const USAGE = `usage:
  node apps/dashboard/state-load.mjs load <port> [clients=10] [seconds=60] [--max-state-ms=1000] [--max-usage-ms=100]
  node apps/dashboard/state-load.mjs compare <portA> <portB> [--verbose]`;
const STATE = '/api/state', USAGE_EP = '/api/usage';
const TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const bad = () => { console.error(USAGE); process.exit(2); };

/** Gives the whole number in s when it is minValue or more, else null. */
const whole = (s, minValue) => (/^\d+$/.test(String(s)) && +s >= minValue ? +s : null);
/** Gives the port in s when it is a whole number from 1 to 65535, else null. */
const portOf = (s) => { const p = whole(s, 1); return p != null && p <= 65535 ? p : null; };

/** Gives the median of a list of numbers (0 for an empty list). */
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Sends one GET and gives { ok, status, ms, body, build }. A network error or the time limit gives ok false. */
const hit = async (port, p) => {
  const t = performance.now();
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await r.text();
    return { ok: r.status === 200, status: r.status, ms: performance.now() - t, body, build: r.headers.get('x-state-build') };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t, body: '', build: null, error: e.name || String(e) };
  }
};

/** Runs the load mode and gives the exit code. */
const load = async (args) => {
  // a flag with no value (--max-state-ms) gives '', which is not a number: the usage, not the default
  const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)];
  }));
  const pos = args.filter((a) => !a.startsWith('--'));
  const port = portOf(pos[0]);
  const clients = pos[1] == null ? 10 : whole(pos[1], 1);
  const seconds = pos[2] == null ? 60 : whole(pos[2], 1);
  const maxState = flags['max-state-ms'] == null ? 1000 : whole(flags['max-state-ms'], 0);
  const maxUsage = flags['max-usage-ms'] == null ? 100 : whole(flags['max-usage-ms'], 0);
  for (const k of Object.keys(flags)) if (!['max-state-ms', 'max-usage-ms'].includes(k)) bad();
  if (port == null || clients == null || seconds == null || maxState == null || maxUsage == null || pos.length > 3) bad();

  const t0 = Date.now(), end = t0 + seconds * 1000;
  const res = { [STATE]: [], [USAGE_EP]: [] };
  const builds = new Set();
  let notArray = 0;
  const record = (p, r) => {
    res[p].push(r);
    if (p !== STATE || !r.ok) return;
    if (r.build != null) builds.add(r.build);
    try { if (!Array.isArray(JSON.parse(r.body))) notArray++; } catch { notArray++; }
  };
  // one loop: a request every `every` ms from its start, no new request after the end
  const loop = async (p, offset, every) => {
    await sleep(offset);
    while (Date.now() < end) {
      const start = Date.now();
      record(p, await hit(port, p));
      if (start + every >= end) break;
      await sleep(start + every - Date.now());
    }
  };
  const spread = Math.min(5000, seconds * 1000);
  await Promise.all([
    ...Array.from({ length: clients }, (_, i) => loop(STATE, (i * spread) / clients, 5000)),
    loop(USAGE_EP, 0, 500),
  ]);

  const fails = [];
  for (const [p, limit] of [[STATE, maxState], [USAGE_EP, maxUsage]]) {
    const rs = res[p], ms = rs.map((r) => r.ms);
    const max = ms.length ? Math.max(...ms) : 0;
    console.log(`${p}: count ${rs.length}, median ${Math.round(median(ms))} ms, max ${Math.round(max)} ms`);
    if (!rs.length) fails.push(`${p} has no samples`);
    else if (max >= limit) fails.push(`${p} max ${Math.round(max)} ms is at or over the limit ${limit} ms`);
    const failed = rs.filter((r) => r.status === 0).length;
    const notOk = rs.filter((r) => r.status !== 0 && !r.ok).length;
    if (failed) fails.push(`${p} ${failed} requests failed`);
    if (notOk) fails.push(`${p} ${notOk} answers are not 200`);
  }
  console.log(`state builds: ${builds.size} distinct X-State-Build values`);
  if (notArray) fails.push(`${STATE} ${notArray} bodies are not a JSON array`);
  for (const f of fails) console.log('FAIL: ' + f);
  if (!fails.length) console.log('OK');
  return fails.length ? 1 : 0;
};

/** Gives the parsed JSON array of an answer, or null. */
const parsed = (r) => { try { const v = JSON.parse(r.body); return Array.isArray(v) ? v : null; } catch { return null; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Runs the compare mode and gives the exit code. */
const compare = async (args) => {
  const verbose = args.includes('--verbose');
  const pos = args.filter((a) => a !== '--verbose');
  if (pos.some((a) => a.startsWith('--'))) bad();
  const a = portOf(pos[0]), b = portOf(pos[1]);
  if (a == null || b == null || pos.length !== 2) bad();

  // the first answer fills the PR list cache of each server; the second answer is the one compared
  const first = await Promise.all([hit(a, STATE), hit(b, STATE)]);
  await sleep(6000);
  const second = await Promise.all([hit(a, STATE), hit(b, STATE)]);
  const fails = [];
  const notOk = [...first, ...second].filter((r) => !r.ok).length;
  if (notOk) fails.push(`${notOk} answers are not 200`);
  const [sa, sb] = second.map(parsed);
  if (!sa || !sb) fails.push('an answer is not a JSON array');
  const paths = [];
  if (sa && sb) {
    const namesA = sa.map((p) => p.name).sort(), namesB = sb.map((p) => p.name).sort();
    if (!same(namesA, namesB)) { fails.push('project names differ'); paths.push('project names'); }
    const info = new Map();
    const note = (field, where) => { info.set(field, (info.get(field) || 0) + 1); paths.push(`${where}.${field}`); };
    let keyDiffs = 0, validDiffs = 0, plans = 0;
    for (const pa of sa) {
      const pb = sb.find((p) => p.name === pa.name);
      if (!pb) continue;
      for (const f of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
        if (f !== 'plans' && !same(pa[f], pb[f])) note('project.' + f, pa.name);
      }
      const rowsA = new Map((pa.plans || []).map((p) => [p.key, p])), rowsB = new Map((pb.plans || []).map((p) => [p.key, p]));
      if (!same([...rowsA.keys()].sort(), [...rowsB.keys()].sort())) { keyDiffs++; paths.push(`${pa.name}.plans (keys)`); }
      for (const [key, ra] of rowsA) {
        const rb = rowsB.get(key);
        if (!rb) continue;
        plans++;
        if (ra.validations !== rb.validations) { validDiffs++; paths.push(`${key}.validations`); }
        for (const f of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
          if (f !== 'validations' && !same(ra[f], rb[f])) note(f, key);
        }
      }
    }
    console.log(`compared: ${sa.length} projects, ${plans} plans`);
    if (keyDiffs) fails.push(`plan keys differ in ${keyDiffs} projects`);
    if (validDiffs) fails.push(`validations differ in ${validDiffs} plans`);
    for (const [field, n] of [...info].sort()) console.log(`info: ${field} ${n}`);
  }
  if (verbose) for (const p of paths) console.log('path: ' + p);
  for (const f of fails) console.log('FAIL: ' + f);
  if (!fails.length) console.log('OK');
  return fails.length ? 1 : 0;
};

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'load') process.exitCode = await load(rest);
else if (mode === 'compare') process.exitCode = await compare(rest);
else bad();
