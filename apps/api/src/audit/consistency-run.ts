/**
 * pnpm audit:consistency [--limit N] [--run-id ID] [--hide] [--out FILE]
 *
 * Runs the consistency sweep over every published MCQ: structural/permutation
 * integrity (code) for all, plus an explanation-vs-key check (haiku, Batch API)
 * for those that have an explanation. Records a question_audits row per question
 * (resumable via --run-id; a re-run under the same id skips already-audited ids).
 *
 * Read-only by default — it produces the flagged list without touching the bank.
 * Pass --hide to also unpublish + queue each flagged question (needs_review).
 */
import { writeFileSync } from "node:fs";
import { runBatch } from "../lib/anthropic.js";
import { MODELS } from "../lib/models.js";
import { loadPublishedMcqs, upsertAuditMany, alreadyAudited, hideQuestion, type AuditRecord } from "./shared.js";
import {
  structuralCheck,
  hasExplanation,
  buildArguedParams,
  interpretConsistency,
  type ArguedResult,
} from "./consistency.js";

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const runId = argVal(args, "--run-id") ?? "consistency-1";
  const limitStr = argVal(args, "--limit");
  const limit = limitStr ? Number(limitStr) : undefined;
  const doHide = args.includes("--hide");
  const outFile = argVal(args, "--out");

  console.log(`[consistency] run_id=${runId} hide=${doHide}`);
  let questions = await loadPublishedMcqs();
  if (limit) questions = questions.slice(0, limit);
  const done = await alreadyAudited("consistency", runId);
  const todo = questions.filter((q) => !done.has(q.id));
  console.log(
    `[consistency] ${questions.length} published MCQs · ${todo.length} to audit · ${done.size} already done this run`,
  );
  if (todo.length === 0) {
    console.log("[consistency] nothing to do.");
    return;
  }

  // 1. structural (code) for all
  const structurals = new Map(todo.map((q) => [q.id, structuralCheck(q)] as const));

  // 2. explanation-vs-key (haiku, Batch API) for those with an explanation
  const withExpl = todo.filter(hasExplanation);
  console.log(`[consistency] ${withExpl.length}/${todo.length} have explanations → batching haiku argued-key calls`);
  const argued = new Map<string, ArguedResult | null>();
  let batchCost = 0;
  if (withExpl.length > 0) {
    const reqs = withExpl.map((q) => ({ customId: q.id, params: buildArguedParams(q), purpose: "audit_consistency" }));
    const results = await runBatch(reqs, {
      onPoll: (c) =>
        process.stdout.write(`\r  batch: succeeded ${c.succeeded} · processing ${c.processing} · errored ${c.errored}   `),
      onUsage: (u) => {
        batchCost += u.costUsd;
      },
    });
    process.stdout.write("\n");
    for (const q of withExpl) {
      const r = results.get(q.id);
      if (r?.ok) {
        try {
          argued.set(q.id, JSON.parse(r.text) as ArguedResult);
        } catch {
          argued.set(q.id, null);
        }
      } else {
        argued.set(q.id, null);
      }
    }
    console.log(`[consistency] argued-key batch cost ~$${batchCost.toFixed(4)} (batch-discounted)`);
  }

  // 3. combine + upsert + collect flagged
  const records: AuditRecord[] = [];
  const flagged: Record<string, unknown>[] = [];
  for (const q of todo) {
    const s = structurals.get(q.id)!;
    const a = hasExplanation(q) ? argued.get(q.id) ?? null : null;
    const v = interpretConsistency(q, s, a);
    records.push({
      question_id: q.id,
      audit_kind: "consistency",
      run_id: runId,
      status: v.status,
      model: hasExplanation(q) ? MODELS.haiku : null,
      detail: v.detail,
    });
    if (v.status === "flagged") {
      flagged.push({ id: q.id, source_kind: q.source_kind, ...v.detail });
      if (doHide) await hideQuestion(q.id, { kind: "consistency", run_id: runId, detail: v.detail });
    }
  }
  await upsertAuditMany(records);

  const flaggedCount = flagged.length;
  const summary = {
    run_id: runId,
    audited: todo.length,
    with_explanation: withExpl.length,
    flagged: flaggedCount,
    ok: todo.length - flaggedCount,
    hidden: doHide ? flaggedCount : 0,
    batch_cost_usd: Number(batchCost.toFixed(4)),
    flagged_questions: flagged,
  };

  console.log(`\n[consistency] DONE — ${flaggedCount} flagged / ${todo.length} audited${doHide ? ` (${flaggedCount} hidden)` : " (read-only)"}`);
  if (flaggedCount > 0) {
    console.log("[consistency] flagged:");
    for (const f of flagged.slice(0, 50)) {
      const reason = f.explanation_mismatch
        ? `explanation argues ${f.argued_key} but key is ${f.stored_key}`
        : `structural: ${(f.structural_issues as string[]).join(", ")}`;
      console.log(`  - ${f.id} [${f.source_kind}] ${reason}`);
    }
  }
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(summary, null, 2));
    console.log(`[consistency] wrote ${outFile}`);
  }
  console.log(`\n===CONSISTENCY_SUMMARY_JSON===\n${JSON.stringify(summary)}\n===END===`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
