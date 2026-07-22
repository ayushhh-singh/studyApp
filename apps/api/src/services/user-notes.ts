/**
 * "My notes" — personal study material a user distils from an AI-Mentor answer
 * (table user_notes, migration 0066). One structured claude-haiku-4-5 call maps
 * the answer's prose into the SAME fixed block structure as an official note
 * (overview / key_facts / mnemonics / quick_revision), generated in the user's
 * current locale; the other locale stays empty until an on-demand translate.
 *
 * These are private: every read/write is scoped by currentUserId() and the row
 * is owner-only under RLS. No review queue, no publish gate.
 */
import { createHash } from "node:crypto";
import type {
  BilingualText,
  Locale,
  NoteBody,
  NoteContentI18n,
  NoteSource,
  NoteSrsCandidate,
  UserNote,
  UserNoteListItem,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { MODELS, structuredJson, translateBatch } from "../lib/anthropic.js";
import { embedQuery, retrieveContext } from "./mentor/retrieval.js";

const EMPTY_BODY: NoteBody = {
  overview: "",
  key_facts: [],
  up_angle: "",
  pyq_analysis: "",
  mnemonics: [],
  quick_revision: [],
  further_reading: [],
};

function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "hi" : "en";
}

/** Deterministic uuid-shaped source_id so re-adding a note's deck is idempotent. */
function userNoteSourceId(noteId: string, key: string): string {
  const h = createHash("sha256").update(`user_note:${noteId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Row → API mapping
// ---------------------------------------------------------------------------
interface UserNoteRow {
  id: string;
  title: string;
  syllabus_node_id: string | null;
  source_thread_id: string | null;
  source_message_id: string | null;
  content_i18n: NoteContentI18n;
  srs_candidates: NoteSrsCandidate[];
  meta: { sources?: NoteSource[] } | null;
  created_at: string;
  updated_at: string;
  syllabus_nodes?: { paper_code: string; title_i18n: BilingualText } | { paper_code: string; title_i18n: BilingualText }[] | null;
}

function filledLocales(content: NoteContentI18n): Locale[] {
  const out: Locale[] = [];
  if (content?.en?.overview?.trim()) out.push("en");
  if (content?.hi?.overview?.trim()) out.push("hi");
  return out;
}

function toUserNote(r: UserNoteRow): UserNote {
  const sn = Array.isArray(r.syllabus_nodes) ? r.syllabus_nodes[0] : r.syllabus_nodes;
  return {
    id: r.id,
    title: r.title,
    syllabus_node_id: r.syllabus_node_id,
    syllabus_paper_code: sn?.paper_code ?? null,
    syllabus_title_i18n: sn?.title_i18n ?? null,
    source_thread_id: r.source_thread_id,
    source_message_id: r.source_message_id,
    content_i18n: r.content_i18n,
    sources: r.meta?.sources ?? [],
    srs_candidates: r.srs_candidates ?? [],
    filled_locales: filledLocales(r.content_i18n),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const DETAIL_COLUMNS =
  "id, title, syllabus_node_id, source_thread_id, source_message_id, content_i18n, srs_candidates, meta, created_at, updated_at, syllabus_nodes(paper_code, title_i18n)";
const LIST_COLUMNS =
  "id, title, syllabus_node_id, content_i18n, created_at, syllabus_nodes(paper_code, title_i18n)";

// ---------------------------------------------------------------------------
// Conversion — mentor answer → note blocks (one structured call)
// ---------------------------------------------------------------------------
interface ConvertResult {
  title: string;
  overview: string;
  key_facts: { fact: string; source_ref: string | null }[];
  mnemonics: string[];
  quick_revision: string[];
  cards: { front: string; back: string }[];
}

async function convertAnswerToBody(
  userId: string,
  answer: string,
  locale: Locale,
  sources: NoteSource[],
): Promise<{ body: NoteBody; title: string; cards: { front: string; back: string }[] }> {
  const lang = locale === "hi" ? "Hindi (Devanagari)" : "English";
  const sourceLines = sources.length
    ? sources.map((s) => `${s.id}: ${s.title}`).join("\n")
    : "(none)";

  const out = await structuredJson<ConvertResult>({
    model: MODELS.haiku,
    purpose: "user_note_convert",
    userId,
    system:
      `You convert a mentor's answer into concise, well-structured personal STUDY NOTES for a UPPSC aspirant, in ${lang}. ` +
      "Restructure and tighten the content into clean study material — do not just copy the answer. Fill:\n" +
      "- title: a short 3-8 word topic title.\n" +
      "- overview: a 2-4 sentence plain-language summary of the core idea.\n" +
      "- key_facts: 3-8 crisp, standalone, memorizable facts. If a fact comes from one of the AVAILABLE SOURCES " +
      "listed below, set source_ref to that source's id (e.g. \"S1\"); otherwise set source_ref to null. Never " +
      "invent a source id not in the list.\n" +
      "- mnemonics: 0-3 memory aids ONLY if genuinely useful (else []).\n" +
      "- quick_revision: 3-6 ultra-short one-line revision bullets.\n" +
      "- cards: 2-5 spaced-repetition flashcards (front = a question/cue, back = the answer), for self-testing.\n" +
      "Be faithful to the answer — never add facts it doesn't contain. Plain text only, no markdown.",
    content:
      `AVAILABLE SOURCES (id: title):\n${sourceLines}\n\n` +
      `MENTOR ANSWER TO CONVERT:\n<<<\n${answer.replace(/[<>]/g, " ").slice(0, 12000)}\n>>>`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        overview: { type: "string" },
        key_facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { fact: { type: "string" }, source_ref: { type: ["string", "null"] } },
            required: ["fact", "source_ref"],
          },
        },
        mnemonics: { type: "array", items: { type: "string" } },
        quick_revision: { type: "array", items: { type: "string" } },
        cards: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { front: { type: "string" }, back: { type: "string" } },
            required: ["front", "back"],
          },
        },
      },
      required: ["title", "overview", "key_facts", "mnemonics", "quick_revision", "cards"],
    },
    maxTokens: 4000,
  });

  const validSourceIds = new Set(sources.map((s) => s.id));
  const body: NoteBody = {
    overview: out.overview?.trim() ?? "",
    key_facts: (out.key_facts ?? []).map((f) => ({
      fact: f.fact,
      source_ref: f.source_ref && validSourceIds.has(f.source_ref) ? f.source_ref : null,
    })),
    up_angle: "",
    pyq_analysis: "",
    mnemonics: (out.mnemonics ?? []).filter(Boolean),
    quick_revision: (out.quick_revision ?? []).filter(Boolean),
    further_reading: [],
  };
  return { body, title: (out.title ?? "").trim(), cards: out.cards ?? [] };
}

