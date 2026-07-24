/**
 * F10 Voice Mode pipeline. Half-duplex push-to-talk, ONE turn per call —
 * unlike chat.ts's `/chat/stream` this is a plain POST/JSON endpoint, not SSE:
 * a voice turn's "streaming" is the audio PLAYBACK experience on the client
 * (see routes.tsx's saathi-voice page), not a token-by-token text stream —
 * there is no partial-transcript or partial-reply UI to feed. Recording →
 * transcript → reply text → reply audio all resolve before the single
 * response is sent, keeping the pipeline simple (blueprint: "5-10x cheaper,
 * simpler, good enough for a companion" — the same rationale the blueprint
 * gives for half-duplex over the realtime API applies again here to skip
 * inventing a binary-streaming response format).
 *
 * Reuses chat.ts's preflight/context/persistence/summary helpers so the
 * "same prompts/caps/summaries as chat" requirement can't drift between the
 * two surfaces — see chat.ts's header for the parts THIS file doesn't repeat.
 *
 * Turn order (mirrors executeChatStream's ordering, adapted for a single
 * response instead of an event stream):
 *   1. STT (transcribe the recording).
 *   2. Crisis engine on the transcript — ALWAYS runs, even if the user is
 *      already over their monthly voice-minute cap (a crisis must never be
 *      silenced by a quota — same posture as chat's cap-vs-crisis ordering).
 *   3. high/critical or anti-doom-loop → handoff: persist the user turn,
 *      DO NOT spend any voice-minute budget on it (mirrors chat: a crisis
 *      handoff bypasses the cap entirely, never counts against it), return
 *      with no assistant reply/audio — the client shows the SAME
 *      <CrisisTakeover/> component as text chat.
 *   4. Otherwise: NOW check the monthly cap (a real reply is about to be
 *      generated and spoken, which is what the cap actually protects). Over
 *      cap → 402 (feature: sukoon_voice_cap), nothing persisted — mirrors
 *      chat's "an over-cap send doesn't even create a conversation".
 *   5. semantic-cache read (skipped for `moderate`, exactly like chat) → else
 *      a real model reply (Haiku, escalate to Sonnet on `moderate` or a long
 *      transcript) with the SAME persona + an added VOICE_REPLY_DIRECTIVE
 *      (speakable prose, no markdown/lists/emoji).
 *   6. TTS the reply text via the configured provider.
 *   7. Persist both turns, meter the turn's seconds, refresh the rolling
 *      summary on the same 10-message cadence as chat.
 */
