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
import { getUserExam } from "../lib/exams.js";
import { getExamConfig, requireAuthored } from "../lib/exam-config.js";

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
  /**
   * Which exam this note was written under (0123). Deliberately NOT carried out
   * to the client `UserNote` shape: nothing in the UI needs it, and a raw exam
   * column reaching the client is exactly how the U7-residual display mismatch
   * arose (docs/OUTSTANDING.md §8f). Server-internal, read via `getUserNoteRow`.
   *
   * NULL on a pre-0123 row whose exam could not be derived — see the 0123 header.
   */
  exam_code: string | null;
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
  "id, title, exam_code, syllabus_node_id, source_thread_id, source_message_id, content_i18n, srs_candidates, meta, created_at, updated_at, syllabus_nodes(paper_code, title_i18n)";
const LIST_COLUMNS =
  "id, title, syllabus_node_id, content_i18n, created_at, syllabus_nodes(paper_code, title_i18n)";

/**
 * "Notes belonging to this exam" — the same predicate shape community.ts uses
 * for `discussion_threads` (`examVisibilityFilter`), for the same reason: a NULL
 * `exam_code` means "exam unknown / not exam-specific" and must stay visible
 * under every exam rather than becoming invisible under all of them (0123).
 *
 * Only three rows in the whole table-pair are NULL today (see the 0123 header),
 * so this arm is nearly dead — but it is the difference between a future write
 * path that forgets the column producing a *visible* note and producing one the
 * owner can never reach again.
 */
export function examVisibilityFilter(examCode: string): string {
  return `exam_code.eq.${examCode},exam_code.is.null`;
}

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

/**
 * The domain hint handed to `translateBatch()` by `translateUserNote()`.
 *
 * EXPORTED so `pnpm prompts:snapshot` can diff it by string: it used to be a
 * bare inline literal argument, and after the exam-config sweep it is a config
 * read inside a function that also reads and writes the DB — so the only way to
 * observe the string was to actually run a translation. A one-line builder makes
 * it snapshot-reachable with zero side effects.
 */
export function buildUserNoteTranslateHint(examCode: string): string {
  return requireAuthored(
    getExamConfig(examCode).misc.personalNotesTranslateDomainHint,
    examCode,
    "misc.personalNotesTranslateDomainHint",
  );
}

/**
 * EXPORTED (the whole prompt used to be anonymous inline properties of the
 * `structuredJson({...})` argument inside the module-private
 * `convertAnswerToBody`) so `pnpm prompts:snapshot` can diff it by string.
 */
export function buildUserNoteConvertSystem(examCode: string, locale: Locale): string {
  const lang = locale === "hi" ? "Hindi (Devanagari)" : "English";
  const audience = requireAuthored(
    getExamConfig(examCode).misc.personalNotesAudience,
    examCode,
    "misc.personalNotesAudience",
  );
  return (
    `You convert a mentor's answer into concise, well-structured personal STUDY NOTES for ${audience}, in ${lang}. ` +
    "Restructure and tighten the content into clean study material — do not just copy the answer. Fill:\n" +
    "- title: a short 3-8 word topic title.\n" +
    "- overview: a 2-4 sentence plain-language summary of the core idea.\n" +
    "- key_facts: 3-8 crisp, standalone, memorizable facts. If a fact comes from one of the AVAILABLE SOURCES " +
    "listed below, set source_ref to that source's id (e.g. \"S1\"); otherwise set source_ref to null. Never " +
    "invent a source id not in the list.\n" +
    "- mnemonics: 0-3 memory aids ONLY if genuinely useful (else []).\n" +
    "- quick_revision: 3-6 ultra-short one-line revision bullets.\n" +
    "- cards: 2-5 spaced-repetition flashcards (front = a question/cue, back = the answer), for self-testing.\n" +
    "Be faithful to the answer — never add facts it doesn't contain. Plain text only, no markdown."
  );
}

