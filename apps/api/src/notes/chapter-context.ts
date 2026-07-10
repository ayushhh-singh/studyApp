/**
 * `pnpm notes:chapter:context --node <uuid|PAPER_CODE> [--top N] [--out <path>]`
 *
 * Dumps the exact CONTEXT PACK the chapter pipeline feeds its outline/section
 * passes (node + sub-topics + weightage-by-year + real PYQs with ids + RAG
 * grounding) as JSON. Used to author a chapter OUTSIDE the app's Anthropic API
 * (agent + web tools) with byte-identical inputs, then load via
 * notes:chapter:assemble. A real-API run gets the same pack from loadChapterContext.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadChapterContext } from "./chapter-generate.js";
import { resolvePaperCode, topWeightageNodes } from "./generate.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "";
  return out;
}

export async function buildContextPack(nodeId: string): Promise<Record<string, unknown>> {
  const { node, weightage, pyqs, grounding, nodeIds } = await loadChapterContext(nodeId);
  return {
    node_id: node.id,
    paper_code: node.paperCode,
    stage: node.stage,
    title_en: node.title_en,
    description_en: node.description_en,
    child_titles: node.childTitles,
    subtree_node_count: nodeIds.length,
    weightage: { total_pyqs: weightage.totalPyqs, by_year: weightage.byYear, last_asked_year: weightage.lastAskedYear },
    pyqs: pyqs.map((p) => ({ n: p.n, id: p.id, year: p.year, stem_en: p.stem_en, explanation_en: p.explanation_en })),
    grounding: grounding.chunks.map((c) => ({ source_type: c.source_type, chunk_text: c.chunk_text })),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const nodeArg = args.node;
  if (!nodeArg) throw new Error("usage: notes:chapter:context --node <uuid|PAPER_CODE> [--top N] [--out <path>] [--dir <dir>]");

  let nodeIds: { id: string; title: string }[] = [];
  if (UUID_RE.test(nodeArg)) {
    nodeIds = [{ id: nodeArg, title: nodeArg }];
  } else {
    const code = await resolvePaperCode(nodeArg);
    const top = args.top ? Number(args.top) : 15;
    nodeIds = (await topWeightageNodes(code, top)).map((t) => ({ id: t.id, title: t.title }));
  }

  const dir = args.dir || null;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const { id, title } of nodeIds) {
    const pack = await buildContextPack(id);
    const json = JSON.stringify(pack, null, 2);
    if (dir) {
      writeFileSync(join(dir, `${id}.json`), json);
      console.error(`✓ ${title} → ${id}.json (${(pack.pyqs as unknown[]).length} PYQs, ${(pack.grounding as unknown[]).length} chunks)`);
    } else if (args.out) {
      writeFileSync(args.out, json);
      console.error(`✓ wrote ${args.out}`);
    } else {
      process.stdout.write(json + "\n");
    }
  }
}

main().catch((err) => {
  console.error("notes:chapter:context failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
