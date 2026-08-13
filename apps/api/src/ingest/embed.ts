/**
 * ingest:embed — chunk syllabus node descriptions + question stems/
 * explanations per locale, embed them with OpenAI text-embedding-3-small
 * (via src/lib/embeddings.ts, behind a swappable provider interface), and
 * upsert into the pgvector `embeddings` table (HNSW cosine index).
 *
 *   pnpm ingest:embed [--only syllabus|question] [--limit N] [--missing-only]
 *
 * Idempotent: upsert keyed on (source_type, source_id, locale, chunk_index).
 * Each re-embedded source's existing chunks are deleted first (see
 * clearStaleChunks) so a source whose chunk count shrinks leaves no orphans.
 */
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { embeddings } from "../lib/embeddings.js";
import { toVectorLiteral, upsertEmbeddingRows, type EmbeddingRow } from "../lib/embed-upsert.js";
import { paperByCode, parseArgs, report } from "./_shared.js";
import { computeEmbedCoverage } from "./embed-coverage.js";
import { chunkWithContext } from "./chunk.js";

type Locale = "hi" | "en";
const LOCALES: Locale[] = ["hi", "en"];

interface Chunk {
  source_type: "syllabus" | "question";
  source_id: string;
  locale: Locale;
  chunk_index: number;
  chunk_text: string;
  /** Denormalized onto the embedding row so match_embeddings can filter on it. */
  exam_code: string;
}

function pushChunks(
  out: Chunk[],
  source_type: Chunk["source_type"],
  source_id: string,
  locale: Locale,
  text: string,
  exam_code: string,
  /** Identifying context repeated onto CONTINUATION chunks — see chunk.ts. */
  contextFor?: string,
): void {
  chunkWithContext(text, contextFor).forEach((chunk_text, chunk_index) =>
    out.push({ source_type, source_id, locale, chunk_index, chunk_text, exam_code }),
  );
}

async function collectSyllabusChunks(limit?: number): Promise<Chunk[]> {
  // Paged: the tree is 294 nodes for one exam today, but grows per exam and an
  // unranged read silently truncates at 1000 — which here means quietly leaving
  // a late paper unembedded (i.e. invisible to the mentor) with nothing logged.
  const data = await selectAll<{ id: string; exam_code: string | null; title_i18n: unknown; description_i18n: unknown }>(
    () => supabase().from("syllabus_nodes").select("id, exam_code, title_i18n, description_i18n").order("id"),
  );
  const out: Chunk[] = [];
  for (const n of data.slice(0, limit)) {
    const title = n.title_i18n as { hi?: string; en?: string };
    const desc = (n.description_i18n ?? {}) as { hi?: string; en?: string };
    for (const loc of LOCALES) {
      const text = [title[loc], desc[loc]].filter(Boolean).join(". ");
      pushChunks(out, "syllabus", n.id, loc, text, n.exam_code ?? DEFAULT_EXAM_CODE);
    }
  }
  return out;
}

