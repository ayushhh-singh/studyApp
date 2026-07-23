/**
 * Question-generation orchestrator (the four-stage pipeline).
 *
 *   generateForNode()  — synchronous, one node. Used by `pnpm qgen` and dev.
 *   generateBatch()    — Message-Batches (50% cheaper), many nodes, pipelined
 *                        stage-by-stage. Used by the nightly top-up job.
 *
 * Both paths: Stage A generate → Stage B critic → Stage C blind verify (MCQ) →
 * Stage D dedup → insert survivors as review_state='needs_review',
 * is_published=false, source='generated', with a full generation_meta trail —
 * and record one generation_batches row (requested/accepted/cost) per node.
 */
import type { BilingualText, Difficulty, GenerationMeta, QuestionType } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import {
  MODELS,
  runBatch,
  structuredJson,
  structuredParams,
  type BatchRequest,
  type LlmUsage,
} from "../lib/anthropic.js";
import { embeddings } from "../lib/embeddings.js";
import { retrieveGrounding, type GroundingResult } from "../services/evaluation/grounding.js";
import { dedupCandidates, type DedupResult } from "./dedup.js";
import {
  QGEN_PROMPT_VERSION,
  buildCriticParams,
  buildDescGenParams,
  buildMcqGenParams,
  buildVerifyParams,
  parseCritic,
  parseDescGen,
  parseMcqGen,
  parseVerify,
  renderQuestionForCritic,
  type FewShotQuestion,
  type GeneratedDescriptive,
  type GeneratedMcq,
  type NodeContext,
} from "./prompts.js";

/** Questions per Stage-A call. Small enough for varied output + a manageable token budget; multiple chunks per node exercise the cached few-shot block. */
const GEN_CHUNK = 5;
/** Concurrency for the per-question critic/verify calls in the synchronous path. */
const SYNC_CONCURRENCY = 5;
const MCQ_MARKS = 2;

export interface DifficultyMix {
  easy: number;
  medium: number;
  hard: number;
}
export const DEFAULT_DIFFICULTY_MIX: DifficultyMix = { easy: 0.3, medium: 0.5, hard: 0.2 };

export interface GeneratePlan {
  node: NodeContext;
  count: number;
  kind: QuestionType;
  difficultyMix?: DifficultyMix;
}

export interface NodeGenerationResult {
  batchId: string | null;
  nodeId: string;
  nodeTitle: string;
  kind: QuestionType;
  requested: number;
  generated: number;
  accepted: number;
  rejected: { critic: number; verify: number; dedup: number };
  costUsd: number;
}

type Log = (msg: string) => void;

// ---------------------------------------------------------------------------
// Candidate model (carries a generated question through all four stages)
// ---------------------------------------------------------------------------
interface Candidate {
  kind: QuestionType;
  mcq?: GeneratedMcq;
  desc?: GeneratedDescriptive;
  critic?: ReturnType<typeof parseCritic>;
  verify?: ReturnType<typeof parseVerify>;
  dedup?: DedupResult;
  reject?: "critic" | "verify" | "dedup";
}

function stemEn(c: Candidate): string {
  return (c.mcq?.stem_i18n.en ?? c.desc?.stem_i18n.en ?? "").trim();
}
function stemI18n(c: Candidate): BilingualText {
  return c.mcq?.stem_i18n ?? c.desc?.stem_i18n ?? { hi: "", en: "" };
}
function difficultyOf(c: Candidate): Difficulty {
  return (c.mcq?.difficulty ?? c.desc?.difficulty ?? "medium") as Difficulty;
}

// ---------------------------------------------------------------------------
// Context loading (node, few-shot, grounding) — shared by both paths
// ---------------------------------------------------------------------------
export async function loadNodeContext(nodeId: string): Promise<NodeContext> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, exam_stage, title_i18n, description_i18n")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) throw new Error(`syllabus node lookup failed: ${error.message}`);
  if (!data) throw new Error(`syllabus node ${nodeId} not found`);
  return {
    id: data.id as string,
    paperCode: data.paper_code as string,
    stage: data.exam_stage as "prelims" | "mains",
    title_i18n: data.title_i18n as { hi: string; en: string },
    description_i18n: (data.description_i18n as { hi: string; en: string } | null) ?? null,
  };
}