import {
  crisisSurface,
  SUKOON_VOICE_MAX_TURN_SECONDS,
  type SukoonChatCrisisEvent,
  type SukoonChatLanguage,
  type SukoonVoiceTurnBody,
  type SukoonVoiceTurnResult,
  type SukoonVoiceUsage,
} from "@neev/shared";
import { HttpError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { MODELS } from "../../lib/models.js";
import { streamChat, type PromptSegment } from "../../lib/anthropic.js";
import { assessMessage } from "./crisis/engine.js";
import { matchSukoonFaq } from "./semantic-cache.js";
import { consumeVoiceSeconds, getVoiceUsage, getSukoonTier } from "./entitlements.js";
import { transcribeVoiceTurn } from "../lib/stt.js";
import { getTtsProvider } from "../lib/tts.js";
import {
  createConversation,
  loadRecentTurns,
  loadSaathiContext,
  LONG_MESSAGE_WORDS,
  maybeRefreshSummary,
  persistMessage,
  preflightConversation,
  toAlternating,
  touchConversation,
  wordCount,
  type ConversationPreflight,
} from "./chat.js";
import { SAATHI_PERSONA, MODERATE_CARE_DIRECTIVE, VOICE_REPLY_DIRECTIVE, buildContextTail } from "../prompts/saathi.js";

/** Voice replies are shorter than typed ones — listening to a wall of speech
 *  is more taxing than reading one, and it bounds both playback length and
 *  the estimated seconds metered against the monthly cap. */
const VOICE_REPLY_MAX_TOKENS = 300;

/**
 * Language-agnostic natural-speech rate used to ESTIMATE the TTS reply's
 * duration for metering, since no provider reports exact spoken duration
 * before (or without) actually synthesizing the audio — this is the same
 * character-rate approach TTS vendors themselves use for pre-flight cost
 * quotes. A disclosed approximation, not an exact figure; the recorded INPUT
 * side of the meter (below) is exact (client-measured), so only the reply
 * half of any turn's metering carries this estimate's error margin.
 */
const SPEECH_CHARS_PER_SECOND = 15;
function estimateSpeechSeconds(text: string): number {
  return Math.max(1, Math.ceil(text.length / SPEECH_CHARS_PER_SECOND));
}

/** One-in-flight-turn-per-user guard, independent of chat's own lock (a stuck
 *  voice call must never lock out text chat, or vice versa) — same in-process
 *  Set pattern as chat.ts's acquireChatStream/releaseChatStream. */
const activeVoiceTurns = new Set<string>();

export function acquireVoiceTurn(userId: string): boolean {
  if (activeVoiceTurns.has(userId)) return false;
  activeVoiceTurns.add(userId);
  return true;
}

export function releaseVoiceTurn(userId: string): void {
  activeVoiceTurns.delete(userId);
}

export interface VoicePlan extends ConversationPreflight {}

/**
 * Pre-flight: onboarding/restricted/conversation-ownership (shared with chat)
 * PLUS the Pro-tier gate — checked here, BEFORE any audio is even decoded, so
 * a free/plus caller never reaches STT (no OpenAI cost spent on an ineligible
 * request). The MINUTE cap is deliberately NOT checked here (see the file
 * header — it's checked later, after the crisis engine has had a chance to
 * run on the transcript).
 */
export async function planVoiceTurn(
  userId: string,
  conversationId: string | null | undefined,
): Promise<VoicePlan> {
  const pre = await preflightConversation(userId, conversationId);
  const tier = await getSukoonTier(userId);
  if (tier !== "pro") {
    throw new HttpError(402, "Voice Mode is a Sukoon Pro feature.", { feature: "sukoon_voice_pro" });
  }
  return pre;
}

/** Decode + sanity-check the recorded clip before spending anything on it. */
function decodeAudio(body: SukoonVoiceTurnBody): Buffer {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(body.audio_base64, "base64");
  } catch {
    throw new HttpError(400, "Couldn't read that recording — please try again.");
  }
  if (buffer.length < 200) {
    throw new HttpError(400, "That recording was too short to hear anything — try holding a little longer.");
  }
  return buffer;
}