async function collectQuestionChunks(limit?: number): Promise<Chunk[]> {
  // Paginate: the published bank exceeds 1000, so a single select would embed
  // only the first 1000 questions and leave the rest ungrounded.
  //
  // The exam comes from the question's SYLLABUS NODE, never from
  // `questions.exam_code`. Those are different things: `questions.exam_code` is
  // PROVENANCE ("which exam asked this"), and its domain deliberately includes
  // exams we ingest PYQs from but never sell (up_ro_aro, upsssc_pet, other)
  // whose questions are mapped onto the UPPSC tree for weightage. Stamping
  // provenance here would hide a real UPPSC-syllabus question behind an exam no
  // user can select.
  const data = await selectAll<{
    id: string;
    paper_code: string | null;
    stem_i18n: unknown;
    options_i18n: unknown;
    explanation_i18n: unknown;
    syllabus_nodes: { exam_code: string | null } | { exam_code: string | null }[] | null;
  }>(() =>
    supabase()
      .from("questions")
      .select("id, paper_code, stem_i18n, options_i18n, explanation_i18n, syllabus_nodes(exam_code)")
      .eq("is_published", true)
      .order("id", { ascending: true }),
  );
  const out: Chunk[] = [];
  let unmapped = 0;
  for (const q of data.slice(0, limit)) {
    const stem = q.stem_i18n as { hi?: string; en?: string };
    const expl = (q.explanation_i18n ?? {}) as { hi?: string; en?: string };
    const opts = (q.options_i18n ?? []) as { text_i18n?: { hi?: string; en?: string } }[];
    // PostgREST returns a to-one embed as an object or a single-element array.
    const sn = q.syllabus_nodes;
    const nodeExam = (Array.isArray(sn) ? sn[0]?.exam_code : sn?.exam_code) ?? null;
    // An out_of_syllabus question has no node, so the node cannot supply its
    // owning exam. The old fallback was the DEFAULT exam, justified by "every
    // such row is UPPSC" — true when written, and false the moment a second
    // exam's PYQs landed: it stamped ~57 unmapped UPSC questions `uppsc`, i.e.
    // a genuine cross-exam leak into UPPSC users' mentor grounding.
    //
    // `paper_code` is the right second source: it is globally unique ACROSS
    // exams (docs/multi-exam.md §0) and M23 made a non-default exam's codes
    // exam-prefixed, so `UPSC_PRE_CSAT` identifies its exam unambiguously.
    // NOTE it is deliberately NOT `questions.exam_code` — that is PROVENANCE,
    // whose domain includes exams nobody can select (up_ro_aro, upsssc_pet),
    // and using it here would hide a real UPPSC-syllabus question behind an
    // exam no user can pick.
    const paperExam = q.paper_code ? (paperByCode(q.paper_code)?.exam ?? null) : null;
    if (!nodeExam && !paperExam) unmapped++;
    for (const loc of LOCALES) {
      const optText = opts.map((o) => o.text_i18n?.[loc]).filter(Boolean).join("; ");
      const text = [stem[loc], optText, expl[loc]].filter(Boolean).join(" ");
      // The stem is the context: a continuation chunk is explanation prose, and
      // without this it reaches the mentor with no indication of the question it
      // explains. Byte-identical for every question that fits one chunk — see
      // pushChunks' `contextFor` doc.
      pushChunks(out, "question", q.id, loc, text, nodeExam ?? paperExam ?? DEFAULT_EXAM_CODE, stem[loc]);
    }
  }
  if (unmapped > 0) {
    report.warn(
      `${unmapped} published question(s) have neither a syllabus node nor a known paper code — ` +
        `their embeddings are stamped exam_code='${DEFAULT_EXAM_CODE}' by fallback ` +
        `(see OUTSTANDING §8d M19). Synthetic paper codes (CURRENT_AFFAIRS, EDGE) land here.`,
    );
  }
  return out;
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

/**
 * Pack chunks into ~size batches WITHOUT ever splitting a single source across two
 * batches. A source's stale-chunk delete and its fresh upsert must happen in the
 * same batch (see embedAndUpsert) — if a source straddled a batch boundary, the
 * second batch's delete would wipe the first batch's just-written chunks. Grouping
 * by (source_type, source_id) via a Map is robust to any input ordering.
 */
function packBySource(chunks: Chunk[], size: number): Chunk[][] {
  const groups = new Map<string, Chunk[]>();
  for (const c of chunks) {
    // Separator is a printable "|" rather than a NUL byte. It was \x00, which
    // is safe as a key (neither a source_type nor a uuid can contain it) but
    // made the WHOLE FILE binary to grep — `grep -n pushChunks embed.ts`
    // silently returned nothing while awk printed the line. That is the D15
    // census-miss class, and it cost real time twice while auditing this very
    // file. "|" is equally impossible in `syllabus`/`question` or a uuid, and
    // this Map is local to the function, so the change is behaviour-identical.
    const k = `${c.source_type}|${c.source_id}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
  }
  const batches: Chunk[][] = [];
  let cur: Chunk[] = [];
  for (const group of groups.values()) {
    if (cur.length > 0 && cur.length + group.length > size) {
      batches.push(cur);
      cur = [];
    }
    cur.push(...group);
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

async function embedAndUpsert(chunks: Chunk[], opts: { clearStale?: boolean } = {}): Promise<number> {
  const provider = embeddings();
  const clearStale = opts.clearStale !== false;
  const EMBED_BATCH = 96; // OpenAI batch — kept large (cheap, no index cost)
  const UPSERT_BATCH = 12; // DB batch — kept small to stay under statement_timeout

  // Interleave the stale-chunk delete PER BATCH rather than a blanket delete up
  // front. A full delete-then-reinsert would leave the whole bank "deleted but not
  // yet re-embedded" for the entire run — so a mid-run statement_timeout would drop
  // RAG coverage to near-zero until a re-run. Per-batch, each source is deleted and
  // re-upserted together (packBySource keeps a source whole), so at most one batch's
  // handful of sources is ever briefly incomplete; every earlier batch is durable.
  const batches = packBySource(chunks, EMBED_BATCH);
  let upserted = 0;
  let done = 0;
  for (const batch of batches) {
    if (clearStale) await clearStaleChunks(batch);
    const vectors = await provider.embed(batch.map((c) => c.chunk_text));
    const rows: EmbeddingRow[] = batch.map((c, j) => ({
      source_type: c.source_type,
      source_id: c.source_id,
      locale: c.locale,
      chunk_index: c.chunk_index,
      chunk_text: c.chunk_text,
      embedding: toVectorLiteral(vectors[j]),
      exam_code: c.exam_code,
    }));
    await upsertEmbeddingRows(rows, { batchSize: UPSERT_BATCH, onWarn: (m) => report.warn(m) });
    upserted += rows.length;
    done += rows.length;
    report.step(`embedded ${done}/${chunks.length}`);
  }
  return upserted;
}

async function main(): Promise<void> {
  // `--missing-only` is load-bearing: .github/workflows/nightly-settle.yml runs
  // `ingest:embed --missing-only` nightly, so it must stay in this spec.
  // `--limit` is a positiveInt because it CAPS the run — 0/NaN are both falsy and
  // would silently widen a capped pass into a full re-embed of the whole bank,
  // which churns the HNSW index hard enough to trip statement_timeout.
  const args = parseArgs(
    process.argv.slice(2),
    { value: ["only"], positiveInt: ["limit"], boolean: ["missing-only"] },
    "ingest:embed",
  );
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
