/**
 * GET /profile/analytics — one aggregate bundle for the profile page's charts.
 * Two of the five pieces (accuracy_time_buckets, improvement_proof) are real
 * SQL aggregation via the RPCs added in migration 0050 (this app's convention
 * for anything beyond a simple filter — see mv_node_weightage/match_embeddings);
 * the other three are small bounded fetches (≤200/≤30 rows) mapped in JS.
 */
import type {
  AccuracyTimeBucket,
  BilingualText,
  DimensionInsight,
  EvaluationTrendPoint,
  ImprovementProofItem,
  PaperScoreTrajectory,
  ProfileAnalytics,
  RubricDimensionKey,
} from "@prayasup/shared";
import { RUBRIC_DIMENSION_KEYS } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// score_trajectory
// ---------------------------------------------------------------------------
interface AttemptTrajectoryRow {
  id: string;
  submitted_at: string;
  score: number | null;
  total: number | null;
  tests: { paper_code: string | null } | null;
}

async function getScoreTrajectory(userId: string): Promise<PaperScoreTrajectory[]> {
  const [attemptsRes, rootsRes] = await Promise.all([
    supabase()
      .from("attempts")
      .select("id, submitted_at, score, total, tests!inner(paper_code)")
      .eq("user_id", userId)
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(200),
    supabase().from("syllabus_nodes").select("paper_code, title_i18n").eq("depth", 0),
  ]);
  if (attemptsRes.error) throw new HttpError(500, `attempts trajectory query failed: ${attemptsRes.error.message}`);
  if (rootsRes.error) throw new HttpError(500, `paper roots query failed: ${rootsRes.error.message}`);

  const titleByPaper = new Map<string, BilingualText>(
    (rootsRes.data ?? []).map((r) => [r.paper_code as string, r.title_i18n as BilingualText]),
  );

  const byPaper = new Map<string, { date: string; overall_pct: number }[]>();
  for (const row of (attemptsRes.data ?? []) as unknown as AttemptTrajectoryRow[]) {
    const paperCode = row.tests?.paper_code;
    if (!paperCode) continue;
    const total = row.total ?? 0;
    if (total <= 0) continue;
    const points = byPaper.get(paperCode) ?? [];
    points.push({ date: row.submitted_at, overall_pct: round1((100 * (row.score ?? 0)) / total) });
    byPaper.set(paperCode, points);
  }

  return [...byPaper.entries()]
    .map(([paper_code, points]) => ({
      paper_code,
      paper_title_i18n: titleByPaper.get(paper_code) ?? { hi: paper_code, en: paper_code },
      // fetched newest-first (for the LIMIT 200 to bite on the most recent
      // attempts) — flip to chronological order for charting.
      points: points.slice().reverse(),
    }))
    .sort((a, b) => a.paper_code.localeCompare(b.paper_code));
}

// ---------------------------------------------------------------------------
// accuracy_time_buckets (RPC)
// ---------------------------------------------------------------------------
const BUCKET_ORDER = ["<30s", "30-60s", "60-120s", ">120s"] as const;

