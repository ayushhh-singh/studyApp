/**
 * Sukoon F6 — Exercise library. The catalog (sukoon_exercises) is static,
 * operator-seeded content (blueprint: "nothing generates content at runtime
 * that can be pre-generated") — this service only reads it, resolves the
 * per-user tier lock, mints signed audio URLs, and logs session activity.
 * Every query is owner-scoped by user_id (defense in depth alongside RLS
 * 0079 — the real guard since the API uses the service-role client).
 */
import {
  sukoonBreathingConfigSchema,
  sukoonGroundingConfigSchema,
  sukoonPmrConfigSchema,
  sukoonTimerConfigSchema,
  sukoonMeditationConfigSchema,
  SUKOON_AMBIENT_SOUNDS,
  type SukoonAmbientId,
  type SukoonExercise,
  type SukoonExerciseAudioLang,
  type SukoonExerciseSession,
  type SukoonExerciseSessionCompleteBody,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../../lib/http-error.js";
import { getSukoonTier } from "./entitlements.js";
import { signAudioPath, type SignedAudio } from "../lib/storage.js";

const EXERCISE_COLUMNS =
  "id, key, type, title_hi, title_en, config_json, audio_hi, audio_en, premium, sort";

interface ExerciseRow {
  id: string;
  key: string | null;
  type: string;
  title_hi: string;
  title_en: string;
  config_json: unknown;
  audio_hi: string | null;
  audio_en: string | null;
  premium: boolean;
  sort: number;
}

/** Narrows `config_json` per `type` — throws if seeded content is malformed
 *  (a real bug worth surfacing loudly, not silently degrading a wellness tool). */
function parseConfig(row: ExerciseRow): SukoonExercise {
  const common = {
    id: row.id,
    key: row.key,
    title_hi: row.title_hi,
    title_en: row.title_en,
    has_audio_hi: row.audio_hi != null,
    has_audio_en: row.audio_en != null,
    premium: row.premium,
    sort: row.sort,
  };
  switch (row.type) {
    case "breathing":
      return { type: "breathing", config: sukoonBreathingConfigSchema.parse(row.config_json), locked: false, ...common };
    case "grounding":
      return { type: "grounding", config: sukoonGroundingConfigSchema.parse(row.config_json), locked: false, ...common };
    case "pmr":
      return { type: "pmr", config: sukoonPmrConfigSchema.parse(row.config_json), locked: false, ...common };
    case "timer":
      return { type: "timer", config: sukoonTimerConfigSchema.parse(row.config_json), locked: false, ...common };
    case "meditation":
      return {
        type: "meditation",
        config: sukoonMeditationConfigSchema.parse(row.config_json),
        locked: false,
        ...common,
      };
    default:
      throw new HttpError(500, `sukoon exercise ${row.id} has an unknown type: ${row.type}`);
  }
}

/** GET /exercises — the tools grid's one call. `locked` is resolved from the
 *  caller's live tier so a stale client can never show a paid exercise as free. */
export async function listExercises(userId: string): Promise<SukoonExercise[]> {
  const [{ data, error }, tier] = await Promise.all([
    supabase().from("sukoon_exercises").select(EXERCISE_COLUMNS).order("sort", { ascending: true }),
    getSukoonTier(userId),
  ]);
  if (error) throw new HttpError(500, `sukoon exercises list failed: ${error.message}`);

  const rows = (data as unknown as ExerciseRow[]) ?? [];
  return rows.map((row) => {
    const exercise = parseConfig(row);
    return { ...exercise, locked: exercise.premium && tier === "free" };
  });
}

async function getExerciseRow(id: string): Promise<ExerciseRow> {
  const { data, error } = await supabase()
    .from("sukoon_exercises")
    .select(EXERCISE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon exercise lookup failed: ${error.message}`);
  if (!data) throw notFound("Exercise not found");
  return data as unknown as ExerciseRow;
}

/**
 * GET /exercises/:id/audio-url?lang= — mints a signed URL for one exercise's
 * pre-rendered audio. This is the ONE place premium is enforced for audio (a
 * locked exercise's path is never signed for a free-tier caller, regardless of
 * what the client believes) — a bucket-level Storage policy could not express
 * a subscription-tier check, so signing has to stay server-side by design.
 */
export async function getExerciseAudioUrl(
  userId: string,
  exerciseId: string,
  lang: SukoonExerciseAudioLang,
): Promise<SignedAudio> {
  const row = await getExerciseRow(exerciseId);
  if (row.premium) {
    const tier = await getSukoonTier(userId);
    if (tier === "free") throw new HttpError(402, "This exercise needs Sukoon Plus or Pro", { feature: "sukoon_exercise_premium" });
  }
  const path = lang === "hi" ? row.audio_hi : row.audio_en;
  if (!path) throw notFound("Audio for this exercise/language hasn't been uploaded yet");
  return signAudioPath(path);
}

/** GET /exercises/ambient/:id/audio-url — always free (the ambient mixer is
 *  part of the core toolkit); the id is validated against the fixed catalog
 *  server-side so a caller can never probe an arbitrary bucket path. */
export async function getAmbientAudioUrl(id: string): Promise<SignedAudio> {
  const def = SUKOON_AMBIENT_SOUNDS.find((s) => s.id === id);
  if (!def) throw badRequest(`Unknown ambient sound: ${id}`);
  return signAudioPath(ambientPath(def.id));
}

function ambientPath(id: SukoonAmbientId): string {
  return `ambient/${id}.mp3`;
}

// ---------------------------------------------------------------------------
// Session logging (start / complete, duration)
// ---------------------------------------------------------------------------

function toSession(row: {
  id: string;
  exercise_id: string | null;
  duration_s: number | null;
  completed: boolean;
  created_at: string;
}): SukoonExerciseSession {
  return {
    id: row.id,
    exercise_id: row.exercise_id,
    duration_s: row.duration_s,
    completed: row.completed,
    created_at: row.created_at,
  };
}

export async function startSession(userId: string, exerciseId: string | null): Promise<SukoonExerciseSession> {
  const { data, error } = await supabase()
    .from("sukoon_exercise_sessions")
    .insert({ user_id: userId, exercise_id: exerciseId ?? null, completed: false })
    .select("id, exercise_id, duration_s, completed, created_at")
    .single();
  if (error) {
    // 23503 = FK violation — a stale/invalid exercise_id, not a server fault.
    if (error.code === "23503") throw badRequest("Unknown exercise_id");
    throw new HttpError(500, `sukoon session start failed: ${error.message}`);
  }
  return toSession(data as unknown as { id: string; exercise_id: string | null; duration_s: number | null; completed: boolean; created_at: string });
}

export async function completeSession(
  userId: string,
  sessionId: string,
  body: SukoonExerciseSessionCompleteBody,
): Promise<SukoonExerciseSession> {
  const { data, error } = await supabase()
    .from("sukoon_exercise_sessions")
    .update({ duration_s: body.duration_s, completed: body.completed })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .select("id, exercise_id, duration_s, completed, created_at")
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon session complete failed: ${error.message}`);
  if (!data) throw notFound("Session not found");
  return toSession(data as unknown as { id: string; exercise_id: string | null; duration_s: number | null; completed: boolean; created_at: string });
}
