/**
 * Five monthly Deep Dives for the Mains Analysis magazine edition — the
 * month's top issues (ranked by mains_relevance + syllabus weightage), each a
 * longer sonnet-synthesized analysis grounded on that issue's own mains_brief
 * + related items from the same month/topic + RAG-retrieved notes/PYQs.
 *
 * Runs via the Message Batches API (50% cheaper) — this is a scheduled
 * monthly job (pnpm ca:deepdive), never a request-handler call. Everything
 * else in both magazine editions is pure assembly from already-published
 * data; only this step spends real synthesis tokens, which is why it alone
 * goes through the Review Queue (magazine_deep_dives.status starts at
 * 'needs_review') before a Mains Analysis edition will show it.
 *
 * Regenerating a month CLEARS that month's existing not-yet-published deep
 * dives first (a re-run never leaves stale/duplicate drafts sitting in
 * review) but never touches ones a reviewer already published.
 */
import { supabase } from "../lib/supabase.js";
import { MODELS, estimateCostUsd } from "../lib/models.js";
import { BATCH_DISCOUNT, runBatch, structuredParams, type BatchRequest, type LlmUsage } from "../lib/anthropic.js";
import { retrieveGrounding } from "../services/evaluation/grounding.js";
import { loadNodeWeightage } from "../lib/weightage.js";
import { monthBounds } from "../lib/month.js";
import { RELEVANCE_GATE } from "./pipeline.js";
import type { CurrentAffairsGsPaper, CurrentAffairsMainsBrief } from "@prayasup/shared";

export const DEEP_DIVE_COUNT = 5;

const bilingual = {
  type: "object",
  additionalProperties: false,
  properties: { hi: { type: "string" }, en: { type: "string" } },
  required: ["hi", "en"],
};
const bilingualList = {
  type: "object",
  additionalProperties: false,
  properties: {
    hi: { type: "array", items: { type: "string" } },
    en: { type: "array", items: { type: "string" } },
  },
  required: ["hi", "en"],
};

interface MainsItemRow {
  id: string;
  date: string;
  title_i18n: { hi: string; en: string };
  mains_relevance: number;
  gs_papers: CurrentAffairsGsPaper[];
  syllabus_node_ids: string[];
  mains_brief: CurrentAffairsMainsBrief;
}

async function loadMainsItems(month: string): Promise<MainsItemRow[]> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("id, date, title_i18n, mains_relevance, gs_papers, syllabus_node_ids, mains_brief")
    .eq("status", "published")
    .gte("mains_relevance", RELEVANCE_GATE)
    .not("mains_brief", "is", null)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });
  if (error) throw new Error(`deep-dive item query failed: ${error.message}`);
  return (data ?? []) as unknown as MainsItemRow[];
}

export interface RankedIssue {
  item: MainsItemRow;
  relatedItems: MainsItemRow[];
  score: number;
}

/** Rank this month's mains-life items by relevance + rolled-up syllabus weightage, and cluster related items. */
export async function rankIssues(month: string): Promise<RankedIssue[]> {
  const items = await loadMainsItems(month);
  if (items.length === 0) return [];

  const weightage = await loadNodeWeightage();
  const nodeWeight = (nodeIds: string[]): number =>
    nodeIds.reduce((sum, id) => sum + (weightage.get(id)?.total ?? 0), 0);

  const scored = items
    .map((item) => ({ item, score: item.mains_relevance * 1000 + nodeWeight(item.syllabus_node_ids) }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, DEEP_DIVE_COUNT);
  return top.map(({ item, score }) => {
    const relatedItems = items
      .filter((other) => other.id !== item.id && other.syllabus_node_ids.some((id) => item.syllabus_node_ids.includes(id)))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 4);
    return { item, relatedItems, score };
  });
}

interface DeepDiveGenerated {
  title_i18n: { hi: string; en: string };
  intro_i18n: { hi: string; en: string };
  synthesis_i18n: { hi: string[]; en: string[] };
  significance_i18n: { hi: string[]; en: string[] };
  challenges_i18n: { hi: string[]; en: string[] };
  way_forward_i18n: { hi: string[]; en: string[] };
  keywords_i18n: { hi: string[]; en: string[] };
  case_examples_i18n: { hi: string[]; en: string[] };
}

const DEEP_DIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title_i18n: bilingual,
    intro_i18n: bilingual,
    synthesis_i18n: bilingualList,
    significance_i18n: bilingualList,
    challenges_i18n: bilingualList,
    way_forward_i18n: bilingualList,
    keywords_i18n: bilingualList,
    case_examples_i18n: bilingualList,
  },
  required: [
    "title_i18n", "intro_i18n", "synthesis_i18n", "significance_i18n",
    "challenges_i18n", "way_forward_i18n", "keywords_i18n", "case_examples_i18n",
  ],
};

