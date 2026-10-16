// Project profiles: links, database access, test accounts and notes, kept per
// project in the user's home folder (never in a repo). One profile serves every
// repo of the project (frontend, backend, worktrees), matched by git remote or path.
//
// Usage:
//   node profile.mjs resolve                    which project this repo belongs to + what is missing
//   node profile.mjs init <project> <role>      new project with the current repo (role: frontend|backend|…)
//   node profile.mjs add-repo <project> <role>  add the current repo to an existing project
//   node profile.mjs add-account <project> '<json>'
//        json: {"label","email","password","twoFactor","role","tenant","tenantId","superadmin","notes"}
//        same email or label → updated. Stored in accounts.json, mode 600.
//
// Env: QA_HOME (store folder), QA_PROJECT (skip repo matching).
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_SCHEMA = join(SKILL_DIR, "references", "profile.schema.json");
const ACCOUNTS_SCHEMA = join(SKILL_DIR, "references", "accounts.schema.json");

export const STORE =
  process.env.QA_HOME ??
  join(homedir(), ".claude", "browser-usability-test", "projects");

// Local development only: the skill refuses to drive anything on the public web.
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0|.+\.localhost|.+\.test|.+\.local)$/i;

export const expandHome = (p) => p?.replace(/^~(?=\/|$)/, homedir());

/** Throws unless `url` points at this machine (localhost, *.test, *.local). */
export function assertLocal(url, what = "URL") {
  if (!url) return url;
  const host = new URL(url).hostname;
  if (!LOCAL_HOST.test(host))
    throw new Error(
      `${what} ${url} is not local. This skill only tests local development (localhost, *.test, *.local).`,
    );
  return url;
}

const git = (cwd, ...args) => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

