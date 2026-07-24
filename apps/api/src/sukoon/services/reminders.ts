/**
 * Sukoon F11 — reminder crons: daily mood-reminder ping (user's own
 * reminder_time, skipped once they've checked in), journey-step reminder
 * (8pm IST, only if a started journey's step for today is still open), and
 * the exam-eve support ping (7pm IST, the evening before profile.exam_date).
 * Driven by an hourly GitHub Actions job (scripts/sukoon-notifications-run.ts)
 * — the same cadence/rationale as Neev's own notifications.yml: arbitrary
 * user-chosen times and a couple of fixed evening pings both only need an
 * hour's slack, never a per-minute clock.
 *
 * PUSH DELIVERY IS A DELIBERATE, DOCUMENTED EXCEPTION to Sukoon's usual
 * self-containment rule (CLAUDE.md: "no FKs into Neev feature tables"). In
 * INTEGRATED mode Sukoon is mounted inside the same SPA/service-worker as
 * Neev (shell.tsx's own comment: it's a sibling of, not nested inside, Neev's
 * app-shell — but they still share ONE origin and ONE registered service
 * worker), so there is exactly one browser PushSubscription per device
 * regardless of which app section asked for permission. Reusing Neev's
 * push_subscriptions table + lib/push.ts's sendPush (rather than standing up
 * a second, parallel subscription against the same origin — which the Push
 * API doesn't really support well anyway) is the only sane way to reach that
 * device today. This is a READ-ONLY join against existing infra, not a new FK
 * Sukoon's own schema introduces — sukoon_profiles/sukoon_notification_log
 * stay entirely self-contained. A future standalone extraction (a different
 * origin, its own service worker) would need its own subscribe endpoint +
 * storage — flagged as a known follow-up, not attempted here.
 *
 * QUIET HOURS (hard rule): never push between 11pm and 7am IST, no
 * exceptions. A reminder whose condition is true during quiet hours simply
 * isn't sent on this tick — the per-day dedupe log (sukoon_notification_log)
 * means it still only ever fires once, on the next tick after 7am.
 */
import type { SukoonChatLanguage } from "@neev/shared";
import { SUKOON_EXAM_EVE_JOURNEY_SLUG } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { pushConfigured, sendPush } from "../../lib/push.js";
import { IST_OFFSET_MS, istClockUtc, istDayRangeUtc, istToday, shiftDate } from "../../lib/ist.js";
import { getSukoonProfile } from "./profile.js";
import { hasIncompleteStepToday } from "./journeys.js";
import { forEachSukoonUser } from "../lib/users.js";

const QUIET_HOUR_START = 23; // 11pm IST — nothing pushes at/after this hour
const QUIET_HOUR_END = 7; // 7am IST — nothing pushes before this hour

function istHour(now: number): number {
  return new Date(now + IST_OFFSET_MS).getUTCHours();
}

function isQuietHours(now: number): boolean {
  const hour = istHour(now);
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

type ReminderType = "mood_reminder" | "journey_reminder" | "exam_eve";

interface BilingualCopy {
  en: string;
  hi: string;
}

const COPY: Record<ReminderType, { title: BilingualCopy; body: BilingualCopy; link: string }> = {
  mood_reminder: {
    title: { en: "How are you feeling today?", hi: "आज आप कैसा महसूस कर रहे हैं?" },
    body: {
      en: "A quick 10-second check-in — just for you.",
      hi: "बस 10 सेकंड का एक छोटा-सा चेक-इन — सिर्फ़ आपके लिए।",
    },
    link: "/sukoon/mood",
  },
  journey_reminder: {
    title: { en: "Today's step is waiting", hi: "आज का कदम आपका इंतज़ार कर रहा है" },
    body: {
      en: "A few gentle minutes on your journey today.",
      hi: "आज अपनी जर्नी पर कुछ शांत मिनट बिताइए।",
    },
    link: "/sukoon/journeys",
  },
  exam_eve: {
    title: { en: "Exam tomorrow — we're here", hi: "कल परीक्षा है — हम साथ हैं" },
    body: {
      en: "Feeling the nerves? A short Exam-Eve session can help settle them.",
      hi: "घबराहट हो रही है? एक छोटा-सा Exam-Eve सेशन आपको शांत करने में मदद कर सकता है।",
    },
    link: `/sukoon/journeys/${SUKOON_EXAM_EVE_JOURNEY_SLUG}`,
  },
};

/** Maps the CHAT-language preference (hi/en/hinglish) to the 2-key copy
 *  above — hinglish is a conversational chat register, never a UI/content
 *  language (see sukoonChatLanguageSchema's own doc comment), so it degrades
 *  to Hindi for this short, fixed, code-authored notification text. */
function pushLocale(language: SukoonChatLanguage): "hi" | "en" {
  return language === "en" ? "en" : "hi";
}

/** True if this (user, type, IST day) hasn't been sent yet — and claims it
 *  immediately by inserting the row, so a concurrent/retried tick can't send
 *  twice. A 23505 (unique_violation) means another tick already claimed it
 *  today; that's the expected steady-state outcome, not an error. */
async function claim(userId: string, type: ReminderType, day: string): Promise<boolean> {
  const { error } = await supabase().from("sukoon_notification_log").insert({ user_id: userId, type, day });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`sukoon reminder claim failed (${type}): ${error.message}`);
}

