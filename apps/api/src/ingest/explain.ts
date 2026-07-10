/**
 * ingest:explain — grounded, bilingual MCQ explanations for freshly-ingested
 * PYQs, generated via the Batch API (0.5x). Encodes the Session-27 grounded
 * policy (the same one services/question-explanation.ts uses on demand), kept
 * self-contained here so this ingest CLI doesn't couple to that live-endpoint
 * module: the official answer key is ground truth, but before writing an
 * explanation that argues FOR the stored key a cheap grounded key-SUPPORT
 * pre-check confirms the evidence backs it — if it doesn't, we flag the question
 * (needs_review + unpublished) and write NO explanation, rather than fabricate a
 * justification for a key we don't trust.
 *
 *   pnpm ingest:explain --paper PRE_GS1 --year 2024   (scope)
 *   pnpm ingest:explain --all                          (every published MCQ missing one)
 *   pnpm ingest:explain --dry-run --all                (COST PROJECTION only — no spend)
 *   flags: --force (overwrite existing explanations), --limit N
 *
 * Cost-capped: --dry-run prints the projected batch cost so it can be reviewed
 * BEFORE any spend.
 */
import { runBatch, structuredParams, MODELS, type BatchRequest } from "../lib/anthropic.js";
import { estimateCostUsd } from "../lib/models.js";
import { supabase } from "../lib/supabase.js";
import { retrieveGrounding, type GroundingResult } from "../services/evaluation/grounding.js";
import { pMap } from "../audit/shared.js";

/** Format retrieved passages for the prompt (same shape as the on-demand path). */
function groundingBlockText(g: GroundingResult): string {
  if (g.chunks.length === 0) return "No reference passages were retrieved; rely only on well-established, verifiable facts.";
  return g.chunks.map((c, i) => `${i + 1}. [${c.source_type}] ${c.chunk_text}`).join("\n");
}
import { parseArgs, report } from "./_shared.js";

interface Bi {
  hi?: string | null;
  en?: string | null;
}
interface ExQ {
  id: string;
  syllabus_node_id: string | null;
  stem_i18n: Bi;
  options_i18n: { key: string; text_i18n: Bi }[] | null;
  correct_option_key: string | null;
}

const SUPPORT_SYSTEM =
  "You are auditing a UPPSC exam MCQ before an explanation is written for it. You are given the question, its options, " +
  "reference passages, and the STORED answer key. Using the passages and well-established knowledge, decide whether the " +
  "evidence genuinely supports the stored key being the single correct option. Do NOT assume the stored key is right — " +
  "check it. If it is clearly wrong, say which option the evidence actually supports. Name the decisive fact. Return strict JSON only.";
const SUPPORT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    supports_key: { type: "boolean" },
    believed_key: { type: "string", enum: ["A", "B", "C", "D", "unsure"] },
    decisive_fact: { type: "string" },
    reason: { type: "string" },
  },
  required: ["supports_key", "believed_key", "decisive_fact", "reason"],
};
const EXPLAIN_SYSTEM =
  "You write UPPSC MCQ answer explanations for exam aspirants, in BOTH Hindi (Devanagari) and English. You are given the " +
  "verified correct option — write a concise explanation (3-5 sentences per language) that argues FOR that option using " +
  "the reference passages, and briefly why each other option is wrong. Ground every factual claim in the passages or " +
  "well-established knowledge; never invent a date, article, name, or number. Plain prose only — no markdown, no headers, " +
  "no bold/italic asterisks, no bullet lists. Return strict JSON only.";
const EXPLAIN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    explanation: {
      type: "object",
      additionalProperties: false,
      properties: { hi: { type: "string" }, en: { type: "string" } },
      required: ["hi", "en"],
    },
  },
  required: ["explanation"],
};

