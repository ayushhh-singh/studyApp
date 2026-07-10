/**
 * Teacher-mode helpers: intent detection + the three structured extras attached
 * below a lesson (Related PYQs from OUR bank, ephemeral Quick-check MCQs, and
 * adjacent syllabus nodes). All are best-effort — a failure here degrades the
 * lesson gracefully (the prose still streams) rather than failing the turn.
 */
import type {
  Locale,
  MentorContinueNode,
  MentorPyqRef,
  MentorQuizQuestion,
} from "@prayasup/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import type { LlmUsage } from "../../lib/anthropic.js";
import { resolveSubtreeNodeIds } from "../../lib/syllabus-subtree.js";
import { questionVisibilityOrFilter } from "../../lib/question-visibility.js";
import { generateMcqs } from "../../ca/prompts.js";

/**
 * Does this message ask to be TAUGHT a concept (vs a quick factual doubt)?
 * Bilingual heuristic. Deliberately conservative — an ambiguous message stays a
 * quick doubt (cheaper); the explicit "Teach me this" button forces teacher
 * mode regardless of this.
 */
export function detectTeachIntent(content: string): boolean {
  const en =
    /\b(teach me|explain|explain in detail|elaborate( on)?|walk me through|help me understand|(cover|explain).{0,30}\bin (depth|detail)|what (is|are|do you mean by)|give me an overview|in detail\b|break (this|it) down|tell me (all )?about)\b/i;
  // "X kya hai", "X samjhao/samjhaiye", "X ke baare mein batao", "vistaar/gehrai se"
  const hi =
    /(क्या (है|हैं|होता|होती)|समझा(ओ|इए| दो|या करें)?|समझा दीजिए|के बारे में बता(ओ|इए|एं)?|विस्तार से|गहराई से|पढ़ा(ओ|इए)|सिखा(ओ|इए)|व्याख्या कर)/;
  return en.test(content) || hi.test(content);
}

// ---------------------------------------------------------------------------
// Related PYQs — real questions from our bank for the node's subtree.
// ---------------------------------------------------------------------------
interface PyqRow {
  id: string;
  type: string;
  paper_code: string;
  syllabus_node_id: string | null;
  year: number | null;
  exam_label_i18n: MentorPyqRef["exam_label_i18n"];
  stem_i18n: MentorPyqRef["stem_i18n"];
}

export async function loadRelatedPyqs(nodeId: string, limit = 4): Promise<MentorPyqRef[]> {
  try {
    const subtreeIds = await resolveSubtreeNodeIds(nodeId);
    if (subtreeIds.length === 0) return [];
    const { data, error } = await supabase()
      .from("questions")
      .select("id, type, paper_code, syllabus_node_id, year, exam_label_i18n, stem_i18n")
      .in("syllabus_node_id", subtreeIds)
      .or(questionVisibilityOrFilter("catalog"))
      .order("year", { ascending: false })
      .limit(limit * 4);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PyqRow[];
    // MCQs first (tappable to practice), then by recency — take `limit`.
    rows.sort((a, b) => {
      if (a.type !== b.type) return a.type === "mcq" ? -1 : 1;
      return (b.year ?? 0) - (a.year ?? 0);
    });
    return rows.slice(0, limit).map((r) => ({
      id: r.id,
      stem_i18n: r.stem_i18n,
      paper_code: r.paper_code,
      syllabus_node_id: r.syllabus_node_id,
      year: r.year,
      exam_label_i18n: r.exam_label_i18n ?? null,
      type: r.type,
    }));
  } catch (err) {
    logger.warn({ err, nodeId }, "teacher: related PYQ load failed");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Quick-check — 2 ephemeral MCQs grounded in what was just taught. Reuses the
// CA MCQ primitive (haiku, fact-constrained, no persistence).
// ---------------------------------------------------------------------------
export async function generateQuickCheck(opts: {
  topic: string;
  facts: string[];
  onUsage?: (u: LlmUsage) => void;
}): Promise<MentorQuizQuestion[]> {
  const facts = opts.facts.map((f) => f.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8);
  if (facts.length === 0) return [];
  try {
    const mcqs = await generateMcqs({ title: opts.topic, facts, onUsage: opts.onUsage });
    return mcqs.slice(0, 2).map((m) => ({
      stem_i18n: m.stem_i18n,
      options: m.options,
      correct_option_key: m.correct_option_key,
      explanation_i18n: m.explanation_i18n,
    }));
  } catch (err) {
    logger.warn({ err }, "teacher: quick-check generation failed");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Continue with — 2-3 adjacent syllabus nodes (siblings first, then children).
// ---------------------------------------------------------------------------
interface NodeRow {
  id: string;
  paper_code: string;
  parent_id: string | null;
  order_index: number | null;
  title_i18n: MentorContinueNode["title_i18n"];
}

export async function loadAdjacentNodes(nodeId: string, limit = 3): Promise<MentorContinueNode[]> {
  try {
    const { data: self, error } = await supabase()
      .from("syllabus_nodes")
      .select("id, paper_code, parent_id, order_index, title_i18n")
      .eq("id", nodeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const node = self as NodeRow | null;
    if (!node) return [];

    const collected: MentorContinueNode[] = [];
    const seen = new Set<string>([nodeId]);
    const push = (r: NodeRow) => {
      if (seen.has(r.id)) return;
      seen.add(r.id);
      collected.push({ node_id: r.id, paper_code: r.paper_code, title_i18n: r.title_i18n });
    };

    // Siblings (same parent), then this node's own children — both excluding self.
    if (node.parent_id) {
      const { data: sibs } = await supabase()
        .from("syllabus_nodes")
        .select("id, paper_code, parent_id, order_index, title_i18n")
        .eq("parent_id", node.parent_id)
        .order("order_index", { ascending: true })
        .limit(limit + 3);
      (sibs as NodeRow[] | null)?.forEach(push);
    }
    if (collected.length < limit) {
      const { data: kids } = await supabase()
        .from("syllabus_nodes")
        .select("id, paper_code, parent_id, order_index, title_i18n")
        .eq("parent_id", nodeId)
        .order("order_index", { ascending: true })
        .limit(limit + 3);
      (kids as NodeRow[] | null)?.forEach(push);
    }
    return collected.slice(0, limit);
  } catch (err) {
    logger.warn({ err, nodeId }, "teacher: adjacent-node load failed");
    return [];
  }
}
