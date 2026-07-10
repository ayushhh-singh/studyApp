import { createHash } from "node:crypto";
import type {
  BilingualText,
  FactAudit,
  NoteContentI18n,
  NoteDetail,
  NoteSource,
  NoteSrsCandidate,
  ReviewNote,
  ReviewNoteEditBody,
  StudyContent,
} from "@prayasup/shared";
import { hasChapter, unresolvedFlagCount } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { canReadFullNote, paywall } from "./entitlements.js";

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
  "id, syllabus_node_id, status, version, content_i18n, study_content_i18n, chapter_version, fact_audit, sources, srs_candidates, updated_at";

const EMPTY_STUDY: StudyContent = { sections: [], toc: [], est_read_minutes: 0, word_count: 0 };

interface NoteDetailRow {
  id: string;
  syllabus_node_id: string;
  status: NoteDetail["status"];
  version: number;
  content_i18n: NoteContentI18n;
  study_content_i18n: StudyContent | null;
  chapter_version: number | null;
  fact_audit: FactAudit | null;
  sources: NoteSource[] | null;
  srs_candidates: NoteSrsCandidate[] | null;
  updated_at: string;
}

/**
 * GET /notes/node/:nodeId — the PUBLISHED note for a topic, or null.
 *
 * Entitlement: Free users read the full note only for the top-5 notes per paper
 * (by weightage). Any other note comes back `locked` with content trimmed to a
 * preview (the overview + the chapter's first section) plus an upgrade gate.
 */
export async function getNoteForNode(userId: string, nodeId: string): Promise<NoteDetail | null> {
  const { data, error } = await supabase()
    .from("notes")
    .select(NOTE_DETAIL_COLUMNS)
    .eq("syllabus_node_id", nodeId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new HttpError(500, `note lookup failed: ${error.message}`);
  const row = (data as NoteDetailRow | null) ?? null;
  if (!row) return null;

  const study = row.study_content_i18n ?? EMPTY_STUDY;
  const base: NoteDetail = {
    id: row.id,
    syllabus_node_id: row.syllabus_node_id,
    status: row.status,
    version: row.version,
    content_i18n: row.content_i18n,
    study_content_i18n: study,
    chapter_version: row.chapter_version ?? 0,
    fact_audit_ok: unresolvedFlagCount(row.fact_audit) === 0,
    sources: row.sources ?? [],
    srs_candidates: row.srs_candidates ?? [],
    updated_at: row.updated_at,
    locked: false,
  };

  if (await canReadFullNote(userId, nodeId)) return base;

  // Locked: overview only, plus a preview of the chapter's first section (body,
  // no boxes/diagram). Drop everything else + the SRS candidates.
  const emptyBody = (overview: string) => ({
    overview,
    key_facts: [],
    up_angle: "",
    pyq_analysis: "",
    mnemonics: [],
    quick_revision: [],
    further_reading: [],
  });
  const trimmedContent: NoteContentI18n = {
    hi: emptyBody(row.content_i18n?.hi?.overview ?? ""),
    en: emptyBody(row.content_i18n?.en?.overview ?? ""),
  };
  const firstSection = study.sections[0];
  const trimmedStudy: StudyContent = firstSection
    ? {
        sections: [{ ...firstSection, boxes: [], diagram: null, pyq_ids: [] }],
        toc: study.toc.slice(0, 1),
        est_read_minutes: study.est_read_minutes,
        word_count: study.word_count,
      }
    : EMPTY_STUDY;

  return {
    ...base,
    content_i18n: trimmedContent,
    study_content_i18n: trimmedStudy,
    sources: [],
    srs_candidates: [],
    locked: true,
  };
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
    .select("id, syllabus_node_id, srs_candidates")
    .eq("id", noteId)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new HttpError(500, `note lookup failed: ${error.message}`);
  const row = note as unknown as (PublishedNoteForDeck & { syllabus_node_id: string }) | null;
  if (!row) throw notFound("Note not found");
  // Gate: the note reader trims a locked note to its overview, so its SRS
  // candidates must not be harvestable by calling this endpoint directly.
  if (!(await canReadFullNote(userId, row.syllabus_node_id))) {
    throw paywall("all_notes", "This note is a Pro topic. Upgrade to add its revision deck.");
  }
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
  "id, syllabus_node_id, status, version, content_i18n, study_content_i18n, chapter_version, fact_audit, sources, srs_candidates, meta, model, cost_usd, created_at, updated_at, syllabus_nodes(paper_code, title_i18n)";

const EMPTY_FACT_AUDIT: FactAudit = { facts: [], summary: { verified: 0, flagged: 0, unverifiable: 0 }, audited_at: null, model: null };

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
  study_content_i18n: StudyContent | null;
  chapter_version: number | null;
  fact_audit: FactAudit | null;
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
  const study = r.study_content_i18n ?? { sections: [], toc: [], est_read_minutes: 0, word_count: 0 };
  const factAudit = r.fact_audit ?? EMPTY_FACT_AUDIT;
  return {
    id: r.id,
    syllabus_node_id: r.syllabus_node_id,
    paper_code: sn?.paper_code ?? null,
    syllabus_title_i18n: sn?.title_i18n ?? null,
    status: r.status,
    version: r.version,
    content_i18n: r.content_i18n,
    study_content_i18n: study,
    chapter_version: r.chapter_version ?? 0,
    fact_audit: factAudit,
    sources: r.sources ?? [],
    srs_candidates: r.srs_candidates ?? [],
    meta: r.meta ?? null,
    model: r.model,
    cost_usd: Number(r.cost_usd ?? 0),
    publish_gate_ok: overviewComplete(r.content_i18n),
    unresolved_flags: unresolvedFlagCount(factAudit),
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
    // study_content_i18n + fact_audit drive the chapter publish gate.
    .from("notes")
    .select("id, content_i18n, study_content_i18n, fact_audit, status, meta")
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
  // Chapter gate: a chapter with ANY unresolved flagged/unverifiable decisive fact
  // cannot publish (Session 28). Resolve or fix the flagged facts first.
  if (hasChapter(note.study_content_i18n)) {
    const unresolved = unresolvedFlagCount(note.fact_audit);
    if (unresolved > 0) {
      throw badRequest(
        `Cannot publish: ${unresolved} decisive fact(s) are still flagged/unverifiable. Resolve them in the fact-audit panel first.`,
      );
    }
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
  if (body.study_content_i18n) patch.study_content_i18n = body.study_content_i18n;
  if (body.fact_audit) patch.fact_audit = body.fact_audit;
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
