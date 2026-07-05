import { supabase } from "./supabase.js";
import { HttpError } from "./http-error.js";

export interface GradedAnswerRow {
  is_correct: boolean | null;
  questions: { paper_code: string; syllabus_node_id: string | null } | null;
}

/** Every graded (is_correct is not null) attempt_answers row for a user's submitted attempts. */
export async function getGradedAnswers(userId: string): Promise<GradedAnswerRow[]> {
  const { data: attemptIdRows, error: attemptIdsError } = await supabase()
    .from("attempts")
    .select("id")
    .eq("user_id", userId)
    .not("submitted_at", "is", null);
  if (attemptIdsError) throw new HttpError(500, `attempt id lookup failed: ${attemptIdsError.message}`);
  const attemptIds = (attemptIdRows ?? []).map((r) => r.id as string);
  if (attemptIds.length === 0) return [];

  const { data, error } = await supabase()
    .from("attempt_answers")
    .select("is_correct, questions(paper_code, syllabus_node_id)")
    .in("attempt_id", attemptIds)
    .not("is_correct", "is", null);
  if (error) throw new HttpError(500, `graded answers lookup failed: ${error.message}`);
  return (data ?? []) as unknown as GradedAnswerRow[];
}
