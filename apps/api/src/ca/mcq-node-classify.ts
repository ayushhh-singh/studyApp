/**
 * Dedicated, narrow classification for placing a current-affairs MCQ on its
 * real PRE_GS1 topic — separate from ca/prompts.ts's triageItem, which
 * classifies the whole ITEM against the full candidate pool (mains-oriented
 * framing, for the magazine/mains brief) and only incidentally picks a
 * prelims node when one happens to be the best fit (measured: ~1-in-50 real
 * items). This asks the ONE question that actually matters for MCQ
 * placement — "given the exact facts this MCQ was written from, which
 * PRE_GS1 topic (if any) does it concretely belong to" — using the same
 * prompt this repo's ca-reclassify-mcq-nodes.ts backfill validated live
 * against 585 historical items (534 real matches, 51 correctly left generic,
 * 0 errors). ca/pipeline.ts calls this ONLY when triage's own
 * classification (pickPrelimsMcqNode) found no prelims match, so it fires
 * for a small minority of items, not every one.
 *
 * FAILS OPEN: any error (bad key, timeout, malformed response) logs a
 * warning and returns null so the caller falls back to the pooled "Current
 * Events" node — never blocks MCQ generation.
 */
import { MODELS, structuredJson, type LlmUsage } from "../lib/anthropic.js";
import { logger } from "../lib/logger.js";
import type { SyllabusCandidate } from "./prompts.js";

export const MCQ_NODE_CLASSIFY_SYSTEM =
  "You are mapping an already-confirmed prelims-relevant current-affairs item to ONE specific UPPSC Prelims " +
  "General Studies Paper I curriculum topic, from the candidate list, that its facts most concretely belong to " +
  "(e.g. a scheme/appointment/report belongs to its subject area; a monument/place to History or Geography). " +
  "Choose \"none\" if the item is genuinely generic breaking news with no better specific fit than plain current " +
  "events — do not force a stretch mapping. Give a one-line reason.";

export function buildMcqNodeClassifySchema(validIds: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      syllabus_node_id: { type: "string", enum: [...validIds, "none"] },
      reason: { type: "string" },
    },
    required: ["syllabus_node_id", "reason"],
  };
}

interface ClassifyResult {
  syllabus_node_id: string;
  reason: string;
}

export async function classifyPrelimsMcqNode(opts: {
  title: string;
  facts: string[];
  /** Already filtered to PRE_GS1 (never PRE_CSAT — see pickPrelimsMcqNode's comment in pipeline.ts). */
  prelimsCandidates: SyllabusCandidate[];
  onUsage: (u: LlmUsage) => void;
}): Promise<string | null> {
  if (opts.prelimsCandidates.length === 0) return null;
  const validIds = opts.prelimsCandidates.map((c) => c.id);
  const candidateLines = opts.prelimsCandidates.map((c) => `${c.id}: ${c.title}`).join("\n");
  const content =
    `Item: ${opts.title}\n` +
    `Facts:\n${opts.facts.map((f) => `- ${f}`).join("\n")}\n\n` +
    `Candidate topics (id: title):\n${candidateLines}`;

  try {
    const out = await structuredJson<ClassifyResult>({
      model: MODELS.haiku,
      maxTokens: 300,
      system: MCQ_NODE_CLASSIFY_SYSTEM,
      content,
      schema: buildMcqNodeClassifySchema(validIds),
      purpose: "ca_mcq_node_classify",
      onUsage: opts.onUsage,
    });
    if (out.syllabus_node_id === "none") return null;
    return validIds.includes(out.syllabus_node_id) ? out.syllabus_node_id : null;
  } catch (err) {
    logger.warn({ err }, "ca: MCQ node classification failed — falling back to the pooled Current Events node");
    return null;
  }
}
