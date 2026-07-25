/**
 * Sukoon "For you" recommendations — rank the STATIC content library (F6
 * exercises + F7 journeys) by GENUINE semantic similarity to a person's recent
 * emotional signal, replacing the plain static ordered list that exercises.ts /
 * journeys.ts return today.
 *
 * SPINE (reused, not new): the SAME embeddings + cosine-ANN pattern the
 * semantic-FAQ cache (services/semantic-cache.ts, 0080) and Saathi memory
 * (services/memory.ts, 0097) already prove out — here matching a per-user signal
 * vector against sukoon_content_embeddings (0101), one embedding per content item
 * computed ONCE offline by `pnpm sukoon:embed-content`.
 *
 * COST (blueprint cost spine): content embeddings are static — the ONLY
 * per-request model cost is embedding the user's own rolling signal (one
 * text-embedding-3-small call, cents-negligible). No LLM call at all.
 *
 * PRIVACY (SUKOON_CONTEXT / blueprint privacy-first): the signal is built from
 * mood check-ins (score/emotions/factors/note — the note is the user's own short
 * casual text, not the encrypted journal) + journal METADATA ONLY (tags, never
 * the encrypted body — mirrors services/journal.ts's "list is metadata-only"
 * rule). The signal text is embedded transiently and never stored (same posture
 * as memory retrieval embedding the current message).
 *
 * HONESTY: every recommendation's reason is grounded in a REAL signal the user
 * gave (a tagged factor/emotion, a journal tag, a genuine mood dip) — returned
 * as a bilingual reason CODE so the UI localises it and never overclaims ("because
 * X has come up", never "you need X"). See SukoonRecommendation in @neev/shared.
 *
 * FAILS OPEN everywhere: any embed/RPC error, or the migration not yet applied,
 * degrades to a calm getting-started set — a wellness home screen must never 500
 * over a recommendation.
 */
import type {
  SukoonEmotionId,
  SukoonExerciseType,
  SukoonMoodFactorId,
  SukoonMoodPatternTier,
  SukoonRecommendation,
  SukoonRecommendationReason,
  SukoonTier,
} from "@neev/shared";
import { SUKOON_EMOTIONS, SUKOON_MOOD_FACTORS } from "@neev/shared";
import { embeddings } from "../../lib/embeddings.js";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { istDayRangeUtc, istToday, shiftDate } from "../../lib/ist.js";
import { getSukoonTier } from "./entitlements.js";
import { detectMoodPattern } from "./mood.js";

/** How far back the rolling signal looks (mood + journal metadata). */
const SIGNAL_LOOKBACK_DAYS = 21;
/** Bound the signal scans (a heavy multi-check-in user). Mirrors mood/journal caps. */
const SIGNAL_SCAN_CAP = 500;
/** How many of each signal dimension feed the query text / reason ranking. */
const TOP_EMOTIONS = 4;
const TOP_FACTORS = 3;
const TOP_TAGS = 4;
/** Recent mood notes carry the richest free-text signal — include a few verbatim
 *  (the user's own casual words, not the encrypted journal) into the query text. */
const MAX_NOTES = 4;
const NOTE_MAX_CHARS = 200;
/** Never surface more than this many of one exercise type (keep the set varied). */
const MAX_PER_TYPE = 2;
/** Below this cosine we don't call it a genuine match — drop to getting-started. */
const MIN_SIMILARITY = 0.15;

/** A neutral seed used ONLY for cold start (no signal): returns real calm tools
 *  via the same pipeline, all labelled getting_started (no personalisation claim). */
const GETTING_STARTED_SEED =
  "a calm and gentle way to start, slow breathing to steady myself, grounding to feel present, relaxing and easing tension, finding a little peace";

interface UserSignal {
  hasSignal: boolean;
  /** Natural-language description of the recent state, for embedding. */
  text: string;
  topEmotions: SukoonEmotionId[];
  topFactors: SukoonMoodFactorId[];
  /** Lowercased journal tags, most-frequent first. */
  topTags: string[];
  moodTier: SukoonMoodPatternTier;
}

