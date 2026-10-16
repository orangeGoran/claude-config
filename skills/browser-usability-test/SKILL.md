---
name: browser-usability-test
description: Usability-test a page or feature of a locally running web app in a real headless Chromium — sign in as a test account, click through it like a person, compare the screen with the API and the local database, compare a new feature with similar features already in the app, run axe and responsive checks, and return one report with findings, frontend file:line causes, a copy-paste block for the backend team and a fix list. Works from any repo of a project (frontend, backend, worktree) and across projects; links, database access and test accounts are saved per project in the home folder and asked for once when missing. Credentials can be given in the call. With no route given, it tests the pages touched by the current changes (uncommitted + branch), and asks only when there are none. Local development only. Use whenever the user asks to QA, usability-test, smoke-test, click through, "try out", check in the browser, find bugs, or check that a new feature matches the rest of the app on a route or feature (e.g. /dashboard, /admin/users, /cases/:id) — even if they don't say "Playwright" or "usability".
---

# Browser usability test

Test one page or feature the way a real user meets it, in a real browser, and prove every finding with evidence (screenshot, API payload, SQL row, measured layout, or code line). The output is one report the user can act on.

**Local development only.** The scripts refuse any app, API or database URL that is not on this machine (localhost, 127.0.0.1, `*.test`, `*.local`). Never point the skill at a deployed or public site.

`SKILL_DIR` below is the folder of this file (`~/.claude/skills/browser-usability-test`). Run its scripts from the current repo: `node $SKILL_DIR/scripts/<file>.mjs`. Write run-specific scripts in the session scratchpad and import `lib.mjs` by absolute path; don't add page-specific code to `lib.mjs`.

## 0. Before anything

### 0.1 Tools

`test -d $SKILL_DIR/node_modules || npm install --prefix $SKILL_DIR` (Playwright and axe belong to the skill, so a backend repo works too). If Chromium is missing: `npx --prefix $SKILL_DIR playwright-core install chromium-headless-shell`.

### 0.2 Project profile

Run `node $SKILL_DIR/scripts/profile.mjs resolve`. One profile per project lives in `~/.claude/browser-usability-test/projects/<project>/`, outside every repo: `project.json` (repos, links, database, roles, tenancy, auth, UI hooks), `accounts.json` (test accounts, mode 600) and `notes.md` (project rules). Schema and an example: `references/profile.md`. The profile matches the current repo by git remote or path, so the frontend repo, the backend repo and their worktrees all find the same project.

- **`project: null`** — this repo is not in any project. If `existingProjects` has the project this repo belongs to (e.g. the backend of an existing frontend), run `profile.mjs add-repo <project> <role>`. Otherwise run `profile.mjs init <project> <role>` and fill `project.json` (below).
- **`missing` is not empty** — fill the gaps. Find what you can first: ports in `package.json` scripts, `.env.example`, `docker-compose*.yml`, vite/next config; login form selectors in the login page; the users/tenant tables in the DB or the ORM entities; roles from the role enum. Then ask the user only for what you could not find, in one chat message that lists your guesses for confirmation. Save the answers into `project.json` right away, so the next run (in any repo of the project) does not ask again.
- **`does not match … schema`** — `project.json` or `accounts.json` breaks its schema (`references/profile.schema.json`, `references/accounts.schema.json`). Each line names the field and, for a typo, the key it probably meant. Fix the file, then run `resolve` again. Never remove the check or add keys the schema doesn't know: project-specific facts that have no field go in `notes.md`. If the scripts need a new field, add it to the schema, `references/profile.md` and the code together.
- **Read `notes.md`** for project rules. Add to it whenever a run teaches a new rule (a rate limit, a selector trap, where guards live). Keep it current-state only.
- **Check services are up.** `curl` the app URL and the API health URL; `docker ps` should show every container in `services.docker`. If something is down, tell the user instead of testing a broken setup.

### 0.3 Account

Decide the account yourself. Ask only when no saved account fits.

