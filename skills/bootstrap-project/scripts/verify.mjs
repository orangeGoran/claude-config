#!/usr/bin/env node
// verify.mjs — check a bootstrapped repo: the plans dashboard readiness checks plus the
// checks that a first headless run needs.
//
//   node verify.mjs <repo> [--registry <file>] [--json]
//
// Part 1 copies projectHealth() in claude-config scripts/plans-dashboard.mjs (pipeline
// mode). Keep the two in step: references/contracts.md, "Dashboard readiness checks".
// Part 2 checks what the dashboard does not: --describe JSON, plan-lanes JSON, the fixed
// skill names, deny vs the "to PR" overlay, .gitignore, executable bits, bash -n,
// node --check, leftover placeholders, and the "bare commands" rule in every skill.
//
// Exit code 0 when every required check passes, 1 otherwise. Tips never fail the run.
import { readFileSync, existsSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { checkParams, moduleOn } from './render.mjs';

const argv = process.argv.slice(2);
const opt = { json: false };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--registry') opt.registry = argv[++i];
  else if (argv[i] === '--json') opt.json = true;
  else pos.push(argv[i]);
}
if (!pos[0]) { console.error('usage: verify.mjs <repo> [--registry <file>] [--json]'); process.exit(2); }
const root = path.resolve(pos[0]);
const R = (...p) => path.join(root, ...p);
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const run = (cmd, args, o = {}) => {
  try { return { ok: true, out: execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, ...o }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message || e) }; }
};
// never follows symlinks (no loops, no dangling links) and skips build and vendor folders
const SKIP_DIRS = new Set(['node_modules', '.git', 'auto-runs', '.venv', 'venv', 'vendor', 'target', 'dist', 'build', '.build', 'coverage', 'Pods', 'DerivedData', '.next', '.turbo']);
const walk = (dir) => {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((n) => {
    if (SKIP_DIRS.has(n)) return [];
    const a = path.join(dir, n);
    let st;
    try { st = lstatSync(a); } catch { return []; }
    if (st.isSymbolicLink()) return [];
    return st.isDirectory() ? walk(a) : [a];
  });
};

const results = [];
// level: dash-required | dash-tip (the dashboard's own levels) | required | tip
const check = (id, level, label, ok, detail = '') => results.push({ id, level, label, ok: Boolean(ok), detail });

const params = readJson(R('.claude', 'bootstrap.json'));
const base = params?.git?.base || 'develop';

// ---------------------------------------------------------------------------
// Part 1: dashboard readiness (projectHealth, pipeline mode)
// ---------------------------------------------------------------------------
const plansDir = R('.plans');
const pipeline = R('.claude', 'scripts', 'auto-pipeline.sh');
const settings = readJson(R('.claude', 'settings.json'));
const allow = settings?.permissions?.allow || [];
const deny = settings?.permissions?.deny || [];
const skillDirs = existsSync(R('.claude', 'skills'))
  ? readdirSync(R('.claude', 'skills')).filter((d) => existsSync(R('.claude', 'skills', d, 'SKILL.md'))) : [];
const planCount = existsSync(plansDir) ? readdirSync(plansDir).filter((f) => f.endsWith('.md')).length : 0;

check('git', 'dash-required', 'Git repository', existsSync(R('.git')));
check('plansDir', 'dash-required', 'Plans folder', existsSync(plansDir), '.plans/');
check('plans', 'dash-tip', 'At least one plan', planCount > 0, `${planCount} plan(s) in .plans/`);
check('launch', 'dash-required', 'A way to launch plans', existsSync(pipeline), '.claude/scripts/auto-pipeline.sh');
check('modes', 'dash-tip', 'Modes and run state', /^\s*--describe\)/m.test(read(pipeline) || ''), '--describe) case');
check('allow', 'dash-tip', 'Permission allowlist', allow.length > 0, `${allow.length} allow rule(s)`);
check('skills', 'dash-tip', 'Project skills', skillDirs.length > 0, `${skillDirs.length} skill(s)`);
check('claudemd', 'dash-tip', 'CLAUDE.md', existsSync(R('CLAUDE.md')));

