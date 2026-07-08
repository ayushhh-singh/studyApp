/**
 * Achievement milestones. evaluateMilestones computes the user's current metrics
 * and awards any newly-crossed milestone idempotently (unique on user+key). GET
 * /milestones runs it and returns the still-unseen ones, which the client shows
 * as one-time dismissible toasts (dismiss → mark seen).
 */
import type { BilingualText, Milestone } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { getGradedAnswers } from "../lib/graded-answers.js";
import { countPerfectDays } from "./daily-stats.js";

type Metric = "evaluations" | "attempts" | "mcqs" | "streak" | "perfect_days";

interface MilestoneDef {
  key: string;
  metric: Metric;
  threshold: number;
  title_i18n: BilingualText;
  body_i18n: BilingualText;
}

const MILESTONE_DEFS: MilestoneDef[] = [
  {
    key: "first_evaluation",
    metric: "evaluations",
    threshold: 1,
    title_i18n: { en: "First answer evaluated!", hi: "पहला उत्तर मूल्यांकित!" },
    body_i18n: { en: "You've written and scored your first Mains answer.", hi: "आपने अपना पहला मुख्य परीक्षा उत्तर लिखा और स्कोर किया।" },
  },
  {
    key: "answers_10",
    metric: "evaluations",
    threshold: 10,
    title_i18n: { en: "10 answers written", hi: "10 उत्तर लिखे" },
    body_i18n: { en: "Ten evaluated answers — answer writing is becoming a habit.", hi: "दस मूल्यांकित उत्तर — उत्तर लेखन आदत बन रही है।" },
  },
  {
    key: "first_test",
    metric: "attempts",
    threshold: 1,
    title_i18n: { en: "First test done", hi: "पहला टेस्ट पूरा" },
    body_i18n: { en: "You've completed your first practice test.", hi: "आपने अपना पहला अभ्यास टेस्ट पूरा किया।" },
  },
  {
    key: "mcqs_100",
    metric: "mcqs",
    threshold: 100,
    title_i18n: { en: "100 MCQs answered", hi: "100 एमसीक्यू हल किए" },
    body_i18n: { en: "A century of practice questions — keep going!", hi: "अभ्यास प्रश्नों का शतक — जारी रखें!" },
  },
  {
    key: "mcqs_250",
    metric: "mcqs",
    threshold: 250,
    title_i18n: { en: "250 MCQs answered", hi: "250 एमसीक्यू हल किए" },
    body_i18n: { en: "250 questions in — serious preparation.", hi: "250 प्रश्न पूरे — गंभीर तैयारी।" },
  },
  {
    key: "streak_7",
    metric: "streak",
    threshold: 7,
    title_i18n: { en: "7-day streak!", hi: "7-दिन की स्ट्रीक!" },
    body_i18n: { en: "A full week of daily study. Consistency wins.", hi: "पूरे सप्ताह की दैनिक पढ़ाई। निरंतरता जीतती है।" },
  },
  {
    key: "streak_30",
    metric: "streak",
    threshold: 30,
    title_i18n: { en: "30-day streak!", hi: "30-दिन की स्ट्रीक!" },
    body_i18n: { en: "A month of unbroken study — exceptional discipline.", hi: "एक महीने की अटूट पढ़ाई — असाधारण अनुशासन।" },
  },
  {
    key: "perfect_days_7",
    metric: "perfect_days",
    threshold: 7,
    title_i18n: { en: "7 Perfect Days", hi: "7 पर्फेक्ट दिन" },
    body_i18n: {
      en: "Seven days with the full Today checklist done. That's exactly how toppers study.",
      hi: "सात दिन पूरी 'आज' चेकलिस्ट पूरी की। टॉपर्स ऐसे ही पढ़ते हैं।",
    },
  },
];

const defByKey = new Map(MILESTONE_DEFS.map((d) => [d.key, d]));

async function computeMetrics(userId: string): Promise<Record<Metric, number>> {
  const [evalRes, attemptRes, graded, profileRes, perfectDays] = await Promise.all([
    supabase().from("answer_submissions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "complete"),
    supabase().from("attempts").select("id", { count: "exact", head: true }).eq("user_id", userId).not("submitted_at", "is", null),
    getGradedAnswers(userId),
    supabase().from("users_profile").select("streak_count").eq("id", userId).maybeSingle(),
    countPerfectDays(userId),
  ]);
  if (evalRes.error) throw new HttpError(500, `evaluations count failed: ${evalRes.error.message}`);
  if (attemptRes.error) throw new HttpError(500, `attempts count failed: ${attemptRes.error.message}`);
  if (profileRes.error) throw new HttpError(500, `profile lookup failed: ${profileRes.error.message}`);
  return {
    evaluations: evalRes.count ?? 0,
    attempts: attemptRes.count ?? 0,
    mcqs: graded.length,
    streak: (profileRes.data?.streak_count as number | undefined) ?? 0,
    perfect_days: perfectDays,
  };
}

/** Award any newly-crossed milestone; returns the full achieved list. */
export async function evaluateMilestones(userId: string): Promise<void> {
  const metrics = await computeMetrics(userId);
  const earned = MILESTONE_DEFS.filter((d) => metrics[d.metric] >= d.threshold).map((d) => d.key);
  if (earned.length === 0) return;

  const { data: existing, error } = await supabase()
    .from("milestones")
    .select("key")
    .eq("user_id", userId)
    .in("key", earned);
  if (error) throw new HttpError(500, `milestone lookup failed: ${error.message}`);
  const have = new Set((existing ?? []).map((r) => r.key as string));
  const toInsert = earned.filter((k) => !have.has(k));
  if (toInsert.length === 0) return;

  const { error: insErr } = await supabase()
    .from("milestones")
    .upsert(
      toInsert.map((key) => ({ user_id: userId, key })),
      { onConflict: "user_id,key", ignoreDuplicates: true },
    );
  if (insErr) throw new HttpError(500, `milestone insert failed: ${insErr.message}`);
}

function mapMilestone(row: { id: string; key: string; achieved_at: string; seen: boolean }): Milestone | null {
  const def = defByKey.get(row.key);
  if (!def) return null; // a retired milestone key — skip rather than crash
  return { id: row.id, key: row.key, achieved_at: row.achieved_at, seen: row.seen, title_i18n: def.title_i18n, body_i18n: def.body_i18n };
}

export async function listUnseenMilestones(userId: string): Promise<Milestone[]> {
  const { data, error } = await supabase()
    .from("milestones")
    .select("id, key, achieved_at, seen")
    .eq("user_id", userId)
    .eq("seen", false)
    .order("achieved_at", { ascending: true });
  if (error) throw new HttpError(500, `milestone list failed: ${error.message}`);
  return ((data ?? []) as { id: string; key: string; achieved_at: string; seen: boolean }[])
    .map(mapMilestone)
    .filter((m): m is Milestone => m !== null);
}

export async function markMilestoneSeen(userId: string, id: string): Promise<Milestone> {
  const { data, error } = await supabase()
    .from("milestones")
    .update({ seen: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, key, achieved_at, seen")
    .maybeSingle();
  if (error) throw new HttpError(500, `milestone update failed: ${error.message}`);
  if (!data) throw notFound("Milestone not found");
  const m = mapMilestone(data as { id: string; key: string; achieved_at: string; seen: boolean });
  if (!m) throw notFound("Milestone not found");
  return m;
}
