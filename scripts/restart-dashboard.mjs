#!/usr/bin/env node
// Restart the plans dashboard's login service so https://plans.test serves the code on disk:
//
//   npm run restart            (or: node scripts/restart-dashboard.mjs [--now])
//
// A restart ends the chat panel's claude, so it first waits while a chat agent is answering
// or waiting for a permission. Plan runs are their own processes and keep going. --now skips
// the wait. After the restart it waits for the server to answer, or points at the log.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PORT = +(process.env.DASH_PORT || 4899);
const SERVICE = 'gui/' + process.getuid() + '/com.plans-dashboard';
const LOG = path.join(os.homedir(), '.claude', 'pipeline-dashboard', 'server.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async () => {
  try {
    const r = await fetch('http://127.0.0.1:' + PORT + '/api/state', { signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

if (process.platform !== 'darwin') {
  console.error('The dashboard runs as a launchd service only on macOS. Restart it the way you started it.');
  process.exit(1);
}
if (!process.argv.includes('--now')) {
  let told = '';
  for (;;) {
    const projects = await state();
    const busy = (projects || []).flatMap((p) => p.plans.filter((x) => x.chatting || x.chatWaits)
      .map((x) => p.name + ' / ' + x.slug + (x.chatWaits ? ' (waits for your permission)' : '')));
    if (!busy.length) break;
    const now = busy.join(', ');
    if (now !== told) console.log('Waiting for the chat to finish: ' + now + '. Ctrl+C to cancel, --now to restart anyway.');
    told = now;
    await sleep(3000);
  }
}
try { execFileSync('launchctl', ['kickstart', '-k', SERVICE], { stdio: 'inherit' }); }
catch { console.error('Could not restart ' + SERVICE + '. Is it installed? See docs/plans-dashboard.md.'); process.exit(1); }
await sleep(500);
for (let i = 0; i < 30; i++) {
  if (await state()) { console.log('Restarted. Reload https://plans.test (Cmd+Shift+R).'); process.exit(0); }
  await sleep(500);
}
console.error('The dashboard did not come back. The reason (usually a syntax error) is at the end of ' + LOG);
process.exit(1);
