/**
 * ingest:resolve — the Session-27 blind re-solve gate, run over PARSED PYQ JSON
 * (before load) so a mis-keyed / series-mismatched / unkeyed MCQ can be caught
 * BEFORE it reaches the live bank.
 *
 *   pnpm ingest:resolve --id uppsc_prelims_2024_gs1     (one parsed file)
 *   pnpm ingest:resolve --all                            (every parsed/pyq_*.json prelims file)
 *   flags: --force (re-resolve already-resolved rows), --no-escalate (skip the
 *          sonnet+web_search tie-break), --concurrency N (grounding fan-out)
 *
 * For each MCQ it INDEPENDENTLY solves the question (no stored key/explanation),
 * grounded in RAG passages, via the batch API (0.5x). A disagreement with the
 * stored key escalates to one sonnet solve that must web-verify the decisive
 * fact. The verdict is written into the question's meta.blind_resolve; ingest:
 * pyq:load reads it to decide auto-publish vs Review Queue. This file NEVER
 * writes to the questions table — it only annotates the parsed JSON.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { runBatch, type BatchRequest } from "../lib/anthropic.js";
import {
  buildSolveParams,
  escalate,
  groundingForQuestion,
  interpretResolve,
  type SolveResult,
} from "../audit/resolve.js";
import type { AuditQuestion } from "../audit/shared.js";
import { pMap } from "../audit/shared.js";
import { listParsed, parseArgs, report } from "./_shared.js";

interface ParsedQ {
  external_id: string;
  type: "mcq" | "descriptive";
  paper_code: string;
  year: number;
  difficulty: "easy" | "medium" | "hard";
  syllabus_path: string | null;
  stem_i18n: { hi: string; en: string };
  options_i18n: { key: string; text_i18n: { hi: string; en: string } }[] | null;
  correct_option_key: string | null;
  meta: Record<string, unknown>;
}
interface ParsedFile {
  source: { manifest_id: string };
  summary?: Record<string, unknown>;
  questions: ParsedQ[];
}

/** Map a parsed question onto the AuditQuestion shape the resolver expects. */
function toAudit(q: ParsedQ): AuditQuestion {
  return {
    id: q.external_id,
    paper_code: q.paper_code,
    syllabus_node_id: null, // node id isn't assigned until load; grounding falls back to global top-k
    source_kind: (q.meta.source_kind as string) ?? null,
    difficulty: q.difficulty,
    year: q.year,
    stem_i18n: q.stem_i18n,
    options_i18n: q.options_i18n,
    correct_option_key: q.correct_option_key,
    explanation_i18n: null,
    meta: q.meta,
  };
}

function isSolvable(q: ParsedQ): boolean {
  return q.type === "mcq" && !!q.options_i18n && q.options_i18n.length >= 2;
}

