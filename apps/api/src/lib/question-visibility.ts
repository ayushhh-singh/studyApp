/**
 * The ONE place that encodes which questions a given context may see. Every
 * query that filters questions by publish/review state goes through here
 * instead of an inline `.eq("is_published", true)` — extend the predicate in
 * this file, never at a call site.
 *
 * A user-facing question must be BOTH published AND review-approved:
 *   is_published = true  AND  review_state = 'approved'
 * (`review_state` was added in migration 0035; existing published PYQs were
 * backfilled to 'approved', so this is behaviour-preserving.)
 *
 * Two scopes exist:
 *  - "catalog": published + approved, no exceptions. Backs the general PYQ
 *    list/search, single-question fetch, explanations, and "practice this
 *    topic" builders. qgen survivors (review_state='needs_review') and the
 *    ca:run pipeline's MCQs must never surface here until a human approves them.
 *  - "test": (published + approved) OR the question belongs to the ca:run
 *    pipeline's review-gated current-affairs pool (paper_code ===
 *    CURRENT_AFFAIRS_PAPER_CODE). ⚑ SERVING ONLY — see below.
 *
 * ---------------------------------------------------------------------------
 * ⚑ "test" IS A SERVING SCOPE. ASSEMBLY MUST USE `assemblyVisibilityOrFilter()`.
 * ---------------------------------------------------------------------------
 * The current-affairs exception was written when a CA MCQ was NEVER approved:
 * `ca:run` inserted them `is_published=false` permanently and there was no
 * reviewer UI that could ever flip one, so admitting them by paper code was the
 * only way the "Quiz me on this week" button could have any content at all.
 *
 * THAT PREMISE IS NOW FALSE, and the exception's population has inverted with it.
 * Measured 2026-08-13 across `paper_code = CURRENT_AFFAIRS`:
 *
 *     uppsc mcq          approved 1451   needs_review 18   rejected 331
 *     uppsc descriptive  approved   80   needs_review  0   rejected   1
 *     upsc  mcq          approved   23   needs_review 25   rejected   3
 *
 * So the rows the exception uniquely admits are now dominated by ones a human
 * looked at and REJECTED — and they were reaching real papers: 37 unapproved
 * questions (36 rejected, 1 needs_review) sat inside 25 live tests, 21 of them
 * daily quizzes, which is the shared paper that feeds the competitive daily
 * scoreboard.
 *
 * The exception still has one legitimate job — SERVING and GRADING a test that
 * was already assembled. `getTestDetail`, `startAttempt`, `submitAttempt` and
 * `getAttemptResult` all re-apply this filter so a question retracted after
 * assembly stops being served, and they must keep admitting whatever those older
 * papers already contain rather than mutating history under a user mid-attempt.
 *
 * It has NO legitimate job when CHOOSING questions for a NEW paper. Every builder
 * therefore calls `assemblyVisibilityOrFilter()`, which takes no scope argument
 * at all — so an assembly path cannot opt into the exception by passing the wrong
 * string, which is exactly how the daily quiz's CA slice acquired it.
 */
export const CURRENT_AFFAIRS_PAPER_CODE = "CURRENT_AFFAIRS";

/**
 * This app also ingests non-UPPSC exams (UPSC Civil Services, UPSSSC PET)
 * onto the same Prelims/Mains paper codes for weightage-overlap analytics
 * (see ingest/_shared.ts's classifyPyqId) — any surface that presents itself
 * as "the UPPSC paper/pattern" (pyq_full, sectional, mock, and custom-set
 * assembly, for both MCQ and descriptive) MUST filter `.eq("exam_code",
 * UPPSC_EXAM_CODE)`, or it silently mixes a different exam's questions into
 * a paper labeled UPPSC. This happened once already (a new custom-set
 * builder shipped without the filter); centralized here instead of a raw
 * string literal repeated at every call site so a future test-assembly
 * surface has one obvious constant to import rather than one more place to
 * remember to type the literal correctly.
 */
export const UPPSC_EXAM_CODE = "uppsc";

export type QuestionVisibilityScope = "catalog" | "test";

/**
 * PostgREST `.or()` filter string for the given scope. The published+approved
 * requirement is an AND, expressed as an `and(...)` group so it composes inside
 * a single `.or()` call (also works against a referenced/embedded table via
 * `.or(filter, { referencedTable: "questions" })`).
 */
const PUBLISHED_APPROVED = "and(is_published.eq.true,review_state.eq.approved)";

export function questionVisibilityOrFilter(scope: QuestionVisibilityScope): string {
  if (scope === "catalog") return PUBLISHED_APPROVED;
  return `${PUBLISHED_APPROVED},paper_code.eq.${CURRENT_AFFAIRS_PAPER_CODE}`;
}

/**
 * THE ONLY visibility filter a test-ASSEMBLY path may use: published AND
 * review-approved, no exceptions, for every paper code including
 * CURRENT_AFFAIRS.
 *
 * Deliberately takes NO scope argument. It is a synonym for `"catalog"` today and
 * that is the point — the guarantee is not "these two happen to be equal", it is
 * "an assembly site has no scope parameter to get wrong". A shared enum plus a
 * comment is precisely what let `daily/quiz.ts`'s current-affairs slice pass
 * `"test"` and put rejected questions into 21 live daily quizzes.
 *
 * Callers: `services/mocks.ts` (prelims + mains mock pools), `daily/quiz.ts` (all
 * four slices), `ca/assemble.ts` (both cadences), `services/tests.ts`
 * (createCustomTestFromNode, createCustomTestFromCurrentAffairs) and
 * `services/on-demand.ts` (fresh mock / custom pools). If you add a builder, use
 * this; if you need `questionVisibilityOrFilter("test")`, you are serving an
 * already-assembled paper, not building one.
 */
export function assemblyVisibilityOrFilter(): string {
  return PUBLISHED_APPROVED;
}

/** Same predicate, evaluated in memory for an already-fetched row. */
export function isQuestionVisible(
  scope: QuestionVisibilityScope,
  q: { is_published: boolean; review_state?: string | null; paper_code?: string | null },
): boolean {
  if (q.is_published && q.review_state === "approved") return true;
  return scope === "test" && q.paper_code === CURRENT_AFFAIRS_PAPER_CODE;
}
