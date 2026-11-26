// The tab icon of the QA reports: ../qa-icon.svg, a clipboard with a check mark in the colours of the
// Shipyard icon. compare.mjs puts it in each report, and the plans dashboard's report server
// (apps/dashboard/server.mjs) uses it for its list page and /favicon.ico. The SVG is the one source.
import { readFileSync } from "node:fs";

/** The icon SVG as it is in the file: 1024 x 1024 with the 100 px margin of the macOS icon grid. */
export const QA_ICON_SVG = readFileSync(new URL("../qa-icon.svg", import.meta.url), "utf8");

/** The icon cut to its square (viewBox 100 100 824 824): the margin would only make the 16 px tab icon smaller. */
export const QA_ICON = QA_ICON_SVG.replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"');

/** QA_ICON as a data: URI for <link rel="icon">, so a report that is sent on its own keeps its icon. */
export const QA_ICON_URI = "data:image/svg+xml," + encodeURIComponent(QA_ICON);
