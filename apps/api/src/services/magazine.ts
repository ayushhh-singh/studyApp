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
  MagazineItemBlock,
  MagazineMcq,
  MagazineModelQuestion,
  MagazineMains,
  MagazineMonthSummary,
  MagazinePrelims,
  MagazineTopicSection,
  ReviewMagazineEditBody,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../lib/http-error.js";
import { monthBounds, monthLabel } from "../lib/month.js";
import { RELEVANCE_GATE } from "../ca/pipeline.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";
import { loadNodeWeightage, currentExamYear, type OwnWeightage } from "../lib/weightage.js";
import {
  UP_SPECIAL_LIMIT,
  TOPIC_TOTAL_LIMIT,
  TOPIC_PER_CATEGORY_MAX,
  BOXED_PER_KIND_LIMIT,
  GS_PER_PAPER_MAX,
  scoreRows,
  curateTopicSections,
  type Scored,
} from "./magazine-curation.js";

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
// Shared curation selection — used by BOTH the full editions (compile*) and the
// lightweight month-index counts, so a card's count can never drift from the
// edition it opens. scoreRows only reads the fields the mappers below expose, so
// the light "score row" (scalar columns only, no heavy jsonb) selects identically
// to the full row — letting the index count skip the facts/brief/workbook payloads.
// ---------------------------------------------------------------------------

/** A non-UP item whose category is "up_special" (or outside the taxonomy) has no topic section to render in. */
const RENDERABLE_TOPIC = new Set<CurrentAffairsCategory>(CATEGORY_ORDER.filter((c) => c !== "up_special"));

const PRELIMS_SCORE_COLUMNS = "id, date, category, is_up_specific, prelims_relevance, syllabus_node_ids";
const MAINS_SCORE_COLUMNS = "id, date, is_up_specific, gs_papers, mains_relevance, syllabus_node_ids";

interface PrelimsScoreRow {
  id: string;
  date: string;
  category: CurrentAffairsCategory | null;
  is_up_specific: boolean;
  prelims_relevance: number | null;
  syllabus_node_ids: string[] | null;
}
interface MainsScoreRow {
  id: string;
  date: string;
  is_up_specific: boolean;
  gs_papers: CurrentAffairsGsPaper[] | null;
  mains_relevance: number | null;
  syllabus_node_ids: string[] | null;
}

function scorePrelims<T extends PrelimsScoreRow>(items: T[], weightage: Map<string, OwnWeightage>, year: number): Scored<T>[] {
  return scoreRows(
    items,
    (i) => ({
      relevance: i.prelims_relevance ?? RELEVANCE_GATE,
      syllabus_node_ids: i.syllabus_node_ids ?? [],
      is_up_specific: i.is_up_specific,
      date: i.date,
    }),
    weightage,
    year,
  );
}

function scoreMains<T extends MainsScoreRow>(items: T[], weightage: Map<string, OwnWeightage>, year: number): Scored<T>[] {
  return scoreRows(
    items,
    (i) => ({
      relevance: i.mains_relevance ?? RELEVANCE_GATE,
      syllabus_node_ids: i.syllabus_node_ids ?? [],
      is_up_specific: i.is_up_specific,
      date: i.date,
    }),
    weightage,
    year,
  );
}

/** UP lead + capped topic sections. The one selection both the Prelims edition and its index count use. */
function selectCuratedPrelims<T extends PrelimsScoreRow>(scored: Scored<T>[]): {
  upScored: Scored<T>[];
  topicMap: Map<CurrentAffairsCategory, Scored<T>[]>;
} {
  const upScored = scored.filter((s) => s.row.is_up_specific).slice(0, UP_SPECIAL_LIMIT);
  const nonUp = scored.filter((s) => !s.row.is_up_specific && RENDERABLE_TOPIC.has(s.row.category ?? "polity_governance"));
  const topicMap = curateTopicSections(
    nonUp,
    (r) => r.category ?? "polity_governance",
    TOPIC_PER_CATEGORY_MAX,
    TOPIC_TOTAL_LIMIT,
  );
  return { upScored, topicMap };
}

/** Top-N per GS paper. The one selection both the Mains edition and its index count use. */
function selectCuratedMainsPerPaper<T extends MainsScoreRow>(scored: Scored<T>[]): { paper: CurrentAffairsGsPaper; top: Scored<T>[] }[] {
  return GS_PAPER_ORDER.map((paper) => ({
    paper,
    top: scored.filter((s) => (s.row.gs_papers ?? []).includes(paper)).slice(0, GS_PER_PAPER_MAX),
  }));
}

// ---------------------------------------------------------------------------
// Month index
// ---------------------------------------------------------------------------

