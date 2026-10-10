#!/usr/bin/env node
// Regenerates the screenshots in docs/ — every one in a light and a dark version.
//
//   node scripts/docs-screenshots.mjs
//
// Runs throwaway copies of the dashboard against a fake HOME filled with demo
// repositories, so no real project ever shows up in an image. Drives Chrome over
// the DevTools protocol with Node's built-in WebSocket: no npm dependencies.
// Needs Node 22+ and Chrome; set CHROME=/path/to/chrome if it is not in /Applications.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, realpathSync,
  existsSync, rmSync } from 'node:fs';
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
    '.claude/scripts/run-skill.sh': '#!/usr/bin/env bash\n',
    '.claude/skills/implement/SKILL.md': SKILL('implement'),
    '.claude/skills/review/SKILL.md': SKILL('review'),
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
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
    js, until,
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

const b = await openChrome();
for (const theme of ['light', 'dark']) {
  console.log(theme);
  await onboardingShots(b, theme);
  await dashboardShots(b, theme);
}
process.exit(0);
