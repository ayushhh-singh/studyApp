/**
 * PER-EXAM CONFIGURATION — the single source of truth for every exam-specific
 * string the LLM prompt builders interpolate.
 *
 * WHY THIS EXISTS
 * ---------------
 * ~85 prompt strings across `services/evaluation`, `qgen`, `services/mentor`,
 * `ca`, `notes` and a dozen service modules hardcode "UPPSC" (and UP-specific
 * framing). A second exam cannot be served correctly while that is true. This
 * module holds those strings so a later sweep can replace each hardcoded literal
 * with a config read.
 *
 * THIS MODULE IS NOT WIRED INTO ANY CALL SITE YET. Adding it changes no prompt
 * (`pnpm prompts:snapshot` still reports every prompt byte-identical). The
 * conversion is a separate slice.
 *
 * THE ONE RULE THAT MATTERS
 * -------------------------
 * Parameterise STRUCTURE, never JUDGMENT.
 *
 * Every `uppsc` value below is copied BYTE-FOR-BYTE out of the prompt it came
 * from. For `upsc` and `mppsc`, every judgment-bearing slot is `UNAUTHORED`.
 *
 * It is WRONG to author another exam's value by string-replacing "UPPSC" with
 * "UPSC" in UPPSC's text. The severity anchor's empirical claims (topper
 * percentages, "45-55% per answer") are findings about how UPPSC/UPSC Mains is
 * ACTUALLY marked, researched and recorded in
 * `services/evaluation/prompts.ts`'s calibration comment — not a template with a
 * swappable exam name. The same holds for question-setting style (which formats
 * a specific commission actually uses), the current-affairs relevance lens, and
 * the mentor persona's framing. A second exam's values must be researched and
 * authored, exactly as UPPSC's were.
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 * -------------------------------
 *  - `exams.paper_structure` and `exams.launch_scope_i18n` are DB-authoritative
 *    (migration 0106, verified against commission notification PDFs). They are
 *    NOT copied into TypeScript. This module carries only the paper CODES the
 *    code needs synchronously, plus documented pointers at the DB.
 *  - `TargetExamCode` / `TARGET_EXAM_CODES` / `DEFAULT_EXAM_CODE` are imported
 *    from `@neev/shared`, never redeclared. (`ingest/_shared.ts` once
 *    redeclared `ExamCode` as a local copy and silently drifted on the first
 *    extension, with no typecheck error — see CLAUDE.md's multi-exam audit.)
 *  - Paper-code constants are IMPORTED from `./exam-papers.js`, never re-typed
 *    as literals here, so there is exactly one definition of "MAINS_ESSAY".
 *  - `UPPSC_EXAM_CODE` in `./question-visibility.js` is deliberately NOT used as
 *    `ExamConfig.code`. Despite the identical value, it is the PROVENANCE code
 *    fed to `.eq("exam_code", …)` filters on `questions` ("which exam asked
 *    this"), whose domain includes exams we ingest from but never sell
 *    (up_ro_aro, upsssc_pet, other). This module keys off the PRODUCT exam
 *    (`TargetExamCode`). Conflating the two is the mistake migration 0106's
 *    §4 comment warns about.
 *
 * ADDING A FOURTH EXAM: `EXAM_CONFIGS` is typed `Record<TargetExamCode,
 * ExamConfig>`, so extending the shared enum is a COMPILE ERROR here until the
 * new exam is configured. That is the point — do not weaken the type.
 */
import {
  DEFAULT_EXAM_CODE,
  TARGET_EXAM_CODES,
  type TargetExamCode,
} from "@neev/shared";
import {
  ESSAY_PAPER_CODE,
  GENERAL_HINDI_PAPER_CODE,
  MAINS_GS_PAPER_CODES,
  PRELIMS_CSAT_PAPER_CODE,
  PRELIMS_GS1_PAPER_CODE,
} from "./exam-papers.js";
import { logger } from "./logger.js";
import { supabase } from "./supabase.js";

// ---------------------------------------------------------------------------
// The unauthored sentinel
// ---------------------------------------------------------------------------
/**
 * A judgment-bearing slot that has not been authored for this exam.
 *
 * Reaching one at runtime is a BUG, not a fallback — an exam must never borrow
 * another exam's examiner judgment, question-setting style, or curation lens.
 * There is deliberately no default: silently falling back to UPPSC's text would
 * produce a confidently-wrong prompt for a different commission, which is worse
 * than a loud failure.
 *
 * WHY A SYMBOL rather than a sentinel string or a wrapper object:
 *  - TypeScript refuses to concatenate or template-interpolate a `symbol`
 *    ("Implicit conversion of a 'symbol' to a 'string' will fail at runtime"),
 *    so `Authored<string>` cannot be dropped into a prompt without the compiler
 *    stopping you. A sentinel string like "TODO" would compile and ship.
 *  - Even if a cast forced it through, `String(sym)` yields
 *    "Symbol(unauthored-exam-config)" rather than plausible prose — the failure
 *    stays visible.
 *  - It is one greppable token: `rg UNAUTHORED` enumerates every open slot.
 *
 * Tracked as U6 (per-exam content authoring) — see docs/OUTSTANDING.md §8 and
 * docs/multi-exam.md §5.
 */
export const UNAUTHORED: unique symbol = Symbol("unauthored-exam-config");

/** A value that is either authored for this exam, or explicitly `UNAUTHORED`. */
export type Authored<T> = T | typeof UNAUTHORED;

/** Narrowing guard — `true` when the slot has real, exam-specific text. */
export function isAuthored<T>(value: Authored<T>): value is T {
  return value !== UNAUTHORED;
}

/**
 * Unwrap an authored value, or throw naming the exam and the field.
 *
 * Use at the moment a prompt is built, so the error identifies exactly which
 * exam is missing which piece of authoring:
 *   `requireAuthored(cfg.evaluation.severityAnchor, cfg.code, "evaluation.severityAnchor")`
 */
