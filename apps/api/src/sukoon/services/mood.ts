/**
 * Sukoon F5 — Mood tracking service. One PRIMARY entry per IST day (the first
 * check-in that day, editable in place) plus any EXTRA check-ins the same day
 * (also stored — a bad-mock-test evening dip is a real, separate signal, not a
 * correction of the morning's entry). Every query is owner-scoped by user_id
 * (defense in depth alongside RLS 0079 — the real guard since the API uses the
 * service-role client).
 */
import type {
  SukoonEmotionId,
  SukoonMoodAggregates,
  SukoonMoodCreateBody,
  SukoonMoodEntry,
  SukoonMoodFactorCorrelation,
  SukoonMoodFactorId,
  SukoonMoodHeatmapDay,
  SukoonMoodPattern,
  SukoonMoodPatternTier,
  SukoonMoodUpdateBody,
} from "@neev/shared";
import { SUKOON_MOOD_FACTORS, sukoonEmotionToExerciseType } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";
import { istDateString, istDayRangeUtc, istToday, shiftDate } from "../../lib/ist.js";
import { nextReminderAt } from "../lib/reminder.js";
import { getSukoonProfile } from "./profile.js";

/** Bound the aggregate scans (a heavy multi-check-in-per-day user). Mirrors journal's cap. */
const METADATA_SCAN_CAP = 2000;
/** A factor correlation needs at least this many days on EACH side to be shown at all. */
const MIN_CORRELATION_SAMPLES = 5;
const ENTRY_COLUMNS = "id, score, emotions, factors, note, created_at";

interface MoodRow {
  id: string;
  score: number;
  emotions: string[] | null;
  factors: string[] | null;
  note: string | null;
  created_at: string;
}

