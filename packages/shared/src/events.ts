import { z } from "zod";
import { apiEnvelopeSchema } from "./types";

export const eventBodySchema = z.object({
  name: z.string().min(1).max(120),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type EventBody = z.infer<typeof eventBodySchema>;

export const eventResponseSchema = apiEnvelopeSchema(z.object({ id: z.string().uuid() }));
export type EventResponse = z.infer<typeof eventResponseSchema>;
