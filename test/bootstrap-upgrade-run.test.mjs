// Tests for skills/bootstrap-project/scripts/upgrade-run.mjs: the unattended upgrade of one
// repo. Each test makes a throwaway repo with a bare origin in a temp folder, and puts a fake
// claude and a fake gh first in PATH, so no test talks to Claude or GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, unlinkSync, appendFileSync, symlinkSync, readdirSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/bootstrap-project');
const SCRIPT = path.join(SKILL, 'scripts/upgrade-run.mjs');
const EXAMPLE = path.join(SKILL, 'references/bootstrap.example.json');
const SKILL_FILE = '.claude/skills/skill-3-test/SKILL.md';
const PROJECT_LINE = 'Acme project line: keep the acme fixtures small.';
const { remoteBranchSha, prBody, symlinkedPath, resumeCommand } = await import(SCRIPT);

// the fake claude: reads task.json, writes merged/<n> and decisions.json. FAKE_MODE picks a
// bad output for one test. It logs its argv, its cwd and the files of its folder.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = process.env.FAKE_DIR, mode = process.env.FAKE_MODE || 'default';
const walk = (d) => fs.readdirSync(d).flatMap((n) => { const p = path.join(d, n); return fs.lstatSync(p).isDirectory() ? walk(p) : [path.relative('.', p)]; });
if (process.env.FAKE_WAIT) while (!fs.existsSync(process.env.FAKE_WAIT)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
const task = JSON.parse(fs.readFileSync('task.json', 'utf8'));
const target = process.env.FAKE_TARGET || ${JSON.stringify(SKILL_FILE)};
fs.mkdirSync('merged', { recursive: true });
const files = task.changed.map((c) => {
  let decision = c.path === target ? (process.env.FAKE_TARGET_DECISION || 'merge') : 'replace';
  if (mode === 'keep-all') decision = 'keep';
  if (decision === 'merge') {
    let text = fs.readFileSync(c.current, 'utf8') + '\\nFake merge line.\\n';
    if (mode === 'placeholder') text += '@@LINT_CMD@@\\n';
    if (mode === 'hunk') text += '@@ -1,3 +1,4 @@\\n';
    if (mode === 'no-bare') text = text.replace(/bare/gi, 'plain');
    fs.writeFileSync(c.merged, text);
    if (mode === 'symlink-file') { fs.unlinkSync(c.merged); fs.symlinkSync(path.resolve(c.current), c.merged); }
  }
  return { path: c.path, decision, added: ['fake feature'], kept: ['project line'], dropped: [] };
});
if (mode === 'omit') files.pop();
if (mode === 'extra') files.push({ path: 'not/a/rendered/file.md', decision: 'keep' });
if (mode === 'dup') files.push(files[0]);
if (mode === 'extra-merged') fs.writeFileSync('merged/999', 'stray');
if (mode === 'symlink-dir') { fs.renameSync('merged', 'merged-real'); fs.symlinkSync(path.resolve('merged-real'), 'merged'); }
if (mode === 'bad-decision') files[0].decision = 'rewrite';
if (process.env.FAKE_TOUCH) fs.writeFileSync(process.env.FAKE_TOUCH, 'touched');
if (mode === 'not-json') fs.writeFileSync('decisions.json', '{ not json');
else if (mode !== 'no-decisions') fs.writeFileSync('decisions.json', JSON.stringify({ files, templateUpdates: [{ path: 'templates/x', feature: 'a run lock', why: 'every project needs it' }],
  questions: [process.env.FAKE_QUESTION || 'Keep the acme lint rule?'] }));
fs.appendFileSync(path.join(dir, 'claude.log'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), names: walk('.'), task,
  decided: files.map((f) => [f.path, f.decision]) }) + '\\n');
console.log('DONE ' + files.length + ' files');
// a session that ends with an error, after it wrote good decisions
if (mode === 'exit-1') process.exit(1);
`;

// the fake gh: logs each call; a file fail-<what> in FAKE_DIR makes one call fail
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = process.env.FAKE_DIR, a = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'gh.log'), a.join(' ') + '\\n');
const has = (f) => fs.existsSync(path.join(dir, f));
if (a[0] === 'repo' && a[1] === 'view') { process.stdout.write('acme-co\\n'); process.exit(0); }
if (a[0] === 'api' && /\\/pulls\\?/.test(a[1])) {
  if (has('fail-list')) { process.stderr.write(process.env.FAKE_GH_STDERR || 'list failed'); process.exit(1); }
  process.stdout.write(has('list.json') ? fs.readFileSync(path.join(dir, 'list.json')) : '[]'); process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'create') {
  if (has('fail-create-once')) { fs.unlinkSync(path.join(dir, 'fail-create-once')); process.stderr.write('create failed'); process.exit(1); }
  fs.copyFileSync(a[a.indexOf('--body-file') + 1], path.join(dir, 'created-body.md'));
  process.stdout.write('https://github.com/acme-co/acme-api/pull/41\\n'); process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'edit') {
  if (a.includes('--add-label') && has('fail-label')) { process.stderr.write('no such label'); process.exit(1); }
  if (a.includes('--body-file') && has('fail-body')) { process.stderr.write('edit failed'); process.exit(1); }
  if (a.includes('--body-file')) fs.copyFileSync(a[a.indexOf('--body-file') + 1], path.join(dir, 'edited-body.md'));
  process.exit(0);
}
// the body on GitHub: pr-body.md (an owner edit), else the body the PR was created with
if (a[0] === 'pr' && a[1] === 'view') {
  const f = ['pr-body.md', 'created-body.md'].find(has);
  process.stdout.write(f ? fs.readFileSync(path.join(dir, f)) : ''); process.exit(0);
}
process.exit(0);
`;

