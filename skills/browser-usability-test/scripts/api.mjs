// Call the API as the test account and print the response, for comparing what the
// page shows with what the backend returns.
// Usage: node scripts/api.mjs GET /api/items
//        node scripts/api.mjs POST /api/items '{"json":"body"}'
//        node scripts/api.mjs SQL "select id from items limit 5"
// Token order: QA_TOKEN → token cached by the last browser run (no browser, no
// auth call) → restore the browser session (one page load) → one API login.
import { apiClient, apiLogin, cachedToken, launch, sql } from "./lib.mjs";

const [method = "GET", path, rawBody] = process.argv.slice(2);
if (!path) {
  console.error(
    "Usage: node scripts/api.mjs <GET|POST|PATCH|PUT|DELETE|SQL> <path|query> [json-body]",
  );
  process.exit(1);
}

if (method.toUpperCase() === "SQL") {
  console.log(JSON.stringify(sql(path), null, 2));
  process.exit(0);
}

let token = process.env.QA_TOKEN ?? cachedToken();
if (!token) {
  const session = await launch({ path: "/", locale: null });
  token = session.token();
  await session.close();
}
token ??= await apiLogin();

const api = apiClient(token);
const verb = {
  GET: "get",
  POST: "post",
  PATCH: "patch",
  PUT: "put",
  DELETE: "del",
}[method.toUpperCase()];
const res = await api[verb](path, rawBody ? JSON.parse(rawBody) : undefined);
console.log(`HTTP ${res.status}`);
console.log(res.json ? JSON.stringify(res.json, null, 2) : res.text);
