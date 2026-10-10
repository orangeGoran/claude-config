#!/usr/bin/env node
// Regenerates the images and the demo video in docs/.
//
//   node scripts/docs-media.mjs           every screenshot, in a light and a dark version
//   node scripts/docs-media.mjs --video   docs/demo.mp4 (dark), the walkthrough for the README
//
// The video needs ffmpeg with H.264 (brew install ffmpeg). GitHub does not play a video
// stored in the repo: after recording, drag docs/demo.mp4 into the README on github.com
// and use the link GitHub gives back.
//
// Runs throwaway copies of the dashboard against a fake HOME filled with demo
// repositories, so no real project ever shows up in an image. Drives Chrome over
// the DevTools protocol with Node's built-in WebSocket: no npm dependencies.
// Needs Node 22+ and Chrome; set CHROME=/path/to/chrome if it is not in /Applications.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, realpathSync,
  existsSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(REPO, 'docs');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1600, H = 910;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME} — set CHROME=/path/to/chrome`); process.exit(1); }
if (typeof WebSocket === 'undefined') { console.error('Needs Node 22+ (built-in WebSocket).'); process.exit(1); }

const children = [];
const cleanup = [];
process.on('exit', () => { children.forEach((c) => { try { c.kill('SIGKILL'); } catch {} }); cleanup.forEach((f) => f()); });

// ---------- demo worlds ----------

const put = (p, s) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, s); };
const repoDir = (p, files) => {
  mkdirSync(path.join(p, '.git'), { recursive: true });
  for (const [f, s] of Object.entries(files)) put(path.join(p, f), s);
};
// realpath: on macOS /var and /private/var both name the temp dir, and a mismatch
// lists every repo twice
const newHome = () => {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dash-shots-')));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  // the dashboard scans the folder its own repo sits in, so the copy lives in the fake ~/Workspace
  const dash = path.join(home, 'Workspace', 'claude-config');
  mkdirSync(path.join(dash, 'scripts'), { recursive: true });
  copyFileSync(path.join(REPO, 'scripts/plans-dashboard.mjs'), path.join(dash, 'scripts/plans-dashboard.mjs'));
  cpSync(path.join(REPO, 'docs'), path.join(dash, 'docs'), { recursive: true });
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  return { home, ws: path.join(home, 'Workspace'), script: path.join(dash, 'scripts/plans-dashboard.mjs') };
};
const ALLOW = JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } });
const SKILL = (n) => `---\nname: ${n}\n---\n`;

// no projects registered: three repos to find, one per readiness level
function onboardingWorld() {
  const w = newHome();
  const ready = path.join(w.ws, 'acme', 'storefront-api');
  repoDir(ready, {
    '.plans/checkout-idempotency-keys.md': '# Plan: Idempotency keys for checkout\n\nA retried checkout must not create a second order.\n\n## Steps\n\n1. Add the `idempotency_keys` table.\n2. Wrap the checkout handler in a lookup-or-create.\n3. Test that a repeat request returns the first order.\n',
    '.plans/split-inventory-reads.md': '# Plan: Split inventory reads\n\nMove stock reads to the replica.\n',
    '.claude/settings.json': ALLOW,
    '.claude/scripts/run-skill.sh': '#!/usr/bin/env bash\n',
    '.claude/skills/implement/SKILL.md': SKILL('implement'),
    'CLAUDE.md': '# Rules\n',
  });
  repoDir(path.join(w.ws, 'acme', 'billing-service'), {
    '.plans/proration-on-plan-change.md': '# Plan: Proration on plan change\n',
    '.claude/settings.json': ALLOW,
    '.claude/scripts/run-skill.sh': '#!/usr/bin/env bash\n',
  });
  const bare = path.join(w.ws, 'legacy-admin');
  repoDir(bare, {});
  return { ...w, ready, bare };
}

const CHECKOUT_PLAN = `# Plan: Idempotency keys for checkout

Repeated checkout submissions currently create duplicate orders when a client retries after a timeout. This plan adds an idempotency key to the checkout endpoint so a retry returns the original order instead of creating a new one.

## Scope

