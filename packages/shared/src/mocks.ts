import { z } from "zod";
import { apiEnvelopeSchema } from "./types";

/**
 * Mock-test cut-off comparison: official UPPSC Prelims GS-I cut-offs (out of
 * 200, by year + category) that a mock result is measured against.
 */
export const examCutoffSchema = z.object({
  exam_code: z.string(),
  stage: z.string(),
  year: z.number().int(),
  category: z.string(),
  cutoff: z.number(),
  out_of: z.number().int(),
  is_official: z.boolean(),
});
export type ExamCutoff = z.infer<typeof examCutoffSchema>;

export const examCutoffsResponseSchema = apiEnvelopeSchema(z.array(examCutoffSchema));
export type ExamCutoffsResponse = z.infer<typeof examCutoffsResponseSchema>;
