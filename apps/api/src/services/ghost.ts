/**
 * Ghost Battle. Replays a completed attempt's exact question set as a fresh
 * attempt, and hands back "past you" — the original attempt's per-question time
 * and correctness — so the player can show a live marker and the end screen can
 * show deltas. Mastery updates automatically on submit (the normal submit hook).
 */
import type { GhostEntry, GhostStart } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { getTestDetail } from "./tests.js";
import { startAttempt } from "./attempts.js";

export async function startGhostBattle(userId: string, previousAttemptId: string): Promise<GhostStart> {
  const { data: prev, error: prevErr } = await supabase()
    .from("attempts")
    .select("id, user_id, test_id, submitted_at")
    .eq("id", previousAttemptId)
    .maybeSingle();
  if (prevErr) throw new HttpError(500, `attempt lookup failed: ${prevErr.message}`);
  if (!prev || prev.user_id !== userId) throw notFound("Attempt not found");
  if (!prev.submitted_at) throw badRequest("Can only race a completed attempt");
  if (!prev.test_id) throw badRequest("This attempt can't be raced");

  const { data: prevAnswers, error: ansErr } = await supabase()
    .from("attempt_answers")
    .select("question_id, time_spent_seconds, is_correct")
    .eq("attempt_id", previousAttemptId);
  if (ansErr) throw new HttpError(500, `answers lookup failed: ${ansErr.message}`);
  const byQuestion = new Map(
    (prevAnswers ?? []).map((a) => [
      a.question_id as string,
      { time_spent_seconds: (a.time_spent_seconds as number | null) ?? null, is_correct: (a.is_correct as boolean | null) ?? null },
    ]),
  );

  const attempt = await startAttempt(userId, { test_id: prev.test_id }, { source: "ghost" });
  const test = await getTestDetail(prev.test_id);

  const ghost: GhostEntry[] = test.questions.map((q) => {
    const past = byQuestion.get(q.id);
    return { question_id: q.id, time_spent_seconds: past?.time_spent_seconds ?? null, is_correct: past?.is_correct ?? null };
  });

  return {
    attempt_id: attempt.id,
    started_at: attempt.started_at,
    test,
    previous_attempt_id: previousAttemptId,
    ghost,
  };
}
