#!/usr/bin/env node
// Make a worktree's headless auto-pipeline sessions openable from the VS Code extension.
//
//   node .claude/scripts/vscode-session-copy.mjs <worktree-path>
//
// The extension's Past Conversations list hides sessions started with `claude -p`
// (entrypoint "sdk-cli"). For each such pipeline session this writes a relabeled copy
// under a new session id, tagged as an extension session and given a title. The copy is
// a fork: the original transcript is never modified, and an existing copy is never
// overwritten (you may have continued it in the extension). Called by auto-pipeline.sh
// after every headless session exits; safe to re-run by hand.
import {
  readFileSync, writeFileSync, renameSync, readdirSync, existsSync, openSync, readSync,
  closeSync, cpSync, statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
// explicit imports: some ESLint configs have no Node globals
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';

const wt = process.argv[2];
if (!wt) {
  console.error('usage: vscode-session-copy.mjs <worktree-path>');
  process.exit(1);
}
const wtPath = path.resolve(wt);
const dir = path.join(process.env.HOME, '.claude', 'projects', wtPath.replace(/[^a-zA-Z0-9]/g, '-'));
if (!existsSync(dir)) process.exit(0);

// source id -> copy id; a filename can't tell a copy apart, so this is the idempotence record
const indexFile = path.join(dir, '.vscode-copies.json');
let index = {};
try { index = JSON.parse(readFileSync(indexFile, 'utf8')); } catch { /* first run */ }

const head = (file) => {
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(65536);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  return buf.toString('utf8', 0, n);
};

const slug = path.basename(wtPath);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
  const oldId = f.slice(0, -'.jsonl'.length);
  if (index[oldId] && existsSync(path.join(dir, index[oldId] + '.jsonl'))) continue;
  const src = path.join(dir, f);
  const h = head(src);
  if (h.match(/"entrypoint":"([^"]+)"/)?.[1] !== 'sdk-cli') continue;
  if (!h.includes('/skill-auto-pipeline ')) continue;

  // relabel every record
  const newId = randomUUID();
  const lines = readFileSync(src, 'utf8').split('\n').filter(Boolean).map((l) => {
    const d = JSON.parse(l);
    if (d.sessionId === oldId) d.sessionId = newId;
    if (d.entrypoint === 'sdk-cli') d.entrypoint = 'claude-vscode';
    if (d.turnOrigin === 'sdk') d.turnOrigin = 'human';
    return JSON.stringify(d);
  });
  const started = new Date(h.match(/"timestamp":"([^"]+)"/)?.[1] ?? statSync(src).mtimeMs)
    .toLocaleString('sv-SE').slice(0, 16);
  lines.push(JSON.stringify({ type: 'ai-title', aiTitle: `Auto-pipeline: ${slug} (${started})`, sessionId: newId }));

  // write atomically so the extension never lists a half-written copy
  const tmp = path.join(dir, `.${newId}.jsonl.tmp`);
  writeFileSync(tmp, lines.join('\n') + '\n');
  renameSync(tmp, path.join(dir, newId + '.jsonl'));
  // subagent transcripts + large tool results live in a sibling folder named after the session
  if (existsSync(path.join(dir, oldId))) cpSync(path.join(dir, oldId), path.join(dir, newId), { recursive: true });

  index[oldId] = newId;
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  console.log(`vscode-session-copy: ${oldId} -> ${newId}`);
}
