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

// a web UI with the browser test on and one preflight command
const webUi = (p) => {
  p.registry = { ...p.registry, browserTest: true, role: 'frontend', appUrl: 'http://localhost:3000' };
  p.pipeline.preflight = ['pnpm theme:generate'];
  return p;
};
// runs bash with the CONFIG block and the named functions of the rendered auto-pipeline.sh
function pipelineBash(repo, fns, body, env = {}) {
  const src = readFileSync(path.join(repo, '.claude/scripts/auto-pipeline.sh'), 'utf8');
  const config = src.slice(src.indexOf('# ============================ CONFIG'), src.indexOf('usage() {'));
  const defs = fns.map((f) => src.match(new RegExp(`^${f}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'))[0]).join('\n');
  return spawnSync('bash', ['-c', `set -euo pipefail\n${config}\n${defs}\n${body}`], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('a browser-test project gets the full-path, QA_* and curl run rules, with $HOME expanded by bash', () => {
  const { dir, repo } = bootstrapRepo(webUi);
  try {
    const r = pipelineBash(repo, [], 'printf "%s\\n" "${RUN_EXTRA_ALLOW[@]}"; echo "P=${PREFLIGHT_CMDS[*]} B=$BROWSER_TEST_PROJECT"', { HOME: '/home/ana' });
    assert.equal(r.status, 0, r.stderr);
    const rules = r.stdout.split('\n');
    for (const want of ['Bash(node /home/ana/.claude/skills/browser-usability-test/scripts/*)',
      'Bash(QA_*=* node /home/ana/.claude/skills/browser-usability-test/scripts/*)',
      'Bash(node ~/.claude/skills/browser-usability-test/scripts/*)', 'Bash(curl -s -o /dev/null -w *)', 'Bash(pnpm theme:generate)']) {
      assert.ok(rules.includes(want), `missing ${want}\n${r.stdout}`);
    }
    assert.match(r.stdout, /P=pnpm theme:generate B=acme-api/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the launch preflight refuses a command that no allow rule matches, and passes when all match', () => {
  const { dir, repo } = bootstrapRepo(webUi);
  try {
    const fns = ['rule_matches', 'run_commands', 'check_run_permissions'];
    const ok = pipelineBash(repo, fns, 'ALLOW_RULES=("${RUN_EXTRA_ALLOW[@]}"); DENY_RULES=(); check_run_permissions; echo PASSED', { HOME: '/home/ana' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASSED/);
    const noTheme = pipelineBash(repo, fns, 'ALLOW_RULES=(); for r in "${RUN_EXTRA_ALLOW[@]}"; do [ "$r" = "Bash(pnpm theme:generate)" ] || ALLOW_RULES+=("$r"); done; DENY_RULES=(); check_run_permissions', { HOME: '/home/ana' });
    assert.equal(noTheme.status, 1);
    assert.match(noTheme.stdout, /FATAL: preflight[\s\S]*pnpm theme:generate/);
    const denied = pipelineBash(repo, fns, 'ALLOW_RULES=("${RUN_EXTRA_ALLOW[@]}"); DENY_RULES=("Bash(curl*)"); check_run_permissions', { HOME: '/home/ana' });
    assert.equal(denied.status, 1);
    assert.match(denied.stdout, /curl .*a deny rule matches/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an upgrade adds a CONFIG setting that the kept block lacks', () => {
  const { dir, repo, stage } = bootstrapRepo(webUi);
  try {
    const f = path.join(repo, '.claude/scripts/auto-pipeline.sh');
    // an older script: no PREFLIGHT_CMDS / BROWSER_TEST_PROJECT, and a hand-tuned mode
    const old = readFileSync(f, 'utf8').replace(/^# EDIT 6:[\s\S]*?^BROWSER_TEST_PROJECT=.*\n/m, '').replace('DEFAULT_MODE="pr"', 'DEFAULT_MODE="verify"');
    assert.doesNotMatch(old, /^PREFLIGHT_CMDS=\(/m);
    writeFileSync(f, old);
    const files = JSON.parse(node('render.mjs', ['.', '--upgrade', '--stage', stage, '--json'], repo).stdout).files;
    const ap = files.find((x) => x.path === '.claude/scripts/auto-pipeline.sh');
    assert.equal(ap.status, 'changed');
    const staged = readFileSync(path.join(stage, '.claude/scripts/auto-pipeline.sh'), 'utf8');
    assert.match(staged, /^PREFLIGHT_CMDS=\('pnpm theme:generate'\)$/m);
    assert.match(staged, /^BROWSER_TEST_PROJECT="acme-api"$/m);
    assert.match(staged, /^DEFAULT_MODE="verify"$/m, 'the hand-tuned value stays');
    assert.equal(spawnSync('bash', ['-n', path.join(stage, '.claude/scripts/auto-pipeline.sh')]).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the reporting rules and the browser-test gate render into the skills that report', () => {
  const { dir, repo } = bootstrapRepo(webUi);
  const plain = bootstrapRepo();
  try {
    const skill = (r, s) => readFileSync(path.join(r, '.claude/skills', s, 'SKILL.md'), 'utf8');
    for (const s of ['skill-3-test', 'skill-4-verify', 'skill-5-ship', 'decision-sheet', 'pr-feedback']) {
      assert.match(skill(repo, s), /^## Reporting rules$/m, s);
      assert.match(skill(repo, s), /6 of 10 tickets have pictures/, s);
    }
    assert.match(skill(repo, 'skill-5-ship'), /## Step 5\.5 — Browser-test gate/);
    assert.match(skill(repo, 'skill-5-ship'), /BLOCKED — browser test \(<reason>\)/);
    assert.match(skill(repo, 'skill-auto-pipeline'), /Never end your turn between two phases/);
    assert.match(skill(repo, 'decision-sheet'), /Browser test: <k> of <n> tickets/);
    assert.doesNotMatch(skill(plain.repo, 'skill-5-ship'), /Browser-test gate/);
    assert.match(skill(plain.repo, 'skill-auto-pipeline'), /Never end your turn between two phases/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(plain.dir, { recursive: true, force: true });
  }
});

test('verify shows layout paths that do not exist and CONFIG blocks that differ from the answers', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const lanes = path.join(repo, '.claude/scripts/plan-lanes.mjs');
    writeFileSync(lanes, readFileSync(lanes, 'utf8').replace(/^const FOOTPRINT_ROOTS = .*$/m, "const FOOTPRINT_ROOTS = ['frontend/'];"));
    const out = JSON.parse(node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo).stdout);
    const by = (id) => out.results.find((r) => r.id === id);
    assert.equal(by('layout-paths').ok, false);
    assert.match(by('layout-paths').detail, /src\//);
    assert.equal(by('config-drift').ok, false);
    assert.match(by('config-drift').detail, /plan-lanes\.mjs/);
    assert.deepEqual(out.failed, [], 'tips never fail the run');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('after a run, compaction picks the session from this run, compacts above the threshold, and never fails the run', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const home = path.join(dir, 'home'), wt = path.join(dir, 'wt'), bin = path.join(dir, 'bin');
    const sdir = path.join(home, '.claude/projects', wt.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(sdir, { recursive: true }); mkdirSync(wt); mkdirSync(bin);
    const usage = (n) => JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 10, cache_read_input_tokens: n - 10, cache_creation_input_tokens: 0 } } });
    const head = JSON.stringify({ type: 'user', entrypoint: 'sdk-cli', message: { content: '/skill-auto-pipeline x.md' } });
    writeFileSync(path.join(sdir, 'old.jsonl'), [head, usage(300000)].join('\n') + '\n');
    writeFileSync(path.join(sdir, 'new.jsonl'), [head, usage(200000)].join('\n') + '\n');
    // the log of a resumed run: the older session's init event comes before this session's offset
    const before = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'old' }) + '\n';
    const log = path.join(dir, 'x.log'), report = path.join(dir, 'x.md');
    writeFileSync(log, before + 'not json\n' + JSON.stringify({ type: 'system', subtype: 'init', session_id: 'new' }) + '\n');
    // a fake claude: appends a compact_boundary to the --resume session, or fails when FAIL is set
    writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env bash
[ -z "\${FAIL:-}" ] || exit 3
while [ $# -gt 0 ]; do [ "$1" = --resume ] && id="$2"; shift; done
echo '{"type":"system","subtype":"compact_boundary","compactMetadata":{"preTokens":200000,"postTokens":81234}}' >> "${sdir}/$id.jsonl"
`, { mode: 0o755 });
    const fns = ['now', 'compact_instructions', 'session_dir', 'run_session_id', 'context_tokens', 'compact_skip', 'compact_session'];
    const run = (env) => {
      writeFileSync(report, '## Timeline\n\n');
      const r = pipelineBash(repo, fns, `COMPACT_MIN_TOKENS="\${AUTO_PIPELINE_COMPACT_MIN_TOKENS:-150000}"; mark="$(mktemp)"; touch -t 200001010000 "$mark"
        compact_session "${wt}" "${report}" "${log}" /dev/null ${Buffer.byteLength(before)} "$mark" || true; echo DONE`,
      { HOME: home, PATH: `${bin}:${process.env.PATH}`, ...env });
      assert.match(r.stdout, /DONE/, r.stderr);
      return readFileSync(report, 'utf8');
    };
    assert.match(run({ AUTO_PIPELINE_COMPACT_MIN_TOKENS: '0' }), /compaction skipped: turned off/);
    assert.match(run({ AUTO_PIPELINE_COMPACT_MIN_TOKENS: '250000' }), /compaction skipped: context 200k is under the 250k threshold \(session new\)/);
    assert.match(run({ FAIL: '1' }), /compaction failed \(exit code 3\): session new keeps its full context/);
    assert.match(run({}), /compacting session new \(200k\)[\s\S]*session compacted 200k -> 81k \(session new\)/);
    assert.doesNotMatch(readFileSync(path.join(sdir, 'old.jsonl'), 'utf8'), /compact_boundary/, 'the older session is never compacted');
    // compacted already: the size is the one after the compaction, so it is not compacted again
    assert.match(run({}), /compaction skipped: context 81k is under the 150k threshold/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
