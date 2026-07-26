import { z } from "zod";
import { apiEnvelopeSchema, examCodeSchema } from "./types";
import { difficultySchema } from "./questions";
import { testDetailSchema } from "./tests";

/**
 * "Show me a new set" — a SELECTION action against the demand-aware reserve
 * (qgen/topup.ts), never a live synchronous generation call. The server builds
 * a fresh set instantly from already-published+approved questions the user
 * hasn't recently seen (PYQ + generated reserve + overlapping current affairs),
 * or — when the reserve genuinely can't fill the scope yet — returns `preparing`
 * and feeds the request into tonight's top-up. Both are instant; neither waits
 * on a model.
 */
export const freshSetKindSchema = z.enum(["mcq", "descriptive"]);
export type FreshSetKind = z.infer<typeof freshSetKindSchema>;

/** Custom fresh set — the same topic selection the "build from question bank" builder uses. */
export const createFreshCustomSetBodySchema = z.object({
  node_ids: z.array(z.string().uuid()).min(1).max(10),
  count: z.number().int().min(1).max(100).default(20),
  kind: freshSetKindSchema,
  /** Omit to mix all exams mapped to the topic; pass one to scope to a single exam (MCQ only). */
  exam: examCodeSchema.optional(),
  /** MCQ only. */
  difficulty: difficultySchema.optional(),
});
export type CreateFreshCustomSetBody = z.infer<typeof createFreshCustomSetBodySchema>;

/** Mock fresh set — a fresh full-length UPPSC-pattern paper for one paper code. */
export const createFreshMockSetBodySchema = z.object({
  paper_code: z.string().min(1),
});
export type CreateFreshMockSetBody = z.infer<typeof createFreshMockSetBodySchema>;

/**
 * Either a ready-to-take fresh test, or an honest "we're preparing more" when
 * the reserve can't fill this scope yet (the request has been logged so tonight's
 * top-up generates for it).
 */
export const freshSetResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), test: testDetailSchema }),
  z.object({
    status: z.literal("preparing"),
    requested_count: z.number().int(),
    available_count: z.number().int(),
  }),
]);
export type FreshSetResult = z.infer<typeof freshSetResultSchema>;

export const freshSetResponseSchema = apiEnvelopeSchema(freshSetResultSchema);
export type FreshSetResponse = z.infer<typeof freshSetResponseSchema>;
