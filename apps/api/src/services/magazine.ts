import type {
  CurrentAffairsCategory,
  CurrentAffairsFact,
  CurrentAffairsFactKind,
  CurrentAffairsGsPaper,
  CurrentAffairsMainsBrief,
  CurrentAffairsPossibleQuestions,
  MagazineBoxedFeature,
  MagazineDeepDive,
  MagazineFactEntry,
  MagazineGsSection,
  MagazineIssueBrief,
  MagazineMcq,
  MagazineModelQuestion,
  MagazineMains,
  MagazineMonthSummary,
  MagazinePrelims,
  MagazineTopicSection,
  ReviewMagazineEditBody,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../lib/http-error.js";
import { monthBounds, monthLabel } from "../lib/month.js";
import { RELEVANCE_GATE } from "../ca/pipeline.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";

/** Fixed category display order for the Prelims Compendium's topic sections. */
const CATEGORY_ORDER: CurrentAffairsCategory[] = [
  "polity_governance",
  "economy",
  "schemes",
  "international_relations",
  "environment_ecology",
  "science_tech",
  "security",
  "social_issues",
  "art_culture",
  "reports_indices",
  "places_persons",
  "up_special",
];

/** Fixed fact-kind order for the Prelims Compendium's cross-cutting boxed features. */
const FACT_KIND_ORDER: CurrentAffairsFactKind[] = [
  "scheme",
  "report_index",
  "place",
  "org",
  "species",
  "appointment",
  "day_theme",
  "misc",
];

const GS_PAPER_ORDER: CurrentAffairsGsPaper[] = ["GS1", "GS2", "GS3", "GS4", "ESSAY", "GS5_UP", "GS6_UP"];

const WORKBOOK_LIMIT = 30;
const MODEL_QUESTIONS_LIMIT = 15;

// ---------------------------------------------------------------------------
// Month index
// ---------------------------------------------------------------------------

export async function listMagazineMonths(): Promise<MagazineMonthSummary[]> {
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("date, prelims_relevance, mains_relevance")
    .eq("status", "published")
    .or(`prelims_relevance.gte.${RELEVANCE_GATE},mains_relevance.gte.${RELEVANCE_GATE}`);
  if (error) throw new HttpError(500, `magazine months query failed: ${error.message}`);

  const counts = new Map<string, { prelims: number; mains: number }>();
  for (const r of (data ?? []) as { date: string; prelims_relevance: number | null; mains_relevance: number | null }[]) {
    const month = (r.date ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const cur = counts.get(month) ?? { prelims: 0, mains: 0 };
    if ((r.prelims_relevance ?? 0) >= RELEVANCE_GATE) cur.prelims++;
    if ((r.mains_relevance ?? 0) >= RELEVANCE_GATE) cur.mains++;
    counts.set(month, cur);
  }

  const { data: ddData, error: ddError } = await supabase()
    .from("magazine_deep_dives")
    .select("month")
    .eq("status", "published");
  if (ddError) throw new HttpError(500, `magazine months (deep dive) query failed: ${ddError.message}`);
  const deepDiveCounts = new Map<string, number>();
  for (const r of (ddData ?? []) as { month: string }[]) {
    deepDiveCounts.set(r.month, (deepDiveCounts.get(r.month) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, c]) => ({
      month,
      title_i18n: monthLabel(month),
      prelims_item_count: c.prelims,
      mains_item_count: c.mains,
      deep_dive_count: deepDiveCounts.get(month) ?? 0,
    }));
}

// ---------------------------------------------------------------------------
// Prelims Compendium
// ---------------------------------------------------------------------------

interface PrelimsItemRow {
  id: string;
  date: string;
  category: CurrentAffairsCategory | null;
  is_up_specific: boolean;
  title_i18n: { hi: string; en: string };
  prelims_facts: CurrentAffairsFact[] | null;
}

function toFactEntries(item: PrelimsItemRow): MagazineFactEntry[] {
  return (item.prelims_facts ?? []).map((f) => ({
    ...f,
    item_id: item.id,
    item_title_i18n: item.title_i18n,
    item_date: item.date,
  }));
}

async function loadWorkbook(month: string): Promise<MagazineMcq[]> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("questions")
    .select("id, stem_i18n, options_i18n, correct_option_key, explanation_i18n")
    .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
    .eq("type", "mcq")
    .eq("review_state", "approved")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: true })
    .limit(WORKBOOK_LIMIT);
  if (error) throw new HttpError(500, `magazine workbook query failed: ${error.message}`);
  return ((data ?? []) as unknown as MagazineMcq[]).map((q) => ({
    id: q.id,
    stem_i18n: q.stem_i18n,
    options_i18n: q.options_i18n ?? [],
    correct_option_key: q.correct_option_key ?? null,
    explanation_i18n: q.explanation_i18n ?? null,
  }));
}

