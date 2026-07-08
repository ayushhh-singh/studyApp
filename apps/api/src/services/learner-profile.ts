/**
 * Feature 1 — the learner profile.
 *
 * A compact, size-capped JSON snapshot of who this aspirant is right now: weak
 * and strong top-level syllabus sections, the trend across their last answer
 * evaluations, streak, days to exam, recently studied nodes, and a 7-day
 * activity pace. Recomputed nightly and on-demand (and lazily when stale), then
 * injected into every AI-mentor answer so replies can be personal
 * ("you've been missing DPSP questions — here's the distinction again").
 *
 * Everything here is derived from real rows; nothing is invented. The snapshot
 * is deliberately small (top-5 lists, 6 dimension averages) so it stays cheap to
 * prompt-cache in the mentor system prompt.
 */
import type { BilingualText, DimensionScore, LearnerProfile, Locale } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { getGradedAnswers } from "../lib/graded-answers.js";
import { istToday, daysBetween } from "../lib/ist.js";

const TOP_N = 5;
/** A cached profile older than this is recomputed on read. */
const STALE_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface NodeRow {
  id: string;
  paper_code: string;
  path: string;
  depth: number;
  title_i18n: BilingualText;
}

/**
 * Roll the user's graded MCQ answers up to their top-level syllabus section
 * (depth 1) — the same attribution the dashboard weakness radar uses — and
 * return the weakest-first and strongest-first buckets that have ≥3 answers
 * (so a single lucky/unlucky question doesn't dominate).
 */
async function buildNodeBuckets(userId: string) {
  const graded = await getGradedAnswers(userId);
  const nodeIds = new Set(graded.map((g) => g.questions?.syllabus_node_id).filter((x): x is string => !!x));
  if (nodeIds.size === 0) return { weak: [], strong: [] };

  const { data: nodes, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, path, depth, title_i18n");
  if (error) throw new HttpError(500, `syllabus nodes lookup failed: ${error.message}`);
  const nodeRows = (nodes ?? []) as NodeRow[];
  const nodeById = new Map(nodeRows.map((n) => [n.id, n]));
  const topByKey = new Map(nodeRows.filter((n) => n.depth === 1).map((n) => [`${n.paper_code}::${n.path}`, n]));

  const byTop = new Map<string, { node: NodeRow; correct: number; total: number }>();
  for (const row of graded) {
    const id = row.questions?.syllabus_node_id;
    if (!id) continue;
    const node = nodeById.get(id);
    if (!node) continue;
    const top = topByKey.get(`${node.paper_code}::${node.path.split("/")[0]}`);
    if (!top) continue;
    const bucket = byTop.get(top.id) ?? { node: top, correct: 0, total: 0 };
    bucket.total += 1;
    if (row.is_correct) bucket.correct += 1;
    byTop.set(top.id, bucket);
  }

  const scored = [...byTop.values()]
    .filter((b) => b.total >= 3)
    .map((b) => ({
      node_id: b.node.id,
      paper_code: b.node.paper_code,
      title_i18n: b.node.title_i18n,
      accuracy_pct: round2((b.correct / b.total) * 100),
      answered_count: b.total,
    }));

  const weak = [...scored].sort((a, b) => a.accuracy_pct - b.accuracy_pct).slice(0, TOP_N);
  const strong = [...scored]
    .sort((a, b) => b.accuracy_pct - a.accuracy_pct)
    .filter((n) => n.accuracy_pct >= 60)
    .slice(0, TOP_N);
  return { weak, strong };
}

async function buildEvaluationTrend(userId: string): Promise<LearnerProfile["evaluation"]> {
  const { data, error } = await supabase()
    .from("evaluations")
    .select("overall_score, max_score, dimension_scores, created_at, answer_submissions!inner(user_id)")
    .eq("answer_submissions.user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new HttpError(500, `evaluations lookup failed: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    overall_score: number | null;
    max_score: number | null;
    dimension_scores: DimensionScore[] | null;
  }[];

  if (rows.length === 0) {
    return { count: 0, recent_overall_pct: null, trend: "none", dimension_avgs: {}, weakest_dimension: null };
  }

  // rows are newest-first. Percentage of max for each.
  const pcts = rows
    .filter((r) => r.overall_score != null && r.max_score && r.max_score > 0)
    .map((r) => (r.overall_score as number) / (r.max_score as number) * 100);

  const recent_overall_pct = pcts.length ? round2(pcts[0]) : null;
  let trend: LearnerProfile["evaluation"]["trend"] = "none";
  if (pcts.length >= 4) {
    const half = Math.floor(pcts.length / 2);
    const newer = pcts.slice(0, half); // most recent
    const older = pcts.slice(half);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const delta = avg(newer) - avg(older);
    trend = delta > 3 ? "up" : delta < -3 ? "down" : "flat";
  } else if (pcts.length >= 1) {
    trend = "flat";
  }

  // Average each dimension's 0-10 score across the available evaluations.
  const dimSum = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    for (const d of r.dimension_scores ?? []) {
      const cur = dimSum.get(d.key) ?? { sum: 0, n: 0 };
      cur.sum += d.score;
      cur.n += 1;
      dimSum.set(d.key, cur);
    }
  }
  const dimension_avgs: Record<string, number> = {};
  let weakest: { key: string; avg: number } | null = null;
  for (const [key, { sum, n }] of dimSum) {
    const avg = round2(sum / n);
    dimension_avgs[key] = avg;
    if (!weakest || avg < weakest.avg) weakest = { key, avg };
  }

  return {
    count: rows.length,
    recent_overall_pct,
    trend,
    dimension_avgs,
    weakest_dimension: weakest?.key ?? null,
  };
}

