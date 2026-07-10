/**
 * pnpm audit:resolve [--sample N | --all] [--run-id ID] [--hide]
 *                    [--max-usd N] [--max-escalations N] [--out FILE]
 *
 * Blind re-solve audit. Independently solves published MCQs (no key, no
 * explanation) WITH RAG grounding — haiku for easy/medium, sonnet for hard, via
 * the Batch API. Disagreements with the stored key escalate to one sonnet solve
 * that verifies the decisive fact with web_search + citations. A persistent
 * disagreement is flagged (and, with --hide, unpublished — except official-key
 * PYQs, whose stored key is ground truth: surfaced, never auto-hidden).
 *
 * The default sample is a deterministic stratified 200: all generated + manual
 * (single-model verification = highest risk), then compilation-with-explanation,
 * then a deterministic id-ordered fill. --all audits the full bank.
 */
import { writeFileSync } from "node:fs";
import { runBatch, type LlmUsage } from "../lib/anthropic.js";
import {
  loadPublishedMcqs,
  upsertAuditMany,
  alreadyAudited,
  hideQuestion,
  pMap,
  type AuditQuestion,
  type AuditRecord,
} from "./shared.js";
import {
  groundingForQuestion,
  buildSolveParams,
  solveModel,
  escalate,
  interpretResolve,
  type SolveResult,
  type EscalationResult,
} from "./resolve.js";
import type { GroundingResult } from "../services/evaluation/grounding.js";

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Deterministic stratified sample (see file header). */
function sample(all: AuditQuestion[], n: number): AuditQuestion[] {
  const byId = [...all].sort((a, b) => a.id.localeCompare(b.id));
  const chosen = new Map<string, AuditQuestion>();
  const add = (q: AuditQuestion) => chosen.set(q.id, q);
  // Tier 1: generated + manual (single-model verification, highest risk).
  for (const q of byId) if (q.source_kind === "generated" || q.source_kind === "manual") add(q);
  // Tier 2: compilation with an explanation (the on-demand-explained PYQs).
  for (const q of byId) if (chosen.size < n && q.explanation_i18n?.en?.trim()) add(q);
  // Tier 3: deterministic id-ordered fill.
  for (const q of byId) if (chosen.size < n) add(q);
  return [...chosen.values()].slice(0, n);
}

