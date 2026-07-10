/**
 * The Scoreboard. Every board reads real data, no seeding, ever — see
 * supabase/migrations/0067_scoreboard.sql for the underlying schema/views.
 *
 *   - Daily Quiz TODAY: the one incrementally-updated board (see
 *     recordDailyQuizResult, hooked into services/attempts.ts's
 *     submitAttempt). Everything else below reads the nightly-refreshed
 *     materialized views (mv_test_leaderboard / mv_mock_series_board /
 *     mv_mains_weekly_board) or, for the Essay board and private stats/
 *     percentile (which must never be gated by Mains opt-in), a live
 *     aggregation over evaluations straight from Postgres.
 *   - Ranking uses competition ranking (ties share a rank; the next rank
 *     skips), matching SQL's RANK() — see computeRanks.
 *   - Every board caps its displayed rows (BOARD_TOP_N) but always includes
 *     the viewer's own row even if it falls outside that cap — pickDisplay.
 */
import type {
  BilingualText,
  DimensionBestBoard,
  DimensionBestsData,
  EvaluationPercentile,
  MainsWeeklyBoard,
  MockSeriesBoard,
  MockSeriesRow,
  RankCard,
  RankHistoryData,
  RankHistoryPoint,
  ScoreboardRow,
  ScoreboardTestSummary,
  TestBoard,
  DailyQuizTodayBoard,
  DailyQuizWeeklyBoard,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { istDateString, istDayRangeUtc, istToday, shiftDate } from "../lib/ist.js";
import { RUBRIC_DIMENSION_KEYS } from "./evaluation/rubric.js";

const BOARD_TOP_N = 20;
const DIMENSION_TOP_N = 10;
const MAINS_MIN_EVALUATIONS = 3;
const PERCENTILE_MIN_PARTICIPANTS = 30;

// ---------------------------------------------------------------------------
// Shared ranking helpers
// ---------------------------------------------------------------------------

/** Standard competition ranking (SQL RANK()) over scores already sorted descending. */
function computeRanks(sortedScoresDesc: number[]): number[] {
  const ranks: number[] = new Array(sortedScoresDesc.length);
  let i = 0;
  while (i < sortedScoresDesc.length) {
    let j = i;
    while (j < sortedScoresDesc.length && sortedScoresDesc[j] === sortedScoresDesc[i]) j++;
    for (let k = i; k < j; k++) ranks[k] = i + 1;
    i = j;
  }
  return ranks;
}

/** Top N, plus the viewer's own row if it fell outside that cap — never lose your own rank. */
function pickDisplay<T extends { is_you: boolean }>(sortedRows: T[], topN: number): T[] {
  const top = sortedRows.slice(0, topN);
  if (top.some((r) => r.is_you)) return top;
  const viewerRow = sortedRows.find((r) => r.is_you);
  return viewerRow ? [...top, viewerRow] : top;
}

async function getHandles(userIds: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase().from("users_profile").select("id, handle").in("id", unique);
  if (error) throw new HttpError(500, `handle lookup failed: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.id as string, r.handle as string | null]));
}

async function getOptedInUserIds(userIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Set();
  const { data, error } = await supabase()
    .from("users_profile")
    .select("id")
    .in("id", unique)
    .eq("show_on_mains_board", true);
  if (error) throw new HttpError(500, `opt-in lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.id as string));
}

function istWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const isoDay = day === 0 ? 7 : day; // 1=Mon..7=Sun
  const monday = new Date(d.getTime() - (isoDay - 1) * 24 * 3600 * 1000);
  return monday.toISOString().slice(0, 10);
}

