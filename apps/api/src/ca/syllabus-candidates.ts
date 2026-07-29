/**
 * The syllabus candidate set offered to CA triage for node mapping.
 *
 * Shared by the live pipeline and the batch backfill, which previously each
 * carried their own copy of this query with a hard `.limit(260)`. That cap was
 * a silent truncation waiting to happen: the moment the tree grew past 260
 * depth-1/2 nodes, callers would have gone on mapping against an arbitrary
 * prefix of the syllabus (ordered by paper_code, so late papers would simply
 * vanish) with nothing logged. It also interacts badly with the embedding
 * pre-filter, whose coverage check would flip off against a truncated set.
 *
 * This pages through the whole range instead, so the candidate set is always
 * complete however large the tree gets.
 */
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { selectAll } from "../lib/paginate.js";
import type { SyllabusCandidate } from "./prompts.js";

/**
 * Every depth-1/depth-2 syllabus node, paged (no silent cap), across the LIVE
 * exams.
 *
 * NOT scoped to a single exam, deliberately — and this is the one place in the
 * multi-exam audit where a hard per-exam filter would be the WRONG fix. Migration
 * 0106 §11 decided that one current-affairs item MAY map to several exams' nodes
 * (a budget / IR / environment story genuinely is relevant to all of them), which
 * is exactly why `current_affairs_items.syllabus_node_ids` is a bare uuid[] and
 * `exam_codes` is an array rather than a scalar. Filtering the candidate list to
 * one exam would force every national item to be triaged and enriched once per
 * exam — re-paying the two most expensive LLM calls in the pipeline per copy,
 * which is precisely what that decision exists to avoid.
 *
 * What IS worth excluding is a NON-LIVE exam: a reference or half-ingested exam's
 * nodes have no users and would only inflate the triage prompt (which is already
 * ~94% candidate list — see ca/prompts.ts) and give the model wrong-exam options
 * to choose from. Callers pass the live set; omitting it falls back to every exam,
 * which is the pre-0106 behaviour and still correct, just wider.
 */
export async function loadSyllabusCandidates(
  opts: { examCodes?: string[] } = {},
): Promise<SyllabusCandidate[]> {
  const rows = await selectAll<{ id: string; title_i18n: { en?: string }; paper_code: string; exam_code: string | null }>(() => {
    let q = supabase()
      .from("syllabus_nodes")
      .select("id, title_i18n, paper_code, exam_code")
      .gte("depth", 1)
      .lte("depth", 2);
    if (opts.examCodes?.length) q = q.in("exam_code", opts.examCodes);
    return q
      .order("paper_code", { ascending: true })
      .order("id", { ascending: true }); // stable tiebreak so paging can't skip/repeat
  });
  const out = rows.map((n) => ({
    id: n.id,
    title: (n.title_i18n?.en ?? "").trim(),
    paperCode: n.paper_code,
    examCode: n.exam_code ?? DEFAULT_EXAM_CODE,
  }));
  const untitled = out.filter((c) => !c.title).length;
  if (untitled > 0) {
    logger.warn({ untitled, total: out.length }, "ca: syllabus candidates with an empty English title (they will be unusable for node mapping)");
  }
  return out;
}
