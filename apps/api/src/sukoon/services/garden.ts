/**
 * Sukoon F11 — "Sukoon Garden": growth points computed live from real
 * activity (mood check-ins, completed exercises, journal entries), capped
 * per IST day, mapped onto a fixed stage ladder.
 *
 * HARD ANTI-DARK-PATTERN RULE (blueprint F11, verbatim): "grows slowly,
 * never dies or regresses." There is deliberately NO stored counter here —
 * `growth_points` is recomputed on every read straight from the user's own
 * activity rows, so there is no code path anywhere that could decrement or
 * reset it (no cache to go stale, no write path that could ever subtract).
 * The only way growth_points changes between two reads is a NEW activity row
 * appearing — never time passing, never a missed day.
 *
 * Reads go through selectAll (lib/paginate.ts), NOT a plain `.limit(N)` —
 * this is a real, repo-documented gotcha (see that file's header + several
 * CLAUDE.md incidents): PostgREST caps an unranged/under-ranged `.select()`
 * at 1000 rows server-side regardless of the client's own `.limit()`. Worse
 * than an ordinary truncation here: an `order("created_at", {ascending:
 * false}).limit(N)` read is a RECENCY window — as a prolific user accumulates
 * more rows than the cap, that window slides forward and can drop OLDER days
 * that a previous read had already counted, which would make growth_points
 * go DOWN between two reads. That is precisely the thing the "never decays"
 * rule forbids, so this reads every row (paginated), never a capped slice.
 */
import { SUKOON_GARDEN_STAGES, type SukoonGardenState } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { selectAll } from "../../lib/paginate.js";
import { istDateString } from "../../lib/ist.js";

/** Points per qualifying activity, and how many of each an IST day can count
 *  toward the total — "capped daily" (blueprint F11) so one very-active day
 *  can't leapfrog weeks of ordinary use. A day's activity is never worth
 *  MORE than DAILY_CAP regardless of how many rows it produced; it can also
 *  never be worth less later (there is no "undo" — see header). */
const MOOD_POINTS_PER_DAY = 2;
const EXERCISE_POINTS_PER_SESSION = 2;
const MAX_EXERCISES_COUNTED_PER_DAY = 2;
const JOURNAL_POINTS_PER_ENTRY = 2;
const MAX_JOURNAL_COUNTED_PER_DAY = 2;
const DAILY_CAP = 10;

interface CreatedAtRow {
  created_at: string;
}

/** created_at rows → a day -> count map (IST calendar day). */
function toDayCounts(rows: CreatedAtRow[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = istDateString(new Date(row.created_at).getTime());
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return byDay;
}

async function moodDayCounts(userId: string): Promise<Map<string, number>> {
  const rows = await selectAll<CreatedAtRow>(() =>
    supabase()
      .from("sukoon_mood_entries")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  );
  return toDayCounts(rows);
}

async function exerciseDayCounts(userId: string): Promise<Map<string, number>> {
  const rows = await selectAll<CreatedAtRow>(() =>
    supabase()
      .from("sukoon_exercise_sessions")
      .select("created_at")
      .eq("user_id", userId)
      .eq("completed", true)
      .order("created_at", { ascending: true }),
  );
  return toDayCounts(rows);
}

async function journalDayCounts(userId: string): Promise<Map<string, number>> {
  const rows = await selectAll<CreatedAtRow>(() =>
    supabase()
      .from("sukoon_journal_entries")
      .select("created_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  );
  return toDayCounts(rows);
}

/** Which stage a cumulative point total lands on — the highest stage whose
 *  `min` threshold has been reached. Index 0 (seed) always qualifies. */
function stageForPoints(points: number): number {
  let stageIndex = 0;
  for (let i = 0; i < SUKOON_GARDEN_STAGES.length; i++) {
    if (points >= SUKOON_GARDEN_STAGES[i].min) stageIndex = i;
  }
  return stageIndex;
}

export async function getGardenState(userId: string): Promise<SukoonGardenState> {
  const [moodDays, exerciseDays, journalDays] = await Promise.all([
    moodDayCounts(userId),
    exerciseDayCounts(userId),
    journalDayCounts(userId),
  ]);

  const allDays = new Set<string>([...moodDays.keys(), ...exerciseDays.keys(), ...journalDays.keys()]);
  let growth_points = 0;
  for (const day of allDays) {
    const moodPts = (moodDays.get(day) ?? 0) > 0 ? MOOD_POINTS_PER_DAY : 0;
    const exercisePts =
      Math.min(exerciseDays.get(day) ?? 0, MAX_EXERCISES_COUNTED_PER_DAY) * EXERCISE_POINTS_PER_SESSION;
    const journalPts =
      Math.min(journalDays.get(day) ?? 0, MAX_JOURNAL_COUNTED_PER_DAY) * JOURNAL_POINTS_PER_ENTRY;
    growth_points += Math.min(moodPts + exercisePts + journalPts, DAILY_CAP);
  }

  const stageIndex = stageForPoints(growth_points);
  const stage = SUKOON_GARDEN_STAGES[stageIndex];
  const next = SUKOON_GARDEN_STAGES[stageIndex + 1] ?? null;
  const progress_to_next = next ? Math.min(1, (growth_points - stage.min) / (next.min - stage.min)) : 1;

  return {
    growth_points,
    stage: stage.id,
    stage_index: stageIndex,
    stage_count: SUKOON_GARDEN_STAGES.length,
    next_stage_threshold: next ? next.min : null,
    progress_to_next,
  };
}
