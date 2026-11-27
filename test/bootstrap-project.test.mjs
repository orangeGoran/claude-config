// Tests for skills/bootstrap-project: render a throwaway repo, verify it, upgrade it.
// Everything runs in a temp folder; nothing touches ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, statSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/bootstrap-project');
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

test('codex on by default: Codex checks the plan and runs in each verify round', () => {
  const read = (r, f) => readFileSync(path.join(r, f), 'utf8');
  const def = bootstrapRepo();
  const civ = bootstrapRepo((p) => { p.pipeline.codexInVerify = true; return p; });
  const no = bootstrapRepo((p) => { p.pipeline.codexInVerify = false; return p; });
  try {
    // unset (the example answers) and an explicit true render the same Codex-in-verify texts
    for (const r of [def.repo, civ.repo]) {
      const v = read(r, '.claude/skills/skill-4-verify/SKILL.md');
      assert.match(v, /^## Step 1 — Bug hunt \(max 2 rounds; each round is one Claude review, then one Codex review\)$/m);
      assert.doesNotMatch(v, /@@/);
      assert.match(read(r, '.claude/skills/skill-auto-pipeline/SKILL.md'), /codex-report/);
      assert.match(read(r, '.claude/skills/decision-sheet/SKILL.md'), /Verify already ran Codex/);
      const agents = read(r, 'AGENTS.md');
      assert.match(agents, /--no-codex/);
      assert.ok(agents.includes('round 2 only after a behaviour fix'));
    }
    // an explicit false keeps Codex out of verify; it still checks the plan and runs in the decision sheet
    const v = read(no.repo, '.claude/skills/skill-4-verify/SKILL.md');
    assert.match(v, /^## Step 1 — Bug hunt \(code-review loop, max 2 rounds\)$/m);
    assert.doesNotMatch(v, /Codex/);
    const sheet = read(no.repo, '.claude/skills/decision-sheet/SKILL.md');
    assert.match(sheet, /^## Step 2 — Codex review/m);
    assert.doesNotMatch(sheet, /--codex-report/);
    assert.match(read(no.repo, '.claude/skills/skill-auto-validate-plan/SKILL.md'), /Codex/);
    assert.doesNotMatch(read(no.repo, 'AGENTS.md'), /--no-codex/);
  } finally {
    for (const r of [def, civ, no]) rmSync(r.dir, { recursive: true, force: true });
  }
});

test('codexInVerify: verify runs the Codex code review, the sheet reuses it, and the code-reviews folder is ignored; codex off: none of it', () => {
  const read = (r, f) => readFileSync(path.join(r, f), 'utf8');
  const on = bootstrapRepo((p) => { p.pipeline.codexInVerify = true; return p; });
  const off = bootstrapRepo((p) => { p.modules.codex = false; return p; });
  try {
    const v = read(on.repo, '.claude/skills/skill-4-verify/SKILL.md');
    assert.match(v, /^## Step 1 — Bug hunt \(max 2 rounds; each round is one Claude review, then one Codex review\)$/m);
    assert.doesNotMatch(v, /^## Step 1 — Bug hunt \(code-review loop/m);
    assert.match(v, /validate-implementation skill .*Base: develop\./);
    assert.match(v, /argument-hint: .*--no-codex/);
    assert.doesNotMatch(v, /@@/);
    // one report per branch, overwritten each round: ship, plan-lanes and the dashboard read only this name
    assert.match(v, /-o "\.plans\/\.code-reviews\/<branch-with-slashes-as-dashes>-codex\.md"/);
    assert.match(read(on.repo, '.claude/skills/skill-auto-pipeline/SKILL.md'), /--codex-report <path>` with the Codex report that row 1 names \(`\.plans\/\.code-reviews\/<branch-with-slashes-as-dashes>-codex\.md`/);
    assert.match(read(on.repo, '.claude/skills/decision-sheet/SKILL.md'), /`\.plans\/\.code-reviews\/<branch-with-slashes-as-dashes>-codex\.md`, which each round overwrites/);
    assert.match(read(on.repo, '.claude/scripts/plan-lanes.mjs'), /'-codex\.md'/);
    for (const f of ['.claude/skills/skill-4-verify/SKILL.md', '.claude/skills/skill-auto-pipeline/SKILL.md', '.claude/skills/decision-sheet/SKILL.md', '.claude/skills/skill-5-ship/SKILL.md']) {
      assert.doesNotMatch(read(on.repo, f), /codex-round/, f);
    }
    assert.match(read(on.repo, '.claude/skills/decision-sheet/SKILL.md'), /Verify already ran Codex/);
    assert.match(read(on.repo, '.gitignore'), /^\.plans\/\.code-reviews\/$/m);
    const offV = read(off.repo, '.claude/skills/skill-4-verify/SKILL.md');
    assert.match(offV, /^## Step 1 — Bug hunt \(code-review loop, max 2 rounds\)$/m);
    assert.doesNotMatch(offV, /Codex/);
    assert.doesNotMatch(offV, /@@/);
    assert.doesNotMatch(read(off.repo, '.claude/skills/skill-auto-pipeline/SKILL.md'), /codex-report/);
  } finally {
    rmSync(on.dir, { recursive: true, force: true });
    rmSync(off.dir, { recursive: true, force: true });
  }
});

// write plans and validation reports into a rendered repo, then run its plan-lanes.mjs
function lanesWith({ dir, repo }, plans, reports, json = true) {
  const vdir = path.join(repo, '.plans/.validations');
  mkdirSync(vdir, { recursive: true });
  for (const [slug, title] of Object.entries(plans)) writeFileSync(path.join(repo, '.plans', slug + '.md'), `# Plan: ${title}\n\n## Steps\n\n1. Change \`src/${slug}.ts\`.\n`);
  for (const f of reports) writeFileSync(path.join(vdir, f), '# report\n');
  const r = spawnSync(process.execPath, ['.claude/scripts/plan-lanes.mjs', ...(json ? ['--json'] : [])],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: dir } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('plan-lanes counts Claude and Codex rounds with old and new names', () => {
  const a = bootstrapRepo();
  const b = bootstrapRepo();
  try {
    const reports = ['ana-plan-validation-claude-1.md', 'ana-plan-validation-codex-1.md', 'ana-plan-validation-round-1.md',
      'ana-plan-validation-2.md', 'ana-plan-codex-raw-2.md', 'ana-plan-validation-codex-2.md', 'ana-plan-round-2.md',
      'ana-plan-external-1.md', 'ana-plan-validation-claude-4.md', 'ana-plan-codex-raw-5.md'];
    const out = JSON.parse(lanesWith(a, { 'ana-plan': 'Ana plan', 'bea-plan': 'Bea plan' }, reports));
    const ana = out.plans.find((p) => p.slug === 'ana-plan');
    // -codex-raw-2 and -validation-codex-2 are one round; the rounds are 1, 2, 4 and 5
    assert.deepEqual(ana.validation, { claude: 3, codex: 3, rounds: 4 });
    // a plan with no reports has all three counts, at 0
    assert.deepEqual(out.plans.find((p) => p.slug === 'bea-plan').validation, { claude: 0, codex: 0, rounds: 0 });
    const text = lanesWith(a, {}, [], false);
    assert.ok(out.recommendedBatch.some((p) => p.slug === 'ana-plan'), JSON.stringify(out.excluded));
    assert.match(text, /validation=3c\/3x\/4r/);
    // an empty report (a Codex run that stopped early) and a report of blank lines count for no validator and no round
    const bdir = path.join(b.repo, '.plans/.validations');
    mkdirSync(bdir, { recursive: true });
    writeFileSync(path.join(bdir, 'ana-plan-validation-claude-1.md'), '');
    writeFileSync(path.join(bdir, 'ana-plan-validation-codex-3.md'), '');
    writeFileSync(path.join(bdir, 'ana-plan-validation-claude-4.md'), '\n  \n');
    // one owner per name: -validation-codex-1 is ana-plan's new Codex report, -validation-codex-raw-1 is ana-plan-validation's old one
    const two =JSON.parse(lanesWith(b, { 'ana-plan': 'Ana plan', 'ana-plan-validation': 'Ana validation' },
      // a report name that is also an Object.prototype key must not crash the script
      ['ana-plan-validation-codex-1.md', 'ana-plan-validation-codex-raw-1.md', 'constructor-validation-1.md']));
    const by = (slug) => two.plans.find((p) => p.slug === slug).validation;
    assert.deepEqual(by('ana-plan'), { claude: 0, codex: 1, rounds: 1 });
    assert.deepEqual(by('ana-plan-validation'), { claude: 0, codex: 1, rounds: 1 });
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('plan-lanes ranks a lane by validation rounds, not by report files', () => {
  const c = bootstrapRepo();
  try {
    // both plans change the same three files (a hard overlap: more than 2), so they share one lane
    // and the batch takes one of them.
    // ana-plan: 3 rounds, Claude only (3 files). bea-plan: 2 rounds, both validators (4 files).
    const vdir = path.join(c.repo, '.plans/.validations');
    mkdirSync(vdir, { recursive: true });
    for (const slug of ['ana-plan', 'bea-plan'])
      writeFileSync(path.join(c.repo, '.plans', slug + '.md'),
        `# Plan: ${slug}\n\n## Steps\n\n1. Change \`src/shared-a.ts\`, \`src/shared-b.ts\` and \`src/shared-c.ts\`.\n`);
    for (const f of ['ana-plan-validation-claude-1.md', 'ana-plan-validation-claude-2.md', 'ana-plan-validation-claude-3.md',
      'bea-plan-validation-claude-1.md', 'bea-plan-validation-codex-1.md', 'bea-plan-validation-claude-2.md', 'bea-plan-validation-codex-2.md'])
      writeFileSync(path.join(vdir, f), '# report\n');
    const r = spawnSync(process.execPath, ['.claude/scripts/plan-lanes.mjs', '--json'],
      { cwd: c.repo, encoding: 'utf8', env: { ...process.env, HOME: c.dir } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    const picked = out.recommendedBatch.map((p) => p.slug).filter((s) => s === 'ana-plan' || s === 'bea-plan');
    assert.deepEqual(picked, ['ana-plan'], 'more rounds wins, though bea-plan has more report files');
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('the validation skills write the report names of their author', () => {
  const read = (r, f) => readFileSync(path.join(r, f), 'utf8');
  const on = bootstrapRepo();
  const off = bootstrapRepo((p) => { p.modules.codex = false; return p; });
  try {
    const auto = read(on.repo, '.claude/skills/skill-auto-validate-plan/SKILL.md');
    const outArg = auto.match(/-o "([^"]+)"/)?.[1];
    assert.equal(outArg, '.plans/.validations/<plan-base>-validation-codex-<n>.md');
    assert.match(auto, /^- \*\*Claude\*\*:.*<plan-base>-validation-claude-<n>\.md/m);
    const logLines = (s) => s.split('\n').filter((l) => /^Write one decision log/.test(l));
    assert.ok(logLines(auto).length > 0);
    for (const l of logLines(auto)) {
      assert.match(l, /<plan-base>-validation-round-<n>\.md/);
      assert.doesNotMatch(l, /<plan-base>-round-<n>\.md/);
    }
    assert.doesNotMatch(outArg, /codex-raw/);
    const stopRule = (s) => s.split('\n').find((l) => l.includes('**Continue.**'));
    assert.match(stopRule(auto), /`k` < 4 → run round `k\+1`/);
    assert.match(read(on.repo, '.claude/agents/plan-validator.md'), /-validation-claude-<n>\.md/);
    assert.match(read(on.repo, '.claude/skills/skill-validate-plan/SKILL.md'), /-validation-claude-<n>\.md/);
    assert.match(read(on.repo, '.claude/skills/apply-validation/SKILL.md'), /-validation-round-<n>\.md/);
    assert.match(read(on.repo, '.claude/skills/plans-parallel/SKILL.md'), /<r>r/);
    assert.match(read(on.repo, 'AGENTS.md'), /-validation-round-<n>\.md/);
    const autoOff = read(off.repo, '.claude/skills/skill-auto-validate-plan/SKILL.md');
    assert.match(autoOff, /-validation-claude-<n>\.md/);
    assert.match(autoOff, /-validation-round-<n>\.md/);
    assert.match(stopRule(autoOff), /`k` < 4 → run round `k\+1`/);
    assert.match(read(off.repo, 'AGENTS.md'), /<plan-basename>-validation-claude-<n>\.md/);
    // one round number rule in the skill and the agent, so a new run never overwrites an earlier round
    const rule = /`<n>` is 1 plus the highest number at the end of any validator report or decision log of this plan in `\.plans\/\.validations\/` \(.*-codex-raw-<n>\.md`.*\), or 1 when there is none\./;
    for (const r of [on.repo, off.repo]) {
      assert.match(read(r, '.claude/skills/skill-auto-validate-plan/SKILL.md'), rule, r);
      // the agent still sees the old reports when it takes the next round number
      assert.match(read(r, '.claude/agents/plan-validator.md'), rule, r);
      // a file of a longer plan name (ana-plan-validation) is not a round of ana-plan, and no writer takes a name that exists
      for (const f of ['.claude/skills/skill-auto-validate-plan/SKILL.md', '.claude/agents/plan-validator.md']) {
        assert.ok(read(r, f).includes('or 1 when there is none. A file of a longer plan name does not count'), `${r} ${f}`);
        assert.ok(read(r, f).includes('Never write over a file that exists: when the name is taken, take the next free number.'), `${r} ${f}`);
      }
    }
    // the skill gives the agent its round number in the briefing
    assert.match(auto, /^- \*\*Claude\*\*: dispatch the `plan-validator` agent .*, plus the round number `<n>`\./m);
    assert.match(autoOff, /^Dispatch the `plan-validator` agent .*, plus the round number `<n>`\./m);
  } finally {
    rmSync(on.dir, { recursive: true, force: true });
    rmSync(off.dir, { recursive: true, force: true });
  }
});

test('the install prewarm: pnpm gets `pnpm --version` and a hint, npm gets none, and a failed prewarm stops the launch with the hint', () => {
  const pnpm = bootstrapRepo();
  const npm = bootstrapRepo((p) => ({ ...p, stack: { ...p.stack, packageManager: 'npm', installCmd: 'npm ci' } }));
  try {
    const src = readFileSync(path.join(pnpm.repo, '.claude/scripts/auto-pipeline.sh'), 'utf8');
    assert.match(src, /^INSTALL_PREWARM_CMD="pnpm --version"$/m);
    assert.match(src, /^INSTALL_PREWARM_FIX="remove the \*_tmp_\* folders .*then run pnpm --version"$/m);
    assert.doesNotMatch(src, /if \[ "\$tool" = pnpm \]/, 'no hard-coded pnpm check in the generic code');
    const npmSrc = readFileSync(path.join(npm.repo, '.claude/scripts/auto-pipeline.sh'), 'utf8');
    assert.match(npmSrc, /^INSTALL_PREWARM_CMD=""$/m);
    assert.match(npmSrc, /^INSTALL_PREWARM_FIX=""$/m);
    // the install tool is `bash` here, so the test does not need pnpm on PATH
    const run = (prewarm, fix) => pipelineBash(pnpm.repo, ['check_install_tool'],
      `REPO='${pnpm.repo}'; INSTALL_CMD='bash -c true'; INSTALL_PREWARM_CMD='${prewarm}'; INSTALL_PREWARM_FIX='${fix}'; check_install_tool; echo PASSED`);
    const failed = run('false', 'run the fix');
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout, /FATAL: `false` failed in the main checkout \(INSTALL_PREWARM_CMD in the CONFIG block\)\.\n\s+Try: run the fix/);
    const noHint = run('false', '');
    assert.equal(noHint.status, 1);
    assert.doesNotMatch(noHint.stdout, /Try:/);
    for (const ok of [run('true', ''), run('', '')]) {
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, /PASSED/);
    }
  } finally {
    rmSync(pnpm.dir, { recursive: true, force: true });
    rmSync(npm.dir, { recursive: true, force: true });
  }
});

test('an upgrade adds INSTALL_PREWARM_* to an older kept CONFIG block, and the older block still runs', () => {
  const { dir, repo, stage } = bootstrapRepo();
  try {
    const f = path.join(repo, '.claude/scripts/auto-pipeline.sh');
    const old = readFileSync(f, 'utf8').replace(/^# EDIT 2b:[\s\S]*?^INSTALL_PREWARM_FIX=.*\n/m, '');
    assert.doesNotMatch(old, /^INSTALL_PREWARM_CMD="pnpm/m);
    writeFileSync(f, old);
    // the script body gives an older block an empty default, so `set -u` does not stop it
    const r = pipelineBash(repo, ['check_install_tool'], `REPO='${repo}'; INSTALL_CMD='bash -c true'; check_install_tool; echo "PASSED [$INSTALL_PREWARM_CMD]"`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASSED \[\]/);
    node('render.mjs', ['.', '--upgrade', '--stage', stage, '--json'], repo);
    const staged = readFileSync(path.join(stage, '.claude/scripts/auto-pipeline.sh'), 'utf8');
    assert.match(staged, /^INSTALL_PREWARM_CMD="pnpm --version"$/m);
    assert.match(staged, /^INSTALL_PREWARM_FIX="remove /m);
    assert.equal(spawnSync('bash', ['-n', path.join(stage, '.claude/scripts/auto-pipeline.sh')]).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('existing_worktree falls back to the older flat worktree folder only when the current one does not exist', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const root = path.join(dir, 'worktrees');
    const r = pipelineBash(repo, ['worktree_of_branch', 'existing_worktree'], [
      `REPO='${repo}'; WORKTREES_ROOT='${root}'; WORKTREES_DIR="$WORKTREES_ROOT/acme-api"`,
      'mkdir -p "$WORKTREES_ROOT/old-slug"',
      'echo "A=$(existing_worktree old-slug)"', 'echo "B=$(existing_worktree new-slug)"',
      'mkdir -p "$WORKTREES_DIR/old-slug"', 'echo "C=$(existing_worktree old-slug)"'].join('\n'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^A=${root}/old-slug$`, 'm'));
    assert.match(r.stdout, new RegExp(`^B=${root}/acme-api/new-slug$`, 'm'));
    assert.match(r.stdout, new RegExp(`^C=${root}/acme-api/old-slug$`, 'm'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the verify audit has a Security row and names the rows that may be N/A by number', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const v = readFileSync(path.join(repo, '.claude/skills/skill-4-verify/SKILL.md'), 'utf8');
    const row = (name) => Number(v.match(new RegExp(`^\\| (\\d+) \\| ${name} \\|`, 'm'))?.[1]);
    const sec = row('Security'), scope = row('Plan scope'), tests = row('Tests'), secrets = row('Secrets');
    assert.ok(sec > 2 && scope === sec + 1, `Security ${sec}, Plan scope ${scope}`);
    assert.match(v, new RegExp(`These rows may be N/A: rows 3–\\d+ \\(the hard rules\\), only when the scope has nothing the rule checks`));
    assert.match(v, new RegExp(`row ${sec} \\(Security\\), only when no changed path matches the table of the security pass`));
    assert.match(v, new RegExp(`row ${scope} \\(Plan scope\\), only when there is no plan file`));
    assert.match(v, new RegExp(`Rows 1 \\(Code review\\), 2 \\(Lint and format\\), \\d+ \\(JSDoc\\), ${tests} \\(Tests\\), ${secrets} \\(Secrets\\) are never N/A\\.`));
    assert.match(v, new RegExp(`rows 1–${scope} are Pass or N/A`));
    assert.match(v, /security-checklist\.md/);
    assert.ok(existsSync(path.join(repo, '.claude/skills/skill-4-verify/security-checklist.md')));
    assert.match(v, /### Secrets scan \(subagent, Grep and Read only\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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

test('the placeholder check skips changelog entries, but still checks the changelog docs', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const verify = () => JSON.parse(node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo).stdout);
    // an entry about the templates names a placeholder on purpose: it is history, not a leftover
    writeFileSync(path.join(repo, 'changelog.d/20260101-templates.yaml'), 'kind: changed\naudience: internal\nsummary: x\ninternal: fills @@PLAN_GOAL@@\n');
    assert.ok(!verify().failed.some((f) => /placeholders/.test(JSON.stringify(f))));
    // a leftover in a doc the bootstrap writes still fails
    writeFileSync(path.join(repo, 'changelog.d/README.md'), '# Changelog\n\n@@PROJECT_NAME@@\n');
    assert.ok(verify().failed.some((f) => /placeholders/.test(JSON.stringify(f))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the placeholder check skips a plan the owner wrote, but still checks the first plan', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const verify = () => JSON.parse(node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo).stdout);
    // a plan about the templates names a placeholder on purpose: it is not a leftover
    writeFileSync(path.join(repo, '.plans/20260102-100000-template-work.md'), '# Plan: x\n\n- A merged file with `@@LINT_CMD@@` fails.\n');
    assert.ok(!verify().failed.some((f) => /placeholders/.test(JSON.stringify(f))));
    // a leftover in the first plan, which the bootstrap writes, still fails
    const first = readdirSync(path.join(repo, '.plans')).find((f) => f.endsWith('-check-the-pipeline-end-to-end.md'));
    assert.ok(first, 'the bootstrap wrote the first plan');
    writeFileSync(path.join(repo, '.plans', first), '# Plan: Check the pipeline end to end\n\n@@PLAN_GOAL@@\n');
    assert.ok(verify().failed.some((f) => /placeholders/.test(JSON.stringify(f))));
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
    assert.match(skill, /Before that plan, write the split into a new parent plan/);
    assert.match(skill, /later plans start from the parent plan and not from the chat/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a split gets its own dated parent plan in .plans/, and child plans name it', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    const read = (f) => readFileSync(path.join(repo, f), 'utf8');
    assert.match(read('AGENTS.md'), /`\.plans\/YYYYMMDD-HHMMSS-<slug>-parent\.md`, which starts with `> \*\*Master plan\.\*\*`/);
    const plan = read('.claude/skills/skill-1-plan/SKILL.md');
    assert.match(plan, /write the split into a new parent plan `\.plans\/<YYYYMMDD-HHMMSS>-<slug>-parent\.md`/);
    assert.match(plan, /^- \*\*Parent\*\*: /m);
    assert.match(read('.claude/agents/plan-validator.md'), /`- \*\*Parent\*\*: <file>`, read that parent plan too/);
    assert.match(read('.claude/skills/skill-2-implement/SKILL.md'), /the parent plan named in its `- \*\*Parent\*\*:` line/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a board with reviewStatus and a staging branch gets the staging gate and /staging-review', () => {
  const { dir, repo } = bootstrapRepo((p) => ({ ...p, git: { ...p.git, staging: 'staging', tickets: { ...p.git.tickets, board: { owner: 'acme-co', number: 1, status: 'Next review', reviewStatus: 'In review' } } } }));
  try {
    const read = (f) => readFileSync(path.join(repo, f), 'utf8');
    const review = read('.claude/skills/staging-review/SKILL.md');
    assert.match(review, /^name: staging-review$/m);
    assert.match(review, /Status "Next review"/);
    assert.match(review, /compare\/staging\.\.\./);
    const ship = read('.claude/skills/skill-5-ship/SKILL.md');
    assert.match(ship, /Never set "In review" here/);
    assert.match(ship, /`Refs #<n>` tickets: do not change the Status/);
    assert.doesNotMatch(ship, /both the `To be closed after staging QA: #<n>` and the `Refs #<n>` lines/);
    assert.match(read('AGENTS.md'), /`\/staging-review` moves each ticket/);
    const v = node('verify.mjs', ['.', '--registry', path.join(dir, 'none.json'), '--json'], repo);
    assert.deepEqual(JSON.parse(v.stdout).failed, [], v.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a board without reviewStatus keeps the old ship step and gets no /staging-review', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    assert.ok(!existsSync(path.join(repo, '.claude/skills/staging-review/SKILL.md')));
    const ship = readFileSync(path.join(repo, '.claude/skills/skill-5-ship/SKILL.md'), 'utf8');
    assert.match(ship, /both the `To be closed after staging QA: #<n>` and the `Refs #<n>` lines/);
    assert.doesNotMatch(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), /staging-review/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render rejects a reviewStatus without a staging branch or equal to status', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    for (const [board, staging, msg] of [
      [{ owner: 'acme-co', number: 1, status: 'Next review', reviewStatus: 'In review' }, '', /needs git\.staging/],
      [{ owner: 'acme-co', number: 1, status: 'In review', reviewStatus: 'In review' }, 'staging', /must differ from "status"/],
    ]) {
      const p = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
      p.git.staging = staging;
      p.git.tickets.board = board;
      writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(p));
      const r = node('render.mjs', ['.', '--params', 'answers.json', '--stage', path.join(dir, 'stage')], dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, msg);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rules.planSections renames the plan headings in the plan template, the skills, the validators and plan-lanes', () => {
  const names = { goal: 'Requirement', steps: 'Implementation steps', tests: 'Tests to write', verify: 'Final verification' };
  const { dir, repo } = bootstrapRepo((p) => ({ ...p, rules: { ...p.rules, planSections: names } }));
  try {
    const read = (f) => readFileSync(path.join(repo, f), 'utf8');
    const plan = read('.claude/skills/skill-1-plan/SKILL.md');
    for (const h of ['Requirement', 'Context', 'Implementation steps', 'Tests to write', 'Final verification']) assert.match(plan, new RegExp(`^## ${h}$`, 'm'));
    assert.doesNotMatch(plan, /^## (Goal|Steps|Tests|How to verify)$/m);
    assert.match(read('.claude/skills/skill-2-implement/SKILL.md'), /plan's \*\*Implementation steps\*\*/);
    assert.match(read('.claude/skills/skill-3-test/SKILL.md'), /\*\*Final verification\*\* section/);
    assert.match(read('.claude/agents/plan-validator.md'), /empty Requirement, Context,/);
    const lanes = read('.claude/scripts/plan-lanes.mjs');
    assert.match(lanes, /SKIP_SECTIONS = \[[^\]]*'final verification'/);
    assert.doesNotMatch(lanes, /'how to verify'/);
    // the hard-rule titles keep their case
    assert.doesNotMatch(read('.claude/skills/skill-3-test/SKILL.md'), /\(tenant scoping/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const bad = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: bad });
    const p = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
    p.rules.planSections = { goal: 'Requirement', done: 'Done' };
    writeFileSync(path.join(bad, 'answers.json'), JSON.stringify(p));
    const r = node('render.mjs', ['.', '--params', 'answers.json', '--stage', path.join(bad, 'stage')], bad);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /rules\.planSections\.done is unknown/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});

test('the step gate checks only its own repo: a git -C commit in another repo passes, one into its own repo is checked', () => {
  const { dir, repo } = bootstrapRepo();
  const other = path.join(dir, 'other repo');
  try {
    mkdirSync(other);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other });
    for (const r of [repo, other]) {
      writeFileSync(path.join(r, 'feature.js'), 'export const x = 1;\n');
      execFileSync('git', ['add', 'feature.js'], { cwd: r });
    }
    const guard = (command, cwd) => spawnSync('bash', [path.join(repo, '.claude/scripts/workflow-guard.sh')],
      { cwd, input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' });
    // a plain commit in the guard's repo without a finished plan is blocked
    assert.equal(guard('git commit -m "feat: x"', repo).status, 2);
    // a commit in another repo passes, also with a quoted path that has a space
    assert.equal(guard(`git -C "${other}" commit -m "feat: x"`, repo).status, 0);
    // a commit into the guard's repo from another folder is still checked
    const into = guard(`git -C ${repo} commit -m "feat: x"`, other);
    assert.equal(into.status, 2, into.stderr);
    assert.match(into.stderr, /BLOCKED: This commit does not finish a plan/);
    // not a commit: always passes
    assert.equal(guard(`git -C "${other}" status`, repo).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// pipeline diet: fewer repeated checks on the same tree; Codex in verify unless codexInVerify is false
// ---------------------------------------------------------------------------
const readF = (r, f) => readFileSync(path.join(r, f), 'utf8');
const skillOf = (r, s) => readF(r, `.claude/skills/${s}/SKILL.md`);
const civOn = (p) => { p.pipeline.codexInVerify = true; return p; };
const between = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `missing ${from}`);
  const b = text.indexOf(to, a + from.length);
  assert.ok(b > a, `missing ${to} after ${from}`);
  return text.slice(a, b);
};

test('render rejects a codexInVerify that is not a boolean, or that is on while the codex module is off', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const run = (edit) => {
      const p = edit(JSON.parse(readFileSync(EXAMPLE, 'utf8')));
      writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(p));
      return node('render.mjs', ['.', '--params', 'answers.json', '--stage', path.join(dir, 'stage')], dir);
    };
    const notBool = run((p) => { p.pipeline.codexInVerify = 'yes'; return p; });
    assert.equal(notBool.status, 1);
    assert.match(notBool.stderr, /pipeline\.codexInVerify must be true or false/);
    const noModule = run((p) => { p.pipeline.codexInVerify = true; p.modules.codex = false; return p; });
    assert.equal(noModule.status, 1);
    assert.match(noModule.stderr, /pipeline\.codexInVerify needs modules\.codex/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the diet texts: one lint and drift check after the loop, a third stop rule, no re-read of nested AGENTS.md, one full run per tree', () => {
  const def = bootstrapRepo();
  const civ = bootstrapRepo(civOn);
  try {
    const v = skillOf(def.repo, 'skill-4-verify');
    for (const want of ['--max-checks 3', '**No behaviour fix:**', 'do not read it again', 'no behaviour fix, hit the cap']) assert.ok(v.includes(want), want);
    const step1 = between(v, '## Step 1', '## Step 2');
    assert.doesNotMatch(step1, /check-only lint/);
    assert.doesNotMatch(step1, /migration drift check/);
    assert.match(v, /^\| \d+ \| Migration drift \|/m);
    for (const s of ['skill-2-implement', 'skill-3-test', 'skill-4-verify']) {
      const t = skillOf(def.repo, s);
      for (const bad of ['Read every nested', 'Read the nested', 'Read `test/AGENTS.md`']) assert.ok(!t.includes(bad), `${s}: ${bad}`);
    }
    const t3 = skillOf(def.repo, 'skill-3-test');
    for (const want of ['once per tree state', 'ECONNREFUSED', 'SIGSEGV', 'retried alone', 'lists end-to-end tests', 'only infra failures that item 2a cleared']) assert.ok(t3.includes(want), want);
    const t2 = skillOf(def.repo, 'skill-2-implement');
    assert.ok(t2.includes('skip the full "Test (full)"'));
    assert.ok(t2.includes('With `--unattended`'));
    assert.match(t2, /argument-hint: "<plan file> \[--unattended\]"/);
    assert.ok(skillOf(def.repo, 'test-review').includes('(Step 3), when one exists'));
    const pipe = skillOf(def.repo, 'skill-auto-pipeline');
    assert.ok(pipe.includes('this run counts for it'));
    // the regression gate comes before "Run every command", which skips a "Test (full)" the gate ran
    const gate = pipe.indexOf('If its review loop (with the lint run after it) or its test review changed a file');
    const runAll = pipe.indexOf('Run every command in the plan');
    assert.ok(gate >= 0 && runAll > gate, `${gate} ${runAll}`);
    assert.ok(pipe.includes('(except a "Test (full)" command that the regression gate already ran on the same tree)'));
    // the verify audit lint row uses the lint run after the loop; the test red flag; the hand-off text
    assert.ok(v.includes('use the output of the lint run after the Step 1 loop'));
    assert.ok(t3.includes('A partial run reported as the full run'));
    assert.ok(pipe.includes('/skill-2-implement <plan-file> --unattended'));
    assert.match(readF(def.repo, 'AGENTS.md'), /round 2 only after a behaviour fix/);
    // decision 2A: the Codex variant has the same stop rule
    const cv = skillOf(civ.repo, 'skill-4-verify');
    assert.match(cv, /^## Step 1 — Bug hunt \(max 2 rounds; each round is one Claude review, then one Codex review\)$/m);
    assert.ok(cv.includes('**No behaviour fix:**'));
    assert.ok(cv.includes('no behaviour fix, hit the cap'));
    assert.doesNotMatch(between(cv, '## Step 1', '## Step 2'), /check-only lint/);
  } finally {
    rmSync(def.dir, { recursive: true, force: true });
    rmSync(civ.dir, { recursive: true, force: true });
  }
});

test('the "after the PR opened" rule renders only into the skills that run after a PR opened', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    for (const s of ['skill-3-test', 'skill-4-verify']) assert.doesNotMatch(skillOf(repo, s), /after the PR opened/, s);
    for (const s of ['skill-5-ship', 'decision-sheet', 'pr-feedback']) assert.match(skillOf(repo, s), /When the evidence changes after the PR opened/, s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without a check-only lint, verify runs the fixing lint once after the loop; the audit lint row stays', () => {
  const noCheck = bootstrapRepo((p) => { p.stack.commands.lintCheck = ''; return p; });
  const def = bootstrapRepo();
  try {
    assert.ok(skillOf(noCheck.repo, 'skill-4-verify').includes('**After the loop:**'));
    assert.ok(!skillOf(def.repo, 'skill-4-verify').includes('**After the loop:**'));
    for (const r of [noCheck.repo, def.repo]) assert.match(skillOf(r, 'skill-4-verify'), /^\| 2 \| Lint and format \|/m);
  } finally {
    rmSync(noCheck.dir, { recursive: true, force: true });
    rmSync(def.dir, { recursive: true, force: true });
  }
});

test('render --vars lists CODEX_IN_VERIFY and REPORTING_RULES_AFTER_PR', () => {
  const r = node('render.mjs', ['--vars']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\bCODEX_IN_VERIFY\b/);
  assert.match(r.stdout, /\bREPORTING_RULES_AFTER_PR\b/);
});

test('the decision sheet lists each fixed Codex finding; "ran in verify" unless codexInVerify is false', () => {
  const def = bootstrapRepo();
  const civ = bootstrapRepo(civOn);
  const no = bootstrapRepo((p) => { p.pipeline.codexInVerify = false; return p; });
  try {
    const sheet = skillOf(def.repo, 'decision-sheet');
    assert.match(sheet, /ran in verify/);
    assert.ok(sheet.includes('A fixed finding is not a question'));
    assert.ok(sheet.includes('findings fixed (<file:line> — <one-line gist>, …)'));
    assert.match(skillOf(civ.repo, 'decision-sheet'), /ran in verify/);
    assert.doesNotMatch(skillOf(no.repo, 'decision-sheet'), /ran in verify/);
  } finally {
    for (const r of [def, civ, no]) rmSync(r.dir, { recursive: true, force: true });
  }
});

test('decision 3B: in "to PR" mode the decision sheet runs before the one commit, with --fix and a test gate', () => {
  const def = bootstrapRepo();
  const noCodex = bootstrapRepo((p) => { p.modules.codex = false; return p; });
  const noSheet = bootstrapRepo((p) => { p.modules['decision-sheet'] = false; return p; });
  try {
    const pipe = skillOf(def.repo, 'skill-auto-pipeline');
    const i5 = pipe.indexOf('5. **Decision sheet**'), i6 = pipe.indexOf('6. **Commit**');
    assert.ok(i5 >= 0 && i6 >= 0 && i5 < i6, `${i5} ${i6}`);
    const item5 = pipe.slice(i5, i6);
    for (const want of ['--fix', 'decision sheet: done', 'tree: <mark>', 'decision sheet: gate failed', 'FAILED: decision sheet', 'do not commit',
      'git log --format=%s <base>..HEAD', '**After the commit**', 'without `--fix`', 'DOCUMENTED', 'COMMITTED — READY TO PUSH', '- HH:MM:SS — ']) {
      assert.ok(item5.includes(want), want);
    }
    const commit = between(pipe, '6. **Commit**', '**commit mode:**');
    assert.ok(commit.includes('do item 5.2 (Which case)'));
    // a resume after the commit skips a sheet that is done; the sub-items never read as the Commit or Ship item
    assert.match(item5, /lists the plan's commit, and a Timeline entry, after its `- HH:MM:SS — ` prefix, starts with `decision sheet: done` → done; go to the Ship item/);
    for (const want of ['item 5.6 (After the commit)', 'item 5.7 (After a failed gate)', 'item 5.5 (Test gate)', 'the sheet names no file that its fixes touched', 'take the tree mark again']) {
      assert.ok(item5.includes(want), want);
    }
    assert.doesNotMatch(item5, /→ item [367] \(/);
    // the tree mark follows file contents (an edit inside an untracked file changes it), not only line counts
    assert.ok(item5.includes('git hash-object -- <path> <path> …'));
    // a new folder lists each file, so an edit inside it changes the mark
    assert.ok(item5.includes('git status --porcelain --untracked-files=all'));
    assert.ok(item5.includes('git hash-object <report dir>/<slug>-tree.txt'));
    assert.doesNotMatch(item5, /shortstat/);
    assert.ok(commit.includes("the decision sheet's fixes"));
    assert.ok(between(pipe, '**Resume:**', '## Report protocol').includes('Which case → After the commit'));
    assert.ok(readF(def.repo, '.codex/skills/validate-implementation/SKILL.md').includes('git ls-files --others --exclude-standard'));
    assert.match(readF(def.repo, 'AGENTS.md'), /`\/decision-sheet` \("to PR" mode\) → one commit for the whole plan/);
    assert.ok(readF(def.repo, 'AGENTS.md').includes('In "to PR" mode the pipeline runs it before the commit'));
    // codex off: the sheet runs without --fix
    assert.ok(!between(skillOf(noCodex.repo, 'skill-auto-pipeline'), '**Before the commit.**', '**No change**').includes('--fix'));
    // decision sheet off: no sheet text, the numbers stay
    const off = skillOf(noSheet.repo, 'skill-auto-pipeline');
    for (const bad of ['Decision sheet', 'decision sheet: done', "decision sheet's fixes", 'decision sheet']) assert.ok(!off.includes(bad), bad);
    assert.ok(off.includes('6. **Commit**'));
    assert.ok(off.includes('7. **Ship**'));
  } finally {
    for (const r of [def, noCodex, noSheet]) rmSync(r.dir, { recursive: true, force: true });
  }
});

test('the skill-5-ship browser-test rebuild of the sheet runs no second Codex review', () => {
  const { dir, repo } = bootstrapRepo(webUi);
  try {
    assert.match(skillOf(repo, 'skill-5-ship'), /build the sheet again first: read `\.claude\/skills\/decision-sheet\/SKILL\.md` and follow it with the same `--out` and `--no-codex`, and copy the Codex line and the Codex questions from the old sheet into the new one/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run-usage.mjs ships as a core script: executable, its self-test passes, a Commands row and allow rules', () => {
  const { dir, repo } = bootstrapRepo();
  try {
    for (const f of ['run-usage.mjs', 'run-usage.selftest.mjs']) {
      const p = path.join(repo, '.claude/scripts', f);
      assert.ok(existsSync(p), f);
      assert.ok(statSync(p).mode & 0o100, `${f} is not executable`);
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const t = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(repo, '.claude/scripts/run-usage.selftest.mjs')], { encoding: 'utf8', env });
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /^# fail 0$/m);
    assert.ok(Number(t.stdout.match(/^# pass (\d+)$/m)?.[1]) > 0, t.stdout);
    for (const f of ['AGENTS.md', 'README.md']) {
      assert.ok(readF(repo, f).includes('| Run usage (one pipeline run) | `node .claude/scripts/run-usage.mjs <run .log>` |'), f);
      assert.ok(readF(repo, f).includes('| Test run-usage.mjs | `node --test .claude/scripts/run-usage.selftest.mjs` |'), f);
    }
    const allow = JSON.parse(readF(repo, '.claude/settings.json')).permissions.allow;
    assert.ok(allow.includes('Bash(node .claude/scripts/run-usage.mjs *)'));
    assert.ok(allow.includes('Bash(node --test .claude/scripts/run-usage.selftest.mjs)'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('plan validation runs max 4 rounds with an early stop, with and without Codex', () => {
  const def = bootstrapRepo();
  const noCodex = bootstrapRepo((p) => { p.modules.codex = false; return p; });
  try {
    for (const r of [def.repo, noCodex.repo]) {
      const v = skillOf(r, 'skill-auto-validate-plan');
      assert.match(v, /^## Rounds \(max 4\)$/m);
      for (const want of ['Never run a fifth round', 'RAISED BEFORE (round <m>, F<id>)', '### e. Final edits check', 'READY (round 4 edits self-checked)',
        '**Accepted fix.**', '**Continue.**', 'Do not set a status', 'Raised before:', 'The first rule that matches wins', 'must not break what was correct',
        'step e does not end the loop', 'do not try a third time', 'one the owner deferred or answered with no plan change',
        // a blocking finding counts as an accepted fix only when its fix reached the plan
        'VALID or PARTIALLY VALID and you applied its fix to the plan',
        // after a rollback, the round snapshot is taken again, so the next diff does not show the rollback
        'Then take this round\'s snapshot again (`cp <plan-file> .plans/.validations/<plan-base>-pre-round-<n>.md`)',
        // the step a rollback restores the snapshot taken before the previous round's edits
        'cp .plans/.validations/<plan-base>-pre-round-<n-1>.md <plan-file>']) {
        assert.ok(v.includes(want), `${r}: ${want}`);
      }
      // the stop rules live in step d itself, not only in the final report
      const stepD = between(v, '### d. Continue or stop', '### e. Final edits check');
      for (const want of ['`k` = 4, round 4 had an accepted fix, and step e ran → `READY (round 4 edits self-checked)`',
        '`k` < 4 → run round `k+1`. Do not set a status']) {
        assert.ok(stepD.includes(want), `${r}: step d: ${want}`);
      }
      assert.doesNotMatch(v, /@@/);
      assert.doesNotMatch(v, /max 2 round/i);
      assert.doesNotMatch(v, /third round/);
      assert.ok(!v.includes('`k` < 2'));
      assert.ok(skillOf(r, 'skill-1-plan').includes('all rounds (max 4; most plans stop earlier)'));
      const agents = readF(r, 'AGENTS.md');
      assert.ok(agents.includes('(max 4 rounds; it stops after a round with no accepted fix and no open regression)'));
      assert.ok(!agents.includes('(max 2 rounds)'));
    }
    // only the Codex variant names an OFF validator in a READY status
    assert.ok(skillOf(def.repo, 'skill-auto-validate-plan').includes('READY (round 4 edits self-checked; <Codex|Claude> OFF)'));
    assert.ok(!skillOf(noCodex.repo, 'skill-auto-validate-plan').includes('<Codex|Claude> OFF'));
    const offRule = ['Never a plain `READY` then', 'Do not run one more round only to retry the OFF validator'];
    const defD = between(skillOf(def.repo, 'skill-auto-validate-plan'), '### d. Continue or stop', '### e. Final edits check');
    const noD = between(skillOf(noCodex.repo, 'skill-auto-validate-plan'), '### d. Continue or stop', '### e. Final edits check');
    for (const want of offRule) {
      assert.ok(defD.includes(want), want);
      assert.ok(!noD.includes(want), want);
    }
  } finally {
    rmSync(def.dir, { recursive: true, force: true });
    rmSync(noCodex.dir, { recursive: true, force: true });
  }
});

test('unusedParts offers codexInVerify only while the codex module is on and the setting is false', async () => {
  const { unusedParts } = await import('../skills/bootstrap-project/scripts/render.mjs');
  const base = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  const keys = (p) => unusedParts(p).map((i) => `${i.group}:${i.key}`);
  assert.equal(base().pipeline.codexInVerify, undefined);
  assert.ok(!keys(base()).includes('setting:codexInVerify'));
  const no = base();
  no.pipeline.codexInVerify = false;
  assert.ok(keys(no).includes('setting:codexInVerify'));
  const noCodex = base();
  noCodex.modules.codex = false;
  assert.match(unusedParts(noCodex).find((i) => i.key === 'codex').what, /the finished code in each verify round/);
  assert.ok(!keys(civOn(base())).includes('setting:codexInVerify'));
  const off = base();
  off.modules.codex = false;
  assert.ok(!keys(off).includes('setting:codexInVerify'));
});

test('a repo with submodules gets git -C <submodule> rules, and the checkout rule takes a plain sha and --detach', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-sub-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    writeFileSync(path.join(dir, '.gitmodules'), '[submodule "contracts"]\n\tpath = contracts\n\turl = https://example.test/contracts.git\n'
      + '[submodule "bad"]\n\tpath = has space\n\turl = https://example.test/bad.git\n');
    assert.deepEqual(render.submodulePaths(dir), ['contracts']);
    const params = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
    const allowOf = (repo) => JSON.parse(render.renderAll(params, { repo }).find((f) => f.path === '.claude/settings.json').content).permissions.allow;
    const allow = allowOf(dir);
    for (const v of ['fetch', 'status', 'rev-parse', 'log', 'merge-base', 'checkout', 'switch --detach']) assert.ok(allow.includes(`Bash(git -C contracts ${v}*)`), v);
    const matches = (cmd) => allow.some((a) => { const m = /^Bash\((.*)\*\)$/.exec(a); return m && cmd.startsWith(m[1]); });
    assert.ok(matches('git -C contracts checkout 52adfb603fdf948be14b7897cc6799a3df152e3f'));
    assert.ok(matches('git -C contracts checkout --detach 52adfb603fdf948be14b7897cc6799a3df152e3f'));
    assert.ok(!allow.some((a) => a.includes('has space')));
    rmSync(path.join(dir, '.gitmodules'));
    assert.ok(!allowOf(dir).some((a) => a.startsWith('Bash(git -C ')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