async function buildRecentNodes(userId: string): Promise<LearnerProfile["recent_nodes"]> {
  const { data, error } = await supabase()
    .from("events")
    .select("props, created_at")
    .eq("user_id", userId)
    .eq("name", "syllabus_node_view")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new HttpError(500, `recent node events lookup failed: ${error.message}`);

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of data ?? []) {
    const id = (row.props as { node_id?: string } | null)?.node_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length >= TOP_N) break;
  }
  if (ids.length === 0) return [];

  const { data: nodes, error: nodesError } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, title_i18n")
    .in("id", ids);
  if (nodesError) throw new HttpError(500, `recent nodes lookup failed: ${nodesError.message}`);
  const byId = new Map((nodes ?? []).map((n) => [n.id as string, n]));
  return ids
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((n) => ({ node_id: n.id as string, paper_code: n.paper_code as string, title_i18n: n.title_i18n as BilingualText }));
}

async function buildActivity(userId: string): Promise<LearnerProfile["activity_last_7d"]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count: answers } = await supabase()
    .from("evaluations")
    .select("id, answer_submissions!inner(user_id)", { count: "exact", head: true })
    .eq("answer_submissions.user_id", userId)
    .gte("created_at", cutoff);

  const { count: reviews } = await supabase()
    .from("srs_reviews")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("reviewed_at", cutoff);

  // MCQs attempted in the window: attempt_answers on this user's recent attempts.
  const { data: recentAttempts } = await supabase()
    .from("attempts")
    .select("id")
    .eq("user_id", userId)
    .gte("started_at", cutoff);
  const attemptIds = (recentAttempts ?? []).map((r) => r.id as string);
  let mcqs = 0;
  if (attemptIds.length > 0) {
    const { count } = await supabase()
      .from("attempt_answers")
      .select("id", { count: "exact", head: true })
      .in("attempt_id", attemptIds);
    mcqs = count ?? 0;
  }

  return { answers_written: answers ?? 0, mcqs_attempted: mcqs, srs_reviews: reviews ?? 0 };
}

/** Compute the profile from live rows and persist it. */
export async function computeLearnerProfile(userId: string): Promise<LearnerProfile> {
  const today = istToday();

  const { data: profileRow, error: profileError } = await supabase()
    .from("users_profile")
    .select("streak_count, preferred_locale")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new HttpError(500, `profile lookup failed: ${profileError.message}`);

  const { data: exam } = await supabase()
    .from("exam_calendar")
    .select("exam_date")
    .eq("exam_stage", "prelims")
    .gte("exam_date", today)
    .order("exam_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const [buckets, evaluation, recent_nodes, activity_last_7d] = await Promise.all([
    buildNodeBuckets(userId),
    buildEvaluationTrend(userId),
    buildRecentNodes(userId),
    buildActivity(userId),
  ]);

  const profile: LearnerProfile = {
    weak_nodes: buckets.weak,
    strong_nodes: buckets.strong,
    evaluation,
    streak_count: (profileRow?.streak_count as number | undefined) ?? 0,
    days_to_exam: exam?.exam_date ? daysBetween(today, exam.exam_date as string) : null,
    recent_nodes,
    activity_last_7d,
    locale: ((profileRow?.preferred_locale as Locale | undefined) ?? "en"),
    computed_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase()
    .from("learner_profiles")
    .upsert({ user_id: userId, profile, computed_at: profile.computed_at }, { onConflict: "user_id" });
  if (upsertError) logger.warn({ err: upsertError }, "learner profile upsert failed");

  return profile;
}

