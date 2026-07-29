/**
 * Nightly top-up planner. For every top-level (depth-1) syllabus node, ensure a
 * minimum published-and-approved coverage across the node's subtree — and
 * generate ONLY the shortfall. Runs through the Message-Batches path
 * (generateBatch) for the 50% discount, bounded by QGEN_BATCH_MAX_USD.
 *
 * The per-node floor is WEIGHTAGE-SCALED, not flat: it scales with how often
 * UPPSC actually asks that topic (recency-weighted `hotness` from
 * mv_node_weightage), within a sane [min..max] band. So a high-frequency section
 * (History, Polity) carries a higher minimum than a rarely-asked one (a niche
 * CSAT sub-skill), instead of a blunt "40 of everything". A flat floor's failure
 * mode only shows WHEN it fires (a content purge/re-gate drops a section below
 * floor, or a brand-new syllabus node starts at zero): flat-40 would then over-
 * generate low-value topics and under-provision key ones. A weightage floor is
 * self-damping on a mature bank — high-weight topics are exactly the ones already
 * richest in real PYQs — so at today's bank size it generates 0; its value is
 * doing the RIGHT thing the next time the floor actually fires.
 */
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { estimateCostUsd, MODELS } from "../lib/models.js";
import { BATCH_DISCOUNT } from "../lib/anthropic.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear } from "../lib/weightage.js";
import { loadNodeContext, generateBatch, type GeneratePlan, type NodeGenerationResult } from "./generate.js";
import { loadRecentDemand, onDemandReserveAdditive, ON_DEMAND_WINDOW_DAYS, type DemandRow } from "./on-demand-reserve.js";

/** A weightage-scaled coverage floor: `min` for the least-asked top node, `max` for the busiest. */
export interface FloorBand {
  min: number;
  max: number;
}
/** Prelims MCQ floor band (was a flat 40). */
export const MCQ_FLOOR: FloorBand = { min: 25, max: 80 };
/** Mains descriptive floor band (was a flat 8). */
export const DESCRIPTIVE_FLOOR: FloorBand = { min: 5, max: 20 };
/** Never generate more than this per node in one nightly run (a safety cap on a cold-start deficit). */
const MAX_PER_NODE = 20;

/**
 * A node's coverage floor, scaled linearly by its recency-weighted PYQ hotness
 * relative to the busiest top-level node in the same paper family. hotness=0
 * (never asked) → band.min; the family max → band.max.
 */
function scaledFloor(hot: number, maxHot: number, band: FloorBand): number {
  if (maxHot <= 0) return band.min;
  return Math.round(band.min + (band.max - band.min) * Math.min(1, hot / maxHot));
}

/**
 * Rough per-question cost estimate used only to bound a batch run to
 * QGEN_BATCH_MAX_USD *before* it runs (real cost is measured per generation_batches
 * row afterwards). ~1 generate + 1 critic (sonnet) + 1 verify (haiku) per question,
 * at the batch discount. Deliberately conservative (over-estimates) so we stay
 * under budget.
 */
function estCostPerQuestion(kind: "mcq" | "descriptive"): number {
  const gen = estimateCostUsd(MODELS.sonnet, 2500, 900);
  const critic = estimateCostUsd(MODELS.sonnet, 900, 250);
  const verify = kind === "mcq" ? estimateCostUsd(MODELS.haiku, 350, 60) : 0;
  return (gen + critic + verify) * BATCH_DISCOUNT;
}

interface NodeRow {
  id: string;
  path: string;
  depth: number;
  paper_code: string;
  title_i18n: unknown;
}

/**
 * The full target for one depth-1 node: baseline weightage floor PLUS the
 * additive on-demand reserve, versus what's already published+approved.
 */
export interface NodeTarget {
  node: NodeRow;
  have: number;
  hot: number;
  baseFloor: number;
  /** Additive reserve driven by recent "Show me a new set" demand (0 if none). */
  reserve: number;
  /** baseFloor + reserve. */
  target: number;
  /** Recent request-days attributed to this node (fractional for mock demand). */
  demand: number;
}

/**
 * Per-node coverage targets for one paper-family + question type: the baseline
 * weightage-scaled floor, plus a SEPARATE additive on-demand reserve attributed
 * from recent `on_demand_requests`. Used both to plan shortfalls (below) and,
 * via reserveTargetsFor, to inspect targets without generating.
 */