const DEEP_DIVE_SYSTEM =
  "You are writing one long-form 'Deep Dive' analysis for a UPPSC Mains current-affairs magazine — the kind of " +
  "synthesis a serious aspirant reads to build an examiner-ready understanding of one issue, well beyond a single " +
  "news brief. Write ENTIRELY IN YOUR OWN WORDS from the material given (never copy source sentences verbatim). " +
  "Produce BOTH Hindi (Devanagari) and English, faithful translations of each other, same structure, same number " +
  "of points in every list field.\n" +
  "- title_i18n: a sharp, examiner-style issue title (not the raw news headline).\n" +
  "- intro_i18n: 2-3 sentences framing why this issue matters for UPPSC Mains right now.\n" +
  "- synthesis_i18n: 4-6 substantial analytical paragraphs (own-words synthesis of the background, the current " +
  "development, and its multiple dimensions — polity/economy/social/environment as relevant) — this is the core " +
  "of the deep dive, go well beyond a single article's worth of analysis using every source given.\n" +
  "- significance_i18n / challenges_i18n / way_forward_i18n: 4-6 crisp bullet points each.\n" +
  "- keywords_i18n: 5-10 value-addition phrases/terms an examiner rewards.\n" +
  "- case_examples_i18n: 2-4 concrete real examples/precedents/data points, if any are grounded in the material " +
  "(empty arrays are fine if none are well-supported — never fabricate a case example).\n" +
  "Ground every factual claim in the material provided; if the material is thin on a dimension, keep that part " +
  "brief rather than inventing detail. Return strict JSON, no markdown.";

function buildContext(issue: RankedIssue, notesText: string, pyqText: string): string {
  const b = issue.item.mains_brief;
  const parts = [
    `PRIMARY ISSUE: ${issue.item.title_i18n.en}`,
    `Why in news: ${b.why_in_news_i18n.en}`,
    `Background: ${b.background_i18n.en}`,
    `Significance: ${b.significance_i18n.en.join("; ")}`,
    `Challenges: ${b.challenges_i18n.en.join("; ")}`,
    `Way forward: ${b.way_forward_i18n.en.join("; ")}`,
    `Value-add keywords: ${b.keywords_i18n.en.join(", ")}`,
  ];
  if (issue.relatedItems.length > 0) {
    parts.push(
      "\nRELATED DEVELOPMENTS THIS MONTH:",
      ...issue.relatedItems.map(
        (r) => `- ${r.title_i18n.en}: ${r.mains_brief.why_in_news_i18n.en}`,
      ),
    );
  }
  if (notesText) parts.push("\nBACKGROUND FROM STUDY NOTES / SYLLABUS:", notesText);
  if (pyqText) parts.push("\nRELATED PAST UPPSC QUESTIONS (for angle, not to answer):", pyqText);
  return parts.join("\n");
}

/** Up to 5 published PYQs across the issue's linked syllabus nodes, for angle/context. */
async function loadRelatedPyqs(nodeIds: string[]): Promise<string> {
  if (nodeIds.length === 0) return "";
  const { data } = await supabase()
    .from("questions")
    .select("stem_i18n")
    .in("syllabus_node_id", nodeIds)
    .eq("is_published", true)
    .limit(5);
  return ((data ?? []) as { stem_i18n: { en?: string } }[])
    .map((q) => q.stem_i18n?.en)
    .filter((s): s is string => !!s?.trim())
    .map((s) => `- ${s}`)
    .join("\n");
}

interface DeepDiveRequest {
  issue: RankedIssue;
  context: string;
  sources: { id: string; title: string; url: string }[];
}

async function buildRequests(issues: RankedIssue[]): Promise<DeepDiveRequest[]> {
  const out: DeepDiveRequest[] = [];
  for (const issue of issues) {
    const primaryNodeId = issue.item.syllabus_node_ids[0] ?? null;
    const [grounding, pyqText] = await Promise.all([
      retrieveGrounding({
        questionText: `${issue.item.title_i18n.en} ${issue.item.mains_brief.why_in_news_i18n.en}`,
        locale: "en",
        syllabusNodeId: primaryNodeId,
        k: 6,
      }),
      loadRelatedPyqs(issue.item.syllabus_node_ids),
    ]);
    const notesText = grounding.chunks
      .filter((c) => c.source_type === "note" || c.source_type === "syllabus")
      .map((c) => c.chunk_text)
      .join("\n---\n");
    const sources = [
      { id: issue.item.id, title: issue.item.title_i18n.en, url: `current_affairs_item:${issue.item.id}` },
      ...issue.relatedItems.map((r) => ({ id: r.id, title: r.title_i18n.en, url: `current_affairs_item:${r.id}` })),
    ];
    out.push({ issue, context: buildContext(issue, notesText, pyqText), sources });
  }
  return out;
}

