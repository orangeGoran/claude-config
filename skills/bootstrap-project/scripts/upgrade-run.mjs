#!/usr/bin/env node
// upgrade-run.mjs — upgrade the bootstrap-project scaffolding of one repo with no chat, and
// end in a draft PR. The plans dashboard starts it from the "bootstrap update" chip.
//
//   node upgrade-run.mjs <repo> [--no-push]
//
// What it does, in order (the status file names the last step that started):
//   prepare  take the lock, fetch origin/<base>, find the template hash, make the worktree
//            <parent of repo>/worktrees/<repo name>/bootstrap-upgrade-<hash> on the branch
//            auto/bootstrap-upgrade-<hash>, or continue a branch that an earlier run left
//   render   render.mjs --upgrade into a private work folder
//   claude   copy each changed file (the repo version and the rendered version) into a run
//            folder as numbered files, and run a headless Claude session there:
//            /bootstrap-project --upgrade --unattended <run folder>/task.json
//   apply    check decisions.json, write the new, replaced and merged files into the worktree
//   verify   verify.mjs before and after the apply; a check that newly fails fails the run
//   commit   one commit (the project's git hooks run)
//   push, pr push the branch and open a draft PR (skipped with --no-push)
//
// What it writes in <repo>/.plans/auto-runs/ (gitignored):
//   bootstrap-upgrade.lock                one line <pid> while the run is live
//   bootstrap-upgrade.json                the run status (references/contracts.md)
//   bootstrap-upgrade-pr-body-<hash>.md   the PR body, written right before the commit
//   bootstrap-upgrade.log                 the output of this script and of the Claude session
//
// The main checkout is never written, except these files. The script never pushes the base
// branch and never force-pushes.
//
// Exit code 0 when the run is done or there is nothing to do, 1 when it failed or is locked.
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, openSync, writeSync, closeSync,
  copyFileSync, chmodSync, lstatSync, readdirSync, rmSync, unlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExecutable, moduleOn, baseBranch } from './render.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(SKILL_DIR, 'scripts', 'render.mjs');
const VERIFY = path.join(SKILL_DIR, 'scripts', 'verify.mjs');
const CLAUDE_TIMEOUT_MS = 45 * 60 * 1000;
const DECISIONS = ['merge', 'keep', 'replace'];
const PLACEHOLDER = /@@[A-Z][A-Z0-9_ ]*@@/;
const PR_TITLE = 'chore(claude): upgrade the bootstrap-project scaffolding';

/** Runs a program and gives `{ status, stdout, stderr }`. It never throws. */
export function run(cmd, args, cwd, opts = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) return { status: null, stdout: '', stderr: r.error.message };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const cmdName = (cmd, args) => [cmd === process.execPath ? 'node' : cmd,
  ...args.slice(0, 4).map((a) => (path.isAbsolute(a) ? path.basename(a) : a))].join(' ');

/** Runs a program and gives its stdout. It throws an Error with the command and stderr when the exit code is not 0. */
export function must(cmd, args, cwd, opts = {}) {
  const r = run(cmd, args, cwd, opts);
  if (r.status !== 0) throw new Error(`${cmdName(cmd, args)} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-5).join(' ')}`);
  return r.stdout;
}

/** Removes secrets and personal data from a text (the scout redact() patterns plus credentials in a URL). It does not cut the text. */
export const redactText = (s) => String(s ?? '')
  .replace(/:\/\/[^\s/@]+@/g, '://<redacted>@')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
  .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>')
  .replace(/\b(Bearer|token|key|secret|password)([=: ]+)\S+/gi, '$1$2<redacted>');

/** Removes secrets and personal data from an error text and cuts it to 500 characters. */
export const redactError = (s) => redactText(s).slice(0, 500);

const runsDir = (repo) => path.join(repo, '.plans', 'auto-runs');
const lockFile = (repo) => path.join(runsDir(repo), 'bootstrap-upgrade.lock');
const statusFile = (repo) => path.join(runsDir(repo), 'bootstrap-upgrade.json');
const logFile = (repo) => path.join(runsDir(repo), 'bootstrap-upgrade.log');
const bodyFile = (repo, hash) => path.join(runsDir(repo), `bootstrap-upgrade-pr-body-${hash}.md`);
const bodyMark = (hash) => `<!-- bootstrap-upgrade ${hash} -->`;
const now = () => new Date().toISOString();

