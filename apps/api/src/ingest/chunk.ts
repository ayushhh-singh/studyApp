/**
 * The pure text-chunking used by `ingest:embed`, extracted so it can be TESTED.
 *
 * WHY THIS MODULE EXISTS — the same reason `ingest/prompts.ts` does.
 * `ingest/embed.ts` ends in a bare, unguarded top-level `main().catch(...)`, so
 * importing it from a test would immediately run the real ingest: Supabase
 * writes, OpenAI spend, and a full-bank re-embed. (That is not hypothetical —
 * CLAUDE.md records a scratch file accidentally triggering exactly this path.)
 * Adding an `argv[1]` guard to the CLI is explicitly NOT the fix this repo
 * wants, for the reason `ingest/prompts.ts`'s header gives. So the pure part
 * lives here instead, in a module with NO imports and NO side effects, and the
 * CLI imports it.
 *
 * Covered by `pnpm --filter api test:embed-chunk`.
 */

/**
 * Maximum characters per embedding chunk. Text longer than this is split on
 * sentence boundaries.
 */
export const MAX_CHARS = 1500;

/**
 * How much of a source's identifying text is repeated onto its CONTINUATION
 * chunks. Long enough to say what the chunk is about, short enough that it
 * cannot dominate the chunk it prefixes — a question stem runs to 1,892 chars
 * in this bank, which un-capped would exceed MAX_CHARS on its own.
 */
export const CONTEXT_PREFIX_MAX = 200;

/** Normalise exactly as `splitText` does, so prefix comparisons are real. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function splitText(text: string): string[] {
  const clean = normalise(text);
  if (clean.length <= MAX_CHARS) return clean ? [clean] : [];
  const chunks: string[] = [];
  const sentences = clean.split(/(?<=[.?!।])\s+/);
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).length > MAX_CHARS && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/**
 * The identifying prefix repeated onto continuation chunks.
 *
 * Normalised the same way as the body so `startsWith` below is a real
 * comparison — a stem containing a newline would otherwise fail to match its own
 * chunk and get prefixed onto itself. Truncated at a word boundary and
 * deliberately WITHOUT an ellipsis: an ellipsis would stop the result being a
 * literal prefix of chunk 0, which is the property that keeps single-chunk
 * sources byte-identical.
 */
export function contextPrefix(text: string): string {
  const clean = normalise(text);
  if (clean.length <= CONTEXT_PREFIX_MAX) return clean;
  const cut = clean.slice(0, CONTEXT_PREFIX_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Split `text`, repeating `contextFor` onto every chunk that does not already
 * begin with it — i.e. onto CONTINUATION chunks only.
 *
 * WHY: a question is embedded as stem + options + explanation, and the
 * 2026-08-13 explanation-depth rewrite made explanations ~5x longer. MEASURED
 * over 5,375 live MCQs, that takes the share of questions whose text exceeds
 * MAX_CHARS from 0.3% to 6.7%, and every one of those produced a tail chunk
 * carrying explanation prose with NO stem — so `match_embeddings` could hand the
 * mentor "...Statement 2 is incorrect because..." with nothing saying what the
 * question was.
 *
 * SAME PATTERN AS `notes/embed.ts`'s chapter chunking, which prefixes each
 * section piece with its heading under the identical `startsWith` guard —
 * copied deliberately rather than invented, so the two chunkers stay siblings.
 *
 * ⚑ THE `startsWith` GUARD IS WHAT MAKES THIS SAFE TO SHIP WITHOUT A FULL
 * RE-EMBED: chunk 0 already opens with the identifying text, so it is returned
 * untouched and every source that fits in one chunk is BYTE-IDENTICAL to before.
 * Only genuinely-split sources change, so no existing embedding is invalidated
 * and the nightly inserts-only job stays correct.
 */
export function chunkWithContext(text: string, contextFor?: string): string[] {
  const prefix = contextFor ? contextPrefix(contextFor) : "";
  return splitText(text).map((piece) =>
    prefix && !piece.startsWith(prefix) ? `${prefix}: ${piece}` : piece,
  );
}
