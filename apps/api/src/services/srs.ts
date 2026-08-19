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
  SrsCardSource,
  SrsCardWeightage,
  SrsStats,
} from "@neev/shared";
import { noteRevisionBodySchema } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { getUserExam, questionExamScopeFilter } from "../lib/exams.js";
import { currentUserIsAnonymous } from "../lib/user-context.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { previewIntervals, reviewCard, type FsrsStateJson, type SrsRating } from "../lib/fsrs.js";
import { istDayRangeUtc, istToday, shiftDate } from "../lib/ist.js";
import { selectAll } from "../lib/paginate.js";
import { logger } from "../lib/logger.js";
import { addNoteDeckToRevision, noteSourceId } from "./notes.js";
import { generateGroundedExplanation } from "./question-explanation.js";

/**
 * The per-block "add to revision" keys, taken from the SHARED schema rather than
 * retyped — `noteRevisionBodySchema.shape.block` is the one definition of which
 * blocks exist, so this cannot fall out of step when a block is added.
 */
const NOTE_BLOCK_KEYS = noteRevisionBodySchema.shape.block.options;
/** How far to search per block when recovering a note card's origin. */
const NOTE_BLOCK_MAX_INDEX = 60;

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
 * "Cards that are revision for this exam" (0124).
 *
 * A NULL `exam_code` means "not exam-specific — due under every exam". That arm
 * is NOT vestigial here the way it is for user_notes: 101 of 130 pre-0124 cards
 * carry a sha256-DERIVED `source_id` (the idempotency key for note decks, CA
 * facts, evaluation takeaways and personal-note decks), which cannot be resolved
 * back to an exam, so they are permanently NULL and must keep showing up rather
 * than silently disappearing from their owner's deck.
 *
 * ⚑ This scoping REVERSES 0106 §13's "the deck is shared across exams" decision,
 * on the founder's report — measured, that decision was giving the one user on a
 * second exam a daily review made entirely of the OTHER exam's PYQs. Cards are
 * not deleted, only filtered, so selecting the old exam brings them straight
 * back. See the 0124 header before changing this back.
 */
function examVisibilityFilter(examCode: string): string {
  return `exam_code.eq.${examCode},exam_code.is.null`;
}

/**
 * Add a syllabus topic to revision. Idempotent via a DB-level unique index on
 * (user_id, source_type, source_id) (migration 0026) + upsert — a plain
 * check-then-insert can't actually guarantee this under concurrent requests
 * (two near-simultaneous clicks could both pass the lookup before either
 * insert lands), so the uniqueness has to be enforced by the database, not
 * just by application logic.
 */
export async function addNodeToRevision(userId: string, nodeId: string): Promise<SrsCard> {
  // `node_id` is untrusted request body, so scope it to the caller's own exam —
  // the M7 class of check (`resolveOrderedNodes`, `assertAnchorExists`). Without
  // it a user could source a revision card from ANOTHER exam's syllabus topic,
  // which became genuinely reachable the moment a second exam's tree landed
  // (UPSC, 2026-07-30). Note the asymmetry this fixes: the sibling
  // `addCurrentAffairsFactToRevision` below has always scoped its source.
  //
  // The CARD is now exam-scoped too (0124 — this deliberately reverses 0106 §13's
  // shared-deck decision; see that header). It is stamped with the SAME exam the
  // gate above resolved, so a card can never claim an exam its source contradicts.
  // 404 rather than 403, per the convention: a foreign node genuinely is not
  // part of your syllabus, and a distinct error would confirm the id exists to
  // a caller probing with guessed ids.
  const nodeExam = await getUserExam(userId);
  const { data: node, error: nodeError } = await supabase()
    .from("syllabus_nodes")
    .select("title_i18n, description_i18n")
    .eq("id", nodeId)
    .eq("exam_code", nodeExam)
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
        exam_code: nodeExam,
        // The node IS the origin — this card is revision for exactly this topic.
        origin_node_id: nodeId,
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
  syllabus_node_id: string | null;
  options_i18n: { key: string; text_i18n: BilingualText }[] | null;
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
}

/**
 * The ONE place a question card's back is composed — "Answer: X. <option>" then
 * the explanation, blank-separated, in both locales.
 *
 * Shared between `addQuestionToRevision` (which snapshots it at add time) and
 * `refreshQuestionCardBacks` (which re-derives it later). A second copy is
 * exactly how the refresher would silently stop matching what the generator
 * writes — it would then either rewrite every card on every run, or none.
 *
 * `explanation` is a parameter rather than read off the row so the refresher can
 * ask the counterfactual it needs: "what would this card have looked like when
 * the question had NO explanation?" — see `refreshQuestionCardBacks`.
 */
function buildQuestionCardBack(
  options: { key: string; text_i18n: BilingualText }[] | null,
  correctOptionKey: string | null,
  explanation: BilingualText | null,
): BilingualText {
  const correctOption = options?.find((o) => o.key === correctOptionKey) ?? null;
  return {
    en: [correctOption ? `Answer: ${correctOptionKey}. ${correctOption.text_i18n.en}` : null, explanation?.en]
      .filter((part): part is string => !!part)
      .join("\n\n"),
    hi: [correctOption ? `उत्तर: ${correctOptionKey}. ${correctOption.text_i18n.hi}` : null, explanation?.hi]
      .filter((part): part is string => !!part)
      .join("\n\n"),
  };
}

