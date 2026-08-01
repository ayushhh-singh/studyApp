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
  type CurrentAffairsGsPaper,
  type ExamStateLens,
  type TargetExamCode,
} from "@neev/shared";
import {
  ESSAY_PAPER_CODE,
  GENERAL_HINDI_PAPER_CODE,
  MAINS_GS_PAPER_CODES,
  PRELIMS_CSAT_PAPER_CODE,
  PRELIMS_GS1_PAPER_CODE,
} from "./exam-papers.js";
import {
  UPSC_ESSAY_PAPER_CODE,
  UPSC_MAINS_GS_PAPER_CODES,
  UPSC_PRELIMS_CSAT_PAPER_CODE,
  UPSC_PRELIMS_GS1_PAPER_CODE,
} from "./upsc-papers.js";
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

/**
 * An exam's aptitude-paper (CSAT) question-setting norm, where it is
 * structurally different from the same exam's General Studies Prelims paper.
 *
 * Present ⇒ `qgen` treats that paper as a paper in its own right:
 *  1. `formatGuidance` below REPLACES `ExamQgenConfig.formatGuidance` in the MCQ
 *     system prompt for nodes on `papers.prelimsCsat`;
 *  1b. `toneCriterion` likewise replaces `ExamQgenConfig.toneCriterion` in the
 *     Stage-B critic — the GATE, not just the generator, since a critic still
 *     judging against General Studies formats would keep selecting for exactly
 *     the questions (1) stops producing; and
 *  2. `loadFewShot` stops topping a CSAT node's few-shot set up from the
 *     paper-wide pool. That fallback is coherent for a knowledge paper (every
 *     GS-I question is a GS-I-style question) and incoherent for an aptitude
 *     paper, where the sibling topics are DIFFERENT SKILLS — measured, it served
 *     the "Interpersonal Skills including Communication Skills" node four
 *     train-route and percentage puzzles as style exemplars.
 *
 * Absent (`null`) ⇒ both behaviours stay exactly as they are for that exam.
 */
export interface ExamQgenCsatConfig {
  /**
   * Call site: `mcqSystem` for a node whose paper is `papers.prelimsCsat` —
   * occupies the same slot as `ExamQgenConfig.formatGuidance` and must therefore
   * read as a continuation of "The stem must be self-contained and answerable
   * from the option set alone."
   */
  formatGuidance: string;
  /**
   * Call site: `criticSystem` for a node on `papers.prelimsCsat` — occupies the
   * same slot as `ExamQgenConfig.toneCriterion`, i.e. the text after
   * `` `- uppsc_tone: ` `` (the SCHEMA KEY is frozen and must never be renamed;
   * only this human-readable criterion is configurable).
   *
   * ⚑ WHY THE CRITIC NEEDS ITS OWN CSAT SLOT AND NOT JUST THE GENERATOR.
   * `criticSystem`'s verdict is a HARD GATE — `generate.ts` does
   * `if (c.critic && !c.critic.approve) c.reject = "critic"`, and the critic is
   * told to approve "ONLY if it is … on-tone". So the tone criterion does not
   * merely describe the house style, it decides which candidates survive into
   * the bank. Making only the generator aptitude-aware would have left the
   * SELECTOR still asking "is this a General Studies-shaped question?": a real
   * passage-comprehension item — the single largest genuine CSAT form, measured
   * at 29.7% of the real paper — is neither "a statement-combination set" nor
   * obviously "a direct single-item question" to a literal reader and could be
   * rejected as off-tone, while a GS-shaped statement-combination recall item on
   * a CSAT node passes that same test cleanly. That is the failure this whole
   * change exists to remove, re-entering one stage later and selecting FOR it.
   */
  toneCriterion: string;
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
   *
   * ⚑ This is the GENERAL Prelims MCQ norm, and for an exam whose `qgen.csat` is
   * null it is ALSO what a CSAT/aptitude node gets. See `csat` below.
   */
  formatGuidance: Authored<string>;
  /**
   * How this exam's aptitude paper (CSAT / Paper-II) differs from its General
   * Studies Prelims paper, or `null` if this exam has no separately-authored
   * aptitude norm.
   *
   * WHY THIS IS A SEPARATE SLOT RATHER THAN A CLAUSE IN `formatGuidance`.
   * MEASURED 2026-08-01 over the real ingested bank (paged past the 1000-row
   * cap): a blind 3-judge panel scored generated UPSC CSAT MCQs at 2.00/5 for
   * likeness against 3.63 for real UPSC CSAT — 9.9x the 0.164 inter-judge noise
   * floor. The cause was structural, not a missing sentence: `formatGuidance`
   * is one string used for BOTH prelims papers, so a CSAT node received ~250
   * words teaching the GS statement-set norm followed by one trailing sentence
   * asking the model to disregard it. It did not. `statement_counting` — a
   * GS-I closure that is 6.7% of real UPSC GS-I and 0.6% of real UPSC CSAT —
   * came out at 17.2% of generated CSAT, while `passage_based`, the single
   * largest real CSAT form at ~30%, came out at 3.4%. A trailing exception
   * cannot outweigh the body of the prompt; the CSAT paper needs its own body.
   *
   * `null` for uppsc is a DELIBERATE NO-OP, not a finding: it preserves today's
   * byte-identical UPPSC prompt (and today's UPPSC few-shot selection, see
   * `qgen/generate.ts`'s `loadFewShot`). It is NOT a claim that UPPSC CSAT is
   * stylistically interchangeable with UPPSC GS — measured, UPPSC's own CSAT is
   * ~89% direct-single with a median stem of 87 characters, so it plainly has a
   * norm of its own. Authoring it would change the LIVE exam's generated output
   * and needs the 3-arm control validation this change was not scoped for.
   */
  csat: Authored<ExamQgenCsatConfig | null>;
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

/**
 * Mentor — `services/mentor/prompts.ts` and `services/mentor/index.ts`.
 *
 * =========================================================================
 * ⚠ LENGTH CONSTRAINT ON `platformFraming` + `testingLens` — READ BEFORE
 *   AUTHORING A SECOND EXAM'S MENTOR FRAMING
 * =========================================================================
 * `buildMentorPersona` is the ONLY cached segment on the mentor's generic
 * doubt path, and it clears claude-sonnet-5's 1024-token minimum cacheable
 * prefix by a hair. MEASURED 2026-07-30 with `messages.countTokens`:
 *
 *     uppsc en → 1046 tokens (+22 over the minimum)
 *     uppsc hi → 1055 tokens (+31)
 *     of which 102 tokens are these two keys:
 *         testingLens      81 tokens (233 chars)
 *         platformFraming  21 tokens ( 35 chars)
 *
 * A second exam whose framing is merely ~23 tokens TERSER than UPPSC's pushes
 * the assembled persona below 1024, and Anthropic then silently stops caching
 * it — no error, `cache_creation_input_tokens: 0` forever, and EVERY mentor
 * doubt for that exam re-bills the whole persona as fresh input.
 *
 * So: **do not write a tighter mentor framing than UPPSC's just because it
 * reads better.** Match its length or exceed it. A terser exam-specific
 * testing lens is the single most likely way to trip this, because it is by
 * far the larger of the two keys.
 *
 * `pnpm prompts:snapshot` enforces a character floor per exam and fails loudly
 * if a persona drops into the danger zone (see MENTOR_PERSONA_MIN_CHARS in
 * `apps/api/scripts/prompt-snapshot.ts`) — but it is a proxy, so if a new
 * exam lands near the floor, confirm with `countTokens` before shipping.
 * Background on why a below-minimum `cache: true` is silent:
 * `lib/anthropic.ts`'s PromptSegment doc.
 */
export interface ExamMentorConfig {
  /**
   * Call site: `buildMentorPersona` line 1 —
   * `"…the AI mentor on Neev — " + platformFraming + ". You are a"`.
   *
   * ⚠ Counts toward the persona's cache-minimum budget — see the length
   * constraint on this interface. 21 tokens for uppsc.
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
   *
   * ⚠ THE LARGEST EXAM-CONFIG CONTRIBUTOR to the persona's cache-minimum
   * budget — 81 of the 102 config-supplied tokens for uppsc. Writing a terser
   * testing lens for a new exam is the most likely way to silently disable
   * mentor prompt caching for that exam; see the length constraint documented
   * on this interface before shortening it.
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
  /**
   * Which `CurrentAffairsGsPaper` enum values are THIS exam's real Mains papers,
   * in the order they are offered to the model and rendered by the magazine.
   *
   * ⚑ THIS IS A HARD CONSTRAINT, NOT PROSE, AND THAT IS WHY IT EXISTS. Until
   * 2026-08-01 `ca/prompts.ts` held ONE module-level `GS_PAPERS` list offering
   * `GS5_UP`/`GS6_UP` — UPPSC-only papers — inside the triage **JSON schema**,
   * for every exam. A nationally-scoped exam was fenced off them by
   * `relevanceLens.stateGsPapersNote` alone, i.e. by an instruction the model
   * may ignore, while the structured-output grammar said they were legal
   * values. Prose is a soft constraint; a schema enum is a hard one. Reading
   * this per exam makes the two agree.
   *
   * ORDER IS BYTE-SIGNIFICANT: it is serialised into the triage schema's
   * `enum` array, so `uppsc`'s list must stay exactly as `GS_PAPERS` was
   * (GS1..GS4, ESSAY, GS5_UP, GS6_UP) or `pnpm prompts:snapshot` reports the
   * live exam's prompt as CHANGED — which for this file is a stop-and-report
   * event, not a re-baseline (see its NO PROMPT CACHING note).
   *
   * STRUCTURAL, not judgment — but still `Authored`, because the mapping from a
   * commission's real Mains papers onto this UPPSC-shaped enum is not
   * mechanical: UPPSC's six GS papers land on four `GS*` values plus the two
   * `*_UP` ones, and its General Hindi paper has no value at all. Guessing it
   * for an exam nobody has researched would be exactly the substitution U6
   * forbids. Generalising the enum ITSELF (a jsonb `gs_papers_by_exam`) is M20,
   * deliberately deferred.
   */
  gsPapers: Authored<readonly CurrentAffairsGsPaper[]>;
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

/**
 * A bilingual USER-FACING label (not a prompt fragment).
 *
 * Separate from `Authored<string>` because the strings it carries are rendered
 * to a learner in both locales — a test title, a share-card brand line — so an
 * exam that has one side authored and not the other is not a usable value.
 * `naming.displayNameI18n` uses the same `{en, hi}` shape; this type exists so
 * the several `misc` labels below don't each re-declare it inline.
 */
export interface I18nLabel {
  en: string;
  hi: string;
}

/** Everything else that names the exam in a prompt. */
export interface ExamMiscConfig {
  /** Call site: `lib/community-moderation.ts` — `` `You screen user-generated posts on ${moderationFraming} for abuse…` ``. */
  moderationFraming: Authored<string>;
  /** Call site: `services/ocr/claude-vision-provider.ts` — `` `You transcribe photographed pages of ${ocrFraming}.` ``. */
  ocrFraming: Authored<string>;
  /** Call site: `services/micro-drills.ts` — `` `You are ${drillExaminerFraming}. The student has written ONLY the…` ``. */
  drillExaminerFraming: Authored<string>;
  /**
   * TWO call sites, one byte-identical fragment (so one field, per this file's
   * shared-fragment convention):
   *  - `services/question-explanation.ts` `explainSystem` (the on-demand path)
   *  - `ingest/explain.ts` `explainSystem` (the batch ingest CLI, a deliberate
   *    self-contained copy of the same policy — its surrounding sentence says
   *    "the VERIFIED correct option", which is structural, not exam-bearing).
   * Both read `` `You write ${explanationFraming} for exam aspirants, in BOTH Hindi…` ``.
   */
  explanationFraming: Authored<string>;
  /**
   * The on-demand `/stream/explain` explanation — a DIFFERENT grammatical form
   * (`"UPPSC (UP PCS) MCQ answers"`, the object of "You explain …"); separate
   * field, not derivable from `explanationFraming`.
   *
   * Call site: `services/question-explanation.ts` `streamExplainSystem`, which
   * `routes/stream.ts`'s `/stream/explain` handler sends. (The builder was moved
   * out of the route in the multi-exam sweep so it is reachable by
   * `pnpm prompts:snapshot` without issuing an HTTP request.)
   */
  streamExplanationFraming: Authored<string>;
  /** Call site: `routes/stream.ts` — the `translate()` `domainHint` argument for the second locale. */
  explanationTranslateDomainHint: Authored<string>;
  /**
   * Call site: `ingest/explain.ts` `supportSystem` — the grounded key-SUPPORT
   * pre-check that runs before an explanation is written:
   * `` `You are auditing ${ingestKeySupportFraming} before an explanation is written for it.` ``.
   */
  ingestKeySupportFraming: Authored<string>;
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

