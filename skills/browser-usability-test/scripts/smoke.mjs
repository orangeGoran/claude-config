// First pass over one page: load it signed in, collect console/network problems,
// run axe in both themes, screenshot light + dark, check the four standard widths.
// Costs one page load.
// Usage: node scripts/smoke.mjs /dashboard [--locale=en] [--name=dashboard]
// Output: summary JSON on stdout and in $QA_DIR (default: $TMPDIR/browser-qa/<project>/<account>).
import {
  axeScan,
  checkResponsive,
  currentTheme,
  launch,
  OUT_DIR,
  saveJson,
  screenshot,
  setTheme,
  summarizeLog,
} from "./lib.mjs";

const path = process.argv[2] ?? "/";
const arg = (k, d) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const name = arg(
  "name",
  path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root",
);

const { page, log, token, close } = await launch({
  path,
  locale: arg("locale", "en"),
});
try {
  // Give the page time to render its first data. Never wait for networkidle (SSE or polling can keep it busy).
  await page.waitForTimeout(2500);

  const result = {
    path,
    finalUrl: page.url(),
    title: await page.title(),
    headings: await page.getByRole("heading").allInnerTexts(),
    buttons: (await page.getByRole("button").allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 40),
    comboboxes: await page.getByRole("combobox").allInnerTexts(),
    hasToken: Boolean(token()),
    shots: {},
  };

  // Theme switching follows the profile (ui.theme), see setTheme.
  const startTheme = await currentTheme(page);
  for (const mode of ["light", "dark"]) {
    result[`theme-${mode}`] = await setTheme(page, mode);
    result.shots[mode] = await screenshot(page, `${name}-${mode}`);
    result[`axe-${mode}`] = await axeScan(page, { save: `${name}-${mode}` });
  }
  await setTheme(page, startTheme);

  result.responsive = await checkResponsive(page, name);
  result.log = summarizeLog(log);
  result.saved = saveJson(`${name}-smoke`, result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`\nEvidence in ${OUT_DIR}`);
} finally {
  await close();
}
