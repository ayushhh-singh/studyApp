/**
 * `pnpm notes:chapter` — the multi-pass study-CHAPTER generator (real Anthropic API).
 *
 *   pnpm notes:chapter --node <uuid>                 one node
 *   pnpm notes:chapter --paper <CODE> --top N        top-N weightage nodes of a paper
 *   [--no-web]                                        skip web_search grounding/audit
 *   [--yes]                                           skip the pre-run cost-estimate confirmation
 *
 * Rollout: regenerate the top-N weightage nodes per paper as chapters. A cost
 * ESTIMATE is shown BEFORE running (per-chapter × count), gated on NOTES_CHAPTER_MAX_USD.
 * Chapters land as needs_review for the Review Queue Notes tab. When the app has no
 * Anthropic credit, author chapters via the agent + `notes:chapter:assemble` instead.
 */
import { createInterface } from "node:readline/promises";
import { resolvePaperCode, topWeightageNodes, existingNoteNodeIds } from "./generate.js";
import { generateChapterForNode, NOTES_CHAPTER_MAX_USD, type GenerateChapterResult } from "./chapter-generate.js";

/** Rough per-chapter cost for the pre-run estimate (outline+research+~6 sections+coherence+audit+translate). */
const EST_PER_CHAPTER_USD = 1.2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

async function confirm(msg: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`${msg} [y/N] `)).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const web = args["no-web"] !== true;
  const top = typeof args.top === "string" ? Math.max(1, Math.min(30, Number(args.top))) : 15;
  const nodeArg = typeof args.node === "string" ? args.node : null;
  const paperArg = typeof args.paper === "string" ? args.paper : null;

  let targets: { id: string; title: string; total: number }[] = [];
  if (paperArg || (nodeArg && !UUID_RE.test(nodeArg))) {
    const code = await resolvePaperCode(paperArg ?? (nodeArg as string));
    targets = await topWeightageNodes(code, top);
    if (targets.length === 0) throw new Error(`no weightage-ranked nodes for paper ${code}`);
    console.log(`\nnotes:chapter — top ${targets.length} weightage node(s) of ${code}:`);
    targets.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}  (${t.total} PYQs)`));
  } else if (nodeArg) {
    targets = [{ id: nodeArg, title: nodeArg, total: 0 }];
  } else {
    throw new Error("usage: notes:chapter --node <uuid> | --paper <CODE> --top N [--no-web] [--yes]");
  }

  if (args.regen !== true && targets.length > 1) {
    const existing = await existingNoteNodeIds(targets.map((t) => t.id));
    // Keep them all — a chapter can upgrade an existing digest — but note which are upgrades.
    const upgrades = targets.filter((t) => existing.has(t.id)).length;
    if (upgrades) console.log(`\n(${upgrades} of these already have a note — they will be upgraded to chapters)`);
  }

  const estimate = targets.length * EST_PER_CHAPTER_USD;
  console.log(`\nweb research: ${web ? "on" : "off"}`);
  console.log(`estimated cost: ~$${estimate.toFixed(2)} (≈ ₹${(estimate * 86).toFixed(0)}) for ${targets.length} chapter(s), cap $${NOTES_CHAPTER_MAX_USD}/chapter`);
  if (args.yes !== true && !(await confirm("Proceed?"))) {
    console.log("aborted.");
    return;
  }

  const results: GenerateChapterResult[] = [];
  for (const [i, t] of targets.entries()) {
    console.log(`\n[${i + 1}/${targets.length}] ${t.title}`);
    try {
      results.push(await generateChapterForNode(t.id, { web }, (m) => console.log(m)));
    } catch (err) {
      console.error(`  ✗ failed: ${(err as Error).message}`);
    }
  }

  console.log("\n─── Summary ───");
  let cost = 0;
  for (const r of results) {
    cost += r.costUsd;
    console.log(
      `  ${r.nodeTitle}: ${r.sectionCount} sections, ${r.factCount} facts ` +
        `(${r.factSummary.flagged + r.factSummary.unverifiable} to review), $${r.costUsd.toFixed(4)}`,
    );
  }
  console.log(`\n  ${results.length} chapter(s) → needs_review · total $${cost.toFixed(4)} (≈ ₹${(cost * 86).toFixed(2)})`);
  console.log("  Review + publish at /<locale>/review (Notes tab), then run pnpm notes:embed.");
}

main().catch((err) => {
  console.error("\nnotes:chapter failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