/** Merges `patch` into the status file (or replaces it when `fresh`). `error` always goes through redactError(). */
export function writeStatus(repo, patch, fresh = false) {
  let cur = {};
  if (!fresh) { try { cur = JSON.parse(readFileSync(statusFile(repo), 'utf8')); } catch {} }
  const next = { ...cur, ...patch };
  if (next.error != null) next.error = redactError(next.error);
  writeFileSync(statusFile(repo), JSON.stringify(next, null, 2) + '\n');
}

/** Gives the SHA of the branch on origin, or '' when origin has no such branch. It throws when git fails or prints something else. */
export function remoteBranchSha(repo, branch) {
  const out = must('git', ['-C', repo, 'ls-remote', '--heads', 'origin', 'refs/heads/' + branch], repo).trim();
  if (!out) return '';
  const m = out.match(/^([0-9a-f]{40})\trefs\/heads\/(\S+)$/);
  if (!m || m[2] !== branch) throw new Error(`git ls-remote printed an unexpected line: ${out.split('\n')[0]}`);
  return m[1];
}

const git = (cwd, ...args) => run('git', ['-C', cwd, ...args], cwd);
const listedWorktrees = (repo) => must('git', ['-C', repo, 'worktree', 'list', '--porcelain'], repo)
  .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
const localBranchExists = (repo, branch) => git(repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + branch).status === 0;

/** Removes the worktree (when git lists it) and the local branch. Used only for the run's own worktree and branch. */
function dropWorktree(repo, wt, branch) {
  if (listedWorktrees(repo).includes(wt)) git(repo, 'worktree', 'remove', '--force', wt);
  if (localBranchExists(repo, branch)) git(repo, 'branch', '-D', branch);
}

/** Makes sure the local branch has its worktree at `wt`. */
function ensureWorktree(repo, wt, branch, fromRemote) {
  if (listedWorktrees(repo).includes(wt)) return;
  if (existsSync(wt)) throw new Error(`the folder ${wt} is not a worktree of this repo: look at it and remove it by hand`);
  if (localBranchExists(repo, branch)) must('git', ['-C', repo, 'worktree', 'add', wt, branch], repo);
  else if (fromRemote) must('git', ['-C', repo, 'worktree', 'add', '--track', '-b', branch, wt, 'origin/' + branch], repo);
  else throw new Error(`the branch ${branch} is gone`);
}

/** Reads the PRs of a branch through the GitHub REST API, as the dashboard reads them. State: OPEN, MERGED or CLOSED. */
function branchPrs(repo, branch) {
  try {
    const owner = must('gh', ['repo', 'view', '--json', 'owner', '--jq', '.owner.login'], repo).trim();
    const list = JSON.parse(must('gh', ['api', `repos/{owner}/{repo}/pulls?state=all&head=${owner}:${branch}`], repo));
    if (!Array.isArray(list)) throw new Error('the PR list is not a list');
    return list.map((p) => ({ number: p.number, url: p.html_url,
      state: p.state === 'open' ? 'OPEN' : p.merged_at ? 'MERGED' : 'CLOSED' }));
  } catch (e) {
    throw new Error(`gh cannot see this repo's PRs: run gh auth status (${e.message})`);
  }
}

/**
 * Adds the label no-changelog when the changelog module is on. When that fails, the PR body gets
 * an owner checkbox. Gives null, or a note for the status `error` when the owner must add the
 * label by hand and the body could not tell them.
 */
