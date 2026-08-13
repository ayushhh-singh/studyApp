/**
 * Achievement milestones. evaluateMilestones computes the user's current metrics
 * and awards any newly-crossed milestone idempotently (unique on user+key). GET
 * /milestones runs it and returns the still-unseen ones, which the client shows
 * as one-time dismissible toasts (dismiss → mark seen).
 */
import type { Badge, BilingualText, Milestone } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { getGradedAnswers } from "../lib/graded-answers.js";
import { countPerfectDays } from "./daily-stats.js";
import { countDistinctBoardAppearances } from "./scoreboard.js";

type Metric =
  | "evaluations"
  | "attempts"
  | "mcqs"
  | "streak"
  | "perfect_days"
  | "board_appearances"
  | "srs_reviews"
  | "community_posts"
  | "mentor_doubts";

interface MilestoneDef {
  key: string;
  metric: Metric;
  threshold: number;
  title_i18n: BilingualText;
  body_i18n: BilingualText;
}

/**
 * ⚑ ADDING A METRIC IS NOT FREE. `computeMetrics` runs on EVERY GET /milestones
 * and GET /milestones/case, and the dashboard hits the first on every load — so
 * each new Metric is a query on a hot path, forever. Prefer a new THRESHOLD on
 * an existing metric (costs nothing) over a new metric; when a new metric is
 * genuinely needed, keep it to a single indexed `head: true` count.
 *
 * `getGradedAnswers` (the `mcqs` metric) is already the expensive one — it pages
 * every graded answer rather than counting — so do not add anything of that
 * shape here. `awardEarned` short-circuits once a user holds every badge, which
 * is what keeps the cost bounded as this list grows.
 */

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
  {
    key: "scoreboard_regular",
    metric: "board_appearances",
    threshold: 3,
    title_i18n: { en: "Scoreboard regular", hi: "स्कोरबोर्ड नियमित" },
    body_i18n: {
      en: "You've shown up on 3 different scoreboards — real competition, real progress.",
      hi: "आप 3 अलग-अलग स्कोरबोर्ड पर दिखे — असली प्रतिस्पर्धा, असली प्रगति।",
    },
  },

  // --- Longer rungs on ladders that already existed -------------------------
  // Free: they reuse a metric that is already computed. The originals topped out
  // early enough that a committed aspirant ran out of badges in a few weeks.
  {
    key: "answers_50",
    metric: "evaluations",
    threshold: 50,
    title_i18n: { en: "50 answers written", hi: "50 उत्तर लिखे" },
    body_i18n: {
      en: "Fifty evaluated answers. This is the volume that actually moves a Mains score.",
      hi: "पचास मूल्यांकित उत्तर। यही वह अभ्यास है जो मुख्य परीक्षा का स्कोर वास्तव में बदलता है।",
    },
  },
  {
    key: "mcqs_1000",
    metric: "mcqs",
    threshold: 1000,
    title_i18n: { en: "1,000 MCQs answered", hi: "1,000 एमसीक्यू हल किए" },
    body_i18n: {
      en: "A thousand questions attempted — you've covered real ground.",
      hi: "एक हज़ार प्रश्न हल किए — आपने वास्तविक दूरी तय की है।",
    },
  },
  {
    key: "streak_100",
    metric: "streak",
    threshold: 100,
    title_i18n: { en: "100-day streak!", hi: "100-दिन की स्ट्रीक!" },
    body_i18n: {
      en: "A hundred days without a break. Very few aspirants get here.",
      hi: "सौ दिन बिना रुके। बहुत कम अभ्यर्थी यहाँ तक पहुँचते हैं।",
    },
  },
  {
    key: "perfect_days_30",
    metric: "perfect_days",
    threshold: 30,
    title_i18n: { en: "30 Perfect Days", hi: "30 पर्फेक्ट दिन" },
    body_i18n: {
      en: "Thirty days with the full Today checklist done — a month of complete study days.",
      hi: "तीस दिन पूरी 'आज' चेकलिस्ट पूरी — पूरे एक महीने के सम्पूर्ण अध्ययन दिवस।",
    },
  },

  // --- Areas that had NO badge at all --------------------------------------
  // Revision, the mentor and community are whole features a user can live in
  // without the badge case ever acknowledging it. Revision is the sharpest gap:
  // it is a flagship (real FSRS scheduling) and spaced repetition is precisely
  // the habit that most needs reinforcing, because its payoff is invisible for
  // weeks.
  {
    key: "revision_50",
    metric: "srs_reviews",
    threshold: 50,
    title_i18n: { en: "50 cards revised", hi: "50 कार्ड दोहराए" },
    body_i18n: {
      en: "Fifty spaced-repetition reviews. Revision is where retention is actually built.",
      hi: "पचास स्पेस्ड-रिपिटीशन रिवीज़न। धारण-शक्ति यहीं बनती है।",
    },
  },
  {
    key: "revision_500",
    metric: "srs_reviews",
    threshold: 500,
    title_i18n: { en: "500 cards revised", hi: "500 कार्ड दोहराए" },
    body_i18n: {
      en: "Five hundred reviews — you're revising like someone who intends to clear this.",
      hi: "पाँच सौ रिवीज़न — आप उस तरह दोहरा रहे हैं जैसे परीक्षा निकालने वाले दोहराते हैं।",
    },
  },
  {
    key: "first_doubt",
    metric: "mentor_doubts",
    threshold: 1,
    title_i18n: { en: "First doubt asked", hi: "पहला संदेह पूछा" },
    body_i18n: {
      en: "You asked the mentor your first doubt. Asking early beats staying stuck.",
      hi: "आपने मेंटर से पहला संदेह पूछा। जल्दी पूछना, अटके रहने से बेहतर है।",
    },
  },
  {
    key: "first_post",
    metric: "community_posts",
    threshold: 1,
    title_i18n: { en: "Joined the discussion", hi: "चर्चा में शामिल हुए" },
    body_i18n: {
      en: "Your first community post. Explaining a topic to someone else is how you find your own gaps.",
      hi: "आपकी पहली सामुदायिक पोस्ट। किसी और को समझाना ही अपनी कमियाँ खोजने का तरीका है।",
    },
  },
];