function buildRows(
  entries: { user_id: string; score: number; accuracy_pct: number | null; time_taken_seconds: number | null }[],
  viewerId: string,
  handles: Map<string, string | null>,
): { rows: ScoreboardRow[]; participants: number; your_rank: number | null } {
  const ranks = computeRanks(entries.map((e) => e.score));
  let yourRank: number | null = null;
  const allRows: ScoreboardRow[] = entries.map((e, idx) => {
    const isYou = e.user_id === viewerId;
    if (isYou) yourRank = ranks[idx];
    return {
      rank: ranks[idx],
      handle: handles.get(e.user_id) ?? null,
      is_you: isYou,
      score: e.score,
      accuracy_pct: e.accuracy_pct,
      time_taken_seconds: e.time_taken_seconds,
    };
  });
  return { rows: pickDisplay(allRows, BOARD_TOP_N), participants: allRows.length, your_rank: yourRank };
}

// ---------------------------------------------------------------------------
// Daily Quiz — the one incrementally-updated board.
// ---------------------------------------------------------------------------

interface SubmittedAttemptLike {
  id: string;
  test_id: string | null;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  total: number | null;
}

/**
 * Called from submitAttempt right after a test is submitted. Best-effort —
 * the caller wraps this in try/catch so a scoreboard write can never fail the
 * submission itself. unique(user_id, quiz_date) + ignoreDuplicates means only
 * the user's FIRST submitted attempt on that day's quiz is ever recorded —
 * a later re-attempt (or a "race this again" ghost, already excluded by the
 * caller's own source check) never overwrites it.
 */
export async function recordDailyQuizResult(
  userId: string,
  attempt: SubmittedAttemptLike,
  gradedAnswers: { question_id: string; is_correct: boolean }[],
): Promise<void> {
  if (!attempt.test_id || !attempt.submitted_at) return;

  const { data: test, error } = await supabase()
    .from("tests")
    .select("kind, scheduled_date")
    .eq("id", attempt.test_id)
    .maybeSingle();
  if (error) throw new HttpError(500, `test lookup failed: ${error.message}`);
  if (!test || test.kind !== "daily_quiz") return;

  const quizDate = (test.scheduled_date as string | null) ?? istDateString(Date.parse(attempt.submitted_at));
  const attempted = gradedAnswers.length;
  const correct = gradedAnswers.filter((g) => g.is_correct).length;
  const accuracyPct = attempted > 0 ? Math.round((correct / attempted) * 10000) / 100 : null;
  const timeTakenSeconds = Math.max(
    0,
    Math.round((Date.parse(attempt.submitted_at) - Date.parse(attempt.started_at)) / 1000),
  );

  const { error: insertError } = await supabase()
    .from("daily_quiz_board_entries")
    .upsert(
      {
        user_id: userId,
        quiz_date: quizDate,
        test_id: attempt.test_id,
        attempt_id: attempt.id,
        score: attempt.score ?? 0,
        total: attempt.total ?? 0,
        accuracy_pct: accuracyPct,
        time_taken_seconds: timeTakenSeconds,
      },
      { onConflict: "user_id,quiz_date", ignoreDuplicates: true },
    );
  if (insertError) throw new HttpError(500, `daily quiz board insert failed: ${insertError.message}`);
}

export async function getDailyQuizTodayBoard(userId: string): Promise<DailyQuizTodayBoard> {
  const date = istToday();
  const { data, error } = await supabase()
    .from("daily_quiz_board_entries")
    .select("user_id, score, accuracy_pct, time_taken_seconds")
    .eq("quiz_date", date)
    .order("score", { ascending: false });
  if (error) throw new HttpError(500, `daily quiz board lookup failed: ${error.message}`);
  const entries = (data ?? []) as {
    user_id: string;
    score: number;
    accuracy_pct: number | null;
    time_taken_seconds: number | null;
  }[];
  const handles = await getHandles(entries.map((e) => e.user_id));
  return { date, ...buildRows(entries, userId, handles) };
}

