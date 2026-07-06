/**
 * notes:embed — chunk PUBLISHED study notes per locale, embed them with the
 * same provider as ingest:embed (OpenAI text-embedding-3-small, 1536-dim), and
 * upsert into the pgvector `embeddings` table as source_type='note'.
 *
 *   pnpm notes:embed [--limit N]
 *
 * Idempotent: upsert keyed on (source_type, source_id, locale, chunk_index).
 * Lets a published note's own content join the RAG store the doubt-chat and
 * future features retrieve over. (source_type 'note' predates this — enum 0002.)
 */
import { supabase } from "../lib/supabase.js";
import { embeddings } from "../lib/embeddings.js";
import type { NoteBody } from "@prayasup/shared";

type Locale = "hi" | "en";
const LOCALES: Locale[] = ["hi", "en"];
const MAX_CHARS = 1500;

interface Chunk {
  source_id: string;
  locale: Locale;
  chunk_index: number;
  chunk_text: string;
}

function splitText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
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

/** Flatten a note body into one embeddable text blob per locale. */
function bodyText(b: NoteBody): string {
  return [
    b.overview,
    b.key_facts.map((f) => f.fact).join(". "),
    b.up_angle,
    b.pyq_analysis,
    b.quick_revision.join(". "),
  ]
    .filter(Boolean)
    .join(" ");
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) : undefined;

  console.log(`notes:embed  (provider: ${embeddings().id}, ${embeddings().dimensions}d)`);
  const { data, error } = await supabase()
    .from("notes")
    .select("id, content_i18n")
    .eq("status", "published");
  if (error) throw new Error(`fetch notes: ${error.message}`);

  const chunks: Chunk[] = [];
  for (const n of (data ?? []).slice(0, limit)) {
    const content = (n as { content_i18n: { hi: NoteBody; en: NoteBody } }).content_i18n;
    for (const loc of LOCALES) {
      splitText(bodyText(content[loc])).forEach((chunk_text, chunk_index) =>
        chunks.push({ source_id: (n as { id: string }).id, locale: loc, chunk_index, chunk_text }),
      );
    }
  }

  if (chunks.length === 0) {
    console.log("nothing to embed (no published notes).");
    return;
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
    console.log(`  embedded ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
  }

  console.log(`✓ ${upserted} note chunk(s) embedded + upserted.`);
}

main().catch((err) => {
  console.error("\nnotes:embed failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
