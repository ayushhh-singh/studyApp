import { createHash } from "node:crypto";
import type {
  BilingualText,
  EvaluationAnalysis,
  Locale,
  PaginationMeta,
  SrsCard,
  SrsCardListItem,
  SrsQueueCard,
  SrsSourceType,
  SrsStats,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { previewIntervals, reviewCard, type FsrsStateJson, type SrsRating } from "../lib/fsrs.js";
import { istDayRangeUtc, istToday, shiftDate } from "../lib/ist.js";
import { addNoteDeckToRevision } from "./notes.js";

interface SrsCardRow {
  id: string;
  user_id: string;
  front_i18n: BilingualText;
  back_i18n: BilingualText;
  source_type: SrsCard["source_type"];
  source_id: string | null;
}

const SRS_CARD_COLUMNS = "id, user_id, front_i18n, back_i18n, source_type, source_id";

/**
 * Add a syllabus topic to revision. Idempotent via a DB-level unique index on
 * (user_id, source_type, source_id) (migration 0026) + upsert — a plain
 * check-then-insert can't actually guarantee this under concurrent requests
 * (two near-simultaneous clicks could both pass the lookup before either
 * insert lands), so the uniqueness has to be enforced by the database, not
 * just by application logic.
 */
export async function addNodeToRevision(userId: string, nodeId: string): Promise<SrsCard> {
  const { data: node, error: nodeError } = await supabase()
    .from("syllabus_nodes")
    .select("title_i18n, description_i18n")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeError) throw new HttpError(500, `syllabus node lookup failed: ${nodeError.message}`);
  if (!node) throw notFound("Syllabus node not found");

  const { data: card, error } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: node.title_i18n,
        back_i18n: node.description_i18n ?? { hi: "", en: "" },
        source_type: "manual",
        source_id: nodeId,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card upsert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}

interface QuestionForRevisionRow {
  stem_i18n: BilingualText;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
}

/**
 * Add a practice question to revision from the attempt-result review list.
 * front = the question stem, back = the correct option + explanation (both
 * bilingual) so a later FSRS review reads standalone, without the original
 * attempt context. Idempotent via the same (user_id, source_type, source_id)
 * unique index as addNodeToRevision, keyed by source_type='question'.
 */
export async function addQuestionToRevision(userId: string, questionId: string): Promise<SrsCard> {
  const { data: question, error: questionError } = await supabase()
    .from("questions")
    .select("stem_i18n, options_i18n, correct_option_key, explanation_i18n")
    .eq("id", questionId)
    .eq("is_published", true)
    .maybeSingle();
  if (questionError) throw new HttpError(500, `question lookup failed: ${questionError.message}`);
  if (!question) throw notFound("Question not found");

  const row = question as unknown as QuestionForRevisionRow;
  const correctOption = row.options_i18n?.find((o) => o.key === row.correct_option_key) ?? null;
  const back_i18n: BilingualText = {
    en: [
      correctOption ? `Answer: ${row.correct_option_key}. ${correctOption.text_i18n.en}` : null,
      row.explanation_i18n?.en,
    ]
      .filter((part): part is string => !!part)
      .join("\n\n"),
    hi: [
      correctOption ? `उत्तर: ${row.correct_option_key}. ${correctOption.text_i18n.hi}` : null,
      row.explanation_i18n?.hi,
    ]
      .filter((part): part is string => !!part)
      .join("\n\n"),
  };

  const { data: card, error } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: row.stem_i18n,
        back_i18n,
        source_type: "question",
        source_id: questionId,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card upsert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}

interface SubmissionForRevisionRow {
  user_id: string;
  language: Locale;
  custom_question_text_i18n: BilingualText | null;
  questions: { stem_i18n: BilingualText } | null;
}

interface EvaluationForRevisionRow {
  raw_response: { analysis?: EvaluationAnalysis } | null;
}