// ---------------------------------------------------------------------------
// Save an answer as a personal note
// ---------------------------------------------------------------------------
interface SourceMessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  meta: { node_id?: string | null; web_sources?: NoteSource[] } | null;
  doubt_threads: { user_id: string } | { user_id: string }[] | null;
}

async function inferNode(content: string, metaNodeId: string | null | undefined, locale: Locale): Promise<string | null> {
  if (metaNodeId) return metaNodeId;
  // Fall back to a semantic match: embed the answer, take the top syllabus hit.
  try {
    const vectorLiteral = await embedQuery(content.slice(0, 4000));
    const ctx = await retrieveContext({ vectorLiteral, locale });
    const syllabusCite = ctx.citations.find((c) => c.source_type === "syllabus");
    return syllabusCite?.source_id ?? null;
  } catch (err) {
    logger.warn({ err }, "user-note: node inference failed");
    return null;
  }
}

export async function saveMessageAsNote(
  userId: string,
  opts: { messageId: string; nodeId?: string | null },
  locale: Locale,
): Promise<UserNote> {
  const { data, error } = await supabase()
    .from("doubt_messages")
    .select("id, thread_id, role, content, meta, doubt_threads!inner(user_id)")
    .eq("id", opts.messageId)
    .maybeSingle();
  if (error) throw new HttpError(500, `message lookup failed: ${error.message}`);
  const msg = data as SourceMessageRow | null;
  const owner = Array.isArray(msg?.doubt_threads) ? msg?.doubt_threads[0] : msg?.doubt_threads;
  if (!msg || owner?.user_id !== userId) throw notFound("Message not found");
  if (msg.role !== "assistant") throw badRequest("Only a mentor answer can be saved as study material");
  // A quiz message's `content` is just a one-line intro (the real payload is
  // interactive cards in meta) — there's nothing meaningful to turn into notes.
  if ((msg.meta as { kind?: string } | null)?.kind === "quiz") {
    throw badRequest("A quiz can't be saved as study material — save a mentor answer instead");
  }
  if (!msg.content.trim()) throw badRequest("This answer has no text to save");

  const sources: NoteSource[] = msg.meta?.web_sources ?? [];

  // Node link: explicit value wins (including an explicit null to unlink);
  // undefined → infer from the message's teacher meta or a semantic match.
  const nodeId =
    opts.nodeId === undefined ? await inferNode(msg.content, msg.meta?.node_id, locale) : opts.nodeId;

  const { body, title, cards } = await convertAnswerToBody(userId, msg.content, locale, sources);
  if (!body.overview.trim()) throw new HttpError(502, "Couldn't turn this answer into notes — try a fuller answer.");

  const content_i18n: NoteContentI18n =
    locale === "hi" ? { hi: body, en: EMPTY_BODY } : { hi: EMPTY_BODY, en: body };
  const srs_candidates: NoteSrsCandidate[] = cards.map((c) => ({
    front_i18n: (locale === "hi" ? { hi: c.front, en: "" } : { hi: "", en: c.front }) as BilingualText,
    back_i18n: (locale === "hi" ? { hi: c.back, en: "" } : { hi: "", en: c.back }) as BilingualText,
  }));

  const { data: inserted, error: insErr } = await supabase()
    .from("user_notes")
    .insert({
      user_id: userId,
      syllabus_node_id: nodeId,
      source_thread_id: msg.thread_id,
      source_message_id: msg.id,
      title: title || (locale === "hi" ? "मेरा नोट" : "My note"),
      content_i18n,
      srs_candidates,
      meta: { sources, generated_locale: locale },
    })
    .select(DETAIL_COLUMNS)
    .single();
  if (insErr) throw new HttpError(500, `user note insert failed: ${insErr.message}`);
  return toUserNote(inserted as unknown as UserNoteRow);
}

