import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, examCodeSchema, examStageSchema } from "./types";
import { currentAffairsItemSchema } from "./current-affairs";

/**
 * Cached weightage for a syllabus node — how often the topic has been asked.
 * `total`/`by_year` are rolled up through the node's subtree (like pyq_count);
 * `share_pct` and `hotness` are 0–100 relative to the busiest node in the paper
 * (drives the weightage bar). `hotness` is recency-weighted so recently-hot
 * topics rank above evenly-spread ones of the same total frequency.
 */
export const nodeWeightageSchema = z.object({
  total: z.number().int(),
  by_year: z.record(z.string(), z.number().int()),
  last_asked_year: z.number().int().nullable(),
  years_asked: z.number().int(),
  share_pct: z.number(),
  hotness: z.number(),
});
export type NodeWeightage = z.infer<typeof nodeWeightageSchema>;

export const paperSummarySchema = z.object({
  paper_code: z.string(),
  exam_stage: examStageSchema,
  title_i18n: bilingualTextSchema,
  topics_count: z.number().int(),
  pyq_count: z.number().int(),
  accuracy_pct: z.number().nullable(),
  answered_count: z.number().int(),
  /** Published study notes for this paper — drives the coverage % on the card. */
  notes_published_count: z.number().int(),
  /** Of those, how many are full Study chapters (Session 28) vs digest-only notes. */
  chapters_published_count: z.number().int().default(0),
});
export type PaperSummary = z.infer<typeof paperSummarySchema>;

export const papersResponseSchema = apiEnvelopeSchema(z.array(paperSummarySchema));
export type PapersResponse = z.infer<typeof papersResponseSchema>;

export interface SyllabusNodeWithStats {
  id: string;
  exam_stage: z.infer<typeof examStageSchema>;
  paper_code: string;
  title_i18n: z.infer<typeof bilingualTextSchema>;
  description_i18n: z.infer<typeof bilingualTextSchema> | null;
  order_index: number;
  depth: number;
  path: string;
  /** PYQs (source='pyq') mapped exactly to this node (not descendants) — matches the /questions?node= filter 1:1. */
  own_pyq_count: number;
  /** AI-generated questions (source='generated') mapped exactly to this node — the top-up supply a custom set can add beyond the PYQs. */
  own_generated_count: number;
  /** PYQs mapped to this node OR any descendant — always >= own_pyq_count. */
  pyq_count: number;
  accuracy_pct: number | null;
  answered_count: number;
  /** Cached weightage aggregate (null when the topic has no dated PYQs). */
  weightage: NodeWeightage | null;
  children: SyllabusNodeWithStats[];
}

export const syllabusNodeWithStatsSchema: z.ZodType<SyllabusNodeWithStats> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    exam_stage: examStageSchema,
    paper_code: z.string(),
    title_i18n: bilingualTextSchema,
    description_i18n: bilingualTextSchema.nullable(),
    order_index: z.number().int(),
    depth: z.number().int(),
    path: z.string(),
    own_pyq_count: z.number().int(),
    own_generated_count: z.number().int(),
    pyq_count: z.number().int(),
    accuracy_pct: z.number().nullable(),
    answered_count: z.number().int(),
    weightage: nodeWeightageSchema.nullable(),
    children: z.array(syllabusNodeWithStatsSchema),
  }),
);

export const paperTreeResponseSchema = apiEnvelopeSchema(syllabusNodeWithStatsSchema);
export type PaperTreeResponse = z.infer<typeof paperTreeResponseSchema>;

export const syllabusBreadcrumbItemSchema = z.object({
  id: z.string().uuid(),
  title_i18n: bilingualTextSchema,
  path: z.string(),
});
export type SyllabusBreadcrumbItem = z.infer<typeof syllabusBreadcrumbItemSchema>;

export const syllabusNodeDetailSchema = z.object({
  id: z.string().uuid(),
  exam_stage: examStageSchema,
  paper_code: z.string(),
  title_i18n: bilingualTextSchema,
  description_i18n: bilingualTextSchema.nullable(),
  breadcrumb: z.array(syllabusBreadcrumbItemSchema),
  pyq_count: z.number().int(),
  accuracy_pct: z.number().nullable(),
  answered_count: z.number().int(),
  weightage: nodeWeightageSchema.nullable(),
  related_current_affairs: z.array(currentAffairsItemSchema),
});
export type SyllabusNodeDetail = z.infer<typeof syllabusNodeDetailSchema>;

export const syllabusNodeDetailResponseSchema = apiEnvelopeSchema(syllabusNodeDetailSchema);
export type SyllabusNodeDetailResponse = z.infer<typeof syllabusNodeDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Per-paper Trends (weightage analytics) — GET /syllabus/papers/:code/trends
// ---------------------------------------------------------------------------
export const trendNodeSchema = z.object({
  node_id: z.string().uuid(),
  title_i18n: bilingualTextSchema,
  path: z.string(),
  depth: z.number().int(),
  total: z.number().int(),
  by_year: z.record(z.string(), z.number().int()),
  last_asked_year: z.number().int().nullable(),
  years_asked: z.number().int(),
  hotness: z.number(),
});
export type TrendNode = z.infer<typeof trendNodeSchema>;

export const paperTrendsSchema = z.object({
  paper_code: z.string(),
  /** Exam the view is scoped to; null = all exams combined. */
  exam_code: examCodeSchema.nullable(),
  /** The year axis, ascending (last N years of coverage). */
  years: z.array(z.number().int()),
  /** Paper-wide question count per year (the headline series). */
  total_by_year: z.record(z.string(), z.number().int()),
  total_questions: z.number().int(),
  /** Busiest topics by total frequency. */
  top_nodes: z.array(trendNodeSchema),
  /** Recency-hot topics (rank by hotness). */
  rising: z.array(trendNodeSchema),
  /** Topics with PYQs but not asked in 5+ years. */
  dormant: z.array(trendNodeSchema),
});
export type PaperTrends = z.infer<typeof paperTrendsSchema>;

export const paperTrendsResponseSchema = apiEnvelopeSchema(paperTrendsSchema);
export type PaperTrendsResponse = z.infer<typeof paperTrendsResponseSchema>;

export const paperTrendsQuerySchema = z.object({
  exam: examCodeSchema.optional(),
});
export type PaperTrendsQuery = z.infer<typeof paperTrendsQuerySchema>;