export async function getDailyQuizWeeklyBoard(userId: string): Promise<DailyQuizWeeklyBoard> {
  const today = istToday();
  const weekStart = shiftDate(today, -6);
  const { data, error } = await supabase()
    .from("daily_quiz_board_entries")
    .select("user_id, score, accuracy_pct")
    .gte("quiz_date", weekStart)
    .lte("quiz_date", today);
  if (error) throw new HttpError(500, `daily quiz weekly board lookup failed: ${error.message}`);

  const byUser = new Map<string, { score: number; accSum: number; accCount: number }>();
  for (const r of (data ?? []) as { user_id: string; score: number; accuracy_pct: number | null }[]) {
    const cur = byUser.get(r.user_id) ?? { score: 0, accSum: 0, accCount: 0 };
    cur.score += r.score;
    if (r.accuracy_pct != null) {
      cur.accSum += r.accuracy_pct;
      cur.accCount += 1;
    }
    byUser.set(r.user_id, cur);
  }
  const entries = [...byUser.entries()]
    .map(([user_id, v]) => ({
      user_id,
      score: Math.round(v.score * 100) / 100,
      accuracy_pct: v.accCount > 0 ? Math.round((v.accSum / v.accCount) * 100) / 100 : null,
      time_taken_seconds: null,
    }))
    .sort((a, b) => b.score - a.score);

  const handles = await getHandles(entries.map((e) => e.user_id));
  return { week_start: weekStart, week_end: today, ...buildRows(entries, userId, handles) };
}

// ---------------------------------------------------------------------------
// Mocks + Sectionals — nightly-refreshed mv_test_leaderboard /
// mv_mock_series_board (first non-ghost attempt per user per test only).
// ---------------------------------------------------------------------------

export async function listScoreboardTests(
  kind: "mock" | "sectional",
  paperCode?: string,
): Promise<ScoreboardTestSummary[]> {
  let query = supabase().from("tests").select("id, title_i18n, paper_code").eq("kind", kind).eq("is_published", true);
  if (paperCode) query = query.eq("paper_code", paperCode);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new HttpError(500, `scoreboard test list failed: ${error.message}`);
  return (data ?? []).map((t) => ({
    id: t.id as string,
    title_i18n: t.title_i18n as BilingualText,
    paper_code: (t.paper_code as string | null) ?? null,
  }));
}

export async function getTestBoard(userId: string, testId: string): Promise<TestBoard> {
  const { data: test, error: testError } = await supabase()
    .from("tests")
    .select("id, title_i18n, kind")
    .eq("id", testId)
    .maybeSingle();
  if (testError) throw new HttpError(500, `test lookup failed: ${testError.message}`);
  if (!test || (test.kind !== "mock" && test.kind !== "sectional")) throw notFound("Test not found");

  const { data, error } = await supabase()
    .from("mv_test_leaderboard")
    .select("user_id, score, accuracy_pct, time_taken_seconds")
    .eq("test_id", testId)
    .order("score", { ascending: false });
  if (error) throw new HttpError(500, `test board lookup failed: ${error.message}`);
  const entries = (data ?? []) as {
    user_id: string;
    score: number;
    accuracy_pct: number | null;
    time_taken_seconds: number | null;
  }[];
  const handles = await getHandles(entries.map((e) => e.user_id));
  return { test_id: testId, title_i18n: test.title_i18n as BilingualText, ...buildRows(entries, userId, handles) };
}

