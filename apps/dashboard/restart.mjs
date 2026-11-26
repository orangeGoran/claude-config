#!/usr/bin/env node
// Restart the plans dashboard's login service so its domain (https://shipyard.test by default) serves the code on disk:
//
//   npm run restart            (or: node apps/dashboard/restart.mjs)
//
// Chats survive it: each chat's claude runs under apps/dashboard/chat-relay.mjs, outside the service's
// process group, and the new server connects to it again. Plan runs are their own processes too.
// After the restart it waits for the server to answer, or points at the log.
// It refuses when the service starts a script that does not exist (an install from before a move
// of the server): a restart would stop the running dashboard and not start it again.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Gives the script path that a launchd plist starts (the second ProgramArguments string), or null
 * when the text has no such entry.
 */
export const plistScript = (xml) => {
  const m = /<key>ProgramArguments<\/key>\s*<array>\s*<string>[^<]*<\/string>\s*<string>([^<]*)<\/string>/.exec(String(xml));
  if (!m) return null;
  return m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
};

/** Gives the DASH_PORT that a launchd plist sets for the dashboard, or null when it sets none. */
export const plistPort = (xml) => {
  const m = /<key>DASH_PORT<\/key>\s*<string>(\d+)<\/string>/.exec(String(xml));
  return m ? +m[1] : null;
};

/** Gives the https URL of the first site in a Caddy site file (the domain setup-macos.sh chose), or null. */
export const caddySite = (text) => {
  const m = /^([^\s{#]+)\s*\{/m.exec(String(text || ''));
  return m ? 'https://' + m[1] : null;
};

// true when this file runs as a command; false when a test or the server imports plistScript()
const IS_MAIN = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (IS_MAIN) {
  const LOG = path.join(os.homedir(), '.claude', 'pipeline-dashboard', 'server.log');
  const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.plans-dashboard.plist');
  let xml = '';
  try { xml = readFileSync(PLIST, 'utf8'); } catch {}
  // the port the service listens on: DASH_PORT when set, else the one its plist sets
  const PORT = +(process.env.DASH_PORT || plistPort(xml) || 4899);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // true once the restarted server answers
  const up = async () => {
    try { return (await fetch('http://127.0.0.1:' + PORT + '/api/state', { signal: AbortSignal.timeout(15000) })).ok; }
    catch { return false; }
  };

  if (process.platform !== 'darwin') {
    console.error('The dashboard runs as a launchd service only on macOS. Restart it the way you started it.');
    process.exit(1);
  }
  const script = plistScript(xml);
  if (script && !existsSync(script)) {
    console.error('The login service starts ' + script + ', which does not exist. A restart would stop the dashboard.\n'
      + 'Run scripts/setup-macos.sh again with the --domain and --port of this Mac: it points the service at apps/dashboard/server.mjs and starts it.');
    process.exit(1);
  }
  const SERVICE = 'gui/' + process.getuid() + '/com.plans-dashboard';
  try { execFileSync('launchctl', ['kickstart', '-k', SERVICE], { stdio: 'inherit' }); }
  catch { console.error('Could not restart ' + SERVICE + '. Is it installed? See docs/plans-dashboard.md.'); process.exit(1); }
  await sleep(500);
  for (let i = 0; i < 30; i++) {
    if (await up()) {
      let site = '';
      try { site = caddySite(readFileSync(path.join(os.homedir(), '.claude', 'pipeline-dashboard', 'caddy-site.caddy'), 'utf8')); } catch {}
      console.log('Restarted. Reload ' + (site || 'http://127.0.0.1:' + PORT) + ' (Cmd+Shift+R).');
      process.exit(0);
    }
    await sleep(500);
  }
  console.error('The dashboard did not come back. The reason (usually a syntax error) is at the end of ' + LOG);
  process.exit(1);
}
