#!/usr/bin/env node
// render.mjs — render the bootstrap-project templates for one repo.
//
//   node render.mjs <repo> [--params <file>] [--stage <dir>] [--upgrade] [--json]
//   node render.mjs <repo> --apply new|all|<path,path,...> [--params <file>] [--upgrade]
//   node render.mjs --vars            list every placeholder name and exit
//
// <repo>        the target repo. The answers are in <repo>/.claude/bootstrap.json
//               (or --params <file>). Shape: references/contracts.md, "bootstrap.json".
// (no --apply)  render into the stage folder and print one line per file:
//               new | same | changed | config | merge (.gitignore) | orphan.
//               Writes nothing in <repo>, except that the first render records
//               "firstPlanTs" in bootstrap.json, so the preview and --apply give the
//               same first-plan file name.
//   config      only the CONFIG block differs: the repo keeps its block, and the
//               differing lines are printed. --reset-config --apply <path> takes the new block.
//   orphan      a file of a module that is now off. Shown only; never deleted.
// --apply new   write the new files and merge .gitignore. Never replaces a file.
// --apply all   also replace the changed files. Use only after the owner said yes.
// --apply <list>  write only these repo paths (comma separated).
// --upgrade     skip the first plan (a re-render of an existing setup).
// --reset-config  also replace the CONFIG block of .claude/scripts/* files. Without it,
//               a script that exists keeps its own CONFIG block (hand-tuned values),
//               and each line that differs from the answers is printed.
//
// Template syntax (only in templates/, never in the output):
//   @@NAME@@                a value from the variables below
//   @@IF NAME@@ … @@END@@   keep the lines when NAME is true (directive on its own line)
//   @@IFNOT NAME@@ … @@END@@
// Template paths: a "dot-" segment prefix becomes "." (dot-claude -> .claude), and a
// ".tmpl" suffix is removed (AGENTS.md.tmpl -> AGENTS.md). The prefix and suffix stop
// Claude Code from loading the templates as live skills or instructions in this repo.
//
// The render fails on an unknown placeholder, an unclosed block, a leftover "@@"
// directive in the output, an invalid params file, or settings.json that is not JSON.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(SKILL_DIR, 'templates');

export const MODULES = ['codex', 'changelog', 'decision-sheet', 'test-review', 'step-gate',
  'post-edit-lint', 'plans-parallel', 'pr-feedback', 'run-skill'];
export const MODES = ['verify', 'commit', 'pr'];

const die = (msg) => { console.error('render: ' + msg); process.exit(1); };
const isSafeName = (s) => typeof s === 'string' && /^[A-Za-z0-9._-]+$/.test(s);
const str = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : []);
const NA = 'not available yet';
const code = (s) => '`' + s + '`';
const jsList = (xs) => '[' + xs.map((x) => `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ') + ']';
const bashWords = (xs) => xs.map((x) => `'${String(x).replace(/'/g, `'\\''`)}'`).join(' ');
const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

// ---------------------------------------------------------------------------
// params -> variables
// ---------------------------------------------------------------------------