async function convertAnswerToBody(
  userId: string,
  examCode: string,
  answer: string,
  locale: Locale,
  sources: NoteSource[],
): Promise<{ body: NoteBody; title: string; cards: { front: string; back: string }[] }> {
  const sourceLines = sources.length
    ? sources.map((s) => `${s.id}: ${s.title}`).join("\n")
    : "(none)";

  const out = await structuredJson<ConvertResult>({
    model: MODELS.haiku,
    purpose: "user_note_convert",
    userId,
    system: buildUserNoteConvertSystem(examCode, locale),
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

async function inferNode(
  content: string,
  metaNodeId: string | null | undefined,
  locale: Locale,
  examCode: string,
): Promise<string | null> {
  if (metaNodeId) return metaNodeId;
  // Fall back to a semantic match: embed the answer, take the top syllabus hit.
  // Scoped to the user's exam — inferring a node from ANOTHER exam's tree would
  // file the personal note under a topic they can't even open.
  try {
    const vectorLiteral = await embedQuery(content.slice(0, 4000));
    const ctx = await retrieveContext({ vectorLiteral, locale, examCode });
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
  const examCode = await getUserExam(userId);
  const nodeId =
    opts.nodeId === undefined
      ? await inferNode(msg.content, msg.meta?.node_id, locale, examCode)
      : opts.nodeId;

  const { body, title, cards } = await convertAnswerToBody(userId, examCode, msg.content, locale, sources);
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
      // The exam this note was authored against (0123). Stamped once, at save
      // time, and never rewritten — it records which syllabus the content was
      // framed for (`convertAnswerToBody` above is prompted with this very
      // exam), so it stays correct after the user switches exams.
      exam_code: examCode,
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
/**
 * The raw row, ownership-scoped. Internal — the only way to read `exam_code`.
 *
 * DELIBERATELY NOT exam-scoped, unlike `listUserNotes`. This is the user's OWN
 * private note fetched by its own id: 404ing it because they have since switched
 * exams would strand them from their own material (a bookmarked URL, a link in a
 * revision card), and the list is what stops another exam's notes CLUTTERING the
 * UI. Fail-open on your own private content; the same call the mentor's
 * `requireThread` makes for the same reason.
 */
async function getUserNoteRow(userId: string, id: string): Promise<UserNoteRow> {
  const { data, error } = await supabase()
    .from("user_notes")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `user note lookup failed: ${error.message}`);
  if (!data) throw notFound("Note not found");
  return data as unknown as UserNoteRow;
}

export async function getUserNote(userId: string, id: string): Promise<UserNote> {
  return toUserNote(await getUserNoteRow(userId, id));
}

/**
 * The "My notes" list — scoped to the caller's CURRENT exam (0123).
 *
 * `examCode` is REQUIRED, not defaulted. A default would let a caller keep the
 * pre-0123 cross-exam behaviour by doing nothing, which is precisely the M24
 * trap this codebase has now hit three times (getMasteryMap, getCutoffs,
 * computeNodeTargets) — the compiler has to force the decision.
 */
export async function listUserNotes(
  userId: string,
  examCode: string,
  opts: { nodeId?: string } = {},
): Promise<UserNoteListItem[]> {
  let query = supabase()
    .from("user_notes")
    .select(LIST_COLUMNS)
    .eq("user_id", userId)
    .or(examVisibilityFilter(examCode))
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
  const row = await getUserNoteRow(userId, id); // ownership 404
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.syllabus_node_id !== undefined) {
    // `syllabus_node_id` is an UNTRUSTED body field and was previously written
    // with no validation at all — not even existence. With 0123 that matters:
    // relinking to another exam's node would leave the note's own `exam_code`
    // disagreeing with its linked node, so the list would render a foreign
    // paper code (LIST_COLUMNS joins the node) on a note filed under this exam.
    //
    // The note's exam is NOT rewritten to follow the node: it records what the
    // content was authored against, and a relink is a filing correction, not a
    // re-authoring. So the node must come from the note's own exam instead.
    // 404 rather than 403, per the M7 convention — a foreign node genuinely is
    // not part of this note's syllabus, and a distinct error would confirm the
    // id exists to a caller probing with guessed ids.
    if (body.syllabus_node_id !== null) {
      const { data: node, error: nodeErr } = await supabase()
        .from("syllabus_nodes")
        .select("id, exam_code")
        .eq("id", body.syllabus_node_id)
        .maybeSingle();
      if (nodeErr) throw new HttpError(500, `syllabus node lookup failed: ${nodeErr.message}`);
      // A NULL-exam note (pre-0123, exam undeterminable) has no exam to check
      // against, so fall back to the caller's own — never accept blindly.
      const noteExam = row.exam_code ?? (await getUserExam(userId));
      if (!node || (node.exam_code as string) !== noteExam) throw notFound("Syllabus topic not found");
    }
    patch.syllabus_node_id = body.syllabus_node_id;
  }
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
  const row = await getUserNoteRow(userId, id);
  const note = toUserNote(row);
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
  //
  // The domain hint follows the note's OWN exam (0123), not the caller's current
  // one. Before that column existed this read `getUserExam(userId)` as a stand-in
  // for "the exam this note was framed under" — which silently stopped being the
  // same thing once exam switching shipped: translating a UPPSC note after moving
  // to UPSC would have hinted the wrong commission's domain. `exam_code` is the
  // exam `convertAnswerToBody` actually framed the note under, so it is exact.
  // Falls back to the caller's exam only for a pre-0123 NULL row.
  const noteExam = row.exam_code ?? (await getUserExam(userId));
  const translated = await translateBatch(
    jobs.map((j) => j.text),
    to,
    buildUserNoteTranslateHint(noteExam),
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
  const row = await getUserNoteRow(userId, id);
  const note = toUserNote(row);
  const candidates = note.srs_candidates ?? [];
  if (candidates.length === 0) return { added: 0, already: 0 };

  // The NOTE's own exam (0123), not the caller's current one — this is the exact
  // exam the note was authored against, so a deck materialised from a note
  // written before an exam switch is filed where it belongs rather than under
  // whatever exam the user happens to be on when they click.
  //
  // A note whose own exam is unknown (NULL) yields NULL cards rather than a guess
  // from the caller: the card ids are sha256(note:card:i) with no exam in them, so
  // guessing would let a re-add after a switch upsert onto the same rows and move
  // the whole deck. NULL means "due under every exam", which is the honest answer
  // when the source's exam genuinely is not known.
  const deckExam = row.exam_code;

  const rows = candidates.map((c, i) => ({
    user_id: userId,
    front_i18n: c.front_i18n,
    back_i18n: c.back_i18n,
    source_type: "manual" as const,
    source_id: userNoteSourceId(id, `card:${i}`),
    exam_code: deckExam,
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
