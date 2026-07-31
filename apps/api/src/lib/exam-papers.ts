/**
 * UPPSC paper-code constants + paper-specific exam parameters, verified against
 * the official pattern (see the Mains research recorded in the session log).
 *
 * Prelims (screening, MCQ): GS-I 150 Q / 200 marks / 120 min, CSAT 100 Q / 200
 * marks / 120 min, one-third negative marking.
 * Mains (descriptive, 8 papers): General Hindi + Essay (150 each) and GS-I…VI
 * (200 each), GS-V/VI UP-specific. Essay: 3 sections × one ~700-word essay ×
 * 50 marks each = 150.
 *
 * UPSC's own paper CODES live in the sibling module `lib/upsc-papers.ts`; only
 * the UPSC Prelims per-question MARKING below lives here, because it belongs to
 * the same single-source-of-truth table `ingest:pyq:load` / `ingest:tests` read.
 */
import {
  UPSC_PRELIMS_CSAT_PAPER_CODE,
  UPSC_PRELIMS_GS1_PAPER_CODE,
} from "./upsc-papers.js";

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

  // ---------------------------------------------------------------------------
  // UPSC Civil Services Prelims (added 2026-07-30 for the U5 PYQ ingest).
  //
  // READ OFF THE REAL BOOKLET COVERS now in content-raw/pyq_prelims, not from an
  // aggregator table and not from `exams.paper_structure` — which deliberately
  // carries `question_count: null` and `marks_per_question: null` for UPSC,
  // because UPSC notifies the paper's MARKS and DURATION but has never notified
  // its question count (that is practice, not notification; see 0106).
  //   * GS-I  (2024 cover): "इस परीक्षण पुस्तिका में 100 प्रश्नांश … दिए गए हैं",
  //     पूर्णांक : 200  →  100 Q / 200 marks  →  2.0 per question.
  //   * CSAT   (2020 cover): "…80 प्रश्नांश …", पूर्णांक : 200
  //     →  80 Q / 200 marks  →  2.5 per question.
  //   * Both covers state the one-third penalty ("एक-तिहाई दंड"), matching
  //     `exams.paper_structure`'s verified `negative_marking.fraction = 0.3333`.
  //
  // KNOWN LIMITATION, stated rather than hidden: UPSC does not apply negative
  // marking to CSAT's *Decision Making* questions. This table is a per-PAPER
  // scalar (as it already is for UPPSC), so it cannot express a per-question
  // carve-out; a CSAT decision-making item is therefore penalised here where the
  // real exam would not penalise it. Fixing that needs per-question marking, not
  // a different number in this table.
  // ---------------------------------------------------------------------------
  // Codes (not the numbers) come from lib/upsc-papers.ts, so this is not a
  // fourth place a UPSC paper code is written down — M31.
  [UPSC_PRELIMS_GS1_PAPER_CODE]: { marksPerQuestion: 2, negativeMarking: -0.6667 },
  [UPSC_PRELIMS_CSAT_PAPER_CODE]: { marksPerQuestion: 2.5, negativeMarking: -0.8333 },
};

/**
 * A prelims MCQ's default per-question marks when the parse didn't carry one — null for
 * anything that isn't a known prelims MCQ paper (Mains descriptive keeps its own marks).
 */
export function prelimsMcqMarks(paperCode: string, type: string): number | null {
  if (type !== "mcq") return null;
  return PRELIMS_MARKING[paperCode]?.marksPerQuestion ?? null;
}
