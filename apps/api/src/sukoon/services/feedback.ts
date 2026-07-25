/**
 * Session 14 — feedback (thumbs + optional short note) on a Saathi reply, a
 * completed journey, or general app feedback (the beta banner's link). One
 * opinion per (user, target) for message/journey feedback — a re-rate UPSERTs
 * via the unique index in 0093 rather than piling up duplicate rows. General
 * feedback (no target) always inserts a fresh row.
 */
import type { SukoonFeedbackItem, SukoonFeedbackSubmitBody } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";
import { recordSukoonEvent } from "./analytics.js";

const FEEDBACK_COLUMNS = "id, user_id, target_type, target_id, rating, body_text, created_at, updated_at";

export async function submitSukoonFeedback(
  userId: string,
  body: SukoonFeedbackSubmitBody,
): Promise<SukoonFeedbackItem> {
  const row = {
    user_id: userId,
    target_type: body.target_type,
    target_id: body.target_id ?? null,
    rating: body.rating ?? null,
    body_text: body.body_text?.trim() || null,
  };

  // Only message/journey feedback (a non-null target_id) has the unique index
  // to upsert against — general feedback always inserts a new row.
  const query =
    row.target_id !== null
      ? supabase()
          .from("sukoon_feedback")
          .upsert(row, { onConflict: "user_id,target_type,target_id" })
      : supabase().from("sukoon_feedback").insert(row);

  const { data, error } = await query.select(FEEDBACK_COLUMNS).single();
  if (error) throw new HttpError(500, `sukoon feedback write failed: ${error.message}`);

  void recordSukoonEvent(userId, "feedback_submitted", {
    target_type: body.target_type,
    has_rating: !!body.rating,
    has_note: !!body.body_text,
  });

  return data as unknown as SukoonFeedbackItem;
}

export interface FeedbackListPage {
  items: SukoonFeedbackItem[];
  total: number;
}

/** Admin-only list, newest first, paginated. See routes/admin.ts for the gate. */
export async function listSukoonFeedback(page: number, pageSize: number): Promise<FeedbackListPage> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await supabase()
    .from("sukoon_feedback")
    .select(FEEDBACK_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) {
    // PGRST103 = the requested page is past the end of the data — reachable
    // (not a server fault) since feedback rows cascade-delete when their
    // author's account (or just their Sukoon data) is erased, which can
    // shrink the total between an admin's page loads. Same fix as Neev's own
    // review queue: re-count and return an empty page rather than 500ing.
    if (error.code === "PGRST103") {
      const { count: total, error: countError } = await supabase()
        .from("sukoon_feedback")
        .select("id", { count: "exact", head: true });
      if (countError) throw new HttpError(500, `sukoon feedback list failed: ${countError.message}`);
      return { items: [], total: total ?? 0 };
    }
    throw new HttpError(500, `sukoon feedback list failed: ${error.message}`);
  }
  return { items: (data ?? []) as unknown as SukoonFeedbackItem[], total: count ?? 0 };
}
