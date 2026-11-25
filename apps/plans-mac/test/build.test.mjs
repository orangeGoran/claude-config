// Tests for apps/plans-mac/build.mjs and the source of the Plans Mac app. No test starts the app.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appUrl, infoPlist, installApp, siteUrl } from '../build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'build.mjs');
const SWIFT = readFileSync(path.join(HERE, '..', 'src', 'main.swift'), 'utf8');
const APP_JS = readFileSync(path.join(HERE, '..', '..', 'dashboard', 'page', 'app.js'), 'utf8');
const IS_MAC = process.platform === 'darwin';
const canCompile = IS_MAC && spawnSync(process.execPath, [SCRIPT, '--check']).status === 0;

test('siteUrl gives the first site of the Caddy file, or null', () => {
  assert.equal(siteUrl('plans.test {\n\ttls internal\n}'), 'https://plans.test');
  assert.equal(siteUrl('dash.example.test {\n}'), 'https://dash.example.test');
  assert.equal(siteUrl('# made by setup-macos.sh {\ndash.example.test {\n}'), 'https://dash.example.test');
  // the same reading as apps/dashboard/server.mjs: a tab or no space before the brace
  assert.equal(siteUrl('dash.example.test\t{\n}'), 'https://dash.example.test');
  assert.equal(siteUrl('dash.example.test{\n}'), 'https://dash.example.test');
  assert.equal(siteUrl(''), null);
  assert.equal(siteUrl('nothing here'), null);
});

test('appUrl takes --url as given, else the Caddy site, else https://plans.test, and accepts only https', () => {
  assert.equal(appUrl({ flag: 'https://dash.example.test:8443' }), 'https://dash.example.test:8443');
  assert.equal(appUrl({ caddyText: 'dash.example.test {\n}' }), 'https://dash.example.test');
  assert.equal(appUrl({ caddyText: '' }), 'https://plans.test');
  assert.equal(appUrl({ flag: 'https://dash.example.test:8443', caddyText: 'plans.test {\n}' }), 'https://dash.example.test:8443', '--url wins over the Caddy site');
  assert.throws(() => appUrl({ flag: 'http://plans.test' }), /--url must be an https:\/\/ URL/);
  assert.throws(() => appUrl({ flag: 'not a url' }), /--url must be an https:\/\/ URL/);
});

test('infoPlist writes the bundle keys and an XML-escaped PlansURL', () => {
  const x = infoPlist({ url: 'https://dash.example.test/?a=1&b=2', version: '1.0' });
  assert.match(x, /<key>PlansURL<\/key>\s*<string>https:\/\/dash\.example\.test\/\?a=1&amp;b=2<\/string>/);
  assert.match(x, /<key>CFBundleIdentifier<\/key>\s*<string>com\.plans-dashboard\.mac<\/string>/);
  assert.match(x, /<key>CFBundleExecutable<\/key>\s*<string>Plans<\/string>/);
  assert.match(x, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
  assert.match(x, /<key>LSMinimumSystemVersion<\/key>\s*<string>13\.0<\/string>/);
  assert.doesNotMatch(x, /&b=/);
});

// the window.dashboard object of the page, as its key names
const pageHooks = () => {
  const m = /window\.dashboard = \{([^}]*)\}/.exec(APP_JS);
  assert.ok(m, 'app.js has window.dashboard = { … }');
  return [...m[1].matchAll(/(\w+):/g)].map((x) => x[1]);
};

