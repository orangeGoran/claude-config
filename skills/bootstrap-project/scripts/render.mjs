#!/usr/bin/env node
// render.mjs — render the bootstrap-project templates for one repo.
//
//   node render.mjs <repo> [--params <file>] [--stage <dir>] [--upgrade] [--json]
//   node render.mjs <repo> --apply new|all|<path,path,...> [--params <file>] [--upgrade]
//   node render.mjs <repo> --status   print {hash, saved, counts} as JSON; writes nothing
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
// --status      for the plans dashboard: "hash" is what the templates make from the answers
//               now (renderHash), "saved" is the hash the last --apply stored in
//               bootstrap.json, "counts" the file statuses of an upgrade. hash != saved means
//               the templates or the answers changed since the last apply.
// --unused      print the parts these answers leave out (modules off, registrations off,
//               missing commands, empty settings, things the skill never makes), numbered,
//               each with the bootstrap.json change that turns it on. Writes nothing.
//               With --json: the list as JSON.
//
// Template syntax (only in templates/, never in the output). templates/partials/*.md are
// shared blocks, rendered once and used as a value (reporting-rules.md -> REPORTING_RULES).
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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
// A rule with $HOME goes in double quotes, so bash expands it when the script runs: a
// permission rule does not expand "~" or "$HOME" itself, and the session sees full paths.
const bashWord = (x) => (String(x).includes('$HOME')
  ? `"${String(x).replace(/["\\`]/g, '\\$&').replace(/\$(?!HOME\b)/g, '\\$')}"`
  : `'${String(x).replace(/'/g, `'\\''`)}'`);
const bashWords = (xs) => xs.map(bashWord).join(' ');
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
  if (!str(r.parentPlan)) errs.push('rules.parentPlan is required (for example ".plans/20261109-205757-parent.md" or "docs/PLAN.md")');
  const mode = p.pipeline?.defaultMode ?? 'pr';
  if (!MODES.includes(mode)) errs.push(`pipeline.defaultMode must be one of ${MODES.join(', ')}`);
  for (const k of Object.keys(p.modules || {})) {
    if (!MODULES.includes(k)) errs.push(`modules.${k} is not a known module (${MODULES.join(', ')})`);
  }
  // these values go into double-quoted bash strings and single prefix rules:
  // one bare command each, no shell operators, quotes or expansions
  const preflight = p.pipeline?.preflight;
  if (preflight !== undefined && !(Array.isArray(preflight) && preflight.every((x) => typeof x === 'string'))) errs.push('pipeline.preflight must be a list of commands');
  const cmds = [...Object.values(p.stack?.commands || {}), p.stack?.installCmd, p.stack?.postEditLint?.fix, p.stack?.postEditLint?.format,
    p.changelog?.validateCmd, ...arr(preflight)];
  for (const c of cmds) {
    // "<file>" is a placeholder, not a redirection
    if (c && /[;&|<>`$"'\\]/.test(String(c).replace(/<[a-z-]+>/g, ''))) errs.push(`command "${c}" has a shell operator, a quote or a "$"; give one bare command`);
  }
  if (p.firstPlanTs !== undefined && !/^\d{8}-\d{6}$/.test(p.firstPlanTs)) errs.push('firstPlanTs must look like 20261111-150200');
  const services = p.pipeline?.services;
  if (services !== undefined && !Array.isArray(services)) errs.push('pipeline.services must be a list');
  arr(services).forEach((s, i) => {
    if (!str(s?.name) || (!str(s?.url) === !str(s?.container))) errs.push(`pipeline.services[${i}] needs "name" and exactly one of "url" or "container"`);
    if (str(s?.url) && !/^https?:\/\/[\w.:/-]+$/.test(s.url)) errs.push(`pipeline.services[${i}].url must be a plain http(s) URL`);
    if (str(s?.container) && !/^[\w.-]+$/.test(s.container)) errs.push(`pipeline.services[${i}].container must be a container name`);
  });
  const cl = p.changelog;
  if (cl !== undefined) {
    if (!cl || typeof cl !== 'object') errs.push('changelog must be an object');
    else {
      if (cl.locales !== undefined && !(Array.isArray(cl.locales) && cl.locales.length && cl.locales.every((l) => /^[a-z]{2}(-[A-Z]{2})?$/.test(l)))) {
        errs.push('changelog.locales must be a list of language codes, for example ["en", "de"]');
      }
      if (cl.versionFile !== undefined && cl.versionFile !== '' && !/^[\w./-]+$/.test(cl.versionFile)) errs.push('changelog.versionFile must be a repo path, for example "package.json", or empty');
      if (cl.validateCmd !== undefined && typeof cl.validateCmd !== 'string') errs.push('changelog.validateCmd must be one bare command, for example "pnpm changelog:validate", or empty');
      if (cl.summary !== undefined && typeof cl.summary !== 'boolean') errs.push('changelog.summary must be true or false');
    }
  }
  const extra = p.stack?.extraCommands;
  if (extra !== undefined && !(Array.isArray(extra) && extra.every((x) => x && str(x.label) && str(x.cmd) && (x.note === undefined || typeof x.note === 'string')))) {
    errs.push('stack.extraCommands must be a list of {label, cmd, note?}');
  }
  if (p.stack?.nodeVersionFile !== undefined && p.stack.nodeVersionFile !== '' && !/^[\w./-]+$/.test(p.stack.nodeVersionFile)) errs.push('stack.nodeVersionFile must be a repo path, for example ".nvmrc", or empty');
  if (p.layout?.migrationHints !== undefined && !strList(p.layout.migrationHints)) errs.push('layout.migrationHints must be a list of texts');
  const btp = p.registry?.browserTestProject;
  if (btp !== undefined && btp !== '' && !isSafeName(btp)) errs.push('registry.browserTestProject must use only letters, digits, ".", "_" and "-"');
  const board = p.git?.tickets?.board;
  if (board !== undefined && (!str(board.owner) || !/^\d+$/.test(String(board.number ?? '')) || !str(board.status))) {
    errs.push('git.tickets.board needs "owner", a numeric "number" and "status"');
  }
  return errs;
}

