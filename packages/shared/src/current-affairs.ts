import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, paginatedSchema } from "./types";

export const currentAffairsItemSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  category: z.string().nullable(),
  is_up_specific: z.boolean(),
  title_i18n: bilingualTextSchema,
  summary_i18n: bilingualTextSchema.nullable(),
  detail_i18n: bilingualTextSchema.nullable(),
  source_urls: z.array(z.string()).nullable(),
  syllabus_node_ids: z.array(z.string().uuid()),
  mcq_question_ids: z.array(z.string().uuid()),
});
export type CurrentAffairsItem = z.infer<typeof currentAffairsItemSchema>;

export const currentAffairsQuerySchema = z.object({
  date: z.string().optional(),
  category: z.string().optional(),
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
