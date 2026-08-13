/**
 * notes:embed — embed PUBLISHED study notes into the pgvector `embeddings` store
 * (OpenAI text-embedding-3-small, 1536-dim), source_type='note'. Idempotent:
 * upsert on (source_type, source_id, locale, chunk_index).
 *
 * Session 28: a note that has a CHAPTER (study_content_i18n.sections non-empty) is
 * chunked PER SECTION, each chunk prefixed with its section heading — this is the
 * RAG payoff (a doubt about a sub-topic retrieves that section, with its heading
 * as context, instead of one flat blob). A digest-only note falls back to the
 * flattened NoteBody. Stale chunks for a re-embedded note are deleted first so a
 * shrunk chapter never leaves orphan chunks behind.
 *
 *   pnpm notes:embed [--limit N] [--node <uuid>] [--missing-only]
 *
 * --missing-only embeds ONLY published notes currently missing any embedding
 * (per embed-coverage.ts's source of truth) — cheap on a normal run (usually
 * 0), and what the nightly safety-net cron uses so re-embedding all ~280+
 * chapters every night isn't the default cost.
 */
import { supabase } from "../lib/supabase.js";
import { embeddings } from "../lib/embeddings.js";
import { DEFAULT_EXAM_CODE, hasChapter, type NoteBody, type StudyContent } from "@neev/shared";
import { computeEmbedCoverage } from "../ingest/embed-coverage.js";
import { parseArgs } from "../ingest/_shared.js";
import { toVectorLiteral, upsertEmbeddingRows } from "../lib/embed-upsert.js";
import { chunkWithContext, splitText } from "../ingest/chunk.js";

type Locale = "hi" | "en";
const LOCALES: Locale[] = ["hi", "en"];

interface Chunk {
  source_id: string;
  locale: Locale;
  chunk_index: number;
  chunk_text: string;
  exam_code: string;
}