/**
 * Save an evaluated answer's key points to revision. front = the question
 * text (catalogued stem or the user's own prompt), back = the reference
 * points + missed key points from the analysis, in whichever locale the
 * submission was written in (evaluation feedback is single-locale, same as
 * strengths/improvements/model_answer). Reuses source_type='manual' (like
 * addNodeToRevision) keyed by the submission id, rather than adding a new
 * enum value for a one-off source.
 */
export async function addEvaluationToRevision(userId: string, submissionId: string): Promise<SrsCard> {
  const { data: submission, error: subError } = await supabase()
    .from("answer_submissions")
    .select("user_id, language, custom_question_text_i18n, questions(stem_i18n)")
    .eq("id", submissionId)
    .maybeSingle();
  if (subError) throw new HttpError(500, `submission lookup failed: ${subError.message}`);
  const row = submission as unknown as SubmissionForRevisionRow | null;
  if (!row || row.user_id !== userId) throw notFound("Submission not found");

  const { data: evaluation, error: evalError } = await supabase()
    .from("evaluations")
    .select("raw_response")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (evalError) throw new HttpError(500, `evaluation lookup failed: ${evalError.message}`);
  const analysis = (evaluation as unknown as EvaluationForRevisionRow | null)?.raw_response?.analysis;
  if (!analysis) throw badRequest("This submission has no evaluation to save yet");

  const front_i18n = row.questions?.stem_i18n ?? row.custom_question_text_i18n ?? { hi: "", en: "" };
  const points = [...analysis.reference_points, ...analysis.missed_key_points];
  const backText = points.length ? points.map((p) => `- ${p}`).join("\n") : "";
  const back_i18n: BilingualText = row.language === "hi" ? { hi: backText, en: "" } : { hi: "", en: backText };

  const { data: card, error } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n,
        back_i18n,
        source_type: "manual",
        source_id: submissionId,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card upsert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}

interface CurrentAffairsItemForFactRow {
  title_i18n: BilingualText;
  key_facts_i18n: { hi: string[]; en: string[] } | null;
}

/**
 * source_id is a `uuid` column, but "one card per fact" needs a distinct key
 * per (item, fact index) — not just per item. Rather than widen the column
 * (source_id is already "FK-by-convention", never a real FK per the srs_cards
 * comment), derive a stable, deterministic uuid-shaped id from the pair. Same
 * (itemId, factIndex) always hashes to the same id, so the existing
 * (user_id, source_type, source_id) unique index still makes re-adding the
 * same fact idempotent, while different facts on the same item get distinct
 * cards.
 */
function currentAffairsFactSourceId(itemId: string, factIndex: number): string {
  const hash = createHash("sha256").update(`${itemId}:${factIndex}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Add one current-affairs "key fact" bullet to revision. front = the item's
 * title, back = that single fact (both locales) — deliberately not the whole
 * item, so a later FSRS review is one focused, memorizable claim rather than
 * a wall of bullets.
 */
export async function addCurrentAffairsFactToRevision(
  userId: string,
  itemId: string,
  factIndex: number,
): Promise<SrsCard> {
  const { data: item, error: itemError } = await supabase()
    .from("current_affairs_items")
    .select("title_i18n, detail_i18n->key_facts_i18n")
    .eq("id", itemId)
    .eq("is_published", true)
    .maybeSingle();
  if (itemError) throw new HttpError(500, `current affairs item lookup failed: ${itemError.message}`);
  const row = item as unknown as CurrentAffairsItemForFactRow | null;
  if (!row) throw notFound("Current affairs item not found");

  const facts = row.key_facts_i18n;
  const hi = facts?.hi?.[factIndex];
  const en = facts?.en?.[factIndex];
  if (!hi && !en) throw badRequest("This item has no key fact at that index");

  const { data: card, error: upsertError } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: row.title_i18n,
        back_i18n: { hi: hi ?? "", en: en ?? "" },
        source_type: "current_affairs",
        source_id: currentAffairsFactSourceId(itemId, factIndex),
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (upsertError) throw new HttpError(500, `srs card upsert failed: ${upsertError.message}`);
  return card as unknown as SrsCardRow;
}

// ---------------------------------------------------------------------------
// FSRS review queue + scheduling
// ---------------------------------------------------------------------------
const SRS_CARD_COLUMNS_WITH_STATE = `${SRS_CARD_COLUMNS}, fsrs_state`;

async function headCount(
  build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await build();
  if (error) throw new HttpError(500, `srs query failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Cards due today — fsrs_state->>due_at before the end of the IST calendar
 * day, the SAME cutoff getStats' `due_today`/day-0 forecast bucket uses (not
 * a strict `<= now`). Keeping these aligned matters: the "Start review (N
 * due)" button reads `due_today` from getStats, and if this query used a
 * stricter cutoff a short-interval relearning card (due in a few minutes,
 * still "today") could be promised by the button but missing from the
 * session it opens — the two numbers must never disagree.
 */