export function requireAuthored<T>(
  value: Authored<T>,
  examCode: string,
  field: string,
): T {
  if (!isAuthored(value)) {
    throw new Error(
      `exam-config: "${field}" is UNAUTHORED for exam "${examCode}". ` +
        `This slot carries examiner judgment and must be researched and authored for ` +
        `${examCode} — never derived from another exam's text by substitution (U6).`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How an exam's current-affairs curation is scoped. Powers BOTH the CA pipeline
 * (`ca/prompts.ts` triage) and the magazine's lead section.
 *
 * `kind` is structural and can be stated as fact for every exam. The
 * `curationDirective` is judgment (what actually counts as "for this exam's
 * state") and is authored per exam.
 *
 * NOTE: generalising the CA pipeline's `is_up_specific` / `gs_papers` columns is
 * deliberately deferred (docs/OUTSTANDING.md §8b M8, tracked as M20) because
 * `gs_papers` IS the Mains magazine's section structure. This type is the shape
 * that work should land on; it is not read by anything yet.
 */
export type RelevanceLens =
  | {
      kind: "state_specific";
      /** Structural facts about the state — safe to state for any exam. */
      state: {
        /** Short code used in labels, e.g. "UP". */
        code: string;
        nameEn: string;
        nameHi: string;
        /** Adjectival form as it appears in prompt copy, e.g. "UP-specific". */
        adjectiveEn: string;
      };
      /**
       * Verbatim triage directive for what counts as state-specific.
       * uppsc call site: `ca/prompts.ts` triageParams system, the
       * "`is_up_specific` (true ONLY for items ...)" clause.
       */
      curationDirective: Authored<string>;
      /**
       * Verbatim note naming the state-specific Mains GS papers.
       * uppsc call site: `ca/prompts.ts` triageParams system, the
       * "GS5_UP/GS6_UP are UP-specific papers" parenthetical.
       */
      stateGsPapersNote: Authored<string>;
    }
  | {
      kind: "national";
      curationDirective: Authored<string>;
      stateGsPapersNote: Authored<string>;
    };

/** Naming forms. Every one of these appears verbatim in at least one prompt. */
export interface ExamNaming {
  /** "UPPSC". Call sites: qgen few-shot example labels, most bare mentions. */
  short: string;
  /** "Uttar Pradesh Public Service Commission" — the commission's full name. */
  commission: string;
  /** "UPPSC (Uttar Pradesh Public Service Commission)". */
  full: string;
  /** "UP PCS" — the bare qualifier, used mid-sentence ("for a UP PCS exam platform"). */
  qualifier: string;
  /** "UPPSC (UP PCS)" — the most common parenthesised form. */
  withQualifier: string;
  /** "Uttar Pradesh PCS". */
  longQualifier: string;
  /**
   * "UPPSC (Uttar Pradesh PCS)" — a THIRD parenthesised form, distinct from
   * `withQualifier`. Both are live: notes/chapter prompts use this one, the
   * mentor persona uses `withQualifier`. Do not collapse them.
   */
  withLongQualifier: string;
  /**
   * MUST equal `exams.display_name_i18n` for this exam — that column is
   * DB-authoritative and user-facing. Checked by
   * `assertExamConfigMatchesRegistry()`.
   */
  displayNameI18n: { en: string; hi: string };
}

/**
 * Paper codes the API needs SYNCHRONOUSLY (rubric selection, daily-quiz
 * assembly, mock building). `null` means "no syllabus has been ingested for this
 * exam yet" — an honest data state, NOT unauthored judgment, which is why it is
 * `null` and not `UNAUTHORED`.
 *
 * These MUST be exam-prefixed for any non-UPPSC exam ("UPSC_PRE_GS1"): paper
 * codes are globally unique across exams and that invariant is load-bearing
 * (~30 call sites filter on paper_code alone). See migration 0106's header and
 * docs/multi-exam.md §0/§0a.
 *
 * The values below are REFERENCES to `./exam-papers.js`, not re-typed literals.
 */
export interface ExamPapers {
  essay: string | null;
  generalHindi: string | null;
  prelimsGs: string | null;
  prelimsCsat: string | null;
  mainsGs: readonly string[];
}

export interface ExamCalendar {
  /**
   * The value matched against `exam_calendar.exam_code` by
   * `lib/exam-calendar.ts`'s `pickNextExam`. Always this exam's own code; kept
   * as an explicit field so a future exam that shares another's calendar rows
   * has somewhere to say so.
   */
  lookupExamCode: TargetExamCode;
  /** Which stage the four countdown surfaces count down to. */
  countdownStage: "prelims" | "mains";
}

export interface ExamCutoffs {
  /**
   * The merit paper whose `exam_cutoffs` rows the comparison UI reads.
   * uppsc call site: `cutoff-comparison.tsx`'s `useCutoffs("PRE_GS1")` and
   * `services/mocks.ts`'s `getCutoffs(paperCode, examCode)`.
   */
  meritPaperCode: string | null;
  /** The qualifying-only paper, rendered against its threshold instead of a cut-off. */
  qualifyingPaperCode: string | null;
  /**
   * The official marks scale a raw score is normalised to for cut-off
   * comparison (UPPSC Prelims GS-I: /200).
   *
   * DERIVED, NOT AUTHORITATIVE: the source of truth is
   * `exams.paper_structure` → the merit paper's `marks`. Carried here only
   * because the comparison runs in a synchronous render path; kept honest by
   * `assertExamConfigMatchesRegistry()`, which fails if the two disagree.
   */
  officialMaxMarks: number | null;
  /**
   * The qualifying THRESHOLD is deliberately absent. It lives in
   * `exams.paper_structure` → the paper's `minimum` ({role, pct,
   * pct_by_category}), because it is not a single number for every exam:
   * UPPSC/UPSC CSAT is a 33% stage_gate, MPPSC's is 40%/30% BY CATEGORY, and
   * UPSC's Paper-A/B are 25% evaluation_gates. `cutoff-comparison.tsx` currently
   * hardcodes 33 — that component is the concrete consumer waiting for
   * `paper_structure.minimum` (docs/multi-exam.md, U3).
   */
  readonly minimumSource: "db:exams.paper_structure[].papers[].minimum";
}

/** Answer-evaluation prompts — `services/evaluation/prompts.ts`. */
export interface ExamEvaluationConfig {
  /**
   * Call site: `buildAnalysisSystem` —
   * `"You are a strict but fair examiner for " + examinerFraming + ". You evaluate a candidate's "`.
   */
  examinerFraming: Authored<string>;
  /**
   * Call site: `buildAnalysisSystem`'s essay branch, followed by a space —
   * `isEssay ? essayAnswerFraming + " " : "descriptive answer "`.
   * Exam-specific because the "~700-word" figure is UPPSC's essay format
   * (UPSC's essay is a different length and mark scheme).
   */
  essayAnswerFraming: Authored<string>;
  /**
   * THE SEVERITY ANCHOR — the whole SCORING CALIBRATION block, verbatim.
   *
   * DO NOT AUTHOR THIS BY SUBSTITUTION. Its numbers are researched claims about
   * how this specific exam is marked (topper capture ~half the marks, strong
   * candidates 45-55% per answer), sourced from real topper marksheets; see the
   * calibration comment above `buildAnalysisSystem`. A different commission
   * needs its own research, not "UPPSC"→"UPSC".
   *
   * Call site: `buildAnalysisSystem` — `"\n\n" + severityAnchor + "\n\n" + "Scoring principles:\n"`.
   * Stored WITHOUT the surrounding blank lines (those are structural).
   *
   * Kept separate from `examinerFraming` on purpose: they are interpolated at
   * different points of the same string and the anchor is the far larger,
   * far more consequential slot. Do not merge them into one blob.
   */
  severityAnchor: Authored<string>;
  /** Call site: `buildStrengthsSystem` — `` `You are ${strengthsMentorFraming}. Write ONLY the strengths` ``. */
  strengthsMentorFraming: Authored<string>;
  /** Call site: `buildImprovementsSystem` — `` `You are ${improvementsMentorFraming}. Write ONLY the improvements` ``. */
  improvementsMentorFraming: Authored<string>;
  /** Call site: `buildModelAnswerSystem` GS branch — `` `You are ${x}. Write a MODEL ANSWER` ``. */
  modelAnswerFramingGs: Authored<string>;
  /** Call site: `buildModelAnswerSystem` essay branch — `` `You are ${x}. Write a MODEL ESSAY` ``. */
  modelAnswerFramingEssay: Authored<string>;
  /**
   * Call site: `groundingBlock` (chunks present) —
   * `` `The following passages were retrieved from the ${groundingStoreLabel} (most relevant first).` ``
   * Stored WITHOUT a leading article so the four grounding blocks that phrase it
   * differently can all reuse it (`from the …`, `(from the … — …)`, `(… — …)`).
   */
  groundingStoreLabel: Authored<string>;
  /**
   * Call site: `groundingBlock` (no chunks) —
   * `` `Judge content from your own knowledge of ${groundingFallbackLabel}, and state nothing …` ``
   */
  groundingFallbackLabel: Authored<string>;
  /**
   * Call site: `buildModelAnswerSystem` GS branch — the tail of
   * `"constitutional articles, committees, schemes, and " + substantiationExamples + " where relevant"`.
   *
   * The SAME string appears in `services/evaluation/rubric.ts`'s `examples_data`
   * dimension description. That rubric registry is already exam-aware
   * (`RubricDefinition.examCode`) and is NOT restructured by this module; when
   * the sweep reaches it, it should read this field rather than gain a parallel
   * copy.
   */
  substantiationExamples: Authored<string>;
  /**
   * Call site: `buildModelAnswerSystem` ESSAY branch — a different grammatical
   * form of the same idea ("UP-/India-specific evidence" vs "UP-specific data").
   * Separate field rather than forcing one to do double duty.
   */
  essaySubstantiationExamples: Authored<string>;
  /**
   * Call site: `evaluate.ts` `translateAndCacheEvaluation` — the `domainHint`
   * passed to `translateBatch` when lazily translating a stored evaluation into
   * the other locale. Nominal (it names the corpus, not examiner judgment), but
   * it IS model-facing, so it is configured rather than left hardcoded.
   */
  feedbackTranslateDomainHint: Authored<string>;
}

/** Question generation — `qgen/prompts.ts`. */
export interface ExamQgenConfig {
  /** Call site: `MCQ_SYSTEM` — `` `You are ${prelimsSetterFraming}. You write original…` ``. */
  prelimsSetterFraming: Authored<string>;
  /**
   * Call site: `DESC_SYSTEM` — `` `You are ${mainsSetterFraming}. You write original…` ``.
   * The identical string is also `ca.mainsSetterFraming`; both are kept so the
   * two generators can diverge per exam without one silently changing the other.
   */
  mainsSetterFraming: Authored<string>;
  /** Call site: `CRITIC_SYSTEM` — `` `You are ${criticFraming}. You are given ONE candidate…` ``. */
  criticFraming: Authored<string>;
  /** Call site: `VERIFY_SYSTEM` — `` `You are ${verifierFraming}. You are shown one multiple-choice question…` ``. */
  verifierFraming: Authored<string>;
  /** Call site: `fewShotBlock` (examples present) — the block header line, verbatim. */
  fewShotHeader: Authored<string>;
  /** Call site: `fewShotBlock` (no examples) — the whole fallback sentence, verbatim. */
  fewShotFallback: Authored<string>;
  /**
   * Call site: `fewShotBlock` — the exam label inside each example line,
   * `` `Example ${i + 1} (${fewShotAttribution}${year}, difficulty …)` ``.
   * Equals `naming.short` for uppsc; kept addressable because a second exam may
   * want a fuller label when its bank mixes provenance.
   */
  fewShotAttribution: Authored<string>;
  /** Call site: `groundingBlock` — `` `REFERENCE PASSAGES (from the ${groundingStoreLabel} — base every…` ``. */
  groundingStoreLabel: Authored<string>;
  /** Call site: `groundingBlock` (no chunks) — `` `…verifiable facts about this topic from ${groundingFallbackLabel};` ``. */
  groundingFallbackLabel: Authored<string>;
  /**
   * Call site: `MCQ_SYSTEM` — the "Prefer <exam>'s real formats: …" sentence,
   * verbatim. Judgment: which question formats a specific commission actually
   * sets.
   */
  formatGuidance: Authored<string>;
  /**
   * Call site: `DESC_SYSTEM` — `` `Open with ${directiveVerbGuidance} and demand analysis, not mere recall.` ``
   * Also reused verbatim by `ca.mainsDirectiveVerbGuidance` (the CA Mains
   * generator phrases the tail differently but uses the same verb list).
   */
  directiveVerbGuidance: Authored<string>;
  /** Call site: `DESC_SYSTEM` — `` `Assign realistic marks and a word limit that match ${marksNormGuidance}.` ``. */
  marksNormGuidance: Authored<string>;
  /**
   * Call site: `CRITIC_SYSTEM` — `` `- uppsc_tone: ${toneCriterion}\n` ``.
   *
   * ⚠ THE JSON KEY `uppsc_tone` IS NOT PROMPT COPY. It is a property of
   * `CRITIC_SCHEMA`, of `CriticVerdict` in `@neev/shared`, and of every
   * `generation_meta` row already persisted. The sweep must parameterise only
   * the human-readable criterion text after the colon, never the key.
   */
  toneCriterion: Authored<string>;
  /**
   * Call site: `buildMcqGenParams` user turn — `` `Generate ${n} distinct
   * ${mcqOutputLabel} on the topic above. …` ``. User content, so never inside a
   * cached prefix.
   */
  mcqOutputLabel: Authored<string>;
  /**
   * Call site: `buildDescGenParams` user turn — `` `Generate ${n} distinct
   * ${descOutputLabel} on the topic above. …` ``.
   */
  descOutputLabel: Authored<string>;
}

/** Mentor — `services/mentor/prompts.ts` and `services/mentor/index.ts`. */
export interface ExamMentorConfig {
  /**
   * Call site: `buildMentorPersona` line 1 —
   * `"…the AI mentor on Neev — " + platformFraming + ". You are a"`.
   */
  platformFraming: Authored<string>;
  /**
   * Call site: `buildTeacherPersona` line 1 —
   * `"…the AI mentor on the Neev " + teacherPlatformFraming + ", now in TEACHER mode"`.
   *
   * A DIFFERENT grammatical form of the same phrase (no leading article, because
   * "the Neev" already supplies one). Deliberately not shared with
   * `platformFraming`; see this file's report note on grammatically-fused text.
   */
  teacherPlatformFraming: Authored<string>;
  /**
   * Call site: `buildMentorPersona`'s Style block, the "Connect explanations to
   * how <exam> actually tests the topic" bullet.
   *
   * ⚠ CONTAINS THE SOURCE'S HARD LINE WRAPPING. The persona is an array of
   * string literals joined by "\n", and this bullet spans three of them; the
   * embedded "\n  " sequences are part of the assembled prompt. Keep them.
   */
  testingLens: Authored<string>;
  /**
   * Call site: `buildTeacherPersona`'s MAINS ANGLES bullet.
   * ⚠ Also contains the source's hard line wrapping ("\n     ").
   */
  mainsAnglesLens: Authored<string>;
  /** Call site: `buildRevisionCompressionSystem` — `` `…into a revision cheat-sheet for ${revisionAudience}.` ``. */
  revisionAudience: Authored<string>;
  /** Call site: `services/mentor/index.ts` teacher web research — `` `You are researching ${researchFraming} to help a mentor teach it.` ``. */
  researchFraming: Authored<string>;
  /** Call site: `services/mentor/index.ts` quick-check quiz — `` `You write ${quizFraming} (bilingual: …)` ``. */
  quizFraming: Authored<string>;
}

/** Current affairs — `ca/prompts.ts`, `ca/mcq-node-classify.ts`, `ca/deepdive.ts`. */
export interface ExamCaConfig {
  /** Call site: `triageParams` system — `` `You are ${strategistFraming} triaging a news item.` ``. */
  strategistFraming: Authored<string>;
  /** Call site: `enrichParams` system — `` `You write exam-oriented current-affairs material for ${enrichAudience}, in BOTH Hindi…` ``. */
  enrichAudience: Authored<string>;
  /**
   * Call site: `enrichParams` system, EXAM-WORTHINESS BAR — the quoted question
   * `"would a real UPPSC prelims paper plausibly ask this, or is it just colour/context from the news story?"`.
   */
  examWorthinessBar: Authored<string>;
  /** Call site: `generateMcqs` system line 1 — `` `You write ${mcqStyleFraming} (bilingual, …)` ``. */
  mcqStyleFraming: Authored<string>;
  /** Call site: `generateMcqs` system line 1 tail — `` `…in the style of ${mcqExamplesFraming}. Rules:` ``. */
  mcqExamplesFraming: Authored<string>;
  /** Call site: `generateMcqs` content tail — `` `Write 0-2 ${mcqOutputLabel}, ONLY for the exam-worthy facts, …` ``. */
  mcqOutputLabel: Authored<string>;
  /** Call site: `generateMcqs` system, EXAM-RELEVANCE FILTER — the "write a question for a fact ONLY if …" clause. */
  mcqRelevanceFilter: Authored<string>;
  /** Call site: `generateMainsQuestion` system — `` `You are ${mainsSetterFraming}. Write ONE original…` ``. */
  mainsSetterFraming: Authored<string>;
  /** Call site: `generateMainsQuestion` system — `` `Open with ${mainsDirectiveVerbGuidance} and demand analysis, not recall.` `` (same verb list as qgen; different tail). */
  mainsDirectiveVerbGuidance: Authored<string>;
  /** Call site: `generateMainsQuestion` system — the "Realistic <exam> Mains marks + word limit (…)" line, verbatim. */
  mainsMarksNorm: Authored<string>;
  /** Call site: `ca/deepdive.ts` `DEEP_DIVE_SYSTEM` — `` `…one long-form 'Deep Dive' analysis for ${deepDiveFraming} — the kind of…` ``. */
  deepDiveFraming: Authored<string>;
  /** Call site: `ca/deepdive.ts` `DEEP_DIVE_SYSTEM` — `` `- intro_i18n: 2-3 sentences framing ${deepDiveIntroFraming}.` ``. */
  deepDiveIntroFraming: Authored<string>;
  /** Call site: `ca/deepdive.ts` `buildContext` — the related-PYQ block header, verbatim. */
  deepDivePyqHeader: Authored<string>;
  /** Call site: `ca/mcq-node-classify.ts` `MCQ_NODE_CLASSIFY_SYSTEM` — `` `…item to ${nodeClassifyFraming}, from the candidate list…` ``. */
  nodeClassifyFraming: Authored<string>;
}

/** Study notes + chapters — `notes/prompts.ts`, `notes/chapter-prompts.ts`. */
export interface ExamNotesConfig {
  /** Call site: `notes/prompts.ts` `AUTHOR_SYSTEM` AND `chapter-prompts.ts` `SECTION_SYSTEM` — `` `You are ${facultyFraming} writing/WRITING…` ``. */
  facultyFraming: Authored<string>;
  /** Call site: `chapter-prompts.ts` `OUTLINE_SYSTEM` — a LONGER form ("senior … (Uttar Pradesh PCS) …"); separate field, not derivable from `facultyFraming`. */
  outlineFacultyFraming: Authored<string>;
  /** Call site: `notes/prompts.ts` `RESEARCH_SYSTEM` — `` `You are ${researcherFraming}. Given a syllabus topic…` ``. */
  researcherFraming: Authored<string>;
  /** Call site: `chapter-prompts.ts` `CHAPTER_RESEARCH_SYSTEM` — a SHORTER form; separate call site, separate field. */
  chapterResearcherFraming: Authored<string>;
  /** Call site: `chapter-prompts.ts` `AUDIT_SYSTEM` — `` `You are ${auditorFraming}. You are given the chapter's DECISIVE FACTS…` ``. */
  auditorFraming: Authored<string>;
  /** Call site: `chapter-prompts.ts` `FACT_ESCALATE_SYSTEM` — `` `…verifying ${factEscalateFraming}. Use the web_search tool…` ``. */
  factEscalateFraming: Authored<string>;
  /**
   * Call site: `notes/chapter-generate.ts`'s fact-escalation USER turn —
   * `` `${factEscalateUserFraming}\n"${claim}"` ``. Stored WITH its trailing
   * colon; the newline and the quoted claim are structural.
   *
   * A DIFFERENT grammatical form from `factEscalateFraming`, which is the noun
   * phrase the SYSTEM prompt embeds ("…verifying ONE decisive fact from a UPPSC
   * study chapter"). This one is a complete imperative sentence. Neither is
   * derivable from the other, so both exist.
   */
  factEscalateUserFraming: Authored<string>;
  /** Call site: `notes/prompts.ts` `CRITIC_SYSTEM` — `` `You are ${criticFraming}. You are given a syllabus topic…` ``. */
  criticFraming: Authored<string>;
  /** Call site: `chapter-prompts.ts` `OUTLINE_SYSTEM` — `` `…plan sections that map to ${outlineCompletenessLens} and what a topper must know` ``. */
  outlineCompletenessLens: Authored<string>;
  /**
   * Call site: `notes/prompts.ts` `AUTHOR_SYSTEM` — `` `- up_angle: ${stateAngleDirective}.\n` ``.
   *
   * ⚠ THE BLOCK KEY `up_angle` IS NOT PROMPT COPY. It is a property of
   * `NoteContentI18n` in `@neev/shared`, of `NOTE_GEN_SCHEMA`, and of every
   * persisted `notes.content_i18n` row. Parameterise only the description.
   * (Chapters have no `up_angle` field at all — `chapter-persist.ts` writes
   * `up_angle: ""` — so a chapter carries its state angle in ordinary prose,
   * which is exactly what makes it easy to copy across exams unnoticed.
   * See docs/multi-exam.md §5.)
   */
  stateAngleDirective: Authored<string>;
  /**
   * The human-readable LABEL the same block is rendered under when a finished
   * note is shown to the critic.
   * Call site: `notes/prompts.ts` `renderNoteForCritic` —
   * `` `${stateAngleLabel}: ${b.up_angle}\n\nPYQ ANALYSIS: …` ``. Stored without
   * the colon, which is structural (it matches the sibling "OVERVIEW:",
   * "KEY FACTS:", "PYQ ANALYSIS:" labels).
   *
   * ⚠ SAME WARNING AS `stateAngleDirective`: `up_angle` is a PERSISTED key of
   * `NoteContentI18n`, `NOTE_GEN_SCHEMA` and every stored `notes.content_i18n`
   * row. This field is the rendering label only — never rename the key.
   */
  stateAngleLabel: Authored<string>;
  /**
   * Call site: `notes/prompts.ts` `AUTHOR_SYSTEM`, the `overview` block spec —
   * `` `- overview: 2-4 short paragraphs ${authorRelevanceFraming}.\n` ``.
   * Stored without the trailing period, matching `stateAngleDirective`'s shape.
   *
   * Inside the cached segment `[0]`, which PARTITIONS the prompt cache per exam
   * — fine. See `notes/prompts.ts`'s cache-boundary note.
   */
  authorRelevanceFraming: Authored<string>;
  /**
   * Call site: `notes/prompts.ts` `AUTHOR_SYSTEM`, the `pyq_analysis` block spec —
   * `` `- pyq_analysis: 1-2 short paragraphs on ${pyqAnalysisFraming} (use the PYQ + weightage data provided) and what to focus on.\n` ``.
   * Same cached segment `[0]` as `authorRelevanceFraming`.
   */
  pyqAnalysisFraming: Authored<string>;
  /** Call site: `notes/prompts.ts` `RESEARCH_SYSTEM` — the "especially …-specific schemes, latest data/figures, …" clause. */
  researchStateFocus: Authored<string>;
  /** Call site: `chapter-prompts.ts` `CHAPTER_RESEARCH_SYSTEM` — the same clause PLUS "budget numbers"; separate field. */
  chapterResearchStateFocus: Authored<string>;
  /**
   * Call site: `notes/prompts.ts` `buildResearchContent` — the OPENING line, up
   * to the interpolated stage: `` `${researchTopicFraming} ${node.stage} topic:` ``.
   * Stored WITHOUT the stage (structural, `"prelims" | "mains"`) and without the
   * `" topic:"` tail, so the exam qualifier is the only configurable part.
   */
  researchTopicFraming: Authored<string>;
  /**
   * Call site: `chapter-prompts.ts` `buildChapterResearchContent` — the same
   * opening line with a different tail
   * (`` `${x} ${node.stage} topic and its sub-topics:` ``). Byte-identical to
   * `researchTopicFraming` for uppsc (both reference one const), but a separate
   * field: separate call site, separate field, exactly as
   * `researchPriorityDirective` / `chapterResearchPriorityDirective` are.
   */
  chapterResearchTopicFraming: Authored<string>;
  /** Call site: `notes/prompts.ts` `buildResearchContent` — the closing "Prioritise …" sentence, verbatim. */
  researchPriorityDirective: Authored<string>;
  /** Call site: `chapter-prompts.ts` `buildChapterResearchContent` — the same sentence PLUS "budget data"; separate field. */
  chapterResearchPriorityDirective: Authored<string>;
  /** Call site: `notes/prompts.ts` + `chapter-prompts.ts` `groundingBlock` — `` `REFERENCE PASSAGES (from the ${groundingStoreLabel}):` `` / `` `(${groundingStoreLabel} — ground your facts here)` ``. */
  groundingStoreLabel: Authored<string>;
}

/** Everything else that names the exam in a prompt. */
export interface ExamMiscConfig {
  /** Call site: `lib/community-moderation.ts` — `` `You screen user-generated posts on ${moderationFraming} for abuse…` ``. */
  moderationFraming: Authored<string>;
  /** Call site: `services/ocr/claude-vision-provider.ts` — `` `You transcribe photographed pages of ${ocrFraming}.` ``. */
  ocrFraming: Authored<string>;
  /** Call site: `services/micro-drills.ts` — `` `You are ${drillExaminerFraming}. The student has written ONLY the…` ``. */
  drillExaminerFraming: Authored<string>;
  /** Call site: `services/question-explanation.ts` `EXPLAIN_SYSTEM` — `` `You write ${explanationFraming} for exam aspirants, in BOTH Hindi…` ``. */
  explanationFraming: Authored<string>;
  /** Call site: `routes/stream.ts` on-demand explanation — a DIFFERENT form (`"UPPSC (UP PCS) MCQ answers"`); separate field. */
  streamExplanationFraming: Authored<string>;
  /** Call site: `routes/stream.ts` — the `translate()` `domainHint` argument for the second locale. */
  explanationTranslateDomainHint: Authored<string>;
  /** Call site: `services/study-plan.ts` `buildPlanSystem` — `` `You are ${studyPlanCoachFraming} building a personalised 7-day study plan.` ``. */
  studyPlanCoachFraming: Authored<string>;
  /** Call site: `services/study-plan.ts` `buildPlanContent` — the `displayName` fallback, `` `Student: ${displayName ?? studyPlanAspirantFallback}, …` ``. */
  studyPlanAspirantFallback: Authored<string>;
  /** Call site: `services/user-notes.ts` convert — `` `…personal STUDY NOTES for ${personalNotesAudience}, in ${lang}.` ``. */
  personalNotesAudience: Authored<string>;
  /** Call site: `services/user-notes.ts` translate — the `translateBatch` `domainHint` argument, verbatim (it carries a long parenthetical). */
  personalNotesTranslateDomainHint: Authored<string>;
  /**
   * Call site: `notes/chapter-generate.ts` step 6 — the `translateBatch`
   * `domainHint` for the English→Hindi chapter pass, verbatim (it carries a long
   * parenthetical naming concrete terms).
   *
   * Distinct from `personalNotesTranslateDomainHint`: that one is
   * direction-agnostic ("the target language", a user's own note in either
   * locale), this one is hard-wired to Hindi output and names study-material
   * examples. Lives in `misc` beside the other translate hints rather than in
   * `notes`, matching where every other `domainHint` is configured.
   */
  chapterTranslateDomainHint: Authored<string>;
  /**
   * Call site: `lib/anthropic.ts` `translate()` — the DEFAULT value of the
   * `domainHint` parameter.
   *
   * ⚠ SNEAKY: this is a default parameter, so every caller that omits the
   * argument silently emits "UPPSC" with nothing at the call site to grep for.
   * The sweep must thread an exam through these two functions (or remove the
   * defaults) rather than only fixing the explicit call sites.
   */
  translateDomainHint: Authored<string>;
  /** Call site: `lib/anthropic.ts` `translate()` system body — `` `…between Hindi and English for ${translatePlatformFraming}.` ``. */
  translatePlatformFraming: Authored<string>;
  /** Call site: `lib/anthropic.ts` `translateBatch()` — the DEFAULT `domainHint`. Same default-parameter trap as above. */
  translateQuestionsDomainHint: Authored<string>;
}

export interface ExamConfig {
  code: TargetExamCode;
  naming: ExamNaming;
  papers: ExamPapers;
  calendar: ExamCalendar;
  cutoffs: ExamCutoffs;
  relevanceLens: RelevanceLens;
  evaluation: ExamEvaluationConfig;
  qgen: ExamQgenConfig;
  mentor: ExamMentorConfig;
  ca: ExamCaConfig;
  notes: ExamNotesConfig;
  misc: ExamMiscConfig;
  /**
   * A POINTER, NOT A COPY. The honest per-exam coverage statement shown before a
   * user commits to an exam lives in `exams.launch_scope_i18n` (migration 0106,
   * shape = `examLaunchScopeSchema` in `@neev/shared`). Duplicating it here would
   * let the marketing copy and the database disagree about what is actually
   * ingested — the one thing that statement exists to prevent.
   */
  launchScope: { readonly source: "db:exams.launch_scope_i18n" };
  /** Likewise: the verified paper/marks structure is DB-authoritative. */
  paperStructure: { readonly source: "db:exams.paper_structure" };
}

// ---------------------------------------------------------------------------
// Shared verbatim fragments
// ---------------------------------------------------------------------------
// Two call sites that today share ONE byte-identical string get one const, so a
// future edit cannot silently desynchronise them. Fragments that merely look
// similar but differ by a word get their own fields above — see e.g. the four
// `groundingStoreLabel` phrasings vs the two research-priority sentences.

/** `qgen` DESC_SYSTEM and `ca` generateMainsQuestion use the identical verb list. */
const UPPSC_DIRECTIVE_VERBS =
  "a real UPPSC directive verb (Examine / Critically analyse / Discuss / Evaluate / Comment / To what extent / Elucidate)";

/** `qgen` DESC_SYSTEM and `ca` generateMainsQuestion open with the identical persona. */
const UPPSC_MAINS_SETTER = "an experienced UPPSC Mains paper setter";

/**
 * The retrieval-store label, WITHOUT a leading article, so all four grounding
 * blocks (evaluation / qgen / notes / chapter) can reuse it despite phrasing the
 * surrounding sentence differently.
 */
const UPPSC_GROUNDING_STORE = "official UPPSC syllabus/PYQ store";

/** The ungrounded-fallback knowledge source, shared by evaluation and qgen. */
const UPPSC_SYLLABUS_LABEL = "the UPPSC syllabus";

/**
 * The opening clause of BOTH note-research user turns
 * (`notes/prompts.ts`'s `buildResearchContent` and `chapter-prompts.ts`'s
 * `buildChapterResearchContent`), up to the interpolated stage. The two
 * sentences diverge only in their structural tail (`" topic:"` vs
 * `" topic and its sub-topics:"`), so the exam-bearing prefix is one string —
 * same reasoning as `UPPSC_GROUNDING_STORE`.
 */
const UPPSC_RESEARCH_TOPIC_FRAMING = "Research current, exam-relevant facts for this UPPSC";

/**
 * The full SCORING CALIBRATION block from `buildAnalysisSystem`, verbatim,
 * without the structural blank lines that surround it.
 *
 * Assembled here exactly as the source concatenates it. DO NOT reflow: the
 * prompt-snapshot harness treats any whitespace change as a regression.
 */
const UPPSC_SEVERITY_ANCHOR =
  "SCORING CALIBRATION — read carefully; this is where auto-graders most often go wrong.\n" +
  "Real UPPSC/UPSC Mains marking is SEVERE. Examiners very rarely award the top of the scale: a " +
  "topper's answer typically captures only about HALF the marks on a question, and strong, " +
  "genuinely well-prepared candidates routinely land in the 45-55% range per answer. Grade to " +
  "that reality, not to a generous school-style scale. Apply these bands to EACH dimension (0-10):\n" +
  "  9-10  Exceptional and rare. Topper-level on this dimension: virtually flawless, with " +
  "essentially nothing material a strong examiner would add. This must be GENUINELY UNCOMMON — it " +
  "is NOT the reward for merely competent, complete, on-topic work.\n" +
  "  7-8   Strong, comprehensive, clearly above average — distinctly better than the typical " +
  "well-prepared candidate. Even a good answer does NOT default here; reserve 7-8 for work that " +
  "genuinely stands out.\n" +
  "  5-6   Solid, competent, on-topic work. Give 5 for sound work that does the job but has real, " +
  "nameable gaps — this is the TYPICAL strong, well-prepared answer, and MOST of its dimensions are " +
  "5s. Give 6 only for a dimension with no material gap for its level (thorough and polished) yet " +
  "still short of standout. A 5-heavy strong answer (≈50-55% overall) is the correct, good result — " +
  "not a disappointment.\n" +
  "  3-4   Weak, generic, or with significant gaps in coverage, structure, or substantiation.\n" +
  "  0-2   Absent, off-topic, or empty/irrelevant (see the honesty guardrail).\n" +
  "HARD ANCHORING RULE (this is how you avoid the usual over-scoring): a dimension's SCORE must be " +
  "consistent with its own justification. If your justification for a dimension names any real " +
  "omission or gap (a missing point, no data/examples, thin coverage, a weak conclusion, etc.), " +
  "that dimension is a 5 or lower — NEVER a 6, 7, or 8. Do not praise a dimension in the number " +
  "while criticising it in the words. Only a dimension you can honestly say has essentially NO " +
  "material gap for its level may exceed 5. Consequently a complete, well-structured, on-topic " +
  "answer that still has real gaps (as almost all do) lands around 5 per dimension — a weighted " +
  "overall near 50-55% of the max marks, which is the CORRECT, expected result for a strong " +
  "answer. Reserve 7-8 for work that genuinely stands out and 9-10 for the rare/exceptional.";

// ---------------------------------------------------------------------------
// uppsc — every value copied byte-for-byte from its prompt. ZERO unauthored slots.
// ---------------------------------------------------------------------------
const UPPSC: ExamConfig = {
  code: DEFAULT_EXAM_CODE,

  naming: {
    short: "UPPSC",
    commission: "Uttar Pradesh Public Service Commission",
    full: "UPPSC (Uttar Pradesh Public Service Commission)",
    qualifier: "UP PCS",
    withQualifier: "UPPSC (UP PCS)",
    longQualifier: "Uttar Pradesh PCS",
    withLongQualifier: "UPPSC (Uttar Pradesh PCS)",
    // Mirrors exams.display_name_i18n; enforced by assertExamConfigMatchesRegistry().
    displayNameI18n: { en: "UPPSC (UP PCS)", hi: "यूपीपीएससी (यूपी पीसीएस)" },
  },

  papers: {
    essay: ESSAY_PAPER_CODE,
    generalHindi: GENERAL_HINDI_PAPER_CODE,
    prelimsGs: PRELIMS_GS1_PAPER_CODE,
    prelimsCsat: PRELIMS_CSAT_PAPER_CODE,
    mainsGs: MAINS_GS_PAPER_CODES,
  },

  calendar: { lookupExamCode: "uppsc", countdownStage: "prelims" },

  cutoffs: {
    meritPaperCode: PRELIMS_GS1_PAPER_CODE,
    qualifyingPaperCode: PRELIMS_CSAT_PAPER_CODE,
    officialMaxMarks: 200,
    minimumSource: "db:exams.paper_structure[].papers[].minimum",
  },

  relevanceLens: {
    kind: "state_specific",
    state: {
      code: "UP",
      nameEn: "Uttar Pradesh",
      nameHi: "उत्तर प्रदेश",
      adjectiveEn: "UP-specific",
    },
    curationDirective:
      "true ONLY for items specifically about Uttar Pradesh state government/policy/a UP event of state significance",
    stateGsPapersNote: "GS5_UP/GS6_UP are UP-specific papers",
  },

  evaluation: {
    examinerFraming:
      "the UPPSC (Uttar Pradesh Public Service Commission) Civil Services Mains examination",
    essayAnswerFraming: "ESSAY (निबंध paper — one ~700-word essay written on a chosen topic)",
    severityAnchor: UPPSC_SEVERITY_ANCHOR,
    strengthsMentorFraming: "an encouraging but honest UPPSC Mains mentor",
    improvementsMentorFraming: "a UPPSC Mains mentor",
    modelAnswerFramingGs: "a top UPPSC Mains answer writer",
    modelAnswerFramingEssay: "a top UPPSC Essay-paper writer",
    groundingStoreLabel: UPPSC_GROUNDING_STORE,
    groundingFallbackLabel: UPPSC_SYLLABUS_LABEL,
    substantiationExamples: "UP-specific data",
    essaySubstantiationExamples: "UP-/India-specific evidence",
    feedbackTranslateDomainHint:
      "UPPSC answer-evaluation feedback (an examiner's critique of a candidate's answer)",
  },

  qgen: {
    prelimsSetterFraming:
      "an experienced UPPSC (Uttar Pradesh Public Service Commission) Prelims question setter",
    mainsSetterFraming: UPPSC_MAINS_SETTER,
    criticFraming: "a strict UPPSC question-quality reviewer",
    verifierFraming: "a top UPPSC aspirant sitting the exam",
    fewShotHeader:
      "REAL UPPSC PAST-YEAR QUESTIONS FOR THIS TOPIC (match their stem length, option style, and trap patterns):",
    fewShotFallback:
      "No sample past-year questions were available for this exact topic; follow the general UPPSC style described above.",
    fewShotAttribution: "UPPSC",
    groundingStoreLabel: UPPSC_GROUNDING_STORE,
    groundingFallbackLabel: UPPSC_SYLLABUS_LABEL,
    formatGuidance:
      "Prefer UPPSC's real formats: single statement, 'Consider the following statements', matching, assertion-reason, correctly-matched-pairs.",
    directiveVerbGuidance: UPPSC_DIRECTIVE_VERBS,
    marksNormGuidance:
      "UPPSC Mains norms (typically 125 words / 7 marks, or 200 words / 10 marks; longer for higher marks)",
    toneCriterion: "does it read like a real UPPSC question in difficulty, phrasing, and format?",
    mcqOutputLabel: "UPPSC-Prelims MCQs",
    descOutputLabel: "UPPSC-Mains descriptive questions",
  },

  mentor: {
    platformFraming: "a UPPSC (UP PCS) exam-prep platform",
    teacherPlatformFraming: "UPPSC (UP PCS) exam-prep platform",
    // Spans three joined array lines in buildMentorPersona — the "\n  " sequences
    // are part of the assembled prompt.
    testingLens:
      "Connect explanations to how UPPSC actually tests the topic — PYQ question patterns (statement-based,\n" +
      "  matching-type, chronological-order), commonly confused pairs/traps, and what to actually write in a Mains\n" +
      "  answer where relevant.",
    // Spans two joined array lines in buildTeacherPersona.
    mainsAnglesLens:
      "how UPPSC frames this in a descriptive answer, and which GS paper(s)\n" +
      "     it feeds.",
    revisionAudience: "a UPPSC (UP PCS) aspirant",
    researchFraming: "a UPPSC (UP PCS) exam topic",
    quizFraming: "UPPSC-prelims-style objective questions",
  },

  ca: {
    strategistFraming: "a UPPSC (UP state civil services) exam strategist",
    enrichAudience: "UPPSC aspirants",
    examWorthinessBar:
      "would a real UPPSC prelims paper plausibly ask this, or is it just colour/context from the news story?",
    mcqStyleFraming: "UPPSC-Prelims objective questions",
    mcqExamplesFraming: "the REAL past-year UPPSC questions shown below",
    mcqOutputLabel: "UPPSC-Prelims MCQs",
    mcqRelevanceFilter:
      "write a question for a fact ONLY if a real UPPSC prelims paper would plausibly test it",
    mainsSetterFraming: UPPSC_MAINS_SETTER,
    mainsDirectiveVerbGuidance: UPPSC_DIRECTIVE_VERBS,
    mainsMarksNorm:
      "Realistic UPPSC Mains marks + word limit (typically 125 words / 7 marks or 200 words / 10 marks).",
    deepDiveFraming: "a UPPSC Mains current-affairs magazine",
    deepDiveIntroFraming: "why this issue matters for UPPSC Mains right now",
    deepDivePyqHeader: "\nRELATED PAST UPPSC QUESTIONS (for angle, not to answer):",
    nodeClassifyFraming: "ONE specific UPPSC Prelims General Studies Paper I curriculum topic",
  },

  notes: {
    facultyFraming: "an expert UPPSC faculty member",
    outlineFacultyFraming: "a senior UPPSC (Uttar Pradesh PCS) faculty member",
    researcherFraming: "a UPPSC (Uttar Pradesh PCS) subject researcher",
    chapterResearcherFraming: "a UPPSC subject researcher",
    auditorFraming: "a strict UPPSC fact-checker auditing a study chapter",
    factEscalateFraming: "ONE decisive fact from a UPPSC study chapter",
    factEscalateUserFraming: "Verify this decisive fact from a UPPSC study chapter:",
    criticFraming: "a strict UPPSC content reviewer",
    outlineCompletenessLens: "what UPPSC has actually asked (use the weightage + PYQ patterns)",
    stateAngleDirective:
      "how this topic connects specifically to Uttar Pradesh (state schemes, UP data, local relevance)",
    // The rendering label for the SAME persisted `up_angle` block — never the key.
    stateAngleLabel: "UP ANGLE",
    authorRelevanceFraming: "orienting the aspirant to the topic and why it matters for UPPSC",
    pyqAnalysisFraming: "how UPPSC has asked this topic",
    researchTopicFraming: UPPSC_RESEARCH_TOPIC_FRAMING,
    chapterResearchTopicFraming: UPPSC_RESEARCH_TOPIC_FRAMING,
    researchStateFocus:
      "especially Uttar-Pradesh-specific schemes, latest data/figures, recent " +
      "government initiatives, and anything that has changed recently",
    chapterResearchStateFocus:
      "especially Uttar-Pradesh-specific schemes, latest data/figures, recent government initiatives, budget " +
      "numbers, and anything changed recently",
    researchPriorityDirective:
      "Prioritise UP-specific schemes, latest figures, and recent developments.",
    chapterResearchPriorityDirective:
      "Prioritise UP-specific schemes, latest figures, budget data, and recent developments.",
    groundingStoreLabel: UPPSC_GROUNDING_STORE,
  },

  misc: {
    moderationFraming: "a UPPSC exam-prep community",
    ocrFraming: "a handwritten UPPSC Mains exam answer",
    drillExaminerFraming: "an examiner scoring UPPSC (UP PCS) Mains answer-writing practice",
    explanationFraming: "UPPSC MCQ answer explanations",
    streamExplanationFraming: "UPPSC (UP PCS) MCQ answers",
    explanationTranslateDomainHint: "UPPSC MCQ explanation",
    studyPlanCoachFraming: "an expert UPPSC (UP PCS) exam-prep coach",
    studyPlanAspirantFallback: "a UPPSC aspirant",
    personalNotesAudience: "a UPPSC aspirant",
    personalNotesTranslateDomainHint:
      "UPPSC study note (write natural, fully-idiomatic text in the target language — no leftover source-language words for ordinary terms; keep only genuine loanwords/acronyms readers actually use as-is)",
    chapterTranslateDomainHint:
      "UPPSC study material (write natural, fully-Hindi text — no leftover English words for ordinary terms like 'Preamble' or 'flowchart'; keep only genuine loanwords/acronyms Hindi speakers actually use as-is)",
    translateDomainHint: "UPPSC exam-prep content",
    translatePlatformFraming: "a UP PCS exam platform",
    translateQuestionsDomainHint: "UPPSC exam questions",
  },

  launchScope: { source: "db:exams.launch_scope_i18n" },
  paperStructure: { source: "db:exams.paper_structure" },
};

// ---------------------------------------------------------------------------
// upsc — REFERENCE ROW. Naming is fact and is filled in; every judgment slot is
// UNAUTHORED. `exams.is_live` is false and the exam carries zero syllabus nodes,
// questions, chapters and current affairs (migration 0106), so nothing reads
// these slots today.
//
// DO NOT fill them by adapting UPPSC's text. In particular the severity anchor's
// "45-55% per answer" is a researched claim about a marking regime, not a
// template — and UPSC's Essay paper is ~1000-1200 words at 250 marks, a
// materially different scheme from UPPSC's 700/50.
// ---------------------------------------------------------------------------
const UPSC: ExamConfig = {
  code: "upsc",

  naming: {
    short: "UPSC",
    commission: "Union Public Service Commission",
    full: "UPSC (Union Public Service Commission)",
    qualifier: "CSE",
    withQualifier: "UPSC (CSE)",
    longQualifier: "Civil Services Examination",
    withLongQualifier: "UPSC (Civil Services Examination)",
    displayNameI18n: { en: "UPSC Civil Services", hi: "यूपीएससी सिविल सेवा" },
  },

  // null = no syllabus ingested yet. When one is, these MUST be exam-prefixed
  // ("UPSC_PRE_GS1") — paper codes are globally unique across exams.
  papers: { essay: null, generalHindi: null, prelimsGs: null, prelimsCsat: null, mainsGs: [] },

  calendar: { lookupExamCode: "upsc", countdownStage: "prelims" },

  cutoffs: {
    meritPaperCode: null,
    qualifyingPaperCode: null,
    officialMaxMarks: null,
    minimumSource: "db:exams.paper_structure[].papers[].minimum",
  },

  // Structurally national (no single state focus). The curation lens itself —
  // what a national exam's CA triage should actually prioritise — is unwritten.
  relevanceLens: {
    kind: "national",
    curationDirective: UNAUTHORED,
    stateGsPapersNote: UNAUTHORED,
  },

  evaluation: {
    examinerFraming: UNAUTHORED,
    essayAnswerFraming: UNAUTHORED,
    severityAnchor: UNAUTHORED,
    strengthsMentorFraming: UNAUTHORED,
    improvementsMentorFraming: UNAUTHORED,
    modelAnswerFramingGs: UNAUTHORED,
    modelAnswerFramingEssay: UNAUTHORED,
    groundingStoreLabel: UNAUTHORED,
    groundingFallbackLabel: UNAUTHORED,
    substantiationExamples: UNAUTHORED,
    essaySubstantiationExamples: UNAUTHORED,
    feedbackTranslateDomainHint: UNAUTHORED,
  },

  qgen: {
    prelimsSetterFraming: UNAUTHORED,
    mainsSetterFraming: UNAUTHORED,
    criticFraming: UNAUTHORED,
    verifierFraming: UNAUTHORED,
    fewShotHeader: UNAUTHORED,
    fewShotFallback: UNAUTHORED,
    fewShotAttribution: UNAUTHORED,
    groundingStoreLabel: UNAUTHORED,
    groundingFallbackLabel: UNAUTHORED,
    formatGuidance: UNAUTHORED,
    directiveVerbGuidance: UNAUTHORED,
    marksNormGuidance: UNAUTHORED,
    toneCriterion: UNAUTHORED,
    mcqOutputLabel: UNAUTHORED,
    descOutputLabel: UNAUTHORED,
  },

  mentor: {
    platformFraming: UNAUTHORED,
    teacherPlatformFraming: UNAUTHORED,
    testingLens: UNAUTHORED,
    mainsAnglesLens: UNAUTHORED,
    revisionAudience: UNAUTHORED,
    researchFraming: UNAUTHORED,
    quizFraming: UNAUTHORED,
  },

  ca: {
    strategistFraming: UNAUTHORED,
    enrichAudience: UNAUTHORED,
    examWorthinessBar: UNAUTHORED,
    mcqStyleFraming: UNAUTHORED,
    mcqExamplesFraming: UNAUTHORED,
    mcqOutputLabel: UNAUTHORED,
    mcqRelevanceFilter: UNAUTHORED,
    mainsSetterFraming: UNAUTHORED,
    mainsDirectiveVerbGuidance: UNAUTHORED,
    mainsMarksNorm: UNAUTHORED,
    deepDiveFraming: UNAUTHORED,
    deepDiveIntroFraming: UNAUTHORED,
    deepDivePyqHeader: UNAUTHORED,
    nodeClassifyFraming: UNAUTHORED,
  },

  notes: {
    facultyFraming: UNAUTHORED,
    outlineFacultyFraming: UNAUTHORED,
    researcherFraming: UNAUTHORED,
    chapterResearcherFraming: UNAUTHORED,
    auditorFraming: UNAUTHORED,
    factEscalateFraming: UNAUTHORED,
    factEscalateUserFraming: UNAUTHORED,
    criticFraming: UNAUTHORED,
    outlineCompletenessLens: UNAUTHORED,
    stateAngleDirective: UNAUTHORED,
    stateAngleLabel: UNAUTHORED,
    authorRelevanceFraming: UNAUTHORED,
    pyqAnalysisFraming: UNAUTHORED,
    researchTopicFraming: UNAUTHORED,
    chapterResearchTopicFraming: UNAUTHORED,
    researchStateFocus: UNAUTHORED,
    chapterResearchStateFocus: UNAUTHORED,
    researchPriorityDirective: UNAUTHORED,
    chapterResearchPriorityDirective: UNAUTHORED,
    groundingStoreLabel: UNAUTHORED,
  },

  misc: {
    moderationFraming: UNAUTHORED,
    ocrFraming: UNAUTHORED,
    drillExaminerFraming: UNAUTHORED,
    explanationFraming: UNAUTHORED,
    streamExplanationFraming: UNAUTHORED,
    explanationTranslateDomainHint: UNAUTHORED,
    studyPlanCoachFraming: UNAUTHORED,
    studyPlanAspirantFallback: UNAUTHORED,
    personalNotesAudience: UNAUTHORED,
    personalNotesTranslateDomainHint: UNAUTHORED,
    chapterTranslateDomainHint: UNAUTHORED,
    translateDomainHint: UNAUTHORED,
    translatePlatformFraming: UNAUTHORED,
    translateQuestionsDomainHint: UNAUTHORED,
  },

  launchScope: { source: "db:exams.launch_scope_i18n" },
  paperStructure: { source: "db:exams.paper_structure" },
};

// ---------------------------------------------------------------------------
// mppsc — REFERENCE ROW, same rules as upsc.
//
// Structurally state_specific (Madhya Pradesh), so the state facts below are
// stated as fact — but the CURATION LENS (what actually counts as MP-relevant
// current affairs, and which Mains papers carry the state angle) is unwritten,
// and MPPSC's Mains papers V/VI are Hindi-only with a different mark scheme
// again. Nothing here may be adapted from UPPSC's UP-focused text.
// ---------------------------------------------------------------------------
const MPPSC: ExamConfig = {
  code: "mppsc",

  naming: {
    short: "MPPSC",
    commission: "Madhya Pradesh Public Service Commission",
    full: "MPPSC (Madhya Pradesh Public Service Commission)",
    qualifier: "MP State Service",
    withQualifier: "MPPSC (MP State Service)",
    longQualifier: "Madhya Pradesh State Service",
    withLongQualifier: "MPPSC (Madhya Pradesh State Service)",
    displayNameI18n: { en: "MPPSC (MP State Service)", hi: "एमपीपीएससी (एमपी राज्य सेवा)" },
  },

  papers: { essay: null, generalHindi: null, prelimsGs: null, prelimsCsat: null, mainsGs: [] },

  calendar: { lookupExamCode: "mppsc", countdownStage: "prelims" },

  cutoffs: {
    meritPaperCode: null,
    qualifyingPaperCode: null,
    officialMaxMarks: null,
    minimumSource: "db:exams.paper_structure[].papers[].minimum",
  },

  relevanceLens: {
    kind: "state_specific",
    state: {
      code: "MP",
      nameEn: "Madhya Pradesh",
      nameHi: "मध्य प्रदेश",
      adjectiveEn: "MP-specific",
    },
    curationDirective: UNAUTHORED,
    stateGsPapersNote: UNAUTHORED,
  },

  evaluation: {
    examinerFraming: UNAUTHORED,
    essayAnswerFraming: UNAUTHORED,
    severityAnchor: UNAUTHORED,
    strengthsMentorFraming: UNAUTHORED,
    improvementsMentorFraming: UNAUTHORED,
    modelAnswerFramingGs: UNAUTHORED,
    modelAnswerFramingEssay: UNAUTHORED,
    groundingStoreLabel: UNAUTHORED,
    groundingFallbackLabel: UNAUTHORED,
    substantiationExamples: UNAUTHORED,
    essaySubstantiationExamples: UNAUTHORED,
    feedbackTranslateDomainHint: UNAUTHORED,
  },

  qgen: {
    prelimsSetterFraming: UNAUTHORED,
    mainsSetterFraming: UNAUTHORED,
    criticFraming: UNAUTHORED,
    verifierFraming: UNAUTHORED,
    fewShotHeader: UNAUTHORED,
    fewShotFallback: UNAUTHORED,
    fewShotAttribution: UNAUTHORED,
    groundingStoreLabel: UNAUTHORED,
    groundingFallbackLabel: UNAUTHORED,
    formatGuidance: UNAUTHORED,
    directiveVerbGuidance: UNAUTHORED,
    marksNormGuidance: UNAUTHORED,
    toneCriterion: UNAUTHORED,
    mcqOutputLabel: UNAUTHORED,
    descOutputLabel: UNAUTHORED,
  },

  mentor: {
    platformFraming: UNAUTHORED,
    teacherPlatformFraming: UNAUTHORED,
    testingLens: UNAUTHORED,
    mainsAnglesLens: UNAUTHORED,
    revisionAudience: UNAUTHORED,
    researchFraming: UNAUTHORED,
    quizFraming: UNAUTHORED,
  },

  ca: {
    strategistFraming: UNAUTHORED,
    enrichAudience: UNAUTHORED,
    examWorthinessBar: UNAUTHORED,
    mcqStyleFraming: UNAUTHORED,
    mcqExamplesFraming: UNAUTHORED,
    mcqOutputLabel: UNAUTHORED,
    mcqRelevanceFilter: UNAUTHORED,
    mainsSetterFraming: UNAUTHORED,
    mainsDirectiveVerbGuidance: UNAUTHORED,
    mainsMarksNorm: UNAUTHORED,
    deepDiveFraming: UNAUTHORED,
    deepDiveIntroFraming: UNAUTHORED,
    deepDivePyqHeader: UNAUTHORED,
    nodeClassifyFraming: UNAUTHORED,
  },

  notes: {
    facultyFraming: UNAUTHORED,
    outlineFacultyFraming: UNAUTHORED,
    researcherFraming: UNAUTHORED,
    chapterResearcherFraming: UNAUTHORED,
    auditorFraming: UNAUTHORED,
    factEscalateFraming: UNAUTHORED,
    factEscalateUserFraming: UNAUTHORED,
    criticFraming: UNAUTHORED,
    outlineCompletenessLens: UNAUTHORED,
    stateAngleDirective: UNAUTHORED,
    stateAngleLabel: UNAUTHORED,
    authorRelevanceFraming: UNAUTHORED,
    pyqAnalysisFraming: UNAUTHORED,
    researchTopicFraming: UNAUTHORED,
    chapterResearchTopicFraming: UNAUTHORED,
    researchStateFocus: UNAUTHORED,
    chapterResearchStateFocus: UNAUTHORED,
    researchPriorityDirective: UNAUTHORED,
    chapterResearchPriorityDirective: UNAUTHORED,
    groundingStoreLabel: UNAUTHORED,
  },

  misc: {
    moderationFraming: UNAUTHORED,
    ocrFraming: UNAUTHORED,
    drillExaminerFraming: UNAUTHORED,
    explanationFraming: UNAUTHORED,
    streamExplanationFraming: UNAUTHORED,
    explanationTranslateDomainHint: UNAUTHORED,
    studyPlanCoachFraming: UNAUTHORED,
    studyPlanAspirantFallback: UNAUTHORED,
    personalNotesAudience: UNAUTHORED,
    personalNotesTranslateDomainHint: UNAUTHORED,
    chapterTranslateDomainHint: UNAUTHORED,
    translateDomainHint: UNAUTHORED,
    translatePlatformFraming: UNAUTHORED,
    translateQuestionsDomainHint: UNAUTHORED,
  },

  launchScope: { source: "db:exams.launch_scope_i18n" },
  paperStructure: { source: "db:exams.paper_structure" },
};

/**
 * The registry.
 *
 * Typed `Record<TargetExamCode, ExamConfig>` deliberately: adding a fourth code
 * to `TARGET_EXAM_CODES` in `@neev/shared` breaks this file at compile time
 * until that exam is configured. Do not replace with `Partial<…>`, an index
 * signature, or a lookup that falls back silently.
 */
export const EXAM_CONFIGS: Record<TargetExamCode, ExamConfig> = {
  uppsc: UPPSC,
  upsc: UPSC,
  mppsc: MPPSC,
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------
const KNOWN_CODES = new Set<string>(TARGET_EXAM_CODES);

/**
 * The config for an exam code.
 *
 * Takes a plain `string` because every call site holds one: `getUserExam()`,
 * `examCodeForNode()` and `syllabus_nodes.exam_code` are all `string`, not the
 * narrow union (the DB column is text with a foreign key, not an enum).
 *
 * NEVER THROWS. An unknown code falls back to the default exam and logs a
 * warning. These configs are read at the moment a prompt is built — i.e. at the
 * billing point of an evaluation or a mentor answer — and taking down a paid
 * user's answer evaluation because a row carries an unexpected exam code would
 * be a worse failure than serving the default exam's framing. A genuinely
 * missing exam surfaces through the warning and through
 * `assertExamConfigMatchesRegistry()`, not through a 500.
 *
 * (Contrast `requireAuthored`, which DOES throw: an unknown exam code is an
 * operational anomaly, whereas reaching an unauthored judgment slot means we
 * were about to send another exam's examiner judgment to the model.)
 */
export function getExamConfig(code: string): ExamConfig {
  if (KNOWN_CODES.has(code)) return EXAM_CONFIGS[code as TargetExamCode];
  logger.warn(
    { examCode: code, fallback: DEFAULT_EXAM_CODE },
    "exam-config: unknown exam code; falling back to the default exam",
  );
  return EXAM_CONFIGS[DEFAULT_EXAM_CODE];
}

// ---------------------------------------------------------------------------
// Drift guard against the DB registry
// ---------------------------------------------------------------------------
export interface ExamConfigDrift {
  examCode: string;
  field: string;
  configured: string;
  registry: string;
}

export interface ExamConfigDriftReport {
  ok: boolean;
  problems: ExamConfigDrift[];
}

interface ExamRegistryRow {
  exam_code: string;
  display_name_i18n: { en?: string; hi?: string } | null;
  paper_structure: {
    stages?: { papers?: { paper_code?: string | null; marks?: number | null }[] }[];
  } | null;
}

/**
 * Assert that this module has not drifted from the DB registry (`exams`).
 *
 * The values duplicated here are the ones the code needs synchronously —
 * display names and paper codes — and `exams` is authoritative for both. Nothing
 * stops the two from silently disagreeing, so this is the check that catches it.
 *
 * Modelled on `services/mentor/cache-health.ts`'s boot probe: it logs at ERROR
 * (not warn) so an operator sees it, and returns a structured report a health
 * endpoint can surface.
 *
 * NOT WIRED INTO BOOT IN THIS SLICE — exported only. Wire it into `index.ts`'s
 * `app.listen` (and, if useful, `GET /health`) when the sweep lands, alongside
 * `checkMentorCacheHealthAtBoot`.
 *
 * Checks, per configured exam:
 *   1. the exam exists in `exams`
 *   2. `naming.displayNameI18n` matches `display_name_i18n` (en and hi)
 *   3. every non-null configured paper code appears in `paper_structure`
 *   4. `cutoffs.officialMaxMarks`, when set, equals the merit paper's `marks`
 *
 * A DB read failure is reported as drift rather than swallowed; pass
 * `{ throwOnDrift: true }` to turn any problem into an exception (useful for a
 * CI/ops script; a boot probe should prefer the ERROR log so a transient DB
 * blip cannot crash-loop the API).
 */
export async function assertExamConfigMatchesRegistry(
  opts: { throwOnDrift?: boolean } = {},
): Promise<ExamConfigDriftReport> {
  const problems: ExamConfigDrift[] = [];

  const { data, error } = await supabase()
    .from("exams")
    .select("exam_code, display_name_i18n, paper_structure");

  if (error) {
    problems.push({
      examCode: "*",
      field: "exams",
      configured: "(registry read)",
      registry: `failed: ${error.message}`,
    });
  } else {
    const rows = (data ?? []) as ExamRegistryRow[];
    const byCode = new Map(rows.map((r) => [r.exam_code, r]));

    for (const code of TARGET_EXAM_CODES) {
      const cfg = EXAM_CONFIGS[code];
      const row = byCode.get(code);
      if (!row) {
        problems.push({ examCode: code, field: "exam_code", configured: code, registry: "(missing)" });
        continue;
      }

      for (const locale of ["en", "hi"] as const) {
        const configured = cfg.naming.displayNameI18n[locale];
        const registry = row.display_name_i18n?.[locale] ?? "";
        if (configured !== registry) {
          problems.push({
            examCode: code,
            field: `naming.displayNameI18n.${locale}`,
            configured,
            registry,
          });
        }
      }

      const structurePapers = (row.paper_structure?.stages ?? []).flatMap((s) => s.papers ?? []);
      const knownCodes = new Set(
        structurePapers.map((p) => p.paper_code).filter((p): p is string => !!p),
      );

      const configuredPapers: [string, string | null][] = [
        ["papers.essay", cfg.papers.essay],
        ["papers.generalHindi", cfg.papers.generalHindi],
        ["papers.prelimsGs", cfg.papers.prelimsGs],
        ["papers.prelimsCsat", cfg.papers.prelimsCsat],
        ["papers.mainsGs", null], // expanded below
        ["cutoffs.meritPaperCode", cfg.cutoffs.meritPaperCode],
        ["cutoffs.qualifyingPaperCode", cfg.cutoffs.qualifyingPaperCode],
        ...cfg.papers.mainsGs.map((p, i): [string, string] => [`papers.mainsGs[${i}]`, p]),
      ];

      for (const [field, paperCode] of configuredPapers) {
        if (!paperCode) continue;
        if (!knownCodes.has(paperCode)) {
          problems.push({
            examCode: code,
            field,
            configured: paperCode,
            registry: `(not in paper_structure: ${[...knownCodes].join(", ") || "none"})`,
          });
        }
      }

      if (cfg.cutoffs.officialMaxMarks !== null && cfg.cutoffs.meritPaperCode) {
        const merit = structurePapers.find((p) => p.paper_code === cfg.cutoffs.meritPaperCode);
        const registryMarks = merit?.marks ?? null;
        if (registryMarks !== cfg.cutoffs.officialMaxMarks) {
          problems.push({
            examCode: code,
            field: "cutoffs.officialMaxMarks",
            configured: String(cfg.cutoffs.officialMaxMarks),
            registry: registryMarks === null ? "(absent)" : String(registryMarks),
          });
        }
      }
    }
  }

  const report: ExamConfigDriftReport = { ok: problems.length === 0, problems };

  if (!report.ok) {
    logger.error(
      { problems },
      "exam-config: DRIFTED from the exams registry — lib/exam-config.ts disagrees with the DB. " +
        "`exams` is authoritative for display names, paper codes and paper marks; fix the config, not the row.",
    );
    if (opts.throwOnDrift) {
      const summary = problems
        .map((p) => `${p.examCode}.${p.field}: config="${p.configured}" registry="${p.registry}"`)
        .join("; ");
      throw new Error(`exam-config drifted from the exams registry: ${summary}`);
    }
  }

  return report;
}
