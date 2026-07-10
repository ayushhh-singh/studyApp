import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, paginatedSchema } from "./types";
import { testDetailSchema, testSummarySchema } from "./tests";

/**
 * Current-affairs contract, re-engineered around EXAM RELEVANCE (PT-365 /
 * Mains-365 style). Every item has two potential "lives":
 *  - a PRELIMS life  — boxed, memorizable facts (prelims_facts)
 *  - a MAINS life     — an issue to analyze (mains_brief)
 * Most items have only one; many have neither and are archived by the pipeline.
 *
 * `prelims_relevance` / `mains_relevance` (0-3) score each life; the pipeline's
 * hard gate archives anything scoring < 2 on both. Enrichment is conditional on
 * the score, so we never spend tokens fleshing out a life an item doesn't have.
 */

// ---------------------------------------------------------------------------
// Fixed taxonomy (constrains the DB `category` column + the classifier prompt +
// the UI filter chips — one enum so they can never drift apart).
// ---------------------------------------------------------------------------
export const currentAffairsCategorySchema = z.enum([
  "polity_governance",
  "economy",
  "international_relations",
  "environment_ecology",
  "science_tech",
  "security",
  "social_issues",
  "art_culture",
  "schemes",
  "reports_indices",
  "places_persons",
  "up_special",
]);
export type CurrentAffairsCategory = z.infer<typeof currentAffairsCategorySchema>;

/** Which Mains GS paper(s) an item feeds. GS5_UP/GS6_UP are the UP-specific papers. */
export const currentAffairsGsPaperSchema = z.enum([
  "GS1",
  "GS2",
  "GS3",
  "GS4",
  "ESSAY",
  "GS5_UP",
  "GS6_UP",
]);
export type CurrentAffairsGsPaper = z.infer<typeof currentAffairsGsPaperSchema>;

export const currentAffairsStatusSchema = z.enum(["draft", "published", "archived"]);
export type CurrentAffairsStatus = z.infer<typeof currentAffairsStatusSchema>;

/** Two-language aligned string arrays (same length, same order — hi[i] ⇔ en[i]). */
export const bilingualListSchema = z.object({ hi: z.array(z.string()), en: z.array(z.string()) });
export type BilingualList = z.infer<typeof bilingualListSchema>;

// ---------------------------------------------------------------------------
// Prelims life — boxed facts to memorize.
// ---------------------------------------------------------------------------
export const currentAffairsFactKindSchema = z.enum([
  "scheme",
  "report_index",
  "place",
  "org",
  "species",
  "appointment",
  "day_theme",
  "misc",
]);
export type CurrentAffairsFactKind = z.infer<typeof currentAffairsFactKindSchema>;

export const currentAffairsFactSchema = z.object({
  fact_i18n: bilingualTextSchema,
  kind: currentAffairsFactKindSchema,
  extras: z
    .object({
      ministry: z.string().optional(),
      publisher: z.string().optional(),
      rank: z.string().optional(),
      location: z.string().optional(),
    })
    .default({}),
});
export type CurrentAffairsFact = z.infer<typeof currentAffairsFactSchema>;

// ---------------------------------------------------------------------------
// Mains life — the analytical brief.
// ---------------------------------------------------------------------------
export const currentAffairsMainsBriefSchema = z.object({
  why_in_news_i18n: bilingualTextSchema,
  background_i18n: bilingualTextSchema,
  significance_i18n: bilingualListSchema,
  challenges_i18n: bilingualListSchema,
  way_forward_i18n: bilingualListSchema,
  /** Value-addition phrases/data points an examiner rewards (quote-ready). */
  keywords_i18n: bilingualListSchema,
  case_examples_i18n: bilingualListSchema,
});
export type CurrentAffairsMainsBrief = z.infer<typeof currentAffairsMainsBriefSchema>;

/** Suggested exam questions — a prelims MCQ-style stem and/or a mains directive question. */
export const currentAffairsPossibleQuestionsSchema = z.object({
  prelims_i18n: bilingualTextSchema.nullable().default(null),
  mains_i18n: bilingualTextSchema.nullable().default(null),
});
export type CurrentAffairsPossibleQuestions = z.infer<typeof currentAffairsPossibleQuestionsSchema>;

/**
 * Per-linked-node "why this matters" line, keyed by syllabus node id: one line
 * for each exam stage the item is relevant to, so the UI can say WHY a topic
 * link is worth following per stage.
 */
export const currentAffairsNodeSignificanceSchema = z.record(
  z.string(),
  z.object({
    prelims_i18n: bilingualTextSchema.nullable().default(null),
    mains_i18n: bilingualTextSchema.nullable().default(null),
  }),
);
export type CurrentAffairsNodeSignificance = z.infer<typeof currentAffairsNodeSignificanceSchema>;

