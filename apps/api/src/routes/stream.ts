import { Router } from "express";
import { z } from "zod";
import { localeSchema, type BilingualText } from "@prayasup/shared";
import { createSseConnection } from "../lib/sse.js";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { MODELS, streamText, translate } from "../lib/anthropic.js";
import { getQuestionForExplain, persistQuestionExplanation } from "../services/questions.js";
import {
  executeEvaluation,
  executeOcr,
  planEvaluation,
  planOcr,
  releaseStuckEvaluation,
  releaseStuckOcr,
  replayEvaluation,
  type EvalEmit,
  type OcrEmit,
} from "../services/evaluation/evaluate.js";

export const streamRouter = Router();

streamRouter.get("/stream/ping", (req, res) => {
  const { send, close } = createSseConnection(req, res);

  let tick = 0;
  const interval = setInterval(() => {
    tick += 1;
    send("ping", { tick, at: new Date().toISOString() });
    if (tick >= 5) {
      clearInterval(interval);
      close();
    }
  }, 1000);

  req.on("close", () => clearInterval(interval));
});

const explainParamsSchema = z.object({ questionId: z.string().uuid() });
const explainQuerySchema = z.object({ locale: localeSchema });

/**
 * On-demand MCQ explanation for questions ingested without one. Generates in
 * the requesting locale with claude-haiku-4-5, then batch-translates the
 * other locale and persists both — a second request for the same question
 * (any locale) short-circuits to the now-stored explanation_i18n instead of
 * calling the model again.
 */
streamRouter.get(
  "/stream/explain/:questionId",
  rateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const { questionId } = parse(explainParamsSchema, req.params);
    const { locale } = parse(explainQuerySchema, req.query);

    const { send, close } = createSseConnection(req, res);
    try {
      const question = await getQuestionForExplain(questionId);
      if (question.explanation_i18n) {
        // Any existing explanation_i18n — even one with only a single locale
        // filled in from ingestion — is returned as-is. Regenerating here
        // would silently overwrite content persistQuestionExplanation's own
        // write-layer guard is meant to protect.
        send("done", { explanation_i18n: question.explanation_i18n });
        return;
      }

      const optionsText = (question.options_i18n ?? [])
        .map((o) => `${o.key}. ${o.text_i18n[locale]}`)
        .join("\n");
      const correctOption = (question.options_i18n ?? []).find((o) => o.key === question.correct_option_key);

      let generated = "";
      await streamText({
        model: MODELS.haiku,
        system:
          "You explain UPPSC (UP PCS) MCQ answers for exam aspirants. Be concise (3-5 sentences), " +
          "state why the correct option is right and briefly why the others are wrong. Output plain " +
          "prose only, rendered verbatim with no markdown renderer: no headers, no bold/italic " +
          "asterisks, no bullet lists.",
        content:
          `Question:\n${question.stem_i18n[locale]}\n\nOptions:\n${optionsText}\n\n` +
          `Correct answer: ${question.correct_option_key ?? "unknown"}` +
          (correctOption ? ` (${correctOption.text_i18n[locale]})` : "") +
          `\n\nExplain this answer in ${locale === "hi" ? "Hindi (Devanagari)" : "English"}.`,
        purpose: "mcq_explanation",
        userId: devUserId(),
        onDelta: (delta) => {
          generated += delta;
          send("delta", { text: delta });
        },
      });

      const otherLocale = locale === "en" ? "hi" : "en";
      const otherText = await translate(generated.trim(), otherLocale, "UPPSC MCQ explanation");
      const explanation_i18n: BilingualText =
        locale === "en" ? { en: generated.trim(), hi: otherText } : { en: otherText, hi: generated.trim() };

      await persistQuestionExplanation(questionId, explanation_i18n);
      send("done", { explanation_i18n });
    } catch (err) {
      send("error", { message: err instanceof Error ? err.message : "Failed to generate explanation" });
    } finally {
      close();
    }
  }),
);

const ocrParamsSchema = z.object({ submissionId: z.string().uuid() });

/**
 * Transcribes a handwritten-mode submission's page photos, streamed as SSE —
 * the first half of the trust loop on the confirm screen (transcribe here,
 * then PATCH /answers/submissions/:id/confirm-ocr once the user has reviewed
 * it). Event order: delta ×N -> done. A submission that already has ocr_text
 * replays it as a single "done" instead of re-billing the model. On failure
 * (e.g. every page came back unreadable) the submission is marked 'failed'
 * but stays recoverable — a fresh GET on this route retries the same stored
 * photos with no re-upload needed.
 */
streamRouter.get(
  "/stream/ocr/:submissionId",
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const { submissionId } = parse(ocrParamsSchema, req.params);

    // Pre-flight before opening SSE so 404/400 return as JSON, not a stream.
    const plan = await planOcr(devUserId(), submissionId);

    const { send, close } = createSseConnection(req, res);
    const emit: OcrEmit = (event, data) => {
      if (!res.writableEnded) send(event, data);
    };

    let finished = false;
    const abort = new AbortController();
    req.on("close", () => {
      // Cancel the in-flight sonnet stream so a closed tab/aborted request
      // stops billing tokens.
      abort.abort();
      // A 'run' plan already claimed the submission ('ocr_processing'); if the
      // client vanished (or, in dev, React StrictMode's double-effect aborted
      // the first of two back-to-back opens) before we finished, release it so
      // it isn't stuck for the full stale-reclaim window.
      if (plan.kind === "run" && !finished) {
        void releaseStuckOcr(submissionId);
      }
    });

    try {
      if (plan.kind === "replay") {
        emit("done", { ocr_text: plan.ocrText, ocr_confidence: plan.confidence });
      } else {
        await executeOcr(plan, emit, abort.signal);
      }
      finished = true;
    } catch (err) {
      emit("error", { message: err instanceof Error ? err.message : "Transcription failed" });
    } finally {
      close();
    }
  }),
);

const evaluationParamsSchema = z.object({ submissionId: z.string().uuid() });

/**
 * Two-pass AI evaluation of a descriptive answer submission, streamed as SSE.
 *
 * Guardrails (existence 404, one-concurrent-per-user 409, off-topic honesty)
 * run in planEvaluation BEFORE the stream opens, so they surface as real JSON
 * HTTP errors. Event order: status -> dimension_score (x6) -> analysis ->
 * feedback_delta (strengths, then improvements) -> model_answer_delta -> done.
 * A completed submission replays its stored evaluation instead of re-billing.
 */
streamRouter.get(
  "/stream/evaluations/:submissionId",
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const { submissionId } = parse(evaluationParamsSchema, req.params);

    // Pre-flight before opening SSE so 404/409/400 return as JSON, not a stream.
    const plan = await planEvaluation(devUserId(), submissionId);

    const { send, close } = createSseConnection(req, res);
    const emit: EvalEmit = (event, data) => {
      if (!res.writableEnded) send(event, data);
    };

    let finished = false;
    const abort = new AbortController();
    req.on("close", () => {
      // Cancel the in-flight sonnet stream so a closed tab stops billing tokens.
      abort.abort();
      // A 'run' plan already claimed the submission ('evaluating'); if the client
      // vanished before we finished, release it so it isn't stuck forever.
      if (plan.kind === "run" && !finished) {
        void releaseStuckEvaluation(submissionId);
      }
    });

    try {
      if (plan.kind === "replay") {
        replayEvaluation(plan.evaluation, emit);
      } else {
        await executeEvaluation(plan, emit, abort.signal);
      }
      finished = true;
    } catch (err) {
      emit("error", { message: err instanceof Error ? err.message : "Evaluation failed" });
    } finally {
      close();
    }
  }),
);
