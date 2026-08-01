/**
 * Mock test series. `buildMocks` assembles full-length, exam-pattern papers from
 * the published+approved MCQ bank, balanced across the paper's syllabus tree
 * (weightage-weighted across top-level sections).
 *
 * ⚑ EVERY STRUCTURAL NUMBER COMES FROM `exams.paper_structure` — question
 * count, marks, duration, qualifying minimum and negative marking. Migration
 * 0106 seeded that registry against each commission's own notification PDF, and
 * it is deliberately honest about what a commission does NOT notify
 * (`question_count: null` for UPSC). Papers differ per exam AND per paper, so a
 * literal here is a bug waiting for the next exam: UPPSC Prelims GS-I is 150 Q /
 * 200 marks and UPSC's is 100 Q / 200 marks; UPPSC's Essay is 3 x 50 = 150 and
 * UPSC's is 2 x 125 = 250; UPSC has GS-I..IV at 250 each and no General Hindi
 * paper at all. The only things this module still holds are the two facts the
 * registry genuinely does not carry — a paper's short display label, and a mains
 * paper's per-question marks SHAPE (the registry notifies the total, not the
 * distribution), and the latter is asserted against the registry's total at
 * build time.
 *
 * A prelims mock's raw total is just its scoring scale — the result page
 * compares against the seeded official cut-offs by percentage, and
 * meta.official_max_marks records the real paper's max.
 */
import { DEFAULT_EXAM_CODE, type ExamCutoff, type ExamPaper } from "@neev/shared";
import { getExamConfig, requireAuthored } from "../lib/exam-config.js";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { HttpError } from "../lib/http-error.js";
import { listExamsDetailed } from "../lib/exams.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { PRELIMS_CSAT_PAPER_CODE, PRELIMS_GS1_PAPER_CODE, PRELIMS_MARKING } from "../lib/exam-papers.js";
import {
  UPSC_ESSAY_PAPER_CODE,
  UPSC_ETHICS_PAPER_CODE,
  UPSC_EXAM_CODE,
  UPSC_MAINS_GS_PAPER_CODES,
  UPSC_PRELIMS_CSAT_PAPER_CODE,
  UPSC_PRELIMS_GS1_PAPER_CODE,
} from "../lib/upsc-papers.js";
import { roundMarks } from "../lib/marks.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear, type OwnWeightage } from "../lib/weightage.js";

const MCQ_MARKS = 2;

/**
 * The exam-name half of a mock test's title, per stage.
 *
 * Now resolved PER EXAM rather than pinned to `DEFAULT_EXAM_CODE`. The old
 * comment here argued these builders are "single-exam by construction" — true
 * while `availableQuestions` hardcoded `.eq("exam_code", UPPSC_EXAM_CODE)` and
 * the paper table held only UPPSC's codes, and no longer true now that the
 * paper table is per-exam and the pool filter follows the paper's own exam.
 *
 * Deliberately a FUNCTION, not a module-level const: `requireAuthored` throws
 * for an exam whose title prefix is unauthored (mppsc today), and evaluating
 * that at import time would take down every module that transitively imports
 * this one. Called only for an exam we are actually building.
 */
function mockTitlePrefix(examCode: string, stage: "prelims" | "mains"): { en: string; hi: string } {
  const misc = getExamConfig(examCode).misc;
  return stage === "prelims"
    ? requireAuthored(misc.prelimsMockTitlePrefix, examCode, "misc.prelimsMockTitlePrefix")
    : requireAuthored(misc.mainsMockTitlePrefix, examCode, "misc.mainsMockTitlePrefix");
}

/**
 * A mock must ALWAYS carry at least this many questions from every populated
 * top-level section, so a rarely-asked section still appears — this is
 * reweighting toward high-frequency topics, NOT excluding low-frequency ones.
 */
const MOCK_MIN_PER_SECTION = 1;

/**
 * Shared hard ceiling on distinct mock sets per paper (was per-paper fixed caps:
 * prelims 3/1, mains 2). The actual set count is supply-driven —
 * min(MOCK_MAX_SETS, floor(available / count)) — so as the bank grows the count
 * grows toward this ceiling on the monthly rebuild, instead of freezing at a
 * hardcoded number. Mock sets sample independently (overlap across sets is
 * acceptable per product framing), so this is a variety/UX ceiling, not a
 * uniqueness limit; 6 keeps the Practice → Mock Tests list substantial but
 * manageable. Today's supply supports 4–9 sets per paper.
 */
export const MOCK_MAX_SETS = 6;

interface MockPaperConfig {
  examCode: string;
  paperCode: string;
  count: number;
  officialMaxMarks: number;
  durationMinutes: number;
  qualifyingPct?: number; // CSAT is qualifying-only
  /**
   * A FRACTION of the question's own marks, which is what `attempts.ts` applies
   * (`awarded = negative_marking * marks`). Sourced from
   * `exams.paper_structure[].papers[].negative_marking.fraction`, except for the
   * two frozen UPPSC values — see FROZEN_NEGATIVE_MARKING below.
   */
  negativeMarking: number;
  /** Short paper label for the mock title ("GS-I", "CSAT"). */
  title: { en: string; hi: string };
}