/** Checks the answers and returns a list of problems (empty when valid). */
export function checkParams(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['params is not a JSON object'];
  if (p.version !== 1) errs.push('version must be 1');
  const pr = p.project || {};
  if (!isSafeName(pr.name)) errs.push('project.name must use only letters, digits, ".", "_" and "-"');
  if (!str(pr.summary)) errs.push('project.summary is required (one sentence)');
  if (pr.short && String(pr.short).length > 12) errs.push('project.short is longer than 12 characters');
  if (pr.client && String(pr.client).length > 40) errs.push('project.client is longer than 40 characters');
  if (pr.remote && !/^[\w.-]+\/[\w.-]+$/.test(pr.remote)) errs.push('project.remote must be "<owner>/<repo>" or empty');
  const g = p.git || {};
  for (const k of ['base', 'prod', 'staging']) {
    if (g[k] && !/^[\w./-]+$/.test(g[k])) errs.push(`git.${k} is not a valid branch name`);
  }
  if (g.mergeStyle && !['squash', 'merge'].includes(g.mergeStyle)) errs.push('git.mergeStyle must be "squash" or "merge"');
  const r = p.rules || {};
  const hard = arr(r.hard);
  if (hard.length < 1) errs.push('rules.hard needs at least one rule');
  const strList = (v) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  hard.forEach((h, i) => {
    if (!str(h.title) || !str(h.rule)) errs.push(`rules.hard[${i}] needs "title" and "rule"`);
    if (!strList(h.details)) errs.push(`rules.hard[${i}].details must be a list of texts`);
    if (!strList(h.tests)) errs.push(`rules.hard[${i}].tests must be a list of texts`);
  });
  if (!strList(r.validatorLimits)) errs.push('rules.validatorLimits must be a list of texts');
  if (!str(r.parentPlan)) errs.push('rules.parentPlan is required (for example "PLAN.md" or "docs/ARCHITECTURE.md")');
  const mode = p.pipeline?.defaultMode ?? 'pr';
  if (!MODES.includes(mode)) errs.push(`pipeline.defaultMode must be one of ${MODES.join(', ')}`);
  for (const k of Object.keys(p.modules || {})) {
    if (!MODULES.includes(k)) errs.push(`modules.${k} is not a known module (${MODULES.join(', ')})`);
  }
  // these values go into double-quoted bash strings and single prefix rules:
  // one bare command each, no shell operators, quotes or expansions
  const cmds = [...Object.values(p.stack?.commands || {}), p.stack?.installCmd, p.stack?.postEditLint?.fix, p.stack?.postEditLint?.format];
  for (const c of cmds) {
    // "<file>" is a placeholder, not a redirection
    if (c && /[;&|<>`$"'\\]/.test(String(c).replace(/<[a-z-]+>/g, ''))) errs.push(`command "${c}" has a shell operator, a quote or a "$"; give one bare command`);
  }
  if (p.firstPlanTs !== undefined && !/^\d{8}-\d{6}$/.test(p.firstPlanTs)) errs.push('firstPlanTs must look like 20261111-150200');
  return errs;
}

/** Returns true when a module is on. Every module is on unless the answers turn it off. */
export const moduleOn = (p, m) => p.modules?.[m] !== false;

// Codex is found on PATH or in ~/.local/bin (installer default). The skills call it as
// `codex` or as `~/.local/bin/codex` (with the tilde), so these rules match both.
const CODEX_ALLOW = ['Bash(command -v codex)', 'Bash(test -x ~/.local/bin/codex)',
  'Bash(codex exec*)', 'Bash(codex login status*)',
  'Bash(~/.local/bin/codex exec*)', 'Bash(~/.local/bin/codex login status*)'];

/** Turns the interview answers into the placeholder values. */
export function buildVars(p, now = new Date()) {
  const pr = p.project, g = p.git || {}, st = p.stack || {}, r = p.rules || {}, ly = p.layout || {};
  const cmd = st.commands || {};
  const base = str(g.base, 'develop'), prod = str(g.prod, 'main'), staging = str(g.staging);
  // details: the project's own checks for a rule (what to look for, which values pass);
  // tests: the tests a change that touches the rule must have. Both are kept on every
  // re-render, so project text never needs a hand merge.
  const hard = arr(r.hard).map((h) => ({ title: str(h.title), rule: str(h.rule), check: str(h.check),
    details: arr(h.details).map((x) => str(x)).filter(Boolean), tests: arr(h.tests).map((x) => str(x)).filter(Boolean) }));
  const sub = (xs) => xs.map((x) => '\n  - ' + x).join('');
  const contract = r.contracts || {};
  const contractSource = str(contract.source);
  const contractsRule = contractSource
    ? `Types and enum values come from ${code(contractSource)}${contract.direction ? ` (${contract.direction})` : ''}. Do not duplicate them or hardcode their values.`
    : 'The project has no shared contract source yet. When one exists, add it here and take types and enum values only from it.';
  const parent = str(r.parentPlan);
  const rulesDocs = [...new Set(['AGENTS.md', parent, ...arr(r.rulesDocs)])];

  const commandRows = [
    ['Install', st.installCmd], ['Test (full)', cmd.test], ['Test (one file)', cmd.testScoped],
    ['Test (end to end)', cmd.testE2e], ['Lint', cmd.lint], ['Format', cmd.format],
    ['Type check', cmd.typecheck], ['Build', cmd.build],
  ];
  const commandsMd = '| What | Command |\n| --- | --- |\n' +
    commandRows.map(([k, v]) => `| ${k} | ${str(v) ? code(str(v)) : NA} |`).join('\n');

  // allow rules: one prefix rule per real command
  const allowCmds = [...new Set([st.installCmd, ...Object.values(cmd)].map((c) => str(c)).filter(Boolean)
    .map((c) => c.replace(/\s*<[^>]*>.*$/, '').replace(/\s+"?\{?file\}?"?$/, '')))];
  const allow = [
    'Read(./**)', 'Edit(./**)',
    'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)',
    'Bash(git branch --show-current)', 'Bash(git ls-files*)', 'Bash(git merge-base*)', 'Bash(git check-ignore*)',
    'Bash(grep *)', 'Bash(ls *)', 'Bash(diff *)', 'Bash(cp .plans/*)', 'Bash(mkdir -p .plans/*)',
    'Bash(gh pr view*)', 'Bash(gh pr diff*)', 'Bash(gh issue view*)', 'Bash(gh run view*)',
    ...allowCmds.map((c) => `Bash(${c}*)`),
    ...(moduleOn(p, 'codex') ? CODEX_ALLOW : []),
    ...(moduleOn(p, 'step-gate') ? ['Bash(bash .claude/scripts/workflow-complete-step.sh*)'] : []),
    ...arr(r.extraAllow),
  ];
  // deny: destructive commands only. Never push or PR commands: deny beats every
  // allow rule, also the per-run --allowedTools overlay of the "to PR" mode.
  const deny = [
    'Bash(git reset --hard*)', 'Bash(git clean*)', 'Bash(rm -rf*)',
    'Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(gh repo create*)', 'Bash(gh repo delete*)',
    ...arr(r.protectedPaths).flatMap((pp) => [`Edit(${pp})`, `Write(${pp})`]),
  ];
  const hooks = {};
  if (moduleOn(p, 'step-gate')) {
    hooks.PreToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/scripts/workflow-guard.sh"' }] }];
  }
  if (moduleOn(p, 'post-edit-lint')) {
    hooks.PostToolUse = [{ matcher: 'Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/scripts/post-edit-lint.sh"' }] }];
  }

  // run overlay extras for auto-pipeline.sh (install step + owner extras)
  const installWords = str(st.installCmd).split(/\s+/).slice(0, 2).join(' ');
  const runExtra = [...(installWords ? [`Bash(${installWords}*)`] : []), ...arr(p.pipeline?.runAllow)];
  if (moduleOn(p, 'step-gate')) runExtra.push('Bash(bash .claude/scripts/workflow-complete-step.sh*)');
  if (moduleOn(p, 'codex')) runExtra.push(...CODEX_ALLOW);

  // hard-rule blocks
  const hardMd = hard.map((h) => `- **${h.title}.** ${h.rule}` + sub(h.details)).join('\n');
  const huntMd = hard.map((h) => `- **${h.title}:** the plan breaks or skips the rule "${h.rule}"` + sub(h.details)).join('\n');
  const checklistMd = hard.map((h) => `- [ ] ${h.title} respected`).join('\n');
  const planCheckMd = hard.map((h) => `- **${h.title}.** ${h.rule} How does the plan keep this rule?` + sub(h.details)).join('\n');
  const ruleTestsMd = hard.filter((h) => h.tests.length).map((h) => `- **${h.title}:**` + sub(h.tests)).join('\n');
  const ruleDetailsMd = hard.filter((h) => h.details.length).map((h) => `- **${h.title}:**` + sub(h.details)).join('\n');
  const limits = arr(r.validatorLimits).map((x) => str(x)).filter(Boolean);
  let n = 2;
  const auditRows = [`| ${n} | Lint and format | The repo's lint and format commands (AGENTS.md, Commands). Error and warning counts. |`];
  for (const h of hard) {
    const how = [h.check, ...h.details].filter(Boolean).map((x) => x.replace(/\|/g, '\\|'));
    auditRows.push(`| ${++n} | ${h.title} | ${h.rule.replace(/\|/g, '\\|')}${how.length ? ' Check: ' + how.join(' ') : ''} Name the file:line of each place you checked. |`);
  }
  // a hard rule about contracts already covers this row (no duplicate rule)
  const contractInRules = hard.some((h) => /contract/i.test(h.title));
  if (!contractInRules) auditRows.push(`| ${++n} | Contracts | ${contractsRule} |`);
  auditRows.push(`| ${++n} | JSDoc | Every new or changed public function has a doc comment in ASD-STE100. Report only what the diff added or changed. |`);
  auditRows.push(`| ${++n} | Tests | Every test in the plan's **Tests** list exists, and each rule above that the change touches has a test that fails when the rule breaks. |`);
  auditRows.push(`| ${++n} | Secrets | No keys, passwords, tokens or private paths in the code or fixtures. Fixtures use made-up data only. |`);
  auditRows.push(`| ${++n} | Plan scope | Every plan step is done. No file outside **Affected files** changed without a reason in the summary. No open owner decision taken silently. |`);

  // layout
  const layoutRows = arr(ly.folders).map((f) => `| ${code(str(f.path))} | ${str(f.what)} |`);
  const layoutMd = layoutRows.length ? '| Path | What |\n| --- | --- |\n' + layoutRows.join('\n')
    : 'No code yet. Add one row per top-level folder when the first code lands.';
  const roots = [...new Set([...arr(ly.folders).map((f) => str(f.path).replace(/^\.\//, '').replace(/\/?$/, '/')), 'docs/', 'scripts/', '.github/'])];
  const rootFiles = [...new Set([...arr(ly.rootFiles), 'AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore',
    ...(str(st.manifest) ? [str(st.manifest)] : []), ...(parent.includes('/') ? [] : [parent])])];
  const softFiles = [...new Set([...arr(ly.softFiles), '.gitignore', ...(str(st.manifest) ? [str(st.manifest)] : []), ...arr(st.lockfiles)])];

  const branchChain = [base, staging, prod].filter(Boolean).join(' → ');
  const merge = str(g.mergeStyle, 'squash');
  const pel = st.postEditLint || {};
  const exts = arr(pel.extensions).map((e) => String(e).replace(/^\*?\.?/, ''));

  return {
    PROJECT_NAME: pr.name,
    PROJECT_TITLE: str(pr.title, pr.name),
    PROJECT_SUMMARY: str(pr.summary),
    CLIENT: str(pr.client, 'Default'),
    SHORT: str(pr.short),
    GITHUB_REMOTE: str(pr.remote),
    GITHUB_URL: pr.remote ? `https://github.com/${pr.remote}` : '',
    BASE_BRANCH: base,
    PROD_BRANCH: prod,
    BRANCH_CHAIN: branchChain,
    MERGE_STYLE: merge,
    MERGE_HINT: merge === 'squash' ? `a squash merge keeps ${base} to one commit per PR` : 'use a merge commit, so the branch history stays as it was',
    PARENT_PLAN: parent,
    RULES_DOCS: rulesDocs.map(code).join(', '),
    STACK_SUMMARY: str(st.summary, 'Not decided yet.'),
    MANIFESTS: (arr(st.manifests).length ? arr(st.manifests) : [str(st.manifest, 'package.json')]).map(code).join(' and '),
    COMMANDS_TABLE: commandsMd,
    INSTALL_CMD: str(st.installCmd),
    INSTALL_MANIFEST: str(st.manifest, 'package.json'),
    ENV_FILES_BASH: bashWords(arr(ly.envFiles).length ? arr(ly.envFiles) : ['.env']),
    RUN_EXTRA_ALLOW_BASH: bashWords(runExtra),
    DEFAULT_MODE: p.pipeline?.defaultMode ?? 'pr',
    HARD_RULES: hardMd,
    HARD_RULE_TITLES: hard.map((h) => h.title.toLowerCase()).join(', '),
    VALIDATOR_HUNT: huntMd,
    VALIDATOR_RULE_CHECKS: checklistMd,
    PLAN_RULE_CHECKS: planCheckMd,
    RULE_TESTS: ruleTestsMd,
    RULE_DETAILS: ruleDetailsMd,
    VALIDATOR_LIMITS: limits.map((x) => '- **Never:** ' + x).join('\n'),
    HAS_RULE_TESTS: Boolean(ruleTestsMd),
    HAS_RULE_DETAILS: Boolean(ruleDetailsMd),
    HAS_VALIDATOR_LIMITS: limits.length > 0,
    AUDIT_ROWS: auditRows.join('\n'),
    AUDIT_LAST: String(n),
    CONTRACTS_RULE: contractsRule,
    CONTRACT_SOURCE: contractSource || 'none yet',
    TEST_DATA_RULE: str(r.testData, 'Use made-up test data only. Never put real customer data, real names, real addresses or real secrets in a test or a fixture. Example: `"Ana Example"`, `ana@example.test`, a fake key `sk-test-0000`.'),
    QUESTION_ACTOR: str(r.exampleActor, 'Ana (the owner)'),
    LAYOUT_TABLE: layoutMd,
    LANES_ROOTS: jsList(roots),
    LANES_ROOT_FILES: jsList(rootFiles),
    LANES_HARD_DOCS: jsList(parent && !parent.startsWith('.plans/') ? [parent] : []),
    LANES_SOFT_FILES: jsList(softFiles),
    SETTINGS_ALLOW: JSON.stringify(allow, null, 2).replace(/\n/g, '\n    '),
    SETTINGS_DENY: JSON.stringify(deny, null, 2).replace(/\n/g, '\n    '),
    SETTINGS_HOOKS: JSON.stringify(hooks, null, 2).replace(/\n/g, '\n  '),
    LINT_FIX_FILE_CMD: str(pel.fix),
    FORMAT_FILE_CMD: str(pel.format),
    TYPECHECK_CMD: str(cmd.typecheck),
    LINT_EXTENSIONS_CASE: exts.length ? exts.map((e) => `*.${e}`).join('|') : '*.__none__',
    TODAY: now.toISOString().slice(0, 10),
    FIRST_PLAN_TS: p.firstPlanTs || stamp(now),
    // switches for @@IF@@ blocks
    HAS_REMOTE: Boolean(pr.remote),
    HAS_STAGING: Boolean(staging),
    STAGING_BRANCH: staging,
    HAS_INSTALL: Boolean(str(st.installCmd)),
    HAS_CONTRACTS: Boolean(contractSource),
    CONTRACT_IN_RULES: contractInRules,
    MOD_CODEX: moduleOn(p, 'codex'),
    MOD_CHANGELOG: moduleOn(p, 'changelog'),
    MOD_DECISION_SHEET: moduleOn(p, 'decision-sheet'),
    MOD_TEST_REVIEW: moduleOn(p, 'test-review'),
    MOD_STEP_GATE: moduleOn(p, 'step-gate'),
    MOD_POST_EDIT_LINT: moduleOn(p, 'post-edit-lint'),
    MOD_PLANS_PARALLEL: moduleOn(p, 'plans-parallel'),
    MOD_PR_FEEDBACK: moduleOn(p, 'pr-feedback'),
    MOD_RUN_SKILL: moduleOn(p, 'run-skill'),
  };
}

// ---------------------------------------------------------------------------
// template engine
// ---------------------------------------------------------------------------

/** Renders one template text. Throws with the line number on any problem. */
export function renderText(text, vars, where = 'template') {
  const out = [];
  const stack = []; // each: { keep, line }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const at = `${where}:${i + 1}`;
    const dir = line.match(/^\s*(?:#|\/\/|<!--)?\s*@@(IF|IFNOT|END)(?:\s+([A-Z0-9_]+))?@@\s*(?:-->)?\s*$/);
    if (dir) {
      const [, kind, name] = dir;
      if (kind === 'END') {
        if (!stack.length) throw new Error(`${at}: @@END@@ without @@IF@@`);
        stack.pop();
        return;
      }
      if (!name || !(name in vars)) throw new Error(`${at}: unknown switch "${name}"`);
      if (typeof vars[name] !== 'boolean') throw new Error(`${at}: "${name}" is not a switch`);
      stack.push({ keep: kind === 'IF' ? vars[name] : !vars[name], line: i + 1 });
      return;
    }
    if (stack.some((s) => !s.keep)) return;
    out.push(line.replace(/@@([A-Z0-9_]+)@@/g, (m, name) => {
      if (!(name in vars)) throw new Error(`${at}: unknown placeholder @@${name}@@`);
      if (typeof vars[name] === 'boolean') throw new Error(`${at}: @@${name}@@ is a switch, not a value`);
      return vars[name];
    }));
  });
  if (stack.length) throw new Error(`${where}:${stack.at(-1).line}: @@IF@@ without @@END@@`);
  const result = out.join('\n');
  const left = result.match(/@@[A-Z][A-Z0-9_ ]*@@/);
  if (left) throw new Error(`${where}: leftover ${left[0]} after render`);
  return result;
}

/** Maps a template path to its repo path. */
export const repoPath = (rel) => rel.split('/').map((s) => s.replace(/^dot-/, '.')).join('/').replace(/\.tmpl$/, '');

function walk(dir, rel = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((name) => {
    const abs = path.join(dir, name), r = rel ? rel + '/' + name : name;
    return statSync(abs).isDirectory() ? walk(abs, r) : [{ abs, rel: r }];
  });
}

const isExecutable = (p) => /^\.claude\/scripts\/.*\.(sh|mjs)$/.test(p);

/** Renders every enabled template. Returns [{ path, content, kind }]. */
export function renderAll(params, { upgrade = false, now = new Date() } = {}) {
  const vars = buildVars(params, now);
  const sources = [
    ...walk(path.join(TEMPLATES, 'core')),
    ...MODULES.filter((m) => moduleOn(params, m)).flatMap((m) => walk(path.join(TEMPLATES, 'modules', m))),
  ];
  const files = new Map();
  for (const s of sources) {
    let p = repoPath(s.rel);
    let kind = 'file';
    if (p === 'gitignore.fragment') { p = '.gitignore'; kind = 'merge'; }
    if (p === 'editorconfig') p = '.editorconfig';
    if (p === 'parent-plan.md') {
      // a skeleton, only when the parent plan does not exist (never a pattern like .plans/*-parent.md)
      if (/[*?]/.test(vars.PARENT_PLAN)) continue;
      p = vars.PARENT_PLAN;
      kind = 'once';
    }
    if (p === '.plans/first-plan.md') {
      if (upgrade) continue;
      p = `.plans/${vars.FIRST_PLAN_TS}-check-the-pipeline-end-to-end.md`;
      kind = 'first-plan';
    }
    let content;
    try { content = renderText(readFileSync(s.abs, 'utf8'), vars, path.relative(SKILL_DIR, s.abs)); } catch (e) { die(e.message); }
    if (p.endsWith('.json')) {
      try { JSON.parse(content); } catch (e) { die(`${s.rel}: rendered JSON is not valid: ${e.message}`); }
    }
    if (files.has(p) && kind !== 'merge') die(`two templates write ${p}`);
    if (kind === 'merge' && files.has(p)) {
      files.get(p).content += '\n' + content;
      continue;
    }
    files.set(p, { path: p, content, kind });
  }
  // files of modules that are off: reported as orphans when the repo still has them
  for (const m of MODULES.filter((x) => !moduleOn(params, x))) {
    for (const s of walk(path.join(TEMPLATES, 'modules', m))) {
      const p = repoPath(s.rel);
      if (p !== 'gitignore.fragment' && !files.has(p)) files.set(p, { path: p, content: '', kind: 'orphan', module: m });
    }
  }
  return [...files.values()];
}

/** Merges the .gitignore lines: keeps the repo file and appends the missing lines. */
export function mergeGitignore(existing, fragment) {
  const have = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = [];
  let header = null;
  for (const line of fragment.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) { header = line; continue; }
    if (!have.has(t)) {
      if (header) { missing.push('', header); header = null; }
      missing.push(line);
      have.add(t);
    }
  }
  if (!missing.length) return existing;
  return existing.replace(/\n*$/, '\n') + missing.join('\n').replace(/^\n/, existing.trim() ? '\n' : '') + '\n';
}

/** Compares the rendered files with the repo. */
// The CONFIG block of a repo script holds project values the owner may have tuned by
// hand. A re-render keeps the repo's block and replaces only the generic code.
const CONFIG_START = /^(?:\/\/|#) =+ CONFIG \(.*\) =+$/;
const CONFIG_END = /^(?:\/\/|#) =+$/;
/** Returns [start, end] line indexes of the CONFIG block, or null. */
export function configBlock(lines) {
  const a = lines.findIndex((l) => CONFIG_START.test(l));
  if (a < 0) return null;
  const b = lines.findIndex((l, i) => i > a && CONFIG_END.test(l));
  return b < 0 ? null : [a, b];
}
/** Puts the CONFIG block of `current` into `rendered`. Returns null when either has none. */
/** Returns the lines that differ between two CONFIG blocks ("- yours", "+ answers"). */
export function configDiff(current, rendered) {
  const c = current.split('\n'), r = rendered.split('\n');
  const cb = configBlock(c), rb = configBlock(r);
  if (!cb || !rb) return [];
  const a = c.slice(cb[0] + 1, cb[1]), b = r.slice(rb[0] + 1, rb[1]);
  return [...a.filter((l) => !b.includes(l)).map((l) => '- ' + l), ...b.filter((l) => !a.includes(l)).map((l) => '+ ' + l)];
}
export function keepConfig(current, rendered) {
  const c = current.split('\n'), r = rendered.split('\n');
  const cb = configBlock(c), rb = configBlock(r);
  if (!cb || !rb) return null;
  return [...r.slice(0, rb[0]), ...c.slice(cb[0], cb[1] + 1), ...r.slice(rb[1] + 1)].join('\n');
}

export function plan(repo, files, { resetConfig = false } = {}) {
  const planHasPlans = (() => {
    const dirs = [path.join(repo, '.plans'), path.join(repo, '.plans', 'done')];
    return dirs.some((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith('.md')));
  })();
  return files.flatMap((f) => {
    const abs = path.join(repo, f.path);
    if (f.kind === 'first-plan' && planHasPlans) return [];
    if (f.kind === 'once' && existsSync(abs)) return [];
    if (f.kind === 'orphan') return existsSync(abs) ? [{ ...f, status: 'orphan', note: `module "${f.module}" is off; delete by hand if unused` }] : [];
    const ensureNl = (s) => (s === '' || s.endsWith('\n') ? s : s + '\n');
    if (f.kind === 'merge') {
      const cur = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      const next = mergeGitignore(cur, f.content);
      return [{ ...f, content: next, status: cur === next ? 'same' : existsSync(abs) ? 'merge' : 'new' }];
    }
    let content = ensureNl(f.content);
    if (!existsSync(abs)) return [{ ...f, content, status: 'new' }];
    const cur = readFileSync(abs, 'utf8');
    let note = '', diff = [];
    if (!resetConfig && /^\.claude\/scripts\//.test(f.path)) {
      diff = configDiff(cur, content);
      const kept = keepConfig(cur, content);
      if (kept !== null) content = kept;
      if (diff.length) note = 'CONFIG differs: yours is kept; --reset-config --apply <path> takes the answers';
    }
    const status = cur !== content ? 'changed' : diff.length ? 'config' : 'same';
    return [{ ...f, content, note, diff, status }];
  });
}

function writeFile(root, f) {
  const abs = path.join(root, f.path);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, f.content);
  if (isExecutable(f.path)) chmodSync(abs, 0o755);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const opt = { apply: null, stage: null, params: null, upgrade: false, json: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opt.apply = argv[++i];
    else if (a === '--stage') opt.stage = argv[++i];
    else if (a === '--params') opt.params = argv[++i];
    else if (a === '--upgrade') opt.upgrade = true;
    else if (a === '--reset-config') opt.resetConfig = true;
    else if (a === '--json') opt.json = true;
    else if (a === '--vars') opt.vars = true;
    else if (a.startsWith('--')) die('unknown option ' + a);
    else pos.push(a);
  }
  if (opt.vars) {
    const sample = JSON.parse(readFileSync(path.join(SKILL_DIR, 'references', 'bootstrap.example.json'), 'utf8'));
    for (const [k, v] of Object.entries(buildVars(sample))) console.log(`${k}\t${typeof v === 'boolean' ? 'switch' : 'value'}`);
    return;
  }
  const repo = pos[0] ? path.resolve(pos[0]) : die('usage: render.mjs <repo> [--apply new|all|<paths>]');
  if (!existsSync(path.join(repo, '.git'))) die(`${repo} is not a git repository`);
  const paramsFile = opt.params ? path.resolve(opt.params) : path.join(repo, '.claude', 'bootstrap.json');
  if (!existsSync(paramsFile)) die(`no answers file at ${paramsFile}; run the interview first`);
  let params;
  try { params = JSON.parse(readFileSync(paramsFile, 'utf8')); } catch (e) { die(`${paramsFile}: ${e.message}`); }
  const errs = checkParams(params);
  if (errs.length) die('the answers file has problems:\n  - ' + errs.join('\n  - '));

  if (!params.firstPlanTs && !opt.upgrade) {
    // record the timestamp once, so the preview and --apply name the first plan the same
    params.firstPlanTs = stamp(new Date());
    writeFileSync(paramsFile, JSON.stringify(params, null, 2) + '\n');
  }
  const rows = plan(repo, renderAll(params, { upgrade: opt.upgrade }), { resetConfig: opt.resetConfig });
  // a fresh stage each time, so files of a module that was turned off do not linger
  const stage = path.resolve(opt.stage || path.join(tmpdir(), `bootstrap-${params.project.name}`));
  const marker = path.join(stage, '.bootstrap-stage');
  if (existsSync(stage) && readdirSync(stage).length && !existsSync(marker)) die(`stage folder ${stage} is not empty and is not a bootstrap stage; pick another --stage`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  writeFileSync(marker, '');
  for (const f of rows.filter((r) => r.status !== 'orphan')) writeFile(stage, f);

  let applied = [];
  if (opt.apply) {
    const pick = opt.apply === 'new' ? rows.filter((f) => f.status === 'new' || f.status === 'merge')
      : opt.apply === 'all' ? rows.filter((f) => f.status === 'new' || f.status === 'merge' || f.status === 'changed')
      : (() => {
        const want = opt.apply.split(',').map((s) => s.trim()).filter(Boolean);
        const unknown = want.filter((w) => !rows.some((f) => f.path === w));
        if (unknown.length) die('not a rendered file: ' + unknown.join(', '));
        const orphan = want.filter((w) => rows.find((f) => f.path === w)?.status === 'orphan');
        if (orphan.length) die('an orphan file is never written: ' + orphan.join(', '));
        return rows.filter((f) => want.includes(f.path));
      })();
    for (const f of pick) writeFile(repo, f);
    applied = pick.map((f) => f.path);
  }

  if (opt.json) {
    console.log(JSON.stringify({ repo, stage, files: rows.map(({ path: p, status, kind, note, diff }) => ({ path: p, status, kind, note, diff })), applied }, null, 2));
    return;
  }
  const order = { changed: 0, config: 1, orphan: 2, merge: 3, new: 4, same: 5 };
  for (const f of [...rows].sort((a, b) => order[a.status] - order[b.status] || a.path.localeCompare(b.path))) {
    console.log(`${f.status.padEnd(8)} ${f.path}${f.note ? `   (${f.note})` : ''}${applied.includes(f.path) ? '   (written)' : ''}`);
    for (const d of f.diff || []) console.log(`           ${d}`);
  }
  const count = (s) => rows.filter((f) => f.status === s).length;
  console.log(`\n${rows.length} files: ${count('new')} new, ${count('changed')} changed, ${count('config')} config, ${count('merge')} merge, ${count('orphan')} orphan, ${count('same')} same`);
  console.log(`stage: ${stage}`);
  if (!opt.apply && count('changed')) console.log(`compare one file: diff -u "${repo}/<path>" "${stage}/<path>"`);
}

// realpath: the skill is usually called through the ~/.claude/skills symlink
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
