/**
 * Nightly top-up planner. For every top-level (depth-1) syllabus node, ensure a
 * minimum published-and-approved coverage across the node's subtree — and
 * generate ONLY the shortfall. Runs through the Message-Batches path
 * (generateBatch) for the 50% discount, bounded by QGEN_BATCH_MAX_USD.
 *
 * MULTI-EXAM: the planner runs once PER EXAM (every live exam by default, or one
 * `--exam` override), but the cost budget is applied ONCE across the combined
 * plan set — see `runTopup`. Both the paper set and the coverage counts are
 * derived from the exam registry rather than pattern-matched; see
 * `paperCodesForStage`.
 *
 * TWO INDEPENDENT FLOORS RUN EACH NIGHT, measuring two different quantities.
 * Both are weightage-scaled, both feed one plan list, and both are bounded by the
 * single shared budget cap.
 *
 *  1. COVERAGE (`MCQ_FLOOR` / `DESCRIPTIVE_FLOOR`, per depth-1 SECTION, counts
 *     every published+approved question). "Does this section have enough
 *     questions at all?" A cold-start / content-purge safety net. Weightage-
 *     scaled rather than flat so a high-frequency section (History, Polity)
 *     carries a higher minimum than a niche CSAT sub-skill, instead of a blunt
 *     "40 of everything" that would over-generate low-value topics and under-
 *     provision key ones when it does fire.
 *
 *  2. FRESH SUPPLY (`FRESH_MCQ_FLOOR` / `FRESH_DESCRIPTIVE_FLOOR`, per LEAF
 *     topic, counts GENERATED questions only). "Does this topic have anything
 *     new to practise on?" Read `FRESH_MCQ_FLOOR`'s note before changing either
 *     band: floor (1) is self-damping on a mature bank — its `have` and its floor
 *     are monotone functions of the same PYQ frequency, with `have` rising ~2x
 *     faster — so it is not merely inert but ANTI-CORRELATED with need, and
 *     measured 2026-08-13 it fired on 1 of 110 nodes. Floor (2) exists because
 *     that is a real product gap, not a tuning problem: a topic can hold 189 real
 *     PYQs, satisfy floor (1) several times over, and still offer a student who
 *     has worked the PYQ archive nothing they have not already seen.
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { estimateCostUsd, MODELS } from "../lib/models.js";
import { BATCH_DISCOUNT } from "../lib/anthropic.js";
import { getExamConfig, requireAuthored } from "../lib/exam-config.js";
import { mainsPaperCodesFor } from "../ca/exam-fanout.js";
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

/**
 * ⚑ THE FRESH-SUPPLY FLOOR — why a SECOND floor exists rather than a bigger first one.
 *
 * The coverage floor above asks "does this section have enough questions?" and
 * counts every published+approved question, which on a mature bank is dominated
 * by real PYQs. Both sides of that comparison are then monotone functions of the
 * SAME quantity — `have` rises with how often the commission asks a topic, and
 * `scaledFloor` rises with the recency-weighted count of those same asks — but
 * `have` rises far faster. MEASURED 2026-08-13 across both live exams: the
 * have/floor ratio is 1.75 at the 25th hotness percentile and 3.65 at the 100th,
 * i.e. the floor is furthest from binding exactly where the commission asks
 * most, and **1 of 110 depth-1 nodes was in shortfall**. So the coverage floor is
 * not merely inert (its own docblock says so) — it is ANTI-CORRELATED with need,
 * and no change to its band can fix that, because widening the band raises the
 * floor on the busy nodes and the thin ones together.
 *
 * The quantity a student actually experiences is different: real PYQs are the
 * questions they have already worked through in the PYQ archive, so a topic with
 * 189 real PYQs and zero generated ones offers them nothing NEW to practise on.
 * That is the reported symptom — no generated question had ever appeared on
 * high-yield topics like History or the Economy — and it is why this floor
 * measures GENERATED supply only. It is a floor, not a rate: once a node reaches
 * it, it stops, so this cannot become an unbounded generator.
 *
 * Evaluated at LEAF granularity (a node with no children), not depth-1, for two
 * reasons. It is the grain a student browses, so "Ancient India" gets its own
 * supply instead of being averaged into "History of India and Indian National
 * Movement"; and it is the grain the real PYQ corpus is attached to, so
 * `loadFewShot` conditions the generation on that leaf's OWN past questions
 * rather than a paper-wide pool (see its docblock — the two defects are the same
 * depth-1-vs-depth-2 mismatch seen from opposite sides).
 *
 * The bands are much smaller than the coverage bands because they are per-LEAF,
 * not per-section. Sized against the real tree: ~980 questions across both exams
 * to satisfy from cold, which the existing shared $5 cap drains over ~3 nights.
 * `have` deliberately counts ANY generated question on the leaf, current-affairs
 * MCQs included — those are genuinely fresh practice the student can see, so
 * topping up past them would be waste.
 */
