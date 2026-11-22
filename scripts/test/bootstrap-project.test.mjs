// Tests for skills/bootstrap-project: render a throwaway repo, verify it, upgrade it.
// Everything runs in a temp folder; nothing touches ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
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

test('a browser-test run adds the /tmp/claude-<uid> folder, so the session can write its click script', () => {
  const { dir, repo } = bootstrapRepo(webUi);
  try {
    const r = pipelineBash(repo, ['add_dir_args'], 'add_dir_args; printf "%s\\n" "${ADD_DIR_ARGS[@]}"; BROWSER_TEST_PROJECT=; add_dir_args; echo "N=${#ADD_DIR_ARGS[@]}"');
    assert.equal(r.status, 0, r.stderr);
    const tmp = realpathSync('/tmp');
    assert.ok(r.stdout.startsWith(`--add-dir\n${tmp}/claude-${process.getuid()}\n`), r.stdout);
    assert.match(r.stdout, /N=0/);
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

const render = await import(path.join(SKILL, 'scripts/render.mjs'));

test('dedupeRules drops exact duplicates and rules that a broader prefix rule covers', () => {
  assert.deepEqual(render.dedupeRules(['Bash(pnpm format:check*)', 'Bash(pnpm format:check)', 'Bash(pnpm lint*)', 'Bash(pnpm lint:check)',
    'Bash(npx oxlint)', 'Bash(npx oxlint *)', 'Read(./**)', 'Read(./**)', 'Bash(git hash-object*)', 'Bash(git hash-object*)']),
  ['Bash(pnpm format:check*)', 'Bash(pnpm lint*)', 'Bash(npx oxlint)', 'Bash(npx oxlint *)', 'Read(./**)', 'Bash(git hash-object*)']);
});

test('settings.json: deny holds only destructive rules (force push yes, plain push no), and the shared allow list has no PR rule', () => {
  const { dir, repo } = bootstrapRepo((p) => { p.rules.extraAllow = ['Bash(pnpm lint:check)', 'Bash(git hash-object*)']; return p; });
  try {
    const s = JSON.parse(readFileSync(path.join(repo, '.claude/settings.json'), 'utf8'));
    // a plain push is never denied (lesson 1); a force push and a new repo are
    assert.ok(!s.permissions.deny.some((d) => /^Bash\(git push(\*)?\)$/.test(d)), s.permissions.deny.join(', '));
    for (const d of ['Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(gh repo create*)']) assert.ok(s.permissions.deny.includes(d), d);
    assert.ok(!s.permissions.allow.some((a) => /^Bash\(gh pr /.test(a)));
    assert.equal(s.permissions.allow.filter((a) => a.startsWith('Bash(git hash-object')).length, 1);
    assert.ok(!s.permissions.allow.includes('Bash(pnpm lint:check)'), 'covered by Bash(pnpm lint*)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a validator prints one list: the generic lines with the new project limits appended', () => {
  const tmpl = '@@IFNOT HAS_VALIDATOR_LIMITS@@\n- **Never:** sign in, open a browser, or change a database row or a file.\n- **Never read or print secrets:** no password, token or key from `.env` files.\n@@END@@\n';
  assert.deepEqual(render.mergeLimits(['open a browser', 'change a database row'], tmpl), [], 'all covered: the generic lines stay as they are');
  assert.deepEqual(render.mergeLimits(['load a page', 'load a page', 'read an OAuth client secret'], tmpl), [
    '- **Never:** sign in, open a browser, or change a database row or a file. Also never: load a page.',
    '- **Never read or print secrets:** no password, token or key from `.env` files. Also never: read an OAuth client secret.']);
  const { dir, repo } = bootstrapRepo((p) => { p.rules.validatorLimits = ['load a page']; return p; });
  try {
    const v = readFileSync(path.join(repo, '.claude/agents/plan-validator.md'), 'utf8');
    assert.equal((v.match(/^- \*\*Never:\*\*/gm) || []).length, 1, v);
    assert.match(v, /Also never: load a page\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the verify audit skips the generic Secrets row when a hard rule covers secrets, and its lint row is check-only', () => {
  const { dir, repo } = bootstrapRepo((p) => {
    p.rules.hard.push({ title: 'Config and secrets', rule: 'Code reads config only through the config service.' });
    return p;
  });
  try {
    const v = readFileSync(path.join(repo, '.claude/skills/skill-4-verify/SKILL.md'), 'utf8');
    assert.doesNotMatch(v, /^\| \d+ \| Secrets \|/m);
    assert.match(v, /^\| \d+ \| Config and secrets \|/m);
    assert.match(v, /^\| 2 \| Lint and format \| `pnpm lint:check`.*Never a `--fix` command/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('changelog.validateCmd replaces the rendered validator in the gate, the docs and the allow list', () => {
  const { dir, repo } = bootstrapRepo((p) => { p.changelog.validateCmd = 'pnpm changelog:validate'; return p; });
  try {
    assert.ok(!existsSync(path.join(repo, '.claude/scripts/changelog-validate.mjs')));
    const gate = readFileSync(path.join(repo, '.github/workflows/changelog-gate.yml'), 'utf8');
    assert.match(gate, /run: pnpm changelog:validate$/m);
    assert.match(gate, /CHANGELOG_SKIP: .*no-changelog/);
    assert.match(gate, /pnpm install --frozen-lockfile/);
    for (const f of ['changelog.d/README.md', 'changelog.d/AGENTS.md', '.claude/skills/changelog-entry/SKILL.md']) {
      const t = readFileSync(path.join(repo, f), 'utf8');
      assert.match(t, /`pnpm changelog:validate`/, f);
      assert.doesNotMatch(t, /changelog-validate\.mjs/, f);
    }
    const allow = JSON.parse(readFileSync(path.join(repo, '.claude/settings.json'), 'utf8')).permissions.allow;
    assert.ok(allow.includes('Bash(pnpm changelog:validate)'));
    assert.ok(!allow.some((a) => a.includes('changelog-validate.mjs')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('registry.browserTestProject names the browser-test profile in auto-pipeline.sh and register.mjs', () => {
  const { dir, repo } = bootstrapRepo((p) => { webUi(p); p.registry.browserTestProject = 'acme'; return p; });
  try {
    assert.match(readFileSync(path.join(repo, '.claude/scripts/auto-pipeline.sh'), 'utf8'), /^BROWSER_TEST_PROJECT="acme"$/m);
    const r = node('register.mjs', ['.', '--registry', path.join(dir, 'reg.json'), '--qa-home', path.join(dir, 'qa')], repo);
    assert.equal(r.status, 0, r.stderr);
    if (!/skipped: .* is missing/.test(r.stdout)) assert.match(r.stdout, /profile\.mjs' (init|add-repo) 'acme'/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('codex on: verify runs the Codex code review, the sheet reuses it, and the code-reviews folder is ignored; codex off: none of it', () => {
  const read = (r, f) => readFileSync(path.join(r, f), 'utf8');
  const on = bootstrapRepo();
  const off = bootstrapRepo((p) => { p.modules.codex = false; return p; });
  try {
    const v = read(on.repo, '.claude/skills/skill-4-verify/SKILL.md');
    assert.match(v, /^## Step 1\.5 — Codex review/m);
    assert.match(v, /validate-implementation skill .*Base: develop\./);
    assert.match(v, /argument-hint: .*--no-codex/);
    assert.doesNotMatch(v, /@@/);
    assert.match(read(on.repo, '.claude/skills/skill-auto-pipeline/SKILL.md'), /--codex-report \.plans\/\.code-reviews\//);
    assert.match(read(on.repo, '.claude/skills/decision-sheet/SKILL.md'), /Verify already ran Codex/);
    assert.match(read(on.repo, '.gitignore'), /^\.plans\/\.code-reviews\/$/m);
    const offV = read(off.repo, '.claude/skills/skill-4-verify/SKILL.md');
    assert.doesNotMatch(offV, /Codex/);
    assert.doesNotMatch(offV, /@@/);
    assert.doesNotMatch(read(off.repo, '.claude/skills/skill-auto-pipeline/SKILL.md'), /codex-report/);
  } finally {
    rmSync(on.dir, { recursive: true, force: true });
    rmSync(off.dir, { recursive: true, force: true });
  }
});

test('after the ship, follow-ups on an open PR are committed and pushed without asking', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const agents = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
    assert.match(agents, /\*\*Follow-ups on an open PR: commit and push without asking\.\*\*/);
    assert.match(agents, /never `git add -A`/);
    assert.match(readFileSync(path.join(repo, '.claude/skills/skill-5-ship/SKILL.md'), 'utf8'), /^## After the ship$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--apply saves renderHash; --status ignores an owner edit but reports changed answers', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const status = () => { const r = node('render.mjs', ['.', '--status'], repo); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
    const answersFile = path.join(repo, '.claude/bootstrap.json');
    const answers = JSON.parse(readFileSync(answersFile, 'utf8'));
    assert.match(answers.renderHash, /^[0-9a-f]{16}$/);
    let s = status();
    assert.equal(s.saved, s.hash);
    // the owner edits a rendered skill on purpose: the file differs, the fingerprint does not
    const skill = path.join(repo, '.claude/skills/skill-3-test/SKILL.md');
    writeFileSync(skill, readFileSync(skill, 'utf8') + '\nA rule only this repo has.\n');
    s = status();
    assert.equal(s.saved, s.hash);
    assert.equal(s.counts.changed, 1);
    // a changed answer is not applied yet: the fingerprint differs
    writeFileSync(answersFile, JSON.stringify({ ...answers, project: { ...answers.project, summary: 'Another summary.' } }, null, 2));
    s = status();
    assert.notEqual(s.saved, s.hash);
    // --status writes nothing
    assert.equal(JSON.parse(readFileSync(answersFile, 'utf8')).renderHash, answers.renderHash);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--unused lists the modules, registrations, commands and settings the answers leave out, and skips what the repo has', () => {
  const { dir, repo } = bootstrapRepo((p) => ({ ...p, modules: { ...p.modules, codex: false }, registry: { ...p.registry, browserTest: false }, git: { ...p.git, tickets: {} } }));
  try {
    mkdirSync(path.join(repo, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(repo, '.github/workflows/ci.yml'), 'on: push\n');
    writeFileSync(path.join(repo, '.nvmrc'), '24\n');
    const r = node('render.mjs', ['.', '--unused', '--json'], repo);
    assert.equal(r.status, 0, r.stderr);
    const keys = JSON.parse(r.stdout).map((i) => `${i.group}:${i.key}`);
    for (const k of ['module:codex', 'registration:browserTest', 'command:testE2e', 'command:format', 'setting:tickets.evidence', 'setting:tickets.board', 'plan:dependabot']) assert.ok(keys.includes(k), `${k} missing in ${keys}`);
    for (const k of ['module:changelog', 'registration:dashboard', 'command:test', 'setting:services', 'plan:ci', 'plan:node-version']) assert.ok(!keys.includes(k), `${k} should not be listed`);
    const text = node('render.mjs', ['.', '--unused'], repo).stdout;
    assert.match(text, /^Modules that are off:\n {2}1\. codex: /);
    assert.match(text, /to turn on: modules\["codex"\] = true/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a root CLAUDE.md with another job stays: .claude/CLAUDE.md loads AGENTS.md, and verify accepts it', () => {
  const { dir, repo, stage } = bootstrapRepo();
  try {
    const globalRules = '# Global instructions (all projects)\n\n- TLDR first.\n';
    writeFileSync(path.join(repo, 'CLAUDE.md'), globalRules);
    // without the .claude/ shim the root file is a change, and verify fails
    let r = node('render.mjs', ['.', '--upgrade', '--stage', stage, '--json'], repo);
    assert.equal(JSON.parse(r.stdout).files.find((f) => f.path === 'CLAUDE.md').status, 'changed');
    let v = JSON.parse(node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo).stdout);
    assert.ok(v.failed.some((f) => /instructions/.test(JSON.stringify(f))), JSON.stringify(v.failed));
    // with it, the render leaves the root file out, and verify passes
    writeFileSync(path.join(repo, '.claude/CLAUDE.md'), '@../AGENTS.md\n');
    r = node('render.mjs', ['.', '--upgrade', '--stage', stage, '--json'], repo);
    assert.ok(!JSON.parse(r.stdout).files.some((f) => f.path === 'CLAUDE.md'));
    v = JSON.parse(node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo).stdout);
    assert.deepEqual(v.failed, []);
    assert.equal(readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), globalRules);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one branch for base and production is named once, and a repo with no install asks before adding a package', () => {
  const { dir, repo } = bootstrapRepo((p) => ({ ...p, git: { ...p.git, base: 'main', prod: 'main' }, stack: { ...p.stack, installCmd: '' } }));
  try {
    const agents = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^- Branches: main only\./m);
    assert.doesNotMatch(agents, /`main` or `main`/);
    assert.doesNotMatch(readFileSync(path.join(repo, '.claude/skills/skill-5-ship/SKILL.md'), 'utf8'), /`main` or `main`/);
    assert.match(agents, /^- Add a package only with the owner's yes\./m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const two = bootstrapRepo();
  try {
    const agents = readFileSync(path.join(two.repo, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^- Branches: develop → main\./m);
    assert.match(agents, /Never push `develop` or `main`/);
    assert.match(agents, /^- Use the latest package versions/m);
  } finally { rmSync(two.dir, { recursive: true, force: true }); }
});

test('skill-1-plan writes a split into the parent plan before the first plan', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const skill = readFileSync(path.join(repo, '.claude/skills/skill-1-plan/SKILL.md'), 'utf8');
    assert.match(skill, /split it into ordered plans without asking/);
    assert.match(skill, /Before that plan, write the split into `docs\/PLAN\.md` \(Phases\)/);
    assert.match(skill, /later plans start from the parent plan and not from the chat/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