async function checkedInToday(userId: string, today: string): Promise<boolean> {
  const { startUtc, endUtc } = istDayRangeUtc(today);
  const { count, error } = await supabase()
    .from("sukoon_mood_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtc);
  if (error) throw new Error(`sukoon reminder mood-check failed: ${error.message}`);
  return (count ?? 0) > 0;
}

function parseReminderTime(reminderTime: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})/.exec(reminderTime);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

/**
 * The user's current push subscriptions, or `null` if there is nowhere to
 * deliver anything (push not configured, lookup failed, or genuinely zero
 * subscriptions). Fetched ONCE per user per tick and checked BEFORE any
 * `claim()` — see processUser's header note on why: claiming first would
 * permanently burn today's slot for a user who has no device yet, even
 * though they might subscribe later the same day.
 */
async function loadPushSubscriptions(userId: string): Promise<PushSubscriptionRow[] | null> {
  if (!pushConfigured()) return null;
  const { data, error } = await supabase()
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth_key")
    .eq("user_id", userId);
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon reminder: push subscription lookup failed");
    return null;
  }
  const subs = (data as PushSubscriptionRow[] | null) ?? [];
  return subs.length > 0 ? subs : null;
}

async function pushToUser(subs: PushSubscriptionRow[], type: ReminderType, locale: "hi" | "en"): Promise<void> {
  const copy = COPY[type];
  const payload = {
    type: `sukoon_${type}`,
    title: copy.title[locale],
    body: copy.body[locale],
    link: copy.link,
    tag: `sukoon_${type}`,
  };
  // Pruning a "gone" endpoint is Neev's own push sender's job (push/sender.ts,
  // its own hourly tick) — duplicating that delete here would race it for no
  // benefit; a stale endpoint just 410s harmlessly until then.
  for (const sub of subs) {
    await sendPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, authKey: sub.auth_key }, payload);
  }
}

async function processUser(userId: string, now: number): Promise<void> {
  const profile = await getSukoonProfile(userId);
  if (!profile) return; // not onboarded — nothing to remind

  // Nothing to deliver to today — skip entirely WITHOUT claiming anything,
  // so a user who subscribes to push later the same day can still get a
  // reminder whose condition was already true (claim() is a one-shot lock;
  // burning it against an empty audience would silently lose that day's
  // nudge for good, for no benefit — there's no in-app fallback surface
  // this log backs, unlike Neev's own bell-backed notification_schedule).
  const subs = await loadPushSubscriptions(userId);
  if (!subs) return;

  const today = istToday();
  const locale = pushLocale(profile.language);

  // 1. Mood check-in — the user's own reminder_time, skipped once checked in.
  if (profile.reminder_time && profile.mood_reminder_enabled) {
    const parsed = parseReminderTime(profile.reminder_time);
    if (parsed) {
      const dueAt = Date.parse(istClockUtc(today, parsed.hour, parsed.minute));
      if (now >= dueAt && !(await checkedInToday(userId, today)) && (await claim(userId, "mood_reminder", today))) {
        await pushToUser(subs, "mood_reminder", locale);
      }
    }
  }

  // 2. Journey step — 8pm IST, only if something started is still open today.
  if (profile.journey_reminder_enabled) {
    const eightPm = Date.parse(istClockUtc(today, 20, 0));
    if (now >= eightPm && (await hasIncompleteStepToday(userId)) && (await claim(userId, "journey_reminder", today))) {
      await pushToUser(subs, "journey_reminder", locale);
    }
  }

  // 3. Exam-eve support ping — 7pm IST, the evening before exam_date.
  if (profile.exam_eve_reminder_enabled && profile.exam_date === shiftDate(today, 1)) {
    const sevenPm = Date.parse(istClockUtc(today, 19, 0));
    if (now >= sevenPm && (await claim(userId, "exam_eve", today))) {
      await pushToUser(subs, "exam_eve", locale);
    }
  }
}

export interface RunRemindersResult {
  processed: number;
  quiet_hours: boolean;
}

export async function runSukoonReminders(now: number = Date.now()): Promise<RunRemindersResult> {
  if (isQuietHours(now)) {
    logger.info("sukoon reminders: quiet hours (11pm–7am IST) — skipping this tick");
    return { processed: 0, quiet_hours: true };
  }

  let processed = 0;
  await forEachSukoonUser(
    "sukoon reminders",
    async (userId) => {
      await processUser(userId, now);
      processed++;
    },
    { throwOnListFailure: true }, // a one-shot CLI run should exit non-zero on a real list failure, not exit 0 having silently done nothing
  );
  return { processed, quiet_hours: false };
}
