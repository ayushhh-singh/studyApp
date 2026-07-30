/**
 * The daily answer set: a few GS descriptive questions per IST day rotating
 * across the exam's own GS papers (UPPSC: six, incl. GS-V/VI UP), plus one
 * weekly ESSAY slot on Sundays for exams with an authored essay paper.
 *
 * WHICH papers feature each day is a fixed calendar rotation (answerSetPapers);
 * WHICH question within each paper is a combined weak-AND-heavily-tested pick
 * (see getDailyAnswerSet) — deterministic per (user, day), so it's stable within
 * a day (no storage) yet favours the topics that matter most for this user and
 * rotates over time. Sourced from published + review-approved descriptive
 * questions (Mains PYQs + the approved generated pool) via the centralized
 * visibility helper. Per-question status is "evaluated" once the user has a
 * completed evaluation for that question — one such completion maintains the
 * streak.
 *
 * PAPER FAMILY is resolved per user via `getExamConfig(examCode).papers`
 * (`lib/exam-config.ts`) rather than the hardcoded UPPSC paper-code constants —
 * an exam with no ingested Mains GS papers yet (`papers.mainsGs = []`)
 * correctly gets an EMPTY daily set instead of silently being served UPPSC's
 * rotation (docs/multi-exam.md).
 */
import type { BilingualText, DailyAnswerItem, DailyAnswerKind, DailyAnswerSet } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { daysBetween, istDayRangeUtc, istToday } from "../lib/ist.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { loadNodeWeightage, hotnessRaw, currentExamYear } from "../lib/weightage.js";
import { ANSWER_SET_CONFIG } from "../daily/config.js";
import { ESSAY_MAX_MARKS, ESSAY_WORD_LIMIT } from "../lib/exam-papers.js";
import { getExamConfig, type ExamPapers } from "../lib/exam-config.js";
import { getUserExam } from "../lib/exams.js";

interface DescQRow {
  id: string;
  paper_code: string;
  stem_i18n: BilingualText;
  word_limit: number | null;
  marks: number | null;
  syllabus_node_id: string | null;
}

/**
 * A deterministic per-(user, day) weighted pick, so the set is stable within a
 * day yet still favours high-priority questions AND rotates over time. Each row
 * gets weight `PICK_FLOOR + score`, so a low-score question keeps a nonzero
 * chance (coverage) while a weak-and-common one is chosen on more days.
 */
export const PICK_FLOOR = 0.35;

