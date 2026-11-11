// Tests for skills/bootstrap-project: render a throwaway repo, verify it, upgrade it.
// Everything runs in a temp folder; nothing touches ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/bootstrap-project');
const EXAMPLE = path.join(SKILL, 'references/bootstrap.example.json');
const node = (script, args, cwd) => spawnSync(process.execPath, [path.join(SKILL, 'scripts', script), ...args], { cwd, encoding: 'utf8' });

// a new repo with a package.json and the example answers, rendered with --apply new
function bootstrapRepo(edit = (p) => p) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
  const repo = path.join(dir, 'acme-api');
  mkdirSync(path.join(repo, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'acme-api', private: true, scripts: { test: 'node --test', lint: 'node --check package.json' } }));
  writeFileSync(path.join(repo, '.claude/bootstrap.json'), JSON.stringify(edit(JSON.parse(readFileSync(EXAMPLE, 'utf8'))), null, 2));
  const r = node('render.mjs', ['.', '--stage', path.join(dir, 'stage'), '--apply', 'new'], repo);
  assert.equal(r.status, 0, r.stderr);
  return { dir, repo, stage: path.join(dir, 'stage') };
}

test('a fresh render passes every required verify check and the dashboard is green', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const v = node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo);
    const out = JSON.parse(v.stdout);
    assert.deepEqual(out.failed, [], v.stdout);
    assert.match(out.dashboard, /^green/);
    assert.equal(v.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an upgrade with no changes reports every file as same and skips the first plan', () => {
  const { dir, repo, stage } = bootstrapRepo();
  try {
    const r = node('render.mjs', ['.', '--upgrade', '--stage', stage, '--json'], repo);
    const files = JSON.parse(r.stdout).files;
    assert.deepEqual(files.filter((f) => f.status !== 'same').map((f) => f.path), []);
    assert.ok(!files.some((f) => f.kind === 'first-plan'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an upgrade keeps a hand-tuned CONFIG line and lists the answer that differs', () => {
  const { dir, repo, stage } = bootstrapRepo();
  try {
    const lint = path.join(repo, '.claude/scripts/post-edit-lint.sh');
    writeFileSync(lint, readFileSync(lint, 'utf8').replace('LINT_FIX_FILE_CMD="npx oxlint --fix"', 'LINT_FIX_FILE_CMD="npx oxlint --fix --quiet"'));
    const answers = path.join(repo, '.claude/bootstrap.json');
    const p = JSON.parse(readFileSync(answers, 'utf8'));
    p.git.base = 'main';
    p.modules.codex = false;
    writeFileSync(answers, JSON.stringify(p, null, 2));
    const files = JSON.parse(node('render.mjs', ['.', '--upgrade', '--stage', stage, '--json'], repo).stdout).files;
    const by = (f) => files.find((x) => x.path === f);
    assert.equal(by('.claude/scripts/post-edit-lint.sh').status, 'config');
    assert.ok(by('.claude/scripts/post-edit-lint.sh').diff.includes('- LINT_FIX_FILE_CMD="npx oxlint --fix --quiet"'));
    assert.ok(by('.claude/scripts/auto-pipeline.sh').diff.includes('+ BASE_BRANCH="main"'));
    assert.equal(by('.codex/skills/validate-plan/SKILL.md').status, 'orphan');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render rejects compound commands and unknown modules', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const p = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
    p.stack.installCmd = 'npm ci && npm run build';
    p.modules.nope = true;
    writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(p));
    const r = node('render.mjs', ['.', '--params', 'answers.json', '--stage', path.join(dir, 'stage')], dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /npm ci && npm run build/);
    assert.match(r.stderr, /modules\.nope/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify fails on a deny rule that blocks the "to PR" overlay', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const f = path.join(repo, '.claude/settings.json');
    const s = JSON.parse(readFileSync(f, 'utf8'));
    s.permissions.deny.push('Bash(git push*)');
    writeFileSync(f, JSON.stringify(s));
    const out = JSON.parse(node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo).stdout);
    assert.ok(out.failed.includes('deny-overlay'));
    assert.ok(existsSync(path.join(repo, '.claude/scripts/auto-pipeline.sh')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