  // -------------------------------------------------------------------------
  // Ingest / audit CLI prompts
  // -------------------------------------------------------------------------
  /**
   * Call site: `ingest/series.ts` `seriesSystem` —
   * `` `You are shown the cover/first page of ${seriesPaperFraming}. Look for a BOOKLET …` ``.
   */
  seriesPaperFraming: Authored<string>;
  /**
   * Call site: `ingest/series.ts` `seriesSystem` — `` `Note: ${seriesBookletCodeNote}, and coaching-reconstructed papers …` ``.
   *
   * JUDGMENT, not naming: "DSTF-1-23" is the shape of the code a UPPSC booklet
   * actually prints instead of a plain A/B/C/D series letter (confirmed on the
   * 2024 GS-I pilot — see that module's header). Another commission's booklets
   * carry whatever THEY print; this must be observed, never adapted.
   */
  seriesBookletCodeNote: Authored<string>;
  /**
   * Call site: `ingest/syllabus.ts` `buildStructurePaperSystem` —
   * `` `You are an expert on ${syllabusExpertFraming}. You build a clean, hierarchical …` ``.
   *
   * JUDGMENT: the uppsc value names a specific reform year ("its 2025-reform
   * syllabus"), which is a fact about UPPSC's own syllabus history.
   */
  syllabusExpertFraming: Authored<string>;
  /**
   * Call site: `ingest/syllabus.ts` `buildStructurePaperSystem` —
   * `` `…use ${syllabusStructureNote} to organise topics into sections and sub-topics.` ``.
   */
  syllabusStructureNote: Authored<string>;
  /**
   * Call site: `ingest/pyq.ts` `buildNodeClassifySystem` —
   * `` `You map ${pyqNodeClassifyFraming} to the single best-matching syllabus node. ` ``.
   */
  pyqNodeClassifyFraming: Authored<string>;
  /** Call site: `audit/resolve.ts` `solveSystem` — `` `You are ${auditSolverFraming}. You are shown ONE multiple-choice question…` ``. */
  auditSolverFraming: Authored<string>;
  /** Call site: `audit/resolve.ts` `escalateSystem` — `` `You are ${auditEscalateFraming}. An automated solver disagreed…` ``. */
  auditEscalateFraming: Authored<string>;

  // -------------------------------------------------------------------------
  // USER-FACING labels (rendered to a learner, not sent to a model)
  // -------------------------------------------------------------------------
  /**
   * Call site: `ingest/tests.ts` — the `tests.title_i18n` of a `pyq_full` test:
   * `` `${pyqTestTitlePrefix.en} ${paper.title.en} — ${year}` `` (and the `hi` half).
   * Stored WITHOUT the trailing space, which is structural.
   */
  pyqTestTitlePrefix: Authored<I18nLabel>;
  /**
   * Call site: `services/mocks.ts` `upsertPrelimsMockTest` —
   * `` `${prelimsMockTitlePrefix.en} ${paperName.en} — Mock Test ${index}` ``.
   * Distinct from `pyqTestTitlePrefix` because it names the STAGE too.
   */
  prelimsMockTitlePrefix: Authored<I18nLabel>;
  /** Call site: `services/mocks.ts` `upsertMainsMockTest` — the Mains counterpart. */
  mainsMockTitlePrefix: Authored<I18nLabel>;
  /**
   * Call site: `services/share-image.ts` — the brand line rendered into BOTH
   * share PNGs (weekly digest + Conquest Map). "Neev" is the product name and is
   * exam-independent; only the exam half of the line varies, but the two are
   * fused into one rendered string, so the whole line is configured rather than
   * assembled from a product constant plus an exam name.
   */
  shareCardBrand: Authored<I18nLabel>;
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
 * UPSC's counterparts to the two consts above (M34, hoisted 2026-07-31). They
 * were authored as duplicated literals inside the `UPSC` block because that pass
 * was scoped to edit only inside it.
 *
 * ⚑ De-duplicating the LITERAL does NOT merge the FIELDS. `qgen.*` and `ca.*`
 * stay separate fields precisely so the two generators (question bank vs current
 * affairs) can diverge per exam later — and their host templates already differ
 * ("…and demand analysis, not mere recall." vs "…not recall."), so the sentences
 * they build are not identical even today. Point a new exam's two fields at one
 * const only while the two values genuinely are one value.
 */
const UPSC_DIRECTIVE_VERBS =
  "a real UPSC directive verb — Discuss most often, then Explain / Examine / Comment / Analyse / Elucidate " +
  "('Critically examine' is only about 2% of real stems, so never make it the default) — or, in roughly a third " +
  "of questions as real UPSC papers do, with no directive verb at all (a bare What / How / Why interrogative, " +
  "or a bare topic statement)";

const UPSC_MAINS_SETTER = "an experienced UPSC Civil Services Mains paper setter";

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
    // Deliberate no-op — see `ExamQgenConfig.csat`. NOT a claim that UPPSC's
    // CSAT paper has no norm of its own (measured: ~89% direct-single, median
    // stem 87 chars, ~4% passage-based against UPSC CSAT's ~30%). Authoring it
    // changes the LIVE exam's generated questions and needs its own validation.
    csat: null,
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
    // BYTE-FOR-BYTE the old module-level `GS_PAPERS` in ca/prompts.ts, in its
    // exact order — this is the live exam's triage schema enum. GS5_UP/GS6_UP
    // are UPPSC Mains GS-V/GS-VI, the two UP-specific papers. General Hindi has
    // no value in this enum and never had one.
    gsPapers: ["GS1", "GS2", "GS3", "GS4", "ESSAY", "GS5_UP", "GS6_UP"],
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
    ingestKeySupportFraming: "a UPPSC exam MCQ",

    seriesPaperFraming: "a UPPSC exam question paper or its official answer key",
    seriesBookletCodeNote:
      "many UPPSC booklets carry only a CODE string (e.g. 'DSTF-1-23') or a bar-code serial number instead of a " +
      "plain A/B/C/D letter",
    syllabusExpertFraming: "the UPPSC (UP PCS) examination and its 2025-reform syllabus",
    syllabusStructureNote: "the standard UPPSC structure",
    pyqNodeClassifyFraming: "each UPPSC question",
    auditSolverFraming: "a top UPPSC aspirant taking the exam",
    auditEscalateFraming: "a meticulous fact-checker auditing a UPPSC exam question",

    pyqTestTitlePrefix: { en: "UPPSC", hi: "यूपीपीएससी" },
    prelimsMockTitlePrefix: { en: "UPPSC Prelims", hi: "यूपीपीएससी प्रारंभिक" },
    mainsMockTitlePrefix: { en: "UPPSC Mains", hi: "यूपीपीएससी मुख्य" },
    shareCardBrand: { en: "Neev · UPPSC prep", hi: "नींव · यूपीपीएससी तैयारी" },
  },

