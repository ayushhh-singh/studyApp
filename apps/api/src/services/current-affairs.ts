import type { CurrentAffairsItem, CurrentAffairsQuery } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import {
  CA_CURATION_SCOPE_COLUMNS,
  gsPapersForExam,
  hasStateFocusForExam,
  stateFocusFilterFor,
  type CaCurationScopeRow,
} from "../ca/curation-scope.js";
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
  "id, date, status, category, prelims_relevance, mains_relevance, " +
  `${CA_CURATION_SCOPE_COLUMNS}, ` +
  "title_i18n, summary_i18n, prelims_facts, mains_brief, possible_questions, node_significance, " +
  "detail_i18n, source_urls, syllabus_node_ids, mcq_question_ids";

/**
 * A raw row as selected above → the wire `CurrentAffairsItem`, with the two
 * shared-row curation columns RESOLVED against the reading exam (M20b).
 *
 * ⚑ THE RAW COLUMNS MUST NOT REACH THE CLIENT. `is_up_specific` / `gs_papers`
 * are whichever commission(s) triaged the row, OR-ed and UNION-ed onto it by
 * `mergeExamTriages`; `current_affairs_items` is one row across several exams by
 * design (0106 §11). Sending them raw is how the feed card's "UP-specific" chip
 * came to render UNGATED — a national-exam reader would see another
 * commission's state verdict on any widened row. Resolving here means every
 * consumer (card, detail sheet, related-CA on a syllabus node) is correct
 * without each having to remember a lens gate.
 */
export function toWireItem(row: Record<string, unknown>, examCode: string): CurrentAffairsItem {
  const scope = row as unknown as CaCurationScopeRow;
  const { is_up_specific: _u, gs_papers_by_exam: _g, state_focus: _s, ...rest } = row as Record<string, unknown>;
  return {
    ...(rest as unknown as CurrentAffairsItem),
    state_focus: hasStateFocusForExam(scope, examCode),
    gs_papers: [...gsPapersForExam(scope, examCode)],
  };
}

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
  // M20b: the SQL twin of `hasStateFocusForExam` — this exam's own state code,
  // with the legacy `is_up_specific` disjunct emitted only for the default exam.
  // Resolved in SQL rather than in JS because this endpoint paginates in the
  // database, so a post-hoc filter would return short pages. Null ⇔ a
  // nationally-scoped exam, i.e. there is no such tab; the filter is then
  // DROPPED rather than narrowed, exactly as before.
  const stateFilter = stateFocusFilterFor(examCode);

  // Exam-lens tabs. `up_only` (legacy query param) still works and is ANDed in.
  switch (filters.lens) {
    case "prelims":
      query = query.gte("prelims_relevance", RELEVANCE_GATE);
      break;
    case "mains":
      query = query.gte("mains_relevance", RELEVANCE_GATE);
      break;
    case "up":
      if (stateFilter) query = query.or(stateFilter);
      break;
    default:
      break;
  }
  if (filters.up_only && stateFilter) query = query.or(stateFilter);

  const from = (filters.page - 1) * CURRENT_AFFAIRS_PAGE_SIZE;
  const to = from + CURRENT_AFFAIRS_PAGE_SIZE - 1;
  query = query
    .order("date", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to);

  const { data, error, count } = await query;
  if (error) throw new HttpError(500, `current affairs query failed: ${error.message}`);
  return {
    items: (data ?? []).map((r) => toWireItem(r as unknown as Record<string, unknown>, examCode)),
    total: count ?? 0,
  };
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
  return toWireItem(data as unknown as Record<string, unknown>, examCode);
}