/** Light markdown → plain text (drop table pipes, bold, headings, mermaid fences). */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[|>#*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// splitText / MAX_CHARS used to be duplicated here, byte-for-byte identical to
// `ingest/chunk.ts`'s. They were found by an audit of the question-chunking
// change and unified: two copies of a chunker is exactly the shape that lets one
// improve while the other silently keeps the old behaviour, which is the same
// hazard `ingest/_shared.ts`'s redeclared `ExamCode` already demonstrated.
//
// VERIFIED A NO-OP before unifying, not assumed: `chunkWithContext` differs from
// the old local code only in that it normalises and 200-char-caps the prefix,
// and 0 of the 4,536 real chapter headings in this bank (both locales) are
// changed by that. `splitText` itself was already identical, including the
// empty-input case.

/** Digest fallback: flatten a NoteBody into one embeddable blob. */
function digestText(b: NoteBody): string {
  return [b.overview, b.key_facts.map((f) => f.fact).join(". "), b.up_angle, b.pyq_analysis, b.quick_revision.join(". ")]
    .filter(Boolean)
    .join(" ");
}

/** Chapter: one heading-prefixed text per section (body + boxes), split if long. */
function chapterSectionTexts(sc: StudyContent, locale: Locale): string[] {
  const out: string[] = [];
  for (const s of sc.sections) {
    const heading = s.heading_i18n[locale]?.trim() || s.heading_i18n.en;
    const body = stripMarkdown(s.body_md_i18n[locale] ?? "");
    const boxes = s.boxes.map((b) => stripMarkdown(b.content_i18n[locale] ?? "")).filter(Boolean).join(" ");
    const blob = `${heading}. ${body} ${boxes}`.trim();
    // Prefix EVERY resulting chunk with the heading so retrieval keeps section
    // context. This is the ORIGINAL of the pattern `ingest/chunk.ts` now shares
    // with the question chunker — same `startsWith` guard, so chunk 0 (which
    // already opens with the heading) is untouched.
    out.push(...chunkWithContext(blob, heading));
  }
  return out;
}

interface NoteRow {
  id: string;
  content_i18n: { hi: NoteBody; en: NoteBody };
  study_content_i18n: StudyContent | null;
  syllabus_nodes: { exam_code: string | null } | { exam_code: string | null }[] | null;
}

export interface EmbedNotesResult {
  noteCount: number;
  chapterCount: number;
  chunkCount: number;
}

/**
 * Embed published notes IN-PROCESS (no child-process spawn). Callers that need
 * to embed many notes from a loop (e.g. a batch checkpoint script) MUST call this
 * directly rather than shelling out to `tsx .../embed.ts --node <id>` per note —
 * spawning a fresh node process per note under a tight loop is fragile (observed:
 * silent failures with no visible stderr, verified this way in Session 28's
 * post-rollout audit) and needlessly slow (a fresh Supabase/OpenAI client per call).
 */
export async function embedNotes(opts: { nodeId?: string; noteIds?: string[]; limit?: number } = {}): Promise<EmbedNotesResult> {
  // exam_code comes from the note's own syllabus node — the tree is what defines
  // which exam a chapter belongs to (`notes.syllabus_node_id` is UNIQUE, so a
  // note has exactly one).
  let q = supabase()
    .from("notes")
    .select("id, content_i18n, study_content_i18n, syllabus_nodes(exam_code)")
    .eq("status", "published");
  if (opts.nodeId) q = q.eq("syllabus_node_id", opts.nodeId);
  if (opts.noteIds) q = q.in("id", opts.noteIds); // note.id === embeddings.source_id (see embed-coverage.ts)
  const { data, error } = await q;
  if (error) throw new Error(`fetch notes: ${error.message}`);

  const notes = ((data ?? []) as NoteRow[]).slice(0, opts.limit);
  if (notes.length === 0) return { noteCount: 0, chapterCount: 0, chunkCount: 0 };

  const chunks: Chunk[] = [];
  let chapterCount = 0;
  for (const n of notes) {
    const isChapter = hasChapter(n.study_content_i18n);
    if (isChapter) chapterCount++;
    for (const loc of LOCALES) {
      const texts = isChapter ? chapterSectionTexts(n.study_content_i18n!, loc) : splitText(digestText(n.content_i18n[loc]));
      const sn = n.syllabus_nodes;
      // PostgREST returns a to-one embed as an object or a single-element array.
      const examCode = (Array.isArray(sn) ? sn[0]?.exam_code : sn?.exam_code) ?? DEFAULT_EXAM_CODE;
      texts.forEach((chunk_text, chunk_index) =>
        chunks.push({ source_id: n.id, locale: loc, chunk_index, chunk_text, exam_code: examCode }),
      );
    }
  }
  if (chunks.length === 0) return { noteCount: notes.length, chapterCount, chunkCount: 0 };

  // Delete existing chunks for the notes we're re-embedding so a shrunk chapter
  // leaves no orphan chunk_index rows behind.
  for (const n of notes) {
    const { error: delErr } = await supabase().from("embeddings").delete().eq("source_type", "note").eq("source_id", n.id);
    if (delErr) console.warn(`  (warn) clear chunks for ${n.id}: ${delErr.message}`);
  }

  const provider = embeddings();
  // Two DIFFERENT batch sizes, deliberately — they were one `batchSize = 96`
  // before, which conflated an embedding-provider concern with a DB one. 96 is
  // fine for the OpenAI call; it is NOT fine for the pgvector write, because
  // inserting into the HNSW-indexed `embeddings` table is index-maintenance-heavy
  // and a 96-row statement reliably trips Postgres `statement_timeout` (observed
  // live on this DB three times: 2026-07-23, Session 28.5, and again 2026-08-02).
  // Each of those was worked around by retrying the whole note by hand; the fix
  // is to use the shared helper every OTHER embed writer already uses, which
  // re-batches at 12 with exponential backoff (CLAUDE.md Dev conventions:
  // "Every embed writer shares one statement-timeout-hardened upsert").
  const providerBatchSize = 96;
  let upserted = 0;
  for (let i = 0; i < chunks.length; i += providerBatchSize) {
    const batch = chunks.slice(i, i + providerBatchSize);
    const vectors = await provider.embed(batch.map((c) => c.chunk_text));
    const rows = batch.map((c, j) => ({
      source_type: "note",
      source_id: c.source_id,
      locale: c.locale,
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: toVectorLiteral(vectors[j]),
      exam_code: c.exam_code,
    }));
    await upsertEmbeddingRows(rows, { onWarn: (m) => console.warn(`  (warn) ${m}`) });
    upserted += rows.length;
  }
  return { noteCount: notes.length, chapterCount, chunkCount: upserted };
}

async function main(): Promise<void> {
  // `--limit` fed `notes.slice(0, opts.limit)` through a bare `Number(...)`:
  // `--limit abc` produced NaN, and `slice(0, NaN)` is `slice(0, 0)` — an empty
  // run reported as success. A valueless `--node` likewise became `undefined`
  // and silently WIDENED a one-node re-embed to every published note.
  const args = parseArgs(
    process.argv.slice(2),
    { value: ["node"], boolean: ["missing-only"], positiveInt: ["limit"] },
    "notes:embed",
  );
  const limit = typeof args.limit === "string" ? Number(args.limit) : undefined;
  const nodeId = typeof args.node === "string" ? args.node : undefined;
  const missingOnly = args["missing-only"] === true;

  console.log(`notes:embed  (provider: ${embeddings().id}, ${embeddings().dimensions}d)${missingOnly ? "  [missing-only]" : ""}`);

  let noteIds: string[] | undefined;
  if (missingOnly) {
    const coverage = await computeEmbedCoverage();
    noteIds = coverage.find((c) => c.source_type === "note")?.missing ?? [];
    console.log(`  published notes missing an embedding: ${noteIds.length}`);
    if (noteIds.length === 0) {
      console.log("nothing to embed.");
      return;
    }
  }

  const result = await embedNotes({ nodeId, noteIds, limit });
  if (result.noteCount === 0) {
    console.log("nothing to embed (no published notes match).");
    return;
  }
  console.log(`  ${result.noteCount} note(s) (${result.chapterCount} chapter${result.chapterCount === 1 ? "" : "s"}) → ${result.chunkCount} chunk(s)`);
  console.log(`✓ ${result.chunkCount} note chunk(s) embedded + upserted.`);
}

if (process.argv[1] && process.argv[1].endsWith("embed.ts")) {
  main().catch((err) => {
    console.error("\nnotes:embed failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