// ---------------------------------------------------------------------------
// Read / list / update / delete
// ---------------------------------------------------------------------------
export async function getUserNote(userId: string, id: string): Promise<UserNote> {
  const { data, error } = await supabase()
    .from("user_notes")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `user note lookup failed: ${error.message}`);
  if (!data) throw notFound("Note not found");
  return toUserNote(data as unknown as UserNoteRow);
}

export async function listUserNotes(userId: string, opts: { nodeId?: string } = {}): Promise<UserNoteListItem[]> {
  let query = supabase()
    .from("user_notes")
    .select(LIST_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (opts.nodeId) query = query.eq("syllabus_node_id", opts.nodeId);
  const { data, error } = await query;
  if (error) throw new HttpError(500, `user notes list failed: ${error.message}`);
  return ((data ?? []) as unknown as UserNoteRow[]).map((r) => {
    const sn = Array.isArray(r.syllabus_nodes) ? r.syllabus_nodes[0] : r.syllabus_nodes;
    return {
      id: r.id,
      title: r.title,
      syllabus_node_id: r.syllabus_node_id,
      syllabus_paper_code: sn?.paper_code ?? null,
      syllabus_title_i18n: sn?.title_i18n ?? null,
      filled_locales: filledLocales(r.content_i18n),
      created_at: r.created_at,
    };
  });
}

export async function updateUserNote(
  userId: string,
  id: string,
  body: { title?: string; syllabus_node_id?: string | null },
): Promise<UserNote> {
  await getUserNote(userId, id); // ownership 404
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.syllabus_node_id !== undefined) patch.syllabus_node_id = body.syllabus_node_id;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase().from("user_notes").update(patch).eq("id", id).eq("user_id", userId);
    if (error) throw new HttpError(500, `user note update failed: ${error.message}`);
  }
  return getUserNote(userId, id);
}