export async function executeVoiceTurn(
  userId: string,
  plan: VoicePlan,
  body: SukoonVoiceTurnBody,
  signal: AbortSignal,
): Promise<SukoonVoiceTurnResult> {
  const { profile } = plan;
  const language = profile.language as SukoonChatLanguage;
  const audio = decodeAudio(body);
  const inputSeconds = Math.min(SUKOON_VOICE_MAX_TURN_SECONDS, Math.max(0, Math.round(body.duration_seconds)));

  // 1) Transcribe.
  const { text: transcript } = await transcribeVoiceTurn({
    audio,
    mimeType: body.mime_type,
    language,
    userId,
    signal,
  });
  if (!transcript.trim()) {
    throw new HttpError(400, "Didn't catch that — please try again.", { feature: "sukoon_voice_empty" });
  }

  // 2) Crisis engine — ALWAYS runs, cap or no cap (see file header).
  const assessment = await assessMessage(userId, transcript, { signal });
  const level = assessment.level;
  const surface = crisisSurface(level);
  const handoff = surface === "takeover" || assessment.rate_limited;

  if (handoff) {
    // Same reasoning as executeChatStream's handoff branch: only record the
    // message into an ALREADY-open conversation. A lone crisis turn with no
    // prior conversation gets no new one minted for it (the crisis event is
    // already logged, privacy-first; a bare takeover thread would just
    // clutter history and hand a cap-bypass abuse surface).
    if (plan.conversationId) {
      await persistMessage(plan.conversationId, "user", transcript, { crisis_level: level, channel: "voice" });
      await touchConversation(plan.conversationId);
    }
    const usage = await getVoiceUsage(userId);
    return {
      conversation_id: plan.conversationId,
      user_transcript: transcript,
      assistant_text: null,
      assistant_audio_base64: null,
      assistant_audio_mime: null,
      crisis: { level, surface: "takeover" },
      usage,
    };
  }

  // 3) The monthly minute cap — checked NOW, since a real reply is about to
  //    be generated and spoken (see file header for why this isn't step 1).
  const usageBefore = await getVoiceUsage(userId);
  if (usageBefore.remaining_seconds <= 0) {
    throw new HttpError(
      402,
      "You've used all your voice minutes for this month — they refresh on the 1st. Typed chat is always here.",
      { feature: "sukoon_voice_cap" },
    );
  }

  // 4) Commit to the turn: create the conversation now, persist the user turn,
  //    load prior turns BEFORE inserting this one (mirrors executeChatStream).
  const conversationId = plan.conversationId ?? (await createConversation(userId, transcript));
  const recentTurns = await loadRecentTurns(conversationId);
  await persistMessage(conversationId, "user", transcript, { crisis_level: level, channel: "voice" });

  const ctx = await loadSaathiContext(userId, profile);
  const crisisEvent: SukoonChatCrisisEvent | null = surface === "inline" ? { level, surface } : null;

  // 5) Semantic-cache read (skipped for `moderate`, exactly like chat) → else a
  //    real model reply, escalating on `moderate` or a long spoken transcript
  //    (the exact same rule chat.ts applies to a typed message).
  let replyText: string | null = null;
  let modelUsed = "cache";
  if (surface !== "inline") {
    replyText = await matchSukoonFaq(transcript, language, ctx.name);
  }
  if (replyText === null) {
    const escalate = surface === "inline" || wordCount(transcript) > LONG_MESSAGE_WORDS;
    const model = escalate ? MODELS.sonnet : MODELS.haiku;
    const system: PromptSegment[] = [
      ...SAATHI_PERSONA,
      buildContextTail(ctx),
      ...(surface === "inline" ? [MODERATE_CARE_DIRECTIVE] : []),
      VOICE_REPLY_DIRECTIVE,
    ];
    const messages = toAlternating([...recentTurns, { role: "user", content: transcript }]);
    replyText = await streamChat({
      model,
      system,
      messages,
      maxTokens: VOICE_REPLY_MAX_TOKENS,
      // haiku rejects `effort`; Sonnet takes low effort — a warm, brief spoken
      // reply doesn't need deep reasoning (mirrors chat's own choice).
      ...(model === MODELS.sonnet ? { effort: "low" as const } : {}),
      purpose: "sukoon_saathi_voice_chat",
      userId,
      signal,
    });
    modelUsed = model;
  }

  // 6) TTS the reply — degrade to a TEXT-ONLY reply on a TTS failure rather
  //    than discarding an already-generated (already-billed) reply outright:
  //    the client already renders assistant_text as a caption card even with
  //    no audio to play, so a transient TTS hiccup costs the user nothing but
  //    the spoken half of this one turn. An ABORT (the caller disconnected)
  //    still propagates — there is no one left to degrade gracefully FOR.
  //    Only counts reply-seconds against the cap when audio was ACTUALLY
  //    produced (no voice minutes for a voice that never spoke).
  const provider = getTtsProvider();
  let audioBase64: string | null = null;
  let mimeType: string | null = null;
  let replySeconds = 0;
  try {
    const speech = await provider.synthesize({ text: replyText, language, userId, signal });
    audioBase64 = speech.audioBase64;
    mimeType = speech.mimeType;
    replySeconds = estimateSpeechSeconds(replyText);
  } catch (err) {
    if (signal.aborted) throw err;
    logger.warn(
      { err: err instanceof Error ? err.message : err, userId, provider: provider.name },
      "sukoon voice: TTS failed; degrading to a text-only reply",
    );
  }

  // 7) Persist, meter, refresh summary.
  await persistMessage(conversationId, "assistant", replyText, {
    model_used: modelUsed,
    channel: "voice",
    ...(surface === "inline" ? { crisis_level: level } : {}),
  });
  await touchConversation(conversationId);

  const usage = await consumeVoiceSeconds(userId, inputSeconds + replySeconds);

  void maybeRefreshSummary(userId, conversationId);

  logger.info(
    { userId, conversationId, inputSeconds, replySeconds, provider: provider.name, hadAudio: !!audioBase64 },
    "sukoon voice: turn complete",
  );

  return {
    conversation_id: conversationId,
    user_transcript: transcript,
    assistant_text: replyText,
    assistant_audio_base64: audioBase64,
    assistant_audio_mime: mimeType,
    crisis: crisisEvent,
    usage,
  };
}

export type { SukoonVoiceUsage };