/** Returns true when a module is on. Every module is on unless the answers turn it off. */
export const moduleOn = (p, m) => p.modules?.[m] !== false;

// What each module does for the owner, in plain words (the "not used" list of the hand-off)
const MODULE_INFO = {
  codex: 'Codex checks the plan and the finished code a second time, with another AI (.codex/skills/validate-plan, validate-implementation)',
  changelog: 'a changelog entry for each PR, the changelog-entry skill and a GitHub check that blocks a PR without an entry (changelog.d/)',
  'decision-sheet': 'a PR decision sheet: at most 5 yes/no questions only a person can answer, plus what the machines already checked',
  'test-review': 'an independent review of the tests of a change, with revert checks (test-review skill, test-reviewer agent)',
  'step-gate': 'a hook that blocks "git commit" until the plan steps (implement, test, verify, document) are done',
  'post-edit-lint': 'a hook that runs the lint fixer and the formatter on each file Claude edits',
  'plans-parallel': 'a report of which plans can run at the same time and which must wait (plans-parallel skill)',
  'pr-feedback': 'applies your review comments on an open PR, tests again, pushes and replies to each comment (pr-feedback skill)',
  'run-skill': 'a manual launcher that runs one plan skill headless in the current checkout (run-skill.sh)',
};
const COMMAND_INFO = {
  test: 'run all tests', testScoped: 'run the tests of one file', testE2e: 'run the end-to-end tests',
  lint: 'lint and fix', lintCheck: 'lint without changing files', format: 'format the code',
  typecheck: 'type check', build: 'build',
};

/**
 * Lists the parts the skill can set up but that these answers leave out, so the hand-off can
 * offer them. Each item: {group, key, what, turnOn}. "turnOn" is the bootstrap.json change.
 */