/** 5-8 real published PYQs to condition style: node-scoped first, then paper-level. */
async function loadFewShot(node: NodeContext, type: QuestionType): Promise<FewShotQuestion[]> {
  const cols = "stem_i18n, options_i18n, correct_option_key, year, difficulty";
  const map = (rows: unknown[]): FewShotQuestion[] =>
    (rows as FewShotQuestion[]).map((r) => ({
      year: r.year ?? null,
      difficulty: (r as { difficulty?: string }).difficulty ?? "medium",
      stem_i18n: r.stem_i18n,
      options_i18n: r.options_i18n,
      correct_option_key: r.correct_option_key,
    }));

  const { data: nodeRows } = await supabase()
    .from("questions")
    .select(cols)
    .eq("syllabus_node_id", node.id)
    .eq("type", type)
    .eq("is_published", true)
    .limit(8);
  let examples = map(nodeRows ?? []);
  if (examples.length < 5) {
    const { data: paperRows } = await supabase()
      .from("questions")
      .select(cols)
      .eq("paper_code", node.paperCode)
      .eq("type", type)
      .eq("is_published", true)
      .limit(8);
    // Merge, de-dup by stem, cap at 8.
    const seen = new Set(examples.map((e) => e.stem_i18n.en));
    for (const e of map(paperRows ?? [])) {
      if (examples.length >= 8) break;
      if (!seen.has(e.stem_i18n.en)) {
        seen.add(e.stem_i18n.en);
        examples.push(e);
      }
    }
  }
  return examples.slice(0, 8);
}

interface GenContext {
  node: NodeContext;
  examples: FewShotQuestion[];
  grounding: GroundingResult;
}

function groundingQueryFor(node: NodeContext): string {
  return `${node.title_i18n.en}. ${node.description_i18n?.en ?? ""}`.trim();
}

async function loadGenContext(node: NodeContext, kind: QuestionType): Promise<GenContext> {
  const query = groundingQueryFor(node);
  const [examples, grounding] = await Promise.all([
    loadFewShot(node, kind),
    retrieveGrounding({ questionText: query, locale: "en", syllabusNodeId: node.id, k: 6 }),
  ]);
  return { node, examples, grounding };
}

/** Batch-embed size — matches the 96-per-call pattern already used in ca/pipeline.ts, notes/embed.ts, and qgen/dedup.ts. */
const EMBED_BATCH_SIZE = 96;

/**
 * Embed in chunks of EMBED_BATCH_SIZE, isolating a failure to just the chunk
 * it occurred in — a failed chunk leaves its slots `undefined` (rather than
 * rejecting the whole call and discarding every OTHER chunk's already-
 * successful vectors) so only the texts in that one chunk fall back to
 * per-node individual embedding. Never throws.
 */
async function batchEmbed(texts: string[]): Promise<(number[] | undefined)[]> {
  const provider = embeddings();
  const out: (number[] | undefined)[] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const chunk = texts.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const vecs = await provider.embed(chunk);
      vecs.forEach((v, j) => (out[i + j] = v));
    } catch (err) {
      logger.warn(
        { err, chunkOffset: i, chunkSize: chunk.length },
        "qgen: pooled grounding-query embed chunk failed; those nodes will fall back to individual embed",
      );
      // leave out[i..i+chunk.length) undefined — each affected node embeds its own query below.
    }
  }
  return out;
}

/**
 * Load generation context for MANY nodes at once (the nightly top-up path),
 * pooling every node's grounding-query embedding into shared batched embed()
 * calls instead of one embed() round trip per node — same saving as the
 * existing ca/pipeline.ts and notes/embed.ts batching, just applied to qgen's
 * grounding lookups. Few-shot lookup (a plain DB query, no embedding) and the
 * two match_embeddings RPC calls per node are unaffected — those still run
 * once per node since they're node-scoped filters, not embed() round trips.
 *
 * Fault isolation: retrieveGrounding's own try/catch used to be the ONLY
 * thing standing between a per-node embed() failure and that node losing
 * grounding (never the whole run). Pooling hoists the embed call out of that
 * per-node boundary into shared batched calls, so batchEmbed() itself catches
 * per-chunk and never throws — a failed chunk leaves its nodes' vectors
 * undefined, and each such node's own retrieveGrounding call then embeds its
 * query individually (its own try/catch still isolates a further per-node
 * failure), exactly matching pre-pooling behavior for the affected nodes only.
 */
