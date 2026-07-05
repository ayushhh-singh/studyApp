import type { DashboardSummary } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getDashboardSummary(userId: string): Promise<DashboardSummary> {
  const { data: profile, error: profileError } = await supabase()
    .from("users_profile")
    .select("streak_count")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new HttpError(500, `profile lookup failed: ${profileError.message}`);

  const { count: attemptsCount, error: attemptsError } = await supabase()
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("submitted_at", "is", null);
  if (attemptsError) throw new HttpError(500, `attempts count failed: ${attemptsError.message}`);

  const { data: scored, error: scoredError } = await supabase()
    .from("attempts")
    .select("score, total")
    .eq("user_id", userId)
    .not("submitted_at", "is", null)
    .not("total", "is", null);
  if (scoredError) throw new HttpError(500, `attempts score lookup failed: ${scoredError.message}`);
  const pcts = (scored ?? [])
    .filter((a) => (a.total as number | null) && (a.total as number) > 0)
    .map((a) => ((a.score as number | null) ?? 0) / (a.total as number) * 100);
  const avgScorePct = pcts.length > 0 ? round2(pcts.reduce((s, x) => s + x, 0) / pcts.length) : null;

  const nowIso = new Date().toISOString();
  const { count: srsDue, error: srsError } = await supabase()
    .from("srs_cards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lte("fsrs_state->>due_at", nowIso);
  if (srsError) throw new HttpError(500, `srs due count failed: ${srsError.message}`);

  const { data: latestCa, error: caError } = await supabase()
    .from("current_affairs_items")
    .select("date")
    .eq("is_published", true)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (caError) throw new HttpError(500, `current affairs lookup failed: ${caError.message}`);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: recent, error: recentError } = await supabase()
    .from("attempts")
    .select("submitted_at")
    .eq("user_id", userId)
    .not("submitted_at", "is", null)
    .gte("submitted_at", sevenDaysAgo);
  if (recentError) throw new HttpError(500, `weekly activity lookup failed: ${recentError.message}`);
  const byDay = new Map<string, number>();
  for (const r of recent ?? []) {
    const day = (r.submitted_at as string).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const weeklyActivity = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, attempts]) => ({ date, attempts }));

  return {
    attempts_count: attemptsCount ?? 0,
    avg_score_pct: avgScorePct,
    streak_count: profile?.streak_count ?? 0,
    srs_due_count: srsDue ?? 0,
    latest_current_affairs_date: (latestCa as { date: string } | null)?.date ?? null,
    weekly_activity: weeklyActivity,
  };
}
