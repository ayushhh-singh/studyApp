import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

/**
 * Exams the platform can serve as a PRODUCT — i.e. what a user may pick as their
 * `users_profile.target_exam`.
 *
 * DO NOT confuse this with `examCodeSchema` in ./types, which is the PROVENANCE
 * enum on `questions.exam_code` ("which exam ASKED this question"). That one
 * deliberately includes exams we ingest PYQs from but never sell (up_ro_aro,
 * upsssc_pet, other) because their papers overlap the UPPSC syllabus and feed
 * weightage analytics. The two lists differ on purpose and must not be merged —
 * see migration 0106 §4.
 */
export const TARGET_EXAM_CODES = ["uppsc", "upsc", "mppsc"] as const;
export const targetExamCodeSchema = z.enum(TARGET_EXAM_CODES);
export type TargetExamCode = z.infer<typeof targetExamCodeSchema>;

/** What every pre-multi-exam row backfills to, and the only `is_live` exam today. */
export const DEFAULT_EXAM_CODE: TargetExamCode = "uppsc";

/**
 * Stages in an exam's pattern. Wider than ./types' `examStageSchema`
 * (prelims|mains), which types content rows — this one also covers the
 * interview/personality test, which carries marks but no papers and no content.
 */
export const examStructureStageSchema = z.enum(["prelims", "mains", "interview"]);
export type ExamStructureStage = z.infer<typeof examStructureStageSchema>;

/**
 * What a minimum-mark threshold on a paper actually DOES. A boolean
 * `is_qualifying` cannot express this — all three exams use thresholds, but for
 * three genuinely different purposes, and conflating them produces wrong copy
 * and wrong pass/fail logic:
 *
 *  - `stage_gate`      — clear it to reach the next stage; the marks themselves
 *                        never count for merit. (UPSC/UPPSC/MPPSC CSAT at 33%.)
 *  - `evaluation_gate` — fail it and your OTHER papers are never even evaluated.
 *                        (UPSC Paper-A/Paper-B at 25% — strictly harsher than a
 *                        stage gate, and unique to UPSC.)
 *  - `merit_floor`     — the paper DOES count for merit, but there is also a
 *                        minimum you must clear. (MPPSC's 40%/30% per paper;
 *                        UPPSC General Hindi.)
 */
export const paperMinimumRoleSchema = z.enum(["stage_gate", "evaluation_gate", "merit_floor"]);
export type PaperMinimumRole = z.infer<typeof paperMinimumRoleSchema>;

export const paperMinimumSchema = z.object({
  role: paperMinimumRoleSchema,
  /**
   * The threshold percentage, or null when a threshold provably EXISTS but its
   * value is not officially published — UPPSC's General Hindi minimum is
   * literally "as may be determined by the Government or the Commission".
   * null therefore means "threshold exists, value unknown", NEVER "no threshold"
   * (absence of the whole `minimum` object means that).
   */
  pct: z.number().nullable(),
  /**
   * Category-dependent thresholds, when the exam sets different floors by
   * category (MPPSC: 40% UR / 30% reserved; UPPSC's efficiency standard:
   * 40% others / 35% SC-ST). Mutually exclusive with a meaningful `pct`.
   */
  pct_by_category: z.record(z.string(), z.number()).nullable().default(null),
});
export type PaperMinimum = z.infer<typeof paperMinimumSchema>;

/**
 * Negative marking, expressed as a FRACTION OF THAT QUESTION'S MARKS rather
 * than an absolute deduction. This is not pedantry: UPPSC Prelims deducts
 * ~0.44 in Paper I and ~0.67 in Paper II from the same "one-third" rule,
 * because the papers carry different marks per question. An absolute scalar
 * gets one of the two wrong — and published aggregator tables frequently do.
 */
export const negativeMarkingSchema = z.object({
  fraction: z.number(),
  of: z.literal("question_marks"),
});
export type NegativeMarking = z.infer<typeof negativeMarkingSchema>;

export const examPaperSchema = z.object({
  /**
   * The `syllabus_nodes.paper_code` this paper maps to, or null until a syllabus
   * has been ingested for it. MUST be exam-prefixed for any non-UPPSC exam
   * ('UPSC_PRE_GS1') — paper codes are globally unique across exams and that
   * invariant is load-bearing. See migration 0106's header.
   */
  paper_code: z.string().nullable(),
  order: z.number().int(),
  /** The commission's own label ("Paper-A", "Paper-VII"), distinct from the name. */
  official_label: z.string().nullable().default(null),
  name_i18n: bilingualTextSchema,
  format: z.enum(["objective", "descriptive"]),
  marks: z.number(),
  duration_minutes: z.number().int().nullable(),
  /**
   * null means NOT OFFICIALLY NOTIFIED, not "unknown to us" — UPSC's notification
   * fixes the marks and duration of its prelims papers but never the question
   * count. Do not default this to a number lifted from past papers.
   */
  question_count: z.number().int().nullable(),
  marks_per_question: z.number().nullable(),
  negative_marking: negativeMarkingSchema.nullable(),
  counts_for_merit: z.boolean(),
  /** Absent/null = no minimum at all. See paperMinimumSchema for the semantics. */
  minimum: paperMinimumSchema.nullable().default(null),
  /**
   * Binds the papers of one candidate-chosen optional subject together. UPSC's
   * Paper-VI and Paper-VII must be the SAME chosen subject, which a boolean
   * `is_optional_subject` cannot express. null = not an optional paper.
   */
  optional_group: z.string().nullable().default(null),
  /**
   * false when the paper is waived for some candidates — UPSC's Paper-A does not
   * apply to candidates from six north-eastern states, nor to hearing-impaired
   * PwBD candidates.
   */
  applies_to_all_candidates: z.boolean().default(true),
  /**
   * Overrides the stage's `answer_languages` for this paper. Not hypothetical:
   * MPPSC's Papers V and VI must be answered in Hindi ONLY while its GS papers
   * accept Hindi or English — 300 merit-counting marks with a different rule
   * from the rest of the same stage. null = inherit the stage.
   */
  answer_languages: z.array(z.string()).nullable().default(null),
});
export type ExamPaper = z.infer<typeof examPaperSchema>;

