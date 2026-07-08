/**
 * Perfect Days + the activity heatmap.
 *
 * `recordPerfectDay` marks an IST day perfect (sticky) once the guided Today
 * checklist is fully complete — called from the dashboard summary (which already
 * computes the checklist) and nightly. `getActivityHeatmap` returns a GitHub-style
 * grid: per-day activity intensity computed live from raw events, with the stored
 * perfect-day flag overlaid.
 */
import type { ActivityHeatmap, HeatmapDay } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { istDateString, istDayRangeUtc, istToday, shiftDate } from "../lib/ist.js";
import { buildChecklist, getDailyProgress, type DailyProgress } from "./daily-progress.js";

/** Mark today perfect if the whole checklist is done. Sticky — only ever sets true. */
export async function recordPerfectDay(
  userId: string,
  date: string = istToday(),
  progress?: DailyProgress,
): Promise<boolean> {
  const p = progress ?? (await getDailyProgress(userId, date));
  const checklist = buildChecklist(p);
  const isPerfect = checklist.total > 0 && checklist.completed === checklist.total;
  if (!isPerfect) return false;

  const { error } = await supabase()
    .from("daily_stats")
    .upsert(
      { user_id: userId, date, is_perfect: true, computed_at: new Date().toISOString(), meta: { checklist_total: checklist.total } },
      { onConflict: "user_id,date" },
    );
  if (error) throw new HttpError(500, `perfect-day upsert failed: ${error.message}`);
  return true;
}

/** All-time count of the user's Perfect Days (drives the milestone). */
export async function countPerfectDays(userId: string): Promise<number> {
  const { count, error } = await supabase()
    .from("daily_stats")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_perfect", true);
  if (error) throw new HttpError(500, `perfect-day count failed: ${error.message}`);
  return count ?? 0;
}

async function bucketByDay(
  table: string,
  userId: string,
  tsColumn: string,
  startUtc: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refine?: (q: any) => any,
): Promise<Map<string, number>> {
  const base = supabase().from(table).select(tsColumn).eq("user_id", userId).gte(tsColumn, startUtc);
  const { data, error } = await (refine ? refine(base) : base);
  if (error) throw new HttpError(500, `${table} heatmap query failed: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Record<string, string | null>[]) {
    const ts = row[tsColumn];
    if (!ts) continue;
    const day = istDateString(Date.parse(ts));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

/**
 * Weeks of daily activity, Monday-aligned columns of 7 days ending today.
 * Intensity = attempts submitted + SRS reviews + answer submissions + reads that
 * day; is_perfect overlaid from daily_stats.
 */
export async function getActivityHeatmap(userId: string, weeks = 13): Promise<ActivityHeatmap> {
  const w = Math.max(4, Math.min(26, weeks));
  const today = istToday();
  // Grid ends on today's column; start so we cover `w` full weeks (Mon-first).
  const todayDow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0=Mon
  const gridEnd = shiftDate(today, 6 - todayDow); // Sunday of this week
  const gridStart = shiftDate(gridEnd, -(w * 7 - 1));
  const { startUtc } = istDayRangeUtc(gridStart);

  const [attempts, reviews, submissions, events, perfectRows] = await Promise.all([
    bucketByDay("attempts", userId, "submitted_at", startUtc, (q) => q.not("submitted_at", "is", null)),
    bucketByDay("srs_reviews", userId, "reviewed_at", startUtc),
    bucketByDay("answer_submissions", userId, "created_at", startUtc),
    bucketByDay("events", userId, "created_at", startUtc, (q) => q.in("name", ["note_read", "syllabus_node_view"])),
    supabase().from("daily_stats").select("date, is_perfect").eq("user_id", userId).gte("date", gridStart).lte("date", gridEnd),
  ]);
  if (perfectRows.error) throw new HttpError(500, `daily_stats query failed: ${perfectRows.error.message}`);
  const perfectByDate = new Map(
    (perfectRows.data ?? []).map((r) => [r.date as string, r.is_perfect as boolean]),
  );

  const days: HeatmapDay[] = [];
  for (let i = 0; i < w * 7; i++) {
    const date = shiftDate(gridStart, i);
    const count =
      (attempts.get(date) ?? 0) + (reviews.get(date) ?? 0) + (submissions.get(date) ?? 0) + (events.get(date) ?? 0);
    days.push({ date, count, is_perfect: perfectByDate.get(date) ?? false, is_future: date > today });
  }

  const perfectTotal = await countPerfectDays(userId);
  return { weeks: w, days, perfect_days_total: perfectTotal };
}