/**
 * ⚑ FROZEN, AND KNOWN TO BE WRONG FOR CSAT. Do not "tidy" these into the
 * registry without deciding to reprice live tests.
 *
 * `attempts.ts` multiplies `negative_marking` by the question's marks, so these
 * are FRACTIONS. The registry says 0.3333 for both UPPSC prelims papers, and
 * one-third is the real rule. But these two literals shipped long ago as
 * ABSOLUTE deductions ("one-third of 2 marks = 0.66") into a field that is a
 * fraction, so today:
 *   PRE_GS1  -0.33 x 1.33 = -0.44  ~ 1/3 of 1.33  (right, bar a 1% rounding)
 *   PRE_CSAT -0.66 x 2.00 = -1.32  vs 1/3 = 0.667 (WRONG — exactly DOUBLE)
 * The two readings coincide for GS-I only because its marks happen to be ~1,
 * which is why it went unnoticed. The same defect is in `ingest/tests.ts` for
 * sectional / pyq_full papers, so a fix belongs there too, in one deliberate
 * change that also decides what to do about already-submitted attempts (their
 * scheme is frozen in `attempts.meta` and would not be corrected retroactively).
 * Out of scope here: this commit must leave UPPSC's mocks scoring exactly as
 * they score today. A NEW exam has no such history and takes the registry's
 * own fraction, which is correct.
 */
const FROZEN_NEGATIVE_MARKING: Record<string, number> = {
  PRE_GS1: -0.33,
  PRE_CSAT: -0.66,
};

/**
 * Which papers get a mock, and the SHORT label its title uses.
 *
 * This table deliberately carries no marks, no duration, no question count and
 * no qualifying threshold — every one of those is read from
 * `exams.paper_structure` (migration 0106, verified against each commission's
 * own notification PDF) by `resolvePrelimsMockPapers` below. Titles stay here
 * because the registry's `name_i18n` is the LONG official name ("General
 * Studies-II (CSAT)") and these mocks have always used the short form a
 * candidate actually says.
 *
 * Replaces the `paperCode === "PRE_CSAT" ? CSAT : GS-I` ternary that was
 * duplicated at two call sites, and which would have titled a `UPSC_PRE_CSAT`
 * mock "GS-I".
 */
const PRELIMS_MOCK_PAPERS: { examCode: string; paperCode: string; title: { en: string; hi: string } }[] = [
  { examCode: DEFAULT_EXAM_CODE, paperCode: PRELIMS_GS1_PAPER_CODE, title: { en: "GS-I", hi: "जीएस-I" } },
  { examCode: DEFAULT_EXAM_CODE, paperCode: PRELIMS_CSAT_PAPER_CODE, title: { en: "CSAT", hi: "सीसैट" } },
  { examCode: UPSC_EXAM_CODE, paperCode: UPSC_PRELIMS_GS1_PAPER_CODE, title: { en: "GS-I", hi: "जीएस-I" } },
  { examCode: UPSC_EXAM_CODE, paperCode: UPSC_PRELIMS_CSAT_PAPER_CODE, title: { en: "CSAT", hi: "सीसैट" } },
];

/** One exam's registry row, indexed by paper code. Cached per build run. */
type PaperStructureIndex = Map<string, { exam: ExamRegistryRow; paper: ExamPaper }>;
type ExamRegistryRow = Awaited<ReturnType<typeof listExamsDetailed>>[number];

async function paperStructureIndex(): Promise<PaperStructureIndex> {
  const out: PaperStructureIndex = new Map();
  for (const exam of await listExamsDetailed()) {
    for (const stage of exam.paper_structure.stages) {
      for (const paper of stage.papers) {
        // Papers with no code are out of launch scope (UPSC's Paper-A/B and the
        // optional papers, MPPSC's whole structure) — nothing to build for.
        if (paper.paper_code) out.set(paper.paper_code, { exam, paper });
      }
    }
  }
  return out;
}

/**
 * Resolve one exam's prelims mock structures FROM THE REGISTRY.
 *
 * `question_count` is the interesting field. It is `null` for UPSC on purpose —
 * `0106` records that UPSC's notification fixes a prelims paper's MARKS and
 * DURATION but has never fixed its question count (the familiar 100/80 is
 * practice, not notification), and explicitly refuses to assert a number lifted
 * from past papers. So the rule is: use the notified count when the commission
 * notifies one, otherwise derive it as `marks / marks_per_question`, taking the
 * per-question marks from `lib/exam-papers.ts`'s PRELIMS_MARKING — the one table
 * in this repo that carries UPSC's real per-question figures, read off the real
 * booklet covers and already the source of truth for `questions.marks` at
 * ingest. That yields 200/2 = 100 for UPSC GS and 200/2.5 = 80 for CSAT, both
 * confirmed by the ingested bank (every year of GS-I is exactly 100 questions
 * summing to 200; every year of CSAT is exactly 80 summing to 200).
 */
