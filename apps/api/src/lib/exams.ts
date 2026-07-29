/**
 * Exam registry lookups.
 *
 * `exams.is_live` is the gate on whether an exam is SELECTABLE in-product. A
 * non-live row is reference data: it has a verified paper structure but zero
 * syllabus nodes, questions, chapters and current affairs (migration 0106).
 *
 * The foreign key on `users_profile.target_exam` only proves the exam EXISTS —
 * it cannot express "and it is ready to be used". Without the check below,
 * `PATCH /profile {"target_exam":"upsc"}` succeeds and strands the user on an
 * exam with no content: an empty papers grid, no PYQs, no chapters, no
 * countdown. Verified against the live DB before this guard existed.
 */
import { supabase } from "./supabase.js";
import { HttpError, badRequest } from "./http-error.js";

export interface ExamRow {
  exam_code: string;
  is_live: boolean;
}

/** Every registered exam, ordered for display. */
export async function listExams(): Promise<ExamRow[]> {
  const { data, error } = await supabase()
    .from("exams")
    .select("exam_code, is_live")
    .order("sort_order", { ascending: true });
  if (error) throw new HttpError(500, `exam lookup failed: ${error.message}`);
  return (data ?? []) as ExamRow[];
}

/**
 * Throws 400 unless `examCode` names a LIVE exam. Call before persisting any
 * user-supplied exam choice.
 */
export async function assertSelectableExam(examCode: string): Promise<void> {
  const { data, error } = await supabase()
    .from("exams")
    .select("exam_code, is_live")
    .eq("exam_code", examCode)
    .maybeSingle();
  if (error) throw new HttpError(500, `exam lookup failed: ${error.message}`);
  // Unknown code would also be caught by the FK, but as a 500 rather than a 400.
  if (!data) throw badRequest(`Unknown exam: ${examCode}`);
  if (!(data as ExamRow).is_live) {
    throw badRequest(
      `${examCode} is not available yet — its syllabus and question bank have not been published.`,
    );
  }
}
