#!/usr/bin/env node
// plan-lanes.mjs — compute which .plans/ plans can run in parallel.
//
//   node .claude/scripts/plan-lanes.mjs [--json]
//
// Reads every top-level .plans/*.md, extracts the repo files each plan says it
// will touch, and groups plans into "lanes" = connected components of the
// hard-conflict graph. Plans in DIFFERENT lanes can run concurrently in separate
// worktrees; plans in the SAME lane must be serialized.
//
// Hard conflict  = the two plans share more than MINOR_MAX_SHARED code files
//                  (files not soft and not docs). Forces serialization.
// Minor conflict = the two plans share 1..MINOR_MAX_SHARED code files. Reported,
//                  but does not force serialization: fix the merge conflict by hand.
// Soft conflict  = shared append-only files (registrations, translations,
//                  generated types, the version bump). Reported only.
//
// Repo-specific settings are in the CONFIG block; the rest is the same in every
// repo that has this script (template: claude-config skills/bootstrap-project).
// Pure data, no judgment.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ============================ CONFIG (@@PROJECT_NAME@@) ============================
// EDIT 1: the repo values below. Written by /bootstrap-project; change them when the
// layout changes. Everything outside this block is the same in every repo.

// Plans name their base in a `**Base**:` line; this is the fallback.
const BASE = process.env.PLAN_LANES_BASE || '@@BASE_BRANCH@@';

// A full path under one of these roots is a repo file even when it does not exist
// yet (the plan creates it). Anything else must resolve to a tracked file.
const FOOTPRINT_ROOTS = @@LANES_ROOTS@@;
const ROOT_FILES = new Set(@@LANES_ROOT_FILES@@);
// Docs that plans rewrite like code (the parent plan). Two plans that both edit one
// are a minor overlap (one shared file), not a lane.
const HARD_DOCS = new Set(@@LANES_HARD_DOCS@@);

// Files many plans touch only to append or regenerate. Counting them as hard
// conflicts would collapse every plan into one lane; the merge is a few lines.
// Add module registration files, barrels and generated types here when they exist.
const SOFT_FILES = new Set(@@LANES_SOFT_FILES@@);
const SOFT_PATTERNS = [
  /^changelog\.d\//,          // one new entry per plan
];
// Never repo footprint (build output, run state).
const IGNORE_PATTERNS = [/(^|\/)(dist|build|coverage|node_modules|\.build)\//];

// Without a `## Affected files` section, read the files from these sections
// (heading starts with the text). Without those either, the whole plan minus SKIP.
const SCOPE_SECTIONS = ['steps'];
const SKIP_SECTIONS = ['context', 'out of scope', 'follow-ups', 'how to verify', 'open questions'];

// readable lane label for one file: <container>/<name> for app and package folders,
// else the top folder. EDIT 2: add a deeper rule for big source folders.
const areaOf = (f) => {
  const m = f.match(/^((?:apps|packages|services|libs|native|src\/domains|src\/modules)\/[^/]+)/)
    || f.match(/^([^/]+)\//);
  return m ? m[1] : f;
};
// ============================================================================

const PLANS_DIR = process.env.PLAN_LANES_PLANS_DIR
  ? path.resolve(process.env.PLAN_LANES_PLANS_DIR) : path.join(REPO, '.plans');
const DONE_DIR = path.join(REPO, '.plans', 'done');
const RUNS_DIR = path.join(REPO, '.plans', 'auto-runs');
const VALID_DIR = path.join(REPO, '.plans', '.validations');
// The plans dashboard keeps plan status and summaries here when the repo has no
// tracked copy (same fallback as the dashboard's resolveProject).
const CENTRAL_STATE = path.join(os.homedir(), '.claude', 'pipeline-dashboard', 'state', path.basename(REPO));
const pick = (...files) => files.find((f) => existsSync(f)) ?? files[0];
const META_FILE = pick(path.join(REPO, '.plans', 'plan-meta.json'), path.join(CENTRAL_STATE, 'plan-meta.json'));
const SUMMARY_CACHE = pick(path.join(RUNS_DIR, 'plan-summaries.json'), path.join(CENTRAL_STATE, 'plan-summaries.json'));
const GENERIC_RUNS = path.join(CENTRAL_STATE, 'runs.json');

const MINOR_MAX_SHARED = 2;

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const gitLines = (args) => {
  try {
    return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 })
      .split('\n').map((l) => l.trim()).filter(Boolean);
  } catch { return []; }   // missing branch etc. — treat as no evidence
};