const defByKey = new Map(MILESTONE_DEFS.map((d) => [d.key, d]));

async function computeMetrics(userId: string): Promise<Record<Metric, number>> {
  const [evalRes, attemptRes, graded, profileRes, perfectDays, boardAppearances, srsRes, postRes, doubtRes] =
    await Promise.all([
      supabase().from("answer_submissions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "complete"),
      supabase().from("attempts").select("id", { count: "exact", head: true }).eq("user_id", userId).not("submitted_at", "is", null),
      getGradedAnswers(userId),
      supabase().from("users_profile").select("streak_count").eq("id", userId).maybeSingle(),
      countPerfectDays(userId),
      countDistinctBoardAppearances(userId),
      // head:true — the COUNT only, no rows over the wire. Deliberately not the
      // `getGradedAnswers` shape, which pages every row.
      supabase().from("srs_reviews").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase().from("discussion_posts").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase().from("doubt_threads").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
  if (evalRes.error) throw new HttpError(500, `evaluations count failed: ${evalRes.error.message}`);
  if (attemptRes.error) throw new HttpError(500, `attempts count failed: ${attemptRes.error.message}`);
  if (profileRes.error) throw new HttpError(500, `profile lookup failed: ${profileRes.error.message}`);
  if (srsRes.error) throw new HttpError(500, `srs review count failed: ${srsRes.error.message}`);
  if (postRes.error) throw new HttpError(500, `community post count failed: ${postRes.error.message}`);
  if (doubtRes.error) throw new HttpError(500, `doubt thread count failed: ${doubtRes.error.message}`);
  return {
    evaluations: evalRes.count ?? 0,
    attempts: attemptRes.count ?? 0,
    mcqs: graded.length,
    streak: (profileRes.data?.streak_count as number | undefined) ?? 0,
    perfect_days: perfectDays,
    board_appearances: boardAppearances,
    srs_reviews: srsRes.count ?? 0,
    community_posts: postRes.count ?? 0,
    mentor_doubts: doubtRes.count ?? 0,
  };
}

/**
 * In-flight `computeMetrics` calls, keyed by user — a single-flight guard, NOT
 * a cache.
 *
 * A profile page load fires BOTH `/milestones` (the toaster, mounted app-wide)
 * and `/milestones/case` within milliseconds, and each ran the full nine-query
 * pass independently: measured 483 ms + 401 ms, with `getGradedAnswers` paging
 * every graded answer twice. Sharing the in-flight promise makes the second
 * request free.
 *
 * Deliberately NOT a TTL cache. A TTL would also collapse the toaster's
 * 2-minute poll, but it would mean showing stale progress right after the
 * action that moved it — crossing 100 MCQs and then seeing "99 / 100" is
 * exactly the moment this feature exists for. Single-flight has no staleness:
 * the entry is deleted the moment the promise settles, so anything sequential
 * recomputes, and the map cannot grow (one entry per concurrent request).
 */
const inFlightMetrics = new Map<string, Promise<Record<Metric, number>>>();

function metricsFor(userId: string): Promise<Record<Metric, number>> {
  const existing = inFlightMetrics.get(userId);
  if (existing) return existing;
  // `finally`, not `then`: the entry must clear on rejection too, or one failed
  // pass would pin a rejected promise and fail every later request for that
  // user for the life of the process.
  const p = computeMetrics(userId).finally(() => inFlightMetrics.delete(userId));
  inFlightMetrics.set(userId, p);
  return p;
}

/**
 * The keys this user already holds. One cheap indexed read.
 *
 * ⚑ Filtered to keys still IN the catalogue. A `milestones` row can outlive its
 * definition — mapMilestone already tolerates that ("a retired milestone key —
 * skip rather than crash") — and an unfiltered count would let N retired rows
 * satisfy the all-badges-held check in `evaluateMilestones`, silently stopping
 * that user from ever earning N real badges again. Latent today (0 unknown keys
 * live, max held 7 of 17) but it would fail silently, which is the worst shape.
 */
async function fetchEarnedKeys(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase().from("milestones").select("key").eq("user_id", userId);
  if (error) throw new HttpError(500, `milestone lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.key as string).filter((k) => defByKey.has(k)));
}

/** Insert any crossed-but-unheld milestone. Idempotent (unique on user+key). */
async function awardEarned(userId: string, metrics: Record<Metric, number>, have: Set<string>): Promise<void> {
  const toInsert = MILESTONE_DEFS.filter((d) => !have.has(d.key) && metrics[d.metric] >= d.threshold).map((d) => d.key);
  if (toInsert.length === 0) return;
  const { error: insErr } = await supabase()
    .from("milestones")
    .upsert(
      toInsert.map((key) => ({ user_id: userId, key })),
      { onConflict: "user_id,key", ignoreDuplicates: true },
    );
  if (insErr) throw new HttpError(500, `milestone insert failed: ${insErr.message}`);
}

/**
 * Award any newly-crossed milestone.
 *
 * Reads the held keys FIRST and returns immediately if the user already holds
 * every badge — one cheap count instead of the nine queries `computeMetrics`
 * runs. That ordering is what stops this hot path (the dashboard calls it on
 * every load) getting more expensive each time the catalogue grows.
 */
export async function evaluateMilestones(userId: string): Promise<void> {
  const have = await fetchEarnedKeys(userId);
  if (have.size >= MILESTONE_DEFS.length) return;
  const metrics = await metricsFor(userId);
  await awardEarned(userId, metrics, have);
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

/**
 * The profile's badge case: the WHOLE catalogue, each entry marked earned or
 * not and carrying the user's progress toward it.
 *
 * Deliberately not "the earned ones" (which is what this used to return, and
 * is still what listUnseenMilestones does for the toasts). A case that shows
 * only what you already hold cannot tell you what exists or what is close —
 * the unearned slots ARE the roadmap, and they are the reason to come back.
 * Progress is returned per badge so the client can surface the nearest one
 * without needing to know any threshold itself.
 *
 * Order: earned first (newest first — the most recent achievement is the one
 * worth seeing), then locked sorted by how close they are, so the next one to
 * chase is always at the head of the locked group.
 */
export async function getBadgeCase(userId: string): Promise<Badge[]> {
  const metrics = await metricsFor(userId);
  const { data, error } = await supabase()
    .from("milestones")
    .select("key, achieved_at")
    .eq("user_id", userId);
  if (error) throw new HttpError(500, `milestone list failed: ${error.message}`);
  const rows = (data ?? []) as { key: string; achieved_at: string }[];
  const earnedAt = new Map(rows.map((r) => [r.key, r.achieved_at]));

  // Award before building, so a badge crossed by this very request shows as
  // earned rather than at 100% progress and still locked.
  await awardEarned(userId, metrics, new Set(earnedAt.keys()));

  const badges: Badge[] = MILESTONE_DEFS.map((d) => {
    const current = metrics[d.metric];
    return {
      key: d.key,
      title_i18n: d.title_i18n,
      body_i18n: d.body_i18n,
      // A badge just awarded above has no row in `earnedAt` yet — treat
      // "threshold met" as earned so it never renders as locked-at-100%.
      earned_at: earnedAt.get(d.key) ?? (current >= d.threshold ? new Date().toISOString() : null),
      // Capped: a user with 4,000 MCQs should read "1000 / 1000", not "4000 / 1000".
      progress: { current: Math.min(current, d.threshold), target: d.threshold },
    };
  });

  return badges.sort((a, b) => {
    if (a.earned_at && b.earned_at) return a.earned_at < b.earned_at ? 1 : -1;
    if (a.earned_at) return -1;
    if (b.earned_at) return 1;
    return b.progress.current / b.progress.target - a.progress.current / a.progress.target;
  });
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