// the fake pnpm (the example answers install with pnpm): logs its argv and cwd, and makes
// .husky/_/h.sh like a husky prepare script. A file fail-install in FAKE_DIR makes it fail.
const FAKE_PNPM = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = process.env.FAKE_DIR;
fs.appendFileSync(path.join(dir, 'pnpm.log'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
if (fs.existsSync(path.join(dir, 'fail-install'))) { process.stderr.write('ERR_PNPM_FAKE install failed'); process.exit(1); }
fs.mkdirSync('.husky/_', { recursive: true });
fs.writeFileSync('.husky/_/h.sh', 'true\\n');
`;

/**
 * Makes a rendered repo with a bare origin. With `change`, one answer changes and one rendered
 * skill file gets a project line after the apply, so the run has work to do.
 */
function setup({ edit = (p) => { p.git.base = 'main'; return p; }, branch = 'main', change = true } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'bootstrap-upgrade-test-')));
  const home = path.join(dir, 'home'), bin = path.join(dir, 'bin');
  mkdirSync(home); mkdirSync(bin);
  writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  writeFileSync(path.join(bin, 'pnpm'), FAKE_PNPM, { mode: 0o755 });
  const env = { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH, FAKE_DIR: dir,
    GIT_AUTHOR_NAME: 'Ana Example', GIT_COMMITTER_NAME: 'Ana Example',
    GIT_AUTHOR_EMAIL: 'ana@example.test', GIT_COMMITTER_EMAIL: 'ana@example.test', GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['FAKE_MODE', 'FAKE_WAIT', 'FAKE_TOUCH', 'FAKE_TARGET', 'FAKE_TARGET_DECISION', 'FAKE_QUESTION', 'FAKE_GH_STDERR']) delete env[k];
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = path.join(dir, 'origin.git');
  g(dir, 'init', '-q', '--bare', '-b', branch, origin);
  // counts the pushes that reach origin
  writeFileSync(path.join(origin, 'hooks', 'pre-receive'), `#!/bin/sh\ncat >> "${path.join(dir, 'pushes.log')}"\n`, { mode: 0o755 });
  const repo = path.join(dir, 'acme-api');
  mkdirSync(path.join(repo, '.claude'), { recursive: true });
  g(repo, 'init', '-q', '-b', branch);
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'acme-api', private: true, scripts: { test: 'node --test' } }));
  writeFileSync(path.join(repo, '.claude/bootstrap.json'), JSON.stringify(edit(JSON.parse(readFileSync(EXAMPLE, 'utf8'))), null, 2));
  const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts/render.mjs'), '.', '--stage', path.join(dir, 'stage'), '--apply', 'new'], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'init');
  g(repo, 'remote', 'add', 'origin', origin);
  g(repo, 'push', '-q', '-u', 'origin', branch);
  const t = { dir, repo, origin, env, g, branch, wtDir: path.join(dir, 'worktrees', 'acme-api') };
  if (change) {
    changeAnswer(t, 'node --check index.mjs');
    appendFileSync(path.join(repo, SKILL_FILE), '\n' + PROJECT_LINE + '\n');
    commitPush(t, 'acme: a project line');
  }
  return t;
}
const changeAnswer = (t, lint) => {
  const f = path.join(t.repo, '.claude/bootstrap.json');
  const p = JSON.parse(readFileSync(f, 'utf8'));
  p.stack.commands.lint = lint;
  writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
};
const commitPush = (t, msg) => { t.g(t.repo, 'add', '-A'); t.g(t.repo, 'commit', '-q', '-m', msg); t.g(t.repo, 'push', '-q', 'origin', t.branch); };
const up = (t, args = [], env = {}) => spawnSync(process.execPath, [SCRIPT, t.repo, ...args], { env: { ...t.env, ...env }, encoding: 'utf8' });
const runs = (t) => path.join(t.repo, '.plans/auto-runs');
const status = (t) => JSON.parse(readFileSync(path.join(runs(t), 'bootstrap-upgrade.json'), 'utf8'));
const hashOf = (t) => JSON.parse(execFileSync(process.execPath, [path.join(SKILL, 'scripts/render.mjs'), t.repo, '--status'], { env: t.env, encoding: 'utf8' })).hash;
const names = (t) => { const h = hashOf(t); return { hash: h, branch: `auto/bootstrap-upgrade-${h}`, wt: path.join(t.wtDir, `bootstrap-upgrade-${h}`), body: path.join(runs(t), `bootstrap-upgrade-pr-body-${h}.md`) }; };
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const claudeLog = (t) => read(path.join(t.dir, 'claude.log')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ghLog = (t) => read(path.join(t.dir, 'gh.log'));
const pushes = (t) => read(path.join(t.dir, 'pushes.log')).split('\n').filter(Boolean).length;
const hasBranch = (t, b) => t.g(t.repo, 'branch', '--list', b) !== '';
const onOrigin = (t, b) => t.g(t.repo, 'ls-remote', '--heads', 'origin', 'refs/heads/' + b) !== '';
const touch = (t, f, text = '') => writeFileSync(path.join(t.dir, f), text);
// a failed run keeps its run folder in the temp dir for a look: remove it with the test folder.
// maxRetries: a git process of the run can still write a file while the folder is removed (ENOTEMPTY).
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
const done = (t) => {
  try { const d = status(t).runDir; if (d) rmSync(d, RM); } catch {}
  rmSync(t.dir, RM);
};
const noLeftover = (t, n) => {
  assert.ok(!existsSync(n.wt), 'no worktree folder is left');
  assert.ok(!hasBranch(t, n.branch), 'no local branch is left');
};

test('the happy path with --no-push commits the upgrade on its own branch and leaves the main checkout clean', () => {
  const t = setup();
  try {
    const n = names(t);
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(t.g(t.repo, 'rev-list', '--count', `origin/main..${n.branch}`), '1');
    const merged = t.g(t.repo, 'show', `${n.branch}:${SKILL_FILE}`);
    assert.match(merged, /Fake merge line\./);
    assert.ok(merged.includes(PROJECT_LINE));
    const replaced = claudeLog(t)[0].decided.filter(([, d]) => d === 'replace').map(([p]) => p);
    assert.ok(replaced.length > 0, 'the answer change makes more files changed');
    const after = JSON.parse(execFileSync(process.execPath, [path.join(SKILL, 'scripts/render.mjs'), n.wt, '--upgrade', '--json', '--stage', path.join(t.dir, 'check')], { env: t.env, encoding: 'utf8' })).files;
    for (const p of replaced) assert.equal(after.find((f) => f.path === p).status, 'same', `${p} equals the rendered file`);
    assert.equal(JSON.parse(t.g(t.repo, 'show', `${n.branch}:.claude/bootstrap.json`)).renderHash, n.hash);
    assert.equal(status(t).state, 'committed');
    assert.equal(read(n.body).split('\n')[0], `<!-- bootstrap-upgrade ${n.hash} -->`);
    assert.equal(t.g(t.repo, 'status', '--porcelain'), '');
    assert.equal(ghLog(t), '', 'gh is not called with --no-push');
    assert.ok(!existsSync(path.join(runs(t), 'bootstrap-upgrade.lock')), 'the own lock is removed');
    // the pending worktree that gave the hash is removed: from git and from the disk
    assert.ok(!t.g(t.repo, 'worktree', 'list', '--porcelain').includes('bootstrap-upgrade-pending-'));
    assert.ok(!readdirSync(t.wtDir).some((d) => d.startsWith('bootstrap-upgrade-pending-')), readdirSync(t.wtDir).join(', '));
  } finally { done(t); }
});

test('the Claude session sees only the run folder, with numbered files and no instruction files', () => {
  const t = setup();
  try {
    assert.equal(up(t, ['--no-push']).status, 0);
    const [c] = claudeLog(t);
    assert.match(path.basename(c.cwd), /^bootstrap-upgrade-run-/);
    assert.equal(c.argv[0], '-p');
    assert.match(c.argv[1], /^\/bootstrap-project --upgrade --unattended .*\/task\.json$/);
    const i = c.argv.indexOf('--disallowedTools');
    assert.ok(i > 0);
    assert.deepEqual(c.argv.slice(i + 1, i + 4), ['Bash', 'WebFetch', 'WebSearch']);
    assert.ok(!c.argv.includes('--add-dir') && !c.argv.includes('--allowedTools'));
    assert.ok(c.argv.includes('--strict-mcp-config'));
    assert.equal(c.argv[c.argv.indexOf('--permission-mode') + 1], 'acceptEdits');
    for (const f of c.names) assert.ok(!['CLAUDE.md', 'AGENTS.md', 'bootstrap.json'].includes(path.basename(f)), f);
    assert.ok(c.names.includes('refs/unattended.md') && c.names.includes('refs/lessons.md'));
    for (const e of c.task.changed) for (const k of ['current', 'stage', 'merged']) assert.ok(!path.isAbsolute(e[k]) && e[k] === `${k}/${e.n}`);
  } finally { done(t); }
});

test('without --no-push the run pushes the branch, opens a draft PR and adds the no-changelog label', () => {
  const t = setup();
  try {
    const n = names(t);
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    const s = status(t);
    assert.equal(s.state, 'pr');
    assert.equal(s.pr.number, 41);
    assert.ok(onOrigin(t, n.branch));
    assert.ok(ghLog(t).includes(`pr create --draft --base main --head ${n.branch}`));
    const body = read(path.join(t.dir, 'created-body.md'));
    assert.match(body, /\| File \| Decision \|/);
    assert.match(body, /- \[ \] Keep the acme lint rule\?/);
    assert.match(body, new RegExp(`auto-pipeline\\.sh --cleanup bootstrap-upgrade-${n.hash}`));
    assert.ok(ghLog(t).includes('pr edit 41 --add-label no-changelog'));
    assert.ok(existsSync(s.runDir), 'the run folder stays for a continued session');
    // the session id: Claude gets it, the status and the report name it
    assert.match(s.session.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepEqual(s.session, { id: s.session.id, runDir: s.runDir, hash: n.hash });
    const argv = claudeLog(t)[0].argv;
    assert.equal(argv[argv.indexOf('--session-id') + 1], s.session.id);
    const report = read(path.join(runs(t), `bootstrap-upgrade-${n.hash}.md`));
    assert.match(report, /- \*\*Result\*\*: draft PR \[#41\]\(https:\/\/github\.com\/acme-co\/acme-api\/pull\/41\)/);
    assert.ok(report.includes(`\n${resumeCommand(s.runDir, s.session.id)}\n`), 'the report has the command that continues the session');
    assert.equal(resumeCommand('/tmp/run-x', 'abc'), "mkdir -p '/tmp/run-x' && cd '/tmp/run-x' && claude --resume abc");
    assert.match(report, /## PR body\n[\s\S]*### Questions for the owner\n\n- \[ \] Keep the acme lint rule\?/);
    assert.ok(!report.includes('<!-- bootstrap-upgrade'), 'no body marker in the report');
  } finally { done(t); }
});

test('a failed label call adds an owner checkbox to the PR body', () => {
  const t = setup();
  try {
    touch(t, 'fail-label');
    assert.equal(up(t).status, 0);
    assert.equal(status(t).state, 'pr');
    assert.match(read(names(t).body), /- \[ \] add the label `no-changelog`/);
    assert.match(read(path.join(t.dir, 'edited-body.md')), /add the label `no-changelog`/);
  } finally { done(t); }
});

test('a failed label call with no other question puts the checkbox in place of "None."', () => {
  const t = setup({ change: false });
  try {
    t.g(t.repo, 'rm', '-q', '.claude/agents/plan-validator.md');
    t.g(t.repo, 'commit', '-q', '-m', 'drop a file');
    t.g(t.repo, 'push', '-q', 'origin', 'main');
    touch(t, 'fail-label');
    assert.equal(up(t).status, 0);
    const body = read(names(t).body);
    assert.match(body, /## Questions for the owner\n\n- \[ \] add the label `no-changelog`\n\n## Verify/);
  } finally { done(t); }
});

test('an open PR with no saved body: a failed label call adds the checkbox to the body that GitHub has', () => {
  const t = setup();
  try {
    touch(t, 'list.json', JSON.stringify([{ number: 41, html_url: 'https://github.com/acme-co/acme-api/pull/41', state: 'open', merged_at: null }]));
    touch(t, 'pr-body.md', '<!-- bootstrap-upgrade x -->\n\nThe body on GitHub.\n');
    touch(t, 'fail-label');
    assert.equal(up(t).status, 0);
    assert.ok(ghLog(t).includes('pr view 41 --json body'));
    const edited = read(path.join(t.dir, 'edited-body.md'));
    assert.match(edited, /The body on GitHub\./);
    assert.match(edited, /## Questions for the owner\n\n- \[ \] add the label `no-changelog`/);
    assert.equal(status(t).error, null);
  } finally { done(t); }
});

test('a retry after a failed label call keeps the edits the owner made to the PR body on GitHub', () => {
  const t = setup();
  try {
    assert.equal(up(t).status, 0);
    touch(t, 'pr-body.md', read(path.join(t.dir, 'created-body.md')) + '\nOwner note: keep this.\n');
    touch(t, 'list.json', JSON.stringify([{ number: 41, html_url: 'https://github.com/acme-co/acme-api/pull/41', state: 'open', merged_at: null }]));
    touch(t, 'fail-label');
    assert.equal(up(t).status, 0);
    const edited = read(path.join(t.dir, 'edited-body.md'));
    assert.match(edited, /Owner note: keep this\./);
    assert.match(edited, /- \[ \] add the label `no-changelog`/);
  } finally { done(t); }
});

test('a failed label call whose body edit fails too names the label in the status', () => {
  const t = setup();
  try {
    touch(t, 'fail-label');
    touch(t, 'fail-body');
    const r = up(t);
    assert.equal(r.status, 0, 'the PR is open, so the run is done');
    assert.equal(status(t).state, 'pr');
    assert.match(status(t).error, /add the label no-changelog to PR #41 by hand/);
    assert.match(r.stderr, /by hand/);
  } finally { done(t); }
});

test('the PR body redacts secrets in the CONFIG lines that differ', () => {
  const files = [{ path: '.claude/scripts/auto-pipeline.sh', status: 'config', diff: ['- token: sk-test-0000', '+ BASE_BRANCH="main"'] }];
  const body = prBody({ hash: 'abc', slug: 'bootstrap-upgrade-abc', files, changed: [], decisions: { files: [], templateUpdates: [], questions: [] }, alreadyFailing: [] });
  assert.ok(!body.includes('sk-test-0000'), body);
  assert.match(body, /token: <redacted>/);
  assert.match(body, /BASE_BRANCH="main"/);
  assert.match(body, /The repo keeps its own CONFIG block: `-` is the line the repo keeps, `\+` is the value from the answers/);
  const none = prBody({ hash: 'abc', slug: 'bootstrap-upgrade-abc', files: [], changed: [], decisions: { files: [], templateUpdates: [], questions: [] }, alreadyFailing: [] });
  assert.match(none, /## CONFIG lines that differ\n\nNone\./, 'no note when no line differs');
});

test('a merged PR for this hash says merged, not closed', () => {
  const t = setup();
  try {
    assert.equal(up(t).status, 0);
    touch(t, 'list.json', JSON.stringify([{ number: 41, html_url: 'https://github.com/acme-co/acme-api/pull/41', state: 'closed', merged_at: '2026-01-01T00:00:00Z' }]));
    assert.equal(up(t).status, 1);
    assert.match(status(t).error, /PR #41 for this hash was merged/);
  } finally { done(t); }
});

test('only new files: Claude is not called and the commit has the new file', () => {
  const t = setup({ change: false });
  try {
    const gone = '.claude/agents/plan-validator.md';
    t.g(t.repo, 'rm', '-q', gone);
    t.g(t.repo, 'commit', '-q', '-m', 'drop a file');
    t.g(t.repo, 'push', '-q', 'origin', 'main');
    const n = names(t);
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(claudeLog(t), []);
    assert.ok(t.g(t.repo, 'show', '--name-only', '--format=', n.branch).split('\n').includes(gone));
    assert.equal(status(t).session, null);
    assert.ok(!existsSync(status(t).runDir), 'a run folder that Claude never used is removed');
    const report = read(path.join(runs(t), `bootstrap-upgrade-${n.hash}.md`));
    assert.match(report, /- \*\*Result\*\*: committed on `auto\/bootstrap-upgrade-[0-9a-f]{16}`, not pushed/);
    assert.match(report, /No Claude session ran/);
    assert.ok(!/claude --resume/.test(report));
  } finally { done(t); }
});

test('nothing staged: a keep of the only changed file ends with "same" and no commit', () => {
  const t = setup({ change: false });
  try {
    appendFileSync(path.join(t.repo, SKILL_FILE), '\n' + PROJECT_LINE + '\n');
    commitPush(t, 'acme: a project line');
    const n = names(t);
    const r = up(t, ['--no-push'], { FAKE_MODE: 'keep-all' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(claudeLog(t).length, 1, 'the changed file goes to Claude');
    assert.equal(status(t).state, 'same');
    assert.equal(status(t).error, null);
    assert.ok(!existsSync(n.body), 'no commit, so no body');
    noLeftover(t, n);
  } finally { done(t); }
});

for (const [mode, why] of [['omit', /no decision for/], ['extra', /not a changed file/], ['dup', /twice/],
  ['extra-merged', /no merge entry names: 999/], ['symlink-file', /not a regular file/], ['symlink-dir', /not a real folder/],
  ['placeholder', /placeholder/], ['no-decisions', /decisions\.json is missing or not JSON/], ['not-json', /decisions\.json is missing or not JSON/],
  ['bad-decision', /has the decision "rewrite"/], ['exit-1', /the Claude session failed \(exit 1\)/]]) {
  test(`bad decisions (${mode}) fail the run with no commit and no worktree left`, () => {
    const t = setup();
    try {
      const n = names(t);
      const r = up(t, ['--no-push'], { FAKE_MODE: mode });
      assert.equal(r.status, 1);
      const s = status(t);
      assert.equal(s.state, 'failed');
      assert.match(s.error, why);
      assert.ok(s.error.startsWith(s.runDir + ': '), 'the error starts with the run folder');
      assert.ok(existsSync(s.runDir), 'the run folder stays for a look');
      assert.ok(!existsSync(n.body));
      noLeftover(t, n);
    } finally { done(t); }
  });
}

test('symlinkedPath finds a symlinked file and a file under a symlinked folder', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'bootstrap-upgrade-link-')));
  try {
    const wt = path.join(dir, 'wt'), outside = path.join(dir, 'outside');
    mkdirSync(path.join(wt, '.claude'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'x.md'), 'shared');
    writeFileSync(path.join(wt, 'AGENTS.md'), 'real');
    assert.equal(symlinkedPath(wt, ['AGENTS.md', '.claude/new.md']), null);
    symlinkSync(path.join(outside, 'x.md'), path.join(wt, 'CLAUDE.md'));
    assert.equal(symlinkedPath(wt, ['AGENTS.md', 'CLAUDE.md']), 'CLAUDE.md');
    symlinkSync(outside, path.join(wt, '.claude', 'skills'));
    assert.equal(symlinkedPath(wt, ['.claude/skills/x.md']), '.claude/skills/x.md');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a changed file that is a symlink fails the run before Claude, and nothing is written through it', () => {
  const t = setup();
  try {
    const n = names(t);
    const f = path.join(t.repo, SKILL_FILE), shared = path.join(t.dir, 'shared-skill.md');
    writeFileSync(shared, readFileSync(f, 'utf8'));
    unlinkSync(f);
    symlinkSync(shared, f);
    commitPush(t, 'acme: a shared skill file');
    const before = readFileSync(shared, 'utf8');
    assert.equal(up(t, ['--no-push']).status, 1);
    assert.match(status(t).error, /is a symlink or lies under one/);
    assert.deepEqual(claudeLog(t), []);
    assert.equal(readFileSync(shared, 'utf8'), before);
    noLeftover(t, n);
  } finally { done(t); }
});

test('a merged file with a diff hunk line (@@ -1,3 +1,4 @@) is not a placeholder', () => {
  const t = setup();
  try {
    const r = up(t, ['--no-push'], { FAKE_MODE: 'hunk' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'committed');
  } finally { done(t); }
});

test('a check that fails only after the apply fails the run and names the check', () => {
  const t = setup();
  try {
    const n = names(t);
    assert.equal(up(t, ['--no-push'], { FAKE_MODE: 'no-bare' }).status, 1);
    assert.match(status(t).error, /bare-commands/);
    noLeftover(t, n);
  } finally { done(t); }
});

test('a check that already failed before the upgrade goes into the PR body and does not fail the run', () => {
  const t = setup();
  try {
    const f = path.join(t.repo, SKILL_FILE);
    writeFileSync(f, readFileSync(f, 'utf8').replace(/bare/gi, 'plain'));
    commitPush(t, 'acme: no bare word');
    const n = names(t);
    const r = up(t, ['--no-push'], { FAKE_TARGET_DECISION: 'keep' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'committed');
    assert.match(read(n.body), /Already failing before the upgrade: .*`bare-commands`/);
    assert.match(read(n.body), /- \[ \] The verify check `bare-commands` already failed/);
  } finally { done(t); }
});

test('a session that writes into the worktree fails the run', () => {
  const t = setup();
  try {
    const n = names(t);
    assert.equal(up(t, ['--no-push'], { FAKE_TOUCH: path.join(n.wt, 'touched.txt') }).status, 1);
    assert.match(status(t).error, /changed the worktree/);
    noLeftover(t, n);
  } finally { done(t); }
});

test('a held lock stops the run with no status write', () => {
  const t = setup();
  try {
    mkdirSync(runs(t), { recursive: true });
    writeFileSync(path.join(runs(t), 'bootstrap-upgrade.lock'), String(process.pid));
    writeFileSync(path.join(runs(t), 'bootstrap-upgrade.json'), '{"state":"pr"}\n');
    const r = up(t);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already live/);
    assert.equal(read(path.join(runs(t), 'bootstrap-upgrade.json')), '{"state":"pr"}\n');
    assert.equal(read(path.join(runs(t), 'bootstrap-upgrade.lock')), String(process.pid));
  } finally { done(t); }
});

test('two runs at the same time: the second one stops at the lock', async () => {
  const t = setup();
  try {
    const go = path.join(t.dir, 'go');
    const a = spawn(process.execPath, [SCRIPT, t.repo, '--no-push'], { env: { ...t.env, FAKE_WAIT: go }, stdio: 'ignore' });
    const exited = new Promise((r) => a.on('exit', r));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try { if (status(t).step === 'claude' && status(t).pid === a.pid) break; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(status(t).step, 'claude');
    const b = up(t, ['--no-push']);
    assert.equal(b.status, 1);
    assert.match(b.stderr, /already live/);
    assert.equal(status(t).pid, a.pid);
    writeFileSync(go, '');
    assert.equal(await exited, 0);
    assert.equal(status(t).state, 'committed');
  } finally { done(t); }
});

test('a lock that the script did not make is never removed', () => {
  const t = setup();
  try {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    mkdirSync(runs(t), { recursive: true });
    writeFileSync(path.join(runs(t), 'bootstrap-upgrade.lock'), String(dead));
    assert.equal(up(t).status, 1);
    assert.equal(read(path.join(runs(t), 'bootstrap-upgrade.lock')), String(dead));
  } finally { done(t); }
});

test('answers that are not on origin stop the run before any worktree is made', () => {
  const t = setup();
  try {
    changeAnswer(t, 'node --check other.mjs');
    const r = up(t);
    assert.equal(r.status, 1);
    assert.match(status(t).error, /push or pull \.claude\/bootstrap\.json first/);
    assert.equal(status(t).state, 'failed');
    assert.ok(!existsSync(t.wtDir) || !execFileSync('ls', [t.wtDir], { encoding: 'utf8' }).includes('bootstrap-upgrade-pending-'));
  } finally { done(t); }
});

test('folders that the script did not make stay', () => {
  const t = setup();
  try {
    const other = path.join(t.wtDir, 'bootstrap-upgrade-pending-99999-1');
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, 'keep.txt'), 'mine');
    assert.equal(up(t, ['--no-push']).status, 0);
    assert.equal(status(t).state, 'committed');
    assert.equal(read(path.join(other, 'keep.txt')), 'mine');
  } finally { done(t); }
  const u = setup();
  try {
    const n = names(u);
    mkdirSync(n.wt, { recursive: true });
    writeFileSync(path.join(n.wt, 'keep.txt'), 'mine');
    assert.equal(up(u, ['--no-push']).status, 1);
    assert.match(status(u).error, /is not a worktree of this repo/);
    assert.equal(read(path.join(n.wt, 'keep.txt')), 'mine');
  } finally { done(u); }
});

test('remoteBranchSha throws when ls-remote fails and gives "" when origin has no such branch', () => {
  const t = setup({ change: false });
  try {
    assert.equal(remoteBranchSha(t.repo, 'auto/none'), '');
    assert.match(remoteBranchSha(t.repo, 'main'), /^[0-9a-f]{40}$/);
    const lone = path.join(t.dir, 'lone');
    mkdirSync(lone);
    t.g(lone, 'init', '-q');
    t.g(lone, 'remote', 'add', 'origin', path.join(t.dir, 'missing'));
    assert.throws(() => remoteBranchSha(lone, 'auto/none'), /ls-remote.*failed/);
  } finally { done(t); }
});

test('two hashes wait side by side: each keeps its own PR body', () => {
  const t = setup();
  try {
    const a = names(t);
    assert.equal(up(t, ['--no-push']).status, 0);
    changeAnswer(t, 'node --check second.mjs');
    commitPush(t, 'acme: another lint');
    const b = names(t);
    assert.notEqual(a.hash, b.hash);
    assert.equal(up(t, ['--no-push']).status, 0);
    assert.equal(status(t).state, 'committed');
    assert.ok(existsSync(a.body) && existsSync(b.body));
  } finally { done(t); }
});

test('nothing to upgrade: status "same" and no worktree or branch is left', () => {
  const t = setup({ change: false });
  try {
    const n = names(t);
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'same');
    noLeftover(t, n);
    assert.equal(t.g(t.repo, 'branch', '--list', 'auto/bootstrap-upgrade-*'), '');
  } finally { done(t); }
});

// a husky-style pre-commit hook: it needs .husky/_/h.sh, which only the install step makes
const addHuskyHook = (t) => {
  mkdirSync(path.join(t.repo, '.husky'));
  writeFileSync(path.join(t.repo, '.husky/pre-commit'), '#!/bin/sh\n. "$(dirname "$0")/_/h.sh"\n', { mode: 0o755 });
  appendFileSync(path.join(t.repo, '.gitignore'), '\n.husky/_/\n');
  commitPush(t, 'acme: husky hook');
  t.g(t.repo, 'config', 'core.hooksPath', '.husky');
};
const pnpmLog = (t) => read(path.join(t.dir, 'pnpm.log')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('the install step runs in the worktree before the commit, so a husky hook finds its files', () => {
  const t = setup();
  try {
    addHuskyHook(t);
    const n = names(t);
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'committed');
    const calls = pnpmLog(t);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].argv, ['install', '--prefer-offline']);
    assert.equal(realpathSync(calls[0].cwd), realpathSync(n.wt));
    assert.ok(!existsSync(path.join(t.repo, '.husky/_')), 'the main checkout is not installed');
  } finally { done(t); }
});

test('a failed install step fails the run at step install with the tool output, and no commit is made', () => {
  const t = setup();
  try {
    addHuskyHook(t);
    touch(t, 'fail-install');
    const n = names(t);
    assert.equal(up(t, ['--no-push']).status, 1);
    const s = status(t);
    assert.equal(s.state, 'failed');
    assert.equal(s.step, 'install');
    assert.match(s.error, /pnpm install --prefer-offline` failed: ERR_PNPM_FAKE/);
    const report = read(path.join(runs(t), `bootstrap-upgrade-${n.hash}.md`));
    assert.match(report, /- \*\*Result\*\*: failed at step `install`: .*ERR_PNPM_FAKE/);
    assert.ok(report.includes(resumeCommand(s.session.runDir, s.session.id)), 'a failed run can be continued too');
    noLeftover(t, n);
    unlinkSync(path.join(t.dir, 'fail-install'));
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'committed');
  } finally { done(t); }
});

test('an install tool that is not on PATH fails the run with the answer to fix', () => {
  const t = setup({ edit: (p) => { p.git.base = 'main'; p.stack.installCmd = 'acme-missing-pm install'; return p; } });
  try {
    assert.equal(up(t, ['--no-push']).status, 1);
    assert.equal(status(t).step, 'install');
    assert.match(status(t).error, /acme-missing-pm is not on PATH \(stack\.installCmd/);
  } finally { done(t); }
});

test('no installCmd or no manifest: the install step is skipped', () => {
  for (const edit of [(p) => { p.git.base = 'main'; p.stack.installCmd = ''; return p; },
    (p) => { p.git.base = 'main'; p.stack.manifest = 'acme.lock.json'; return p; }]) {
    const t = setup({ edit });
    try {
      const r = up(t, ['--no-push']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(status(t).state, 'committed');
      assert.equal(pnpmLog(t).length, 0);
    } finally { done(t); }
  }
});

test('a retry after a failure before the commit starts clean', () => {
  const t = setup();
  try {
    assert.equal(up(t, ['--no-push'], { FAKE_MODE: 'omit' }).status, 1);
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'committed');
  } finally { done(t); }
});

test('a retry after a failed PR create does not push again and opens the PR with the saved body', () => {
  const t = setup();
  try {
    const n = names(t);
    touch(t, 'fail-create-once');
    assert.equal(up(t).status, 1);
    assert.equal(status(t).state, 'failed');
    assert.equal(status(t).step, 'pr');
    assert.ok(onOrigin(t, n.branch));
    assert.ok(existsSync(n.wt), 'a failure after the commit keeps the worktree');
    assert.ok(existsSync(status(t).runDir), 'the run folder stays for a continued session');
    const first = status(t).session;
    assert.ok(!status(t).error.startsWith(status(t).runDir), 'only a failure before the commit names the run folder');
    const before = pushes(t);
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(pushes(t), before, 'no second push');
    assert.deepEqual(status(t).session, first, 'a retry with no Claude session keeps the earlier session');
    assert.ok(read(path.join(runs(t), `bootstrap-upgrade-${n.hash}.md`)).includes(resumeCommand(first.runDir, first.id)));
    assert.equal(ghLog(t).split('\n').filter((l) => l.startsWith('pr create')).length, 2, 'one failed and one good pr create');
    assert.equal(read(path.join(t.dir, 'created-body.md')), read(n.body));
    assert.equal(status(t).state, 'pr');
  } finally { done(t); }
});

test('a retry with the remote branch behind pushes the new commit and opens the PR', () => {
  const t = setup();
  try {
    const n = names(t);
    assert.equal(up(t).status, 0);
    writeFileSync(path.join(n.wt, 'extra.txt'), 'one more\n');
    t.g(n.wt, 'add', 'extra.txt');
    t.g(n.wt, 'commit', '-q', '-m', 'one more');
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(t.g(t.repo, 'ls-remote', '--heads', 'origin', n.branch).split('\t')[0], t.g(t.repo, 'rev-parse', n.branch));
    assert.equal(status(t).state, 'pr');
  } finally { done(t); }
});

test('a run after --no-push pushes the saved commit and opens the PR with the saved body', () => {
  const t = setup();
  try {
    const n = names(t);
    assert.equal(up(t, ['--no-push']).status, 0);
    assert.equal(pushes(t), 2, 'only the setup pushes so far');
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(onOrigin(t, n.branch));
    assert.equal(read(path.join(t.dir, 'created-body.md')), read(n.body));
    assert.equal(status(t).state, 'pr');
  } finally { done(t); }
});

test('an open PR for this hash is never made twice, also after a crash with no PR in the status', () => {
  const t = setup();
  try {
    const n = names(t);
    touch(t, 'list.json', JSON.stringify([{ number: 41, html_url: 'https://github.com/acme-co/acme-api/pull/41', state: 'open', merged_at: null }]));
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'pr');
    assert.equal(status(t).pr.number, 41);
    assert.ok(!ghLog(t).includes('pr create'));
    assert.ok(ghLog(t).includes('pr edit 41 --add-label no-changelog'));
    noLeftover(t, n);
  } finally { done(t); }
});

test('a closed PR for this hash stops the run with the commands to start again; after them the run goes on', () => {
  const t = setup();
  try {
    const n = names(t);
    assert.equal(up(t).status, 0);
    touch(t, 'list.json', JSON.stringify([{ number: 41, html_url: 'https://github.com/acme-co/acme-api/pull/41', state: 'closed', merged_at: null }]));
    assert.equal(up(t).status, 1);
    const err = status(t).error;
    assert.match(err, /PR #41 for this hash was closed/);
    assert.ok(err.includes(`git branch -D ${n.branch}`) && err.includes(`git push origin --delete ${n.branch}`));
    t.g(t.repo, 'worktree', 'remove', '--force', n.wt);
    t.g(t.repo, 'branch', '-D', n.branch);
    t.g(t.repo, 'push', '-q', 'origin', '--delete', n.branch);
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'pr');
  } finally { done(t); }
});

test('a leftover worktree with uncommitted work stops the run and stays', () => {
  const t = setup();
  try {
    const n = names(t);
    t.g(t.repo, 'worktree', 'add', '-q', '--no-track', '-b', n.branch, n.wt, 'origin/main');
    writeFileSync(path.join(n.wt, 'work.txt'), 'unsaved');
    assert.equal(up(t, ['--no-push']).status, 1);
    assert.ok(status(t).error.includes(n.wt));
    assert.match(status(t).error, /uncommitted changes/);
    assert.equal(read(path.join(n.wt, 'work.txt')), 'unsaved');
  } finally { done(t); }
});

test('a leftover worktree with no work is removed and the run goes on', () => {
  const t = setup();
  try {
    const n = names(t);
    t.g(t.repo, 'worktree', 'add', '-q', '--no-track', '-b', n.branch, n.wt, 'origin/main');
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'committed');
  } finally { done(t); }
});

test('a committed branch without its saved body stops the push', () => {
  const t = setup();
  try {
    const n = names(t);
    assert.equal(up(t, ['--no-push']).status, 0);
    unlinkSync(n.body);
    const before = pushes(t);
    assert.equal(up(t).status, 1);
    assert.match(status(t).error, /no saved PR body/);
    assert.equal(pushes(t), before, 'nothing is pushed');
  } finally { done(t); }
});

test('no git.base in the answers: the run uses origin/develop', () => {
  const t = setup({ edit: (p) => { delete p.git.base; return p; }, branch: 'develop' });
  try {
    const n = names(t);
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).base, 'develop');
    assert.equal(t.g(t.repo, 'merge-base', n.branch, 'origin/develop'), t.g(t.repo, 'rev-parse', 'origin/develop'));
    assert.equal(t.g(t.repo, 'rev-list', '--count', `origin/develop..${n.branch}`), '1');
  } finally { done(t); }
});

test('a repo with a submodule: a failed run removes its worktree, and a good run commits', () => {
  const t = setup();
  try {
    const lib = path.join(t.dir, 'lib');
    mkdirSync(lib);
    t.g(lib, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(lib, 'x.txt'), 'x');
    t.g(lib, 'add', 'x.txt');
    t.g(lib, 'commit', '-q', '-m', 'lib');
    t.g(t.repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'lib');
    t.g(t.repo, 'commit', '-q', '-m', 'add lib');
    t.g(t.repo, 'push', '-q', 'origin', 'main');
    const n = names(t);
    assert.equal(up(t, ['--no-push'], { FAKE_MODE: 'omit' }).status, 1);
    noLeftover(t, n);
    const r = up(t, ['--no-push']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'committed');
  } finally { done(t); }
});

test('secrets in a gh error and in a question from Claude are redacted', () => {
  const t = setup();
  try {
    touch(t, 'fail-list');
    assert.equal(up(t, [], { FAKE_GH_STDERR: 'token=sk-test-0000 https://ana:sk-test-0000@example.test' }).status, 1);
    assert.match(status(t).error, /gh cannot see this repo's PRs/);
    assert.ok(!status(t).error.includes('sk-test-0000'), status(t).error);
    unlinkSync(path.join(t.dir, 'fail-list'));
    assert.equal(up(t, ['--no-push'], { FAKE_QUESTION: 'Is password=sk-test-0000 still used?' }).status, 0);
    const body = read(names(t).body);
    assert.match(body, /Is password=<redacted> still used\?/);
    assert.ok(!body.includes('sk-test-0000'));
  } finally { done(t); }
});

test('with the changelog module off, the PR gets no label', () => {
  const t = setup({ edit: (p) => { p.git.base = 'main'; p.modules.changelog = false; return p; } });
  try {
    const r = up(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(status(t).state, 'pr');
    assert.ok(ghLog(t).includes('pr create'));
    assert.ok(!ghLog(t).includes('--add-label'), ghLog(t));
  } finally { done(t); }
});

test('a local branch that differs from the remote one stops the run, and nothing is pushed', () => {
  const t = setup();
  try {
    const n = names(t);
    assert.equal(up(t).status, 0);
    // the local commit is rewritten: local and remote no longer share the tip
    t.g(n.wt, 'commit', '-q', '--amend', '-m', 'rewritten');
    const before = pushes(t);
    assert.equal(up(t).status, 1);
    assert.match(status(t).error, /the local and remote branch differ/);
    assert.equal(pushes(t), before);
  } finally { done(t); }
});

test('a merged script in .claude/scripts/ is executable in the commit', () => {
  const t = setup();
  try {
    const script = '.claude/scripts/auto-pipeline.sh';
    appendFileSync(path.join(t.repo, script), '# acme: a project comment\n');
    chmodSync(path.join(t.repo, script), 0o644);
    commitPush(t, 'acme: a script comment');
    const n = names(t);
    const r = up(t, ['--no-push'], { FAKE_TARGET: script });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(claudeLog(t)[0].decided.find(([p]) => p === script), [script, 'merge']);
    assert.match(t.g(t.repo, 'ls-tree', n.branch, script), /^100755 /);
  } finally { done(t); }
});

test('a verify.mjs that cannot run (exit 3, no JSON) fails the run, with no commit', () => {
  const t = setup();
  try {
    // a preload module that stops only verify.mjs: render.mjs and the fake claude run as before
    const preload = path.join(t.dir, 'break-verify.mjs');
    writeFileSync(preload, "if (/verify\\.mjs$/.test(process.argv[1] || '')) { console.log('not json'); process.exit(3); }\n");
    const n = names(t);
    const r = up(t, ['--no-push'], { NODE_OPTIONS: `--import=${new URL('file://' + preload).href}` });
    assert.equal(r.status, 1, r.stderr);
    assert.match(status(t).error, /verify\.mjs could not run \(exit 3\)/);
    assert.equal(claudeLog(t).length, 1, 'the run got as far as verify');
    noLeftover(t, n);
  } finally { done(t); }
});

test('a PR for a newer hash names the older upgrade PR, also after a failed run in between', () => {
  const t = setup();
  try {
    mkdirSync(runs(t), { recursive: true });
    writeFileSync(path.join(runs(t), 'bootstrap-upgrade.json'), JSON.stringify({ state: 'pr', hash: '0123456789abcdef',
      pr: { number: 40, url: 'https://github.com/acme-co/acme-api/pull/40' } }));
    assert.equal(up(t, ['--no-push'], { FAKE_MODE: 'omit' }).status, 1);
    assert.deepEqual(status(t).replaces, { number: 40, hash: '0123456789abcdef' });
    assert.equal(up(t, ['--no-push']).status, 0);
    assert.match(read(names(t).body), /- \[ \] This PR replaces upgrade PR #40 \(template hash `0123456789abcdef`\): close #40 without a merge\./);
  } finally { done(t); }
});

test('a git.base that starts with "-" is refused before git runs', () => {
  const t = setup();
  try {
    const f = path.join(t.repo, '.claude/bootstrap.json');
    const p = JSON.parse(readFileSync(f, 'utf8'));
    p.git.base = '--upload-pack=touch-pwned';
    writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
    assert.equal(up(t).status, 1);
    assert.match(status(t).error, /is not a branch name/);
    assert.ok(!existsSync(path.join(t.repo, 'touch-pwned')));
  } finally { done(t); }
});
