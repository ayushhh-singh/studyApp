import type {
  BilingualText,
  DashboardAnswerSpotlight,
  DashboardContinue,
  DashboardGreeting,
  DashboardPerformance,
  DashboardSummary,
  DashboardToday,
  DashboardWeaknessNode,
  ExamStage,
  PlanDay,
  TestKind,
  TestSummary,
  TodayPlanTask,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { getGradedAnswers } from "../lib/graded-answers.js";
import { getBestScoresByTest } from "./tests.js";
import { buildChecklist, getDailyProgress, type DailyProgress } from "./daily-progress.js";
import { recordPerfectDay } from "./daily-stats.js";
import { refreshStreak, type StreakState } from "../daily/streak.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// IST is a fixed UTC+5:30 offset (no DST). This app is India/UP-specific, so
// "today" must follow IST, not server UTC — otherwise there's a ~5.5h daily
// window (from 18:30 UTC to midnight UTC) where current-affairs/daily-quiz/
// exam-countdown resolve to the wrong calendar day.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function todayDateString(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = Date.parse(`${fromDateStr}T00:00:00Z`);
  const to = Date.parse(`${toDateStr}T00:00:00Z`);
  return Math.round((to - from) / (24 * 3600 * 1000));
}

async function getGreeting(userId: string, today: string, streak: StreakState): Promise<DashboardGreeting> {
  const { data: profile, error: profileError } = await supabase()
    .from("users_profile")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new HttpError(500, `profile lookup failed: ${profileError.message}`);

  const { data: exam, error: examError } = await supabase()
    .from("exam_calendar")
    .select("exam_stage, title_i18n, exam_date, is_tentative")
    .eq("exam_stage", "prelims")
    .gte("exam_date", today)
    .order("exam_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (examError) throw new HttpError(500, `exam calendar lookup failed: ${examError.message}`);
  const examRow = exam as {
    exam_stage: ExamStage;
    title_i18n: BilingualText;
    exam_date: string;
    is_tentative: boolean;
  } | null;

  return {
    display_name: profile?.display_name ?? null,
    streak_count: streak.streak_count,
    streak_incremented_today: streak.incremented_today,
    streak_active_today: streak.active_today,
    streak_freezes: streak.streak_freezes,
    freeze_used_recently: streak.freeze_used_recently,
    next_exam: examRow
      ? {
          exam_stage: examRow.exam_stage,
          title_i18n: examRow.title_i18n,
          exam_date: examRow.exam_date,
          days_until: daysBetween(today, examRow.exam_date),
          is_tentative: examRow.is_tentative,
        }
      : null,
  };
}

async function getContinue(userId: string): Promise<DashboardContinue> {
  const { data: attempt, error: attemptError } = await supabase()
    .from("attempts")
    .select("id, test_id, started_at, meta")
    .eq("user_id", userId)
    .is("submitted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (attemptError) throw new HttpError(500, `unfinished attempt lookup failed: ${attemptError.message}`);

  let attemptCandidate: (Extract<DashboardContinue, { type: "attempt" }>) | null = null;
  if (attempt) {
    const meta = attempt.meta as { question_ids?: string[] } | null;
    const totalCount = meta?.question_ids?.length ?? 0;

    const { count: answeredCount, error: answeredError } = await supabase()
      .from("attempt_answers")
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", attempt.id);
    if (answeredError) throw new HttpError(500, `attempt answers count failed: ${answeredError.message}`);

    const { data: lastAnswer, error: lastAnswerError } = await supabase()
      .from("attempt_answers")
      .select("created_at")
      .eq("attempt_id", attempt.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastAnswerError) throw new HttpError(500, `last answer lookup failed: ${lastAnswerError.message}`);

    let testTitle: BilingualText | null = null;
    if (attempt.test_id) {
      const { data: test, error: testError } = await supabase()
        .from("tests")
        .select("title_i18n")
        .eq("id", attempt.test_id)
        .maybeSingle();
      if (testError) throw new HttpError(500, `test lookup failed: ${testError.message}`);
      testTitle = (test?.title_i18n as BilingualText | undefined) ?? null;
    }

    attemptCandidate = {
      type: "attempt",
      attempt_id: attempt.id as string,
      test_title_i18n: testTitle,
      answered_count: answeredCount ?? 0,
      total_count: totalCount,
      last_activity_at: (lastAnswer?.created_at as string | undefined) ?? (attempt.started_at as string),
    };
  }

  const { data: viewEvent, error: viewEventError } = await supabase()
    .from("events")
    .select("props, created_at")
    .eq("user_id", userId)
    .eq("name", "syllabus_node_view")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (viewEventError) throw new HttpError(500, `syllabus view event lookup failed: ${viewEventError.message}`);

  let syllabusCandidate: (Extract<DashboardContinue, { type: "syllabus_node" }>) | null = null;
  if (viewEvent) {
    const nodeId = (viewEvent.props as { node_id?: string } | null)?.node_id;
    if (nodeId) {
      const { data: node, error: nodeError } = await supabase()
        .from("syllabus_nodes")
        .select("title_i18n, paper_code")
        .eq("id", nodeId)
        .maybeSingle();
      if (nodeError) throw new HttpError(500, `syllabus node lookup failed: ${nodeError.message}`);
      if (node) {
        syllabusCandidate = {
          type: "syllabus_node",
          syllabus_node_id: nodeId,
          paper_code: node.paper_code as string,
          title_i18n: node.title_i18n as BilingualText,
          last_activity_at: viewEvent.created_at as string,
        };
      }
    }
  }

  if (attemptCandidate && syllabusCandidate) {
    return Date.parse(attemptCandidate.last_activity_at) >= Date.parse(syllabusCandidate.last_activity_at)
      ? attemptCandidate
      : syllabusCandidate;
  }
  return attemptCandidate ?? syllabusCandidate ?? { type: "none" };
}

/**
 * Today's tasks from the user's active AI study plan, if any. Best-effort —
 * ANY failure here (no plan, malformed jsonb, missing day) must degrade to an
 * empty array rather than ever break the dashboard load.
 */
async function getTodayPlanTasks(userId: string, today: string): Promise<TodayPlanTask[]> {
  try {
    const { data, error } = await supabase()
      .from("study_plans")
      .select("plan")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return [];
    const planJson = data.plan as { days?: PlanDay[] } | null;
    const day = planJson?.days?.find((d) => d.date === today);
    if (!day) return [];
    return day.tasks.map((t) => ({ id: t.id, title_i18n: t.title_i18n, kind: t.kind, done: t.done }));
  } catch (err) {
    logger.warn({ err, userId }, "today plan-tasks lookup failed; degrading to empty");
    return [];
  }
}

async function getToday(userId: string, today: string, progress: DailyProgress): Promise<DashboardToday> {
  const srsDue = progress.srs_due;

  const { count: caToday, error: caError } = await supabase()
    .from("current_affairs_items")
    .select("id", { count: "exact", head: true })
    .eq("is_published", true)
    .eq("date", today);
  if (caError) throw new HttpError(500, `current affairs today count failed: ${caError.message}`);

  // order + limit(1) before maybeSingle() so a data slip (two daily_quiz
  // tests accidentally sharing a scheduled_date — nothing but the partial
  // unique index in 0024 prevents that) can't 500 the whole dashboard.
  const { data: quiz, error: quizError } = await supabase()
    .from("tests")
    .select("id, slug, title_i18n, kind, paper_code, duration_minutes, total_marks, test_questions(count)")
    .eq("kind", "daily_quiz")
    .eq("is_published", true)
    .eq("scheduled_date", today)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (quizError) throw new HttpError(500, `daily quiz lookup failed: ${quizError.message}`);
  const quizRow = quiz as {
    id: string;
    slug: string | null;
    title_i18n: BilingualText;
    kind: TestKind;
    paper_code: string | null;
    duration_minutes: number | null;
    total_marks: number | null;
    test_questions: { count: number }[];
  } | null;

  const quizBestScore = quizRow ? (await getBestScoresByTest([quizRow.id])).get(quizRow.id) : undefined;
  const dailyQuiz: TestSummary | null = quizRow
    ? {
        id: quizRow.id,
        slug: quizRow.slug,
        title_i18n: quizRow.title_i18n,
        kind: quizRow.kind,
        paper_code: quizRow.paper_code,
        duration_minutes: quizRow.duration_minutes,
        total_marks: quizRow.total_marks,
        question_count: quizRow.test_questions[0]?.count ?? 0,
        best_score: quizBestScore?.best ?? null,
        attempts_count: quizBestScore?.count ?? 0,
        year: null,
      }
    : null;

  const checklist = buildChecklist(progress);
  const planTasks = await getTodayPlanTasks(userId, today);

  return {
    srs_due_count: srsDue,
    current_affairs_today_count: caToday ?? 0,
    daily_quiz: dailyQuiz,
    checklist: checklist.items,
    checklist_completed: checklist.completed,
    checklist_total: checklist.total,
    plan_tasks: planTasks,
  };
}

async function getPerformanceAndWeakness(
  userId: string,
): Promise<{ performance: DashboardPerformance; weakness_radar: DashboardWeaknessNode[] }> {
  const { data: submitted, error: submittedError } = await supabase()
    .from("attempts")
    .select("id, submitted_at, score, total")
    .eq("user_id", userId)
    .not("submitted_at", "is", null)
    .not("total", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(5);
  if (submittedError) throw new HttpError(500, `recent attempts lookup failed: ${submittedError.message}`);

  const recentScores = (submitted ?? [])
    .filter((a) => (a.total as number | null) && (a.total as number) > 0)
    .map((a) => ({
      attempt_id: a.id as string,
      submitted_at: a.submitted_at as string,
      score_pct: round2(((a.score as number | null) ?? 0) / (a.total as number) * 100),
    }))
    .reverse();

  const graded = await getGradedAnswers(userId);

  const byPaper = new Map<string, { correct: number; total: number }>();
  const nodeIdsWithAnswers = new Set<string>();
  for (const row of graded) {
    const paperCode = row.questions?.paper_code;
    if (paperCode) {
      const bucket = byPaper.get(paperCode) ?? { correct: 0, total: 0 };
      bucket.total += 1;
      if (row.is_correct) bucket.correct += 1;
      byPaper.set(paperCode, bucket);
    }
    if (row.questions?.syllabus_node_id) nodeIdsWithAnswers.add(row.questions.syllabus_node_id);
  }
  const accuracyByPaper = [...byPaper.entries()]
    .map(([paper_code, { correct, total }]) => ({
      paper_code,
      accuracy_pct: round2((correct / total) * 100),
      answered_count: total,
    }))
    .sort((a, b) => a.paper_code.localeCompare(b.paper_code));

  let weaknessRadar: DashboardWeaknessNode[] = [];
  if (nodeIdsWithAnswers.size > 0) {
    const { data: nodes, error: nodesError } = await supabase()
      .from("syllabus_nodes")
      .select("id, paper_code, path, depth, title_i18n");
    if (nodesError) throw new HttpError(500, `syllabus nodes lookup failed: ${nodesError.message}`);
    const nodeRows = (nodes ?? []) as {
      id: string;
      paper_code: string;
      path: string;
      depth: number;
      title_i18n: BilingualText;
    }[];

    const nodeById = new Map(nodeRows.map((n) => [n.id, n]));
    const topNodeByKey = new Map(
      nodeRows.filter((n) => n.depth === 1).map((n) => [`${n.paper_code}::${n.path}`, n]),
    );

    const byTopNode = new Map<
      string,
      { title: BilingualText; paperCode: string; correct: number; total: number }
    >();
    for (const row of graded) {
      const syllabusNodeId = row.questions?.syllabus_node_id;
      if (!syllabusNodeId) continue;
      const node = nodeById.get(syllabusNodeId);
      if (!node) continue;
      const topSegment = node.path.split("/")[0];
      const topNode = topNodeByKey.get(`${node.paper_code}::${topSegment}`);
      if (!topNode) continue;
      const bucket =
        byTopNode.get(topNode.id) ??
        { title: topNode.title_i18n, paperCode: topNode.paper_code, correct: 0, total: 0 };
      bucket.total += 1;
      if (row.is_correct) bucket.correct += 1;
      byTopNode.set(topNode.id, bucket);
    }

    weaknessRadar = [...byTopNode.entries()]
      .map(([syllabus_node_id, { title, paperCode, correct, total }]) => ({
        syllabus_node_id,
        paper_code: paperCode,
        title_i18n: title,
        accuracy_pct: round2((correct / total) * 100),
        answered_count: total,
      }))
      .sort((a, b) => a.accuracy_pct - b.accuracy_pct);
  }

  return {
    performance: { recent_scores: recentScores, accuracy_by_paper: accuracyByPaper },
    weakness_radar: weaknessRadar,
  };
}

async function getAnswerSpotlight(userId: string): Promise<DashboardAnswerSpotlight> {
  const { data, error } = await supabase()
    .from("evaluations")
    .select(
      "id, submission_id, overall_score, max_score, created_at, answer_submissions!inner(user_id, custom_question_text_i18n, questions(stem_i18n))",
    )
    .eq("answer_submissions.user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `evaluation lookup failed: ${error.message}`);
  const row = data as unknown as {
    submission_id: string;
    overall_score: number | null;
    max_score: number | null;
    created_at: string;
    answer_submissions: {
      custom_question_text_i18n: BilingualText | null;
      questions: { stem_i18n: BilingualText } | null;
    } | null;
  } | null;

  return {
    latest: row
      ? {
          submission_id: row.submission_id,
          overall_score: row.overall_score,
          max_score: row.max_score,
          created_at: row.created_at,
          // custom prompts (no catalogued question_id) have no `questions`
          // row to embed — fall back to the submission's own stem text.
          question_stem_i18n:
            row.answer_submissions?.questions?.stem_i18n ??
            row.answer_submissions?.custom_question_text_i18n ??
            null,
        }
      : null,
  };
}

export async function getDashboardSummary(userId: string): Promise<DashboardSummary> {
  const today = todayDateString();
  // Compute the day's progress once, then reuse it for the streak refresh AND the
  // Today checklist so they agree and don't double-query.
  const progress = await getDailyProgress(userId, today);
  const streak = await refreshStreak(userId, today, progress);
  // Record a Perfect Day if the whole checklist is done — best-effort so it never
  // blocks the dashboard; the nightly job also settles it.
  recordPerfectDay(userId, today, progress).catch((err) => logger.error({ err }, "perfect-day record failed"));
  const [greeting, continueItem, todayCard, performanceAndWeakness, answerSpotlight] = await Promise.all([
    getGreeting(userId, today, streak),
    getContinue(userId),
    getToday(userId, today, progress),
    getPerformanceAndWeakness(userId),
    getAnswerSpotlight(userId),
  ]);

  return {
    greeting,
    continue: continueItem,
    today: todayCard,
    performance: performanceAndWeakness.performance,
    weakness_radar: performanceAndWeakness.weakness_radar,
    answer_spotlight: answerSpotlight,
  };
}