function labelRule(ctx, number) {
  if (!moduleOn(ctx.params, 'changelog')) return null;
  if (run('gh', ['pr', 'edit', String(number), '--add-label', 'no-changelog'], ctx.repo).status === 0) return null;
  const note = `add the label no-changelog to PR #${number} by hand: gh could not add it, and could not put the checkbox into the PR body`;
  const file = bodyFile(ctx.repo, ctx.hash);
  // start from the body that GitHub has: the owner may have edited it, and a run whose saved body
  // is gone (a crash, another machine) has none. Only when gh cannot read it, use the saved body.
  const r = run('gh', ['pr', 'view', String(number), '--json', 'body', '--jq', '.body'], ctx.repo);
  if (r.status === 0 && r.stdout.trim()) writeFileSync(file, r.stdout);
  else if (!existsSync(file)) return note;
  const line = '- [ ] add the label `no-changelog`';
  const head = '## Questions for the owner\n\n';
  const text = readFileSync(file, 'utf8');
  // an empty list says "None.": the checkbox takes its place; a body with no list gets one at the end
  const next = text.includes(line) ? text
    : text.includes(head + 'None.\n') ? text.replace(head + 'None.\n', `${head}${line}\n`)
      : text.includes(head) ? text.replace(head, `${head}${line}\n`)
        : `${text.replace(/\n*$/, '\n')}\n${head}${line}\n`;
  if (next !== text) writeFileSync(file, next);
  return run('gh', ['pr', 'edit', String(number), '--body-file', file], ctx.repo).status === 0 ? null : note;
}

/** The saved PR body of a resumed run must exist and name this hash. */
function checkBody(repo, hash) {
  const file = bodyFile(repo, hash);
  const first = existsSync(file) ? readFileSync(file, 'utf8').split('\n')[0] : '';
  if (first !== bodyMark(hash)) throw new Error('the branch has commits but no saved PR body: open the PR by hand or delete the branch');
}

/** Pushes the branch (when `push`) and opens the draft PR, then writes status `pr`. */
function publish(ctx, push) {
  const { repo, wt, branch, base, hash } = ctx;
  writeStatus(repo, { step: 'push' });
  if (push) must('git', ['-C', wt, 'push', '-u', 'origin', branch], wt);
  writeStatus(repo, { step: 'pr' });
  const out = must('gh', ['pr', 'create', '--draft', '--base', base, '--head', branch, '--title', PR_TITLE,
    '--body-file', bodyFile(repo, hash)], repo);
  const url = out.trim().split('\n').reverse().find((l) => /^https?:\/\/\S+\/\d+$/.test(l.trim()))?.trim();
  if (!url) throw new Error('gh pr create printed no PR URL');
  const number = Number(url.split('/').pop());
  const note = labelRule(ctx, number);
  writeStatus(repo, { state: 'pr', pr: { number, url }, error: note, endedAt: now() });
  console.log(`upgrade PR #${number}: ${url}`);
  if (note) console.error('upgrade-run: ' + note);
  return 0;
}

/**
 * Checks decisions.json of the run folder against the changed files of the render. It gives the
 * decisions, or throws with the problem. Nothing is written.
 */
export function checkDecisions(runDir, changed) {
  let d;
  try { d = JSON.parse(readFileSync(path.join(runDir, 'decisions.json'), 'utf8')); }
  catch (e) { throw new Error(`decisions.json is missing or not JSON: ${e.message}`); }
  if (!d || !Array.isArray(d.files)) throw new Error('decisions.json has no files list');
  const want = changed.map((c) => c.path);
  const seen = new Set();
  for (const f of d.files) {
    if (!f || typeof f.path !== 'string') throw new Error('decisions.json has a file entry with no path');
    if (seen.has(f.path)) throw new Error(`decisions.json names ${f.path} twice`);
    seen.add(f.path);
    if (!want.includes(f.path)) throw new Error(`decisions.json names ${f.path}, which is not a changed file`);
    if (!DECISIONS.includes(f.decision)) throw new Error(`decisions.json: ${f.path} has the decision "${f.decision}" (merge, keep or replace)`);
  }
  const missing = want.filter((p) => !seen.has(p));
  if (missing.length) throw new Error(`decisions.json has no decision for ${missing.join(', ')}`);
  const mergedDir = path.join(runDir, 'merged');
  // no merged/ folder is the same as an empty one (every decision is keep or replace)
  let entries = [], dirStat = null;
  try { dirStat = lstatSync(mergedDir); } catch {}
  if (dirStat) {
    if (!dirStat.isDirectory()) throw new Error('merged/ is not a real folder (a symlink or a file)');
    entries = readdirSync(mergedDir);
  }
  const nOf = (p) => changed.find((c) => c.path === p).n;
  const mergeNs = d.files.filter((f) => f.decision === 'merge').map((f) => String(nOf(f.path)));
  for (const n of mergeNs) {
    let st;
    try { st = lstatSync(path.join(mergedDir, n)); } catch { throw new Error(`merged/${n} is missing (${changed[n - 1].path} is a merge)`); }
    if (!st.isFile()) throw new Error(`merged/${n} is not a regular file (a symlink or a folder)`);
    if (PLACEHOLDER.test(readFileSync(path.join(mergedDir, n), 'utf8'))) throw new Error(`merged/${n} (${changed[n - 1].path}) has a leftover template placeholder`);
  }
  const extra = entries.filter((e) => !mergeNs.includes(e));
  if (extra.length) throw new Error(`merged/ holds files that no merge entry names: ${extra.join(', ')}`);
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    files: d.files.map((f) => ({ path: f.path, decision: f.decision, added: list(f.added).map(String), kept: list(f.kept).map(String), dropped: list(f.dropped).map(String) })),
    templateUpdates: list(d.templateUpdates).filter((t) => t && typeof t === 'object'),
    questions: list(d.questions).map(String),
  };
}