// --- plan text helpers ------------------------------------------------------------
// Split a plan into `## ` sections. A line scanner, not a regex: multiline anchors
// around `\s*` silently swallow or truncate bodies. `###` stays inside its section.
function sectionsOf(text) {
  const out = [{ title: null, body: [] }];
  for (const line of text.split('\n')) {
    const h = line.match(/^#{1,2} (.*)$/);
    if (h) out.push({ title: h[1].trim().toLowerCase(), body: [] });
    else out.at(-1).body.push(line);
  }
  return out.map((s) => ({ title: s.title, body: s.body.join('\n') }));
}
// `- **Branch**: fix/x` style header fields (same pattern as the dashboard's planBranch)
const field = (text, name) =>
  (text.match(new RegExp(String.raw`^\s*[-*]\s*\*\*${name}\*\*:\s*` + '`?([\\w./:-]+)`?\\s*$', 'm')) || [])[1] ?? null;

// --- file classification ----------------------------------------------------------
const isSoft = (f) => SOFT_FILES.has(f) || SOFT_PATTERNS.some((r) => r.test(f));
const isDoc = (f) => f.endsWith('.md') && !HARD_DOCS.has(f);
const isIgnored = (f) => IGNORE_PATTERNS.some((r) => r.test(f));
const isFootprint = (f) => !isIgnored(f)
  && (ROOT_FILES.has(f) || HARD_DOCS.has(f) || FOOTPRINT_ROOTS.some((r) => f.startsWith(r)));
const isHard = (f) => isFootprint(f) && !isDoc(f) && !isSoft(f);

// --- name -> repo file -------------------------------------------------------------
// Plans name files as full paths, partial paths (`components/d4/X.tsx`) or bare
// names with a line (`AdminSidebar.tsx:348`). Resolve partial names by a unique
// suffix match against the tracked files; an ambiguous name (`page.tsx`) is dropped
// and reported, never guessed.
const EXT = 'tsx?|jsx?|mjs|cjs|json|css|scss|html|ya?ml|sql|sh|md|swift|py|conf|toml|example';
const TOKEN_RE = new RegExp(String.raw`(?<![\w.@/()\[\]-])([\w.@()\[\]-]+(?:\/[\w.@()\[\]-]+)*\.(?:${EXT}))(?![\w/])`, 'g');
const tracked = gitLines(['ls-files']);
const trackedSet = new Set(tracked);
const bySuffix = new Map();
for (const f of tracked) {
  const parts = f.split('/');
  for (let i = 1; i < parts.length; i++) {
    const s = parts.slice(i).join('/');
    if (!bySuffix.has(s)) bySuffix.set(s, []);
    bySuffix.get(s).push(f);
  }
}
function resolveName(tok) {
  const t = tok.replace(/^\.\//, '');
  if (t.startsWith('.plans/') || t.includes('..') || isIgnored(t)) return null;
  if (trackedSet.has(t) || isFootprint(t)) return { file: t };
  const c = bySuffix.get(t) || [];
  return c.length === 1 ? { file: c[0] } : { unresolved: t, candidates: c.length };
}
// `frontend/src/app/…/d3/page.tsx`: a path with the middle left out
const ELIDED_RE = new RegExp(String.raw`(?<![\w.@/()\[\]-])([\w.@()\[\]-]+(?:\/[\w.@()\[\]-]+)*)\/(?:…|\.\.\.)\/([\w.@()\[\]-]+(?:\/[\w.@()\[\]-]+)*\.(?:${EXT}))(?![\w/])`, 'g');
function resolveElided(prefix, suffix) {
  const c = tracked.filter((f) => f.startsWith(prefix + '/') && f.endsWith('/' + suffix));
  return c.length === 1 ? { file: c[0] } : { unresolved: `${prefix}/…/${suffix}`, candidates: c.length };
}

// The files a plan says it will edit.
function footprintOf(text) {
  // `## Affected files` lists edits only; other sections also name files the plan
  // merely READS to copy a pattern, and counting those invents conflicts.
  const secs = sectionsOf(text);
  const affected = secs.filter((s) => s.title === 'affected files');
  const scoped = secs.filter((s) => s.title && SCOPE_SECTIONS.some((p) => s.title.startsWith(p)));
  let scope, footprintSource;
  if (affected.length) { scope = affected; footprintSource = 'affected-files-section'; }
  else if (scoped.length) { scope = scoped; footprintSource = 'steps-sections'; }
  else {
    scope = secs.filter((s) => !s.title || !SKIP_SECTIONS.some((p) => s.title.startsWith(p)));
    footprintSource = 'whole-document';
  }
  const raw = new Set(), unresolved = new Set();
  for (const s of scope) {
    const found = [];
    const body = s.body.replace(ELIDED_RE, (_, prefix, suffix) => { found.push(resolveElided(prefix, suffix)); return ' '; });
    for (const m of body.matchAll(TOKEN_RE)) found.push(resolveName(m[1]));
    for (const r of found) {
      if (r?.file) raw.add(r.file);
      else if (r?.unresolved && !r.unresolved.endsWith('.md')) unresolved.add(r.candidates ? `${r.unresolved} (${r.candidates} matches)` : r.unresolved);
    }
  }
  const files = [...raw].sort();
  return {
    files,
    hard: files.filter(isHard),
    soft: files.filter((f) => isFootprint(f) && (isSoft(f) || isDoc(f))),
    unresolved: [...unresolved].sort(),
    footprintSource,
  };
}

const meta = readJson(META_FILE);
const summaries = readJson(SUMMARY_CACHE);

// --- collect plans -----------------------------------------------------------------
const planFiles = (() => { try { return readdirSync(PLANS_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('.')).sort(); } catch { return []; } })();
const planText = Object.fromEntries(planFiles.map((f) => [f.slice(0, -3), readFileSync(path.join(PLANS_DIR, f), 'utf8')]));

// branch and base of every known plan (top-level and done/), so a worktree on a
// plan-named branch (fix/x) maps back to its plan
const planBranch = {}, planBase = {}, planPr = {};
const noteHeader = (slug, text) => {
  planBranch[slug] = field(text, 'Branch') || `auto/${slug}`;
  planBase[slug] = field(text, 'Base') || BASE;
  const pr = field(text, 'PR');
  if (pr) planPr[slug] = (pr.match(/(\d+)\/?$/) || [])[1] ?? null;
};
if (existsSync(DONE_DIR)) {
  for (const f of readdirSync(DONE_DIR).filter((x) => x.endsWith('.md'))) {
    const t = readText(path.join(DONE_DIR, f));
    if (t) noteHeader(f.slice(0, -3), t);
  }
}
for (const [slug, text] of Object.entries(planText)) noteHeader(slug, text);
const branchOf = (slug) => planBranch[slug] || `auto/${slug}`;
const baseOf = (slug) => planBase[slug] || BASE;
const slugOfBranch = new Map(Object.entries(planBranch).map(([s, b]) => [b, s]));
const autoSlug = (b) => (b.match(/^auto\/(.+)$/) || [])[1];
const branchSlug = (b) => slugOfBranch.get(b) ?? autoSlug(b);

// --- auto-pipeline reports -----------------------------------------------------------
const RUN_SIDE_REPORTS = ['-pr-body.md', '-codex.md', '-decision-sheet.md', '-test-review.md'];
const runStatus = {};
if (existsSync(RUNS_DIR)) {
  for (const f of readdirSync(RUNS_DIR)) {
    if (!f.endsWith('.md') || RUN_SIDE_REPORTS.some((x) => f.endsWith(x))) continue;
    const m = readFileSync(path.join(RUNS_DIR, f), 'utf8').match(/^## Status:\s*(.*)$/m);
    runStatus[f.slice(0, -3)] = m ? m[1].trim() : 'unknown';
  }
}

// --- dashboard runs without a pipeline (they run in the main checkout) --------------
const pidAlive = (pid) => { try { return !!pid && (process.kill(pid, 0), true); } catch { return false; } };
const genericLive = new Set(Object.entries(readJson(GENERIC_RUNS))
  .filter(([, r]) => r && r.exitCode == null && pidAlive(r.pid)).map(([s]) => s));

// --- live worktrees ------------------------------------------------------------------
// A worktree holding uncommitted work is finished-but-unreviewed: its lane is
// OCCUPIED no matter what the branch says.
const localBranches = new Set(gitLines(['branch', '--format=%(refname:short)']));
const worktreePath = new Map();   // slug -> worktree directory
const worktreeDirty = new Set();
const pendingFiles = new Map();   // slug -> Set(repo paths held uncommitted)
{
  let cwd = null;
  for (const line of gitLines(['worktree', 'list', '--porcelain'])) {
    const w = line.match(/^worktree (.+)$/);
    if (w) { cwd = w[1]; continue; }
    const b = line.match(/^branch refs\/heads\/(.+)$/);
    const slug = b && cwd !== REPO && branchSlug(b[1]);
    if (!slug) continue;
    worktreePath.set(slug, cwd);
    const dirty = gitLines(['-C', cwd, 'status', '--porcelain', '--ignore-submodules=all'])
      .map((l) => l.replace(/^.{1,2}\s+/, '').split(' -> ').pop())
      .filter((f) => f && !f.startsWith('.plans/'));
    if (!dirty.length) continue;
    worktreeDirty.add(slug);
    pendingFiles.set(slug, new Set(dirty));
  }
}

// --- did a run actually ship? ----------------------------------------------------------
// Not `git branch --merged`: a branch with zero own commits reads as merged, and a
// squash-merged branch never does. Strongest evidence first:
//   1. .plans/done/<slug>.md tracked on the base branch.
//   2. every commit on the branch has an equivalent on its base (`git cherry`).
const shippedCommit = {};   // slug -> landing commit (or null)
for (const base of new Set([BASE, ...Object.values(planBase)])) {
  for (const f of gitLines(['ls-tree', '-r', '--name-only', base, '.plans/done/'])) {
    const m = f.match(/\.plans\/done\/(.+)\.md$/);
    if (!m || m[1] in shippedCommit) continue;
    const [c] = gitLines(['log', '-1', '--format=%h', base, '--', f]);
    shippedCommit[m[1]] = c ?? null;
  }
}
const branchOwnCommits = {};
const candidateSlugs = new Set([...worktreePath.keys(), ...planFiles.map((f) => f.slice(0, -3)),
  ...[...localBranches].map(autoSlug).filter(Boolean)]);
for (const slug of candidateSlugs) {
  const ref = branchOf(slug);
  if (!localBranches.has(ref)) continue;
  const cherry = gitLines(['cherry', baseOf(slug), ref]);
  branchOwnCommits[slug] = cherry.filter((l) => l.startsWith('+')).length;
  if (cherry.length && cherry.every((l) => l.startsWith('-')) && !(slug in shippedCommit)) {
    const [c] = gitLines(['log', '-1', '--format=%h', baseOf(slug)]);
    shippedCommit[slug] = c ?? null;
  }
}

// --- run state: uncommitted work outranks any merge evidence ---------------------------
const runState = (slug) => {
  if (worktreeDirty.has(slug)) return 'awaiting-review';          // lane OCCUPIED
  if (slug in shippedCommit) return 'shipped';                     // lane FREE
  if (genericLive.has(slug) || worktreePath.has(slug) || branchOwnCommits[slug]) return 'in-flight';
  return runStatus[slug] ? 'stale-report' : 'not-started';
};
const occupied = (state) => state === 'in-flight' || state === 'awaiting-review';

// --- plans with uncommitted edits: never launch a half-written plan ---------------------
const dirtyPlans = new Set();
for (const line of gitLines(['status', '--porcelain', '--', '.plans'])) {
  const m = line.match(/\.plans\/([^/]+)\.md$/);
  if (m) dirtyPlans.add(m[1]);
}

// --- validation evidence ---------------------------------------------------------------
const validationRounds = {};
if (existsSync(VALID_DIR)) {
  for (const f of readdirSync(VALID_DIR)) {
    const m = f.match(/^(.*?)-(validation|codex)-(\d+)\.md$/);
    if (!m) continue;
    validationRounds[m[1]] ??= { claude: 0, codex: 0 };
    validationRounds[m[1]][m[2] === 'validation' ? 'claude' : 'codex']++;
  }
}

// --- files held by active runs -----------------------------------------------------------
// uncommitted (worktree edits), committed (branch commits not on base), planned (the
// run's own plan — the only signal for a run that just started). Worktree copy wins.
const launchedSlugs = new Set([...worktreePath.keys(), ...Object.keys(runStatus), ...genericLive,
  ...Object.entries(branchOwnCommits).filter(([, n]) => n).map(([s]) => s)]);
const heldByRun = new Map();
for (const slug of launchedSlugs) {
  const state = runState(slug);
  if (!occupied(state)) continue;
  const uncommitted = [...(pendingFiles.get(slug) ?? [])];
  const committed = localBranches.has(branchOf(slug))
    ? gitLines(['diff', '--name-only', `${baseOf(slug)}...${branchOf(slug)}`]).filter((f) => !f.startsWith('.plans/'))
    : [];
  const planCopy = [worktreePath.has(slug) && path.join(worktreePath.get(slug), '.plans', `${slug}.md`),
    path.join(PLANS_DIR, `${slug}.md`)].filter(Boolean).find((f) => existsSync(f));
  const planned = planCopy ? footprintOf(readFileSync(planCopy, 'utf8')).hard : [];
  heldByRun.set(slug, {
    state,
    all: new Set([...uncommitted, ...committed, ...planned].filter(isHard)),
    bySource: { uncommitted: new Set(uncommitted), committed: new Set(committed), planned: new Set(planned) },
  });
}

// --- per-plan extraction -------------------------------------------------------------------
const plans = Object.entries(planText).map(([slug, text]) => {
  const { files, hard, soft, unresolved, footprintSource } = footprintOf(text);
  const areas = [...new Set(hard.map(areaOf))].sort();
  const opsHits = (text.match(/\baws\s+(?:s3|ec2|ssm|route53|cloudfront|acm|iam)\b/gi) || []).length;
  // roadmap plans announce themselves in the title or the opening callout — scoped to
  // the header block, so a child plan that mentions its parent is not hidden
  const headerBlock = text.split(/\n## /)[0];
  const looksRoadmap = /^#.*(master plan|parent)/im.test(text.split('\n').slice(0, 5).join('\n'))
    || /\bMaster plan\.|\bParent plan\.|\bparent roadmap\b/i.test(headerBlock);
  const state = runState(slug);
  return {
    slug,
    file: path.relative(REPO, path.join(PLANS_DIR, `${slug}.md`)),
    status: meta[slug]?.status ?? null,
    tags: meta[slug]?.tags ?? [],
    summary: summaries[slug] ?? null,
    branch: branchOf(slug),
    base: baseOf(slug),
    sizeKb: +(text.length / 1024).toFixed(1),
    footprintSource,
    hardFileCount: hard.length,
    hardFiles: hard,
    softFiles: soft,
    unresolvedNames: unresolved,
    areas,
    addsMigration: files.some((f) => /(^|\/)migrations?\//.test(f)),
    opsCommandHits: opsHits,
    opsManual: opsHits >= 5 && hard.length < 8,
    looksRoadmap,
    looksHandoff: /^# Handoff/m.test(text),
    validation: validationRounds[slug] ?? { claude: 0, codex: 0 },
    autoRunStatus: runStatus[slug] ?? null,
    hasLiveWorktree: worktreePath.has(slug),
    runState: state,
    shippedCommit: shippedCommit[slug] ?? null,
    hasUncommittedEdits: dirtyPlans.has(slug),
    // an active run holds edits not on base yet; a "conflict-free" plan can still land on them
    blockedByActiveRun: [...heldByRun].filter(([s]) => s !== slug).map(([s, held]) => {
      const shared = hard.filter((f) => held.all.has(f));
      return {
        slug: s, state: held.state, files: shared,
        sources: Object.fromEntries(Object.entries(held.bySource)
          .map(([k, set]) => [k, shared.filter((f) => set.has(f)).length]).filter(([, n]) => n)),
      };
    }).filter((b) => b.files.length),
  };
});

// --- conflict graph over implementable plans -----------------------------------------------
const schedulable = plans.filter((p) => p.hardFileCount > 0 && !p.looksRoadmap && !p.looksHandoff
  && !occupied(p.runState) && p.runState !== 'shipped' && !p.opsManual);
const excluded = plans.filter((p) => !schedulable.includes(p));

const overlaps = [];
const parent = new Map(schedulable.map((p) => [p.slug, p.slug]));
const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
for (let i = 0; i < schedulable.length; i++) {
  for (let j = i + 1; j < schedulable.length; j++) {
    const a = schedulable[i], b = schedulable[j];
    const setB = new Set(b.hardFiles), softB = new Set(b.softFiles);
    const shared = a.hardFiles.filter((f) => setB.has(f));
    const sharedSoft = a.softFiles.filter((f) => softB.has(f));
    if (shared.length > MINOR_MAX_SHARED) {
      union(a.slug, b.slug);
      overlaps.push({ a: a.slug, b: b.slug, kind: 'hard', count: shared.length, files: shared.slice(0, 8) });
    } else if (shared.length) {
      overlaps.push({ a: a.slug, b: b.slug, kind: 'minor', count: shared.length, files: shared });
    } else if (sharedSoft.length) {
      overlaps.push({ a: a.slug, b: b.slug, kind: 'soft', count: sharedSoft.length, files: sharedSoft });
    }
  }
}

const laneMap = new Map();
for (const p of schedulable) {
  const root = find(p.slug);
  if (!laneMap.has(root)) laneMap.set(root, []);
  laneMap.get(root).push(p.slug);
}
const lanes = [...laneMap.values()]
  .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
  .map((members, i) => {
    const areaCounts = {};
    for (const s of members) for (const a of schedulable.find((p) => p.slug === s).areas) areaCounts[a] = (areaCounts[a] || 0) + 1;
    const label = Object.entries(areaCounts).sort((x, y) => y[1] - x[1]).slice(0, 3).map((e) => e[0]).join(' + ');
    return { lane: i + 1, label: label || 'misc', members: members.sort(), concurrentCapacity: 1 };
  });
const laneOf = new Map(lanes.flatMap((l) => l.members.map((s) => [s, l.lane])));

// --- launched runs, split by resolved state (not the report's frozen `## Status:` line) ---
const launched = [...launchedSlugs].sort().map((slug) => {
  const state = runState(slug);
  const pr = planPr[slug];
  return {
    slug,
    state,
    branch: branchOf(slug),
    hasWorktree: worktreePath.has(slug),
    worktreeDirty: worktreeDirty.has(slug),
    // the dashboard shows the text up to the first `.` or `—`
    autoRunStatus: runStatus[slug]
      ?? (state === 'awaiting-review' ? 'Awaiting review — uncommitted work in the worktree'
        : genericLive.has(slug) ? 'Running — dashboard launcher'
        : pr ? `PR #${pr} open — branch ${branchOf(slug)}`
        : state === 'in-flight' ? `In flight — branch ${branchOf(slug)}` : null),
    planFileStillInPlansDir: slug in planText,
    areas: plans.find((p) => p.slug === slug)?.areas ?? null,
    shippedCommit: shippedCommit[slug] ?? null,
  };
});
const inFlight = launched.filter((r) => occupied(r.state));   // running or awaiting review
const awaitingReview = launched.filter((r) => r.state === 'awaiting-review');
const needsCleanup = launched.filter((r) => r.state === 'shipped' && r.hasWorktree);
const staleReports = launched.filter((r) => !r.hasWorktree && (r.state === 'shipped' || r.state === 'stale-report'));

// --- recommended batch: the best launchable plan of each lane --------------------------
// Ranked by explicit ready status, validation rounds, then smaller footprint.
const conflictsWith = new Map(schedulable.map((p) => [p.slug, new Set()]));
for (const o of overlaps) {
  if (o.kind !== 'hard') continue;
  conflictsWith.get(o.a).add(o.b);
  conflictsWith.get(o.b).add(o.a);
}
const score = (p) => (p.status === 'ready' ? 1000 : p.status === 'needs-validation' ? -500 : 0)
  + (p.validation.claude + p.validation.codex) * 50
  - (p.blockedByActiveRun.length ? 300 : 0)
  - p.hardFileCount;
const batch = [];
for (const p of [...schedulable].sort((a, b) => score(b) - score(a))) {
  if (p.hasUncommittedEdits) continue;   // mid-edit — stays in its lane, not launchable now
  if (batch.some((q) => laneOf.get(q.slug) === laneOf.get(p.slug))) continue;
  batch.push(p);
}
const recommendedBatch = batch.map((p) => ({
  slug: p.slug,
  file: p.file,
  lane: laneOf.get(p.slug),
  status: p.status,
  validation: p.validation,
  hardFileCount: p.hardFileCount,
  areas: p.areas,
  addsMigration: p.addsMigration,
  blocks: [...conflictsWith.get(p.slug)].sort(),
  minorWith: overlaps
    .filter((o) => o.kind === 'minor' && (o.a === p.slug || o.b === p.slug))
    .map((o) => ({ slug: o.a === p.slug ? o.b : o.a, files: o.files }))
    .filter((m) => batch.some((q) => q.slug === m.slug)),
  blockedByActiveRun: p.blockedByActiveRun,
}));

const result = {
  repo: REPO,
  baseBranch: BASE,
  planCount: plans.length,
  schedulableCount: schedulable.length,
  maxParallel: recommendedBatch.length,
  laneCount: lanes.length,
  inFlight,
  awaitingReview,
  needsCleanup,
  staleReports,
  dirtyPlans: [...dirtyPlans].sort(),
  recommendedBatch,
  lanes,
  overlaps,
  minorMaxShared: MINOR_MAX_SHARED,
  plans,
  excluded: excluded.map((p) => ({
    slug: p.slug,
    reason: p.runState === 'awaiting-review' ? 'verified but UNCOMMITTED in its worktree — awaiting your review; lane is OCCUPIED'
      : p.runState === 'in-flight' ? `run still going or PR not merged (branch ${p.branch})`
      : p.runState === 'shipped' ? `shipped${p.shippedCommit ? ` in ${p.shippedCommit}` : ''} — move the plan to .plans/done/`
      : p.looksHandoff ? 'handoff/tracker doc, nothing to implement'
      : p.looksRoadmap ? 'roadmap/parent plan, split into subplans first'
      : p.opsManual ? 'manual ops runbook (aws/ssm/host commands) — run by hand, never headless'
      : `names no code files under ${[...ROOT_FILES, ...HARD_DOCS, ...FOOTPRINT_ROOTS].join(', ')} — docs-only or names unresolved`,
    unresolvedNames: p.unresolvedNames,
    autoRunStatus: p.autoRunStatus,
  })),
  footprintRoots: FOOTPRINT_ROOTS,
  softFileList: [...SOFT_FILES],
  softPatterns: SOFT_PATTERNS.map(String),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`plans: ${result.planCount}  schedulable: ${result.schedulableCount}  lanes: ${result.laneCount}`
    + `  in flight/awaiting review: ${inFlight.length}  done/uncleaned: ${needsCleanup.length}`
    + `  can launch in parallel now: ${result.maxParallel}  (base: ${BASE})\n`);
  if (inFlight.length) {
    console.log('IN FLIGHT / AWAITING REVIEW (lane is occupied, do not relaunch)');
    for (const r of inFlight) console.log(`  · ${r.slug}${r.hasWorktree ? ' [worktree]' : ''} — ${r.autoRunStatus ?? r.state}`);
    console.log('');
  }
  if (needsCleanup.length) {
    console.log(`DONE — NEEDS CLEANUP (shipped; lane is FREE)`);
    for (const r of needsCleanup) console.log(`  · ${r.slug}${r.shippedCommit ? ` (${r.shippedCommit})` : ''} — worktree still on disk`);
    console.log('');
  }
  console.log('RECOMMENDED PARALLEL BATCH (one plan per lane)');
  for (const r of recommendedBatch) {
    const v = r.validation.claude + r.validation.codex;
    console.log(`  · ${r.slug}  [lane ${r.lane}]`);
    console.log(`      status=${r.status ?? '—'} files=${r.hardFileCount} validation=${v ? `${r.validation.claude}c/${r.validation.codex}x` : 'none'}`);
    console.log(`      areas: ${r.areas.join(', ')}`);
    for (const m of r.minorWith) console.log(`      ~ shares ${m.files.join(', ')} with ${m.slug} — expect a merge conflict`);
    for (const b of r.blockedByActiveRun) console.log(`      !! ${b.files.length} file(s) also held by ${b.slug} (${b.state}): ${b.files.join(', ')}`);
  }
  console.log('');
  console.log('LANES (connected conflict components — one plan per lane at a time)');
  for (const l of lanes) {
    console.log(`LANE ${l.lane} — ${l.label}`);
    for (const s of l.members) {
      const p = plans.find((x) => x.slug === s);
      console.log(`  · ${s}  files=${p.hardFileCount} (${p.footprintSource})${p.hasUncommittedEdits ? ' !MID-EDIT' : ''}`);
      console.log(`      ${p.hardFiles.join('\n      ')}`);
      if (p.unresolvedNames.length) console.log(`      ? unresolved: ${p.unresolvedNames.join(', ')}`);
    }
  }
  console.log('');
  if (result.excluded.length) {
    console.log('NOT SCHEDULABLE');
    for (const e of result.excluded) console.log(`  · ${e.slug} — ${e.reason}`);
    console.log('');
  }
  for (const kind of ['minor', 'soft']) {
    const list = overlaps.filter((o) => o.kind === kind);
    if (!list.length) continue;
    console.log(kind === 'minor' ? `MINOR OVERLAPS (≤${MINOR_MAX_SHARED} shared code files — parallel-safe, fix the merge by hand)` : 'SOFT OVERLAPS (append-only files — parallel-safe)');
    for (const o of list) console.log(`  · ${o.a} ↔ ${o.b}: ${o.files.join(', ')}`);
    console.log('');
  }
}
