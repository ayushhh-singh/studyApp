/**
 * Safety net for the official-key publish path (migration 0074, item 3): when a
 * question is published on the strength of an OFFICIAL-commission key but the
 * independent blind re-solve DISAGREED with that key, raise a SYSTEM-generated flag
 * into the same admin Review Queue as user "Report this question" complaints — but
 * distinct from one (user_id=null, reason 'ai_key_dispute'). The publish is never
 * blocked (an official key is ground truth); this only surfaces the disagreement so
 * a human can investigate — the 2021 GS-I "official key is genuinely wrong" case.
 *
 * This is an ONGOING mechanism, not a one-time backfill: every future official-key
 * load/re-gate that hits a disagreement raises (or refreshes) the flag.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface KeyDisputeDetail {
  official_key: string | null;
  blind_key: string | null;
  confidence: number | null;
}

/**
 * Idempotently raise (or refresh) the system flag for one question. Returns
 * "created" | "exists". Also stamps meta.key_dispute on the question so the
 * provenance is visible on the row itself and a re-run doesn't double-flag.
 */
export async function raiseKeyDisputeFlag(
  sb: SupabaseClient,
  questionId: string,
  detail: KeyDisputeDetail,
): Promise<"created" | "exists"> {
  const detailText =
    `[SYSTEM] AI blind re-solve disagrees with the official-commission answer key ` +
    `(official=${detail.official_key ?? "?"}, blind=${detail.blind_key ?? "?"}` +
    `${detail.confidence != null ? `, confidence=${detail.confidence}` : ""}). ` +
    `Published on the official key (not blocked); flagged for human review.`;

  // One open system flag per question — a system report has user_id=null, so the
  // question_reports_one_open_per_user partial unique index (which keys on
  // (question_id, user_id)) does NOT dedupe nulls; dedupe explicitly instead.
  const { data: existing, error: selErr } = await sb
    .from("question_reports")
    .select("id")
    .eq("question_id", questionId)
    .is("user_id", null)
    .eq("reason", "ai_key_dispute")
    .eq("status", "open")
    .maybeSingle();
  if (selErr) throw new Error(`key-dispute flag lookup: ${selErr.message}`);

  if (existing) {
    // Refresh the detail (blind verdict may have changed on a re-run).
    const { error } = await sb
      .from("question_reports")
      .update({ detail: detailText })
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(`key-dispute flag refresh: ${error.message}`);
    return "exists";
  }

  const { error } = await sb
    .from("question_reports")
    .insert({ question_id: questionId, user_id: null, reason: "ai_key_dispute", detail: detailText });
  if (error) throw new Error(`key-dispute flag insert: ${error.message}`);
  return "created";
}
