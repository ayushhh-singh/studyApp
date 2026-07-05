import type {
  Attempt,
  AttemptAnswerInput,
  AttemptResultItem,
  AttemptStartBody,
  AttemptSubmitResult,
  MarkingScheme,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, conflict, HttpError, notFound } from "../lib/http-error.js";

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

export async function startAttempt(userId: string, body: AttemptStartBody): Promise<Attempt> {
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

    // !inner + questions.is_published filters out questions retracted after
    // the test was assembled — a since-unpublished question must not be
    // served or graded in a new attempt.
    const { data: tq, error: tqError } = await supabase()
      .from("test_questions")
      .select("question_id, marks, order_index, questions!inner(marks)")
      .eq("test_id", body.test_id)
      .eq("questions.is_published", true)
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
      .eq("is_published", true);
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
  if (error) throw new HttpError(500, `attempt insert failed: ${error.message}`);
  return toAttempt(attempt as unknown as AttemptRow);
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

  // is_published filter: a question retracted after the attempt started
  // must not be graded — see the matching filter in startAttempt.
  const { data: qs, error: qError } = await supabase()
    .from("questions")
    .select("id, correct_option_key, explanation_i18n")
    .in("id", questionIds)
    .eq("is_published", true);
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
