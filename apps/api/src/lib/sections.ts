/**
 * "Which top-level syllabus section does this question belong to, and how heavily
 * does the commission ask that section?" — the two lookups every topic-balanced
 * assembly surface needs, in one place.
 *
 * Split out of `services/mocks.ts` when the daily quiz and the current-affairs
 * sittings adopted topic balancing: mocks owned both, and importing a mock
 * builder from the daily-quiz assembler to get a syllabus lookup would be the
 * wrong dependency edge. `services/mocks.ts` re-exports `sectionHotness` so
 * `services/on-demand.ts`'s import is unchanged.
 *
 * A "section" is the FIRST segment of `syllabus_nodes.path` — the depth-1 node a
 * question ultimately sits under. That is the grain real papers and real test
 * series are organised by (docs/test-series-design.md §6.1: our depth-1 sections
 * already ARE the institutes' sectional subjects), and it is the grain
 * `mv_node_weightage` rolls up to.
 */
import { supabase } from "./supabase.js";
import { selectAll } from "./paginate.js";
import { HttpError } from "./http-error.js";
import { hotnessRaw, type OwnWeightage } from "./weightage.js";

/** The section key for a question whose `syllabus_node_id` is null or unknown. */
export const UNMAPPED_SECTION = "__unmapped__";

/**
 * node_id -> top-level path segment, for one paper's tree.
 *
 * Not paged on purpose: this is one paper's syllabus, 11-45 rows per paper today
 * and bounded by the commission's own syllabus rather than by content volume, so
 * it cannot approach PostgREST's 1000-row cap the way a question pool can.
 */
export async function topLevelByNode(paperCode: string): Promise<Map<string, string>> {
  const { data, error } = await supabase().from("syllabus_nodes").select("id, path").eq("paper_code", paperCode);
  if (error) throw new HttpError(500, `syllabus lookup failed: ${error.message}`);
  const out = new Map<string, string>();
  for (const n of (data ?? []) as { id: string; path: string }[]) {
    out.set(n.id, n.path ? n.path.split("/")[0] : "__root__");
  }
  return out;
}

/**
 * Rolled-up recency-weighted PYQ frequency (hotness) per top-level section of a
 * paper, from the cached weightage matview — the SAME signal qgen/topup.ts and
 * the /learn weightage bars use. Every node under a section contributes, so a
 * section's weight reflects its whole subtree. Sections with no dated PYQ have
 * weight 0; they still appear in an assembled paper via the balancer's coverage
 * floor.
 */
export async function sectionHotness(
  paperCode: string,
  weightage: Map<string, OwnWeightage>,
  year: number,
): Promise<Map<string, number>> {
  const topByNode = await topLevelByNode(paperCode);
  const out = new Map<string, number>();
  for (const [nodeId, top] of topByNode) {
    const w = weightage.get(nodeId);
    if (!w) continue;
    out.set(top, (out.get(top) ?? 0) + hotnessRaw(w.byYear, year));
  }
  return out;
}

/** The section a question belongs to, given a paper's node->section map. */
export function sectionOf(nodeId: string | null | undefined, topByNode: Map<string, string>): string {
  return (nodeId && topByNode.get(nodeId)) || UNMAPPED_SECTION;
}

/**
 * node_id -> PAPER code, for one exam's whole tree.
 *
 * The section axis for content that spans several papers rather than sitting
 * inside one. The current-affairs MAINS set is the case: measured, its approved
 * descriptive questions map across MAINS_ESSAY and GS1-GS6 simultaneously (the
 * MCQ set does not — every CA MCQ maps into the single prelims GS paper), so
 * "which depth-1 section" is not a well-formed question for it and "which paper"
 * is.
 *
 * Paged: two exams' trees are ~500 rows today and grow with every syllabus
 * ingest, and a truncated read would silently drop papers from the balance rather
 * than error.
 */
export async function paperByNode(examCode: string): Promise<Map<string, string>> {
  const rows = await selectAll<{ id: string; paper_code: string }>(() =>
    supabase().from("syllabus_nodes").select("id, paper_code").eq("exam_code", examCode).order("id", { ascending: true }),
  );
  return new Map(rows.map((r) => [r.id, r.paper_code]));
}