  launchScope: { source: "db:exams.launch_scope_i18n" },
  paperStructure: { source: "db:exams.paper_structure" },
};

/**
 * UPSC's OWN severity anchor for `buildAnalysisSystem`. Structurally parallel to
 * `UPPSC_SEVERITY_ANCHOR` (five 0-10 bands + a hard anchoring rule + the
 * severity-is-not-brevity guard is enforced separately in the prompt), but every
 * NUMBER in it is UPSC's own, measured from UPSC's own written-stage marksheets.
 * It is NOT UPPSC's text with the exam renamed (§6a) — the two marking regimes
 * genuinely differ, and UPSC's is the harsher of the two.
 *
 * WHAT IS MEASURED, and what is not — recorded because a future session will be
 * tempted to "tidy" the hedges out:
 *  * MEASURED, from real sourced written-only marksheets:
 *      - Excellent (AIR-1, whole-paper average across the four GS papers):
 *        45-51%; five-topper mean 46.9%, range 44.8-50.7%.
 *      - Barely adequate (last recommended General candidate): ~42% of written
 *        marks; six-year mean 42.4%.
 *      - Single papers sit far lower than the average even for the year's
 *        topper: one AIR-1's GS-III was 88/250 = 35.2%.
 *      - Essay: topper range 43-62% of 250, six-topper mean 52.1%.
 *  * INTERPOLATED, not measured: the "solid but unremarkable ~45-47%" band. It
 *    is bracketed by the two measured anchors above and is stated in the prompt
 *    as a calibration target, never as an observation.
 *  * ARITHMETIC FROM PAPER TOTALS, assuming proportional distribution — an
 *    ASSUMPTION, not a measurement: a genuinely strong 10-marker earns ~4-5/10
 *    and a strong 15-marker ~7-8/15. Independently corroborated by
 *    coaching-community figures derived separately ("6-7/10 is highest-scoring",
 *    "8/15 is a strong performance"); the convergence is meaningful, but neither
 *    is a direct per-question measurement. The 20-mark GS-IV figure in the
 *    prompt is a further extrapolation from the same ratio and says so.
 *
 * TWO CLAIMS DELIBERATELY NOT MADE, because the evidence refuses them:
 *  1. "Essay is more generous than GS" is NOT a stable rule — true by 2-10
 *     points in 2018/2021/2022 and REVERSED in 2023 and 2025. The anchor says
 *     essay is *comparable and not reliably more generous*, which is what the
 *     data supports.
 *  2. GS-IV scoring a few points above the other GS papers rests on n=4, AIR-1
 *     candidates only (3 of 4 had GS-IV as their best GS paper; one AIR-1's
 *     143/250 = 57.2%). Stated as a mild directional hint, never as a rule.
 *
 * ⚑ THE TRAP THIS ANCHOR EXISTS TO BLOCK. The widely quoted "~54% for a UPSC
 * topper" is the BLENDED written+interview aggregate. UPSC's interview is marked
 * far more generously (toppers 58-75%) than the written stage. An answer-writing
 * evaluator never sees an interview, so anchoring to ~54% inflates every score
 * systematically. The anchor names the trap explicitly rather than merely
 * avoiding it, because the model's own priors carry the blended number.
 *
 * NET: UPSC is calibrated at least as severely as UPPSC and arguably slightly
 * more — its written-only excellent ceiling (~51%) sits at or below UPPSC's
 * anchor low end, and its adequate floor (~42%) is 8-13 points below it.
 *
 * HONEST GAP, recorded rather than hidden: UPSC publishes no marking scheme and
 * releases evaluated scripts only by personal RTI, and the "topper copies" in
 * circulation are overwhelmingly test-series mocks rather than UPSC-marked
 * scripts. There is therefore NO verifiable per-question UPSC data anywhere; the
 * per-question bands are the best available inference, not a published tariff.
 *
 * Paper structure is measured from the 2,791 ingested UPSC PYQs: GS-I..III use
 * 10 marks / 150 words and 15 marks / 250 words at ~45%/45%; GS-IV is mostly
 * 20 marks; Essay is 125 marks / 1200 words per essay, two essays for 250.
 *
 * DO NOT REFLOW: the prompt-snapshot harness treats any whitespace change as a
 * regression. Stored WITHOUT the blank lines the prompt puts around it.
 */
const UPSC_SEVERITY_ANCHOR =
  "SCORING CALIBRATION — read carefully; this is where auto-graders most often go wrong.\n" +
  "Real UPSC Civil Services Mains marking is SEVERE, and harsher than most graders assume. From " +
  "published written-stage marksheets: across the four GS papers even the year's top-ranked " +
  "candidate averages only about 45-51% (five-topper mean ≈47%), and the LAST candidate " +
  "recommended in the General list clears it on roughly 42% of the written marks. Individual " +
  "papers run lower still — one AIR-1 scored 88/250 (35%) on GS-III in the very year they topped " +
  "the exam. The Essay paper spans about 43-62% of 250 for toppers: comparable to GS, and NOT " +
  "reliably more generous — in some years it scores BELOW the GS papers, so never mark an essay " +
  "on a softer scale.\n" +
  "TRAP — the '~54% for a topper' figure you may have absorbed is the BLENDED written-plus-" +
  "interview aggregate. UPSC marks the interview far more generously (toppers 58-75%) than the " +
  "written stage. You are grading a WRITTEN answer and there is no interview in view, so " +
  "anchoring anywhere near 54% inflates every score systematically. Anchor ONLY to the " +
  "written-only numbers above.\n" +
  "In the units the candidate actually sees: a genuinely strong answer earns roughly 4-5 out of " +
  "10 on a 10-mark / 150-word question, 7-8 out of 15 on a 15-mark / 250-word one, and by the " +
  "same ratio around 9-10 out of 20 on a 20-mark GS-IV question. That IS the good outcome, not a " +
  "poor one. (UPSC publishes no marking scheme and releases scripts only on personal request, so " +
  "these per-question figures are inferred from real paper totals rather than published — treat " +
  "them as the calibration target, not as an exact tariff.) Apply these bands to EACH dimension " +
  "(0-10):\n" +
  "  9-10  Exceptional and rare. The standard at which a dimension is essentially flawless and a " +
  "demanding UPSC examiner would have nothing material to add. Keep this GENUINELY UNCOMMON: on " +
  "real papers even AIR-1 candidates average under 51% across their GS papers, so this band is " +
  "never the reward for work that is merely complete, correct and on-topic.\n" +
  "  7-8   Clearly above the well-prepared candidate — a dimension that would visibly lift this " +
  "answer above the crowd sitting the same paper. Good, competent treatment does NOT default " +
  "here; 7-8 has to be earned by something that stands out.\n" +
  "  5-6   Sound, on-topic, well-prepared work that still has real, nameable gaps. THIS IS THE " +
  "MODAL BAND FOR A GENUINELY STRONG ANSWER: most dimensions of the ≈4-5/10, ≈7-8/15 answer " +
  "described above are 5s, and an overall around 45-47% is the target for solid, unremarkable " +
  "competence. Award 6 only where a dimension carries no material gap for its level yet still " +
  "would not stand out. A 5-heavy strong answer is the CORRECT result, not a disappointment.\n" +
  "  3-4   Weak, generic, or with significant gaps in coverage, structure, or substantiation.\n" +
  "  0-2   Absent, off-topic, or empty/irrelevant (see the honesty guardrail).\n" +
  "HARD ANCHORING RULE — this is how you avoid the over-scoring that ruins auto-graded feedback: " +
  "a dimension's NUMBER must agree with its own JUSTIFICATION. If the justification you write " +
  "names any real omission or shortfall — a demand of the question left unaddressed, no data or " +
  "examples, thin coverage, an unearned conclusion, a mishandled directive word — then that " +
  "dimension is 5 or lower, NEVER 6, 7 or 8. Do not praise a dimension in the number while " +
  "criticising it in the words. Only a dimension you can honestly say carries essentially NO " +
  "material gap for its level may exceed 5. It follows that a complete, well-structured, " +
  "on-topic answer that still has real gaps — as nearly every answer does — lands near 5 per " +
  "dimension, a weighted overall around 45-50% of the max marks. On this exam that is the " +
  "expected outcome for a strong candidate: reserve 7-8 for work that genuinely stands out, and " +
  "9-10 for the exceptional.";

// ---------------------------------------------------------------------------
// upsc — REFERENCE ROW. `exams.is_live` is false. Naming, papers, cutoffs and
// calendar are fact; the judgment-bearing groups are authored ONE AT A TIME as a
// pipeline genuinely needs them (relevanceLens, qgen, mentor, ca and the U5
// ingest slots landed 2026-07-31; `evaluation`, then `notes` and the rest of
// `misc`, landed the same day).
//
// EXACTLY THREE SLOTS REMAIN UNAUTHORED, AND ALL THREE ARE DELIBERATE — they are
// not the tail of an unfinished pass and must not be "completed" by one:
//   * `misc.syllabusExpertFraming` + `misc.syllabusStructureNote` — a live
//     safety guard. Authoring them helps re-open `ingest:syllabus` for upsc,
//     which would overwrite the coverage-gated hand-authored tree in place AND
//     build it from UPPSC's syllabus text. Full reasoning at the fields.
//   * `misc.translateDomainHint` — its sole consumer is that same permanently
//     closed path, so a value here is a string nothing can emit.
// Each carries its own ⚑ block below explaining why; read it before filling one.
//
// DO NOT fill any remaining slot by adapting UPPSC's text (§6a). The severity
// anchor in particular is a researched claim about ONE commission's marking
// regime, not a template with a swappable exam name — see UPSC_SEVERITY_ANCHOR
// above for what is measured, what is interpolated, and what is assumed.
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

  // POPULATED 2026-07-31 (M32). The 202-node UPSC tree and its 7 bound paper
  // codes have existed since migration 0112; leaving these null was stale rather
  // than harmful, but it read as "UPSC has no papers". Codes come from
  // `lib/upsc-papers.ts` (M31), never re-typed here — see that module for the
  // order of authority and for the §0 global-uniqueness invariant that makes the
  // `UPSC_` prefix mandatory.
  //
  // ⚑ `generalHindi: null` IS THE CORRECT VALUE, not an oversight: UPSC has no
  // General Hindi paper at all. UPPSC's `MAINS_GH` has no UPSC counterpart, so
  // this null means "does not exist", not "not ingested yet". (UPSC's Paper-A /
  // Paper-B qualifying language papers are a different thing, are out of launch
  // scope, and are deliberately code-less in 0112.)
  papers: {
    essay: UPSC_ESSAY_PAPER_CODE,
    generalHindi: null,
    prelimsGs: UPSC_PRELIMS_GS1_PAPER_CODE,
    prelimsCsat: UPSC_PRELIMS_CSAT_PAPER_CODE,
    mainsGs: UPSC_MAINS_GS_PAPER_CODES,
  },

  calendar: { lookupExamCode: "upsc", countdownStage: "prelims" },

  cutoffs: {
    meritPaperCode: null,
    qualifyingPaperCode: null,
    officialMaxMarks: null,
    minimumSource: "db:exams.paper_structure[].papers[].minimum",
  },

  // ---------------------------------------------------------------------------
  // AUTHORED 2026-07-31 — CA triage's relevance lens.
  //
  // Structurally national (no single state focus), so `kind` was already
  // "national" — which makes `ca/prompts.ts` suppress the "Source hints at
  // <state> focus" content line entirely. These two slots are the remaining
  // prose.
  //
  // THE CONSTRAINT THAT SHAPES BOTH VALUES: `is_up_specific` is a REAL COLUMN on
  // `current_affairs_items`, and `GS5_UP`/`GS6_UP` are REAL enum values of
  // `currentAffairsGsPaperSchema` (packages/shared/src/current-affairs.ts) that
  // the triage JSON schema offers and requires for EVERY exam. Renaming or
  // migrating them is M20's job (docs/OUTSTANDING.md §8b), deliberately NOT
  // started here — half-migrating a live schema is worse than writing honest
  // prose inside it. So:
  //   * `curationDirective` gives the boolean the only defensible national
  //     meaning — ALWAYS false. UPSC has no state paper and no state lens, so
  //     no item is ever "state-specific" for this exam. This does NOT mirror
  //     uppsc's value (which defines a real UP editorial signal); it disables a
  //     field that has no national analogue.
  //   * `stateGsPapersNote` actively fences the model OFF the two UP enum
  //     values and names UPSC's real Mains paper set instead (GS-I..GS-IV plus
  //     Essay — `ESSAY` is a valid enum value and IS a real UPSC paper).
  // ---------------------------------------------------------------------------
  relevanceLens: {
    kind: "national",
    curationDirective:
      "ALWAYS false for this exam — UPSC is a national examination with no state-specific paper, so no item is " +
      "ever state-specific here, however strongly the story centres on one state",
    stateGsPapersNote:
      "choose ONLY from GS1, GS2, GS3, GS4 and ESSAY, which are UPSC's real Mains papers, and NEVER emit GS5_UP " +
      "or GS6_UP — those are another commission's state-specific papers and do not exist in this exam",
  },

