import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, paginatedSchema } from "./types";

export const srsSourceTypeSchema = z.enum(["question", "current_affairs", "manual"]);
export type SrsSourceType = z.infer<typeof srsSourceTypeSchema>;

export const srsCardSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  front_i18n: bilingualTextSchema,
  back_i18n: bilingualTextSchema,
  source_type: srsSourceTypeSchema,
  source_id: z.string().uuid().nullable(),
});
export type SrsCard = z.infer<typeof srsCardSchema>;

export const createSrsCardFromNodeBodySchema = z.object({
  node_id: z.string().uuid(),
});
export type CreateSrsCardFromNodeBody = z.infer<typeof createSrsCardFromNodeBodySchema>;

export const createSrsCardFromQuestionBodySchema = z.object({
  question_id: z.string().uuid(),
});
export type CreateSrsCardFromQuestionBody = z.infer<typeof createSrsCardFromQuestionBodySchema>;

export const createSrsCardFromEvaluationBodySchema = z.object({
  submission_id: z.string().uuid(),
});
export type CreateSrsCardFromEvaluationBody = z.infer<typeof createSrsCardFromEvaluationBodySchema>;

export const createSrsCardFromCurrentAffairsFactBodySchema = z.object({
  item_id: z.string().uuid(),
  fact_index: z.number().int().min(0),
});
export type CreateSrsCardFromCurrentAffairsFactBody = z.infer<
  typeof createSrsCardFromCurrentAffairsFactBodySchema
>;

export const srsCardResponseSchema = apiEnvelopeSchema(srsCardSchema);
export type SrsCardResponse = z.infer<typeof srsCardResponseSchema>;

// ---------------------------------------------------------------------------
// FSRS scheduling — due queue, reviews, stats, manage view
// ---------------------------------------------------------------------------

/** ts-fsrs Rating: 1=Again, 2=Hard, 3=Good, 4=Easy (Manual=0 is never submitted by users). */
export const srsRatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type SrsRating = z.infer<typeof srsRatingSchema>;

/** ts-fsrs State: 0=New, 1=Learning, 2=Review, 3=Relearning. */
export const srsCardStateSchema = z.object({
  due_at: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  learning_steps: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: z.number().int(),
  last_review: z.string().nullable(),
});
export type SrsCardState = z.infer<typeof srsCardStateSchema>;

export const srsRatingPreviewSchema = z.object({
  due_at: z.string(),
  interval_days: z.number(),
});

export const srsIntervalPreviewSchema = z.object({
  1: srsRatingPreviewSchema,
  2: srsRatingPreviewSchema,
  3: srsRatingPreviewSchema,
  4: srsRatingPreviewSchema,
});

/** A due card as returned by the review queue — includes scheduler state + a preview of all four ratings. */
export const srsQueueCardSchema = srsCardSchema.extend({
  fsrs_state: srsCardStateSchema,
  preview: srsIntervalPreviewSchema,
});
export type SrsQueueCard = z.infer<typeof srsQueueCardSchema>;

export const srsDueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type SrsDueQuery = z.infer<typeof srsDueQuerySchema>;

export const srsDueQueueSchema = z.object({
  cards: z.array(srsQueueCardSchema),
  due_count: z.number().int(),
});
export const srsDueQueueResponseSchema = apiEnvelopeSchema(srsDueQueueSchema);
export type SrsDueQueueResponse = z.infer<typeof srsDueQueueResponseSchema>;

export const srsForecastDaySchema = z.object({
  date: z.string(),
  count: z.number().int(),
});

export const srsStatsSchema = z.object({
  due_today: z.number().int(),
  reviewed_today: z.number().int(),
  /** null when there's no review history yet in the lookback window. */
  retention_pct: z.number().nullable(),
  total_cards: z.number().int(),
  /** 7 entries, today first. */
  forecast: z.array(srsForecastDaySchema),
});
export const srsStatsResponseSchema = apiEnvelopeSchema(srsStatsSchema);
export type SrsStats = z.infer<typeof srsStatsSchema>;

export const submitSrsReviewItemSchema = z.object({
  card_id: z.string().uuid(),
  rating: srsRatingSchema,
});
export const submitSrsReviewsBodySchema = z.object({
  reviews: z.array(submitSrsReviewItemSchema).min(1).max(50),
});
export type SubmitSrsReviewsBody = z.infer<typeof submitSrsReviewsBodySchema>;

export const srsReviewResultSchema = z.object({
  card_id: z.string().uuid(),
  rating: srsRatingSchema,
  due_at: z.string(),
  state: z.number().int(),
});
export const submitSrsReviewsResponseSchema = apiEnvelopeSchema(z.object({
  results: z.array(srsReviewResultSchema),
}));
export type SubmitSrsReviewsResponse = z.infer<typeof submitSrsReviewsResponseSchema>;

export const createManualSrsCardBodySchema = z.object({
  front_i18n: bilingualTextSchema,
  back_i18n: bilingualTextSchema,
});
export type CreateManualSrsCardBody = z.infer<typeof createManualSrsCardBodySchema>;

export const updateSrsCardBodySchema = z.object({
  front_i18n: bilingualTextSchema.optional(),
  back_i18n: bilingualTextSchema.optional(),
});
export type UpdateSrsCardBody = z.infer<typeof updateSrsCardBodySchema>;

export const srsCardsQuerySchema = z.object({
  query: z.string().optional(),
  source_type: srsSourceTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type SrsCardsQuery = z.infer<typeof srsCardsQuerySchema>;

/** Manage-view row: a card plus enough scheduler state to show its next-due date. */
export const srsCardListItemSchema = srsCardSchema.extend({
  fsrs_state: srsCardStateSchema,
  created_at: z.string(),
});
export type SrsCardListItem = z.infer<typeof srsCardListItemSchema>;

export const listSrsCardsResponseSchema = apiEnvelopeSchema(paginatedSchema(srsCardListItemSchema));
export type ListSrsCardsResponse = z.infer<typeof listSrsCardsResponseSchema>;

export const seedRevisionResultSchema = z.object({
  added: z.number().int(),
  already: z.number().int(),
});
export const seedRevisionResponseSchema = apiEnvelopeSchema(seedRevisionResultSchema);
export type SeedRevisionResult = z.infer<typeof seedRevisionResultSchema>;
