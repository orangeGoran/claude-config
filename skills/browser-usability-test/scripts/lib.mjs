// Shared helpers for real-browser usability runs against a local web app.
// Everything project-specific (URLs, login form, auth endpoints, database, theme,
// noise) comes from the project profile — see profile.mjs and references/profile.md.
// Generic only: login, logging, axe, screenshots, layout measurement, mocking,
// API client, read-only SQL. Page-specific helpers belong in the run's own script.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  assertLocal,
  expandHome,
  pickAccount,
  requireProject,
} from "./profile.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = resolve(HERE, "..");

/** The project profile this run uses (found from the current repo, or QA_PROJECT). */
export const { project: PROJECT, repo: THIS_REPO } = requireProject();
const AUTH = PROJECT.auth ?? {};
const UI = PROJECT.ui ?? {};

/** Absolute path of the project's repo with this role ("frontend", "backend"), or null. */
export const repoPath = (role) =>
  expandHome(PROJECT.repos?.find((r) => r.role === role)?.path) ?? null;

export const APP_URL = assertLocal(
  process.env.QA_APP_URL ?? PROJECT.app?.url,
  "App URL",
);
if (!APP_URL) throw new Error(`Project ${PROJECT.name} has no app.url.`);
export const API_URL = assertLocal(
  process.env.QA_API_URL ?? PROJECT.api?.url ?? APP_URL,
  "API URL",
);

const ACCOUNT = pickAccount(PROJECT);
/** Evidence + saved session, one folder per project and account. */
export const OUT_DIR =
  process.env.QA_DIR ??
  join(tmpdir(), "browser-qa", PROJECT.name, ACCOUNT?.label ?? "anonymous");
mkdirSync(OUT_DIR, { recursive: true });

// Saved cookies + localStorage (refresh cookie, CSRF token) so later scripts in
// the same run restore the session instead of logging in again.
const STATE_FILE = join(OUT_DIR, "session-state.json");
// Last access token, so api.mjs can skip starting a browser.
const TOKEN_FILE = join(OUT_DIR, "token.json");
const TOKEN_MAX_AGE_MS = (AUTH.tokenMaxAgeMinutes ?? 12) * 60 * 1000;

// Playwright and axe are the skill's own dependencies, so the skill works from
// any repo of the project (a backend repo has no browser tooling).
const require = createRequire(join(SKILL_DIR, "package.json"));
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  throw new Error(
    `Playwright is not installed for this skill. Run: npm install --prefix ${SKILL_DIR}`,
  );
}
export { chromium };

// Known noise from the profile: not findings.
const NOISE = (PROJECT.noise ?? []).map((n) => ({
  kind: n.kind,
  test: (e) =>
    n.kind === "console"
      ? new RegExp(n.pattern, "i").test(e.text)
      : (!n.status || e.status === n.status) &&
        (!n.method || e.method === n.method) &&
        (!n.urlIncludes || e.url.includes(n.urlIncludes)),
}));
const isNoise = (kind, entry) =>
  NOISE.some((n) => n.kind === kind && n.test(entry));

const throttleRe = AUTH.throttlePattern ? new RegExp(AUTH.throttlePattern) : null;
const isLoginPath = (pathname) =>
  pathname.startsWith(AUTH.loginPath ?? "/login");

// ── credentials ──────────────────────────────────────────────────────────────

/**
 * The account for this run, from the profile (QA_ACCOUNT=<label|email>) or the
 * call (QA_EMAIL + QA_PASSWORD [+ QA_2FA]). Never hardcode credentials in scripts.
 */
export function creds() {
  if (!ACCOUNT) {
    throw new Error(
      `No account chosen for ${PROJECT.name}. Set QA_ACCOUNT=<label|email> (saved accounts: node ${join(HERE, "profile.mjs")} resolve) or QA_EMAIL + QA_PASSWORD.`,
    );
  }
  return {
    email: ACCOUNT.email,
    password: ACCOUNT.password,
    code: ACCOUNT.twoFactor ?? "",
    account: ACCOUNT,
  };
}

// ── logging ──────────────────────────────────────────────────────────────────

/**
 * Records console errors/warnings, page errors, failed requests, HTTP >= 400 and
 * a count of every API request (for duplicate detection). Known noise is kept
 * separately so the report can say it was seen and ignored.
 */
