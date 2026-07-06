import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, localeSchema } from "./types";

/**
 * Study-notes contract (migration 0038). A note is AI-generated, grounded,
 * bilingual study material for ONE syllabus node — our own words, with every
 * externally-sourced fact carrying a source_ref that resolves into `sources`.
 *
 * The block set is fixed (not free-form) so the reader UI, the generation
 * prompt, and the Review Queue editor never drift apart.
 */

export const noteStatusSchema = z.enum(["draft", "needs_review", "published"]);
export type NoteStatus = z.infer<typeof noteStatusSchema>;

/** A single cited fact. source_ref matches a `sources[].id`, or null if grounded in our own bank. */
export const noteKeyFactSchema = z.object({
  fact: z.string(),
  source_ref: z.string().nullable(),
});
export type NoteKeyFact = z.infer<typeof noteKeyFactSchema>;

export const noteFurtherReadingSchema = z.object({
  title: z.string(),
  url: z.string(),
});
export type NoteFurtherReading = z.infer<typeof noteFurtherReadingSchema>;

/** The per-language note body — the fixed block set. */
export const noteBodySchema = z.object({
  overview: z.string(),
  key_facts: z.array(noteKeyFactSchema),
  up_angle: z.string(),
  pyq_analysis: z.string(),
  mnemonics: z.array(z.string()),
  quick_revision: z.array(z.string()),
  further_reading: z.array(noteFurtherReadingSchema),
});
export type NoteBody = z.infer<typeof noteBodySchema>;

export const noteContentI18nSchema = z.object({
  hi: noteBodySchema,
  en: noteBodySchema,
});
export type NoteContentI18n = z.infer<typeof noteContentI18nSchema>;

/** A source used during generation — resolves a fact's source_ref to a link-out. */
export const noteSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
});
export type NoteSource = z.infer<typeof noteSourceSchema>;

/** A stored SRS-card candidate derived from a key fact — offered, never auto-added. */
export const noteSrsCandidateSchema = z.object({
  front_i18n: bilingualTextSchema,
  back_i18n: bilingualTextSchema,
});
export type NoteSrsCandidate = z.infer<typeof noteSrsCandidateSchema>;

/**
 * GET /notes/node/:nodeId — the published note for the reader. Null when the
 * node has no published note yet (the Notes tab then shows an empty state).
 */
export const noteDetailSchema = z.object({
  id: z.string().uuid(),
  syllabus_node_id: z.string().uuid(),
  status: noteStatusSchema,
  version: z.number().int(),
  content_i18n: noteContentI18nSchema,
  sources: z.array(noteSourceSchema),
  srs_candidates: z.array(noteSrsCandidateSchema),
  updated_at: z.string(),
});
export type NoteDetail = z.infer<typeof noteDetailSchema>;

export const noteDetailResponseSchema = apiEnvelopeSchema(noteDetailSchema.nullable());
export type NoteDetailResponse = z.infer<typeof noteDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Reading-progress + deck actions
// ---------------------------------------------------------------------------

/** POST /notes/:id/deck — materialise this note's SRS candidates into srs_cards. */
export const noteDeckResponseSchema = apiEnvelopeSchema(
  z.object({ added: z.number().int(), already: z.number().int() }),
);
export type NoteDeckResponse = z.infer<typeof noteDeckResponseSchema>;

/** POST /notes/:id/revision — add ONE block/fact to revision (per-block "add to revision"). */
export const noteRevisionBodySchema = z.object({
  /** Which block the snippet came from, for the card front label. */
  block: z.enum(["overview", "key_fact", "up_angle", "pyq_analysis", "quick_revision", "mnemonic"]),
  /** Stable index within the block (e.g. the key_fact index) so repeat clicks are idempotent. */
  index: z.number().int().min(0).default(0),
  front_i18n: bilingualTextSchema,
  back_i18n: bilingualTextSchema,
});
export type NoteRevisionBody = z.infer<typeof noteRevisionBodySchema>;

