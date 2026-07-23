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
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { selectAll } from "../lib/paginate.js";
import type { SyllabusCandidate } from "./prompts.js";

/** Every depth-1/depth-2 syllabus node, paged (no silent cap). */
export async function loadSyllabusCandidates(): Promise<SyllabusCandidate[]> {
  const rows = await selectAll<{ id: string; title_i18n: { en?: string }; paper_code: string }>(() =>
    supabase()
      .from("syllabus_nodes")
      .select("id, title_i18n, paper_code")
      .gte("depth", 1)
      .lte("depth", 2)
      .order("paper_code", { ascending: true })
      .order("id", { ascending: true }), // stable tiebreak so paging can't skip/repeat
  );
  const out = rows.map((n) => ({ id: n.id, title: (n.title_i18n?.en ?? "").trim(), paperCode: n.paper_code }));
  const untitled = out.filter((c) => !c.title).length;
  if (untitled > 0) {
    logger.warn({ untitled, total: out.length }, "ca: syllabus candidates with an empty English title (they will be unusable for node mapping)");
  }
  return out;
}