- Accept an \`Idempotency-Key\` header on \`POST /checkout\`.
- Persist the key with the resulting order id for 24 hours.
- Replay the stored response when the same key arrives again.

## Steps

1. Add the \`idempotency_keys\` table and its migration.
2. Wrap the checkout handler in a lookup-or-create around that table.
3. Return \`409\` when the same key is reused with a different request body.
4. Test a retried request, a reused key with a new body, and an expired key.
`;

const RATE_LIMIT_PLAN = `# Plan: Rate-limit the login endpoint

Five attempts per minute per IP address, then \`429 Too Many Requests\`.

## Steps

1. Add a rate-limit guard in \`src/auth/\`.
2. Apply it to \`POST /login\`.
3. Test that the sixth attempt in a minute fails and the first after the window passes.
`;
const FAKE_RUN = `#!/usr/bin/env bash
say() { printf '%s\\n' "$1"; sleep "\${2:-0.9}"; }
say "reading the plan  .plans/$(basename "$2")"
say "create  src/auth/rate-limit.guard.ts"
say "edit    src/auth/login.controller.ts"
say "create  test/auth/rate-limit.spec.ts"
say "run     npm test" 1.4
say "        48 passed, 0 failed"
say "review  /code-review high"
say "        no findings" 0.5
say "done: ready for your review" 0
`;

