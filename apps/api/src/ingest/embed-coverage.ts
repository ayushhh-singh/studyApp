/**
 * Embedding coverage — REAL numbers, not an assumption. For each embeddable
 * source_type, compares the set of eligible content rows (exactly the rows the
 * embed pipelines target) against the distinct source_ids actually present in the
 * `embeddings` table, and reports both directions of the delta:
 *
 *   - missing  = eligible content that has NO embedding  → RAG-invisible (undercoverage)
 *   - orphan   = embedded source_ids no longer eligible   → stale (e.g. a question
 *                that was un-published, or a source deleted, after it was embedded)
 *
 * Eligibility mirrors each pipeline's OWN filter so the comparison is apples-to-apples:
 *   syllabus        → every syllabus_nodes row            (ingest/embed.ts)
 *   question        → questions where is_published = true  (ingest/embed.ts)
 *   note            → notes where status = 'published'      (notes/embed.ts)
 *   current_affairs → current_affairs_items status='published' (ca/pipeline.ts)
 *
 * Used by `pnpm ingest:embed:verify` and surfaced in `pnpm cost:report` so a
 * forgotten re-embed shows up as a visible metric instead of a silent gap.
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";

export type EmbedSourceType = "syllabus" | "question" | "note" | "current_affairs";

/** Which command re-embeds each type — a missing gap is only actionable via its own pipeline. */
export const REMEDY: Record<EmbedSourceType, string> = {
  syllabus: "pnpm ingest:embed",
  question: "pnpm ingest:embed",
  note: "pnpm notes:embed",
  current_affairs: "pnpm ca:embed",
};

/** Types `ingest:embed` itself manages — the set `ingest:embed:verify --strict` gates on. */
export const INGEST_EMBED_TYPES: EmbedSourceType[] = ["syllabus", "question"];

export interface TypeCoverage {
  source_type: EmbedSourceType;
  eligible: number;
  embedded: number; // distinct source_ids present in embeddings
  missing: string[]; // eligible ids with no embedding
  orphan: string[]; // embedded ids no longer eligible
}

/** Every syllabus node id — embed targets all of them. */
async function eligibleSyllabus(): Promise<string[]> {
  const rows = await selectAll<{ id: string }>(() => supabase().from("syllabus_nodes").select("id").order("id"));
  return rows.map((r) => r.id);
}

/** Published questions — matches collectQuestionChunks' `.eq("is_published", true)`. */
async function eligibleQuestions(): Promise<string[]> {
  const rows = await selectAll<{ id: string }>(() =>
    supabase().from("questions").select("id").eq("is_published", true).order("id"),
  );
  return rows.map((r) => r.id);
}

/** Published notes — matches notes/embed.ts's `.eq("status", "published")`. */
async function eligibleNotes(): Promise<string[]> {
  const rows = await selectAll<{ id: string }>(() =>
    supabase().from("notes").select("id").eq("status", "published").order("id"),
  );
  return rows.map((r) => r.id);
}

/** Published CA items — matches ca/pipeline.ts (only status='published' items embed). */
async function eligibleCurrentAffairs(): Promise<string[]> {
  const rows = await selectAll<{ id: string }>(() =>
    supabase().from("current_affairs_items").select("id").eq("status", "published").order("id"),
  );
  return rows.map((r) => r.id);
}

/** Distinct source_ids present in `embeddings`, grouped by source_type. */
async function embeddedIdsByType(): Promise<Map<string, Set<string>>> {
  const rows = await selectAll<{ source_type: string; source_id: string }>(() =>
    supabase().from("embeddings").select("source_type, source_id").order("source_type"),
  );
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.source_type)) map.set(r.source_type, new Set());
    map.get(r.source_type)!.add(r.source_id);
  }
  return map;
}

export async function computeEmbedCoverage(): Promise<TypeCoverage[]> {
  const [syllabus, questions, notes, ca, embedded] = await Promise.all([
    eligibleSyllabus(),
    eligibleQuestions(),
    eligibleNotes(),
    eligibleCurrentAffairs(),
    embeddedIdsByType(),
  ]);

  const eligibleByType: Record<EmbedSourceType, string[]> = {
    syllabus,
    question: questions,
    note: notes,
    current_affairs: ca,
  };

  const out: TypeCoverage[] = [];
  for (const source_type of Object.keys(eligibleByType) as EmbedSourceType[]) {
    const eligibleIds = eligibleByType[source_type];
    const eligibleSet = new Set(eligibleIds);
    const embeddedSet = embedded.get(source_type) ?? new Set<string>();
    const missing = eligibleIds.filter((id) => !embeddedSet.has(id));
    const orphan = [...embeddedSet].filter((id) => !eligibleSet.has(id));
    out.push({
      source_type,
      eligible: eligibleIds.length,
      embedded: embeddedSet.size,
      missing,
      orphan,
    });
  }
  return out;
}

/**
 * True if any embeddable type has eligible content with no embedding. Pass a
 * `types` filter to gate on only certain pipelines (e.g. the ingest:embed-managed
 * set for a --strict CI check, so a CA gap — fixable only by ca:run — doesn't
 * fail an ingest:embed gate).
 */
export function hasCoverageGap(coverage: TypeCoverage[], types?: EmbedSourceType[]): boolean {
  return coverage.some((c) => (!types || types.includes(c.source_type)) && c.missing.length > 0);
}
