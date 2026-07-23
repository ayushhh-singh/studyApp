/**
 * `pnpm ca:distribute-mcqs [--apply]`
 *
 * One-time backfill, the counterpart to `ca:remap-prelims` (which pooled every
 * CA MCQ onto the prelims "Current Events" node). `ca:run` now maps each NEW
 * CA MCQ to whichever real prelims topic triage's own classification points at
 * (see `pickPrelimsMcqNode` in ca/pipeline.ts), falling back to the pooled
 * "Current Events" node only when triage found no prelims match at all — this
 * catches the existing backlog that's still sitting on the pooled node from
 * before that change, so the custom-set builder's "+N AI" count is spread
 * across topics instead of stacked entirely on one row.
 *
 * A question has no direct back-reference to the current_affairs_items row it
 * came from (only the item's own `mcq_question_ids` array points at it), so
 * this loads every item with a non-empty `mcq_question_ids` and inverts that
 * into a question_id -> item map first.
 *
 * Only touches questions whose syllabus_node_id currently IS the pooled node
 * (never a question someone/something else already placed elsewhere).
 * Idempotent; dry-run unless --apply.
 */
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";
import { getPrelimsCurrentAffairsNodeId } from "../src/ca/prelims-node.js";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const pooledNode = await getPrelimsCurrentAffairsNodeId();
  if (!pooledNode) throw new Error("prelims 'Current Events' node (PRE_GS1, depth 1) not found");

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

  const items = await selectAll<{ id: string; syllabus_node_ids: string[]; mcq_question_ids: string[] }>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, syllabus_node_ids, mcq_question_ids")
      .not("mcq_question_ids", "eq", "{}")
      .order("id", { ascending: true }),
  );
  const nodeIdsByQuestion = new Map<string, string[]>();
  for (const item of items) {
    for (const qId of item.mcq_question_ids) nodeIdsByQuestion.set(qId, item.syllabus_node_ids);
  }

  const allNodeIds = [...new Set(items.flatMap((i) => i.syllabus_node_ids))];
  const paperCodeById = new Map<string, string>();
  for (let i = 0; i < allNodeIds.length; i += 200) {
    const batch = allNodeIds.slice(i, i + 200);
    const { data, error } = await supabase().from("syllabus_nodes").select("id, paper_code").in("id", batch);
    if (error) throw new Error(`syllabus node lookup failed: ${error.message}`);
    for (const row of data ?? []) paperCodeById.set(row.id as string, row.paper_code as string);
  }

  function pickPrelimsNode(nodeIds: string[]): string | null {
    for (const id of nodeIds) {
      // PRE_GS1 only, not PRE_CSAT — see the identical rule/reasoning in
      // pickPrelimsMcqNode (ca/pipeline.ts).
      if (paperCodeById.get(id) === "PRE_GS1") return id;
    }
    return null;
  }

  const moves: { id: string; target: string }[] = [];
  let noItemFound = 0;
  let noPrelimsMatch = 0;
  for (const q of pooledQuestions) {
    const itemNodeIds = nodeIdsByQuestion.get(q.id);
    if (!itemNodeIds) {
      noItemFound++;
      continue;
    }
    const target = pickPrelimsNode(itemNodeIds);
    if (!target) {
      noPrelimsMatch++;
      continue;
    }
    moves.push({ id: q.id, target });
  }

  console.log(
    `To re-map: ${moves.length}; staying pooled (no owning item found — pre-migration remnant): ${noItemFound}; ` +
      `staying pooled (item's own classification is mains-only, correctly left as-is): ${noPrelimsMatch}`,
  );
  if (!APPLY) {
    console.log("DRY-RUN — re-run with --apply to write.");
    process.exit(0);
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
  console.log(`APPLIED: re-mapped ${moved} CA MCQs across ${byTarget.size} distinct prelims topics.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