/** FNV-1a → a stable fraction in [0,1) for a seed string (no storage, reproducible). */
function seededFraction(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function weightedPick(rows: DescQRow[], weights: number[], seed: string): DescQRow {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = seededFraction(seed) * sum;
  for (let i = 0; i < rows.length; i++) {
    r -= weights[i];
    if (r < 0) return rows[i];
  }
  return rows[rows.length - 1];
}

/** IST weekday for a `YYYY-MM-DD` date, 0 = Sunday. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * The papers featured on a given day (rotating GS window + optional essay),
 * scoped to ONE exam's own Mains paper family — never the UPPSC constants
 * directly. `papers.mainsGs` is empty for an exam with no ingested Mains GS
 * papers (getExamConfig), which correctly yields an empty rotation rather than
 * falling through to another exam's paper codes.
 */
export function answerSetPapers(date: string, papers: ExamPapers): { paperCode: string; kind: DailyAnswerKind }[] {
  if (papers.mainsGs.length === 0) return [];
  const dayNum = daysBetween("1970-01-01", date);
  const start = ((dayNum % papers.mainsGs.length) + papers.mainsGs.length) % papers.mainsGs.length;
  const gs = Array.from({ length: ANSWER_SET_CONFIG.gsPerDay }, (_, i) => ({
    paperCode: papers.mainsGs[(start + i) % papers.mainsGs.length],
    kind: "gs" as const,
  }));
  if (papers.essay && weekdayOf(date) === ANSWER_SET_CONFIG.essayWeekday) {
    return [...gs, { paperCode: papers.essay, kind: "essay" }];
  }
  return gs;
}

async function fetchDescriptiveByPaper(paperCodes: string[]): Promise<Map<string, DescQRow[]>> {
  if (paperCodes.length === 0) return new Map();
  const { data, error } = await supabase()
    .from("questions")
    .select("id, paper_code, stem_i18n, word_limit, marks, syllabus_node_id")
    .eq("type", "descriptive")
    .in("paper_code", paperCodes)
    .or(questionVisibilityOrFilter("catalog"))
    .order("id", { ascending: true });
  if (error) throw new HttpError(500, `descriptive question lookup failed: ${error.message}`);
  const byPaper = new Map<string, DescQRow[]>();
  for (const row of (data ?? []) as DescQRow[]) {
    (byPaper.get(row.paper_code) ?? byPaper.set(row.paper_code, []).get(row.paper_code)!).push(row);
  }
  return byPaper;
}

/**
 * Per-node weakness for this user in [0,1] (higher = weaker), from their
 * COMPLETED descriptive evaluations dated strictly BEFORE this IST day — the
 * "before the day" cutoff keeps the day's set stable regardless of evaluations
 * the user completes later the same day. A node with no evaluation history is
 * absent (weakness 0), so it's ranked on weightage alone rather than boosted.
 */
async function userNodeWeakness(userId: string, date: string): Promise<Map<string, number>> {
  const { startUtc } = istDayRangeUtc(date);
  const { data, error } = await supabase()
    .from("answer_submissions")
    .select("created_at, questions!inner(syllabus_node_id), evaluations!inner(overall_score, max_score)")
    .eq("user_id", userId)
    .eq("status", "complete")
    .lt("created_at", startUtc);
  if (error) throw new HttpError(500, `weakness lookup failed: ${error.message}`);
  const byNode = new Map<string, { sum: number; n: number }>();
  for (const row of (data ?? []) as unknown as {
    questions: { syllabus_node_id: string | null } | null;
    evaluations: { overall_score: number | null; max_score: number | null } | null;
  }[]) {
    const nodeId = row.questions?.syllabus_node_id;
    const score = row.evaluations?.overall_score;
    const max = row.evaluations?.max_score;
    if (!nodeId || score == null || !max) continue;
    const b = byNode.get(nodeId) ?? { sum: 0, n: 0 };
    b.sum += Math.max(0, Math.min(1, score / max));
    b.n += 1;
    byNode.set(nodeId, b);
  }
  const out = new Map<string, number>();
  for (const [id, b] of byNode) out.set(id, 1 - b.sum / b.n);
  return out;
}

interface CompletedInfo {
  submission_id: string;
  overall_score: number | null;
  max_score: number | null;
}

/** Most recent COMPLETED evaluation per question for this user, over the given questions. */
async function completedByQuestion(userId: string, questionIds: string[]): Promise<Map<string, CompletedInfo>> {
  const out = new Map<string, CompletedInfo>();
  if (questionIds.length === 0) return out;
  const { data, error } = await supabase()
    .from("answer_submissions")
    .select("id, question_id, created_at, evaluations(overall_score, max_score)")
    .eq("user_id", userId)
    .eq("status", "complete")
    .in("question_id", questionIds)
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(500, `submission status lookup failed: ${error.message}`);
  for (const row of (data ?? []) as unknown as {
    id: string;
    question_id: string;
    evaluations: { overall_score: number | null; max_score: number | null } | null;
  }[]) {
    if (out.has(row.question_id)) continue; // newest wins (ordered desc)
    out.set(row.question_id, {
      submission_id: row.id,
      overall_score: row.evaluations?.overall_score ?? null,
      max_score: row.evaluations?.max_score ?? null,
    });
  }
  return out;
}

export async function getDailyAnswerSet(
  userId: string,
  date: string = istToday(),
  /**
   * Pre-resolved exam code, for a caller (e.g. daily-progress.ts) that already
   * read `getUserExam(userId)` for its own use — avoids a second identical
   * `users_profile` read on a hot path. Falls back to resolving it itself so
   * every existing caller (routes/answers.ts, daily/run.ts) is unaffected.
   */
  examCode?: string,
): Promise<DailyAnswerSet> {
  const dayNum = daysBetween("1970-01-01", date);
  const weekNum = Math.floor(dayNum / 7);
  const resolvedExamCode = examCode ?? (await getUserExam(userId));
  const papers = answerSetPapers(date, getExamConfig(resolvedExamCode).papers);
  const [byPaper, weightage, weakness] = await Promise.all([
    fetchDescriptiveByPaper(papers.map((p) => p.paperCode)),
    loadNodeWeightage(),
    userNodeWeakness(userId, date),
  ]);
  const year = currentExamYear();

  // Within each featured paper, rank questions by a COMBINED weak-AND-heavily-
  // tested score, not a blind rotation: prefer questions whose topic this user
  // is weak on (evaluation history) AND that UPPSC asks often (weightage). Both
  // signals are normalized to [0,1] within the paper's own candidate set and
  // summed. The pick is a deterministic per-(user, day) weighted draw, so a
  // weak-and-common question is served on more days while a weak-but-rare (or
  // never-evaluated) one still appears sometimes (PICK_FLOOR) — reweighting, not
  // exclusion. Essay is seeded by week (it rotates weekly), GS by day.
  const picked: { row: DescQRow; kind: DailyAnswerKind }[] = [];
  for (const { paperCode, kind } of papers) {
    const rows = byPaper.get(paperCode) ?? [];
    if (rows.length === 0) continue; // no supply for this paper today — skip rather than pad
    const hot = rows.map((r) => hotnessRaw(weightage.get(r.syllabus_node_id ?? "")?.byYear ?? new Map(), year));
    const maxHot = hot.reduce((m, h) => (h > m ? h : m), 0) || 1;
    const weights = rows.map((r, i) => {
      const weightNorm = hot[i] / maxHot; // [0,1]
      const weak = (r.syllabus_node_id && weakness.get(r.syllabus_node_id)) || 0; // [0,1]
      return PICK_FLOOR + weightNorm + weak;
    });
    const seed = `${userId}:${paperCode}:${kind === "essay" ? `w${weekNum}` : `d${dayNum}`}`;
    picked.push({ row: weightedPick(rows, weights, seed), kind });
  }

  const completed = await completedByQuestion(userId, picked.map((p) => p.row.id));

  const items: DailyAnswerItem[] = picked.map(({ row, kind }) => {
    const done = completed.get(row.id);
    return {
      question_id: row.id,
      paper_code: row.paper_code,
      kind,
      stem_i18n: row.stem_i18n,
      word_limit: row.word_limit ?? (kind === "essay" ? ESSAY_WORD_LIMIT : null),
      marks: row.marks ?? (kind === "essay" ? ESSAY_MAX_MARKS : null),
      status: done ? "evaluated" : "not_started",
      submission_id: done?.submission_id ?? null,
      overall_score: done?.overall_score ?? null,
      max_score: done?.max_score ?? null,
    };
  });

  return { date, items, completed_count: items.filter((i) => i.status === "evaluated").length };
}
