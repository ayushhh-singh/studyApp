/**
 * OCR for handwritten-mode answer submissions, behind a provider interface so
 * a fallback (e.g. Google Cloud Vision) can be added later without touching
 * any call site. Only `claudeVisionProvider` (claude-sonnet-5, which reads
 * Devanagari + English handwriting natively) is implemented today — see
 * CLAUDE.md's "OCR provider architecture" note for the intended fallback
 * shape (same interface, tried on a claude-vision low-confidence/error
 * result).
 */
import type { Locale } from "@prayasup/shared";
import { claudeVisionProvider } from "./claude-vision-provider.js";
import type { ImageMediaType } from "./storage.js";

export interface OcrPage {
  base64: string;
  mediaType: ImageMediaType;
}

export interface OcrResult {
  /** Faithful transcription; illegible spans are marked [अस्पष्ट]/[illegible]. */
  text: string;
  /** Provider's self-reported confidence, 0-1. */
  confidence: number;
}

export interface OcrTranscribeInput {
  /** Page photos in reading order. */
  pages: OcrPage[];
  language: Locale;
  userId?: string;
  /** Invoked with each text chunk as the transcription streams in. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export interface OcrProvider {
  name: string;
  transcribe(input: OcrTranscribeInput): Promise<OcrResult>;
}

export function getOcrProvider(): OcrProvider {
  return claudeVisionProvider;
}

export { ANSWER_IMAGES_BUCKET, downloadImageAsBase64 } from "./storage.js";
export type { ImageMediaType } from "./storage.js";
