// Before/after review of the fixed findings as ONE self-contained HTML file
// (screenshots embedded as base64), easy to send to someone else.
// With "mode": "findings" it is the test-run page instead: the findings with their
// "before" shots only, nothing fixed yet.
// Usage: node scripts/compare.mjs <items.json> [--out=<file.html>]
// items.json (written by Claude after the test run, or after the fixes):
//   {
//     "mode": "findings",                                    // optional, test run without fixes
//     "route": "/cases", "account": "Ana (Member, Acme)",
//     "title": "Filters on /cases fit a phone",              // optional, plain-words headline
//     "summary": "…",                                        // TLDR: does it work now, what is still open
//     "before": "HEAD 89dd94d", "after": "working tree",     // optional, what each side was taken from
//     "dirs": ["<other account's QA_DIR>"],                  // optional
//     "items": [{ "id": "1", "problem": "…", "severity": "Medium", "fix": "…",
//                 "cause": "src/…/FilterBar.tsx:42",          // optional
//                 "result": "fixed" | "partly" | "not-fixed",
//                 "note": "…",                                // optional, what to look at in the pictures
//                 "shots": ["filterbar-390", { "name": "filterbar-dark", "caption": "Dark theme" }],  // beforeAfterShot names
//                 "references": [{ "file": "/…/sibling.png", "caption": "Admin users list" }],  // optional, the standard it should match
//                 "beforeText": "API total 12", "afterText": "API total 3",                     // optional, non-visual proof
//                 "review": true }],                         // optional, adds "Is this fix good?" to this finding
//     "reviewEachFix": true,                                 // optional, "Is this fix good?" on every finding
//     "works": ["Saving a valid provider shows it in the list", "…"],  // optional, "What works"
//     "notTested": ["Safari", "…"],                          // optional
//     "questions": [{ "question": "Is the wrapped filter bar OK on a phone?",   // optional; the reader answers
//                     "finding": "1",                         // shown inside that finding; without it, at the end
//                     "why": "…",                             // optional context
//                     "type": "radio" | "checkbox" | "text",  // default radio
//                     "options": [{ "label": "Yes, keep it", "detail": "…", "recommended": true }],
//                     "other": true }],                       // optional free-text "Other" option
//     "copyBlocks": [{ "title": "Missing from backend", "lead": "…", "text": "…" }]           // optional, with a Copy button
//   }
// In findings mode: "result" is not used, "before" is the version tested, "fix" is the
// proposed fix, and "reviewEachFix" asks "Should I apply this fix?" on every finding.
// Output: ~/.claude/browser-usability-test/projects/<project>/reports/<date>-<route>-before-after.html
//         (…-findings.html in findings mode)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { BEFORE_AFTER_FILE, PROJECT } from "./lib.mjs";
import { STORE } from "./profile.mjs";

const input = process.argv[2];
if (!input) throw new Error("Usage: node compare.mjs <items.json> [--out=<file.html>]");
const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const spec = JSON.parse(readFileSync(input, "utf8"));
const items = spec.items ?? [];
const FINDINGS = spec.mode === "findings";

// Shot records from this account's folder plus any extra account folders.
const shots = {};
for (const file of [
  BEFORE_AFTER_FILE,
  ...(spec.dirs ?? []).map((d) => join(d, "before-after.json")),
]) {
  if (existsSync(file)) Object.assign(shots, JSON.parse(readFileSync(file, "utf8")));
}

const warnings = [];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const dataUri = (file) =>
  `data:${MIME[extname(file).toLowerCase()] ?? "image/png"};base64,${readFileSync(file).toString("base64")}`;
const describe = (r) =>
  [
    r.path,
    r.viewport && `${r.viewport.width} × ${r.viewport.height}`,
    r.theme,
    r.account,
    r.element ? "element" : r.fullPage ? "full page" : null,
  ]
    .filter(Boolean)
    .join(" · ");

// The "after" must show the same state as the "before", or the pair proves nothing.
function stateDiff(b, a) {
  const diff = [];
  if (b.path !== a.path) diff.push(`route ${b.path} → ${a.path}`);
  if (b.viewport?.width !== a.viewport?.width)
    diff.push(`width ${b.viewport?.width} → ${a.viewport?.width}`);
  if (b.theme !== a.theme) diff.push(`theme ${b.theme} → ${a.theme}`);
  if (b.account !== a.account) diff.push(`account ${b.account} → ${a.account}`);
  return diff;
}

