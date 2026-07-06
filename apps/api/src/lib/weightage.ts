/**
 * Weightage aggregates — how often each syllabus topic has been asked, by year.
 * Reads the cached `mv_node_weightage` materialized view (refreshed after each
 * ingest, see ingest:pyq:load / ingest:refresh-weightage) rather than
 * re-aggregating the questions table on every request.
 *
 * The view is per (node_id, exam_code, year); callers roll the OWN-node counts
 * up through the syllabus subtree themselves (services/syllabus.ts), exactly
 * like pyq_count, so a chapter row reflects its descendants.
 */
import type { ExamCode, NodeWeightage } from "@prayasup/shared";
import { supabase } from "./supabase.js";
import { HttpError } from "./http-error.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Recency decay per year for the hotness score (recent asks weigh more). */
const HOTNESS_DECAY = 0.85;
/** "Not asked in 5+ years" cutoff for the Trends "dormant" bucket. */
export const DORMANT_YEARS = 5;

/** Current exam year in IST (the app is UP/India-specific — no server-UTC drift). */
export function currentExamYear(): number {
  return new Date(Date.now() + IST_OFFSET_MS).getUTCFullYear();
}

export interface OwnWeightage {
  /** year -> question count for this node alone (not descendants). */
  byYear: Map<number, number>;
  total: number;
}

/**
 * Load per-node own weightage from the materialized view.
 * `exam` scopes to a single exam; omit to combine all exams.
 */
export async function loadNodeWeightage(exam?: ExamCode): Promise<Map<string, OwnWeightage>> {
  let query = supabase().from("mv_node_weightage").select("node_id, exam_code, year, q_count");
  if (exam) query = query.eq("exam_code", exam);
  const { data, error } = await query;
  if (error) throw new HttpError(500, `weightage lookup failed: ${error.message}`);

  const out = new Map<string, OwnWeightage>();
  for (const row of (data ?? []) as { node_id: string; year: number; q_count: number }[]) {
    const cur = out.get(row.node_id) ?? { byYear: new Map<number, number>(), total: 0 };
    cur.byYear.set(row.year, (cur.byYear.get(row.year) ?? 0) + row.q_count);
    cur.total += row.q_count;
    out.set(row.node_id, cur);
  }
  return out;
}

/** Recency-weighted frequency: recent asks contribute more than old ones. */
export function hotnessRaw(byYear: Map<number, number>, currentYear: number): number {
  let sum = 0;
  for (const [year, count] of byYear) sum += count * Math.pow(HOTNESS_DECAY, Math.max(0, currentYear - year));
  return sum;
}

export function lastAskedYear(byYear: Map<number, number>): number | null {
  let last: number | null = null;
  for (const year of byYear.keys()) if (last === null || year > last) last = year;
  return last;
}

export function byYearRecord(byYear: Map<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [year, count] of byYear) out[String(year)] = count;
  return out;
}

/**
 * Build a NodeWeightage from a rolled-up by-year map, given the paper-wide
 * maxima used to normalise `share_pct` (bar width) and `hotness` to 0–100.
 * Returns null for a node with no dated PYQs.
 */
export function toNodeWeightage(
  byYear: Map<number, number>,
  currentYear: number,
  maxTotal: number,
  maxHotness: number,
): NodeWeightage | null {
  const total = [...byYear.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const hot = hotnessRaw(byYear, currentYear);
  return {
    total,
    by_year: byYearRecord(byYear),
    last_asked_year: lastAskedYear(byYear),
    years_asked: byYear.size,
    share_pct: maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0,
    hotness: maxHotness > 0 ? Math.round((hot / maxHotness) * 100) : 0,
  };
}

/**
 * Refresh the cached matview (after an ingest). The RPC attempts a CONCURRENT
 * refresh but, since it runs inside a transactional function, that raises and
 * falls back to a brief blocking refresh — fine at ingest time (not on a hot
 * read path).
 */
export async function refreshNodeWeightage(): Promise<void> {
  const { error } = await supabase().rpc("refresh_node_weightage");
  if (error) throw new HttpError(500, `weightage refresh failed: ${error.message}`);
}
