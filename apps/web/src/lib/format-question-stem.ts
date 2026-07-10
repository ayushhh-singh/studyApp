// UPPSC PYQ stems are transcribed by ingest/pyq.ts's vision-extraction pass as one
// flattened string with no structural line breaks — "Match List-I ... A. ... B. ...
// List-II ... 1. ... 2. ..." comes back as a single run-on paragraph (some other-source
// papers already carry real \n, which this also normalizes). This reintroduces line
// breaks before List-I/List-II-style headers, Assertion/Reason markers, closing
// "which of the statements..." phrasing, and runs of sequential A/B/C/... or
// 1/2/3/... markers — while leaving ordinary prose (article numbers, initials,
// years) untouched, since a single marker with no incrementing neighbor never
// qualifies as a run.

// `\b` is defined over ASCII word chars only — it never fires around
// Devanagari (two non-word chars in its eyes, e.g. a preceding space and सू),
// so the Hindi alternatives below deliberately go unanchored rather than
// silently failing to match.
const LIST_HEADER_RE = /\b(?:List[-\s]?(?:I{1,3}|IV|V))\s*[:(]|सूची[-\s]?(?:[IVX]+)\s*[:(]/gi;
// Trailing punctuation after "(A)"/"(R)" varies across real papers between a
// plain hyphen, an en dash (–), and a colon — all three are audited as
// occurring. "कारण (R)" (not "तर्क (R)", which never appears in the real
// corpus) is the actual Hindi word used for "Reason" here.
const ASSERTION_REASON_RE =
  /\b(?:Assertion\s*\(A\)|Reason\s*\(R\))\s*[:\-–—]|(?:अभिकथन\s*\(A\)|कारण\s*\(R\))\s*[:\-–—]/gi;
// The negative lookbehind on "Select" excludes the OTHER common role this
// exact phrase plays: "Match List-I with List-II and select the correct
// answer using the codes given below the lists:" is one continuous opening
// instruction (synonym for "...and choose..."), not a closing sentence after
// an enumerated list — breaking there would split "and" from "select".
// Deliberately excludes a bare "सही उत्तर चुनिए" ("choose the correct
// answer") trigger — audited against 181 real occurrences and 100% of them
// are the tail of the SAME clause as what precedes them ("...कूट से सही
// उत्तर चुनिए", joined by से/करके/कर/हुए), unlike the English "Select the
// correct answer" which does start a fresh sentence.
// "ऊपर दिए गए/उपर्युक्त/उपरोक्त ... में से" ("from the above ...") DOES
// start a fresh sentence, but only ~77% of raw occurrences actually are one
// (audited) — the lookbehind restricts it to right after a real। sentence
// end, which brought real-data precision to 125/125.
const CLOSING_PHRASE_RE =
  /\bWhich of the (?:above |following )?(?:statements?|pairs?|codes?)\b|\bHow many (?:of the (?:above|following) )?(?:statements?|pairs?|codes?)\b|(?<!and\s)\bSelect the correct (?:answer|code)\b|(?<=।\s{0,3})(?:ऊपर दिए गए|उपर्युक्त|उपरोक्त)[^।?]{0,25}में से/gi;

// A word-start char that plausibly begins a new clause/item, in either script.
// Lowercase is included deliberately — real PYQ statement items can start
// with a stylized lowercase term ("e-Governance", "i-STEM"); the sequential
// run + proximity checks below are what actually guard against false hits,
// not the capitalization of what follows.
// Also covers a handful of real items whose text opens with a quote mark,
// rupee sign, or parenthesis instead of a bare letter (e.g. 1. "The Climate
// Group" ..., 2. (i) ...).
const ITEM_START = "[A-Za-z0-9\\u0900-\\u097F\"'₹(]";
const LETTER_MARKER_RE = new RegExp(`\\b([A-H])\\.\\s+(?=${ITEM_START})`, "g");
const NUMBER_MARKER_RE = new RegExp(`\\b(\\d{1,2})\\.\\s+(?=${ITEM_START})`, "g");

// Coincidental matches far apart in the text are very unlikely to be the same
// list — cap how far a "next" marker can be from the previous one.
const MAX_MARKER_GAP = 200;

function findSequentialMarkerBreaks(text: string, re: RegExp, toValue: (raw: string) => number): number[] {
  const matches = [...text.matchAll(re)];
  const breaks: number[] = [];
  let runStart = -1;

  for (let i = 1; i < matches.length; i++) {
    const prev = matches[i - 1];
    const curr = matches[i];
    const isNext = toValue(curr[1]) === toValue(prev[1]) + 1;
    const isClose = curr.index! - (prev.index! + prev[0].length) < MAX_MARKER_GAP;

    if (isNext && isClose) {
      if (runStart === -1) runStart = i - 1;
    } else {
      if (runStart !== -1) {
        for (let j = runStart; j <= i - 1; j++) breaks.push(matches[j].index!);
      }
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    for (let j = runStart; j < matches.length; j++) breaks.push(matches[j].index!);
  }
  return breaks;
}

export function formatQuestionStem(text: string): string {
  if (!text) return text;

  const breakPoints = new Set<number>();
  for (const re of [LIST_HEADER_RE, ASSERTION_REASON_RE, CLOSING_PHRASE_RE]) {
    for (const m of text.matchAll(re)) breakPoints.add(m.index!);
  }
  for (const i of findSequentialMarkerBreaks(text, LETTER_MARKER_RE, (r) => r.charCodeAt(0))) {
    breakPoints.add(i);
  }
  for (const i of findSequentialMarkerBreaks(text, NUMBER_MARKER_RE, (r) => parseInt(r, 10))) {
    breakPoints.add(i);
  }

  const sorted = [...breakPoints].sort((a, b) => a - b);
  let withBreaks = "";
  let cursor = 0;
  for (const index of sorted) {
    if (index <= cursor) continue;
    const segment = text.slice(cursor, index);
    // Some stems already carry a real \n exactly where we'd otherwise insert
    // one (e.g. already-clean per-statement lines) — appending unconditionally
    // would double it into a blank line between every item.
    withBreaks += segment + (/\n[ \t]*$/.test(segment) ? "" : "\n");
    cursor = index;
  }
  withBreaks += text.slice(cursor);

  // Also normalizes stems that already carried real \n from ingestion (stray
  // per-line whitespace, runs of blank lines) even when no new break was
  // inserted above. A single blank line is kept — some stems (e.g. a Mains
  // "read the passage" prompt) use one deliberately as a paragraph
  // separator — but runs of 2+ collapse to one, and a leading/trailing blank
  // is dropped.
  const lines: string[] = [];
  for (const rawLine of withBreaks.split("\n")) {
    const line = rawLine.trim();
    if (line === "" && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}