async function loadGenContextsBatch(plans: GeneratePlan[]): Promise<GenContext[]> {
  const queries = plans.map((p) => groundingQueryFor(p.node));
  const embedIdx: number[] = [];
  const toEmbed: string[] = [];
  queries.forEach((q, i) => {
    if (q) {
      embedIdx.push(i);
      toEmbed.push(q);
    }
  });
  const vecs: (number[] | undefined)[] = new Array(plans.length);
  const embedded = toEmbed.length ? await batchEmbed(toEmbed) : [];
  embedIdx.forEach((planIdx, j) => (vecs[planIdx] = embedded[j]));

  return Promise.all(
    plans.map(async (plan, i) => {
      const [examples, grounding] = await Promise.all([
        loadFewShot(plan.node, plan.kind),
        retrieveGrounding({
          questionText: queries[i],
          locale: "en",
          syllabusNodeId: plan.node.id,
          k: 6,
          queryEmbedding: vecs[i],
        }),
      ]);
      return { node: plan.node, examples, grounding };
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers shared by sync + batch
// ---------------------------------------------------------------------------
function difficultyHint(mix: DifficultyMix): string {
  const pct = (n: number) => Math.round(n * 100);
  return `Aim for roughly ${pct(mix.easy)}% easy, ${pct(mix.medium)}% medium, and ${pct(mix.hard)}% hard across the set.`;
}

/** Chunk sizes for `count` questions, GEN_CHUNK per call. */
function chunkSizes(count: number): number[] {
  const sizes: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    sizes.push(Math.min(GEN_CHUNK, remaining));
    remaining -= GEN_CHUNK;
  }
  return sizes;
}

function genParamsFor(ctx: GenContext, kind: QuestionType, count: number, mix: DifficultyMix, chunkIdx: number) {
  const shared = {
    node: ctx.node,
    examples: ctx.examples,
    grounding: ctx.grounding,
    count,
    difficultyHint: difficultyHint(mix),
    variantHint: chunkIdx > 0 ? `This is set ${chunkIdx + 1}; avoid framings likely used in earlier sets.` : "",
  };
  return kind === "mcq" ? buildMcqGenParams(shared) : buildDescGenParams(shared);
}

function candidatesFromGen(kind: QuestionType, json: unknown): Candidate[] {
  if (kind === "mcq") return parseMcqGen(json).map((mcq) => ({ kind, mcq }));
  return parseDescGen(json).map((desc) => ({ kind, desc }));
}

/** Apply Stage-B/C verdicts already attached to each candidate → set .reject in pipeline order. */
function markRejections(candidates: Candidate[]): void {
  for (const c of candidates) {
    if (c.critic && !c.critic.approve) {
      c.reject = "critic";
      continue;
    }
    if (c.kind === "mcq" && c.verify && !c.verify.matches_key) {
      c.reject = "verify";
      continue;
    }
    if (c.dedup?.isDuplicate) c.reject = "dedup";
  }
}

function buildQuestionRow(node: NodeContext, c: Candidate, batchId: string, groundingSourceIds: string[]) {
  const meta: GenerationMeta = {
    model: MODELS.sonnet,
    prompt_version: QGEN_PROMPT_VERSION,
    difficulty: difficultyOf(c),
    critic: c.critic,
    ...(c.kind === "mcq" && c.verify ? { verify_result: c.verify } : {}),
    ...(c.kind === "descriptive" && c.desc ? { marking_points_i18n: c.desc.marking_points_i18n } : {}),
    ...(c.dedup ? { dedup: { max_similarity: c.dedup.maxSimilarity, nearest: c.dedup.nearest } } : {}),
    source_context_ids: groundingSourceIds,
    batch_id: batchId,
  };
  const base = {
    stage: node.stage,
    paper_code: node.paperCode,
    syllabus_node_id: node.id,
    year: null,
    source: "generated" as const,
    difficulty: difficultyOf(c),
    is_published: false,
    review_state: "needs_review" as const,
    generation_meta: meta,
  };
  if (c.kind === "mcq" && c.mcq) {
    return {
      ...base,
      type: "mcq" as const,
      stem_i18n: c.mcq.stem_i18n,
      options_i18n: c.mcq.options.map((o) => ({ key: o.key, text_i18n: o.text_i18n })),
      correct_option_key: c.mcq.correct_option_key,
      explanation_i18n: c.mcq.explanation_i18n,
      word_limit: null,
      marks: MCQ_MARKS,
    };
  }
  const d = c.desc!;
  return {
    ...base,
    type: "descriptive" as const,
    stem_i18n: d.stem_i18n,
    options_i18n: null,
    correct_option_key: null,
    explanation_i18n: null,
    word_limit: d.word_limit,
    marks: d.marks,
  };
}

/**
 * Dedup survivors, insert them as needs_review, and record the generation_batches
 * row. Shared terminal step for both paths. The batch row is inserted first so
 * each question's generation_meta.batch_id points at it.
 */
async function finalizeNode(
  ctx: GenContext,
  candidates: Candidate[],
  plan: GeneratePlan,
  mode: "sync" | "batch",
  costUsd: number,
  log: Log,
): Promise<NodeGenerationResult> {
  const node = ctx.node;
  const groundingSourceIds = [...new Set(ctx.grounding.chunks.map((c) => c.source_id))];

  // Stage D — dedup only the candidates still alive after critic + verify.
  const preDedup = candidates.filter((c) => !c.reject);
  const dedup = await dedupCandidates(node.id, preDedup.map(stemEn));
  preDedup.forEach((c, i) => (c.dedup = dedup[i]));
  markRejections(candidates); // re-run so dedup rejects are counted

  const survivors = candidates.filter((c) => !c.reject);
  const rejected = {
    critic: candidates.filter((c) => c.reject === "critic").length,
    verify: candidates.filter((c) => c.reject === "verify").length,
    dedup: candidates.filter((c) => c.reject === "dedup").length,
  };

  // Insert the batch row first (id stamped into each question's meta).
  const { data: batchRow, error: batchErr } = await supabase()
    .from("generation_batches")
    .insert({
      kind: plan.kind,
      node_id: node.id,
      requested_count: plan.count,
      accepted_count: 0,
      cost_usd: costUsd,
      meta: { mode, prompt_version: QGEN_PROMPT_VERSION, generated: candidates.length, rejected },
    })
    .select("id")
    .single();
  if (batchErr) throw new Error(`generation_batches insert failed: ${batchErr.message}`);
  const batchId = batchRow.id as string;

  if (survivors.length > 0) {
    const rows = survivors.map((c) => buildQuestionRow(node, c, batchId, groundingSourceIds));
    const { error: insErr } = await supabase().from("questions").insert(rows);
    if (insErr) {
      // Don't leave a batch row claiming acceptances we failed to insert.
      await supabase().from("generation_batches").update({ accepted_count: 0, meta: { mode, error: insErr.message } }).eq("id", batchId);
      throw new Error(`question insert failed: ${insErr.message}`);
    }
    await supabase().from("generation_batches").update({ accepted_count: survivors.length }).eq("id", batchId);
  }

  log(
    `[${node.title_i18n.en.slice(0, 48)}] generated ${candidates.length}, accepted ${survivors.length} ` +
      `(rejected critic=${rejected.critic} verify=${rejected.verify} dedup=${rejected.dedup}) cost=$${costUsd.toFixed(4)}`,
  );

  return {
    batchId,
    nodeId: node.id,
    nodeTitle: node.title_i18n.en,
    kind: plan.kind,
    requested: plan.count,
    generated: candidates.length,
    accepted: survivors.length,
    rejected,
    costUsd,
  };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Synchronous path — one node (interactive `pnpm qgen`)
// ---------------------------------------------------------------------------
export async function generateForNode(plan: GeneratePlan, log: Log = () => {}): Promise<NodeGenerationResult> {
  const mix = plan.difficultyMix ?? DEFAULT_DIFFICULTY_MIX;
  const ctx = await loadGenContext(plan.node, plan.kind);
  log(`[${plan.node.title_i18n.en.slice(0, 48)}] few-shot=${ctx.examples.length} grounding=${ctx.grounding.chunks.length}`);

  const cost = { usd: 0 };
  const onUsage = (u: LlmUsage) => (cost.usd += u.costUsd);

  // Stage A — generate (chunked; the few-shot/grounding block is cached across chunks).
  const sizes = chunkSizes(plan.count);
  const candidates: Candidate[] = [];
  for (let ci = 0; ci < sizes.length; ci++) {
    const json = await structuredJson({
      ...genParamsFor(ctx, plan.kind, sizes[ci], mix, ci),
      purpose: `qgen_${plan.kind}_generate`,
      onUsage,
    });
    candidates.push(...candidatesFromGen(plan.kind, json));
  }

  // Stage B — critic (every candidate, concurrent).
  await pool(candidates, SYNC_CONCURRENCY, async (c) => {
    const rendered =
      c.kind === "mcq" ? renderQuestionForCritic.mcq(c.mcq!) : renderQuestionForCritic.descriptive(c.desc!);
    const json = await structuredJson({
      ...buildCriticParams({ node: ctx.node, rendered, grounding: ctx.grounding }),
      purpose: "qgen_critic",
      onUsage,
    });
    c.critic = parseCritic(json);
  });
  markRejections(candidates);

  // Stage C — blind verify (MCQ survivors of the critic only).
  const toVerify = candidates.filter((c) => c.kind === "mcq" && !c.reject);
  await pool(toVerify, SYNC_CONCURRENCY, async (c) => {
    const json = await structuredJson({
      ...buildVerifyParams({ stemEn: c.mcq!.stem_i18n.en, options: c.mcq!.options, grounding: ctx.grounding }),
      purpose: "qgen_verify",
      onUsage,
    });
    c.verify = parseVerify(json, c.mcq!.correct_option_key);
  });
  markRejections(candidates);

  return finalizeNode(ctx, candidates, plan, "sync", cost.usd, log);
}

// ---------------------------------------------------------------------------
// Batch path — many nodes, pipelined stage-by-stage (nightly top-up)
// ---------------------------------------------------------------------------
interface BatchPlanState {
  plan: GeneratePlan;
  ctx: GenContext;
  mix: DifficultyMix;
  candidates: Candidate[];
  cost: number;
}

/**
 * Sum this run's per-request costs back to the owning plan by parsing the
 * custom_id. Anthropic requires custom_id to match ^[a-zA-Z0-9_-]{1,64}$, so
 * segments are `_`-joined (NOT `:` — that 400s at batch submission).
 */
function addCost(states: BatchPlanState[], customId: string, usd: number): void {
  const planIdx = Number(customId.split("_")[1]);
  if (Number.isInteger(planIdx) && states[planIdx]) states[planIdx].cost += usd;
}

export async function generateBatch(plans: GeneratePlan[], log: Log = () => {}): Promise<NodeGenerationResult[]> {
  if (plans.length === 0) return [];
  const contexts = await loadGenContextsBatch(plans);
  const states: BatchPlanState[] = plans.map((plan, i) => ({
    plan,
    ctx: contexts[i],
    mix: plan.difficultyMix ?? DEFAULT_DIFFICULTY_MIX,
    candidates: [] as Candidate[],
    cost: 0,
  }));

  // Stage A — one batch of all generate chunks across all nodes.
  const genReqs: BatchRequest[] = [];
  states.forEach((s, pi) => {
    chunkSizes(s.plan.count).forEach((size, ci) => {
      genReqs.push({
        customId: `gen_${pi}_${ci}`,
        params: structuredParams(genParamsFor(s.ctx, s.plan.kind, size, s.mix, ci)),
        purpose: `qgen_${s.plan.kind}_generate`,
      });
    });
  });
  log(`Stage A: ${genReqs.length} generate requests across ${states.length} nodes...`);
  const genRes = await runBatch(genReqs, {
    onPoll: (c) => log(`  A: succeeded=${c.succeeded} errored=${c.errored} processing=${c.processing}`),
  });
  for (const req of genReqs) {
    const r = genRes.get(req.customId);
    if (!r?.ok) continue;
    const pi = Number(req.customId.split("_")[1]);
    if (r.usage) addCost(states, req.customId, r.usage.costUsd);
    try {
      states[pi].candidates.push(...candidatesFromGen(states[pi].plan.kind, JSON.parse(r.text)));
    } catch (err) {
      logger.warn({ err, customId: req.customId }, "qgen batch: failed to parse generate result");
    }
  }

  // Stage B — critic for every candidate.
  const criticReqs: BatchRequest[] = [];
  states.forEach((s, pi) => {
    s.candidates.forEach((c, ci) => {
      const rendered =
        c.kind === "mcq" ? renderQuestionForCritic.mcq(c.mcq!) : renderQuestionForCritic.descriptive(c.desc!);
      criticReqs.push({
        customId: `critic_${pi}_${ci}`,
        params: structuredParams(buildCriticParams({ node: s.ctx.node, rendered, grounding: s.ctx.grounding })),
        purpose: "qgen_critic",
      });
    });
  });
  log(`Stage B: ${criticReqs.length} critic requests...`);
  const criticRes = await runBatch(criticReqs, {
    onPoll: (c) => log(`  B: succeeded=${c.succeeded} errored=${c.errored} processing=${c.processing}`),
  });
  for (const req of criticReqs) {
    const r = criticRes.get(req.customId);
    const [, pi, ci] = req.customId.split("_").map(Number);
    if (r?.ok) {
      addCost(states, req.customId, r.usage?.costUsd ?? 0);
      try {
        states[pi].candidates[ci].critic = parseCritic(JSON.parse(r.text));
      } catch {
        /* leave critic undefined → treated as not-approved below */
      }
    }
    // A missing/failed critic → conservative reject.
    if (!states[pi].candidates[ci].critic) {
      states[pi].candidates[ci].critic = { approve: false, single_correct_answer: false, options_plausible: false, uppsc_tone: false, out_of_syllabus: true, decisive_facts: [], factual_red_flags: ["critic call failed"], notes: "critic unavailable" };
    }
  }
  states.forEach((s) => markRejections(s.candidates));

  // Stage C — blind verify for MCQ survivors of the critic.
  const verifyReqs: BatchRequest[] = [];
  states.forEach((s, pi) => {
    s.candidates.forEach((c, ci) => {
      if (c.kind === "mcq" && !c.reject) {
        verifyReqs.push({
          customId: `verify_${pi}_${ci}`,
          params: structuredParams(buildVerifyParams({ stemEn: c.mcq!.stem_i18n.en, options: c.mcq!.options, grounding: s.ctx.grounding })),
          purpose: "qgen_verify",
        });
      }
    });
  });
  log(`Stage C: ${verifyReqs.length} blind-verify requests...`);
  const verifyRes = await runBatch(verifyReqs, {
    onPoll: (c) => log(`  C: succeeded=${c.succeeded} errored=${c.errored} processing=${c.processing}`),
  });
  for (const req of verifyReqs) {
    const r = verifyRes.get(req.customId);
    const [, pi, ci] = req.customId.split("_").map(Number);
    const c = states[pi].candidates[ci];
    if (r?.ok) {
      addCost(states, req.customId, r.usage?.costUsd ?? 0);
      try {
        c.verify = parseVerify(JSON.parse(r.text), c.mcq!.correct_option_key);
      } catch {
        c.verify = { chosen_key: null, matches_key: false, confidence: 0 };
      }
    } else {
      c.verify = { chosen_key: null, matches_key: false, confidence: 0 };
    }
  }
  states.forEach((s) => markRejections(s.candidates));

  // Stage D + insert + record, per node.
  const results: NodeGenerationResult[] = [];
  for (const s of states) {
    results.push(await finalizeNode(s.ctx, s.candidates, s.plan, "batch", s.cost, log));
  }
  return results;
}