export async function compilePrelimsEdition(month: string): Promise<MagazinePrelims | null> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("id, date, category, is_up_specific, title_i18n, prelims_facts")
    .eq("status", "published")
    .gte("prelims_relevance", RELEVANCE_GATE)
    .not("prelims_facts", "is", null)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });
  if (error) throw new HttpError(500, `prelims edition query failed: ${error.message}`);

  const items = (data ?? []) as unknown as PrelimsItemRow[];
  if (items.length === 0) return null;

  const upItems = items.filter((i) => i.is_up_specific);
  const restItems = items.filter((i) => !i.is_up_specific);
  const upSpecial = upItems.flatMap(toFactEntries);

  const byCategory = new Map<CurrentAffairsCategory, MagazineFactEntry[]>();
  for (const item of restItems) {
    const cat = item.category ?? "polity_governance";
    const arr = byCategory.get(cat) ?? [];
    arr.push(...toFactEntries(item));
    byCategory.set(cat, arr);
  }
  const topicSections: MagazineTopicSection[] = CATEGORY_ORDER.filter((c) => c !== "up_special" && byCategory.has(c)).map(
    (category) => ({ category, facts: byCategory.get(category) ?? [] }),
  );

  const byKind = new Map<CurrentAffairsFactKind, MagazineFactEntry[]>();
  for (const item of items) {
    for (const entry of toFactEntries(item)) {
      const arr = byKind.get(entry.kind) ?? [];
      arr.push(entry);
      byKind.set(entry.kind, arr);
    }
  }
  const boxedFeatures: MagazineBoxedFeature[] = FACT_KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    facts: byKind.get(kind) ?? [],
  }));

  const workbook = await loadWorkbook(month);
  const totalFacts = items.reduce((n, i) => n + (i.prelims_facts?.length ?? 0), 0);

  return {
    month,
    title_i18n: monthLabel(month),
    total_items: items.length,
    total_facts: totalFacts,
    up_special: upSpecial,
    topic_sections: topicSections,
    boxed_features: boxedFeatures,
    workbook,
  };
}

// ---------------------------------------------------------------------------
// Mains Analysis
// ---------------------------------------------------------------------------

interface MainsItemRow {
  id: string;
  date: string;
  category: CurrentAffairsCategory | null;
  is_up_specific: boolean;
  gs_papers: CurrentAffairsGsPaper[];
  mains_relevance: number | null;
  title_i18n: { hi: string; en: string };
  mains_brief: CurrentAffairsMainsBrief;
  possible_questions: CurrentAffairsPossibleQuestions | null;
  syllabus_node_ids: string[];
}