// a working set: one pipeline project and one generic project, in every run state
function busyWorld() {
  const w = newHome();
  const store = path.join(w.ws, 'acme', 'storefront-api');
  const ts = (h, m) => `2026-08-25 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const report = (status, events) => `# Run report\n\n## Status: ${status}\n\n## Timeline\n\n` +
    events.map((e) => `- ${e}\n`).join('');
  repoDir(store, {
    '.claude/scripts/auto-pipeline.sh': '#!/usr/bin/env bash\n',
    '.claude/settings.json': ALLOW,
    'CLAUDE.md': '# Rules\n',
    '.plans/checkout-idempotency-keys.md': CHECKOUT_PLAN,
    '.plans/retire-legacy-cart-endpoint.md': '# Plan: Retire the legacy cart endpoint\n\nRemove `/v1/cart` after the last client moved to `/v2/cart`.\n',
    '.plans/split-inventory-reads.md': '# Plan: Split inventory reads\n\nMove stock reads to the read replica.\n',
    '.plans/webhook-retry-backoff.md': '# Plan: Exponential backoff for webhook retries\n\nStop retrying failed webhooks every second.\n',
    '.plans/auto-runs/checkout-idempotency-keys.md': report('IMPLEMENTING',
      [`${ts(9, 2)} worktree created`, `${ts(9, 31)} migration added, checkout handler rewritten`]),
    '.plans/auto-runs/retire-legacy-cart-endpoint.md': report('IMPLEMENTING', [`${ts(10, 4)} worktree created`]),
    '.plans/auto-runs/split-inventory-reads.md': report('VERIFIED', [`${ts(8, 15)} tests pass, review clean`]),
    '.plans/auto-runs/plan-summaries.json': JSON.stringify({
      'checkout-idempotency-keys': 'Right now, if a shopper’s connection drops while they are paying and their phone quietly sends the order a second time, they get charged twice. This work gives every checkout attempt a unique ticket number so a repeat attempt returns the original order instead of creating a new one. It matters because duplicate orders cost us refunds, support time and customer trust.',
    }),
    '.plans/plan-meta.json': JSON.stringify({
      'checkout-idempotency-keys': { status: 'needs-validation', tags: ['db-migration', 'risky'] },
      'retire-legacy-cart-endpoint': { status: 'ready', tags: ['small', 'tech-debt'] },
      'split-inventory-reads': { status: 'ready', tags: ['big'] },
      'webhook-retry-backoff': { status: 'in-refinement', tags: [] },
    }),
    '.plans/.validations/checkout-idempotency-keys-validation-1.md': '',
    '.plans/.validations/split-inventory-reads-validation-1.md': '',
    '.plans/.validations/split-inventory-reads-codex-1.md': '',
    '.plans/done/archive-old-coupons.md': '# Plan: Archive old coupons\n',
  });
  for (const s of ['checkout-idempotency-keys', 'retire-legacy-cart-endpoint', 'split-inventory-reads'])
    mkdirSync(path.join(w.ws, 'acme', 'worktrees', s), { recursive: true });

  const billing = path.join(w.ws, 'acme', 'billing-service');
  repoDir(billing, {
    '.claude/settings.json': ALLOW,
    // stands in for a real headless run in the video: prints what Claude would do, then exits 0
    '.claude/scripts/run-skill.sh': FAKE_RUN,
    '.claude/skills/implement/SKILL.md': SKILL('implement'),
    '.claude/skills/review/SKILL.md': SKILL('review'),
    '.plans/rate-limit-login.md': RATE_LIMIT_PLAN,
    'CLAUDE.md': '# Rules\n',
    '.plans/proration-on-plan-change.md': '# Plan: Proration on plan change\n\nCharge the difference when a customer upgrades mid-cycle.\n',
    '.plans/invoice-pdf-localization.md': '# Plan: Localize invoice PDFs\n\nRender invoices in the customer’s language.\n',
    '.plans/dunning-email-schedule.md': '# Plan: Dunning email schedule\n\nRemind customers about failed payments on day 1, 3 and 7.\n',
  });

  // live runs: the dashboard checks a pipeline run with `pgrep -f "skill-auto-pipeline <slug>.md"`
  // and a generic run by its recorded pid, so park a sleeping process for each
  const idle = (...argv) => {
    const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 6e5)', ...argv], { stdio: 'ignore' });
    children.push(c);
    return c.pid;
  };
  idle('skill-auto-pipeline retire-legacy-cart-endpoint.md');
  const state = path.join(w.home, '.claude', 'pipeline-dashboard', 'state', 'billing-service');
  put(path.join(state, 'plan-summaries.json'), JSON.stringify({
    'rate-limit-login': 'Anyone can try passwords on the login page as fast as they like, which makes guessing attacks cheap. This work allows five attempts per minute from one address and answers the sixth with a clear \u201ctoo many attempts\u201d error. It matters because it closes an easy way into customer accounts without bothering normal users.',
  }));
  put(path.join(state, 'runs.json'), JSON.stringify({
    'proration-on-plan-change': { pid: idle(), label: 'Implement', startedAt: '2026-08-25T10:12:00.000Z', exitCode: null },
    'invoice-pdf-localization': { pid: 1, label: 'Implement', startedAt: '2026-08-25T07:40:00.000Z',
      exitCode: 0, finishedAt: '2026-08-25T08:02:00.000Z' },
  }));

  put(path.join(w.home, '.claude', 'pipeline-projects.json'), JSON.stringify({ projects: [
    { name: 'storefront-api', client: 'Acme', root: store },
    { name: 'billing-service', client: 'Acme', root: billing, launchers: [
      { label: 'Implement', cmd: 'bash .claude/scripts/run-skill.sh implement {plan}' },
      { label: 'Parallel: worktree → implement → review',
        cmd: 'bash ~/Workspace/claude-config/scripts/worktree-run.sh --repo {root} --plan {plan} --prompt "/implement %PLAN%"' },
    ] },
  ] }));
  return w;
}

// ---------- dashboard + Chrome ----------

let nextPort = 4970;
async function startDashboard(world) {
  const port = nextPort++;
  const c = spawn(process.execPath, [world.script], {
    env: { ...process.env, HOME: world.home, DASH_PORT: String(port), DASH_NO_OPEN: '1', DASH_NO_SUMMARY: '1' },
    stdio: 'ignore',
  });
  children.push(c);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/state')).ok) return { base, stop: () => c.kill('SIGKILL') }; } catch {}
    await sleep(100);
  }
  throw new Error('dashboard did not start');
}

