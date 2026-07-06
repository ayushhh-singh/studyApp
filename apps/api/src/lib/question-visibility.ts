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
 *    CURRENT_AFFAIRS_PAPER_CODE). Their only intended serving surface is the
 *    "Quiz me on this week" test (services/tests.ts's
 *    createCustomTestFromCurrentAffairs), which links to them purely by
 *    question_id, so this exception can never leak one into an unrelated
 *    test/attempt. Once a CA MCQ is approved in the Review Queue it becomes
 *    published+approved and is served through the first clause like any PYQ.
 */
export const CURRENT_AFFAIRS_PAPER_CODE = "CURRENT_AFFAIRS";

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

/** Same predicate, evaluated in memory for an already-fetched row. */
export function isQuestionVisible(
  scope: QuestionVisibilityScope,
  q: { is_published: boolean; review_state?: string | null; paper_code?: string | null },
): boolean {
  if (q.is_published && q.review_state === "approved") return true;
  return scope === "test" && q.paper_code === CURRENT_AFFAIRS_PAPER_CODE;
}
