import { z } from "zod";
import { apiEnvelopeSchema } from "./types";
import { testDetailSchema } from "./tests";

/**
 * Ghost Battle — replay a completed attempt's exact question set while racing
 * "past you", whose per-question pace comes from the original attempt's
 * attempt_answers.time_spent_seconds. A quiet marker shows where past-you is;
 * the end screen shows per-question time/accuracy deltas.
 */
export const ghostEntrySchema = z.object({
  question_id: z.string().uuid(),
  /** Seconds past-you spent on this question (null if not recorded). */
  time_spent_seconds: z.number().nullable(),
  /** Whether past-you got it right (null if unanswered). */
  is_correct: z.boolean().nullable(),
});
export type GhostEntry = z.infer<typeof ghostEntrySchema>;

export const ghostStartSchema = z.object({
  attempt_id: z.string().uuid(),
  started_at: z.string(),
  test: testDetailSchema,
  previous_attempt_id: z.string().uuid(),
  /** Past-you's per-question pace + correctness, in the test's question order. */
  ghost: z.array(ghostEntrySchema),
});
export type GhostStart = z.infer<typeof ghostStartSchema>;

export const ghostStartResponseSchema = apiEnvelopeSchema(ghostStartSchema);
export type GhostStartResponse = z.infer<typeof ghostStartResponseSchema>;
