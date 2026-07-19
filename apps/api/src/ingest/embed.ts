/**
 * ingest:embed — chunk syllabus node descriptions + question stems/
 * explanations per locale, embed them with OpenAI text-embedding-3-small
 * (via src/lib/embeddings.ts, behind a swappable provider interface), and
 * upsert into the pgvector `embeddings` table (HNSW cosine index).
 *
 *   pnpm ingest:embed [--only syllabus|question] [--limit N]
 *
 * Idempotent: upsert keyed on (source_type, source_id, locale, chunk_index).
 * Each re-embedded source's existing chunks are deleted first (see
 * clearStaleChunks) so a source whose chunk count shrinks leaves no orphans.
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { embeddings } from "../lib/embeddings.js";
import { parseArgs, report } from "./_shared.js";
import { computeEmbedCoverage } from "./embed-coverage.js";

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

/**
 * Before re-embedding, delete every existing chunk for the sources we're about to
 * re-upsert (scoped to the exact (source_type, source_id) set in the new chunks,
 * so a `--limit`/`--only` partial run never touches a source it isn't re-embedding).
 * Without this, a source whose text SHRINKS its chunk count (e.g. a Hindi-overlay
 * pass shortening a stem, dropping it from 2 chunks to 1) would keep its now-orphan
 * chunk_index=1 row forever — the upsert only overwrites indices that still exist.
 * This mirrors the proven pattern in notes/embed.ts. `.in()` is chunked because
 * PostgREST throws `fetch failed` on a URL with a few hundred+ values (documented
 * gotcha in CLAUDE.md).
 */
async function clearStaleChunks(chunks: Chunk[]): Promise<void> {
  const byType = new Map<Chunk["source_type"], Set<string>>();
  for (const c of chunks) {
    if (!byType.has(c.source_type)) byType.set(c.source_type, new Set());
    byType.get(c.source_type)!.add(c.source_id);
  }
  const IN_BATCH = 100;
  for (const [source_type, idSet] of byType) {
    const ids = [...idSet];
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const slice = ids.slice(i, i + IN_BATCH);
      const { error } = await supabase()
        .from("embeddings")
        .delete()
        .eq("source_type", source_type)
        .in("source_id", slice);
      if (error) throw new Error(`clear stale ${source_type} chunks: ${error.message}`);
    }
  }
}

interface EmbedRow {
  source_type: string;
  source_id: string;
  locale: string;
  chunk_index: number;
  chunk_text: string;
  embedding: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Upsert a small slice, retrying transient Postgres `statement_timeout`s with
 * exponential backoff. Inserting vectors into the HNSW-indexed `embeddings` table
 * is index-maintenance-heavy, so under a sustained re-embed the DB can time out a
 * batch (observed live at 96 AND intermittently at 24 rows). Small batches +
 * backing off (rather than hammering immediately) let a loaded index catch up.
 */
async function upsertRows(rows: EmbedRow[]): Promise<void> {
  const backoffMs = [500, 1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase()
      .from("embeddings")
      .upsert(rows, { onConflict: "source_type,source_id,locale,chunk_index" });
    if (!error) return;
    const timeout = /statement timeout/i.test(error.message);
    if (timeout && attempt < backoffMs.length) {
      report.warn(`upsert timed out (${rows.length} rows) — retry ${attempt + 1}/${backoffMs.length} after ${backoffMs[attempt]}ms…`);
      await sleep(backoffMs[attempt]);
      continue;
    }
    throw new Error(`upsert embeddings: ${error.message}`);
  }
}

async function embedAndUpsert(chunks: Chunk[], opts: { clearStale?: boolean } = {}): Promise<number> {
  const provider = embeddings();
  if (opts.clearStale !== false) await clearStaleChunks(chunks);
  const embedBatch = 96; // OpenAI batch — kept large (cheap, no index cost)
  const UPSERT_BATCH = 12; // DB batch — kept small to stay under statement_timeout
  let upserted = 0;
  for (let i = 0; i < chunks.length; i += embedBatch) {
    const batch = chunks.slice(i, i + embedBatch);
    const vectors = await provider.embed(batch.map((c) => c.chunk_text));
    const rows: EmbedRow[] = batch.map((c, j) => ({
      source_type: c.source_type,
      source_id: c.source_id,
      locale: c.locale,
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: toVectorLiteral(vectors[j]),
    }));
    for (let k = 0; k < rows.length; k += UPSERT_BATCH) {
      await upsertRows(rows.slice(k, k + UPSERT_BATCH));
    }
    upserted += rows.length;
    report.step(`embedded ${Math.min(i + embedBatch, chunks.length)}/${chunks.length}`);
  }
  return upserted;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const only = typeof args.only === "string" ? args.only : null;
  const limit = typeof args.limit === "string" ? Number(args.limit) : undefined;
  // --missing-only: embed ONLY sources with no embedding yet, as plain inserts
  // with NO delete phase. Full delete-then-reinsert of the whole bank churns the
  // HNSW index hard enough to trip statement_timeout under load; missing-only makes
  // every (even partial) run durable forward progress, so re-running converges to
  // full coverage. Trade-off: it does NOT refresh a source whose text changed but
  // is still embedded (a plain `ingest:embed` re-embeds everything for that).
  const missingOnly = args["missing-only"] === true || only === "missing";

  report.section(`ingest:embed  (provider: ${embeddings().id}, ${embeddings().dimensions}d)${missingOnly ? "  [missing-only]" : ""}`);

  let missingByType: Record<string, Set<string>> | null = null;
  if (missingOnly) {
    const coverage = await computeEmbedCoverage();
    missingByType = {};
    for (const c of coverage) missingByType[c.source_type] = new Set(c.missing);
    const totalMissing = coverage.reduce((n, c) => n + (c.source_type === "note" || c.source_type === "current_affairs" ? 0 : c.missing.length), 0);
    report.step(`missing sources to embed (syllabus+question): ${totalMissing}`);
  }
  const keep = (type: string, id: string): boolean => !missingByType || missingByType[type]?.has(id);

  // `only === "missing"` is a synonym for --missing-only, not a type filter — so
  // treat it as "no type filter" here (both syllabus + question, filtered to missing).
  const typeFilter = only === "missing" ? null : only;
  const chunks: Chunk[] = [];
  if (!typeFilter || typeFilter === "syllabus") {
    const s = (await collectSyllabusChunks(limit)).filter((c) => keep("syllabus", c.source_id));
    report.step(`syllabus chunks: ${s.length}`);
    chunks.push(...s);
  }
  if (!typeFilter || typeFilter === "question") {
    const q = (await collectQuestionChunks(limit)).filter((c) => keep("question", c.source_id));
    report.step(`question chunks: ${q.length}`);
    chunks.push(...q);
  }

  if (chunks.length === 0) {
    report.warn("nothing to embed.");
    return;
  }

  report.section("Embedding + upsert");
  // Skip the delete phase in missing-only mode — the sources have no chunks to clear,
  // so we avoid adding any delete-churn to an already-loaded index.
  const n = await embedAndUpsert(chunks, { clearStale: !missingOnly });

  report.section("Summary");
  report.ok(`chunks embedded + upserted: ${n}`);
}

main().catch((err) => {
  console.error("\ningest:embed failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
