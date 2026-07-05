import type {
  Attempt,
  AttemptAnswerInput,
  AttemptAnswerRecord,
  AttemptDetail,
  AttemptResultDetail,
  AttemptResultItem,
  AttemptReviewItem,
  AttemptStartBody,
  AttemptSubmitResult,
  AttemptTopicBreakdownItem,
  BilingualText,
  MarkingScheme,
  TestKind,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, conflict, HttpError, notFound } from "../lib/http-error.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";

interface AttemptMeta {
  question_ids: string[];
  question_marks: Record<string, number>;
  marking_scheme: MarkingScheme;
}

interface AttemptRow {
  id: string;
  user_id: string;
  test_id: string | null;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  total: number | null;
  meta: AttemptMeta;
}

const ATTEMPT_COLUMNS = "id, user_id, test_id, started_at, submitted_at, score, total, meta";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    user_id: row.user_id,
    test_id: row.test_id,
    started_at: row.started_at,
    submitted_at: row.submitted_at,
    score: row.score,
    total: row.total,
  };
}

async function getOwnedAttemptRow(userId: string, attemptId: string): Promise<AttemptRow> {
  const { data, error } = await supabase()
    .from("attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw new HttpError(500, `attempt lookup failed: ${error.message}`);
  const row = data as unknown as AttemptRow | null;
  if (!row || row.user_id !== userId) throw notFound("Attempt not found");
  return row;
}

/**
 * Resuming a test means re-clicking "Start Test" for a paper the user already
 * has an unsubmitted attempt on — return that attempt instead of creating a
 * second one, so the server-authoritative started_at (and the timer derived
 * from it) never resets on a page reload.
 */
async function findActiveAttempt(userId: string, testId: string): Promise<AttemptRow | null> {
  const { data, error } = await supabase()
    .from("attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("user_id", userId)
    .eq("test_id", testId)
    .is("submitted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `active attempt lookup failed: ${error.message}`);
  return data as unknown as AttemptRow | null;
}

export async function startAttempt(userId: string, body: AttemptStartBody): Promise<Attempt> {
  if (body.test_id) {
    const active = await findActiveAttempt(userId, body.test_id);
    if (active) return toAttempt(active);
  }

  let questionIds: string[];
  let markingScheme: MarkingScheme = null;
  const marksById = new Map<string, number>();

  if (body.test_id) {
    const { data: test, error: testError } = await supabase()
      .from("tests")
      .select("id, is_published, meta")
      .eq("id", body.test_id)
      .maybeSingle();
    if (testError) throw new HttpError(500, `test lookup failed: ${testError.message}`);
    if (!test || !test.is_published) throw notFound("Test not found");
    markingScheme = ((test.meta as { marking_scheme?: MarkingScheme } | null)?.marking_scheme ??
      null) as MarkingScheme;

    // !inner + the question-visibility filter excludes questions retracted
    // after the test was assembled — a since-unpublished question must not be
    // served or graded in a new attempt. The "test" scope's current-affairs
    // exception keeps that one quiz's always-unpublished AI-generated MCQs
    // servable (see lib/question-visibility.ts).
    const { data: tq, error: tqError } = await supabase()
      .from("test_questions")
      .select("question_id, marks, order_index, questions!inner(marks)")
      .eq("test_id", body.test_id)
      .or(questionVisibilityOrFilter("test"), { referencedTable: "questions" })
      .order("order_index", { ascending: true });
    if (tqError) throw new HttpError(500, `test questions lookup failed: ${tqError.message}`);

    const rows = (tq ?? []) as unknown as {
      question_id: string;
      marks: number | null;
      questions: { marks: number | null } | null;
    }[];
    questionIds = rows.map((r) => r.question_id);
    for (const r of rows) {
      marksById.set(r.question_id, r.marks ?? r.questions?.marks ?? 0);
    }
  } else {
    questionIds = [...new Set(body.question_ids!)];
    const { data: qs, error: qError } = await supabase()
      .from("questions")
      .select("id, marks")
      .in("id", questionIds)
      .or(questionVisibilityOrFilter("catalog"));
    if (qError) throw new HttpError(500, `question lookup failed: ${qError.message}`);
    // Compare against the rows actually returned, not a server-reported count
    // — a count could still match questionIds.length even if the row set
    // itself was capped/truncated, silently under-scoring the missing ones.
    if ((qs ?? []).length !== questionIds.length) {
      throw badRequest("One or more question_ids are invalid or unpublished");
    }
    for (const q of qs ?? []) marksById.set(q.id as string, (q.marks as number | null) ?? 0);
  }

  if (questionIds.length === 0) throw badRequest("No questions to attempt");

  const questionMarks = Object.fromEntries(marksById);
  const total = Object.values(questionMarks).reduce((sum, m) => sum + m, 0);

  const { data: attempt, error } = await supabase()
    .from("attempts")
    .insert({
      user_id: userId,
      test_id: body.test_id ?? null,
      total,
      meta: { question_ids: questionIds, question_marks: questionMarks, marking_scheme: markingScheme },
    })
    .select(ATTEMPT_COLUMNS)
    .single();
  if (error) {
    // 23505 here means a concurrent "Start Test" request (double-click, slow
    // network) won the race against the active-attempt check above — the
    // partial unique index (attempts_one_active_per_test_idx) caught it.
    // Return the winner's attempt instead of erroring, so both requests
    // converge on the same attempt id.
    if (error.code === "23505" && body.test_id) {
      const winner = await findActiveAttempt(userId, body.test_id);
      if (winner) return toAttempt(winner);
    }
    throw new HttpError(500, `attempt insert failed: ${error.message}`);
  }
  return toAttempt(attempt as unknown as AttemptRow);
}

export async function getAttemptDetail(userId: string, attemptId: string): Promise<AttemptDetail> {
  const attempt = await getOwnedAttemptRow(userId, attemptId);

  const { data, error } = await supabase()
    .from("attempt_answers")
    .select("question_id, chosen_option_key, time_spent_seconds")
    .eq("attempt_id", attemptId);
  if (error) throw new HttpError(500, `answers lookup failed: ${error.message}`);

  return { attempt: toAttempt(attempt), answers: (data ?? []) as unknown as AttemptAnswerRecord[] };
}

export async function upsertAttemptAnswers(
  userId: string,
  attemptId: string,
  answers: AttemptAnswerInput[],
): Promise<number> {
  const attempt = await getOwnedAttemptRow(userId, attemptId);
  if (attempt.submitted_at) throw conflict("Attempt already submitted");

  const allowedIds = new Set(attempt.meta.question_ids);
  for (const a of answers) {
    if (!allowedIds.has(a.question_id)) {
      throw badRequest(`question_id ${a.question_id} is not part of this attempt`);
    }
  }

  // Dedupe by question_id (keep the last occurrence) — a single multi-row
  // upsert with the same conflict target twice fails in Postgres with
  // "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const deduped = new Map(answers.map((a) => [a.question_id, a]));
  const rows = [...deduped.values()].map((a) => ({
    attempt_id: attemptId,
    question_id: a.question_id,
    chosen_option_key: a.chosen_option_key ?? null,
    time_spent_seconds: a.time_spent_seconds ?? null,
  }));
  const { error } = await supabase()
    .from("attempt_answers")
    .upsert(rows, { onConflict: "attempt_id,question_id" });
  if (error) throw new HttpError(500, `answers upsert failed: ${error.message}`);
  return rows.length;
}

export async function submitAttempt(userId: string, attemptId: string): Promise<AttemptSubmitResult> {
  const attempt = await getOwnedAttemptRow(userId, attemptId);
  if (attempt.submitted_at) throw conflict("Attempt already submitted");

  const { question_ids: questionIds, question_marks: questionMarks, marking_scheme: markingScheme } =
    attempt.meta;
  const negativeFraction = markingScheme?.negative_marking ?? 0;

  // Question-visibility filter ("test" scope): a question retracted after the
  // attempt started must not be graded — see the matching filter in
  // startAttempt. The current-affairs exception is what keeps that one
  // quiz's always-unpublished questions gradable (see lib/question-visibility.ts).
  const { data: qs, error: qError } = await supabase()
    .from("questions")
    .select("id, correct_option_key, explanation_i18n")
    .in("id", questionIds)
    .or(questionVisibilityOrFilter("test"));
  if (qError) throw new HttpError(500, `question lookup failed: ${qError.message}`);
  const correctById = new Map((qs ?? []).map((q) => [q.id as string, q.correct_option_key as string | null]));
  const explanationById = new Map(
    (qs ?? []).map((q) => [q.id as string, q.explanation_i18n as AttemptResultItem["explanation_i18n"]]),
  );

  const { data: answered, error: aError } = await supabase()
    .from("attempt_answers")
    .select("question_id, chosen_option_key")
    .eq("attempt_id", attemptId);
  if (aError) throw new HttpError(500, `answers lookup failed: ${aError.message}`);
  const chosenById = new Map(
    (answered ?? []).map((a) => [a.question_id as string, a.chosen_option_key as string | null]),
  );

  let score = 0;
  const results: AttemptResultItem[] = [];
  const gradedAnswers: { question_id: string; is_correct: boolean }[] = [];

  for (const qid of questionIds) {
    const marks = questionMarks[qid] ?? 0;
    const chosen = chosenById.get(qid) ?? null;
    // Not in correctById means the question was retracted (unpublished)
    // since the attempt started — exclude it from scoring entirely rather
    // than penalizing the user for content that's no longer live.
    const isRetracted = !correctById.has(qid);
    const correct = correctById.get(qid) ?? null;
    let isCorrect: boolean | null = null;
    let awarded = 0;

    if (!isRetracted && chosen != null) {
      isCorrect = correct != null && chosen === correct;
      awarded = isCorrect ? marks : negativeFraction * marks;
      gradedAnswers.push({ question_id: qid, is_correct: isCorrect });
    }
    score += awarded;

    results.push({
      question_id: qid,
      chosen_option_key: chosen,
      correct_option_key: correct,
      is_correct: isCorrect,
      marks_awarded: round2(awarded),
      explanation_i18n: explanationById.get(qid) ?? null,
    });
  }
  score = round2(score);

  if (gradedAnswers.length > 0) {
    const { error: gradeError } = await supabase()
      .from("attempt_answers")
      .upsert(
        gradedAnswers.map((g) => ({ attempt_id: attemptId, ...g })),
        { onConflict: "attempt_id,question_id" },
      );
    if (gradeError) throw new HttpError(500, `answer grading failed: ${gradeError.message}`);
  }

  const { data: updated, error: updateError } = await supabase()
    .from("attempts")
    .update({ score, submitted_at: new Date().toISOString() })
    .eq("id", attemptId)
    .select(ATTEMPT_COLUMNS)
    .single();
  if (updateError) throw new HttpError(500, `attempt submit failed: ${updateError.message}`);

  return { attempt: toAttempt(updated as unknown as AttemptRow), results };
}

interface ResultQuestionRow {
  id: string;
  paper_code: string;
  syllabus_node_id: string | null;
  stem_i18n: BilingualText;
  options_i18n: AttemptReviewItem["options_i18n"];
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
}

interface TopicBucket {
  paper_code: string | null;
  title_i18n: BilingualText | null;
  attempted: number;
  correct: number;
}

const UNMAPPED_KEY = "__unmapped__";

export async function getAttemptResult(userId: string, attemptId: string): Promise<AttemptResultDetail> {
  const attempt = await getOwnedAttemptRow(userId, attemptId);
  if (!attempt.submitted_at) throw conflict("Attempt has not been submitted yet");

  const { question_ids: questionIds, question_marks: questionMarks, marking_scheme: markingScheme } = attempt.meta;
  const negativeFraction = markingScheme?.negative_marking ?? 0;

  const testResult = attempt.test_id
    ? await supabase().from("tests").select("id, title_i18n, kind, paper_code").eq("id", attempt.test_id).maybeSingle()
    : { data: null, error: null };

  // Question-visibility filter ("test" scope): a question retracted after
  // this attempt was submitted must not be shown as authoritative on the
  // result page — same invariant startAttempt/submitAttempt enforce when
  // serving/grading it. The current-affairs exception (lib/question-visibility.ts)
  // keeps that one quiz's always-unpublished questions visible here too.
  const [answersResult, questionsResult] = await Promise.all([
    supabase()
      .from("attempt_answers")
      .select("question_id, chosen_option_key, is_correct, time_spent_seconds")
      .eq("attempt_id", attemptId),
    supabase()
      .from("questions")
      .select("id, paper_code, syllabus_node_id, stem_i18n, options_i18n, correct_option_key, explanation_i18n")
      .in("id", questionIds)
      .or(questionVisibilityOrFilter("test")),
  ]);
  if (testResult.error) throw new HttpError(500, `test lookup failed: ${testResult.error.message}`);
  if (answersResult.error) throw new HttpError(500, `answers lookup failed: ${answersResult.error.message}`);
  if (questionsResult.error) throw new HttpError(500, `questions lookup failed: ${questionsResult.error.message}`);

  const answerByQuestion = new Map(
    (answersResult.data ?? []).map((a) => [
      a.question_id as string,
      a as { chosen_option_key: string | null; is_correct: boolean | null; time_spent_seconds: number | null },
    ]),
  );
  const questionById = new Map(
    (questionsResult.data ?? []).map((q) => [q.id as string, q as unknown as ResultQuestionRow]),
  );

  const nodeIds = [
    ...new Set([...questionById.values()].map((q) => q.syllabus_node_id).filter((id): id is string => !!id)),
  ];
  const nodesResult = nodeIds.length
    ? await supabase().from("syllabus_nodes").select("id, title_i18n").in("id", nodeIds)
    : { data: [] as { id: string; title_i18n: BilingualText }[], error: null };
  if (nodesResult.error) throw new HttpError(500, `syllabus node lookup failed: ${nodesResult.error.message}`);
  const nodeTitleById = new Map((nodesResult.data ?? []).map((n) => [n.id as string, n.title_i18n as BilingualText]));

  let correctCount = 0;
  let incorrectCount = 0;
  let attemptedCount = 0;
  let totalSeconds = 0;
  let totalSecondsCount = 0;
  let correctSeconds = 0;
  let correctSecondsCount = 0;

  const review: AttemptReviewItem[] = [];
  const breakdownByNode = new Map<string, TopicBucket>();

  // A question retracted since this attempt was submitted has no row in
  // questionById (is_published filter above) — submitAttempt already left its
  // attempt_answers.is_correct null and excluded it from scoring, so it's
  // dropped here too rather than counted as an ungraded "miss": otherwise it
  // would inflate attempted/topic-breakdown denominators for something that
  // was never gradable, and correct+incorrect+skipped would fall short of
  // the total question count.
  const liveQuestionIds = questionIds.filter((qid) => questionById.has(qid));

  for (const qid of liveQuestionIds) {
    const question = questionById.get(qid)!;
    const answer = answerByQuestion.get(qid);
    const marks = questionMarks[qid] ?? 0;
    const chosen = answer?.chosen_option_key ?? null;
    const isCorrect = answer?.is_correct ?? null;
    const timeSpent = answer?.time_spent_seconds ?? null;
    const awarded = isCorrect === true ? marks : isCorrect === false ? negativeFraction * marks : 0;

    if (chosen != null) attemptedCount += 1;
    if (isCorrect === true) correctCount += 1;
    if (isCorrect === false) incorrectCount += 1;
    if (timeSpent != null) {
      totalSeconds += timeSpent;
      totalSecondsCount += 1;
      if (isCorrect === true) {
        correctSeconds += timeSpent;
        correctSecondsCount += 1;
      }
    }

    const nodeId = question.syllabus_node_id;
    const bucketKey = nodeId ?? UNMAPPED_KEY;
    const bucket = breakdownByNode.get(bucketKey) ?? {
      paper_code: question.paper_code,
      title_i18n: nodeId ? (nodeTitleById.get(nodeId) ?? null) : null,
      attempted: 0,
      correct: 0,
    };
    if (chosen != null) {
      bucket.attempted += 1;
      if (isCorrect === true) bucket.correct += 1;
    }
    breakdownByNode.set(bucketKey, bucket);

    review.push({
      question_id: qid,
      stem_i18n: question.stem_i18n,
      options_i18n: question.options_i18n,
      chosen_option_key: chosen,
      correct_option_key: question.correct_option_key,
      is_correct: isCorrect,
      marks_awarded: round2(awarded),
      explanation_i18n: question.explanation_i18n,
      time_spent_seconds: timeSpent,
      syllabus_node_id: nodeId,
      paper_code: question.paper_code,
    });
  }

  const skippedCount = liveQuestionIds.length - attemptedCount;
  const scorePct = attempt.total ? round2(((attempt.score ?? 0) / attempt.total) * 100) : null;
  const accuracyPct = attemptedCount > 0 ? round2((correctCount / attemptedCount) * 100) : null;
  const avgSecondsPerQuestion = totalSecondsCount > 0 ? round2(totalSeconds / totalSecondsCount) : null;
  const avgSecondsCorrect = correctSecondsCount > 0 ? round2(correctSeconds / correctSecondsCount) : null;

  const topicBreakdown: AttemptTopicBreakdownItem[] = [...breakdownByNode.entries()]
    .map(([key, bucket]) => ({
      syllabus_node_id: key === UNMAPPED_KEY ? null : key,
      paper_code: bucket.paper_code,
      title_i18n: bucket.title_i18n,
      attempted: bucket.attempted,
      correct: bucket.correct,
      accuracy_pct: bucket.attempted > 0 ? round2((bucket.correct / bucket.attempted) * 100) : null,
      is_weak: bucket.attempted > 0 && bucket.correct / bucket.attempted < 0.5,
    }))
    .sort((a, b) => (a.accuracy_pct ?? Infinity) - (b.accuracy_pct ?? Infinity));

  // Percentile is computed against every submitted attempt of this test (not
  // just this user's) — with a single dev user today that's the same
  // population, but the calc itself doesn't assume that.
  let percentile: number | null = null;
  if (attempt.test_id) {
    const { data: scoreRows, error: scoresError } = await supabase()
      .from("attempts")
      .select("score")
      .eq("test_id", attempt.test_id)
      .not("submitted_at", "is", null);
    if (scoresError) throw new HttpError(500, `attempt scores lookup failed: ${scoresError.message}`);
    const scores = (scoreRows ?? []).map((r) => (r.score as number | null) ?? 0);
    if (scores.length > 0) {
      const myScore = attempt.score ?? 0;
      const below = scores.filter((s) => s < myScore).length;
      const equal = scores.filter((s) => s === myScore).length;
      percentile = round2(((below + 0.5 * equal) / scores.length) * 100);
    }
  }

  const test = testResult.data
    ? {
        id: testResult.data.id as string,
        title_i18n: testResult.data.title_i18n as BilingualText,
        kind: testResult.data.kind as TestKind,
        paper_code: testResult.data.paper_code as string | null,
      }
    : null;

  return {
    attempt: toAttempt(attempt),
    test,
    score_pct: scorePct,
    percentile,
    accuracy_pct: accuracyPct,
    attempted_count: attemptedCount,
    correct_count: correctCount,
    incorrect_count: incorrectCount,
    skipped_count: skippedCount,
    avg_seconds_per_question: avgSecondsPerQuestion,
    avg_seconds_correct: avgSecondsCorrect,
    topic_breakdown: topicBreakdown,
    review,
  };
}
