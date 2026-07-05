/**
 * The ONE place that encodes which questions a given context may see. Every
 * query that filters questions by publish state goes through here instead of
 * an inline `.eq("is_published", true)` — a future `review_state` column
 * extends the predicate in this file, not any call site.
 *
 * Two scopes exist:
 *  - "catalog": is_published=true, no exceptions. Backs the general PYQ
 *    list/search, single-question fetch, explanations, and "practice this
 *    topic" builders — CA-generated MCQs (see ca/pipeline.ts's
 *    insertMcqsForItem) are deliberately always is_published=false and must
 *    never surface here.
 *  - "test": is_published=true OR the question belongs to the ca:run
 *    pipeline's review-gated current-affairs pool (paper_code ===
 *    CURRENT_AFFAIRS_PAPER_CODE). Their only intended serving surface is the
 *    "Quiz me on this week" test (services/tests.ts's
 *    createCustomTestFromCurrentAffairs), which links to them purely by
 *    question_id, so this exception can never leak one into an unrelated
 *    test/attempt.
 */
export const CURRENT_AFFAIRS_PAPER_CODE = "CURRENT_AFFAIRS";

export type QuestionVisibilityScope = "catalog" | "test";

/** PostgREST `.or()` filter string for the given scope. */
export function questionVisibilityOrFilter(scope: QuestionVisibilityScope): string {
  if (scope === "catalog") return "is_published.eq.true";
  return `is_published.eq.true,paper_code.eq.${CURRENT_AFFAIRS_PAPER_CODE}`;
}

/** Same predicate, evaluated in memory for an already-fetched row. */
export function isQuestionVisible(
  scope: QuestionVisibilityScope,
  q: { is_published: boolean; paper_code?: string | null },
): boolean {
  if (q.is_published) return true;
  return scope === "test" && q.paper_code === CURRENT_AFFAIRS_PAPER_CODE;
}