async function resolvePrelimsMockPapers(examCode: string): Promise<MockPaperConfig[]> {
  const index = await paperStructureIndex();
  const out: MockPaperConfig[] = [];
  for (const spec of PRELIMS_MOCK_PAPERS.filter((p) => p.examCode === examCode)) {
    const hit = index.get(spec.paperCode);
    if (!hit) throw new HttpError(500, `mock config: ${spec.paperCode} is not in exams.paper_structure`);
    const { paper } = hit;
    const perQuestion = PRELIMS_MARKING[spec.paperCode]?.marksPerQuestion ?? paper.marks_per_question;
    const count = paper.question_count ?? (perQuestion ? Math.round(paper.marks / perQuestion) : null);
    if (!count || count <= 0) {
      throw new HttpError(
        500,
        `mock config: cannot determine a question count for ${spec.paperCode} — the registry notifies none and no per-question marks are known`,
      );
    }
    if (paper.duration_minutes == null) {
      throw new HttpError(500, `mock config: ${spec.paperCode} has no notified duration in exams.paper_structure`);
    }
    // A stage/evaluation gate is a "qualifying" threshold; a merit_floor is not
    // (the paper still counts for merit). A category-dependent minimum has no
    // single percentage, so it stays absent rather than being flattened to one.
    const min = paper.minimum;
    const qualifyingPct = min && min.role !== "merit_floor" && min.pct != null ? min.pct : undefined;
    if (!paper.negative_marking) {
      throw new HttpError(500, `mock config: ${spec.paperCode} has no negative_marking in exams.paper_structure`);
    }
    out.push({
      examCode,
      paperCode: spec.paperCode,
      count,
      officialMaxMarks: paper.marks,
      durationMinutes: paper.duration_minutes,
      ...(qualifyingPct === undefined ? {} : { qualifyingPct }),
      negativeMarking: FROZEN_NEGATIVE_MARKING[spec.paperCode] ?? -paper.negative_marking.fraction,
      title: spec.title,
    });
  }
  return out;
}

type Log = (msg: string) => void;

export interface AvailQ {
  id: string;
  marks: number;
  top: string;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** node_id -> top-level path segment, for the paper's tree (balance grouping). */
async function topLevelByNode(paperCode: string): Promise<Map<string, string>> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, path")
    .eq("paper_code", paperCode);
  if (error) throw new HttpError(500, `syllabus lookup failed: ${error.message}`);
  const out = new Map<string, string>();
  for (const n of (data ?? []) as { id: string; path: string }[]) {
    out.set(n.id, n.path ? n.path.split("/")[0] : "__root__");
  }
  return out;
}

/**
 * The exam that OWNS a paper — the value the pool queries filter `exam_code` on.
 *
 * Paper codes are globally unique across exams and a non-default exam's are
 * exam-prefixed (docs/multi-exam.md §0 / M23), so this is a total function on
 * the codes this module knows about. It replaces a hardcoded
 * `.eq("exam_code", UPPSC_EXAM_CODE)` in both pool queries, which made
 * `availableMockPool` UPPSC-only no matter which paper code it was handed.
 *
 * NOTE this is NOT the same question as `questions.exam_code`'s provenance
 * meaning: for a UPPSC paper the filter still resolves to `uppsc`, which is
 * exactly what deliberately excludes the up_ro_aro / upsssc_pet PYQs that share
 * UPPSC's paper codes for weightage analytics but must never appear inside a
 * paper claiming to be the genuine UPPSC pattern.
 *
 * Read off this module's own two paper tables rather than re-deriving the
 * prefix, so there is no way for the pool filter and the mock's declared exam
 * to disagree. Falls back to the default exam for a paper with no mock
 * structure — `availableMockPool` is only ever called for one that has one.
 */
function owningExamForPaper(paperCode: string): string {
  return (
    PRELIMS_MOCK_PAPERS.find((p) => p.paperCode === paperCode)?.examCode ??
    MAINS_MOCK_CONFIGS.find((p) => p.paperCode === paperCode)?.examCode ??
    DEFAULT_EXAM_CODE
  );
}

async function availableQuestions(paperCode: string): Promise<AvailQ[]> {
  const [rows, topByNode] = await Promise.all([
    // Paginate: a single paper's published MCQs across all years can exceed 1000
    // (e.g. PRE_GS1), which a single select would truncate — dropping questions
    // from the mock pool.
    selectAll<{ id: string; marks: number | null; syllabus_node_id: string | null }>(() =>
      supabase()
        .from("questions")
        .select("id, marks, syllabus_node_id")
        .eq("type", "mcq")
        .eq("paper_code", paperCode)
      // Some PYQs got tagged with this paper_code at ingest despite being
      // out-of-syllabus filler (e.g. UPSSSC-PET aptitude/reasoning items with
      // no real syllabus_node_id) — a full-length UPPSC-pattern mock must not
      // include them, or ~1 in 8 questions on the paper won't map to anything
      // a candidate actually studies. Every other catalog surface (tests.ts,
      // questions.ts) deliberately still SHOWS these rows (flagged, not
      // hidden), so this exclusion is scoped to mocks only, not folded into
      // the shared question-visibility filter.
      .eq("out_of_syllabus", false)
      // A mock is titled and marked to ONE commission's pattern, so it may only
      // contain that commission's own questions — same rationale as
      // ingest/tests.ts's pyq_full/sectional builders. Other exams (UPSSSC PET,
      // UP RO/ARO) intentionally share UPPSC's paper codes for weightage
      // analytics, but must never end up inside a paper claiming to be the
      // genuine UPPSC pattern. Scoped to the paper's OWN exam rather than a
      // hardcoded UPPSC, which is what made this pool UPPSC-only regardless of
      // the paper code passed in.
        .eq("exam_code", owningExamForPaper(paperCode))
        .or(questionVisibilityOrFilter("catalog"))
        .order("id", { ascending: true }),
    ),
    topLevelByNode(paperCode),
  ]);
  return rows.map((r) => ({
    id: r.id,
    marks: r.marks ?? MCQ_MARKS,
    top: (r.syllabus_node_id && topByNode.get(r.syllabus_node_id)) || "__unmapped__",
  }));
}

