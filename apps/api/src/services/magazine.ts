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
import { selectAll } from "../lib/paginate.js";
import { HttpError, badRequest, notFound } from "../lib/http-error.js";
import { monthBounds, monthLabel } from "../lib/month.js";
import { RELEVANCE_GATE } from "../ca/pipeline.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";
import { examCodeForNode } from "../lib/exams.js";
import { gsPapersFor } from "../lib/exam-config.js";
import {
  CA_CURATION_SCOPE_COLUMNS,
  gsPapersForExam,
  hasStateFocusForExam,
  type CaCurationScopeRow,
} from "../ca/curation-scope.js";
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

// The Mains edition's GS section structure is PER EXAM — `gsPapersFor(examCode)`
// in lib/exam-config.ts, the same list the CA triage schema offers. It was one
// module-level order here (GS1..GS4, ESSAY, GS5_UP, GS6_UP), so every exam's
// Mains edition was laid out with UPPSC's two UP-specific papers as sections;
// for a nationally-scoped exam those render as permanently-empty headings for
// papers its commission does not set. uppsc's list is byte-for-byte the old one.

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

// ⚑ EVERY read below selects `CA_CURATION_SCOPE_COLUMNS` (M20b), not the flat
// `is_up_specific` / `gs_papers` it used to. Those two columns are ONE
// commission's verdict folded onto a row that is deliberately shared across
// exams, so reading them directly renders the other exam's Mains placements
// under this exam's paper headings. `ca/curation-scope.ts` resolves them; the
// shared column-list constant means a read cannot select a partial set.
const PRELIMS_SCORE_COLUMNS =
  `id, date, category, prelims_relevance, syllabus_node_ids, ${CA_CURATION_SCOPE_COLUMNS}`;
const MAINS_SCORE_COLUMNS =
  `id, date, mains_relevance, syllabus_node_ids, ${CA_CURATION_SCOPE_COLUMNS}`;

interface PrelimsScoreRow extends CaCurationScopeRow {
  id: string;
  date: string;
  category: CurrentAffairsCategory | null;
  prelims_relevance: number | null;
  syllabus_node_ids: string[] | null;
}
interface MainsScoreRow extends CaCurationScopeRow {
  id: string;
  date: string;
  mains_relevance: number | null;
  syllabus_node_ids: string[] | null;
}

function scorePrelims<T extends PrelimsScoreRow>(
  items: T[],
  weightage: Map<string, OwnWeightage>,
  year: number,
  examCode: string,
): Scored<T>[] {
  return scoreRows(
    items,
    (i) => ({
      relevance: i.prelims_relevance ?? RELEVANCE_GATE,
      syllabus_node_ids: i.syllabus_node_ids ?? [],
      state_focus: hasStateFocusForExam(i, examCode),
      date: i.date,
    }),
    weightage,
    year,
  );
}

function scoreMains<T extends MainsScoreRow>(
  items: T[],
  weightage: Map<string, OwnWeightage>,
  year: number,
  examCode: string,
): Scored<T>[] {
  return scoreRows(
    items,
    (i) => ({
      relevance: i.mains_relevance ?? RELEVANCE_GATE,
      syllabus_node_ids: i.syllabus_node_ids ?? [],
      state_focus: hasStateFocusForExam(i, examCode),
      date: i.date,
    }),
    weightage,
    year,
  );
}

/**
 * State lead + capped topic sections. The one selection both the Prelims edition
 * and its index count use.
 *
 * A NATIONALLY-SCOPED EXAM GETS NO LEAD SECTION AND LOSES NOTHING, and M20b is
 * what makes that true of a SECOND STATE EXAM too. The lead now keys off
 * `hasStateFocusForExam` — the reader's OWN state — rather than the flat
 * `is_up_specific`, which is one commission's verdict OR-ed onto a shared row.
 * A national exam still resolves to false unconditionally (so no lead section,
 * and the topic filter stops excluding flagged rows — excluding them would
 * silently drop a genuinely national story from the edition just because uppsc
 * also called it UP-specific), and an MP aspirant no longer leads on UP stories.
 * For uppsc the resolution is byte-identical to the old flag on every row.
 */
function selectCuratedPrelims<T extends PrelimsScoreRow>(
  scored: Scored<T>[],
  examCode: string,
): {
  upScored: Scored<T>[];
  topicMap: Map<CurrentAffairsCategory, Scored<T>[]>;
} {
  const inState = (s: Scored<T>) => hasStateFocusForExam(s.row, examCode);
  const upScored = scored.filter(inState).slice(0, UP_SPECIAL_LIMIT);
  const nonUp = scored.filter(
    (s) => !inState(s) && RENDERABLE_TOPIC.has(s.row.category ?? "polity_governance"),
  );
  const topicMap = curateTopicSections(
    nonUp,
    (r) => r.category ?? "polity_governance",
    TOPIC_PER_CATEGORY_MAX,
    TOPIC_TOTAL_LIMIT,
  );
  return { upScored, topicMap };
}

