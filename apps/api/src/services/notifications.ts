/**
 * Scheduled in-app notifications. generateForUser is idempotent per
 * (user, dedupe_key) and also RESOLVES nudges whose condition no longer holds
 * (quiz done, no SRS due, activity logged) so the bell stays accurate. It runs
 * on every GET /notifications (self-heal) and hourly from the scheduler.
 */
import type { BilingualText, Notification, NotificationType } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { istClockUtc, istToday } from "../lib/ist.js";
import { getDailyProgress, hadActivity } from "./daily-progress.js";

/** IST wall-clock times each nudge is scheduled for. */
const TIMES = { quiz_ready: [5, 0], srs_due: [7, 0], streak_at_risk: [20, 0] } as const;

const NOTIFICATION_COLUMNS =
  "id, type, status, scheduled_for, title_i18n, body_i18n, link, created_at";

interface EnqueueInput {
  userId: string;
  type: NotificationType;
  scheduledFor: string;
  dedupeKey: string;
  title_i18n: BilingualText;
  body_i18n: BilingualText;
  link: string | null;
}

/** Insert a notification, keeping any existing row for the same (user, dedupe_key) untouched (so a dismiss sticks). */
async function enqueue(input: EnqueueInput): Promise<void> {
  const { error } = await supabase()
    .from("notification_schedule")
    .upsert(
      {
        user_id: input.userId,
        type: input.type,
        scheduled_for: input.scheduledFor,
        dedupe_key: input.dedupeKey,
        title_i18n: input.title_i18n,
        body_i18n: input.body_i18n,
        link: input.link,
      },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    );
  if (error) throw new HttpError(500, `notification enqueue failed: ${error.message}`);
}

/** Mark a still-pending nudge as read once its reason is gone. */
async function resolve(userId: string, dedupeKey: string): Promise<void> {
  const { error } = await supabase()
    .from("notification_schedule")
    .update({ status: "read" })
    .eq("user_id", userId)
    .eq("dedupe_key", dedupeKey)
    .eq("status", "pending");
  if (error) throw new HttpError(500, `notification resolve failed: ${error.message}`);
}

export async function generateForUser(userId: string, now: number = Date.now()): Promise<void> {
  const today = istToday();
  const progress = await getDailyProgress(userId, today);
  const active = hadActivity(progress);

  // 1. Quiz ready — today's quiz exists but isn't done.
  const quizKey = `quiz_ready:${today}`;
  if (progress.daily_quiz_test_id && !progress.daily_quiz_done) {
    await enqueue({
      userId,
      type: "quiz_ready",
      scheduledFor: istClockUtc(today, TIMES.quiz_ready[0], TIMES.quiz_ready[1]),
      dedupeKey: quizKey,
      title_i18n: { en: "Today's quiz is ready", hi: "आज की क्विज़ तैयार है" },
      body_i18n: { en: "A fresh daily quiz is waiting — keep your streak going.", hi: "एक नई डेली क्विज़ तैयार है — अपनी स्ट्रीक जारी रखें।" },
      link: `/practice/test/${progress.daily_quiz_test_id}`,
    });
  } else {
    await resolve(userId, quizKey);
  }

  // 2. SRS due — cards are due for revision.
  const srsKey = `srs_due:${today}`;
  if (progress.srs_due > 0) {
    await enqueue({
      userId,
      type: "srs_due",
      scheduledFor: istClockUtc(today, TIMES.srs_due[0], TIMES.srs_due[1]),
      dedupeKey: srsKey,
      title_i18n: { en: "Revision due", hi: "रिवीजन बकाया" },
      body_i18n: {
        en: `${progress.srs_due} card${progress.srs_due === 1 ? "" : "s"} due for revision today.`,
        hi: `आज ${progress.srs_due} कार्ड रिवीजन के लिए बकाया हैं।`,
      },
      link: `/revision`,
    });
  } else {
    await resolve(userId, srsKey);
  }

  // 3. Streak at risk — after ~8 PM IST with no qualifying activity today.
  const streakKey = `streak_at_risk:${today}`;
  const eightPm = Date.parse(istClockUtc(today, TIMES.streak_at_risk[0], TIMES.streak_at_risk[1]));
  if (!active && now >= eightPm) {
    await enqueue({
      userId,
      type: "streak_at_risk",
      scheduledFor: new Date(eightPm).toISOString(),
      dedupeKey: streakKey,
      title_i18n: { en: "Your streak is at risk", hi: "आपकी स्ट्रीक ख़तरे में है" },
      body_i18n: {
        en: "You haven't studied today yet — a quick quiz or one answer keeps your streak alive.",
        hi: "आपने आज अभी तक पढ़ाई नहीं की — एक छोटी क्विज़ या एक उत्तर आपकी स्ट्रीक बचा लेगा।",
      },
      link: `/dashboard`,
    });
  } else if (active) {
    await resolve(userId, streakKey);
  }
}

interface NotificationRow {
  id: string;
  type: Notification["type"];
  status: Notification["status"];
  scheduled_for: string;
  title_i18n: BilingualText;
  body_i18n: BilingualText;
  link: string | null;
  created_at: string;
}

/** Active notifications: pending + due (scheduled_for has passed), newest first. */
export async function listActive(userId: string, now: number = Date.now()): Promise<{ items: Notification[]; unread_count: number }> {
  const { data, error } = await supabase()
    .from("notification_schedule")
    .select(NOTIFICATION_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "pending")
    .lte("scheduled_for", new Date(now).toISOString())
    .order("scheduled_for", { ascending: false });
  if (error) throw new HttpError(500, `notification list failed: ${error.message}`);
  const items = (data ?? []) as NotificationRow[];
  return { items, unread_count: items.length };
}

export async function setStatus(
  userId: string,
  id: string,
  status: "read" | "dismissed",
): Promise<Notification> {
  const { data, error } = await supabase()
    .from("notification_schedule")
    .update({ status })
    .eq("id", id)
    .eq("user_id", userId)
    .select(NOTIFICATION_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, `notification update failed: ${error.message}`);
  if (!data) throw notFound("Notification not found");
  return data as NotificationRow;
}