/**
 * Rolled-up recency-weighted PYQ frequency (hotness) per top-level section of a
 * paper, from the cached weightage matview — the SAME signal qgen/topup.ts and
 * the /learn weightage bars use. Every node under a section contributes, so a
 * chapter's weight reflects its whole subtree. Sections with no dated PYQ have
 * weight 0 (they still appear in a mock via the per-section floor).
 */
export async function sectionHotness(paperCode: string, weightage: Map<string, OwnWeightage>, year: number): Promise<Map<string, number>> {
  const topByNode = await topLevelByNode(paperCode);
  const out = new Map<string, number>();
  for (const [nodeId, top] of topByNode) {
    const w = weightage.get(nodeId);
    if (!w) continue;
    out.set(top, (out.get(top) ?? 0) + hotnessRaw(w.byYear, year));
  }
  return out;
}

/**
 * Weightage-weighted sample across top-level sections, so a mock's topic mix
 * tracks how often UPPSC actually asks each section (recency-weighted hotness),
 * the way a real paper does — instead of the old flat round-robin that gave a
 * niche section the same share as History/Polity.
 *
 * Two-phase, so it's reweighting rather than exclusion:
 *   1. Coverage floor — up to MOCK_MIN_PER_SECTION from every populated section,
 *      so even a zero-weightage section appears.
 *   2. Weighted fill — the remaining slots go to sections in proportion to their
 *      hotness, via a weighted-round-robin ticket interleave (a heavier section
 *      gets more early tickets). A section that runs dry is simply skipped.
 *   3. Any slots still unfilled (all remaining sections had weight 0, or supply
 *      ran short) are topped up from whatever's left, so the mock still reaches
 *      `count` whenever supply allows.
 */
export function weightedSample(items: AvailQ[], count: number, weightOf: (top: string) => number): AvailQ[] {
  const groups = new Map<string, AvailQ[]>();
  for (const it of items) (groups.get(it.top) ?? groups.set(it.top, []).get(it.top)!).push(it);
  for (const arr of groups.values()) arr.splice(0, arr.length, ...shuffle(arr));

  const picked: AvailQ[] = [];
  // 1. Coverage floor, highest-weightage sections first — so a small mock whose
  //    `count` is less than the number of sections still spends its floor on the
  //    sections UPPSC weights most, rather than on whatever section happened to
  //    appear first in the pool. (For count >= sections every section gets its
  //    floor regardless of order, so this only changes the small-mock case.)
  const floorOrder = [...groups.keys()].sort((a, b) => weightOf(b) - weightOf(a));
  for (const top of floorOrder) {
    const arr = groups.get(top)!;
    for (let i = 0; i < MOCK_MIN_PER_SECTION && arr.length && picked.length < count; i++) picked.push(arr.pop()!);
  }
  // 2. Weighted fill: tickets at position (k-0.5)/weight, walked ascending — a
  //    heavier section's tickets bunch up front, so it's drawn more often.
  const tickets: { pos: number; top: string }[] = [];
  for (const [top, arr] of groups) {
    const w = Math.max(0, weightOf(top));
    if (w <= 0 || arr.length === 0) continue;
    for (let k = 1; k <= arr.length; k++) tickets.push({ pos: (k - 0.5) / w, top });
  }
  tickets.sort((a, b) => a.pos - b.pos);
  for (const t of tickets) {
    if (picked.length >= count) break;
    const arr = groups.get(t.top)!;
    if (arr.length) picked.push(arr.pop()!);
  }
  // 3. Top-up from any leftover (weight-0 sections included).
  if (picked.length < count) {
    for (const it of shuffle([...groups.values()].flat())) {
      if (picked.length >= count) break;
      picked.push(it);
    }
  }
  return picked;
}

/** `marking_scheme.type` for one exam's prelims papers — a label, not logic. */
function prelimsMarkingType(examCode: string): string {
  return `${examCode}_prelims`;
}

