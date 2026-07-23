import { supabase } from "../lib/supabase.js";

let cached: string | null | undefined;

/**
 * The prelims "Current Events of National and International Importance" leaf node
 * (PRE_GS1, depth 1, no children) — the FALLBACK home for a current-affairs MCQ
 * when triage's own classification (`syllabus_node_ids`) contains no prelims-
 * paper node at all (see `pickPrelimsMcqNode` in pipeline.ts, which is tried
 * first and maps most MCQs onto their real topic — History/Polity/etc). This
 * node only catches items triage classified purely against mains-only themes.
 * Being a leaf, it sidesteps the custom builder's leaf-based cap (own == subtree).
 * Cached per process.
 */
export async function getPrelimsCurrentAffairsNodeId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const { data } = await supabase()
    .from("syllabus_nodes")
    .select("id")
    .eq("paper_code", "PRE_GS1")
    .eq("depth", 1)
    .ilike("title_i18n->>en", "%current events%")
    .limit(1)
    .maybeSingle();
  cached = (data?.id as string | undefined) ?? null;
  return cached;
}