function optionsEn(q: ExQ): string {
  return (q.options_i18n ?? []).map((o) => `${o.key}) ${o.text_i18n.en ?? o.text_i18n.hi ?? ""}`).join("\n");
}
function stemEn(q: ExQ): string {
  return q.stem_i18n.en ?? q.stem_i18n.hi ?? "";
}
function supportContent(q: ExQ, gb: string): string {
  return (
    `Question:\n${stemEn(q)}\n\nOptions:\n${optionsEn(q)}\n\n` +
    `Stored answer key: ${q.correct_option_key ?? "unknown"}\n\nReference passages:\n${gb}\n\n` +
    `Does the evidence support the stored key?`
  );
}
function explainContent(q: ExQ, gb: string): string {
  const correct = (q.options_i18n ?? []).find((o) => o.key === q.correct_option_key);
  return (
    `Question:\n${stemEn(q)}\n\nOptions:\n${optionsEn(q)}\n\n` +
    `Verified correct option: ${q.correct_option_key}` +
    (correct ? ` (${correct.text_i18n.en ?? correct.text_i18n.hi})` : "") +
    `\n\nReference passages:\n${gb}\n\nWrite the bilingual explanation.`
  );
}

/** Published+approved MCQs missing an explanation, scoped by paper/year. */
async function selectTargets(args: Record<string, string | boolean>): Promise<ExQ[]> {
  let q = supabase()
    .from("questions")
    .select("id, syllabus_node_id, stem_i18n, options_i18n, correct_option_key")
    .eq("type", "mcq")
    .eq("is_published", true)
    .eq("review_state", "approved")
    .not("correct_option_key", "is", null);
  if (!args.force) q = q.is("explanation_i18n", null);
  if (typeof args.paper === "string") q = q.eq("paper_code", args.paper);
  if (typeof args.year === "string") q = q.eq("year", Number(args.year));
  const { data, error } = await q.limit(typeof args.limit === "string" ? Number(args.limit) : 5000);
  if (error) throw new Error(`selectTargets failed: ${error.message}`);
  return (data ?? []) as unknown as ExQ[];
}