export async function getMockSeriesBoard(userId: string, paperCode: string): Promise<MockSeriesBoard> {
  const { data, error } = await supabase()
    .from("mv_mock_series_board")
    .select("user_id, avg_score_pct, avg_accuracy_pct, mocks_attempted")
    .eq("paper_code", paperCode)
    .order("avg_score_pct", { ascending: false });
  if (error) throw new HttpError(500, `mock series board lookup failed: ${error.message}`);
  const entries = (data ?? []) as {
    user_id: string;
    avg_score_pct: number;
    avg_accuracy_pct: number | null;
    mocks_attempted: number;
  }[];
  const handles = await getHandles(entries.map((e) => e.user_id));
  const ranks = computeRanks(entries.map((e) => e.avg_score_pct));
  let yourRank: number | null = null;
  const allRows: MockSeriesRow[] = entries.map((e, idx) => {
    const isYou = e.user_id === userId;
    if (isYou) yourRank = ranks[idx];
    return {
      rank: ranks[idx],
      handle: handles.get(e.user_id) ?? null,
      is_you: isYou,
      score: e.avg_score_pct,
      accuracy_pct: e.avg_accuracy_pct,
      time_taken_seconds: null,
      mocks_attempted: e.mocks_attempted,
    };
  });
  return {
    paper_code: paperCode,
    rows: pickDisplay(allRows, BOARD_TOP_N),
    participants: allRows.length,
    your_rank: yourRank,
  };
}

// ---------------------------------------------------------------------------
// Mains — opt-in only. The public board (mv_mains_weekly_board) is already
// gated at the SQL level to opted-in, >=3-evaluations-this-week users; a
// user's own private stats and the evaluation screen's percentile pool are
// computed live against the RAW population instead, so neither depends on
// having opted in.
// ---------------------------------------------------------------------------

interface WeeklyEvalRow {
  user_id: string;
  pct: number;
}