async function resolveFile(
  file: string,
  opts: { force: boolean; escalate: boolean; concurrency: number },
): Promise<{ solved: number; agree: number; flagged: number; noKey: number; skipped: number }> {
  const data = JSON.parse(await readFile(file, "utf8")) as ParsedFile;
  const targets = data.questions.filter(
    (q) => isSolvable(q) && (opts.force || !q.meta.blind_resolve),
  );
  const skipped = data.questions.filter((q) => isSolvable(q)).length - targets.length;
  if (targets.length === 0) return { solved: 0, agree: 0, flagged: 0, noKey: 0, skipped };

  // 1. Grounding (OpenAI embed per q — cheap; bounded fan-out).
  report.step(`retrieving grounding for ${targets.length} MCQs…`);
  const groundings = await pMap(targets, opts.concurrency, (q) => groundingForQuestion(toAudit(q)));

  // 2. Blind solve — batched (0.5x). custom_id = external_id.
  report.step("submitting blind-solve batch (claude-haiku/sonnet, 0.5x)…");
  const requests: BatchRequest[] = targets.map((q, i) => ({
    customId: q.external_id,
    params: buildSolveParams(toAudit(q), groundings[i]),
    purpose: "ingest_blind_solve",
  }));
  const results = await runBatch(requests, {
    onPoll: (c) =>
      report.step(`  batch: ${c.succeeded} ok / ${c.processing} processing / ${c.errored} errored`),
  });

  // 3. Interpret + escalate disagreements.
  let agree = 0;
  let flagged = 0;
  let noKey = 0;
  const idx = new Map(data.questions.map((q, i) => [q.external_id, i]));
  await pMap(targets, 3, async (q) => {
    const r = results.get(q.external_id);
    const audit = toAudit(q);
    const at = idx.get(q.external_id)!;
    const target = data.questions[at];
    if (!r || !r.ok) {
      target.meta.blind_resolve = { status: "error", error: r?.error ?? "no batch result" };
      return;
    }
    let blind: SolveResult;
    try {
      blind = JSON.parse(r.text) as SolveResult;
    } catch {
      target.meta.blind_resolve = { status: "error", error: "unparseable solve result" };
      return;
    }
    blind.chosen_key = (blind.chosen_key ?? "").toUpperCase();

    const storedKey = q.correct_option_key;
    // No trustworthy stored key (no official series-aligned key): blind-resolve
    // PROPOSES the answer; it publishes only via human review (answer_key_verified stays false).
    if (!storedKey || q.meta.answer_key_verified !== true) {
      noKey++;
      // Fill an empty extracted key with the blind proposal so the row has an answer to show.
      if (!target.correct_option_key) target.correct_option_key = blind.chosen_key;
      target.meta.blind_resolve = {
        status: "no_key",
        proposed_key: blind.chosen_key,
        stored_key: storedKey,
        confidence: blind.confidence,
        decisive_facts: blind.decisive_facts,
        agrees: storedKey ? blind.chosen_key === storedKey : null,
      };
      return;
    }

    // Keyed path: agreement → ok; disagreement → escalate (unless disabled).
    let escalation = null;
    if (blind.chosen_key !== storedKey && opts.escalate) {
      try {
        escalation = await escalate(audit, blind);
      } catch (e) {
        escalation = null;
        report.warn(`escalation failed for ${q.external_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    const verdict = interpretResolve(audit, blind, escalation);
    target.meta.blind_resolve = {
      status: verdict.status, // "ok" | "flagged" | "error"
      chosen_key: blind.chosen_key,
      stored_key: storedKey,
      confidence: blind.confidence,
      agrees: verdict.status === "ok",
      escalated: escalation !== null,
      escalated_key: escalation?.final_key ?? null,
      detail: verdict.detail,
    };
    if (verdict.status === "ok") agree++;
    else if (verdict.status === "flagged") flagged++;
  });

  data.summary = {
    ...(data.summary ?? {}),
    blind_resolve: { solved: targets.length, agree, flagged, no_key: noKey },
  };
  await writeFile(file, JSON.stringify(data, null, 2));
  return { solved: targets.length, agree, flagged, noKey, skipped };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  report.section("ingest:resolve — blind re-solve gate (parsed JSON → meta.blind_resolve)");
  let files: string[];
  if (args.all) files = await listParsed("pyq_");
  else if (typeof args.id === "string") files = await listParsed(`pyq_${args.id}`);
  else throw new Error("Provide --id <manifest_id> or --all.");
  if (files.length === 0) throw new Error("No parsed/pyq_*.json files found. Run ingest:pyq first.");

  const opts = {
    force: !!args.force,
    escalate: !args["no-escalate"],
    concurrency: typeof args.concurrency === "string" ? Number(args.concurrency) : 6,
  };

  let T = { solved: 0, agree: 0, flagged: 0, noKey: 0, skipped: 0 };
  for (const f of files) {
    // Only prelims MCQ files have solvable content; descriptive files no-op.
    const r = await resolveFile(f, opts);
    if (r.solved > 0 || r.skipped > 0) {
      report.ok(
        `${basename(f)}: solved ${r.solved} (agree ${r.agree}, flagged ${r.flagged}, no-key ${r.noKey}` +
          `${r.skipped ? `, skipped ${r.skipped} already-resolved` : ""})`,
      );
    }
    T = {
      solved: T.solved + r.solved,
      agree: T.agree + r.agree,
      flagged: T.flagged + r.flagged,
      noKey: T.noKey + r.noKey,
      skipped: T.skipped + r.skipped,
    };
  }
  report.section("Summary");
  report.ok(`MCQs re-solved: ${T.solved}`);
  report.ok(`  agree with official key (auto-publish eligible): ${T.agree}`);
  report.ok(`  FLAGGED disagreement (→ Review Queue): ${T.flagged}`);
  report.ok(`  no trusted key (→ Review Queue, blind-proposed answer): ${T.noKey}`);
}

main().catch((err) => {
  console.error("\ningest:resolve failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