async function openChrome() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'dash-shots-chrome-'));
  cleanup.push(() => rmSync(profile, { recursive: true, force: true }));
  const c = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  children.push(c);
  const portFile = path.join(profile, 'DevToolsActivePort');
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = readFileSync(portFile, 'utf8').split('\n')[0]; } catch { await sleep(100); }
  }
  if (!port) throw new Error('Chrome did not open its DevTools port');
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = {};
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method) return listeners[m.method]?.(m.params);
    if (!pending.has(m.id)) return;
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    pending.set(++id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(expr + '\n' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const until = async (expr, what = expr) => {
    for (let i = 0; i < 100; i++) { if (await js(expr)) return; await sleep(100); }
    throw new Error('timed out waiting for ' + what);
  };
  const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  return {
    async open(url, theme) {
      // with nothing saved in localStorage, the dashboard follows the system color scheme
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await send('Page.navigate', { url });
      await until(`document.readyState === 'complete' && document.documentElement.dataset.theme === '${theme}'`,
        theme + ' page load');
    },
    js, until, send,
    on: (method, fn) => { listeners[method] = fn; },
    waitFor: (sel) => until(`!!${q(sel)}`, sel),
    click: (sel) => js(`${q(sel)}.click()`),
    async shot(file, sel) {
      await sleep(500);   // let transitions settle
      let clip;
      if (sel) clip = { ...(await js(`(() => { const b = ${q(sel)}.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`)), scale: 1 };
      const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      writeFileSync(path.join(DOCS, file), Buffer.from(data, 'base64'));
      console.log('  docs/' + file);
    },
  };
}

// ---------- shots ----------

async function onboardingShots(b, theme) {
  const w = onboardingWorld();
  const d = await startDashboard(w);
  const f = (n) => `add-project-${n}-${theme}.png`;
  await b.open(d.base + '/', theme);
  await b.waitFor('#onb.open');
  await b.shot(f('1-guide'));

  await b.click('#onbnext');
  await b.waitFor('.prow');
  await b.shot(f('2-repos'), '.onb-box');

  const row = `.prow-head[data-card="${w.bare}"]`;
  await b.click(row);
  await b.waitFor('.prow-body');
  await b.js(`document.querySelector(${JSON.stringify(row)}).scrollIntoView({ block: 'start' })`);
  await b.shot(f('3-fixes'), '.onb-box');
  await b.click(row);

  await b.click(`[data-add="${w.ready}"]`);
  await b.until(`[...document.querySelectorAll('#onbbody h3')].some((h) => h.textContent === 'Added')`, 'Added list');
  await b.js(`document.getElementById('onbbody').scrollTo(0, 0)`);
  await b.shot(f('4-added'), '.onb-box');

  await b.click('#onbnext');
  await b.waitFor('#tournext');
  await b.shot(f('5-tour'));
  d.stop();
}

async function dashboardShots(b, theme) {
  const w = busyWorld();
  const d = await startDashboard(w);
  await b.open(d.base + '/', theme);
  await b.waitFor('[data-go="storefront-api/checkout-idempotency-keys"]');
  await b.click('[data-go="storefront-api/checkout-idempotency-keys"]');
  await b.waitFor('#detail .summary');
  await b.shot(`plans-dashboard-${theme}.png`);

  await b.js(`openLauncherSetup('billing-service')`);
  await b.until(`document.body.innerText.includes('Parallel: worktree')`, 'launcher drawer');
  await b.shot(`plans-dashboard-launchers-${theme}.png`);
  d.stop();
}

// ---------- video ----------

// headless Chrome draws no mouse pointer and no captions, so the page gets both
const OVERLAY = `(() => {
  const st = document.createElement('style');
  st.textContent = '#demo-cursor{position:fixed;left:800px;top:600px;width:26px;height:26px;margin:-13px 0 0 -13px;' +
    'border-radius:50%;background:rgba(139,92,246,.35);border:2px solid #8b5cf6;z-index:99999;pointer-events:none;' +
    'transition:left .7s ease-in-out,top .7s ease-in-out,transform .15s}' +
    '#demo-cursor.down{transform:scale(.7);background:rgba(139,92,246,.7)}' +
    '#demo-cap{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:99999;pointer-events:none;' +
    'background:rgba(15,15,25,.88);color:#fff;font:600 22px/1.3 system-ui,sans-serif;padding:12px 22px;border-radius:12px;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .3s;white-space:nowrap}';
  document.head.appendChild(st);
  for (const id of ['demo-cursor', 'demo-cap']) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); }
  document.getElementById('demo-cap').style.opacity = 0;
})()`;

async function demoVideo(b) {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  try { execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { stdio: 'pipe' }).toString().includes('libx264') || (() => { throw 0; })(); }
  catch { console.error('The video needs ffmpeg with libx264: brew install ffmpeg (or set FFMPEG=/path/to/ffmpeg)'); process.exit(1); }

  const w = busyWorld();
  const d = await startDashboard(w);
  const frames = mkdtempSync(path.join(os.tmpdir(), 'dash-video-'));
  cleanup.push(() => rmSync(frames, { recursive: true, force: true }));

  await b.open(d.base + '/', 'dark');
  await b.waitFor('.item[data-key="billing-service/rate-limit-login"]');
  await b.js(OVERLAY);

  const shots = [];
  b.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const f = path.join(frames, String(shots.length).padStart(5, '0') + '.jpg');
    writeFileSync(f, Buffer.from(data, 'base64'));
    shots.push({ f, t: metadata.timestamp });
    b.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await b.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H });

  const cap = (text) => b.js(`(() => { const c = document.getElementById('demo-cap');
    c.textContent = ${JSON.stringify(text)}; c.style.opacity = ${text ? 1 : 0}; })()`);
  const point = async (sel) => {
    await b.waitFor(sel);
    await b.js(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
    await b.js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      const c = document.getElementById('demo-cursor'); c.style.left = (r.left + Math.min(r.width / 2, 120)) + 'px';
      c.style.top = (r.top + r.height / 2) + 'px'; })()`);
    await sleep(900);
  };
  const click = async (sel) => {
    await point(sel);
    await b.js(`document.getElementById('demo-cursor').classList.add('down')`);
    await sleep(150);
    await b.js(`document.getElementById('demo-cursor').classList.remove('down'); document.querySelector(${JSON.stringify(sel)}).click()`);
  };
  const KEY = 'billing-service/rate-limit-login';
  const launchBtn = `[...document.querySelectorAll('#detail button')].find((x) => x.textContent.includes('Launch now'))`;

  await sleep(800);
  await cap('Every plan from every project, in one list');
  await sleep(2600);

  await cap('Open a plan: a plain-language summary sits on top');
  await click(`.item[data-key="${KEY}"]`);
  await b.waitFor('#detail .summary');
  await sleep(3200);

  await cap('Launch it. Claude works in the background');
  await b.js(`${launchBtn}.id = 'demo-launch'`);
  await click('#demo-launch');
  await b.until(`!!document.querySelector('#runstrip [data-log="${KEY}"]')`, 'run in the running strip');
  await sleep(1800);

  await cap('Watch the log while it runs');
  await click(`#runstrip [data-log="${KEY}"]`);
  // the page polls every 5 s; reload the log faster so the video shows it streaming
  for (let i = 0; i < 22; i++) { await b.js('loadLog()'); await sleep(450); }

  await cap('Done. It waits for your review');
  await b.js('closeLog()');
  await b.js('refresh()');
  await b.until(`[...document.querySelectorAll('#runstrip .okp')].some((x) => x.dataset.go === '${KEY}')`, 'awaiting review');
  await point(`#runstrip .okp[data-go="${KEY}"]`);
  await sleep(3000);
  await cap('');
  await sleep(600);

  await b.send('Page.stopScreencast');
  d.stop();

  // frames arrive only when the screen changes: hold each one until the next arrives
  const list = shots.map((s, i) => `file '${s.f}'\nduration ${((shots[i + 1]?.t ?? s.t + 1) - s.t).toFixed(3)}`);
  const listFile = path.join(frames, 'frames.txt');
  writeFileSync(listFile, list.join('\n') + `\nfile '${shots.at(-1).f}'\n`);
  const out = path.join(DOCS, 'demo.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=30,scale=${W}:${H},format=yuv420p`, '-c:v', 'libx264', '-crf', '22', '-preset', 'slow',
    '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`  docs/demo.mp4 (${(statSync(out).size / 1e6).toFixed(1)} MB, ${shots.length} frames)`);
}

const b = await openChrome();
if (process.argv.includes('--video')) await demoVideo(b);
else for (const theme of ['light', 'dark']) {
  console.log(theme);
  await onboardingShots(b, theme);
  await dashboardShots(b, theme);
}
process.exit(0);