async function fetchWeeklyEvaluations(weekStart: string): Promise<WeeklyEvalRow[]> {
  const sunday = shiftDate(weekStart, 6);
  const startUtc = istDayRangeUtc(weekStart).startUtc;
  const endUtc = istDayRangeUtc(sunday).endUtc;
  const { data, error } = await supabase()
    .from("evaluations")
    .select("overall_score, max_score, answer_submissions!inner(user_id)")
    .gte("created_at", startUtc)
    .lt("created_at", endUtc)
    .not("overall_score", "is", null)
    .not("max_score", "is", null);
  if (error) throw new HttpError(500, `weekly evaluations lookup failed: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    overall_score: number;
    max_score: number;
    answer_submissions: { user_id: string };
  }[];
  return rows
    .filter((r) => r.max_score > 0)
    .map((r) => ({ user_id: r.answer_submissions.user_id, pct: (r.overall_score / r.max_score) * 100 }));
}

function aggregateByUser(rows: WeeklyEvalRow[]): Map<string, { count: number; avgPct: number }> {
  const byUser = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byUser.get(r.user_id) ?? [];
    arr.push(r.pct);
    byUser.set(r.user_id, arr);
  }
  const out = new Map<string, { count: number; avgPct: number }>();
  for (const [uid, pcts] of byUser) {
    out.set(uid, { count: pcts.length, avgPct: Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100 });
  }
  return out;
}

export async function getMainsWeeklyBoard(userId: string): Promise<MainsWeeklyBoard> {
  const weekStart = istWeekStart(istToday());
  const [{ data: mvRows, error: mvError }, profileRes, weekly] = await Promise.all([
    supabase().from("mv_mains_weekly_board").select("user_id, avg_pct").eq("week_start", weekStart),
    supabase().from("users_profile").select("show_on_mains_board").eq("id", userId).maybeSingle(),
    fetchWeeklyEvaluations(weekStart),
  ]);
  if (mvError) throw new HttpError(500, `mains weekly board lookup failed: ${mvError.message}`);
  if (profileRes.error) throw new HttpError(500, `profile lookup failed: ${profileRes.error.message}`);
  const optedIn = (profileRes.data?.show_on_mains_board as boolean | undefined) ?? false;

  const entries = ((mvRows ?? []) as { user_id: string; avg_pct: number }[]).sort((a, b) => b.avg_pct - a.avg_pct);
  const handles = await getHandles(entries.map((e) => e.user_id));
  const ranks = computeRanks(entries.map((e) => e.avg_pct));
  let yourRank: number | null = null;
  const allRows: ScoreboardRow[] = entries.map((e, idx) => {
    const isYou = e.user_id === userId;
    if (isYou) yourRank = ranks[idx];
    return {
      rank: ranks[idx],
      handle: handles.get(e.user_id) ?? null,
      is_you: isYou,
      score: e.avg_pct,
      accuracy_pct: null,
      time_taken_seconds: null,
    };
  });

  const mine = aggregateByUser(weekly).get(userId);
  return {
    week_start: weekStart,
    rows: pickDisplay(allRows, BOARD_TOP_N),
    participants: allRows.length,
    your_rank: optedIn ? yourRank : null,
    opted_in: optedIn,
    your_stats: {
      week_start: weekStart,
      evaluations_count: mine?.count ?? 0,
      avg_pct: mine?.avgPct ?? null,
      qualifies: (mine?.count ?? 0) >= MAINS_MIN_EVALUATIONS,
    },
  };
}

/**
 * Essay board — not materialized (the weekly Sunday-only slot means genuinely
 * low volume), computed live and filtered to rubric_version='essay-v1'. The
 * qualifying floor is >=1 evaluated essay this week, not >=3 — a weekly-only
 * slot can never reach 3 in a single week.
 */
export async function getMainsEssayWeeklyBoard(userId: string): Promise<MainsWeeklyBoard> {
  const weekStart = istWeekStart(istToday());
  const sunday = shiftDate(weekStart, 6);
  const startUtc = istDayRangeUtc(weekStart).startUtc;
  const endUtc = istDayRangeUtc(sunday).endUtc;

  const [{ data, error }, profileRes] = await Promise.all([
    supabase()
      .from("evaluations")
      .select("overall_score, max_score, answer_submissions!inner(user_id)")
      .eq("rubric_version", "essay-v1")
      .gte("created_at", startUtc)
      .lt("created_at", endUtc)
      .not("overall_score", "is", null)
      .not("max_score", "is", null),
    supabase().from("users_profile").select("show_on_mains_board").eq("id", userId).maybeSingle(),
  ]);
  if (error) throw new HttpError(500, `essay weekly board lookup failed: ${error.message}`);
  if (profileRes.error) throw new HttpError(500, `profile lookup failed: ${profileRes.error.message}`);
  const optedIn = (profileRes.data?.show_on_mains_board as boolean | undefined) ?? false;

  const rows = ((data ?? []) as unknown as {
    overall_score: number;
    max_score: number;
    answer_submissions: { user_id: string };
  }[])
    .filter((r) => r.max_score > 0)
    .map((r) => ({ user_id: r.answer_submissions.user_id, pct: (r.overall_score / r.max_score) * 100 }));
  const byUser = aggregateByUser(rows);

  const optedInIds = await getOptedInUserIds([...byUser.keys()]);
  const entries = [...byUser.entries()]
    .filter(([uid]) => optedInIds.has(uid))
    .map(([user_id, v]) => ({ user_id, score: v.avgPct }))
    .sort((a, b) => b.score - a.score);

  const handles = await getHandles(entries.map((e) => e.user_id));
  const ranks = computeRanks(entries.map((e) => e.score));
  let yourRank: number | null = null;
  const allRows: ScoreboardRow[] = entries.map((e, idx) => {
    const isYou = e.user_id === userId;
    if (isYou) yourRank = ranks[idx];
    return {
      rank: ranks[idx],
      handle: handles.get(e.user_id) ?? null,
      is_you: isYou,
      score: e.score,
      accuracy_pct: null,
      time_taken_seconds: null,
    };
  });

  const mine = byUser.get(userId);
  return {
    week_start: weekStart,
    rows: pickDisplay(allRows, BOARD_TOP_N),
    participants: allRows.length,
    your_rank: optedIn ? yourRank : null,
    opted_in: optedIn,
    your_stats: {
      week_start: weekStart,
      evaluations_count: mine?.count ?? 0,
      avg_pct: mine?.avgPct ?? null,
      qualifies: (mine?.count ?? 0) >= 1,
    },
  };
}

export async function getDimensionBests(userId: string): Promise<DimensionBestsData> {
  const weekStart = istWeekStart(istToday());
  const [{ data, error }, profileRes] = await Promise.all([
    supabase().from("mv_mains_weekly_board").select("user_id, dimension_bests").eq("week_start", weekStart),
    supabase().from("users_profile").select("show_on_mains_board").eq("id", userId).maybeSingle(),
  ]);
  if (error) throw new HttpError(500, `dimension bests lookup failed: ${error.message}`);
  if (profileRes.error) throw new HttpError(500, `profile lookup failed: ${profileRes.error.message}`);
  const optedIn = (profileRes.data?.show_on_mains_board as boolean | undefined) ?? false;

  const rows = (data ?? []) as { user_id: string; dimension_bests: Record<string, number> }[];
  const handles = await getHandles(rows.map((r) => r.user_id));

  const boards: DimensionBestBoard[] = RUBRIC_DIMENSION_KEYS.map((dim) => {
    const entries = rows
      .filter((r) => typeof r.dimension_bests?.[dim] === "number")
      .map((r) => ({ user_id: r.user_id, score: r.dimension_bests[dim] }))
      .sort((a, b) => b.score - a.score);
    const ranks = computeRanks(entries.map((e) => e.score));
    const dimRows = entries.slice(0, DIMENSION_TOP_N).map((e, idx) => ({
      rank: ranks[idx],
      handle: handles.get(e.user_id) ?? null,
      is_you: e.user_id === userId,
      score: e.score,
    }));
    return { dimension: dim, rows: dimRows };
  });

  return { week_start: weekStart, opted_in: optedIn, boards };
}

// ---------------------------------------------------------------------------
// Rank cards — the moment right after a result ("you ranked N of M today"),
// and the evaluation screen's private percentile.
// ---------------------------------------------------------------------------

export async function getRankCardForAttempt(userId: string, attemptId: string): Promise<RankCard | null> {
  const { data: attempt, error } = await supabase()
    .from("attempts")
    .select("id, user_id, test_id, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw new HttpError(500, `attempt lookup failed: ${error.message}`);
  if (!attempt || attempt.user_id !== userId || !attempt.test_id || !attempt.submitted_at) return null;

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .select("kind")
    .eq("id", attempt.test_id)
    .maybeSingle();
  if (testError) throw new HttpError(500, `test lookup failed: ${testError.message}`);
  if (!test) return null;

  if (test.kind === "daily_quiz") {
    const { data: entry, error: entryError } = await supabase()
      .from("daily_quiz_board_entries")
      .select("quiz_date")
      .eq("attempt_id", attemptId)
      .maybeSingle();
    if (entryError) throw new HttpError(500, `daily quiz entry lookup failed: ${entryError.message}`);
    // A re-attempt (not the user's first submission that day) was never
    // recorded — no rank card for it, matching the anti-farm rule.
    if (!entry) return null;

    const { data: dayRows, error: dayError } = await supabase()
      .from("daily_quiz_board_entries")
      .select("user_id, score")
      .eq("quiz_date", entry.quiz_date)
      .order("score", { ascending: false });
    if (dayError) throw new HttpError(500, `daily quiz board lookup failed: ${dayError.message}`);
    const entries = (dayRows ?? []) as { user_id: string; score: number }[];
    const ranks = computeRanks(entries.map((e) => e.score));
    const idx = entries.findIndex((e) => e.user_id === userId);
    if (idx === -1) return null;
    return { board_type: "daily_quiz", rank: ranks[idx], participants: entries.length };
  }

  if (test.kind === "mock" || test.kind === "sectional") {
    const { data: rows, error: rowsError } = await supabase()
      .from("v_test_leaderboard")
      .select("user_id, score")
      .eq("test_id", attempt.test_id)
      .order("score", { ascending: false });
    if (rowsError) throw new HttpError(500, `test board lookup failed: ${rowsError.message}`);
    const entries = (rows ?? []) as { user_id: string; score: number }[];
    const ranks = computeRanks(entries.map((e) => e.score));
    const idx = entries.findIndex((e) => e.user_id === userId);
    // Not present means this attempt wasn't the user's qualifying (first,
    // non-ghost) one on this test — no card for a later re-attempt either.
    if (idx === -1) return null;
    return { board_type: "test", rank: ranks[idx], participants: entries.length };
  }

  return null;
}

export async function getEvaluationPercentile(userId: string, submissionId: string): Promise<EvaluationPercentile> {
  const { data: submission, error } = await supabase()
    .from("answer_submissions")
    .select("id, user_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new HttpError(500, `submission lookup failed: ${error.message}`);
  if (!submission || submission.user_id !== userId) throw notFound("Submission not found");

  const { data: evaluation, error: evalError } = await supabase()
    .from("evaluations")
    .select("created_at")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (evalError) throw new HttpError(500, `evaluation lookup failed: ${evalError.message}`);
  if (!evaluation) return { eligible: false, participants: 0, percentile: null };

  const weekStart = istWeekStart(istDateString(Date.parse(evaluation.created_at as string)));
  const pool = await fetchWeeklyEvaluations(weekStart);
  const byUser = aggregateByUser(pool);

  const mine = byUser.get(userId);
  if (!mine || mine.count < MAINS_MIN_EVALUATIONS) return { eligible: false, participants: 0, percentile: null };

  // Population = everyone who cleared the >=3-evaluations floor that week,
  // regardless of Mains-board opt-in — a bare percentile number reveals no
  // identity, so it can safely draw on the full active population rather
  // than just the tiny opted-in subset that appears on the named board.
  const qualifying = [...byUser.values()].filter((v) => v.count >= MAINS_MIN_EVALUATIONS);
  const participants = qualifying.length;
  if (participants < PERCENTILE_MIN_PARTICIPANTS) return { eligible: false, participants, percentile: null };

  const below = qualifying.filter((v) => v.avgPct < mine.avgPct).length;
  const tied = qualifying.filter((v) => v.avgPct === mine.avgPct).length;
  const percentile = Math.round(((below + 0.5 * tied) / participants) * 100 * 100) / 100;
  return { eligible: true, participants, percentile };
}

// ---------------------------------------------------------------------------
// Profile "my ranks" history + the >=3-board-appearances milestone.
// ---------------------------------------------------------------------------

export async function getRankHistory(userId: string, limit = 60): Promise<RankHistoryData> {
  const { data, error } = await supabase()
    .from("scoreboard_rank_snapshots")
    .select("snapshot_date, board_type, board_key, rank, participants")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false })
    .limit(limit);
  if (error) throw new HttpError(500, `rank history lookup failed: ${error.message}`);
  const points = ((data ?? []) as RankHistoryPoint[]).slice().reverse();
  return { points };
}

export async function countDistinctBoardAppearances(userId: string): Promise<number> {
  const { data, error } = await supabase()
    .from("scoreboard_rank_snapshots")
    .select("board_type, board_key")
    .eq("user_id", userId);
  if (error) throw new HttpError(500, `board appearances lookup failed: ${error.message}`);
  const set = new Set((data ?? []).map((r) => `${r.board_type as string}:${r.board_key as string}`));
  return set.size;
}

/** Nightly RPC: refreshes the three materialized views + writes today's rank snapshots. */
export async function refreshScoreboardViews(): Promise<void> {
  const { error } = await supabase().rpc("refresh_scoreboard_views", { p_snapshot_date: istToday() });
  if (error) throw new HttpError(500, `scoreboard refresh failed: ${error.message}`);
}
