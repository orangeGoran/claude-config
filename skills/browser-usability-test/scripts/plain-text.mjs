// Checks that the report title and summary are plain text for a reader who is new to the
// project: short sentences, no HTTP codes, no request counts, no file paths.
// compare.mjs prints each problem as a warning; the skill says to fix every warning.

/** Maximum number of sentences in the summary. */
export const MAX_SENTENCES = 4;
/** Maximum number of words in one sentence (ASD-STE100). */
export const MAX_WORDS = 25;
/** Maximum number of words in the title. */
export const MAX_TITLE_WORDS = 12;

const JARGON = [
  [/\b(?:GET|POST|PUT|PATCH|DELETE)s?\b/, "an HTTP method"],
  [/\b(?:HTTP\s*)?[45]\d\d\b/, "an HTTP status code"],
  [/[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|css|json)\b/, "a file name"],
  [/(?:^|\s)\/[\w-]+\/[\w/:-]*/, "a route or path"],
];

const words = (s) => s.split(/\s+/).filter(Boolean);
const sentences = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/** Return one warning for each term in the text that a new reader does not know. */
function jargon(text, label) {
  return JARGON.filter(([re]) => re.test(text)).map(
    ([re, what]) => `${label} uses ${what} ("${text.match(re)[0].trim()}"): say what the user sees instead`,
  );
}

/**
 * Return the warnings for a report summary: too many sentences, a sentence that is too
 * long, or a technical term. An empty or missing summary gives one warning.
 */
export function summaryWarnings(summary) {
  const text = String(summary ?? "").trim();
  if (!text) return ['no "summary": write 2–4 plain sentences for someone new to the project'];
  const out = [];
  const list = sentences(text);
  if (list.length > MAX_SENTENCES)
    out.push(`summary has ${list.length} sentences: use ${MAX_SENTENCES} or fewer (what was tested, the result, what is open); put details in "works" and the findings`);
  const long = list.filter((s) => words(s).length > MAX_WORDS);
  if (long.length)
    out.push(`summary has ${long.length} sentence(s) longer than ${MAX_WORDS} words: split them ("${long[0].slice(0, 60)}…")`);
  return out.concat(jargon(text, "summary"));
}

/** Return the warnings for a report title: too long, or a technical term. */
export function titleWarnings(title) {
  const text = String(title ?? "").trim();
  if (!text) return [];
  const out = [];
  if (words(text).length > MAX_TITLE_WORDS)
    out.push(`title has ${words(text).length} words: use ${MAX_TITLE_WORDS} or fewer`);
  return out.concat(jargon(text, "title"));
}