/** Read the cached profile, recomputing when missing, stale, or forced. */
export async function getLearnerProfile(
  userId: string,
  opts: { refresh?: boolean } = {},
): Promise<LearnerProfile> {
  if (!opts.refresh) {
    const { data, error } = await supabase()
      .from("learner_profiles")
      .select("profile, computed_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new HttpError(500, `learner profile lookup failed: ${error.message}`);
    if (data?.profile && Date.now() - Date.parse(data.computed_at as string) < STALE_MS) {
      return data.profile as LearnerProfile;
    }
  }
  return computeLearnerProfile(userId);
}

const DIMENSION_LABELS: Record<string, string> = {
  structure_flow: "structure & flow",
  content_coverage: "content coverage",
  keywords_concepts: "keywords & concepts",
  examples_data: "examples & data",
  presentation: "presentation",
  word_limit_language: "word limit & language",
};

/**
 * Render the profile as a compact plain-text block for the mentor's system
 * prompt. Returns "" for a brand-new user with no signal (so the mentor stays
 * generic rather than fabricating a persona). Deterministic → prompt-cacheable.
 */
export function formatProfileForPrompt(p: LearnerProfile): string {
  const lines: string[] = [];
  const title = (n: { title_i18n: BilingualText }) => n.title_i18n.en || n.title_i18n.hi;

  if (p.days_to_exam != null) lines.push(`Days until next Prelims: ${p.days_to_exam}.`);
  if (p.streak_count > 0) lines.push(`Current study streak: ${p.streak_count} day(s).`);

  if (p.weak_nodes.length) {
    lines.push(
      `Weak sections (low MCQ accuracy): ${p.weak_nodes
        .map((n) => `${title(n)} (${n.accuracy_pct}% over ${n.answered_count})`)
        .join("; ")}.`,
    );
  }
  if (p.strong_nodes.length) {
    lines.push(`Strong sections: ${p.strong_nodes.map((n) => `${title(n)} (${n.accuracy_pct}%)`).join("; ")}.`);
  }
  if (p.evaluation.count > 0) {
    const parts = [`${p.evaluation.count} answer(s) evaluated`];
    if (p.evaluation.recent_overall_pct != null) parts.push(`most recent ${p.evaluation.recent_overall_pct}%`);
    if (p.evaluation.trend !== "none") parts.push(`trend ${p.evaluation.trend}`);
    if (p.evaluation.weakest_dimension) {
      parts.push(`weakest writing dimension: ${DIMENSION_LABELS[p.evaluation.weakest_dimension] ?? p.evaluation.weakest_dimension}`);
    }
    lines.push(`Answer-writing: ${parts.join(", ")}.`);
  }
  if (p.recent_nodes.length) {
    lines.push(`Recently studied: ${p.recent_nodes.map(title).join("; ")}.`);
  }
  lines.push(
    `Last 7 days: ${p.activity_last_7d.answers_written} answers, ${p.activity_last_7d.mcqs_attempted} MCQs, ${p.activity_last_7d.srs_reviews} revisions.`,
  );

  const body = lines.join("\n");
  // If there is no real signal (no exam date, no activity), skip the block.
  const hasSignal =
    p.weak_nodes.length > 0 ||
    p.strong_nodes.length > 0 ||
    p.evaluation.count > 0 ||
    p.recent_nodes.length > 0 ||
    p.streak_count > 0 ||
    p.activity_last_7d.answers_written + p.activity_last_7d.mcqs_attempted + p.activity_last_7d.srs_reviews > 0;
  return hasSignal ? body : "";
}
