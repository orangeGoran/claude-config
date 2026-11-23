// The setup scripts and the npm scripts name files that exist in this checkout. The scripts
// themselves are not run: setup changes the real login service (docs/plans-dashboard.md).
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(REPO, 'scripts');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
// the shell values every setup script sets: HERE is scripts/, REPO is the folder above it
const expand = (s) => s.replaceAll('$REPO', REPO).replaceAll('$HERE', SCRIPTS);
const REPO_LINE = 'REPO="$(cd "$HERE/.." && pwd)"';

test('setup-macos.sh writes the path of the dashboard server into the login service', () => {
  const sh = read('scripts/setup-macos.sh');
  assert.ok(sh.includes(REPO_LINE), 'REPO is the folder above scripts/');
  const m = /s\|__SCRIPT__\|([^|]+)\|/.exec(sh);
  assert.ok(m, 'the __SCRIPT__ replacement is there');
  assert.equal(expand(m[1]), path.join(REPO, 'apps', 'dashboard', 'server.mjs'));
  assert.ok(existsSync(expand(m[1])));
});

test('setup.sh installs the scout and names the dashboard server from this checkout', () => {
  const sh = read('scripts/setup.sh');
  assert.ok(sh.includes(REPO_LINE), 'REPO is the folder above scripts/');
  const scout = /node "([^"]+)" --install/.exec(sh);
  assert.ok(scout, 'the scout install line is there');
  assert.equal(expand(scout[1]), path.join(REPO, 'apps', 'scout', 'scout.mjs'));
  const tryLine = /To try the dashboard: node %s\/([^\\]+)\\n' "\$REPO"/.exec(sh);
  assert.ok(tryLine, 'the "To try the dashboard" line prints a path under $REPO');
  assert.ok(existsSync(path.join(REPO, tryLine[1])), `${tryLine[1]} exists`);
});

test('npm test runs every test file of the repo, and npm run restart names a file that exists', () => {
  const { scripts } = JSON.parse(read('package.json'));
  const restart = /^node (\S+)$/.exec(scripts.restart);
  assert.ok(restart && existsSync(path.join(REPO, restart[1])), `${scripts.restart} names a file that exists`);
  // each pattern of the test script as a regex: * matches one path part
  const globs = scripts.test.split(/\s+/).filter((a) => a.includes('*'))
    .map((g) => new RegExp('^' + g.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+') + '$'));
  assert.ok(globs.length > 0, 'the test script names its files');
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.test.mjs'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').filter((f) => f && existsSync(path.join(REPO, f)));
  assert.ok(files.length >= 4, 'git lists the test files');
  assert.deepEqual(files.filter((f) => !globs.some((g) => g.test(f))), [], 'every test file is in npm test');
});