export const examStageBlockSchema = z.object({
  stage: examStructureStageSchema,
  /** Stage-level, not paper-level: prelims marks count for merit in none of the three. */
  counts_for_merit: z.boolean(),
  /** For the interview stage, which has marks but no papers. */
  marks: z.number().nullable().default(null),
  /** How many candidates per vacancy this stage shortlists (UPSC ~12-13x, UPPSC ~15x). */
  shortlist_multiple: z.number().nullable().default(null),
  /** Scripts/languages answers may be written in at this stage. */
  answer_languages: z.array(z.string()).default([]),
  papers: z.array(examPaperSchema).default([]),
});
export type ExamStageBlock = z.infer<typeof examStageBlockSchema>;

export const examPaperStructureSchema = z.object({
  version: z.literal(1),
  /**
   * REQUIRED, and the most load-bearing field here. Exam patterns change:
   * UPPSC restructured for Mains 2023 (optional subject abolished, GS-V/VI
   * added); MPPSC changed for 2026 (negative marking introduced, GS-IV
   * 200 -> 300, interview 175 -> 185). Without it, a 2021 PYQ gets rendered
   * against a structure that did not exist when it was set, and every
   * "out of N marks" figure on an older paper is silently wrong.
   */
  effective_from_year: z.number().int().nullable(),
  effective_to_year: z.number().int().nullable().default(null),
  stages: z.array(examStageBlockSchema),
  /** Marks the FINAL MERIT is computed out of (mains + interview). */
  total_marks: z.number(),
  /** Where these figures came from. Same honesty policy as exam_cutoffs.source_url. */
  sources: z.array(z.string()).default([]),
  /**
   * Figures we could NOT confirm against a primary source, recorded rather than
   * silently asserted. Never leave a contested number here undisclosed.
   */
  unverified_notes: z.array(z.string()).default([]),
});
export type ExamPaperStructure = z.infer<typeof examPaperStructureSchema>;

/**
 * The honest, per-exam coverage statement shown BEFORE a user commits to an
 * exam. Never overstate what is actually ingested — an exam that has a registry
 * row but no syllabus or questions must say so plainly here.
 */
export const examLaunchScopeSchema = z.object({
  summary_i18n: bilingualTextSchema,
  covered_i18n: z.array(bilingualTextSchema).default([]),
  not_covered_i18n: z.array(bilingualTextSchema).default([]),
});
export type ExamLaunchScope = z.infer<typeof examLaunchScopeSchema>;

/**
 * The state an exam's CONTENT is scoped to, or `null` for a nationally-scoped
 * one (see `examSchema.state_lens`).
 *
 * DELIBERATELY NOT A DB COLUMN. Unlike every other field on `examSchema`, this
 * is derived server-side from `apps/api/src/lib/exam-config.ts`'s
 * `relevanceLens`, which is where the fact already lives and is already the
 * gate the CA pipeline and the magazine use. Adding an `exams` column for it
 * would create a second source of truth for one boolean-ish fact and require a
 * migration; the client only needs to know whether a state lens EXISTS.
 */
export const examStateLensSchema = z.object({
  /** Short code as it appears in labels, e.g. "UP". */
  code: z.string(),
  name_i18n: bilingualTextSchema,
});
export type ExamStateLens = z.infer<typeof examStateLensSchema>;

export const examSchema = z.object({
  exam_code: targetExamCodeSchema,
  display_name_i18n: bilingualTextSchema,
  is_live: z.boolean(),
  paper_structure: examPaperStructureSchema,
  launch_scope_i18n: examLaunchScopeSchema,
  sort_order: z.number().int(),
  /**
   * null = nationally scoped: no state lens tab on the current-affairs feed, no
   * state lead section in the magazine, no state ranking boost. Defaulted so a
   * client parsing an older response (or a fixture) reads "national" rather
   * than throwing — a missing state lens is the safe reading, since every
   * state-shaped surface is opt-IN on this field.
   */
  state_lens: examStateLensSchema.nullable().default(null),
});
export type Exam = z.infer<typeof examSchema>;

export const examsResponseSchema = apiEnvelopeSchema(z.array(examSchema));
export type ExamsResponse = z.infer<typeof examsResponseSchema>;
