/**
 * Review Queue service — powers the admin-gated /:locale/review UI.
 *
 * Surfaces questions awaiting human review across four tabs and applies the
 * approve / edit-then-approve / reject decisions. Approving sets
 * review_state='approved' AND is_published=true iff the bilingual publish gate
 * passes (the DB trigger from 0005/0017 blocks publishing an incomplete row, so
 * is_published is derived from the stored publish_gate_ok generated column).
 */
import type {
  BilingualText,
  GenerationMeta,
  ReviewActionResult,
  ReviewCounts,
  ReviewEditBody,
  ReviewQuestion,
  ReviewTab,
  SimilarQuestion,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";
import { reviewNotesCount } from "./notes.js";

export const REVIEW_PAGE_SIZE = 10;

const REVIEW_COLUMNS =
  "id, type, stage, paper_code, syllabus_node_id, year, source, stem_i18n, options_i18n, correct_option_key, " +
  "explanation_i18n, difficulty, word_limit, marks, review_state, is_published, publish_gate_ok, generation_meta, " +
  "meta, created_at, syllabus_nodes(title_i18n)";

/**
 * Narrow a questions query to one review tab. The four tabs are disjoint:
 *  - generated_mcq / generated_descriptive: qgen output (needs_review), CA excluded.
 *  - current_affairs: the ca:run pool (needs_review), by paper_code.
 *  - machine_translated: PYQ rows whose Hindi was machine-regenerated and not yet
 *    human-verified. These are already approved+published (visible); this tab is
 *    an AUDIT surface — approving stamps meta.human_verified so it leaves the tab.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTab(query: any, tab: ReviewTab): any {
  switch (tab) {
    case "generated_mcq":
      return query
        .eq("review_state", "needs_review")
        .eq("source", "generated")
        .eq("type", "mcq")
        .neq("paper_code", CURRENT_AFFAIRS_PAPER_CODE);
    case "generated_descriptive":
      return query.eq("review_state", "needs_review").eq("source", "generated").eq("type", "descriptive");
    case "current_affairs":
      return query.eq("review_state", "needs_review").eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE);
    case "machine_translated":
      return query
        .eq("meta->>machine_translated", "true")
        .neq("review_state", "rejected")
        .or("meta->>human_verified.is.null,meta->>human_verified.neq.true");
    default:
      // "notes" is served by a separate endpoint (services/notes.ts); never a
      // questions query. Return an unsatisfiable filter as a defensive no-op.
      return query.eq("review_state", "__none__");
  }
}

interface ReviewRow {
  id: string;
  type: ReviewQuestion["type"];
  stage: ReviewQuestion["stage"];
  paper_code: string;
  syllabus_node_id: string | null;
  year: number | null;
  source: ReviewQuestion["source"];
  stem_i18n: BilingualText;
  options_i18n: ReviewQuestion["options_i18n"];
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
  difficulty: ReviewQuestion["difficulty"];
  word_limit: number | null;
  marks: number | null;
  review_state: ReviewQuestion["review_state"];
  is_published: boolean;
  publish_gate_ok: boolean;
  generation_meta: GenerationMeta | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  syllabus_nodes: { title_i18n: BilingualText } | null;
}

/** Resolve each row's generation_meta.dedup.nearest hits to displayable stems (batched). */
async function resolveSimilar(rows: ReviewRow[]): Promise<Map<string, SimilarQuestion[]>> {
  const ids = new Set<string>();
  for (const r of rows) for (const n of r.generation_meta?.dedup?.nearest ?? []) ids.add(n.question_id);
  const byId = new Map<string, { stem_i18n: BilingualText; year: number | null; source: SimilarQuestion["source"] }>();
  if (ids.size > 0) {
    const { data } = await supabase().from("questions").select("id, stem_i18n, year, source").in("id", [...ids]);
    for (const q of data ?? [])
      byId.set(q.id as string, {
        stem_i18n: q.stem_i18n as BilingualText,
        year: (q.year as number | null) ?? null,
        source: q.source as SimilarQuestion["source"],
      });
  }
  const out = new Map<string, SimilarQuestion[]>();
  for (const r of rows) {
    const hits: SimilarQuestion[] = [];
    for (const n of r.generation_meta?.dedup?.nearest ?? []) {
      const q = byId.get(n.question_id);
      if (q) hits.push({ id: n.question_id, similarity: n.similarity, stem_i18n: q.stem_i18n, year: q.year, source: q.source });
    }
    out.set(r.id, hits);
  }
  return out;
}

function mapRow(row: ReviewRow, similar: SimilarQuestion[]): ReviewQuestion {
  return {
    id: row.id,
    type: row.type,
    stage: row.stage,
    paper_code: row.paper_code,
    syllabus_node_id: row.syllabus_node_id,
    syllabus_title_i18n: row.syllabus_nodes?.title_i18n ?? null,
    year: row.year,
    source: row.source,
    stem_i18n: row.stem_i18n,
    options_i18n: row.options_i18n,
    correct_option_key: row.correct_option_key,
    explanation_i18n: row.explanation_i18n,
    difficulty: row.difficulty,
    word_limit: row.word_limit,
    marks: row.marks === null ? null : Number(row.marks),
    review_state: row.review_state,
    is_published: row.is_published,
    publish_gate_ok: row.publish_gate_ok,
    generation_meta: row.generation_meta,
    created_at: row.created_at,
    similar,
  };
}

export async function listReviewQueue(tab: ReviewTab, page: number): Promise<{ items: ReviewQuestion[]; total: number }> {
  // Notes have their own list endpoint (services/notes.ts) — never a question query.
  if (tab === "notes") return { items: [], total: 0 };
  const from = (page - 1) * REVIEW_PAGE_SIZE;
  const to = from + REVIEW_PAGE_SIZE - 1;
  const base = supabase().from("questions").select(REVIEW_COLUMNS, { count: "exact" });
  const { data, error, count } = await applyTab(base, tab)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to);
  if (error) throw new HttpError(500, `review queue query failed: ${error.message}`);
  const rows = (data ?? []) as unknown as ReviewRow[];
  const similar = await resolveSimilar(rows);
  return { items: rows.map((r) => mapRow(r, similar.get(r.id) ?? [])), total: count ?? 0 };
}

