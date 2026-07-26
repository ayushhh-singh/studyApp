/**
 * The DEMAND-AWARE RESERVE that layers on top of qgen/topup.ts's baseline
 * weightage floor. When a user clicks "Show me a new set" (services/on-demand.ts)
 * a row lands in `on_demand_requests`; the nightly top-up reads a rolling window
 * of those rows and adds a SEPARATE, additive reserve target per node, so a
 * heavily-requested topic keeps a stock of fresh generated questions ready to
 * select instantly.
 *
 * A node with ZERO on-demand demand stays at exactly today's baseline floor
 * (onDemandReserveAdditive returns 0) — no wasted generation. And because the
 * demand is read from a ROLLING recent window, a topic that stops being
 * requested tapers its reserve target back to baseline within one window (the
 * decay in step 3): the additive shrinks with the window, it is NOT a one-way
 * ratchet. Existing questions are never deleted — the target just stops adding.
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";

/**
 * Rolling window of "recent" demand. 30 days matches the app's other monthly
 * windows (trial, analytics), long enough to accumulate a stable signal and
 * short enough that a topic that stops being requested tapers its reserve back
 * to baseline within a month.
 */
export const ON_DEMAND_WINDOW_DAYS = 30;

/**
 * Reserve target ≤ this × the baseline floor. 4× gives a repeat user weeks of
 * fresh content on a hot topic (4× a 25–80 MCQ floor = 100–320 questions) while
 * bounding the worst-case nightly generation a single topic can demand; below 3×
 * a heavy repeat user exhausts the reserve too fast, above 5× a briefly-viral
 * topic would hoard the nightly budget from genuinely-thin nodes. 4× is the
 * middle of the proposed 3–5× band.
 */
export const ON_DEMAND_RESERVE_MULTIPLIER = 4;

/**
 * Reserve questions added per recent request-day. Each request-day (one user
 * asking once that day — the DB dedup guarantees at most one) adds ~2 to the
 * target, so a single curious click barely moves it (contributes 2, within
 * noise) while sustained demand ramps it toward the cap. A floor-50 node reaches
 * its +150 cap at 75 request-days inside the window.
 */
export const ON_DEMAND_QUESTIONS_PER_REQUEST = 2;

export interface DemandRow {
  node_id: string;
  scope_type: "custom" | "mock";
}

/** All demand rows inside the rolling window (paged — the log can exceed 1000). */
export async function loadRecentDemand(): Promise<DemandRow[]> {
  const cutoff = new Date(Date.now() - ON_DEMAND_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  return selectAll<DemandRow>(() =>
    supabase()
      .from("on_demand_requests")
      .select("id, node_id, scope_type")
      .gte("requested_at", cutoff)
      .order("id", { ascending: true }),
  );
}

/**
 * The additive reserve for a node: min(baseFloor·(M−1), K·demand), rounded.
 * demand=0 → 0 (the node stays at its baseline floor, unchanged). The cap keeps
 * the whole target (baseFloor + additive) at or below baseFloor·M.
 */
export function onDemandReserveAdditive(baseFloor: number, demand: number): number {
  if (demand <= 0) return 0;
  const cap = baseFloor * (ON_DEMAND_RESERVE_MULTIPLIER - 1);
  return Math.min(cap, Math.round(ON_DEMAND_QUESTIONS_PER_REQUEST * demand));
}
