// Turns a report page into the link the user clicks. The VS Code chat opens only
// http(s) links (a file:// link does nothing), so the plans dashboard serves the
// reports folders read-only at http://localhost:4898/<project>/<file>.html.
// This is the one place that decides where a report is published (later: Showpane).
// Usage: node scripts/publish.mjs <report.html>   → prints { url, file, served }
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE } from "./profile.mjs";

const PORT = process.env.QA_REPORTS_PORT ?? 4898;

/** { url, file, served }: url is null when the file can't be served (server down, or outside the reports folders). */
export async function publish(file) {
  const abs = resolve(file);
  const [project, folder, name, ...rest] = relative(STORE, abs).split(sep);
  const local = { url: null, file: abs, served: false };
  if (rest.length || folder !== "reports" || !name || project.startsWith("..")) return local;
  const url = `http://localhost:${PORT}/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    await res.body?.cancel();
    if (res.ok) return { url, file: abs, served: true };
  } catch {}
  return local;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node publish.mjs <report.html>");
  console.log(JSON.stringify(await publish(process.argv[2]), null, 2));
}