1. **Credentials in the call.** If the user's message gives credentials (email, password, 2FA code, role, tenant — in any form), use them and save them first: `profile.mjs add-account <project> '<json>'` (same email → updated).
2. **Pick from saved accounts** by what the test needs: the role the page requires (admin route → admin/superadmin account; a "Viewer can't edit" check → Viewer), the tenant, and a second tenant for isolation checks. State the chosen account(s) in the test plan.
3. **Accounts in the repos.** Look for local QA env files in every repo of the profile (`.env.qa.local`, `.env.test.local`, other gitignored `.env.*.local`) with test credentials (`*_TEST_EMAIL` / `*_TEST_PASSWORD` / `*_TEST_2FA` or similar). Look up each email in the DB for role, superadmin flag and tenant, and save it with `add-account` (`notes: "from <file>"`). Read the password in a script and pass it straight to `add-account`; never print it.
4. **No fitting account** (the needed role or tenant is missing, or no account at all):
   - If `accountSetup` exists in the profile, follow it (run its command, or do its steps through the API) to create the account, then save it with `add-account`. This is the automated path; don't ask.
   - Otherwise find a recipe in the code before asking. Look in every repo of the profile: user-creation endpoints in the OpenAPI spec (`POST …/users`, invite, register, setup-account), seed and fixture scripts, CLI or `package.json` scripts that create users, and how a new user gets a password (set directly, or an invite email; then check for a local mail catcher such as Mailpit in `.env*` / `docker-compose*.yml` and whether it is running). Write the recipe as concrete steps with real endpoints, commands and values for the needed role and tenant, show it to the user in one chat message and ask for a yes, because it writes data. On yes, save it as `accountSetup` (`{ "command": "…", "steps": ["…"], "confirmedAt": "<date>" }`), run it, check the login works, and save the account with `add-account`. Later runs follow the saved recipe without asking. When the user changes the recipe, save their version.
   - If no recipe can work (for example, the invite token only arrives by email and no mail catcher runs), say exactly which step is blocked and why (`file:line` or the endpoint), then ask the user in one chat message. List the roles the project has (`roles`, or the role enum / `select distinct <roleColumn>` from the DB). If the project is multi-tenant, list the tenants (`select id, name from <tenantsTable>`) and say which tenant(s) the test needs. Ask for either credentials per needed role/tenant, or the steps or command to create such an account. Save credentials with `add-account` (include `role`, `tenant`, `tenantId`, `superadmin`, `twoFactor`). Save creation steps as `accountSetup` in `project.json`, then run them, so the next run creates accounts without asking.

Pass the account to the scripts as `QA_ACCOUNT=<label|email>`, or with credentials from the call as `QA_EMAIL` / `QA_PASSWORD` / `QA_2FA`. Never write credentials into a repo file. Each account gets its own evidence and session folder automatically (`$TMPDIR/browser-qa/<project>/<account>`); set `QA_DIR` to a folder in the session scratchpad to keep evidence there, one per account.

### 0.4 What to test

When the user names a route or feature, test that. When they don't, test the current changes:

1. In every repo of the profile that exists on this machine (frontend and backend), collect the changes: uncommitted (`git status --porcelain`, including untracked files) and the branch's commits that are not on the default branch (`git diff --name-only $(git merge-base HEAD origin/<default>)...HEAD`; default from `git symbolic-ref refs/remotes/origin/HEAD`, else `main`). For a worktree, use the worktree you are in, not the main checkout. Uncommitted changes come first: when there are any, test those only. Use the branch commits only when nothing is uncommitted.
2. **There are changes:** map them to what a user sees. A frontend page or component → the routes that render it (follow imports to the route table). A backend endpoint, guard or DTO → the frontend pages that call that endpoint. Shared code (styles, layout, i18n) → 2–3 representative pages. Changes with no user-visible effect (tests, docs, config) → skip them. Up to 5 routes: test them; don't ask. Name each route in the test plan with one line on which change it covers (`file:line`). More than 5 (a long-lived branch can touch the whole app): don't test them all. List the routes grouped by area with the number of changed files each, and ask which to test.
3. **No changes**, or none with a user-visible effect: ask the user which page or feature to test, in one short chat message. Say what you checked ("no uncommitted changes and no commits ahead of main in SolveR and galileon-solver-api").

## 1. Learn what the page should do

Read before clicking, so findings compare against intent rather than guesses. The profile's `repos` gives the frontend and backend paths, whichever repo you started in. `notes.md` says where things live for this project. In general:

- Route → page component, then the components and hooks it uses.
- The API calls it makes and their types (generated contract types often state rules: limits, roles, tenant scoping). The live spec (`api.openApiPath`) when the types might be stale.
- i18n keys the page uses — they tell you the intended empty / error messages.
- The DB tables behind it (`sql("select table_name from information_schema.tables where table_name ilike '%x%'")`).
- **Similar features already in the app** (siblings). A new feature should look and behave like the features that solve the same problem: a new AI button like the other AI buttons, a new admin list like the other admin lists. Ask the user which siblings to compare with, with `AskUserQuestion`. Offer:
  - "I will name them": the user gives routes or components.
  - "I don't know, suggest some": search the code first (shared components, the same icon, the same i18n key prefix, the same API pattern), then propose 2–4 siblings with `file:line` and one line on why each one is similar. Let the user confirm or change the list.
  - "No comparison": skip section I and write "not tested" in the report.
  - Skip the question when the user already named siblings, or said not to compare.

## 2. Write and show the test plan

Fill `references/test-plan.md` for this page (sections A–I, plus the AI section for AI features). Keep it to concrete checks, each with what you expect. Name the account(s) and tenant(s) it uses. Show it to the user, then start. Stop and ask first only if the plan needs data writes (seeding through the API on a test tenant).

## 3. Drive the app