  // ---------------------------------------------------------------------------
  // AUTHORED 2026-07-31 — answer evaluation.
  //
  // `severityAnchor` is the judgment core; its evidence, its hedges and the
  // blended-aggregate trap it blocks are documented on UPSC_SEVERITY_ANCHOR
  // above. The other eleven slots split into two categories, and the split is
  // what keeps this from being a find-and-replace:
  //
  //  * STRUCTURAL NAMING (same category as `misc.translateQuestionsDomainHint`,
  //    authored for U5): examinerFraming, the four mentor/model-answer personas,
  //    the two grounding labels, and feedbackTranslateDomainHint. Each is a noun
  //    phrase naming THIS commission and THIS corpus in a slot whose grammar
  //    belongs to the template. The grounding labels deliberately match the
  //    qgen block's wording for the same two corpora, so the mentor, the question
  //    setter and the examiner all name the store identically.
  //
  //  * GENUINELY RE-DERIVED, because UPPSC's value would be WRONG here:
  //     - essayAnswerFraming. UPPSC's is one ~700-word essay for 50 marks; UPSC
  //       sets TWO essays of ~1200 words at 125 marks each (100% of the ingested
  //       Essay PYQ rows), so both the length and the mark scale differ. It also
  //       drops UPPSC's "निबंध paper" gloss, which names a UP-specific paper.
  //     - substantiationExamples. UPPSC's "UP-specific data" has no UPSC
  //       analogue at all: UPSC is a NATIONAL examination with no state angle,
  //       so the analogue is national/international substantiation. The value is
  //       worded to NOT duplicate what its two host sentences already list
  //       (both already name committees/commissions, constitutional articles,
  //       schemes and judgments), which is why it reaches for the Economic
  //       Survey / NITI Aayog / global-index / cross-country material instead.
  //     - essaySubstantiationExamples. Same reasoning; UPPSC's "UP-/India-
  //       specific" collapses to India-plus-comparative for a national paper.
  //
  // BOTH substantiation slots are ALSO read by services/evaluation/rubric.ts
  // (the `examples_data` dimension description of the GS and Essay rubrics), so
  // each is worded to read correctly in that sentence as well as in the model-
  // answer prompt. Verify both hosts before editing either.
  // ---------------------------------------------------------------------------
  evaluation: {
    examinerFraming: "the UPSC (Union Public Service Commission) Civil Services Mains examination",
    // No trailing space — the template supplies it. No Devanagari gloss: unlike
    // UPPSC's निबंध paper, UPSC's is simply the Essay paper.
    essayAnswerFraming:
      "ESSAY (Essay paper — one ~1200-word essay for 125 marks, one of the two essays written in the paper)",
    severityAnchor: UPSC_SEVERITY_ANCHOR,
    strengthsMentorFraming: "an encouraging but honest UPSC Civil Services Mains mentor",
    improvementsMentorFraming: "a UPSC Civil Services Mains mentor",
    modelAnswerFramingGs: "a top UPSC Civil Services Mains answer writer",
    modelAnswerFramingEssay: "a top UPSC Civil Services Essay-paper writer",
    // No leading article — the template says "retrieved from the ${...}".
    groundingStoreLabel: "official UPSC syllabus/PYQ store",
    // Carries its own article — the template says "your own knowledge of ${...}".
    groundingFallbackLabel: "the UPSC Civil Services syllabus",
    substantiationExamples:
      "national and international evidence (Economic Survey and NITI Aayog data, global indices " +
      "and rankings, and cross-country comparisons)",
    essaySubstantiationExamples: "India-specific and comparative international evidence",
    feedbackTranslateDomainHint:
      "UPSC Civil Services answer-evaluation feedback (an examiner's critique of a candidate's answer)",
  },