async function loadModelQuestions(month: string): Promise<MagazineModelQuestion[]> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("questions")
    .select("id, stem_i18n, marks, word_limit, generation_meta")
    .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
    .eq("type", "descriptive")
    .eq("review_state", "approved")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: true })
    .limit(MODEL_QUESTIONS_LIMIT);
  if (error) throw new HttpError(500, `magazine model-questions query failed: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    stem_i18n: { hi: string; en: string };
    marks: number | null;
    word_limit: number | null;
    generation_meta: { ca_linked?: boolean; marking_points_i18n?: { hi: string[]; en: string[] } } | null;
  }[])
    .filter((q) => q.generation_meta?.ca_linked)
    .map((q) => ({
      id: q.id,
      stem_i18n: q.stem_i18n,
      marks: q.marks,
      word_limit: q.word_limit,
      marking_points_i18n: q.generation_meta?.marking_points_i18n ?? { hi: [], en: [] },
      gs_papers: [],
    }));
}

export async function compileMainsEdition(month: string): Promise<MagazineMains | null> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("id, date, category, is_up_specific, gs_papers, mains_relevance, title_i18n, mains_brief, possible_questions, syllabus_node_ids")
    .eq("status", "published")
    .gte("mains_relevance", RELEVANCE_GATE)
    .not("mains_brief", "is", null)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });
  if (error) throw new HttpError(500, `mains edition query failed: ${error.message}`);

  const items = (data ?? []) as unknown as MainsItemRow[];

  const [{ data: ddData, error: ddError }, modelQuestions] = await Promise.all([
    supabase()
      .from("magazine_deep_dives")
      .select(
        "id, month, rank, status, title_i18n, intro_i18n, synthesis_i18n, significance_i18n, challenges_i18n, way_forward_i18n, keywords_i18n, case_examples_i18n, gs_papers, syllabus_node_ids, source_item_ids, sources, model, cost_usd, created_at, updated_at",
      )
      .eq("month", month)
      .eq("status", "published")
      .order("rank", { ascending: true }),
    loadModelQuestions(month),
  ]);
  if (ddError) throw new HttpError(500, `mains edition deep-dive query failed: ${ddError.message}`);
  const deepDives = ((ddData ?? []) as unknown as MagazineDeepDive[]).map((d) => ({ ...d, cost_usd: Number(d.cost_usd) }));

  if (items.length === 0 && deepDives.length === 0 && modelQuestions.length === 0) return null;

  const toBrief = (item: MainsItemRow): MagazineIssueBrief => ({
    item_id: item.id,
    title_i18n: item.title_i18n,
    date: item.date,
    category: item.category,
    is_up_specific: item.is_up_specific,
    gs_papers: item.gs_papers ?? [],
    mains_relevance: item.mains_relevance,
    brief: item.mains_brief,
    possible_questions: item.possible_questions,
    syllabus_node_ids: item.syllabus_node_ids ?? [],
  });

  const gsSections: MagazineGsSection[] = GS_PAPER_ORDER.map((paper) => ({
    paper,
    items: items.filter((i) => (i.gs_papers ?? []).includes(paper)).map(toBrief),
  })).filter((s) => s.items.length > 0);

  return {
    month,
    title_i18n: monthLabel(month),
    total_issues: items.length,
    gs_sections: gsSections,
    deep_dives: deepDives,
    model_questions: modelQuestions,
  };
}

// ---------------------------------------------------------------------------
// Review Queue — Magazine tab (deep dives awaiting needs_review -> published)
// ---------------------------------------------------------------------------

export const MAGAZINE_REVIEW_PAGE_SIZE = 5;

const REVIEW_DEEP_DIVE_COLUMNS =
  "id, month, rank, status, title_i18n, intro_i18n, synthesis_i18n, significance_i18n, challenges_i18n, way_forward_i18n, keywords_i18n, case_examples_i18n, gs_papers, syllabus_node_ids, source_item_ids, sources, model, cost_usd, created_at, updated_at";

function toDeepDive(row: Record<string, unknown>): MagazineDeepDive {
  return { ...(row as unknown as MagazineDeepDive), cost_usd: Number(row.cost_usd ?? 0) };
}

export async function listReviewMagazine(page: number): Promise<{ items: MagazineDeepDive[]; total: number }> {
  const from = (page - 1) * MAGAZINE_REVIEW_PAGE_SIZE;
  const { data, count, error } = await supabase()
    .from("magazine_deep_dives")
    .select(REVIEW_DEEP_DIVE_COLUMNS, { count: "exact" })
    .eq("status", "needs_review")
    .order("month", { ascending: false })
    .order("rank", { ascending: true })
    .range(from, from + MAGAZINE_REVIEW_PAGE_SIZE - 1);
  if (error) throw new HttpError(500, `magazine review list failed: ${error.message}`);
  return { items: (data ?? []).map(toDeepDive), total: count ?? 0 };
}

export async function reviewMagazineCount(): Promise<number> {
  const { count, error } = await supabase()
    .from("magazine_deep_dives")
    .select("id", { count: "exact", head: true })
    .eq("status", "needs_review");
  if (error) throw new HttpError(500, `magazine review count failed: ${error.message}`);
  return count ?? 0;
}

async function loadDeepDiveForAction(id: string): Promise<{ id: string; status: string }> {
  const { data, error } = await supabase()
    .from("magazine_deep_dives")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, `deep dive lookup failed: ${error.message}`);
  if (!data) throw notFound("Deep dive not found");
  return data as { id: string; status: string };
}

export async function approveMagazineDeepDive(id: string): Promise<{ id: string; status: "published" }> {
  const { data, error: loadError } = await supabase()
    .from("magazine_deep_dives")
    .select("title_i18n, intro_i18n, synthesis_i18n")
    .eq("id", id)
    .maybeSingle();
  if (loadError) throw new HttpError(500, `deep dive lookup failed: ${loadError.message}`);
  if (!data) throw notFound("Deep dive not found");
  if (!deepDivePublishGateOk(data as unknown as MagazineDeepDive)) {
    throw badRequest("Cannot publish: the deep dive is missing a title, intro, or synthesis in one language");
  }
  const { error } = await supabase().from("magazine_deep_dives").update({ status: "published" }).eq("id", id);
  if (error) throw new HttpError(500, `deep dive publish failed: ${error.message}`);
  return { id, status: "published" };
}

export async function rejectMagazineDeepDive(id: string, reason?: string): Promise<{ id: string; status: "rejected" }> {
  await loadDeepDiveForAction(id);
  const { error } = await supabase()
    .from("magazine_deep_dives")
    .update({ status: "rejected", meta: reason ? { reject_reason: reason } : null })
    .eq("id", id);
  if (error) throw new HttpError(500, `deep dive reject failed: ${error.message}`);
  return { id, status: "rejected" };
}

export async function editMagazineDeepDive(
  id: string,
  body: ReviewMagazineEditBody,
): Promise<{ id: string; status: string }> {
  const patch: Record<string, unknown> = {};
  for (const key of [
    "title_i18n", "intro_i18n", "synthesis_i18n", "significance_i18n",
    "challenges_i18n", "way_forward_i18n", "keywords_i18n", "case_examples_i18n",
  ] as const) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase().from("magazine_deep_dives").update(patch).eq("id", id);
    if (error) throw new HttpError(500, `deep dive edit failed: ${error.message}`);
  }
  if (body.approve) return approveMagazineDeepDive(id);
  const row = await loadDeepDiveForAction(id);
  return { id, status: row.status };
}

/** Guard used by the edit form / approve action — mirrors notes' overview gate. */
export function deepDivePublishGateOk(d: Pick<MagazineDeepDive, "title_i18n" | "intro_i18n" | "synthesis_i18n">): boolean {
  const titleOk = !!d.title_i18n.hi.trim() && !!d.title_i18n.en.trim();
  const introOk = !!d.intro_i18n.hi.trim() && !!d.intro_i18n.en.trim();
  const synthesisOk = d.synthesis_i18n.hi.length > 0 && d.synthesis_i18n.en.length > 0;
  return titleOk && introOk && synthesisOk;
}