export function collectLog(page, log = newLog()) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const entry = { type, text: msg.text().slice(0, 500), url: page.url() };
    (isNoise("console", entry) ? log.noise : log.console).push(entry);
  });
  page.on("pageerror", (err) =>
    log.pageErrors.push({
      text: String(err.message ?? err).slice(0, 500),
      url: page.url(),
    }),
  );
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "failed";
    // Aborted SSE/fetches on navigation are normal.
    if (failure.includes("ERR_ABORTED")) return;
    log.failed.push({ method: req.method(), url: req.url(), failure });
  });
  page.on("request", (req) => {
    if (!req.url().startsWith(API_URL)) return;
    const key = `${req.method()} ${req.url().replace(API_URL, "")}`;
    const bucket = (log.requests[log.segment] ??= {});
    bucket[key] = (bucket[key] ?? 0) + 1;
  });
  page.on("response", async (res) => {
    if (res.status() < 400) return;
    const entry = {
      status: res.status(),
      method: res.request().method(),
      url: res.url(),
      body: "",
    };
    try {
      entry.body = (await res.text()).slice(0, 300);
    } catch {
      /* body not available (redirect, aborted) */
    }
    if (entry.status === 429 && throttleRe?.test(entry.url))
      log.throttled.push(entry);
    (isNoise("http", entry) ? log.noise : log.http).push(entry);
  });
  return log;
}

export function newLog() {
  return {
    console: [],
    pageErrors: [],
    failed: [],
    http: [],
    noise: [],
    throttled: [],
    requests: {},
    segment: "load",
  };
}

/**
 * Starts a new segment of the request count, so duplicates are reported per user
 * action ("filter by status") instead of across the whole run. step() calls it.
 */
export function markStep(log, name) {
  log.segment = name;
}

/**
 * Compact summary for the report. `duplicates` lists API calls made more than
 * once within one step. `throttled` non-empty means auth hit its rate limit and
 * evidence gathered after that point is not trustworthy (blank pages).
 */
export function summarizeLog(log) {
  const duplicates = Object.entries(log.requests)
    .flatMap(([segment, keys]) =>
      Object.entries(keys)
        .filter(([, n]) => n > 1)
        .map(([key, n]) => ({ segment, key, n })),
    )
    .sort((a, b) => b.n - a.n);
  if (log.throttled.length) {
    console.error(
      `!! ${log.throttled.length} auth request(s) got 429 — results after that point are unreliable. Pause 60 s before the next script.`,
    );
  }
  return {
    throttled: log.throttled,
    consoleErrors: log.console.filter((e) => e.type === "error"),
    consoleWarnings: log.console.filter((e) => e.type === "warning"),
    pageErrors: log.pageErrors,
    failedRequests: log.failed,
    httpErrors: log.http,
    duplicates,
    ignoredNoise: log.noise.length,
  };
}

// ── browser ──────────────────────────────────────────────────────────────────

/**
 * View-only language switch (profile ui.localeRewrite): rewrites the locale field
 * in matching API responses so the UI renders in `locale` without saving anything
 * to the user's profile. Without that setting only the browser locale changes.
 */
export async function forceLocale(context, locale) {
  const rewrite = UI.localeRewrite;
  if (!rewrite) return;
  const field = new RegExp(`"${rewrite.field}":"[a-zA-Z-]+"`, "g");
  await context.route(new RegExp(rewrite.urlPattern), async (route) => {
    let res;
    try {
      res = await route.fetch();
    } catch {
      // API unreachable: fail the request like the browser would, without a crash.
      return route.abort("connectionrefused");
    }
    const type = res.headers()["content-type"] ?? "";
    if (!type.includes("json")) return route.fulfill({ response: res });
    const body = (await res.text()).replace(
      field,
      `"${rewrite.field}":"${locale}"`,
    );
    return route.fulfill({ response: res, body });
  });
}

const getPath = (obj, path) =>
  path?.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * Starts Chromium, signs in once and opens `path`.
 * Reuses the saved session from an earlier script when it is still valid, so a
 * run of several scripts costs one login. Falls back to one UI login, never loops.
 *
 * @returns {{ browser, context, page, log, token: () => string|null, close: () => Promise<void> }}
 */
