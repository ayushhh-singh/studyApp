import type { ExamCalendarEntry, PaperWeightage, WeightageSection } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { HttpError } from "../lib/http-error.js";

/**
 * Read models for the PUBLIC content hub (`docs/content-strategy.md` §5).
 *
 * Every function here is exam-reference data with no user in it — see the
 * contract note on `packages/shared/src/content-hub.ts` for why that makes it
 * safe to mount before `requireAuth`.
 */

/**
 * Every dated milestone we hold, soonest first, for every exam.
 *
 * NOT filtered to "upcoming". An article about the 2027 cycle should still read
 * correctly the day after Prelims, showing the sitting that has happened as
 * well as the one that has not — and the caller (an article, a hub) knows its
 * own framing far better than this query does. The table holds a handful of
 * rows per exam per year, so returning all of them is one small indexed read.
 */
export async function listExamCalendar(): Promise<ExamCalendarEntry[]> {
  const { data, error } = await supabase()
    .from("exam_calendar")
    .select("exam_code, exam_stage, title_i18n, exam_date, year, is_tentative, notes_i18n")
    .order("exam_date", { ascending: true });
  if (error) throw new HttpError(500, `exam calendar lookup failed: ${error.message}`);
  return (data ?? []) as ExamCalendarEntry[];
}

interface NodeRow {
  id: string;
  exam_code: string;
  paper_code: string;
  depth: number;
  path: string;
  order_index: number;
  title_i18n: { hi: string; en: string };
}

/**
 * Depth-1 section weightage for one or more papers.
 *
 * ⚑ BOTH READS ARE PAGED, and that is not defensive boilerplate — an unpaged
 * `.select()` on `mv_node_weightage` returns exactly 1000 rows (PostgREST's cap)
 * against 1,829 real ones, and every percentage computed from it would be wrong
 * while looking entirely plausible. This bit the first draft of the probe that
 * produced §2c's figures; it is the repo's most-repeated defect class.
 *
 * The roll-up is by materialized PATH, not by parent chain: a section owns every
 * node whose path is its own or is prefixed by `<path>/`. That mirrors what
 * `getPaperTrends` does for the in-app Trends view, so the public number and the
 * signed-in number are the same number.
 *
 * `share_pct` is rounded here rather than at each call site, so a page, an OG
 * card and a future API consumer cannot disagree in the first decimal.
 */
export async function getPaperWeightage(paperCodes: string[]): Promise<PaperWeightage[]> {
  if (paperCodes.length === 0) return [];

  const [nodes, weightRows] = await Promise.all([
    selectAll<NodeRow>(() =>
      supabase()
        .from("syllabus_nodes")
        .select("id, exam_code, paper_code, depth, path, order_index, title_i18n")
        .in("paper_code", paperCodes)
        .order("paper_code")
        .order("depth")
        .order("order_index"),
    ),
    selectAll<{ node_id: string; year: number; q_count: number }>(() =>
      supabase().from("mv_node_weightage").select("node_id, year, q_count").order("node_id"),
    ),
  ]);

  const byNode = new Map<string, Map<number, number>>();
  for (const r of weightRows) {
    const years = byNode.get(r.node_id) ?? new Map<number, number>();
    years.set(r.year, (years.get(r.year) ?? 0) + r.q_count);
    byNode.set(r.node_id, years);
  }

  const out: PaperWeightage[] = [];
  for (const paperCode of paperCodes) {
    const paperNodes = nodes.filter((n) => n.paper_code === paperCode);
    if (paperNodes.length === 0) continue;

    const sections: WeightageSection[] = [];
    const paperYears = new Set<number>();
    let total = 0;

    for (const section of paperNodes.filter((n) => n.depth === 1)) {
      const subtree = paperNodes.filter((n) => n.path === section.path || n.path.startsWith(`${section.path}/`));
      const byYear: Record<string, number> = {};
      let sectionTotal = 0;
      for (const node of subtree) {
        for (const [year, count] of byNode.get(node.id) ?? []) {
          byYear[String(year)] = (byYear[String(year)] ?? 0) + count;
          sectionTotal += count;
          paperYears.add(year);
        }
      }
      total += sectionTotal;
      sections.push({
        node_id: section.id,
        title_i18n: section.title_i18n,
        total: sectionTotal,
        by_year: byYear,
        share_pct: 0, // filled below, once the denominator is known
      });
    }

    for (const s of sections) s.share_pct = total ? Math.round((s.total / total) * 1000) / 10 : 0;
    // Descending by count, then by title so a tie is stable rather than
    // dependent on whatever order the node read came back in.
    sections.sort((a, b) => b.total - a.total || a.title_i18n.en.localeCompare(b.title_i18n.en));

    out.push({
      paper_code: paperCode,
      exam_code: paperNodes[0].exam_code as PaperWeightage["exam_code"],
      total_questions: total,
      years: [...paperYears].sort((a, b) => a - b),
      sections,
    });
  }
  return out;
}