export const FRESH_MCQ_FLOOR: FloorBand = { min: 3, max: 12 };
/** Mains descriptive fresh-supply floor, per leaf. See `FRESH_MCQ_FLOOR`. */
export const FRESH_DESCRIPTIVE_FLOOR: FloorBand = { min: 2, max: 6 };

/** Never generate more than this per node in one nightly run (a safety cap on a cold-start deficit). */
const MAX_PER_NODE = 20;

/** The two passes this planner makes, named by exam stage rather than by a paper-code pattern. */
export type TopupStage = "prelims" | "mains";

/**
 * The paper codes one exam's stage covers.
 *
 * ⚑ REPLACES `like 'PRE_%'` / `like 'MAINS_%'`, which were not near-misses: they
 * match ZERO paper codes for any non-default exam, because M23 mandates an exam
 * prefix (`UPSC_PRE_GS1`, `UPSC_MAINS_GS1`) and the prefix sits in FRONT of the
 * pattern. A second exam therefore planned 0 nodes, silently — no error, no log,
 * just an empty result that reads exactly like "nothing is below floor".
 *
 * MAINS reuses `ca/exam-fanout.ts`'s `mainsPaperCodesFor` rather than rebuilding
 * the set here: that function already assembles `mainsGs + essay + generalHindi`
 * from the same registry, is cached, and is the module a future mains paper kind
 * would be added to. A local copy would be a second thing to remember.
 *
 * PRELIMS is derived here and NOT from that module's `prelimsPaperCodeFor`,
 * which returns the prelims GS paper ONLY — deliberately, because CSAT topics
 * are aptitude skills and never a current-affairs subject. That reasoning is
 * specific to CA triage and is WRONG here: `PRE_%` matched `PRE_CSAT` too, qgen
 * genuinely generates CSAT questions, and this file's own comments cite CSAT
 * over-generation as a real past incident. Reusing it would have silently
 * dropped CSAT from the LIVE exam's nightly top-up — a regression, not a tidy-up.
 *
 * Returns `[]` for an exam whose syllabus is not ingested (every `papers` entry
 * is null, e.g. `mppsc`); callers must treat that as "nothing to plan", never as
 * "everything is covered".
 */
export function paperCodesForStage(examCode: string, stage: TopupStage): string[] {
  if (stage === "mains") return [...mainsPaperCodesFor(examCode)];
  const { prelimsGs, prelimsCsat } = getExamConfig(examCode).papers;
  return [prelimsGs, prelimsCsat].filter((c): c is string => !!c);
}

/**
 * Drop papers whose syllabus nodes are ASSESSMENT DIMENSIONS rather than topics.
 *
 * A per-node coverage floor asks "does this node have enough questions?", which
 * presupposes the node is a topic. On a paper whose syllabus names only the
 * criteria an answer is marked on, that quantity does not exist — so the floor
 * fires on an arbitrary number and the critic's in-syllabus check cannot fail.
 * See `ExamQgenConfig.skillDimensionPapers` for the measured case that produced
 * this (21 of 28 generated upsc descriptive rows).
 *
 * Never silent: an excluded paper is LOGGED, because "excluded by policy" and
 * "above floor" are indistinguishable in the output otherwise — the same
 * confusion `paperCodesForStage`'s own empty-list log exists to prevent.
 */
