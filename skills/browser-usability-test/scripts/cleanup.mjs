// Removes what a browser test leaves in a repo tree, and lists what else is left.
//   - vite.qa.config.* at the repo root: the temporary config that starts the new code
//     beside the owner's dev server (see the project's notes.md)
//   - node_modules/.vite-qa-*: the separate Vite caches of those servers
// It removes only those, and only when git does not track them. Then it lists the other
// untracked files of the tree (gitignored files excluded): a run script that wrote into
// the current folder instead of QA_DIR shows up there. It never deletes them.
// Run it as a bare command, so a headless run needs no rm rule (rm -rf is denied there).
// Usage: node scripts/cleanup.mjs [<repo dir>] [--dry-run]
// Output: { root, removed: [paths], leftovers: [paths] } on stdout.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const start = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? ".");
const git = (...args) =>
  execFileSync("git", ["-C", start, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

let root;
try {
  root = git("rev-parse", "--show-toplevel");
} catch {
  throw new Error(`${start} is not inside a git repository.`);
}
const tracked = (rel) => {
  try {
    git("ls-files", "--error-unmatch", "--", rel);
    return true;
  } catch {
    return false;
  }
};

const targets = [
  ...readdirSync(root).filter((f) => /^vite\.qa\.config\.[a-z]+$/.test(f)),
  ...(existsSync(join(root, "node_modules"))
    ? readdirSync(join(root, "node_modules"))
        .filter((f) => f.startsWith(".vite-qa-"))
        .map((f) => `node_modules/${f}`)
    : []),
].filter((rel) => !tracked(rel));

if (!dryRun) for (const rel of targets) rmSync(join(root, rel), { recursive: true, force: true });

const leftovers = git("status", "--porcelain", "--untracked-files=all")
  .split("\n")
  .filter((l) => l.startsWith("?? "))
  .map((l) => l.slice(3))
  .filter((p) => !targets.some((t) => p === t || p.startsWith(`${t}/`)));

console.log(
  JSON.stringify(
    { root, dryRun, removed: targets, leftovers, cwd: relative(root, process.cwd()) || "." },
    null,
    2,
  ),
);
if (leftovers.length)
  console.error(
    `!! ${leftovers.length} untracked file(s) in the tree: new files of the change, or files a run script left. A run script writes into QA_DIR (runFile()), never the current folder: check each one that the change did not make.`,
  );
