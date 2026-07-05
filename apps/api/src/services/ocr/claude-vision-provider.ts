/**
 * Default OCR provider: claude-sonnet-5 vision. Two calls per transcription —
 * a streamed plain-text pass (so the trust-loop confirm screen can show the
 * transcription appearing live, the same way evaluation feedback streams),
 * then a fast, cheap self-reported confidence rating. See ./index.ts for the
 * provider interface this implements.
 */
import type { Locale } from "@prayasup/shared";
import { MODELS, streamText, structuredJson } from "../../lib/anthropic.js";
import { logger } from "../../lib/logger.js";
import type { OcrPage, OcrProvider, OcrResult } from "./index.js";

function langName(locale: Locale): string {
  return locale === "hi" ? "Hindi (Devanagari script)" : "English";
}

function buildTranscribeSystem(language: Locale): string {
  return (
    "You transcribe photographed pages of a handwritten UPPSC Mains exam answer. The pages are " +
    "given in order; treat them as one continuous answer and transcribe them in that order. " +
    `Transcribe EXACTLY what is written — the answer is primarily in ${langName(language)}, but a ` +
    "candidate may mix Hindi and English words; transcribe each word in the script it was actually " +
    "written in, never translate. Preserve structure: keep headings, paragraph breaks, and " +
    "numbered or bulleted points on their own lines, matching the page layout. Mark any word or " +
    "short phrase you cannot confidently read as [अस्पष्ट] if the surrounding text is Hindi, or " +
    "[illegible] if it is English — never guess a plausible-sounding replacement for text you " +
    "cannot actually read. Output ONLY the transcription: no preamble, no page markers, no " +
    "commentary, no markdown."
  );
}

function buildConfidenceSystem(): string {
  return (
    "You just transcribed a handwritten answer from photographs. Rate your own confidence in the " +
    "transcription's accuracy as a single number from 0 to 1: 1.0 means every word was clearly " +
    "legible and you are confident nothing was misread; lower scores mean more of the source text " +
    "was blurry, cramped, faint, or had to be marked illegible. Be honest, not generous — this " +
    "score tells the candidate whether to re-check the text carefully before it is scored."
  );
}

function imageBlocks(pages: OcrPage[]) {
  return pages.map((p) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
  }));
}

/**
 * Heuristic confidence fallback if the self-rating call itself fails — derived
 * from how much of the transcription had to be marked illegible, so a
 * transient API error on the (cheap, secondary) rating call never discards a
 * transcription the user already watched stream in successfully.
 */
function estimateConfidenceFromMarkers(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const markers = (text.match(/\[अस्पष्ट\]|\[illegible\]/g) ?? []).length;
  return Math.max(0, Math.min(1, 1 - markers / words.length));
}

export const claudeVisionProvider: OcrProvider = {
  name: "claude-vision",
  async transcribe({ pages, language, userId, onDelta, signal }): Promise<OcrResult> {
    const content = [
      {
        type: "text" as const,
        text: `${pages.length} page photo${pages.length === 1 ? "" : "s"} of a handwritten answer, in order:`,
      },
      ...imageBlocks(pages),
    ];

    let text = "";
    await streamText({
      model: MODELS.sonnet,
      // Fixed per language — cached so it's a cache read, not a fresh input
      // token cost, for every other student's transcription in that language.
      system: [{ text: buildTranscribeSystem(language), cache: true }],
      content,
      maxTokens: 4000,
      purpose: "answer_ocr_transcribe",
      userId,
      signal,
      onDelta: (delta) => {
        text += delta;
        onDelta?.(delta);
      },
    });

    const trimmed = text.trim();
    if (!trimmed) return { text: "", confidence: 0 };

    // A successful transcription must never be lost because of the secondary
    // confidence call — fall back to a marker-density heuristic on failure
    // rather than letting the whole transcribe() promise reject.
    let confidence: number;
    try {
      const confidenceResult = await structuredJson<{ confidence: number }>({
        model: MODELS.sonnet,
        effort: "low",
        system: buildConfidenceSystem(),
        content: `TRANSCRIPTION:\n<<<\n${trimmed}\n>>>`,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { confidence: { type: "number" } },
          required: ["confidence"],
        },
        maxTokens: 200,
        purpose: "answer_ocr_confidence",
        userId,
        signal,
      });
      confidence = Math.min(1, Math.max(0, confidenceResult.confidence));
    } catch (err) {
      logger.warn({ err }, "OCR confidence self-rating failed; using marker-density heuristic instead");
      confidence = estimateConfidenceFromMarkers(trimmed);
    }

    return { text: trimmed, confidence };
  },
};
