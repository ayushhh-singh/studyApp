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