/** git@github.com:Org/Repo.git and https://github.com/Org/Repo → github.com/org/repo */
export function normalizeRemote(url) {
  if (!url) return null;
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(":", "/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** The repo `cwd` is in: its top folder, the main checkout (for worktrees) and origin. */
export function repoIdentity(cwd = process.cwd()) {
  const top = git(cwd, "rev-parse", "--show-toplevel");
  if (!top) return { top: null, main: null, remote: null };
  const common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const main = common && basename(common) === ".git" ? dirname(common) : top;
  return { top, main, remote: normalizeRemote(git(cwd, "remote", "get-url", "origin")) };
}

const projectDir = (name) => join(STORE, name);
const projectFile = (name) => join(projectDir(name), "project.json");
const accountsFile = (name) => join(projectDir(name), "accounts.json");
export const notesFile = (name) => join(projectDir(name), "notes.md");

export function listProjects() {
  if (!existsSync(STORE)) return [];
  return readdirSync(STORE).filter((d) => existsSync(projectFile(d)));
}

// ── schema checks ────────────────────────────────────────────────────────────

let validators;
function schemaValidators() {
  if (validators) return validators;
  let Ajv;
  try {
    Ajv = createRequire(join(SKILL_DIR, "package.json"))("ajv");
  } catch {
    throw new Error(
      `ajv is not installed for this skill. Run: npm install --prefix ${SKILL_DIR}`,
    );
  }
  const ajv = new Ajv({ allErrors: true, verbose: true, discriminator: true });
  const load = (f) => ajv.compile(JSON.parse(readFileSync(f, "utf8")));
  validators = { project: load(PROJECT_SCHEMA), accounts: load(ACCOUNTS_SCHEMA) };
  return validators;
}

// Edit distance, to suggest the key a typo meant.
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

/** One plain-language line per schema error, e.g. "auth.selector is not allowed (did you mean selectors?)". */
function describeErrors(errors) {
  const where = (path) => path.replace(/^\//, "").replace(/\/(\d+)/g, "[$1]").replace(/\//g, ".") || "(top level)";
  const lines = errors
    // oneOf/anyOf/if wrappers repeat what the branch errors already say.
    .filter((e) => !["oneOf", "anyOf", "if"].includes(e.keyword))
    // "must be null" from an optional-null branch hides the real error in the object branch.
    .filter((e) => !(e.keyword === "type" && e.params.type === "null" && e.data !== null))
    .map((e) => {
      const at = where(e.instancePath);
      if (e.keyword === "additionalProperties") {
        const key = e.params.additionalProperty;
        const allowed = Object.keys(e.parentSchema.properties ?? {});
        const near = allowed
          .map((k) => [k, distance(key.toLowerCase(), k.toLowerCase())])
          .sort((x, y) => x[1] - y[1])[0];
        const hint = near && near[1] <= 3 ? ` (did you mean ${near[0]}?)` : ` (allowed: ${allowed.join(", ")})`;
        return `${at === "(top level)" ? key : `${at}.${key}`} is not allowed${hint}`;
      }
      if (e.keyword === "required") return `${at} needs ${e.params.missingProperty}`;
      if (e.keyword === "enum") return `${at} must be one of ${e.params.allowedValues.join(", ")}`;
      if (e.keyword === "const") return `${at} must be ${JSON.stringify(e.params.allowedValue)}`;
      if (e.keyword === "discriminator")
        return `${at}.kind must be one of ${e.parentSchema.oneOf.map((b) => b.properties.kind.const).join(", ")}`;
      if (e.keyword === "pattern") return `${at} ${JSON.stringify(e.data)} must match ${e.params.pattern}`;
      return `${at} ${e.message}`;
    });
  return [...new Set(lines)];
}

function check(kind, file, data) {
  const validate = schemaValidators()[kind];
  if (validate(data)) return data;
  throw new Error(
    `${file} does not match ${kind === "project" ? PROJECT_SCHEMA : ACCOUNTS_SCHEMA}:\n` +
      describeErrors(validate.errors).map((l) => `  - ${l}`).join("\n"),
  );
}

// ── projects ─────────────────────────────────────────────────────────────────

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** The project profile, checked against the schema (validate: false only for repo matching). */
export function readProject(name, { validate = true } = {}) {
  const file = projectFile(name);
  const project = readJson(file);
  if (validate) check("project", file, project);
  return { ...project, name };
}

function writeProject(project) {
  const file = projectFile(project.name);
  const data = { $schema: pathToFileURL(PROJECT_SCHEMA).href, ...project };
  check("project", file, data);
  mkdirSync(projectDir(project.name), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** The project whose repos include `cwd` (by origin remote, then by path), or null. */
export function findProject(cwd = process.cwd()) {
  const id = repoIdentity(cwd);
  if (process.env.QA_PROJECT) {
    const project = readProject(process.env.QA_PROJECT);
    return { project, repo: matchRepo(project, id), id };
  }
  // Match first, check after: a broken profile of another project must not block this one.
  const matches = listProjects()
    .map((name) => ({ name, repo: matchRepo(readProject(name, { validate: false }), id) }))
    .filter((m) => m.repo);
  if (matches.length > 1)
    throw new Error(
      `${id.top} belongs to more than one project: ${matches.map((m) => m.name).join(", ")}. Remove it from all but one project.json, or set QA_PROJECT.`,
    );
  if (matches.length) return { project: readProject(matches[0].name), repo: matches[0].repo, id };
  return { project: null, repo: null, id };
}

function matchRepo(project, id) {
  return (
    (project.repos ?? []).find(
      (r) =>
        (id.remote && normalizeRemote(r.remote) === id.remote) ||
        [id.top, id.main].includes(expandHome(r.path)),
    ) ?? null
  );
}

/** Like findProject, but throws a message that tells Claude what to do next. */
export function requireProject(cwd = process.cwd()) {
  const found = findProject(cwd);
  if (!found.project)
    throw new Error(
      `No browser-usability-test project for ${found.id.top ?? cwd}. Run: node ${fileURLToPath(import.meta.url)} resolve`,
    );
  return found;
}

// ── accounts ─────────────────────────────────────────────────────────────────

export function readAccounts(name) {
  const file = accountsFile(name);
  if (!existsSync(file)) return [];
  return check("accounts", file, readJson(file)).accounts;
}

/** Adds or updates (same email or label) one account. The file stays mode 600. */
export function saveAccount(name, account) {
  const accounts = readAccounts(name);
  account.label ??= account.email?.split("@")[0].replace(/[^A-Za-z0-9._-]/g, "-");
  const roles = readProject(name).roles;
  if (account.role && roles?.length && !roles.includes(account.role))
    throw new Error(`Role "${account.role}" is not a role of ${name}. Roles: ${roles.join(", ")}.`);
  const i = accounts.findIndex(
    (a) => a.email === account.email || a.label === account.label,
  );
  if (i >= 0) accounts[i] = { ...accounts[i], ...account };
  else accounts.push(account);
  const file = accountsFile(name);
  const data = { $schema: pathToFileURL(ACCOUNTS_SCHEMA).href, accounts };
  check("accounts", file, data);
  mkdirSync(projectDir(name), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return account;
}

/**
 * The account for this run:
 *   QA_EMAIL + QA_PASSWORD (+ QA_2FA)  credentials given in the call
 *   QA_ACCOUNT=<label|email>           a saved account
 *   the only saved account             when there is just one
 * Returns null when it can't decide; creds() then explains.
 */
export function pickAccount(project) {
  if (process.env.QA_EMAIL && process.env.QA_PASSWORD) {
    const saved = readAccounts(project.name).find(
      (a) => a.email === process.env.QA_EMAIL,
    );
    return {
      ...saved,
      label: saved?.label ?? process.env.QA_EMAIL.split("@")[0],
      email: process.env.QA_EMAIL,
      password: process.env.QA_PASSWORD,
      twoFactor: process.env.QA_2FA ?? saved?.twoFactor ?? "",
    };
  }
  const accounts = readAccounts(project.name);
  const wanted = process.env.QA_ACCOUNT;
  if (wanted) return accounts.find((a) => a.label === wanted || a.email === wanted) ?? null;
  return accounts.length === 1 ? accounts[0] : null;
}

const masked = ({ password, ...rest }) => ({ ...rest, password: password ? "***" : "" });

// ── what is still missing ────────────────────────────────────────────────────

/** Fields the skill needs and the profile doesn't have yet, in plain words. */
export function missing(project) {
  const gaps = [];
  if (!project.app?.url) gaps.push("app.url (where the frontend runs)");
  if (!project.api?.url) gaps.push("api.url (where the backend runs; skip if there is no separate API)");
  if (!project.db) gaps.push("db (read-only database access; skip if not available)");
  if (!project.roles?.length) gaps.push("roles (user roles the app has)");
  if (!project.tenancy) gaps.push("tenancy (users table, tenant column; null if single-tenant)");
  if (!project.accountSetup) gaps.push("accountSetup (how to create a test account; command or steps)");
  if (!readAccounts(project.name).length) gaps.push("accounts (no test account saved yet)");
  for (const r of project.repos ?? [])
    if (!existsSync(expandHome(r.path) ?? "")) gaps.push(`repos: ${r.role} path ${r.path} not found on this machine`);
  return gaps;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function cli([cmd, ...args]) {
  const out = (v) => console.log(JSON.stringify(v, null, 2));
  const repoEntry = (role) => {
    const id = repoIdentity();
    if (!id.top) throw new Error("Not inside a git repo.");
    return { role, path: id.main.replace(homedir(), "~"), remote: id.remote };
  };

  if (cmd === "resolve") {
    const { project, repo, id } = findProject();
    if (!project)
      return out({ project: null, repo: id, store: STORE, existingProjects: listProjects() });
    for (const u of [project.app?.url, project.api?.url]) assertLocal(u);
    return out({
      project: project.name,
      thisRepo: repo,
      store: projectDir(project.name),
      ...project,
      name: undefined,
      accounts: readAccounts(project.name).map(masked),
      notes: existsSync(notesFile(project.name)) ? notesFile(project.name) : null,
      missing: missing(project),
    });
  }
  if (cmd === "init") {
    const [name, role = "frontend"] = args;
    if (!name) throw new Error("Usage: init <project> <role>");
    if (existsSync(projectFile(name))) throw new Error(`Project ${name} exists. Use add-repo.`);
    writeProject({ name, repos: [repoEntry(role)] });
    if (!existsSync(notesFile(name)))
      writeFileSync(notesFile(name), `# ${name}: notes for browser usability tests\n`);
    return out({ created: projectFile(name), missing: missing(readProject(name)) });
  }
  if (cmd === "add-repo") {
    const [name, role] = args;
    if (!name || !role) throw new Error("Usage: add-repo <project> <role>");
    const project = readProject(name);
    const entry = repoEntry(role);
    project.repos = [...(project.repos ?? []).filter((r) => r.remote !== entry.remote), entry];
    writeProject(project);
    return out({ project: name, repos: project.repos });
  }
  if (cmd === "add-account") {
    const [name, json] = args;
    if (!name || !json) throw new Error("Usage: add-account <project> '<json>'");
    if (!existsSync(projectFile(name))) throw new Error(`No project ${name}.`);
    return out({ saved: masked(saveAccount(name, JSON.parse(json))) });
  }
  console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(4, 13).join("\n"));
  process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}
