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
import { hasChapter, type NoteBody, type StudyContent } from "@neev/shared";
import { computeEmbedCoverage } from "../ingest/embed-coverage.js";

type Locale = "hi" | "en";
const LOCALES: Locale[] = ["hi", "en"];
const MAX_CHARS = 1500;

interface Chunk {
  source_id: string;
  locale: Locale;
  chunk_index: number;
  chunk_text: string;
}

/** Light markdown → plain text (drop table pipes, bold, headings, mermaid fences). */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[|>#*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= MAX_CHARS) return [clean];
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
    // Prefix EVERY resulting chunk with the heading so retrieval keeps section context.
    for (const piece of splitText(blob)) {
      out.push(piece.startsWith(heading) ? piece : `${heading}: ${piece}`);
    }
  }
  return out;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

interface NoteRow {
  id: string;
  content_i18n: { hi: NoteBody; en: NoteBody };
  study_content_i18n: StudyContent | null;
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
  let q = supabase().from("notes").select("id, content_i18n, study_content_i18n").eq("status", "published");
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
      texts.forEach((chunk_text, chunk_index) => chunks.push({ source_id: n.id, locale: loc, chunk_index, chunk_text }));
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
  const batchSize = 96;
  let upserted = 0;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await provider.embed(batch.map((c) => c.chunk_text));
    const rows = batch.map((c, j) => ({
      source_type: "note",
      source_id: c.source_id,
      locale: c.locale,
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: toVectorLiteral(vectors[j]),
    }));
    const { error: upErr } = await supabase()
      .from("embeddings")
      .upsert(rows, { onConflict: "source_type,source_id,locale,chunk_index" });
    if (upErr) throw new Error(`upsert embeddings: ${upErr.message}`);
    upserted += rows.length;
  }
  return { noteCount: notes.length, chapterCount, chunkCount: upserted };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) : undefined;
  const nodeIdx = args.indexOf("--node");
  const nodeId = nodeIdx >= 0 ? args[nodeIdx + 1] : undefined;
  const missingOnly = args.includes("--missing-only");

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