/** char/4 ≈ tokens — a coarse but adequate projection estimate. */
function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args["dry-run"];
  report.section(`ingest:explain — grounded bilingual explanations (batch, 0.5x)${dryRun ? " — DRY RUN" : ""}`);

  const targets = await selectTargets(args);
  report.ok(`target MCQs (published, no explanation): ${targets.length}`);
  if (targets.length === 0) return;

  // Grounding for every target (retrieveGrounding embeds + ANN; bounded fan-out).
  report.step("retrieving grounding…");
  const grounds = await pMap(targets, 6, async (q) => {
    const g = await retrieveGrounding({
      questionText: `${stemEn(q)}\n${optionsEn(q)}`,
      locale: "en",
      syllabusNodeId: q.syllabus_node_id,
      k: 6,
    });
    return groundingBlockText(g);
  });

  // ---- Cost projection (both rounds) ----
  const SYS_TOK = estTokens(SUPPORT_SYSTEM) + estTokens(EXPLAIN_SYSTEM);
  let inTok = 0;
  for (let i = 0; i < targets.length; i++) {
    inTok += estTokens(supportContent(targets[i], grounds[i]));
    inTok += estTokens(explainContent(targets[i], grounds[i]));
  }
  inTok += SYS_TOK * targets.length; // both round systems, once per question
  const outTok = targets.length * (120 + 600); // ~support + ~explain output tokens
  const fullCost = estimateCostUsd(MODELS.haiku, inTok, outTok, 0, 0);
  const batchCost = fullCost * 0.5;
  report.section("Projected explanation cost");
  console.log(`  model                 ${MODELS.haiku} (batch, 0.5x)`);
  console.log(`  questions             ${targets.length}`);
  console.log(`  est. input tokens     ~${inTok.toLocaleString()}`);
  console.log(`  est. output tokens    ~${outTok.toLocaleString()}`);
  console.log(`  est. cost (batch)     ~$${batchCost.toFixed(2)}  (₹${(batchCost * 84).toFixed(0)})`);
  console.log(`  est. cost (if sync)   ~$${fullCost.toFixed(2)}`);
  if (dryRun) {
    report.ok("dry run — no spend. Re-run without --dry-run to generate.");
    return;
  }

  // ---- Round 1: key-support pre-check (batched) ----
  report.section("Round 1 — grounded key-support pre-check");
  const idx = new Map(targets.map((q, i) => [q.id, i]));
  const supReqs: BatchRequest[] = targets.map((q, i) => ({
    customId: q.id,
    params: structuredParams({
      model: MODELS.haiku,
      maxTokens: 500,
      system: SUPPORT_SYSTEM,
      content: supportContent(q, grounds[i]),
      schema: SUPPORT_SCHEMA,
    }),
    purpose: "explanation_key_check",
  }));
  const supRes = await runBatch(supReqs, {
    onPoll: (c) => report.step(`  support: ${c.succeeded} ok / ${c.processing} processing / ${c.errored} err`),
  });

  const supported: ExQ[] = [];
  let disputed = 0;
  for (const q of targets) {
    const r = supRes.get(q.id);
    if (!r?.ok) continue; // errored → leave for a re-run, no state change
    let parsed: { supports_key: boolean; believed_key: string; decisive_fact: string; reason: string };
    try {
      parsed = JSON.parse(r.text);
    } catch {
      continue;
    }
    if (parsed.supports_key) {
      supported.push(q);
    } else {
      // The stored key was already decided by the ingest resolve gate (blind
      // re-solve + sonnet/web escalation) — the AUTHORITATIVE trust check. This
      // cheap grounded pre-check is far weaker (no escalation) and false-disputes
      // ~45% of keys, so it must NOT unpublish a gate-approved question. Record
      // the dispute in meta for a human spot-check and skip writing an
      // explanation; leave review_state/is_published untouched.
      disputed++;
      const { data } = await supabase().from("questions").select("meta").eq("id", q.id).maybeSingle();
      const meta = ((data?.meta as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      await supabase()
        .from("questions")
        .update({
          meta: {
            ...meta,
            explain_key_precheck: {
              disputed: true,
              reason: parsed.reason,
              believed_key: parsed.believed_key,
              decisive_fact: parsed.decisive_fact,
              at: new Date().toISOString(),
            },
          },
        })
        .eq("id", q.id);
    }
  }
  report.ok(`supported: ${supported.length} · disputed (spot-check flag only, NOT unpublished): ${disputed}`);

  // ---- Round 2: author explanation (batched) ----
  report.section("Round 2 — author grounded bilingual explanation");
  const expReqs: BatchRequest[] = supported.map((q) => ({
    customId: q.id,
    params: structuredParams({
      model: MODELS.haiku,
      maxTokens: 1500,
      system: EXPLAIN_SYSTEM,
      content: explainContent(q, grounds[idx.get(q.id)!]),
      schema: EXPLAIN_SCHEMA,
    }),
    purpose: "mcq_explanation",
  }));
  const expRes = await runBatch(expReqs, {
    onPoll: (c) => report.step(`  explain: ${c.succeeded} ok / ${c.processing} processing / ${c.errored} err`),
  });

  let written = 0;
  for (const q of supported) {
    const r = expRes.get(q.id);
    if (!r?.ok) continue;
    let parsed: { explanation: Bi };
    try {
      parsed = JSON.parse(r.text);
    } catch {
      continue;
    }
    const upd = supabase().from("questions").update({ explanation_i18n: parsed.explanation }).eq("id", q.id);
    const { error } = await (args.force ? upd : upd.is("explanation_i18n", null));
    if (!error) written++;
  }

  report.section("Summary");
  report.ok(`explanations written: ${written}`);
  report.ok(`disputed → Review Queue (no explanation): ${disputed}`);
}

main().catch((err) => {
  console.error("\ningest:explain failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
