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

const PRELIMS_NEGATIVE = -0.33;
const MCQ_MARKS = 2;

interface MockPaperConfig {
  paperCode: string;
  count: number;
  officialMaxMarks: number;
  durationMinutes: number;
  qualifyingPct?: number; // CSAT is qualifying-only
  maxSets: number;
}

const MOCK_PAPERS: MockPaperConfig[] = [
  { paperCode: "PRE_GS1", count: 150, officialMaxMarks: 200, durationMinutes: 120, maxSets: 3 },
  { paperCode: "PRE_CSAT", count: 100, officialMaxMarks: 200, durationMinutes: 120, qualifyingPct: 33, maxSets: 1 },
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
            negative_marking: PRELIMS_NEGATIVE,
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
      });
      await setMembership(testId, sample);
      log(`built mock:${cfg.paperCode}:${s} — ${sample.length} questions, ${totalMarks} marks`);
    }
    results.push({ paper_code: cfg.paperCode, built: numSets, skipped: false });
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