/**
 * Questions currently having an explanation generated in THIS process, so two
 * near-simultaneous adds of the same bare question don't both pay for one.
 *
 * `writeExplanation` already guards on `explanation_i18n IS NULL`, so a race
 * could never CORRUPT anything — the loser's write is simply a no-op. What it
 * could not prevent is paying for the model call twice. Per-instance only, which
 * is the honest bound: a multi-instance deploy could still double-generate once,
 * the same caveat lib/rate-limit.ts carries.
 */
const explanationInFlight = new Set<string>();

/**
 * Fill in a question's missing explanation, then re-derive the card that was
 * just created from it.
 *
 * ⚑ WHY THIS EXISTS. 76% of the published bank has no explanation, and one is
 * written ONLY when a user explicitly clicks "Generate explanation" on the
 * result review list (`routes/stream.ts`). Adding a question to revision does
 * not go through that button — so without this, a card added from a bare
 * question is saved as `"Answer: D. 9"` and stays that way forever, because
 * nothing else would ever generate the explanation for that question.
 *
 * COST — one `claude-haiku-4-5` call per genuinely-new question, and only when a
 * real user actually adds a card. It is NOT a backfill: nothing is generated for
 * questions nobody has put in their deck. The result is persisted to `questions`,
 * so it is paid once ever and every other surface (result review, PYQ browse,
 * search, magazine) gets it too — the same call the user would have paid for by
 * clicking the button, moved to the moment it is actually needed.
 *
 * ⚑ NOT RUN FOR GUESTS. Every other AI-spend surface in this app already refuses
 * an anonymous user — evaluation, OCR, mentor, study plan all call
 * `assertNotGuest` — so leaving this one open was inconsistent with the app's own
 * policy, and it is genuinely reachable: measured 2026-08-16 there are 3,681 bare
 * published questions with a key, and `srsRouter` allows 120 requests a minute,
 * so one anonymous session could drive thousands of billable calls. A guest still
 * gets a working card; it simply stays answer-only until a real user (or any
 * other path) generates that question's explanation, at which point the nightly
 * refresh upgrades it.
 *
 * Fire-and-forget: the caller must NOT await this. Adding a card is a fast,
 * user-facing write and must never block on (or fail because of) a model call —
 * the same `void screenPost(...)` shape community moderation uses. If it fails,
 * the card simply keeps its answer-only back and the nightly refresh will pick
 * the explanation up later if any other path writes one.
 */
async function backfillExplanationForNewCard(cardId: string, questionId: string): Promise<void> {
  if (explanationInFlight.has(questionId)) return;
  explanationInFlight.add(questionId);
  try {
    await generateGroundedExplanation(questionId);
    // Re-derive JUST the card that was created, not the caller's whole deck.
    // `seedWrongAnswers` calls the parent in a loop up to 15 times, so a
    // deck-wide scan here would re-read every one of that user's question cards
    // (and every backing question) fifteen times over for one new row each.
    // Reuses the same tested refresher — and therefore the same "is this card
    // safe to rewrite?" rule — rather than a second copy of it.
    await refreshQuestionCardBacks({ cardId, apply: true });
  } finally {
    explanationInFlight.delete(questionId);
  }
}

/**
 * Add a practice question to revision from the attempt-result review list.
 * front = the question stem, back = the correct option + explanation (both
 * bilingual) so a later FSRS review reads standalone, without the original
 * attempt context. Idempotent via the same (user_id, source_type, source_id)
 * unique index as addNodeToRevision, keyed by source_type='question'.
 */
