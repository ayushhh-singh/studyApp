import { supabase } from "./supabase.js";
import { selectAll } from "./paginate.js";
import { HttpError } from "./http-error.js";

export interface GradedAnswerRow {
  is_correct: boolean | null;
  questions: { paper_code: string; syllabus_node_id: string | null } | null;
}

/** Every graded (is_correct is not null) attempt_answers row for a user's submitted attempts. */
export async function getGradedAnswers(userId: string): Promise<GradedAnswerRow[]> {
  // Both reads are PAGED. Measured during the multi-exam audit: the heaviest
  // real user today has 359 graded answers, so neither truncates yet — but a
  // user who sits a handful of full 150-question mocks crosses PostgREST's
  // 1000-row cap, and a truncated read here does not error, it silently drops
  // answers from the dashboard weakness radar, the papers grid's accuracy and
  // the mentor's learner profile at once (all three read this one helper).
  const attemptIdRows = await selectAll<{ id: string }>(() =>
    supabase()
      .from("attempts")
      .select("id")
      .eq("user_id", userId)
      .not("submitted_at", "is", null)
      .order("id", { ascending: true }),
  );
  const attemptIds = attemptIdRows.map((r) => r.id);
  if (attemptIds.length === 0) return [];

  // `.in()` is chunked: PostgREST throws `fetch failed` on a URL carrying a few
  // hundred+ values (documented gotcha), and a heavy account can exceed that.
  const IN_BATCH = 100;
  const out: GradedAnswerRow[] = [];
  for (let i = 0; i < attemptIds.length; i += IN_BATCH) {
    const slice = attemptIds.slice(i, i + IN_BATCH);
    const rows = await selectAll<GradedAnswerRow>(() =>
      supabase()
        .from("attempt_answers")
        .select("id, is_correct, questions(paper_code, syllabus_node_id)")
        .in("attempt_id", slice)
        .not("is_correct", "is", null)
        .order("id", { ascending: true }),
    );
    out.push(...rows);
  }
  return out;
}
