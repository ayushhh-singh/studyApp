import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, paginatedSchema } from "./types";
import { testDetailSchema } from "./tests";

/**
 * Fixed category set the ingestion pipeline classifies every item into (see
 * apps/api/src/ca/pipeline.ts). Kept as a shared enum (not free text) so the
 * UI filter dropdown and the pipeline's classifier prompt never drift apart.
 */
export const currentAffairsCategorySchema = z.enum([
  "polity_governance",
  "economy",
  "environment_ecology",
  "science_tech",
  "schemes_welfare",
  "up_state_affairs",
  "national",
  "international",
  "awards_sports_misc",
]);
export type CurrentAffairsCategory = z.infer<typeof currentAffairsCategorySchema>;

/** The structured, exam-oriented breakdown shown in the item detail sheet. */
export const currentAffairsDetailSchema = z.object({
  what_happened_i18n: bilingualTextSchema,
  why_it_matters_i18n: bilingualTextSchema,
  key_facts_i18n: z.object({ hi: z.array(z.string()), en: z.array(z.string()) }),
  question_angle_i18n: bilingualTextSchema,
});
export type CurrentAffairsDetail = z.infer<typeof currentAffairsDetailSchema>;

export const currentAffairsItemSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  category: currentAffairsCategorySchema.nullable(),
  is_up_specific: z.boolean(),
  title_i18n: bilingualTextSchema,
  summary_i18n: bilingualTextSchema.nullable(),
  detail_i18n: currentAffairsDetailSchema.nullable(),
  source_urls: z.array(z.string()).nullable(),
  syllabus_node_ids: z.array(z.string().uuid()),
  mcq_question_ids: z.array(z.string().uuid()),
});
export type CurrentAffairsItem = z.infer<typeof currentAffairsItemSchema>;

export const currentAffairsQuerySchema = z.object({
  date: z.string().optional(),
  category: currentAffairsCategorySchema.optional(),
  // z.coerce.boolean() treats ANY non-empty string (including "false") as
  // true — enumerate the literal query values instead.
  up_only: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().int().min(1).default(1),
});
export type CurrentAffairsQuery = z.infer<typeof currentAffairsQuerySchema>;

export const currentAffairsResponseSchema = apiEnvelopeSchema(paginatedSchema(currentAffairsItemSchema));
export type CurrentAffairsResponse = z.infer<typeof currentAffairsResponseSchema>;

/** GET /current-affairs/:id — a single published item, for the detail sheet. */
export const currentAffairsItemResponseSchema = apiEnvelopeSchema(currentAffairsItemSchema);
export type CurrentAffairsItemResponse = z.infer<typeof currentAffairsItemResponseSchema>;

/** POST /current-affairs/quiz — builds a custom test from the last N days of CA-linked MCQs. */
export const currentAffairsQuizBodySchema = z.object({
  days: z.number().int().min(1).max(30).default(7),
});
export type CurrentAffairsQuizBody = z.infer<typeof currentAffairsQuizBodySchema>;

export const currentAffairsQuizResponseSchema = apiEnvelopeSchema(testDetailSchema);
export type CurrentAffairsQuizResponse = z.infer<typeof currentAffairsQuizResponseSchema>;
