/**
 * `pnpm ca:reclassify-mcq-nodes [--apply]`
 *
 * One-time backfill for the historical CA-MCQ backlog that `ca:distribute-mcqs`
 * cannot fix: those ~1170 MCQs' owning current_affairs_items were all triaged
 * BEFORE today's syllabus_candidates fix (see ca/syllabus-candidates.ts), when
 * the candidate list truncated at 260 rows ordered by paper_code — which cut
 * off 24 of PRE_GS1's 30 nodes and left the classifier with essentially no real
 * prelims topics to map onto. Re-running full triage would also re-litigate
 * category/gs_papers/mains relevance, which is out of scope and risks the
 * item's mains brief/magazine placement — this instead asks ONE narrow,
 * additive question per already-generated item: given the exact facts its MCQs
 * were written from, which single PRE_GS1 topic (if any) does it best fit?
 * Deliberately PRE_GS1 only, never PRE_CSAT — CSAT is aptitude/reasoning, never
 * a real current-affairs subject (see pickPrelimsMcqNode's comment in
 * ca/pipeline.ts, which this mirrors).
 *
 * Only touches MCQ questions currently on the pooled "Current Events" node —
 * never a question already placed elsewhere. The item's own syllabus_node_ids
 * (mains classification, magazine/related-CA display) is untouched.
 *
 * Message Batches API (0.5x) — this is a one-time backfill, not a latency-
 * sensitive path, so there's no reason to pay full sync price. Prints a cost
 * projection and requires --apply to actually spend/write.
 */
import { runBatch, structuredParams, MODELS, type BatchRequest } from "../src/lib/anthropic.js";
import { estimateCostUsd } from "../src/lib/models.js";
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";
import { loadSyllabusCandidates } from "../src/ca/syllabus-candidates.js";
import { getPrelimsCurrentAffairsNodeId } from "../src/ca/prelims-node.js";

const APPLY = process.argv.includes("--apply");

interface Item {
  id: string;
  title_i18n: { en?: string };
  prelims_facts: { fact_i18n: { en?: string } }[] | null;
  mcq_question_ids: string[];
}

/** char/4 ≈ tokens — same coarse projection heuristic as ingest:explain. */
function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function itemContent(item: Item, candidateLines: string): string {
  const facts = (item.prelims_facts ?? []).map((f) => f.fact_i18n.en ?? "").filter(Boolean);
  return (
    `Item: ${item.title_i18n.en ?? ""}\n` +
    `Facts:\n${facts.map((f) => `- ${f}`).join("\n")}\n\n` +
    `Candidate topics (id: title):\n${candidateLines}`
  );
}

const SYSTEM =
  "You are mapping an already-confirmed prelims-relevant current-affairs item to ONE specific UPPSC Prelims " +
  "General Studies Paper I curriculum topic, from the candidate list, that its facts most concretely belong to " +
  "(e.g. a scheme/appointment/report belongs to its subject area; a monument/place to History or Geography). " +
  "Choose \"none\" if the item is genuinely generic breaking news with no better specific fit than plain current " +
  "events — do not force a stretch mapping. Give a one-line reason.";