  // ---------------------------------------------------------------------------
  // AUTHORED 2026-07-31 — question generation.
  //
  // MEASURED, NOT ADAPTED. Every format/verb/marks claim below is a frequency
  // measured over the 2,791 real UPSC PYQs ingested by U5 (Prelims GS-I n=1,100,
  // CSAT n=880, Mains n=811) — not coaching lore, and emphatically not UPPSC's
  // guidance with the name swapped. The two commissions set genuinely different
  // papers, and reusing UPPSC's `formatGuidance` here would be actively wrong:
  //
  //   format                UPSC PRE_GS1    UPPSC PRE_GS1
  //   assertion-reason           0.0%            6.6%   ← 0 of 1,100. FORBIDDEN.
  //   pair-matching              3.4%           16.3%   ← would be ~5x over-produced
  //   chronological ordering     0.5%            6.3%   ← would be ~12x over-produced
  //   negative ("which is NOT")  2.1%           12.1%
  //   four content options      35.6%           67.6%
  //   "Consider the following"  45.0%            6.1%
  //
  // WHAT `formatGuidance` DELIBERATELY ENCODES:
  //  * Scaffolded multi-part stems are the norm (65.8% overall, 74-83% in
  //    2024-25); the statement-combination family alone is 55.3%. Modal design
  //    is THREE numbered statements (53.5% of scaffolded stems; 2 → 21.1%,
  //    4 → 19.7%), so 5+ is forbidden outright (5.8% combined, and lengthening
  //    a statement set is the easiest way to drift off-format).
  //  * ASSERTION-REASON IS BANNED BY NAME — 0/1,100 in the real corpus. UPSC's
  //    counterpart is the "Statement-I / Statement-II" pair (4.1%, 2023 onward)
  //    closed by "Which one of the following is correct in respect of the above
  //    statements?" with a four-way explanation code, so the ban ships WITH the
  //    real substitute rather than as a bare prohibition.
  //  * The counting variant ("How many of the above statements are correct?",
  //    options Only one / Only two / All three / None) is flagged MODERN, not
  //    classic: 0/600 across 2016-2021, then 8% (2022), 47% (2023), 18% (2024),
  //    27% (2025) — 7.6% overall. Calling it a staple would over-produce it;
  //    omitting it would miss the single biggest recent shift in the paper.
  //  * The canonical "1 only / 2 only / Both / Neither" quartet is explicitly
  //    NOT the default: only 13.0% of option sets, behind broad combinations
  //    (38.9%) and four substantive content options (35.6%).
  //  * CSAT is named as a different animal (68.9% direct single-item, only
  //    25.5% scaffolded, counting variant 1/880) so a CSAT node cannot inherit
  //    the statement-set norm.
  //
  // MAINS VERBS — the trap here is coaching lore. "Critically examine" reads as
  // the signature UPSC verb but is only 2.3% of primary stems (all "Critically
  // X" forms together 4.2%), so it is explicitly DEMOTED rather than promoted.
  // Discuss is the workhorse (20.8%), and A THIRD OF REAL STEMS CARRY NO
  // DIRECTIVE VERB AT ALL (33.3% — a bare What/How/Why or a bare topic), which
  // no adapted UPPSC verb list would ever have produced.
  //
  // MARKS: 10 marks/150w and 15 marks/250w in near-equal measure for GS-I..III
  // (45%/45%), GS-IV usually 20 marks (77.9%), Essay 125 marks / 1200 words
  // (100% of rows) — materially different from UPPSC's 7/125w and 10/200w.
  //
  // The few-shot and grounding labels are STRUCTURAL naming of a corpus, not
  // judgment (same category as `misc.translateQuestionsDomainHint`, authored for
  // U5 below), so they keep uppsc's grammatical shape — the shape belongs to the
  // template; only the corpus name differs. NOTE they are ALSO consumed by the
  // CA MCQ generator (`ca/prompts.ts` calls `fewShotBlock`), so each is worded
  // to read correctly in both contexts.
  // ---------------------------------------------------------------------------
  qgen: {
    prelimsSetterFraming:
      "an experienced UPSC (Union Public Service Commission) Civil Services Prelims question setter",
    mainsSetterFraming: UPSC_MAINS_SETTER,
    criticFraming: "a strict UPSC Civil Services question-quality reviewer",
    verifierFraming: "a top UPSC Civil Services aspirant sitting the exam",
    fewShotHeader:
      "REAL UPSC PAST-YEAR QUESTIONS FOR THIS TOPIC (match their stem length, option style, and trap patterns):",
    fewShotFallback:
      "No sample past-year questions were available for this exact topic; follow the general UPSC style described above.",
    fewShotAttribution: "UPSC",
    groundingStoreLabel: "official UPSC syllabus/PYQ store",
    groundingFallbackLabel: "the UPSC Civil Services syllabus",
    formatGuidance:
      "Prefer UPSC's real formats: about two-thirds of Prelims GS-I stems are scaffolded, most often 'Consider the " +
      "following statements' or 'With reference to X, consider the following' followed by THREE numbered statements " +
      "(two or four are also common; never five or more), closed either by a combination option set ('1 and 2 only', " +
      "'1, 2 and 3', 'None of the above') or by the modern counting form 'How many of the above statements are " +
      "correct?' with options 'Only one / Only two / All three / None'. The remaining third are direct single-item " +
      "questions answered by four substantive content options; do not default to the '1 only / 2 only / Both 1 and 2 " +
      "/ Neither 1 nor 2' quartet, which is only about one option set in eight. NEVER write an Assertion-Reason " +
      "(A/R) question — UPSC does not set them; where a two-part logical pair is wanted, use UPSC's actual " +
      "counterpart, a 'Statement-I / Statement-II' pair closed by 'Which one of the following is correct in respect " +
      "of the above statements?' with the four-way code (both correct and II explains I / both correct but II does " +
      "not explain I / I correct, II incorrect / I incorrect, II correct). Keep matching-pairs, chronological " +
      "ordering and negative 'which is NOT' framings rare — each is under 4% of real papers.",
    // ⚑ The sentence that USED to close the string above ("for a CSAT topic drop
    // the statement-set norm entirely…") is gone, and no developer-facing
    // replacement took its place: a draft of this change ended the prompt with
    // "the CSAT aptitude paper has its own norm (`qgen.csat` below)", which is a
    // note to whoever is reading THIS FILE, not an instruction to a model — the
    // model has no "below" and no config tree, so it is pure token waste in a
    // cached prefix and an invitation to look for a section that does not exist.
    // The routing fact belongs here, in a comment: a node on
    // `papers.prelimsCsat` never reaches this string at all, because
    // `csatQgenConfigFor` substitutes `csat.formatGuidance` for it wholesale.
    // ---------------------------------------------------------------------
    // AUTHORED 2026-08-01 — the CSAT aptitude paper's own norm.
    //
    // This slot exists because the trailing "for a CSAT topic, drop the
    // statement-set norm" sentence that used to close `formatGuidance` above
    // did not work: measured over the 29 generated CSAT MCQs, the GS-I counting
    // closure still came out at 17.2% against 0.6% in real CSAT, and the
    // largest real CSAT form (passage-based, ~30%) at 3.4%. See the long note
    // on `ExamQgenConfig.csat`.
    //
    // EVERY PROPORTION BELOW IS MEASURED, not estimated, over the real ingested
    // UPSC_PRE_CSAT bank (909 rows, paged past the 1000-row cap; 860 are
    // published and 841 of those are node-mapped — 841 is the denominator for
    // the per-skill split), 2026-08-01, and INDEPENDENTLY RE-MEASURED the same
    // day with a second classifier, which is why two figures below carry a
    // range: form classification is a judgement call at the margin (does a long
    // stem that asks for "the most logical inference" count as passage-based?),
    // so the honest report is the band, not a false 3-significant-figure point.
    //
    //   FORM        passage-based 29.7-32.6% | direct single-item 59.3-61.7%
    //               statement-combination 5.0% | Statement-I/II 2.5%
    //               "How many of the above" 0.6% | matching-pairs 0.4% (4 rows)
    //               Assertion-Reason 0.0%  (0 of 909 — as in GS-I: UPSC sets none)
    //   SKILL       numeracy + data interpretation 292 (34.7%)
    //               logical + analytical reasoning 258 (30.7%)
    //               comprehension                  246 (29.2%)
    //               decision-making + problem solving 30 (3.6%)
    //               general mental ability 11 | interpersonal 4
    //   STEM        median 226 chars, mean 278, max 1833 (a passage item carries
    //               its passage INSIDE the stem, which is why CSAT stems run
    //               2.6x the median length of UPPSC's CSAT stems).
    //
    // The decision-making closure quoted here ("most rational, practical and
    // immediate action") is VERBATIM from a real 2023 CSAT stem, not invented —
    // that family is posed as a situation, never as a definition, which is
    // precisely the failure mode observed in the generated set.
    // ---------------------------------------------------------------------
    csat: {
      formatGuidance:
        "This is the CSAT aptitude paper (Prelims Paper-II), NOT a General Studies paper: it tests comprehension, " +
        "reasoning, decision-making and basic numeracy as SKILLS, so treat the topic above as naming the skill the " +
        "question must EXERCISE, never a body of theory to be recalled. Do NOT ask what a term means, what its " +
        "components are, or which statements about it are correct — a real CSAT item is a self-contained exercise " +
        "the candidate solves on the spot by reading, reasoning or calculating, needing no outside knowledge. Write " +
        "in UPSC's real CSAT families in roughly their real proportions: about a third are reading-comprehension " +
        "items whose stem CARRIES ITS OWN PASSAGE in full and then asks for the most logical or most rational " +
        "inference, the main idea, the author's assumption, or which of several numbered assumptions/inferences are " +
        "valid (these are the items that take combination options such as '1 only' / 'Both 1 and 2' / 'Neither 1 " +
        "nor 2'); about a third are basic numeracy and data interpretation — number and letter series, " +
        "time-speed-distance, work, ratio and partnership, percentages and averages, and small tables or charts; " +
        "about a third are logical and analytical reasoning — seating and ranking arrangements, coding-decoding, " +
        "blood relations, calendars and clocks, truth-teller deduction, cubes, and data-sufficiency pairs presented " +
        "as 'Statement-I / Statement-II' and closed by whether either alone or both together suffice. " +
        "Decision-making and interpersonal items are a small minority and are posed as a short administrative or " +
        "workplace SITUATION closed by 'Which one of the following best reflects the most rational, practical and " +
        "immediate action?', never as a definition. NEVER write an Assertion-Reason item — UPSC sets none. Do NOT " +
        "use the 'How many of the above statements are correct?' counting closure and do NOT write a " +
        "matching-pairs list: those are Paper-I General Studies forms and together account for under 1% of real " +
        "CSAT papers. Keep standalone 'Consider the following statements' factual sets to about one item in twenty, " +
        "and never let one become a recall test on the topic. Real CSAT stems are substantial — a median of about " +
        "230 characters, and several hundred to well over a thousand for a passage item — and every stem must state " +
        "its own complete set-up, never referring to a passage, table or arrangement given in another question.",
      // The critic's own gate, re-stated for the aptitude paper. Deliberately
      // asks whether the item can be SOLVED without outside knowledge rather
      // than whether it matches a format list: "is this the right shape" is what
      // the GS criterion asks, and on CSAT the shape is not the thing that went
      // wrong — a theory-recall statement set about the node title is perfectly
      // well-shaped and still not a CSAT question.
      toneCriterion:
        "this question is for the CSAT aptitude paper (Prelims Paper-II), so judge it as an aptitude item, NOT as a " +
        "General Studies one: could a well-read candidate with NO subject knowledge of the topic solve it purely by " +
        "reading, reasoning or calculating from what the stem itself supplies, and does it read like a real UPSC " +
        "CSAT item in difficulty and phrasing? Answer false if it instead tests recall or theory about the topic " +
        "(what a term means, what its components or principles are, or whether statements about it are correct), if " +
        "it depends on facts not contained in the stem, if it uses the 'How many of the above statements are " +
        "correct?' counting closure or a matching-pairs list, or if it is an Assertion-Reason item — UPSC sets none " +
        "on either Prelims paper. A self-contained reading-comprehension item that carries its own passage, a " +
        "numeracy or data-interpretation problem, a logical-reasoning arrangement or deduction, and a " +
        "decision-making situation are all correct and expected CSAT forms; do not mark any of them off-tone for " +
        "not being a statement-combination set.",
    },
    // Shares ONE const with `ca.mainsDirectiveVerbGuidance` below, exactly as
    // uppsc does (M34, 2026-07-31). Still two separate FIELDS on purpose — see
    // the const's own note for why the fields are not merged.
    directiveVerbGuidance: UPSC_DIRECTIVE_VERBS,
    // MARKS/WORD PAIRINGS RE-MEASURED 2026-08-01 over all 826 real ingested UPSC
    // Mains rows (0 have a null marks or word_limit), because the generated set
    // used two pairings the commission effectively does not set:
    //   GS-I/II/III (200 each): 10/150 x90, 15/250 x90, 12.5/200 x20 (2016 only)
    //   GS-IV (134):  20/250 x58, 20/150 x44  → 20 marks = 76.1% of the paper
    //                 10/150 x21, 30/150 x7, 25/300 x2, 15/250 x2
    //   ESSAY (92):   125/1200 x88, 125/1000 x4  → 1200 words = 95.7%
    // The old text named no word limit for GS-IV at all, so the model invented
    // 15/250 (2 of 134 real rows, 1.5%); and "125 marks / 1200 words" alone was
    // not enough to stop 1000 words leaking in from those 4 real Essay rows. Both
    // are now stated as an explicit closed set with the near-misses named. The
    // brief that commissioned this fix called 15/250 "absent from all 131 real
    // GS-IV PYQs" — it is rare (2 of 134), not absent, so it is ruled out here
    // by frequency rather than by a false claim of non-existence.
    marksNormGuidance:
      "real UPSC Mains norms, and use ONLY a pairing the commission actually sets: a GS-I to GS-III question is " +
      "either 10 marks / 150 words or 15 marks / 250 words, in almost exactly equal measure, and no other pairing " +
      "appears in current papers; a GS-IV Ethics question is 20 marks in about three-quarters of real papers, " +
      "paired with EITHER 250 words or 150 words (a 20-mark GS-IV item is often a case study), and the only other " +
      "common GS-IV pairing is 10 marks / 150 words — never 15 marks / 250 words, which is under 2% of real GS-IV " +
      "questions; an Essay is ALWAYS 125 marks and 1200 words, never 1000",
    toneCriterion:
      "does it read like a real UPSC Civil Services question in difficulty, phrasing, and format — and, for a " +
      "Prelims MCQ, does it use a format UPSC actually sets (a statement-combination set or a direct single-item " +
      "question), never Assertion-Reason?",
    mcqOutputLabel: "UPSC-Prelims MCQs",
    descOutputLabel: "UPSC-Mains descriptive questions",
  },

  // ---------------------------------------------------------------------------
  // AUTHORED 2026-07-31 — mentor.
  //
  // ⚠ CACHE FLOOR. `buildMentorPersona` is the ONLY cached segment on the
  // generic-doubt path and clears claude-sonnet-5's 1024-token minimum by ~22
  // tokens for uppsc, where `platformFraming` + `testingLens` supply 268 chars /
  // 102 tokens. A TERSER second exam silently disables that cache with no error
  // (§6c). These two keys deliberately supply MORE than uppsc's 268 chars — the
  // sanctioned fix is to lengthen the persona, never to lower the floor — and the
  // extra length is genuine UPSC-specific content, not padding.
  //
  // `testingLens` is where the measured Prelims evidence lands for the mentor
  // (same corpus as the qgen block above): the statement-combination norm, the
  // modern counting form, the Statement-I/II pair, and the fact that UPSC sets
  // NO Assertion-Reason — which is the single most useful thing a UPSC mentor
  // can tell an aspirant who has been drilled on A/R by state-exam material. It
  // also names CSAT as a different paper, which UPPSC's lens has no reason to.
  // Both this field and `mainsAnglesLens` carry the SOURCE'S OWN hard wrapping
  // ("\n  " and "\n     " respectively) — those sequences are part of the
  // assembled prompt once `buildMentorPersona`'s array is joined by "\n". Do not
  // reflow them.
  //
  // `mainsAnglesLens` states UPSC's real answer lengths (150/250 words) and its
  // real Mains paper set (GS-I..GS-IV) rather than UPPSC's six-paper structure.
  // ---------------------------------------------------------------------------
  mentor: {
    platformFraming: "a UPSC Civil Services Examination (CSE) prep platform",
    teacherPlatformFraming: "UPSC Civil Services Examination (CSE) prep platform",
    // Spans several joined array lines in buildMentorPersona — the "\n  "
    // sequences are part of the assembled prompt.
    testingLens:
      "Connect explanations to how UPSC actually tests the topic — in Prelims GS-I roughly two-thirds of questions\n" +
      "  are scaffolded 'Consider the following statements' sets, usually three statements, closed either by a\n" +
      "  combination option set or by the newer 'How many of the above statements are correct?' counting form, with\n" +
      "  'Statement-I / Statement-II' pairs used for cause-and-effect; UPSC sets NO Assertion-Reason questions at\n" +
      "  all, so do not drill that format. Flag the commonly confused pairs and the precise wording traps those\n" +
      "  formats exploit. CSAT is a different paper — comprehension, logical reasoning and quantitative aptitude,\n" +
      "  not statement recall. For Mains, say what a 150- or 250-word answer must actually contain and which GS\n" +
      "  paper it belongs to.",
    // Spans two joined array lines in buildTeacherPersona.
    mainsAnglesLens:
      "how UPSC frames this in a 150- or 250-word descriptive answer, which\n" +
      "     GS paper (GS-I to GS-IV) it feeds, and the analytical angle an examiner rewards.",
    revisionAudience: "a UPSC Civil Services (CSE) aspirant",
    researchFraming: "a UPSC Civil Services (CSE) exam topic",
    quizFraming: "UPSC-Prelims-style objective questions",
  },

