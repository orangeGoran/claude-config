// Pure helpers of the contracts jump (server.mjs, sections "event watcher" step 5b and "contracts jump").
// No imports and no side effects: the server gives the data in, the tests check the result.
// Guide: docs/plans-dashboard.md, "Contracts jump".

const SUB_PATH_RE = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/;
const JUMP_RE = /^\s*[-*]\s*\*\*Contracts jump\*\*:\s*(.+?)\s*$/;

/**
 * Tells if `s` is a good watched submodule path: a string of 1–200 characters of `A-Z a-z 0-9 _ . / -`
 * that does not start with `/` or `-`, has no `..` anywhere, no `.` segment and no empty segment.
 * A good path is also a good `submodule <path> contains <sha>` path for `parseWaitsFor()`.
 */
export function safeSubPath(s) {
  if (typeof s !== 'string' || s.length < 1 || s.length > 200) return false;
  if (!SUB_PATH_RE.test(s) || s.includes('..')) return false;
  return s.split('/').every((seg) => seg !== '' && seg !== '.');
}

/**
 * Reads the watched submodule paths of a registry value.
 * `v` is an array of strings, or a string split on commas and spaces (the Settings input); else no paths.
 * Trims each item, removes one trailing `/`, keeps only good paths (`safeSubPath()`), removes repeats
 * and keeps the first 8. Returns `{ paths, dropped }`: `dropped` holds the bad non-empty items and the
 * good items after the first 8, in input order (repeats are dropped silently).
 */
export function parseSubPaths(v) {
  const items = Array.isArray(v) ? v.filter((x) => typeof x === 'string')
    : typeof v === 'string' ? v.split(/[\s,]+/) : [];
  const paths = [];
  const dropped = [];
  for (const raw of items) {
    const s = raw.trim().replace(/\/$/, '');
    if (!s) continue;
    if (!safeSubPath(s)) { dropped.push(s); continue; }
    if (paths.includes(s)) continue;
    if (paths.length >= 8) { if (!dropped.includes(s)) dropped.push(s); continue; }
    paths.push(s);
  }
  return { paths, dropped };
}

/**
 * Gives the base branch of a project's `.claude/scripts/auto-pipeline.sh` text:
 * the value of its first `BASE_BRANCH="<name>"` line, or null when it has none or the name is not good.
 */
export function launcherBase(text) {
  const m = String(text || '').match(/^BASE_BRANCH="([\w./][\w./-]*)"\s*$/m);
  return m ? m[1] : null;
}

/**
 * Gives the `branch` value of the `.gitmodules` section whose `path` is `subPath`, or null.
 * `gitmodules` is the text of the file (sections `[submodule "<name>"]`, lines `key = value`).
 * A value in double quotes loses its quotes; a `#` or `;` comment after an unquoted value is removed (git config rules).
 */
