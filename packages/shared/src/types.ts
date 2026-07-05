import { z } from "zod";

export const bilingualTextSchema = z.object({
  hi: z.string(),
  en: z.string(),
});
export type BilingualText = z.infer<typeof bilingualTextSchema>;

export const apiEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema.nullable(),
    error: z.string().nullable(),
  });

export const healthResponseSchema = apiEnvelopeSchema(z.object({ ok: z.boolean() }));
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const examStageSchema = z.enum(["prelims", "mains"]);
export type ExamStage = z.infer<typeof examStageSchema>;

export const localeSchema = z.enum(["hi", "en"]);
export type Locale = z.infer<typeof localeSchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  page_size: z.number().int(),
  total: z.number().int(),
  total_pages: z.number().int(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const paginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    pagination: paginationMetaSchema,
  });
