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
 *
 * NO PROMPT CACHING — DELIBERATE, MEASURED, DO NOT ADD (2026-07-23). Unlike
 * ca/prompts.ts's triage prompt (candidate list ~8.6k tokens, rejected only
 * because reordering it to be cacheable proved a real quality regression —
 * see that file's own header), this prompt has nowhere near enough content
 * to ever benefit: MCQ_NODE_CLASSIFY_SYSTEM measures ~123 tokens and the
 * full PRE_GS1 candidate list ~474 tokens — combined, ~600 tokens against
 * claude-haiku-4-5's ~4096-token minimum cacheable prefix. Even a `system:
 * PromptSegment[]` with the whole thing marked `cache: true` would compile,
 * ship, and cache nothing (the exact silent-no-op trap CLAUDE.md's Session
 * 13 already documented for prompts this size on this model) — there is no
 * reordering that fixes a token-count problem. Also considered and rejected:
 * moving this call onto the Message Batches API for the 50% discount — it
 * runs synchronously inline while an item is being processed (the MCQ needs
 * its node before insert), so batching would mean a submit-now/collect-later
 * restructure for a call that's already ~3-4% of a run's total CA spend
 * (measured: $0.0124 across 5 calls in one run) — not proportionate.
 */
import { MODELS, structuredJson, type LlmUsage } from "../lib/anthropic.js";
import { getExamConfig, requireAuthored } from "../lib/exam-config.js";
import { logger } from "../lib/logger.js";
import type { SyllabusCandidate } from "./prompts.js";

/**
 * The system prompt, per exam. Was a module-level const (one string instance);
 * it is now a memoised per-exam builder, so repeated calls still reuse one
 * instance per exam. The NAME is deliberately unchanged (it is the key this
 * file's prompt-snapshot entry is recorded under) even though it is now a
 * function — call it as `MCQ_NODE_CLASSIFY_SYSTEM(examCode)`.
 *
 * NO CACHE BOUNDARY EXISTS HERE (see this file's header): the prompt is a plain
 * string `system`, far below haiku's minimum cacheable prefix, so the per-exam
 * text is free and cannot move anything across a breakpoint.
 */
const classifySystemCache = new Map<string, string>();
export function MCQ_NODE_CLASSIFY_SYSTEM(examCode: string): string {
  const hit = classifySystemCache.get(examCode);
  if (hit !== undefined) return hit;
  const framing = requireAuthored(
    getExamConfig(examCode).ca.nodeClassifyFraming,
    examCode,
    "ca.nodeClassifyFraming",
  );
  const built =
    `You are mapping an already-confirmed prelims-relevant current-affairs item to ${framing}, from the candidate list, that its facts most concretely belong to ` +
    "(e.g. a scheme/appointment/report belongs to its subject area; a monument/place to History or Geography). " +
    "Choose \"none\" if the item is genuinely generic breaking news with no better specific fit than plain current " +
    "events — do not force a stretch mapping. Give a one-line reason.";
  classifySystemCache.set(examCode, built);
  return built;
}

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
  /**
   * Whose prelims curriculum the model is choosing from — i.e. the exam that
   * OWNS `prelimsCandidates`, not the item's own exam. The prompt names the
   * paper the candidate list was drawn from, so it must agree with that list.
   */
  examCode: string;
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
      system: MCQ_NODE_CLASSIFY_SYSTEM(opts.examCode),
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
