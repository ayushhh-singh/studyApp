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

// ---------------------------------------------------------------------------
// Study CHAPTER (Session 28) — study_content_i18n. The long-form, section-based
// study material that upgrades a digest note into a genuine chapter. The compact
// NoteBody above stays UNTOUCHED as the Quick Revision layer; this is the Study
// layer. Every leaf text field is bilingual {hi,en}; markdown bodies render in
// the reader (tables + mermaid diagrams). A note is a "chapter" iff
// study_content_i18n.sections is non-empty (chapter_version > 0).
// ---------------------------------------------------------------------------

/** In-chapter highlight box. `data_table` / diagram tables render markdown; pyq_inline links real bank questions. */
export const chapterBoxKindSchema = z.enum([
  "prelims_facts",
  "mains_angle",
  "case_study",
  "data_table",
  "up_special",
  "pyq_inline",
]);
export type ChapterBoxKind = z.infer<typeof chapterBoxKindSchema>;

export const chapterBoxSchema = z.object({
  kind: chapterBoxKindSchema,
  content_i18n: bilingualTextSchema, // markdown
  /** For pyq_inline boxes: real bank question ids rendered as id-linked chips. */
  pyq_ids: z.array(z.string().uuid()).default([]),
});
export type ChapterBox = z.infer<typeof chapterBoxSchema>;

/** A structural/processual diagram — mermaid source, or a markdown table. Labels localized. */
export const chapterDiagramSchema = z.object({
  kind: z.enum(["mermaid", "table"]),
  source_i18n: bilingualTextSchema,
  caption_i18n: bilingualTextSchema.nullable().default(null),
});
export type ChapterDiagram = z.infer<typeof chapterDiagramSchema>;

export const chapterSectionSchema = z.object({
  id: z.string(),
  heading_i18n: bilingualTextSchema,
  /** Markdown (paragraphs, bullets, **bold**, tables). Rendered by the reader. */
  body_md_i18n: bilingualTextSchema,
  boxes: z.array(chapterBoxSchema).default([]),
  diagram: chapterDiagramSchema.nullable().default(null),
  /** Real bank question ids referenced inline in this section (id-linked chips). */
  pyq_ids: z.array(z.string().uuid()).default([]),
});
export type ChapterSection = z.infer<typeof chapterSectionSchema>;

export const chapterTocEntrySchema = z.object({
  id: z.string(),
  heading_i18n: bilingualTextSchema,
});
export type ChapterTocEntry = z.infer<typeof chapterTocEntrySchema>;

export const studyContentSchema = z.object({
  sections: z.array(chapterSectionSchema).default([]),
  toc: z.array(chapterTocEntrySchema).default([]),
  est_read_minutes: z.number().int().default(0),
  word_count: z.number().int().default(0),
});
export type StudyContent = z.infer<typeof studyContentSchema>;

/** True iff this study-content payload is a real chapter (has sections). */
export function hasChapter(sc: StudyContent | null | undefined): boolean {
  return !!sc && Array.isArray(sc.sections) && sc.sections.length > 0;
}

// ---------------------------------------------------------------------------
// Fact audit (Session 27 pattern) — every decisive fact verified.
// ---------------------------------------------------------------------------
export const factAuditStatusSchema = z.enum(["verified", "flagged", "unverifiable"]);
export type FactAuditStatus = z.infer<typeof factAuditStatusSchema>;

export const auditedFactSchema = z.object({
  id: z.string(),
  section_id: z.string(),
  /** The decisive claim (article, date, name, number) — English canonical. */
  claim: z.string(),
  status: factAuditStatusSchema,
  /** Resolves into `sources[].id`, or null when grounded in our own bank. */
  source_ref: z.string().nullable(),
  /** How it was verified, or why it was flagged. */
  evidence: z.string().default(""),
  /** A reviewer's explicit "I checked/fixed this" — clears a flag for the publish gate. */
  resolved: z.boolean().default(false),
});
export type AuditedFact = z.infer<typeof auditedFactSchema>;

export const factAuditSummarySchema = z.object({
  verified: z.number().int().default(0),
  flagged: z.number().int().default(0),
  unverifiable: z.number().int().default(0),
});
export type FactAuditSummary = z.infer<typeof factAuditSummarySchema>;

export const factAuditSchema = z.object({
  facts: z.array(auditedFactSchema).default([]),
  summary: factAuditSummarySchema.default({ verified: 0, flagged: 0, unverifiable: 0 }),
  audited_at: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
});
export type FactAudit = z.infer<typeof factAuditSchema>;

/**
 * A decisive fact BLOCKS publish iff it is flagged/unverifiable AND not resolved.
 * The chapter publish gate (services/notes.ts approveNote) requires this to be 0.
 */
export function unresolvedFlagCount(fa: FactAudit | null | undefined): number {
  if (!fa || !Array.isArray(fa.facts)) return 0;
  return fa.facts.filter((f) => f.status !== "verified" && !f.resolved).length;
}

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
  /** The Study layer (Session 28); empty (no sections) for digest-only notes. */
  study_content_i18n: studyContentSchema.default({ sections: [], toc: [], est_read_minutes: 0, word_count: 0 }),
  chapter_version: z.number().int().default(0),
  /** True when every decisive fact passed the audit (no unresolved flags). Shown as a "verified" badge. */
  fact_audit_ok: z.boolean().default(true),
  sources: z.array(noteSourceSchema),
  srs_candidates: z.array(noteSrsCandidateSchema),
  updated_at: z.string(),
  /**
   * True when the reader is a Free user and this note is outside the free
   * top-5-per-paper allowance: content is trimmed to the overview/first section
   * only, and the UI shows an upgrade gate below the preview.
   */
  locked: z.boolean().default(false),
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
    // Null when the critic pass failed/was skipped (e.g. a mid-run API error);
    // the note still persists with meta.critic = null, so accept it.
    critic: noteCriticVerdictSchema.nullable().optional(),
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
  /** The Study chapter under review (Session 28); empty for a digest-only note. */
  study_content_i18n: studyContentSchema.default({ sections: [], toc: [], est_read_minutes: 0, word_count: 0 }),
  chapter_version: z.number().int().default(0),
  /** The full fact-audit report — reviewed section-by-section; unresolved flags block publish. */
  fact_audit: factAuditSchema.default({ facts: [], summary: { verified: 0, flagged: 0, unverifiable: 0 }, audited_at: null, model: null }),
  sources: z.array(noteSourceSchema),
  srs_candidates: z.array(noteSrsCandidateSchema),
  meta: noteGenerationMetaSchema.nullable(),
  model: z.string().nullable(),
  cost_usd: z.number(),
  /** Whether the bilingual overview gate passes (drives the publishable badge). */
  publish_gate_ok: z.boolean(),
  /** Count of decisive facts still flagged/unverifiable AND unresolved — a chapter can't publish while > 0. */
  unresolved_flags: z.number().int().default(0),
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
  /** Section-level chapter edits (full replacement of the sections/toc payload). */
  study_content_i18n: studyContentSchema.optional(),
  /** Reviewer edits to the fact-audit (flip a fact's status, mark resolved). */
  fact_audit: factAuditSchema.optional(),
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