export async function launch({
  path = "/",
  locale = "en",
  viewport = { width: 1440, height: 900 },
  colorScheme = "light",
  reuseSession = true,
  headless = true,
} = {}) {
  await assertServersUp();
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport,
    colorScheme,
    locale: locale ?? undefined,
    storageState:
      reuseSession && existsSync(STATE_FILE) ? STATE_FILE : undefined,
  });
  if (locale) await forceLocale(context, locale);

  let token = null;
  context.on("request", (req) => {
    const auth = req.headers()["authorization"];
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  });
  const tokenRe = AUTH.tokenResponse?.urlPattern
    ? new RegExp(AUTH.tokenResponse.urlPattern)
    : null;
  context.on("response", async (res) => {
    if (!tokenRe?.test(res.url()) || res.status() !== 200) return;
    try {
      const value = getPath(await res.json(), AUTH.tokenResponse.path);
      if (value) token = value;
    } catch {
      /* not JSON */
    }
  });

  const page = await context.newPage();
  const log = collectLog(page);

  await page.goto(APP_URL + path);
  const restored = await waitForSession(page, () => token, log);
  if (log.throttled.length) {
    await browser.close();
    throw new Error(
      `${log.throttled[0].method} ${log.throttled[0].url} returned 429 (rate limit). Wait 60 s and run again; do not fall back to a UI login.`,
    );
  }
  if (!restored) {
    await uiLogin(page);
    if (!new URL(page.url()).pathname.startsWith(path.split("?")[0]))
      await page.goto(APP_URL + path);
  }
  await context.storageState({ path: STATE_FILE });

  return {
    browser,
    context,
    page,
    log,
    token: () => token,
    close: async () => {
      await context.storageState({ path: STATE_FILE }).catch(() => {});
      if (token)
        writeFileSync(
          TOKEN_FILE,
          JSON.stringify({ token, savedAt: Date.now() }),
        );
      await browser.close();
    },
  };
}

/** Fails fast with a clear message when the app or the API is not running. */
export async function assertServersUp() {
  const checks = [["app", APP_URL]];
  if (PROJECT.api?.url)
    checks.push(["API", API_URL + (PROJECT.api.healthPath ?? "")]);
  for (const [name, url] of checks) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (!ok)
      throw new Error(
        `The ${name} at ${url} is not reachable. Start it and run again.`,
      );
  }
}

/**
 * True when the restored session is still signed in. "bearer" apps: a request
 * with a bearer token went out before the page landed on the login path.
 * "cookie" apps: the page is not on the login path after a short wait.
 */
async function waitForSession(page, getToken, log, timeoutMs = 15000) {
  const cookie = AUTH.session === "cookie";
  const start = Date.now();
  while (Date.now() - start < (cookie ? 3000 : timeoutMs)) {
    if (log.throttled.length) return false;
    if (isLoginPath(new URL(page.url()).pathname)) return false;
    if (getToken()) return true;
    await page.waitForTimeout(250);
  }
  return cookie || Boolean(getToken());
}

/** One UI login: email + password, then the 2FA code if the challenge appears. */
export async function uiLogin(page) {
  const { email, password, code } = creds();
  const sel = AUTH.selectors ?? {};
  const loginPath = AUTH.loginPath ?? "/login";
  if (!isLoginPath(new URL(page.url()).pathname))
    await page.goto(APP_URL + loginPath);
  await page
    .locator(sel.email ?? "input[type=email], input[name=email], input[name=username]")
    .first()
    .fill(email);
  await page.locator(sel.password ?? "input[type=password]").first().fill(password);
  await page.locator(sel.submit ?? "form button[type=submit]").first().click();

  const twoFactor = sel.twoFactor ? page.locator(sel.twoFactor).first() : null;
  const outcome = await Promise.race([
    ...(twoFactor
      ? [twoFactor.waitFor({ timeout: 20000 }).then(() => "2fa")]
      : []),
    page
      .waitForURL((u) => !isLoginPath(u.pathname), { timeout: 20000 })
      .then(() => "in"),
  ]).catch(() => "stuck");

  if (outcome === "2fa") {
    if (!code)
      throw new Error(
        "Account asks for 2FA: save twoFactor on the account, or set QA_2FA.",
      );
    await twoFactor.fill(code);
    await twoFactor.press("Enter");
    await page.waitForURL((u) => !isLoginPath(u.pathname), {
      timeout: 20000,
    });
  } else if (outcome === "stuck") {
    const shotPath = await screenshot(page, "login-failed");
    throw new Error(
      `Login did not complete (still on ${page.url()}). See ${shotPath}. Do not retry in a loop: auth may be throttled.`,
    );
  }
}