const EMOTION_LABEL_EN = new Map(SUKOON_EMOTIONS.map((e) => [e.id, e.label_en.toLowerCase()]));
const FACTOR_LABEL_EN = new Map(SUKOON_MOOD_FACTORS.map((f) => [f.id, f.label_en.toLowerCase()]));

/** Count occurrences, return ids most-frequent first (ties keep first-seen). */
function rankByFrequency<T>(items: T[]): T[] {
  const counts = new Map<T, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * Build the rolling per-user signal from recent mood check-ins + journal
 * metadata. Owner-scoped, indexed queries; no body decryption. Never throws —
 * a signal-build hiccup degrades to "no signal" (a getting-started fallback).
 */
export async function buildUserSignal(userId: string): Promise<UserSignal> {
  const empty: UserSignal = {
    hasSignal: false,
    text: "",
    topEmotions: [],
    topFactors: [],
    topTags: [],
    moodTier: "none",
  };
  try {
    const startUtc = istDayRangeUtc(shiftDate(istToday(), -(SIGNAL_LOOKBACK_DAYS - 1))).startUtc;

    const [moodRes, journalRes, pattern] = await Promise.all([
      supabase()
        .from("sukoon_mood_entries")
        .select("score, emotions, factors, note, created_at")
        .eq("user_id", userId)
        .gte("created_at", startUtc)
        .order("created_at", { ascending: false })
        .limit(SIGNAL_SCAN_CAP),
      // Journal METADATA ONLY — tags never touch the encrypted body.
      supabase()
        .from("sukoon_journal_entries")
        .select("tags, created_at")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .gte("created_at", startUtc)
        .order("created_at", { ascending: false })
        .limit(SIGNAL_SCAN_CAP),
      // Reuse the conservative F5×F6 decline detector for the mood tier.
      detectMoodPattern(userId).catch(() => null),
    ]);

    const moodRows =
      (moodRes.data as
        | { emotions: string[] | null; factors: string[] | null; note: string | null }[]
        | null) ?? [];
    const journalRows = (journalRes.data as { tags: string[] | null }[] | null) ?? [];

    const topEmotions = rankByFrequency(
      moodRows.flatMap((r) => r.emotions ?? []),
    ).slice(0, TOP_EMOTIONS) as SukoonEmotionId[];
    const topFactors = rankByFrequency(
      moodRows.flatMap((r) => r.factors ?? []),
    ).slice(0, TOP_FACTORS) as SukoonMoodFactorId[];
    const topTags = rankByFrequency(
      journalRows.flatMap((r) => (r.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)),
    ).slice(0, TOP_TAGS);
    const notes = moodRows
      .map((r) => (r.note ?? "").trim())
      .filter(Boolean)
      .slice(0, MAX_NOTES)
      .map((n) => n.slice(0, NOTE_MAX_CHARS));
    const moodTier: SukoonMoodPatternTier = pattern?.tier ?? "none";

    // Assemble a natural-language description (english labels align with the
    // bilingual content descriptors; tags/notes stay in the user's own words —
    // cross-lingual embeddings handle the mix, exactly like memory retrieval).
    const parts: string[] = [];
    if (topEmotions.length) {
      parts.push(`Recently feeling ${topEmotions.map((e) => EMOTION_LABEL_EN.get(e) ?? e).join(", ")}`);
    }
    if (topFactors.length) {
      parts.push(`What's weighing on me: ${topFactors.map((f) => FACTOR_LABEL_EN.get(f) ?? f).join(", ")}`);
    }
    if (topTags.length) parts.push(`Journaling about: ${topTags.join(", ")}`);
    for (const n of notes) parts.push(n);
    if (moodTier === "care") parts.push("Overall this has been a low, heavy stretch.");
    else if (moodTier === "soft") parts.push("My mood has dipped a little recently.");

    const hasSignal =
      topEmotions.length > 0 ||
      topFactors.length > 0 ||
      topTags.length > 0 ||
      notes.length > 0 ||
      moodTier !== "none";

    return { hasSignal, text: parts.join(". "), topEmotions, topFactors, topTags, moodTier };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, userId }, "sukoon recommendations: signal build failed");
    return empty;
  }
}

interface ContentMatch {
  content_kind: "exercise" | "journey";
  content_id: string;
  content_ref: string;
  emotions: string[];
  factors: string[];
  topics: string[];
  similarity: number;
}

