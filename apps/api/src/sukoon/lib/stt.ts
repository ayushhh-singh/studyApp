/**
 * Speech-to-text for F10 Voice Mode: OpenAI `gpt-4o-transcribe`, with
 * `gpt-4o-mini-transcribe` as a COST FALLBACK — if the primary call fails for
 * any reason (rate limit, transient 5xx, timeout), retry once on the cheaper
 * mini model rather than failing the whole turn. This mirrors the OCR
 * provider's "a successful result must never be lost to a secondary-call
 * failure" posture (services/ocr/claude-vision-provider.ts's confidence-
 * rating fallback), just applied to the PRIMARY call here since there's no
 * secondary call in this pipeline step.
 *
 * No provider abstraction here (unlike TTS) — the blueprint names OpenAI STT
 * specifically, with no alternative vendor to evaluate.
 */
import OpenAI, { toFile } from "openai";
import type { SukoonChatLanguage } from "@neev/shared";
import { logger } from "../../lib/logger.js";

const PRIMARY_MODEL = "gpt-4o-transcribe";
const FALLBACK_MODEL = "gpt-4o-mini-transcribe";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set (apps/api/.env)");
    }
    client = new OpenAI();
  }
  return client;
}

/** ISO-639-1 hint OpenAI's transcription API accepts. "hinglish" has no real
 *  ISO code (it's a conversational register, not a language) — omit the hint
 *  entirely for it so the model auto-detects from the actual audio instead of
 *  being biased toward a single language. */
function languageHint(language: SukoonChatLanguage): string | undefined {
  return language === "hi" ? "hi" : language === "en" ? "en" : undefined;
}

/** File extension OpenAI's SDK needs on the Uploadable — it infers the format
 *  from the filename, not the mime type object, so this must be accurate. */
function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/mp4":
      return "mp4";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    default:
      return "webm";
  }
}

export interface SttResult {
  text: string;
}

async function transcribeWith(
  model: string,
  audio: Buffer,
  mimeType: string,
  language: SukoonChatLanguage,
  userId?: string,
): Promise<string> {
  const file = await toFile(audio, `turn.${extensionFor(mimeType)}`, { type: mimeType });
  const hint = languageHint(language);
  const transcription = await openai().audio.transcriptions.create({
    file,
    model,
    ...(hint ? { language: hint } : {}),
    // Nudges the model toward the wellness-chat domain and away from
    // transcribing filler/hesitation as if it were meaningful punctuation.
    prompt: "A short, casual voice message to a wellbeing companion app, possibly in Hindi, English, or a Hindi-English mix.",
  });
  void userId; // no per-call cost ledger for OpenAI audio calls (see file header) — kept for a future one.
  return transcription.text ?? "";
}

/**
 * Transcribe one voice turn. Never throws for a model-side failure on the
 * PRIMARY call — it retries once on the mini model; only a totally broken
 * pipeline (both calls fail, e.g. OPENAI_API_KEY missing/invalid) propagates.
 */
export async function transcribeVoiceTurn(params: {
  audio: Buffer;
  mimeType: string;
  language: SukoonChatLanguage;
  userId?: string;
}): Promise<SttResult> {
  try {
    const text = await transcribeWith(PRIMARY_MODEL, params.audio, params.mimeType, params.language, params.userId);
    return { text: text.trim() };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, userId: params.userId },
      "sukoon voice: primary STT model failed; retrying on the cost-fallback model",
    );
    const text = await transcribeWith(FALLBACK_MODEL, params.audio, params.mimeType, params.language, params.userId);
    return { text: text.trim() };
  }
}
