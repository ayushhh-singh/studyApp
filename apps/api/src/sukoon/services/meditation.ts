/**
 * Personalized guided-meditation service (extends F6). Turns what a person just
 * shared — a Saathi conversation's rolling memory, or a recent mood check-in —
 * into ONE short, personally-addressed guided meditation: an LLM-authored
 * speakable script (claude-haiku-4-5, with a REAL prompt-cache hit on its large
 * instructional head — see prompts/meditation.ts), narrated by the Voice-Mode
 * TTS provider, and played over a real ambient bed (S2 soundscapes) client-side.
 *
 * COST DISCIPLINE (blueprint MODELS & COST rules):
 *   - The static instructional head is a genuine prompt-cache breakpoint (>4096
 *     tokens, Haiku's minimum), so every generation after the first in a 5-min
 *     window reads it at 0.1x instead of paying full input each time.
 *   - Generate-once / serve-many: a generated meditation (script + its rendered
 *     TTS audio) is CACHED in sukoon_meditations keyed by a deterministic
 *     cache_key + context_hash. An identical request within the same unchanged
 *     context replays the stored row — no LLM call, no TTS render, no allowance
 *     consumed. The one-time TTS render (the most expensive part) never repeats
 *     for the same meditation.
 *   - Generation is metered against a per-tier allowance (entitlements) — free
 *     gets a small lifetime taste, plus/pro a generous daily budget. A REPLAY is
 *     always free.
 *
 * SAFETY: the acknowledged "theme" is always derived SERVER-SIDE from the user's
 * own sanitized signals (the rolling chat summary — already a neutral, no-verbatim
 * compression — or a mood score/emotions phrase), never from client input, and is
 * fed to the prompt only as a gentle label to acknowledge once. The prompt's
 * cached head carries the non-negotiable no-clinical-words / no-diagnosis framing.
 */
