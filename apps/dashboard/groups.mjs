// Pure helpers of the group ledger and the checklist (server.mjs, section "group ledger").
// No imports and no side effects: the server gives the data in, the tests check the result.
// Guide: docs/plans-dashboard.md, "Groups and the checklist".

const TICKETS_RE = /^\s*[-*]\s*\*\*Tickets\*\*:\s*(.+?)\s*$/;
const TICKET_RE = /^(?:([\w.-]+\/[\w.-]+))?#(\d{1,7})$/;
const ISSUES_RE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/$/;
const NO_RUN_RE = /^(CLEANED|unknown)/;

/**
 * Tells if `s` is a good group name: a string of 1 to 40 characters of `A-Z a-z 0-9 . _ -`, not `.` or `..`.
 * The name is also a folder name, so other characters are not accepted.
 */
export function safeGroup(s) {
  return typeof s === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(s) && s !== '.' && s !== '..';
}

/**
 * Reads the `- **Tickets**: <#n, owner/repo#n …>` line of a plan header.
 * The header is the text before the first line that starts with `## `. Lines inside ``` fences do not count.
 * Only the first such line counts. Each part must be `#<n>` or `owner/repo#<n>` (n has 1 to 7 digits);
 * other parts are skipped. Returns `[{ repo, number }]` (`repo` is `'owner/name'` or null), without repeats.
 * Returns `[]` when there is no line or no good part.
 */
export function parseTickets(content) {
  let fence = false;
  for (const line of String(content || '').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;   // a `## ` line inside an example block does not end the header
    if (line.startsWith('## ')) break;
    const m = line.match(TICKETS_RE);
    if (!m) continue;
    const out = [];
    const seen = new Set();
    for (const part of m[1].replace(/`/g, '').split(/[\s,;]+/)) {
      const t = part.match(TICKET_RE);
      if (!t) continue;
      const repo = t[1] || null;
      const k = (repo || '') + '#' + +t[2];
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ repo, number: +t[2] });
    }
    return out;
  }
  return [];
}

/**
 * Gives the key and the issue URL of one ticket `t` of a plan in `project`.
 * A ticket with `repo` uses that GitHub repo. A ticket without `repo` uses the project's GitHub issues URL
 * (`https://github.com/<owner>/<repo>/issues/`) when it has one, else the key `<project>#<n>` and no URL.
 * A GitHub key is lower case (GitHub names are not case-sensitive); the URL keeps the case as written.
 * The `<project>#<n>` key keeps the project name as it is.
 */
export function ticketKey(t, issuesUrl, project) {
  const n = t.number;
  if (t.repo) return { key: t.repo.toLowerCase() + '#' + n, url: 'https://github.com/' + t.repo + '/issues/' + n };
  const m = String(issuesUrl || '').match(ISSUES_RE);
  if (m) return { key: m[1].toLowerCase() + '#' + n, url: issuesUrl + n };
  return { key: project + '#' + n, url: null };
}

/**
 * Gives the step of one `/api/state` plan object: `done`, `running`, `closed`, `failed`, `needs-you`,
 * `waiting` or `planned`. The first rule that matches wins, in this order.
 * A `running` report counts as running only when it is newer than `staleMs`; an older one counts as failed.
 * A report whose status starts with CLEANED or unknown counts as no run.
 */
export function planStep(p, now, staleMs) {
  const run = p.run || null;
  const noRun = !run || NO_RUN_RE.test(String(run.status || ''));
  const runningReport = !noRun && run.outcome === 'running';
  const fresh = runningReport && p.reportAt != null && now - p.reportAt < staleMs;
  const pr = p.pr && p.pr.state;
  if (p.archived || pr === 'MERGED') return 'done';
  if (p.live || (p.launch && p.launch.state === 'starting') || fresh) return 'running';
  if (pr === 'CLOSED') return 'closed';
  if ((p.launch && p.launch.state === 'failed') || (!noRun && run.outcome === 'failed') || runningReport) return 'failed';
  if ((!noRun && run.outcome === 'needs-you') || (p.chatWaits || 0) > 0 || pr === 'OPEN') return 'needs-you';
  if (Array.isArray(p.waits) && p.waits.some((w) => w.met === false)) return 'waiting';
  return 'planned';
}

/**
 * Builds the chain ticket → plan → step → PR for the `/api/state` project objects of one group
 * (each with `name`, `issuesUrl` and `plans`). Returns `{ tickets, untracked }`.
 * An active plan goes into each of its tickets (once per ticket key), or into `untracked` when it has none.
 * An archived plan goes only into tickets that also have an active plan. Rows are sorted by slug,
 * tickets by the slug of their first row. A ticket is `done` when every row's step is `done`.
 */
export function buildChain(projects, now, staleMs) {
  const tickets = new Map();
  const untracked = [];
  const archivedRows = [];
  for (const proj of projects || []) {
    for (const p of proj.plans || []) {
      const row = {
        project: proj.name, slug: p.slug, title: p.title, step: planStep(p, now, staleMs),
        pr: p.pr ? { number: p.pr.number, state: p.pr.state, url: p.pr.url } : null,
        waits: p.waits ? p.waits.map(({ text, met, error }) => ({ text, met, error: error || null })) : null,
        archived: !!p.archived,
      };
      const keys = new Map();
      for (const t of p.tickets || []) {
        const k = ticketKey(t, proj.issuesUrl, proj.name);
        if (!keys.has(k.key)) keys.set(k.key, k);
      }
      if (!keys.size) { if (!p.archived) untracked.push(row); continue; }
      if (p.archived) { archivedRows.push({ row, keys }); continue; }
      for (const k of keys.values()) {
        if (!tickets.has(k.key)) tickets.set(k.key, { key: k.key, url: k.url, plans: [] });
        const tk = tickets.get(k.key);
        if (!tk.url && k.url) tk.url = k.url;
        tk.plans.push(row);
      }
    }
  }
  for (const { row, keys } of archivedRows)
    for (const k of keys.keys()) if (tickets.has(k)) tickets.get(k).plans.push(row);
  const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const list = [...tickets.values()].map((t) => {
    t.plans.sort(bySlug);
    return { key: t.key, url: t.url, done: t.plans.every((r) => r.step === 'done'), plans: t.plans };
  });
  list.sort((a, b) => bySlug(a.plans[0], b.plans[0]));
  untracked.sort(bySlug);
  return { tickets: list, untracked };
}

/** Gives the text of a new `ledger.md` for `group`: a title, one line of help, and empty Goals, Holds and Notes. */
export function ledgerTemplate(group) {
  return '# Ledger: ' + group + '\n\nGoals, holds and notes of this group. The dashboard computes the tickets, plans and PRs by itself.\n\n## Goals\n\n## Holds\n\n## Notes\n';
}