// ---------------------------------------------------------------------------
// Part 2: what a first run needs
// ---------------------------------------------------------------------------
// --describe must be valid JSON in the shape the dashboard accepts (plans-dashboard.mjs, pipelineModes)
{
  const r = existsSync(pipeline) ? run('bash', [pipeline, '--describe'], { timeout: 5000 }) : { ok: false, err: 'no script' };
  let ok = false, detail = r.err || '';
  if (r.ok) {
    try {
      const spec = JSON.parse(r.out);
      const modes = (spec.modes || []).filter((m) => m && /^[A-Za-z0-9._-]+$/.test(m.id || '') && /^--[a-z0-9-]+$/.test(m.flag || '') && typeof m.label === 'string');
      const ids = modes.map((m) => m.id);
      ok = modes.length === (spec.modes || []).length && ['verify', 'commit', 'pr'].every((m) => ids.includes(m)) && ids.includes(spec.default);
      detail = `default ${spec.default}; modes ${ids.join(', ')}`;
    } catch (e) { detail = 'not JSON: ' + e.message; }
  }
  check('describe', 'required', 'auto-pipeline.sh --describe gives valid JSON', ok, detail);
}
// plan-lanes: "⚡ All" refuses until every project has it; the JSON contract is in plans-dashboard.mjs (lanesFixPrompt)
{
  const f = R('.claude', 'scripts', 'plan-lanes.mjs');
  let ok = false, detail = 'missing';
  if (existsSync(f)) {
    const r = run(process.execPath, [f, '--json']);
    if (!r.ok) detail = r.err.split('\n')[0];
    else {
      try {
        const j = JSON.parse(r.out);
        const missing = ['schedulableCount', 'laneCount', 'maxParallel'].filter((k) => typeof j[k] !== 'number')
          .concat(['recommendedBatch', 'lanes', 'inFlight'].filter((k) => !Array.isArray(j[k])));
        ok = missing.length === 0;
        detail = ok ? `${j.schedulableCount} schedulable, ${j.laneCount} lane(s)` : 'missing fields: ' + missing.join(', ');
      } catch (e) { detail = 'not JSON: ' + e.message; }
    }
  }
  check('lanes', 'required', 'plan-lanes.mjs --json gives the lanes JSON', ok, detail);
}
// fixed skill names: the dashboard and vscode-session-copy.mjs match them as text
{
  const need = ['skill-1-plan', 'skill-validate-plan', 'skill-auto-validate-plan', 'apply-validation',
    'skill-2-implement', 'skill-3-test', 'skill-4-verify', 'skill-5-ship', 'skill-auto-pipeline'];
  const missing = need.filter((s) => !skillDirs.includes(s));
  const badName = skillDirs.filter((d) => !new RegExp(`^name:\\s*${d.replace(/[.]/g, '\\.')}\\s*$`, 'm').test(read(R('.claude', 'skills', d, 'SKILL.md')) || ''));
  check('skill-names', 'required', 'The workflow skills exist with the fixed names', !missing.length && !badName.length,
    [missing.length && 'missing: ' + missing.join(', '), badName.length && 'frontmatter name differs from folder: ' + badName.join(', ')].filter(Boolean).join('; ') || `${need.length} skills`);
  const noAuto = ['skill-5-ship', 'skill-auto-pipeline'].filter((s) => skillDirs.includes(s) && !/^disable-model-invocation:\s*true\s*$/m.test(read(R('.claude', 'skills', s, 'SKILL.md')) || ''));
  check('manual-only', 'required', 'skill-5-ship and skill-auto-pipeline run only on request', !noAuto.length, noAuto.length ? 'no disable-model-invocation: ' + noAuto.join(', ') : '');
  const pl = read(pipeline) || '';
  const vsc = read(R('.claude', 'scripts', 'vscode-session-copy.mjs')) || '';
  check('live-check', 'required', 'Run prompt matches the dashboard live check', /"\/skill-auto-pipeline \$plan_base /.test(pl) && vsc.includes("'/skill-auto-pipeline '"),
    'pgrep -f "skill-auto-pipeline <slug>.md"; vscode-session-copy.mjs');
  check('validator', 'required', 'plan-validator agent', existsSync(R('.claude', 'agents', 'plan-validator.md')));
}
// settings.json: complete on day one, and no deny rule that blocks the "to PR" overlay
{
  check('settings', 'required', 'settings.json: $schema and no AI attribution',
    settings && settings.$schema && settings.attribution?.commit === '' && settings.attribution?.pr === '',
    settings ? '' : 'missing or not JSON');
  const glob = (rule) => {
    const m = rule.match(/^Bash\((.*)\)$/);
    if (!m) return null;
    const pat = m[1].replace(/:\*$/, '*');
    return new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  };
  const overlay = [`git fetch origin ${base}`, `git merge --no-edit origin/${base}`, 'git push -u origin auto/x', 'git push origin auto/x',
    'gh pr create --draft --base x --title y --body-file z', 'gh pr edit 1 --add-label no-changelog', 'gh pr view 1', 'git add x', 'git commit -m x', 'git mv a b'];
  const blocked = overlay.filter((c) => deny.some((d) => glob(d)?.test(c)));
  check('deny-overlay', 'required', 'No deny rule blocks the run or "to PR" overlay', !blocked.length,
    blocked.length ? 'blocked: ' + blocked.join('; ') : `${deny.length} deny rule(s)`);
  const pushAllow = allow.filter((a) => /^Bash\((git push|gh pr create|gh pr merge)/.test(a));
  check('push-allow', 'required', 'No push or PR rule in the shared allow list', !pushAllow.length, pushAllow.join(', '));
  const localAllow = readJson(R('.claude', 'settings.local.json'))?.permissions?.allow || [];
  const localPush = localAllow.filter((a) => /^Bash\((git push|gh pr create)/.test(a));
  check('push-local', 'tip', 'No push rule in settings.local.json (the launcher replays it)', !localPush.length, localPush.join(', '));
}
// .gitignore
{
  const gi = (read(R('.gitignore')) || '').split('\n').map((l) => l.trim());
  const need = ['.plans/auto-runs/', '.claude/settings.local.json', '.plans/.validations/*-pre-round-*.md'];
  // with bootstrap.json the module switches decide; without it, the files that exist
  const on = (m, file) => (params ? moduleOn(params, m) : existsSync(file));
  if (on('step-gate', R('.claude', 'scripts', 'workflow-guard.sh'))) need.push('.plans/.workflow-state/');
  if (on('test-review', R('.claude', 'skills', 'test-review'))) need.push('.plans/.test-review/');
  if (on('decision-sheet', R('.claude', 'skills', 'decision-sheet'))) need.push('.plans/.decision-sheets/');
  const missing = need.filter((l) => !gi.includes(l));
  check('gitignore', 'required', '.gitignore has the run-state lines', !missing.length, missing.length ? 'missing: ' + missing.join(', ') : '');
  const tracked = run('git', ['ls-files', '.claude/settings.local.json', '.plans/auto-runs']);
  check('not-tracked', 'required', 'settings.local.json and auto-runs/ are not tracked', tracked.ok && !tracked.out.trim(), tracked.out.trim());
}
// scripts: executable bits, bash -n, node --check
{
  const scripts = walk(R('.claude', 'scripts'));
  const notExec = scripts.filter((f) => /\.(sh|mjs)$/.test(f) && !(statSync(f).mode & 0o111)).map((f) => path.relative(root, f));
  check('exec-bits', 'required', 'Scripts are executable', !notExec.length, notExec.join(', ') || `${scripts.length} script(s)`);
  const shBad = scripts.filter((f) => f.endsWith('.sh')).filter((f) => !run('bash', ['-n', f]).ok).map((f) => path.relative(root, f));
  check('bash-n', 'required', 'bash -n passes', !shBad.length, shBad.join(', '));
  const mjsBad = scripts.filter((f) => f.endsWith('.mjs')).filter((f) => !run(process.execPath, ['--check', f]).ok).map((f) => path.relative(root, f));
  check('node-check', 'required', 'node --check passes', !mjsBad.length, mjsBad.join(', '));
}
// leftover template placeholders anywhere the bootstrap writes
{
  const files = [...['AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore', '.editorconfig'].map((f) => R(f)).filter(existsSync),
    ...walk(R('.claude')), ...walk(R('.codex')), ...walk(R('.github')), ...walk(R('changelog.d')),
    ...walk(R('.plans')).filter((f) => f.endsWith('.md'))];
  const hits = files.filter((f) => /@@[A-Z][A-Z0-9_ ]*@@/.test(read(f) || '')).map((f) => path.relative(root, f));
  check('placeholders', 'required', 'No leftover template placeholders', !hits.length, hits.join(', ') || `${files.length} file(s) scanned`);
}
// every skill tells a headless run to use bare commands
{
  const skills = [...walk(R('.claude', 'skills')), ...walk(R('.codex', 'skills'))].filter((f) => f.endsWith('SKILL.md'));
  const miss = skills.filter((f) => !/\bbare\b/i.test(read(f) || '')).map((f) => path.relative(root, f));
  check('bare-commands', 'required', 'Every skill says "run bare commands, one per call"', !miss.length, miss.join(', ') || `${skills.length} skill(s)`);
}
// instruction files: CLAUDE.md is only @AGENTS.md, next to every AGENTS.md
{
  const agents = walk(root).filter((f) => path.basename(f) === 'AGENTS.md');
  const bad = agents.filter((a) => (read(path.join(path.dirname(a), 'CLAUDE.md')) || '').trim() !== '@AGENTS.md').map((f) => path.relative(root, f));
  check('instructions', 'required', 'Each AGENTS.md has a CLAUDE.md shim (@AGENTS.md)', agents.length && !bad.length, bad.length ? 'no shim: ' + bad.join(', ') : `${agents.length} AGENTS.md`);
}
// the answers file
{
  const errs = params ? checkParams(params) : ['missing'];
  check('bootstrap-json', 'required', '.claude/bootstrap.json is valid', !errs.length, errs.join('; '));
}
// tips: tools, the tooling on origin/<base>, the registry entry
{
  const has = (c) => run('sh', ['-c', `command -v ${c}`]).ok;
  check('tools', 'tip', 'claude and jq on PATH', has('claude') && has('jq'));
  const remote = run('git', ['remote', 'get-url', 'origin']);
  const pushed = remote.ok && run('git', ['cat-file', '-e', `origin/${base}:.claude/skills/skill-auto-pipeline/SKILL.md`]).ok;
  // a worktree install creates an untracked lock file when none is committed; ship then stops (tree not clean)
  const manifest = params?.stack?.manifest || 'package.json';
  const locks = params?.stack?.lockfiles || [];
  if (params?.stack?.installCmd && existsSync(R(manifest)) && locks.length) {
    const tracked = run('git', ['ls-files', '--', ...locks]);
    check('lockfile', 'tip', 'The lock file is committed (run the install once, then git add it)', tracked.ok && tracked.out.trim(), locks.join(', '));
  }
  check('pushed', 'tip', `Tooling is on origin/${base} (a launch needs it)`, pushed, remote.ok ? 'push it, then git fetch' : 'no origin remote yet');
  const regFile = opt.registry ? path.resolve(opt.registry) : path.join(homedir(), '.claude', 'pipeline-projects.json');
  const reg = readJson(regFile);
  const entry = (reg?.projects || []).find((x) => path.resolve((x.root || '').replace(/^~(?=\/|$)/, homedir())) === root);
  check('registered', 'tip', 'Registered in the plans dashboard (pipeline mode, launchers: [])', entry && Array.isArray(entry.launchers) && entry.launchers.length === 0,
    entry ? `as "${entry.name}"` : `not in ${regFile.replace(homedir(), '~')}`);
}

// ---------------------------------------------------------------------------
const dashFail = results.filter((r) => !r.ok && r.level === 'dash-required');
const dashTips = results.filter((r) => !r.ok && r.level === 'dash-tip');
const dashLevel = dashFail.length ? 'red (needs setup)' : dashTips.length ? 'amber (ready with tips)' : 'green (ready)';
const failed = results.filter((r) => !r.ok && (r.level === 'required' || r.level === 'dash-required'));

if (opt.json) {
  console.log(JSON.stringify({ root, dashboard: dashLevel, failed: failed.map((r) => r.id), results }, null, 2));
} else {
  const mark = (r) => (r.ok ? 'PASS' : r.level.endsWith('tip') ? 'TIP ' : 'FAIL');
  console.log(`Repo: ${root}\n`);
  console.log('Dashboard readiness (projectHealth, pipeline mode):');
  for (const r of results.filter((x) => x.level.startsWith('dash'))) console.log(`  ${mark(r)}  ${r.id.padEnd(16)} ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`  => dashboard level: ${dashLevel}\n`);
  console.log('Run readiness:');
  for (const r of results.filter((x) => !x.level.startsWith('dash'))) console.log(`  ${mark(r)}  ${r.id.padEnd(16)} ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`\n${failed.length ? `${failed.length} required check(s) failed.` : 'All required checks pass.'}`);
}
process.exit(failed.length ? 1 : 0);
