import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema, localeSchema } from "./types";
import { noteContentI18nSchema, noteSourceSchema, noteSrsCandidateSchema } from "./notes";

/**
 * "My notes" — personal study material a user saved from an AI-Mentor answer
 * (migration 0066, table user_notes). Same fixed block structure as an official
 * `notes` row (content_i18n: {hi,en} NoteBody) so the SAME reader renders both,
 * but private to one user: no review queue, no publish gate, never shown to
 * anyone else. `content_i18n` is generated in the user's current locale; the
 * other locale's body may be empty until an on-demand "translate" action fills
 * it — `filled_locales` says which sides actually have content.
 */

/** The full personal note (reader). */
export const userNoteSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  syllabus_node_id: z.string().uuid().nullable(),
  /** For deep-linking the node chip when linked. */
  syllabus_paper_code: z.string().nullable(),
  syllabus_title_i18n: bilingualTextSchema.nullable(),
  source_thread_id: z.string().uuid().nullable(),
  source_message_id: z.string().uuid().nullable(),
  content_i18n: noteContentI18nSchema,
  /** External sources a fact's source_ref resolves to (carried from the mentor answer). */
  sources: z.array(noteSourceSchema),
  srs_candidates: z.array(noteSrsCandidateSchema),
  /** Which locales' bodies are populated (overview non-empty). */
  filled_locales: z.array(localeSchema),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UserNote = z.infer<typeof userNoteSchema>;

/** A lighter row for the "My notes" lists (profile + per-node group). */
export const userNoteListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  syllabus_node_id: z.string().uuid().nullable(),
  syllabus_paper_code: z.string().nullable(),
  syllabus_title_i18n: bilingualTextSchema.nullable(),
  filled_locales: z.array(localeSchema),
  created_at: z.string(),
});
export type UserNoteListItem = z.infer<typeof userNoteListItemSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
/** POST /user-notes — convert a mentor answer into a personal note. */
export const saveMentorNoteBodySchema = z.object({
  message_id: z.string().uuid(),
  /**
   * The node to link. Omit → the server infers it (from the message's teacher
   * meta or its thread's page context). Send null to link no node.
   */
  node_id: z.string().uuid().nullable().optional(),
});
export type SaveMentorNoteBody = z.infer<typeof saveMentorNoteBodySchema>;

/** PATCH /user-notes/:id — edit the node link / title after saving. */
export const updateUserNoteBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  syllabus_node_id: z.string().uuid().nullable().optional(),
});
export type UpdateUserNoteBody = z.infer<typeof updateUserNoteBodySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
export const userNoteResponseSchema = apiEnvelopeSchema(userNoteSchema);
export const userNoteListResponseSchema = apiEnvelopeSchema(
  z.object({ items: z.array(userNoteListItemSchema) }),
);
