import { z } from "zod";
import {
  apiEnvelopeSchema,
  bilingualTextSchema,
  examCodeSchema,
  examStageSchema,
  paginatedSchema,
  sourceKindSchema,
} from "./types";

export const questionTypeSchema = z.enum(["mcq", "descriptive"]);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const questionSourceSchema = z.enum(["pyq", "generated", "manual"]);
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const questionOptionSchema = z.object({
  key: z.string(),
  text_i18n: bilingualTextSchema,
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const questionSchema = z.object({
  id: z.string().uuid(),
  type: questionTypeSchema,
  stage: examStageSchema,
  exam_code: examCodeSchema,
  /** Bilingual attribution label, e.g. { en: "UPSC Prelims", hi: "…" }. Null for legacy rows without one. */
  exam_label_i18n: bilingualTextSchema.nullable(),
  source_kind: sourceKindSchema,
  /** True when the question maps to no UPPSC syllabus node (an out-of-scope ask). */
  out_of_syllabus: z.boolean(),
  paper_code: z.string(),
  syllabus_node_id: z.string().uuid().nullable(),
  year: z.number().int().nullable(),
  source: questionSourceSchema,
  stem_i18n: bilingualTextSchema,
  options_i18n: z.array(questionOptionSchema).nullable(),
  correct_option_key: z.string().nullable(),
  explanation_i18n: bilingualTextSchema.nullable(),
  difficulty: difficultySchema,
  word_limit: z.number().int().nullable(),
  marks: z.number().nullable(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionsQuerySchema = z.object({
  paper: z.string().optional(),
  node: z.string().uuid().optional(),
  year: z.coerce.number().int().optional(),
  type: questionTypeSchema.optional(),
  /** Filter by source exam. Omit for "All exams"; pass "uppsc" for "UPPSC only". */
  exam: examCodeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type QuestionsQuery = z.infer<typeof questionsQuerySchema>;

export const questionsResponseSchema = apiEnvelopeSchema(paginatedSchema(questionSchema));
export type QuestionsResponse = z.infer<typeof questionsResponseSchema>;

/** GET /questions/:id — a single published question (e.g. to hydrate the Writing Room from ?question=). */
export const questionResponseSchema = apiEnvelopeSchema(questionSchema);
export type QuestionResponse = z.infer<typeof questionResponseSchema>;

/** GET /answers/today — a daily-rotated descriptive question; null if none published yet. */
export const todaysQuestionResponseSchema = apiEnvelopeSchema(questionSchema.nullable());
export type TodaysQuestionResponse = z.infer<typeof todaysQuestionResponseSchema>;
