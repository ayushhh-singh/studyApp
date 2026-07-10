/**
 * Mock test series. `buildMocks` assembles full-length, UPPSC-Prelims-pattern
 * papers from the published+approved MCQ bank, balanced across the paper's
 * syllabus tree (round-robin across top-level sections). Verified pattern:
 * GS-I 150 questions / 200 marks / 120 min, CSAT 100 / 200 / 120, both with
 * one-third negative marking; CSAT is qualifying at 33%.
 *
 * A mock's raw total (2 marks/MCQ) is just its scoring scale — the result page
 * compares against the seeded official cut-offs (out of 200) by percentage, and
 * meta.official_max_marks records the real paper's max.
 */
import type { ExamCutoff } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";

const MCQ_MARKS = 2;

interface MockPaperConfig {
  paperCode: string;
  count: number;
  officialMaxMarks: number;
  durationMinutes: number;
  qualifyingPct?: number; // CSAT is qualifying-only
  maxSets: number;
  // Real UPPSC Prelims negative marking (verified via web search, matches
  // ingest/tests.ts's PRELIMS_MARKING): GS-I -0.33 (one-third of 1.33/correct),
  // CSAT -0.66 (one-third of 2/correct) — NOT the same value, since a mock's
  // raw per-question marks (MCQ_MARKS=2 for both, as a flat scoring scale)
  // differ from each paper's real per-question marks that the negative
  // marking fraction is actually taken from.
  negativeMarking: number;
}

const MOCK_PAPERS: MockPaperConfig[] = [
  { paperCode: "PRE_GS1", count: 150, officialMaxMarks: 200, durationMinutes: 120, maxSets: 3, negativeMarking: -0.33 },
  {
    paperCode: "PRE_CSAT",
    count: 100,
    officialMaxMarks: 200,
    durationMinutes: 120,
    qualifyingPct: 33,
    maxSets: 1,
    negativeMarking: -0.66,
  },
];

type Log = (msg: string) => void;

interface AvailQ {
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

async function availableQuestions(paperCode: string): Promise<AvailQ[]> {
  const [rows, topByNode] = await Promise.all([
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
      // Mocks are titled/marked "UPPSC Prelims" and use UPPSC's own marking
      // scheme — same rationale as ingest/tests.ts's pyq_full/sectional
      // builders (see that file's doc comment). Non-UPPSC exams (UPSC CSE,
      // UPSSSC PET) intentionally share this paper_code for weightage
      // analytics elsewhere, but must never end up inside a paper claiming
      // to be the genuine UPPSC pattern.
      .eq("exam_code", "uppsc")
      .or(questionVisibilityOrFilter("catalog")),
    topLevelByNode(paperCode),
  ]);
  if (rows.error) throw new HttpError(500, `mock question lookup failed: ${rows.error.message}`);
  return ((rows.data ?? []) as { id: string; marks: number | null; syllabus_node_id: string | null }[]).map((r) => ({
    id: r.id,
    marks: r.marks ?? MCQ_MARKS,
    top: (r.syllabus_node_id && topByNode.get(r.syllabus_node_id)) || "__unmapped__",
  }));
}

/** Round-robin across top-level sections so the mock spreads over the syllabus tree. */
function balancedSample(items: AvailQ[], count: number): AvailQ[] {
  const groups = new Map<string, AvailQ[]>();
  for (const it of items) (groups.get(it.top) ?? groups.set(it.top, []).get(it.top)!).push(it);
  for (const arr of groups.values()) arr.splice(0, arr.length, ...shuffle(arr));
  const keys = shuffle([...groups.keys()]);
  const picked: AvailQ[] = [];
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (const k of keys) {
      const arr = groups.get(k)!;
      if (arr.length) {
        picked.push(arr.pop()!);
        progressed = true;
        if (picked.length >= count) break;
      }
    }
  }
  return picked;
}

