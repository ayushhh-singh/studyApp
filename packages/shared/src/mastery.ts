import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

/**
 * Mastery engine — the game-skin over honest SRS logic. Each syllabus node earns
 * a level (unseen -> bronze -> silver -> gold -> exam_ready) from a 0-100 score
 * computed as accuracy x volume x recency, where recency decays with a 30-day
 * half-life so an untouched Gold node fades back to Silver. See /docs/mastery.md.
 */
export const masteryLevelSchema = z.enum(["unseen", "bronze", "silver", "gold", "exam_ready"]);
export type MasteryLevel = z.infer<typeof masteryLevelSchema>;

/** One node in the Conquest Map: mastery + PYQ-weight so it can be rendered as territory. */
export const masteryNodeSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  title_i18n: bilingualTextSchema,
  depth: z.number().int(),
  path: z.string(),
  order_index: z.number().int(),
  /** Subtree PYQ count — the territory's size / exam weight. */
  pyq_count: z.number().int(),
  /** pyq_count as a share of the paper's total published PYQs (0-100). */
  weight_pct: z.number(),
  mastery_level: masteryLevelSchema,
  mastery_score: z.number(),
  /** Graded MCQs attributed to this node's subtree (drives the score). */
  attempted: z.number().int(),
  /** Weak (below Gold) AND high-weight — the "study this next" pulse on the map. */
  is_priority: z.boolean(),
});
export type MasteryNode = z.infer<typeof masteryNodeSchema>;

export const masteryMapSchema = z.object({
  paper_code: z.string().nullable(),
  total_pyq_count: z.number().int(),
  nodes: z.array(masteryNodeSchema),
});
export type MasteryMap = z.infer<typeof masteryMapSchema>;

export const masteryMapResponseSchema = apiEnvelopeSchema(masteryMapSchema);
export type MasteryMapResponse = z.infer<typeof masteryMapResponseSchema>;