/**
 * Top-N per GS paper, in THIS exam's paper order. The one selection both the
 * Mains edition and its index count use.
 *
 * ⚑ THIS IS WHERE M20b'S CROSS-EXAM INHERITANCE IS ACTUALLY STOPPED. The
 * membership test reads THIS EXAM'S OWN placement (`gsPapersForExam`), never the
 * flat `gs_papers` column — which is the cross-exam UNION and, because
 * `GS1..GS4`/`ESSAY` is a shared namespace over syllabi that differ, means a
 * different paper for a different commission. Measured on the live corpus
 * (2026-08-08): the flat column carries 3,224 placements of which only 101 are
 * state-labelled, so **3,123 would have been inherited wholesale** into a second
 * exam's edition the moment one row carried two exam codes. `gsPapersFor` alone
 * cannot prevent that — it constrains which HEADINGS render, not which items
 * land under them.
 */
function selectCuratedMainsPerPaper<T extends MainsScoreRow>(
  scored: Scored<T>[],
  examCode: string,
): { paper: CurrentAffairsGsPaper; top: Scored<T>[] }[] {
  return gsPapersFor(examCode).map((paper) => ({
    paper,
    top: scored.filter((s) => gsPapersForExam(s.row, examCode).includes(paper)).slice(0, GS_PER_PAPER_MAX),
  }));
}

// ---------------------------------------------------------------------------
// Month index
// ---------------------------------------------------------------------------

export async function listMagazineMonths(examCode: string): Promise<MagazineMonthSummary[]> {
  // Discover which months have ANY gate-clearing published CA (dates only). MUST page: a single
  // busy month already returns ~967 rows (~97% of PostgREST's 1000-row cap), and this spans EVERY
  // month — unpaged it would silently truncate and drop whole months from the index once >1000.
  //
  // `examCode` is REQUIRED — current_affairs_items.exam_codes exists precisely so a reader gets
  // "current affairs relevant to MY exam" (see current-affairs.ts's listCurrentAffairs, the
  // established `.overlaps` idiom reused here). Without it, a non-UPPSC exam's magazine index would
  // list every UPPSC-only month, leading into editions that then (correctly) render empty — a
  // confusing "0 items" card is worse than the month never being listed at all.
  const dateRows = await selectAll<{ date: string }>(() =>
    supabase()
      .from("current_affairs_items")
      .select("date, id")
      .eq("status", "published")
      .overlaps("exam_codes", [examCode])
      .or(`prelims_relevance.gte.${RELEVANCE_GATE},mains_relevance.gte.${RELEVANCE_GATE}`)
      .order("date", { ascending: false })
      .order("id", { ascending: true }),
  );

  const months = new Set<string>();
  for (const r of dateRows) {
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
        countCuratedPrelims(month, examCode, weightage, year),
        countCuratedMainsIssues(month, examCode, weightage, year),
        countPublishedDeepDives(month, examCode),
      ]);
      return { month, title_i18n: monthLabel(month), prelims_item_count, mains_item_count, deep_dive_count };
    }),
  );
  // Drop any month that cleared the gate but has nothing curatable in either edition (both would
  // open to an empty state) — don't advertise a month card that leads nowhere.
  return summaries.filter((s) => s.prelims_item_count > 0 || s.mains_item_count > 0 || s.deep_dive_count > 0);
}

/** Curated Prelims write-up count (UP lead + topic sections) — the same selection the edition renders. */
async function countCuratedPrelims(
  month: string,
  examCode: string,
  weightage: Map<string, OwnWeightage>,
  year: number,
): Promise<number> {
  const { start, end } = monthBounds(month);
  // Paged + date,id order — identical to the edition's item query, so the count can't drift from it
  // (and a >1000-item month doesn't silently truncate the pool the caps rank over).
  const items = await selectAll<PrelimsScoreRow>(() =>
    supabase()
      .from("current_affairs_items")
      .select(PRELIMS_SCORE_COLUMNS)
      .eq("status", "published")
      .overlaps("exam_codes", [examCode])
      .gte("prelims_relevance", RELEVANCE_GATE)
      .not("prelims_facts", "is", null)
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false })
      .order("id", { ascending: true }),
  );
  if (items.length === 0) return 0;
  const { upScored, topicMap } = selectCuratedPrelims(scorePrelims(items, weightage, year, examCode), examCode);
  let topic = 0;
  for (const arr of topicMap.values()) topic += arr.length;
  return upScored.length + topic;
}

