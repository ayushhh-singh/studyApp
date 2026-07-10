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

export const healthResponseSchema = apiEnvelopeSchema(
  z.object({
    ok: z.boolean(),
    /** Mentor FAQ-cache liveness (doubt_faq_cache table + match_doubt_faq RPC). */
    mentor_cache: z
      .object({ table_ok: z.boolean(), rpc_ok: z.boolean(), detail: z.string() })
      .optional(),
  }),
);
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const examStageSchema = z.enum(["prelims", "mains"]);
export type ExamStage = z.infer<typeof examStageSchema>;

/** Which exam a question came from. Orthogonal to paper_code (the UPPSC syllabus anchor). */
export const examCodeSchema = z.enum(["uppsc", "upsc", "up_ro_aro", "upsssc_pet", "other"]);
export type ExamCode = z.infer<typeof examCodeSchema>;

/** Provenance tier of the source a question was extracted from — the ingest audit trail. */
export const sourceKindSchema = z.enum(["official", "compilation", "generated", "manual"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

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