async function computeNodeTargets(
  paperLike: string,
  kind: "mcq" | "descriptive",
  band: FloorBand,
  demand: DemandRow[],
  log: (msg: string) => void,
  examCode: string = DEFAULT_EXAM_CODE,
): Promise<NodeTarget[]> {
  // All nodes for the matching papers, in this exam.
  //
  // The `like 'PRE_%'` pattern is only UPPSC-specific by CONVENTION — the paper-
  // code invariant (docs/multi-exam.md §0) mandates an exam prefix for a second
  // exam, so `UPSC_PRE_GS1` would not match `PRE_%`. That is a convention doing
  // load-bearing work; the explicit exam filter makes it structural instead, and
  // keeps working if a future exam's codes ever break the prefix habit.
  const { data: nodes, error: nodesErr } = await supabase()
    .from("syllabus_nodes")
    .select("id, path, depth, paper_code, title_i18n")
    .eq("exam_code", examCode)
    .like("paper_code", paperLike);
  if (nodesErr) throw new Error(`syllabus nodes query failed: ${nodesErr.message}`);
  const rows = (nodes ?? []) as NodeRow[];

  // Published+approved question counts by syllabus_node_id, for these papers.
  // Paginate (selectAll + stable order): PRE_% published+approved MCQs exceed
  // 1000, so a single select silently truncates the count and UNDER-reports
  // coverage — which fires the floor spuriously and would generate questions
  // that already exist. (This bit the old flat floor too, causing real nightly
  // over-generation on CSAT; it is not new to the weightage change.)
  const qs = await selectAll<{ syllabus_node_id: string }>(() =>
    supabase()
      .from("questions")
      .select("syllabus_node_id")
      .like("paper_code", paperLike)
      .eq("type", kind)
      .eq("is_published", true)
      .eq("review_state", "approved")
      .not("syllabus_node_id", "is", null)
      .order("id", { ascending: true }),
  );
  const countByNode = new Map<string, number>();
  for (const q of qs) countByNode.set(q.syllabus_node_id, (countByNode.get(q.syllabus_node_id) ?? 0) + 1);

  // Recency-weighted PYQ frequency (hotness) per node, rolled up through each
  // depth-1 subtree exactly like `have` — the same signal the /learn weightage
  // bars use. Own-node counts from the cached matview; combined across exams.
  const weightage = await loadNodeWeightage();
  const currentYear = currentExamYear();

  const subtreeOf = (node: NodeRow) =>
    rows.filter((n) => n.paper_code === node.paper_code && (n.path === node.path || n.path.startsWith(`${node.path}/`)));

  // First pass: subtree `have` + rolled-up hotness per top-level node, so the
  // band can be scaled against the family's busiest topic.
  const tops = rows.filter((n) => n.depth === 1);
  const info = tops.map((node) => {
    const subtree = subtreeOf(node);
    const have = subtree.reduce((sum, n) => sum + (countByNode.get(n.id) ?? 0), 0);
    const byYear = new Map<number, number>();
    for (const n of subtree) {
      const w = weightage.get(n.id);
      if (!w) continue;
      for (const [y, c] of w.byYear) byYear.set(y, (byYear.get(y) ?? 0) + c);
    }
    return { node, have, hot: hotnessRaw(byYear, currentYear) };
  });
  const maxHot = Math.max(0, ...info.map((i) => i.hot));
  log(
    `${paperLike} ${kind}: weightage-scaled floor band [${band.min}..${band.max}], ` +
      `maxHotness=${maxHot.toFixed(1)} over ${tops.length} top-level nodes`,
  );

  // Attribute each recent on-demand request to a depth-1 node's reserve:
  //  - a custom request on any node → its depth-1 ancestor (path first segment)
  //  - a mock request on the paper's depth-0 root → distributed across that
  //    paper's depth-1 sections by hotness share (so whole-paper mock demand
  //    concentrates fresh generation where the paper is heaviest, matching where
  //    a mock actually draws), or equally if the paper has no hotness yet.
  // A demand row whose node isn't in this paper family (or was deleted) is
  // skipped — the MCQ pass only sees PRE_% demand, descriptive only MAINS_%.
  const nodeById = new Map(rows.map((n) => [n.id, n]));
  const topsByPaper = new Map<string, typeof info>();
  for (const i of info) (topsByPaper.get(i.node.paper_code) ?? topsByPaper.set(i.node.paper_code, []).get(i.node.paper_code)!).push(i);
  const topByPathKey = new Map<string, NodeRow>(); // `${paper}::${firstSegment}` → depth-1 node
  for (const i of info) topByPathKey.set(`${i.node.paper_code}::${i.node.path}`, i.node);

  const demandByTop = new Map<string, number>();
  const addDemand = (topId: string, amount: number) => demandByTop.set(topId, (demandByTop.get(topId) ?? 0) + amount);
  for (const d of demand) {
    const node = nodeById.get(d.node_id);
    if (!node) continue;
    if (node.depth === 0) {
      const paperTops = topsByPaper.get(node.paper_code) ?? [];
      if (paperTops.length === 0) continue;
      const totalHot = paperTops.reduce((s, t) => s + t.hot, 0);
      for (const t of paperTops) addDemand(t.node.id, totalHot > 0 ? t.hot / totalHot : 1 / paperTops.length);
    } else {
      const top = topByPathKey.get(`${node.paper_code}::${node.path.split("/")[0]}`);
      if (top) addDemand(top.id, 1);
    }
  }

  return info.map(({ node, have, hot }) => {
    const baseFloor = scaledFloor(hot, maxHot, band);
    const d = demandByTop.get(node.id) ?? 0;
    const reserve = onDemandReserveAdditive(baseFloor, d);
    return { node, have, hot, baseFloor, reserve, target: baseFloor + reserve, demand: d };
  });
}

