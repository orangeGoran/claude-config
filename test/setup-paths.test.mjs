// The setup scripts and the npm scripts name files that exist in this checkout. The whole scripts
// are not run, because setup changes the real login service (docs/plans-dashboard.md): the tests run
// only the lines that build the plist and pick the port, on temp files.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plistPort, plistScript } from '../apps/dashboard/restart.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(REPO, 'scripts');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
// the shell values every setup script sets: HERE is scripts/, REPO is the folder above it
const expand = (s) => s.replaceAll('$REPO', REPO).replaceAll('$HERE', SCRIPTS);
const REPO_LINE = 'REPO="$(cd "$HERE/.." && pwd)"';

// runs the lines of setup-macos.sh from the line that starts with `from` to the line that starts with `to`, in bash
const runPart = (from, to, env, tail) => {
  const lines = read('scripts/setup-macos.sh').split('\n');
  const a = lines.findIndex((l) => l.startsWith(from)), b = lines.findIndex((l, i) => i > a && l.startsWith(to));
  assert.ok(a >= 0 && b > a, `setup-macos.sh has the lines ${from} … ${to}`);
  return spawnSync('bash', ['-euo', 'pipefail', '-c', lines.slice(a, b + 1).join('\n') + '\n' + tail], { env: { ...process.env, ...env }, encoding: 'utf8' });
};
const isMac = process.platform === 'darwin';
// the twin of runPart for setup.sh: its blocks are indented, so the marker lines are matched after trim()
const runSetupPart = (from, to, env, stdin) => {
  const lines = read('scripts/setup.sh').split('\n');
  const a = lines.findIndex((l) => l.trim().startsWith(from)), b = lines.findIndex((l, i) => i > a && l.trim().startsWith(to));
  assert.ok(a >= 0 && b > a, `setup.sh has the lines ${from} … ${to}`);
  return spawnSync('bash', ['-euo', 'pipefail', '-c', lines.slice(a, b + 1).join('\n') + '\nprintf "APP=%s\\n" "$APP"'],
    { env: { ...process.env, ...env }, input: stdin ?? '', encoding: 'utf8' });
};

test('setup-macos.sh writes the path of the dashboard server into the login service, also when the path has & or |', { skip: !isMac }, () => {
  const sh = read('scripts/setup-macos.sh');
  assert.ok(sh.includes(REPO_LINE), 'REPO is the folder above scripts/');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'setup-plist-'));
  try {
    const plist = path.join(dir, 'new.plist');
    for (const repo of [REPO, '/Users/ana/R&D|x/claude-config']) {
      const r = runPart('cp "$HERE/launchd/com.plans-dashboard.plist.template"', 'plutil -replace EnvironmentVariables.DASH_PORT',
        { HERE: SCRIPTS, REPO: repo, NODE: '/usr/local/bin/node', STATE: '/tmp/a&b', PORT: '4920', NEW_PLIST: plist }, '');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(spawnSync('plutil', ['-lint', plist]).status, 0, 'plutil reads the plist');
      const xml = readFileSync(plist, 'utf8');
      assert.equal(plistScript(xml), path.join(repo, 'apps', 'dashboard', 'server.mjs'));
      assert.equal(plistPort(xml), 4920);
      assert.doesNotMatch(xml, /__[A-Z]+__/, 'every placeholder is filled');
    }
    assert.ok(existsSync(path.join(REPO, 'apps', 'dashboard', 'server.mjs')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup-macos.sh without --port keeps the port of the installed service, else 4899', { skip: !isMac }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'setup-port-'));
  try {
    const plist = path.join(dir, 'installed.plist');
    writeFileSync(plist, '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>EnvironmentVariables</key><dict><key>DASH_PORT</key><string>4920</string></dict></dict></plist>\n');
    const port = (env) => runPart('if [ -z "$PORT" ]; then', 'fi', env, 'printf %s "$PORT"').stdout;
    assert.equal(port({ PORT: '', PLIST: plist }), '4920', 'a re-run keeps 4920');
    assert.equal(port({ PORT: '4930', PLIST: plist }), '4930', '--port wins');
    assert.equal(port({ PORT: '', PLIST: path.join(dir, 'none.plist') }), '4899', 'a first install gets 4899');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('setup.sh asks to build the Mac app, skips it without swiftc, and goes on when the build fails', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'setup-app-'));
  try {
    // a fake build.mjs: it writes its arguments to a file, and exits FAKE_CHECK for --check, else FAKE_BUILD
    mkdirSync(path.join(dir, 'repo', 'apps', 'plans-mac'), { recursive: true });
    const calls = path.join(dir, 'calls.txt');
    writeFileSync(path.join(dir, 'repo', 'apps', 'plans-mac', 'build.mjs'),
      `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`
      + `process.exit(+(process.argv[2] === '--check' ? process.env.FAKE_CHECK : process.env.FAKE_BUILD));\n`);
    const home = path.join(dir, 'home');
    const run = (env, stdin) => {
      rmSync(calls, { force: true });
      const r = runSetupPart('# --- Mac app ---', '# --- end Mac app ---', { REPO: path.join(dir, 'repo'), HOME: home, ...env }, stdin);
      const ran = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
      return { ...r, ran, app: /^APP=(.*)$/m.exec(r.stdout)?.[1] };
    };

    let r = run({ YES: '1', FAKE_CHECK: '0', FAKE_BUILD: '0' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.ran, [['--check'], []], 'the build runs with no arguments');
    assert.equal(r.app, path.join(home, 'Applications', 'Plans.app'));

    r = run({ YES: '0', FAKE_CHECK: '0', FAKE_BUILD: '0' }, 'n\n');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.ran, [['--check']], 'no build after "n"');
    assert.equal(r.app, '');

    r = run({ YES: '1', FAKE_CHECK: '1', FAKE_BUILD: '0' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.ran, [['--check']]);
    assert.match(r.stdout, /Mac app: skipped/);

    r = run({ YES: '1', FAKE_CHECK: '0', FAKE_BUILD: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /the build failed; setup goes on/);
    assert.equal(r.app, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // at the end, setup opens the app when it was built, else the dashboard URL
  const sh = read('scripts/setup.sh');
  assert.ok(sh.includes('open "${APP:-$url}" 2>/dev/null || true'));
  assert.ok(sh.includes(`printf '\\nDone. Opening %s — the guide there helps you add your repos.\\n' "\${APP:-$url}"`));
  assert.ok(!sh.includes('open "$url" 2>/dev/null'));
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