async function main() {
  const args = process.argv.slice(2);
  const runId = argVal(args, "--run-id") ?? "resolve-1";
  const doHide = args.includes("--hide");
  const doAll = args.includes("--all");
  const sampleN = Number(argVal(args, "--sample") ?? "200");
  const maxUsd = Number(argVal(args, "--max-usd") ?? "12");
  const maxEscalations = Number(argVal(args, "--max-escalations") ?? "80");
  const outFile = argVal(args, "--out");

  console.log(`[resolve] run_id=${runId} hide=${doHide} ${doAll ? "ALL" : `sample=${sampleN}`} max_usd=${maxUsd} max_escalations=${maxEscalations}`);
  const all = await loadPublishedMcqs();
  const selected = doAll ? all : sample(all, sampleN);
  const done = await alreadyAudited("resolve", runId);
  const todo = selected.filter((q) => !done.has(q.id));
  console.log(`[resolve] ${all.length} published MCQs · selected ${selected.length} · ${todo.length} to audit · ${done.size} already done`);
  if (todo.length === 0) {
    console.log("[resolve] nothing to do.");
    return;
  }

  let totalCost = 0;
  const onUsage = (u: LlmUsage) => {
    totalCost += u.costUsd;
  };

  // Phase 0 — grounding (bounded concurrency; embeds + RPCs, cheap).
  console.log("[resolve] retrieving RAG grounding…");
  const grounding = new Map<string, GroundingResult>();
  await pMap(todo, 6, async (q) => {
    grounding.set(q.id, await groundingForQuestion(q));
  });

  // Phase 1 — blind solve (Batch API, mixed models).
  const nSonnet = todo.filter((q) => solveModel(q) === "claude-sonnet-5").length;
  console.log(`[resolve] blind-solving ${todo.length} (${nSonnet} hard→sonnet, ${todo.length - nSonnet} →haiku) via Batch API…`);
  const reqs = todo.map((q) => ({
    customId: q.id,
    params: buildSolveParams(q, grounding.get(q.id)!),
    purpose: "audit_resolve",
  }));
  const solveResults = await runBatch(reqs, {
    onPoll: (c) =>
      process.stdout.write(`\r  batch: succeeded ${c.succeeded} · processing ${c.processing} · errored ${c.errored}   `),
    onUsage,
  });
  process.stdout.write("\n");

  const blind = new Map<string, SolveResult | null>();
  for (const q of todo) {
    const r = solveResults.get(q.id);
    if (r?.ok) {
      try {
        blind.set(q.id, JSON.parse(r.text) as SolveResult);
      } catch {
        blind.set(q.id, null);
      }
    } else {
      blind.set(q.id, null);
    }
  }

  // Phase 2 — escalate disagreements (sonnet + web_search, budget-capped).
  const disagreements = todo.filter((q) => {
    const b = blind.get(q.id);
    return b && b.chosen_key !== q.correct_option_key;
  });
  console.log(`[resolve] ${disagreements.length} blind disagreements → escalating (web_search) within budget…`);
  const escalations = new Map<string, EscalationResult | null>();
  let escalated = 0;
  for (const q of disagreements) {
    if (escalated >= maxEscalations || totalCost >= maxUsd) {
      console.log(`\n[resolve] escalation budget reached (escalated=${escalated}, cost=$${totalCost.toFixed(2)}); remaining disagreements flagged un-escalated`);
      break;
    }
    const b = blind.get(q.id)!;
    try {
      escalations.set(q.id, await escalate(q, b, onUsage));
    } catch (e) {
      escalations.set(q.id, null);
      console.error(`  escalate ${q.id} failed: ${String(e)}`);
    }
    escalated += 1;
    process.stdout.write(`\r  escalated ${escalated}/${Math.min(disagreements.length, maxEscalations)} · cost $${totalCost.toFixed(2)}   `);
  }
  process.stdout.write("\n");

  // Phase 3 — combine + upsert + collect flagged.
  const records: AuditRecord[] = [];
  const flagged: Record<string, unknown>[] = [];
  let errored = 0;
  for (const q of todo) {
    const b = blind.get(q.id);
    if (!b) {
      errored += 1;
      records.push({ question_id: q.id, audit_kind: "resolve", run_id: runId, status: "error", model: solveModel(q), detail: { error: "blind solve failed/unparseable" } });
      continue;
    }
    const esc = escalations.get(q.id) ?? null;
    const v = interpretResolve(q, b, esc);
    records.push({ question_id: q.id, audit_kind: "resolve", run_id: runId, status: v.status, model: solveModel(q), detail: v.detail });
    if (v.status === "flagged") {
      flagged.push({ id: q.id, source_kind: q.source_kind, auto_hide_eligible: v.auto_hide_eligible, ...v.detail });
      if (doHide && v.auto_hide_eligible) await hideQuestion(q.id, { kind: "resolve", run_id: runId, detail: v.detail });
    }
  }
  await upsertAuditMany(records);

  const summary = {
    run_id: runId,
    audited: todo.length,
    blind_errors: errored,
    disagreements: disagreements.length,
    escalated,
    flagged: flagged.length,
    flagged_auto_hide_eligible: flagged.filter((f) => f.auto_hide_eligible).length,
    hidden: doHide ? flagged.filter((f) => f.auto_hide_eligible).length : 0,
    total_cost_usd: Number(totalCost.toFixed(4)),
    cost_per_question_usd: Number((totalCost / todo.length).toFixed(5)),
    flagged_questions: flagged,
  };

  console.log(`\n[resolve] DONE — ${flagged.length} flagged / ${todo.length} audited · cost $${totalCost.toFixed(2)}`);
  for (const f of flagged.slice(0, 60)) {
    console.log(
      `  - ${f.id} [${f.source_kind}] stored=${f.stored_key} blind=${f.blind_key} escalated=${f.escalated_key ?? "-"} gt=${f.ground_truth} hide_eligible=${f.auto_hide_eligible}`,
    );
  }
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(summary, null, 2));
    console.log(`[resolve] wrote ${outFile}`);
  }
  console.log(`\n===RESOLVE_SUMMARY_JSON===\n${JSON.stringify({ ...summary, flagged_questions: undefined })}\n===END===`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