export async function addQuestionToRevision(userId: string, questionId: string): Promise<SrsCard> {
  // `questionId` is UNTRUSTED (a path param). Exam-scoped for the same reason
  // `addNodeToRevision` above is: another exam's ids are internally consistent,
  // so a published-only check passes happily on a question from a syllabus this
  // user is not sitting. 404 rather than 403, per convention.
  //
  //
  // Scoped via paper_code (globally unique across exams), NOT questions.exam_code
  // — that column is PROVENANCE and its domain includes exams nobody can select
  // (up_ro_aro, upsssc_pet) whose PYQs legitimately belong to the default exam's
  // bank, so filtering on it would wrongly refuse them.
  const questionExam = await getUserExam(userId);
  const { data: question, error: questionError } = await supabase()
    .from("questions")
    .select("stem_i18n, syllabus_node_id, options_i18n, correct_option_key, explanation_i18n")
    .eq("id", questionId)
    .eq("is_published", true)
    .or(await questionExamScopeFilter(questionExam))
    .maybeSingle();
  if (questionError) throw new HttpError(500, `question lookup failed: ${questionError.message}`);
  if (!question) throw notFound("Question not found");

  const row = question as unknown as QuestionForRevisionRow;
  const back_i18n = buildQuestionCardBack(row.options_i18n, row.correct_option_key, row.explanation_i18n);

  const { data: card, error } = await supabase()
    .from("srs_cards")
    .upsert(
      {
        user_id: userId,
        front_i18n: row.stem_i18n,
        back_i18n,
        source_type: "question",
        source_id: questionId,
        exam_code: questionExam,
        // 0132 — so the review player can offer "re-read this chapter". Null when
        // the question is unmapped; the UI then shows no link rather than a bad one.
        origin_node_id: row.syllabus_node_id ?? null,
      },
      { onConflict: "user_id,source_type,source_id" },
    )
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card upsert failed: ${error.message}`);

  // The card was just saved answer-only because the question has no explanation
  // yet. Generate one in the background so the card is actually worth reviewing
  // — see backfillExplanationForNewCard for the cost rationale. Requires a
  // correct_option_key: the explanation prompt argues FOR the stored key, so
  // there is nothing to write without one.
  // ⚑ The guest flag MUST be read here, synchronously, not inside the background
  // task: `currentUserIsAnonymous()` reads AsyncLocalStorage and returns FALSE
  // outside a request context — so checking it after the response has gone would
  // fail OPEN and treat every guest as a paying user.
  const isGuest = currentUserIsAnonymous();
  const hasExplanation = !!(row.explanation_i18n?.en || row.explanation_i18n?.hi);
  if (!hasExplanation && row.correct_option_key && !isGuest) {
    void backfillExplanationForNewCard((card as { id: string }).id, questionId).catch((err) => {
      console.error(
        `srs: explanation generation failed for question ${questionId} (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  return card as unknown as SrsCardRow;
}

/**
 * Re-derive `back_i18n` for `source_type='question'` cards from their question's
 * CURRENT explanation.
 *
 * ⚑ WHY THIS EXISTS, and what it does NOT fix. `addQuestionToRevision` snapshots
 * the explanation at add time, so a card is frozen at whatever the question said
 * then. That is a real one-way gap, because **76% of the published bank has no
 * explanation at all** (measured 2026-08-16: 6,422 of 8,401 published+approved
 * questions have `explanation_i18n IS NULL`) — those are written LAZILY on first
 * view (`routes/stream.ts` -> `persistQuestionExplanation`). So the common path
 * is: add a card while the question is bare, someone views that question later,
 * the question gains a real explanation, and the card stays answer-only forever.
 * Measured on the same day, 27 of the 29 live question cards were answer-only —
 * backs as short as `"Answer: D. 9"` (12 chars). That, not staleness, is why
 * cards read as too basic.
 *
 * ⚑ IT REFRESHED 0 CARDS ON ITS FIRST RUN, and that is the expected result, not
 * a failure: a card is only stale once its question has GAINED an explanation,
 * and today those 27 questions are still bare. This is a mechanism that makes
 * cards self-heal from here on, not a repair of existing damage. The repair
 * would be generating those explanations, which is billed work the owner has
 * already declined once for the wider bank (see CLAUDE.md's explanation-depth
 * session) — so it is deliberately NOT done here.
 *
 * SAFETY — only a card whose back is EXACTLY the answer-only generated form is
 * rewritten. That exact string is reachable only by the generator running with a
 * null explanation, so matching it proves the card is generator-owned and has
 * never been hand-edited via the Manage tab's `updateCard` (which can rewrite
 * any card's back, including this one's). The deliberately-skipped case is a
 * card generated from an explanation that was LATER rewritten: that back is
 * indistinguishable from a user's own edit without a provenance column, and
 * clobbering someone's edited card is worse than leaving one stale. It is also
 * not currently reachable — `writeExplanation` guards on `explanation_i18n IS
 * NULL`, so nothing rewrites an existing explanation without `--force`.
 */
export async function refreshQuestionCardBacks(
  opts: { apply?: boolean; userId?: string; cardId?: string } = {},
): Promise<{ scanned: number; refreshed: number; skippedEdited: number; danglingSource: number }> {
  const cards = await selectAll<{ id: string; source_id: string; back_i18n: BilingualText }>(() => {
    let q = supabase()
      .from("srs_cards")
      .select("id, source_id, back_i18n")
      .eq("source_type", "question")
      .not("source_id", "is", null)
      // A deterministic sort key is required for paging to be stable: `id` is the
      // primary key, so it is a total order and no row can be skipped or repeated
      // across pages even while another request is inserting cards.
      .order("id", { ascending: true });
    if (opts.userId) q = q.eq("user_id", opts.userId);
    if (opts.cardId) q = q.eq("id", opts.cardId);
    return q;
  });
  if (cards.length === 0) return { scanned: 0, refreshed: 0, skippedEdited: 0, danglingSource: 0 };

  // Chunked at 100 — an `.in()` with several hundred uuids exceeds PostgREST's
  // URL length and fails outright ("fetch failed"), which this repo has hit before.
  const questionIds = [...new Set(cards.map((c) => c.source_id))];
  const byId = new Map<string, QuestionForRevisionRow>();
  for (let i = 0; i < questionIds.length; i += 100) {
    const { data, error } = await supabase()
      .from("questions")
      .select("id, stem_i18n, options_i18n, correct_option_key, explanation_i18n")
      .in("id", questionIds.slice(i, i + 100));
    if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
    for (const row of data ?? []) byId.set(row.id as string, row as unknown as QuestionForRevisionRow);
  }

  let refreshed = 0;
  let skippedEdited = 0;
  let danglingSource = 0;
  for (const card of cards) {
    const question = byId.get(card.source_id);
    // The source question was deleted or rejected since the card was added. The
    // card is deliberately LEFT ALONE rather than repaired or removed: it is the
    // user's own deck, and deleting someone's revision card because our bank
    // changed is not this job's call.
    if (!question) {
      danglingSource += 1;
      continue;
    }
    const fresh = buildQuestionCardBack(question.options_i18n, question.correct_option_key, question.explanation_i18n);
    if (fresh.en === card.back_i18n?.en && fresh.hi === card.back_i18n?.hi) continue; // already current

    const answerOnly = buildQuestionCardBack(question.options_i18n, question.correct_option_key, null);
    if (card.back_i18n?.en !== answerOnly.en || card.back_i18n?.hi !== answerOnly.hi) {
      skippedEdited += 1;
      continue;
    }

    if (opts.apply) {
      const { error } = await supabase().from("srs_cards").update({ back_i18n: fresh }).eq("id", card.id);
      if (error) throw new HttpError(500, `srs card back refresh failed: ${error.message}`);
    }
    refreshed += 1;
  }
  return { scanned: cards.length, refreshed, skippedEdited, danglingSource };
}

/**
 * Fill in `origin_node_id` (0132) for cards that predate it or whose write path
 * could not resolve one at the time.
 *
 * Four recovery routes, in the order they can be resolved cheaply:
 *   (a) question card      -> questions.syllabus_node_id
 *   (b) node card          -> source_id IS the node
 *   (c) evaluation card    -> submission -> question -> node
 *   (d) note deck/block    -> RECOMPUTE the sha256-derived source_id
 *
 * (a) and (b) are also done in 0132's SQL; they are repeated here so a card
 * created between the migration and the deploy still converges, and so the CLI
 * is a complete repair on its own.
 *
 * (d) is the interesting one and why this is TypeScript rather than SQL: a note
 * card's `source_id` is `sha256("note:<id>:<key>")`, which cannot be reversed.
 * The only way back is to re-derive every id a published note COULD have
 * produced and match — using notes.ts's own `noteSourceId` and the shared block
 * enum, never a hand-copied list, because a drifted copy would match nothing and
 * be indistinguishable from "there was nothing to recover".
 *
 * Deliberately does NOT resolve current-affairs facts: a CA item's
 * `syllabus_node_ids` is an ARRAY (an item legitimately spans several topics),
 * so picking one would be a guess, and a CA fact's natural "read more" target is
 * the current-affairs item, not a chapter. Those keep a NULL origin, which the
 * UI renders as no link rather than a wrong one.
 */
export async function backfillCardOriginNodes(
  opts: { apply?: boolean; userId?: string } = {},
): Promise<{ missing: number; resolved: number; byRoute: Record<string, number> }> {
  const cards = await selectAll<{ id: string; source_type: SrsSourceType; source_id: string | null }>(() => {
    let q = supabase()
      .from("srs_cards")
      .select("id, source_type, source_id")
      .is("origin_node_id", null)
      .not("source_id", "is", null)
      .order("id", { ascending: true });
    if (opts.userId) q = q.eq("user_id", opts.userId);
    return q;
  });
  const byRoute: Record<string, number> = { question: 0, node: 0, evaluation: 0, note: 0 };
  if (cards.length === 0) return { missing: 0, resolved: 0, byRoute };

  const resolved = new Map<string, string>(); // cardId -> nodeId

  // (a) question cards
  const qCards = cards.filter((c) => c.source_type === "question");
  const qIds = [...new Set(qCards.map((c) => c.source_id!))];
  const qNode = new Map<string, string | null>();
  for (let i = 0; i < qIds.length; i += 100) {
    const { data, error } = await supabase().from("questions").select("id, syllabus_node_id").in("id", qIds.slice(i, i + 100));
    if (error) throw new HttpError(500, `question node lookup failed: ${error.message}`);
    for (const r of data ?? []) qNode.set(r.id as string, r.syllabus_node_id as string | null);
  }
  for (const c of qCards) {
    const n = qNode.get(c.source_id!);
    if (n) { resolved.set(c.id, n); byRoute.question += 1; }
  }

  const manual = cards.filter((c) => c.source_type === "manual");
  const mIds = [...new Set(manual.map((c) => c.source_id!))];

  // (b) node cards — source_id IS a syllabus node.
  const realNodes = new Set<string>();
  for (let i = 0; i < mIds.length; i += 100) {
    const { data, error } = await supabase().from("syllabus_nodes").select("id").in("id", mIds.slice(i, i + 100));
    if (error) throw new HttpError(500, `node lookup failed: ${error.message}`);
    for (const r of data ?? []) realNodes.add(r.id as string);
  }
  for (const c of manual) {
    if (!resolved.has(c.id) && realNodes.has(c.source_id!)) { resolved.set(c.id, c.source_id!); byRoute.node += 1; }
  }

  // (c) evaluation cards — source_id is a submission.
  const unres = manual.filter((c) => !resolved.has(c.id)).map((c) => c.source_id!);
  const subQuestion = new Map<string, string | null>();
  for (let i = 0; i < unres.length; i += 100) {
    const { data, error } = await supabase()
      .from("answer_submissions")
      .select("id, questions(syllabus_node_id)")
      .in("id", unres.slice(i, i + 100));
    if (error) throw new HttpError(500, `submission lookup failed: ${error.message}`);
    for (const r of data ?? []) {
      // PostgREST returns a to-one embed as an object, but defensively accept an
      // array too — the same shape guard getPaperSummaries already carries.
      const q = (r as { questions?: { syllabus_node_id?: string | null } | { syllabus_node_id?: string | null }[] }).questions;
      const node = Array.isArray(q) ? q[0]?.syllabus_node_id : q?.syllabus_node_id;
      subQuestion.set(r.id as string, node ?? null);
    }
  }
  for (const c of manual) {
    if (resolved.has(c.id)) continue;
    const n = subQuestion.get(c.source_id!);
    if (n) { resolved.set(c.id, n); byRoute.evaluation += 1; }
  }

  // (d) note deck/block cards — recompute the derived ids and match.
  const stillUnresolved = new Set(manual.filter((c) => !resolved.has(c.id)).map((c) => c.source_id!));
  if (stillUnresolved.size > 0) {
    const notes = await selectAll<{ id: string; syllabus_node_id: string | null; srs_candidates: unknown[] | null }>(() =>
      supabase()
        .from("notes")
        .select("id, syllabus_node_id, srs_candidates")
        .not("syllabus_node_id", "is", null)
        .order("id", { ascending: true }),
    );
    const derived = new Map<string, string>();
    for (const n of notes) {
      if (!n.syllabus_node_id) continue;
      const candidateCount = Array.isArray(n.srs_candidates) ? n.srs_candidates.length : 0;
      for (let i = 0; i < candidateCount; i++) derived.set(noteSourceId(n.id, `card:${i}`), n.syllabus_node_id);
      // Per-block cards. The index is unbounded in principle; NOTE_BLOCK_MAX_INDEX
      // bounds the search. A block card beyond it simply stays unresolved (no
      // link) rather than causing a wrong one — the honest failure direction.
      for (const block of NOTE_BLOCK_KEYS) {
        for (let i = 0; i <= NOTE_BLOCK_MAX_INDEX; i++) derived.set(noteSourceId(n.id, `${block}:${i}`), n.syllabus_node_id);
      }
    }
    for (const c of manual) {
      if (resolved.has(c.id)) continue;
      const n = derived.get(c.source_id!);
      if (n) { resolved.set(c.id, n); byRoute.note += 1; }
    }
  }

  if (opts.apply) {
    for (const [cardId, nodeId] of resolved) {
      const { error } = await supabase().from("srs_cards").update({ origin_node_id: nodeId }).eq("id", cardId);
      if (error) throw new HttpError(500, `origin_node_id update failed: ${error.message}`);
    }
  }
  return { missing: cards.length, resolved: resolved.size, byRoute };
}

interface SubmissionForRevisionRow {
  user_id: string;
  language: Locale;
  custom_question_text_i18n: BilingualText | null;
  questions: { stem_i18n: BilingualText; syllabus_node_id: string | null } | null;
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
    .select("user_id, language, custom_question_text_i18n, questions(stem_i18n, syllabus_node_id)")
    .eq("id", submissionId)
    .maybeSingle();
  if (subError) throw new HttpError(500, `submission lookup failed: ${subError.message}`);
  const row = submission as unknown as SubmissionForRevisionRow | null;
  if (!row || row.user_id !== userId) throw notFound("Submission not found");

  const { data: evaluation, error: evalError } = await supabase()
    .from("evaluations")
    .select("raw_response, exam_code")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (evalError) throw new HttpError(500, `evaluation lookup failed: ${evalError.message}`);
  const analysis = (evaluation as unknown as EvaluationForRevisionRow | null)?.raw_response?.analysis;
  if (!analysis) throw badRequest("This submission has no evaluation to save yet");

  // Ownership-scoped, not exam-scoped: this is the user's OWN past answer, so
  // there is no cross-exam content to leak and refusing it would strand them
  // from saving their own work.
  //
  // The CARD's exam comes from the EVALUATION's own `exam_code` (0109) rather
  // than the caller's current exam. Same reason as the CA path above: source_id
  // here is the submission id, so re-adding the same submission after an exam
  // switch upserts onto the same row — keyed off the caller it would move the
  // card, keyed off the evaluation it is stable and correct.
  const evalExam = (evaluation as unknown as { exam_code?: string | null } | null)?.exam_code ?? null;
  const submissionExam = evalExam ?? (await getUserExam(userId));
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
        exam_code: submissionExam,
        // 0132 — a catalogued question's own topic; null for a custom prompt,
        // which has no syllabus node to send the user back to.
        origin_node_id: (row.questions as { syllabus_node_id?: string | null } | null)?.syllabus_node_id ?? null,
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
  prelims_facts: { fact_i18n: BilingualText }[] | null;
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
  // `itemId` is untrusted request body, and the CA feed is exam-scoped, so an
  // item outside the caller's exam is not something they can legitimately have
  // reached — same check (and same 404, not 403) as the other untrusted-id
  // sites. The CARD is stamped from the ITEM's own scope, not blindly from the
  // caller (0124): a CA item legitimately spans several exams (measured: 116 of
  // 5,178 carry both), and its fact's source_id is sha256(item:index) with NO
  // exam in the key — so stamping the caller's exam would let the SAME fact,
  // re-added after an exam switch, upsert onto the same row and silently MOVE the
  // card out of the first exam's deck. A multi-exam item therefore yields a NULL
  // (= due under every exam) card, matching ca/embed-exam.ts's rule for the
  // identical situation and matching how 0124's own backfill treated them.
  const caExam = await getUserExam(userId);
  const { data: item, error: itemError } = await supabase()
    .from("current_affairs_items")
    .select("title_i18n, prelims_facts, detail_i18n->key_facts_i18n, exam_codes")
    .eq("id", itemId)
    .overlaps("exam_codes", [caExam])
    .eq("is_published", true)
    .maybeSingle();
  if (itemError) throw new HttpError(500, `current affairs item lookup failed: ${itemError.message}`);
  const row = item as unknown as CurrentAffairsItemForFactRow | null;
  if (!row) throw notFound("Current affairs item not found");

  // Single-exam item -> that exam. Multi-exam -> NULL, i.e. genuinely shared.
  const itemExams = ((row as unknown as { exam_codes: string[] | null }).exam_codes ?? []) as string[];
  const cardExam = itemExams.length === 1 ? itemExams[0]! : null;

  // New items store boxed facts in `prelims_facts`; un-backfilled legacy items
  // still carry the flat `detail_i18n.key_facts_i18n` — read whichever exists.
  let hi: string | undefined;
  let en: string | undefined;
  if (row.prelims_facts && row.prelims_facts.length > 0) {
    const fact = row.prelims_facts[factIndex];
    hi = fact?.fact_i18n?.hi;
    en = fact?.fact_i18n?.en;
  } else {
    hi = row.key_facts_i18n?.hi?.[factIndex];
    en = row.key_facts_i18n?.en?.[factIndex];
  }
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
        exam_code: cardExam,
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
 * Resolve the display enrichment for a batch of cards' origin topics: where the
 * card came from, and how heavily that topic is examined.
 *
 * Batched over the whole queue (never per card) — a 30-card session would
 * otherwise fire ~90 round trips. Everything is best-effort: a topic that has
 * never been examined simply has no weightage, and a card whose topic was
 * retired resolves to no source, both of which the UI renders as "no chip"
 * rather than an error. The enrichment is decoration on a working review
 * session; it must never be able to take the session down.
 *
 * Weightage is rolled up over the topic's SUBTREE, matching what /learn shows
 * for the same node — a section's number must not disagree between two screens.
 */
async function resolveCardEnrichment(
  nodeIds: string[],
  examCode: string,
): Promise<Map<string, { source: SrsCardSource; weightage: SrsCardWeightage | null; exam_stage: string }>> {
  const out = new Map<string, { source: SrsCardSource; weightage: SrsCardWeightage | null; exam_stage: string }>();
  const ids = [...new Set(nodeIds)];
  if (ids.length === 0) return out;

  const [nodesResult, chaptersResult] = await Promise.all([
    // ⚑ EXAM-SCOPED, and this is a real leak guard rather than belt-and-braces.
    // A card with `exam_code IS NULL` is due under EVERY exam (0124 — legacy
    // shared-deck rows), but its `origin_node_id` points at ONE exam's tree.
    // Measured 2026-08-16: 4 such cards exist, all with uppsc origins — so
    // without this filter a UPSC user reviewing one would be shown a UPPSC topic
    // name and a "read the chapter" link into a syllabus they are not sitting.
    // Filtering here (rather than after) means the whole enrichment for a foreign
    // node is simply absent, which the UI already renders as no chips.
    supabase()
      .from("syllabus_nodes")
      .select("id, paper_code, title_i18n, path, exam_code, exam_stage")
      .in("id", ids)
      .eq("exam_code", examCode),
    supabase()
      .from("notes")
      .select("syllabus_node_id, chapter_version")
      .in("syllabus_node_id", ids)
      .eq("status", "published"),
  ]);
  if (nodesResult.error) throw new HttpError(500, `card source lookup failed: ${nodesResult.error.message}`);
  const nodes = (nodesResult.data ?? []) as {
    id: string;
    paper_code: string;
    title_i18n: BilingualText;
    path: string;
    exam_code: string;
    exam_stage: string;
  }[];
  if (nodes.length === 0) return out;

  // A note row without a chapter is a digest-only note — real content, but not
  // the chapter the "re-read" link promises, so it does not count as one.
  const withChapter = new Set(
    ((chaptersResult.data ?? []) as { syllabus_node_id: string; chapter_version: number | null }[])
      .filter((n) => (n.chapter_version ?? 0) > 0)
      .map((n) => n.syllabus_node_id),
  );

  // Subtree rollup. `path` is a materialized path, so a node's descendants are
  // exactly the rows whose path is prefixed by it within the same paper — one
  // query for every card in the queue rather than one per card.
  const papers = [...new Set(nodes.map((n) => n.paper_code))];
  const treeRows = await selectAll<{ id: string; paper_code: string; path: string }>(() =>
    supabase().from("syllabus_nodes").select("id, paper_code, path").in("paper_code", papers).order("id", { ascending: true }),
  );
  // Chunked at 100 ids: a whole paper's tree runs to a few hundred nodes, and an
  // `.in()` that long exceeds PostgREST's URL limit and fails outright.
  const weightByNode = new Map<string, number>();
  // Years are collected per PAPER, not per topic: the rate must mean "questions
  // per exam", so the denominator is how many exams we hold — a topic that only
  // appears in 3 of 8 years must read as ~low per year, not as if it were only
  // examinable in 3.
  const yearsByPaper = new Map<string, Set<number>>();
  const paperOfNode = new Map(treeRows.map((r) => [r.id, r.paper_code]));
  const treeIds = treeRows.map((r) => r.id);
  for (let i = 0; i < treeIds.length; i += 100) {
    const { data, error } = await supabase()
      .from("mv_node_weightage")
      .select("node_id, year, q_count")
      .in("node_id", treeIds.slice(i, i + 100));
    if (error) throw new HttpError(500, `weightage lookup failed: ${error.message}`);
    for (const r of (data ?? []) as { node_id: string; year: number; q_count: number }[]) {
      weightByNode.set(r.node_id, (weightByNode.get(r.node_id) ?? 0) + r.q_count);
      const paper = paperOfNode.get(r.node_id);
      if (!paper) continue;
      if (!yearsByPaper.has(paper)) yearsByPaper.set(paper, new Set());
      yearsByPaper.get(paper)!.add(r.year);
    }
  }

  for (const node of nodes) {
    // Self + descendants. An empty path is a paper root, whose descendants are
    // the whole paper; `startsWith("")` is true for every row, which is correct.
    let asked = 0;
    for (const row of treeRows) {
      if (row.paper_code !== node.paper_code) continue;
      const isSelfOrDescendant = row.id === node.id || row.path === node.path || row.path.startsWith(`${node.path}/`);
      if (!isSelfOrDescendant) continue;
      asked += weightByNode.get(row.id) ?? 0;
    }
    const years = yearsByPaper.get(node.paper_code)?.size ?? 0;
    out.set(node.id, {
      source: {
        node_id: node.id,
        paper_code: node.paper_code,
        title_i18n: node.title_i18n,
        has_chapter: withChapter.has(node.id),
      },
      weightage: asked > 0 && years > 0 ? { asked, years, per_year: asked / years } : null,
      exam_stage: node.exam_stage,
    });
  }
  return out;
}

/**
 * "Was this exact question actually asked, and when?"
 *
 * ⚑ GATED ON `source = 'pyq'`, which is the whole point. The bank also holds
 * GENERATED questions — current-affairs MCQs and qgen items — which carry a
 * `year` (the year they were written about) but were never on any real paper.
 * Showing "Asked in Prelims 2026" for one of those would be a plain falsehood on
 * a card a learner is trusting, so the filter is a correctness gate, not a
 * cosmetic one. Measured: 30 of 31 card-backing questions are real PYQs, 1 is
 * generated — so the wrong branch is reachable today, not hypothetical.
 */
async function resolveQuestionProvenance(questionIds: string[]): Promise<Map<string, { year: number }>> {
  const out = new Map<string, { year: number }>();
  const ids = [...new Set(questionIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase()
      .from("questions")
      .select("id, year, source")
      .in("id", ids.slice(i, i + 100))
      .eq("source", "pyq")
      .not("year", "is", null);
    if (error) throw new HttpError(500, `question provenance lookup failed: ${error.message}`);
    for (const r of (data ?? []) as { id: string; year: number }[]) out.set(r.id, { year: r.year });
  }
  return out;
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
export async function getDueQueue(
  userId: string,
  examCode: string,
  limit = 30,
): Promise<{ cards: SrsQueueCard[]; due_count: number }> {
  const { endUtc: todayEndUtc } = istDayRangeUtc(istToday());
  const examFilter = examVisibilityFilter(examCode);

  const dueCount = await headCount(() =>
    supabase()
      .from("srs_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .or(examFilter)
      .lt("fsrs_state->>due_at", todayEndUtc),
  );

  const { data, error } = await supabase()
    .from("srs_cards")
    .select(`${SRS_CARD_COLUMNS_WITH_STATE}, origin_node_id`)
    .eq("user_id", userId)
    .or(examFilter)
    .lt("fsrs_state->>due_at", todayEndUtc)
    .order("fsrs_state->>due_at", { ascending: true })
    .limit(limit);
  if (error) throw new HttpError(500, `srs due queue failed: ${error.message}`);

  const rows = (data ?? []) as unknown as (SrsCardRow & {
    fsrs_state: FsrsStateJson;
    origin_node_id: string | null;
  })[];

  // Best-effort enrichment: a failure here must never cost the user their review
  // session, so it degrades to unenriched cards (no chips) rather than throwing.
  let enrichment = new Map<string, { source: SrsCardSource; weightage: SrsCardWeightage | null; exam_stage: string }>();
  let provenance = new Map<string, { year: number }>();
  try {
    const [e, p] = await Promise.all([
      resolveCardEnrichment(rows.map((r) => r.origin_node_id).filter((id): id is string => !!id), examCode),
      resolveQuestionProvenance(
        rows.filter((r) => r.source_type === "question" && r.source_id).map((r) => r.source_id!),
      ),
    ]);
    enrichment = e;
    provenance = p;
  } catch (err) {
    logger.warn({ err }, "srs: card enrichment failed, serving plain cards");
  }

  const now = new Date();
  const cards = rows.map((row) => {
    const e = row.origin_node_id ? enrichment.get(row.origin_node_id) : undefined;
    const p = row.source_id ? provenance.get(row.source_id) : undefined;
    return {
      ...row,
      preview: previewIntervals(row.fsrs_state, now),
      source: e?.source ?? null,
      weightage: e?.weightage ?? null,
      // The stage comes from the topic's own paper, so it can only be attached
      // when BOTH the year and the topic resolved — never half a claim.
      provenance: p && e ? { year: p.year, exam_stage: e.exam_stage } : null,
    };
  }) as unknown as SrsQueueCard[];

  return { cards, due_count: dueCount };
}

/** Header stats + a 7-day due-count forecast (day 0 absorbs today + any overdue backlog). */
export async function getStats(userId: string, examCode: string): Promise<SrsStats> {
  const today = istToday();
  const examFilter = examVisibilityFilter(examCode);
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
    headCount(() =>
      supabase().from("srs_cards").select("id", { count: "exact", head: true }).eq("user_id", userId).or(examFilter),
    ),
    supabase().from("srs_reviews").select("rating").eq("user_id", userId).gte("reviewed_at", thirtyDaysAgoIso),
    Promise.all(
      forecastDays.map((date, i) => {
        if (i === 0) {
          return headCount(() =>
            supabase()
              .from("srs_cards")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .or(examFilter)
              .lt("fsrs_state->>due_at", todayEndUtc),
          );
        }
        const range = istDayRangeUtc(date);
        return headCount(() =>
          supabase()
            .from("srs_cards")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .or(examFilter)
            .gte("fsrs_state->>due_at", range.startUtc)
            .lt("fsrs_state->>due_at", range.endUtc),
        );
      }),
    ),
  ]);

  if (reviewRowsResult.error) {
    throw new HttpError(500, `srs retention lookup failed: ${reviewRowsResult.error.message}`);
  }
  // `reviewed_today` and `retention_pct` come from `srs_reviews`, which has no
  // exam column, and are deliberately left GLOBAL: they describe the user's own
  // review behaviour, not a deck's contents. Since the queue is now exam-scoped,
  // every FUTURE review is already single-exam, so the only mixing is historical
  // — and a user's past retention genuinely is their past retention. Scoping it
  // would need a join through srs_cards for a number nobody reads per-exam.
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
    // A hand-written card is stamped with the author's exam too (0124): they
    // wrote it while revising for THAT exam, so it is that exam's revision.
    // A user who wants it under both can add it again after switching.
    .insert({ user_id: userId, front_i18n, back_i18n, source_type: "manual", source_id: null, exam_code: await getUserExam(userId) })
    .select(SRS_CARD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `srs card insert failed: ${error.message}`);
  return card as unknown as SrsCardRow;
}

export async function listCards(
  userId: string,
  examCode: string,
  opts: { query?: string; sourceType?: SrsSourceType; page?: number; pageSize?: number },
): Promise<{ items: SrsCardListItem[]; pagination: PaginationMeta }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase()
    .from("srs_cards")
    .select(SRS_CARD_COLUMNS_WITH_STATE + ", created_at", { count: "exact" })
    .eq("user_id", userId)
    .or(examVisibilityFilter(examCode));
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

/**
 * Seed: the user's most recently missed MCQs (reuses addQuestionToRevision,
 * best-effort per question).
 *
 * A question is only a genuine "wrong answer" gap if the user's MOST RECENT
 * graded attempt at it is ALSO wrong — querying `is_correct=false` across
 * every attempt ever (the previous approach) kept a question flagged forever
 * even after the user went back and answered it correctly on a later
 * attempt, since that later correct row was never checked. Fix: pull every
 * graded (non-null is_correct) answer, rank/dedupe to the single latest row
 * per question_id, and only keep questions whose latest outcome is still
 * wrong before seeding from that set.
 */
export async function seedWrongAnswers(userId: string, limit = 15): Promise<{ added: number; already: number }> {
  // Exam-scoped through `tests` (the same join listAttempts uses). Not merely
  // cosmetic: addQuestionToRevision now refuses another exam's question, and the
  // catch below swallows that — so without this filter a switched user's `limit`
  // would be spent on questions that are silently skipped, and the seed would
  // report scanning 15 while adding none.
  const { data: attemptIdRows, error: attemptIdsError } = await supabase()
    .from("attempts")
    .select("id, tests!inner(exam_code)")
    .eq("user_id", userId)
    .eq("tests.exam_code", await getUserExam(userId))
    .not("submitted_at", "is", null);
  if (attemptIdsError) throw new HttpError(500, `attempt lookup failed: ${attemptIdsError.message}`);
  const attemptIds = (attemptIdRows ?? []).map((r) => r.id as string);
  if (attemptIds.length === 0) return { added: 0, already: 0 };

  // Every graded answer, newest first, so the FIRST row seen per question_id
  // below is that question's most recent outcome — not just its most recent
  // WRONG outcome, which is exactly the distinction the old query missed.
  const { data: answerRows, error: answersError } = await supabase()
    .from("attempt_answers")
    .select("question_id, is_correct, created_at")
    .in("attempt_id", attemptIds)
    .not("is_correct", "is", null)
    .order("created_at", { ascending: false });
  if (answersError) throw new HttpError(500, `wrong-answer lookup failed: ${answersError.message}`);

  const latestOutcomeByQuestion = new Map<string, boolean>();
  for (const row of (answerRows ?? []) as { question_id: string; is_correct: boolean }[]) {
    // Map insertion order tracks first-seen order = descending recency, so
    // only recording the FIRST outcome per question_id captures its latest one.
    if (!latestOutcomeByQuestion.has(row.question_id)) latestOutcomeByQuestion.set(row.question_id, row.is_correct);
  }

  const questionIds: string[] = [];
  for (const [questionId, latestIsCorrect] of latestOutcomeByQuestion) {
    if (latestIsCorrect) continue; // since answered correctly on the latest attempt — no longer an open gap
    questionIds.push(questionId);
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

  const candidateIds: string[] = [];
  for (const row of (eventRows ?? []) as { props: { note_id?: string } }[]) {
    const noteId = row.props?.note_id;
    if (noteId && !candidateIds.includes(noteId)) candidateIds.push(noteId);
  }

  // Keep only notes in the user's own exam, BEFORE applying `limit`. A
  // `note_read` event is not proof of exam: the chapter reader reaches a node
  // through unscoped public-reference reads (docs/multi-exam.md §0a), so a user
  // can legitimately have read another exam's chapter. addNoteDeckToRevision now
  // refuses those and the catch below swallows it, so filtering first is what
  // stops `limit` being consumed by notes that are silently skipped.
  const noteIds: string[] = [];
  if (candidateIds.length > 0) {
    const { data: scoped, error: scopeErr } = await supabase()
      .from("notes")
      .select("id, syllabus_nodes!inner(exam_code)")
      .in("id", candidateIds)
      .eq("status", "published")
      .eq("syllabus_nodes.exam_code", await getUserExam(userId));
    if (scopeErr) throw new HttpError(500, `note exam lookup failed: ${scopeErr.message}`);
    const allowed = new Set((scoped ?? []).map((n) => n.id as string));
    // Preserve most-recently-read order, which `candidateIds` already carries.
    for (const id of candidateIds) {
      if (!allowed.has(id)) continue;
      noteIds.push(id);
      if (noteIds.length >= limit) break;
    }
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
