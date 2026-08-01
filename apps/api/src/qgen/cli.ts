/**
 * `pnpm qgen` — the question-generation CLI.
 *
 *   pnpm qgen --node <uuid|PAPER_CODE> --count N --kind mcq|descriptive [--batch] [--difficulty e:m:h]
 *   pnpm qgen:topup [--max-usd N] [--kind mcq|descriptive] [--exam <code>] [--dry-run]
 *
 * Single-node runs are synchronous (structuredJson). --batch and the nightly
 * top-up use the Message-Batches path (50% cheaper). Survivors land as
 * review_state='needs_review' for the Review Queue (/:locale/review).
 */
import { parseArgs } from "../ingest/_shared.js";
import { supabase } from "../lib/supabase.js";
import { listExams } from "../lib/exams.js";
import {
  generateBatch,
  generateForNode,
  loadNodeContext,
  type DifficultyMix,
  type GeneratePlan,
  type NodeGenerationResult,
} from "./generate.js";
import { runTopup } from "./topup.js";

/**
 * Every flag this CLI reads, surveyed from the actual `args.*` accesses in
 * `main()` — see the usage lines in the header comment.
 *
 * This file used to carry its OWN copy of the old unsafe parser, which made it
 * the single most dangerous instance in the repo: a collapsed argv token (zsh
 * does not word-split an unquoted `$var`) defeated `--max-usd` AND `--dry-run`
 * at once, silently turning a capped dry run into a real, billed batch-
 * generation run that writes `questions` rows.
 */
