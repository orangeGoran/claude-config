// Tests for apps/dashboard/restart.mjs. They only read plist text: no test talks to launchctl.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plistPort, plistScript } from '../restart.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'restart.mjs');
const plist = (script) => '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>Label</key>\n\t<string>com.plans-dashboard</string>\n'
  + `\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/usr/local/bin/node</string>\n\t\t<string>${script}</string>\n\t</array>\n</dict>\n</plist>\n`;

test('plistScript gives the script that a launchd plist starts', () => {
  assert.equal(plistScript(plist('/Users/ana/Workspace/claude-config/apps/dashboard/server.mjs')), '/Users/ana/Workspace/claude-config/apps/dashboard/server.mjs');
  assert.equal(plistScript(plist('/Users/ana/R&amp;D/apps/dashboard/server.mjs')), '/Users/ana/R&D/apps/dashboard/server.mjs');
  assert.equal(plistScript('<plist><dict></dict></plist>'), null);
});

test('plistPort gives the port that the service sets, so npm run restart waits on that port', () => {
  const xml = '<plist><dict><key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>DASH_NO_OPEN</key>\n\t\t<string>1</string>\n\t\t<key>DASH_PORT</key>\n\t\t<string>4920</string>\n\t</dict></dict></plist>';
  assert.equal(plistPort(xml), 4920);
  assert.equal(plistPort('<plist><dict></dict></plist>'), null);
  assert.equal(plistPort(''), null);
});

test('npm run restart refuses, and restarts nothing, when the service starts a script that does not exist', { skip: process.platform !== 'darwin' }, () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'dash-restart-'));
  try {
    const agents = path.join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(path.join(agents, 'com.plans-dashboard.plist'), plist(path.join(home, 'claude-config', 'moved-away', 'server.mjs')));
    const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, HOME: home, PATH: '' }, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not exist/);
    assert.match(r.stderr, /setup-macos\.sh/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
