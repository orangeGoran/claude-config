#!/usr/bin/env node
// The scout: once a day it looks for work in the projects listed in ~/.claude/scout.json and writes
// each new finding as a short proposal into the project's plans folder, with status "proposed".
// The plans dashboard shows proposals in its Proposed column: Confirm starts /skill-1-plan in a chat,
// Dismiss archives the proposal. Guide: docs/scout.md.
//
//   node apps/scout/scout.mjs                 scan every configured project
//   node apps/scout/scout.mjs --dry-run       print the findings, write nothing
//   node apps/scout/scout.mjs --project <n>   scan one project
//   node apps/scout/scout.mjs --install       run it every day at 07:00 (macOS launchd)
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const CONFIG = path.join(CLAUDE, 'scout.json');
const REGISTRY = path.join(CLAUDE, 'pipeline-projects.json');
const CENTRAL = path.join(CLAUDE, 'pipeline-dashboard');
const DAY = 864e5;
export const ALL_CHECKS = ['ci-red', 'flaky', 'stuck-prs', 'security', 'prod-errors', 'slow-endpoints'];

// ---------- small helpers ----------
const expand = (p) => (p ? p.replace(/^~(?=$|\/)/, HOME) : p);
const loadJson = (f, dflt = {}) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return dflt; } };
const saveJson = (f, v) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f + '.tmp', JSON.stringify(v, null, 2) + '\n');
  renameSync(f + '.tmp', f);
};
const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...opts }, (err, out, errOut) =>
    resolve({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') }));
});
const runJson = async (cmd, args, opts) => {
  const r = await run(cmd, args, opts);
  if (!r.ok) return { ok: false, err: r.err.trim().split('\n').slice(-3).join(' ') };
  try { return { ok: true, data: JSON.parse(r.out) }; } catch { return { ok: false, err: 'not JSON: ' + r.out.slice(0, 200) }; }
};
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).replace(/-$/, '');
const fence = (s) => '```\n' + String(s).replace(/```/g, "'''") + '\n```';

// Text from production goes into a file in the repo and to the Anthropic API: take out what
// identifies a tenant, a user or a machine first.
export const redact = (s) => String(s ?? '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
  .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>')
  .replace(/\b(Bearer|token|key|secret|password)([=: ]+)\S+/gi, '$1$2<redacted>');

// /v1/cases/3f2a…/report?x=1 → /v1/cases/:id/report, so one endpoint is one row
export const normalizeRoute = (url) => String(url || '').split('?')[0].split('/').map((seg) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? ':id'
  : /^\d+$/.test(seg) ? ':n'
  : seg.length >= 16 && /\d/.test(seg) && /^[\w-]+$/.test(seg) ? ':token'
  : seg).join('/');

// An error message with its ids taken out, so the same error on two tenants is one finding
export const errorKey = (msg) => redact(msg).replace(/\b\d+\b/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 160);

// Per-URL rows (count and p95 of each raw URL) merged into one row per endpoint. The p95 of the
// endpoint is estimated as the count-weighted 95th percentile of the URLs' p95 values: close
// enough to see an endpoint get 2× slower, not an exact percentile.
export const mergeRoutes = (rows) => {
  const by = new Map();
  for (const r of rows) {
    const k = r.method + ' ' + normalizeRoute(r.url);
    const e = by.get(k) || { route: k, n: 0, parts: [] };
    e.n += r.n;
    e.parts.push({ n: r.n, p95: r.p95 });
    by.set(k, e);
  }
  return [...by.values()].map((e) => {
    const parts = e.parts.sort((a, b) => a.p95 - b.p95);
    let seen = 0, p95 = parts.at(-1).p95;
    for (const p of parts) { seen += p.n; if (seen >= 0.95 * e.n) { p95 = p.p95; break; } }
    return { route: e.route, n: e.n, p95: Math.round(p95) };
  });
};

// An endpoint is slow when its p95 doubled against the last 7 days, is over the floor, and both
// periods have enough requests to mean something
export const slowRoutes = (today, base, { factor = 2, floorMs = 500, minRequests = 20 } = {}) => {
  const old = new Map(base.map((r) => [r.route, r]));
  return today.filter((r) => {
    const b = old.get(r.route);
    return b && r.n >= minRequests && b.n >= minRequests && r.p95 >= floorMs && r.p95 >= factor * b.p95;
  }).map((r) => ({ ...r, baseP95: old.get(r.route).p95, baseN: old.get(r.route).n }));
};

// New errors, and known ones that happen at least `factor` times more often than their daily average
export const errorSpikes = (today, base, { factor = 3, minCount = 5, baseDays = 7 } = {}) => {
  const old = new Map(base.map((r) => [r.key, r.n / baseDays]));
  return today.filter((r) => {
    const avg = old.get(r.key) || 0;
    return avg === 0 ? true : r.n >= minCount && r.n >= factor * avg;
  }).map((r) => ({ ...r, dailyAvg: Math.round((old.get(r.key) || 0) * 10) / 10 }));
};

// ---------- GitHub checks (gh CLI, run in the repo) ----------
const RUN_FIELDS = 'databaseId,workflowName,conclusion,status,headSha,createdAt,url,attempt';

export const ciRedFindings = (runs, base) => {
  const out = [], byWf = new Map();
  for (const r of runs.filter((x) => x.status === 'completed').sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    (byWf.get(r.workflowName) || byWf.set(r.workflowName, []).get(r.workflowName)).push(r);
  for (const [wf, list] of byWf) {
    if (list[0].conclusion !== 'failure') continue;
    let red = 0;
    while (red < list.length && list[red].conclusion === 'failure') red++;
    const last = list[0];
    out.push({ check: 'ci-red', key: 'ci-red:' + wf, size: red, runId: last.databaseId,
      title: `Fix the red "${wf}" workflow on ${base}`,
      evidence: `- Workflow **${wf}** failed on \`${base}\` ${red} time(s) in a row.\n- Last failure: [run ${last.databaseId}](${last.url}) on commit \`${last.headSha.slice(0, 10)}\`, ${last.createdAt}.` });
  }
  return out;
};

export const flakyFindings = (runs, base, now = Date.now()) => {
  const recent = runs.filter((r) => r.status === 'completed' && now - Date.parse(r.createdAt) < 7 * DAY);
  const bySha = new Map();
  for (const r of recent) {
    const k = r.workflowName + '@' + r.headSha;
    (bySha.get(k) || bySha.set(k, []).get(k)).push(r);
  }
  const hits = new Map();
  for (const r of recent) {
    const same = bySha.get(r.workflowName + '@' + r.headSha);
    const flaky = (r.conclusion === 'success' && r.attempt > 1)
      || (r.conclusion === 'failure' && same.some((x) => x.conclusion === 'success'));
    if (!flaky) continue;
    const h = hits.get(r.workflowName) || { shas: new Set(), urls: [] };
    if (!h.shas.has(r.headSha)) { h.shas.add(r.headSha); h.urls.push(r.url); }
    hits.set(r.workflowName, h);
  }
  return [...hits].map(([wf, h]) => ({ check: 'flaky', key: 'flaky:' + wf, size: h.shas.size,
    title: `Find the flaky test in the "${wf}" workflow`,
    evidence: `- On \`${base}\` in the last 7 days, **${wf}** failed and then passed on the same commit ${h.shas.size} time(s).\n` +
      h.urls.slice(0, 5).map((u) => `- ${u}`).join('\n') }));
};

export const stuckPrFindings = (prs, now = Date.now(), idleDays = 5) => prs.flatMap((p) => {
  const idle = Math.floor((now - Date.parse(p.updatedAt)) / DAY);
  if (p.mergeable === 'CONFLICTING')
    return [{ check: 'stuck-prs', key: `pr:${p.number}:conflicts`, size: Math.max(idle, 1),
      title: `Resolve the conflicts in PR #${p.number}`,
      evidence: `- [PR #${p.number}](${p.url}) "${p.title}" has merge conflicts with \`${p.baseRefName}\`.\n- Last activity ${idle} day(s) ago.` }];
  if (idle >= idleDays)
    return [{ check: 'stuck-prs', key: `pr:${p.number}:idle`, size: idle,
      title: `Finish or close PR #${p.number}`,
      evidence: `- [PR #${p.number}](${p.url}) "${p.title}"${p.isDraft ? ' (draft)' : ''} has had no activity for ${idle} days.` }];
  return [];
});

const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
export const securityFindings = (alerts) => {
  const by = new Map();
  for (const a of alerts) {
    const pkg = a.dependency?.package || a.security_vulnerability?.package || {};
    const k = (pkg.ecosystem || '?') + ':' + (pkg.name || '?');
    const e = by.get(k) || { pkg, list: [] };
    e.list.push(a);
    by.set(k, e);
  }
  return [...by].map(([k, e]) => {
    const worst = e.list.map((a) => a.security_advisory?.severity || a.security_vulnerability?.severity || 'low')
      .sort((x, y) => (SEV[y] || 0) - (SEV[x] || 0))[0];
    return { check: 'security', key: 'dep:' + k, size: e.list.length,
      title: `Update ${e.pkg.name} (${worst} security alert)`,
      evidence: e.list.slice(0, 5).map((a) => `- [${a.security_advisory?.ghsa_id || 'alert ' + a.number}](${a.html_url}): ` +
        `${a.security_advisory?.summary || ''} (${a.security_advisory?.severity || '?'}), fixed in ${a.security_vulnerability?.first_patched_version?.identifier || 'no release yet'}`).join('\n') };
  });
};

// ---------- CloudWatch Logs Insights (aws CLI) ----------
const insights = async (aws, groups, query, fromMs, toMs) => {
  const base = ['--profile', aws.profile, '--region', aws.region, '--output', 'json'];
  const st = await runJson('aws', ['logs', 'start-query', '--log-group-names', ...groups,
    '--start-time', String(Math.floor(fromMs / 1000)), '--end-time', String(Math.floor(toMs / 1000)),
    '--query-string', query, ...base]);
  if (!st.ok) return st;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 1000 : 2000));
    const r = await runJson('aws', ['logs', 'get-query-results', '--query-id', st.data.queryId, ...base]);
    if (!r.ok) return r;
    if (['Complete', 'Failed', 'Cancelled', 'Timeout'].includes(r.data.status)) {
      if (r.data.status !== 'Complete') return { ok: false, err: 'query ' + r.data.status };
      return { ok: true, rows: r.data.results.map((row) => Object.fromEntries(row.map((c) => [c.field, c.value]))) };
    }
  }
  return { ok: false, err: 'query did not finish in 3 minutes' };
};