async function getAccuracyTimeBuckets(userId: string): Promise<AccuracyTimeBucket[]> {
  const { data, error } = await supabase().rpc("profile_accuracy_time_buckets", { p_user_id: userId });
  if (error) throw new HttpError(500, `accuracy time-bucket query failed: ${error.message}`);
  const byLabel = new Map(
    ((data ?? []) as { bucket_label: string; accuracy_pct: number | string; cnt: number }[]).map((r) => [
      r.bucket_label,
      { accuracy_pct: Number(r.accuracy_pct), count: r.cnt },
    ]),
  );
  return BUCKET_ORDER.map((bucket_label) => ({
    bucket_label,
    accuracy_pct: byLabel.get(bucket_label)?.accuracy_pct ?? 0,
    count: byLabel.get(bucket_label)?.count ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// evaluation_trend — last ~30 evaluations, chronological
// ---------------------------------------------------------------------------
interface EvaluationTrendRow {
  submission_id: string;
  overall_score: number | null;
  max_score: number | null;
  dimension_scores: { key: RubricDimensionKey; score: number }[] | null;
  created_at: string;
}

/** Shared by evaluation_trend and dimension_insights (which reuses this same window). */
async function fetchRecentEvaluations(userId: string, limit: number): Promise<EvaluationTrendPoint[]> {
  const { data, error } = await supabase()
    .from("evaluations")
    .select(
      "submission_id, overall_score, max_score, dimension_scores, created_at, answer_submissions!inner(user_id)",
    )
    .eq("answer_submissions.user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HttpError(500, `evaluation trend query failed: ${error.message}`);

  const rows = ((data ?? []) as unknown as EvaluationTrendRow[]).filter(
    (r) => r.overall_score !== null && r.max_score !== null && r.max_score > 0,
  );

  const points: EvaluationTrendPoint[] = rows.map((r) => {
    const dimension_pct = {} as Record<RubricDimensionKey, number>;
    for (const d of r.dimension_scores ?? []) {
      dimension_pct[d.key] = round1((d.score / 10) * 100);
    }
    return {
      date: r.created_at,
      submission_id: r.submission_id,
      overall_pct: round1((100 * (r.overall_score as number)) / (r.max_score as number)),
      dimension_pct,
    };
  });
  // Fetched newest-first — reverse for chronological order (charting convention).
  return points.reverse();
}

// ---------------------------------------------------------------------------
// dimension_insights — derived from the same (last-10-of-the-30) window
// ---------------------------------------------------------------------------
function computeDimensionInsights(trendAsc: EvaluationTrendPoint[]): DimensionInsight[] {
  if (trendAsc.length === 0) return [];
  const last10 = trendAsc.slice(-10);
  const recent5 = last10.slice(-5);
  const hasPrevious = last10.length >= 10;
  const previous5 = hasPrevious ? last10.slice(0, 5) : [];

  const avg = (vals: number[]): number => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);

  return RUBRIC_DIMENSION_KEYS.map((key) => {
    const recentVals = recent5.map((e) => e.dimension_pct[key]).filter((v): v is number => v !== undefined);
    const recentAvg = round1(avg(recentVals));
    let previousAvg: number | null = null;
    if (hasPrevious) {
      const previousVals = previous5.map((e) => e.dimension_pct[key]).filter((v): v is number => v !== undefined);
      previousAvg = round1(avg(previousVals));
    }
    return {
      dimension_key: key,
      recent_avg_pct: recentAvg,
      previous_avg_pct: previousAvg,
      delta_pct: previousAvg === null ? null : round1(recentAvg - previousAvg),
    };
  });
}

// ---------------------------------------------------------------------------
// improvement_proof (RPC + a small batch fetch of question stems)
// ---------------------------------------------------------------------------
interface ImprovementPairRow {
  question_id: string;
  before_submission_id: string;
  after_submission_id: string;
  before_score: number | string;
  before_max_score: number | string;
  after_score: number | string;
  after_max_score: number | string;
  before_date: string;
  after_date: string;
}

async function getImprovementProof(
  userId: string,
): Promise<{ items: ImprovementProofItem[]; avg_delta_pct: number | null }> {
  const { data, error } = await supabase().rpc("profile_improvement_pairs", { p_user_id: userId });
  if (error) throw new HttpError(500, `improvement-proof query failed: ${error.message}`);
  const rows = (data ?? []) as ImprovementPairRow[];
  if (rows.length === 0) return { items: [], avg_delta_pct: null };

  const questionIds = [...new Set(rows.map((r) => r.question_id))];
  const { data: questions, error: qError } = await supabase()
    .from("questions")
    .select("id, stem_i18n")
    .in("id", questionIds);
  if (qError) throw new HttpError(500, `improvement-proof question lookup failed: ${qError.message}`);
  const stemById = new Map((questions ?? []).map((q) => [q.id as string, q.stem_i18n as BilingualText]));

  const items: ImprovementProofItem[] = rows.map((r) => {
    const before_pct = round1((100 * Number(r.before_score)) / Number(r.before_max_score));
    const after_pct = round1((100 * Number(r.after_score)) / Number(r.after_max_score));
    return {
      question_id: r.question_id,
      question_stem_i18n: stemById.get(r.question_id) ?? { hi: "", en: "" },
      before_submission_id: r.before_submission_id,
      after_submission_id: r.after_submission_id,
      before_pct,
      after_pct,
      delta_pct: round1(after_pct - before_pct),
      before_date: r.before_date,
      after_date: r.after_date,
    };
  });

  const avgDelta = round1(items.reduce((s, i) => s + i.delta_pct, 0) / items.length);
  return { items, avg_delta_pct: avgDelta };
}

// ---------------------------------------------------------------------------
export async function getProfileAnalytics(userId: string): Promise<ProfileAnalytics> {
  const [score_trajectory, accuracy_time_buckets, evaluationTrend, improvement_proof] = await Promise.all([
    getScoreTrajectory(userId),
    getAccuracyTimeBuckets(userId),
    fetchRecentEvaluations(userId, 30),
    getImprovementProof(userId),
  ]);

  return {
    score_trajectory,
    accuracy_time_buckets,
    evaluation_trend: evaluationTrend,
    dimension_insights: computeDimensionInsights(evaluationTrend),
    improvement_proof,
  };
}

/** Exported for micro-drills.ts's recommendation logic (same evaluation window, no query duplication). */
export { fetchRecentEvaluations, computeDimensionInsights };