  // ---------------------------------------------------------------------------
  // AUTHORED 2026-07-31 — current affairs.
  //
  // THE ONE JUDGMENT THAT IS NOT UPPSC'S: the curation bar is NATIONAL. UPPSC's
  // CA lens is built around a state signal (`is_up_specific`, GS5_UP/GS6_UP);
  // UPSC has no state paper at all (see the relevanceLens block above), so
  // `examWorthinessBar` and `mcqRelevanceFilter` both make national/international
  // significance the filter rather than adding a second state test. That is the
  // substantive difference; the rest of this group is naming in the template's
  // own grammatical shape.
  //
  // The Mains slots reuse the measured UPSC verb distribution and mark scheme
  // from the qgen block above (Discuss-led, a third of stems verb-less,
  // 10/150w or 15/250w) — NOT UPPSC's 7/125w and 10/200w. `mainsMarksNorm` is a
  // COMPLETE BULLET SENTENCE with its own period, unlike `qgen.marksNormGuidance`
  // which is a noun phrase; the two templates differ and the values must match
  // their own template, not each other.
  //
  // `deepDivePyqHeader` carries a LEADING "\n" (it is pushed as its own element
  // of `buildContext`'s parts array, and the newline is what produces the blank
  // line before the block).
  //
  // `nodeClassifyFraming` must be SINGULAR — the template's relative clause
  // ("…that its facts most concretely belong to") has to agree with it. UPSC's
  // prelims paper code is UPSC_PRE_GS1; the paper is named in prose, not by code.
  // ---------------------------------------------------------------------------
  ca: {
    strategistFraming: "a UPSC (national civil services) exam strategist",
    enrichAudience: "UPSC Civil Services aspirants",
    examWorthinessBar:
      "would a real UPSC prelims paper — which tests facts of national or international significance — plausibly " +
      "ask this, or is it just colour/context from the news story?",
    mcqStyleFraming: "UPSC-Prelims objective questions",
    mcqExamplesFraming: "the REAL past-year UPSC questions shown below",
    mcqOutputLabel: "UPSC-Prelims MCQs",
    mcqRelevanceFilter:
      "write a question for a fact ONLY if it carries national or international significance AND a real UPSC " +
      "Civil Services prelims paper would plausibly test it",
    mainsSetterFraming: UPSC_MAINS_SETTER,
    // Same const as `qgen.directiveVerbGuidance` above; the host templates still
    // differ ("…not mere recall." vs "…not recall."), which is why these remain
    // two fields rather than one.
    mainsDirectiveVerbGuidance: UPSC_DIRECTIVE_VERBS,
    mainsMarksNorm:
      "Realistic UPSC Mains marks + word limit (a GS-I to GS-III question is either 10 marks / 150 words or 15 " +
      "marks / 250 words; a GS-IV Ethics question is usually 20 marks).",
    deepDiveFraming: "a UPSC Civil Services Mains current-affairs magazine",
    deepDiveIntroFraming: "why this issue matters for UPSC Mains right now",
    deepDivePyqHeader: "\nRELATED PAST UPSC QUESTIONS (for angle, not to answer):",
    nodeClassifyFraming:
      "ONE specific UPSC Civil Services Prelims General Studies Paper I syllabus topic",
    // UPSC Mains has exactly four General Studies papers (GS-I..GS-IV) plus the
    // Essay paper — verified against the same 2026 examination notice the
    // hand-authored syllabus tree was transcribed from (migration 0112 binds
    // UPSC_MAINS_GS1..GS4 + UPSC_MAINS_ESSAY). GS5_UP/GS6_UP are another
    // commission's state papers and MUST be absent: until now the triage schema
    // offered them as legal values here, contradicting
    // `relevanceLens.stateGsPapersNote`, which spends a whole clause fencing the
    // model off them. Qualifying Paper-A/Paper-B and the two optional-subject
    // papers carry no current-affairs life and have no value in this enum.
    gsPapers: ["GS1", "GS2", "GS3", "GS4", "ESSAY"],
  },

  // ---------------------------------------------------------------------------
  // AUTHORED 2026-07-31 — study notes + study chapters.
  //
  // THE ONE JUDGMENT THAT IS NOT UPPSC'S: there is no state angle, anywhere.
  // UPPSC's notes group is built around a UP lens (`stateAngleDirective`,
  // `stateAngleLabel: "UP ANGLE"`, and the "especially Uttar-Pradesh-specific
  // schemes" clause in both research slots). UPSC is a NATIONAL examination:
  // there is no state-focused node anywhere in its hand-authored 195-node tree,
  // and its Prelims line P1-L01 is literally "Current events of national and
  // INTERNATIONAL importance." Renaming UPPSC's UP clauses would instruct the
  // author to hunt for a state angle this exam never tests, in the one block
  // whose whole job is to be exam-specific. So the four affected slots are
  // RE-DERIVED to the national/comparative dimension UPSC actually tests, and
  // `stateAngleLabel` names that dimension rather than a state.
  //
  // ⚠ `up_angle` IS A PERSISTED IDENTIFIER IN FIVE PLACES AT ONCE — a field of
  // `noteBodySchema`/`NoteContentI18n`, a value of the add-to-revision block
  // enum (it crosses the API boundary), a property of `NOTE_GEN_SCHEMA` AND a
  // member of its `required` list, a key inside every stored
  // `notes.content_i18n` jsonb (migration 0038), and text that `notes/embed.ts`
  // flattens into the RAG chunk. NEVER rename it. Because the schema marks it
  // REQUIRED, an empty string is not an option either — the slot must carry a
  // non-empty directive, which is exactly why it is redirected rather than
  // blanked. This mirrors the precedent set one group up by
  // `relevanceLens.curationDirective`, which faced the identical
  // live-column-with-no-national-analogue constraint (`is_up_specific`) and
  // solved it by giving the field its only defensible national meaning instead
  // of mirroring UPPSC.
  //
  // WHAT IS STRUCTURAL NAMING (same category as `misc.translateQuestionsDomainHint`,
  // authored for U5): the six persona slots, the two research-topic openers, and
  // `groundingStoreLabel`. Each is a noun phrase naming THIS commission in a
  // slot whose grammar belongs to the template. `groundingStoreLabel` is
  // deliberately byte-identical to `evaluation.groundingStoreLabel` and
  // `qgen.groundingStoreLabel` — one corpus, so the examiner, the question
  // setter and the note author all name the store identically.
  //
  // MEASURED, from the 2,791 real UPSC PYQs ingested by U5, and used by
  // `outlineCompletenessLens` / `pyqAnalysisFraming`: a UPSC chapter has to serve
  // TWO structurally different stages, which is why both slots name both.
  // Prelims GS-I is a fact base tested through scaffolded statement sets (65.8%
  // of stems are scaffolded; the statement-combination family alone is 55.3%),
  // while Mains is analytical prose at 10 marks / 150 words or 15 marks / 250
  // words in near-equal measure (~45% each). Naming only "what the commission
  // has asked", as uppsc's lens does, loses that split.
  //
  // CACHE (§6b/§6c): `facultyFraming` sits in cached segment `[0]` of BOTH
  // `buildNoteGenParams` and `buildSectionParams`, and `groundingStoreLabel` in
  // `[1]` — in each the cached prefix is `[0]+[1]`, so per-exam text PARTITIONS
  // the cache (one entry per exam) and destroys nothing. `buildSectionParams` is
  // the only live cache among these (~10,656 tokens measured on a real run, ~10x
  // sonnet-5's 1024 minimum), so there is no floor to clear. `buildNoteGenParams`
  // measures 817 tokens with an empty context — already below 1024 for uppsc
  // too, pre-existing and not exam-specific — so these four `[0]` slots are kept
  // at or above uppsc's combined 219 chars rather than shortened. And
  // `buildNoteCriticParams` (206 tokens) is a MEASURED NO-OP (M25): authoring
  // `criticFraming` cannot change its caching either way, and no caching benefit
  // is claimed for it.
  // ---------------------------------------------------------------------------
  notes: {
    facultyFraming: "an expert UPSC Civil Services faculty member",
    outlineFacultyFraming: "a senior UPSC (Civil Services Examination) faculty member",
    researcherFraming: "a UPSC (Civil Services Examination) subject researcher",
    chapterResearcherFraming: "a UPSC Civil Services subject researcher",
    auditorFraming: "a strict UPSC Civil Services fact-checker auditing a study chapter",
    factEscalateFraming: "ONE decisive fact from a UPSC Civil Services study chapter",
    // A COMPLETE IMPERATIVE SENTENCE ending in its colon (the newline and the
    // quoted claim are structural). NOT interchangeable with
    // `factEscalateFraming` above, which is the noun phrase the SYSTEM prompt
    // embeds — neither is derivable from the other, which is why both exist.
    factEscalateUserFraming: "Verify this decisive fact from a UPSC Civil Services study chapter:",
    criticFraming: "a strict UPSC Civil Services content reviewer",
    // Names BOTH stages deliberately — see the MEASURED note above. No trailing
    // period: the template continues "… and what a topper must know — never
    // padding".
    //
    // ⚑ THE SHAPE OF THIS VALUE IS LOAD-BEARING, and two earlier shapes were
    // both wrong AT THE BOUNDARY — invisible in the raw string, visible only in
    // the assembled prompt (`notes/buildOutlineParams:upsc`):
    //   1. An em-dash gloss opened a clause the template never closes, so "and
    //      what a topper must know" read as part of the gloss.
    //   2. Replacing it with a COLON gloss was ALSO wrong, and its own comment
    //      claimed otherwise ("the colon closes at the parenthesis") — a colon
    //      has no closing bracket. The template already opens on a colon ("The
    //      EXAM defines completeness:"), so that nested a second colon inside
    //      the first; the gloss's internal "A, and B" list then captured the
    //      template's own trailing "and what a topper must know" as a third list
    //      item; and "(use the weightage + PYQ patterns)" — which modifies the
    //      WHOLE clause for uppsc — ended up scoped to the Mains item alone.
    // The fix keeps both stages but expresses them as two PARALLEL "in …"
    // phrases, so the template's trailing "and what …" (not an "in" phrase)
    // cannot be read into the list, and the parenthetical again trails the whole
    // clause exactly as it does for uppsc. Re-read the assembled snapshot, not
    // this string, before changing it again.
    outlineCompletenessLens:
      "what UPSC has actually asked at both stages, in Prelims statement sets and in GS Mains answers " +
      "(use the weightage + PYQ patterns)",
    // ⚠ The block key `up_angle` is PERSISTED and must never be renamed; only
    // this description is configurable. UPSC has no state lens, so the directive
    // fences the author OFF a state angle and names the national/comparative
    // dimension instead. The template supplies the trailing period.
    stateAngleDirective:
      "UPSC is a NATIONAL examination with no state-specific paper and no state-focused syllabus topic, so never " +
      "write a state angle here; instead give the national and comparative dimension the exam actually tests — " +
      "Union policy and its handling in Parliament, centre-state and federal implications, Economic Survey / NITI " +
      "Aayog / ministry data, India's standing on the relevant global index, and any cross-country comparison an " +
      "examiner would reward",
    // The rendering label for that SAME persisted `up_angle` block — never the
    // key. Stored WITHOUT its colon, which is structural (it matches the sibling
    // "OVERVIEW:", "KEY FACTS:", "PYQ ANALYSIS:" labels). It names the dimension
    // the directive above redirects to, not a state.
    stateAngleLabel: "NATIONAL AND COMPARATIVE ANGLE",
    authorRelevanceFraming:
      "orienting the aspirant to the topic and why it matters across both UPSC Prelims and UPSC Mains",
    // No internal em dash: the host already appends "(use the PYQ + weightage
    // data provided) and what to focus on.", and reading the assembled prompt
    // showed a dash here opened a clause the template never closes.
    pyqAnalysisFraming:
      "how UPSC has actually asked this topic in Prelims statement sets and in 150- or 250-word Mains answers",
    // Byte-identical to `chapterResearchTopicFraming` below TODAY. Written twice
    // rather than hoisted to a shared const because this pass is scoped to edit
    // only inside the UPSC block — exactly the situation M34 recorded for
    // UPSC_DIRECTIVE_VERBS / UPSC_MAINS_SETTER, which were likewise authored as
    // duplicated literals by a block-scoped pass and hoisted afterwards. Hoist
    // these two the same way if a later pass has the file open; the FIELDS must
    // stay separate either way (separate call sites, separate structural tails —
    // " topic:" vs " topic and its sub-topics:").
    researchTopicFraming: "Research current, exam-relevant facts for this UPSC Civil Services",
    chapterResearchTopicFraming: "Research current, exam-relevant facts for this UPSC Civil Services",
    // National, not state. No trailing period — the template continues
    // ". Prefer official government and reputable sources."
    researchStateFocus:
      "especially Union government schemes and flagship missions, the latest official data and figures (Economic " +
      "Survey, ministry and NITI Aayog releases), India's position on the major global indices, and anything that " +
      "has changed recently",
    // The chapter variant additionally names Budget numbers, mirroring the extra
    // clause uppsc's chapter slot carries over its note slot.
    chapterResearchStateFocus:
      "especially Union government schemes and flagship missions, the latest official data and figures (Economic " +
      "Survey, ministry and NITI Aayog releases), Union Budget numbers, India's position on the major global " +
      "indices, and anything changed recently",
    // Both carry their OWN period — the template appends " Cite …" after them.
    researchPriorityDirective:
      "Prioritise Union government schemes, the latest official figures, India's standing on the major global " +
      "indices, and recent developments.",
    chapterResearchPriorityDirective:
      "Prioritise Union government schemes, the latest official figures, Union Budget data, India's standing on " +
      "the major global indices, and recent developments.",
    // NO leading article — it must read both after "REFERENCE PASSAGES (from the "
    // (notes) and directly after "(" (chapters). Identical to the evaluation and
    // qgen labels for the same corpus, on purpose.
    groundingStoreLabel: "official UPSC syllabus/PYQ store",
  },