const ERR_QUERY = `filter level >= 50
| stats count(*) as n, latest(err.stack) as stack, latest(req.url) as url, latest(git_sha) as sha by msg, err.type, err.message
| sort n desc | limit 200`;
// 404s left out: internet scanners probe thousands of paths that do not exist (/joomla/administrator/…)
const ROUTE_QUERY = `filter ispresent(responseTime) and ispresent(req.url) and res.statusCode != 404
| stats count(*) as n, pct(responseTime, 95) as p95 by req.method, req.url
| limit 10000`;

const errRows = (rows) => {
  const by = new Map();
  for (const r of rows) {
    const text = [r['err.type'], r['err.message'] || r.msg].filter(Boolean).join(': ');
    const key = errorKey(text);
    const e = by.get(key) || { key, n: 0, text: redact(text), stack: redact(r.stack || ''), url: normalizeRoute(r.url), sha: r.sha || '' };
    e.n += +r.n || 0;
    by.set(key, e);
  }
  return [...by.values()];
};

const prodErrorChecks = async (aws, now) => {
  const [today, base] = await Promise.all([
    insights(aws, aws.logGroups, ERR_QUERY, now - DAY, now),
    insights(aws, aws.logGroups, ERR_QUERY, now - 8 * DAY, now - DAY)]);
  if (!today.ok || !base.ok) return { warning: 'prod-errors: ' + (today.err || base.err) };
  const now24 = errRows(today.rows);
  return { seen: `${now24.length} distinct error(s) in the last 24 hours`, findings: errorSpikes(now24, errRows(base.rows)).slice(0, 10).map((e) => ({
    check: 'prod-errors', key: 'err:' + e.key, size: e.n,
    title: `Fix the production error "${e.text.slice(0, 70)}"`,
    evidence: `- ${e.n} time(s) in the last 24 hours; ${e.dailyAvg ? 'daily average before: ' + e.dailyAvg : 'new: not seen in the 7 days before'}.\n` +
      (e.url ? `- Last seen on \`${e.url}\`` + (e.sha ? `, build \`${e.sha.slice(0, 10)}\`` : '') + '.\n' : '') +
      '\n' + fence(e.text + (e.stack ? '\n\n' + e.stack.split('\n').slice(0, 25).join('\n') : '')) })) };
};