async function main(): Promise<void> {
  const pooledNode = await getPrelimsCurrentAffairsNodeId();
  if (!pooledNode) throw new Error("prelims 'Current Events' node (PRE_GS1, depth 1) not found");

  const allCandidates = await loadSyllabusCandidates();
  const prelimsCandidates = allCandidates.filter((c) => c.paperCode === "PRE_GS1" && c.id !== pooledNode);
  const candidateLines = prelimsCandidates.map((c) => `${c.id}: ${c.title}`).join("\n");
  const validIds = new Set(prelimsCandidates.map((c) => c.id));

  const pooledQuestions = await selectAll<{ id: string }>(() =>
    supabase()
      .from("questions")
      .select("id")
      .eq("paper_code", "CURRENT_AFFAIRS")
      .eq("type", "mcq")
      .eq("syllabus_node_id", pooledNode)
      .order("id", { ascending: true }),
  );
  console.log(`CA MCQs currently pooled on Current Events: ${pooledQuestions.length}`);
  if (pooledQuestions.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }
  const pooledQuestionIds = new Set(pooledQuestions.map((q) => q.id));

  const items = await selectAll<Item>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, title_i18n, prelims_facts, mcq_question_ids")
      .not("mcq_question_ids", "eq", "{}")
      .order("id", { ascending: true }),
  );

  // Only items that actually own at least one currently-pooled MCQ.
  const targets = items.filter((it) => it.mcq_question_ids.some((qId) => pooledQuestionIds.has(qId)));
  console.log(`Owning items to classify: ${targets.length} (for ${pooledQuestions.length} pooled MCQs)`);
  if (targets.length === 0) {
    console.log("No owning item found for any pooled MCQ (pre-migration remnants) — nothing to do.");
    process.exit(0);
  }

  const SYS_TOK = estTokens(SYSTEM);
  let inTok = 0;
  for (const it of targets) inTok += SYS_TOK + estTokens(itemContent(it, candidateLines));
  const outTok = targets.length * 40;
  const fullCost = estimateCostUsd(MODELS.haiku, inTok, outTok, 0, 0);
  const batchCost = fullCost * 0.5;
  console.log("\nProjected cost");
  console.log(`  model                 ${MODELS.haiku} (batch, 0.5x)`);
  console.log(`  items                 ${targets.length}`);
  console.log(`  est. input tokens     ~${inTok.toLocaleString()}`);
  console.log(`  est. output tokens    ~${outTok.toLocaleString()}`);
  console.log(`  est. cost (batch)     ~$${batchCost.toFixed(3)}  (₹${(batchCost * 84).toFixed(2)})`);

  if (!APPLY) {
    console.log("\nDRY-RUN — no spend, no writes. Re-run with --apply to classify + write.");
    process.exit(0);
  }

  const requests: BatchRequest[] = targets.map((it) => ({
    customId: it.id,
    params: structuredParams({
      model: MODELS.haiku,
      maxTokens: 300,
      system: SYSTEM,
      content: itemContent(it, candidateLines),
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          syllabus_node_id: { type: "string", enum: [...validIds, "none"] },
          reason: { type: "string" },
        },
        required: ["syllabus_node_id", "reason"],
      },
    }),
    purpose: "ca_mcq_reclassify",
  }));

  console.log(`\nSubmitting batch of ${requests.length} classification requests…`);
  const results = await runBatch(requests, {
    onPoll: (c) => console.log(`  ${c.succeeded} ok / ${c.processing} processing / ${c.errored} err`),
  });

  const targetNodeByItem = new Map<string, string>();
  let none = 0;
  let errored = 0;
  for (const it of targets) {
    const r = results.get(it.id);
    if (!r?.ok) {
      errored++;
      continue;
    }
    let parsed: { syllabus_node_id: string; reason: string };
    try {
      parsed = JSON.parse(r.text);
    } catch {
      errored++;
      continue;
    }
    if (parsed.syllabus_node_id === "none" || !validIds.has(parsed.syllabus_node_id)) {
      none++;
      continue;
    }
    targetNodeByItem.set(it.id, parsed.syllabus_node_id);
  }
  console.log(`\nClassified: ${targetNodeByItem.size} → a real topic; ${none} → stayed generic (none fit); ${errored} errored`);

  const moves: { id: string; target: string }[] = [];
  for (const it of targets) {
    const target = targetNodeByItem.get(it.id);
    if (!target) continue;
    for (const qId of it.mcq_question_ids) {
      if (pooledQuestionIds.has(qId)) moves.push({ id: qId, target });
    }
  }

  const byTarget = new Map<string, string[]>();
  for (const m of moves) byTarget.set(m.target, [...(byTarget.get(m.target) ?? []), m.id]);
  let moved = 0;
  for (const [target, ids] of byTarget) {
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { error } = await supabase().from("questions").update({ syllabus_node_id: target }).in("id", batch);
      if (error) throw new Error(`update failed: ${error.message}`);
      moved += batch.length;
    }
  }
  console.log(`\nAPPLIED: re-mapped ${moved} CA MCQs across ${byTarget.size} distinct PRE_GS1 topics.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
