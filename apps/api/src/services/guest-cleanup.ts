/**
 * Retention/prune for abandoned GUEST (anonymous) accounts.
 *
 * Supabase never auto-deletes anonymous users, so every guest who browses and
 * leaves (or clears their device) accumulates forever — an `auth.users` row, a
 * `users_profile` row, and whatever `attempts`/`events`/`srs_cards` they created.
 * This prunes ones that are BOTH old and inactive:
 *   - `is_anonymous = true` (a converted guest is no longer anonymous → NEVER
 *     touched; a real account is never anonymous → NEVER touched), AND
 *   - created more than `retentionDays` ago, AND
 *   - no real INTERACTION in that window — no `events` row and no `attempts` row
 *     since the cutoff. (We use raw interactions, not `last_active_date`, because
 *     that column is only set on a study-DAY activity — a guest who merely browses
 *     chapters/current-affairs fires events but no study-day, and must NOT be
 *     pruned as if abandoned.)
 *
 * Deletion order matters: `users_profile` first (its children — attempts, events,
 * srs_cards, … — are ON DELETE CASCADE from it), then the auth user (whose delete
 * does NOT cascade the profile). Before each delete we RE-CONFIRM the user is
 * still anonymous, so a guest who converts between the scan and the delete is
 * never removed.
 *
 * Dry-run unless `apply` is true. Runs nightly (nightly:settle) + `pnpm guests:prune`.
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";

export interface PruneGuestsResult {
  /** anonymous users older than the cutoff (before the activity filter) */
  oldAnonymous: number;
  /** of those, also inactive → eligible to prune */
  eligible: number;
  /** actually deleted (0 in dry-run) */
  pruned: number;
  retentionDays: number;
  applied: boolean;
}

function defaultRetentionDays(): number {
  const n = Number(process.env.GUEST_RETENTION_DAYS ?? 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export async function pruneAbandonedGuests(opts?: {
  retentionDays?: number;
  apply?: boolean;
}): Promise<PruneGuestsResult> {
  const retentionDays = opts?.retentionDays ?? defaultRetentionDays();
  const apply = opts?.apply ?? false;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  // 1. Page through auth users, collect anonymous ones older than the cutoff.
  const oldAnon: string[] = [];
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase().auth.admin.listUsers({ page, perPage });
    if (error) throw new HttpError(500, `listUsers failed: ${error.message}`);
    const users = data.users ?? [];
    for (const u of users) {
      if (u.is_anonymous === true && u.created_at && new Date(u.created_at) < cutoff) oldAnon.push(u.id);
    }
    if (users.length < perPage) break;
  }

  // 2. Activity filter: keep any guest with a real INTERACTION in the window —
  //    an events row OR an attempt since the cutoff. `selectAll` pages past the
  //    1000-row cap so an active guest's user_id can never be truncated out of
  //    the "keep" set (which would wrongly delete them).
  const active = new Set<string>();
  for (let i = 0; i < oldAnon.length; i += 200) {
    const chunk = oldAnon.slice(i, i + 200);
    const evs = await selectAll<{ user_id: string }>(() =>
      supabase().from("events").select("user_id").in("user_id", chunk).gte("created_at", cutoffIso),
    );
    evs.forEach((r) => active.add(r.user_id));
    const atts = await selectAll<{ user_id: string }>(() =>
      supabase().from("attempts").select("user_id").in("user_id", chunk).gte("created_at", cutoffIso),
    );
    atts.forEach((r) => active.add(r.user_id));
  }
  const eligible = oldAnon.filter((id) => !active.has(id));

  // 3. Delete (apply only), re-confirming anonymity per user.
  let pruned = 0;
  if (apply) {
    for (const id of eligible) {
      const { data: got } = await supabase().auth.admin.getUserById(id);
      if (got?.user?.is_anonymous !== true) continue; // converted since the scan — skip
      const { error: pErr } = await supabase().from("users_profile").delete().eq("id", id); // cascades children
      if (pErr) {
        logger.warn({ err: pErr, id }, "guest prune: profile delete failed");
        continue;
      }
      const { error: uErr } = await supabase().auth.admin.deleteUser(id);
      if (uErr) {
        logger.warn({ err: uErr, id }, "guest prune: auth delete failed (profile already removed)");
        continue;
      }
      pruned++;
    }
  }

  return { oldAnonymous: oldAnon.length, eligible: eligible.length, pruned, retentionDays, applied: apply };
}
