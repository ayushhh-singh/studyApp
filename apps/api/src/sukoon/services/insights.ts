/**
 * Sukoon F9 — Weekly Insights service. The Sunday cron calls generateWeeklyInsight
 * per eligible user; the app reads listInsights for the feed.
 *
 * PRIVACY (blueprint F9 + SUKOON_CONTEXT): the model is fed ONLY aggregate,
 * anonymised signals — a mood series, top emotions/factors, exercise & journey
 * COUNTS, and journal METADATA (entry count + mood tags). Decrypted journal
 * bodies are included ONLY for a Pro user who has explicitly opted into deep
 * insights (deep_insights_opt_in), bounded and never logged. The tier is the
 * real gate — we never trust the flag alone.
 *
 * Eligibility to generate: Plus+ tier, insights_opt_in on, and ≥3 mood entries
 * in the week (enough signal for a real reflection, not a hollow one).
 * Idempotent per (user, week_start) via the unique index — a re-run is a no-op
 * unless `force`. Every model call is cost-logged (purpose sukoon_weekly_insight).
 */
import type {
  SukoonChatLanguage,
  SukoonInsight,
  SukoonInsightContent,
} from "@neev/shared";
import { sukoonInsightContentSchema } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { MODELS } from "../../lib/models.js";
import { structuredJson, type LlmUsage } from "../../lib/anthropic.js";
import { daysBetween, istDateString, istDayRangeUtc, istToday, shiftDate } from "../../lib/ist.js";
import { getSukoonProfile } from "./profile.js";
import { getSukoonTier } from "./entitlements.js";
import { getEntry } from "./journal.js";
import {
  INSIGHTS_SCHEMA,
  INSIGHTS_SYSTEM,
  buildInsightsUserContent,
  type InsightJourneyOption,
  type InsightSignals,
} from "../prompts/insights.js";

/** Min mood entries in the week to bother generating (else the reflection is hollow). */
const MIN_MOOD_ENTRIES = 3;
/** Deep-insights: at most this many recent journal excerpts, each truncated. */
const DEEP_EXCERPT_LIMIT = 5;
const DEEP_EXCERPT_CHARS = 500;
const INSIGHTS_FEED_LIMIT = 12;

// ---------------------------------------------------------------------------
// Week window helpers (IST). A "week" is Monday 00:00 IST → next Monday 00:00.
// The Sunday-evening cron therefore reflects the Mon–Sun that is just ending.
// ---------------------------------------------------------------------------

/** The Monday (YYYY-MM-DD, IST) of the week containing `dateStr`. */
export function weekStartMonday(dateStr: string): string {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  return shiftDate(dateStr, dow === 0 ? -6 : 1 - dow);
}

/** The current IST week's Monday — what the Sunday job generates for. */
export function currentWeekStart(): string {
  return weekStartMonday(istToday());
}

// ---------------------------------------------------------------------------
// Signal gathering — the ONLY data that reaches the model.
// ---------------------------------------------------------------------------

interface MoodRow {
  score: number;
  emotions: string[] | null;
  factors: string[] | null;
  created_at: string;
}

function topN(rows: MoodRow[], key: "emotions" | "factors", n: number): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const v of r[key] ?? []) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function avg(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
}

