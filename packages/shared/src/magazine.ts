import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";
import { currentAffairsCategorySchema, currentAffairsItemSchema } from "./current-affairs";
import { questionOptionSchema } from "./questions";

/**
 * Monthly Current-Affairs magazine (pnpm ca:compile --month YYYY-MM). Assembles
 * a month's PUBLISHED current-affairs items into a structured bilingual document,
 * rendered at the print-styled route /:locale/magazine/:month. Doubles as a
 * marketing artifact — hence the cover copy + a working print-to-PDF path.
 *
 * The document is COMPUTED on demand from the live tables (no new table); this
 * module is just the response shape the route/hook consume.
 */

/** "YYYY-MM" — the calendar month (IST) the magazine covers. */
export const magazineMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM");
export type MagazineMonth = z.infer<typeof magazineMonthSchema>;

/** A category section of the magazine (UP-specific items are pulled into their own lead section first). */
export const magazineSectionSchema = z.object({
  category: currentAffairsCategorySchema,
  items: z.array(currentAffairsItemSchema),
});
export type MagazineSection = z.infer<typeof magazineSectionSchema>;

/** A compact MCQ for the quiz appendix (bilingual stem + options + answer). */
export const magazineMcqSchema = z.object({
  id: z.string().uuid(),
  stem_i18n: bilingualTextSchema,
  options_i18n: z.array(questionOptionSchema),
  correct_option_key: z.string().nullable(),
  explanation_i18n: bilingualTextSchema.nullable(),
});
export type MagazineMcq = z.infer<typeof magazineMcqSchema>;

export const magazineSchema = z.object({
  month: magazineMonthSchema,
  /** Human month label per locale, e.g. { en: "July 2026", hi: "जुलाई 2026" }. */
  title_i18n: bilingualTextSchema,
  total_items: z.number().int(),
  up_item_count: z.number().int(),
  /** UP-specific items, foregrounded as the lead section. */
  up_section: z.array(currentAffairsItemSchema),
  /** The remaining items grouped by category (category order is stable). */
  sections: z.array(magazineSectionSchema),
  /** Linked MCQs from this month's "important" items, as a practice appendix. */
  mcq_appendix: z.array(magazineMcqSchema),
});
export type Magazine = z.infer<typeof magazineSchema>;

export const magazineResponseSchema = apiEnvelopeSchema(magazineSchema.nullable());
export type MagazineResponse = z.infer<typeof magazineResponseSchema>;

/** GET /magazine — the list of months that have any published CA (for an index/picker). */
export const magazineMonthSummarySchema = z.object({
  month: magazineMonthSchema,
  title_i18n: bilingualTextSchema,
  item_count: z.number().int(),
});
export type MagazineMonthSummary = z.infer<typeof magazineMonthSummarySchema>;

export const magazineMonthsResponseSchema = apiEnvelopeSchema(
  z.array(magazineMonthSummarySchema),
);
export type MagazineMonthsResponse = z.infer<typeof magazineMonthsResponseSchema>;