/** Cosine-match the query text against the content library. Fails open → []. */
async function matchContent(queryText: string, matchCount: number): Promise<ContentMatch[]> {
  const query = queryText.trim().replace(/\s+/g, " ");
  if (!query) return [];
  try {
    const [vec] = await embeddings().embed([query]);
    if (!vec) return [];
    const { data, error } = await supabase().rpc("match_sukoon_content", {
      query_embedding: vec,
      filter_kinds: null,
      match_count: matchCount,
    });
    if (error) {
      // Includes "function does not exist" before 0101 is applied — treated as
      // no matches so the read path ships safely ahead of the migration.
      logger.warn({ err: error.message }, "sukoon recommendations: match unavailable; empty");
      return [];
    }
    return (data as ContentMatch[] | null) ?? [];
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, "sukoon recommendations: match error; empty");
    return [];
  }
}

interface ExerciseMeta {
  id: string;
  key: string | null;
  type: SukoonExerciseType;
  title_hi: string;
  title_en: string;
  premium: boolean;
}
interface JourneyMeta {
  id: string;
  slug: string;
  title_hi: string;
  title_en: string;
  premium: boolean;
}

/** Resolve the matched content ids to their current catalog rows (batch). */
async function resolveContent(matches: ContentMatch[]): Promise<{
  exercises: Map<string, ExerciseMeta>;
  journeys: Map<string, JourneyMeta>;
}> {
  const exerciseIds = matches.filter((m) => m.content_kind === "exercise").map((m) => m.content_id);
  const journeyIds = matches.filter((m) => m.content_kind === "journey").map((m) => m.content_id);

  const [exRes, jrRes] = await Promise.all([
    exerciseIds.length
      ? supabase().from("sukoon_exercises").select("id, key, type, title_hi, title_en, premium").in("id", exerciseIds)
      : Promise.resolve({ data: [], error: null }),
    journeyIds.length
      ? supabase()
          .from("sukoon_journeys")
          .select("id, slug, title_hi, title_en, premium, published")
          .in("id", journeyIds)
          .eq("published", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const exercises = new Map<string, ExerciseMeta>();
  for (const r of (exRes.data as ExerciseMeta[] | null) ?? []) exercises.set(r.id, r);
  const journeys = new Map<string, JourneyMeta>();
  for (const r of (jrRes.data as (JourneyMeta & { published: boolean })[] | null) ?? []) {
    journeys.set(r.id, r);
  }
  return { exercises, journeys };
}

/**
 * Pick the most specific, honest reason a matched item relates to the signal.
 * Priority (most concrete → least): a tagged factor, a tagged emotion, a
 * recurring journal tag, a genuine mood dip, else "it fits" (general). Only ever
 * cites a signal the user actually gave.
 */
function pickReason(match: ContentMatch, signal: UserSignal): SukoonRecommendationReason {
  const base: SukoonRecommendationReason = { kind: "general", factor: null, emotion: null, tag: null };

  const factor = signal.topFactors.find((f) => match.factors.includes(f));
  if (factor) return { ...base, kind: "factor", factor };

  const emotion = signal.topEmotions.find((e) => match.emotions.includes(e));
  if (emotion) return { ...base, kind: "emotion", emotion };

  const tag = signal.topTags.find((t) => match.topics.includes(t));
  if (tag) return { ...base, kind: "journal_theme", tag };

  if (signal.moodTier !== "none") return { ...base, kind: "low_mood" };

  return base;
}

/**
 * Diversity-aware ranking: keep semantic similarity as the primary order, but
 * cap how many of one exercise type surface so the set isn't five breathing
 * tools in a row. A first pass takes items respecting the per-type cap; a second
 * pass backfills from the leftovers if we're short of `limit`.
 */
function rankWithDiversity(recs: SukoonRecommendation[], limit: number): SukoonRecommendation[] {
  const sorted = [...recs].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  const typeCounts = new Map<string, number>();
  const picked: SukoonRecommendation[] = [];
  const leftovers: SukoonRecommendation[] = [];

  for (const rec of sorted) {
    if (picked.length >= limit) break;
    const bucket = rec.content_kind === "journey" ? "journey" : (rec.exercise_type ?? "other");
    const n = typeCounts.get(bucket) ?? 0;
    if (n < MAX_PER_TYPE) {
      picked.push(rec);
      typeCounts.set(bucket, n + 1);
    } else {
      leftovers.push(rec);
    }
  }
  for (const rec of leftovers) {
    if (picked.length >= limit) break;
    picked.push(rec);
  }
  return picked;
}

/**
 * Never hand a free user an all-locked "For you" wall: if every ranked item is
 * locked but a relevant UNLOCKED item exists in the pool, swap the
 * lowest-similarity locked pick for the highest-similarity unlocked candidate,
 * then re-sort. Only fires in the all-locked case, and still picks by
 * similarity — so it's a "don't dead-end every tap at a paywall" guarantee
 * (matching mood-pattern-nudge's precedent), not a business/popularity rerank.
 * Locked items still appear whenever they're genuinely the best matches.
 */
function ensureOneTappable(
  ranked: SukoonRecommendation[],
  pool: SukoonRecommendation[],
): SukoonRecommendation[] {
  if (ranked.length === 0 || ranked.some((r) => !r.locked)) return ranked;
  const inList = new Set(ranked.map((r) => r.content_id));
  const bestUnlocked = pool
    .filter((r) => !r.locked && !inList.has(r.content_id))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0];
  if (!bestUnlocked) return ranked; // nothing unlocked is relevant — keep honest set
  const worstLockedIdx = ranked.reduce(
    (worst, r, i) => ((r.similarity ?? 0) < (ranked[worst].similarity ?? 0) ? i : worst),
    0,
  );
  const next = [...ranked];
  next[worstLockedIdx] = bestUnlocked;
  return next.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
}

/**
 * The one public entry — GET /recommendations. Builds the signal, matches the
 * library, resolves + reasons + ranks. `signal_available` tells the UI whether
 * this is genuinely personalised or a calm cold-start set.
 */
export async function getRecommendations(
  userId: string,
  limit: number,
): Promise<{ recommendations: SukoonRecommendation[]; signal_available: boolean }> {
  const [signal, tier] = await Promise.all([buildUserSignal(userId), getSukoonTier(userId)]);

  const queryText = signal.hasSignal ? signal.text : GETTING_STARTED_SEED;
  // Over-fetch so diversity + resolution drop-outs still leave a full list.
  const matches = await matchContent(queryText, Math.max(limit * 3, 12));

  const usable = matches.filter((m) => m.similarity >= MIN_SIMILARITY);
  if (usable.length === 0) return { recommendations: [], signal_available: false };

  const { exercises, journeys } = await resolveContent(usable);

  const recs: SukoonRecommendation[] = [];
  for (const m of usable) {
    if (m.content_kind === "exercise") {
      const ex = exercises.get(m.content_id);
      if (!ex) continue; // stale id (content re-seeded before re-embed) — skip safely
      recs.push({
        content_kind: "exercise",
        content_id: ex.id,
        content_ref: ex.key ?? m.content_ref,
        title_hi: ex.title_hi,
        title_en: ex.title_en,
        premium: ex.premium,
        locked: ex.premium && tier === "free",
        exercise_type: ex.type,
        slug: null,
        similarity: m.similarity,
        reason: signal.hasSignal
          ? pickReason(m, signal)
          : { kind: "getting_started", factor: null, emotion: null, tag: null },
      });
    } else {
      const jr = journeys.get(m.content_id);
      if (!jr) continue;
      recs.push({
        content_kind: "journey",
        content_id: jr.id,
        content_ref: jr.slug,
        title_hi: jr.title_hi,
        title_en: jr.title_en,
        premium: jr.premium,
        locked: jr.premium && tier === "free",
        exercise_type: null,
        slug: jr.slug,
        similarity: m.similarity,
        reason: signal.hasSignal
          ? pickReason(m, signal)
          : { kind: "getting_started", factor: null, emotion: null, tag: null },
      });
    }
  }

  return {
    recommendations: ensureOneTappable(rankWithDiversity(recs, limit), recs),
    signal_available: signal.hasSignal,
  };
}
