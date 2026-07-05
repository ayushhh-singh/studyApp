import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { questionSchema } from "./questions";

export const testKindSchema = z.enum(["pyq_full", "sectional", "daily_quiz", "custom"]);
export type TestKind = z.infer<typeof testKindSchema>;

export const markingSchemeSchema = z
  .object({
    type: z.string(),
    negative_marking: z.number(),
    note: z.string().optional(),
  })
  .nullable();
export type MarkingScheme = z.infer<typeof markingSchemeSchema>;

export const testSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().nullable(),
  title_i18n: bilingualTextSchema,
  kind: testKindSchema,
  paper_code: z.string().nullable(),
  duration_minutes: z.number().int().nullable(),
  total_marks: z.number().nullable(),
  question_count: z.number().int(),
});
export type TestSummary = z.infer<typeof testSummarySchema>;

// Test-taking view of a question: correct answer & explanation stripped.
export const testQuestionPublicSchema = questionSchema
  .omit({ correct_option_key: true, explanation_i18n: true })
  .extend({
    order_index: z.number().int(),
    marks: z.number().nullable(),
  });
export type TestQuestionPublic = z.infer<typeof testQuestionPublicSchema>;

export const testDetailSchema = testSummarySchema.extend({
  marking_scheme: markingSchemeSchema,
  questions: z.array(testQuestionPublicSchema),
});
export type TestDetail = z.infer<typeof testDetailSchema>;

export const testsQuerySchema = z.object({
  kind: testKindSchema.optional(),
  paper: z.string().optional(),
});
export type TestsQuery = z.infer<typeof testsQuerySchema>;

export const createCustomTestBodySchema = z.object({
  node_id: z.string().uuid(),
  count: z.number().int().min(1).max(100).default(20),
});
export type CreateCustomTestBody = z.infer<typeof createCustomTestBodySchema>;

export const testsListResponseSchema = apiEnvelopeSchema(z.array(testSummarySchema));
export type TestsListResponse = z.infer<typeof testsListResponseSchema>;

export const testDetailResponseSchema = apiEnvelopeSchema(testDetailSchema);
export type TestDetailResponse = z.infer<typeof testDetailResponseSchema>;
