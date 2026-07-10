import type { CurrentAffairsItem, CurrentAffairsQuery } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { RELEVANCE_GATE } from "../ca/pipeline.js";

export const CURRENT_AFFAIRS_PAGE_SIZE = 20;

const CURRENT_AFFAIRS_COLUMNS =
  "id, date, status, category, is_up_specific, prelims_relevance, mains_relevance, gs_papers, " +
  "title_i18n, summary_i18n, prelims_facts, mains_brief, possible_questions, node_significance, " +
  "detail_i18n, source_urls, syllabus_node_ids, mcq_question_ids";

export async function listCurrentAffairs(
  filters: CurrentAffairsQuery,
): Promise<{ items: CurrentAffairsItem[]; total: number }> {
  let query = supabase()
    .from("current_affairs_items")
    .select(CURRENT_AFFAIRS_COLUMNS, { count: "exact" })
    .eq("status", "published");

  if (filters.date) query = query.eq("date", filters.date);
  if (filters.category) query = query.eq("category", filters.category);

  // Exam-lens tabs. `up_only` (legacy query param) still works and is ANDed in.
  switch (filters.lens) {
    case "prelims":
      query = query.gte("prelims_relevance", RELEVANCE_GATE);
      break;
    case "mains":
      query = query.gte("mains_relevance", RELEVANCE_GATE);
      break;
    case "up":
      query = query.eq("is_up_specific", true);
      break;
    default:
      break;
  }
  if (filters.up_only) query = query.eq("is_up_specific", true);

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

export async function getCurrentAffairsItemById(id: string): Promise<CurrentAffairsItem> {
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select(CURRENT_AFFAIRS_COLUMNS)
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new HttpError(500, `current affairs item lookup failed: ${error.message}`);
  if (!data) throw notFound("Current affairs item not found");
  return data as unknown as CurrentAffairsItem;
}
