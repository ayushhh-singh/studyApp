import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

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

export const srsCardResponseSchema = apiEnvelopeSchema(srsCardSchema);
export type SrsCardResponse = z.infer<typeof srsCardResponseSchema>;