/**
 * Gives the first repo path that the apply would write through a symlink (the file itself, or a
 * folder above it inside the worktree), or null. A write through a symlink can land outside the worktree.
 */
export function symlinkedPath(wt, paths) {
  for (const p of paths) {
    const parts = p.split('/');
    for (let i = parts.length; i > 0; i--) {
      let st = null;
      try { st = lstatSync(path.join(wt, ...parts.slice(0, i))); } catch {}
      if (st && st.isSymbolicLink()) return p;
    }
  }
  return null;
}

/** Runs verify.mjs --json and gives the ids of the required checks that fail. */
function verifyFailed(wt) {
  const r = run(process.execPath, [VERIFY, wt, '--json'], wt);
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if ((r.status !== 0 && r.status !== 1) || !out || !Array.isArray(out.failed))
    throw new Error(`verify.mjs could not run (exit ${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`);
  return out.failed;
}

/** Runs the headless Claude session in the run folder and waits for its exit. */
function runClaude(repo, runDir) {
  return new Promise((resolve, reject) => {
    const fd = openSync(logFile(repo), 'a');
    writeSync(fd, `\n=== bootstrap upgrade, Claude session, ${now()} ===\n`);
    const child = spawn('claude', ['-p', `/bootstrap-project --upgrade --unattended ${path.join(runDir, 'task.json')}`,
      '--permission-mode', 'acceptEdits',
      '--disallowedTools', 'Bash', 'WebFetch', 'WebSearch',
      '--strict-mcp-config',
      '--verbose', '--output-format', 'stream-json'],
    { cwd: runDir, env: { ...process.env, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' }, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, CLAUDE_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude could not start: ${e.message}`)); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('the Claude session timed out'));
      else if (code !== 0) reject(new Error(`the Claude session failed (exit ${code ?? signal}); see ${logFile(repo)}`));
      else resolve();
    });
  });
}

const cell = (xs) => (Array.isArray(xs) ? xs : [xs]).map((x) => redactText(x).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')).join('; ') || '—';

/** Builds the PR body. The text that Claude wrote goes through redactText(). */
export function prBody({ hash, slug, files, changed, decisions, alreadyFailing, replaces = null }) {
  const dec = new Map(decisions.files.map((f) => [f.path, f]));
  const count = (d) => decisions.files.filter((f) => f.decision === d).length;
  const newFiles = files.filter((f) => f.status === 'new' || f.status === 'merge');
  const orphans = files.filter((f) => f.status === 'orphan');
  // a CONFIG line can hold a value that must not reach a PR (a token, an email): redact it too
  const config = files.flatMap((f) => (f.diff || []).map((d) => ({ path: f.path, line: redactText(d).replace(/`/g, "'") })));
  const questions = [
    ...decisions.questions.map((q) => redactText(q).replace(/\s*\n\s*/g, ' ')),
    ...orphans.map((f) => `Not deleted: \`${f.path}\` (${f.note || 'its module is off'}). Delete it by hand, or keep it?`),
    ...config.map((c) => `CONFIG in \`${c.path}\` differs from the answers: \`${c.line}\`. Keep your value, or take the answers (\`render.mjs --reset-config --apply ${c.path}\`)?`),
    ...alreadyFailing.map((id) => `The verify check \`${id}\` already failed before the upgrade: fix it in a follow-up?`),
    // the templates changed while an older upgrade PR was open: both change the same files
    ...(replaces && replaces.hash !== hash ? [`This PR replaces upgrade PR #${replaces.number} (template hash \`${replaces.hash}\`): close #${replaces.number} without a merge.`] : []),
  ];
  const L = [bodyMark(hash), '', '## TLDR', '',
    `This PR upgrades the bootstrap-project scaffolding to the template hash \`${hash}\`: ${count('replace')} replaced, ${count('merge')} merged, ${count('keep')} kept, ${newFiles.length} new.`, ''];
  L.push('## Changed files', '');
  if (changed.length) {
    L.push('| File | Decision | What moved in | Project text kept | Dropped |', '| --- | --- | --- | --- | --- |');
    for (const c of changed) {
      const d = dec.get(c.path);
      L.push(`| \`${c.path}\` | ${d.decision} | ${cell(d.added)} | ${cell(d.kept)} | ${cell(d.dropped)} |`);
    }
  } else L.push('None.');
  L.push('', '## New files', '', ...(newFiles.length ? newFiles.map((f) => `- \`${f.path}\`${f.status === 'merge' ? ' (merged lines)' : ''}`) : ['None.']));
  L.push('', '## CONFIG lines that differ', '', ...(config.length ? config.map((c) => `- \`${c.path}\`: \`${c.line}\``) : ['None.']));
  L.push('', '## Not deleted', '', ...(orphans.length ? orphans.map((f) => `- \`${f.path}\``) : ['None.']));
  L.push('', '## Template updates', '', ...(decisions.templateUpdates.length
    ? decisions.templateUpdates.map((t) => `- \`${cell(t.path)}\`: ${cell(t.feature)} (${cell(t.why)})`) : ['None.']));
  L.push('', '## Questions for the owner', '', ...(questions.length ? questions.map((q) => `- [ ] ${q}`) : ['None.']));
  L.push('', '## Verify', '', alreadyFailing.length
    ? `\`verify.mjs\`: no check fails because of the upgrade. Already failing before the upgrade: ${alreadyFailing.map((i) => `\`${i}\``).join(', ')}.`
    : '`verify.mjs`: every required check passes.');
  L.push('', '## After the merge', '',
    `Run \`bash .claude/scripts/auto-pipeline.sh --cleanup ${slug}\`; when it cannot delete the branch after a squash merge, run \`git branch -D auto/${slug}\`.`, '');
  return L.join('\n');
}

/** Steps 4–10: render, Claude, apply, verify, commit. Gives the exit code. */
async function upgradeInWorktree(ctx, opt) {
  const { repo, wt, branch, hash, slug } = ctx;
  let committed = false, ok = false;
  let workDir = null, runDir = null;
  const cleanDirs = () => {
    for (const d of [workDir, runDir]) if (d) rmSync(d, { recursive: true, force: true });
  };
  try {
    writeStatus(repo, { step: 'render' });
    workDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'bootstrap-upgrade-work-')));
    runDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'bootstrap-upgrade-run-')));
    writeStatus(repo, { runDir });
    const files = JSON.parse(must(process.execPath, [RENDER, wt, '--upgrade', '--json', '--stage', path.join(workDir, 'stage')], wt)).files;
    const changed = files.filter((f) => f.status === 'changed').map((f, i) => ({ ...f, n: i + 1 }));
    const todo = files.filter((f) => ['changed', 'new', 'merge'].includes(f.status));
    if (!todo.length && ctx.saved === hash) {
      dropWorktree(repo, wt, branch);
      writeStatus(repo, { state: 'same', error: null, endedAt: now() });
      ok = true;
      console.log('nothing to upgrade');
      return 0;
    }
    const linked = symlinkedPath(wt, todo.map((f) => f.path));
    if (linked) throw new Error(`${linked} is a symlink or lies under one: the upgrade does not write through a symlink; upgrade this file by hand`);

    let decisions = { files: [], templateUpdates: [], questions: [] };
    if (changed.length) {
      writeStatus(repo, { step: 'claude' });
      for (const sub of ['current', 'stage', 'refs']) mkdirSync(path.join(runDir, sub));
      for (const c of changed) {
        copyFileSync(path.join(wt, c.path), path.join(runDir, 'current', String(c.n)));
        copyFileSync(path.join(workDir, 'stage', c.path), path.join(runDir, 'stage', String(c.n)));
      }
      for (const r of ['unattended.md', 'lessons.md']) copyFileSync(path.join(SKILL_DIR, 'references', r), path.join(runDir, 'refs', r));
      const task = {
        changed: changed.map((c) => ({ n: c.n, path: c.path, current: `current/${c.n}`, stage: `stage/${c.n}`, merged: `merged/${c.n}`, note: c.note || '', diff: c.diff || [] })),
        orphans: files.filter((f) => f.status === 'orphan').map((f) => f.path),
      };
      writeFileSync(path.join(runDir, 'task.json'), JSON.stringify(task, null, 2) + '\n');
      const before = must('git', ['-C', wt, 'status', '--porcelain', '--ignored'], wt);
      await runClaude(repo, runDir);
      const after = must('git', ['-C', wt, 'status', '--porcelain', '--ignored'], wt);
      if (after !== before) throw new Error('the Claude session changed the worktree: it may write only in the run folder');
      writeStatus(repo, { step: 'apply' });
      decisions = checkDecisions(runDir, changed);
    }

    writeStatus(repo, { step: 'verify' });
    const failedBefore = verifyFailed(wt);

    writeStatus(repo, { step: 'apply' });
    const dec = new Map(decisions.files.map((f) => [f.path, f.decision]));
    const list = [...files.filter((f) => f.status === 'new' || f.status === 'merge').map((f) => f.path),
      ...changed.filter((c) => dec.get(c.path) === 'replace').map((c) => c.path)];
    must(process.execPath, [RENDER, wt, '--upgrade', '--stage', path.join(workDir, 'stage-apply'), '--apply', list.length ? list.join(',') : 'new'], wt);
    const merged = changed.filter((c) => dec.get(c.path) === 'merge');
    for (const c of merged) {
      const dest = path.join(wt, c.path);
      copyFileSync(path.join(runDir, 'merged', String(c.n)), dest);
      if (isExecutable(c.path)) chmodSync(dest, 0o755);
    }

    writeStatus(repo, { step: 'verify' });
    const failedAfter = verifyFailed(wt);
    const broken = failedAfter.filter((id) => !failedBefore.includes(id));
    if (broken.length) throw new Error(`verify.mjs fails after the upgrade: ${broken.join(', ')}`);
    const alreadyFailing = failedAfter.filter((id) => failedBefore.includes(id));

    writeStatus(repo, { step: 'commit' });
    must('git', ['-C', wt, 'add', '--', ...list, ...merged.map((c) => c.path), '.claude/bootstrap.json'], wt);
    if (git(wt, 'diff', '--cached', '--quiet').status === 0) {
      dropWorktree(repo, wt, branch);
      writeStatus(repo, { state: 'same', error: null, endedAt: now() });
      ok = true;
      console.log('nothing to commit: the upgrade changes no file');
      return 0;
    }
    writeFileSync(bodyFile(repo, hash), prBody({ hash, slug, files, changed, decisions, alreadyFailing, replaces: ctx.replaces }));
    must('git', ['-C', wt, 'commit', '-m', `${PR_TITLE} (${hash})`], wt);
    committed = true;
    if (opt.noPush) {
      writeStatus(repo, { state: 'committed', error: null, endedAt: now() });
      ok = true;
      console.log(`committed on ${branch} in ${wt}`);
      return 0;
    }
    const code = publish(ctx, true);
    ok = true;
    return code;
  } catch (e) {
    // after the commit the worktree stays for a retry, and the run folder is of no more use
    if (committed) throw e;
    // a failed cleanup must not hide the real error
    try { dropWorktree(repo, wt, branch); } catch {}
    throw new Error(`${runDir ? runDir + ': ' : ''}${e.message}`);
  } finally {
    if (ok || committed) cleanDirs();
    else if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

/** The whole run after the lock is taken. Gives the exit code. */
async function upgrade(repo, opt) {
  const startedAt = now();
  // the PR of the last run, kept across failed runs: a PR for a newer hash names it in its body
  let replaces = null;
  try {
    const prev = JSON.parse(readFileSync(statusFile(repo), 'utf8'));
    const p = prev.state === 'pr' && prev.pr ? { number: prev.pr.number, hash: prev.hash } : prev.replaces;
    if (p && Number.isInteger(p.number) && typeof p.hash === 'string') replaces = { number: p.number, hash: p.hash };
  } catch {}
  writeStatus(repo, { state: 'running', step: 'prepare', hash: null, base: null, branch: null, worktree: null, runDir: null,
    pid: process.pid, pr: null, error: null, startedAt, endedAt: null, replaces }, true);
  try {
    const paramsFile = path.join(repo, '.claude', 'bootstrap.json');
    let paramsText, params;
    try { paramsText = readFileSync(paramsFile, 'utf8'); params = JSON.parse(paramsText); }
    catch (e) { throw new Error(`cannot read .claude/bootstrap.json: ${e.message}`); }
    const base = baseBranch(params);
    // a name that starts with "-" would reach git as an option
    if (base.startsWith('-')) throw new Error(`git.base "${base}" is not a branch name`);
    writeStatus(repo, { base });
    must('git', ['-C', repo, 'fetch', 'origin', base], repo);
    const baseSha = must('git', ['-C', repo, 'rev-parse', '--verify', `origin/${base}^{commit}`], repo).trim();
    const remoteParams = git(repo, 'show', `${baseSha}:.claude/bootstrap.json`);
    if (remoteParams.status !== 0 || remoteParams.stdout !== paramsText)
      throw new Error(`.claude/bootstrap.json differs from origin/${base}: push or pull .claude/bootstrap.json first`);

    must('git', ['-C', repo, 'worktree', 'prune'], repo);
    const wtDir = path.join(path.dirname(repo), 'worktrees', path.basename(repo));
    mkdirSync(wtDir, { recursive: true });
    const pending = path.join(wtDir, `bootstrap-upgrade-pending-${process.pid}-${Date.parse(startedAt)}`);
    if (existsSync(pending)) throw new Error(`the folder ${pending} exists: look at it and remove it by hand`);
    must('git', ['-C', repo, 'worktree', 'add', '--detach', pending, baseSha], repo);
    let status;
    try { status = JSON.parse(must(process.execPath, [RENDER, pending, '--status'], pending)); }
    finally { git(repo, 'worktree', 'remove', '--force', pending); }
    const hash = status.hash;
    if (!/^[0-9a-f]{16}$/.test(String(hash))) throw new Error('render.mjs --status gave no hash');
    const slug = `bootstrap-upgrade-${hash}`, branch = `auto/${slug}`, wt = path.join(wtDir, slug);
    const ctx = { repo, params, base, baseSha, hash, slug, branch, wt, saved: status.saved, replaces };
    writeStatus(repo, { hash, branch, worktree: wt });

    const remoteSha = remoteBranchSha(repo, branch);
    const hasLocal = localBranchExists(repo, branch);
    if (!opt.noPush) {
      const prs = branchPrs(repo, branch);
      const open = prs.find((p) => p.state === 'OPEN');
      if (open) {
        const note = labelRule(ctx, open.number);
        writeStatus(repo, { state: 'pr', step: 'pr', pr: { number: open.number, url: open.url }, error: note, endedAt: now() });
        console.log(`upgrade PR #${open.number} is already open: ${open.url}`);
        if (note) console.error('upgrade-run: ' + note);
        return 0;
      }
      if (prs.length && (remoteSha || hasLocal)) {
        const rmWt = listedWorktrees(repo).includes(wt) ? `git worktree remove --force ${wt}, ` : '';
        throw new Error(`PR #${prs[0].number} for this hash was ${prs[0].state === 'MERGED' ? 'merged (git pull, then the upgrade is done)' : 'closed'}; to start again run: ${rmWt}git branch -D ${branch} and git push origin --delete ${branch}`);
      }
    }

    if (remoteSha) {
      must('git', ['-C', repo, 'fetch', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`], repo);
      ensureWorktree(repo, wt, branch, true);
      if (opt.noPush) { writeStatus(repo, { state: 'committed', error: null, endedAt: now() }); return 0; }
      checkBody(repo, hash);
      const local = must('git', ['-C', repo, 'rev-parse', branch], repo).trim();
      if (local === remoteSha) return publish(ctx, false);
      if (git(repo, 'merge-base', '--is-ancestor', remoteSha, branch).status === 0) return publish(ctx, true);
      throw new Error(`the local and remote branch differ: ${branch}`);
    }
    const ahead = hasLocal ? Number(must('git', ['-C', repo, 'rev-list', '--count', `${baseSha}..${branch}`], repo).trim()) : 0;
    if (ahead > 0) {
      ensureWorktree(repo, wt, branch, false);
      if (opt.noPush) { writeStatus(repo, { state: 'committed', error: null, endedAt: now() }); return 0; }
      checkBody(repo, hash);
      return publish(ctx, true);
    }
    if (hasLocal || existsSync(wt)) {
      const listed = listedWorktrees(repo).includes(wt);
      if (existsSync(wt) && !listed) throw new Error(`the folder ${wt} is not a worktree of this repo: look at it and remove it by hand`);
      if (listed) {
        const s = git(wt, 'status', '--porcelain', '--ignore-submodules=none');
        if (s.status !== 0 || s.stdout.trim()) throw new Error(`the worktree ${wt} has uncommitted changes: look at them, then run git worktree remove --force ${wt}`);
        must('git', ['-C', repo, 'worktree', 'remove', '--force', wt], repo);
      }
      if (localBranchExists(repo, branch)) must('git', ['-C', repo, 'branch', '-D', branch], repo);
    }
    must('git', ['-C', repo, 'worktree', 'add', '--no-track', '-b', branch, wt, baseSha], repo);
    return await upgradeInWorktree(ctx, opt);
  } catch (e) {
    writeStatus(repo, { state: 'failed', error: e.message, endedAt: now() });
    console.error('upgrade-run: ' + redactError(e.message));
    return 1;
  }
}

/** The CLI. Gives the exit code; it never calls process.exit(). */
export async function main(argv) {
  const noPush = argv.includes('--no-push');
  const bad = argv.filter((a) => a.startsWith('--') && a !== '--no-push');
  const pos = argv.filter((a) => !a.startsWith('--'));
  if (bad.length || pos.length !== 1) { console.error('usage: node upgrade-run.mjs <repo> [--no-push]'); return 1; }
  let repo;
  try { repo = realpathSync(path.resolve(pos[0])); } catch { console.error(`upgrade-run: no folder ${pos[0]}`); return 1; }
  mkdirSync(runsDir(repo), { recursive: true });
  const lock = lockFile(repo);
  let fd;
  try { fd = openSync(lock, 'wx'); } catch (e) {
    if (e.code === 'EEXIST') { console.error(`upgrade-run: an upgrade run is already live, or a stale lock is left: ${lock}`); return 1; }
    throw e;
  }
  writeSync(fd, String(process.pid) + '\n');
  closeSync(fd);
  try {
    return await upgrade(repo, { noPush });
  } finally {
    // remove only the own lock
    try { if (readFileSync(lock, 'utf8').trim() === String(process.pid)) unlinkSync(lock); } catch {}
  }
}

// realpath: the skill is usually called through the ~/.claude/skills symlink
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; },
    (e) => { console.error('upgrade-run: ' + redactError(e.message)); process.exitCode = 1; });
}
