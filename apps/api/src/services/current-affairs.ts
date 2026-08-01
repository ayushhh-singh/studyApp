import type { CurrentAffairsItem, CurrentAffairsQuery } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { stateLensFor } from "../lib/exam-config.js";
import { RELEVANCE_GATE } from "../ca/pipeline.js";

export const CURRENT_AFFAIRS_PAGE_SIZE = 20;

/**
 * The full column list every surface that returns a `CurrentAffairsItem` to the
 * frontend must select — the shared `currentAffairsItemSchema` requires all of
 * these (status/prelims_relevance/mains_relevance/prelims_facts/mains_brief/
 * possible_questions/node_significance are non-optional), so a partial select
 * makes the client-side zod parse throw. Reused by services/magazine.ts and
 * services/syllabus.ts (related CA) so they can never drift from the schema.
 */
export const CURRENT_AFFAIRS_COLUMNS =
  "id, date, status, category, is_up_specific, prelims_relevance, mains_relevance, gs_papers, " +
  "title_i18n, summary_i18n, prelims_facts, mains_brief, possible_questions, node_significance, " +
  "detail_i18n, source_urls, syllabus_node_ids, mcq_question_ids";

/**
 * `examCode` is REQUIRED, not optional-with-a-default: 0106 §11 added
 * `exam_codes` precisely so a reader could get "current affairs relevant to MY
 * exam", and until this filter existed the column was written by the pipeline
 * and read by nobody — a second exam's feed would have been the UPPSC feed,
 * UP-specific items and all.
 *
 * `overlaps`, not equality: `exam_codes` is an ARRAY on purpose. A national
 * budget / IR / environment story is genuinely relevant to several exams and is
 * deliberately NOT duplicated per exam (0106 §11), so it must appear in each of
 * their feeds from the one row.
 */
export async function listCurrentAffairs(
  examCode: string,
  filters: CurrentAffairsQuery,
): Promise<{ items: CurrentAffairsItem[]; total: number }> {
  let query = supabase()
    .from("current_affairs_items")
    .select(CURRENT_AFFAIRS_COLUMNS, { count: "exact" })
    .overlaps("exam_codes", [examCode])
    .eq("status", "published");

  if (filters.date) query = query.eq("date", filters.date);
  if (filters.category) query = query.eq("category", filters.category);

  // THE STATE LENS EXISTS ONLY FOR A STATE-SCOPED EXAM. `is_up_specific` is a
  // property of the shared ROW, not of the reader — `current_affairs_items` is
  // deliberately one row across several `exam_codes` (0106 §11) and
  // `mergeExamTriages` ORs the flag across every exam that triaged it — so for a
  // nationally-scoped exam it is another commission's verdict. Filtering on it
  // would hand a UPSC aspirant a "UP" tab built from UPPSC's judgment.
  //
  // Not a 400: the tab is hidden client-side, but `?lens=up` survives in the URL
  // across an exam switch, and erroring the whole feed over a stale query param
  // is worse than serving it. The filter is DROPPED (never silently narrowed or
  // widened to some other lens), and the client normalises the param away so the
  // user sees the "All" tab actually selected rather than a phantom one.
  const stateLensAvailable = stateLensFor(examCode) !== null;

  // Exam-lens tabs. `up_only` (legacy query param) still works and is ANDed in.
  switch (filters.lens) {
    case "prelims":
      query = query.gte("prelims_relevance", RELEVANCE_GATE);
      break;
    case "mains":
      query = query.gte("mains_relevance", RELEVANCE_GATE);
      break;
    case "up":
      if (stateLensAvailable) query = query.eq("is_up_specific", true);
      break;
    default:
      break;
  }
  if (filters.up_only && stateLensAvailable) query = query.eq("is_up_specific", true);

  const from = (filters.page - 1) * CURRENT_AFFAIRS_PAGE_SIZE;
  const to = from + CURRENT_AFFAIRS_PAGE_SIZE - 1;
  query = query
    .order("date", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to);

  const { data, error, count } = await query;
  if (error) throw new HttpError(500, `current affairs query failed: ${error.message}`);
  return { items: (data ?? []) as unknown as CurrentAffairsItem[], total: count ?? 0 };
}

export async function getCurrentAffairsItemById(examCode: string, id: string): Promise<CurrentAffairsItem> {
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select(CURRENT_AFFAIRS_COLUMNS)
    .eq("id", id)
    .overlaps("exam_codes", [examCode])
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new HttpError(500, `current affairs item lookup failed: ${error.message}`);
  if (!data) throw notFound("Current affairs item not found");
  return data as unknown as CurrentAffairsItem;
}