test('every hook the Swift menu calls exists in the page, and the menu calls all eight', () => {
  const called = [...new Set([...SWIFT.matchAll(/call\("(\w+)\(/g)].map((m) => m[1]))];
  const page = pageHooks();
  for (const name of called) assert.ok(page.includes(name), `the page has window.dashboard.${name}`);
  assert.deepEqual(called.sort(), ['closeSession', 'focusChat', 'nextSession', 'openSearch', 'openSettings',
    'reopenSession', 'switchSession', 'toggleBoard']);
});

test('each menu key calls its hook', () => {
  // key equivalent → the action of its menu item → the call(…) of that action
  const actions = Object.fromEntries([...SWIFT.matchAll(/@objc func (\w+)\(_ sender: Any\?\) \{ call\("([^"]+)"\) \}/g)].map((m) => [m[1], m[2]]));
  const keys = {};
  for (const m of SWIFT.matchAll(/NSMenuItem\(title: "[^"]*", action: #selector\((\w+)\(_:\)\), keyEquivalent: "([^"]*)"\)/g))
    if (actions[m[1]]) keys[m[2]] = actions[m[1]];
  const want = {
    1: 'switchSession(1)', 2: 'switchSession(2)', 3: 'switchSession(3)', 4: 'switchSession(4)',
    5: 'switchSession(5)', 6: 'switchSession(6)', 7: 'switchSession(7)', 8: 'switchSession(8)', 9: 'switchSession(9)',
    '{': 'nextSession(-1)', '}': 'nextSession(1)', w: 'closeSession()', T: 'reopenSession()',
    k: 'openSearch()', l: 'focusChat()', b: 'toggleBoard()', ',': 'openSettings()',
  };
  for (const [k, hook] of Object.entries(want)) assert.equal(keys[k], hook, `⌘${k} → ${hook}`);
});

test('the delegates are set, and closing the window hides it and keeps the app running', () => {
  assert.match(SWIFT, /^let delegate = AppDelegate\(\)$/m);
  assert.match(SWIFT, /^app\.delegate = delegate$/m);
  assert.match(SWIFT, /window\.delegate = self/);
  assert.match(SWIFT, /web\.navigationDelegate = self/);
  assert.match(SWIFT, /web\.uiDelegate = self/);
  assert.match(SWIFT, /func applicationShouldTerminateAfterLastWindowClosed\([^)]*\) -> Bool \{\s*return false\s*\}/);
  assert.match(SWIFT, /func windowShouldClose\([^)]*\) -> Bool \{\s*window\.orderOut\(nil\)\s*return false\s*\}/);
  assert.match(SWIFT, /window\.initialFirstResponder = web/);
});

test('the macOS 14 line compiles with an older SDK, and alert() and confirm() show a hidden window first', () => {
  assert.match(SWIFT, /#if compiler\(>=5\.9\)\s*if #available\(macOS 14\.0, \*\) \{[^}]*inactiveSchedulingPolicy[^}]*\}\s*#endif/);
  assert.match(SWIFT, /func showForPanel\(\) \{[\s\S]{0,120}if !window\.isVisible \{ window\.makeKeyAndOrderFront\(nil\) \}/);
  for (const panel of ['runJavaScriptAlertPanelWithMessage', 'runJavaScriptConfirmPanelWithMessage']) {
    const body = SWIFT.slice(SWIFT.indexOf(panel));
    assert.ok(body.indexOf('showForPanel()') >= 0 && body.indexOf('showForPanel()') < body.indexOf('beginSheetModal'), panel);
  }
});

test('the menu calls go only to the app origin, and the app pages stay in the window', () => {
  // a hidden window gets no menu call (⌘W after ⇧⌘W closes no tab that nobody sees)
  assert.match(SWIFT, /func call\(_ js: String\) \{\s*guard window\.isVisible, sameOrigin\(web\.url\) else \{ return \}/);
  assert.match(SWIFT, /return a\.0 == b\.0 && a\.1 == b\.1 && a\.2 == b\.2/);
  assert.match(SWIFT, /url\.port \?\? \(scheme == "https" \? 443/);
  assert.match(SWIFT, /if scheme == "about" \|\| scheme == "data" \|\| scheme == "blob" \{ return decisionHandler\(\.allow\) \}/);
  // a link to another origin, and a vscode: or mailto: link, open outside and are cancelled in the window
  assert.match(SWIFT, /if scheme != "http" && scheme != "https" \{\s*NSWorkspace\.shared\.open\(url\)\s*return decisionHandler\(\.cancel\)\s*\}/);
  assert.match(SWIFT, /if navigationAction\.targetFrame\?\.isMainFrame == true && !sameOrigin\(url\) \{\s*NSWorkspace\.shared\.open\(url\)\s*return decisionHandler\(\.cancel\)\s*\}/);
});

test('target="_blank", window.open and downloads open in the default browser', () => {
  assert.match(SWIFT, /createWebViewWith[^{]*\{\s*if let url = navigationAction\.request\.url \{ NSWorkspace\.shared\.open\(url\) \}\s*return nil\s*\}/);
  assert.match(SWIFT, /if !navigationResponse\.canShowMIMEType, let url = url \{\s*NSWorkspace\.shared\.open\(url\)\s*return decisionHandler\(\.cancel\)\s*\}/);
});

test('confirm() answers true only for OK, the first of the two buttons', () => {
  const body = SWIFT.slice(SWIFT.indexOf('runJavaScriptConfirmPanelWithMessage'));
  assert.match(body, /a\.addButton\(withTitle: "OK"\)\s*a\.addButton\(withTitle: "Cancel"\)/);
  assert.match(body, /beginSheetModal\(for: window\) \{ r in completionHandler\(r == \.alertFirstButtonReturn\) \}/);
});

test('the waiting page: cancelled loads skip it, one timer, the failed plan link comes back, 502-504 show it', () => {
  assert.match(SWIFT, /guard e\.domain == NSURLErrorDomain, e\.code != NSURLErrorCancelled else \{ return \}/);
  assert.match(SWIFT, /retryURL = sameOrigin\(url\) \? url : appURL/);
  const wait = SWIFT.slice(SWIFT.indexOf('func showWaiting'));
  assert.ok(wait.indexOf('retry?.invalidate()') >= 0 && wait.indexOf('retry?.invalidate()') < wait.indexOf('Timer.scheduledTimer'),
    'the old timer stops before a new one starts');
  assert.match(SWIFT, /as\? HTTPURLResponse, sameOrigin\(url\),\s*\[502, 503, 504\]\.contains\(http\.statusCode\)[\s\S]{0,80}decisionHandler\(\.cancel\)\s*showWaiting\(/);
  // the timer loads the kept URL, so a failed plan link comes back to that plan
  assert.match(wait, /Timer\.scheduledTimer\(withTimeInterval: 5, repeats: false\)[\s\S]{0,120}self\.web\.load\(URLRequest\(url: self\.retryURL \?\? appURL\)\)/);
  // a certificate error (-1206 … -1200) shows the caddy trust hint
  assert.match(SWIFT, /showWaiting\(for: url, certificate: \(-1206 \.\.\. -1200\)\.contains\(e\.code\)\)/);
  assert.match(wait, /let hint = certificate \? "<p>Run <code>caddy trust<\/code>/);
  assert.match(SWIFT, /func webView\(_ webView: WKWebView, didFinish[^{]*\{\s*if sameOrigin\(webView\.url\) \{\s*retry\?\.invalidate\(\); retry = nil/);
});

// a fake .app folder with one file and a relative symlink
const fakeApp = (dir, file) => {
  mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(path.join(dir, 'Contents', 'MacOS', file), file);
  symlinkSync('MacOS/' + file, path.join(dir, 'Contents', 'link'));
  return dir;
};

test('installApp: makes the folder, swaps an old app, keeps the old app on a failure', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'plans-install-'));
  try {
    const built = fakeApp(path.join(tmp, 'build', 'Plans.app'), 'new');
    const dest = path.join(tmp, 'home', 'Applications', 'Plans.app');

    // a missing parent folder is made; the symlink stays a link
    assert.deepEqual(installApp(built, dest), { path: dest });
    assert.ok(existsSync(path.join(dest, 'Contents', 'MacOS', 'new')));
    assert.ok(lstatSync(path.join(dest, 'Contents', 'link')).isSymbolicLink());
    assert.equal(readlinkSync(path.join(dest, 'Contents', 'link')), 'MacOS/new');

    // over an old app: the new file is there, the old one is gone, nothing is left beside it
    rmSync(dest, { recursive: true });
    fakeApp(dest, 'old');
    installApp(built, dest);
    assert.ok(existsSync(path.join(dest, 'Contents', 'MacOS', 'new')));
    assert.ok(!existsSync(path.join(dest, 'Contents', 'MacOS', 'old')));
    assert.ok(!existsSync(dest + '.new') && !existsSync(dest + '.old'));

    // a source that does not exist: it throws, and the old app stays
    rmSync(dest, { recursive: true });
    fakeApp(dest, 'old');
    assert.throws(() => installApp(path.join(tmp, 'missing.app'), dest));
    assert.ok(existsSync(path.join(dest, 'Contents', 'MacOS', 'old')));

    // the .new → dest swap fails: it throws, and the old app is put back
    let n = 0;
    const rename = (a, b) => { if (++n === 2) throw new Error('rename failed'); renameSync(a, b); };
    assert.throws(() => installApp(built, dest, { rename }), /rename failed/);
    assert.ok(existsSync(path.join(dest, 'Contents', 'MacOS', 'old')));
    assert.ok(!existsSync(dest + '.old'));

    // a stale .old and .new from a stopped install are removed (the failed swap above left its .new)
    rmSync(dest + '.new', { recursive: true, force: true });
    fakeApp(dest + '.old', 'stale');
    fakeApp(dest + '.new', 'stale');
    installApp(built, dest);
    assert.ok(existsSync(path.join(dest, 'Contents', 'MacOS', 'new')));
    assert.ok(!existsSync(dest + '.new') && !existsSync(dest + '.old'));

    // stopped between the two renames (no dest, only .old): .old is the last working app and comes back
    rmSync(dest, { recursive: true });
    fakeApp(dest + '.old', 'old');
    assert.throws(() => installApp(path.join(tmp, 'missing.app'), dest));
    assert.ok(existsSync(path.join(dest, 'Contents', 'MacOS', 'old')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('build.mjs compiles, signs and does not install with --no-install', { skip: !canCompile }, () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'plans-build-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'plans-home-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--out', tmp, '--no-install', '--url', 'https://plans.test'],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const bin = path.join(tmp, 'Plans.app', 'Contents', 'MacOS', 'Plans');
    assert.ok(existsSync(bin));
    assert.ok(statSync(bin).mode & 0o111, 'the binary is executable');
    assert.match(readFileSync(path.join(tmp, 'Plans.app', 'Contents', 'Info.plist'), 'utf8'), /https:\/\/plans\.test/);
    assert.equal(spawnSync('codesign', ['--verify', path.join(tmp, 'Plans.app')]).status, 0);
    assert.ok(!existsSync(path.join(home, 'Applications', 'Plans.app')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('without --url the build opens the site of the Caddy file in HOME', { skip: !canCompile }, () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'plans-build-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'plans-home-'));
  try {
    mkdirSync(path.join(home, '.claude', 'pipeline-dashboard'), { recursive: true });
    writeFileSync(path.join(home, '.claude', 'pipeline-dashboard', 'caddy-site.caddy'), 'dash.example.test {\n\ttls internal\n}\n');
    const r = spawnSync(process.execPath, [SCRIPT, '--out', tmp, '--no-install'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(readFileSync(path.join(tmp, 'Plans.app', 'Contents', 'Info.plist'), 'utf8'),
      /<key>PlansURL<\/key>\s*<string>https:\/\/dash\.example\.test<\/string>/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('npm run build-app runs build.mjs', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(HERE, '..', '..', '..', 'package.json'), 'utf8'));
  assert.equal(scripts['build-app'], 'node apps/plans-mac/build.mjs');
  assert.ok(existsSync(path.join(HERE, '..', '..', '..', 'apps', 'plans-mac', 'build.mjs')));
});

test('build.mjs refuses an http --url before it compiles', { skip: !IS_MAC }, () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--url', 'http://plans.test', '--no-install'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--url must be an https:\/\/ URL/);
});

test('build.mjs stops when --url or --out has no value', { skip: !IS_MAC }, () => {
  for (const args of [['--url'], ['--out', '--no-install'], ['--url', '--no-install']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /needs a value/, args.join(' '));
  }
});

test('build.mjs builds only on macOS', { skip: IS_MAC }, () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /builds only on macOS/);
});
