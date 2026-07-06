/**
 * The daily answer set: 4 GS descriptive questions per IST day rotating across
 * the six GS papers (incl. GS-V/VI UP), plus one weekly ESSAY slot on Sundays.
 *
 * Computed deterministically from the IST calendar day (no storage): the same
 * day always yields the same set, and it rotates cleanly over time. Sourced from
 * published + review-approved descriptive questions (Mains PYQs + the approved
 * generated pool) via the centralized visibility helper. Per-question status is
 * "evaluated" once the user has a completed evaluation for that question — one
 * such completion maintains the streak.
 */
import type { BilingualText, DailyAnswerItem, DailyAnswerKind, DailyAnswerSet } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { daysBetween, istToday } from "../lib/ist.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { ANSWER_SET_CONFIG } from "../daily/config.js";
import { ESSAY_MAX_MARKS, ESSAY_PAPER_CODE, ESSAY_WORD_LIMIT, MAINS_GS_PAPER_CODES } from "../lib/exam-papers.js";

interface DescQRow {
  id: string;
  paper_code: string;
  stem_i18n: BilingualText;
  word_limit: number | null;
  marks: number | null;
}

/** IST weekday for a `YYYY-MM-DD` date, 0 = Sunday. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The papers featured on a given day (rotating GS window + optional essay). */
export function answerSetPapers(date: string): { paperCode: string; kind: DailyAnswerKind }[] {
  const dayNum = daysBetween("1970-01-01", date);
  const start = ((dayNum % MAINS_GS_PAPER_CODES.length) + MAINS_GS_PAPER_CODES.length) % MAINS_GS_PAPER_CODES.length;
  const gs = Array.from({ length: ANSWER_SET_CONFIG.gsPerDay }, (_, i) => ({
    paperCode: MAINS_GS_PAPER_CODES[(start + i) % MAINS_GS_PAPER_CODES.length],
    kind: "gs" as const,
  }));
  if (weekdayOf(date) === ANSWER_SET_CONFIG.essayWeekday) {
    return [...gs, { paperCode: ESSAY_PAPER_CODE, kind: "essay" }];
  }
  return gs;
}

async function fetchDescriptiveByPaper(paperCodes: string[]): Promise<Map<string, DescQRow[]>> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, paper_code, stem_i18n, word_limit, marks")
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

export async function getDailyAnswerSet(userId: string, date: string = istToday()): Promise<DailyAnswerSet> {
  const dayNum = daysBetween("1970-01-01", date);
  const weekNum = Math.floor(dayNum / 7);
  const papers = answerSetPapers(date);
  const byPaper = await fetchDescriptiveByPaper(papers.map((p) => p.paperCode));

  const picked: { row: DescQRow; kind: DailyAnswerKind }[] = [];
  for (const { paperCode, kind } of papers) {
    const rows = byPaper.get(paperCode) ?? [];
    if (rows.length === 0) continue; // no supply for this paper today — skip rather than pad
    // Essay rotates weekly (one per week); GS rotates daily.
    const idx = (kind === "essay" ? weekNum : dayNum) % rows.length;
    picked.push({ row: rows[idx], kind });
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
