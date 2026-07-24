/**
 * Sukoon F8 — Wellbeing Check-ins service (WHO-5 + Exam Stress Self-Check).
 * SELF-REFLECTION tools, never clinical screeners (SUKOON_CONTEXT). Every query
 * is owner-scoped by user_id (defense in depth alongside RLS 0079).
 *
 * The QUESTION COPY lives in @neev/shared (SUKOON_CHECKIN_DEFS) — the single
 * source both this service (which validates + scores) and the FE (which renders)
 * read. We store only answers_json + a 0–100 score; never the item text.
 *
 * Scoring is server-authoritative: the client sends raw answers, never a score.
 * The pure scoring rules are the shared scoreWho5/scoreStressSelfCheck so a FE
 * preview and this server can never disagree.
 */
import type {
  SukoonCheckin,
  SukoonCheckinStatusItem,
  SukoonCheckinSubmitBody,
  SukoonCheckinTrendPoint,
  SukoonCheckinType,
} from "@neev/shared";
import {
  SUKOON_STRESS_HIGH_THRESHOLD,
  SUKOON_WHO5_LOW_THRESHOLD,
  scoreStressSelfCheck,
  scoreWho5,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";
import { istDateString } from "../../lib/ist.js";

const CHECKIN_TYPES: SukoonCheckinType[] = ["who5", "stress_self_check"];
/** Gentle monthly re-prompt: a type is "due" if untaken in this many days. */
const REPROMPT_AFTER_DAYS = 30;
/** Bound trend/status scans (a checkin is monthly-ish, so this is generous). */
const TREND_SCAN_CAP = 200;

interface CheckinRow {
  id: string;
  type: SukoonCheckinType;
  score: number | null;
  created_at: string;
}

/** Is this score in the "offer gentle support" band? (WHO-5 low OR stress high.) */
export function isLowWellbeing(type: SukoonCheckinType, score: number): boolean {
  return type === "who5"
    ? score < SUKOON_WHO5_LOW_THRESHOLD
    : score >= SUKOON_STRESS_HIGH_THRESHOLD;
}

/**
 * Score + store a check-in. The score is computed here from the raw answers
 * (never trusted from the client). Returns the stored row + a `low` flag telling
 * the FE whether to surface the gentle suggestion card — NO label/diagnosis.
 */
export async function submitCheckin(
  userId: string,
  body: SukoonCheckinSubmitBody,
): Promise<{ checkin: SukoonCheckin; low: boolean }> {
  const { raw, score } =
    body.type === "who5" ? scoreWho5(body.answers) : scoreStressSelfCheck(body.answers);

  const { data, error } = await supabase()
    .from("sukoon_checkins")
    .insert({
      user_id: userId,
      type: body.type,
      // Store raw answers + raw sum (audit/re-score), never the item text.
      answers_json: { answers: body.answers, raw },
      score,
    })
    .select("id, type, score, created_at")
    .single();
  if (error) throw new HttpError(500, `checkin write failed: ${error.message}`);

  const row = data as unknown as CheckinRow;
  return {
    checkin: { id: row.id, type: row.type, score: row.score ?? score, created_at: row.created_at },
    low: isLowWellbeing(body.type, score),
  };
}

/**
 * Per-type status: last-taken + last-score + whether a gentle monthly re-prompt
 * is due. Reads the latest row per type in one scan. Never taken → due=true
 * (the first nudge to try it), which the FE frames as an invitation, not alarm.
 */
export async function getCheckinStatus(userId: string): Promise<SukoonCheckinStatusItem[]> {
  const { data, error } = await supabase()
    .from("sukoon_checkins")
    .select("type, score, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(TREND_SCAN_CAP);
  if (error) throw new HttpError(500, `checkin status failed: ${error.message}`);

  const rows = (data as { type: SukoonCheckinType; score: number | null; created_at: string }[]) ?? [];
  const now = Date.now();

  return CHECKIN_TYPES.map((type) => {
    const latest = rows.find((r) => r.type === type) ?? null;
    if (!latest) return { type, last_taken_at: null, last_score: null, due: true };
    const ageDays = (now - new Date(latest.created_at).getTime()) / 86_400_000;
    return {
      type,
      last_taken_at: latest.created_at,
      last_score: latest.score,
      due: ageDays >= REPROMPT_AFTER_DAYS,
    };
  });
}

/** Score history for one type (oldest→newest) for the /sukoon/you trend chart. */
export async function getCheckinTrend(
  userId: string,
  type: SukoonCheckinType,
): Promise<SukoonCheckinTrendPoint[]> {
  const { data, error } = await supabase()
    .from("sukoon_checkins")
    .select("score, created_at")
    .eq("user_id", userId)
    .eq("type", type)
    .order("created_at", { ascending: true })
    .limit(TREND_SCAN_CAP);
  if (error) throw new HttpError(500, `checkin trend failed: ${error.message}`);

  return ((data as { score: number | null; created_at: string }[]) ?? [])
    .filter((r): r is { score: number; created_at: string } => r.score != null)
    .map((r) => ({ date: istDateString(new Date(r.created_at).getTime()), score: r.score }));
}
