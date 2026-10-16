# Working patterns

Copy into a run script in the scratchpad. Import helpers by absolute path, and run it from a repo of the project with the account set, e.g. `QA_ACCOUNT=ana node run.mjs`. Examples use SolveR routes and tables; take yours from the profile (`tenancy`) and the code.

```js
import {
  launch,
  apiClient,
  whoami,
  sql,
  mock,
  step,
  captureRequest,
  axeScan,
  screenshot,
  measure,
  setTheme,
  tabSequence,
  activeElement,
  summarizeLog,
  saveJson,
  APP_URL,
  PROJECT,
} from "/Users/<you>/.claude/skills/browser-usability-test/scripts/lib.mjs";
const { page, context, log, token, close } = await launch({
  path: "/admin/brain",
});
const me = whoami(); // { id, email, role, tenant_id, superadmin } from profile tenancy
const api = apiClient(token); // pass the getter: tokens rotate in long runs
const results = {};
try {
  await step(
    log,
    results,
    "first-view",
    async () => ({
      heading: await page.getByRole("heading").first().innerText(),
    }),
    "flows",
  );
  await step(
    log,
    results,
    "filter-status",
    async () => {
      /* ... */ return { rows: 3 };
    },
    "flows",
  );
} finally {
  results.log = summarizeLog(log);
  saveJson("flows", results);
  await close();
}
```

## Filters and selects (Radix)

```js
// Scope by the trigger's current text — never pick comboboxes by index on admin pages
// (the header "Switch tenant…" combobox is also role=combobox).
await page
  .getByRole("combobox")
  .filter({ hasText: /all statuses/i })
  .click();
await page.getByRole("option", { name: /failed/i }).click();
await page.waitForTimeout(600);
const rows = page.locator("table tbody tr");
console.log("rows after filter", await rows.count());
```

## Back / forward / reload keep state?

```js
const filtered = page.url();
await page
  .getByRole("link", { name: /details/i })
  .first()
  .click();
await page.goBack();
console.log("url kept", page.url() === filtered);
await page.reload();
await page.getByRole("table").waitFor();
```

## Expand rows without stale handles

```js
const n = await page.getByRole("button", { name: /expand/i }).count();
for (let i = 0; i < n; i++) {
  await page
    .getByRole("button", { name: /expand/i })
    .first()
    .click(); // re-query each time
  await page.waitForTimeout(200);
}
```

## Screen vs API vs DB

```js
const { json } = await api.get("/v1/brain/queries?limit=20");
const onScreen = await page.locator("table tbody tr").count();
const [db] = sql(
  `select count(*)::int as n from brain_queries where ${PROJECT.tenancy.tenantColumn} = '${me.tenant_id}'`,
);
saveJson("brain-counts", {
  onScreen,
  api: json.data?.length,
  apiTotal: json.meta?.total,
  db: db.n,
});
```

## Isolation

Test the endpoint the page actually calls (e.g. `/v1/brain/queries/:id/chain`, not a guessed `/v1/brain/queries/:id`).

```js
const [foreign] = sql(
  `select id from brain_queries where ${PROJECT.tenancy.tenantColumn} <> '${me.tenant_id}' limit 1`,
);
console.log(
  "foreign id",
  (await api.get(`/v1/brain/queries/${foreign.id}`)).status,
); // expect 404
await page.goto(`${APP_URL}/brain/${foreign.id}`); // UI should show not-found, not data
```

## Unhappy states (this browser only)

```js
await mock(page, /\/v1\/brain\/queries(\?|$)/, {
  body: { statusCode: 200, message: "ok", data: [] },
}); // empty
await mock(page, /\/v1\/brain\/queries(\?|$)/, {
  status: 500,
  body: { message: "Internal error" },
}); // error
await mock(page, /\/v1\/brain\/queries(\?|$)/, {
  delayMs: 6000,
  method: "GET",
}); // slow (real data)
await mock(page, /\/v1\/brain\/queries(\?|$)/, { abort: true }); // API down
await page.reload(); // mocks apply to the next request — one reload per state; mind the page-load budget
await page.unrouteAll({ behavior: "ignoreErrors" }); // back to real data (the locale route is on the context, so it stays)
```

Match the real response envelope (look at one real response first) — a mock with the wrong shape tests a crash that real users never see.

## Layout and contrast

```js
console.log(
  await measure(page, '[data-testid="answer-panel"]', [
    "overflowY",
    "maxHeight",
  ]),
);
for (const mode of ["light", "dark"]) {
  await setTheme(page, mode);
  console.log(mode, await measure(page, "h1", ["color", "backgroundColor"]));
}
```

## Compare with a sibling feature

```js
// Same theme and width for both, or the diff only shows the theme.
await setTheme(page, "light");
const mine = await fingerprint(
  page.getByRole("button", { name: /suggest causes/i }),
);
await screenshot(page, "new-ai-button", {
  locator: page.getByRole("button", { name: /suggest causes/i }),
});
// Reach the sibling by clicking inside the app where you can (page-load budget).
await page.getByRole("link", { name: /d8/i }).click();
const sibling = await fingerprint(
  page.getByRole("button", { name: /generate with ai/i }),
);
saveJson("consistency-ai-button", {
  mine,
  sibling,
  diff: compareFingerprints(mine, sibling),
});
// diff → [{ prop: "height", a: 32, b: 36 }, { prop: "icon", a: "lucide-sparkles", b: "lucide-brain" }, ...]
// Repeat for states: hover (locator.hover()), disabled, loading.
```

## Keyboard

```js
console.log(await tabSequence(page, 8)); // where focus goes, and whether it's visible
await page.keyboard.press("Escape");
console.log(await activeElement(page)); // did focus return to the trigger?
```

## Prove what a click sent

```js
const sent = await captureRequest(
  page,
  /\/v1\/brain\/queries$/,
  () => askButton.click(),
  { method: "POST" },
);
// sent.body.methods → ['pdca'] when the PDCA filter is on
```

## Timing an async AI answer

```js
const t0 = Date.now();
const sent = await captureRequest(
  page,
  /\/v1\/brain\/queries$/,
  () => input.press("Enter"),
  { method: "POST" },
);
// Wait for the feature's own done signal — read the component to find it.
await page
  .getByRole("status")
  .filter({ hasText: /thinking|searching/i })
  .waitFor({ state: "detached", timeout: 120000 });
const total = Date.now() - t0;
```
