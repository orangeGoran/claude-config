#!/usr/bin/env node
// Restart the plans dashboard's login service so https://plans.test serves the code on disk:
//
//   npm run restart            (or: node scripts/restart-dashboard.mjs)
//
// Chats survive it: each chat's claude runs under scripts/chat-relay.mjs, outside the service's
// process group, and the new server connects to it again. Plan runs are their own processes too.
// After the restart it waits for the server to answer, or points at the log.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PORT = +(process.env.DASH_PORT || 4899);
const LOG = path.join(os.homedir(), '.claude', 'pipeline-dashboard', 'server.log');
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
const SERVICE = 'gui/' + process.getuid() + '/com.plans-dashboard';
try { execFileSync('launchctl', ['kickstart', '-k', SERVICE], { stdio: 'inherit' }); }
catch { console.error('Could not restart ' + SERVICE + '. Is it installed? See docs/plans-dashboard.md.'); process.exit(1); }
await sleep(500);
for (let i = 0; i < 30; i++) {
  if (await up()) { console.log('Restarted. Reload https://plans.test (Cmd+Shift+R).'); process.exit(0); }
  await sleep(500);
}
console.error('The dashboard did not come back. The reason (usually a syntax error) is at the end of ' + LOG);
process.exit(1);