// ---------------------------------------------------------------------------
// Legacy detail blob (pre-re-engineering items still carry this until backfilled).
// Kept nullable/optional so the magazine + un-backfilled rows still parse.
// ---------------------------------------------------------------------------
export const currentAffairsDetailSchema = z.object({
  what_happened_i18n: bilingualTextSchema,
  why_it_matters_i18n: bilingualTextSchema,
  key_facts_i18n: bilingualListSchema,
  question_angle_i18n: bilingualTextSchema,
});
export type CurrentAffairsDetail = z.infer<typeof currentAffairsDetailSchema>;

// ---------------------------------------------------------------------------
// The item.
// ---------------------------------------------------------------------------
export const currentAffairsItemSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  status: currentAffairsStatusSchema,
  category: currentAffairsCategorySchema.nullable(),
  is_up_specific: z.boolean(),
  prelims_relevance: z.number().int().min(0).max(3).nullable(),
  mains_relevance: z.number().int().min(0).max(3).nullable(),
  gs_papers: z.array(currentAffairsGsPaperSchema).default([]),
  title_i18n: bilingualTextSchema,
  summary_i18n: bilingualTextSchema.nullable(),
  prelims_facts: z.array(currentAffairsFactSchema).nullable(),
  mains_brief: currentAffairsMainsBriefSchema.nullable(),
  possible_questions: currentAffairsPossibleQuestionsSchema.nullable(),
  node_significance: currentAffairsNodeSignificanceSchema.nullable(),
  // Legacy — read-tolerant, used by the magazine + pre-backfill rows.
  detail_i18n: currentAffairsDetailSchema.nullable(),
  source_urls: z.array(z.string()).nullable(),
  syllabus_node_ids: z.array(z.string().uuid()),
  mcq_question_ids: z.array(z.string().uuid()),
});
export type CurrentAffairsItem = z.infer<typeof currentAffairsItemSchema>;

// ---------------------------------------------------------------------------
// List query — exam-lens tabs + category chips.
// ---------------------------------------------------------------------------
export const currentAffairsLensSchema = z.enum(["all", "prelims", "mains", "up"]);
export type CurrentAffairsLens = z.infer<typeof currentAffairsLensSchema>;

export const currentAffairsQuerySchema = z.object({
  date: z.string().optional(),
  category: currentAffairsCategorySchema.optional(),
  lens: currentAffairsLensSchema.default("all"),
  // z.coerce.boolean() treats ANY non-empty string (incl. "false") as true —
  // enumerate the literal query values instead. Kept for back-compat; `lens=up`
  // is the preferred way to filter UP-only now.
  up_only: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().int().min(1).default(1),
});
export type CurrentAffairsQuery = z.infer<typeof currentAffairsQuerySchema>;

export const currentAffairsResponseSchema = apiEnvelopeSchema(paginatedSchema(currentAffairsItemSchema));
export type CurrentAffairsResponse = z.infer<typeof currentAffairsResponseSchema>;

/** GET /current-affairs/:id — a single published item, for the detail view. */
export const currentAffairsItemResponseSchema = apiEnvelopeSchema(currentAffairsItemSchema);
export type CurrentAffairsItemResponse = z.infer<typeof currentAffairsItemResponseSchema>;

// ---------------------------------------------------------------------------
// "Quiz me" — the legacy ad-hoc last-N-days quiz builder is still supported
// (POST /current-affairs/quiz), but the primary path is now the two weekly
// assemblies surfaced via GET /current-affairs/weekly-sets.
// ---------------------------------------------------------------------------
export const currentAffairsQuizBodySchema = z.object({
  days: z.number().int().min(1).max(30).default(7),
});
export type CurrentAffairsQuizBody = z.infer<typeof currentAffairsQuizBodySchema>;

export const currentAffairsQuizResponseSchema = apiEnvelopeSchema(testDetailSchema);
export type CurrentAffairsQuizResponse = z.infer<typeof currentAffairsQuizResponseSchema>;

/**
 * GET /current-affairs/weekly-sets — the two ready-to-run weekly assemblies:
 * a Prelims MCQ quiz and a Mains descriptive practice set. Either can be null
 * before the week's first assembly cron has run (or if there's no approved
 * supply yet).
 */
export const currentAffairsWeeklySetsSchema = z.object({
  prelims: testSummarySchema.nullable(),
  mains: testSummarySchema.nullable(),
});
export type CurrentAffairsWeeklySets = z.infer<typeof currentAffairsWeeklySetsSchema>;

export const currentAffairsWeeklySetsResponseSchema = apiEnvelopeSchema(currentAffairsWeeklySetsSchema);
export type CurrentAffairsWeeklySetsResponse = z.infer<typeof currentAffairsWeeklySetsResponseSchema>;
