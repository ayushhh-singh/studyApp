import { z } from "zod";
import { apiEnvelopeSchema, paginatedSchema } from "./types";
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
