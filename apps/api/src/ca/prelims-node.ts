import { supabase } from "../lib/supabase.js";

let cached: string | null | undefined;

/**
 * The prelims "Current Events of National and International Importance" leaf node
 * (PRE_GS1, depth 1, no children) — the home for current-affairs MCQs in prelims
 * topic practice. CA MCQs are prelims-format (MCQs) and current-affairs IS a
 * prelims topic, so this is where they belong (the classifier files the CA
 * *item* against mains GS themes, which is correct for the magazine/mains brief,
 * but the MCQ artifact is prelims-facing). Being a leaf, it sidesteps the custom
 * builder's leaf-based cap (own == subtree). Cached per process.
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
