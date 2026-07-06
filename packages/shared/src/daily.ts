import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, paginatedSchema } from "./types";
import { testSummarySchema } from "./tests";

/**
 * Daily-engagement engine shared contracts: the daily-quiz archive (today +
 * yesterday's makeup + every past day) and the daily answer set.
 */

/** One past daily quiz in the archive: its test summary + the day it targeted. */
export const dailyQuizArchiveItemSchema = testSummarySchema.extend({
  scheduled_date: z.string(),
});
export type DailyQuizArchiveItem = z.infer<typeof dailyQuizArchiveItemSchema>;

export const dailyQuizArchiveResponseSchema = apiEnvelopeSchema(paginatedSchema(dailyQuizArchiveItemSchema));
export type DailyQuizArchiveResponse = z.infer<typeof dailyQuizArchiveResponseSchema>;

// ---------------------------------------------------------------------------
// Daily answer set — 4-5 descriptive questions/day with per-question status.
// ---------------------------------------------------------------------------
export const dailyAnswerKindSchema = z.enum(["gs", "essay"]);
export type DailyAnswerKind = z.infer<typeof dailyAnswerKindSchema>;

export const dailyAnswerItemSchema = z.object({
  question_id: z.string().uuid(),
  paper_code: z.string(),
  kind: dailyAnswerKindSchema,
  stem_i18n: bilingualTextSchema,
  word_limit: z.number().int().nullable(),
  marks: z.number().nullable(),
  /** "evaluated" once the user has a completed evaluation for this question. */
  status: z.enum(["not_started", "evaluated"]),
  submission_id: z.string().uuid().nullable(),
  overall_score: z.number().nullable(),
  max_score: z.number().nullable(),
});
export type DailyAnswerItem = z.infer<typeof dailyAnswerItemSchema>;

export const dailyAnswerSetSchema = z.object({
  date: z.string(),
  items: z.array(dailyAnswerItemSchema),
  /** How many items in the set the user has completed an evaluation for. */
  completed_count: z.number().int(),
});
export type DailyAnswerSet = z.infer<typeof dailyAnswerSetSchema>;

export const dailyAnswerSetResponseSchema = apiEnvelopeSchema(dailyAnswerSetSchema);
export type DailyAnswerSetResponse = z.infer<typeof dailyAnswerSetResponseSchema>;
