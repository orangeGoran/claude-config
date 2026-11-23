// Tests for missing() in the browser-usability-test profile: which fields a project still
// needs. null means "this app has none" (api, db) or "single-tenant" (tenancy), and auth.none
// means "no login", so a no-login app such as the plans dashboard can pass the pipeline preflight.
//   node --test test/browser-usability-profile.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// readAccounts() reads the store, so point it at an empty temp folder before the import
const store = mkdtempSync(path.join(os.tmpdir(), 'qa-profile-test-'));
process.env.QA_HOME = store;
const { missing } = await import('../skills/browser-usability-test/scripts/profile.mjs');
test.after(() => rmSync(store, { recursive: true, force: true }));

const base = { name: 'demo-app', repos: [], app: { url: 'http://127.0.0.1:4911' } };
const fields = (project) => missing(project).map((g) => g.split(' ')[0]);

test('a profile with nothing answered lists every field', () => {
  assert.deepEqual(fields(base), ['api.url', 'db', 'tenancy', 'roles', 'accountSetup', 'accounts']);
});

test('null answers api, db and tenancy', () => {
  assert.deepEqual(fields({ ...base, api: null, db: null, tenancy: null }), ['roles', 'accountSetup', 'accounts']);
});

test('auth.none drops roles, account setup and accounts, so a no-login app has nothing missing', () => {
  assert.deepEqual(fields({ ...base, api: null, db: null, tenancy: null, auth: { none: true } }), []);
});

test('an api object without a url is still missing its url', () => {
  assert.deepEqual(fields({ ...base, api: {}, db: null, tenancy: null, auth: { none: true } }), ['api.url']);
});
