/**
 * M20b — resolving a SHARED current-affairs row's curation against ONE reader's
 * exam. The PURE half, so every rule below is unit-assertable without a
 * database, an LLM call, or a clock.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BEING RESOLVED, AND WHY IT NEEDS RESOLVING AT ALL
 * ---------------------------------------------------------------------------
 * `current_affairs_items` is deliberately ONE row across several `exam_codes`
 * (0106 §11). Two of its columns are nevertheless a single exam's VERDICT:
 *
 *   gs_papers      — which Mains GS papers the item feeds
 *   is_up_specific — whether it is state-focused
 *
 * `mergeExamTriages` folds N per-exam verdicts onto that one row by UNION and
 * OR. Lossless at N=1, lossy at N>1 — and wrongly so, because `GS1..GS4`/
 * `ESSAY` is a SHARED NAMESPACE across commissions whose syllabi differ
 * (UPPSC sets six Mains GS papers, UPSC four; UPPSC GS2 carries UP-specific
 * governance, UPSC GS1 carries World History). A UNION therefore reads as
 * "UPPSC says GS2" ⇒ "render under UPSC's GS2", which is a different paper.
 *
 * 0116 adds the two per-exam columns this module reads. Nothing else may read
 * `gs_papers` / `is_up_specific` on a curation path — go through here.
 *
 * ---------------------------------------------------------------------------
 * ⚑ THE LEGACY-ATTRIBUTION RULE, AND WHY IT IS `DEFAULT_EXAM_CODE`
 * ---------------------------------------------------------------------------
 * A row written before 0116 has NULL in both new columns. Its legacy value is
 * still a real verdict — it just belongs to whichever exam produced it — so the
 * fallback attributes it to `DEFAULT_EXAM_CODE` and to no one else. Every other
 * exam reads an empty placement / no state focus, which is precisely the
 * inheritance this closes: a widened row does not appear in a second exam's
 * Mains sections until that exam's own triage has run, which is an honest
 * absence rather than a wrong placement.
 *
 * Two things justify pinning the fallback to the default exam specifically,
 * rather than to the row's own framing exam (`exam_codes[0]`):
 *
 *  1. MEASURED: all 4,459 rows in the corpus (2026-08-08) carry
 *     `exam_codes = {uppsc}` = {DEFAULT_EXAM_CODE} and 0 rows carry more than
 *     one code, so the two rules agree on every row that exists — and the
 *     fallback can only ever fire on a pre-0116 row, because `withExamScope`
 *     makes omitting the new columns a compile error for every write path.
 *  2. SQL-EXPRESSIBLE: `services/current-affairs.ts` must apply the same rule
 *     as a PostgREST filter for the `lens=up` tab, where pagination forbids a
 *     post-hoc JS filter. "state_focus contains my code, OR (state_focus is
 *     null AND is_up_specific)" is expressible; "…AND exam_codes[1] = my code"
 *     is not. A rule the read path can only half-enforce is worse than a
 *     stricter rule both paths enforce identically.
 *
 * The rule is deliberately STRICTER than necessary in one direction: it never
 * over-attributes. Over-attribution is the entire defect; under-attribution
 * costs at most a re-triage.
 *
 * ---------------------------------------------------------------------------
 * ⚑ AN ARCHIVED ROW'S `exam_codes` AND ITS MAP CAN LEGITIMATELY DISAGREE
 * ---------------------------------------------------------------------------
 * Do not re-flag this: measured 2026-08-08, 10 rows carry `exam_codes {uppsc}`
 * while `gs_papers_by_exam` names only `upsc`. That is `mergeExamTriages`'
 * documented archive path, not a defect — when NO exam clears the gate there is
 * no relevant exam to stamp, so `itemExamCodes` falls back down its ladder to
 * `DEFAULT_EXAM_CODE` as a placeholder, while the map faithfully records which
 * exam actually triaged the item. **All 10 are `status='archived'`, and every
 * read on every surface filters `status='published'`, so none is reachable.**
 * Verified anyway: they resolve to `[]` and `false` for every exam, so even if
 * one were published it could not inherit. The invariant worth asserting is the
 * one that holds — every PUBLISHED row has a map entry for each of its
 * `exam_codes` (42/42 at the time of writing).
 */