export interface DeepDivePlan {
  count: number;
  titles: string[];
  estimatedCostUsd: number;
}

/** Rank + preview the month's deep dives (no LLM calls, no writes). */
export async function planDeepDives(month: string): Promise<DeepDivePlan> {
  const issues = await rankIssues(month);
  // Measured against real synthesis calls: a rich context (~2.5k input tokens) + a long structured 6-paragraph output.
  const perCallCost = estimateCostUsd(MODELS.sonnet, 3000, 3500) * BATCH_DISCOUNT;
  return {
    count: issues.length,
    titles: issues.map((i) => i.item.title_i18n.en),
    estimatedCostUsd: perCallCost * issues.length,
  };
}

export interface DeepDiveRunResult {
  month: string;
  planned: number;
  generated: number;
  failed: number;
  costUsd: number;
}

type Log = (msg: string) => void;

/**
 * Generate this month's deep dives and persist them (status='needs_review').
 * Clears any of the month's existing NOT-YET-PUBLISHED deep dives first, so a
 * re-run replaces drafts cleanly instead of accumulating stale duplicates —
 * rows a reviewer already published are left untouched.
 */
export async function runDeepDives(month: string, log: Log = () => {}): Promise<DeepDiveRunResult> {
  const issues = await rankIssues(month);
  const result: DeepDiveRunResult = { month, planned: issues.length, generated: 0, failed: 0, costUsd: 0 };
  if (issues.length === 0) return result;

  log(`ranked ${issues.length} candidate issue(s) for ${month}`);
  const requests = await buildRequests(issues);

  const { error: delError } = await supabase()
    .from("magazine_deep_dives")
    .delete()
    .eq("month", month)
    .neq("status", "published");
  if (delError) throw new Error(`clearing previous deep-dive drafts failed: ${delError.message}`);
  log(`cleared previous (unpublished) deep-dive drafts for ${month}`);

  const batchRequests: BatchRequest[] = requests.map((r, i) => ({
    customId: `dd_${i}`,
    params: structuredParams({
      model: MODELS.sonnet,
      effort: "high",
      system: DEEP_DIVE_SYSTEM,
      content: r.context,
      schema: DEEP_DIVE_SCHEMA,
      maxTokens: 8000,
    }),
    purpose: "magazine_deepdive",
  }));

  const onUsage = (u: LlmUsage) => (result.costUsd += u.costUsd);
  const results = await runBatch(batchRequests, {
    onUsage,
    onPoll: (counts) => log(`batch poll: processing=${counts.processing} succeeded=${counts.succeeded} errored=${counts.errored}`),
  });

  for (let i = 0; i < requests.length; i++) {
    const r = results.get(`dd_${i}`);
    if (!r?.ok) {
      result.failed++;
      log(`deep dive ${i + 1}/${requests.length} FAILED: ${r?.error ?? "no result"}`);
      continue;
    }
    let parsed: DeepDiveGenerated;
    try {
      parsed = JSON.parse(r.text) as DeepDiveGenerated;
    } catch {
      result.failed++;
      log(`deep dive ${i + 1}/${requests.length} FAILED: unparseable JSON`);
      continue;
    }
    const { issue, sources } = requests[i];
    const { error: insError } = await supabase().from("magazine_deep_dives").insert({
      month,
      rank: i + 1,
      status: "needs_review",
      title_i18n: parsed.title_i18n,
      intro_i18n: parsed.intro_i18n,
      synthesis_i18n: parsed.synthesis_i18n,
      significance_i18n: parsed.significance_i18n,
      challenges_i18n: parsed.challenges_i18n,
      way_forward_i18n: parsed.way_forward_i18n,
      keywords_i18n: parsed.keywords_i18n,
      case_examples_i18n: parsed.case_examples_i18n,
      gs_papers: issue.item.gs_papers,
      syllabus_node_ids: issue.item.syllabus_node_ids,
      source_item_ids: sources.map((s) => s.id),
      sources,
      model: MODELS.sonnet,
      cost_usd: 0, // per-row cost isn't separable from the batch aggregate; total is logged on the run.
    });
    if (insError) {
      result.failed++;
      log(`deep dive ${i + 1}/${requests.length} insert FAILED: ${insError.message}`);
      continue;
    }
    result.generated++;
    log(`deep dive ${i + 1}/${requests.length} OK — "${parsed.title_i18n.en.slice(0, 64)}"`);
  }

  return result;
}
