/**
 * `pnpm ca:remap-prelims [--apply]`
 *
 * One-time backfill: re-map existing current-affairs MCQs from the mains
 * classification node they inherited to the prelims "Current Events" topic, where
 * they belong (they're MCQ-format and current-affairs IS a prelims topic — see
 * ca/prelims-node.ts). This is what unlocks the abundant CA pool for prelims
 * topic practice via the custom-set builder. ca:run does this for new MCQs going
 * forward; this catches the backlog. Only changes the MCQ questions'
 * syllabus_node_id — the CA item's own classification (magazine/mains brief) is
 * untouched, as are the item's mains descriptive questions. Idempotent; dry-run
 * unless --apply.
 */
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";
import { getPrelimsCurrentAffairsNodeId } from "../src/ca/prelims-node.js";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const target = await getPrelimsCurrentAffairsNodeId();
  if (!target) throw new Error("prelims 'Current Events' node (PRE_GS1, depth 1) not found");

  const rows = await selectAll<{ id: string; syllabus_node_id: string | null }>(() =>
    supabase()
      .from("questions")
      .select("id, syllabus_node_id")
      .eq("paper_code", "CURRENT_AFFAIRS")
      .eq("type", "mcq")
      .order("id", { ascending: true }),
  );
  const toMove = rows.filter((r) => r.syllabus_node_id !== target);
  console.log(
    `CA MCQs: ${rows.length} total; already on target: ${rows.length - toMove.length}; to re-map: ${toMove.length} → prelims Current Events (${target})`,
  );
  if (!APPLY) {
    console.log("DRY-RUN — re-run with --apply to write.");
    process.exit(0);
  }
  let moved = 0;
  for (let i = 0; i < toMove.length; i += 200) {
    const ids = toMove.slice(i, i + 200).map((r) => r.id);
    const { error } = await supabase().from("questions").update({ syllabus_node_id: target }).in("id", ids);
    if (error) throw new Error(`update failed: ${error.message}`);
    moved += ids.length;
  }
  console.log(`APPLIED: re-mapped ${moved} CA MCQs to the prelims Current Events topic.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
