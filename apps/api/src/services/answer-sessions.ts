/**
 * Timed multi-question Answer-Writing test sessions — a thin, resumable
 * wrapper around an existing `tests` row (yearly full paper / sectional /
 * mock / custom, all built the same way pyq_full/sectional/mock/custom are
 * for MCQ, just with descriptive questions — see services/tests.ts and
 * ingest/tests.ts). Every question in a session is a normal
 * answer_submissions row (typed or handwritten, tagged with
 * answer_session_id) — the OCR/evaluation pipeline is completely unchanged;
 * this module only manages the session's own lifecycle and read views.
 */
import type { AnswerSession, AnswerSessionDetail, AnswerSessionResult, SubmissionStatus } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { getTestDetail } from "./tests.js";

interface SessionRow {
  id: string;
  user_id: string;
  test_id: string;
  started_at: string;
  duration_minutes: number | null;
  submitted_at: string | null;
  status: "in_progress" | "submitted";
}

const SESSION_COLUMNS = "id, user_id, test_id, started_at, duration_minutes, submitted_at, status";

function toSession(row: SessionRow): AnswerSession {
  return {
    id: row.id,
    test_id: row.test_id,
    started_at: row.started_at,
    duration_minutes: row.duration_minutes,
    submitted_at: row.submitted_at,
    status: row.status,
  };
}

async function getOwnedSessionRow(userId: string, sessionId: string): Promise<SessionRow> {
  const { data, error } = await supabase()
    .from("answer_test_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new HttpError(500, `answer session lookup failed: ${error.message}`);
  const row = data as unknown as SessionRow | null;
  if (!row || row.user_id !== userId) throw notFound("Answer session not found");
  return row;
}

async function findActiveSession(userId: string, testId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase()
    .from("answer_test_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .eq("test_id", testId)
    .is("submitted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `active session lookup failed: ${error.message}`);
  return data as unknown as SessionRow | null;
}

/** Resuming a test session re-clicking "Start" for a test already in progress returns that same session — mirrors startAttempt's findActiveAttempt. */
export async function startAnswerSession(userId: string, testId: string): Promise<AnswerSession> {
  const active = await findActiveSession(userId, testId);
  if (active) return toSession(active);

  const { data: test, error: testError } = await supabase()
    .from("tests")
    .select("id, is_published, duration_minutes, paper_code")
    .eq("id", testId)
    .maybeSingle();
  if (testError) throw new HttpError(500, `test lookup failed: ${testError.message}`);
  if (!test || !test.is_published) throw notFound("Test not found");
  // Every current caller only ever supplies a Mains (descriptive) test id —
  // guard it server-side too, since an MCQ test's questions carry
  // options_i18n/correct_option_key semantics the answer-session player and
  // validateAnswerSessionSubmission (typed/handwritten answer intake) don't
  // understand at all.
  if ((test.paper_code ?? "").startsWith("PRE_")) {
    throw badRequest("This test is an MCQ test, not an answer-writing test");
  }

  const { data, error } = await supabase()
    .from("answer_test_sessions")
    .insert({ user_id: userId, test_id: testId, duration_minutes: test.duration_minutes })
    .select(SESSION_COLUMNS)
    .single();
  if (error) {
    // Mirrors startAttempt's identical race handling (see
    // 0025_attempts_active_unique.sql / 0064_answer_sessions_active_unique.sql):
    // two concurrent "Start" requests can both pass the findActiveSession
    // check above before either insert lands; the partial unique index
    // catches the loser here, and we converge both callers onto the winner.
    if (error.code === "23505") {
      const winner = await findActiveSession(userId, testId);
      if (winner) return toSession(winner);
    }
    throw new HttpError(500, `answer session insert failed: ${error.message}`);
  }
  return toSession(data as unknown as SessionRow);
}

interface SessionSubmissionRow {
  id: string;
  question_id: string | null;
  status: SubmissionStatus;
  mode: "typed" | "handwritten";
  evaluations: { overall_score: number | null; max_score: number | null } | null;
}

interface SessionSubmissionSummary {
  submission_id: string;
  status: SubmissionStatus;
  mode: "typed" | "handwritten";
  overall_score: number | null;
  max_score: number | null;
}

async function submissionsBySession(sessionId: string): Promise<Map<string, SessionSubmissionSummary>> {
  const { data, error } = await supabase()
    .from("answer_submissions")
    .select("id, question_id, status, mode, evaluations(overall_score, max_score)")
    .eq("answer_session_id", sessionId);
  if (error) throw new HttpError(500, `session submissions lookup failed: ${error.message}`);
  const map = new Map<string, SessionSubmissionSummary>();
  for (const row of (data ?? []) as unknown as SessionSubmissionRow[]) {
    if (!row.question_id) continue;
    map.set(row.question_id, {
      submission_id: row.id,
      status: row.status,
      mode: row.mode,
      overall_score: row.evaluations?.overall_score ?? null,
      max_score: row.evaluations?.max_score ?? null,
    });
  }
  return map;
}

export async function getAnswerSession(userId: string, sessionId: string): Promise<AnswerSessionDetail> {
  const row = await getOwnedSessionRow(userId, sessionId);
  const [test, submissionsMap] = await Promise.all([getTestDetail(row.test_id), submissionsBySession(sessionId)]);
  const submissions: AnswerSessionDetail["submissions"] = {};
  for (const [questionId, s] of submissionsMap) submissions[questionId] = s;
  return { session: toSession(row), test, submissions };
}

/** Idempotent — a second "Finish" call (or a retried timeout) is a no-op once submitted_at is set. */
export async function finishAnswerSession(userId: string, sessionId: string): Promise<AnswerSession> {
  const row = await getOwnedSessionRow(userId, sessionId);
  if (row.submitted_at) return toSession(row);

  const { data, error } = await supabase()
    .from("answer_test_sessions")
    .update({ submitted_at: new Date().toISOString(), status: "submitted" })
    .eq("id", sessionId)
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `answer session finish failed: ${error.message}`);
  return toSession(data as unknown as SessionRow);
}

export async function getAnswerSessionResult(userId: string, sessionId: string): Promise<AnswerSessionResult> {
  const row = await getOwnedSessionRow(userId, sessionId);
  const [test, submissionsMap] = await Promise.all([getTestDetail(row.test_id), submissionsBySession(sessionId)]);

  const items = test.questions
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((q) => ({
      question_id: q.id,
      stem_i18n: q.stem_i18n,
      marks: q.marks,
      word_limit: q.word_limit,
      order_index: q.order_index,
      submission: submissionsMap.get(q.id) ?? null,
    }));

  const attemptedCount = items.filter((i) => i.submission).length;
  const completed = items.filter((i) => i.submission?.status === "complete");
  const totalScore = completed.length > 0 ? completed.reduce((sum, i) => sum + (i.submission!.overall_score ?? 0), 0) : null;
  const totalMaxScore = completed.length > 0 ? completed.reduce((sum, i) => sum + (i.submission!.max_score ?? 0), 0) : null;

  return {
    session: toSession(row),
    test_title_i18n: test.title_i18n,
    items,
    attempted_count: attemptedCount,
    total_count: items.length,
    total_score: totalScore,
    total_max_score: totalMaxScore,
  };
}