// ── evidence ─────────────────────────────────────────────────────────────────

/** Saves a PNG in OUT_DIR and returns its path (open it with the Read tool). */
export async function screenshot(
  page,
  name,
  { fullPage = false, locator } = {},
) {
  const file = join(OUT_DIR, `${name.replace(/[^a-z0-9-_]+/gi, "-")}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage });
  return file;
}

/** Writes JSON evidence (API payloads, SQL rows, summaries) next to the screenshots. */
export function saveJson(name, data) {
  const file = join(OUT_DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/**
 * Layout facts for one element: box, scroll vs client size (overflow), and the
 * computed styles you name. Use this instead of guessing from a screenshot.
 */
export async function measure(
  page,
  selectorOrLocator,
  styles = ["color", "backgroundColor", "fontSize", "overflow"],
) {
  const loc =
    typeof selectorOrLocator === "string"
      ? page.locator(selectorOrLocator).first()
      : selectorOrLocator;
  return loc.evaluate((el, props) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      scroll: {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      },
      overflowsX: el.scrollWidth > el.clientWidth + 1,
      overflowsY: el.scrollHeight > el.clientHeight + 1,
      styles: Object.fromEntries(props.map((p) => [p, cs[p]])),
    };
  }, styles);
}

/** Does the page scroll sideways? Lists the widest offenders when it does. */
export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth > vw + 1;
    const offenders = overflow
      ? [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > vw + 1)
          .slice(0, 8)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className).slice(0, 80),
            right: Math.round(el.getBoundingClientRect().right),
          }))
      : [];
    return {
      viewportWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      overflow,
      offenders,
    };
  });
}

/** Resizes through the standard widths, screenshots each, reports sideways scroll. */
export async function checkResponsive(
  page,
  name,
  widths = [390, 1100, 1440, 2555],
  height = 900,
) {
  const results = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    results.push({
      width,
      ...(await horizontalOverflow(page)),
      shot: await screenshot(page, `${name}-${width}`),
    });
  }
  await page.setViewportSize({ width: 1440, height });
  return results;
}

// ── accessibility ────────────────────────────────────────────────────────────

let AxeBuilder;
/**
 * Runs axe (WCAG 2 A/AA) on the current state. Returns a compact violation list.
 * Pass `save: 'name'` to also write every node (selectors, contrast ratios) to JSON.
 */
export async function axeScan(
  page,
  {
    include,
    exclude,
    save,
    tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  } = {},
) {
  if (!AxeBuilder) {
    AxeBuilder = require("@axe-core/playwright").default;
  }
  let builder = new AxeBuilder({ page }).withTags(tags);
  if (include) builder = builder.include(include);
  if (exclude) builder = builder.exclude(exclude);
  const { violations } = await builder.analyze();
  if (save) {
    saveJson(
      `axe-${save}`,
      violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target.join(" "),
          html: n.html.slice(0, 200),
          summary: n.failureSummary,
          data: n.any?.[0]?.data,
        })),
      })),
    );
  }
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    count: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    summary: v.nodes[0]?.failureSummary?.split("\n").slice(0, 3).join(" "),
  }));
}

// ── mocking (test browser only) ──────────────────────────────────────────────

/**
 * Rewrites API responses in this browser only, to reach empty / error / slow
 * states without touching real data.
 *   mock(page, /\/api\/items/, { body: { statusCode: 200, data: [] } })
 *   mock(page, /\/api\/items/, { status: 500, body: { message: 'boom' } })
 *   mock(page, /\/api\/items/, { delayMs: 8000 })              // slow, real data
 *   mock(page, /\/api\/items/, { transform: (json) => json })   // edit real data
 *   mock(page, /\/api\/items/, { abort: true })                 // API down
 */
export async function mock(
  page,
  pattern,
  { status, body, delayMs = 0, transform, abort = false, method } = {},
) {
  await page.route(pattern, async (route) => {
    if (method && route.request().method() !== method) return route.fallback();
    // Anything without body/abort reaches the real API. For writes that means real
    // data gets created, so refuse unless the caller fakes the response.
    if (route.request().method() !== "GET" && body === undefined && !abort) {
      console.error(
        `!! mock(): blocked ${route.request().method()} ${route.request().url()} — it would hit the real API. Pass body/abort, or method: 'GET'.`,
      );
      return route.abort("blockedbyclient");
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (abort) return route.abort("connectionrefused");
    if (body !== undefined) {
      return route.fulfill({
        status: status ?? 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    }
    const res = await route.fetch();
    if (!transform)
      return route.fulfill({ response: res, status: status ?? res.status() });
    const json = transform(await res.json());
    return route.fulfill({
      response: res,
      status: status ?? res.status(),
      body: JSON.stringify(json),
    });
  });
}

// ── run structure & interaction helpers ──────────────────────────────────────

/**
 * Runs one plan step: marks the log segment, catches failures so one broken step
 * doesn't end the run, stores the result and re-saves `<name>.json` each time.
 *   const results = {};
 *   await step(log, results, 'filter-status', async () => ({ rows: await rows.count() }), 'flows');
 */
export async function step(log, results, name, fn, saveAs) {
  markStep(log, name);
  const t0 = Date.now();
  try {
    results[name] = { ok: true, ms: 0, ...(await fn()) };
  } catch (err) {
    results[name] = {
      ok: false,
      error: String(err.message ?? err).slice(0, 400),
    };
  }
  results[name].ms = Date.now() - t0;
  console.error(
    `${results[name].ok ? "ok  " : "FAIL"} ${name} (${results[name].ms} ms)${results[name].ok ? "" : " — " + results[name].error}`,
  );
  if (saveAs) saveJson(saveAs, results);
  return results[name];
}

/** Captures the request an action sends (to prove a filter / id was sent). */
export async function captureRequest(
  page,
  urlPattern,
  action,
  { method } = {},
) {
  const [req] = await Promise.all([
    page.waitForRequest(
      (r) => urlPattern.test(r.url()) && (!method || r.method() === method),
      { timeout: 15000 },
    ),
    action(),
  ]);
  let body = req.postData();
  try {
    body = JSON.parse(body);
  } catch {
    /* not JSON */
  }
  return { method: req.method(), url: req.url().replace(API_URL, ""), body };
}

/** What has keyboard focus right now, and is the focus ring visible. */
export async function activeElement(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const cs = el ? getComputedStyle(el) : null;
    return el
      ? {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          name:
            el.getAttribute("aria-label") ??
            el.textContent?.trim().slice(0, 50),
          focusVisible: el.matches(":focus-visible"),
          outline:
            cs.outlineStyle !== "none"
              ? `${cs.outlineStyle} ${cs.outlineColor}`
              : cs.boxShadow !== "none"
                ? "box-shadow"
                : "none",
        }
      : null;
  });
}

/** Presses Tab `n` times and lists where focus went — keyboard order in one call. */
export async function tabSequence(page, n = 10) {
  const seq = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    seq.push(await activeElement(page));
  }
  return seq;
}

/**
 * Switches the app theme. With profile ui.theme.toggle it clicks that control and
 * reads ui.theme.attribute on <html> (apps that keep the theme in localStorage
 * ignore prefers-color-scheme). Without it, it emulates prefers-color-scheme.
 * Safe: a local preference, not saved to the user.
 */
export async function setTheme(page, mode) {
  if (!UI.theme?.toggle) {
    await page.emulateMedia({ colorScheme: mode });
    return mode;
  }
  const current = () => currentTheme(page);
  for (let i = 0; i < 2; i++) {
    if ((await current()) === mode) return mode;
    await page.locator(UI.theme.toggle).first().click();
    await page.waitForTimeout(250);
  }
  return current();
}

/** The theme the page shows now ("light" / "dark"), as setTheme understands it. */
export async function currentTheme(page) {
  if (!UI.theme?.toggle)
    return page.evaluate(() =>
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
  return page.evaluate(
    (a) => document.documentElement.getAttribute(a),
    UI.theme.attribute ?? "data-theme",
  );
}

// ── consistency with similar features ────────────────────────────────────────

/**
 * How one element looks: text, icon, size, spacing, font, colours.
 * Colours are also mapped back to the CSS variable (profile ui.cssTokenPrefix,
 * e.g. "--brand-") with the same value
 * (null = a colour that is not a theme token, i.e. hardcoded or derived).
 * Take one per sibling (same theme, same width) and diff with compareFingerprints.
 */
export async function fingerprint(locator) {
  const prefix = UI.cssTokenPrefix ?? "--";
  return locator.first().evaluate((el, prefix) => {
    const cs = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    const tokens = {};
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      for (const rule of rules) {
        for (const prop of rule.style ?? []) {
          if (!prop.startsWith(prefix) || prop in tokens) continue;
          tokens[prop] = root.getPropertyValue(prop).trim();
        }
      }
    }
    // Resolve each token to the browser's rgb() form so it compares with computed styles.
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const tokenByColor = {};
    for (const [name, value] of Object.entries(tokens)) {
      probe.style.color = "";
      probe.style.color = value;
      if (!probe.style.color) continue; // not a colour
      const rgb = getComputedStyle(probe).color;
      tokenByColor[rgb] ??= name;
    }
    probe.remove();
    const color = (v) => ({ value: v, token: tokenByColor[v] ?? null });
    const r = el.getBoundingClientRect();
    const icon = el.querySelector("svg");
    return {
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim().slice(0, 60),
      icon: icon
        ? ([...icon.classList].find(
            (c) => c.startsWith("lucide-") && c !== "lucide-react",
          ) ??
          ([...icon.classList][0] || "svg (inline)"))
        : null,
      iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : null,
      width: Math.round(r.width),
      height: Math.round(r.height),
      padding: cs.padding,
      gap: cs.gap,
      borderRadius: cs.borderRadius,
      borderWidth: cs.borderWidth,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: color(cs.color),
      background: color(cs.backgroundColor),
      borderColor: color(cs.borderColor),
      cursor: cs.cursor,
      testId: el.getAttribute("data-testid"),
    };
  }, prefix);
}

/**
 * Differences between two fingerprints, one row per property. Width is skipped
 * by default because labels differ in length; sizes within `tolerancePx` match.
 */
export function compareFingerprints(
  a,
  b,
  { ignore = ["text", "width", "testId"], tolerancePx = 1 } = {},
) {
  const px = (v) => (typeof v === "number" ? v : null);
  const flat = (v) =>
    v && typeof v === "object" ? `${v.value} (${v.token ?? "no token"})` : v;
  return Object.keys(a)
    .filter((k) => !ignore.includes(k))
    .filter((k) => {
      if (px(a[k]) !== null && px(b[k]) !== null)
        return Math.abs(a[k] - b[k]) > tolerancePx;
      return flat(a[k]) !== flat(b[k]);
    })
    .map((k) => ({ prop: k, a: flat(a[k]), b: flat(b[k]) }));
}

// ── API ──────────────────────────────────────────────────────────────────────

/**
 * Logs in over the API with profile auth.api: POST loginPath → token at tokenPath,
 * or a 2FA challenge (challengePath) → POST twoFactor.path with the code.
 * Prefer launch().token() — it reuses the browser's login and costs no extra auth call.
 */
export async function apiLogin() {
  const cfg = AUTH.api;
  if (!cfg?.loginPath)
    throw new Error(
      `Project ${PROJECT.name} has no auth.api.loginPath; use launch().token() instead.`,
    );
  const { email, password, code } = creds();
  const post = (path, body) =>
    fetch(API_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: await r.json() }));

  const first = await post(cfg.loginPath, {
    [cfg.emailKey ?? "email"]: email,
    [cfg.passwordKey ?? "password"]: password,
    ...cfg.extraBody,
  });
  const token = getPath(first.json, cfg.tokenPath);
  if (first.status < 300 && token) return token;
  const tf = cfg.twoFactor;
  const challenge = tf && getPath(first.json, tf.challengePath);
  if (!challenge)
    throw new Error(
      `API login failed: ${first.status} ${JSON.stringify(first.json).slice(0, 200)}`,
    );
  if (!code)
    throw new Error(
      "Account asks for 2FA: save twoFactor on the account, or set QA_2FA.",
    );
  const second = await post(tf.path, {
    [tf.challengeKey ?? "challenge_id"]: challenge,
    [tf.codeKey ?? "code"]: code,
  });
  const token2 = getPath(second.json, cfg.tokenPath);
  if (second.status >= 300 || !token2)
    throw new Error(
      `2FA failed: ${second.status} ${JSON.stringify(second.json).slice(0, 200)}`,
    );
  return token2;
}

/** Token saved by the last launch().close(), if it is still young enough to use. */
export function cachedToken() {
  if (!existsSync(TOKEN_FILE)) return null;
  const { token, savedAt } = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  return Date.now() - savedAt < TOKEN_MAX_AGE_MS ? token : null;
}

/**
 * Small fetch client. Never throws on HTTP errors: returns { status, json } and
 * records >= 400 in `errors`, so isolation checks (expect 403/404) read naturally.
 * Pass launch()'s `token` getter (not its value) in long runs — the browser
 * refreshes the token and the client picks up the new one.
 */
export function apiClient(token) {
  const errors = [];
  const call = async (method, path, body) => {
    const bearer = typeof token === "function" ? token() : token;
    const res = await fetch(API_URL + path, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    if (res.status >= 400)
      errors.push({
        method,
        path,
        status: res.status,
        body: text.slice(0, 300),
      });
    return { status: res.status, json, text };
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    patch: (p, b) => call("PATCH", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
    errors,
  };
}

/** The live OpenAPI spec (profile api.openApiPath), for checking what the backend actually serves. */
export async function openApiSpec() {
  if (!PROJECT.api?.openApiPath)
    throw new Error(`Project ${PROJECT.name} has no api.openApiPath.`);
  return (await fetch(API_URL + PROJECT.api.openApiPath)).json();
}

// ── database (read-only) ─────────────────────────────────────────────────────

/** psql command for profile db: {kind:"docker-psql", container, user, database} or {kind:"psql", url}. */
function psqlCommand() {
  const db = PROJECT.db;
  const readOnly = "-c default_transaction_read_only=on";
  if (db?.kind === "docker-psql")
    return {
      cmd: "docker",
      args: ["exec", "-e", `PGOPTIONS=${readOnly}`, db.container, "psql",
        "-U", db.user, "-d", db.database],
      env: process.env,
    };
  if (db?.kind === "psql")
    return {
      cmd: "psql",
      args: [assertLocalDb(db.url)],
      env: { ...process.env, PGOPTIONS: readOnly },
    };
  throw new Error(
    `Project ${PROJECT.name} has no supported db (kind docker-psql or psql).`,
  );
}

function assertLocalDb(url) {
  assertLocal(url.replace(/^postgres(ql)?:/, "http:"), "Database URL");
  return url;
}

/**
 * Read-only SQL against the project's local Postgres. The session is forced
 * read-only, so a stray write fails instead of changing data.
 * Returns rows as objects. Tenant column: profile tenancy.tenantColumn.
 */
export function sql(query) {
  const { cmd, args, env } = psqlCommand();
  const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${query.trim().replace(/;$/, "")}) t`;
  const out = execFileSync(
    cmd,
    [...args, "-At", "-v", "ON_ERROR_STOP=1", "-c", wrapped],
    { encoding: "utf8", env },
  );
  return JSON.parse(out.trim() || "[]");
}

/**
 * The test user's row (id, email, role, tenant, superadmin flag) from profile
 * tenancy — needed for most isolation and DB checks. Null without db/tenancy.
 */
export function whoami() {
  const t = PROJECT.tenancy;
  if (!PROJECT.db || !t?.usersTable) return null;
  const email = creds().email.replace(/'/g, "''");
  const cols = [
    "id",
    `${t.emailColumn ?? "email"} as email`,
    t.roleColumn && `${t.roleColumn} as role`,
    t.tenantColumn && `${t.tenantColumn} as tenant_id`,
    t.superadminColumn && `${t.superadminColumn} as superadmin`,
  ].filter(Boolean);
  return (
    sql(
      `select ${cols.join(", ")} from ${t.usersTable} where ${t.emailColumn ?? "email"} = '${email}'`,
    )[0] ?? null
  );
}
