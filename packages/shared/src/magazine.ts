import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, paginatedSchema } from "./types";
import {
  bilingualListSchema,
  currentAffairsCategorySchema,
  currentAffairsFactKindSchema,
  currentAffairsFactSchema,
  currentAffairsGsPaperSchema,
  currentAffairsMainsBriefSchema,
  currentAffairsPossibleQuestionsSchema,
} from "./current-affairs";
import { questionOptionSchema } from "./questions";

/**
 * TWO editions per month, built from the exam-relevance data (0065):
 *  - PRELIMS COMPENDIUM — boxed, memorizable facts, topic-wise + by fact kind.
 *  - MAINS ANALYSIS — GS-paper-wise issue briefs, five curated Deep Dives, and
 *    Model Mains Questions with marking-point frameworks.
 *
 * Both editions are COMPUTED ON DEMAND from current_affairs_items/questions
 * (no new table) EXCEPT the five Deep Dives, which are sonnet-synthesized via
 * the Batch API (pnpm ca:deepdive) and stored in magazine_deep_dives so they
 * can go through the Review Queue before a Mains Analysis edition surfaces
 * them. Rendered at print-styled routes /:locale/magazine/:month/{prelims,mains}.
 */

export const magazineMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM (01-12)");
export type MagazineMonth = z.infer<typeof magazineMonthSchema>;

export const magazineEditionSchema = z.enum(["prelims", "mains"]);
export type MagazineEdition = z.infer<typeof magazineEditionSchema>;

/** A compact MCQ for the Prelims Compendium's workbook appendix. */
export const magazineMcqSchema = z.object({
  id: z.string().uuid(),
  stem_i18n: bilingualTextSchema,
  options_i18n: z.array(questionOptionSchema),
  correct_option_key: z.string().nullable(),
  explanation_i18n: bilingualTextSchema.nullable(),
});
export type MagazineMcq = z.infer<typeof magazineMcqSchema>;

// ---------------------------------------------------------------------------
// Prelims Compendium
// ---------------------------------------------------------------------------

/** One prelims_facts entry, carrying its parent item's id/title/date for attribution. */
export const magazineFactEntrySchema = currentAffairsFactSchema.extend({
  item_id: z.string().uuid(),
  item_title_i18n: bilingualTextSchema,
  item_date: z.string(),
});
export type MagazineFactEntry = z.infer<typeof magazineFactEntrySchema>;

export const magazineTopicSectionSchema = z.object({
  category: currentAffairsCategorySchema,
  facts: z.array(magazineFactEntrySchema),
});
export type MagazineTopicSection = z.infer<typeof magazineTopicSectionSchema>;

/** A cross-cutting boxed feature grouping facts by kind (Schemes of the Month, Reports & Indices, ...). */
export const magazineBoxedFeatureSchema = z.object({
  kind: currentAffairsFactKindSchema,
  facts: z.array(magazineFactEntrySchema),
});
export type MagazineBoxedFeature = z.infer<typeof magazineBoxedFeatureSchema>;

export const magazinePrelimsSchema = z.object({
  month: magazineMonthSchema,
  title_i18n: bilingualTextSchema,
  total_items: z.number().int(),
  total_facts: z.number().int(),
  /** UP-specific items' facts, foregrounded as a first-class lead section. */
  up_special: z.array(magazineFactEntrySchema),
  /** Fixed-taxonomy topic sections (UP-specific items excluded — they live in up_special). */
  topic_sections: z.array(magazineTopicSectionSchema),
  /** Cross-cutting boxed features, grouped by fact kind across every item (UP included). */
  boxed_features: z.array(magazineBoxedFeatureSchema),
  /** The month's approved CA MCQs with answers + explanations. */
  workbook: z.array(magazineMcqSchema),
});
export type MagazinePrelims = z.infer<typeof magazinePrelimsSchema>;

export const magazinePrelimsResponseSchema = apiEnvelopeSchema(magazinePrelimsSchema.nullable());
export type MagazinePrelimsResponse = z.infer<typeof magazinePrelimsResponseSchema>;

// ---------------------------------------------------------------------------
// Mains Analysis
// ---------------------------------------------------------------------------

/** One qualifying mains-life item, rendered as an issue brief. */
export const magazineIssueBriefSchema = z.object({
  item_id: z.string().uuid(),
  title_i18n: bilingualTextSchema,
  date: z.string(),
  category: currentAffairsCategorySchema.nullable(),
  is_up_specific: z.boolean(),
  gs_papers: z.array(currentAffairsGsPaperSchema),
  mains_relevance: z.number().int().min(0).max(3).nullable(),
  brief: currentAffairsMainsBriefSchema,
  possible_questions: currentAffairsPossibleQuestionsSchema.nullable(),
  syllabus_node_ids: z.array(z.string().uuid()),
});
export type MagazineIssueBrief = z.infer<typeof magazineIssueBriefSchema>;

