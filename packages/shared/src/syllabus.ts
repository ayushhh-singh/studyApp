import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, examStageSchema } from "./types";

export interface SyllabusNode {
  id: string;
  exam_stage: z.infer<typeof examStageSchema>;
  paper_code: string;
  title_i18n: z.infer<typeof bilingualTextSchema>;
  description_i18n: z.infer<typeof bilingualTextSchema> | null;
  order_index: number;
  depth: number;
  path: string;
  children: SyllabusNode[];
}

export const syllabusNodeSchema: z.ZodType<SyllabusNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    exam_stage: examStageSchema,
    paper_code: z.string(),
    title_i18n: bilingualTextSchema,
    description_i18n: bilingualTextSchema.nullable(),
    order_index: z.number().int(),
    depth: z.number().int(),
    path: z.string(),
    children: z.array(syllabusNodeSchema),
  }),
);

export const syllabusTreeQuerySchema = z.object({
  stage: examStageSchema.optional(),
});
export type SyllabusTreeQuery = z.infer<typeof syllabusTreeQuerySchema>;

export const syllabusTreeResponseSchema = apiEnvelopeSchema(z.array(syllabusNodeSchema));
export type SyllabusTreeResponse = z.infer<typeof syllabusTreeResponseSchema>;