export async function listMagazineMonths(): Promise<MagazineMonthSummary[]> {
  // Discover which months have ANY gate-clearing published CA (cheap — dates only).
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("date")
    .eq("status", "published")
    .or(`prelims_relevance.gte.${RELEVANCE_GATE},mains_relevance.gte.${RELEVANCE_GATE}`);
  if (error) throw new HttpError(500, `magazine months query failed: ${error.message}`);

  const months = new Set<string>();
  for (const r of (data ?? []) as { date: string }[]) {
    const month = (r.date ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) months.add(month);
  }
  const sorted = [...months].sort((a, b) => (a < b ? 1 : -1));
  if (sorted.length === 0) return [];

  // Counts shown on the index/month cards MUST be the CURATED edition counts, not the raw
  // gate-clearing pile — otherwise a card advertises "582 items" and links to an 82-item edition.
  // Use the SAME scoring + selection the editions use (via selectCuratedPrelims/…MainsPerPaper), but
  // over light scalar-only rows and skipping the workbook/deep-dive/model-question/block-building
  // payloads — so the card can never drift from the edition it opens, without compiling it in full.
  // Weightage is global, so load it ONCE for every month rather than per edition per month.
  const year = currentExamYear();
  const weightage = await loadNodeWeightage();

  const summaries = await Promise.all(
    sorted.map(async (month) => {
      const [prelims_item_count, mains_item_count, deep_dive_count] = await Promise.all([
        countCuratedPrelims(month, weightage, year),
        countCuratedMainsIssues(month, weightage, year),
        countPublishedDeepDives(month),
      ]);
      return { month, title_i18n: monthLabel(month), prelims_item_count, mains_item_count, deep_dive_count };
    }),
  );
  // Drop any month that cleared the gate but has nothing curatable in either edition (both would
  // open to an empty state) — don't advertise a month card that leads nowhere.
  return summaries.filter((s) => s.prelims_item_count > 0 || s.mains_item_count > 0 || s.deep_dive_count > 0);
}

/** Curated Prelims write-up count (UP lead + topic sections) — the same selection the edition renders. */
async function countCuratedPrelims(month: string, weightage: Map<string, OwnWeightage>, year: number): Promise<number> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select(PRELIMS_SCORE_COLUMNS)
    .eq("status", "published")
    .gte("prelims_relevance", RELEVANCE_GATE)
    .not("prelims_facts", "is", null)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });
  if (error) throw new HttpError(500, `magazine prelims count failed: ${error.message}`);
  const items = (data ?? []) as unknown as PrelimsScoreRow[];
  if (items.length === 0) return 0;
  const { upScored, topicMap } = selectCuratedPrelims(scorePrelims(items, weightage, year));
  let topic = 0;
  for (const arr of topicMap.values()) topic += arr.length;
  return upScored.length + topic;
}

/** Curated Mains issue count (distinct union of per-paper top-N) — the same selection the edition renders. */
async function countCuratedMainsIssues(month: string, weightage: Map<string, OwnWeightage>, year: number): Promise<number> {
  const { start, end } = monthBounds(month);
  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select(MAINS_SCORE_COLUMNS)
    .eq("status", "published")
    .gte("mains_relevance", RELEVANCE_GATE)
    .not("mains_brief", "is", null)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });
  if (error) throw new HttpError(500, `magazine mains count failed: ${error.message}`);
  const items = (data ?? []) as unknown as MainsScoreRow[];
  if (items.length === 0) return 0;
  const perPaper = selectCuratedMainsPerPaper(scoreMains(items, weightage, year));
  return new Set(perPaper.flatMap((p) => p.top.map((s) => s.row.id))).size;
}

