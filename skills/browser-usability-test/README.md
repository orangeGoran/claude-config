# browser-usability-test

Claude Code skill: usability-test a page of a locally running web app in headless Chromium and report what works, what's broken and what the backend is missing. Ask Claude e.g. "usability test /admin/knowledge as a Leader". Works from any repo of a project (frontend, backend, worktree) and across projects. Local development only: the scripts refuse non-local URLs.

## Setup

Once per machine: `npm install --prefix ~/.claude/skills/browser-usability-test`. If Chromium is missing: `npx --prefix ~/.claude/skills/browser-usability-test playwright-core install chromium-headless-shell`.

Per project, nothing by hand: on the first run Claude finds the links, database and login details in the code, asks for the rest and for a test account, and saves them in `~/.claude/browser-usability-test/projects/<project>/`. The format is in [references/profile.md](references/profile.md).

## Running a script by hand

From any repo of the project:

```bash
S=~/.claude/skills/browser-usability-test/scripts
node $S/profile.mjs resolve                       # which project, saved accounts, what is missing
node $S/profile.mjs add-account solver '{"email":"ana@example.test","password":"…","twoFactor":"000000","role":"Member"}'

export QA_ACCOUNT=ana                             # a saved account (label or email)
# or credentials for this call only: QA_EMAIL=… QA_PASSWORD=… QA_2FA=…
node $S/smoke.mjs /brain
node $S/api.mjs GET /v1/brain/queries
node $S/api.mjs SQL "select count(*) from users"
```

The first script logs in through the UI and saves the session to `$TMPDIR/browser-qa/<project>/<account>/session-state.json` (or `$QA_DIR`); later scripts reuse it. Delete that file to force a new login. `api.mjs` reuses the token from the last browser run, so it costs no auth call.

Optional env: `QA_PROJECT` (skip repo matching), `QA_HOME` (profile store), `QA_APP_URL` / `QA_API_URL` (override the profile, still local only), `QA_DIR` (evidence folder), `QA_TOKEN` (skip login in `api.mjs`).

## Scripts

| File | What it does |
| --- | --- |
| `scripts/profile.mjs` | Finds the project for the current repo; `init`, `add-repo`, `add-account`. Checks `project.json` and `accounts.json` against `references/*.schema.json` on every read and write |
| `scripts/smoke.mjs <path>` | Opens a page signed in; prints headings, buttons, axe violations, console/network problems, light/dark screenshots, sideways-scroll check at 390/1100/1440/2555 px |
| `scripts/api.mjs <METHOD> <path> [body]` | Calls the API as the test account and prints the response; `SQL "<select>"` runs a read-only query |
| `scripts/lib.mjs` | Helpers below — import it from your own run scripts |

## `lib.mjs` helpers

| Helper | Purpose |
| --- | --- |
| `launch({ path, locale, viewport, colorScheme })` | Chromium + one login (or restored session); returns `{ page, context, log, token(), close() }` |
| `uiLogin(page)` | Email → password → 2FA through the login form |
| `forceLocale(context, 'en')` | Show the UI in a language without saving it to the user (profile `ui.localeRewrite`) |
| `collectLog` / `summarizeLog(log)` | Console errors/warnings, page errors, failed requests, HTTP ≥ 400, duplicate API calls; known noise counted separately |
| `screenshot(page, name, { fullPage, locator })` | PNG into `OUT_DIR` |
| `saveJson(name, data)` | JSON evidence into `OUT_DIR` |
| `measure(page, selector, styles)` | Box, overflow and computed styles of one element |
| `horizontalOverflow(page)` / `checkResponsive(page, name, widths)` | Sideways scroll check, with offending elements |
| `axeScan(page, { include, exclude, save })` | axe WCAG 2.1 A/AA violations, compact; `save` writes every node with contrast data |
| `mock(page, pattern, { body, status, delayMs, transform, abort })` | Fake empty/error/slow/down API states in this browser only; blocks non-GET calls that would reach the real API |
| `apiLogin()` / `apiClient(token)` | API login (profile `auth.api`, optional 2FA) and a fetch client that records errors |
| `openApiSpec()` | Live OpenAPI spec (profile `api.openApiPath`) |
| `sql(query)` | Read-only SELECT against the project's local Postgres (profile `db`); returns rows as objects |
| `creds()` | The run's account (`QA_ACCOUNT` or `QA_EMAIL`/`QA_PASSWORD`); never hardcode credentials |
| `whoami()` | Account's `id`, `email`, `role`, `tenant_id`, `superadmin` from the DB (profile `tenancy`) |
| `step(log, results, name, fn, file)` / `markStep(log, name)` | Run one plan step with try/catch, save results, count requests per step |
| `captureRequest(page, urlRegex, action)` | The request (method, url, JSON body) an action sends |
| `activeElement(page)` / `tabSequence(page, n)` | Keyboard focus checks |
| `setTheme(page, 'light' \| 'dark')` / `currentTheme(page)` | Switch / read the theme (profile `ui.theme` toggle, else `prefers-color-scheme`) |
| `fingerprint(locator)` / `compareFingerprints(a, b)` | How an element looks (size, spacing, font, icon, colours + the design token behind each, prefix `ui.cssTokenPrefix`) and the differences between two elements, for comparing with similar features |
| `assertServersUp()` | Stops with a clear message when the app or the API is not running (`launch()` calls it) |
| `cachedToken()` | Token saved by the last browser run, if younger than `auth.tokenMaxAgeMinutes` |
| `PROJECT`, `repoPath(role)`, `APP_URL`, `API_URL`, `OUT_DIR` | The resolved profile, a repo path by role, and the run's URLs and evidence folder |
