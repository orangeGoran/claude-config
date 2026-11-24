// Pure helpers of the dashboard's event watcher (server.mjs, section "event watcher").
// No imports and no side effects: the server gives the data in, the tests check the result.
// Guide: docs/plans-dashboard.md, "Waits for and the event watcher".

const WAITS_RE = /^\s*[-*]\s*\*\*Waits for\*\*:\s*(.+?)\s*$/;
const PR_RE = /^(\S+) PR #(\d{1,7}) merged$/;
const PLAN_RE = /^(\S+) plan ([A-Za-z0-9_-][A-Za-z0-9._-]*) merged$/;
const SUB_RE = /^submodule (\S+) contains ([0-9a-f]{7,40})$/;

/**
 * Reads the `- **Waits for**: <condition>` lines of a plan header.
 * The header is the text before the first line that starts with `## `. Lines inside ``` fences do not count.
 * Returns null when the header has no such line. Else returns one object per line:
 * `{ kind: 'pr', project, number, text }`, `{ kind: 'plan', project, slug, text }`,
 * `{ kind: 'submodule', path, sha, text }`, or `{ kind: 'bad', text }` for a condition it cannot read.
 */
export function parseWaitsFor(content) {
  const out = [];
  let fence = false;
  for (const line of String(content || '').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;   // a `## ` line inside an example block does not end the header
    if (line.startsWith('## ')) break;
    const m = line.match(WAITS_RE);
    if (!m) continue;
    const text = m[1].replace(/`/g, '').trim();
    let c;
    if ((c = text.match(PR_RE))) out.push({ kind: 'pr', project: c[1], number: +c[2], text });
    else if ((c = text.match(PLAN_RE)) && !c[2].includes('..')) out.push({ kind: 'plan', project: c[1], slug: c[2], text });
    else if ((c = text.match(SUB_RE)) && !c[1].includes('..') && !/^[/-]/.test(c[1]))
      out.push({ kind: 'submodule', path: c[1], sha: c[2], text });
    else out.push({ kind: 'bad', text });
  }
  return out.length ? out : null;
}

/**
 * Writes the PR rows of one watcher tick over the saved PR map.
 * Returns a copy of `prev` (or `{}`) where each row's number holds `{ state }`.
 * Numbers that are not in `rows` stay, so a PR that merges much later still makes one event only.
 */
export function prMap(rows, prev) {
  const out = { ...(prev || {}) };
  for (const r of rows || []) out[r.number] = { state: r.state };
  return out;
}

/**
 * Compares the saved PR map with this tick's rows and returns the PR events.
 * `prev === null` (the first tick of a project) gives no events.
 * A new number gives `pr-opened` (OPEN, created after `since`), `pr-merged` (MERGED, merged after `since`)
 * or `pr-closed` (CLOSED, closed after `since`).
 * A known number gives `pr-merged` or `pr-closed` when its state changed to MERGED or CLOSED.
 * Each event takes `number`, `title`, `url`, `branch` (head) and `base` from its row.
 */
export function prEvents(prev, rows, since) {
  if (prev == null) return [];
  const sinceMs = Date.parse(since);
  const after = (t) => !!t && Date.parse(t) > sinceMs;
  const out = [];
  for (const r of rows || []) {
    const old = prev[r.number];
    let type = null;
    if (!old) {
      if (r.state === 'OPEN' && after(r.createdAt)) type = 'pr-opened';
      else if (r.state === 'MERGED' && after(r.mergedAt)) type = 'pr-merged';
      else if (r.state === 'CLOSED' && after(r.closedAt)) type = 'pr-closed';
    } else if (old.state !== r.state) {
      if (r.state === 'MERGED') type = 'pr-merged';
      else if (r.state === 'CLOSED') type = 'pr-closed';
    }
    if (type) out.push({ type, number: r.number, title: r.title, url: r.url, branch: r.headRefName, base: r.baseRefName });
  }
  return out;
}

/**
 * Compares the saved run outcomes with the new ones and returns a `run-outcome` event
 * for each slug whose `outcome` or `status` changed. `prev === null` gives no events.
 * A slug that is new in `next` counts as changed from null.
 */
export function outcomeEvents(prev, next) {
  if (prev == null) return [];
  const out = [];
  for (const [slug, n] of Object.entries(next || {})) {
    const p = prev[slug];
    if (p && p.outcome === n.outcome && p.status === n.status) continue;
    out.push({ type: 'run-outcome', slug, outcome: n.outcome, status: n.status, previous: p ? p.outcome : null });
  }
  return out;
}

/**
 * Counts the plans of a project that run now: live, starting, or with a fresh `running` report.
 * A report counts only when it is newer than `staleMs` and its status does not start with CLEANED or unknown.
 */
export function runningCount(plans, now, staleMs) {
  return (plans || []).filter((p) => p.live === true
    || (p.launch && p.launch.state === 'starting')
    || (p.run && p.run.outcome === 'running' && !/^(CLEANED|unknown)/.test(String(p.run.status || ''))
      && p.reportAt != null && now - p.reportAt < staleMs)).length;
}

/**
 * Tells if the watcher can start a plan now. True only when every condition of `waits` is met,
 * the watcher did not start the plan before, the plan has no run, no launch, no worktree,
 * no busy chat and no open permission question, its status is not parked or proposed,
 * and fewer than `limit` plans of the project run.
 */
export function canAutoLaunch(plan, waits, launched, running, limit) {
  return Array.isArray(waits) && waits.length > 0 && waits.every((w) => w.met === true)
    && !(launched || {})[plan.slug]
    && plan.run == null && plan.live === false && plan.launch == null
    && plan.worktree === false && plan.chatting === false && (plan.chatWaits || 0) === 0
    && plan.status !== 'parked' && plan.status !== 'proposed'
    && running < limit;
}

/** Returns the last `max` lines of `text`. A final line end stays. */
export function capLines(text, max) {
  const s = String(text || '');
  const end = s.endsWith('\n');
  const lines = (end ? s.slice(0, -1) : s).split('\n');
  if (lines.length <= max) return s;
  return lines.slice(-max).join('\n') + (end ? '\n' : '');
}

/**
 * Removes secrets from a text that a command printed: the user and password in a URL,
 * URL query strings, `Bearer <x>`, `<name>=<x>` for names with token, secret, password or key,
 * and GitHub or API tokens. Returns at most 500 characters.
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/(https?:\/\/)[^\s/@?#]+@/g, '$1[redacted]@')
    .replace(/(https?:\/\/[^\s?#]*)\?[^\s#]*/g, '$1?[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/([A-Za-z0-9_.-]*(?:token|secret|password|key)[A-Za-z0-9_.-]*)=([^\s&]+)/gi, '$1=[redacted]')
    .replace(/\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-)[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 500);
}