async function countPublishedDeepDives(month: string): Promise<number> {
  const { count, error } = await supabase()
    .from("magazine_deep_dives")
    .select("id", { count: "exact", head: true })
    .eq("month", month)
    .eq("status", "published");
  if (error) throw new HttpError(500, `magazine deep-dive count failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Prelims Compendium
// ---------------------------------------------------------------------------

interface PrelimsItemRow {
  id: string;
  date: string;
  category: CurrentAffairsCategory | null;
  is_up_specific: boolean;
  prelims_relevance: number | null;
  syllabus_node_ids: string[] | null;
  title_i18n: { hi: string; en: string };
  summary_i18n: { hi: string; en: string } | null;
  possible_questions: CurrentAffairsPossibleQuestions | null;
  prelims_facts: CurrentAffairsFact[] | null;
}

function toFactEntries(item: PrelimsItemRow): MagazineFactEntry[] {
  return (item.prelims_facts ?? []).map((f) => ({
    ...f,
    item_id: item.id,
    item_title_i18n: item.title_i18n,
    item_date: item.date,
    item_summary_i18n: item.summary_i18n,
  }));
}

/** A full item write-up (headline + context + all its facts) for topic sections / UP Special. */
function toItemBlock(s: Scored<PrelimsItemRow>): MagazineItemBlock {
  const item = s.row;
  return {
    item_id: item.id,
    item_title_i18n: item.title_i18n,
    item_date: item.date,
    summary_i18n: item.summary_i18n,
    possible_question_i18n: item.possible_questions?.prelims_i18n ?? null,
    facts: item.prelims_facts ?? [],
    weightage_pct: s.weightage_pct,
    editors_pick: s.editors_pick,
  };
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
  const [{ data, error }, weightage] = await Promise.all([
    supabase()
      .from("current_affairs_items")
      .select(
        "id, date, category, is_up_specific, prelims_relevance, syllabus_node_ids, title_i18n, summary_i18n, possible_questions, prelims_facts",
      )
      .eq("status", "published")
      .gte("prelims_relevance", RELEVANCE_GATE)
      .not("prelims_facts", "is", null)
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false }),
    loadNodeWeightage(),
  ]);
  if (error) throw new HttpError(500, `prelims edition query failed: ${error.message}`);

  const items = (data ?? []) as unknown as PrelimsItemRow[];
  if (items.length === 0) return null;

  // Rank by importance (relevance tier + syllabus weightage + UP + recency), then CAP each section
  // via the SHARED selection (also used by the index count, so they can't drift) — a busy month
  // clears every item past the survival gate, so unranked sections would dump hundreds.
  const { upScored, topicMap } = selectCuratedPrelims(scorePrelims(items, weightage, currentExamYear()));

  const upSpecial = upScored.map(toItemBlock);
  const topicSections: MagazineTopicSection[] = CATEGORY_ORDER.filter((c) => c !== "up_special" && topicMap.has(c)).map(
    (category) => ({ category, items: (topicMap.get(category) ?? []).map(toItemBlock) }),
  );

  // The curated set (UP + topic write-ups) also feeds the boxed-fact appendix and the cover counts,
  // so the whole edition reflects one coherent, capped selection — not the raw month.
  const curated = [...upScored, ...[...topicMap.values()].flat()].sort((a, b) => b.score - a.score);
  const byKind = new Map<CurrentAffairsFactKind, MagazineFactEntry[]>();
  for (const s of curated) {
    for (const entry of toFactEntries(s.row)) {
      const arr = byKind.get(entry.kind) ?? [];
      arr.push(entry);
      byKind.set(entry.kind, arr);
    }
  }
  const boxedFeatures: MagazineBoxedFeature[] = FACT_KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    facts: (byKind.get(kind) ?? []).slice(0, BOXED_PER_KIND_LIMIT),
  }));

  const workbook = await loadWorkbook(month);
  const totalFacts = curated.reduce((n, s) => n + (s.row.prelims_facts?.length ?? 0), 0);

  return {
    month,
    title_i18n: monthLabel(month),
    total_items: curated.length,
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

  const [{ data: ddData, error: ddError }, modelQuestions, weightage] = await Promise.all([
    supabase()
      .from("magazine_deep_dives")
      .select(
        "id, month, rank, status, title_i18n, intro_i18n, synthesis_i18n, significance_i18n, challenges_i18n, way_forward_i18n, keywords_i18n, case_examples_i18n, gs_papers, syllabus_node_ids, source_item_ids, sources, model, cost_usd, created_at, updated_at",
      )
      .eq("month", month)
      .eq("status", "published")
      .order("rank", { ascending: true }),
    loadModelQuestions(month),
    loadNodeWeightage(),
  ]);
  if (ddError) throw new HttpError(500, `mains edition deep-dive query failed: ${ddError.message}`);
  const deepDives = ((ddData ?? []) as unknown as MagazineDeepDive[]).map((d) => ({ ...d, cost_usd: Number(d.cost_usd) }));

  if (items.length === 0 && deepDives.length === 0 && modelQuestions.length === 0) return null;

  // Rank issues by importance, then cap each GS section to its top-N via the SHARED selection (also
  // used by the index count, so they can't drift). gs_papers is multi-valued (an issue can span
  // papers), so the DISTINCT union of what renders IS the curated set — never a global pre-slice,
  // which would count items a later per-paper cap then dropped from view (rendering nowhere).
  const perPaperTop = selectCuratedMainsPerPaper(scoreMains(items, weightage, currentExamYear()));

  const toBrief = (s: Scored<MainsItemRow>): MagazineIssueBrief => {
    const item = s.row;
    return {
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
      weightage_pct: s.weightage_pct,
      editors_pick: s.editors_pick,
    };
  };

  const gsSections: MagazineGsSection[] = perPaperTop
    .filter((p) => p.top.length > 0)
    .map((p) => ({ paper: p.paper, items: p.top.map(toBrief) }));
  const curatedIds = new Set(perPaperTop.flatMap((p) => p.top.map((s) => s.row.id)));

  return {
    month,
    title_i18n: monthLabel(month),
    total_issues: curatedIds.size,
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
