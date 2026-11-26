#!/usr/bin/env node
// Build, sign and install Shipyard, the Mac app of the plans dashboard (~/Applications/Shipyard.app), a window around the dashboard page:
//
//   npm run build-app          (or: node apps/plans-mac/build.mjs [--url <url>] [--out <dir>] [--no-install])
//   node apps/plans-mac/build.mjs --check     (exit 0 when the Swift compiler is usable)
//
// The app opens the domain that scripts/setup-macos.sh serves (~/.claude/pipeline-dashboard/caddy-site.caddy),
// else https://shipyard.test; --url overrides it. It compiles src/*.swift with swiftc (macOS only) and signs ad hoc.
// It never stops the running app: quit Shipyard (⌘Q) and open it again to use the new build.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://shipyard.test';

/**
 * Gives 'https://' + the first site name of a Caddy file (the first line `<name> {`, comment lines skipped),
 * or null when the text has no site. It reads the file as apps/dashboard/server.mjs does.
 */
export const siteUrl = (caddyText) => {
  const m = /^([^\s{#]+)\s*\{/m.exec(String(caddyText || ''));
  return m ? 'https://' + m[1].replace(/\/+$/, '') : null;
};

/**
 * Gives the URL the app opens, exactly as given: the --url flag when set, else the site of the Caddy text,
 * else https://shipyard.test. Throws when the result is not an https: URL.
 */
export const appUrl = ({ flag, caddyText } = {}) => {
  const url = flag || siteUrl(caddyText) || DEFAULT_URL;
  let ok = false;
  try { ok = new URL(url).protocol === 'https:'; } catch {}
  if (!ok) throw new Error('--url must be an https:// URL');
  return url;
};

/** The name of the app: the bundle, its program and the menu. */
export const APP_NAME = 'Shipyard';

/** The name of the icon file in Contents/Resources (AppIcon.icns), made from the page icon. */
export const ICON_NAME = 'AppIcon';

/** The PNG files of a macOS .iconset: [file name, pixel size] for 16, 32, 128, 256 and 512 pt, each at 1x and 2x. */
export const iconsetFiles = () => [16, 32, 128, 256, 512].flatMap((pt) => [
  ['icon_' + pt + 'x' + pt + '.png', pt],
  ['icon_' + pt + 'x' + pt + '@2x.png', pt * 2],
]);

/**
 * Writes <resources>/AppIcon.icns from an SVG file: Quick Look renders the SVG at 1024 px, sips scales it to
 * each iconset size, iconutil packs the set. Gives true on success; on a failure it warns and gives false,
 * and the app gets the default icon.
 */
const writeIcon = (svg, resources, tmpDir) => {
  try {
    const ql = path.join(tmpDir, 'ql');
    const set = path.join(tmpDir, ICON_NAME + '.iconset');
    mkdirSync(ql, { recursive: true });
    mkdirSync(set, { recursive: true });
    execFileSync('qlmanage', ['-t', '-s', '1024', '-o', ql, svg], { stdio: 'ignore' });
    const png = path.join(ql, path.basename(svg) + '.png');
    for (const [name, px] of iconsetFiles()) {
      execFileSync('sips', ['-z', String(px), String(px), png, '--out', path.join(set, name)], { stdio: 'ignore' });
    }
    mkdirSync(resources, { recursive: true });
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(resources, ICON_NAME + '.icns')], { stdio: 'ignore' });
    return true;
  } catch (e) {
    console.warn('Could not make the app icon (' + e.message + '); the app gets the default icon.');
    return false;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Gives the Info.plist XML of the app, with the dashboard URL as PlansURL. Each value is XML-escaped. */
export const infoPlist = ({ url, version }) => {
  const entries = [
    ['CFBundleIdentifier', 'com.plans-dashboard.mac'],
    ['CFBundleName', APP_NAME],
    ['CFBundleExecutable', APP_NAME],
    ['CFBundlePackageType', 'APPL'],
    ['CFBundleShortVersionString', version],
    ['CFBundleIconFile', ICON_NAME],
    ['LSMinimumSystemVersion', '13.0'],
    ['PlansURL', url],
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + '<plist version="1.0">\n<dict>\n'
    + entries.map(([k, v]) => '\t<key>' + xml(k) + '</key>\n\t<string>' + xml(v) + '</string>\n').join('')
    + '\t<key>NSHighResolutionCapable</key>\n\t<true/>\n'
    + '</dict>\n</plist>\n';
};

/**
 * Copies the built app to dest with a staged swap: the copy goes to dest.new, the old app moves to dest.old,
 * then dest.new becomes dest. When a step fails, the old app stays (or is put back) in place.
 * The rename option exists only so a test can make one rename fail.
 */
export const installApp = (built, dest, { rename = renameSync } = {}) => {
  const NEW = dest + '.new', OLD = dest + '.old';
  mkdirSync(path.dirname(dest), { recursive: true });
  // a stopped install: with no dest, dest.old is the last working app
  if (!existsSync(dest) && existsSync(OLD)) rename(OLD, dest);
  rmSync(NEW, { recursive: true, force: true });
  rmSync(OLD, { recursive: true, force: true });
  cpSync(built, NEW, { recursive: true, verbatimSymlinks: true });
  const had = existsSync(dest);
  if (had) rename(dest, OLD);
  try { rename(NEW, dest); }
  catch (e) { if (had) rename(OLD, dest); throw e; }
  try { rmSync(OLD, { recursive: true, force: true }); }
  catch (e) { console.warn('Could not remove ' + OLD + ' (' + e.message + '); the next build removes it.'); }
  return { path: dest };
};

/** True when the Swift compiler of the Command Line Tools or Xcode is installed. */
const swiftcUsable = () => {
  try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' }); return true; } catch { return false; }
};

// true when this file runs as a command; false when a test imports the helpers
const IS_MAIN = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (IS_MAIN) {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  // a flag with no value stops the build: a silent default would build for the wrong place
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith('--')) { console.error(name + ' needs a value'); process.exit(1); }
    return v;
  };
  const HINT = 'swiftc not found. Install the Command Line Tools: xcode-select --install';

  if (process.platform !== 'darwin') {
    console.error(APP_NAME + ' builds only on macOS.');
    process.exit(1);
  }
  if (args.includes('--check')) {
    if (swiftcUsable()) process.exit(0);
    console.error(HINT);
    process.exit(1);
  }
  const urlFlag = opt('--url'), outFlag = opt('--out');
  let caddyText = '';
  try { caddyText = readFileSync(path.join(os.homedir(), '.claude', 'pipeline-dashboard', 'caddy-site.caddy'), 'utf8'); } catch {}
  let url;
  try { url = appUrl({ flag: urlFlag, caddyText }); }
  catch (e) { console.error(e.message); process.exit(1); }
  if (!swiftcUsable()) { console.error(HINT); process.exit(1); }

  let version = '1.0';
  try { version = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8')).version || '1.0'; } catch {}
  // without --out the build goes to a temp folder, removed after the install
  const tmpOut = !outFlag && !args.includes('--no-install');
  const out = outFlag ? path.resolve(outFlag) : mkdtempSync(path.join(os.tmpdir(), 'plans-app-'));
  const dropOut = () => { if (tmpOut) rmSync(out, { recursive: true, force: true }); };
  const APP = path.join(out, APP_NAME + '.app');
  mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(path.join(APP, 'Contents', 'Info.plist'), infoPlist({ url, version }));
  writeIcon(path.join(HERE, '..', 'dashboard', 'page', 'icon.svg'), path.join(APP, 'Contents', 'Resources'),
    mkdtempSync(path.join(os.tmpdir(), 'plans-icon-')));
  const SRC = path.join(HERE, 'src');
  const sources = readdirSync(SRC).filter((f) => f.endsWith('.swift')).sort().map((f) => path.join(SRC, f));
  const target = (process.arch === 'arm64' ? 'arm64' : 'x86_64') + '-apple-macos13.0';
  try {
    // Swift 5 language mode: the Swift 6 strict concurrency checks of a new compiler do not apply
    execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', target,
      '-o', path.join(APP, 'Contents', 'MacOS', APP_NAME), ...sources], { stdio: 'inherit' });
    execFileSync('codesign', ['--force', '--sign', '-', APP], { stdio: 'inherit' });
  } catch { dropOut(); console.error('The build failed (see the output above).'); process.exit(1); }

  if (args.includes('--no-install')) {
    console.log('Built ' + APP);
  } else {
    const dest = path.join(os.homedir(), 'Applications', APP_NAME + '.app');
    try { installApp(APP, dest); }
    catch (e) { dropOut(); console.error('Could not install ' + dest + ': ' + e.message); process.exit(1); }
    dropOut();
    console.log('Installed ' + dest + ' (opens ' + url + ').');
    console.log('Quit ' + APP_NAME + ' (⌘Q) and open it again to use the new build.');
  }
}
