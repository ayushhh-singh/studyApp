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