  // ---------------------------------------------------------------------------
  // AUTHORED 2026-07-31 — everything else that names the exam in a prompt.
  //
  // ALL SEVENTEEN VALUES BELOW ARE STRUCTURAL NAMING, not judgment: each is a
  // noun phrase (or a bilingual label) naming THIS commission in a slot whose
  // grammar, and whose substantive instruction, belong entirely to the template.
  // Nothing here encodes how UPSC marks, what it asks, or what to curate — that
  // judgment lives in `evaluation`, `qgen`, `mentor`, `ca` and `notes`, and was
  // researched there. Two consequences worth stating, because they are what make
  // this pass legitimate rather than a find-and-replace:
  //
  //  * The long parentheticals kept verbatim from uppsc
  //    (`personalNotesTranslateDomainHint`, `chapterTranslateDomainHint`) are
  //    TRANSLATION-QUALITY instructions — "write natural, fully-idiomatic text,
  //    no leftover source-language words for ordinary terms" — with no exam
  //    content at all. Their 'Preamble'/'flowchart' examples are generic
  //    study-material vocabulary, not UP-specific. Keeping that shape is correct;
  //    only the corpus name changes. This matters more for UPSC than for UPPSC,
  //    not less: the U5-ingested UPSC corpus is 100% bilingual with 0
  //    machine-translated rows, so Hindi output is held to exam register.
  //  * MEASURED and used below: UPSC sets MCQs in Prelims ONLY (GS-I and CSAT);
  //    all 811 ingested Mains rows are descriptive. So the three MCQ-facing
  //    slots (`explanationFraming`, `streamExplanationFraming`,
  //    `ingestKeySupportFraming`) say "Prelims" where uppsc's say only "exam" —
  //    more precise, and true of this exam's corpus by construction.
  //
  // DEVANAGARI: the four `I18nLabel`s are rendered to a learner, so both sides
  // must be real exam register rather than transliteration. UPSC is यूपीएससी;
  // प्रारंभिक / मुख्य are the standard Hindi names for the Prelims / Mains
  // stages and are reused from uppsc's labels because they name the STAGE, not
  // the commission.
  //
  // CACHE (§6c): `ocrFraming` feeds `buildTranscribeSystem`, a MEASURED NO-OP
  // (270/280 tokens vs sonnet-5's 1024 — M25). Authoring it cannot change
  // caching either way and no caching benefit is claimed for it.
  //
  // NOT YET REACHABLE, authored anyway and honestly flagged: `services/mocks.ts`
  // reads `prelimsMockTitlePrefix`/`mainsMockTitlePrefix` through a
  // module-level `MOCK_TITLE_EXAM` pinned to `DEFAULT_EXAM_CODE`, because mocks
  // are titled AND marked to one commission's pattern and a second exam needs
  // its own verified builder, not a threaded parameter. These two values are
  // therefore correct-but-dormant until that builder exists — they are labels,
  // so authoring them early costs nothing and removes a trip hazard.
  // ---------------------------------------------------------------------------
  misc: {
    moderationFraming: "a UPSC Civil Services exam-prep community",
    ocrFraming: "a handwritten UPSC Civil Services Mains exam answer",
    drillExaminerFraming: "an examiner scoring UPSC (Civil Services Examination) Mains answer-writing practice",
    // MCQ-facing, so "Prelims": every UPSC MCQ is a Prelims question (GS-I or
    // CSAT) — all 811 ingested Mains rows are descriptive. Reads correctly in
    // BOTH hosts (`services/question-explanation.ts` and `ingest/prompts.ts`),
    // which share this one fragment.
    explanationFraming: "UPSC Civil Services Prelims MCQ answer explanations",
    // A DIFFERENT grammatical form — the object of "You explain … for exam
    // aspirants." Not derivable from `explanationFraming` above.
    streamExplanationFraming: "UPSC (Civil Services Examination) Prelims MCQ answers",
    explanationTranslateDomainHint: "UPSC Civil Services MCQ explanation",
    studyPlanCoachFraming: "an expert UPSC (Civil Services Examination) exam-prep coach",
    // A display-name fallback rendered mid-sentence, so it stays short.
    studyPlanAspirantFallback: "a UPSC Civil Services aspirant",
    personalNotesAudience: "a UPSC Civil Services aspirant",
    // The parenthetical is a TRANSLATION-QUALITY instruction with no exam
    // content; kept in uppsc's shape deliberately. Direction-agnostic ("the
    // target language") — a user's own note may be in either locale.
    personalNotesTranslateDomainHint:
      "UPSC Civil Services study note (write natural, fully-idiomatic text in the target language — no leftover " +
      "source-language words for ordinary terms; keep only genuine loanwords/acronyms readers actually use as-is)",
    // Distinct from the hint above: this one is hard-wired to HINDI output,
    // because `chapter-generate.ts` step 6 translates a chapter EN→HI.
    chapterTranslateDomainHint:
      "UPSC Civil Services study material (write natural, fully-Hindi text — no leftover English words for " +
      "ordinary terms like 'Preamble' or 'flowchart'; keep only genuine loanwords/acronyms Hindi speakers " +
      "actually use as-is)",
    // ⚑ DELIBERATELY LEFT UNAUTHORED — not an omission, and not a slot waiting
    // to be filled by a future bulk pass.
    //
    // Its SOLE consumer repo-wide is `ingest/syllabus.ts`'s `fillBilingual`
    // (verified by grep: that one call site, plus a doc mention in
    // `lib/anthropic.ts`'s header). `fillBilingual` is reachable only from the
    // LLM syllabus-structuring pipeline — the one path that must NEVER run for
    // upsc, for the two independently fatal reasons spelled out at
    // `syllabusExpertFraming`/`syllabusStructureNote` below. Authoring this
    // would produce a string nothing can emit, while quietly implying that
    // pipeline is open to this exam. `translate()` itself is unaffected: its
    // `domainHint` is a REQUIRED parameter (the "UPPSC exam-prep content"
    // default was removed in slice 2d), so every other caller names its own
    // hint explicitly and none of them reads this slot.
    translateDomainHint: UNAUTHORED,
    translatePlatformFraming: "a UPSC Civil Services exam platform",
    // AUTHORED 2026-07-30 for the U5 PYQ ingest (rationale in the block below).
    // Structural naming of WHAT is being translated, in the same grammatical
    // slot as uppsc's — not a judgment slot.
    translateQuestionsDomainHint: "UPSC Civil Services exam questions",
    ingestKeySupportFraming: "a UPSC Civil Services Prelims MCQ",

    // -----------------------------------------------------------------------
    // AUTHORED 2026-07-30 — the slots the U5 PYQ-ingest path actually needs
    // (`ingest:pyq`'s booklet-series detection + syllabus classification +
    // bilingual fill, and `ingest:resolve`'s blind solve/escalate). Every other
    // slot in this group stays deliberately UNAUTHORED (U6): authoring is
    // per-slot as a pipeline genuinely needs it, NEVER a bulk find-and-replace
    // of "UPPSC" (§6a).
    //
    // OBSERVED, not adapted — from direct inspection of the real booklet covers
    // now in content-raw/pyq_prelims (2024 GS-I and 2020 CSAT rendered to PNG
    // and read):
    //   * UPSC prints the booklet series as a LARGE STANDALONE LETTER (A/B/C/D)
    //     in a ruled box on the cover, beside "परीक्षण पुस्तिका अनुक्रम" /
    //     "Test Booklet Series". That is genuinely easier to read than UPPSC's,
    //     which frequently prints no plain letter at all.
    //   * It ALSO prints a separate T.B.C. paper code (2024 GS-I `KSPC-P-GSPO`;
    //     2020 CSAT `HGY-D-LKUV`). **That code is NOT the series, and its own
    //     letters actively mislead**: `HGY-D-LKUV` contains a lone "D" on a
    //     booklet whose series box reads "A". A detector that simply greps for
    //     a stray capital would get that paper exactly wrong, so the note names
    //     the trap rather than leaving the model to fall into it.
    // -----------------------------------------------------------------------
    seriesPaperFraming: "a UPSC Civil Services examination question paper or its official answer key",
    seriesBookletCodeNote:
      "a UPSC test booklet normally prints its series as a single large letter (A, B, C or D) in a ruled box on the " +
      "cover next to the words 'Test Booklet Series', and SEPARATELY prints a T.B.C. paper code such as " +
      "'KSPC-P-GSPO' or 'HGY-D-LKUV' which is NOT the series and whose own letters must be ignored (a booklet " +
      "coded 'HGY-D-LKUV' can still be Series A)",
    // ⚑ DELIBERATELY LEFT UNAUTHORED — this pair is a LIVE SAFETY GUARD, not a
    // gap. Do not fill them as part of a bulk authoring pass.
    //
    // They are the only two config reads in `buildStructurePaperSystem`
    // (`ingest/prompts.ts`), which `ingest:syllabus` calls to LLM-STRUCTURE a
    // syllabus tree. That pipeline must never run for upsc, for two
    // independently fatal reasons — both verified, neither cosmetic:
    //
    //  1. OVERWRITE IN PLACE. `ingest/syllabus.ts`'s `upsertNode` conflicts on
    //     `(paper_code, path)` — the IDENTICAL key the hand-authored seed
    //     (`ingest/seed/upsc-syllabus-seed.ts`) writes under. An LLM-invented
    //     tree would therefore overwrite the coverage-gated 195-node UPSC tree
    //     in place: `title_i18n`/`description_i18n`/`meta` replaced wholesale,
    //     `meta.source` flipped off `official_syllabus_hand_authored`, and paths
    //     inserted that `verify-coverage.ts`'s 13 defect kinds never approved.
    //  2. WRONG SOURCE TEXT. `loadLangSource` hardcodes UPPSC's manifest ids
    //     (`uppsc_syllabus_2026_${lang}`, `uppsc_syllabus_drishti_${lang}`) and
    //     has no code path to select `upsc_syllabus_*`, so a successfully
    //     authored run would structure UPSC's tree FROM UPPSC's syllabus PDF.
    //
    // UPSC's real path is `pnpm ingest:upsc-syllabus` — hand-authored, zero-LLM,
    // coverage-gated.
    //
    // ⚠ THIS GUARD IS NOW THE SECOND LAYER, NOT THE FIRST. `ingest/syllabus.ts`
    // gained an explicit `LLM_STRUCTURABLE_SYLLABUS_EXAMS = ["uppsc"]` allow-list
    // whose `resolveExamScope` throws in `main()` before any module here is
    // consulted — verified live: `pnpm ingest:syllabus --exam upsc --dry-run`
    // dies at `syllabus.ts:104` with that allow-list's message, never reaching
    // `buildStructurePaperSystem`. The redundancy is deliberate and runs BOTH
    // ways: that file's comment says the local gate exists because this one
    // could be filled by a well-meaning bulk pass, and this comment exists
    // because an allow-list is one line someone could widen. Removing either
    // alone still leaves a guard; do not remove both, and do not treat the
    // allow-list's existence as a reason to author these two.
    syllabusExpertFraming: UNAUTHORED,
    syllabusStructureNote: UNAUTHORED,
    pyqNodeClassifyFraming: "each UPSC Civil Services question",
    auditSolverFraming: "a top UPSC Civil Services aspirant taking the exam",
    auditEscalateFraming: "a meticulous fact-checker auditing a UPSC Civil Services exam question",

    // Stored WITHOUT the trailing space, which is structural:
    // `${prefix.en} ${paper.title.en} — ${year}`.
    pyqTestTitlePrefix: { en: "UPSC", hi: "यूपीएससी" },
    // Dormant until `services/mocks.ts` grows a UPSC builder — see the block
    // comment above. प्रारंभिक / मुख्य name the STAGE, not the commission, so
    // they are the same words uppsc's labels use.
    prelimsMockTitlePrefix: { en: "UPSC Prelims", hi: "यूपीएससी प्रारंभिक" },
    mainsMockTitlePrefix: { en: "UPSC Mains", hi: "यूपीएससी मुख्य" },
    // One FUSED rendered line in a share PNG (satori), so the whole line is
    // configured rather than assembled from a product constant plus an exam
    // name. "Neev"/"नींव" is the product and is exam-independent.
    shareCardBrand: { en: "Neev · UPSC prep", hi: "नींव · यूपीएससी तैयारी" },
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
    // UNAUTHORED, not `null`: `null` is the authored decision "this exam needs no
    // separate aptitude norm", and nobody has looked at MPPSC's papers at all.
    // (`papers.prelimsCsat` is also null here, so this slot is unreachable today
    // — `formatGuidance` above throws first either way.)
    csat: UNAUTHORED,
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
    // UNAUTHORED, consistent with every other slot in this group. MPPSC Mains
    // has GS-I..GS-IV plus two Hindi papers (V: Hindi; VI: Hindi essay and
    // drafting), and whether Paper VI maps onto this enum's `ESSAY` value is a
    // real editorial call about a paper written under a different mark scheme —
    // exactly the kind of judgment U6 forbids deriving by substitution. Nothing
    // reaches it today: `triageParams` throws on `relevanceLens.stateGsPapersNote`
    // and every other slot here long before the schema is built, and the
    // magazine's reads are exam-scoped so an exam with zero current affairs
    // returns before the enum is consulted.
    gsPapers: UNAUTHORED,
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
    ingestKeySupportFraming: UNAUTHORED,

    seriesPaperFraming: UNAUTHORED,
    seriesBookletCodeNote: UNAUTHORED,
    syllabusExpertFraming: UNAUTHORED,
    syllabusStructureNote: UNAUTHORED,
    pyqNodeClassifyFraming: UNAUTHORED,
    auditSolverFraming: UNAUTHORED,
    auditEscalateFraming: UNAUTHORED,

    pyqTestTitlePrefix: UNAUTHORED,
    prelimsMockTitlePrefix: UNAUTHORED,
    mainsMockTitlePrefix: UNAUTHORED,
    shareCardBrand: UNAUTHORED,
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
 * `assertExamConfigMatchesRegistry()`, not through a 500 — and that second
 * signal is real: it runs at every boot via `checkExamConfigRegistryAtBoot()`
 * from `index.ts`'s `app.listen`. (Until 2026-07-30 it had no callers at all,
 * so this sentence promised a backstop that never ran; the only live signal was
 * the `logger.warn` below.)
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

/**
 * This exam's Mains papers in the `CurrentAffairsGsPaper` taxonomy — the ONE
 * place the triage schema's enum, `normalizeTriage`'s filter and the Mains
 * magazine's section order are decided.
 *
 * Throws (via `requireAuthored`) for an exam whose CA config is unwritten,
 * rather than falling back to UPPSC's seven — a fallback here would silently
 * re-offer `GS5_UP`/`GS6_UP` to a commission that has no state paper, which is
 * the exact defect this accessor was added to remove.
 */
export function gsPapersFor(examCode: string): readonly CurrentAffairsGsPaper[] {
  return requireAuthored(getExamConfig(examCode).ca.gsPapers, examCode, "ca.gsPapers");
}

/**
 * The state an exam's current-affairs curation is scoped to, or `null` when the
 * exam is nationally scoped.
 *
 * THE POINT OF THE null: it is the gate on every state-shaped CA surface — the
 * magazine's lead section, `magazine-curation.ts`'s `UP_BOOST`, and the feed's
 * `lens=up` tab. Each of those keyed off the flat `is_up_specific` boolean
 * alone, so a nationally-scoped exam would have rendered a state section and
 * applied a state ranking boost the moment a single row carried a stray `true`.
 * Gating on the LENS instead makes those surfaces impossible for a national
 * exam regardless of what that column says — which is what makes deferring the
 * `is_up_specific` → `state_focus` migration (M20) safe rather than merely
 * postponed.
 *
 * Returns only STRUCTURAL facts (`state.code` / names), never an `Authored`
 * slot, so it is total across all three exams and safe on a read path — mppsc's
 * lens prose is UNAUTHORED but its state block is stated as fact.
 */
export function stateLensFor(examCode: string): ExamStateLens | null {
  const lens = getExamConfig(examCode).relevanceLens;
  if (lens.kind !== "state_specific") return null;
  return { code: lens.state.code, name_i18n: { en: lens.state.nameEn, hi: lens.state.nameHi } };
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
 * WIRED INTO BOOT (2026-07-30) via `checkExamConfigRegistryAtBoot()` below,
 * called from `index.ts`'s `app.listen` alongside `checkMentorCacheHealthAtBoot`.
 * It previously had ZERO callers repo-wide, which made `getExamConfig`'s
 * docstring promise of a backstop untrue — the only live signal was a
 * `logger.warn`. Call this function directly (not the wrapper) from a CI/ops
 * script that wants the report or `{ throwOnDrift: true }`.
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

/**
 * Boot probe — the wiring that makes `assertExamConfigMatchesRegistry()` an
 * actual backstop rather than dead code. Mirrors
 * `services/mentor/cache-health.ts`'s `checkMentorCacheHealthAtBoot`: log at
 * ERROR so an operator sees drift, and NEVER throw.
 *
 * CANNOT CRASH BOOT, by three separate guards:
 *   1. `throwOnDrift` is left at its default `false`, so real drift logs and
 *      returns rather than throwing.
 *   2. the try/catch below swallows the paths `assertExamConfigMatchesRegistry`
 *      cannot report as drift — `supabase()` throwing on missing env, and the
 *      network call rejecting rather than returning `{ error }`.
 *   3. it returns `Promise<void>` and is `void`-called, so nothing awaits it and
 *      a slow/unreachable DB delays no request.
 *
 * A transient DB blip must never crash-loop the API over a config check.
 */
export async function checkExamConfigRegistryAtBoot(): Promise<void> {
  try {
    const report = await assertExamConfigMatchesRegistry();
    if (report.ok) {
      logger.info("exam-config: matches the exams registry");
    }
    // The drift case already logged at ERROR inside the assert; don't double-log.
  } catch (err) {
    logger.error(
      { err },
      "exam-config: registry check could not run (DB unreachable or unconfigured) — " +
        "config/registry drift is UNVERIFIED this boot. Not fatal; the API continues.",
    );
  }
}