export const magazineGsSectionSchema = z.object({
  paper: currentAffairsGsPaperSchema,
  items: z.array(magazineIssueBriefSchema),
});
export type MagazineGsSection = z.infer<typeof magazineGsSectionSchema>;

/** A published Deep Dive, as rendered in the Mains Analysis edition. */
export const magazineDeepDiveSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
});
export type MagazineDeepDiveSource = z.infer<typeof magazineDeepDiveSourceSchema>;

export const magazineDeepDiveSchema = z.object({
  id: z.string().uuid(),
  month: magazineMonthSchema,
  rank: z.number().int().min(1).max(5),
  status: z.enum(["needs_review", "published", "rejected"]),
  title_i18n: bilingualTextSchema,
  intro_i18n: bilingualTextSchema,
  synthesis_i18n: bilingualListSchema,
  significance_i18n: bilingualListSchema,
  challenges_i18n: bilingualListSchema,
  way_forward_i18n: bilingualListSchema,
  keywords_i18n: bilingualListSchema,
  case_examples_i18n: bilingualListSchema,
  gs_papers: z.array(currentAffairsGsPaperSchema),
  syllabus_node_ids: z.array(z.string().uuid()),
  source_item_ids: z.array(z.string().uuid()),
  sources: z.array(magazineDeepDiveSourceSchema),
  model: z.string().nullable(),
  cost_usd: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MagazineDeepDive = z.infer<typeof magazineDeepDiveSchema>;

/** A CA-linked descriptive question with its marking-points answer framework. */
export const magazineModelQuestionSchema = z.object({
  id: z.string().uuid(),
  stem_i18n: bilingualTextSchema,
  marks: z.number().nullable(),
  word_limit: z.number().int().nullable(),
  marking_points_i18n: bilingualListSchema,
  gs_papers: z.array(currentAffairsGsPaperSchema),
});
export type MagazineModelQuestion = z.infer<typeof magazineModelQuestionSchema>;

export const magazineMainsSchema = z.object({
  month: magazineMonthSchema,
  title_i18n: bilingualTextSchema,
  total_issues: z.number().int(),
  gs_sections: z.array(magazineGsSectionSchema),
  deep_dives: z.array(magazineDeepDiveSchema),
  model_questions: z.array(magazineModelQuestionSchema),
});
export type MagazineMains = z.infer<typeof magazineMainsSchema>;

export const magazineMainsResponseSchema = apiEnvelopeSchema(magazineMainsSchema.nullable());
export type MagazineMainsResponse = z.infer<typeof magazineMainsResponseSchema>;

// ---------------------------------------------------------------------------
// Month index
// ---------------------------------------------------------------------------

export const magazineMonthSummarySchema = z.object({
  month: magazineMonthSchema,
  title_i18n: bilingualTextSchema,
  prelims_item_count: z.number().int(),
  mains_item_count: z.number().int(),
  deep_dive_count: z.number().int(),
});
export type MagazineMonthSummary = z.infer<typeof magazineMonthSummarySchema>;

export const magazineMonthsResponseSchema = apiEnvelopeSchema(z.array(magazineMonthSummarySchema));
export type MagazineMonthsResponse = z.infer<typeof magazineMonthsResponseSchema>;

// ---------------------------------------------------------------------------
// Review Queue — Magazine tab (Deep Dives awaiting needs_review -> published).
// ---------------------------------------------------------------------------

export const reviewMagazineQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});
export type ReviewMagazineQuery = z.infer<typeof reviewMagazineQuerySchema>;

export const reviewMagazineResponseSchema = apiEnvelopeSchema(
  paginatedSchema(magazineDeepDiveSchema),
);
export type ReviewMagazineResponse = z.infer<typeof reviewMagazineResponseSchema>;

export const reviewMagazineEditBodySchema = z.object({
  title_i18n: bilingualTextSchema.optional(),
  intro_i18n: bilingualTextSchema.optional(),
  synthesis_i18n: bilingualListSchema.optional(),
  significance_i18n: bilingualListSchema.optional(),
  challenges_i18n: bilingualListSchema.optional(),
  way_forward_i18n: bilingualListSchema.optional(),
  keywords_i18n: bilingualListSchema.optional(),
  case_examples_i18n: bilingualListSchema.optional(),
  approve: z.boolean().optional(),
});
export type ReviewMagazineEditBody = z.infer<typeof reviewMagazineEditBodySchema>;

export const reviewMagazineRejectBodySchema = z.object({ reason: z.string().max(500).optional() });
export type ReviewMagazineRejectBody = z.infer<typeof reviewMagazineRejectBodySchema>;

export const reviewMagazineActionResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["needs_review", "published", "rejected"]),
});
export const reviewMagazineActionResponseSchema = apiEnvelopeSchema(reviewMagazineActionResultSchema);
export type ReviewMagazineActionResponse = z.infer<typeof reviewMagazineActionResponseSchema>;