/** Curated Mains issue count (distinct union of per-paper top-N) — the same selection the edition renders. */
async function countCuratedMainsIssues(
  month: string,
  examCode: string,
  weightage: Map<string, OwnWeightage>,
  year: number,
): Promise<number> {
  const { start, end } = monthBounds(month);
  const items = await selectAll<MainsScoreRow>(() =>
    supabase()
      .from("current_affairs_items")
      .select(MAINS_SCORE_COLUMNS)
      .eq("status", "published")
      .overlaps("exam_codes", [examCode])
      .gte("mains_relevance", RELEVANCE_GATE)
      .not("mains_brief", "is", null)
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false })
      .order("id", { ascending: true }),
  );
  if (items.length === 0) return 0;
  const perPaper = selectCuratedMainsPerPaper(scoreMains(items, weightage, year, examCode), examCode);
  return new Set(perPaper.flatMap((p) => p.top.map((s) => s.row.id))).size;
}

/**
 * `magazine_deep_dives` carries no `exam_code` column of its own (adding one is
 * a schema change, out of scope for this fix) — its exam is derived the SAME
 * way ca/deepdive.ts derives it at generation time (buildRequests): from the
 * ranked issue's PRIMARY syllabus node, `syllabus_node_ids[0]`. Reusing
 * `examCodeForNode` (rather than re-deriving the rule) keeps this read-time
 * filter byte-identical in behaviour to the write-time decision, so a deep
 * dive can never be shown to an exam other than the one it was written for.
 */
async function filterDeepDivesByExam<T extends { syllabus_node_ids: string[] | null }>(
  rows: T[],
  examCode: string,
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const codes = await Promise.all(rows.map((r) => examCodeForNode(r.syllabus_node_ids?.[0] ?? null)));
  return rows.filter((_, i) => codes[i] === examCode);
}

async function countPublishedDeepDives(month: string, examCode: string): Promise<number> {
  const { data, error } = await supabase()
    .from("magazine_deep_dives")
    .select("syllabus_node_ids")
    .eq("month", month)
    .eq("status", "published");
  if (error) throw new HttpError(500, `magazine deep-dive count failed: ${error.message}`);
  const rows = (data ?? []) as { syllabus_node_ids: string[] | null }[];
  return (await filterDeepDivesByExam(rows, examCode)).length;
}

// ---------------------------------------------------------------------------
// Prelims Compendium
// ---------------------------------------------------------------------------