/** Shortfall plans for one paper-family + question type, against the full target (floor + on-demand reserve). */
async function shortfallsFor(
  paperLike: string,
  kind: "mcq" | "descriptive",
  band: FloorBand,
  demand: DemandRow[],
  log: (msg: string) => void,
): Promise<GeneratePlan[]> {
  const targets = await computeNodeTargets(paperLike, kind, band, demand, log);
  const plans: GeneratePlan[] = [];
  for (const t of targets) {
    const shortfall = Math.min(MAX_PER_NODE, Math.max(0, t.target - t.have));
    if (shortfall > 0) {
      // Audit line — only fires when a node is genuinely below its target (a
      // purge/re-gate/new node, or a fresh on-demand reserve to stock). Keeps a
      // nightly trail of what got generated and why.
      log(
        `  ↳ "${(t.node.title_i18n as { en: string }).en}": floor=${t.baseFloor}` +
          `${t.reserve > 0 ? `+${t.reserve} on-demand reserve` : ""} target=${t.target} have=${t.have} ` +
          `(hotness=${t.hot.toFixed(1)}, demand=${t.demand.toFixed(1)}) → generate ${shortfall}`,
      );
      plans.push({ node: await loadNodeContext(t.node.id), count: shortfall, kind });
    }
  }
  return plans;
}

/**
 * Inspect per-node targets (baseline floor + on-demand reserve) WITHOUT
 * generating — used by the on-demand reserve verification/reporting so the
 * reserve target and its decay can be observed for any node, not only nodes that
 * happen to be in shortfall.
 */
export async function reserveTargetsFor(
  paperLike: string,
  kind: "mcq" | "descriptive",
  band: FloorBand,
): Promise<NodeTarget[]> {
  const demand = await loadRecentDemand();
  return computeNodeTargets(paperLike, kind, band, demand, () => {});
}

export interface TopupResult {
  planned: number;
  requested: number;
  dropped: number;
  results: NodeGenerationResult[];
}

/**
 * Compute shortfalls, trim to the cost budget, and run the batch. `only` limits
 * to one kind ('mcq' | 'descriptive'); omit for both.
 */
export async function runTopup(
  opts: { maxUsd: number; only?: "mcq" | "descriptive"; dryRun?: boolean },
  log: (msg: string) => void = () => {},
): Promise<TopupResult> {
  // Load the rolling demand window once and reuse it across both passes — the
  // additive reserve it drives is 0 for every node when there's no demand, so a
  // demand-free system generates exactly as it did before this feature.
  const demand = await loadRecentDemand();
  log(`On-demand demand: ${demand.length} request-day(s) in the last ${ON_DEMAND_WINDOW_DAYS} days.`);

  const plans: GeneratePlan[] = [];
  if (opts.only !== "descriptive") plans.push(...(await shortfallsFor("PRE_%", "mcq", MCQ_FLOOR, demand, log)));
  if (opts.only !== "mcq") plans.push(...(await shortfallsFor("MAINS_%", "descriptive", DESCRIPTIVE_FLOOR, demand, log)));

  const totalRequested = plans.reduce((s, p) => s + p.count, 0);
  log(`Shortfall: ${plans.length} nodes need generation (${totalRequested} questions total).`);

  // Trim to budget: keep whole node plans (smallest shortfalls first) until the
  // estimated cost would exceed the cap. Log what was dropped — never silently.
  const budget = opts.maxUsd;
  const kept: GeneratePlan[] = [];
  let spent = 0;
  for (const plan of [...plans].sort((a, b) => a.count - b.count)) {
    const est = plan.count * estCostPerQuestion(plan.kind);
    if (spent + est > budget) continue;
    spent += est;
    kept.push(plan);
  }
  const dropped = plans.length - kept.length;
  if (dropped > 0) {
    log(`Budget $${budget.toFixed(2)} (est. per-q ~$${estCostPerQuestion("mcq").toFixed(4)} mcq): running ${kept.length} nodes, DEFERRING ${dropped} to a later run.`);
  }
  const requested = kept.reduce((s, p) => s + p.count, 0);

  if (opts.dryRun) {
    for (const p of kept) log(`  would generate ${p.count} ${p.kind} for "${(p.node.title_i18n as { en: string }).en}"`);
    return { planned: plans.length, requested, dropped, results: [] };
  }

  const results = kept.length ? await generateBatch(kept, log) : [];
  return { planned: plans.length, requested, dropped, results };
}
