#!/usr/bin/env node
// HTML pages as single files, kept per project next to the browser-usability-test reports:
// ~/.claude/browser-usability-test/projects/<project>/artifacts/<date>-<slug>.html, and
// _other/ for pages of no project. Every file the page loads from its own folder (images,
// stylesheets, scripts, data) goes into the page, images and data as base64 data: URLs, so
// one .html can be sent on its own. The plans dashboard lists these files on the QA page.
//
//   node scripts/artifact-copies.mjs --save <page.html> [--project <name>] [--title <t>]
//       a page Claude wrote: packed into one file and saved to the project of the repo
//       you run it in; prints the file and its http://localhost:4898 link. Saving the same
//       name again, also on a later day, keeps the same file and link and the old page as
//       a version (scripts/page-versions.mjs)
//   node scripts/artifact-copies.mjs <manifest.jsonl>...
//       Claude artifacts downloaded from claude.ai with the Artifact tool. A manifest line:
//       {"url","title","updated","dir","assets":[{"url","saved"}],"error"}
//   node scripts/artifact-copies.mjs --projects
//       works out again which project each downloaded artifact belongs to, and moves it
//   node scripts/artifact-copies.mjs --inline <page.html> [out.html]
//       only packs one page; out defaults to <page>.single.html
//
// What the QA list needs is in <meta name="qa:…"> tags right after the doctype, where the
// dashboard reads them without loading megabytes of images: qa:title, qa:updated,
// qa:issues, and for downloaded artifacts qa:source (the claude.ai link), qa:project-from
// ("log" or "content"), qa:live (parts need claude.ai) and qa:remote-only (Docs, Slides
// and Design, which only claude.ai can show).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameNameIn, writeVersioned } from './page-versions.mjs';

export const QA_HOME = process.env.QA_HOME || path.join(os.homedir(), '.claude', 'browser-usability-test', 'projects');
export const OTHER = '_other';
const LOGS = path.join(os.homedir(), '.claude', 'projects');
const QA_PORT = +(process.env.QA_REPORTS_PORT || 4898);

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm',
  pdf: 'application/pdf', json: 'application/json', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', html: 'text/html',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };
const typeOf = (f) => TYPES[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream';
const dataUrl = (f) => `data:${typeOf(f)};base64,${readFileSync(f).toString('base64')}`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// every file under dir except the page itself, as paths relative to dir with / separators
const filesUnder = (dir, skip, rel = '') => readdirSync(path.join(dir, rel)).flatMap((n) => {
  const r = rel ? `${rel}/${n}` : n;
  if (n.startsWith('.') || n === 'node_modules') return [];
  if (statSync(path.join(dir, r)).isDirectory()) return filesUnder(dir, skip, r);
  return path.join(dir, r) === skip ? [] : [r];
});

// a reference: the name right after a quote or url( (with an optional ./), and right
// before the closing quote, ) or a ?query/#hash
const refRe = (ref) => new RegExp(`(["'(\`])(?:\\./)?${esc(ref)}(?:[?#][^"'()\`\\s]*)?(?=["')\`])`, 'g');
const swap = (text, ref, url) => text.replace(refRe(ref), (_, q) => q + url);

// a stylesheet's own url(...) references point next to the stylesheet, not the page
const inlineCss = (css, cssFile) => css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, u) => {
  if (/^(data:|https?:|\/\/|#)/.test(u)) return m;
  const f = path.resolve(path.dirname(cssFile), u.replace(/[?#].*$/, ''));
  return existsSync(f) && statSync(f).isFile() ? `url("${dataUrl(f)}")` : m;
});

// urls: { 'https://…asset url…': '/saved/file' } for files the page loads by absolute URL
export const inlineHtml = (html, dir, { page, urls = {} } = {}) => {
  const files = existsSync(dir) ? filesUnder(dir, page) : [];
  const dynamic = {};
  // a folder the page's script builds paths into: `img/${name}.jpg` or 'img/' + name
  const built = (ref) => ref.includes('/') && new RegExp(`${esc(ref.slice(0, ref.lastIndexOf('/') + 1))}(\\$\\{|["'\`]\\s*\\+)`).test(html);
  for (const ref of files) {
    const f = path.join(dir, ref), type = typeOf(ref);
    if (/^(image|video)\//.test(type) && built(ref)) dynamic[ref] = dataUrl(f);
    if (!refRe(ref).test(html)) continue;
    if (type === 'text/css') {
      const css = inlineCss(readFileSync(f, 'utf8'), f);
      html = html.replace(new RegExp(`<link\\b[^>]*\\bhref=(["'])(?:\\./)?${esc(ref)}\\1[^>]*>`, 'gi'),
        () => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`);
    } else if (type === 'text/javascript') {
      const js = readFileSync(f, 'utf8').replace(/<\/script/gi, '<\\/script');
      html = html.replace(new RegExp(`<script\\b([^>]*?)\\s+src=(["'])(?:\\./)?${esc(ref)}\\2([^>]*)>\\s*</script>`, 'gi'),
        (_, a, __, b) => `<script${a}${b}>\n${js}\n</script>`);
    }
    html = swap(html, ref, dataUrl(f));
  }
  for (const [u, f] of Object.entries(urls)) if (existsSync(f)) html = html.split(u).join(dataUrl(f));
  // claude.ai's own copy of a library, from the public CDN instead
  html = html.replace(/(["'])\/_runtime\/mermaid-([\d.]+)\.min\.js\1/g,
    (_, q, v) => `${q}https://cdn.jsdelivr.net/npm/mermaid@${v}/dist/mermaid.min.js${q}`);
  // images whose path the page's script puts together (`img/${name}.jpg`): swapped for
  // their data: URL as soon as they appear
  if (Object.keys(dynamic).length) {
    const fix = `<script>(() => { const F = ${JSON.stringify(dynamic)};
const fix = (el) => { for (const a of ['src', 'poster', 'href', 'data-full']) { const v = el.getAttribute && el.getAttribute(a); const k = v && v.replace(/^\\.\\//, ''); if (F[k]) el.setAttribute(a, F[k]); } };
new MutationObserver((ms) => ms.forEach((m) => { if (m.type === 'attributes') fix(m.target); else m.addedNodes.forEach((n) => { if (n.nodeType === 1) { fix(n); n.querySelectorAll('*').forEach(fix); } }); }))
  .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'poster', 'href', 'data-full'] });
})();</script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + fix) : fix + html;
  }
  return html;
};

const visibleText = (html) => html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/data:[^"')\s]+/g, ' ').replace(/<[^>]*>/g, ' ');

// ticket references in a page, for the QA list's search: GitHub issue/PR links as
// "repo#435", and "#435" in the visible text (styles, scripts and data: URLs dropped first,
// so colours and base64 don't count)
export const findIssues = (html) => {
  const found = new Set();
  for (const m of html.matchAll(/github\.com\/[\w.-]+\/([\w.-]+)\/(?:issues|pull)\/(\d+)/g)) found.add(`${m[1]}#${m[2]}`);
  for (const m of visibleText(html).matchAll(/(?<![\w&#])#(\d{2,5})\b/g)) if (![...found].some((f) => f.endsWith(`#${m[1]}`))) found.add(`#${m[1]}`);
  return [...found].slice(0, 12);
};

const slug = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artifact';

// Which browser-usability-test project an artifact belongs to, so the QA list shows it
// next to that project's reports. First the session that published it: Claude Code's log
// says "Published <file> at <url>" or "Created a new Artifact at <url>", and the log's
// folder names the repo Claude ran in (a worktree counts by its git remote). Without such
// a log (an older artifact, or one made on claude.ai), the project named most in the page.
const home = (p) => p.replace(/^~(?=\/)/, os.homedir());
const logFolder = (dir) => dir.replace(/[^A-Za-z0-9]/g, '-');
const remoteOf = (dir) => {
  try {
    return execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().replace(/^(https?:\/\/|git@)/, '').replace(':', '/').replace(/\.git$/, '').toLowerCase();
  } catch { return null; }
};
const projectFinder = () => {
  const profiles = (existsSync(QA_HOME) ? readdirSync(QA_HOME) : []).flatMap((name) => {
    try { return [{ name, ...JSON.parse(readFileSync(path.join(QA_HOME, name, 'project.json'), 'utf8')) }]; } catch { return []; }
  });
  // log folder → project: each repo, and every folder next to it or in a worktrees/ folder
  // there whose remote is one of the project's
  const byFolder = new Map(), byRemote = new Map();
  for (const p of profiles) for (const r of p.repos || []) {
    byFolder.set(logFolder(home(r.path)), p.name);
    if (r.remote) byRemote.set(r.remote.toLowerCase(), p.name);
  }
  const parents = new Set(profiles.flatMap((p) => (p.repos || []).map((r) => path.dirname(home(r.path)))));
  for (const parent of parents) for (const dir of [parent, path.join(parent, 'worktrees')]) {
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (!d.isDirectory() || byFolder.has(logFolder(full))) continue;
      const project = byRemote.get(remoteOf(full));
      if (project) byFolder.set(logFolder(full), project);
    }
  }
  // artifact id → log folder of the session that published or created it
  const published = new Map();
  try {
    const out = execFileSync('grep', ['-roE', '--include=*.jsonl', '-e', '"content":"(Published [^"]* at|Created a new Artifact at) https://claude\\.ai/artifact/[A-Za-z0-9]+', LOGS],
      { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      const m = line.match(/^(.+?\.jsonl):.*claude\.ai\/artifact\/([A-Za-z0-9]+)$/);
      if (m && !published.has(m[2])) published.set(m[2], path.relative(LOGS, m[1]).split(path.sep)[0]);
    }
  } catch {}
  const words = profiles.map((p) => ({ name: p.name,
    re: new RegExp(`\\b(${[p.name, ...(p.repos || []).map((r) => path.basename(home(r.path)))].map(esc).join('|')})\\b`, 'gi') }));
  return {
    forArtifact: (url, title, html = '') => {
      const project = byFolder.get(published.get(url.split('/').pop()));
      if (project) return { project, projectFrom: 'log' };
      const text = title + ' ' + visibleText(html);
      const [best] = words.map((w) => ({ name: w.name, n: (text.match(w.re) || []).length })).sort((a, b) => b.n - a.n);
      return best?.n ? { project: best.name, projectFrom: 'content' } : {};
    },
    // the repo a command runs in: by its git remote, else by its folder
    forDir: (dir) => byRemote.get(remoteOf(dir)) || byFolder.get(logFolder(dir)),
  };
};

// the qa:* tags, right after the doctype (a page without one gets them first)
const META_RE = /<meta name="qa:[a-z-]+" content="[^"]*">\n?/g;
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const stamp = (html, meta) => {
  const tags = Object.entries(meta).filter(([, v]) => v != null && v !== false && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `<meta name="qa:${k}" content="${attr(Array.isArray(v) ? v.join(' ') : v === true ? '1' : v)}">\n`).join('');
  html = html.replace(META_RE, '');
  const doctype = html.match(/^\s*<!doctype[^>]*>\s*/i)?.[0] || '';
  return doctype + tags + html.slice(doctype.length);
};
// the qa:* tags of a saved page, from its first 16 KB
export const readMeta = (file) => {
  const buf = Buffer.alloc(16384), fd = openSync(file, 'r');
  const head = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0));
  closeSync(fd);
  const meta = {};
  for (const m of head.matchAll(/<meta name="qa:([a-z-]+)" content="([^"]*)">/g))
    meta[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  meta.title ||= head.match(/<title>([^<]*)<\/title>/i)?.[1];
  return meta;
};

const dirOf = (project) => path.join(QA_HOME, project || OTHER, 'artifacts');
const linkOf = (project, file) => `http://localhost:${QA_PORT}/${encodeURIComponent(project || OTHER)}/artifacts/${encodeURIComponent(file)}`;
// every saved page: { project, file, path, meta }
const savedPages = () => (existsSync(QA_HOME) ? readdirSync(QA_HOME) : []).flatMap((project) => {
  const dir = path.join(QA_HOME, project, 'artifacts');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html'))
    .map((file) => ({ project, file, path: path.join(dir, file), meta: readMeta(path.join(dir, file)) })) : [];
});
const write = (project, file, html) => {
  mkdirSync(dirOf(project), { recursive: true });
  writeFileSync(path.join(dirOf(project), file), html);
};

// Docs, Slides and Design artifacts run claude.ai's own app (artifact-type/…) on content
// kept there: saved as a short page that links to it
const stub = (title, url) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${attr(title)}</title></head>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px">
<h1 style="font-size:20px">${attr(title)}</h1><p>This is a claude.ai Docs, Slides or Design artifact. Only claude.ai can show it: <a href="${attr(url)}">${attr(url)}</a></p></body></html>`;

const saveDownloads = (manifests) => {
  const finder = projectFinder();
  const byUrl = new Map(savedPages().filter((p) => p.meta.source).map((p) => [p.meta.source, p]));
  for (const m of manifests) {
    const page = path.join(m.dir || '', 'index.html');
    const remoteOnly = !!(m.error || !existsSync(page) || /artifact-type\//.test(readFileSync(page, 'utf8')));
    const urls = Object.fromEntries((m.assets || []).map((a) => [a.url, a.saved]));
    const html = remoteOnly ? stub(m.title, m.url) : inlineHtml(readFileSync(page, 'utf8'), m.dir, { page, urls });
    const { project, projectFrom } = finder.forArtifact(m.url, m.title, remoteOnly ? '' : html);
    const old = byUrl.get(m.url), file = old?.file || `${m.updated}-${slug(m.title)}.html`;
    if (old && old.project !== (project || OTHER)) unlinkSync(old.path);
    // saved data, comments and "ask Claude" only work on claude.ai
    write(project, file, stamp(html, { title: m.title, updated: m.updated, source: m.url, issues: findIssues(m.title + ' ' + html),
      'project-from': projectFrom, live: !remoteOnly && /\bwindow\.claude\b/.test(html), 'remote-only': remoteOnly }));
    console.log(`${project || OTHER}/artifacts/${file}  ${(html.length / 1048576).toFixed(1)} MB${remoteOnly ? '  (link to claude.ai only)' : ''}`);
  }
};

// moves downloaded artifacts whose project came out differently this time
const reassign = () => {
  const finder = projectFinder();
  for (const p of savedPages().filter((x) => x.meta.source)) {
    const html = readFileSync(p.path, 'utf8');
    const { project = OTHER, projectFrom } = finder.forArtifact(p.meta.source, p.meta.title || '', p.meta['remote-only'] ? '' : html);
    if (project === p.project && projectFrom === p.meta['project-from']) continue;
    write(project, p.file, stamp(html, { ...Object.fromEntries(Object.entries(p.meta).filter(([k]) => k !== 'project-from')), 'project-from': projectFrom }));
    if (project !== p.project) unlinkSync(p.path);
    console.log(`${p.project} → ${project}: ${p.file}`);
  }
};

const savePage = (src, { project, title } = {}) => {
  const full = path.resolve(src);
  project ||= projectFinder().forDir(process.cwd());
  const html = inlineHtml(readFileSync(full, 'utf8'), path.dirname(full), { page: full });
  title ||= html.match(/<title>([^<]*)<\/title>/i)?.[1] || path.basename(full, '.html');
  const day = new Date().toISOString().slice(0, 10);
  const name = sameNameIn(dirOf(project), /^\d{4}-\d{2}-\d{2}-/.test(path.basename(full)) ? path.basename(full) : `${day}-${slug(title)}.html`);
  const version = writeVersioned(path.join(dirOf(project), name), stamp(html, { title, updated: day, issues: findIssues(title + ' ' + html) }));
  console.log(JSON.stringify({ file: path.join(dirOf(project), name), url: linkOf(project, name), project: project || OTHER, version }, null, 2));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  if (args[0] === '--save' && args[1]) {
    const project = opt('project'), title = opt('title');
    savePage(args[1], { project, title });
  } else if (args[0] === '--inline' && args[1]) {
    const out = args[2] || args[1].replace(/\.html?$/i, '') + '.single.html';
    writeFileSync(out, inlineHtml(readFileSync(args[1], 'utf8'), path.dirname(path.resolve(args[1])), { page: path.resolve(args[1]) }));
    console.log(out);
  } else if (args[0] === '--projects') {
    reassign();
  } else if (args[0]) {
    saveDownloads(args.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  } else {
    console.error('usage: artifact-copies.mjs --save <page.html> [--project <name>] [--title <t>] | <manifest.jsonl>... | --projects | --inline <page.html> [out.html]');
    process.exit(1);
  }
}