interface PrelimsItemRow extends PrelimsScoreRow {
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

async function loadWorkbook(month: string, examCode: string): Promise<MagazineMcq[]> {
  const { start, end } = monthBounds(month);
  // `questions.exam_code` is PROVENANCE, not the node-derived product exam (see
  // lib/exams.ts) — but every CA-generated MCQ insert (ca/pipeline.ts
  // insertMcqsForItem) leaves it at the column default ('uppsc'), so filtering
  // on it here is still correct today: it can only ever match uppsc rows. This
  // is an honest empty state for a second exam, not a wrong one — ca/pipeline.ts
  // stamping exam_code on generated CA questions is a separate, pre-existing gap
  // (outside this fix's scope) that the moment it lands, this filter starts
  // working for a second exam with no change needed here.
  const { data, error } = await supabase()
    .from("questions")
    .select("id, stem_i18n, options_i18n, correct_option_key, explanation_i18n")
    .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
    .eq("type", "mcq")
    .eq("review_state", "approved")
    .eq("exam_code", examCode)
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

export async function compilePrelimsEdition(month: string, examCode: string): Promise<MagazinePrelims | null> {
  const { start, end } = monthBounds(month);
  // Paged (date,id) — a busy month's prelims-life pool can approach/exceed PostgREST's 1000-row cap;
  // unpaged it would silently truncate and rank the caps over a partial month.
  //
  // `.overlaps("exam_codes", [examCode])` — see listMagazineMonths' comment. Without it this edition
  // would compile from EVERY exam's current affairs regardless of who is reading it.
  const [items, weightage] = await Promise.all([
    selectAll<PrelimsItemRow>(() =>
      supabase()
        .from("current_affairs_items")
        .select(`${PRELIMS_SCORE_COLUMNS}, title_i18n, summary_i18n, possible_questions, prelims_facts`)
        .eq("status", "published")
        .overlaps("exam_codes", [examCode])
        .gte("prelims_relevance", RELEVANCE_GATE)
        .not("prelims_facts", "is", null)
        .gte("date", start)
        .lt("date", end)
        .order("date", { ascending: false })
        .order("id", { ascending: true }),
    ),
    loadNodeWeightage(),
  ]);

  if (items.length === 0) return null;

  // Rank by importance (relevance tier + syllabus weightage + UP + recency), then CAP each section
  // via the SHARED selection (also used by the index count, so they can't drift) — a busy month
  // clears every item past the survival gate, so unranked sections would dump hundreds.
  const { upScored, topicMap } = selectCuratedPrelims(
    scorePrelims(items, weightage, currentExamYear(), examCode),
    examCode,
  );

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

  const workbook = await loadWorkbook(month, examCode);
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

interface MainsItemRow extends MainsScoreRow {
  category: CurrentAffairsCategory | null;
  title_i18n: { hi: string; en: string };
  mains_brief: CurrentAffairsMainsBrief;
  possible_questions: CurrentAffairsPossibleQuestions | null;
}

async function loadModelQuestions(month: string, examCode: string): Promise<MagazineModelQuestion[]> {
  const { start, end } = monthBounds(month);
  // See loadWorkbook's comment: `questions.exam_code` is provenance, but every
  // CA-linked descriptive question (ca/pipeline.ts insertMainsQuestionForItem)
  // leaves it at the 'uppsc' column default, so this filter is correct today
  // and will start working for a second exam once that pipeline stamps it.
  const { data, error } = await supabase()
    .from("questions")
    .select("id, stem_i18n, marks, word_limit, generation_meta")
    .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
    .eq("type", "descriptive")
    .eq("review_state", "approved")
    .eq("exam_code", examCode)
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

export async function compileMainsEdition(month: string, examCode: string): Promise<MagazineMains | null> {
  const { start, end } = monthBounds(month);
  // Paged (date,id) — mains-life already runs ~836 rows (~84% of PostgREST's 1000-row cap) and grows;
  // unpaged it would silently truncate and rank the per-paper caps over a partial month.
  //
  // `.overlaps("exam_codes", [examCode])` — see listMagazineMonths' comment.
  const items = await selectAll<MainsItemRow>(() =>
    supabase()
      .from("current_affairs_items")
      .select(`${MAINS_SCORE_COLUMNS}, category, title_i18n, mains_brief, possible_questions`)
      .eq("status", "published")
      .overlaps("exam_codes", [examCode])
      .gte("mains_relevance", RELEVANCE_GATE)
      .not("mains_brief", "is", null)
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false })
      .order("id", { ascending: true }),
  );

  const [{ data: ddData, error: ddError }, modelQuestions, weightage] = await Promise.all([
    supabase()
      .from("magazine_deep_dives")
      .select(
        "id, month, rank, status, title_i18n, intro_i18n, synthesis_i18n, significance_i18n, challenges_i18n, way_forward_i18n, keywords_i18n, case_examples_i18n, gs_papers, syllabus_node_ids, source_item_ids, sources, model, cost_usd, created_at, updated_at",
      )
      .eq("month", month)
      .eq("status", "published")
      .order("rank", { ascending: true }),
    loadModelQuestions(month, examCode),
    loadNodeWeightage(),
  ]);
  if (ddError) throw new HttpError(500, `mains edition deep-dive query failed: ${ddError.message}`);
  // magazine_deep_dives has no exam_code column — filtered at read time via
  // filterDeepDivesByExam (derives it from each row's primary syllabus node,
  // mirroring how ca/deepdive.ts derived it at generation time).
  const deepDives = await filterDeepDivesByExam(
    ((ddData ?? []) as unknown as MagazineDeepDive[]).map((d) => ({ ...d, cost_usd: Number(d.cost_usd) })),
    examCode,
  );

  if (items.length === 0 && deepDives.length === 0 && modelQuestions.length === 0) return null;

  // Rank issues by importance, then cap each GS section to its top-N via the SHARED selection (also
  // used by the index count, so they can't drift). gs_papers is multi-valued (an issue can span
  // papers), so the DISTINCT union of what renders IS the curated set — never a global pre-slice,
  // which would count items a later per-paper cap then dropped from view (rendering nowhere).
  const perPaperTop = selectCuratedMainsPerPaper(scoreMains(items, weightage, currentExamYear(), examCode), examCode);

  const toBrief = (s: Scored<MainsItemRow>): MagazineIssueBrief => {
    const item = s.row;
    return {
      item_id: item.id,
      title_i18n: item.title_i18n,
      date: item.date,
      category: item.category,
      // Both RESOLVED for this reader (M20b), never the raw shared-row values:
      // `gs_papers` here is this exam's own placement, so the brief's chips
      // cannot advertise the other commission's papers, and `state_focus` is
      // false for a national exam by construction — so the renderer needs no
      // lens gate of its own (it used to carry one, as a workaround for exactly
      // this).
      state_focus: hasStateFocusForExam(item, examCode),
      gs_papers: [...gsPapersForExam(item, examCode)],
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