const QGEN_FLAGS = {
  // `--exam` is TOPUP-ONLY (see `resolveTopupExams`); a single-node run takes its
  // exam from the node itself, so passing both is rejected rather than ignored.
  value: ["node", "kind", "difficulty", "exam"],
  // `--topup` is PRE-SUPPLIED by the `qgen:topup` pnpm script, so it must stay
  // declared here or that scheduled/CI entry point breaks immediately.
  boolean: ["topup", "batch", "dry-run"],
  positiveInt: ["count"],
  // A dollar budget — fractional values like `--max-usd 2.5` are valid, so this
  // must NOT be positiveInt.
  positiveNumber: ["max-usd"],
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve --node: a syllabus node uuid, or a paper code → that paper's root (depth-0) node. */
async function resolveNodeId(nodeArg: string): Promise<string> {
  if (UUID_RE.test(nodeArg)) return nodeArg;
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id")
    .eq("paper_code", nodeArg)
    .eq("depth", 0)
    .maybeSingle();
  if (error) throw new Error(`paper root lookup failed: ${error.message}`);
  if (!data) {
    const { data: papers } = await supabase().from("syllabus_nodes").select("paper_code").eq("depth", 0);
    const codes = [...new Set((papers ?? []).map((p) => p.paper_code as string))].sort();
    throw new Error(`No node/paper "${nodeArg}". Pass a node uuid or a paper code: ${codes.join(", ")}`);
  }
  return data.id as string;
}

/**
 * Which exams tonight's top-up plans for. THE EXAM-SELECTION POLICY LIVES HERE,
 * deliberately — `runTopup` takes `examCodes` as a REQUIRED parameter precisely
 * so this decision cannot hide behind a default nobody has to think about (M24;
 * a defaulted `examCode` is exactly what kept the planner pinned to uppsc while
 * looking parameterised).
 *
 * DEFAULT = every LIVE exam, not every registered one. A reference exam (`upsc`
 * and `mppsc` today, `is_live = false`) is one no user can select, so generating
 * for it is real nightly spend on a bank nobody can reach. Measured today the
 * live set is exactly `["uppsc"]`, so the scheduled cron
 * (`.github/workflows/qgen-topup.yml`, which passes no `--exam`) plans EXACTLY
 * the papers it planned before the multi-exam change — the second exam costs
 * nothing until it either goes live or is named explicitly.
 *
 * Reads the registry through `listExams` rather than `liveExamCodes` because the
 * override path needs the SAME rows to validate the code and to report whether
 * it is live; one query answers both instead of two that could disagree.
 *
 * `--exam <code>` is that explicit naming, and it is allowed to name a NON-live
 * exam on purpose: stocking a bank BEFORE launch is the real use case (`upsc`
 * has a 202-node tree and a real PYQ bank while still being unselectable). It is
 * only ever ONE exam — a multi-exam override would need a shared-budget policy
 * argument, and the live set already covers "several".
 *
 * ⚑ VALIDATED AGAINST THE REGISTRY, never passed through. `getExamConfig` does
 * NOT throw on an unknown code — it logs a warn and FALLS BACK to the default
 * exam — so `--exam upcs` would silently plan UPPSC's papers under the wrong
 * label and generate real questions against them. That is the same
 * silently-wrong-scope class this whole change closes, so a typo dies here.
 */
async function resolveTopupExams(examArg: string | boolean | undefined, log: (m: string) => void): Promise<string[]> {
  const registry = await listExams();

  if (typeof examArg === "string") {
    const hit = registry.find((e) => e.exam_code === examArg);
    if (!hit) {
      const codes = registry.map((e) => e.exam_code).sort().join(", ");
      throw new Error(`Unknown --exam "${examArg}". Registered exams: ${codes}`);
    }
    if (!hit.is_live) {
      // Not an error — but never silent. Generating for an unselectable exam is
      // a deliberate pre-launch act, and the operator should see that it was.
      log(`--exam ${examArg}: this exam is NOT live (no user can select it yet) — generating anyway, as explicitly named.`);
    }
    return [examArg];
  }

  const live = registry.filter((e) => e.is_live).map((e) => e.exam_code);
  if (live.length === 0) {
    // A zero-plan run and a "nothing is below floor" run are indistinguishable
    // in the output, so refuse rather than exit 0 having done nothing.
    throw new Error("No exam has exams.is_live = true, so there is nothing to top up. Pass --exam <code> to override.");
  }
  return live;
}

function parseDifficulty(v: string | boolean | undefined): DifficultyMix | undefined {
  if (typeof v !== "string") return undefined;
  const [e, m, h] = v.split(":").map(Number);
  const total = (e || 0) + (m || 0) + (h || 0);
  if (!total) return undefined;
  return { easy: (e || 0) / total, medium: (m || 0) / total, hard: (h || 0) / total };
}

function reportResults(results: NodeGenerationResult[]): void {
  console.log("\n" + "─".repeat(64));
  let totRequested = 0;
  let totGenerated = 0;
  let totAccepted = 0;
  let totCost = 0;
  for (const r of results) {
    totRequested += r.requested;
    totGenerated += r.generated;
    totAccepted += r.accepted;
    totCost += r.costUsd;
    const rate = r.generated ? Math.round((r.accepted / r.generated) * 100) : 0;
    console.log(
      `  ${r.nodeTitle.slice(0, 44).padEnd(44)} ${r.kind.padEnd(11)} accepted ${String(r.accepted).padStart(2)}/${String(
        r.generated,
      ).padStart(2)} (${rate}%)  $${r.costUsd.toFixed(4)}`,
    );
  }
  console.log("─".repeat(64));
  const rate = totGenerated ? Math.round((totAccepted / totGenerated) * 100) : 0;
  const perAccepted = totAccepted ? totCost / totAccepted : 0;
  console.log(
    `  TOTAL requested=${totRequested} generated=${totGenerated} accepted=${totAccepted} (${rate}% approvable-untouched) cost=$${totCost.toFixed(
      4,
    )}`,
  );
  console.log(`  Cost per accepted question: $${perAccepted.toFixed(4)} (~₹${(perAccepted * 86).toFixed(2)})`);
  console.log(`  Review them at /<locale>/review (sign in as an admin — users_profile.is_admin).`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), QGEN_FLAGS, "qgen");

  if (args.topup) {
    const maxUsd = typeof args["max-usd"] === "string" ? Number(args["max-usd"]) : Number(process.env.QGEN_BATCH_MAX_USD ?? 5);
    const only = args.kind === "mcq" || args.kind === "descriptive" ? (args.kind as "mcq" | "descriptive") : undefined;
    const examCodes = await resolveTopupExams(args.exam, (m) => console.log(m));
    // ⚑ ONE budget for the WHOLE run, not one per exam — `runTopup` plans every
    // exam first (reads only) and trims the combined list once. The cron passes a
    // single QGEN_BATCH_MAX_USD and that must stay the ceiling however many exams
    // are live, or enabling a second exam silently doubles the nightly spend cap.
    console.log(`qgen:topup — budget $${maxUsd.toFixed(2)} shared across ${examCodes.length} exam(s)${only ? ` (kind=${only})` : ""}${args["dry-run"] ? " [dry run]" : ""}`);
    const res = await runTopup({ maxUsd, examCodes, only, dryRun: !!args["dry-run"] }, (m) => console.log(m));
    if (!args["dry-run"]) reportResults(res.results);
    console.log(`\nPlanned ${res.planned} shortfall nodes; ran ${res.requested} questions; deferred ${res.dropped} nodes to budget.`);
    return;
  }

  if (typeof args.exam === "string") {
    // A silently-ignored flag is the same failure class as a silently-defaulted
    // one: the operator believes they scoped the run and nothing did. A
    // single-node run's exam is a property of the node, not a choice.
    throw new Error("--exam applies to --topup only; a single-node run takes its exam from the node itself.");
  }
  if (typeof args.node !== "string") {
    throw new Error("Usage: pnpm qgen --node <uuid|PAPER_CODE> --count N --kind mcq|descriptive [--batch] [--difficulty e:m:h]");
  }
  const kind = args.kind === "descriptive" ? "descriptive" : "mcq";
  const count = Math.max(1, Math.min(60, Number(args.count) || 10));
  const nodeId = await resolveNodeId(args.node);
  const node = await loadNodeContext(nodeId);
  const plan: GeneratePlan = { node, count, kind, difficultyMix: parseDifficulty(args.difficulty) };

  console.log(`qgen — ${kind} ×${count} for "${node.title_i18n.en}" (${node.paperCode})${args.batch ? " [batch]" : " [sync]"}`);
  const results = args.batch ? await generateBatch([plan], (m) => console.log(m)) : [await generateForNode(plan, (m) => console.log(m))];
  reportResults(results);
}

main().catch((err) => {
  console.error("\nqgen failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
