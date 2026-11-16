#!/usr/bin/env node
// changelog-validate.mjs — check the changelog.d/ entries of this repo.
//
//   node .claude/scripts/changelog-validate.mjs                    check every entry file
//   node .claude/scripts/changelog-validate.mjs --base origin/<b>  also: the branch adds an
//                                                                  entry, and the version
//                                                                  goes up by one step
//   node .claude/scripts/changelog-validate.mjs --base <ref> --skip-required
//                                                                  the no-changelog label:
//                                                                  check the files only
//
// The "Changelog Gate" workflow and /changelog-entry run it. The format is in
// changelog.d/README.md. No dependencies: it reads only the small YAML shape of an entry
// (top-level keys, "|" text blocks, and one nested map for `customer`).
//
// Repo-specific settings are in the CONFIG block; the rest is the same in every repo.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ============================ CONFIG (@@PROJECT_NAME@@) ============================
// The languages of the customer note. Every entry that customers see has all of them.
const LOCALES = @@CHANGELOG_LOCALES_JS@@;
// The file with the release version ("version" in JSON, or `version = "…"` in TOML).
// Empty: no version check.
const VERSION_FILE = '@@CHANGELOG_VERSION_FILE@@';
// ==================================================================================

const DIR = 'changelog.d';
const KINDS = ['added', 'changed', 'fixed', 'removed', 'security', 'performance'];
const AUDIENCES = ['internal', 'customer', 'both'];
const KEYS = ['kind', 'audience', 'scope', 'pr', 'summary', 'internal', 'customer'];
const SCOPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOCS = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md']);

const text = (v) => typeof v === 'string' && v.trim().length > 0;

/** Reads a plain scalar: a quoted text, an integer, or the bare text without a trailing comment. */
function scalar(raw) {
  const s = raw.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(s)) return JSON.parse(s);
  if (/^'(?:[^']|'')*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  const bare = s.replace(/\s+#.*$/, '').trim();
  return /^-?\d+$/.test(bare) ? Number(bare) : bare;
}

/**
 * Parses the entry shape: `key: value`, `key: |` with indented lines, and `key:` with
 * indented `sub: value` lines. Returns { value } or { error }.
 */