async function gatherSignals(
  userId: string,
  weekStart: string,
  language: SukoonChatLanguage,
  deepEligible: boolean,
): Promise<InsightSignals> {
  const weekEnd = shiftDate(weekStart, 7);
  const startUtc = istDayRangeUtc(weekStart).startUtc;
  const endUtc = istDayRangeUtc(weekEnd).startUtc;
  const prevStartUtc = istDayRangeUtc(shiftDate(weekStart, -7)).startUtc;

  const db = supabase();

  // --- Mood (this week + prev-week avg for trend context) -------------------
  const { data: moodData } = await db
    .from("sukoon_mood_entries")
    .select("score, emotions, factors, created_at")
    .eq("user_id", userId)
    .gte("created_at", prevStartUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: true });
  const allMood = (moodData as MoodRow[] | null) ?? [];
  // Split this-week vs previous-week by EPOCH, not string compare: istDayRangeUtc
  // emits "…:00.000Z" while Postgres returns "…:00+00:00", so a string `>=` at
  // the exact week boundary compares '.' vs '+' and would drop a midnight entry.
  const startMs = new Date(startUtc).getTime();
  const weekMood = allMood.filter((r) => new Date(r.created_at).getTime() >= startMs);
  const prevMood = allMood.filter((r) => new Date(r.created_at).getTime() < startMs);

  // Mon→Sun daily average (null when no entry that day).
  const byDay = new Map<string, number[]>();
  for (const r of weekMood) {
    const d = istDateString(new Date(r.created_at).getTime());
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r.score);
  }
  const dailyScores: (number | null)[] = [];
  for (let i = 0; i < 7; i++) dailyScores.push(avg(byDay.get(shiftDate(weekStart, i)) ?? []));

  // --- Activity: exercise sessions + journeys -------------------------------
  const { count: exerciseCount } = await db
    .from("sukoon_exercise_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtc);

  const { data: progressData } = await db
    .from("sukoon_journey_progress")
    .select("journey_id, completed_steps, completed_at, journey:sukoon_journeys(title_en)")
    .eq("user_id", userId);
  const progressRows =
    (progressData as { completed_steps: string[] | null; completed_at: string | null; journey: { title_en: string } | null }[] | null) ?? [];
  const activeJourneys = progressRows.filter((p) => !p.completed_at);
  const journeysActive = activeJourneys.map((p) => p.journey?.title_en).filter((t): t is string => !!t);
  const journeyStepsDone = activeJourneys.reduce((n, p) => n + (p.completed_steps?.length ?? 0), 0);

  // --- Journal metadata (never bodies, unless deep-eligible) ----------------
  const { data: journalData } = await db
    .from("sukoon_journal_entries")
    .select("id, mood, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .order("created_at", { ascending: false });
  const journalRows = (journalData as { id: string; mood: number | null; created_at: string }[] | null) ?? [];
  const moodTags = journalRows.map((r) => r.mood).filter((m): m is number => m != null);

  let excerpts: string[] | undefined;
  if (deepEligible && journalRows.length) {
    excerpts = [];
    for (const r of journalRows.slice(0, DEEP_EXCERPT_LIMIT)) {
      try {
        const entry = await getEntry(userId, r.id); // decrypts one body
        const body = entry.body?.trim();
        if (body) excerpts.push(body.slice(0, DEEP_EXCERPT_CHARS));
      } catch (err) {
        // A decrypt hiccup (or unconfigured key) must never fail the insight —
        // just fall back to metadata-only for that entry. Never log the body.
        logger.warn({ userId, entryId: r.id }, "deep-insight excerpt decrypt skipped");
      }
    }
    if (!excerpts.length) excerpts = undefined;
  }

  // --- Exam context ---------------------------------------------------------
  const profile = await getSukoonProfile(userId);
  const examDate = profile?.exam_date ?? null;
  const daysToExam = examDate && examDate >= istToday() ? daysBetween(istToday(), examDate) : null;

  const weekLabel = `${istDateString(new Date(`${weekStart}T00:00:00Z`).getTime())} → ${shiftDate(weekStart, 6)}`;

  return {
    language,
    week_label: weekLabel,
    exam: profile?.exam ?? null,
    days_to_exam: daysToExam,
    mood: {
      entry_days: byDay.size,
      daily_scores: dailyScores,
      avg_score: avg(weekMood.map((r) => r.score)),
      prev_week_avg: avg(prevMood.map((r) => r.score)),
      top_emotions: topN(weekMood, "emotions", 4),
      top_factors: topN(weekMood, "factors", 3),
    },
    activity: {
      exercise_sessions: exerciseCount ?? 0,
      journeys_active: journeysActive,
      journey_steps_done: journeyStepsDone,
    },
    journal: { entry_count: journalRows.length, mood_tags: moodTags, excerpts },
  };
}

/** The published journeys the model may recommend, with denormalised titles. */
async function getJourneyOptions(): Promise<{
  forPrompt: InsightJourneyOption[];
  bySlug: Map<string, { title_hi: string; title_en: string }>;
}> {
  const { data } = await supabase()
    .from("sukoon_journeys")
    .select("slug, title_hi, title_en, description_en")
    .eq("published", true)
    .order("title_en", { ascending: true });
  const rows = (data as { slug: string; title_hi: string; title_en: string; description_en: string | null }[] | null) ?? [];
  return {
    forPrompt: rows.map((r) => ({
      slug: r.slug,
      title_en: r.title_en,
      description_en: (r.description_en ?? "").slice(0, 160),
    })),
    bySlug: new Map(rows.map((r) => [r.slug, { title_hi: r.title_hi, title_en: r.title_en }])),
  };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export type InsightGenOutcome =
  | { status: "generated"; insight: SukoonInsight; costUsd: number }
  | { status: "dry_run"; content: SukoonInsightContent; signals: InsightSignals }
  | { status: "skipped"; reason: string };

export interface GenerateOptions {
  /** Regenerate even if a row already exists for the week (upsert). */
  force?: boolean;
  /** Build + call the model but DON'T persist or push (acceptance dry-run). */
  dryRun?: boolean;
  /** Abort the in-flight model call (SSE/CLI cancellation). */
  signal?: AbortSignal;
}

export async function generateWeeklyInsight(
  userId: string,
  weekStart: string,
  opts: GenerateOptions = {},
): Promise<InsightGenOutcome> {
  const profile = await getSukoonProfile(userId);
  if (!profile) return { status: "skipped", reason: "no_profile" };
  if (!profile.insights_opt_in) return { status: "skipped", reason: "opted_out" };

  const tier = await getSukoonTier(userId);
  if (tier === "free") return { status: "skipped", reason: "free_tier" };

  // Idempotency: skip an already-generated week unless forced (before any spend).
  if (!opts.force && !opts.dryRun) {
    const { data: existing } = await supabase()
      .from("sukoon_insights")
      .select("id")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (existing) return { status: "skipped", reason: "already_exists" };
  }

  const deepEligible = tier === "pro" && profile.deep_insights_opt_in;
  const signals = await gatherSignals(userId, weekStart, profile.language, deepEligible);
  if (signals.mood.entry_days < MIN_MOOD_ENTRIES) {
    return { status: "skipped", reason: "insufficient_data" };
  }

  const journeys = await getJourneyOptions();

  let usage: LlmUsage | undefined;
  const raw = await structuredJson<SukoonInsightContent>({
    model: MODELS.sonnet,
    // Cached head (byte-identical across the run) + effort:low — warm reflective
    // prose, not a reasoning task; keeps the weekly batch cheap.
    system: [{ text: INSIGHTS_SYSTEM, cache: true }],
    content: buildInsightsUserContent(signals, journeys.forPrompt),
    schema: INSIGHTS_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxTokens: 1200,
    purpose: "sukoon_weekly_insight",
    userId,
    onUsage: (u) => (usage = u),
    signal: opts.signal,
  });

  // Validate the model's structured output + guard the journey slug against
  // hallucination (only a real published slug survives).
  const parsed = sukoonInsightContentSchema.parse(raw);
  const journeyMeta = parsed.journey_slug ? journeys.bySlug.get(parsed.journey_slug) : undefined;
  const content: SukoonInsightContent = {
    summary: parsed.summary.trim(),
    suggestion: parsed.suggestion.trim(),
    journey_slug: journeyMeta ? parsed.journey_slug : null,
    journey_reason: journeyMeta ? parsed.journey_reason.trim() : "",
  };

  if (opts.dryRun) return { status: "dry_run", content, signals };

  const { data, error } = await supabase()
    .from("sukoon_insights")
    .upsert(
      {
        user_id: userId,
        week_start: weekStart,
        content: content.summary,
        suggestion: content.suggestion,
        journey_slug: content.journey_slug,
        journey_reason: content.journey_reason,
        journey_title_hi: journeyMeta?.title_hi ?? null,
        journey_title_en: journeyMeta?.title_en ?? null,
        language: profile.language,
        meta: {
          model: MODELS.sonnet,
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: usage?.outputTokens ?? null,
          cost_usd: usage?.costUsd ?? null,
          deep: deepEligible,
          signal_counts: {
            mood_entry_days: signals.mood.entry_days,
            exercise_sessions: signals.activity.exercise_sessions,
            journal_entries: signals.journal.entry_count,
          },
        },
      },
      { onConflict: "user_id,week_start" },
    )
    .select("id, week_start, created_at")
    .single();
  if (error) throw new Error(`insight persist failed: ${error.message}`);

  const row = data as { id: string; week_start: string; created_at: string };
  return {
    status: "generated",
    costUsd: usage?.costUsd ?? 0,
    insight: {
      id: row.id,
      week_start: row.week_start,
      content,
      journey_title_hi: journeyMeta?.title_hi ?? null,
      journey_title_en: journeyMeta?.title_en ?? null,
      created_at: row.created_at,
    },
  };
}

// ---------------------------------------------------------------------------
// Read (the in-app feed)
// ---------------------------------------------------------------------------

interface InsightRow {
  id: string;
  week_start: string;
  content: string;
  suggestion: string | null;
  journey_slug: string | null;
  journey_reason: string | null;
  journey_title_hi: string | null;
  journey_title_en: string | null;
  created_at: string;
}

function toInsight(row: InsightRow): SukoonInsight {
  return {
    id: row.id,
    week_start: row.week_start,
    content: {
      summary: row.content,
      suggestion: row.suggestion ?? "",
      journey_slug: row.journey_slug,
      journey_reason: row.journey_reason ?? "",
    },
    journey_title_hi: row.journey_title_hi,
    journey_title_en: row.journey_title_en,
    created_at: row.created_at,
  };
}

export async function listInsights(userId: string): Promise<SukoonInsight[]> {
  const { data, error } = await supabase()
    .from("sukoon_insights")
    .select(
      "id, week_start, content, suggestion, journey_slug, journey_reason, journey_title_hi, journey_title_en, created_at",
    )
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(INSIGHTS_FEED_LIMIT);
  if (error) throw new Error(`insights list failed: ${error.message}`);
  return ((data as InsightRow[] | null) ?? []).map(toInsight);
}

/** Whether weekly insights are currently active for this user (tier + opt-in). */
export async function insightsEnabled(userId: string): Promise<boolean> {
  const [tier, profile] = await Promise.all([getSukoonTier(userId), getSukoonProfile(userId)]);
  return tier !== "free" && !!profile?.insights_opt_in;
}