const slowEndpointChecks = async (aws, now) => {
  const groups = aws.requestLogGroups || aws.logGroups.slice(0, 1);
  const [today, base] = await Promise.all([
    insights(aws, groups, ROUTE_QUERY, now - DAY, now),
    insights(aws, groups, ROUTE_QUERY, now - 8 * DAY, now - DAY)]);
  if (!today.ok || !base.ok) return { warning: 'slow-endpoints: ' + (today.err || base.err) };
  if (!today.rows.length) return { warning: 'slow-endpoints: no request line with responseTime in the last 24 hours' };
  const rows = (list) => mergeRoutes(list.map((r) => ({ method: r['req.method'], url: r['req.url'], n: +r.n || 0, p95: +r.p95 || 0 })));
  const cur = rows(today.rows), min = (aws.slow || {}).minRequests || 20;
  return { seen: `${cur.filter((r) => r.n >= min).length} endpoint(s) with ${min}+ requests compared`, findings: slowRoutes(cur, rows(base.rows), aws.slow || {}).map((r) => ({
    check: 'slow-endpoints', key: 'slow:' + r.route, size: r.p95,
    title: `Make ${r.route} fast again`,
    evidence: `- p95 in the last 24 hours: **${r.p95} ms** over ${r.n} requests.\n- p95 in the 7 days before: ${r.baseP95} ms over ${r.baseN} requests.\n` +
      '- The p95 is estimated from per-URL percentiles, so take it as a trend, not an exact number.' })) };
};