export function parseEntry(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = {};
  const indent = (l) => l.match(/^ */)[0].length;
  // a "|" or ">" block: the lines that are more indented than `min`, or empty
  const block = (i, min, style) => {
    const body = [];
    while (i < lines.length && (lines[i].trim() === '' || indent(lines[i]) > min)) body.push(lines[i++]);
    while (body.length && body.at(-1).trim() === '') body.pop();
    const cut = Math.min(...body.filter((l) => l.trim()).map(indent));
    const rows = body.map((l) => l.slice(cut));
    return { i, value: style.startsWith('>') ? rows.join(' ').replace(/\s+/g, ' ').trim() : rows.join('\n') + '\n' };
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line) || line === '---') { i++; continue; }
    const m = line.match(/^([a-z_]+):(?:\s+(.*))?$/);
    if (!m) return { error: `line ${i + 1}: expected "key: value" at the start of the line` };
    const [, key, rest = ''] = m;
    const v = rest.replace(/\s+#.*$/, '').trim();
    i++;
    if (/^[|>][-+]?$/.test(v)) {
      const b = block(i, 0, v);
      out[key] = b.value; i = b.i;
    } else if (v === '') {
      const map = {};
      while (i < lines.length && (lines[i].trim() === '' || indent(lines[i]) > 0)) {
        const sub = lines[i];
        if (!sub.trim() || /^\s*#/.test(sub)) { i++; continue; }
        const sm = sub.match(/^(\s+)([A-Za-z_-]+):(?:\s+(.*))?$/);
        if (!sm) return { error: `line ${i + 1}: expected "  key: value" under "${key}:"` };
        const sv = (sm[3] || '').replace(/\s+#.*$/, '').trim();
        i++;
        if (/^[|>][-+]?$/.test(sv)) {
          const b = block(i, sm[1].length, sv);
          map[sm[2]] = b.value; i = b.i;
        } else {
          map[sm[2]] = scalar(sm[3] || '');
        }
      }
      out[key] = map;
    } else {
      out[key] = scalar(rest);
    }
  }
  return { value: out };
}

/**
 * Returns the problems of one parsed entry (empty when valid). `needSummary` is false for
 * an entry written before `summary` existed: only the entries a branch adds must have it.
 */
export function checkEntry(e, at, { needSummary = true } = {}) {
  const errs = [];
  for (const k of Object.keys(e)) if (!KEYS.includes(k)) errs.push(`${at}: unknown field "${k}" (allowed: ${KEYS.join(', ')})`);
  if (!KINDS.includes(e.kind)) errs.push(`${at}: "kind" must be one of ${KINDS.join(', ')}`);
  if (!AUDIENCES.includes(e.audience)) errs.push(`${at}: "audience" must be one of ${AUDIENCES.join(', ')}`);
  if (!text(e.scope) || !SCOPE_RE.test(e.scope)) errs.push(`${at}: "scope" must be a kebab-case area, for example "orders"`);
  if (e.pr !== undefined && !(Number.isInteger(e.pr) && e.pr > 0)) errs.push(`${at}: "pr" must be a positive number, or left out`);
  if (needSummary && !text(e.summary)) errs.push(`${at}: "summary" is missing: one short paragraph in plain words`);
  if (!text(e.internal)) errs.push(`${at}: "internal" is missing: what changed, for developers`);
  if (e.audience === 'customer' || e.audience === 'both') {
    const c = e.customer;
    if (!c || typeof c !== 'object') {
      errs.push(`${at}: "customer" is missing: a text in each of ${LOCALES.join(', ')}`);
    } else {
      for (const l of LOCALES) if (!text(c[l])) errs.push(`${at}: "customer.${l}" is missing or empty`);
      for (const l of Object.keys(c)) if (!LOCALES.includes(l)) errs.push(`${at}: "customer.${l}" is not a language of this project (${LOCALES.join(', ')})`);
    }
  } else if (e.customer !== undefined) {
    errs.push(`${at}: "customer" must be left out when audience is "internal" (use "both" when customers see the change)`);
  }
  return errs;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
/** Reads the version from the text of a JSON or TOML file, or null. */
export function readVersion(src) {
  if (src == null) return null;
  return src.match(/"version"\s*:\s*"([^"]+)"/)?.[1] ?? src.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}
/** Returns null when `to` is exactly one patch, minor or major step above `from`, else the problem. */
export function stepProblem(from, to) {
  const a = from.match(SEMVER), b = to.match(SEMVER);
  if (!a || !b) return `the version must look like 1.4.2 (base "${from}", branch "${to}")`;
  const [x, y, z] = a.slice(1).map(Number), [p, q, r] = b.slice(1).map(Number);
  const ok = (p === x && q === y && r === z + 1) || (p === x && q === y + 1 && r === 0) || (p === x + 1 && q === 0 && r === 0);
  if (ok) return null;
  if (p === x && q === y && r === z) return `the version is still ${from}. Raise it by one step: patch for a fix, minor for a feature, major for a breaking change`;
  return `${from} -> ${to} is not one step. Use ${x}.${y}.${z + 1} (patch), ${x}.${y + 1}.0 (minor) or ${x + 1}.0.0 (major)`;
}

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function main(argv) {
  const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;
  const skip = argv.includes('--skip-required');
  const errs = [], notes = [];

  if (base) {
    try { git('rev-parse', '--verify', '--quiet', `${base}^{commit}`); } catch {
      console.log(`Changelog check: FAIL\n  x Unknown base "${base}". Run git fetch origin, or give the right branch after --base.`);
      process.exit(1);
    }
  }
  // the entries this branch adds: not yet added, staged, and (with --base) committed on the
  // branch. Only these must have `summary`; older entries were written before it existed.
  const list = (...args) => git(...args).split('\n');
  const added = new Set([
    ...list('ls-files', '--others', '--exclude-standard', '--', `${DIR}/`),
    ...list('diff', '--name-only', '--diff-filter=A', '--cached', '--', `${DIR}/`),
    ...(base ? list('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', `${DIR}/`) : []),
  ].filter((f) => f && !DOCS.has(path.basename(f))));

  const dir = path.join(REPO, DIR);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => !DOCS.has(f)).sort() : [];
  for (const f of files) {
    const at = `${DIR}/${f}`;
    if (!/\.ya?ml$/.test(f)) { errs.push(`${at}: an entry file ends with .yaml`); continue; }
    const parsed = parseEntry(readFileSync(path.join(dir, f), 'utf8'));
    if (parsed.error) errs.push(`${at}: ${parsed.error}`);
    else errs.push(...checkEntry(parsed.value, at, { needSummary: added.has(at) }));
  }
  notes.push(`${files.length} entry file(s) checked.`);

  if (base && skip) notes.push('The no-changelog label is on the PR: no new entry and no version step needed.');
  if (base && !skip) {
    if (!added.size) errs.push(`The branch adds no file under ${DIR}/. Run /changelog-entry, or put the label no-changelog on the PR.`);
    else notes.push(`New: ${[...added].join(', ')}`);
    if (VERSION_FILE) {
      let before = null;
      try { before = readVersion(git('show', `${base}:${VERSION_FILE}`)); } catch { /* not on the base yet */ }
      const now = readVersion(existsSync(path.join(REPO, VERSION_FILE)) ? readFileSync(path.join(REPO, VERSION_FILE), 'utf8') : null);
      if (!now) errs.push(`${VERSION_FILE} has no version.`);
      else if (!before) notes.push(`${VERSION_FILE}: no version on ${base}; ${now} is the first.`);
      else {
        const problem = stepProblem(before, now);
        if (problem) errs.push(`${VERSION_FILE}: ${problem}.`);
        else notes.push(`${VERSION_FILE}: ${before} -> ${now}.`);
      }
    }
  }

  console.log(errs.length ? 'Changelog check: FAIL' : 'Changelog check: PASS');
  for (const n of notes) console.log('  - ' + n);
  for (const e of errs) console.log('  x ' + e);
  process.exit(errs.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