function withoutSkillDimensionPapers(
  examCode: string,
  paperCodes: string[],
  log: (msg: string) => void,
): string[] {
  // Nothing to filter means nothing to decide, so do not demand the decision.
  // An exam with no ingested syllabus (mppsc) reaches here with an empty list and
  // must keep falling through to the caller's "no paper codes registered" log —
  // `--exam mppsc` is an allowed, notice-logged invocation (`resolveTargetExams`),
  // and requiring authorship first turned that graceful skip into a crash. The U6
  // gate still fires the moment such an exam actually HAS papers to plan for,
  // which is the only point at which the answer matters.
  if (paperCodes.length === 0) return paperCodes;
  const skill = new Set(
    requireAuthored(getExamConfig(examCode).qgen.skillDimensionPapers, examCode, "qgen.skillDimensionPapers"),
  );
  if (skill.size === 0) return paperCodes;
  const kept = paperCodes.filter((c) => !skill.has(c));
  const dropped = paperCodes.filter((c) => skill.has(c));
  if (dropped.length > 0) {
    log(
      `${examCode}: skipping ${dropped.join(", ")} — its syllabus nodes are assessment dimensions, ` +
        `not topics, so a per-node coverage floor does not apply (qgen.skillDimensionPapers).`,
    );
  }
  return kept;
}

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
async function computeNodeTargets(opts: {
  /** REQUIRED — never defaulted. A defaulted exam is how this pipeline stayed pinned to uppsc (M24). */
  examCode: string;
  stage: TopupStage;
  kind: "mcq" | "descriptive";
  band: FloorBand;
  demand: DemandRow[];
  log: (msg: string) => void;
}): Promise<NodeTarget[]> {
  const { examCode, stage, kind, band, demand, log } = opts;
  const paperCodes = withoutSkillDimensionPapers(examCode, paperCodesForStage(examCode, stage), log);
  if (paperCodes.length === 0) {
    // An exam with no ingested syllabus for this stage. Say so — an empty plan
    // and "everything is above floor" are indistinguishable in the output
    // otherwise, which is exactly how the `PRE_%` bug hid.
    log(`${examCode} ${stage} ${kind}: no ${stage} paper codes registered — skipping (syllabus not ingested?).`);
    return [];
  }

  // All nodes for this exam's papers at this stage.
  //
  // Paginated for the same reason the question count below is: a mains family is
  // already ~250 nodes for uppsc and grows with every exam ingested, and a
  // truncated node list silently drops depth-1 sections (never planned at all)
  // AND their descendants (under-counting `have`, firing the floor spuriously).
  const rows = await selectAll<NodeRow>(() =>
    supabase()
      .from("syllabus_nodes")
      .select("id, path, depth, paper_code, title_i18n")
      .eq("exam_code", examCode)
      .in("paper_code", paperCodes)
      .order("id", { ascending: true }),
  );

  // Published+approved question counts by syllabus_node_id, for these papers.
  //
  // Scoped by PAPER CODE, not by `questions.exam_code`: that column is
  // PROVENANCE ("which exam asked this"), and its domain deliberately includes
  // exams we ingest PYQs from but never sell (up_ro_aro, upsssc_pet) whose
  // papers are mapped onto the default exam's tree on purpose. Filtering on it
  // would drop those from the coverage count and generate questions that already
  // exist. Paper codes are globally unique across exams (docs/multi-exam.md §0),
  // so `.in(...)` identifies the owning exam unambiguously. (`paperCodes` is at
  // most ~8 short identifiers, far under any URL-length limit — no chunking.)
  //
  // Paginate (selectAll + stable order): published+approved prelims MCQs exceed
  // 1000, so a single select silently truncates the count and UNDER-reports
  // coverage — which fires the floor spuriously and would generate questions
  // that already exist. (This bit the old flat floor too, causing real nightly
  // over-generation on CSAT; it is not new to the weightage change.)
  const qs = await selectAll<{ syllabus_node_id: string }>(() =>
    supabase()
      .from("questions")
      .select("syllabus_node_id")
      .in("paper_code", paperCodes)
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
    `${examCode} ${stage} ${kind} (${paperCodes.join(", ")}): weightage-scaled floor band ` +
      `[${band.min}..${band.max}], maxHotness=${maxHot.toFixed(1)} over ${tops.length} top-level nodes`,
  );

  // Attribute each recent on-demand request to a depth-1 node's reserve:
  //  - a custom request on any node → its depth-1 ancestor (path first segment)
  //  - a mock request on the paper's depth-0 root → distributed across that
  //    paper's depth-1 sections by hotness share (so whole-paper mock demand
  //    concentrates fresh generation where the paper is heaviest, matching where
  //    a mock actually draws), or equally if the paper has no hotness yet.
  // A demand row whose node isn't in this paper family (or was deleted) is
  // skipped — the prelims pass only sees prelims demand, mains only mains. That
  // same `nodeById` lookup is what scopes the (exam-agnostic) demand log to THIS
  // exam: `rows` holds only this exam's nodes, so another exam's demand rows are
  // dropped here rather than needing a filter of their own.
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

/** Shortfall plans for one exam + stage + question type, against the full target (floor + on-demand reserve). */
async function shortfallsFor(opts: {
  examCode: string;
  stage: TopupStage;
  kind: "mcq" | "descriptive";
  band: FloorBand;
  demand: DemandRow[];
  log: (msg: string) => void;
}): Promise<GeneratePlan[]> {
  const { kind, log } = opts;
  const targets = await computeNodeTargets(opts);
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

/** One leaf's fresh-supply position: how many GENERATED questions it has vs its weightage-scaled floor. */
export interface FreshTarget {
  node: NodeRow;
  /** Generated (published+approved) questions on this leaf — real PYQs deliberately excluded. */
  haveGenerated: number;
  hot: number;
  floor: number;
}

/**
 * Per-LEAF fresh-supply targets for one exam + stage + question type. See
 * `FRESH_MCQ_FLOOR` for why this measures generated supply rather than total
 * coverage, and why it runs at leaf rather than section granularity.
 *
 * Exported so the position can be inspected without generating — the same
 * reason `reserveTargetsFor` exists, and what the post-fix coverage verification
 * reads.
 */
export async function freshTargetsFor(opts: {
  /** REQUIRED — never defaulted, for the same reason as `computeNodeTargets` (M24). */
  examCode: string;
  stage: TopupStage;
  kind: "mcq" | "descriptive";
  band: FloorBand;
  log?: (msg: string) => void;
}): Promise<FreshTarget[]> {
  const { examCode, stage, kind, band } = opts;
  const log = opts.log ?? (() => {});
  const paperCodes = withoutSkillDimensionPapers(examCode, paperCodesForStage(examCode, stage), log);
  if (paperCodes.length === 0) return [];

  // Paged for the same reason every other read here is: a truncated node list
  // silently drops leaves, which reads exactly like "already covered".
  const rows = await selectAll<NodeRow & { parent_id: string | null }>(() =>
    supabase()
      .from("syllabus_nodes")
      .select("id, path, depth, paper_code, title_i18n, parent_id")
      .eq("exam_code", examCode)
      .in("paper_code", paperCodes)
      .order("id", { ascending: true }),
  );

  // Generated supply per node. Scoped by the node set rather than by paper code,
  // because a current-affairs MCQ is stamped `paper_code = CURRENT_AFFAIRS` while
  // hanging off a real syllabus node — it is still fresh practice on that leaf,
  // so a paper-code filter here would under-count it and over-generate.
  const nodeIds = new Set(rows.map((r) => r.id));
  const generated = await selectAll<{ syllabus_node_id: string }>(() =>
    supabase()
      .from("questions")
      .select("syllabus_node_id")
      .eq("exam_code", examCode)
      .eq("type", kind)
      .eq("source", "generated")
      .eq("is_published", true)
      .eq("review_state", "approved")
      .not("syllabus_node_id", "is", null)
      .order("id", { ascending: true }),
  );
  const genByNode = new Map<string, number>();
  for (const q of generated) {
    if (!nodeIds.has(q.syllabus_node_id)) continue;
    genByNode.set(q.syllabus_node_id, (genByNode.get(q.syllabus_node_id) ?? 0) + 1);
  }

  const hasChild = new Set(rows.map((r) => r.parent_id).filter((p): p is string => !!p));
  // A leaf is a real topic; depth 0 is the paper root, which is not one.
  const leaves = rows.filter((r) => r.depth >= 1 && !hasChild.has(r.id));

  const weightage = await loadNodeWeightage();
  const currentYear = currentExamYear();
  const hotOf = (n: NodeRow) => {
    const w = weightage.get(n.id);
    return w ? hotnessRaw(w.byYear, currentYear) : 0;
  };
  const hots = leaves.map(hotOf);
  const maxHot = Math.max(0, ...hots);
  log(
    `${examCode} ${stage} ${kind} fresh-supply: ${leaves.length} leaf topic(s), band [${band.min}..${band.max}], ` +
      `maxHotness=${maxHot.toFixed(1)}`,
  );

  return leaves.map((node, i) => ({
    node,
    haveGenerated: genByNode.get(node.id) ?? 0,
    hot: hots[i],
    floor: scaledFloor(hots[i], maxHot, band),
  }));
}

/** Fresh-supply shortfall plans for one exam + stage + type. */
async function freshShortfallsFor(opts: {
  examCode: string;
  stage: TopupStage;
  kind: "mcq" | "descriptive";
  band: FloorBand;
  log: (msg: string) => void;
}): Promise<GeneratePlan[]> {
  const { kind, log } = opts;
  const plans: GeneratePlan[] = [];
  for (const t of await freshTargetsFor(opts)) {
    const shortfall = Math.min(MAX_PER_NODE, Math.max(0, t.floor - t.haveGenerated));
    if (shortfall <= 0) continue;
    log(
      `  ↳ fresh "${(t.node.title_i18n as { en: string }).en}": floor=${t.floor} generated=${t.haveGenerated} ` +
        `(hotness=${t.hot.toFixed(1)}) → generate ${shortfall}`,
    );
    plans.push({ node: await loadNodeContext(t.node.id), count: shortfall, kind });
  }
  return plans;
}

/**
 * Merge the coverage and fresh-supply plan lists. A childless depth-1 node is a
 * leaf, so it can legitimately appear in BOTH passes; without this it would be
 * planned twice and generated twice in one night. Takes the larger count, which
 * satisfies whichever floor asked for more and therefore both.
 */
function mergePlans(plans: GeneratePlan[]): GeneratePlan[] {
  const byNode = new Map<string, GeneratePlan>();
  for (const p of plans) {
    const key = `${p.node.id}|${p.kind}`;
    const hit = byNode.get(key);
    if (!hit) byNode.set(key, p);
    else if (p.count > hit.count) byNode.set(key, p);
  }
  return [...byNode.values()];
}

/**
 * Inspect per-node targets (baseline floor + on-demand reserve) WITHOUT
 * generating — used by the on-demand reserve verification/reporting so the
 * reserve target and its decay can be observed for any node, not only nodes that
 * happen to be in shortfall.
 */
export async function reserveTargetsFor(opts: {
  /** REQUIRED — see `computeNodeTargets`. */
  examCode: string;
  stage: TopupStage;
  kind: "mcq" | "descriptive";
  band: FloorBand;
}): Promise<NodeTarget[]> {
  const demand = await loadRecentDemand();
  return computeNodeTargets({ ...opts, demand, log: () => {} });
}

export interface TopupResult {
  planned: number;
  requested: number;
  dropped: number;
  results: NodeGenerationResult[];
}

/** What one shared budget bought: the plans to run, how many were deferred, and the estimate. */
export interface BudgetTrim {
  kept: GeneratePlan[];
  dropped: number;
  estUsd: number;
}

/**
 * Trim a plan list to ONE cost ceiling. Greedy, smallest shortfall first — the
 * most nodes served per dollar.
 *
 * PURE (no DB, no clock, no model), and that is the point: with a shared budget
 * across exams the interesting property is no longer "does it stop at the cap"
 * but "does ONE cap bound the WHOLE run" — and that cannot be demonstrated from
 * live data while only one exam is ever in shortfall. Extracted so the property
 * can be exercised directly over a synthetic two-exam plan list. Behaviour is
 * byte-identical to the loop that used to be inline in `runTopup`.
 *
 * ⚑ THE ORDER IS EXAM-BLIND, DELIBERATELY, and the consequence is worth stating
 * plainly: because plans are taken smallest-first, the nodes that get DEFERRED
 * when the cap binds are the LARGEST deficits, whichever exam they belong to. A
 * cold-start exam (many nodes at `MAX_PER_NODE`) is therefore the one exposed.
 *
 * That is accepted rather than corrected, for three reasons:
 *  1. It is the IDENTITY at one exam, which is the live exam's regression control.
 *  2. It self-drains rather than starving: the floor is static, so once the small
 *     plans are generated they leave the queue, and the large ones move to the
 *     front of a shorter one the next night. Deferral is a delay, not a lockout.
 *  3. Any exam-aware fairness rule (round-robin, per-exam quotas) is a policy
 *     choice, and there is nothing to ground one in — measured today the cap does
 *     not bind at all, with the whole two-exam plan costing well under the $5 cron
 *     ceiling.
 * The risk is made VISIBLE instead: `runTopup` logs the per-exam kept split. If
 * that log ever shows one exam fully served while another is held at zero across
 * successive nights, revisit this ordering — that is the reversal condition.
 */
export function trimToBudget(plans: readonly GeneratePlan[], maxUsd: number): BudgetTrim {
  const kept: GeneratePlan[] = [];
  let spent = 0;
  for (const plan of [...plans].sort((a, b) => a.count - b.count)) {
    const est = plan.count * estCostPerQuestion(plan.kind);
    if (spent + est > maxUsd) continue;
    spent += est;
    kept.push(plan);
  }
  return { kept, dropped: plans.length - kept.length, estUsd: spent };
}

/**
 * Compute shortfalls across every requested exam, trim to ONE shared cost
 * budget, and run the batch. `only` limits to one kind ('mcq' | 'descriptive');
 * omit for both.
 *
 * ⚑ `examCodes` IS REQUIRED, and resolving it is deliberately the CALLER's job
 * (see `qgen/cli.ts`'s `resolveTopupExams`: an explicit `--exam`, else every
 * exam the registry marks live). Defaulting it here would put the exam-selection
 * policy behind a parameter no caller has to think about — the precise shape
 * (M24) that kept this pipeline pinned to uppsc while looking parameterised.
 *
 * ⚑ THE BUDGET CAP IS GLOBAL, NOT PER EXAM. Every exam is PLANNED first (reads
 * only — no spend), the plans are concatenated, and the single existing trim
 * runs once over the combined list. Trimming per exam would silently multiply
 * the nightly ceiling by the number of live exams: the cron passes one
 * QGEN_BATCH_MAX_USD (default $5) and that must remain the whole run's ceiling.
 *
 * The trim order (smallest shortfall first — most nodes served per dollar) is
 * unchanged and therefore EXAM-BLIND, so one exam's plans can in principle
 * consume the whole budget. That is acceptable because deferred nodes simply
 * return the next night, but it is a starvation risk worth being able to SEE,
 * so the per-exam planned/kept split is logged rather than left implicit.
 */
export async function runTopup(
  opts: { maxUsd: number; examCodes: string[]; only?: "mcq" | "descriptive"; dryRun?: boolean },
  log: (msg: string) => void = () => {},
): Promise<TopupResult> {
  // Load the rolling demand window once and reuse it across every pass — the
  // additive reserve it drives is 0 for every node when there's no demand, so a
  // demand-free system generates exactly as it did before this feature. The log
  // is exam-agnostic; each pass keeps only the rows naming its own exam's nodes.
  const demand = await loadRecentDemand();
  log(`On-demand demand: ${demand.length} request-day(s) in the last ${ON_DEMAND_WINDOW_DAYS} days.`);
  log(`Planning for ${opts.examCodes.length} exam(s): ${opts.examCodes.join(", ")}`);

  const plans: GeneratePlan[] = [];
  for (const examCode of opts.examCodes) {
    const before = plans.length;
    if (opts.only !== "descriptive") {
      plans.push(
        ...(await shortfallsFor({ examCode, stage: "prelims", kind: "mcq", band: MCQ_FLOOR, demand, log })),
        // Second, independent guarantee — see `FRESH_MCQ_FLOOR`. Additive: when
        // every leaf is already at its fresh floor this contributes nothing and
        // the run is byte-identical to the coverage-only behaviour.
        ...(await freshShortfallsFor({ examCode, stage: "prelims", kind: "mcq", band: FRESH_MCQ_FLOOR, log })),
      );
    }
    if (opts.only !== "mcq") {
      plans.push(
        ...(await shortfallsFor({
          examCode,
          stage: "mains",
          kind: "descriptive",
          band: DESCRIPTIVE_FLOOR,
          demand,
          log,
        })),
        ...(await freshShortfallsFor({
          examCode,
          stage: "mains",
          kind: "descriptive",
          band: FRESH_DESCRIPTIVE_FLOOR,
          log,
        })),
      );
    }
    const mine = plans.slice(before);
    log(`  ${examCode}: ${mine.length} node(s) in shortfall (${mine.reduce((s, p) => s + p.count, 0)} questions).`);
  }

  // De-duplicate before costing: a childless depth-1 node is a leaf, so the
  // coverage and fresh-supply passes can both name it.
  const merged = mergePlans(plans);
  if (merged.length !== plans.length) {
    log(`  ${plans.length - merged.length} node(s) named by both the coverage and fresh-supply passes — merged.`);
  }
  const totalRequested = merged.reduce((s, p) => s + p.count, 0);
  log(`Shortfall: ${merged.length} nodes need generation (${totalRequested} questions total).`);

  // Trim to budget: ONE ceiling for every exam's plans together (see
  // `trimToBudget`). Log what was dropped — never silently.
  const budget = opts.maxUsd;
  const { kept, dropped } = trimToBudget(merged, budget);
  if (dropped > 0) {
    log(`Budget $${budget.toFixed(2)} (est. per-q ~$${estCostPerQuestion("mcq").toFixed(4)} mcq): running ${kept.length} nodes, DEFERRING ${dropped} to a later run.`);
  }
  const requested = kept.reduce((s, p) => s + p.count, 0);
  // Per-exam split of what actually survived the shared cap — makes an exam
  // being starved by the exam-blind ordering visible in the nightly log.
  if (opts.examCodes.length > 1) {
    const keptBy = new Map<string, { nodes: number; questions: number }>();
    for (const p of kept) {
      const e = keptBy.get(p.node.examCode) ?? { nodes: 0, questions: 0 };
      e.nodes += 1;
      e.questions += p.count;
      keptBy.set(p.node.examCode, e);
    }
    for (const examCode of opts.examCodes) {
      const e = keptBy.get(examCode) ?? { nodes: 0, questions: 0 };
      log(`  after budget — ${examCode}: ${e.nodes} node(s), ${e.questions} question(s).`);
    }
  }

  if (opts.dryRun) {
    for (const p of kept) {
      log(`  would generate ${p.count} ${p.kind} for "${(p.node.title_i18n as { en: string }).en}" (${p.node.examCode})`);
    }
    return { planned: merged.length, requested, dropped, results: [] };
  }

  const results = kept.length ? await generateBatch(kept, log) : [];
  return { planned: merged.length, requested, dropped, results };
}
