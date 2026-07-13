/**
 * Drains notification_schedule (the same rows the in-app bell reads,
 * apps/api/src/services/notifications.ts) and fires a real browser push for
 * every row that's newly due, respecting each user's per-type opt-out and
 * pruning subscriptions the push service reports as gone. Runs from the
 * daily scheduler's hourly tick (dev) — a production deploy would run this
 * as its own scheduled job, same policy as the CA/daily-build schedulers.
 */
import type { PushPreferences, NotificationType } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { pushConfigured, sendPush } from "../lib/push.js";

interface DueRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title_i18n: Record<string, string>;
  body_i18n: Record<string, string>;
  link: string | null;
}

export async function runPushSender(now: number = Date.now()): Promise<{ sent: number; skipped: number }> {
  if (!pushConfigured()) return { sent: 0, skipped: 0 };

  const { data: due, error } = await supabase()
    .from("notification_schedule")
    .select("id, user_id, type, title_i18n, body_i18n, link")
    .eq("status", "pending")
    .is("pushed_at", null)
    .lte("scheduled_for", new Date(now).toISOString())
    .limit(500);
  if (error) throw new Error(`push sender: fetch due rows failed: ${error.message}`);
  const rows = (due ?? []) as DueRow[];
  if (rows.length === 0) return { sent: 0, skipped: 0 };

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [profilesRes, prefsRes, subsRes] = await Promise.all([
    supabase().from("users_profile").select("id, preferred_locale").in("id", userIds),
    supabase().from("push_preferences").select("user_id, quiz_ready, streak_at_risk, srs_due").in("user_id", userIds),
    supabase().from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth_key").in("user_id", userIds),
  ]);
  if (profilesRes.error) throw new Error(`push sender: profiles fetch failed: ${profilesRes.error.message}`);
  if (prefsRes.error) throw new Error(`push sender: prefs fetch failed: ${prefsRes.error.message}`);
  if (subsRes.error) throw new Error(`push sender: subs fetch failed: ${subsRes.error.message}`);

  const localeByUser = new Map((profilesRes.data ?? []).map((p) => [p.id as string, (p.preferred_locale as string) ?? "en"]));
  const prefsByUser = new Map(
    (prefsRes.data ?? []).map((p) => [p.user_id as string, p as unknown as PushPreferences & { user_id: string }]),
  );
  const subsByUser = new Map<string, { id: string; endpoint: string; p256dh: string; auth_key: string }[]>();
  for (const s of subsRes.data ?? []) {
    const list = subsByUser.get(s.user_id as string) ?? [];
    list.push(s as never);
    subsByUser.set(s.user_id as string, list);
  }

  let sent = 0;
  let skipped = 0;
  const goneSubscriptionIds: string[] = [];
  const pushedIds: string[] = [];

  for (const row of rows) {
    const prefs = prefsByUser.get(row.user_id);
    const optedIn = prefs ? prefs[row.type] !== false : true;
    const subs = subsByUser.get(row.user_id) ?? [];
    if (!optedIn || subs.length === 0) {
      // Nothing to retry here — there's no device to reach regardless of when
      // this runs again, so this row is done.
      pushedIds.push(row.id);
      skipped++;
      continue;
    }
    const locale = localeByUser.get(row.user_id) ?? "en";
    const payload = {
      type: row.type,
      title: row.title_i18n[locale] ?? row.title_i18n.en,
      body: row.body_i18n[locale] ?? row.body_i18n.en,
      link: row.link,
      tag: row.type,
    };
    // Only mark this row done if it reached at least one device — a
    // transient send failure ("error": network blip, push service hiccup)
    // must NOT be marked pushed_at, or it silently never retries. A "gone"
    // subscription is pruned but still counts as "handled" for this row
    // (nothing more to do with a dead endpoint); if every subscription for
    // this user is gone, the row is left unmarked so it's revisited once
    // they (re)subscribe on a new device before scheduled_for's IST-day nudge
    // window closes.
    let delivered = false;
    for (const sub of subs) {
      const result = await sendPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, authKey: sub.auth_key }, payload);
      if (result === "sent") {
        sent++;
        delivered = true;
      } else if (result === "gone") {
        goneSubscriptionIds.push(sub.id);
      }
    }
    if (delivered) pushedIds.push(row.id);
  }

  await supabase()
    .from("notification_schedule")
    .update({ pushed_at: new Date().toISOString() })
    .in("id", pushedIds);
  if (goneSubscriptionIds.length > 0) {
    await supabase().from("push_subscriptions").delete().in("id", goneSubscriptionIds);
  }

  logger.info(`push sender: ${sent} sent, ${skipped} skipped (opted out / no device), ${goneSubscriptionIds.length} stale subscriptions pruned`);
  return { sent, skipped };
}
