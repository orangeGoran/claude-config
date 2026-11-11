#!/usr/bin/env node
// register.mjs — print the commands that register a bootstrapped repo outside the repo.
//
//   node register.mjs <repo> [--params <file>] [--registry <file>] [--qa-home <dir>]
//
// It prints shell commands and runs nothing. Claude Code refuses edits under
// ~/.claude with Edit/Write, so the owner approves these commands and Claude runs them
// with the Bash tool (or the owner runs them by hand). It reads the registry only to say
// whether the entry is new, an update, or a clash with another name for the same root.
//
// --registry <file>  use this registry instead of ~/.claude/pipeline-projects.json
//                    (for a test run on a temp copy)
// --qa-home <dir>    the browser-usability-test projects folder (default
//                    ~/.claude/browser-usability-test/projects; profile.mjs reads QA_HOME)
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkParams } from './render.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_REPO = path.resolve(SKILL_DIR, '..', '..');
const die = (m) => { console.error('register: ' + m); process.exit(1); };
const tilde = (p) => (p.startsWith(homedir() + '/') ? '~' + p.slice(homedir().length) : p);
const untilde = (p) => p.replace(/^~(?=\/|$)/, homedir());
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// quote a path for the shell, but keep a leading ~/ outside the quotes so it expands
const qp = (p) => (p.startsWith('~/') ? '~/' + sq(p.slice(2)) : sq(p));

const argv = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--params') opt.params = argv[++i];
  else if (argv[i] === '--registry') opt.registry = argv[++i];
  else if (argv[i] === '--qa-home') opt.qaHome = argv[++i];
  else if (argv[i].startsWith('--')) die('unknown option ' + argv[i]);
  else pos.push(argv[i]);
}
const repo = pos[0] ? path.resolve(pos[0]) : die('usage: register.mjs <repo>');
const paramsFile = opt.params ? path.resolve(opt.params) : path.join(repo, '.claude', 'bootstrap.json');
let p;
try { p = JSON.parse(readFileSync(paramsFile, 'utf8')); } catch (e) { die(`${paramsFile}: ${e.message}`); }
const errs = checkParams(p);
if (errs.length) die('the answers file has problems:\n  - ' + errs.join('\n  - '));

const reg = p.registry || {};
const registry = opt.registry ? path.resolve(opt.registry) : path.join(homedir(), '.claude', 'pipeline-projects.json');
const root = tilde(repo);

// --- dashboard registry -------------------------------------------------------------
if (reg.dashboard !== false) {
  // pipeline mode: auto-pipeline.sh exists, so the dashboard ignores launchers
  const entry = { name: p.project.name, client: p.project.client || 'Default', root, plansDir: root + '/.plans', launchers: [] };
  if (p.project.short) entry.short = p.project.short;
  if (reg.color) entry.color = reg.color;

  let state = 'new entry';
  if (existsSync(registry)) {
    let cur;
    try { cur = JSON.parse(readFileSync(registry, 'utf8')); } catch (e) { die(`${registry} is not valid JSON: ${e.message}. Fix it by hand first.`); }
    const projects = Array.isArray(cur.projects) ? cur.projects : [];
    const same = projects.find((x) => x.name === entry.name);
    const sameRoot = projects.find((x) => x.name !== entry.name && path.resolve(untilde(x.root || '')) === repo);
    if (sameRoot) die(`the registry already has this repo as "${sameRoot.name}". Use that name in bootstrap.json (project.name), or remove the old entry by hand.`);
    if (same && path.resolve(untilde(same.root || '')) !== repo) die(`the registry already has a project "${entry.name}" at ${same.root}. Pick another project.name in bootstrap.json; the merge would point that project at this repo.`);
    if (same) state = 'update of the existing entry (its other fields stay)';
  } else state = 'new registry file + new entry';

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const r = qp(tilde(registry));
  console.log(`# 1. Plans dashboard registry: ${state}`);
  console.log(`#    ${r}`);
  console.log(`#    entry: ${JSON.stringify(entry)}`);
  if (!existsSync(registry)) console.log(`printf '{"projects":[]}\\n' > ${r}`);
  console.log(`cp ${r} ${r}.bak-${stamp}`);
  console.log(`jq --argjson e ${sq(JSON.stringify(entry))} '.projects |= (if any(.[]; .name == $e.name) then map(if .name == $e.name then . + $e else . end) else . + [$e] end)' ${r} > ${r}.tmp`);
  console.log(`mv ${r}.tmp ${r}`);
  console.log(`jq -e --arg n ${sq(entry.name)} '.projects[] | select(.name == $n)' ${r}`);
  console.log('');
} else {
  console.log('# 1. Plans dashboard registry: skipped (registry.dashboard is false)\n');
}

// --- browser-usability-test profile ---------------------------------------------------
if (reg.browserTest) {
  const qaHome = opt.qaHome ? path.resolve(opt.qaHome) : path.join(homedir(), '.claude', 'browser-usability-test', 'projects');
  const profileDir = path.join(qaHome, p.project.name);
  const profileScript = path.join(CONFIG_REPO, 'skills', 'browser-usability-test', 'scripts', 'profile.mjs');
  const env = opt.qaHome ? `QA_HOME=${sq(qaHome)} ` : '';
  const role = reg.role || 'backend';
  console.log('# 2. browser-usability-test profile (artifact-copies --save and /browser-usability-test find the project by it)');
  if (!existsSync(profileScript)) {
    console.log(`#    skipped: ${tilde(profileScript)} is missing (install the browser-usability-test skill first)\n`);
    process.exit(0);
  }
  if (!existsSync(path.join(CONFIG_REPO, 'skills', 'browser-usability-test', 'node_modules'))) {
    console.log(`npm install --prefix ${qp(tilde(path.dirname(path.dirname(profileScript))))}`);
  }
  if (existsSync(path.join(profileDir, 'project.json'))) {
    console.log(`#    the project exists: add this repo to it`);
    console.log(`cd ${sq(repo)}`);
    console.log(`${env}node ${qp(tilde(profileScript))} add-repo ${sq(p.project.name)} ${sq(role)}`);
  } else {
    console.log(`cd ${sq(repo)}`);
    console.log(`${env}node ${qp(tilde(profileScript))} init ${sq(p.project.name)} ${sq(role)}`);
  }
  if (reg.appUrl) {
    const pj = qp(tilde(path.join(profileDir, 'project.json')));
    console.log(`cp ${pj} ${pj}.bak`);
    console.log(`jq --arg u ${sq(reg.appUrl)} '.app.url = $u' ${pj} > ${pj}.tmp`);
    console.log(`mv ${pj}.tmp ${pj}`);
  }
  console.log('');
} else {
  console.log('# 2. browser-usability-test profile: skipped (registry.browserTest is false)\n');
}
