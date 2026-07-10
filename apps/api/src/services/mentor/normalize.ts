/**
 * Question normalization for the mentor's semantic cache + retrieval.
 *
 * Two paraphrases of the same doubt ("what is federalism", "sir please explain
 * federalism to me") should embed to nearly the same vector so they hit one
 * cache cluster instead of splitting into two. We strip the phrasing noise that
 * doesn't change the question — surrounding courtesy filler, casing of Latin
 * text, and whitespace — BEFORE embedding. This is used only to compute the
 * embedding (for both the cache lookup AND the cache write, so they always
 * agree); the raw question is what gets stored and shown to the user.
 *
 * Devanagari is left untouched (it has no case), and only whole filler *words*
 * are removed so we never mangle the substantive question.
 */

// Courtesy / filler words that carry no meaning for retrieval, in both scripts.
// Matched as whole words (word boundaries for Latin, explicit spacing for
// Devanagari) so "please"/"sir" go but "pleasant"/"sirsa" don't.
const FILLER_LATIN = [
  "please",
  "pls",
  "plz",
  "kindly",
  "thanks",
  "thankyou",
  "thank you",
  "thx",
  "bhai",
  "bro",
  "sir",
  "sirji",
  "madam",
  "maam",
  "ma'am",
  "mam",
  "guru",
  "guruji",
  "ji",
  "yaar",
  "please help",
  "can you",
  "could you",
  "would you",
  "tell me",
  "explain me",
];

const FILLER_DEVANAGARI = ["कृपया", "कृप्या", "धन्यवाद", "भाई", "सर", "जी", "गुरु", "गुरुजी", "यार", "मैडम"];

const FILLER_LATIN_RE = new RegExp(
  `\\b(?:${FILLER_LATIN.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "gi",
);
const FILLER_DEVANAGARI_RE = new RegExp(`(?:^|\\s)(?:${FILLER_DEVANAGARI.join("|")})(?=\\s|$)`, "g");

/**
 * Collapse a doubt to its meaning-bearing core for embedding: trim, drop
 * courtesy filler, lowercase Latin, and collapse whitespace. Never returns "" if
 * there was any substantive text (if stripping filler empties it — e.g. the
 * message was only "please sir" — the trimmed original is returned so we still
 * embed *something*).
 */
export function normalizeQuestion(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const stripped = trimmed
    .replace(FILLER_DEVANAGARI_RE, " ")
    .replace(FILLER_LATIN_RE, " ")
    .replace(/\s+/g, " ")
    // Drop stray leading/trailing punctuation left behind by removed filler
    // (e.g. "sir, explain X" → ", explain X" → "explain X").
    .replace(/^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/g, "")
    .trim()
    .toLowerCase();
  return stripped || trimmed.toLowerCase();
}
