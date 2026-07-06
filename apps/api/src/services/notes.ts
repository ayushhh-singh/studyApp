import { createHash } from "node:crypto";
import type {
  BilingualText,
  NoteContentI18n,
  NoteDetail,
  NoteSource,
  NoteSrsCandidate,
  ReviewNote,
  ReviewNoteEditBody,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";

/**
 * Drop a note's RAG chunks when it leaves `published` (rejected or regenerated),
 * so the vector store never serves stale/unpublished note text until
 * `notes:embed` re-adds it after re-publish. Best-effort — a failure here must
 * not fail the review action.
 */
export async function deleteNoteEmbeddings(noteId: string): Promise<void> {
  const { error } = await supabase()
    .from("embeddings")
    .delete()
    .eq("source_type", "note")
    .eq("source_id", noteId);
  if (error) logger.warn({ error, noteId }, "failed to delete note embeddings");
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------
const NOTE_DETAIL_COLUMNS =
  "id, syllabus_node_id, status, version, content_i18n, sources, srs_candidates, updated_at";

/** GET /notes/node/:nodeId — the PUBLISHED note for a topic, or null. */
export async function getNoteForNode(nodeId: string): Promise<NoteDetail | null> {
  const { data, error } = await supabase()
    .from("notes")
    .select(NOTE_DETAIL_COLUMNS)
    .eq("syllabus_node_id", nodeId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new HttpError(500, `note lookup failed: ${error.message}`);
  return (data as NoteDetail | null) ?? null;
}

// ---------------------------------------------------------------------------
// Deck + per-block "add to revision" (SRS)
// ---------------------------------------------------------------------------
const SRS_CARD_COLUMNS = "id, user_id, front_i18n, back_i18n, source_type, source_id";

/** Deterministic uuid-shaped source_id so re-adds are idempotent (see srs.ts). */
function noteSourceId(noteId: string, key: string): string {
  const h = createHash("sha256").update(`note:${noteId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

interface PublishedNoteForDeck {
  id: string;
  srs_candidates: NoteSrsCandidate[];
}

/** POST /notes/:id/deck — materialise ALL of a note's SRS candidates as cards. */
export async function addNoteDeckToRevision(
  userId: string,
  noteId: string,
): Promise<{ added: number; already: number }> {
  const { data: note, error } = await supabase()
    .from("notes")
    .select("id, srs_candidates")
    .eq("id", noteId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new HttpError(500, `note lookup failed: ${error.message}`);
  const row = note as unknown as PublishedNoteForDeck | null;
  if (!row) throw notFound("Note not found");
  const candidates = row.srs_candidates ?? [];
  if (candidates.length === 0) return { added: 0, already: 0 };

  const rows = candidates.map((c, i) => ({
    user_id: userId,
    front_i18n: c.front_i18n,
    back_i18n: c.back_i18n,
    source_type: "manual" as const,
    source_id: noteSourceId(noteId, `card:${i}`),
  }));
  const ids = rows.map((r) => r.source_id);

  const { data: existing } = await supabase()
    .from("srs_cards")
    .select("source_id")
    .eq("user_id", userId)
    .eq("source_type", "manual")
    .in("source_id", ids);
  const already = (existing ?? []).length;

  const { error: upErr } = await supabase()
    .from("srs_cards")
    .upsert(rows, { onConflict: "user_id,source_type,source_id" });
  if (upErr) throw new HttpError(500, `srs deck upsert failed: ${upErr.message}`);

  return { added: rows.length - already, already };
}

/** POST /notes/:id/revision — add ONE block/fact to revision (per-block button). */
export async function addNoteBlockToRevision(
  userId: string,
  noteId: string,
  body: { block: string; index: number; front_i18n: BilingualText; back_i18n: BilingualText },
): Promise<{ id: string; created: boolean }> {
  const { data: note, error } = await supabase()
    .from("notes")
    .select("id")
    .eq("id", noteId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new HttpError(500, `note lookup failed: ${error.message}`);
  if (!note) throw notFound("Note not found");

  const sourceId = noteSourceId(noteId, `${body.block}:${body.index}`);
  const { data: prior } = await supabase()
    .from("srs_cards")
    .select("id")
    .eq("user_id", userId)
    .eq("source_type", "manual")
    .eq("source_id", sourceId)
    .maybeSingle();

  const { data: card, error: upErr } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: body.front_i18n,
        back_i18n: body.back_i18n,
        source_type: "manual",
        source_id: sourceId,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (upErr) throw new HttpError(500, `srs card upsert failed: ${upErr.message}`);
  return { id: (card as { id: string }).id, created: !prior };
}

// ---------------------------------------------------------------------------
// Review Queue — Notes tab
// ---------------------------------------------------------------------------
export const NOTES_REVIEW_PAGE_SIZE = 5;

const REVIEW_NOTE_COLUMNS =
  "id, syllabus_node_id, status, version, content_i18n, sources, srs_candidates, meta, model, cost_usd, created_at, updated_at, syllabus_nodes(paper_code, title_i18n)";

function overviewComplete(content: NoteContentI18n | null): boolean {
  const hi = content?.hi?.overview?.trim();
  const en = content?.en?.overview?.trim();
  return !!hi && !!en;
}

interface ReviewNoteRow {
  id: string;
  syllabus_node_id: string;
  status: ReviewNote["status"];
  version: number;
  content_i18n: NoteContentI18n;
  sources: NoteSource[];
  srs_candidates: NoteSrsCandidate[];
  meta: ReviewNote["meta"];
  model: string | null;
  cost_usd: number;
  created_at: string;
  updated_at: string;
  syllabus_nodes: { paper_code: string; title_i18n: BilingualText } | { paper_code: string; title_i18n: BilingualText }[] | null;
}

function toReviewNote(r: ReviewNoteRow): ReviewNote {
  // PostgREST embeds the to-one join as an object or a single-element array.
  const sn = Array.isArray(r.syllabus_nodes) ? r.syllabus_nodes[0] : r.syllabus_nodes;
  return {
    id: r.id,
    syllabus_node_id: r.syllabus_node_id,
    paper_code: sn?.paper_code ?? null,
    syllabus_title_i18n: sn?.title_i18n ?? null,
    status: r.status,
    version: r.version,
    content_i18n: r.content_i18n,
    sources: r.sources ?? [],
    srs_candidates: r.srs_candidates ?? [],
    meta: r.meta ?? null,
    model: r.model,
    cost_usd: Number(r.cost_usd ?? 0),
    publish_gate_ok: overviewComplete(r.content_i18n),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listReviewNotes(page: number): Promise<{ items: ReviewNote[]; total: number }> {
  const from = (page - 1) * NOTES_REVIEW_PAGE_SIZE;
  const { data, count, error } = await supabase()
    .from("notes")
    .select(REVIEW_NOTE_COLUMNS, { count: "exact" })
    .eq("status", "needs_review")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + NOTES_REVIEW_PAGE_SIZE - 1);
  if (error) throw new HttpError(500, `note review list failed: ${error.message}`);
  return {
    items: ((data ?? []) as unknown as ReviewNoteRow[]).map(toReviewNote),
    total: count ?? 0,
  };
}

export async function reviewNotesCount(): Promise<number> {
  const { count, error } = await supabase()
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("status", "needs_review");
  if (error) throw new HttpError(500, `note review count failed: ${error.message}`);
  return count ?? 0;
}

async function loadNoteForAction(id: string): Promise<ReviewNoteRow> {
  const { data, error } = await supabase()
    // `meta` is needed so rejectNote can MERGE reject_reason into the existing
    // generation/critic audit blob instead of overwriting it with just the reason.
    .from("notes")
    .select("id, content_i18n, status, meta")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, `note lookup failed: ${error.message}`);
  if (!data) throw notFound("Note not found");
  return data as unknown as ReviewNoteRow;
}

export async function approveNote(id: string): Promise<{ id: string; status: ReviewNote["status"] }> {
  const note = await loadNoteForAction(id);
  if (!overviewComplete(note.content_i18n)) {
    throw badRequest("Cannot publish: the note is missing a Hindi or English overview");
  }
  const { error } = await supabase().from("notes").update({ status: "published" }).eq("id", id);
  if (error) throw new HttpError(500, `note publish failed: ${error.message}`);
  return { id, status: "published" };
}

export async function rejectNote(id: string, reason?: string): Promise<{ id: string; status: ReviewNote["status"] }> {
  const note = await loadNoteForAction(id);
  const { error } = await supabase()
    .from("notes")
    .update({ status: "draft", meta: { ...(note.meta ?? {}), reject_reason: reason ?? null } })
    .eq("id", id);
  if (error) throw new HttpError(500, `note reject failed: ${error.message}`);
  await deleteNoteEmbeddings(id); // unpublished → drop stale RAG chunks
  return { id, status: "draft" };
}

export async function editNote(id: string, body: ReviewNoteEditBody): Promise<{ id: string; status: ReviewNote["status"] }> {
  const patch: Record<string, unknown> = {};
  if (body.content_i18n) patch.content_i18n = body.content_i18n;
  if (body.sources) patch.sources = body.sources;
  if (body.srs_candidates) patch.srs_candidates = body.srs_candidates;
  if (Object.keys(patch).length > 0) {
    // A human edit bumps version, matching the column's contract (0038) and the
    // regeneration path in persistNote.
    const { data: cur } = await supabase().from("notes").select("version").eq("id", id).maybeSingle();
    patch.version = (((cur as { version: number } | null)?.version ?? 0) + 1) as number;
    const { error } = await supabase().from("notes").update(patch).eq("id", id);
    if (error) throw new HttpError(500, `note edit failed: ${error.message}`);
  }
  if (body.approve) return approveNote(id);
  const note = await loadNoteForAction(id);
  return { id, status: note.status };
}