export function submoduleBranch(gitmodules, subPath) {
  let cur = null;
  const sections = [];
  const value = (v) => {
    const q = v.match(/^"((?:[^"\\]|\\.)*)"/);
    return q ? q[1].replace(/\\(.)/g, '$1') : v.replace(/\s*[#;].*$/, '').trim();
  };
  for (const line of String(gitmodules || '').split('\n')) {
    const t = line.trim();
    if (/^\[/.test(t)) { cur = /^\[submodule\s+"[^"]*"\]$/.test(t) ? {} : null; if (cur) sections.push(cur); continue; }
    const m = t.match(/^([A-Za-z][\w-]*)\s*=\s*(.*)$/);
    if (cur && m) cur[m[1].toLowerCase()] = value(m[2].trim());
  }
  const s = sections.find((x) => x.path === subPath);
  return s && s.branch ? s.branch : null;
}

/**
 * Gives a key that is the same for every remote URL form of one repo.
 * Removes a `user[:password]@` part of an `http(s)://` URL, a trailing `/` and `.git`.
 * The GitHub forms `git@github.com:o/r`, `ssh://git@github.com/o/r` and `https://github.com/o/r`
 * give `github.com/o/r` in lower case. Any other value (a local path) stays as it is. No value gives `''`.
 */
export function repoKey(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  s = s.replace(/^(https?:\/\/)[^/@\s]+@/i, '$1');
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  let m;
  if ((m = s.match(/^git@github\.com:(.+)$/i))
    || (m = s.match(/^ssh:\/\/git@github\.com(?::\d+)?\/(.+)$/i))
    || (m = s.match(/^https?:\/\/(?:www\.)?github\.com\/(.+)$/i))) return ('github.com/' + m[1]).toLowerCase();
  return s;
}

/**
 * Reads the path of the first `- **Contracts jump**: <path>` line of a plan header
 * (the header and fence rules of `parseWaitsFor()`; backticks are removed).
 * Returns the path when it is good (`safeSubPath()`), else null.
 */
export function parseJumpLine(content) {
  let fence = false;
  for (const line of String(content || '').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (line.startsWith('## ')) break;
    const m = line.match(JUMP_RE);
    if (!m) continue;
    const p = m[1].replace(/`/g, '').trim();
    return safeSubPath(p) ? p : null;
  }
  return null;
}

/** Gives the path part of a jump plan slug: the path in lower case, each run of other characters as one `-`, max 40 characters. */
export function jumpPathPart(subPath) {
  return String(subPath).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Gives the slug of a jump plan: `<stamp>-contracts-jump-<path part>`. */
export function jumpSlug(subPath, stamp) {
  return stamp + '-contracts-jump-' + jumpPathPart(subPath);
}

/** Gives `YYYYMMDD-HHMMSS` of the Date `d` in local time (the AGENTS.md plan name rule). */
export function planStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const prOut = (r) => ({ number: r.number, title: r.title, url: r.url });

/**
 * Gives the recommendation of the Contracts jump card for one watched path.
 * `sub` is the `watch.json` `subs` record (or null); `blockers` is the list of jump plans and jump PRs.
 * The first rule that matches wins: no check → `unchecked`; an error → `error`; a pin ahead or on another
 * line → `diverged`; a blocker → `blocked`; upstream PRs not read yet → `unchecked`; PRs that cannot be read
 * → `error`; open, non-draft PRs on the branch → `batch`; a pin behind → `now`; else `up-to-date`.
 * Returns `{ state, recommended, drafts, blockers, error }`; each PR is `{ number, title, url }`.
 */
export function recommendJump(sub, blockers) {
  const bl = Array.isArray(blockers) ? blockers : [];
  const out = (state, extra) => ({ state, recommended: [], drafts: [], blockers: bl, error: null, ...(extra || {}) });
  if (!sub || !sub.checkedAt) return out('unchecked');
  if (sub.error) return out('error', { error: sub.error });
  if (sub.relation === 'ahead' || sub.relation === 'diverged') return out('diverged');
  if (bl.length) return out('blocked');
  if (sub.upstream && sub.prs == null) return out('unchecked');
  if (sub.prs && sub.prs.error) return out('error', { error: 'cannot read the open PRs of ' + sub.upstream + ': ' + sub.prs.error });
  const rows = (sub.prs && Array.isArray(sub.prs.rows) ? sub.prs.rows : [])
    .filter((r) => r && r.state === 'OPEN' && r.baseRefName === sub.branch && Number.isInteger(r.number));
  const pick = (draft) => {
    const seen = new Set();
    return rows.filter((r) => !!r.isDraft === draft && !seen.has(r.number) && seen.add(r.number))
      .sort((a, b) => a.number - b.number).map(prOut);
  };
  const recommended = pick(false);
  const drafts = pick(true);
  if (recommended.length) return out('batch', { recommended, drafts });
  if (sub.relation === 'behind') return out('now', { drafts });
  return out('up-to-date', { drafts });
}

/**
 * Gives the text of one jump plan. The header has `- **Base**: <base>`, `- **Contracts jump**: <subPath>`
 * and one `- **Waits for**: <upstream> PR #<n> merged` line per number in `prs` (none without an upstream
 * or without PRs). The plan moves the submodule to the newest commit of `origin/<branch>` at run time,
 * and makes the code build with the new types. `pin` and `tip` are the shas at write time; `date` is `YYYY-MM-DD`.
 */
export function jumpPlanText({ subPath, branch, base, upstream, prs, pin, tip, date }) {
  const nums = upstream ? (prs || []) : [];
  const s7 = (x) => String(x || '').slice(0, 7) || 'unknown';
  const prText = (prs || []).length ? (prs || []).map((n) => '#' + n).join(', ') : 'none';
  const L = [];
  L.push('# Plan: Contracts jump: move `' + subPath + '` to the newest origin/' + branch, '');
  L.push('- **Base**: ' + base);
  L.push('- **Contracts jump**: ' + subPath);
  for (const n of nums) L.push('- **Waits for**: ' + upstream + ' PR #' + n + ' merged');
  L.push('', '## Goal', '');
  L.push('Move the submodule `' + subPath + '` to the newest commit of `origin/' + branch + '` at run time, and make the code build with the new contracts. Types only: no new feature and no behavior change.');
  L.push('The plans dashboard wrote this plan on ' + date + '. Then the pin was `' + s7(pin) + '` and `origin/' + branch + '` was `' + s7(tip) + '`. Upstream PRs: ' + prText + (upstream ? ' (' + upstream + ')' : '') + '.');
  L.push('', '## Context', '');
  L.push('- When `.claude/skills/contracts-jump/SKILL.md` exists, follow it. Its rules win over this text.');
  L.push('- The pin moves to the newest commit of `origin/' + branch + '` when the run starts, not to the tip named in the Goal.');
  L.push('- `## Steps`, `## Tests` and `## How to verify` are the default headings. Read them as the step, test and verify headings of this project.');
  L.push('', '## Steps', '');
  L.push('1. `git -C ' + subPath + ' fetch origin +refs/heads/' + branch + ':refs/remotes/origin/' + branch + '` (an explicit refspec, so `origin/' + branch + '` is the commit just fetched).');
  L.push('2. `git -C ' + subPath + ' merge-base --is-ancestor HEAD origin/' + branch + '`. When it fails (the upstream was force-pushed, or the pin is on another line), stop and write it under `## Questions`. Else run `git -C ' + subPath + ' checkout --detach origin/' + branch + '`, then write the new sha and `git -C ' + subPath + ' log --oneline ' + (pin || s7(pin)) + '..HEAD` into the run report.');
  L.push('3. Run the contract or type generation command of the AGENTS.md **Commands** table, when it has one.');
  L.push('4. Run the type check and the build of that table that exist. Fix only what the new contracts break (types, imports, renamed fields). A change that needs a product or design decision: stop and write it under `## Questions`.');
  L.push('5. Add the release note when the project uses `changelog.d/`.');
  L.push('', '## Tests', '');
  L.push('- Run the existing tests. Add a test only when a fix changes logic.');
  L.push('', '## How to verify', '');
  L.push('- The "Test (full)", "Type check" and "Build" commands of the AGENTS.md **Commands** table that exist.');
  L.push('- `git -C ' + subPath + ' merge-base --is-ancestor ' + (pin || s7(pin)) + ' HEAD`');
  return L.join('\n') + '\n';
}
