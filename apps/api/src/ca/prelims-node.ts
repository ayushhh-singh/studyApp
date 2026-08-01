import { getExamConfig } from "../lib/exam-config.js";
import { supabase } from "../lib/supabase.js";

/**
 * The (exam, paper) pair that identifies ONE exam's pooled "Current Events"
 * node. Split out as a pure function so the exam-scoping can be asserted
 * without a database — the lookup below is otherwise untestable offline.
 *
 * `null` = this exam has no prelims GS paper ingested yet, so it has no pooled
 * node and never will until its syllabus lands. An honest empty answer, not a
 * fallback onto some other exam's node.
 */
export function prelimsPooledNodeScope(
  examCode: string,
): { examCode: string; paperCode: string } | null {
  const paperCode = getExamConfig(examCode).papers.prelimsGs;
  return paperCode ? { examCode, paperCode } : null;
}

/** Per-exam cache. Was a single module-level id — see the exam-collision note below. */
const cache = new Map<string, string | null>();

/**
 * ONE EXAM'S prelims "Current Events of National and International Importance"
 * leaf node (its own prelims-GS paper, depth 1, no children) — the FALLBACK home
 * for a current-affairs MCQ when triage's own classification
 * (`syllabus_node_ids`) contains no prelims-paper node at all (see
 * `pickPrelimsMcqNode` in pipeline.ts, which is tried first and maps most MCQs
 * onto their real topic — History/Polity/etc). This node only catches items
 * triage classified purely against mains-only themes. Being a leaf, it sidesteps
 * the custom builder's leaf-based cap (own == subtree).
 *
 * ⚑ EXAM-KEYED ON PURPOSE, AND THE TITLE PREDICATE MUST STAY STRICT.
 * `docs/OUTSTANDING.md` §8h U4a: UPPSC's `PRE_GS1` and UPSC's `UPSC_PRE_GS1`
 * BOTH carry a depth-1 node titled, byte-identically, "Current Events of
 * National and International Importance" — that phrase is verbatim official text
 * in both commissions' notifications, so the collision is inherent to the domain
 * and cannot be renamed away. This lookup therefore matches on the title only
 * AFTER pinning both `exam_code` and that exam's own `paper_code`. DO NOT loosen
 * either predicate to "fix" a miss: dropping `paper_code` and relying on
 * `exam_code` alone would still be correct today but throws away the §0
 * global-paper-code-uniqueness guarantee the rest of the pipeline leans on, and
 * dropping `exam_code` silently hands one exam's MCQs to the other exam's pooled
 * node — cross-exam contamination of a LIVE exam, with no error anywhere.
 *
 * The cache is now a Map keyed by exam. A single cached id was safe only while
 * one exam existed; with two live it would serve whichever exam asked first.
 */
export async function getPrelimsCurrentAffairsNodeId(examCode: string): Promise<string | null> {
  const hit = cache.get(examCode);
  if (hit !== undefined) return hit;
  const scope = prelimsPooledNodeScope(examCode);
  if (!scope) {
    cache.set(examCode, null);
    return null;
  }
  const { data } = await supabase()
    .from("syllabus_nodes")
    .select("id")
    .eq("exam_code", scope.examCode)
    .eq("paper_code", scope.paperCode)
    .eq("depth", 1)
    .ilike("title_i18n->>en", "%current events%")
    .limit(1)
    .maybeSingle();
  const id = (data?.id as string | undefined) ?? null;
  cache.set(examCode, id);
  return id;
}
