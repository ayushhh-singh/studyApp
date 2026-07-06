/**
 * `pnpm notes:gen` — the study-notes generation CLI.
 *
 *   pnpm notes:gen --node <uuid>                 generate a note for one node
 *   pnpm notes:gen --paper <PAPER_CODE> --top N  top-N weightage nodes of a paper
 *   pnpm notes:gen --node <PAPER_CODE> --top N    (paper code also accepted on --node)
 *   [--no-web]                                    skip the web_search research stage
 *
 * Notes land as status='needs_review' for the Review Queue Notes tab
 * (/:locale/review with ADMIN_MODE=true). Coverage is chosen by Session-12
 * weightage, not alphabetically — the top-weightage nodes get notes first.
 */
import {
  generateNoteForNode,
  resolvePaperCode,
  topWeightageNodes,
  type GenerateNoteResult,
} from "./generate.js";

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

const log = (msg: string) => console.log(msg);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const web = args["no-web"] !== true;
  const top = typeof args.top === "string" ? Math.max(1, Math.min(30, Number(args.top))) : 15;

  const nodeArg = typeof args.node === "string" ? args.node : null;
  const paperArg = typeof args.paper === "string" ? args.paper : null;

  // Resolve the target node id list.
  let targets: { id: string; title: string; total: number }[] = [];
  if (paperArg || (nodeArg && !UUID_RE.test(nodeArg))) {
    const code = await resolvePaperCode(paperArg ?? (nodeArg as string));
    targets = await topWeightageNodes(code, top);
    if (targets.length === 0) throw new Error(`no weightage-ranked nodes found for paper ${code}`);
    console.log(`\nnotes:gen — top ${targets.length} weightage node(s) of ${code}:`);
    targets.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}  (${t.total} PYQs)`));
  } else if (nodeArg) {
    targets = [{ id: nodeArg, title: nodeArg, total: 0 }];
  } else {
    throw new Error("usage: notes:gen --node <uuid> | --paper <PAPER_CODE> --top N [--no-web]");
  }

  console.log(`\nweb research: ${web ? "on" : "off"}\n`);

  const results: GenerateNoteResult[] = [];
  for (const [i, t] of targets.entries()) {
    console.log(`[${i + 1}/${targets.length}] ${t.title}`);
    try {
      results.push(await generateNoteForNode(t.id, { web }, log));
    } catch (err) {
      console.error(`  ✗ failed: ${(err as Error).message}`);
    }
  }

  // Report.
  console.log("\n─── Summary ───");
  let cost = 0;
  for (const r of results) {
    cost += r.costUsd;
    const flags = r.critic?.factual_red_flags?.length ?? 0;
    console.log(
      `  ${r.nodeTitle}: ${r.keyFactCount} facts, ${r.srsCandidateCount} SRS cards, ` +
        `web=${r.webSearchUsed ? "y" : "n"}, critic ${r.critic?.approve ? "approve" : "flag"}` +
        `${flags ? ` (${flags} red flag${flags > 1 ? "s" : ""})` : ""}, $${r.costUsd.toFixed(4)}`,
    );
  }
  console.log(`\n  ${results.length} note(s) → needs_review · total $${cost.toFixed(4)} (≈ ₹${(cost * 86).toFixed(2)})`);
  console.log("  Review + publish at /<locale>/review (Notes tab, ADMIN_MODE=true).");
}

main().catch((err) => {
  console.error("\nnotes:gen failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