Start with `scripts/smoke.mjs <path>` for a fast baseline (console, network, axe, light/dark, four widths). Then write focused scripts per plan section using `lib.mjs` helpers. Look at every screenshot you take with the Read tool — a screenshot you didn't open is not evidence. `references/patterns.md` has working snippets for filters, mocking, measuring and DB comparison.

General rules (projects add their own in `notes.md`):

- **Login once per run.** Auth endpoints are often throttled; a login loop locks the account. `launch()` saves the session and later scripts restore it. If a login fails, stop and look at the screenshot — don't retry in a loop.
- **Rate limits.** When `summarizeLog()` reports `throttled` (429 on `auth.throttlePattern`), evidence after that point is junk: pause and rerun that part. Move around inside the app (click links, Back) instead of many `goto`/`reload` calls.
- **Never change saved user settings** (language, profile) to test a view. Use view-only means: `launch({ locale })`, mocks.
- **Don't wait for `networkidle`** in apps with SSE, websockets or polling. Wait for concrete UI (text, role, URL) or a short fixed wait.
- **Selectors:** prefer `getByRole` / `getByText`. Never pick controls by index when the layout has similar controls elsewhere (headers, toolbars).
- **Re-query after list changes.** After expand/collapse or filtering, query again (`.first()`, `.nth(i)`) instead of reusing an old `.all()` array.
- **Layout bugs:** measure (`measure()`, `horizontalOverflow()`) instead of judging from pixels alone. Use `fullPage` screenshots only when needed.
- **Dark/light:** `setTheme(page, mode)` uses the profile's theme toggle or emulates `prefers-color-scheme`. For contrast questions compare computed colors in both themes, not just axe output (`axeScan(page, { save })`).
- **Unhappy states via mocking only.** Reach empty / error / slow / API-down states with `mock()` (this browser only). Never delete or edit real data to get there. Mock the endpoint the page actually calls (check with `captureRequest` or the log).
- **Data writes:** seeding through the API on a test tenant is fine once the user agreed in the plan. Direct DB writes only when the user allows it, only on the test tenant. Read-only SQL (`sql()`, forced read-only) is always fine.
- **Long runs** (e.g. 20+ AI questions) go in the background (`run_in_background`); report progress as results come in.
- **Known noise** is listed in the profile (`noise`); `summarizeLog()` counts it separately. Add new noise there once you've confirmed it is harmless.

Structure each script as a list of `step(log, results, name, fn, file)` calls: one failing step is recorded and the rest still run, results are saved after every step, and duplicate API calls are counted per step. `whoami()` gives the account's id, role and tenant for DB checks; `captureRequest()` proves what a click sent; `tabSequence()` / `activeElement()` cover keyboard checks.

**Async features** (AI answers, background jobs): capture the POST that creates the job (`captureRequest`), then wait for the page's own "done" signal with a generous timeout, and record the time. Read the component first to find that signal.

## 4. Compare screen vs API vs DB

For every number or list the page shows, get the same thing from the API (`apiClient(token)`) and, where it matters, from the DB (`sql()`, tenant column from `tenancy.tenantColumn`). A mismatch is a finding only once you know which layer is wrong: the DB is the truth, the API should match it, the screen should match the API. Note filters, pagination and time zones before calling something a mismatch.

## 5. Compare with similar features

Compare the new feature with each confirmed sibling, in the code and on the screen:

- **Code.** Does it use the same shared component (or a copy of it)? The same design tokens, i18n key style, loading / empty / error states, confirm dialogs, filters in the URL? A shared component that exists but is not used is a finding.
- **Screen.** Open both, in the same theme and width, and diff them with `fingerprint()` + `compareFingerprints()`: size, padding, radius, font, icon, colours and the token behind each colour (`token: null` means a colour that is not a theme token; prefix from `ui.cssTokenPrefix`). Compare the states too: hover, disabled, loading. Put screenshots of both side by side as evidence. Reach the sibling page by clicking inside the app where possible.

**When the siblings disagree with each other, don't pick a winner.** Report the conflict under "Design decisions" in the report, with both options and how many places use each, and ask the user which one is the standard.

## 6. Security and isolation claims

Before writing anything about authorization, read the guard/middleware code that applies (in the backend repo from the profile, if it is on this machine; otherwise the contract's descriptions and the observed status codes) and quote it. Test it, don't assume it: another tenant's id → expect 404, a lower role on an admin route → expect 403, list responses contain only the account's tenant (check the tenant column of returned ids in the DB). If you can't read the guard, report what you observed and say the code wasn't checked.

## 7. Report

Use `references/report.md` exactly. When running as a subagent, return the report as text (the harness may refuse report files); evidence files are fine. Every finding needs a concrete example and evidence; for frontend causes, give `file:line` you actually read. Put backend gaps in one fenced, copy-paste block written for the backend team. Close by asking before fixing anything, and say which fixes are small and safe. Don't fix code during the test run — the user decides what to change.
