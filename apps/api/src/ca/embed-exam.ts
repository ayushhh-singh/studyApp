/**
 * Which exam a current-affairs item's EMBEDDING row belongs to.
 *
 * Shared by the live pipeline and the `ca:embed` backfill so the two can never
 * disagree about a chunk's exam — they already share the embed text
 * (`${title}. ${summary}`) for exactly the same reason.
 *
 * CA is the one content type that is genuinely multi-exam (0106 §11): a budget /
 * IR / environment story maps into several exams' trees and is deliberately NOT
 * duplicated per exam, because duplicating it would re-pay the triage + enrich
 * LLM calls per copy. But `embeddings` has one row per (source, locale, chunk),
 * so there is no room for a per-exam copy of the vector either.
 *
 * Hence the three-way mapping, matching `match_embeddings`' predicate (0107):
 *  - exactly one exam  → stamp it, so a UP-specific item stays out of another
 *                        exam's retrieval;
 *  - several exams     → NULL, meaning "shared", which the RPC matches for every
 *                        exam. Picking one of them would silently hide a
 *                        genuinely national item from all the others;
 *  - none / unknown    → NULL as well. Failing OPEN is right here: an item with
 *                        no recorded relevance is at worst a slightly wider
 *                        retrieval pool, whereas failing closed would make it
 *                        invisible to everyone with nothing to show why.
 */
export function caEmbeddingExamCode(examCodes: readonly string[] | null | undefined): string | null {
  const unique = [...new Set((examCodes ?? []).filter(Boolean))];
  return unique.length === 1 ? unique[0] : null;
}
