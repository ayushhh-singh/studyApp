/**
 * UPPSC paper-code constants + paper-specific exam parameters, verified against
 * the official pattern (see the Mains research recorded in the session log).
 *
 * Prelims (screening, MCQ): GS-I 150 Q / 200 marks / 120 min, CSAT 100 Q / 200
 * marks / 120 min, one-third negative marking.
 * Mains (descriptive, 8 papers): General Hindi + Essay (150 each) and GS-I…VI
 * (200 each), GS-V/VI UP-specific. Essay: 3 sections × one ~700-word essay ×
 * 50 marks each = 150.
 */

/** The Essay (निबंध) Mains paper. Its submissions score under the essay-v1 rubric. */
export const ESSAY_PAPER_CODE = "MAINS_ESSAY";
export const GENERAL_HINDI_PAPER_CODE = "MAINS_GH";

/** One UPPSC essay: ~700 words for 50 marks (per official paper: 3 sections × 50). */
export const ESSAY_WORD_LIMIT = 700;
export const ESSAY_MAX_MARKS = 50;

/** The six General Studies Mains papers (GS-V/VI are the UP-specific papers). */
export const MAINS_GS_PAPER_CODES = [
  "MAINS_GS1",
  "MAINS_GS2",
  "MAINS_GS3",
  "MAINS_GS4",
  "MAINS_GS5",
  "MAINS_GS6",
] as const;

/** Prelims paper codes. */
export const PRELIMS_GS1_PAPER_CODE = "PRE_GS1";
export const PRELIMS_CSAT_PAPER_CODE = "PRE_CSAT";

/**
 * Real UPPSC Prelims marking (web-verified, cross-checked): GS-I is 150 questions
 * summing to 200 marks (1.33/correct, -0.33/wrong — one-third); CSAT is 100 questions
 * summing to 200 marks (2/correct, -0.66/wrong). This is the SINGLE source of truth for
 * a prelims MCQ's intrinsic per-question marks — used by `ingest:pyq:load` to stamp
 * `questions.marks` at load time, by `ingest:tests` for a test's total + negative-marking
 * scheme, and by `ingest:backfill-marks` to repair rows loaded before marks was set.
 * (`marks: null` on a question graded as 0 — a null key on BOTH questions.marks AND
 * test_questions.marks silently scores a whole attempt 0/0.)
 */
export const PRELIMS_MARKING: Record<string, { marksPerQuestion: number; negativeMarking: number }> = {
  [PRELIMS_GS1_PAPER_CODE]: { marksPerQuestion: 1.33, negativeMarking: -0.33 },
  [PRELIMS_CSAT_PAPER_CODE]: { marksPerQuestion: 2, negativeMarking: -0.66 },
};

/**
 * A prelims MCQ's default per-question marks when the parse didn't carry one — null for
 * anything that isn't a known prelims MCQ paper (Mains descriptive keeps its own marks).
 */
export function prelimsMcqMarks(paperCode: string, type: string): number | null {
  if (type !== "mcq") return null;
  return PRELIMS_MARKING[paperCode]?.marksPerQuestion ?? null;
}
