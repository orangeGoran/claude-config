// Tests for the QA reports icon: skills/browser-usability-test/qa-icon.svg, read by scripts/qa-icon.mjs, and
// the report that compare.mjs writes. (The dashboard's list page and /favicon.ico are checked in
// apps/dashboard/test/dashboard.test.mjs.)
//   node --test test/browser-usability-qa-icon.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QA_ICON, QA_ICON_SVG, QA_ICON_URI } from '../skills/browser-usability-test/scripts/qa-icon.mjs';

const SKILL = fileURLToPath(new URL('../skills/browser-usability-test/', import.meta.url));

test('qa-icon.svg is a flat icon on the macOS icon grid, not an emoji', () => {
  assert.match(QA_ICON_SVG, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* viewBox="0 0 1024 1024"/);
  assert.match(QA_ICON_SVG, /<rect x="100" y="100" width="824" height="824" rx="185"\/>/, 'the same rounded square as the Shipyard icon');
  assert.doesNotMatch(QA_ICON_SVG, /<text|📊/, 'no text or emoji');
});

test('QA_ICON is cut to the square and QA_ICON_URI holds it', () => {
  assert.match(QA_ICON, /viewBox="100 100 824 824"/);
  assert.doesNotMatch(QA_ICON, /viewBox="0 0 1024 1024"/);
  assert.ok(QA_ICON_URI.startsWith('data:image/svg+xml,'));
  assert.equal(decodeURIComponent(QA_ICON_URI.slice('data:image/svg+xml,'.length)), QA_ICON);
});

// compare.mjs loads playwright-core (lib.mjs) and checks the project profile with ajv: the skill's own
// packages (npm install --prefix <skill>). Without them the report test is skipped.
const skillRequire = createRequire(path.join(SKILL, 'package.json'));
const hasPackages = ['ajv', 'playwright-core'].every((p) => { try { return skillRequire.resolve(p); } catch { return false; } });

test('a report that compare.mjs writes has the QA reports icon', { skip: !hasPackages && 'the skill\'s packages are not installed' }, () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'qa-icon-test-'));
  try {
    const store = path.join(tmp, 'store'), qaDir = path.join(tmp, 'qa'), out = path.join(tmp, 'report.html');
    mkdirSync(path.join(store, 'demo-app'), { recursive: true });
    mkdirSync(qaDir);
    writeFileSync(path.join(store, 'demo-app', 'project.json'), JSON.stringify({ repos: [{ role: 'frontend', path: path.join(tmp, 'demo-web') }], app: { url: 'http://127.0.0.1:4911' } }));
    const items = path.join(tmp, 'items.json');
    writeFileSync(items, JSON.stringify({ date: '2026-11-26', route: '/demo', account: 'Ana Example', summary: 'A made-up test run.', items: [] }));
    const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'compare.mjs'), items, `--out=${out}`], {
      encoding: 'utf8',
      // QA_REPORTS_PORT=1: no report server answers there, so publish() gives no link and the run stays offline
      env: { ...process.env, HOME: tmp, QA_HOME: store, QA_DIR: qaDir, QA_PROJECT: 'demo-app', QA_REPORTS_PORT: '1' },
    });
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(out, 'utf8');
    assert.ok(html.includes(`<link rel="icon" href="${QA_ICON_URI}">`), 'the report has the QA reports icon inline');
    assert.doesNotMatch(html, /📊/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
