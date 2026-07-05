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
