#!/usr/bin/env node
// Keeps one dashboard chat's claude alive across dashboard restarts.
//
//   node chat-relay.mjs <socket> <command> [args...]
//
// The dashboard starts this detached (its own process group), so restarting the dashboard's
// launchd service does not end it. It runs <command> with pipes and lets one client at a time
// talk to it through the Unix socket:
//   client -> relay   a line for claude's stdin, or {"relay":"kill"} to stop claude
//   relay -> client   "o\t<line>"   a line claude wrote to stdout
//                     "e\t<json>"   a piece of claude's stderr (a JSON string)
//                     "p\t<pid>"    claude's pid, first thing on every connection
//                     "b\t1"        a message went in and its turn has not ended (before the replay)
//                     "x\t<json>"   claude ended: {code, signal, err}, or {spawnError} when it never started
// A new connection gets the lines of the turn running now again (from the last result on, and
// of the stream events only the current message's), so a restarted dashboard rebuilds the
// chat's state from them. A newer connection replaces the older one. When claude ends, the
// relay says so, removes the socket and ends too.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { rmSync } from 'node:fs';

const [sock, cmd, ...args] = process.argv.slice(2);
if (!sock || !cmd) { console.error('usage: chat-relay.mjs <socket> <command> [args...]'); process.exit(2); }

let client = null, err = '', ended = null, working = false;
const turn = [];   // the lines a new connection gets again
const send = (s) => { if (client && !client.destroyed) client.write(s + '\n'); };
const keep = (line) => {
  let j = null;
  try { j = JSON.parse(line); } catch {}
  if (j && j.type === 'result') { turn.length = 0; working = false; }
  // the words of earlier messages are in the transcript: keep only the current message's
  if (j && j.type === 'stream_event' && !j.parent_tool_use_id && j.event?.type === 'message_start')
    for (let i = turn.length - 1; i >= 0; i--) if (turn[i].stream) turn.splice(i, 1);
  turn.push({ line, stream: !!(j && j.type === 'stream_event'), ask: j && j.type === 'control_request' ? j.request_id : null });
};
// a permission the dashboard answered is no longer a question: a new connection must not ask it again
const answered = (line) => {
  if (!line.startsWith('{"type":"control_response"')) return;
  let id = null;
  try { id = JSON.parse(line).response?.request_id; } catch {}
  const i = id ? turn.findIndex((t) => t.ask === id) : -1;
  if (i >= 0) turn.splice(i, 1);
};

const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {});
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line) continue;
    keep(line);
    send('o\t' + line);
  }
});
child.stderr.on('data', (d) => { err = (err + d).slice(-2000); send('e\t' + JSON.stringify(String(d))); });
const finish = (info) => {
  if (ended) return;
  ended = info;
  send('x\t' + JSON.stringify(info));
  try { rmSync(sock, { force: true }); } catch {}
  server.close();
  // let the last frame reach the dashboard, then go (a dashboard that is down learns it from the missing socket)
  setTimeout(() => process.exit(0), client ? 500 : 0);
};
child.on('error', (e) => finish({ spawnError: e.message }));
child.on('exit', (code, signal) => finish({ code, signal, err }));

try { rmSync(sock, { force: true }); } catch {}
const server = net.createServer((c) => {
  if (client) client.destroy();
  client = c;
  c.on('error', () => {});
  c.on('close', () => { if (client === c) client = null; });
  send('p\t' + child.pid);
  if (working) send('b\t1');
  for (const t of turn) send('o\t' + t.line);
  if (ended) send('x\t' + JSON.stringify(ended));
  let inb = '';
  c.on('data', (d) => {
    inb += d;
    let i;
    while ((i = inb.indexOf('\n')) >= 0) {
      const line = inb.slice(0, i + 1); inb = inb.slice(i + 1);
      if (line.startsWith('{"relay":"kill"')) { child.kill('SIGTERM'); continue; }
      answered(line);
      if (line.startsWith('{"type":"user"')) working = true;
      try { child.stdin.write(line); } catch {}
    }
  });
});
// no socket, no way to talk to claude: end both
server.on('error', (e) => { console.error('chat-relay: ' + e.message); child.kill('SIGTERM'); process.exit(1); });
server.listen(sock);
// the dashboard is not this process's parent for long: a hangup from a closed terminal is no reason to stop
process.on('SIGHUP', () => {});
process.on('SIGTERM', () => { child.kill('SIGTERM'); });