import { createHash } from "node:crypto";
import {
  SUKOON_AMBIENT_IDS,
  type SukoonAmbientId,
  type SukoonChatLanguage,
  type SukoonEmotionId,
  type SukoonMeditation,
  type SukoonMeditationContext,
  type SukoonMeditationFocus,
  type SukoonMeditationGenerateBody,
  type SukoonMeditationListItem,
  type SukoonMeditationSource,
  type SukoonMeditationUsage,
  type SukoonMeditationVoice,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { HttpError, notFound } from "../../lib/http-error.js";
import { MODELS } from "../../lib/models.js";
import { streamText } from "../../lib/anthropic.js";
import { getSukoonProfile } from "./profile.js";
import { getMeditationUsage, consumeMeditation } from "./entitlements.js";
import { recordSukoonEvent } from "./analytics.js";
import { getTtsProvider } from "../lib/tts.js";
import { signAudioPath, uploadAudioPath } from "../lib/storage.js";
import {
  MEDITATION_SYSTEM,
  MEDITATION_USER_INSTRUCTION,
  buildMeditationContextTail,
  type MeditationContext,
} from "../prompts/meditation.js";

/** Script length ceiling — a 10-min meditation is ~780 words; give headroom for
 *  Devanagari (more tokens/char) without inviting a padded, over-long script. */
const SCRIPT_MAX_TOKENS = 3000;

/** One-in-flight-generation-per-user guard (its own lock, independent of chat/
 *  voice) so a stuck generation never blocks another Sukoon surface, and a user
 *  can't fire several expensive generations at once. */
const activeGenerations = new Set<string>();
export function acquireMeditation(userId: string): boolean {
  if (activeGenerations.has(userId)) return false;
  activeGenerations.add(userId);
  return true;
}
export function releaseMeditation(userId: string): void {
  activeGenerations.delete(userId);
}

// ---------------------------------------------------------------------------
// Context inference — the SETUP screen's smart defaults + the theme the
// generator gently acknowledges. Both read only sanitized server-side signals.
// ---------------------------------------------------------------------------

/** Map a dominant recent emotion to the meditation focus most likely to help. */
function emotionToFocus(emotion: SukoonEmotionId | null, lowScore: boolean): SukoonMeditationFocus {
  switch (emotion) {
    case "anxious":
    case "restless":
    case "overwhelmed":
      return "ease_worry";
    case "sad":
    case "lonely":
    case "exhausted":
      return "self_kindness";
    case "frustrated":
      return "unwind";
    default:
      return lowScore ? "self_kindness" : "unwind";
  }
}

interface MoodSignal {
  score: number;
  emotions: SukoonEmotionId[];
}

/** The latest mood check-in (F5), or null. Sanitized: score + a few emotion ids only. */
async function latestMood(userId: string): Promise<MoodSignal | null> {
  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .select("score, emotions, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { score: number; emotions: unknown };
  const emotions = Array.isArray(row.emotions) ? (row.emotions.filter(Boolean) as SukoonEmotionId[]) : [];
  return { score: row.score, emotions };
}

/** The user's rolling chat memory (sukoon_chat_summaries) — a neutral, no-verbatim
 *  ≤100-token compression by construction (see services/chat.ts). Safe to use as
 *  the acknowledged theme; still never restated specifically by the prompt. */
async function rollingChatSummary(userId: string): Promise<string | null> {
  const { data, error } = await supabase()
    .from("sukoon_chat_summaries")
    .select("summary")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const s = (data as { summary: string | null }).summary;
  return s && s.trim() ? s.trim() : null;
}

/** A gentle, non-clinical phrase describing a mood signal (for BOTH the UI chip
 *  and the generator's acknowledgement). Never names a condition. */
function moodThemeLabel(mood: MoodSignal): { hi: string; en: string } {
  const em = mood.emotions[0] ?? null;
  if (mood.score <= 2) {
    return { en: "a low, tired stretch lately", hi: "पिछले कुछ दिनों की थकान और भारीपन" };
  }
  if (em === "anxious" || em === "restless" || em === "overwhelmed") {
    return { en: "some anxious, racing energy", hi: "मन में चल रही बेचैनी" };
  }
  if (em === "frustrated") {
    return { en: "some frustration from the day", hi: "दिन की थोड़ी झुँझलाहट" };
  }
  return { en: "a wish for a calmer few minutes", hi: "कुछ शांत पलों की चाह" };
}

/**
 * GET /meditation/context — the setup screen's smart defaults. Prefers the most
 * recent signal: a fresh mood check-in, else the rolling chat memory. Returns a
 * suggested focus + a gentle, non-raw theme label, or nulls when there's nothing
 * recent (a general meditation). NEVER returns raw chat/mood text.
 */
export async function getMeditationContext(userId: string): Promise<SukoonMeditationContext> {
  const [mood, summary, conversationId] = await Promise.all([
    latestMood(userId),
    rollingChatSummary(userId),
    latestConversationId(userId),
  ]);

  if (mood) {
    const label = moodThemeLabel(mood);
    return {
      source: "mood",
      conversation_id: null,
      suggested_focus: emotionToFocus(mood.emotions[0] ?? null, mood.score <= 2),
      theme_label_hi: label.hi,
      theme_label_en: label.en,
    };
  }
  if (summary) {
    // The UI chip stays a soft, generic label — the sanitized summary itself is
    // used only server-side as the generator's acknowledgement, never shown raw.
    return {
      source: "chat",
      conversation_id: conversationId,
      suggested_focus: "unwind",
      theme_label_hi: "जो बातें तुमने साथी से साझा कीं",
      theme_label_en: "what you shared with Saathi",
    };
  }
  return {
    source: null,
    conversation_id: null,
    suggested_focus: "unwind",
    theme_label_hi: null,
    theme_label_en: null,
  };
}

/** The user's most recent conversation id, for attributing a chat-seeded meditation. */
async function latestConversationId(userId: string): Promise<string | null> {
  const { data, error } = await supabase()
    .from("sukoon_conversations")
    .select("id")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * Resolve the theme the generator should gently acknowledge, SERVER-SIDE, from
 * the request's `source` — the sanitized rolling chat summary for a chat-seeded
 * meditation, a mood phrase for a mood-seeded one, or null (a general meditation).
 * Returns the phrase used both to build the prompt AND to derive the context hash
 * that keys the reuse cache (so a moved-on conversation naturally misses).
 */
async function resolveThemeLabel(
  userId: string,
  source: SukoonMeditationSource,
): Promise<string | null> {
  if (source === "chat") {
    return rollingChatSummary(userId);
  }
  if (source === "mood") {
    const mood = await latestMood(userId);
    return mood ? moodThemeLabel(mood).en : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reuse cache — deterministic keys so an identical request within the same
// unchanged context replays a stored meditation with zero LLM/TTS spend.
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** The reuse arbiter: identical (controls) → same cache_key. */
function cacheKeyOf(body: SukoonMeditationGenerateBody): string {
  return sha256(
    [body.source, body.conversation_id ?? "", body.focus, body.duration_min, body.language, body.voice].join("|"),
  );
}

/** The context digest: identical acknowledged theme → same context_hash. */
function contextHashOf(themeLabel: string | null): string {
  return sha256(themeLabel ?? "");
}

interface MeditationRow {
  id: string;
  source: SukoonMeditationSource;
  focus: SukoonMeditationFocus;
  duration_min: number;
  language: SukoonChatLanguage;
  voice: SukoonMeditationVoice;
  ambient: SukoonAmbientId | null;
  script: string;
  audio_path: string | null;
  created_at: string;
}

const MEDITATION_COLUMNS =
  "id, source, focus, duration_min, language, voice, ambient, script, audio_path, created_at";

/** Sign a row's audio (if rendered) and shape it for the client. */
async function toClientMeditation(row: MeditationRow, fromCache: boolean): Promise<SukoonMeditation> {
  let audioUrl: string | null = null;
  let audioExpiresAt: string | null = null;
  if (row.audio_path) {
    try {
      const signed = await signAudioPath(row.audio_path);
      audioUrl = signed.url;
      audioExpiresAt = signed.expires_at;
    } catch (err) {
      // A signing failure shouldn't blank the whole meditation — the client can
      // still read the script and play the ambient bed.
      logger.warn({ err: err instanceof Error ? err.message : err, id: row.id }, "sukoon meditation: audio sign failed");
    }
  }
  return {
    id: row.id,
    source: row.source,
    focus: row.focus,
    duration_min: row.duration_min,
    language: row.language,
    voice: row.voice,
    ambient: row.ambient,
    script: row.script,
    audio_url: audioUrl,
    audio_expires_at: audioExpiresAt,
    from_cache: fromCache,
    created_at: row.created_at,
  };
}

/** The newest already-rendered meditation matching this exact request+context, or null. */
async function findReusable(
  userId: string,
  cacheKey: string,
  contextHash: string,
): Promise<MeditationRow | null> {
  const { data, error } = await supabase()
    .from("sukoon_meditations")
    .select(MEDITATION_COLUMNS)
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .eq("context_hash", contextHash)
    .not("audio_path", "is", null) // only replay a fully-rendered meditation
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon meditation: reuse lookup failed");
    return null;
  }
  return (data as MeditationRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Generate (or replay) — the one call the route drives.
// ---------------------------------------------------------------------------

export interface MeditationResult {
  meditation: SukoonMeditation;
  usage: SukoonMeditationUsage;
}

/**
 * Pre-flight (runs BEFORE any work, surfaced as JSON): the user must be onboarded.
 * Restricted (under-18) accounts DO get meditations — a calming tool is exactly
 * what the restricted experience is steered toward (unlike open chat/voice) — so
 * no restricted gate here. Returns nothing; throws on failure.
 */
export async function planMeditation(userId: string): Promise<void> {
  const profile = await getSukoonProfile(userId);
  if (!profile) throw new HttpError(404, "Complete Sukoon onboarding first");
}

const EXT_BY_MIME: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav" };

/**
 * Generate a personalized meditation, or replay an identical cached one. Order:
 *   1. Resolve the acknowledged theme + cache keys (server-side).
 *   2. Reuse lookup — a hit replays instantly (no spend, no allowance consumed).
 *   3. Allowance check — a miss needs a free generation credit (402 if spent).
 *   4. Generate the script (Haiku, cached instructional head).
 *   5. Render + upload the TTS audio (one-time; degrades to script-only on failure).
 *   6. Persist, then consume one allowance (charged only on a successful miss).
 */
export async function generateMeditation(
  userId: string,
  body: SukoonMeditationGenerateBody,
  signal: AbortSignal,
): Promise<MeditationResult> {
  const profile = await getSukoonProfile(userId);
  if (!profile) throw new HttpError(404, "Complete Sukoon onboarding first");

  const themeLabel = await resolveThemeLabel(userId, body.source);
  const cacheKey = cacheKeyOf(body);
  const contextHash = contextHashOf(themeLabel);

  // 2) Reuse — a cached, rendered meditation for this exact request replays free.
  const reusable = await findReusable(userId, cacheKey, contextHash);
  if (reusable) {
    void recordSukoonEvent(userId, "feature_viewed", { feature: "meditation", outcome: "cache_hit" });
    const usage = await getMeditationUsage(userId);
    return { meditation: await toClientMeditation(reusable, true), usage };
  }

  // 3) Allowance — a genuine generation needs a credit.
  const pre = await getMeditationUsage(userId);
  if (pre.remaining <= 0) {
    void recordSukoonEvent(userId, "cap_hit", { feature: "meditation", tier: pre.tier });
    throw new HttpError(402, "You've used your guided-meditation credits for now.", {
      feature: "sukoon_meditation_cap",
    });
  }

  // 4) Author the script — the big instructional head is the cache breakpoint.
  const ctx: MeditationContext = {
    language: body.language,
    focus: body.focus,
    durationMin: body.duration_min,
    name: null, // kept optional; a null name is handled gracefully by the prompt
    themeLabel,
  };
  let script = "";
  try {
    script = (
      await streamText({
        model: MODELS.haiku, // haiku rejects the `effort` param — never pass it
        system: [...MEDITATION_SYSTEM, buildMeditationContextTail(ctx)],
        content: MEDITATION_USER_INSTRUCTION,
        maxTokens: SCRIPT_MAX_TOKENS,
        purpose: "sukoon_meditation_script",
        userId,
        signal,
      })
    ).trim();
  } catch (err) {
    if (signal.aborted) throw err;
    throw err;
  }
  if (!script) throw new Error("empty meditation script");

  // 5) Persist the row FIRST (so we have a stable id to name the audio object),
  //    then render + upload the one-time TTS audio and patch the path in.
  const inserted = await insertRow(userId, body, script, cacheKey, contextHash);

  let audioPath: string | null = null;
  const provider = getTtsProvider();
  try {
    const speech = await provider.synthesize({ text: script, language: body.language, voice: body.voice, userId, signal });
    const ext = EXT_BY_MIME[speech.mimeType] ?? "mp3";
    const path = `meditations/${inserted.id}.${ext}`;
    await uploadAudioPath(path, Buffer.from(speech.audioBase64, "base64"), speech.mimeType);
    await supabase().from("sukoon_meditations").update({ audio_path: path }).eq("id", inserted.id);
    audioPath = path;
  } catch (err) {
    if (signal.aborted) throw err;
    // Degrade to a script-only meditation (client reads the transcript + plays
    // the ambient bed) rather than discarding an already-authored script.
    logger.warn(
      { err: err instanceof Error ? err.message : err, userId, provider: provider.name },
      "sukoon meditation: TTS render failed; returning script-only",
    );
  }

  // 6) Consume one allowance — charged only now that a real meditation exists.
  const { usage } = await consumeMeditation(userId);
  void recordSukoonEvent(userId, "feature_viewed", {
    feature: "meditation",
    outcome: audioPath ? "generated" : "generated_no_audio",
    focus: body.focus,
  });

  const row: MeditationRow = { ...inserted, audio_path: audioPath };
  return { meditation: await toClientMeditation(row, false), usage };
}

/** Insert the meditation row (audio_path filled in after the render). */
async function insertRow(
  userId: string,
  body: SukoonMeditationGenerateBody,
  script: string,
  cacheKey: string,
  contextHash: string,
): Promise<MeditationRow> {
  const { data, error } = await supabase()
    .from("sukoon_meditations")
    .insert({
      user_id: userId,
      source: body.source,
      source_ref: body.conversation_id ?? null,
      focus: body.focus,
      duration_min: body.duration_min,
      language: body.language,
      voice: body.voice,
      ambient: body.ambient,
      script,
      audio_path: null,
      cache_key: cacheKey,
      context_hash: contextHash,
      model: MODELS.haiku,
    })
    .select(MEDITATION_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `could not save meditation: ${error.message}`);
  return data as MeditationRow;
}

/** GET /meditation/:id — replay one (re-signs a fresh audio URL, no regen). */
export async function getMeditationById(userId: string, id: string): Promise<SukoonMeditation> {
  const { data, error } = await supabase()
    .from("sukoon_meditations")
    .select(MEDITATION_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon meditation lookup failed: ${error.message}`);
  if (!data) throw notFound("Meditation not found");
  return toClientMeditation(data as MeditationRow, true);
}

/** GET /meditation — the person's recent meditations (a small "again" list). */
export async function listMeditations(userId: string): Promise<SukoonMeditationListItem[]> {
  const { data, error } = await supabase()
    .from("sukoon_meditations")
    .select("id, focus, duration_min, language, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new HttpError(500, `sukoon meditation list failed: ${error.message}`);
  return ((data as { id: string; focus: SukoonMeditationFocus; duration_min: number; language: SukoonChatLanguage; created_at: string }[]) ?? []).map(
    (r) => ({ id: r.id, focus: r.focus, duration_min: r.duration_min, language: r.language, created_at: r.created_at }),
  );
}

/** Re-exported for the route's ambient validation (defense in depth). */
export const AMBIENT_IDS = SUKOON_AMBIENT_IDS;