export async function deleteUserNote(userId: string, id: string): Promise<void> {
  await getUserNote(userId, id); // ownership 404
  const { error } = await supabase().from("user_notes").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new HttpError(500, `user note delete failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// On-demand translate — fill the empty locale (never automatic; costs a call)
// ---------------------------------------------------------------------------
export async function translateUserNote(userId: string, id: string): Promise<UserNote> {
  const note = await getUserNote(userId, id);
  const filled = note.filled_locales;
  if (filled.length === 0) throw badRequest("This note has no content to translate");
  if (filled.length === 2) return note; // already bilingual
  const from = filled[0]!;
  const to = otherLocale(from);
  const src = note.content_i18n[from];

  // ONE batched call for every field this note needs translated, instead of
  // one haiku round-trip per field (mirrors translateAndCacheEvaluation /
  // ingest/pyq.ts's collectHindiJobs pattern). Jobs carry an explicit key so
  // results are mapped back by key, not by array position.
  const jobs: { key: string; text: string }[] = [
    { key: "overview", text: src.overview },
    ...src.mnemonics.map((m, i) => ({ key: `mnemonic:${i}`, text: m })),
    ...src.quick_revision.map((q, i) => ({ key: `quick_revision:${i}`, text: q })),
    ...src.key_facts.map((f, i) => ({ key: `fact:${i}`, text: f.fact })),
    ...note.srs_candidates.map((c, i) => ({ key: `card_front:${i}`, text: c.front_i18n[from] })),
    ...note.srs_candidates.map((c, i) => ({ key: `card_back:${i}`, text: c.back_i18n[from] })),
  ];
  // jobs always has >= 1 entry (the overview job is unconditional), so this
  // never skips the call — no empty-batch special case needed. `to` can be
  // either locale (this fills whichever side is missing), so the hint stays
  // direction-agnostic rather than naming a specific source/target language.
  const translated = await translateBatch(
    jobs.map((j) => j.text),
    to,
    "UPPSC study note (write natural, fully-idiomatic text in the target language — no leftover source-language words for ordinary terms; keep only genuine loanwords/acronyms readers actually use as-is)",
    { purpose: "user_note_translate", userId },
  );
  const byKey = new Map(jobs.map((j, i) => [j.key, translated[i] ?? ""]));

  const overview = byKey.get("overview") ?? "";
  const mnemonics = src.mnemonics.map((_, i) => byKey.get(`mnemonic:${i}`) ?? "");
  const quickRevision = src.quick_revision.map((_, i) => byKey.get(`quick_revision:${i}`) ?? "");
  const factTexts = src.key_facts.map((_, i) => byKey.get(`fact:${i}`) ?? "");
  const cardFronts = note.srs_candidates.map((_, i) => byKey.get(`card_front:${i}`) ?? "");
  const cardBacks = note.srs_candidates.map((_, i) => byKey.get(`card_back:${i}`) ?? "");

  const translatedBody: NoteBody = {
    overview,
    key_facts: src.key_facts.map((f, i) => ({ fact: factTexts[i] ?? "", source_ref: f.source_ref })),
    up_angle: "",
    pyq_analysis: "",
    mnemonics,
    quick_revision: quickRevision,
    further_reading: [],
  };
  const content_i18n: NoteContentI18n =
    to === "hi" ? { hi: translatedBody, en: src } : { hi: src, en: translatedBody };
  const srs_candidates: NoteSrsCandidate[] = note.srs_candidates.map((c, i) => ({
    front_i18n: { ...c.front_i18n, [to]: cardFronts[i] ?? "" } as BilingualText,
    back_i18n: { ...c.back_i18n, [to]: cardBacks[i] ?? "" } as BilingualText,
  }));

  const { error } = await supabase()
    .from("user_notes")
    .update({ content_i18n, srs_candidates })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new HttpError(500, `user note translate failed: ${error.message}`);
  return getUserNote(userId, id);
}

// ---------------------------------------------------------------------------
// SRS deck — materialise this note's candidate cards (like official notes)
// ---------------------------------------------------------------------------
export async function addUserNoteDeckToRevision(userId: string, id: string): Promise<{ added: number; already: number }> {
  const note = await getUserNote(userId, id);
  const candidates = note.srs_candidates ?? [];
  if (candidates.length === 0) return { added: 0, already: 0 };

  const rows = candidates.map((c, i) => ({
    user_id: userId,
    front_i18n: c.front_i18n,
    back_i18n: c.back_i18n,
    source_type: "manual" as const,
    source_id: userNoteSourceId(id, `card:${i}`),
  }));
  const ids = rows.map((r) => r.source_id);
  const { data: existing } = await supabase()
    .from("srs_cards")
    .select("source_id")
    .eq("user_id", userId)
    .eq("source_type", "manual")
    .in("source_id", ids);
  const already = (existing ?? []).length;

  const { error } = await supabase()
    .from("srs_cards")
    .upsert(rows, { onConflict: "user_id,source_type,source_id" });
  if (error) throw new HttpError(500, `srs deck upsert failed: ${error.message}`);
  return { added: rows.length - already, already };
}
