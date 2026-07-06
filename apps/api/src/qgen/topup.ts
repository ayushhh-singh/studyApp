/**
 * Nightly top-up planner. For every top-level (depth-1) syllabus node, ensure a
 * minimum published-and-approved coverage — >= MIN_MCQ MCQs (prelims papers)
 * and >= MIN_DESCRIPTIVE descriptive questions (mains papers) across the node's
 * subtree — and generate ONLY the shortfall. Runs through the Message-Batches
 * path (generateBatch) for the 50% discount, bounded by QGEN_BATCH_MAX_USD.
 */
import { supabase } from "../lib/supabase.js";
import { estimateCostUsd, MODELS } from "../lib/models.js";
import { BATCH_DISCOUNT } from "../lib/anthropic.js";
import { loadNodeContext, generateBatch, type GeneratePlan, type NodeGenerationResult } from "./generate.js";

export const MIN_MCQ = 40;
export const MIN_DESCRIPTIVE = 8;
/** Never generate more than this per node in one nightly run (a safety cap on a cold-start deficit). */
const MAX_PER_NODE = 20;

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

/** Shortfall plans for one paper-family + question type. */
async function shortfallsFor(paperLike: string, kind: "mcq" | "descriptive", min: number): Promise<GeneratePlan[]> {
  // All nodes for the matching papers.
  const { data: nodes, error: nodesErr } = await supabase()
    .from("syllabus_nodes")
    .select("id, path, depth, paper_code, title_i18n")
    .like("paper_code", paperLike);
  if (nodesErr) throw new Error(`syllabus nodes query failed: ${nodesErr.message}`);
  const rows = (nodes ?? []) as NodeRow[];

  // Published+approved question counts by syllabus_node_id, for these papers.
  const { data: qs, error: qErr } = await supabase()
    .from("questions")
    .select("syllabus_node_id")
    .like("paper_code", paperLike)
    .eq("type", kind)
    .eq("is_published", true)
    .eq("review_state", "approved")
    .not("syllabus_node_id", "is", null);
  if (qErr) throw new Error(`question count query failed: ${qErr.message}`);
  const countByNode = new Map<string, number>();
  for (const q of qs ?? []) {
    const id = (q as { syllabus_node_id: string }).syllabus_node_id;
    countByNode.set(id, (countByNode.get(id) ?? 0) + 1);
  }

  const plans: GeneratePlan[] = [];
  for (const node of rows.filter((n) => n.depth === 1)) {
    // Subtree = this node + any node whose materialized path is under it.
    const subtree = rows.filter(
      (n) => n.paper_code === node.paper_code && (n.path === node.path || n.path.startsWith(`${node.path}/`)),
    );
    const have = subtree.reduce((sum, n) => sum + (countByNode.get(n.id) ?? 0), 0);
    const shortfall = Math.min(MAX_PER_NODE, Math.max(0, min - have));
    if (shortfall > 0) {
      plans.push({ node: await loadNodeContext(node.id), count: shortfall, kind });
    }
  }
  return plans;
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
  const plans: GeneratePlan[] = [];
  if (opts.only !== "descriptive") plans.push(...(await shortfallsFor("PRE_%", "mcq", MIN_MCQ)));
  if (opts.only !== "mcq") plans.push(...(await shortfallsFor("MAINS_%", "descriptive", MIN_DESCRIPTIVE)));

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