const TAG = { before: "Before", after: "After", ref: "Standard" };

function figure(kind, file, caption, alt, rec) {
  const state = rec ? `<span class="state">${esc(describe(rec))}</span>` : "";
  if (!file || !existsSync(file))
    return `<figure><div class="none">No ${TAG[kind].toLowerCase()} screenshot</div><figcaption><span class="tag ${kind}">${TAG[kind]}</span> ${esc(caption)}${state}</figcaption></figure>`;
  return `<figure><button class="shot" type="button" aria-label="Enlarge: ${esc(alt)}"><img loading="lazy" src="${dataUri(file)}" alt="${esc(alt)}"></button><figcaption><span class="tag ${kind}">${TAG[kind]}</span> ${esc(caption)}${state}</figcaption></figure>`;
}

// Non-visual proof (API value, SQL count) shown in the same before/after layout.
const textFigure = (kind, text) =>
  `<figure><pre class="proof">${esc(text ?? "—")}</pre><figcaption><span class="tag ${kind}">${TAG[kind]}</span></figcaption></figure>`;

function pair(item, shot) {
  const { name, caption } = typeof shot === "string" ? { name: shot } : shot;
  const rec = shots[name] ?? {};
  if (!rec.before) warnings.push(`#${item.id}: no "before" shot named ${name}`);
  if (FINDINGS)
    return `<div class="gallery">
${figure("before", rec.before?.file, caption ?? name, `#${item.id} as found`, rec.before)}
</div>`;
  if (!rec.after)
    warnings.push(`#${item.id}: no "after" shot named ${name} (rerun with QA_PHASE=after)`);
  const diff = rec.before && rec.after ? stateDiff(rec.before, rec.after) : [];
  if (diff.length) warnings.push(`#${item.id} ${name}: state differs — ${diff.join(", ")}`);
  return `<div class="gallery">
${figure("before", rec.before?.file, caption ?? name, `#${item.id} before the fix`, rec.before)}
${figure("after", rec.after?.file, caption ?? name, `#${item.id} after the fix`, rec.after)}
</div>${diff.length ? `<p class="warn">Not taken in the same state: ${esc(diff.join(", "))}</p>` : ""}`;
}

const RESULT = {
  fixed: ["Fixed", "good"],
  partly: ["Partly fixed", "part"],
  "not-fixed": ["Not fixed", "bad"],
};
const result = (item) => RESULT[item.result] ?? ["Not checked", "part"];
const resultTag = (item) => {
  const [label, cls] = result(item);
  return `<span class="tag ${cls}">${label}</span>`;
};

const overview = `<section aria-labelledby="overview">
<span class="eyebrow">${FINDINGS ? "Findings" : "Result"}</span>
<h2 id="overview">${FINDINGS ? "What was found" : "What was fixed"}</h2>
<div class="table-wrap"><table class="diff">
<thead><tr><th>#</th><th>Problem</th><th class="wide">${FINDINGS ? "Proposed fix" : "Fix"}</th>${FINDINGS ? "<th>Severity</th>" : `<th class="wide">Severity</th><th>Result</th>`}</tr></thead>
<tbody>
${items
  .map(
    (i) =>
      `<tr><td><a href="#f${esc(i.id)}">#${esc(i.id)}</a></td><td>${esc(i.problem)}</td><td class="wide">${esc(i.fix ?? "—")}</td>${FINDINGS ? `<td>${esc(i.severity ?? "—")}</td>` : `<td class="wide">${esc(i.severity ?? "—")}</td><td>${resultTag(i)}</td>`}</tr>`,
  )
  .join("\n")}
</tbody>
</table></div>
</section>`;

// Questions for the reader. Answers are collected into one text block they copy
// and send back; the "Short" line is the "1A, 2B" form Claude can act on.
const LETTERS = "ABCDEFGHIJ";
// A string literal safe inside <script> (a title may contain "</script>").
const jsString = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
// Questions sit next to what they ask about: one with `finding` goes inside that
// finding's section, the rest at the end. Numbered in page order (findings first).
const REVIEW = FINDINGS
  ? {
      question: "Should I apply this fix?",
      options: [{ label: "Yes, apply it" }, { label: "No, leave it as it is" }],
      other: true,
    }
  : {
      question: "Is this fix good?",
      options: [{ label: "Yes, it is good" }, { label: "No, it needs changes" }],
    };
const asked = spec.questions ?? [];
const sameId = (a, b) => a != null && String(a) === String(b);
const forFinding = (item) => [
  ...(spec.reviewEachFix || item.review ? [{ ...REVIEW, finding: item.id }] : []),
  ...asked.filter((q) => sameId(q.finding, item.id)),
];
const general = asked.filter((q) => !items.some((i) => sameId(q.finding, i.id)));
let askedCount = 0;
const question = (q) => {
  const type = q.type ?? "radio";
  q = { ...q, id: String(++askedCount) };
  const name = `q${q.id}`;
  const options =
    type === "text"
      ? `<textarea class="qtext" rows="3" aria-label="Answer to question ${esc(q.id)}"></textarea>`
      : (q.options ?? [])
          .map(
            (o, n) =>
              `<label class="opt"><input type="${type}" name="${name}" value="${LETTERS[n]}" data-label="${esc(o.label)}"><span><b>${LETTERS[n]}.</b> ${esc(o.label)}${o.recommended ? ` <span class="tag good">Recommended</span>` : ""}${o.detail ? `<span class="detail">${esc(o.detail)}</span>` : ""}</span></label>`,
          )
          .concat(
            q.other
              ? `<label class="opt"><input type="${type}" name="${name}" value="other" data-label="Other"><span><b>Other:</b> <input type="text" class="other" aria-label="Other answer to question ${esc(q.id)}"></span></label>`
              : [],
          )
          .join("\n");
  return `<fieldset class="q" data-id="${q.id}" data-type="${type}" data-question="${esc(q.question)}" data-finding="${esc(q.finding ?? "")}">
<legend><span class="eyebrow">Question ${q.id}</span>${esc(q.question)}</legend>
${q.why ? `<p class="note">${esc(q.why)}</p>` : ""}
${options}
${type === "text" ? "" : `<input type="text" class="qnote" placeholder="Comment (optional)" aria-label="Comment for question ${esc(q.id)}">`}
</fieldset>`;
};
const findings = items.map((item) => {
  const text =
    item.beforeText || item.afterText
      ? `<div class="gallery">${textFigure("before", item.beforeText)}${FINDINGS ? "" : textFigure("after", item.afterText)}</div>`
      : "";
  const refs = (item.references ?? []).length
    ? `<div class="gallery">${item.references
        .map((r) => figure("ref", r.file, r.caption, r.caption ?? "Similar feature"))
        .join("\n")}</div>`
    : "";
  return `<section id="f${esc(item.id)}" aria-labelledby="h${esc(item.id)}">
<span class="eyebrow">#${esc(item.id)}${item.severity ? ` · ${esc(item.severity)}` : ""}${FINDINGS ? "" : ` · ${result(item)[0]}`}</span>
<h2 id="h${esc(item.id)}">${esc(item.problem)}</h2>
${item.fix ? `<p class="lead"><strong>${FINDINGS ? "Proposed fix" : "Fix"}:</strong> ${esc(item.fix)}${item.cause ? ` <code>${esc(item.cause)}</code>` : ""}</p>` : ""}
${item.note ? `<p class="note">${esc(item.note)}</p>` : ""}
${(item.shots ?? []).map((n) => pair(item, n)).join("\n")}
${text}
${refs}
${forFinding(item).map(question).join("\n")}
</section>`;
});

const works = (spec.works ?? []).length
  ? `<section aria-labelledby="works">
<span class="eyebrow">Checked</span>
<h2 id="works">What works</h2>
<ul class="list">${spec.works.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
</section>`
  : "";

const notTested = (spec.notTested ?? []).length
  ? `<section aria-labelledby="not-tested">
<span class="eyebrow">Limits</span>
<h2 id="not-tested">Not tested</h2>
<ul class="list">${spec.notTested.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
</section>`
  : "";

const inline = askedCount;
const questions = inline || general.length
  ? `<section aria-labelledby="questions">
<span class="eyebrow">Your answers</span>
<h2 id="questions">${general.length ? "Questions" : "Send your answers"}</h2>
<p class="lead">${inline ? `${inline === 1 ? "One question is" : `${inline} questions are`} next to the findings above. ` : ""}Answer in this page, then press <strong>Copy answers</strong> and send the text back. Answers stay in this browser until you send them.</p>
${general.map(question).join("\n")}
<label class="who">Your name <input type="text" id="who" autocomplete="name"></label>
<button class="copy" type="button" data-target="answers">Copy answers</button>
<pre class="ticket" id="answers" aria-live="polite"></pre>
</section>`
  : "";

const copyBlocks = (spec.copyBlocks ?? []).map(
  (b, n) => `<section aria-labelledby="c${n}">
<span class="eyebrow">Copy and paste</span>
<h2 id="c${n}">${esc(b.title)}</h2>
${b.lead ? `<p class="lead">${esc(b.lead)}</p>` : ""}
<button class="copy" type="button" data-target="ct${n}">Copy text</button>
<pre class="ticket" id="ct${n}">${esc(b.text)}</pre>
</section>`,
);

const date = new Date().toISOString().slice(0, 10);
const route = spec.route ?? PROJECT.name;
const count = (k) => items.filter((i) => i.result === k).length;
const title = spec.title ?? `${FINDINGS ? "Usability test" : "Before and after"}: ${route}`;
const eyebrow = [PROJECT.name, route, FINDINGS ? "findings" : "before / after"]
  .filter(Boolean)
  .join(" · ");
// Screens and themes actually used, from the shot records of this report.
const used = items
  .flatMap((i) => i.shots ?? [])
  .map((s) => shots[typeof s === "string" ? s : s.name])
  .flatMap((r) => [r?.before, r?.after])
  .filter(Boolean);
const uniq = (xs) => [...new Set(xs.filter(Boolean))].join(", ");
const meta = [
  spec.before && `${FINDINGS ? "Tested" : "Before"}: ${spec.before}`,
  spec.after && `After: ${spec.after}`,
  spec.account,
  uniq(used.map((r) => r.viewport && `${r.viewport.width} × ${r.viewport.height}`)),
  uniq(used.map((r) => r.theme)),
  date,
].filter(Boolean);
const severities = uniq(
  ["High", "Medium", "Low"].map((s) => {
    const n = items.filter((i) => i.severity === s).length;
    return n && `${n} ${s.toLowerCase()}`;
  }),
);
const totals = FINDINGS
  ? `${items.length} finding${items.length === 1 ? "" : "s"}${severities ? ` (${severities})` : ""}`
  : [
      `${count("fixed")} of ${items.length} fixed`,
      count("partly") && `${count("partly")} partly`,
      count("not-fixed") && `${count("not-fixed")} not fixed`,
    ]
      .filter(Boolean)
      .join(" · ");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  /* Fonts fall back to the system fonts when the file is opened offline. */
  :root {
    --bg: #f7f6f3; --surface: #ffffff; --fg: #1d1c1a; --muted: #5f5b53; --line: #e2ded6;
    --accent: #b0700b; --accent-soft: #f6e9d2;
    --good: #1f6f4a; --good-soft: #e2f1e8; --bad: #a3321f; --bad-soft: #f8e1dc;
    --font-body: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #151413; --surface: #1e1d1b; --fg: #ece9e3; --muted: #a8a299; --line: #34312d;
      --accent: #e3a33a; --accent-soft: #3a2c14; --good: #6fcf9f; --good-soft: #183126;
      --bad: #f19a88; --bad-soft: #3b1d17; color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #151413; --surface: #1e1d1b; --fg: #ece9e3; --muted: #a8a299; --line: #34312d;
    --accent: #e3a33a; --accent-soft: #3a2c14; --good: #6fcf9f; --good-soft: #183126;
    --bad: #f19a88; --bad-soft: #3b1d17; color-scheme: dark;
  }

  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: 15px; line-height: 1.55; }
  .wrap {
    max-width: 1280px; margin: 0 auto; padding-block: 40px 72px; display: grid; gap: 52px;
    padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  }
  h1, h2 { margin: 0; text-wrap: balance; }
  h1 { font-size: clamp(26px, 4vw, 34px); font-weight: 700; letter-spacing: -0.01em; }
  h2 { font-size: 21px; font-weight: 600; }
  p { margin: 0; max-width: 72ch; }
  a { color: inherit; }
  code { font-family: var(--font-mono); font-size: 13px; overflow-wrap: anywhere; }
  .eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  section, header { display: grid; gap: 16px; min-width: 0; }
  .lead { color: var(--muted); }
  .note { font-size: 13.5px; color: var(--muted); max-width: 80ch; }
  .tldr { background: var(--accent-soft); border-radius: 10px; padding: 14px 16px; max-width: 80ch; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-family: var(--font-mono); font-size: 12.5px; color: var(--muted); max-width: none; }
  .state { font-family: var(--font-mono); font-size: 11.5px; flex-basis: 100%; }
  .list { margin: 0; padding-left: 22px; display: grid; gap: 6px; max-width: 78ch; }
  .warn { font-size: 13.5px; color: var(--bad); }

  .table-wrap { overflow-x: auto; }
  table.diff { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.diff th, table.diff td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  table.diff th { font-family: var(--font-mono); font-size: 11.5px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
  table.diff td:first-child { font-weight: 600; white-space: nowrap; }
  /* Each finding section repeats fix and severity, so a phone shows only # / problem / result. */
  @media (max-width: 600px) { table.diff .wide { display: none; } }

  .gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  @media (max-width: 760px) { .gallery { grid-template-columns: minmax(0, 1fr); } }
  figure { margin: 0; display: grid; gap: 8px; min-width: 0; align-content: start; }
  figcaption { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  .tag { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
  .tag.before { color: var(--muted); border: 1px solid var(--line); }
  .tag.after, .tag.good { color: var(--good); background: var(--good-soft); }
  .tag.ref, .tag.part { color: var(--accent); background: var(--accent-soft); }
  .tag.bad { color: var(--bad); background: var(--bad-soft); }
  /* Real pixel size, shrunk only when wider than the column, so sizes compare fairly. */
  .shot { display: block; width: fit-content; max-width: 100%; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); cursor: zoom-in; overflow: hidden; }
  .shot:focus-visible, .copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .shot img { display: block; max-width: 100%; height: auto; }
  .none { border: 1px dashed var(--line); border-radius: 6px; padding: 32px 16px; text-align: center; color: var(--muted); }
  pre.proof, pre.ticket { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
  fieldset.q { margin: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 16px; display: grid; gap: 10px; min-width: 0; }
  fieldset.q legend { float: left; width: 100%; padding: 0; display: grid; gap: 4px; font-weight: 600; font-size: 16px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
  .opt input[type=radio], .opt input[type=checkbox] { margin-top: 4px; accent-color: var(--accent); }
  .detail { display: block; color: var(--muted); font-size: 13.5px; }
  .who { display: grid; gap: 4px; width: min(100%, 320px); font-size: 13.5px; color: var(--muted); }
  input[type=text], textarea { font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; width: 100%; max-width: 640px; }
  .opt input.other { width: min(100%, 420px); }
  input[type=text]:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .copy { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); cursor: pointer; width: fit-content; }

  .zoom { position: fixed; inset: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 92%, transparent); display: grid; place-items: center; cursor: zoom-out; padding: 16px; }
  .zoom img { max-width: 100%; max-height: 100%; border: 1px solid var(--line); border-radius: 6px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="wrap">
<header>
<span class="eyebrow">${esc(eyebrow)}</span>
<h1>${esc(title)}</h1>
${spec.summary ? `<div class="tldr"><strong>TLDR.</strong> ${esc(spec.summary)}</div>` : ""}
<p class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</p>
<p class="note">${esc(totals)}. ${FINDINGS ? "Nothing is fixed yet. Each finding shows the screen as it was found, with the width, theme and account it was taken at." : "Each finding shows the same view before and after the fix, taken at the same width, theme and account."} Click a picture to enlarge it.${askedCount ? ` This page has ${askedCount} question${askedCount === 1 ? "" : "s"} for you; answer them in place and <a href="#questions">copy all answers at the end</a>.` : ""}</p>
</header>
${overview}
${findings.join("\n")}
${works}
${notTested}
${questions}
${copyBlocks.join("\n")}
</div>
<div class="zoom" id="zoom" hidden><img id="zoom-img" alt=""></div>
<script>
  (function () {
    var zoom = document.getElementById('zoom');
    var big = document.getElementById('zoom-img');
    var last = null;
    function close() { zoom.hidden = true; big.removeAttribute('src'); if (last) last.focus(); }
    document.querySelectorAll('.shot').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var img = btn.querySelector('img');
        last = btn; big.src = img.src; big.alt = img.alt; zoom.hidden = false;
      });
    });
    zoom.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !zoom.hidden) close(); });

    document.querySelectorAll('.copy').forEach(function (btn) {
      var text = document.getElementById(btn.dataset.target);
      btn.addEventListener('click', function () {
        var label = btn.textContent;
        var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 1800); };
        var fallback = function () {
          var range = document.createRange(); range.selectNodeContents(text);
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          btn.textContent = 'Selected, press Ctrl+C';
        };
        try { navigator.clipboard.writeText(text.textContent).then(done, fallback); } catch (e) { fallback(); }
      });
    });

    // Questions: rebuild the answer text on every change; keep a draft in this browser.
    var out = document.getElementById('answers');
    if (!out) return;
    var KEY = 'bat-answers:' + ${jsString(`${route} ${date} ${title}`)};
    var fields = function () { return document.querySelectorAll('fieldset.q input, fieldset.q textarea, #who'); };
    function save() {
      var state = [];
      fields().forEach(function (el) { state.push(el.type === 'radio' || el.type === 'checkbox' ? el.checked : el.value); });
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    }
    function restore() {
      var state;
      try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
      if (!Array.isArray(state)) return;
      fields().forEach(function (el, i) {
        if (i >= state.length) return;
        if (el.type === 'radio' || el.type === 'checkbox') el.checked = state[i] === true; else el.value = state[i] || '';
      });
    }
    function render() {
      var short = [], long = [];
      document.querySelectorAll('fieldset.q').forEach(function (q) {
        var id = q.dataset.id, picked = [], note = q.querySelector('.qnote');
        if (q.dataset.type === 'text') {
          var t = q.querySelector('.qtext').value.trim();
          if (t) picked.push(t);
          short.push(id + (t ? ' (see below)' : ' —'));
        } else {
          q.querySelectorAll('input[type=radio]:checked, input[type=checkbox]:checked').forEach(function (el) {
            if (el.value === 'other') picked.push('Other: ' + (q.querySelector('.other').value.trim() || '…'));
            else picked.push(el.value + '. ' + el.dataset.label);
          });
          short.push(id + (picked.length ? picked.map(function (p) { return p.charAt(1) === '.' ? p.charAt(0) : '(other)'; }).join('+') : ' —'));
        }
        long.push(id + '. ' + (q.dataset.finding ? '[#' + q.dataset.finding + '] ' : '') + q.dataset.question + '\\n   → ' + (picked.length ? picked.join('\\n   → ') : '(no answer)') +
          (note && note.value.trim() ? '\\n   Comment: ' + note.value.trim() : ''));
      });
      var who = document.getElementById('who').value.trim();
      out.textContent = 'Answers to "' + ${jsString(title)} + '" (' + ${jsString(`${route}, ${date}`)} + ')\\n' +
        (who ? 'From: ' + who + '\\n' : '') + 'Short: ' + short.join(', ') + '\\n\\n' + long.join('\\n\\n');
    }
    restore();
    render();
    document.addEventListener('input', function (e) {
      if (!e.target.closest('fieldset.q') && e.target.id !== 'who') return;
      // Typing in "Other" picks that option.
      if (e.target.classList.contains('other')) e.target.closest('.opt').querySelector('input').checked = true;
      render(); save();
    });
  })();
</script>
</body>
</html>
`;

const slug = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
const out =
  arg("out") ?? join(STORE, PROJECT.name, "reports", `${date}-${slug}-${FINDINGS ? "findings" : "before-after"}.html`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);

const mb = statSync(out).size / 1024 / 1024;
for (const w of warnings) console.error(`!! ${w}`);
if (mb > 15)
  console.error(`!! ${mb.toFixed(1)} MB — too big for most email; take element shots (locator) instead of full pages.`);
console.log(JSON.stringify({ out, sizeMb: Number(mb.toFixed(2)), warnings }, null, 2));
