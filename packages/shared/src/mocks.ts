import { z } from "zod";
import { apiEnvelopeSchema } from "./types";

/**
 * Mock-test cut-off comparison: official UPPSC Prelims GS-I cut-offs (out of
 * 200, by year + category) that a mock result is measured against.
 */
export const examCutoffSchema = z.object({
  /** The PAPER the cut-off is on (e.g. PRE_GS1). Renamed from `exam_code` in migration 0106 — it never held an exam code. */
  paper_code: z.string(),
  /** Which exam these cut-offs belong to (genuinely an exam code, unlike the field above). */
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
