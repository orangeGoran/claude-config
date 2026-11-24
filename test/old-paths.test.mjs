// Fails on any reference to a path the dashboard and the scout had before they moved to apps/.
// Plans (.plans/) and release notes (changelog.d/) keep their history, so they are not read.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.relative(REPO, fileURLToPath(import.meta.url));
// the path text, and the same paths built in code: path.join(..., 'scripts', 'scout.mjs'),
// path.join(..., 'scripts', 'plans-dashboard', ...) or "$HERE/scout.mjs" in scripts/
const OLD = new RegExp([
  /scripts\/plans-dashboard|scripts\/scout\.mjs|scripts\/chat-relay|scripts\/test\/|restart-dashboard|\bplans-dashboard\.mjs\b/.source,
  /['"]scripts['"],\s*['"](?:scout\.mjs|chat-relay\.mjs|plans-dashboard|test)['"]/.source,
  /\$HERE\/(?:scout|chat-relay)\.mjs/.source,
].join('|'));

// a NUL byte in the first 8 KB means a binary file (the PNGs and the video in docs/)
const isBinary = (file) => {
  const buf = Buffer.alloc(8192);
  const fd = openSync(file, 'r');
  try { return buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).includes(0); } finally { closeSync(fd); }
};

test('no file names an old path of the dashboard or the scout', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: REPO, encoding: 'utf8' })
    .split('\0').filter((f) => f && f !== SELF && !f.startsWith('.plans/') && !f.startsWith('changelog.d/'));
  assert.ok(files.length > 0, 'git lists the files of the repo');
  const hits = [];
  for (const f of files) {
    const abs = path.join(REPO, f);
    let lines;
    try { if (isBinary(abs)) continue; lines = readFileSync(abs, 'utf8').split('\n'); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }   // deleted, not yet staged
    lines.forEach((l, i) => { if (OLD.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`); });
  }
  assert.deepEqual(hits, [], 'old paths are left:\n' + hits.join('\n'));
});
