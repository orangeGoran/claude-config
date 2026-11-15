// Runs a click script you wrote (references/patterns.md) from the skill's own folder.
// A headless pipeline run allows only `node <skill>/scripts/*`, so
// `QA_ACCOUNT=ana node run.mjs` from the scratchpad is refused; this form is allowed:
//   QA_ACCOUNT=ana node /Users/<you>/.claude/skills/browser-usability-test/scripts/run.mjs /abs/path/flow.mjs [args…]
// The script must be an absolute .mjs path in a temp folder (the scratchpad, $TMPDIR) or in
// ~/.claude/browser-usability-test, never a repo file. It sees its own args from process.argv[2].
import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";

const file = process.argv[2];
const fail = (msg) => {
  console.error(`run.mjs: ${msg}`);
  process.exit(2);
};
if (!file || !isAbsolute(file) || !file.endsWith(".mjs"))
  fail("give the absolute path of a .mjs script, e.g. run.mjs /tmp/…/scratchpad/flow.mjs");
if (!existsSync(file)) fail(`no such file: ${file}`);

const real = realpathSync(file);
const roots = [tmpdir(), "/tmp", "/private/tmp", `${homedir()}/.claude/browser-usability-test`]
  .filter(existsSync)
  .map((r) => realpathSync(r));
if (!roots.some((r) => real.startsWith(r + sep)))
  fail(`the script must live in the scratchpad, $TMPDIR or ~/.claude/browser-usability-test (got ${real})`);

process.argv.splice(1, 2, real); // the script sees argv like `node flow.mjs …`
await import(pathToFileURL(real).href);
