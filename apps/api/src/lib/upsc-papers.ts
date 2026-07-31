/**
 * UPSC Civil Services paper-code constants — the UPSC sibling of
 * `lib/exam-papers.ts` (which is UPPSC's own constants module).
 *
 * WHY THIS FILE EXISTS (docs/OUTSTANDING.md §8f M31): `services/evaluation/
 * rubric.ts` held UPSC paper codes as local `const`s, because `lib/exam-papers.ts`
 * is UPPSC's own constants module and had no UPSC sibling. This module is that
 * sibling — the home a NON-INGEST consumer imports from instead of re-typing a
 * literal.
 *
 * ⚑ ORDER OF AUTHORITY — and this file is NOT the top of it. Stated plainly
 * because an earlier draft of this header claimed to be "the one TypeScript home",
 * which is not true and read as a contradiction of a file that says the same
 * thing about itself (M38):
 *
 *   1. `apps/api/src/ingest/seed/upsc-syllabus-tree.ts` — the hand-authored,
 *      coverage-gated syllabus seed, and migration `0112`, which binds the codes
 *      to `exams.upsc.paper_structure` (matched on the commission's own
 *      `official_label`, never array index — UPSC's Main labels are offset from
 *      the GS numbering, so Paper-II *is* GS-I). These two are the authority.
 *   2. `apps/api/src/ingest/_shared.ts`'s `PAPERS` — all 7 codes again, as
 *      `PaperDef` literals carrying stage + bilingual titles the ingest pipeline
 *      needs. `ingest/seed/upsc-syllabus-seed.ts` reads its paper list from
 *      THERE and calls it the single source of truth, so within the ingest
 *      pipeline it is. Deliberately not refactored: `PaperDef` is a richer record
 *      than a code, and re-pointing it is ingest-pipeline surgery for no
 *      correctness gain.
 *   3. This module — paper CODES only, for consumers outside the ingest pipeline.
 *
 * The three agree byte-for-byte today (verified). If they ever disagree, (1)
 * wins and this file is wrong; `assertExamConfigMatchesRegistry()` is the
 * boot-time guard that catches it, because `EXAM_CONFIGS.upsc.papers` is built
 * from these constants and is checked against the DB registry.
 *
 * ⚑ PAPER CODES ONLY — no marks, no durations, no qualifying minimums. Those
 * live in `exams.paper_structure` and stay DB-authoritative (verified against
 * the commission's notification PDF); `docs/multi-exam.md` §6a records the
 * "do not copy the registry into TypeScript" rule and why. Note that
 * `lib/exam-papers.ts` DOES carry UPSC Prelims per-question marking — that is
 * deliberate and is not `paper_structure` data: UPSC notifies a paper's marks
 * and duration but has never notified its question count, so the per-question
 * figure was read off the real booklet covers. It stays in the one table that
 * `ingest:pyq:load` / `ingest:tests` already read.
 *
 * ⚑ THE §0 INVARIANT: paper codes are GLOBALLY UNIQUE across exams, which is
 * what lets ~30 call sites filter on `paper_code` alone. Every code here is
 * therefore exam-prefixed (`UPSC_`), never a bare `PRE_GS1`.
 *
 * SCOPE — what UPSC deliberately has NO code for:
 *   * Paper-A / Paper-B (the qualifying Indian-language and English papers) and
 *     Paper-VI / Paper-VII (the candidate's chosen optional, ~25 subjects × 2
 *     papers) are out of the launch scope and are deliberately code-less in
 *     `0112`, so they are absent here too.
 *   * There is NO General Hindi paper. UPPSC has one (`MAINS_GH`); UPSC does
 *     not. That is a genuine structural absence, not an un-ingested paper.
 */
import type { TargetExamCode } from "@neev/shared";

/** This exam's registry key — the value `getExamConfig()` / `RUBRICS[*].examCode` use. */
export const UPSC_EXAM_CODE = "upsc" as const satisfies TargetExamCode;

/** The Essay Mains paper (two ~1200-word essays, 125 marks each). Scores under `upsc-essay-v1`. */
export const UPSC_ESSAY_PAPER_CODE = "UPSC_MAINS_ESSAY";

/** Prelims paper codes. */
export const UPSC_PRELIMS_GS1_PAPER_CODE = "UPSC_PRE_GS1";
export const UPSC_PRELIMS_CSAT_PAPER_CODE = "UPSC_PRE_CSAT";

/**
 * The four General Studies Mains papers. UPSC has four (GS-I..IV) where UPPSC
 * has six — the two extra UPPSC papers are its UP-specific GS-V/VI, which have
 * no UPSC counterpart.
 */
export const UPSC_MAINS_GS_PAPER_CODES = [
  "UPSC_MAINS_GS1",
  "UPSC_MAINS_GS2",
  "UPSC_MAINS_GS3",
  "UPSC_MAINS_GS4",
] as const;

/**
 * GS Paper IV (Ethics, Integrity and Aptitude) — named separately because it is
 * the ONE paper UPSC's own notification describes as testing "attitude and
 * approach" rather than a topic list, and so selects its own rubric
 * (`upsc-ethics-v1`) rather than the GS default. Same code as
 * `UPSC_MAINS_GS_PAPER_CODES[3]`; both names are intentional.
 */
export const UPSC_ETHICS_PAPER_CODE = "UPSC_MAINS_GS4";
