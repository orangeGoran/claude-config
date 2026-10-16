# Project profile

One folder per project in `~/.claude/browser-usability-test/projects/<project>/` (override with `QA_HOME`). Never in a repo.

| File | What it holds |
| --- | --- |
| `project.json` | Repos, links, database, roles, tenancy, account setup, auth, UI hooks, noise |
| `accounts.json` | Test accounts with passwords, mode 600. Write it with `profile.mjs add-account` |
| `notes.md` | Project rules for test runs: where code lives, traps, rate limits |

## `project.json`

Both files are checked against a JSON Schema every time they are read or written: [profile.schema.json](profile.schema.json) and [accounts.schema.json](accounts.schema.json). Unknown keys, wrong types and wrong values stop the run with a plain message (for example `auth.selector is not allowed (did you mean selectors?)`). Each file has a `"$schema"` line, so an editor shows the allowed keys.

The schema requires only `repos`; a run also needs `app.url` (`profile.mjs resolve` lists it under `missing`). Leave out what the project doesn't have; the helpers fall back to generic behaviour. The test-result JSON in the evidence folder has no schema.

| Key | Meaning | Used by |
| --- | --- | --- |
| `repos[]` | `{ role, path, remote }` per repo. `remote` is the normalized origin (`github.com/org/repo`); it matches clones in other folders and worktrees | `profile.mjs resolve`, `repoPath(role)` |
| `app.url` | Frontend URL. Must be local | `launch()` |
| `api.url` | Backend URL; defaults to `app.url`. Must be local | `apiClient()`, request counting |
| `api.healthPath` | Path that returns 200 when the API is up | `assertServersUp()` |
| `api.openApiPath` | Live OpenAPI JSON | `openApiSpec()` |
| `services.docker[]` | Containers that must run | step 0.2 check |
| `db` | `{ kind: "docker-psql", container, user, database }` or `{ kind: "psql", url }`. Postgres only; always read-only | `sql()` |
| `roles[]` | User roles, as the app names them | account choice, credential questions |
| `tenancy` | `{ usersTable, emailColumn, roleColumn, tenantColumn, superadminColumn, tenantsTable }`; `null` for single-tenant apps | `whoami()`, isolation checks |
| `accountSetup` | How to create a test account: `{ command, steps, confirmedAt }` (shell command and/or plain steps, e.g. API calls; `{role}`, `{email}`, `{tenant}` as placeholders). Found in the code by the agent and confirmed once by the user. `null` until known | step 0.3 |
| `auth.session` | `"bearer"` (token in `Authorization`) or `"cookie"` | session restore |
| `auth.loginPath` | Login page path (default `/login`) | `uiLogin()` |
| `auth.selectors` | `{ email, password, submit, twoFactor }` CSS selectors on the login page | `uiLogin()` |
| `auth.tokenResponse` | `{ urlPattern, path }`: responses that carry the access token | `launch().token()` |
| `auth.throttlePattern` | URL regex whose 429s mean "auth rate limit hit" | `summarizeLog().throttled` |
| `auth.tokenMaxAgeMinutes` | How long a cached token is reused (default 12) | `cachedToken()` |
| `auth.api` | `{ loginPath, extraBody, tokenPath, emailKey, passwordKey, twoFactor: { challengePath, path, challengeKey, codeKey } }` | `apiLogin()` |
| `ui.theme` | `{ toggle, attribute }` when the theme is a stored preference; omit to emulate `prefers-color-scheme` | `setTheme()` |
| `ui.localeRewrite` | `{ urlPattern, field }`: rewrite the user's locale in responses (view-only language) | `launch({ locale })` |
| `ui.cssTokenPrefix` | Design-token CSS variable prefix, e.g. `--brand-` | `fingerprint()` |
| `noise[]` | `{ kind: "http", status, method, urlIncludes }` or `{ kind: "console", pattern }` | `summarizeLog().ignoredNoise` |

## `accounts.json`

```json
{
  "accounts": [
    {
      "label": "ana-member",
      "email": "ana@example.test",
      "password": "…",
      "twoFactor": "000000",
      "role": "Member",
      "tenant": "Test tenant",
      "tenantId": "8f1c…",
      "superadmin": false,
      "notes": "created by accountSetup on 2026-10-16"
    }
  ]
}
```

## Example: a minimal project

```json
{
  "name": "shop",
  "repos": [
    { "role": "frontend", "path": "~/Workspace/shop-web", "remote": "github.com/acme/shop-web" },
    { "role": "backend", "path": "~/Workspace/shop-api", "remote": "github.com/acme/shop-api" }
  ],
  "app": { "url": "http://localhost:5173" },
  "api": { "url": "http://localhost:8080", "healthPath": "/health" },
  "db": { "kind": "psql", "url": "postgres://shop:shop@localhost:5432/shop" },
  "roles": ["admin", "staff", "customer"],
  "tenancy": null,
  "accountSetup": { "command": "cd ~/Workspace/shop-api && npm run create-user -- --role {role} --email {email}", "confirmedAt": "2026-10-16" },
  "auth": { "session": "cookie", "loginPath": "/sign-in" }
}
```

The full SolveR profile is a good example of a bearer-token, multi-tenant app with 2FA: `~/.claude/browser-usability-test/projects/solver/project.json`.
