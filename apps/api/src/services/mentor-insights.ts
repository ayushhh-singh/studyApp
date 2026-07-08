/**
 * Feature 5 — proactive mentor insights.
 *
 * The mentor never messages first; instead a nightly (and on-load self-healing)
 * job derives at most a few actionable nudge cards from the learner profile and
 * writes them to `mentor_insights`, idempotent per (user, dedupe_key). The
 * dashboard renders at most ONE undismissed card. Everything is templated from
 * real profile signals — no LLM call, so it's free and never hallucinates.
 */
import type { BilingualText, MentorInsight } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { istToday } from "../lib/ist.js";
import { getLearnerProfile } from "./learner-profile.js";

const DIMENSION_LABELS: Record<string, BilingualText> = {
  structure_flow: { en: "structure & flow", hi: "संरचना और प्रवाह" },
  content_coverage: { en: "content coverage", hi: "विषयवस्तु कवरेज" },
  keywords_concepts: { en: "keywords & concepts", hi: "कीवर्ड और अवधारणाएँ" },
  examples_data: { en: "examples & data", hi: "उदाहरण और आंकड़े" },
  presentation: { en: "presentation", hi: "प्रस्तुति" },
  word_limit_language: { en: "word limit & language", hi: "शब्द-सीमा और भाषा" },
};

interface Candidate {
  kind: string;
  dedupe_key: string;
  insight_i18n: BilingualText;
  cta_link: string | null;
}

function buildCandidates(profile: Awaited<ReturnType<typeof getLearnerProfile>>, today: string): Candidate[] {
  const out: Candidate[] = [];

  // 1. Weakest section with enough evidence → a targeted drill. Scan for the
  // first node that clears the evidence bar (≥4 answers), not just weak[0] —
  // the very weakest may have too few answers to nudge on honestly.
  const weak = profile.weak_nodes.find((n) => n.accuracy_pct < 55 && n.answered_count >= 4);
  if (weak) {
    out.push({
      kind: "weak_node",
      dedupe_key: `weak_node:${weak.node_id}:${today}`,
      insight_i18n: {
        en: `You're missing ${weak.title_i18n.en || weak.title_i18n.hi} questions (${weak.accuracy_pct}% of ${weak.answered_count} recently). Revise the topic and drill its PYQs.`,
        hi: `आप ${weak.title_i18n.hi || weak.title_i18n.en} के प्रश्नों में चूक रहे हैं (हाल ही में ${weak.answered_count} में से ${weak.accuracy_pct}%)। विषय दोहराएँ और इसके PYQ हल करें।`,
      },
      // Link to the section's Learn page (notes / PYQs / CA tabs) — PYQs attach
      // to leaf nodes, so a /practice?node=<section> filter would be empty. This
      // matches the dashboard weakness-card convention.
      cta_link: `/learn/${weak.paper_code}/${weak.node_id}`,
    });
  }

  // 2. Weakest answer-writing dimension.
  const dim = profile.evaluation.weakest_dimension;
  if (profile.evaluation.count >= 2 && dim && DIMENSION_LABELS[dim]) {
    const label = DIMENSION_LABELS[dim];
    out.push({
      kind: "eval_dimension",
      dedupe_key: `eval_dim:${dim}:${today}`,
      insight_i18n: {
        en: `Your answers keep losing marks on ${label.en}. Write one answer today with that in focus.`,
        hi: `आपके उत्तर ${label.hi} में अंक गँवा रहे हैं। आज एक उत्तर उसी पर ध्यान देकर लिखें।`,
      },
      cta_link: `/answers`,
    });
  }

  // 3. Exam is close and streak alive → keep momentum.
  if (profile.days_to_exam != null && profile.days_to_exam <= 45 && profile.days_to_exam > 0) {
    out.push({
      kind: "exam_proximity",
      dedupe_key: `exam_close:${today}`,
      insight_i18n: {
        en: `Prelims is ${profile.days_to_exam} days away — a daily quiz keeps your recall sharp.`,
        hi: `प्रीलिम्स में ${profile.days_to_exam} दिन बचे हैं — रोज़ाना क्विज़ आपकी स्मृति तेज़ रखती है।`,
      },
      cta_link: `/practice`,
    });
  }

  return out;
}

/** Generate today's insights idempotently. Safe to call repeatedly. */
export async function generateMentorInsights(userId: string): Promise<void> {
  let profile;
  try {
    profile = await getLearnerProfile(userId);
  } catch (err) {
    logger.warn({ err }, "mentor-insights: profile load failed");
    return;
  }
  const candidates = buildCandidates(profile, istToday());
  if (candidates.length === 0) return;

  const rows = candidates.map((c) => ({
    user_id: userId,
    kind: c.kind,
    dedupe_key: c.dedupe_key,
    insight_i18n: c.insight_i18n,
    cta_link: c.cta_link,
  }));
  // ignoreDuplicates so a re-run never resurfaces a dismissed card (unique on
  // (user_id, dedupe_key); a dismissed row keeps its key for the day).
  const { error } = await supabase()
    .from("mentor_insights")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) logger.warn({ err: error }, "mentor-insights: upsert failed");
}

/** Undismissed insights, newest first (dashboard shows the first). */
export async function listInsights(userId: string, selfHeal = true): Promise<MentorInsight[]> {
  if (selfHeal) await generateMentorInsights(userId);
  const { data, error } = await supabase()
    .from("mentor_insights")
    .select("id, kind, insight_i18n, cta_link, created_at")
    .eq("user_id", userId)
    .eq("dismissed", false)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) throw new HttpError(500, `insights lookup failed: ${error.message}`);
  return (data ?? []) as MentorInsight[];
}

export async function dismissInsight(userId: string, id: string): Promise<MentorInsight> {
  const { data, error } = await supabase()
    .from("mentor_insights")
    .update({ dismissed: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, kind, insight_i18n, cta_link, created_at")
    .maybeSingle();
  if (error) throw new HttpError(500, `insight dismiss failed: ${error.message}`);
  if (!data) throw notFound("Insight not found");
  return data as MentorInsight;
}
