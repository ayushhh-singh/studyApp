import type { UseQueryResult } from "@tanstack/react-query";

type QueryLike = Pick<UseQueryResult<unknown>, "isPending">;

/**
 * "Does this query have an answer yet?" — the ONE check that distinguishes
 * *we don't know yet* from *the answer is nothing*.
 *
 * ── THE TRAP THIS EXISTS TO CLOSE ────────────────────────────────────────────
 * In TanStack Query v5 a DISABLED query (`enabled: false`) reports
 * `isLoading: false` and `data: undefined` — because `isLoading` is defined as
 * `isPending && isFetching`, and a disabled query is pending but not fetching.
 * So the idiomatic-looking
 *
 *     if (q.isLoading) return <Skeleton />;
 *     return <List rows={q.data ?? []} />;   // ← renders "nothing" FOREVER
 *
 * silently renders an EMPTY state for a query that has never run and never
 * will until its input arrives.
 *
 * That matters here because of a specific shape this app is full of: a
 * component derives a value from the ASYNC exam registry (`useExams` →
 * `useCurrentExam` → `usePaperCatalog`), gets `""`/`null` while the registry is
 * still in flight, hands that to a dependent query — which is therefore
 * disabled — and then renders the disabled query's `isLoading: false` as
 * "the exam has no such thing". A permanent skeleton, an unreachable page, or
 * a card that vanishes. Four live regressions came from exactly this.
 *
 * `isPending` is the correct predicate: it is true both while fetching AND
 * while disabled, i.e. it means "no data yet, for whatever reason".
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * When a query's `enabled` depends on a value that is itself still loading,
 * you must gate on BOTH — the derived input's own loading flag (e.g.
 * `usePaperCatalog().isLoading`) AND `isAwaitingData(query)`. Checking only the
 * query is not enough: once the input resolves to a genuinely empty value the
 * query stays disabled on purpose, and THAT is the moment an honest empty state
 * is correct. Gating only on the query would strand a skeleton there instead.
 *
 * An errored query is NOT awaiting — `isPending` is false once it fails — so a
 * caller that wants to distinguish "failed" from "empty" must read `isError`
 * itself and say so. Failing silently into an empty state is the bug next door.
 */
export function isAwaitingData(...queries: QueryLike[]): boolean {
  return queries.some((q) => q.isPending);
}