async function upsertMockTest(input: {
  slug: string;
  paperCode: string;
  index: number;
  count: number;
  totalMarks: number;
  durationMinutes: number;
  officialMaxMarks: number;
  qualifyingPct?: number;
  negativeMarking: number;
}): Promise<string> {
  const paperName = input.paperCode === "PRE_CSAT" ? { en: "CSAT", hi: "सीसैट" } : { en: "GS-I", hi: "जीएस-I" };
  const { data, error } = await supabase()
    .from("tests")
    .upsert(
      {
        slug: input.slug,
        title_i18n: {
          en: `UPPSC Prelims ${paperName.en} — Mock Test ${input.index}`,
          hi: `यूपीपीएससी प्रारंभिक ${paperName.hi} — मॉक टेस्ट ${input.index}`,
        },
        kind: "mock",
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
            type: "uppsc_prelims",
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
  paper_code: string;
  built: number;
  skipped: boolean;
}

export async function buildMocks(log: Log = () => {}): Promise<MockBuildResult[]> {
  const results: MockBuildResult[] = [];
  for (const cfg of MOCK_PAPERS) {
    const available = await availableQuestions(cfg.paperCode);
    if (available.length < cfg.count) {
      log(`${cfg.paperCode}: only ${available.length}/${cfg.count} published MCQs — skipping (can't build a full mock)`);
      results.push({ paper_code: cfg.paperCode, built: 0, skipped: true });
      continue;
    }
    // As many distinct sets as supply allows, capped by maxSets.
    const numSets = Math.min(cfg.maxSets, Math.max(1, Math.floor(available.length / cfg.count)));
    for (let s = 1; s <= numSets; s++) {
      const sample = balancedSample(available, cfg.count);
      const totalMarks = sample.reduce((sum, q) => sum + q.marks, 0);
      const testId = await upsertMockTest({
        slug: `mock:${cfg.paperCode}:${s}`,
        paperCode: cfg.paperCode,
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
    results.push({ paper_code: cfg.paperCode, built: numSets, skipped: false });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mains mocks — same balanced-sampling approach, descriptive questions.
// Verified pattern (web search): each GS paper is 20 questions / 200 marks /
// 3 hours, no negative marking. Scoped to the six GS papers (III-VIII, the
// "backbone" of Mains per every source found) — Essay/General Hindi have a
// structurally different pattern (topic CHOICES, not a fixed question set)
// that a round-robin balanced mock doesn't model well, so they're left to the
// existing yearly/sectional/custom modes instead.
// ---------------------------------------------------------------------------

const MAINS_GS_PAPER_CODES = ["MAINS_GS1", "MAINS_GS2", "MAINS_GS3", "MAINS_GS4", "MAINS_GS5", "MAINS_GS6"];
const MAINS_MOCK_COUNT = 20;
const MAINS_MOCK_DURATION_MINUTES = 180;
const MAINS_MOCK_MAX_SETS = 2;
// The real paper's max (verified: 20Q/200 marks per GS paper) — distinct
// from a sample's own totalMarks (real per-question marks vary, so a
// balanced sample rarely sums to exactly 200; official_max_marks must stay
// the fixed reference figure the result page compares against, same
// separation the Prelims mock config already makes between
// officialMaxMarks and a sample's raw totalMarks).
const MAINS_MOCK_OFFICIAL_MAX_MARKS = 200;

async function availableDescriptiveQuestions(paperCode: string): Promise<AvailQ[]> {
  const [rows, topByNode] = await Promise.all([
    supabase()
      .from("questions")
      .select("id, marks, syllabus_node_id")
      .eq("type", "descriptive")
      .eq("paper_code", paperCode)
      .eq("exam_code", "uppsc")
      .or(questionVisibilityOrFilter("catalog")),
    topLevelByNode(paperCode),
  ]);
  if (rows.error) throw new HttpError(500, `mains mock question lookup failed: ${rows.error.message}`);
  return ((rows.data ?? []) as { id: string; marks: number | null; syllabus_node_id: string | null }[]).map((r) => ({
    id: r.id,
    marks: r.marks ?? 0,
    top: (r.syllabus_node_id && topByNode.get(r.syllabus_node_id)) || "__unmapped__",
  }));
}

async function upsertMainsMockTest(input: {
  slug: string;
  paperCode: string;
  index: number;
  totalMarks: number;
  sample: AvailQ[];
}): Promise<string> {
  const paperNum = input.paperCode.replace("MAINS_GS", "");
  const { data, error } = await supabase()
    .from("tests")
    .upsert(
      {
        slug: input.slug,
        title_i18n: {
          en: `UPPSC Mains GS-${paperNum} — Mock Test ${input.index}`,
          hi: `यूपीपीएससी मुख्य जीएस-${paperNum} — मॉक टेस्ट ${input.index}`,
        },
        kind: "mock",
        paper_code: input.paperCode,
        duration_minutes: MAINS_MOCK_DURATION_MINUTES,
        total_marks: input.totalMarks,
        is_published: true,
        meta: {
          source: "mock",
          mock_index: input.index,
          official_max_marks: MAINS_MOCK_OFFICIAL_MAX_MARKS,
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

export async function buildMainsMocks(log: Log = () => {}): Promise<MockBuildResult[]> {
  const results: MockBuildResult[] = [];
  for (const paperCode of MAINS_GS_PAPER_CODES) {
    const available = await availableDescriptiveQuestions(paperCode);
    if (available.length < MAINS_MOCK_COUNT) {
      log(`${paperCode}: only ${available.length}/${MAINS_MOCK_COUNT} published descriptive PYQs — skipping`);
      results.push({ paper_code: paperCode, built: 0, skipped: true });
      continue;
    }
    const numSets = Math.min(MAINS_MOCK_MAX_SETS, Math.max(1, Math.floor(available.length / MAINS_MOCK_COUNT)));
    for (let s = 1; s <= numSets; s++) {
      const sample = balancedSample(available, MAINS_MOCK_COUNT);
      const totalMarks = sample.reduce((sum, q) => sum + q.marks, 0);
      await upsertMainsMockTest({ slug: `mock:${paperCode}:${s}`, paperCode, index: s, totalMarks, sample });
      log(`built mock:${paperCode}:${s} — ${sample.length} questions, ${totalMarks} marks`);
    }
    results.push({ paper_code: paperCode, built: numSets, skipped: false });
  }
  return results;
}

export async function getCutoffs(examCode = "PRE_GS1"): Promise<ExamCutoff[]> {
  const { data, error } = await supabase()
    .from("exam_cutoffs")
    .select("exam_code, stage, year, category, cutoff, out_of, is_official")
    .eq("exam_code", examCode)
    .order("year", { ascending: false })
    .order("category", { ascending: true });
  if (error) throw new HttpError(500, `cutoffs lookup failed: ${error.message}`);
  return ((data ?? []) as ExamCutoff[]).map((c) => ({ ...c, cutoff: Number(c.cutoff) }));
}