// ---------- proposals ----------
const PROMPT = (p, f) => `You help a developer decide whether to plan a fix. A daily scout found this in the project "${p.name}".

Finding: ${f.title}
Evidence:
${f.evidence}

Reply with JSON only, no code fence: {"summary": "...", "direction": "..."}
- summary: 2 or 3 short sentences in plain English: what is wrong, who notices it, how urgent it looks.
- direction: 1 or 2 sentences: where to look first and what a fix probably changes. Say "unknown" when the evidence does not show it.`;

// One Sonnet session per proposal, in the repo root. Its id comes back with the answer, so the
// session can become the proposal's chat on the dashboard (linkChat).
const writeUp = async (p, f, model) => {
  const r = await run('claude', ['-p', PROMPT(p, f), '--model', model, '--output-format', 'json'], { cwd: p.root, timeout: 180000 });
  let text = r.out.trim(), session = null;
  try {
    const o = JSON.parse(text);
    if (o && typeof o.result === 'string') { text = o.result.trim(); session = o.session_id || null; }
  } catch {}
  try {
    const j = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (j.summary) return { summary: String(j.summary).trim(), direction: String(j.direction || '').trim(), session };
  } catch {}
  return { summary: f.title + '. The scout could not write a summary; read the evidence below.', direction: '', session };
};
// The dashboard's chat record for a plan (state/<project>/ask/<slug>.json, a "root chat"): the
// proposal opens with this session, you can ask about the finding, and Confirm continues it.
const linkChat = (p, slug, session) => {
  if (session) saveJson(path.join(CENTRAL, 'state', p.name, 'ask', slug + '.json'),
    { root: true, current: { id: session, base: session, copy: false }, own: [session] });
};

export const proposalText = (p, f, w, date = new Date()) => `# Scout: ${f.title}

- **Base**: ${p.base}
- **Found by**: the scout, check \`${f.check}\`, ${date.toISOString().slice(0, 10)}
- **Scout key**: \`${f.key}\`

## Summary

${w.summary}

## Evidence

${f.evidence}
${w.direction && !/^unknown\.?$/i.test(w.direction) ? '\n## Suggested direction\n\n' + w.direction + '\n' : ''}
## Next step

On the plans dashboard, **Confirm** runs \`/skill-1-plan\` in a new chat that turns this proposal into a plan. **Dismiss** archives it; the scout proposes it again only when it gets 2× worse.
`;

// Should a finding become a proposal? Each key is proposed once. A dismissed one comes back
// only when it gets twice as big; a fixed one (archived, not dismissed) only after 14 days, so a
// fix that waits for its deploy does not bring it straight back.
export const decide = (prev, where, size, now = Date.now()) => {
  if (!prev) return { propose: true };
  if (where === 'active') return { propose: false };
  // the scout archived it because the problem went away; now it is back
  if (where === 'resolved') return { propose: true, why: 'came back after it went away on its own' };
  // the proposal file is gone without a Dismiss (deleted, lost with the checkout): propose it again
  if (where === 'gone') return { propose: true, why: 'was proposed before, but its file is gone' };
  if (where === 'dismissed') return { propose: size >= 2 * prev.size, why: 'got 2× worse after it was dismissed' };
  const since = prev.resolvedAt || now;
  return { propose: now - since >= 14 * DAY, why: 'came back after it was fixed', resolvedAt: since };
};

const where = (p, meta, slug) =>
  meta[slug]?.status === 'dismissed' ? 'dismissed'
  : meta[slug]?.status === 'resolved' ? 'resolved'
  : existsSync(path.join(p.plansDir, slug + '.md')) ? 'active'
  : existsSync(path.join(p.doneDir, slug + '.md')) ? 'done' : 'gone';

