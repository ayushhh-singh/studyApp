import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, examStageSchema } from "./types";
import { currentAffairsItemSchema } from "./current-affairs";

export const paperSummarySchema = z.object({
  paper_code: z.string(),
  exam_stage: examStageSchema,
  title_i18n: bilingualTextSchema,
  topics_count: z.number().int(),
  pyq_count: z.number().int(),
  accuracy_pct: z.number().nullable(),
  answered_count: z.number().int(),
});
export type PaperSummary = z.infer<typeof paperSummarySchema>;

export const papersResponseSchema = apiEnvelopeSchema(z.array(paperSummarySchema));
export type PapersResponse = z.infer<typeof papersResponseSchema>;

export interface SyllabusNodeWithStats {
  id: string;
  exam_stage: z.infer<typeof examStageSchema>;
  paper_code: string;
  title_i18n: z.infer<typeof bilingualTextSchema>;
  description_i18n: z.infer<typeof bilingualTextSchema> | null;
  order_index: number;
  depth: number;
  path: string;
  /** PYQs mapped exactly to this node (not descendants) — matches the /questions?node= filter 1:1. */
  own_pyq_count: number;
  /** PYQs mapped to this node OR any descendant — always >= own_pyq_count. */
  pyq_count: number;
  accuracy_pct: number | null;
  answered_count: number;
  children: SyllabusNodeWithStats[];
}

export const syllabusNodeWithStatsSchema: z.ZodType<SyllabusNodeWithStats> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    exam_stage: examStageSchema,
    paper_code: z.string(),
    title_i18n: bilingualTextSchema,
    description_i18n: bilingualTextSchema.nullable(),
    order_index: z.number().int(),
    depth: z.number().int(),
    path: z.string(),
    own_pyq_count: z.number().int(),
    pyq_count: z.number().int(),
    accuracy_pct: z.number().nullable(),
    answered_count: z.number().int(),
    children: z.array(syllabusNodeWithStatsSchema),
  }),
);

export const paperTreeResponseSchema = apiEnvelopeSchema(syllabusNodeWithStatsSchema);
export type PaperTreeResponse = z.infer<typeof paperTreeResponseSchema>;

export const syllabusBreadcrumbItemSchema = z.object({
  id: z.string().uuid(),
  title_i18n: bilingualTextSchema,
  path: z.string(),
});
export type SyllabusBreadcrumbItem = z.infer<typeof syllabusBreadcrumbItemSchema>;

export const syllabusNodeDetailSchema = z.object({
  id: z.string().uuid(),
  exam_stage: examStageSchema,
  paper_code: z.string(),
  title_i18n: bilingualTextSchema,
  description_i18n: bilingualTextSchema.nullable(),
  breadcrumb: z.array(syllabusBreadcrumbItemSchema),
  pyq_count: z.number().int(),
  accuracy_pct: z.number().nullable(),
  answered_count: z.number().int(),
  related_current_affairs: z.array(currentAffairsItemSchema),
});
export type SyllabusNodeDetail = z.infer<typeof syllabusNodeDetailSchema>;

export const syllabusNodeDetailResponseSchema = apiEnvelopeSchema(syllabusNodeDetailSchema);
export type SyllabusNodeDetailResponse = z.infer<typeof syllabusNodeDetailResponseSchema>;
