/**
 * prove-chapter-retrieval — the credit-free half of the "mentor cites a chapter"
 * proof (Session 28). Given a doubt-style question, it runs the EXACT retrieval
 * the mentor runs (OpenAI-embed the question → match_embeddings global pass, no
 * Anthropic call) and shows that a published chapter's per-SECTION note chunk is
 * retrieved and would resolve to a `[n]` citation with the note's deep link.
 *
 * The mentor's final streamed ANSWER is a Sonnet call (needs Anthropic credit);
 * this proves everything up to that: the section chunk exists, embeds, and is the
 * top hit for a relevant doubt.
 *
 *   pnpm --filter api tsx scripts/prove-chapter-retrieval.ts --node <uuid> --q "question"
 */
import { supabase } from "../src/lib/supabase.js";
import { embeddings } from "../src/lib/embeddings.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const nodeId = arg("node");
  const question = arg("q") ?? "";
  const locale = (arg("locale") as "hi" | "en") ?? "en";
  if (!nodeId || !question) throw new Error('usage: --node <uuid> --q "question" [--locale en|hi]');

  const { data: note } = await supabase()
    .from("notes")
    .select("id, chapter_version, syllabus_nodes(paper_code)")
    .eq("syllabus_node_id", nodeId)
    .eq("status", "published")
    .maybeSingle();
  if (!note) throw new Error(`no published note for node ${nodeId}`);
  const noteId = (note as { id: string }).id;
  const sn = (note as { syllabus_nodes: { paper_code: string } | { paper_code: string }[] }).syllabus_nodes;
  const paper = Array.isArray(sn) ? sn[0]?.paper_code : sn?.paper_code;

  console.log(`Question: "${question}" (${locale})`);
  console.log(`Target chapter note: ${noteId} (node ${nodeId}, chapter_version ${(note as { chapter_version: number }).chapter_version})\n`);

  const [vec] = await embeddings().embed([question.replace(/\s+/g, " ").trim()]);
  const { data: rows, error } = await supabase().rpc("match_embeddings", {
    query_embedding: `[${vec.join(",")}]`,
    match_count: 8,
    filter_locale: locale,
    filter_source_type: null, // the mentor's global pass — notes are eligible
    filter_source_id: null,
  });
  if (error) throw new Error(`match_embeddings failed: ${error.message}`);

  const results = (rows ?? []) as { source_type: string; source_id: string; chunk_text: string; similarity: number }[];
  console.log("Top matches (mentor global retrieval pass):");
  let rank = 0;
  let hit: (typeof results)[number] | null = null;
  for (const r of results) {
    rank++;
    const mine = r.source_type === "note" && r.source_id === noteId;
    if (mine && !hit) hit = r;
    console.log(
      `  [${rank}] ${mine ? "★" : " "} ${r.source_type.padEnd(16)} sim=${r.similarity.toFixed(3)}  ${r.chunk_text.slice(0, 90).replace(/\s+/g, " ")}…`,
    );
  }

  console.log("");
  if (hit) {
    console.log(`✓ PROVED: the chapter's section chunk is retrieved (rank ${results.indexOf(hit) + 1}, sim ${hit.similarity.toFixed(3)}).`);
    console.log(`  Chunk (heading-prefixed section): "${hit.chunk_text.slice(0, 160).replace(/\s+/g, " ")}…"`);
    console.log(`  Mentor would cite it as [${results.indexOf(hit) + 1}] → link /learn/${paper}/${nodeId}?tab=notes`);
    process.exit(0);
  } else {
    console.log("✗ The target chapter's chunk did not appear in the top 8 — try a more on-topic question or re-run notes:embed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("prove-chapter-retrieval failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