export async function reviewCounts(): Promise<ReviewCounts> {
  const tabs: ReviewTab[] = ["generated_mcq", "generated_descriptive", "machine_translated", "current_affairs"];
  const [questionEntries, notes] = await Promise.all([
    Promise.all(
      tabs.map(async (tab) => {
        const { count, error } = await applyTab(
          supabase().from("questions").select("id", { count: "exact", head: true }),
          tab,
        );
        if (error) throw new HttpError(500, `review count (${tab}) failed: ${error.message}`);
        return [tab, count ?? 0] as const;
      }),
    ),
    reviewNotesCount(),
  ]);
  return { ...(Object.fromEntries(questionEntries) as Omit<ReviewCounts, "notes">), notes };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
interface DecisionRow {
  id: string;
  publish_gate_ok: boolean;
  is_published: boolean;
  meta: Record<string, unknown> | null;
}

async function fetchDecisionRow(id: string): Promise<DecisionRow> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, publish_gate_ok, is_published, meta")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
  if (!data) throw notFound("Question not found");
  return data as DecisionRow;
}

/** Approve: review_state='approved' + is_published iff the bilingual gate passes. Idempotently stamps human_verified for machine-translated audit rows. */
export async function approveQuestion(id: string): Promise<ReviewActionResult> {
  const row = await fetchDecisionRow(id);
  const publish = row.publish_gate_ok;
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const nextMeta = meta.machine_translated ? { ...meta, human_verified: true } : meta;
  const { error } = await supabase()
    .from("questions")
    .update({ review_state: "approved", is_published: publish, meta: nextMeta })
    .eq("id", id);
  if (error) throw new HttpError(500, `approve failed: ${error.message}`);
  return { id, review_state: "approved", is_published: publish };
}

export async function rejectQuestion(id: string, reason?: string): Promise<ReviewActionResult> {
  const row = await fetchDecisionRow(id);
  const meta = { ...((row.meta ?? {}) as Record<string, unknown>), ...(reason ? { reject_reason: reason } : {}) };
  const { error } = await supabase()
    .from("questions")
    .update({ review_state: "rejected", is_published: false, meta })
    .eq("id", id);
  if (error) throw new HttpError(500, `reject failed: ${error.message}`);
  return { id, review_state: "rejected", is_published: false };
}

/**
 * Edit (and optionally approve). Writes the provided fields first — which
 * recomputes the publish_gate_ok generated column — then, if approve=true,
 * transitions in a second write using the fresh gate value (so a fixed bilingual
 * row publishes and a still-incomplete one is approved-but-unpublished rather
 * than tripping the publish trigger).
 */
export async function editQuestion(id: string, body: ReviewEditBody): Promise<ReviewActionResult> {
  await fetchDecisionRow(id); // 404 if missing

  const patch: Record<string, unknown> = {};
  if (body.stem_i18n !== undefined) patch.stem_i18n = body.stem_i18n;
  if (body.options_i18n !== undefined) patch.options_i18n = body.options_i18n;
  if (body.correct_option_key !== undefined) patch.correct_option_key = body.correct_option_key;
  if (body.explanation_i18n !== undefined) patch.explanation_i18n = body.explanation_i18n;
  if (body.difficulty !== undefined) patch.difficulty = body.difficulty;
  if (body.word_limit !== undefined) patch.word_limit = body.word_limit;
  if (body.marks !== undefined) patch.marks = body.marks;
  if (body.syllabus_node_id !== undefined) patch.syllabus_node_id = body.syllabus_node_id;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase().from("questions").update(patch).eq("id", id);
    if (error) throw new HttpError(500, `edit failed: ${error.message}`);
  }
  if (body.approve) return approveQuestion(id);

  const fresh = await fetchDecisionRow(id);
  return { id, review_state: "needs_review", is_published: fresh.is_published };
}

export async function bulkApprove(ids: string[]): Promise<ReviewActionResult> {
  let approved = 0;
  let published = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      const r = await approveQuestion(id);
      approved += 1;
      if (r.is_published) published += 1;
      else skipped += 1; // approved but gate failed → not published
    } catch {
      skipped += 1;
    }
  }
  return { id: null, review_state: "approved", is_published: published > 0, approved, published, skipped };
}
