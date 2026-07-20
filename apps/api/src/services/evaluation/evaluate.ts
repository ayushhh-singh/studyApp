/**
 * Answer-evaluation orchestrator — the flagship pipeline.
 *
 * createSubmission()  → inserts an answer_submissions row (typed answer to a
 *                       catalogued question or a custom prompt).
 * planEvaluation()    → pre-flight the SSE run: existence (404), one-concurrent-
 *                       evaluation-per-user guard (409), replay of an already-
 *                       complete evaluation, and an atomic status claim.
 * executeEvaluation() → the two-pass claude-sonnet-5 run: RAG grounding →
 *                       structured analysis (pass 1) → streamed strengths /
 *                       improvements / model answer (pass 2) → persist.
 *
 * Emitting is abstracted behind `EvalEmit` so the SSE route and the offline eval
 * harness drive the exact same pipeline.
 */
import type {
  BilingualText,
  CreateSubmissionBody,
  DimensionScore,
  Evaluation,
  EvaluationAnalysis,
  Locale,
  Submission,
  SubmissionDetail,
  SubmissionListItem,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { badRequest, conflict, HttpError, notFound } from "../../lib/http-error.js";
import { MODELS, streamText, structuredJson, translateBatch, type LlmUsage } from "../../lib/anthropic.js";
import { touchFeature } from "../../lib/feature-touch.js";
import { retrieveGrounding } from "./grounding.js";
import {
  computeOverallScore,
  DEFAULT_MAX_SCORE,
  DEFAULT_WORD_LIMIT,
  ESSAY_RUBRIC_VERSION,
  rubricDimensions,
  RUBRIC_VERSION,
} from "./rubric.js";
import { ESSAY_PAPER_CODE, ESSAY_WORD_LIMIT, ESSAY_MAX_MARKS } from "../../lib/exam-papers.js";
import {
  analysisJsonSchema,
  buildAnalysisSystem,
  buildAnalysisUserContent,
  buildFeedbackSharedContext,
  buildImprovementsSystem,
  buildModelAnswerSystem,
  buildModelAnswerUserContent,
  buildStrengthsSystem,
  countWords,
  FEEDBACK_WRITE_NOW,
  type AnalysisPageImage,
  type EvalContext,
  type Pass1Result,
} from "./prompts.js";
import { assertImagesExist, downloadImageAsBase64, getOcrProvider, type OcrResult } from "../ocr/index.js";
import { assertEvaluationCredit, assertHandwrittenOcr } from "../entitlements.js";

/** SSE-style emitter: (event, payload). Route wraps res.write; harness captures. */
export type EvalEmit = (event: string, data: unknown) => void;

/**
 * A submission left in 'evaluating' longer than this is treated as stranded (a
 * crashed run, a lost disconnect-release, a failed terminal write) and is
 * reclaimable — well above the ~1 min a real evaluation takes.
 */
const STALE_EVALUATION_MS = 5 * 60 * 1000;

/**
 * A submission left in 'ocr_processing' longer than this is treated as
 * stranded (a crashed run, a disconnect mid-transcription) and is
 * reclaimable — well above the time a real transcription takes.
 */
const STALE_OCR_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// DB row shapes
// ---------------------------------------------------------------------------
interface SubmissionRow {
  id: string;
  user_id: string;
  question_id: string | null;
  custom_question_text_i18n: BilingualText | null;
  mode: Submission["mode"];
  typed_text: string | null;
  image_paths: string[] | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  status: Submission["status"];
  language: Locale;
  meta: { word_limit?: number; marks?: number; rubric?: string } | null;
  created_at: string;
}

interface EvaluationRow {
  id: string;
  submission_id: string;
  model: string;
  rubric_version: string;
  overall_score: number | null;
  max_score: number | null;
  dimension_scores: DimensionScore[] | null;
  strengths_i18n: BilingualText | null;
  improvements_i18n: BilingualText | null;
  model_answer_i18n: BilingualText | null;
  raw_response: { analysis?: EvaluationAnalysis } | null;
  tokens_used: number | null;
  cost_usd: number | null;
  created_at: string;
}

const SUBMISSION_COLUMNS =
  "id, user_id, question_id, custom_question_text_i18n, mode, typed_text, image_paths, ocr_text, ocr_confidence, status, language, meta, created_at";
const EVALUATION_COLUMNS =
  "id, submission_id, model, rubric_version, overall_score, max_score, dimension_scores, strengths_i18n, improvements_i18n, model_answer_i18n, raw_response, tokens_used, cost_usd, created_at";

// ---------------------------------------------------------------------------
// Create submission
// ---------------------------------------------------------------------------
export async function createSubmission(userId: string, body: CreateSubmissionBody): Promise<Submission> {
  // Entitlement gates (early paywall, before we write a draft): handwritten
  // upload is Pro-only, and every submission consumes an evaluation credit
  // (Free 3-lifetime / Pro 60-month). planEvaluation re-checks the credit at the
  // billing point — this is the friendlier "block the 4th before you write" pass.
  if (body.mode === "handwritten") await assertHandwrittenOcr(userId);
  await assertEvaluationCredit(userId);

  let question_id: string | null = null;
  let custom_question_text_i18n: BilingualText | null = null;

  if (body.question_id) {
    // Validate the catalogued question exists so the insert can't fail on a
    // cryptic FK violation, and so eval time has a stem to read.
    const { data: q, error } = await supabase()
      .from("questions")
      .select("id")
      .eq("id", body.question_id)
      .maybeSingle();
    if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
    if (!q) throw badRequest("question_id does not reference an existing question");
    question_id = body.question_id;
  } else {
    // Custom prompt: store the user's typed question in their language only.
    const text = body.custom_question_text!.trim();
    custom_question_text_i18n = body.language === "hi" ? { hi: text, en: "" } : { hi: "", en: text };
  }

  if (body.mode === "handwritten") {
    // Scope every uploaded path to THIS user's folder (`<uid>/...`). The Storage
    // RLS policy (migration 0053) already blocks a client from writing outside
    // its own prefix; this is the server-side twin that stops a caller from
    // referencing someone else's object by path (the API downloads bytes with
    // the service role, which bypasses RLS, so we must enforce ownership here).
    for (const path of body.image_paths!) {
      if ((path.split("/")[0] ?? "") !== userId) {
        throw badRequest("image path is not under the authenticated user's folder");
      }
    }
    // Then fail fast with a clear 400 if any path doesn't actually exist in the
    // bucket, rather than accepting a guessed path that only surfaces as a
    // confusing 500 later, mid-OCR.
    await assertImagesExist(body.image_paths!);
  }

  const meta: Record<string, number> = {};
  if (body.word_limit) meta.word_limit = body.word_limit;
  if (body.marks) meta.marks = body.marks;

  let sessionOrderIndex: number | null = null;
  if (body.answer_session_id) {
    sessionOrderIndex = await validateAnswerSessionSubmission(userId, body.answer_session_id, question_id!);
  }

  const { data, error } = await supabase()
    .from("answer_submissions")
    .insert({
      user_id: userId,
      question_id,
      custom_question_text_i18n,
      mode: body.mode,
      typed_text: body.mode === "typed" ? body.typed_text : null,
      image_paths: body.mode === "handwritten" ? body.image_paths : null,
      status: "pending",
      language: body.language,
      meta,
      answer_session_id: body.answer_session_id ?? null,
      session_order_index: sessionOrderIndex,
    })
    .select(SUBMISSION_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `submission insert failed: ${error.message}`);
  void touchFeature(userId, "answer_evaluation");
  return mapSubmission(data as SubmissionRow);
}

/**
 * Guards a session-linked submission: the session must belong to this user,
 * still be in_progress, and within its deadline (mirrors the MCQ player's own
 * flush-then-submit tightness — a slow network right at expiry can lose the
 * race, matching real exam conditions). Returns the question's order_index
 * within the session's test, for session_order_index (display sorting only).
 */
async function validateAnswerSessionSubmission(
  userId: string,
  sessionId: string,
  questionId: string,
): Promise<number> {
  const { data: session, error: sessionError } = await supabase()
    .from("answer_test_sessions")
    .select("id, user_id, test_id, started_at, duration_minutes, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw new HttpError(500, `answer session lookup failed: ${sessionError.message}`);
  if (!session || session.user_id !== userId) throw notFound("Answer session not found");
  if (session.submitted_at) throw badRequest("This answer session has already been finished");
  if (session.duration_minutes) {
    const deadline = new Date(session.started_at).getTime() + session.duration_minutes * 60_000;
    if (Date.now() > deadline) throw badRequest("This answer session's time is up");
  }

  const { data: tq, error: tqError } = await supabase()
    .from("test_questions")
    .select("order_index")
    .eq("test_id", session.test_id)
    .eq("question_id", questionId)
    .maybeSingle();
  if (tqError) throw new HttpError(500, `session question lookup failed: ${tqError.message}`);
  if (!tq) throw badRequest("This question is not part of the session's test");
  return tq.order_index as number;
}

// ---------------------------------------------------------------------------
// Read submission + evaluation
// ---------------------------------------------------------------------------
async function fetchSubmission(userId: string, submissionId: string): Promise<SubmissionRow> {
  const { data, error } = await supabase()
    .from("answer_submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new HttpError(500, `submission lookup failed: ${error.message}`);
  if (!data || (data as SubmissionRow).user_id !== userId) throw notFound("Submission not found");
  return data as SubmissionRow;
}

async function fetchEvaluation(submissionId: string): Promise<EvaluationRow | null> {
  const { data, error } = await supabase()
    .from("evaluations")
    .select(EVALUATION_COLUMNS)
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error) throw new HttpError(500, `evaluation lookup failed: ${error.message}`);
  return (data as EvaluationRow) ?? null;
}

export async function getSubmissionDetail(userId: string, submissionId: string): Promise<SubmissionDetail> {
  const submission = await fetchSubmission(userId, submissionId);
  const evaluation = await fetchEvaluation(submissionId);
  return { submission: mapSubmission(submission), evaluation: evaluation ? mapEvaluation(evaluation) : null };
}

export const SUBMISSIONS_PAGE_SIZE = 10;

interface SubmissionListRow {
  id: string;
  status: Submission["status"];
  mode: Submission["mode"];
  language: Locale;
  created_at: string;
  question_id: string | null;
  custom_question_text_i18n: BilingualText | null;
  questions: { stem_i18n: BilingualText } | null;
  evaluations: { overall_score: number | null; max_score: number | null } | null;
}

/** GET /answers/submissions — the Answers hub's history list, newest first. */
export async function listSubmissions(
  userId: string,
  page: number,
): Promise<{ items: SubmissionListItem[]; total: number }> {
  const from = (page - 1) * SUBMISSIONS_PAGE_SIZE;
  const to = from + SUBMISSIONS_PAGE_SIZE - 1;
  const { data, error, count } = await supabase()
    .from("answer_submissions")
    .select(
      "id, status, mode, language, created_at, question_id, custom_question_text_i18n, questions(stem_i18n), evaluations(overall_score, max_score)",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new HttpError(500, `submissions query failed: ${error.message}`);

  const items = ((data ?? []) as unknown as SubmissionListRow[]).map((row) => ({
    id: row.id,
    status: row.status,
    mode: row.mode,
    language: row.language,
    created_at: row.created_at,
    question_id: row.question_id,
    question_stem_i18n: row.questions?.stem_i18n ?? row.custom_question_text_i18n ?? null,
    overall_score: row.evaluations?.overall_score ?? null,
    max_score: row.evaluations?.max_score ?? null,
  }));
  return { items, total: count ?? 0 };
}

// ---------------------------------------------------------------------------
// Plan the evaluation (guardrails run BEFORE the SSE stream opens)
// ---------------------------------------------------------------------------
export type EvaluationPlan =
  | { kind: "replay"; submission: SubmissionRow; evaluation: EvaluationRow }
  | {
      kind: "run";
      submission: SubmissionRow;
      questionText: string;
      syllabusNodeId: string | null;
      wordLimit: number;
      maxScore: number;
      /** Which rubric to apply — essay-v1 for the Essay paper, else v1. */
      rubricVersion: string;
      /** First page photo (handwritten mode only), fed to pass 1 for the presentation dimension. */
      pageImage?: AnalysisPageImage;
    };

async function resolveQuestionContext(submission: SubmissionRow): Promise<{
  questionText: string;
  syllabusNodeId: string | null;
  wordLimit: number;
  maxScore: number;
  rubricVersion: string;
}> {
  const lang = submission.language;
  if (submission.question_id) {
    const { data: q, error } = await supabase()
      .from("questions")
      .select("stem_i18n, syllabus_node_id, word_limit, marks, paper_code")
      .eq("id", submission.question_id)
      .maybeSingle();
    if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
    if (!q) throw new HttpError(409, "The question for this submission no longer exists");
    const stem = q.stem_i18n as BilingualText;
    const questionText = stem[lang]?.trim() || stem.en?.trim() || stem.hi?.trim() || "";
    // The Essay paper (निबंध) scores under the essay rubric; everything else uses v1.
    const isEssay = q.paper_code === ESSAY_PAPER_CODE;
    return {
      questionText,
      syllabusNodeId: (q.syllabus_node_id as string | null) ?? null,
      wordLimit: (q.word_limit as number | null) ?? (isEssay ? ESSAY_WORD_LIMIT : DEFAULT_WORD_LIMIT),
      // A test may re-weight a catalogued question's marks for THIS test (a mains
      // mock re-weights every question to the real paper's 8/12 pattern so it
      // totals exactly 200); that override rides on the session submission's
      // meta.marks. Prefer it, then the question's own marks, then the default —
      // so the answer is scored out of the same number the paper displays.
      maxScore: (submission.meta?.marks as number | null) ?? (q.marks as number | null) ?? (isEssay ? ESSAY_MAX_MARKS : DEFAULT_MAX_SCORE),
      rubricVersion: isEssay ? ESSAY_RUBRIC_VERSION : RUBRIC_VERSION,
    };
  }
  const custom = submission.custom_question_text_i18n;
  const questionText = custom?.[lang]?.trim() || custom?.en?.trim() || custom?.hi?.trim() || "";
  // A custom prompt can opt into the essay rubric via meta.rubric = "essay-v1"
  // (set when the writing room's essay mode is used for a non-catalogued topic).
  const isEssay = submission.meta?.rubric === ESSAY_RUBRIC_VERSION;
  return {
    questionText,
    syllabusNodeId: null,
    wordLimit: submission.meta?.word_limit ?? (isEssay ? ESSAY_WORD_LIMIT : DEFAULT_WORD_LIMIT),
    maxScore: submission.meta?.marks ?? (isEssay ? ESSAY_MAX_MARKS : DEFAULT_MAX_SCORE),
    rubricVersion: isEssay ? ESSAY_RUBRIC_VERSION : RUBRIC_VERSION,
  };
}

export async function planEvaluation(userId: string, submissionId: string): Promise<EvaluationPlan> {
  const submission = await fetchSubmission(userId, submissionId);

  // A persisted evaluation is the source of truth for "done": replay it
  // whatever the submission's status. This covers the normal 'complete' case
  // AND any state where the evaluation persisted but the terminal status write
  // was lost (e.g. a disconnect race) — so a re-request never re-bills the model.
  const existing = await fetchEvaluation(submissionId);
  if (existing) return { kind: "replay", submission, evaluation: existing };

  // The authoritative credit gate, at the billing point (after the replay
  // short-circuit, so re-viewing a finished evaluation is never charged and
  // never blocked). A user who created several drafts under the cap can't
  // evaluate past it — this is the throttle that actually bounds model spend.
  await assertEvaluationCredit(userId);

  // A handwritten submission has no typed_text until the user reviews and
  // confirms its OCR transcription (PATCH .../confirm-ocr) — never fall back to
  // evaluating the raw, unconfirmed ocr_text.
  if (submission.mode === "handwritten" && !submission.typed_text?.trim()) {
    throw badRequest("Please confirm the transcription before evaluating this answer");
  }

  // Resolve the question context BEFORE any status mutation. It only reads (the
  // already-fetched submission + a questions lookup) and can throw on a
  // transient DB error; doing it first means a throw here can never strand the
  // submission in 'evaluating' with no path to release it.
  const ctx = await resolveQuestionContext(submission);
  if (!ctx.questionText) {
    throw badRequest("This submission has no question text to evaluate against");
  }

  // Best-effort: feed the first page photo to pass 1 for the presentation
  // dimension. A download failure here must not block evaluation — it's an
  // enrichment, not a requirement, and the OCR text is the authoritative answer.
  let pageImage: AnalysisPageImage | undefined;
  if (submission.mode === "handwritten" && submission.image_paths?.[0]) {
    try {
      pageImage = await downloadImageAsBase64(submission.image_paths[0]);
    } catch (err) {
      logger.warn({ err, submissionId }, "failed to load page image for presentation scoring; continuing without it");
    }
  }

  // Reclaim submissions stranded in 'evaluating' past the staleness window (a
  // crashed run, a lost disconnect-release, a failed terminal write) so a stuck
  // row can never lock the user out permanently. Best-effort.
  const staleCutoff = new Date(Date.now() - STALE_EVALUATION_MS).toISOString();
  const { error: reclaimError } = await supabase()
    .from("answer_submissions")
    .update({ status: "failed" })
    .eq("user_id", userId)
    .eq("status", "evaluating")
    .lt("updated_at", staleCutoff);
  if (reclaimError) logger.warn({ err: reclaimError }, "stale-evaluation reclaim failed");

  // Guardrail: one concurrent evaluation per user. This gives a friendly 409 in
  // the common case; the partial unique index in migration 0029 is the actual
  // race-proof enforcement (a concurrent claim for a different submission of the
  // same user fails at the DB, below).
  const { data: active, error: activeError } = await supabase()
    .from("answer_submissions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "evaluating")
    .neq("id", submissionId)
    .limit(1);
  if (activeError) throw new HttpError(500, `concurrency check failed: ${activeError.message}`);
  if (active && active.length > 0) {
    throw conflict("You already have an evaluation in progress. Please wait for it to finish.");
  }

  // Atomically claim this submission (only from a non-terminal, non-running
  // state). A unique-violation (23505) means another submission of this user
  // won the per-user 'evaluating' slot in the TOCTOU window — surface it as 409.
  const { data: claimed, error: claimError } = await supabase()
    .from("answer_submissions")
    .update({ status: "evaluating" })
    .eq("id", submissionId)
    .in("status", ["pending", "ocr_done", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) {
    if (claimError.code === "23505") {
      throw conflict("You already have an evaluation in progress. Please wait for it to finish.");
    }
    throw new HttpError(500, `failed to claim submission: ${claimError.message}`);
  }
  if (!claimed) {
    // The row isn't in a claimable state and has no persisted evaluation (checked
    // above) — it is genuinely mid-evaluation.
    throw conflict("This answer is already being evaluated.");
  }

  return { kind: "run", submission: { ...submission, status: "evaluating" }, ...ctx, pageImage };
}

// ---------------------------------------------------------------------------
// Execute the two-pass evaluation
// ---------------------------------------------------------------------------
function clampScore(n: number): number {
  return Math.min(10, Math.max(0, Math.round(n)));
}

function oneLangI18n(language: Locale, text: string): BilingualText {
  const t = text.trim();
  return language === "hi" ? { hi: t, en: "" } : { hi: "", en: t };
}

export async function executeEvaluation(
  plan: Extract<EvaluationPlan, { kind: "run" }>,
  emit: EvalEmit,
  signal?: AbortSignal,
): Promise<void> {
  const { submission } = plan;
  const language = submission.language;
  const answerText = submission.typed_text ?? "";
  const userId = submission.user_id;

  // Aggregates the ANTHROPIC model spend across the four sonnet calls (analysis
  // + strengths + improvements + model answer) into evaluations.tokens_used /
  // cost_usd. The one OpenAI embedding for RAG grounding is not included here —
  // its cost is sub-cent-negligible (~30 tokens of text-embedding-3-small per
  // evaluation) and every Anthropic call is also logged individually to llm_calls.
  const usage = { input: 0, output: 0, cost: 0 };
  const onUsage = (u: LlmUsage) => {
    usage.input += u.inputTokens;
    usage.output += u.outputTokens;
    usage.cost += u.costUsd;
  };

  try {
    // 1. RAG grounding
    emit("status", { phase: "grounding" });
    const grounding = await retrieveGrounding({
      questionText: plan.questionText,
      locale: language,
      syllabusNodeId: plan.syllabusNodeId,
    });
    if (signal?.aborted) return;

    const ctx: EvalContext = {
      questionText: plan.questionText,
      answerText,
      mode: submission.mode,
      language,
      wordLimit: plan.wordLimit,
      maxScore: plan.maxScore,
      wordCount: countWords(answerText),
      grounding,
      rubricVersion: plan.rubricVersion,
    };

    // 2. Pass 1 — structured analysis
    emit("status", { phase: "analyzing" });
    const pass1 = await structuredJson<Pass1Result>({
      model: MODELS.sonnet,
      // Scoring is a rubric-matching task with explicit score bands, not open
      // reasoning. sonnet-5 has no temperature knob (deprecated), so 'low' effort
      // is the determinism lever: it minimizes the divergent exploration that
      // makes a strong answer's borderline dimensions (8-vs-9) wobble run to run,
      // keeping repeatability within ±5% of full marks. The clear rubric + the
      // huge ranking margins mean low effort loses no accuracy here.
      effort: "low",
      // Fixed per (locale, hasPageImage) — cached so the rubric + examiner
      // framing is a cache read, not a fresh input token, for every OTHER
      // student's submission that shares those two axes.
      system: [{ text: buildAnalysisSystem(!!plan.pageImage, plan.rubricVersion), cache: true }],
      content: buildAnalysisUserContent(ctx, plan.pageImage),
      schema: analysisJsonSchema(),
      maxTokens: 8000,
      purpose: "answer_eval_analysis",
      userId,
      onUsage,
      signal,
    });
    if (signal?.aborted) return;

    const dimensionScores: DimensionScore[] = rubricDimensions(plan.rubricVersion).map((d) => ({
      key: d.key,
      label: d.label,
      weight: d.weight,
      score: clampScore(pass1.dimensions[d.key]?.score ?? 0),
      justification: pass1.dimensions[d.key]?.justification ?? "",
    }));
    const overallScore = computeOverallScore(dimensionScores, plan.maxScore);
    const analysis: EvaluationAnalysis = {
      is_off_topic: pass1.is_off_topic,
      reference_points: pass1.reference_points,
      missed_key_points: pass1.missed_key_points,
      factual_errors: pass1.factual_errors,
      overall_comment: pass1.overall_comment,
    };

    emit("status", { phase: "scoring" });
    for (const ds of dimensionScores) emit("dimension_score", { ...ds, max: 10 });
    emit("analysis", { ...analysis, overall_score: overallScore, max_score: plan.maxScore });

    // 3. Pass 2 — streamed feedback: strengths, then improvements. Both calls
    // share one system segment (question + answer + pass-1 analysis) — it is
    // built ONCE here and marked cache:true on both calls so they land on the
    // same cache entry; only the second (persona/task) segment differs.
    emit("status", { phase: "feedback" });
    const sharedFeedbackContext = buildFeedbackSharedContext(ctx, pass1);
    let strengths = "";
    await streamText({
      model: MODELS.sonnet,
      system: [
        { text: sharedFeedbackContext, cache: true },
        { text: buildStrengthsSystem(language) },
      ],
      content: FEEDBACK_WRITE_NOW,
      maxTokens: 1500,
      purpose: "answer_eval_strengths",
      userId,
      onUsage,
      signal,
      onDelta: (t) => {
        strengths += t;
        emit("feedback_delta", { section: "strengths", text: t });
      },
    });
    if (signal?.aborted) return;

    let improvements = "";
    await streamText({
      model: MODELS.sonnet,
      system: [
        { text: sharedFeedbackContext, cache: true },
        { text: buildImprovementsSystem(language) },
      ],
      content: FEEDBACK_WRITE_NOW,
      maxTokens: 2000,
      purpose: "answer_eval_improvements",
      userId,
      onUsage,
      signal,
      onDelta: (t) => {
        improvements += t;
        emit("feedback_delta", { section: "improvements", text: t });
      },
    });
    if (signal?.aborted) return;

    // 4. Pass 2 — streamed model answer. For a catalogued question, the
    // rubric-conformant model answer is the same for every candidate in a
    // given language/rubric version — reuse a stored one instead of re-billing
    // the model. Custom-prompt submissions (no question_id) always generate.
    emit("status", { phase: "model_answer" });
    let modelAnswer = "";
    const reused = submission.question_id
      ? await fetchStoredModelAnswer(submission.question_id, language, plan.rubricVersion).catch((err) => {
          logger.warn({ err, submissionId: submission.id }, "model-answer reuse lookup failed; generating fresh");
          return null;
        })
      : null;
    if (reused) {
      modelAnswer = reused.modelAnswer;
      emit("model_answer_delta", { text: modelAnswer });
    } else {
      const modelAnswerUsage = { tokens: 0, cost: 0 };
      await streamText({
        model: MODELS.sonnet,
        system: buildModelAnswerSystem(ctx),
        content: buildModelAnswerUserContent(ctx, pass1),
        maxTokens: 4000,
        purpose: "answer_eval_model",
        userId,
        signal,
        onUsage: (u) => {
          onUsage(u);
          modelAnswerUsage.tokens += u.inputTokens + u.outputTokens;
          modelAnswerUsage.cost += u.costUsd;
        },
        onDelta: (t) => {
          modelAnswer += t;
          emit("model_answer_delta", { text: t });
        },
      });
      if (signal?.aborted) return;
      // Only cache a non-empty answer — an empty/failed generation must stay
      // a one-off for THIS submission, not get replayed as empty for every
      // future student who lands on this question until RUBRIC_VERSION bumps.
      if (submission.question_id && modelAnswer.trim()) {
        await persistStoredModelAnswer(
          submission.question_id,
          language,
          plan.rubricVersion,
          modelAnswer,
          modelAnswerUsage.tokens,
          modelAnswerUsage.cost,
        );
      }
    }

    // 5. Persist everything
    emit("status", { phase: "persisting" });
    const evaluation = await persistEvaluation({
      submissionId: submission.id,
      rubricVersion: plan.rubricVersion,
      overallScore,
      maxScore: plan.maxScore,
      dimensionScores,
      strengths_i18n: oneLangI18n(language, strengths),
      improvements_i18n: oneLangI18n(language, improvements),
      model_answer_i18n: oneLangI18n(language, modelAnswer),
      analysis,
      pass1,
      grounding,
      wordCount: ctx.wordCount,
      wordLimit: ctx.wordLimit,
      tokensUsed: usage.input + usage.output,
      costUsd: usage.cost,
    });

    // The evaluation is now durable — signal completion BEFORE the status write.
    // A failure flipping the submission to 'complete' must not turn a finished,
    // persisted evaluation into an error/failed outcome; a re-request replays
    // the stored row regardless of the submission's status.
    emit("done", {
      evaluation_id: evaluation.id,
      overall_score: overallScore,
      max_score: plan.maxScore,
    });
    await setSubmissionStatus(submission.id, "complete").catch((err) =>
      logger.warn({ err, submissionId: submission.id }, "failed to mark submission complete after persist"),
    );
  } catch (err) {
    // Only reachable before 'done' is emitted (persist and everything after it
    // is best-effort), so failing the submission here never contradicts a
    // completion the client already saw.
    await setSubmissionStatus(submission.id, "failed").catch(() => {});
    throw err;
  }
}

interface TranslationRow {
  strengths: string;
  improvements: string;
  model_answer: string;
  dimension_justifications: Record<string, string>;
  overall_comment: string;
  missed_key_points: string[];
  factual_error_issues: string[];
}

/**
 * The AI-written substance of an evaluation, resolved for `locale`. When
 * `locale` matches the locale the evaluation was actually generated in
 * (answer_submissions.language), this is a free pass-through of the stored
 * content. Otherwise it's a lazy, cached-per-(evaluation,locale) translation
 * — see 0061_evaluation_translations.sql. Every OTHER piece of this feature
 * (dimension scores/weights, the score gauge, UI chrome) is already
 * locale-independent; only the model's own prose needed this.
 */
async function resolveEvaluationContent(
  evaluation: EvaluationRow,
  locale: Locale,
  userId: string | undefined,
): Promise<{
  dims: DimensionScore[];
  analysis: EvaluationAnalysis | null;
  strengths: string;
  improvements: string;
  modelAnswer: string;
}> {
  const dims = evaluation.dimension_scores ?? [];
  const analysis = evaluation.raw_response?.analysis ?? null;
  const genLocale =
    pickFilledLocale(evaluation.strengths_i18n) ??
    pickFilledLocale(evaluation.improvements_i18n) ??
    pickFilledLocale(evaluation.model_answer_i18n);

  const original = {
    dims,
    analysis,
    strengths: pickFilledText(evaluation.strengths_i18n),
    improvements: pickFilledText(evaluation.improvements_i18n),
    modelAnswer: pickFilledText(evaluation.model_answer_i18n),
  };
  if (!genLocale || genLocale === locale) return original;

  const db = supabase();
  const { data: cached } = await db
    .from("evaluation_translations")
    .select("strengths, improvements, model_answer, dimension_justifications, overall_comment, missed_key_points, factual_error_issues")
    .eq("evaluation_id", evaluation.id)
    .eq("locale", locale)
    .maybeSingle();

  const row: TranslationRow =
    (cached as TranslationRow | null) ?? (await translateAndCacheEvaluation(evaluation, locale, original, userId));

  return {
    dims: dims.map((d) => ({ ...d, justification: row.dimension_justifications[d.key] ?? d.justification })),
    analysis: analysis
      ? {
          ...analysis,
          overall_comment: row.overall_comment || analysis.overall_comment,
          missed_key_points: row.missed_key_points.length ? row.missed_key_points : analysis.missed_key_points,
          // .quote is the candidate's own answer text verbatim — never translated.
          factual_errors: analysis.factual_errors.map((e, i) => ({
            ...e,
            issue: row.factual_error_issues[i] ?? e.issue,
          })),
        }
      : null,
    strengths: row.strengths || original.strengths,
    improvements: row.improvements || original.improvements,
    modelAnswer: row.model_answer || original.modelAnswer,
  };
}

/**
 * One translateBatch call for everything this evaluation could show in the
 * other locale, so a first non-generation-locale view pays for one Haiku
 * round-trip (not five), and every view after that is a free DB read.
 */
async function translateAndCacheEvaluation(
  evaluation: EvaluationRow,
  locale: Locale,
  original: { dims: DimensionScore[]; analysis: EvaluationAnalysis | null; strengths: string; improvements: string; modelAnswer: string },
  userId: string | undefined,
): Promise<TranslationRow> {
  const dimKeys = original.dims.map((d) => d.key);
  const dimTexts = original.dims.map((d) => d.justification);
  const missedKeyPoints = original.analysis?.missed_key_points ?? [];
  const factualIssues = original.analysis?.factual_errors.map((e) => e.issue) ?? [];
  const overallComment = original.analysis?.overall_comment ?? "";

  const usage: LlmUsage[] = [];
  const translated = await translateBatch(
    [original.strengths, original.improvements, original.modelAnswer, overallComment, ...dimTexts, ...missedKeyPoints, ...factualIssues],
    locale,
    "UPPSC answer-evaluation feedback (an examiner's critique of a candidate's answer)",
    { purpose: "eval_translate", userId, onUsage: (u) => usage.push(u) },
  );

  let i = 0;
  const strengths = translated[i++] ?? "";
  const improvements = translated[i++] ?? "";
  const modelAnswer = translated[i++] ?? "";
  const overall_comment = translated[i++] ?? "";
  const dimension_justifications: Record<string, string> = {};
  for (const key of dimKeys) dimension_justifications[key] = translated[i++] ?? "";
  const missed_key_points = missedKeyPoints.map(() => translated[i++] ?? "");
  const factual_error_issues = factualIssues.map(() => translated[i++] ?? "");

  const row: TranslationRow = {
    strengths,
    improvements,
    model_answer: modelAnswer,
    dimension_justifications,
    overall_comment,
    missed_key_points,
    factual_error_issues,
  };

  const totalCost = usage.reduce((s, u) => s + u.costUsd, 0);
  const totalTokens = usage.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0);
  const db = supabase();
  // ignoreDuplicates: a race between two simultaneous first-views of the same
  // (evaluation, locale) both translating is harmless — whichever inserts
  // first wins, the loser's freshly-translated text is simply discarded
  // rather than erroring, matching question_model_answers' upsert convention.
  const { error } = await db.from("evaluation_translations").upsert(
    {
      evaluation_id: evaluation.id,
      locale,
      ...row,
      tokens_used: totalTokens,
      cost_usd: totalCost,
    },
    { onConflict: "evaluation_id,locale", ignoreDuplicates: true },
  );
  if (error) logger.warn({ error, evaluationId: evaluation.id, locale }, "failed to cache evaluation translation");

  return row;
}

/** Replay a stored evaluation over the same event protocol (idempotent GET). */
export async function replayEvaluation(
  evaluation: EvaluationRow,
  emit: EvalEmit,
  locale?: Locale,
  userId?: string,
): Promise<void> {
  const { dims, analysis, strengths, improvements, modelAnswer } = locale
    ? await resolveEvaluationContent(evaluation, locale, userId)
    : {
        dims: evaluation.dimension_scores ?? [],
        analysis: evaluation.raw_response?.analysis ?? null,
        strengths: pickFilledText(evaluation.strengths_i18n),
        improvements: pickFilledText(evaluation.improvements_i18n),
        modelAnswer: pickFilledText(evaluation.model_answer_i18n),
      };

  emit("status", { phase: "scoring" });
  for (const ds of dims) emit("dimension_score", { ...ds, max: 10 });
  if (analysis) {
    emit("analysis", {
      ...analysis,
      overall_score: Number(evaluation.overall_score ?? 0),
      max_score: Number(evaluation.max_score ?? 0),
    });
  }
  if (strengths) emit("feedback_delta", { section: "strengths", text: strengths });
  if (improvements) emit("feedback_delta", { section: "improvements", text: improvements });
  if (modelAnswer) emit("model_answer_delta", { text: modelAnswer });
  emit("done", {
    evaluation_id: evaluation.id,
    overall_score: Number(evaluation.overall_score ?? 0),
    max_score: Number(evaluation.max_score ?? 0),
  });
}

/** Convenience for the eval harness: plan then execute/replay in one call. */
export async function runEvaluation(
  userId: string,
  submissionId: string,
  emit: EvalEmit,
  signal?: AbortSignal,
): Promise<void> {
  const plan = await planEvaluation(userId, submissionId);
  if (plan.kind === "replay") {
    await replayEvaluation(plan.evaluation, emit);
    return;
  }
  await executeEvaluation(plan, emit, signal);
}

// ---------------------------------------------------------------------------
// OCR (handwritten mode) — GET /stream/ocr/:submissionId
// ---------------------------------------------------------------------------
export type OcrEmit = (event: string, data: unknown) => void;

/** Postgres `numeric` columns can come back from supabase-js as strings — mirrors mapSubmission's cast. */
function coerceConfidence(v: number | string | null): number {
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type OcrPlan =
  | { kind: "replay"; ocrText: string; confidence: number }
  | { kind: "run"; submission: SubmissionRow };

export async function planOcr(userId: string, submissionId: string): Promise<OcrPlan> {
  // Handwritten OCR is Pro-only (defense in depth — createSubmission already
  // gated the handwritten write, but the OCR stream is a separate entry point).
  await assertHandwrittenOcr(userId);
  const submission = await fetchSubmission(userId, submissionId);
  if (submission.mode !== "handwritten") {
    throw badRequest("This submission is not a handwritten (photo) submission");
  }
  if (!submission.image_paths?.length) {
    throw new HttpError(500, "Handwritten submission is missing its page images");
  }
  // A persisted transcription is the source of truth for "done": replay it
  // instead of re-billing the model, the same contract as evaluation replay.
  if (submission.ocr_text) {
    return { kind: "replay", ocrText: submission.ocr_text, confidence: coerceConfidence(submission.ocr_confidence) };
  }

  // Reclaim a submission stranded in 'ocr_processing' (a crashed run, a lost
  // disconnect-release) so a stuck row can never lock the user out permanently.
  const staleCutoff = new Date(Date.now() - STALE_OCR_MS).toISOString();
  const { error: reclaimError } = await supabase()
    .from("answer_submissions")
    .update({ status: "failed" })
    .eq("id", submissionId)
    .eq("status", "ocr_processing")
    .lt("updated_at", staleCutoff);
  if (reclaimError) logger.warn({ err: reclaimError, submissionId }, "stale-OCR reclaim failed");

  // Atomically claim this submission for transcription — the same
  // status-guarded-UPDATE pattern planEvaluation uses for 'evaluating'. This
  // closes the race where two concurrent requests (two open tabs, or a
  // confirm-screen remount) would otherwise both call the vision model and
  // race on which transcription gets persisted.
  const { data: claimed, error: claimError } = await supabase()
    .from("answer_submissions")
    .update({ status: "ocr_processing" })
    .eq("id", submissionId)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) throw new HttpError(500, `failed to claim submission for OCR: ${claimError.message}`);
  if (!claimed) {
    // Not claimable — either a genuine concurrent run is already in flight, or
    // it finished and persisted between our initial fetch and this claim
    // attempt. Re-check for that second case before reporting a conflict.
    const fresh = await fetchSubmission(userId, submissionId);
    if (fresh.ocr_text) {
      return { kind: "replay", ocrText: fresh.ocr_text, confidence: coerceConfidence(fresh.ocr_confidence) };
    }
    throw conflict("This answer is already being transcribed. Please wait for it to finish.");
  }

  return { kind: "run", submission: { ...submission, status: "ocr_processing" } };
}

export async function executeOcr(
  plan: Extract<OcrPlan, { kind: "run" }>,
  emit: OcrEmit,
  signal?: AbortSignal,
): Promise<void> {
  const { submission } = plan;
  try {
    const pages = await Promise.all((submission.image_paths ?? []).map((p) => downloadImageAsBase64(p)));
    if (signal?.aborted) return;
    const result: OcrResult = await getOcrProvider().transcribe({
      pages,
      language: submission.language,
      userId: submission.user_id,
      signal,
      onDelta: (text) => emit("delta", { text }),
    });
    if (signal?.aborted) return;
    if (!result.text.trim()) {
      // Honest failure: every page came back unreadable. status=failed but the
      // stored image_paths make this recoverable — a fresh GET on this route
      // retries the same photos with no re-upload needed.
      throw new Error("Could not read any text from the uploaded pages. Please retake the photos.");
    }
    await persistOcrResult(submission.id, result);
    emit("done", { ocr_text: result.text, ocr_confidence: result.confidence });
  } catch (err) {
    await setSubmissionStatus(submission.id, "failed").catch(() => {});
    throw err;
  }
}

async function persistOcrResult(submissionId: string, result: OcrResult): Promise<void> {
  const { error } = await supabase()
    .from("answer_submissions")
    .update({ ocr_text: result.text, ocr_confidence: result.confidence, status: "ocr_done" })
    .eq("id", submissionId);
  if (error) throw new HttpError(500, `failed to persist OCR result: ${error.message}`);
}

/**
 * PATCH /answers/submissions/:id/confirm-ocr — the trust-loop confirm step.
 * Persists the user's reviewed (and possibly edited) transcription as
 * typed_text, which is what executeEvaluation actually reads — the raw
 * ocr_text is kept untouched as an audit trail of what the model produced.
 */
export async function confirmOcr(userId: string, submissionId: string, text: string): Promise<Submission> {
  const submission = await fetchSubmission(userId, submissionId);
  if (submission.mode !== "handwritten") {
    throw badRequest("This submission is not a handwritten (photo) submission");
  }
  if (submission.status === "evaluating" || submission.status === "complete") {
    throw conflict("This answer has already been submitted for evaluation");
  }
  const { data, error } = await supabase()
    .from("answer_submissions")
    .update({ typed_text: text.trim() })
    .eq("id", submissionId)
    .select(SUBMISSION_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `failed to confirm transcription: ${error.message}`);
  return mapSubmission(data as SubmissionRow);
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
export async function setSubmissionStatus(submissionId: string, status: Submission["status"]): Promise<void> {
  const { error } = await supabase()
    .from("answer_submissions")
    .update({ status })
    .eq("id", submissionId);
  if (error) throw new HttpError(500, `failed to set submission status: ${error.message}`);
}

/**
 * Release a submission stuck in 'evaluating' (e.g. the SSE client disconnected
 * mid-run) back to 'failed', but ONLY if it is still 'evaluating' — the
 * conditional guard avoids clobbering a status the run itself already advanced
 * to 'complete' in a disconnect race. Best-effort; never throws.
 */
export async function releaseStuckEvaluation(submissionId: string): Promise<void> {
  await supabase()
    .from("answer_submissions")
    .update({ status: "failed" })
    .eq("id", submissionId)
    .eq("status", "evaluating");
}

/**
 * Release a submission stuck in 'ocr_processing' (the SSE client disconnected
 * or aborted mid-transcription) back to 'failed', but ONLY if it is still
 * 'ocr_processing' — same conditional-guard shape as releaseStuckEvaluation,
 * so a disconnect can never clobber a status the run itself already advanced
 * to 'ocr_done'. Without this, planOcr's atomic claim would strand a
 * submission for the full STALE_OCR_MS window on every abort — including the
 * harmless case of React StrictMode's dev-mode double effect invocation
 * aborting the first of two back-to-back stream opens. Best-effort; never
 * throws.
 */
export async function releaseStuckOcr(submissionId: string): Promise<void> {
  await supabase()
    .from("answer_submissions")
    .update({ status: "failed" })
    .eq("id", submissionId)
    .eq("status", "ocr_processing");
}

/**
 * Model-answer reuse (catalogued questions only): the rubric-conformant model
 * answer for a given (question, locale, rubric_version) is the same for
 * every candidate, so it is generated once and replayed for everyone after.
 */
async function fetchStoredModelAnswer(
  questionId: string,
  locale: Locale,
  rubricVersion: string,
): Promise<{ modelAnswer: string } | null> {
  const { data, error } = await supabase()
    .from("question_model_answers")
    .select("model_answer")
    .eq("question_id", questionId)
    .eq("locale", locale)
    .eq("rubric_version", rubricVersion)
    .maybeSingle();
  if (error) throw new HttpError(500, `model answer lookup failed: ${error.message}`);
  return data ? { modelAnswer: data.model_answer as string } : null;
}

/** Best-effort: a persist race between two concurrent first-evaluations of the same question just keeps whichever wrote first. */
async function persistStoredModelAnswer(
  questionId: string,
  locale: Locale,
  rubricVersion: string,
  modelAnswer: string,
  tokens: number,
  costUsd: number,
): Promise<void> {
  const { error } = await supabase()
    .from("question_model_answers")
    .upsert(
      { question_id: questionId, locale, rubric_version: rubricVersion, model_answer: modelAnswer, tokens, cost_usd: costUsd },
      { onConflict: "question_id,locale,rubric_version", ignoreDuplicates: true },
    );
  if (error) logger.warn({ error, questionId }, "failed to persist reusable model answer");
}

async function persistEvaluation(input: {
  submissionId: string;
  rubricVersion: string;
  overallScore: number;
  maxScore: number;
  dimensionScores: DimensionScore[];
  strengths_i18n: BilingualText;
  improvements_i18n: BilingualText;
  model_answer_i18n: BilingualText;
  analysis: EvaluationAnalysis;
  pass1: Pass1Result;
  grounding: Awaited<ReturnType<typeof retrieveGrounding>>;
  wordCount: number;
  wordLimit: number;
  tokensUsed: number;
  costUsd: number;
}): Promise<EvaluationRow> {
  const raw_response = {
    analysis: input.analysis,
    pass1_dimensions: input.pass1.dimensions,
    grounding: {
      chunk_count: input.grounding.chunks.length,
      node_chunk_count: input.grounding.nodeChunkCount,
      sources: input.grounding.chunks.map((c) => ({
        source_type: c.source_type,
        source_id: c.source_id,
        similarity: c.similarity,
      })),
    },
    word_count: input.wordCount,
    word_limit: input.wordLimit,
  };

  const { data, error } = await supabase()
    .from("evaluations")
    .upsert(
      {
        submission_id: input.submissionId,
        model: MODELS.sonnet,
        rubric_version: input.rubricVersion,
        overall_score: input.overallScore,
        max_score: input.maxScore,
        dimension_scores: input.dimensionScores,
        strengths_i18n: input.strengths_i18n,
        improvements_i18n: input.improvements_i18n,
        model_answer_i18n: input.model_answer_i18n,
        raw_response,
        tokens_used: input.tokensUsed,
        cost_usd: input.costUsd,
      },
      { onConflict: "submission_id" },
    )
    .select(EVALUATION_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `evaluation persist failed: ${error.message}`);
  return data as EvaluationRow;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
function mapSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    user_id: row.user_id,
    question_id: row.question_id,
    custom_question_text_i18n: row.custom_question_text_i18n,
    mode: row.mode,
    typed_text: row.typed_text,
    image_paths: row.image_paths,
    ocr_text: row.ocr_text,
    ocr_confidence: row.ocr_confidence === null ? null : Number(row.ocr_confidence),
    status: row.status,
    language: row.language,
    created_at: row.created_at,
  };
}

function mapEvaluation(row: EvaluationRow): Evaluation {
  return {
    id: row.id,
    submission_id: row.submission_id,
    model: row.model,
    rubric_version: row.rubric_version,
    overall_score: row.overall_score === null ? null : Number(row.overall_score),
    max_score: row.max_score === null ? null : Number(row.max_score),
    dimension_scores: row.dimension_scores,
    strengths_i18n: row.strengths_i18n,
    improvements_i18n: row.improvements_i18n,
    model_answer_i18n: row.model_answer_i18n,
    analysis: row.raw_response?.analysis ?? null,
    tokens_used: row.tokens_used === null ? null : Number(row.tokens_used),
    cost_usd: row.cost_usd === null ? null : Number(row.cost_usd),
    created_at: row.created_at,
  };
}

function pickFilledLocale(v: BilingualText | null): Locale | null {
  if (!v) return null;
  if (v.en?.trim()) return "en";
  if (v.hi?.trim()) return "hi";
  return null;
}

/** The non-empty side of a single-language i18n field (feedback is one locale). */
function pickFilledText(v: BilingualText | null): string {
  const loc = pickFilledLocale(v);
  return loc && v ? (v[loc] ?? "") : "";
}
