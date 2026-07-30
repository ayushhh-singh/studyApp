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
} from "@neev/shared";
import { RUBRIC_DIMENSION_KEYS, isPreRecalibration } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { getUserExam } from "../lib/exams.js";
import { HttpError } from "../lib/http-error.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";

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

async function getScoreTrajectory(userId: string, examCode: string): Promise<PaperScoreTrajectory[]> {
  const [attemptsRes, rootsRes] = await Promise.all([
    // `tests.exam_code` scope — found live 2026-07-30 (U3 exam-selection-UX
    // verification): this select had NO exam filter at all, so once a real
    // exam switcher existed (this same session), a user's "Last 5 scores" /
    // "Accuracy by paper" trend would mix attempts across every exam they've
    // EVER attempted a test in — exactly the class of bleed already found and
    // fixed in services/tests.ts's listTests. The title map below is already
    // exam-scoped, so an unfixed foreign-exam attempt would render with a raw
    // paper code instead of silently vanishing (see §3f's prior note, now
    // stale — this closes it).
    supabase()
      .from("attempts")
      .select("id, submitted_at, score, total, tests!inner(paper_code, exam_code)")
      .eq("user_id", userId)
      .eq("tests.exam_code", examCode)
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(200),
    // Paper-title lookup, scoped to the user's exam. Every paper this user can
    // attempt belongs to their own exam, so pulling other exams' roots only adds
    // rows that are never read back — and one day pushes this past the 1000-row
    // cap for a title map that is meant to be exhaustive.
    supabase().from("syllabus_nodes").select("paper_code, title_i18n").eq("exam_code", examCode).eq("depth", 0),
  ]);
  if (attemptsRes.error) throw new HttpError(500, `attempts trajectory query failed: ${attemptsRes.error.message}`);
  if (rootsRes.error) throw new HttpError(500, `paper roots query failed: ${rootsRes.error.message}`);

  const titleByPaper = new Map<string, BilingualText>(
    (rootsRes.data ?? []).map((r) => [r.paper_code as string, r.title_i18n as BilingualText]),
  );

  const byPaper = new Map<string, { date: string; overall_pct: number }[]>();
  for (const row of (attemptsRes.data ?? []) as unknown as AttemptTrajectoryRow[]) {
    const paperCode = row.tests?.paper_code;
    // The current-affairs quiz isn't a syllabus paper the user is tracking
    // progress in — it has no syllabus_nodes root row, so it would otherwise
    // render as a paper literally titled "CURRENT_AFFAIRS".
    if (!paperCode || paperCode === CURRENT_AFFAIRS_PAPER_CODE) continue;
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

/**
 * FOUND, NOT FIXED (2026-07-30, U3 sibling audit — flagged for a follow-up
 * migration, out of this session's scope): `profile_accuracy_time_buckets`
 * (0050) joins `attempt_answers -> attempts` filtered only by `user_id` — no
 * exam scoping anywhere, and it can't be added at this call site alone since
 * the filter has to live INSIDE the SQL function (the same reason
 * match_embeddings/match_doubt_faq's exam filters had to be added to the RPC
 * itself, not the caller — see M3/M4, docs/multi-exam.md). So this "am I
 * rushing or overthinking" chart mixes time-spent buckets across every exam
 * the user has ever attempted a test in, or (for `attempts.test_id is null`
 * ad-hoc sets) implicitly follows the CURRENT exam per 0106 §13 — genuinely
 * ambiguous without a `tests` join. A real fix needs a new migration adding
 * an optional `p_exam_code` param, LEFT JOINing `tests` and falling back to
 * the caller-supplied exam for the null-test_id rows, mirroring `attempts`'
 * own DERIVES-EXAM rule. Left as a documented gap rather than an
 * out-of-scope migration.
 */
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

/**
 * FOUND LIVE 2026-07-30 (U3 sibling audit): this select carried no exam
 * filter at all, so `evaluation_trend`/`dimension_insights` (computed from
 * it below) would mix evaluations across every exam the user has ever
 * submitted an answer under — exactly the "mixing distorts a trend" reason
 * this same file's getScoreTrajectory was already fixed for. Scoped via
 * `evaluations.exam_code` (0109 §5), the same column getAnswerSpotlight
 * (dashboard.ts) and getWeeklyDigest (digest.ts) now filter on too.
 *
 * `examCode` is OPTIONAL, trailing — the one deliberate exception to this
 * session's own "never a defaulted param, it lets a caller silently keep the
 * old unscoped behaviour" rule (see digest.ts/getWeeklyDigest's doc comment).
 * This function is also called by micro-drills.ts's recommendation logic
 * (`fetchRecentEvaluations(userId, 30)`, no exam), which is OUT OF SCOPE for
 * this audit (owned by a different session) — an omitted examCode there
 * preserves its exact current (already cross-exam-mixing) behaviour rather
 * than either breaking that file's build or reaching into a file this
 * session isn't auditing. That mixing IS the same real gap class found here;
 * it's flagged, not silently left unscoped-by-design — see the U3 audit
 * report for the follow-up.
 */
async function fetchRecentEvaluations(
  userId: string,
  limit: number,
  examCode?: string,
): Promise<EvaluationTrendPoint[]> {
  let query = supabase()
    .from("evaluations")
    .select(
      "submission_id, overall_score, max_score, dimension_scores, created_at, answer_submissions!inner(user_id)",
    )
    .eq("answer_submissions.user_id", userId);
  if (examCode) query = query.eq("exam_code", examCode);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
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

  // If the recent history straddles the 2026-07-26 scoring recalibration, a
  // recent-vs-previous delta compares two different scales — it would read as a
  // sharp (false) drop on every dimension. Suppress the delta (show "steady")
  // until 10 post-recalibration evaluations exist. (RUBRIC_RECALIBRATED_AT)
  const spansBoundary =
    last10.some((p) => isPreRecalibration(p.date)) && last10.some((p) => !isPreRecalibration(p.date));
  const comparable = hasPrevious && !spansBoundary;

  const avg = (vals: number[]): number => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);

  return RUBRIC_DIMENSION_KEYS.map((key) => {
    const recentVals = recent5.map((e) => e.dimension_pct[key]).filter((v): v is number => v !== undefined);
    const recentAvg = round1(avg(recentVals));
    let previousAvg: number | null = null;
    if (comparable) {
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

/**
 * `examCode` is OPTIONAL, trailing — same deliberate exception as
 * fetchRecentEvaluations above, and for the same reason: this function is
 * also exported for mentor-insights.ts's rewrite_improvement candidate
 * (`getImprovementProof(userId)`, no exam), which is out of this session's
 * scope to edit. Passing it (as getProfileAnalytics does below) scopes the
 * result to one exam; omitting it preserves the exact pre-existing
 * (cross-exam-mixing) behaviour for that other caller.
 */
export async function getImprovementProof(
  userId: string,
  examCode?: string,
): Promise<{ items: ImprovementProofItem[]; avg_delta_pct: number | null }> {
  const { data, error } = await supabase().rpc("profile_improvement_pairs", { p_user_id: userId });
  if (error) throw new HttpError(500, `improvement-proof query failed: ${error.message}`);
  const allRows = (data ?? []) as ImprovementPairRow[];
  // A pair whose "before" and "after" fall on opposite sides of the 2026-07-26
  // scoring recalibration compares a lenient before to a strict after — it would
  // turn a genuine rewrite improvement into a false decline (and corrupt the
  // "your rewrites gain +X%" headline / paywall pitch). Only compare within one
  // calibration era. (RUBRIC_RECALIBRATED_AT, @neev/shared)
  const eraRows = allRows.filter((r) => isPreRecalibration(r.before_date) === isPreRecalibration(r.after_date));
  if (eraRows.length === 0) return { items: [], avg_delta_pct: null };

  const questionIds = [...new Set(eraRows.map((r) => r.question_id))];
  const { data: questions, error: qError } = await supabase()
    .from("questions")
    .select("id, stem_i18n, syllabus_node_id")
    .in("id", questionIds);
  if (qError) throw new HttpError(500, `improvement-proof question lookup failed: ${qError.message}`);
  const stemById = new Map((questions ?? []).map((q) => [q.id as string, q.stem_i18n as BilingualText]));

  // FOUND LIVE 2026-07-30 (U3 sibling audit): profile_improvement_pairs (the
  // RPC above) pools re-attempted-question pairs across every exam the user
  // has ever submitted an evaluation under — the same "mixing distorts the
  // headline number" class this file's other analytics were already fixed
  // for. A pair can never be MISattributed to the wrong exam (it's matched by
  // one question_id, and a question belongs to exactly one product exam via
  // its syllabus node — M19, never shared across exams); the bug is only that
  // unscoped, pairs from different exams get mixed into one list/average.
  // Resolved via the question's syllabus_node_id, never `questions.exam_code`
  // (provenance — see lib/exams.ts's examCodeForNode doc comment), matching
  // the distinction M7 already established for every other untrusted-node-id
  // site in this app. No migration needed: `profile_improvement_pairs` itself
  // is untouched, this only filters its already-fetched rows.
  let rows = eraRows;
  if (examCode) {
    const nodeIds = [
      ...new Set(
        (questions ?? [])
          .map((q) => q.syllabus_node_id as string | null)
          .filter((id): id is string => !!id),
      ),
    ];
    const nodeExamById = new Map<string, string>();
    if (nodeIds.length > 0) {
      const { data: nodes, error: nodeError } = await supabase()
        .from("syllabus_nodes")
        .select("id, exam_code")
        .in("id", nodeIds);
      if (nodeError) throw new HttpError(500, `improvement-proof node lookup failed: ${nodeError.message}`);
      for (const n of nodes ?? []) nodeExamById.set(n.id as string, n.exam_code as string);
    }
    const questionExamById = new Map(
      (questions ?? []).map((q) => {
        const nodeId = q.syllabus_node_id as string | null;
        return [q.id as string, nodeId ? (nodeExamById.get(nodeId) ?? null) : null] as const;
      }),
    );
    rows = eraRows.filter((r) => questionExamById.get(r.question_id) === examCode);
  }
  if (rows.length === 0) return { items: [], avg_delta_pct: null };

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
  const examCode = await getUserExam(userId);
  const [score_trajectory, accuracy_time_buckets, evaluationTrend, improvement_proof] = await Promise.all([
    getScoreTrajectory(userId, examCode),
    getAccuracyTimeBuckets(userId),
    fetchRecentEvaluations(userId, 30, examCode),
    getImprovementProof(userId, examCode),
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
/** getImprovementProof is also exported (see its `export` above) for mentor-insights.ts's rewrite_improvement candidate. */
