/**
 * ingest:embed — chunk syllabus node descriptions + question stems/
 * explanations per locale, embed them with OpenAI text-embedding-3-small
 * (via src/lib/embeddings.ts, behind a swappable provider interface), and
 * upsert into the pgvector `embeddings` table (HNSW cosine index).
 *
 *   pnpm ingest:embed [--only syllabus|question] [--limit N]
 *
 * Idempotent: upsert keyed on (source_type, source_id, locale, chunk_index).
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { embeddings } from "../lib/embeddings.js";
import { parseArgs, report } from "./_shared.js";

type Locale = "hi" | "en";
const LOCALES: Locale[] = ["hi", "en"];

interface Chunk {
  source_type: "syllabus" | "question";
  source_id: string;
  locale: Locale;
  chunk_index: number;
  chunk_text: string;
}

const MAX_CHARS = 1500;

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

function pushChunks(
  out: Chunk[],
  source_type: Chunk["source_type"],
  source_id: string,
  locale: Locale,
  text: string,
): void {
  splitText(text).forEach((chunk_text, chunk_index) =>
    out.push({ source_type, source_id, locale, chunk_index, chunk_text }),
  );
}

async function collectSyllabusChunks(limit?: number): Promise<Chunk[]> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, title_i18n, description_i18n");
  if (error) throw new Error(`fetch syllabus: ${error.message}`);
  const out: Chunk[] = [];
  for (const n of (data ?? []).slice(0, limit)) {
    const title = n.title_i18n as { hi?: string; en?: string };
    const desc = (n.description_i18n ?? {}) as { hi?: string; en?: string };
    for (const loc of LOCALES) {
      const text = [title[loc], desc[loc]].filter(Boolean).join(". ");
      pushChunks(out, "syllabus", n.id as string, loc, text);
    }
  }
  return out;
}

async function collectQuestionChunks(limit?: number): Promise<Chunk[]> {
  // Paginate: the published bank exceeds 1000, so a single select would embed
  // only the first 1000 questions and leave the rest ungrounded.
  const data = await selectAll<{ id: string; stem_i18n: unknown; options_i18n: unknown; explanation_i18n: unknown }>(
    () =>
      supabase()
        .from("questions")
        .select("id, stem_i18n, options_i18n, explanation_i18n")
        .eq("is_published", true)
        .order("id", { ascending: true }),
  );
  const out: Chunk[] = [];
  for (const q of data.slice(0, limit)) {
    const stem = q.stem_i18n as { hi?: string; en?: string };
    const expl = (q.explanation_i18n ?? {}) as { hi?: string; en?: string };
    const opts = (q.options_i18n ?? []) as { text_i18n?: { hi?: string; en?: string } }[];
    for (const loc of LOCALES) {
      const optText = opts.map((o) => o.text_i18n?.[loc]).filter(Boolean).join("; ");
      const text = [stem[loc], optText, expl[loc]].filter(Boolean).join(" ");
      pushChunks(out, "question", q.id as string, loc, text);
    }
  }
  return out;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

async function embedAndUpsert(chunks: Chunk[]): Promise<number> {
  const provider = embeddings();
  const batchSize = 96;
  let upserted = 0;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await provider.embed(batch.map((c) => c.chunk_text));
    const rows = batch.map((c, j) => ({
      source_type: c.source_type,
      source_id: c.source_id,
      locale: c.locale,
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: toVectorLiteral(vectors[j]),
    }));
    const { error } = await supabase()
      .from("embeddings")
      .upsert(rows, { onConflict: "source_type,source_id,locale,chunk_index" });
    if (error) throw new Error(`upsert embeddings: ${error.message}`);
    upserted += rows.length;
    report.step(`embedded ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
  }
  return upserted;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const only = typeof args.only === "string" ? args.only : null;
  const limit = typeof args.limit === "string" ? Number(args.limit) : undefined;

  report.section(`ingest:embed  (provider: ${embeddings().id}, ${embeddings().dimensions}d)`);

  const chunks: Chunk[] = [];
  if (!only || only === "syllabus") {
    const s = await collectSyllabusChunks(limit);
    report.step(`syllabus chunks: ${s.length}`);
    chunks.push(...s);
  }
  if (!only || only === "question") {
    const q = await collectQuestionChunks(limit);
    report.step(`question chunks: ${q.length}`);
    chunks.push(...q);
  }

  if (chunks.length === 0) {
    report.warn("nothing to embed.");
    return;
  }

  report.section("Embedding + upsert");
  const n = await embedAndUpsert(chunks);

  report.section("Summary");
  report.ok(`chunks embedded + upserted: ${n}`);
}

main().catch((err) => {
  console.error("\ningest:embed failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