export function unusedParts(p, repo = null) {
  const out = [];
  for (const m of MODULES) {
    if (!moduleOn(p, m)) out.push({ group: 'module', key: m, what: MODULE_INFO[m], turnOn: `modules["${m}"] = true` });
  }
  const reg = p.registry || {};
  if (reg.dashboard === false) out.push({ group: 'registration', key: 'dashboard', what: 'the project on the plans dashboard (launch plans, see runs and PRs)', turnOn: 'registry.dashboard = true' });
  if (reg.browserTest !== true) {
    out.push({ group: 'registration', key: 'browserTest', what: 'a browser-usability-test profile, so runs can click through the app', turnOn: 'registry.browserTest = true (and registry.appUrl for a web UI)' });
  } else if (reg.role !== 'backend' && !str(reg.appUrl)) {
    out.push({ group: 'registration', key: 'appUrl', what: 'the browser-test step and ship gate of each run (needs the dev server link)', turnOn: 'registry.appUrl = "<dev server URL>"' });
  }
  const cmds = p.stack?.commands || {};
  for (const [k, what] of Object.entries(COMMAND_INFO)) {
    if (!str(cmds[k])) out.push({ group: 'command', key: k, what: `the command to ${what} (the skills say "not available yet")`, turnOn: `stack.commands.${k} = "<command>"` });
  }
  const pel = p.stack?.postEditLint || {};
  if (moduleOn(p, 'post-edit-lint') && !str(pel.fix) && !str(pel.format)) {
    out.push({ group: 'setting', key: 'postEditLint', what: 'the lint and format commands for the post-edit hook (the hook does nothing without them)', turnOn: 'stack.postEditLint.fix / .format / .extensions' });
  }
  const t = p.git?.tickets || {};
  if (t.evidence !== true) out.push({ group: 'setting', key: 'tickets.evidence', what: 'a comment with the run evidence on the GitHub issue of each PR', turnOn: 'git.tickets.evidence = true' });
  if (!t.board) out.push({ group: 'setting', key: 'tickets.board', what: 'move the issue to a status on a GitHub project board when the PR opens', turnOn: 'git.tickets.board = {owner, number, status}' });
  if (!arr(p.pipeline?.services).length) out.push({ group: 'setting', key: 'services', what: 'check that the services a run needs (API, database container) are up before it starts', turnOn: 'pipeline.services = [{name, url | container}]' });
  if (!arr(p.pipeline?.preflight).length) out.push({ group: 'setting', key: 'preflight', what: 'commands every run needs first (for example a generator whose output is gitignored)', turnOn: 'pipeline.preflight = ["<command>"]' });
  if (!str(p.git?.staging)) out.push({ group: 'setting', key: 'staging', what: 'a staging branch between the base branch and production', turnOn: 'git.staging = "<branch>"' });
  // never made by the skill: the owner adds them in a plan. Left out when the repo has them.
  const has = (rel) => Boolean(repo) && existsSync(path.join(repo, rel));
  const ours = new Set(['changelog-gate.yml', 'decision-sheet.yml']);
  const ci = has('.github/workflows') && readdirSync(path.join(repo, '.github/workflows')).some((f) => /\.ya?ml$/.test(f) && !ours.has(f));
  const nested = Boolean(repo) && readdirSync(repo, { withFileTypes: true })
    .some((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'changelog.d' && d.name !== 'node_modules' && existsSync(path.join(repo, d.name, 'AGENTS.md')));
  const node = str(p.stack?.manifest) === 'package.json';
  for (const [key, what, present] of [
    ['ci', 'a CI workflow that runs the tests and lint on each PR', ci],
    ['dependabot', 'dependabot updates for the dependencies', has('.github/dependabot.yml') || has('.github/dependabot.yaml')],
    ['git-hooks', 'git hooks (husky or similar)', has('.husky') || has('lefthook.yml') || has('.pre-commit-config.yaml')],
    ['node-version', 'a .nvmrc file that pins the Node version', !node || has('.nvmrc') || has('.node-version')],
    ['nested-agents', 'an AGENTS.md per big folder with the rules of that folder', nested],
  ]) if (!present) out.push({ group: 'plan', key, what, turnOn: 'write a plan: /skill-1-plan' });
  return out;
}

// Codex is found on PATH or in ~/.local/bin (installer default). The skills call it as
// `codex` or as `~/.local/bin/codex` (with the tilde), so these rules match both.
const CODEX_ALLOW = ['Bash(command -v codex)', 'Bash(test -x ~/.local/bin/codex)',
  'Bash(codex exec*)', 'Bash(codex login status*)',
  'Bash(~/.local/bin/codex exec*)', 'Bash(~/.local/bin/codex login status*)'];
// A headless session often writes the full path (/Users/<me>/.local/bin/codex), and a rule
// does not expand "~": the run overlay also gets the $HOME form (expanded by bash).
const CODEX_RUN_ALLOW = [...CODEX_ALLOW, 'Bash($HOME/.local/bin/codex exec*)', 'Bash($HOME/.local/bin/codex login status*)'];

// Bash rule `inner` is covered by prefix rule `pat` ("x*"): the same match as Claude Code.
const ruleCovers = (pat, inner) => pat.endsWith('*') && inner !== pat && inner.startsWith(pat.slice(0, -1));
/** Drops exact duplicates and each Bash rule that a broader prefix rule in the list covers. */
export function dedupeRules(rules) {
  const list = [...new Set(rules)];
  const bash = list.map((r) => r.match(/^Bash\((.*)\)$/)?.[1] ?? null);
  return list.filter((r, i) => bash[i] === null || !bash.some((b, j) => j !== i && b !== null && ruleCovers(b, bash[i])));
}

// The generic "Never" lines of a validator template: its own text in the
// @@IFNOT HAS_VALIDATOR_LIMITS@@ block (else every "Never" line), so they follow template edits.
const genericLines = (tmpl) => {
  const m = tmpl.match(/^@@IFNOT HAS_VALIDATOR_LIMITS@@\n([\s\S]*?)^@@END@@/m);
  return (m ? m[1] : tmpl).split('\n').filter((l) => /^- \*\*Never\b/.test(l));
};
const genericLimits = (tmpl) => genericLines(tmpl).join(' ');
const STOP = new Set(['a', 'an', 'the', 'to', 'or', 'and', 'any', 'in', 'of', 'on', 'from', 'no', 'other', 'never', 'it', 'its', 'by', 'with', 'for', 'outside']);
const words = (s) => String(s).toLowerCase().replace(/[`*()[\]:;.,"']/g, ' ').split(/\s+/)
  .map((w) => w.replace(/s$/, '')).filter((w) => w && !STOP.has(w));
/**
 * The project limits that a validator template does not already print: exact duplicates
 * and limits whose words all appear in the template's own "Never" lines are dropped,
 * so each limit shows once.
 */
export function extraLimits(limits, tmpl) {
  const have = new Set(words(genericLimits(tmpl)));
  const seen = new Set();
  return limits.filter((l) => {
    const key = words(l).join(' ');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !words(l).every((w) => have.has(w));
  });
}

const SECRET_RE = /secret|token|password|credential|\bkeys?\b/i;
/**
 * The complete "Never" lines of one validator: its generic lines (in the template's
 * @@IFNOT HAS_VALIDATOR_LIMITS@@ block) with the project limits they lack appended,
 * secret limits to the secrets line and the others to the first "Never" line.
 * Returns [] when no project limit is left, so the template prints its generic lines.
 */
export function mergeLimits(limits, tmpl) {
  const extra = extraLimits(limits, tmpl);
  if (!extra.length) return [];
  const lines = genericLines(tmpl);
  const secretAt = lines.findIndex((l) => /^- \*\*Never read or print\b/.test(l));
  const actionAt = lines.findIndex((l, i) => i !== secretAt);
  const add = (i, xs) => {
    if (!xs.length) return;
    if (i < 0) { lines.push(...xs.map((x) => '- **Never:** ' + x)); return; }
    lines[i] = lines[i].replace(/\.?\s*$/, '.') + ' Also never: ' + xs.join('; ') + '.';
  };
  const secret = extra.filter((x) => SECRET_RE.test(x)), action = extra.filter((x) => !SECRET_RE.test(x));
  add(secretAt >= 0 ? secretAt : actionAt, secret);
  add(actionAt, action);
  return lines;
}

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

  // changelog: the project's own validator command, when it has one (else the rendered script)
  const clValidateCmd = str(p.changelog?.validateCmd);
  const changelogValidate = clValidateCmd || `node .claude/scripts/changelog-validate.mjs --base origin/${base}`;

  const commandRows = [
    ['Install', st.installCmd], ['Test (full)', cmd.test], ['Test (one file)', cmd.testScoped],
    ['Test (end to end)', cmd.testE2e], ['Lint', cmd.lint],
    // a check-only lint row only when the stack has one (for example a lint:check script)
    ...(str(cmd.lintCheck) ? [['Lint (check only)', cmd.lintCheck]] : []),
    ['Format', cmd.format], ['Type check', cmd.typecheck], ['Build', cmd.build],
  ];
  // the repo's own rows (dev server, services, contract export), kept on every upgrade
  const extraRows = arr(st.extraCommands).map((x) => `| ${str(x.label)} | ${code(str(x.cmd))}${str(x.note) ? ' ' + str(x.note) : ''} |`);
  const commandsMd = '| What | Command |\n| --- | --- |\n' +
    [...commandRows.map(([k, v]) => `| ${k} | ${str(v) ? code(str(v)) : NA} |`), ...extraRows].join('\n');

  // allow rules: one prefix rule per real command
  const allowCmds = [...new Set([st.installCmd, ...Object.values(cmd)].map((c) => str(c)).filter(Boolean)
    .map((c) => c.replace(/\s*<[^>]*>.*$/, '').replace(/\s+"?\{?file\}?"?$/, '')))];
  // never a push or PR rule here (gh pr view/diff too): PR rules live only in the
  // "to PR" overlay of auto-pipeline.sh (lesson 1; verify.mjs checks it)
  const allow = [
    'Read(./**)', 'Edit(./**)',
    'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git show*)',
    'Bash(git branch --show-current)', 'Bash(git ls-files*)', 'Bash(git merge-base*)', 'Bash(git check-ignore*)',
    // the test-review revert check compares file hashes before and after (every mode)
    'Bash(git hash-object*)',
    'Bash(grep *)', 'Bash(ls *)', 'Bash(diff *)', 'Bash(cp .plans/*)', 'Bash(mkdir -p .plans/*)',
    'Bash(gh issue view*)', 'Bash(gh run view*)',
    ...allowCmds.map((c) => `Bash(${c}*)`),
    ...(moduleOn(p, 'codex') ? CODEX_ALLOW : []),
    ...(moduleOn(p, 'step-gate') ? ['Bash(bash .claude/scripts/workflow-complete-step.sh*)'] : []),
    ...(moduleOn(p, 'changelog') ? [clValidateCmd ? `Bash(${clValidateCmd})` : 'Bash(node .claude/scripts/changelog-validate.mjs*)'] : []),
    ...arr(r.extraAllow),
  ];
  // deny: destructive commands only. Never a plain push or PR rule: deny beats every
  // allow rule, also the per-run --allowedTools overlay of the "to PR" mode (lesson 1).
  // A force push and a new repo are destructive and no skill uses them, so they stay denied.
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
  if (moduleOn(p, 'codex')) runExtra.push(...CODEX_RUN_ALLOW);

  // service check before a run (skill-auto-pipeline Step 0)
  const services = arr(p.pipeline?.services).map((s) => ({ name: str(s.name), url: str(s.url), container: str(s.container) }));
  const servicesMd = services.map((s) => s.url
    ? `   - ${s.name}: \`curl -sf -o /dev/null ${s.url}\` exits with 0.`
    : `   - ${s.name}: \`docker inspect -f {{.State.Running}} ${s.container}\` prints \`true\`.`).join('\n');
  if (services.some((s) => s.url)) runExtra.push('Bash(curl -sf -o /dev/null *)');
  if (services.some((s) => s.container)) runExtra.push('Bash(docker inspect -f {{.State.Running}} *)');

  // commands every run needs (generators the checks or the browser test read): the
  // launcher runs each once in the new worktree before the session starts (preflight)
  const preflight = arr(p.pipeline?.preflight).map((c) => str(c)).filter(Boolean);
  runExtra.push(...preflight.map((c) => `Bash(${c})`));

  // browser test of a web UI (skill-1-plan section, skill-3-test step, skill-5-ship gate)
  const reg = p.registry || {};
  const hasBrowserTest = reg.browserTest === true && reg.role !== 'backend' && Boolean(str(reg.appUrl));
  if (hasBrowserTest) {
    // the session writes the full path (/Users/<me>/.claude/...), and a rule does not expand
    // "~": keep the "~" rules for a typed "~" and add the $HOME ones (expanded by bash)
    const bt = '.claude/skills/browser-usability-test';
    runExtra.push(`Read(~/${bt}/**)`, 'Read(~/.claude/browser-usability-test/**)',
      `Bash(node ~/${bt}/scripts/*)`, `Bash(QA_*=* node ~/${bt}/scripts/*)`,
      `Bash(node $HOME/${bt}/scripts/*)`, `Bash(QA_*=* node $HOME/${bt}/scripts/*)`,
      // the evidence step checks that each picture link loads (HTTP status only)
      'Bash(curl -s -o /dev/null -w *)');
  }

  // tickets: evidence comment and board status (skill-5-ship)
  const tickets = g.tickets || {};
  const hasTickets = tickets.evidence === true || Boolean(tickets.board);
  const board = tickets.board || null;
  if (hasTickets) runExtra.push('Bash(gh issue view*)', 'Bash(gh issue comment*)');
  if (board) runExtra.push('Bash(gh project field-list*)', 'Bash(gh project item-list*)', 'Bash(gh project item-edit*)', 'Bash(gh project view*)');

  // hard-rule blocks
  const hardMd = hard.map((h) => `- **${h.title}.** ${h.rule}` + sub(h.details)).join('\n');
  const huntMd = hard.map((h) => `- **${h.title}:** the plan breaks or skips the rule "${h.rule}"` + sub(h.details)).join('\n');
  const checklistMd = hard.map((h) => `- [ ] ${h.title} respected`).join('\n');
  const planCheckMd = hard.map((h) => `- **${h.title}.** ${h.rule} How does the plan keep this rule?` + sub(h.details)).join('\n');
  const ruleTestsMd = hard.filter((h) => h.tests.length).map((h) => `- **${h.title}:**` + sub(h.tests)).join('\n');
  const ruleDetailsMd = hard.filter((h) => h.details.length).map((h) => `- **${h.title}:**` + sub(h.details)).join('\n');
  const limits = arr(r.validatorLimits).map((x) => str(x)).filter(Boolean);
  let n = 2;
  // check-only: an audit that fixes files proves nothing
  const lintRow = str(cmd.lintCheck)
    ? `${code(str(cmd.lintCheck))} (AGENTS.md, Commands, "Lint (check only)") and a format command that only checks, on the changed files. Never a \`--fix\` command. Error and warning counts.`
    : 'The check-only lint and format commands of AGENTS.md, Commands, on the changed files. Never a `--fix` command; with only a fixing command, report "check-only command not available yet". Error and warning counts.';
  const auditRows = [`| ${n} | Lint and format | ${lintRow} |`];
  for (const h of hard) {
    const how = [h.check, ...h.details].filter(Boolean).map((x) => x.replace(/\|/g, '\\|'));
    auditRows.push(`| ${++n} | ${h.title} | ${h.rule.replace(/\|/g, '\\|')}${how.length ? ' Check: ' + how.join(' ') : ''} Name the file:line of each place you checked. |`);
  }
  // a hard rule about contracts already covers this row (no duplicate rule)
  const contractInRules = hard.some((h) => /contract/i.test(h.title));
  if (!contractInRules) auditRows.push(`| ${++n} | Contracts | ${contractsRule} |`);
  auditRows.push(`| ${++n} | JSDoc | Every new or changed public function has a doc comment in ASD-STE100. Report only what the diff added or changed. |`);
  auditRows.push(`| ${++n} | Tests | Every test in the plan's **Tests** list exists, and each rule above that the change touches has a test that fails when the rule breaks. |`);
  // a hard rule about secrets already covers this row (no duplicate row)
  const secretsInRules = hard.some((h) => /secret/i.test(h.title));
  if (!secretsInRules) auditRows.push(`| ${++n} | Secrets | No keys, passwords, tokens or private paths in the code or fixtures. Fixtures use made-up data only. |`);
  auditRows.push(`| ${++n} | Plan scope | Every plan step is done. No file outside **Affected files** changed without a reason in the summary. No open owner decision taken silently. |`);

  // layout
  const layoutRows = arr(ly.folders).map((f) => `| ${code(str(f.path))} | ${str(f.what)} |`);
  const layoutMd = layoutRows.length ? '| Path | What |\n| --- | --- |\n' + layoutRows.join('\n')
    : 'No code yet. Add one row per top-level folder when the first code lands.';
  const roots = [...new Set([...arr(ly.folders).map((f) => str(f.path).replace(/^\.\//, '').replace(/\/?$/, '/')), 'docs/', 'scripts/', '.github/'])];
  const rootFiles = [...new Set([...arr(ly.rootFiles), 'AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore',
    ...(str(st.manifest) ? [str(st.manifest)] : []), ...(parent.includes('/') ? [] : [parent])])];
  const softFiles = [...new Set([...arr(ly.softFiles), '.gitignore', ...(str(st.manifest) ? [str(st.manifest)] : []), ...arr(st.lockfiles)])];

  // changelog: the customer-note languages and the file whose version each PR raises
  const clLocales = arr(p.changelog?.locales).length ? arr(p.changelog.locales) : ['en'];
  const clVersionFile = str(p.changelog?.versionFile);

  // base and prod can be one branch (PRs go straight to main): name it once
  const branchList = [...new Set([base, staging, prod].filter(Boolean))];
  const branchChain = branchList.length > 1 ? branchList.join(' → ') : `${base} only`;
  const protectedBranches = base === prod ? `\`${base}\`` : `\`${base}\` or \`${prod}\``;
  const merge = str(g.mergeStyle, 'squash');
  const pel = st.postEditLint || {};
  const exts = arr(pel.extensions).map((e) => String(e).replace(/^\*?\.?/, ''));
  // oxfmt and prettier fail on a file they ignore (a gitignored or .prettierignore path);
  // the flag keeps such a file from failing the hook
  const fmtCmd = str(pel.format);
  const formatFileCmd = /(^|[\s/])(oxfmt|prettier)(\s|$)/.test(fmtCmd) && !fmtCmd.includes('--no-error-on-unmatched-pattern')
    ? `${fmtCmd} --no-error-on-unmatched-pattern` : fmtCmd;

  // the pipeline order in AGENTS.md: the same as skill-auto-pipeline
  const chain = ['`/skill-2-implement`', '`/skill-3-test`',
    `\`/skill-4-verify\` (\`/code-review\` loop + rule audit${moduleOn(p, 'test-review') ? ', then `/test-review --fix`' : ''})`,
    'plan to `.plans/done/` and one commit for the whole plan',
    ...(moduleOn(p, 'decision-sheet') ? ['`/decision-sheet`'] : []), '`/skill-5-ship` (draft PR)'].join(' → ');

  // a migration that a generator writes has no file name in the plan: these words count too
  const migrationHints = arr(ly.migrationHints).length ? arr(ly.migrationHints).map((x) => str(x)).filter(Boolean) : ['migration:generate'];

  // the CI steps the changelog gate needs before a project command (package manager, node, install)
  const pm = str(st.packageManager);
  const clCiSetup = [];
  if (clValidateCmd && ['pnpm', 'npm', 'yarn'].includes(clValidateCmd.split(/\s+/)[0])) {
    if (pm === 'pnpm') clCiSetup.push('      - uses: pnpm/action-setup@v6');
    clCiSetup.push('      - uses: actions/setup-node@v7', '        with:',
      str(st.nodeVersionFile) ? `          node-version-file: ${str(st.nodeVersionFile)}` : '          node-version: lts/*',
      ...(['pnpm', 'npm', 'yarn'].includes(pm) ? [`          cache: ${pm}`] : []));
    const ciInstall = { pnpm: 'pnpm install --frozen-lockfile', npm: 'npm ci', yarn: 'yarn install --frozen-lockfile' }[pm];
    if (ciInstall) clCiSetup.push(`      - run: ${ciInstall}`);
  }

  const vars = {
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
    PROTECTED_BRANCHES: protectedBranches,
    PACKAGE_RULE: str(st.installCmd) ? 'Use the latest package versions: install them with the package manager, never type a version by hand.'
      : 'Add a package only with the owner\'s yes. Then install its latest version with the package manager, never type a version by hand.',
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
    RUN_EXTRA_ALLOW_BASH: bashWords([...new Set(runExtra)]),
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
    SETTINGS_ALLOW: JSON.stringify(dedupeRules(allow), null, 2).replace(/\n/g, '\n    '),
    SETTINGS_DENY: JSON.stringify(deny, null, 2).replace(/\n/g, '\n    '),
    SETTINGS_HOOKS: JSON.stringify(hooks, null, 2).replace(/\n/g, '\n  '),
    LINT_FIX_FILE_CMD: str(pel.fix),
    SECRETS_IN_RULES: secretsInRules,
    FORMAT_FILE_CMD: formatFileCmd,
    PIPELINE_CHAIN: chain,
    // optional stack facts: unset keeps the generic "when the project has ..." text
    HAS_HTTP_API: st.httpApi !== false,
    HAS_MIGRATIONS: st.migrations !== false,
    HAS_LINT_CHECK: Boolean(str(cmd.lintCheck)),
    LINT_CHECK_CMD: str(cmd.lintCheck),
    HAS_TEST_HARNESS_DOC: Boolean(str(ly.testHarnessDoc)),
    TEST_HARNESS_DOC: str(ly.testHarnessDoc),
    HAS_SOFT_FILES: arr(ly.softFiles).length > 0,
    SOFT_FILES_MD: arr(ly.softFiles).map((f) => `- ${code(str(f))}`).join('\n'),
    LINT_CHECK_STEP: str(cmd.lintCheck) ? `then the "Lint (check only)" row (${code(str(cmd.lintCheck))}).` : 'then the "Lint (check only)" row when the table has one.',
    LINT_CHECK_USE: str(cmd.lintCheck) ? `Use the "Lint (check only)" row of the \`AGENTS.md\` **Commands** table (${code(str(cmd.lintCheck))}),`
      : 'Use the "Lint (check only)" row of the `AGENTS.md` **Commands** table when it has one,',
    TEST_HARNESS_READ: str(ly.testHarnessDoc) ? `Read ${code(str(ly.testHarnessDoc))} and the nested \`AGENTS.md\` of the test folder first.`
      : 'Read the nested `AGENTS.md` of the test folder first, if there is one.',
    // the per-file lint and format commands (stack.postEditLint) for test-review
    FILE_LINT_HINT: (str(pel.fix) || formatFileCmd)
      ? 'the per-file commands: ' + [str(pel.fix), formatFileCmd].filter(Boolean).map((c) => code(`${c} <file>`)).join(' and ')
      : 'for example the per-file commands of the post-edit lint hook, when the repo has one',
    MIGRATIONS_GAP: st.migrations === false ? '' : 'Migrations, ',
    ENDPOINT_GAP: st.httpApi === false ? '' : 'a new endpoint without an Endpoint access row, when the project has an HTTP API; end-to-end tests that do not cover success, validation error, 401/403, 404 (and another tenant, when the project is multi-tenant) for each endpoint; ',
    LANES_MIGRATION_HINTS: jsList(migrationHints),
    CHANGELOG_VALIDATE: changelogValidate,
    HAS_CHANGELOG_CMD: Boolean(clValidateCmd),
    CHANGELOG_CI_SETUP: clCiSetup.join('\n'),
    HAS_CHANGELOG_CI_SETUP: clCiSetup.length > 0,
    HAS_MAKEFILE: false, // set by renderAll from the repo files
    TYPECHECK_CMD: str(cmd.typecheck),
    LINT_EXTENSIONS_CASE: exts.length ? exts.map((e) => `*.${e}`).join('|') : '*.__none__',
    // the setup date: from firstPlanTs (saved on the first render), so an upgrade keeps it
    TODAY: p.firstPlanTs
      ? `${p.firstPlanTs.slice(0, 4)}-${p.firstPlanTs.slice(4, 6)}-${p.firstPlanTs.slice(6, 8)}`
      : now.toISOString().slice(0, 10),
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
    // the rendered validator always accepts `summary`; a project validator
    // (changelog.validateCmd) has its own field list, so it says so with changelog.summary
    CHANGELOG_SUMMARY: typeof p.changelog?.summary === 'boolean' ? p.changelog.summary : !clValidateCmd,
    MOD_DECISION_SHEET: moduleOn(p, 'decision-sheet'),
    MOD_TEST_REVIEW: moduleOn(p, 'test-review'),
    MOD_STEP_GATE: moduleOn(p, 'step-gate'),
    MOD_POST_EDIT_LINT: moduleOn(p, 'post-edit-lint'),
    MOD_PLANS_PARALLEL: moduleOn(p, 'plans-parallel'),
    MOD_PR_FEEDBACK: moduleOn(p, 'pr-feedback'),
    MOD_RUN_SKILL: moduleOn(p, 'run-skill'),
    HAS_SERVICES: services.length > 0,
    SERVICES_CHECKS: servicesMd,
    HAS_BROWSER_TEST: hasBrowserTest,
    APP_URL: str(reg.appUrl),
    HAS_TICKETS: hasTickets,
    HAS_BOARD: Boolean(board),
    BOARD_OWNER: board ? str(board.owner) : '',
    BOARD_NUMBER: board ? String(board.number) : '',
    BOARD_STATUS: board ? str(board.status) : '',
    PREFLIGHT_BASH: bashWords(preflight),
    CHANGELOG_LOCALES: clLocales.map(code).join(', '),
    CHANGELOG_LOCALES_JS: jsList(clLocales),
    CHANGELOG_LOCALES_YAML: clLocales.map((l, i) => (i ? `  ${l}: <the ${clLocales[0]} text, translated to ${l}>` : `  ${l}: You can now add a note to an order. The note shows on the order page and in the order email.`)).join('\n'),
    CHANGELOG_VERSION_FILE: clVersionFile,
    HAS_VERSION_BUMP: Boolean(clVersionFile),
    // the browser-usability-test profile name (default: the project name)
    BROWSER_TEST_PROJECT: hasBrowserTest ? str(reg.browserTestProject, pr.name) : '',
  };
  // one shared block for every skill that reports (templates/partials/reporting-rules.md)
  vars.REPORTING_RULES = renderText(readFileSync(path.join(TEMPLATES, 'partials', 'reporting-rules.md'), 'utf8'),
    vars, 'templates/partials/reporting-rules.md').replace(/\n+$/, '');
  return vars;
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
export function renderAll(params, { upgrade = false, now = new Date(), repo = null } = {}) {
  const vars = buildVars(params, now);
  if (repo) vars.HAS_MAKEFILE = hasMakefile(repo);
  const limits = arr(params.rules?.validatorLimits).map((x) => str(x)).filter(Boolean);
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
    if (p === '.claude/scripts/changelog-validate.mjs' && vars.HAS_CHANGELOG_CMD) {
      // the project has its own validator (changelog.validateCmd): no second one
      files.set(p, { path: p, content: '', kind: 'orphan', note: 'changelog.validateCmd is set, so this script is unused; delete by hand' });
      continue;
    }
    if (p === '.plans/first-plan.md') {
      if (upgrade) continue;
      p = `.plans/${vars.FIRST_PLAN_TS}-check-the-pipeline-end-to-end.md`;
      kind = 'first-plan';
    }
    let content;
    const tmpl = readFileSync(s.abs, 'utf8');
    // a validator prints each limit once: drop the project limits its own "Never" lines cover
    let fileVars = vars;
    if (tmpl.includes('@@VALIDATOR_LIMITS@@')) {
      const merged = mergeLimits(limits, tmpl);
      fileVars = { ...vars, VALIDATOR_LIMITS: merged.join('\n'), HAS_VALIDATOR_LIMITS: merged.length > 0 };
    }
    try { content = renderText(tmpl, fileVars, path.relative(SKILL_DIR, s.abs)); } catch (e) { die(e.message); }
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

/** Returns true when the repo has a Makefile (any folder), so .editorconfig gets its tab block. */
function hasMakefile(repo) {
  if (['Makefile', 'makefile', 'GNUmakefile'].some((f) => existsSync(path.join(repo, f)))) return true;
  try {
    return execFileSync('git', ['ls-files', '--', '*Makefile', '*makefile', '*.mk'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
  } catch { return false; }
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
// one setting of a CONFIG block: `NAME=…` (bash) or `const NAME = …` (JS)
const settingName = (l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1] ?? l.match(/^const ([A-Z][A-Z0-9_]*) =/)?.[1] ?? null;
/**
 * The settings of the rendered block that the repo block lacks (a template update added
 * them), each with its comment lines, so a kept block still defines every setting the
 * generic code reads. A JS setting runs to the line that ends with ";".
 */
export function newSettings(currentBlock, renderedBlock) {
  const have = new Set(currentBlock.map(settingName).filter(Boolean));
  const out = [];
  let comments = [];
  for (let i = 0; i < renderedBlock.length; i++) {
    const l = renderedBlock[i], name = settingName(l);
    if (/^\s*(#|\/\/)/.test(l)) { comments.push(l); continue; }
    if (!name) { comments = []; continue; }
    const lines = [l];
    while (l.startsWith('const ') && !lines.at(-1).trimEnd().endsWith(';') && i + 1 < renderedBlock.length) lines.push(renderedBlock[++i]);
    if (!have.has(name)) out.push(...comments, ...lines);
    comments = [];
  }
  return out;
}
export function keepConfig(current, rendered) {
  const c = current.split('\n'), r = rendered.split('\n');
  const cb = configBlock(c), rb = configBlock(r);
  if (!cb || !rb) return null;
  const added = newSettings(c.slice(cb[0] + 1, cb[1]), r.slice(rb[0] + 1, rb[1]));
  return [...r.slice(0, rb[0]), ...c.slice(cb[0], cb[1]), ...added, c[cb[1]], ...r.slice(rb[1] + 1)].join('\n');
}

/**
 * Returns true when the folder `dir` loads its AGENTS.md: a CLAUDE.md that is only `@AGENTS.md`,
 * or a `.claude/CLAUDE.md` that is only `@../AGENTS.md`. Claude Code reads both locations as
 * project instructions (code.claude.com/docs/en/memory).
 */
export function hasShim(dir, read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null)) {
  return (read(path.join(dir, 'CLAUDE.md')) || '').trim() === '@AGENTS.md'
    || (read(path.join(dir, '.claude', 'CLAUDE.md')) || '').trim() === '@../AGENTS.md';
}

export function plan(repo, files, { resetConfig = false } = {}) {
  // only open plans count: an adopted repo with finished plans in .plans/done/ still
  // gets the end-to-end check plan for its first pipeline run
  const planHasPlans = (() => {
    const d = path.join(repo, '.plans');
    return existsSync(d) && readdirSync(d).some((f) => f.endsWith('.md'));
  })();
  return files.flatMap((f) => {
    const abs = path.join(repo, f.path);
    if (f.kind === 'first-plan' && planHasPlans) return [];
    if (f.kind === 'once' && existsSync(abs)) return [];
    if (f.kind === 'orphan') return existsSync(abs) ? [{ ...f, status: 'orphan', note: f.note || `module "${f.module}" is off; delete by hand if unused` }] : [];
    // the root CLAUDE.md has another job (for example global rules linked into ~/.claude/), and
    // .claude/CLAUDE.md loads AGENTS.md instead: leave the root file alone
    if (f.path === 'CLAUDE.md' && existsSync(abs) && readFileSync(abs, 'utf8').trim() !== '@AGENTS.md'
      && (existsSync(path.join(repo, '.claude', 'CLAUDE.md')) ? readFileSync(path.join(repo, '.claude', 'CLAUDE.md'), 'utf8') : '').trim() === '@../AGENTS.md') return [];
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
      const kept = keepConfig(cur, content);
      if (kept !== null) content = kept;
      // the lines that still differ after the new settings moved in
      diff = configDiff(kept ?? cur, f.content);
      if (diff.length) note = 'CONFIG differs: yours is kept (new settings added); --reset-config --apply <path> takes the answers';
      else if (kept !== null && configDiff(cur, kept).length) note = 'CONFIG: new settings added to yours';
    }
    const status = cur !== content ? 'changed' : diff.length ? 'config' : 'same';
    return [{ ...f, content, note, diff, status }];
  });
}

/**
 * A fingerprint of what the templates make from these answers, before the repo's own files
 * are mixed in (no kept CONFIG blocks, no .gitignore merge), so a file the owner edited on
 * purpose does not change it. A fixed date keeps it the same from day to day.
 */
export function renderHash(params, repo) {
  const h = createHash('sha256');
  const files = renderAll(params, { upgrade: true, now: new Date(0), repo })
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) h.update(`${f.path}\0${f.kind}\0${f.content}\0`);
  return h.digest('hex').slice(0, 16);
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
    else if (a === '--status') opt.status = true;
    else if (a === '--unused') opt.unused = true;
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

  if (opt.unused) {
    const items = unusedParts(params, repo);
    if (opt.json) { console.log(JSON.stringify(items, null, 2)); return; }
    const titles = { module: 'Modules that are off', registration: 'Registrations that are off', command: 'Commands not found', setting: 'Settings left empty', plan: 'Not made by this skill (add them in a plan)' };
    let n = 0;
    for (const [g, title] of Object.entries(titles)) {
      const rows = items.filter((i) => i.group === g);
      if (!rows.length) continue;
      console.log(`${title}:`);
      for (const i of rows) console.log(`  ${++n}. ${i.key}: ${i.what}\n       to turn on: ${i.turnOn}`);
    }
    if (!n) console.log('Everything the skill can set up is in use.');
    return;
  }
  if (opt.status) {
    const counts = {};
    for (const f of plan(repo, renderAll(params, { upgrade: true, repo }))) counts[f.status] = (counts[f.status] || 0) + 1;
    console.log(JSON.stringify({ hash: renderHash(params, repo), saved: params.renderHash || null, counts }));
    return;
  }
  if (!params.firstPlanTs && !opt.upgrade) {
    // record the timestamp once, so the preview and --apply name the first plan the same
    params.firstPlanTs = stamp(new Date());
    writeFileSync(paramsFile, JSON.stringify(params, null, 2) + '\n');
  }
  const rows = plan(repo, renderAll(params, { upgrade: opt.upgrade, repo }), { resetConfig: opt.resetConfig });
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
    // the owner has decided about this render (files not taken are kept on purpose), so the
    // dashboard stops showing "update available" until the templates or the answers change
    params.renderHash = renderHash(params, repo);
    writeFileSync(paramsFile, JSON.stringify(params, null, 2) + '\n');
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