function toEntry(row: MoodRow): SukoonMoodEntry {
  return {
    id: row.id,
    score: row.score,
    emotions: (row.emotions ?? []) as SukoonEmotionId[],
    factors: (row.factors ?? []) as SukoonMoodFactorId[],
    note: row.note,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

/** Dedupe while preserving first-seen order — mirrors the journal's cleanTags(). */
function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalize(input: SukoonMoodCreateBody | SukoonMoodUpdateBody) {
  const note = input.note?.trim();
  return {
    score: input.score,
    // The toggle-based UI never sends a duplicate, but a duplicate id sent
    // directly to the API would otherwise inflate emotion_frequency (each
    // occurrence in the array is counted) — dedupe at the write boundary.
    emotions: dedupe(input.emotions ?? []),
    factors: dedupe(input.factors ?? []),
    note: note ? note : null,
  };
}

export async function createEntry(
  userId: string,
  input: SukoonMoodCreateBody,
): Promise<SukoonMoodEntry> {
  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .insert({ user_id: userId, ...normalize(input) })
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `mood create failed: ${error.message}`);
  return toEntry(data as unknown as MoodRow);
}

export async function updateEntry(
  userId: string,
  id: string,
  input: SukoonMoodUpdateBody,
): Promise<SukoonMoodEntry> {
  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .update(normalize(input))
    .eq("id", id)
    .eq("user_id", userId)
    .select(ENTRY_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, `mood update failed: ${error.message}`);
  if (!data) throw new HttpError(404, "Entry not found");
  return toEntry(data as unknown as MoodRow);
}

/** Hard delete — sukoon_mood_entries has no deleted_at column (unlike the journal). */
export async function deleteEntry(userId: string, id: string): Promise<void> {
  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new HttpError(500, `mood delete failed: ${error.message}`);
  if (!data || data.length === 0) throw new HttpError(404, "Entry not found");
}

// ---------------------------------------------------------------------------
// Today — the check-in screen's primary read
// ---------------------------------------------------------------------------

export interface MoodToday {
  primary: SukoonMoodEntry | null;
  extra: SukoonMoodEntry[];
  next_reminder_at: string | null;
}

export async function getToday(userId: string): Promise<MoodToday> {
  const { startUtc, endUtc } = istDayRangeUtc(istToday());
  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .select(ENTRY_COLUMNS)
    .eq("user_id", userId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(500, `mood today failed: ${error.message}`);

  const rows = ((data as unknown as MoodRow[]) ?? []).map(toEntry);
  const [primary, ...extra] = rows;

  // Reminder-time lookup degrades to "no reminder" on any profile read hiccup —
  // a wellness check-in screen must never fail to load over this.
  let reminderTime: string | null = null;
  try {
    reminderTime = (await getSukoonProfile(userId))?.reminder_time ?? null;
  } catch {
    /* leave reminderTime null */
  }

  return {
    primary: primary ?? null,
    extra,
    next_reminder_at: nextReminderAt(reminderTime, rows.length > 0),
  };
}

// ---------------------------------------------------------------------------
// Calendar heatmap (metadata-light — score is not sensitive like a journal
// body, so this mirrors the journal heatmap shape exactly for UI reuse).
// ---------------------------------------------------------------------------

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export async function heatmap(userId: string, month: string): Promise<SukoonMoodHeatmapDay[]> {
  const startUtc = istDayRangeUtc(`${month}-01`).startUtc;
  const monthEndUtc = istDayRangeUtc(`${nextMonth(month)}-01`).startUtc;

  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .select("created_at, score")
    .eq("user_id", userId)
    .gte("created_at", startUtc)
    .lt("created_at", monthEndUtc);
  if (error) throw new HttpError(500, `mood heatmap failed: ${error.message}`);

  const byDay = new Map<string, { sum: number; count: number }>();
  for (const row of (data as { created_at: string; score: number }[] | null) ?? []) {
    const day = istDateString(new Date(row.created_at).getTime());
    const cur = byDay.get(day) ?? { sum: 0, count: 0 };
    cur.sum += row.score;
    cur.count += 1;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({
      date,
      count: v.count,
      avg_score: Math.round((v.sum / v.count) * 10) / 10,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Aggregates — daily series, 7/30-day averages, emotion frequency, factor
// correlation. Fetches a window covering whichever is larger (the requested
// range or 30 days, so avg_30d is always computable regardless of `range`).
// ---------------------------------------------------------------------------

export async function aggregates(userId: string, rangeDays: number): Promise<SukoonMoodAggregates> {
  const fetchDays = Math.max(rangeDays, 30);
  const today = istToday();
  const startUtc = istDayRangeUtc(shiftDate(today, -(fetchDays - 1))).startUtc;

  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .select("score, emotions, factors, created_at")
    .eq("user_id", userId)
    .gte("created_at", startUtc)
    .order("created_at", { ascending: false })
    .limit(METADATA_SCAN_CAP);
  if (error) throw new HttpError(500, `mood aggregates failed: ${error.message}`);

  interface Row {
    score: number;
    emotions: string[] | null;
    factors: string[] | null;
    created_at: string;
  }
  const rows = (data as unknown as Row[]) ?? [];

  const byDay = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const day = istDateString(new Date(r.created_at).getTime());
    const cur = byDay.get(day) ?? { sum: 0, count: 0 };
    cur.sum += r.score;
    cur.count += 1;
    byDay.set(day, cur);
  }

  const daily = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const date = shiftDate(today, -i);
    const d = byDay.get(date);
    daily.push({
      date,
      avg_score: d ? Math.round((d.sum / d.count) * 10) / 10 : null,
      count: d?.count ?? 0,
    });
  }

  const avgOverLastNDays = (n: number): number | null => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const d = byDay.get(shiftDate(today, -i));
      if (d) {
        sum += d.sum;
        count += d.count;
      }
    }
    return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
  };
  const avg_7d = avgOverLastNDays(7);
  const avg_30d = avgOverLastNDays(30);

  const rangeStart = shiftDate(today, -(rangeDays - 1));
  const inRange = rows.filter((r) => istDateString(new Date(r.created_at).getTime()) >= rangeStart);

  const emotionCounts = new Map<string, number>();
  for (const r of inRange) {
    for (const e of r.emotions ?? []) emotionCounts.set(e, (emotionCounts.get(e) ?? 0) + 1);
  }
  const emotion_frequency = [...emotionCounts.entries()]
    .map(([emotion, count]) => ({ emotion: emotion as SukoonEmotionId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Aggregate to ONE row per DAY (avg score + the union of factors tagged
  // that day) before splitting into with/without — correlating per raw
  // check-in would let a single stressful day with 3 extra check-ins count
  // as 3 samples toward a factor's "with" bucket, both overweighting that
  // day 3x in the average AND inflating its sample count past the 5-sample
  // floor on noise. "Min 5 samples" reads as 5 independent DAYS, matching
  // the docstring below and the UI copy ("N such days").
  const dayAgg = new Map<string, { sum: number; count: number; factors: Set<string> }>();
  for (const r of inRange) {
    const day = istDateString(new Date(r.created_at).getTime());
    const cur = dayAgg.get(day) ?? { sum: 0, count: 0, factors: new Set<string>() };
    cur.sum += r.score;
    cur.count += 1;
    for (const f of r.factors ?? []) cur.factors.add(f);
    dayAgg.set(day, cur);
  }

  const correlations: SukoonMoodFactorCorrelation[] = [];
  for (const def of SUKOON_MOOD_FACTORS) {
    const withDays: number[] = [];
    const withoutDays: number[] = [];
    for (const agg of dayAgg.values()) {
      (agg.factors.has(def.id) ? withDays : withoutDays).push(agg.sum / agg.count);
    }
    if (withDays.length < MIN_CORRELATION_SAMPLES || withoutDays.length < MIN_CORRELATION_SAMPLES) {
      continue;
    }
    const avgWith = withDays.reduce((a, b) => a + b, 0) / withDays.length;
    const avgWithout = withoutDays.reduce((a, b) => a + b, 0) / withoutDays.length;
    correlations.push({
      factor: def.id,
      avg_with: Math.round(avgWith * 10) / 10,
      avg_without: Math.round(avgWithout * 10) / 10,
      gap: Math.round((avgWith - avgWithout) * 10) / 10,
      samples_with: withDays.length,
      samples_without: withoutDays.length,
    });
  }
  correlations.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  return {
    range_days: rangeDays,
    daily,
    avg_7d,
    avg_30d,
    total_entries: inRange.length,
    emotion_frequency,
    factor_correlations: correlations.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Proactive mood-pattern bridge (F5×F6, Ebb-inspired). A pure-code, zero-LLM
// read over the user's OWN recent check-ins. DELIBERATELY conservative — a
// wellness app that nudges on thin or noisy data (or misreads one bad evening
// as a trend) does real harm to trust and tone, so the gates below are strict
// and every threshold errs toward saying "none". This is NOT crisis detection
// (that's per-message, in services/crisis/*): this is a slow cross-day trend
// and never labels a condition. See SukoonMoodPattern in @neev/shared.
// ---------------------------------------------------------------------------

/** How far back we look for the trend. */
const PATTERN_LOOKBACK_DAYS = 14;
/** Never nudge below this many distinct check-in days in the lookback window. */
const PATTERN_MIN_CHECKIN_DAYS = 4;
/** The most-recent check-in days that form the "recent" window. */
const PATTERN_RECENT_WINDOW = 3;
/** The check-in days BEFORE the recent window, for the soft-dip comparison. */
const PATTERN_PRIOR_WINDOW = 7;
/** Don't bridge on stale data — the newest check-in must be within this many days. */
const PATTERN_MAX_STALENESS_DAYS = 4;
/** soft: recent avg must be at least this much (on 1–5) below the prior window. */
const PATTERN_SOFT_DROP = 0.8;
/** soft: and the recent avg must itself be at or below this (an actual low, not a dip from great→good). */
const PATTERN_SOFT_CEILING = 3.0;
/** soft: needs at least this many recent check-in days to call it a pattern, not a blip. */
const PATTERN_SOFT_MIN_DAYS = 2;
/** care: a sustained low — recent avg at or below this... */
const PATTERN_CARE_CEILING = 2.0;
/** ...across at least this many recent check-in days. */
const PATTERN_CARE_MIN_DAYS = 3;

const PATTERN_NONE: SukoonMoodPattern = {
  tier: "none",
  recent_avg: null,
  prior_avg: null,
  recent_days: 0,
  dominant_emotion: null,
  suggested_exercise_type: null,
};

/**
 * Look for a genuine declining mood trend in the user's recent check-ins.
 * Returns `tier: "none"` unless the conservative gates below all pass; a `soft`
 * or `care` tier carries the recent/prior averages, the dominant recent
 * emotion, and the calming tool it maps to (so both Saathi's context and the
 * nudge card read from one computation). One indexed, owner-scoped query.
 */
export async function detectMoodPattern(userId: string): Promise<SukoonMoodPattern> {
  const today = istToday();
  const startUtc = istDayRangeUtc(shiftDate(today, -(PATTERN_LOOKBACK_DAYS - 1))).startUtc;

  const { data, error } = await supabase()
    .from("sukoon_mood_entries")
    .select("score, emotions, created_at")
    .eq("user_id", userId)
    .gte("created_at", startUtc)
    .order("created_at", { ascending: false })
    .limit(METADATA_SCAN_CAP);
  if (error) throw new HttpError(500, `mood pattern failed: ${error.message}`);

  interface Row {
    score: number;
    emotions: string[] | null;
    created_at: string;
  }
  const rows = (data as unknown as Row[]) ?? [];

  // One aggregate per IST day (a day with 3 check-ins is still one data point,
  // matching how aggregates/correlations treat a day — see the note there).
  const byDay = new Map<string, { sum: number; count: number; emotions: string[] }>();
  for (const r of rows) {
    const day = istDateString(new Date(r.created_at).getTime());
    const cur = byDay.get(day) ?? { sum: 0, count: 0, emotions: [] };
    cur.sum += r.score;
    cur.count += 1;
    for (const e of r.emotions ?? []) cur.emotions.push(e);
    byDay.set(day, cur);
  }

  // Gate 1 — enough distinct check-in days to trust any trend at all.
  const days = [...byDay.entries()]
    .map(([date, agg]) => ({ date, avg: agg.sum / agg.count, emotions: agg.emotions }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // most-recent first
  if (days.length < PATTERN_MIN_CHECKIN_DAYS) return PATTERN_NONE;

  // Gate 2 — not stale: the newest check-in must be recent, or this is history,
  // not a "right now" signal to bridge on.
  const staleCutoff = shiftDate(today, -PATTERN_MAX_STALENESS_DAYS);
  if (days[0].date < staleCutoff) return PATTERN_NONE;

  const recent = days.slice(0, PATTERN_RECENT_WINDOW);
  const prior = days.slice(PATTERN_RECENT_WINDOW, PATTERN_RECENT_WINDOW + PATTERN_PRIOR_WINDOW);
  const avg = (xs: { avg: number }[]): number | null =>
    xs.length ? Math.round((xs.reduce((s, d) => s + d.avg, 0) / xs.length) * 10) / 10 : null;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  if (recentAvg == null) return PATTERN_NONE;

  // Dominant recent emotion (most-tagged across the recent window), if any.
  const emoCounts = new Map<string, number>();
  for (const d of recent) for (const e of d.emotions) emoCounts.set(e, (emoCounts.get(e) ?? 0) + 1);
  const dominant = [...emoCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const dominantEmotion = (dominant as SukoonEmotionId | null) ?? null;

  // Decide the tier — care (sustained low) takes precedence over soft (a dip).
  let tier: SukoonMoodPatternTier = "none";
  if (recent.length >= PATTERN_CARE_MIN_DAYS && recentAvg <= PATTERN_CARE_CEILING) {
    tier = "care";
  } else if (
    recent.length >= PATTERN_SOFT_MIN_DAYS &&
    priorAvg != null &&
    priorAvg - recentAvg >= PATTERN_SOFT_DROP &&
    recentAvg <= PATTERN_SOFT_CEILING
  ) {
    tier = "soft";
  }

  if (tier === "none") return PATTERN_NONE;

  return {
    tier,
    recent_avg: recentAvg,
    prior_avg: priorAvg,
    recent_days: recent.length,
    dominant_emotion: dominantEmotion,
    suggested_exercise_type: sukoonEmotionToExerciseType(dominantEmotion),
  };
}
