// Older versions of a saved HTML page (browser-usability-test reports, artifact-copies pages).
// The page keeps its name and link and is always the latest version; each older one is
// <folder>/.versions/<page name>/v<n>.html, with the time it was written as its file time.
// The plans dashboard shows them in a menu on the page.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DATED = /^\d{4}-\d{2}-\d{2}-/;
const folderOf = (file) => path.join(path.dirname(file), '.versions', path.basename(file, '.html'));

// the page's older versions, oldest first: { n, path, mtime }
export const olderVersions = (file) => {
  const dir = folderOf(file);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const n = f.match(/^v(\d+)\.html$/)?.[1];
    return n ? [{ n: +n, path: path.join(dir, f), mtime: statSync(path.join(dir, f)).mtimeMs }] : [];
  }).sort((a, b) => a.n - b.n);
};

// A page of the same purpose keeps one file across days: the name differs only in its date
// prefix, so the newest page with that name is the one to update.
export const sameNameIn = (dir, name) => {
  const rest = name.replace(DATED, '');
  const found = existsSync(dir) ? readdirSync(dir).filter((f) => DATED.test(f) && f.replace(DATED, '') === rest).sort() : [];
  return found.at(-1) || name;
};

// Writes the page, first moving the page it replaces to the next older version. Writing the
// same bytes again adds no version. Returns the page's version number.
export const writeVersioned = (file, content) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const older = olderVersions(file), next = (older.at(-1)?.n || 0) + 1;
  if (!existsSync(file)) { writeFileSync(file, content); return next; }
  if (readFileSync(file).equals(Buffer.from(content))) return next;
  mkdirSync(folderOf(file), { recursive: true });
  renameSync(file, path.join(folderOf(file), `v${next}.html`));
  writeFileSync(file, content);
  return next + 1;
};