export const noteRevisionResponseSchema = apiEnvelopeSchema(
  z.object({ id: z.string().uuid(), created: z.boolean() }),
);
export type NoteRevisionResponse = z.infer<typeof noteRevisionResponseSchema>;

// ---------------------------------------------------------------------------
// Review Queue — Notes tab
// ---------------------------------------------------------------------------

/** The critic (factual red-flags + syllabus-drift) verdict recorded per note. */
export const noteCriticVerdictSchema = z.object({
  approve: z.boolean(),
  factual_red_flags: z.array(z.string()),
  syllabus_drift: z.boolean(),
  notes: z.string(),
});
export type NoteCriticVerdict = z.infer<typeof noteCriticVerdictSchema>;

export const noteGenerationMetaSchema = z
  .object({
    model: z.string().optional(),
    prompt_version: z.string().optional(),
    web_search_used: z.boolean().optional(),
    machine_translated: z.boolean().optional(),
    critic: noteCriticVerdictSchema.optional(),
    weightage_snapshot: z
      .object({ total_pyqs: z.number(), top_years: z.array(z.number()) })
      .partial()
      .optional(),
    source_context_ids: z.array(z.string()).optional(),
  })
  .passthrough();
export type NoteGenerationMeta = z.infer<typeof noteGenerationMetaSchema>;

/** One card in the Review Queue's Notes tab. */
export const reviewNoteSchema = z.object({
  id: z.string().uuid(),
  syllabus_node_id: z.string().uuid(),
  paper_code: z.string().nullable(),
  syllabus_title_i18n: bilingualTextSchema.nullable(),
  status: noteStatusSchema,
  version: z.number().int(),
  content_i18n: noteContentI18nSchema,
  sources: z.array(noteSourceSchema),
  srs_candidates: z.array(noteSrsCandidateSchema),
  meta: noteGenerationMetaSchema.nullable(),
  model: z.string().nullable(),
  cost_usd: z.number(),
  /** Whether the bilingual overview gate passes (drives the publishable badge). */
  publish_gate_ok: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ReviewNote = z.infer<typeof reviewNoteSchema>;

export const reviewNotesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});
export type ReviewNotesQuery = z.infer<typeof reviewNotesQuerySchema>;

export const reviewNotesResponseSchema = apiEnvelopeSchema(
  z.object({
    items: z.array(reviewNoteSchema),
    pagination: z.object({
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int(),
      total_pages: z.number().int(),
    }),
  }),
);
export type ReviewNotesResponse = z.infer<typeof reviewNotesResponseSchema>;

/**
 * Edit-then-approve for a note. content_i18n / sources / srs_candidates are
 * full replacements (the block editor sends the whole edited body); `approve`
 * transitions the note to `published` iff the bilingual overview gate passes.
 */
export const reviewNoteEditBodySchema = z.object({
  content_i18n: noteContentI18nSchema.optional(),
  sources: z.array(noteSourceSchema).optional(),
  srs_candidates: z.array(noteSrsCandidateSchema).optional(),
  approve: z.boolean().optional(),
});
export type ReviewNoteEditBody = z.infer<typeof reviewNoteEditBodySchema>;

export const reviewNoteRejectBodySchema = z.object({ reason: z.string().max(500).optional() });
export type ReviewNoteRejectBody = z.infer<typeof reviewNoteRejectBodySchema>;

export const reviewNoteActionResultSchema = z.object({
  id: z.string().uuid(),
  status: noteStatusSchema,
});
export type ReviewNoteActionResult = z.infer<typeof reviewNoteActionResultSchema>;

export const reviewNoteActionResponseSchema = apiEnvelopeSchema(reviewNoteActionResultSchema);
export type ReviewNoteActionResponse = z.infer<typeof reviewNoteActionResponseSchema>;

// Re-export for convenience where a caller only needs the locale union.
export { localeSchema };