// The dashboard's address: the domain setup-macos.sh gave Caddy, else the plain local port
const dashUrl = () => {
  let host = '';
  try { host = (readFileSync(path.join(CENTRAL, 'caddy-site.caddy'), 'utf8').match(/^([^\s{]+)\s*\{/m) || [])[1] || ''; } catch {}
  return host ? 'https://' + host : 'http://127.0.0.1:' + (process.env.DASH_PORT || 4899);
};
// The notifier programs, in order. Shipyard (the Mac app; apps/plans-mac/build.mjs installs it in ~/Applications)
// shows its own icon, and a click opens the page in its window. terminal-notifier (brew install terminal-notifier)
// opens a click in the browser. With neither, osascript: its notification belongs to Script Editor, and a click opens that.
export const SHIPYARD_NOTIFIER = path.join(os.homedir(), 'Applications', 'Shipyard.app', 'Contents', 'MacOS', 'Shipyard');
export const NOTIFIERS = [SHIPYARD_NOTIFIER, '/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier'];

const runFile = (file, args) => new Promise((ok, fail) => execFile(file, args, { timeout: 15000 }, (e) => (e ? fail(e) : ok())));

/**
 * Sends one notification with the first program in `list` that exists and succeeds, with the terminal-notifier
 * flags in `args`. Shipyard exits 1 while the owner has not allowed its notifications; then the next program sends it.
 * Gives true when a program sent it, false when none did.
 */
export const notifyFirst = async (list, args, { exists = existsSync, run = runFile } = {}) => {
  for (const file of list) {
    if (!exists(file)) continue;
    try { await run(file, args); return true; } catch {}
  }
  return false;
};

// A click opens `query` on the dashboard.
const notify = async (text, query = '?scout=1') => {
  if (process.platform !== 'darwin' || process.env.SCOUT_NO_NOTIFY) return;
  const args = ['-title', 'Scout', '-message', text, '-open', dashUrl() + '/' + query, '-group', 'scout-' + query];
  if (await notifyFirst(NOTIFIERS, args)) return;
  try { execFileSync('osascript', ['-e', `display notification ${JSON.stringify(text)} with title "Scout"`]); } catch {}
};

// ---------- learning from your answers ----------
// What became of a proposal: still waiting, confirmed (planned), dismissed, resolved on its own, or gone.
export const outcomeOf = (status, active, archived) =>
  status === 'proposed' ? (active ? 'waiting' : archived ? 'resolved' : 'gone')
  : status === 'dismissed' ? 'dismissed' : status === 'resolved' ? 'resolved'
  : active || archived ? 'confirmed' : 'gone';
// From every proposal the scout made and what you did with it:
// - a check is muted when you dismissed its last `checkRun` decided proposals in a row;
// - a finding is muted when it was proposed `keyRepeat` times and never confirmed.
// A confirm, or a proposal that resolved on its own, breaks a row. Unmute (state.unmuted, set by
// the dashboard) starts the count again from that moment.
export const learn = (state, outcome, { checkRun = 5, keyRepeat = 3 } = {}) => {
  const un = state.unmuted || {}, events = [];
  for (const [key, e] of Object.entries(state.findings || {}))
    for (const h of e.history || [{ slug: e.slug, at: e.at }])
      events.push({ key, check: e.check || checkOfKey(key), title: e.title || key, at: h.at || '', out: outcome(h.slug) });
  events.sort((a, b) => a.at.localeCompare(b.at));
  const mutedChecks = {}, mutedKeys = {}, stats = {};
  for (const c of new Set(events.map((e) => e.check))) {
    const decided = events.filter((e) => e.check === c && !['waiting', 'gone'].includes(e.out) && e.at > (un['check:' + c] || ''));
    const last = decided.slice(-checkRun);
    if (last.length === checkRun && last.every((e) => e.out === 'dismissed'))
      mutedChecks[c] = `you dismissed its last ${checkRun} proposals`;
    stats[c] = Object.fromEntries(['waiting', 'confirmed', 'dismissed', 'resolved', 'gone'].map((o) => [o, events.filter((e) => e.check === c && e.out === o).length]));
    stats[c].proposed = events.filter((e) => e.check === c).length;
  }
  for (const k of new Set(events.map((e) => e.key))) {
    const ev = events.filter((e) => e.key === k && e.at > (un['key:' + k] || ''));
    if (ev.length >= keyRepeat && !ev.some((e) => e.out === 'confirmed'))
      mutedKeys[k] = { title: ev.at(-1).title, check: ev.at(-1).check, why: `proposed ${ev.length} times, never confirmed` };
  }
  return { mutedChecks, mutedKeys, stats };
};

// ---------- one project ----------
const say = (line) => console.log(line);
const secs = (t) => ((Date.now() - t) / 1000).toFixed(1) + 's';
// run fn over items, n at a time
const pool = async (items, n, fn) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
};
// the check a remembered key belongs to (entries before `check` was stored have only the key)
const checkOfKey = (k) => ({ 'ci-red': 'ci-red', flaky: 'flaky', pr: 'stuck-prs', dep: 'security', err: 'prod-errors', slow: 'slow-endpoints' })[k.split(':')[0]];
// when only a few more proposals fit, the most urgent kinds go first
const RANK = ['ci-red', 'prod-errors', 'slow-endpoints', 'security', 'flaky', 'stuck-prs'];
const RUNS_KEPT = 60;

// The run as data for the 🔭 Scout drawer: scout-current.json while it runs (each step says what
// it checks and why before it starts, then what it found and how long it took), then one entry
// per run in state/<project>/scout-runs.json. The log says the same in plain lines.
export const LIVE_FILE = path.join(CENTRAL, 'scout-current.json');
const scanProject = async (p, opts, live) => {
  const now = Date.now(), checks = new Set(p.checks), findings = [], warnings = [], ranOk = new Set();
  const rec = { project: p.name, at: new Date(now).toISOString(), steps: [], skipped: [], resolved: [], held: [], muted: [], made: [], found: {}, summary: '' };
  live.projects.push(rec);
  const flush = () => { if (!opts.dryRun) saveJson(LIVE_FILE, live); };
  const gh = (args) => runJson('gh', args, { cwd: p.root });
  const add = (list) => { findings.push(...list); return list.length; };
  const step = async (what, why, tags, fn) => {
    const t = Date.now(), st = { what, why, tags, result: '', secs: '', failed: false, made: [] };
    rec.steps.push(st);
    flush();
    say(`  → ${what}: ${why}`);
    const fail = (label, err) => { warnings.push(label + ': ' + err); st.failed = true; return '! failed: ' + err; };
    st.result = await fn(fail, st);
    st.secs = secs(t);
    if (!st.failed) for (const c of tags) ranOk.add(c);
    say(`    ${st.result} (${st.secs})`);
    if (st.failed) st.result = st.result.replace(/^! failed: /, '');
    flush();
  };
  say(`${p.name}: ${p.checks.length} check(s)`);
  if (checks.has('ci-red') || checks.has('flaky'))
    await step(`CI on ${p.base}`, 'red workflows, and tests that fail and then pass on the same commit', ['ci-red', 'flaky'].filter((c) => checks.has(c)), async (fail) => {
      const r = await gh(['run', 'list', '--branch', p.base, '--limit', '100', '--json', RUN_FIELDS]);
      if (!r.ok) return fail('gh run list', r.err);
      const red = checks.has('ci-red') ? (rec.found['ci-red'] = add(ciRedFindings(r.data, p.base))) : 0;
      const flaky = checks.has('flaky') ? (rec.found.flaky = add(flakyFindings(r.data, p.base, now))) : 0;
      return `${r.data.length} run(s) read: ${red} red workflow(s), ${flaky} flaky workflow(s)`;
    });
  if (checks.has('stuck-prs'))
    await step('Open PRs', `conflicts, or no activity for ${p.idleDays || 5} days`, ['stuck-prs'], async (fail) => {
      const r = await gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,url,updatedAt,mergeable,isDraft,baseRefName']);
      if (!r.ok) return fail('gh pr list', r.err);
      return `${r.data.length} open PR(s): ${(rec.found['stuck-prs'] = add(stuckPrFindings(r.data, now, p.idleDays || 5)))} stuck`;
    });
  if (checks.has('security'))
    await step('Dependabot alerts', 'open security alerts, one proposal per package', ['security'], async (fail) => {
      const r = await gh(['api', 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100']);
      if (!r.ok) return fail('Dependabot alerts', r.err);
      return `${r.data.length} open alert(s) in ${(rec.found.security = add(securityFindings(r.data)))} package(s)`;
    });
  for (const [c, fn, what, why] of [
    ['prod-errors', prodErrorChecks, 'Production errors', 'CloudWatch, the last 24 hours against the 7 days before; new errors, or 3× more often'],
    ['slow-endpoints', slowEndpointChecks, 'Slow endpoints', 'CloudWatch, p95 of the last 24 hours against the 7 days before; 2× slower and over the floor']]) {
    if (!checks.has(c)) continue;
    await step(what, why, [c], async (fail) => {
      if (!p.aws?.profile || !p.aws?.logGroups?.length) return fail(c, 'no "aws" settings with profile and logGroups');
      const r = await fn(p.aws, now);
      if (r.warning) return fail(c, r.warning.replace(/^[\w-]+: /, ''));
      return `${r.seen}: ${(rec.found[c] = add(r.findings))} finding(s)`;
    });
  }

  const stateFile = path.join(CENTRAL, 'state', p.name, 'scout.json');
  const metaFile = path.join(CENTRAL, 'state', p.name, 'plan-meta.json');
  const state = loadJson(stateFile, { findings: {} });
  const meta = loadJson(metaFile);
  const found = new Set(findings.map((f) => f.key));

  // A proposal nobody has looked at yet, whose problem is gone (the PR merged, the alert closed,
  // CI green again), is archived as "resolved". Only when its check ran this time without failing.
  for (const [key, e] of Object.entries(state.findings)) {
    const check = e.check || checkOfKey(key);
    if (found.has(key) || !ranOk.has(check) || meta[e.slug]?.status !== 'proposed') continue;
    const src = path.join(p.plansDir, e.slug + '.md');
    if (!existsSync(src)) continue;
    const title = e.title || key;
    rec.resolved.push({ slug: e.slug, title, check });
    say(`  ✓ resolved on its own: "${title}"`);
    if (opts.dryRun) continue;
    mkdirSync(p.doneDir, { recursive: true });
    renameSync(src, path.join(p.doneDir, e.slug + '.md'));
    meta[e.slug] = { ...meta[e.slug], status: 'resolved' };
    const m = loadJson(metaFile); m[e.slug] = { ...m[e.slug], status: 'resolved' }; saveJson(metaFile, m);
  }

  const outcome = (slug) => outcomeOf(meta[slug]?.status, existsSync(path.join(p.plansDir, slug + '.md')), existsSync(path.join(p.doneDir, slug + '.md')));
  const L = learn(state, outcome, p.learn || {});
  let todo = [];
  for (const f of findings) {
    const prev = state.findings[f.key];
    const at = prev && where(p, meta, prev.slug);
    const d = decide(prev, at, f.size, now);
    if (prev && d.resolvedAt && !prev.resolvedAt) prev.resolvedAt = d.resolvedAt;
    if (!d.propose) {
      const why = at === 'active' ? 'already waits as ' + prev.slug : at === 'done' ? 'fixed; waits 14 days before it is proposed again' : 'dismissed; not 2× worse';
      rec.skipped.push({ title: f.title, check: f.check, why });
      say(`  · skip "${f.title}": ${why}`);
      continue;
    }
    const mute = L.mutedChecks[f.check] ? `the ${f.check} check is muted: ${L.mutedChecks[f.check]}` : L.mutedKeys[f.key] ? 'muted: ' + L.mutedKeys[f.key].why : '';
    if (mute) {
      rec.muted.push({ title: f.title, check: f.check, key: f.key, why: mute });
      say(`  · muted "${f.title}": ${mute}`);
      continue;
    }
    if (prev && d.why) f.evidence += `\n- The scout proposed this before (\`${prev.slug}\`); it ${d.why}.`;
    todo.push(f);
  }
  // at most maxOpen proposals wait at a time: after a few days away the column stays readable,
  // and what does not fit is proposed on a later run, once you have looked at some
  const waiting = Object.entries(loadJson(metaFile)).filter(([slug, m]) => m.status === 'proposed' && existsSync(path.join(p.plansDir, slug + '.md'))).length;
  const room = Math.max(0, (p.maxOpen ?? 15) - waiting);
  todo.sort((x, y) => RANK.indexOf(x.check) - RANK.indexOf(y.check));
  if (todo.length > room) {
    for (const f of todo.slice(room)) rec.held.push({ title: f.title, check: f.check });
    say(`  · ${todo.length - room} finding(s) wait for room: ${waiting} proposal(s) already wait for you (maxOpen ${p.maxOpen ?? 15})`);
    todo = todo.slice(0, room);
  }

  const made = [];
  if (opts.dryRun) made.push(...todo.map((f) => ({ f })));
  else if (todo.length) {
    const model = p.model || 'sonnet';
    await step(`Writing ${todo.length} proposal(s)`, `${model} writes a short summary and a suggested direction for each, 3 at a time`, [], async (fail, st) => {
      await pool(todo, 3, async (f) => {
        const t = Date.now();
        const w = await writeUp(p, f, model);
        const slug = stamp() + '-scout-' + slugify(f.check + '-' + f.title);
        mkdirSync(p.plansDir, { recursive: true });
        writeFileSync(path.join(p.plansDir, slug + '.md'), proposalText(p, f, w));
        // read again just before the write: the dashboard may have changed a status meanwhile
        const m = loadJson(metaFile);
        m[slug] = { status: 'proposed', tags: ['scout', f.check] };
        saveJson(metaFile, m);
        linkChat(p, slug, w.session);
        const old = state.findings[f.key];
        const history = [...(old ? old.history || [{ slug: old.slug, at: old.at }] : []), { slug, at: new Date().toISOString() }];
        state.findings[f.key] = { slug, size: f.size, at: new Date(now).toISOString(), title: f.title, check: f.check, history };
        made.push({ f, slug });
        st.made.push({ slug, title: f.title, check: f.check, secs: secs(t) });
        flush();
        say(`    + ${f.title} → ${slug}.md (${secs(t)})`);
      });
      return `${made.length} written`;
    });
  }
  rec.made = made.filter((m) => m.slug).map((m) => ({ slug: m.slug, title: m.f.title, check: m.f.check }));
  rec.findings = findings.length;
  rec.seconds = Math.round((Date.now() - now) / 1000);
  rec.warnings = warnings;
  rec.summary = `${findings.length} finding(s), ${made.length} new proposal(s)`;
  if (!opts.dryRun) {
    state.lastRun = { at: rec.at, seconds: rec.seconds, findings: findings.length, proposed: made.length, made: rec.made, warnings };
    // per check: how often it ran without failing, what it found, and how many runs in a row found nothing
    const runs = state.checkRuns = state.checkRuns || {};
    for (const [c, n] of Object.entries(rec.found)) {
      if (!ranOk.has(c)) continue;
      const r = runs[c] = runs[c] || { runs: 0, found: 0, quiet: 0 };
      r.runs++; r.found += n; r.quiet = n ? 0 : r.quiet + 1;
    }
    state.learn = learn(state, outcome, p.learn || {});
    saveJson(stateFile, state);
    const runsFile = path.join(CENTRAL, 'state', p.name, 'scout-runs.json');
    saveJson(runsFile, [rec, ...loadJson(runsFile, [])].slice(0, RUNS_KEPT));
  }
  flush();
  return { findings, made, warnings };
};

// ---------- config ----------
export const loadProjects = (only) => {
  const cfg = loadJson(CONFIG, null);
  if (!cfg || !cfg.projects) throw new Error(`No ${CONFIG}. Copy scripts/scout.example.json there and edit it (docs/scout.md).`);
  const reg = loadJson(REGISTRY, { projects: [] }).projects;
  return Object.entries(cfg.projects).filter(([n]) => !only || n === only).map(([name, c]) => {
    const r = reg.find((x) => x.name === name);
    if (!r) throw new Error(`"${name}" is in ${CONFIG} but not in ${REGISTRY}. Add it to the dashboard first.`);
    const root = expand(r.root), plansDir = expand(r.plansDir) || path.join(root, '.plans');
    const checks = (c.checks || ALL_CHECKS).filter((x) => ALL_CHECKS.includes(x));
    return { ...c, name, root, plansDir, doneDir: expand(r.doneDir) || path.join(plansDir, 'done'), base: c.base || 'main', checks };
  });
};

// ---------- launchd ----------
/** Gives the absolute path of the scout's launchd template in scripts/launchd/ of this checkout. */
export const plistTemplate = () =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'launchd', 'com.plans-dashboard.scout.plist.template');

/** Gives the launchd plist of the daily job: the template with each value written as XML text. */
export const renderPlist = (template, values) =>
  Object.entries(values).reduce((xml, [k, v]) => xml.replaceAll(`__${k}__`,
    String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')), template);

const install = () => {
  const label = 'com.plans-dashboard.scout';
  const plist = path.join(HOME, 'Library', 'LaunchAgents', label + '.plist');
  const log = path.join(CENTRAL, 'logs', 'scout.log');
  mkdirSync(path.dirname(log), { recursive: true });
  mkdirSync(path.dirname(plist), { recursive: true });
  const xml = renderPlist(readFileSync(plistTemplate(), 'utf8'),
    { NODE: process.execPath, SCRIPT: fileURLToPath(import.meta.url), LOG: log, PATH: process.env.PATH });
  writeFileSync(plist, xml);
  const job = `gui/${process.getuid()}/${label}`;
  try { execFileSync('launchctl', ['bootout', job], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  console.log(`Installed ${plist}\nIt runs every day at 07:00, or when the Mac wakes if it slept through. Log: ${log}\nRun it now: launchctl kickstart ${job}`);
};

// ---------- main ----------
const main = async () => {
  const a = process.argv.slice(2);
  if (a.includes('--help') || a.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (a.includes('--install')) return install();
  const dryRun = a.includes('--dry-run');
  const only = a.includes('--project') ? a[a.indexOf('--project') + 1] : null;
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] scout${dryRun ? ' (dry run)' : ''}`);
  // the dashboard shows a run as running while this file names a live process, also a 07:00 run
  const lock = path.join(CENTRAL, 'scout.lock');
  if (!dryRun) {
    saveJson(lock, { pid: process.pid, startedAt: new Date(t0).toISOString() });
    process.on('exit', () => { try { if (loadJson(lock).pid === process.pid) unlinkSync(lock); } catch {} });
  }
  // the log keeps its last ~256 KB: the drawer reads runs from scout-runs.json, the log is for reading by hand
  const logFile = path.join(CENTRAL, 'logs', 'scout.log');
  if (!dryRun) try {
    const t = readFileSync(logFile, 'utf8');
    if (t.length > 1024 * 1024) writeFileSync(logFile, t.slice(t.indexOf('\n[', t.length - 256 * 1024) + 1));
  } catch {}
  const live = { startedAt: new Date(t0).toISOString(), projects: [] };
  if (!dryRun) process.on('exit', () => { try { if (loadJson(LIVE_FILE).startedAt === live.startedAt) unlinkSync(LIVE_FILE); } catch {} });
  let total = 0;
  const lines = [], problems = [];
  for (const p of loadProjects(only)) {
    const r = await scanProject(p, { dryRun }, live);
    console.log(`${p.name}: ${r.findings.length} finding(s), ${r.made.length} new proposal(s)`);
    if (dryRun) for (const m of r.made) console.log(`  + ${m.f.title}`);
    for (const w of r.warnings) console.log(`  ! ${w}`);
    total += r.made.length;
    if (r.made.length) lines.push(`${r.made.length} for ${p.name}`);
    if (r.warnings.length) problems.push(p.name);
  }
  console.log(`done in ${secs(t0)}`);
  if (dryRun) return;
  if (total) await notify(`${total} new proposal(s): ${lines.join(', ')}. Click to open the Board.`, '?view=board&scout=1');
  if (problems.length) await notify(`Some checks failed for ${problems.join(', ')}. Click to see why.`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(async (e) => { console.error('scout: ' + e.message); await notify('The scout failed: ' + e.message); process.exit(1); });