async function upsertMockTest(input: {
  slug: string;
  examCode: string;
  paperCode: string;
  paperName: { en: string; hi: string };
  index: number;
  count: number;
  totalMarks: number;
  durationMinutes: number;
  officialMaxMarks: number;
  qualifyingPct?: number;
  negativeMarking: number;
}): Promise<string> {
  const prefix = mockTitlePrefix(input.examCode, "prelims");
  const { data, error } = await supabase()
    .from("tests")
    .upsert(
      {
        slug: input.slug,
        title_i18n: {
          en: `${prefix.en} ${input.paperName.en} — Mock Test ${input.index}`,
          hi: `${prefix.hi} ${input.paperName.hi} — मॉक टेस्ट ${input.index}`,
        },
        kind: "mock",
        // Stamped explicitly. The column default is a perfectly valid exam code,
        // so relying on it would silently tag every second exam's mock `uppsc`
        // and nothing would ever error.
        exam_code: input.examCode,
        paper_code: input.paperCode,
        duration_minutes: input.durationMinutes,
        total_marks: input.totalMarks,
        is_published: true,
        meta: {
          source: "mock",
          mock_index: input.index,
          official_max_marks: input.officialMaxMarks,
          qualifying_pct: input.qualifyingPct ?? null,
          marking_scheme: {
            type: prelimsMarkingType(input.examCode),
            negative_marking: input.negativeMarking,
            note: "one-third (1/3) negative marking",
          },
        },
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (error) throw new HttpError(500, `mock upsert failed: ${error.message}`);
  return data.id as string;
}

async function setMembership(testId: string, items: AvailQ[]): Promise<void> {
  const del = await supabase().from("test_questions").delete().eq("test_id", testId);
  if (del.error) throw new HttpError(500, `clear members failed: ${del.error.message}`);
  const rows = items.map((it, i) => ({ test_id: testId, question_id: it.id, order_index: i, marks: it.marks }));
  const ins = await supabase().from("test_questions").insert(rows);
  if (ins.error) throw new HttpError(500, `insert members failed: ${ins.error.message}`);
}

export interface MockBuildResult {
  exam_code: string;
  paper_code: string;
  built: number;
  skipped: boolean;
}

/**
 * `examCodes` is REQUIRED. A defaulted exam set is how a scheduled job keeps
 * building for one exam while looking parameterised (M24), and here the wrong
 * default is worse than a wrong value: building for a not-yet-live exam writes
 * real `tests` rows. The policy lives in `mocks/build.ts`'s
 * `resolveMockBuildExams` — default = live exams, `--exam` to override.
 */
export async function buildMocks(examCodes: string[], log: Log = () => {}): Promise<MockBuildResult[]> {
  const results: MockBuildResult[] = [];
  const weightage = await loadNodeWeightage();
  const year = currentExamYear();
  for (const examCode of examCodes) {
    for (const cfg of await resolvePrelimsMockPapers(examCode)) {
      const available = await availableQuestions(cfg.paperCode);
      if (available.length < cfg.count) {
        log(
          `${cfg.paperCode}: only ${available.length}/${cfg.count} published MCQs — skipping (can't build a full mock)`,
        );
        results.push({ exam_code: examCode, paper_code: cfg.paperCode, built: 0, skipped: true });
        continue;
      }
      const hot = await sectionHotness(cfg.paperCode, weightage, year);
      const weightOf = (top: string) => hot.get(top) ?? 0;
      // As many distinct sets as supply allows, capped by the shared ceiling.
      const numSets = Math.min(MOCK_MAX_SETS, Math.max(1, Math.floor(available.length / cfg.count)));
      for (let s = 1; s <= numSets; s++) {
        const sample = weightedSample(available, cfg.count, weightOf);
        const totalMarks = roundMarks(sample.reduce((sum, q) => sum + q.marks, 0));
        // `mock:<PAPER_CODE>:<n>` needs no exam qualifier: paper codes are
        // globally unique across exams and a non-default exam's are prefixed,
        // so `mock:UPSC_PRE_GS1:1` cannot collide with `mock:PRE_GS1:1`.
        const testId = await upsertMockTest({
          slug: `mock:${cfg.paperCode}:${s}`,
          examCode,
          paperCode: cfg.paperCode,
          paperName: cfg.title,
          index: s,
          count: cfg.count,
          totalMarks,
          durationMinutes: cfg.durationMinutes,
          officialMaxMarks: cfg.officialMaxMarks,
          qualifyingPct: cfg.qualifyingPct,
          negativeMarking: cfg.negativeMarking,
        });
        await setMembership(testId, sample);
        log(`built mock:${cfg.paperCode}:${s} — ${sample.length} questions, ${totalMarks} marks`);
      }
      results.push({ exam_code: examCode, paper_code: cfg.paperCode, built: numSets, skipped: false });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mains mocks — same balanced-sampling approach, descriptive questions, no
// negative marking, 3 hours. Each paper has its own fixed structure (verified
// against the real papers): GS1-6 = 20 questions / 200 marks (10×8 + 10×12);
// Essay = 3 written essays × 50 = 150 (the paper offers section-choice among 9
// topics, but a linear session models the 3 actually written); General Hindi =
// 8 questions / 150 (4×10 + 1×20 + 3×30). Each is captured in MAINS_MOCK_CONFIGS.
// ---------------------------------------------------------------------------

interface MainsMockConfig {
  examCode: string;
  paperCode: string;
  /** Number of questions per set. */
  count: number;
  /** The real paper's exact per-question marks (length === count, sum === the paper max). A sampled PYQ is RE-WEIGHTED to this pattern so every set matches the actual paper, regardless of the PYQs' own marks. Rides on test_questions.marks → the session's meta.marks → the evaluation max score. */
  marksPattern: number[];
  /** Paper name for the mock title. */
  title: { en: string; hi: string };
}

// Post-reform UPPSC Mains GS paper: 10 questions × 8 + 10 × 12 = 200 (verified
// identical across every GS1-6 paper, 2023-2025).
const MAINS_GS_MARKS = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12];

/**
 * UPSC Mains GS-I..III: 10 questions × 10 + 10 × 15 = 250. Derived from the
 * ingested bank, not from memory — every year 2017-2025 of all three papers is
 * exactly this shape (2016 was the pre-reform 20 × 12.5 = 250 and is
 * superseded). Sums to the registry's notified 250, which
 * `assertMainsPatternMatchesRegistry` re-checks at build time.
 */
const UPSC_MAINS_GS_MARKS = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15];

/**
 * UPSC Mains GS-IV (Ethics): 11 × 20 + 1 × 30 = 250. Also derived from the bank
 * — the settled modern shape (2018, 2020-2025 identical; 2016/2017/2019 differ
 * in question count but every year still sums to 250). GS-IV is genuinely a
 * different structure from GS-I..III, which is why it cannot share the pattern
 * above: 12 questions, not 20.
 */
const UPSC_MAINS_GS4_MARKS = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 30];

const MAINS_MOCK_CONFIGS: MainsMockConfig[] = [
  ...["1", "2", "3", "4", "5", "6"].map((n) => ({
    examCode: DEFAULT_EXAM_CODE,
    paperCode: `MAINS_GS${n}`,
    count: 20,
    marksPattern: MAINS_GS_MARKS,
    title: { en: `GS-${n}`, hi: `जीएस-${n}` },
  })),
  // Essay: the paper presents 9 topics with section-choice, but a candidate
  // WRITES 3 essays × 50 = 150 marks — a linear session can't model "pick 1 of 3
  // per section", so the mock is those 3 written essays (sampled across sections).
  {
    examCode: DEFAULT_EXAM_CODE,
    paperCode: "MAINS_ESSAY",
    count: 3,
    marksPattern: [50, 50, 50],
    title: { en: "Essay", hi: "निबंध" },
  },
  // General Hindi: 8 questions / 150 marks — the consistent 2022-25 pattern
  // (4×10 + 1×20 + 3×30). UPSC has NO counterpart paper (see lib/upsc-papers.ts).
  {
    examCode: DEFAULT_EXAM_CODE,
    paperCode: "MAINS_GH",
    count: 8,
    marksPattern: [10, 10, 10, 10, 20, 30, 30, 30],
    title: { en: "General Hindi", hi: "सामान्य हिन्दी" },
  },
  ...UPSC_MAINS_GS_PAPER_CODES.map((code, i) => ({
    examCode: UPSC_EXAM_CODE,
    paperCode: code,
    count: code === UPSC_ETHICS_PAPER_CODE ? UPSC_MAINS_GS4_MARKS.length : UPSC_MAINS_GS_MARKS.length,
    marksPattern: code === UPSC_ETHICS_PAPER_CODE ? UPSC_MAINS_GS4_MARKS : UPSC_MAINS_GS_MARKS,
    title: { en: `GS-${i + 1}`, hi: `जीएस-${i + 1}` },
  })),
  // UPSC Essay is structurally UNLIKE UPPSC's: the paper offers 8 topics in two
  // sections and a candidate WRITES 2 essays × 125 = 250 marks (vs UPPSC's
  // 3 × 50 = 150). Confirmed across all ten ingested years — 8 topics × 125 each
  // — and 2 × 125 sums to the registry's notified 250.
  {
    examCode: UPSC_EXAM_CODE,
    paperCode: UPSC_ESSAY_PAPER_CODE,
    count: 2,
    marksPattern: [125, 125],
    title: { en: "Essay", hi: "निबंध" },
  },
];

/**
 * A mains mock's structure is half registry, half corpus, and this is the seam
 * between them: the registry notifies a paper's TOTAL marks and duration but
 * never its per-question shape, so `marksPattern` is derived from the ingested
 * papers above. This asserts the two agree — a pattern that does not sum to the
 * commission's own notified total is wrong by construction, whichever side is
 * at fault, and a mock built from it would score every answer against a
 * fabricated maximum. Holds for all 9 existing UPPSC papers today, so it is a
 * live gate rather than a UPSC-only one.
 */
function assertMainsPatternMatchesRegistry(cfg: MainsMockConfig, paper: ExamPaper): void {
  const sum = cfg.marksPattern.reduce((s, m) => s + m, 0);
  if (sum !== paper.marks) {
    throw new HttpError(
      500,
      `mock config: ${cfg.paperCode} marksPattern sums to ${sum} but exams.paper_structure notifies ${paper.marks}`,
    );
  }
  if (cfg.marksPattern.length !== cfg.count) {
    throw new HttpError(
      500,
      `mock config: ${cfg.paperCode} has count=${cfg.count} but a ${cfg.marksPattern.length}-entry marksPattern`,
    );
  }
}

async function availableDescriptiveQuestions(paperCode: string): Promise<AvailQ[]> {
  const [rows, topByNode] = await Promise.all([
    selectAll<{ id: string; marks: number | null; syllabus_node_id: string | null }>(() =>
      supabase()
        .from("questions")
        .select("id, marks, syllabus_node_id")
        .eq("type", "descriptive")
        .eq("paper_code", paperCode)
        // Same per-paper exam scoping as the MCQ pool above.
        .eq("exam_code", owningExamForPaper(paperCode))
        .or(questionVisibilityOrFilter("catalog"))
        .order("id", { ascending: true }),
    ),
    topLevelByNode(paperCode),
  ]);
  return rows.map((r) => ({
    id: r.id,
    marks: r.marks ?? 0,
    top: (r.syllabus_node_id && topByNode.get(r.syllabus_node_id)) || "__unmapped__",
  }));
}

async function upsertMainsMockTest(input: {
  slug: string;
  examCode: string;
  paperCode: string;
  index: number;
  totalMarks: number;
  officialMax: number;
  durationMinutes: number;
  title: { en: string; hi: string };
  sample: AvailQ[];
}): Promise<string> {
  const prefix = mockTitlePrefix(input.examCode, "mains");
  const { data, error } = await supabase()
    .from("tests")
    .upsert(
      {
        slug: input.slug,
        title_i18n: {
          en: `${prefix.en} ${input.title.en} — Mock Test ${input.index}`,
          hi: `${prefix.hi} ${input.title.hi} — मॉक टेस्ट ${input.index}`,
        },
        kind: "mock",
        exam_code: input.examCode,
        paper_code: input.paperCode,
        // From the registry's own notified duration, not a module constant —
        // 180 for both exams today, but it is a per-paper fact (MPPSC already
        // notifies 120 and 150 for two of its mains papers).
        duration_minutes: input.durationMinutes,
        total_marks: input.totalMarks,
        is_published: true,
        meta: {
          source: "mock",
          mock_index: input.index,
          official_max_marks: input.officialMax,
          marking_scheme: { type: "descriptive", negative_marking: 0 },
        },
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (error) throw new HttpError(500, `mains mock upsert failed: ${error.message}`);
  const testId = data.id as string;
  await setMembership(testId, input.sample);
  return testId;
}

/** `examCodes` is REQUIRED — same reasoning as `buildMocks`. */
export async function buildMainsMocks(examCodes: string[], log: Log = () => {}): Promise<MockBuildResult[]> {
  const results: MockBuildResult[] = [];
  const weightage = await loadNodeWeightage();
  const year = currentExamYear();
  const index = await paperStructureIndex();
  for (const examCode of examCodes) {
    for (const cfg of MAINS_MOCK_CONFIGS.filter((c) => c.examCode === examCode)) {
      const hit = index.get(cfg.paperCode);
      if (!hit) throw new HttpError(500, `mock config: ${cfg.paperCode} is not in exams.paper_structure`);
      // The registry is authoritative for the paper's TOTAL; the pattern only
      // says how that total is distributed across questions.
      assertMainsPatternMatchesRegistry(cfg, hit.paper);
      const officialMax = hit.paper.marks;
      const durationMinutes = hit.paper.duration_minutes;
      if (durationMinutes == null) {
        throw new HttpError(500, `mock config: ${cfg.paperCode} has no notified duration in exams.paper_structure`);
      }
      const available = await availableDescriptiveQuestions(cfg.paperCode);
      if (available.length < cfg.count) {
        log(`${cfg.paperCode}: only ${available.length}/${cfg.count} published descriptive PYQs — skipping`);
        results.push({ exam_code: examCode, paper_code: cfg.paperCode, built: 0, skipped: true });
        continue;
      }
      const hot = await sectionHotness(cfg.paperCode, weightage, year);
      const weightOf = (top: string) => hot.get(top) ?? 0;
      const numSets = Math.min(MOCK_MAX_SETS, Math.max(1, Math.floor(available.length / cfg.count)));
      for (let s = 1; s <= numSets; s++) {
        const sample = weightedSample(available, cfg.count, weightOf);
        // Re-weight each sampled question to the real paper's marks pattern
        // (shuffled so the values are mixed, like the actual paper), so every set
        // matches the paper's exact structure regardless of the PYQs' own marks.
        const pattern = shuffle(cfg.marksPattern);
        const weighted = sample.map((q, i) => ({ ...q, marks: pattern[i] ?? cfg.marksPattern[0] }));
        const totalMarks = weighted.reduce((sum, q) => sum + q.marks, 0);
        await upsertMainsMockTest({
          slug: `mock:${cfg.paperCode}:${s}`,
          examCode,
          paperCode: cfg.paperCode,
          index: s,
          totalMarks,
          officialMax,
          durationMinutes,
          title: cfg.title,
          sample: weighted,
        });
        log(`built mock:${cfg.paperCode}:${s} — ${weighted.length} questions, ${totalMarks} marks`);
      }
      results.push({ exam_code: examCode, paper_code: cfg.paperCode, built: numSets, skipped: false });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Fresh (on-demand) mocks — services/on-demand.ts's "Show me a new set" for the
// Mock Tests tab reuses the SAME paper structure + question pools as the seeded
// series, so a fresh mock is a genuine full-length paper in that exam's own
// pattern. The unified config + pool accessor below expose that knowledge
// without duplicating it; on-demand.ts owns the seen-exclusion,
// section-balancing (weightedSample), and the new test row.
// ---------------------------------------------------------------------------

/** Unified fresh-mock paper structure across prelims (MCQ) and mains (descriptive). */
export interface FreshMockPaper {
  examCode: string;
  kind: "mcq" | "descriptive";
  count: number;
  durationMinutes: number;
  officialMaxMarks: number;
  qualifyingPct: number | null;
  negativeMarking: number;
  /** Descriptive only: exact per-question marks pattern (length === count). Null for MCQ. */
  marksPattern: number[] | null;
  title: { en: string; hi: string };
  /** `marking_scheme.type` to stamp on the generated test. */
  markingSchemeType: string;
}

/**
 * The fresh-mock config for a paper code, or null if that paper has no mock
 * structure. ASYNC because the structure is read from `exams.paper_structure`
 * rather than from literals — the whole point of this change.
 */
export async function freshMockPaperConfig(paperCode: string): Promise<FreshMockPaper | null> {
  const preSpec = PRELIMS_MOCK_PAPERS.find((p) => p.paperCode === paperCode);
  if (preSpec) {
    const pre = (await resolvePrelimsMockPapers(preSpec.examCode)).find((p) => p.paperCode === paperCode);
    if (!pre) return null;
    return {
      examCode: pre.examCode,
      kind: "mcq",
      count: pre.count,
      durationMinutes: pre.durationMinutes,
      officialMaxMarks: pre.officialMaxMarks,
      qualifyingPct: pre.qualifyingPct ?? null,
      negativeMarking: pre.negativeMarking,
      marksPattern: null,
      title: pre.title,
      markingSchemeType: prelimsMarkingType(pre.examCode),
    };
  }
  const mains = MAINS_MOCK_CONFIGS.find((p) => p.paperCode === paperCode);
  if (mains) {
    const hit = (await paperStructureIndex()).get(paperCode);
    if (!hit) return null;
    assertMainsPatternMatchesRegistry(mains, hit.paper);
    if (hit.paper.duration_minutes == null) return null;
    return {
      examCode: mains.examCode,
      kind: "descriptive",
      count: mains.count,
      durationMinutes: hit.paper.duration_minutes,
      officialMaxMarks: hit.paper.marks,
      qualifyingPct: null,
      negativeMarking: 0,
      marksPattern: mains.marksPattern,
      title: mains.title,
      markingSchemeType: "descriptive",
    };
  }
  return null;
}

/**
 * The paper codes one exam has a mock structure for, by stage. Derived from the
 * two paper tables so there is exactly one answer to "which papers get a mock",
 * and an exam with none (mppsc today) honestly returns empty lists rather than
 * another exam's papers.
 */
export function mockPaperCodes(examCode: string): { prelims: string[]; mains: string[] } {
  return {
    prelims: PRELIMS_MOCK_PAPERS.filter((p) => p.examCode === examCode).map((p) => p.paperCode),
    mains: MAINS_MOCK_CONFIGS.filter((p) => p.examCode === examCode).map((p) => p.paperCode),
  };
}

/** Whole-paper question pool (with section `top` grouping) for a fresh mock. */
export function availableMockPool(paperCode: string, kind: "mcq" | "descriptive"): Promise<AvailQ[]> {
  return kind === "mcq" ? availableQuestions(paperCode) : availableDescriptiveQuestions(paperCode);
}

/**
 * Cut-offs for a PAPER. `paperCode` (not examCode) — migration 0106 renamed the
 * misnamed `exam_cutoffs.exam_code` column to `paper_code` (it always held
 * 'PRE_GS1') and added a real `exam_code` alongside it. Filtering on both keeps
 * the lookup correct once a second exam seeds cut-offs for its own papers.
 *
 * BOTH parameters are required on purpose. This function shipped with
 * `examCode: string = DEFAULT_EXAM_CODE` and its only caller never passed one,
 * so the exam filter was inert and every user got UPPSC's cut-offs regardless of
 * `target_exam` — the promise in the paragraph above was not actually kept. A
 * trailing defaulted parameter lets a caller silently keep the old behaviour;
 * `paperCode`'s own default had to go too, since TypeScript forbids a required
 * parameter after an optional one (the route's zod schema still defaults it).
 * Same trap as `getMasteryMap`'s `targetExam` — see docs/multi-exam.md §3f.
 */
export async function getCutoffs(paperCode: string, examCode: string): Promise<ExamCutoff[]> {
  const { data, error } = await supabase()
    .from("exam_cutoffs")
    .select("exam_code, paper_code, stage, year, category, cutoff, out_of, is_official")
    .eq("paper_code", paperCode)
    .eq("exam_code", examCode)
    .order("year", { ascending: false })
    .order("category", { ascending: true });
  if (error) throw new HttpError(500, `cutoffs lookup failed: ${error.message}`);
  return ((data ?? []) as ExamCutoff[]).map((c) => ({ ...c, cutoff: Number(c.cutoff) }));
}
