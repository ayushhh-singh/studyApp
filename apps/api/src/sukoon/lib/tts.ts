/**
 * Text-to-speech for F10 Voice Mode, behind a provider interface (mirrors
 * apps/api/src/services/ocr/index.ts's `OcrProvider` pattern) so the vendor is
 * env-selected and swappable without touching the voice pipeline:
 *
 *   - `openAiTtsProvider`  — gpt-4o-mini-tts. The default; fully exercised by
 *     this codebase already (OPENAI_API_KEY is a required env var everywhere
 *     else too — see apps/api/.env.example).
 *   - `sarvamTtsProvider`  — Bulbul (bulbul:v2), Sarvam AI's Indian-language
 *     TTS (blueprint: "evaluate in build — likely best Hindi naturalness per
 *     rupee"). Implemented against Sarvam's real documented REST contract
 *     (POST https://api.sarvam.ai/text-to-speech, `api-subscription-key`
 *     header, `{audios:[base64 wav]}` response) — but this session has no
 *     SARVAM_API_KEY configured anywhere in the repo, so unlike the OpenAI
 *     path this has NOT been exercised against a live key. Select it via
 *     SUKOON_TTS_PROVIDER=sarvam once a key is added and the naturalness
 *     comparison the blueprint asks for has actually been run.
 *
 * getTtsProvider() reads sukoonConfig.ttsProvider (env-selected, one place).
 */
import OpenAI from "openai";
import type { SukoonChatLanguage } from "@neev/shared";
import { logger } from "../../lib/logger.js";
import { sukoonConfig } from "../config.js";

export interface TtsResult {
  audioBase64: string;
  mimeType: string;
}

/**
 * Abstract voice choice (the meditation "voice" control). Provider-neutral:
 * each provider maps it to a real speaker id below, falling back to the
 * language default for an unknown/omitted value. Voice Mode (services/voice.ts)
 * never passes this, so it always gets the warm default — unchanged behaviour.
 */
export type TtsVoiceChoice = "warm" | "calm" | "bright";

export interface TtsProvider {
  name: string;
  synthesize(params: {
    text: string;
    language: SukoonChatLanguage;
    /** Optional voice pick (personalized meditations); defaults to the warm
     *  per-language voice when omitted. */
    voice?: TtsVoiceChoice;
    userId?: string;
    signal?: AbortSignal;
  }): Promise<TtsResult>;
}

// ---------------------------------------------------------------------------
// OpenAI (default)
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;
function openai(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set (apps/api/.env)");
    }
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

/** Per-language delivery instructions (blueprint: "per-language voice config")
 *  — one warm, unhurried voice id, with the SPOKEN LANGUAGE steered by the
 *  reply text itself (already in the right register) and the pacing/tone
 *  steered by `instructions`. gpt-4o-mini-tts renders Hindi/Hinglish text
 *  naturally without a language selector — there isn't one in this API. */
const OPENAI_VOICE_CONFIG: Record<SukoonChatLanguage, { voice: string; instructions: string }> = {
  hi: {
    voice: "shimmer",
    instructions: "Speak warmly and gently in natural, everyday Hindi — like a caring friend, unhurried, soft pace.",
  },
  en: {
    voice: "shimmer",
    instructions: "Speak warmly and gently in natural English — like a caring friend, unhurried, soft pace.",
  },
  hinglish: {
    voice: "shimmer",
    instructions:
      "Speak warmly in a natural, effortless Hindi-English mix, exactly as written — like a caring friend, unhurried, soft pace.",
  },
};

/** Abstract voice → real OpenAI speaker. `warm` is the per-language default
 *  (shimmer, same as Voice Mode); the other two are calm/bright alternatives
 *  that read a meditation naturally. */
const OPENAI_VOICE_BY_CHOICE: Record<TtsVoiceChoice, string> = {
  warm: "shimmer",
  calm: "sage",
  bright: "nova",
};

export const openAiTtsProvider: TtsProvider = {
  name: "openai:gpt-4o-mini-tts",
  async synthesize({ text, language, voice, signal }): Promise<TtsResult> {
    const cfg = OPENAI_VOICE_CONFIG[language];
    const res = await openai().audio.speech.create(
      {
        model: "gpt-4o-mini-tts",
        voice: voice ? OPENAI_VOICE_BY_CHOICE[voice] : cfg.voice,
        input: text,
        instructions: cfg.instructions,
        response_format: "mp3",
      },
      signal ? { signal } : undefined,
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    return { audioBase64: buffer.toString("base64"), mimeType: "audio/mpeg" };
  },
};

// ---------------------------------------------------------------------------
// Sarvam AI Bulbul
// ---------------------------------------------------------------------------

const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";
const SARVAM_MODEL = "bulbul:v2";

/** BCP-47 target_language_code Sarvam expects. Bulbul is documented to handle
 *  natural Hindi-English code-mixing WITHIN the Hindi locale, so hinglish maps
 *  to hi-IN rather than needing (or having) a locale of its own. */
const SARVAM_LANGUAGE_CODE: Record<SukoonChatLanguage, string> = {
  hi: "hi-IN",
  en: "en-IN",
  hinglish: "hi-IN",
};

/** One warm female voice per language — Sarvam's speaker ids are per-model,
 *  not documented as language-restricted, so the same speaker id is used for
 *  both language codes (blueprint: "per-language voice config" is satisfied
 *  by `target_language_code` driving the actual phonetics; `speaker` is just
 *  which voice timbre reads it). */
const SARVAM_SPEAKER = "anushka";

/** Abstract voice → real Sarvam bulbul:v2 speaker (best-effort — Sarvam is not
 *  exercised in this repo; unknown ids simply fall back at the API). */
const SARVAM_SPEAKER_BY_CHOICE: Record<TtsVoiceChoice, string> = {
  warm: "anushka",
  calm: "vidya",
  bright: "manisha",
};

interface SarvamTtsResponse {
  audios?: string[];
}

export const sarvamTtsProvider: TtsProvider = {
  name: "sarvam:bulbul-v2",
  async synthesize({ text, language, voice, signal }): Promise<TtsResult> {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      throw new Error("SARVAM_API_KEY is not set (apps/api/.env) — required when SUKOON_TTS_PROVIDER=sarvam");
    }
    const res = await fetch(SARVAM_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        text,
        target_language_code: SARVAM_LANGUAGE_CODE[language],
        model: SARVAM_MODEL,
        speaker: voice ? SARVAM_SPEAKER_BY_CHOICE[voice] : SARVAM_SPEAKER,
        output_audio_codec: "wav",
      }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Sarvam TTS request failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as SarvamTtsResponse;
    const audioBase64 = json.audios?.[0];
    if (!audioBase64) throw new Error("Sarvam TTS returned no audio");
    return { audioBase64, mimeType: "audio/wav" };
  },
};

// ---------------------------------------------------------------------------

export function getTtsProvider(): TtsProvider {
  if (sukoonConfig.ttsProvider === "sarvam") {
    logger.info("sukoon voice: using Sarvam Bulbul TTS provider (SUKOON_TTS_PROVIDER=sarvam)");
    return sarvamTtsProvider;
  }
  return openAiTtsProvider;
}