export async function getDueQueue(userId: string, limit = 30): Promise<{ cards: SrsQueueCard[]; due_count: number }> {
  const { endUtc: todayEndUtc } = istDayRangeUtc(istToday());

  const dueCount = await headCount(() =>
    supabase().from("srs_cards").select("id", { count: "exact", head: true }).eq("user_id", userId).lt(
      "fsrs_state->>due_at",
      todayEndUtc,
    ),
  );

  const { data, error } = await supabase()
    .from("srs_cards")
    .select(SRS_CARD_COLUMNS_WITH_STATE)
    .eq("user_id", userId)
    .lt("fsrs_state->>due_at", todayEndUtc)
    .order("fsrs_state->>due_at", { ascending: true })
    .limit(limit);
  if (error) throw new HttpError(500, `srs due queue failed: ${error.message}`);

  const now = new Date();
  const cards = ((data ?? []) as unknown as (SrsCardRow & { fsrs_state: FsrsStateJson })[]).map((row) => ({
    ...row,
    preview: previewIntervals(row.fsrs_state, now),
  })) as unknown as SrsQueueCard[];

  return { cards, due_count: dueCount };
}

/** Header stats + a 7-day due-count forecast (day 0 absorbs today + any overdue backlog). */
export async function getStats(userId: string): Promise<SrsStats> {
  const today = istToday();
  const { startUtc: todayStartUtc, endUtc: todayEndUtc } = istDayRangeUtc(today);
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const forecastDays = Array.from({ length: 7 }, (_, i) => shiftDate(today, i));

  const [reviewedToday, totalCards, reviewRowsResult, forecastCounts] = await Promise.all([
    headCount(() =>
      supabase()
        .from("srs_reviews")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("reviewed_at", todayStartUtc)
        .lt("reviewed_at", todayEndUtc),
    ),
    headCount(() => supabase().from("srs_cards").select("id", { count: "exact", head: true }).eq("user_id", userId)),
    supabase().from("srs_reviews").select("rating").eq("user_id", userId).gte("reviewed_at", thirtyDaysAgoIso),
    Promise.all(
      forecastDays.map((date, i) => {
        if (i === 0) {
          return headCount(() =>
            supabase()
              .from("srs_cards")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .lt("fsrs_state->>due_at", todayEndUtc),
          );
        }
        const range = istDayRangeUtc(date);
        return headCount(() =>
          supabase()
            .from("srs_cards")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("fsrs_state->>due_at", range.startUtc)
            .lt("fsrs_state->>due_at", range.endUtc),
        );
      }),
    ),
  ]);

  if (reviewRowsResult.error) {
    throw new HttpError(500, `srs retention lookup failed: ${reviewRowsResult.error.message}`);
  }
  const reviewRows = (reviewRowsResult.data ?? []) as { rating: number }[];
  const retention_pct = reviewRows.length
    ? Math.round((reviewRows.filter((r) => r.rating > 1).length / reviewRows.length) * 1000) / 10
    : null;

  return {
    due_today: forecastCounts[0],
    reviewed_today: reviewedToday,
    retention_pct,
    total_cards: totalCards,
    forecast: forecastDays.map((date, i) => ({ date, count: forecastCounts[i] })),
  };
}