import { DEFAULT_EXAM_CODE, type CurrentAffairsGsPaper } from "@neev/shared";
import { stateLensFor } from "../lib/exam-config.js";

/**
 * The columns any curation read needs. Every consumer selects these five, so a
 * partial select is a type error rather than a silently reader-blind ranking.
 */
export interface CaCurationScopeRow {
  /** Per-exam Mains placement (0116). NULL ⇒ pre-0116 row, use the legacy fallback. */
  gs_papers_by_exam: Record<string, CurrentAffairsGsPaper[]> | null;
  /** Legacy cross-exam UNION. Only ever attributed to `DEFAULT_EXAM_CODE`. */
  gs_papers: CurrentAffairsGsPaper[] | null;
  /** Per-exam state focus (0116), as state codes. NULL ⇒ pre-0116 row. */
  state_focus: string[] | null;
  /** Legacy cross-exam OR. Only ever attributed to `DEFAULT_EXAM_CODE`. */
  is_up_specific: boolean;
}

/** The five columns above, as a PostgREST select fragment. One definition, so no read can drift. */
export const CA_CURATION_SCOPE_COLUMNS = "gs_papers, gs_papers_by_exam, is_up_specific, state_focus";

/**
 * Which Mains GS papers this item feeds FOR THIS READER'S EXAM.
 *
 * An explicit `[]` under the exam's key is a real answer ("this exam triaged the
 * item and gave it no Mains paper") and is deliberately distinguished from an
 * ABSENT key ("this exam never triaged it") via `hasOwnProperty` rather than a
 * `??` on the value — otherwise a stored `[]` would silently fall through to
 * the legacy union and re-inherit the other commission's placement, which is
 * the exact bug this function exists to prevent.
 */
export function gsPapersForExam(
  row: Pick<CaCurationScopeRow, "gs_papers_by_exam" | "gs_papers">,
  examCode: string,
): readonly CurrentAffairsGsPaper[] {
  const byExam = row.gs_papers_by_exam;
  if (byExam && Object.prototype.hasOwnProperty.call(byExam, examCode)) {
    return byExam[examCode] ?? [];
  }
  return examCode === DEFAULT_EXAM_CODE ? (row.gs_papers ?? []) : [];
}

/**
 * Does this item carry THIS READER'S OWN state focus?
 *
 * ⚑ A NATIONALLY-SCOPED EXAM IS FALSE UNCONDITIONALLY, checked FIRST and before
 * either column is consulted. That is not an optimisation — it is the guarantee
 * that no state-shaped surface (the magazine's lead section, the ranking boost,
 * the feed's state tab and chip) can ever fire for such an exam whatever the row
 * says. It is also why generalising this column was safe to defer: M20a already
 * gated those surfaces on the reader's lens. What this function ADDS is the
 * distinction M20a could not make — between TWO state exams, where a UP story
 * must not read as state-focused to an MP aspirant.
 */
export function hasStateFocusForExam(
  row: Pick<CaCurationScopeRow, "state_focus" | "is_up_specific">,
  examCode: string,
): boolean {
  const lens = stateLensFor(examCode);
  if (lens === null) return false;
  if (row.state_focus !== null) return row.state_focus.includes(lens.code);
  return row.is_up_specific && examCode === DEFAULT_EXAM_CODE;
}

/**
 * The `lens=up` feed filter, as a PostgREST `.or()` string — the SQL twin of
 * `hasStateFocusForExam`, for the one caller that cannot resolve in JS because
 * it paginates in the database.
 *
 * Returns null for a nationally-scoped exam, meaning "there is no such tab":
 * the caller drops the filter rather than narrowing it, matching the pre-0116
 * behaviour for that case exactly.
 *
 * The legacy disjunct is emitted ONLY for the default exam, mirroring
 * `hasStateFocusForExam`'s attribution rule — for any other state exam the
 * legacy column is another commission's verdict and must not widen the tab.
 */
export function stateFocusFilterFor(examCode: string): string | null {
  const lens = stateLensFor(examCode);
  if (lens === null) return null;
  const own = `state_focus.cs.{${lens.code}}`;
  return examCode === DEFAULT_EXAM_CODE
    ? `${own},and(state_focus.is.null,is_up_specific.is.true)`
    : own;
}
