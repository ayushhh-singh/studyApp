/**
 * `pnpm qgen` — the question-generation CLI.
 *
 *   pnpm qgen --node <uuid|PAPER_CODE> --count N --kind mcq|descriptive [--batch] [--difficulty e:m:h]
 *   pnpm qgen:topup [--max-usd N] [--kind mcq|descriptive] [--dry-run]
 *
 * Single-node runs are synchronous (structuredJson). --batch and the nightly
 * top-up use the Message-Batches path (50% cheaper). Survivors land as
 * review_state='needs_review' for the Review Queue (/:locale/review).
 */
import { supabase } from "../lib/supabase.js";
import {
  generateBatch,
  generateForNode,
  loadNodeContext,
  type DifficultyMix,
  type GeneratePlan,
  type NodeGenerationResult,
} from "./generate.js";
import { runTopup } from "./topup.js";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

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
  const args = parseArgs(process.argv.slice(2));

  if (args.topup) {
    const maxUsd = typeof args["max-usd"] === "string" ? Number(args["max-usd"]) : Number(process.env.QGEN_BATCH_MAX_USD ?? 5);
    const only = args.kind === "mcq" || args.kind === "descriptive" ? (args.kind as "mcq" | "descriptive") : undefined;
    console.log(`qgen:topup — budget $${maxUsd.toFixed(2)}${only ? ` (kind=${only})` : ""}${args["dry-run"] ? " [dry run]" : ""}`);
    const res = await runTopup({ maxUsd, only, dryRun: !!args["dry-run"] }, (m) => console.log(m));
    if (!args["dry-run"]) reportResults(res.results);
    console.log(`\nPlanned ${res.planned} shortfall nodes; ran ${res.requested} questions; deferred ${res.dropped} nodes to budget.`);
    return;
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