/**
 * Rate 1+ cards: reschedules each via ts-fsrs and logs the review. Cards not
 * owned by the caller 404 rather than silently no-op, so a stale offline-queue
 * entry surfaces instead of vanishing.
 */
export async function submitReviews(
  userId: string,
  reviews: { card_id: string; rating: SrsRating }[],
): Promise<{ card_id: string; rating: SrsRating; due_at: string; state: number }[]> {
  const cardIds = [...new Set(reviews.map((r) => r.card_id))];
  const { data: cards, error: cardsError } = await supabase()
    .from("srs_cards")
    .select("id, fsrs_state")
    .eq("user_id", userId)
    .in("id", cardIds);
  if (cardsError) throw new HttpError(500, `srs card lookup failed: ${cardsError.message}`);
  const stateById = new Map((cards ?? []).map((c) => [c.id as string, c.fsrs_state as FsrsStateJson]));

  // Validate every card up front, before writing anything. Reviews arrive as a
  // batch from the offline queue, which retries the WHOLE batch on any failure —
  // if we wrote reviews 1..k and then threw on review k+1, the client would
  // retry all of them (including the ones that already landed), double-logging
  // and double-advancing their FSRS state. Failing fast here keeps the batch
  // all-or-nothing at the write stage.
  for (const { card_id } of reviews) {
    if (!stateById.has(card_id)) throw notFound(`Card not found: ${card_id}`);
  }

  const now = new Date();
  const results: { card_id: string; rating: SrsRating; due_at: string; state: number }[] = [];
  for (const { card_id, rating } of reviews) {
    const currentState = stateById.get(card_id)!;
    const { state: nextState, elapsed_days, scheduled_days } = reviewCard(currentState, rating, now);

    const { error: updateError } = await supabase()
      .from("srs_cards")
      .update({ fsrs_state: nextState })
      .eq("id", card_id)
      .eq("user_id", userId);
    if (updateError) throw new HttpError(500, `srs card update failed: ${updateError.message}`);

    const { error: reviewError } = await supabase()
      .from("srs_reviews")
      .insert({
        card_id,
        user_id: userId,
        rating,
        reviewed_at: now.toISOString(),
        elapsed_days,
        scheduled_days,
      });
    if (reviewError) throw new HttpError(500, `srs review log failed: ${reviewError.message}`);

    stateById.set(card_id, nextState);
    results.push({ card_id, rating, due_at: nextState.due_at, state: nextState.state });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Manage view — manual cards, search, edit, delete
// ---------------------------------------------------------------------------

export async function createManualCard(
  userId: string,
  front_i18n: BilingualText,
  back_i18n: BilingualText,
): Promise<SrsCard> {
  const { data: card, error } = await supabase()
    .from("srs_cards")
    .insert({ user_id: userId, front_i18n, back_i18n, source_type: "manual", source_id: null })
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card insert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}

export async function listCards(
  userId: string,
  opts: { query?: string; sourceType?: SrsSourceType; page?: number; pageSize?: number },
): Promise<{ items: SrsCardListItem[]; pagination: PaginationMeta }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase()
    .from("srs_cards")
    .select(SRS_CARD_COLUMNS_WITH_STATE + ", created_at", { count: "exact" })
    .eq("user_id", userId);
  if (opts.sourceType) q = q.eq("source_type", opts.sourceType);
  // PostgREST's .or() syntax reserves `,()` as condition separators — strip them
  // from free-text search input so a comma in the query can't be read as an
  // extra (malformed) filter condition.
  const safeQuery = opts.query?.replace(/[(),]/g, " ").trim();
  if (safeQuery) {
    const like = `%${safeQuery}%`;
    q = q.or(
      `front_i18n->>en.ilike.${like},front_i18n->>hi.ilike.${like},back_i18n->>en.ilike.${like},back_i18n->>hi.ilike.${like}`,
    );
  }

  const { data, count, error } = await q.order("created_at", { ascending: false }).range(from, to);
  if (error) throw new HttpError(500, `srs card list failed: ${error.message}`);

  const total = count ?? 0;
  return {
    items: (data ?? []) as unknown as SrsCardListItem[],
    pagination: { page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function updateCard(
  userId: string,
  cardId: string,
  patch: { front_i18n?: BilingualText; back_i18n?: BilingualText },
): Promise<SrsCard> {
  if (!patch.front_i18n && !patch.back_i18n) throw badRequest("Nothing to update");
  const { data: card, error } = await supabase()
    .from("srs_cards")
    .update(patch)
    .eq("id", cardId)
    .eq("user_id", userId)
    .select(SRS_CARD_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, `srs card update failed: ${error.message}`);
  if (!card) throw notFound("Card not found");
  return card as unknown as SrsCardRow;
}

export async function deleteCard(userId: string, cardId: string): Promise<void> {
  const { data, error } = await supabase()
    .from("srs_cards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new HttpError(500, `srs card delete failed: ${error.message}`);
  if (!data || data.length === 0) throw notFound("Card not found");
}

// ---------------------------------------------------------------------------
// Empty-state one-tap seeds — real data, not samples
// ---------------------------------------------------------------------------

/** Seed: the user's most recently missed MCQs (reuses addQuestionToRevision, best-effort per question). */
export async function seedWrongAnswers(userId: string, limit = 15): Promise<{ added: number; already: number }> {
  const { data: attemptIdRows, error: attemptIdsError } = await supabase()
    .from("attempts")
    .select("id")
    .eq("user_id", userId)
    .not("submitted_at", "is", null);
  if (attemptIdsError) throw new HttpError(500, `attempt lookup failed: ${attemptIdsError.message}`);
  const attemptIds = (attemptIdRows ?? []).map((r) => r.id as string);
  if (attemptIds.length === 0) return { added: 0, already: 0 };

  const { data: wrongRows, error: wrongError } = await supabase()
    .from("attempt_answers")
    .select("question_id, created_at")
    .in("attempt_id", attemptIds)
    .eq("is_correct", false)
    .order("created_at", { ascending: false })
    .limit(limit * 3);
  if (wrongError) throw new HttpError(500, `wrong-answer lookup failed: ${wrongError.message}`);

  const questionIds: string[] = [];
  for (const row of (wrongRows ?? []) as { question_id: string }[]) {
    if (!questionIds.includes(row.question_id)) questionIds.push(row.question_id);
    if (questionIds.length >= limit) break;
  }

  let added = 0;
  let already = 0;
  for (const questionId of questionIds) {
    const { data: existing } = await supabase()
      .from("srs_cards")
      .select("id")
      .eq("user_id", userId)
      .eq("source_type", "question")
      .eq("source_id", questionId)
      .maybeSingle();
    try {
      await addQuestionToRevision(userId, questionId);
      if (existing) already += 1;
      else added += 1;
    } catch {
      // question no longer published/found — skip, this is a best-effort seed
    }
  }
  return { added, already };
}

/** Seed: full decks from the most recently read notes (reuses addNoteDeckToRevision). */
export async function seedNoteFacts(userId: string, limit = 5): Promise<{ added: number; already: number }> {
  const { data: eventRows, error } = await supabase()
    .from("events")
    .select("props, created_at")
    .eq("user_id", userId)
    .eq("name", "note_read")
    .order("created_at", { ascending: false })
    .limit(limit * 4);
  if (error) throw new HttpError(500, `note-read event lookup failed: ${error.message}`);

  const noteIds: string[] = [];
  for (const row of (eventRows ?? []) as { props: { note_id?: string } }[]) {
    const noteId = row.props?.note_id;
    if (noteId && !noteIds.includes(noteId)) noteIds.push(noteId);
    if (noteIds.length >= limit) break;
  }

  let added = 0;
  let already = 0;
  for (const noteId of noteIds) {
    try {
      const result = await addNoteDeckToRevision(userId, noteId);
      added += result.added;
      already += result.already;
    } catch {
      // note unpublished/deleted since it was read — skip, this is a best-effort seed
    }
  }
  return { added, already };
}
