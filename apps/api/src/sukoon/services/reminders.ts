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
 *
 * TONE (hard rule, audited 2026-07-25): every string below is wellness
 * habit-building copy, never Neev's own competitive-streak voice. No guilt or
 * shame framing anywhere — no "you broke your streak," no achievement-loss
 * language, no implication that skipping a day is a failure. A missed nudge
 * is just re-offered warmly, with no pressure and no reference to what was
 * missed.
 *
 * REPETITION GUARD: each type now has a few bilingual COPY variants instead
 * of one fixed string. Before sending, the candidate variant is compared
 * (cosine similarity over an embedding from ../../lib/embeddings.ts) against
 * the user's last few ACTUALLY-SENT notifications (any type — a nudge that
 * *feels* like the last one is still a repeat from the user's side); the
 * least-similar variant is chosen, and the send is skipped entirely if even
 * that one still reads as basically the same message. This is deliberately
 * lightweight, not a new subsystem: no vector column, no RPC — variant texts
 * are a small, fixed, closed set, so `variantEmbeddingCache` memoizes each
 * (type, variant, locale) embedding for the lifetime of one cron run, meaning
 * the actual embed call for a given variant happens at most once per run no
 * matter how many users are processed (forEachSukoonUser is a plain
 * sequential loop, so there's no concurrent-access race on that cache).
 */
import type { SukoonChatLanguage } from "@neev/shared";
import { SUKOON_EXAM_EVE_JOURNEY_SLUG } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { pushConfigured, sendPush } from "../../lib/push.js";
import { embeddings } from "../../lib/embeddings.js";
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

interface ReminderVariant {
  title: BilingualCopy;
  body: BilingualCopy;
}

/**
 * Every variant is warm, no-pressure re-invitation copy — never guilt/shame
 * framing (see the file header's TONE note). `link` is fixed per type; only
 * the title/body rotate, picked at send time by `pickVariant` below.
 */
const COPY: Record<ReminderType, { variants: ReminderVariant[]; link: string }> = {
  mood_reminder: {
    variants: [
      {
        title: { en: "How are you feeling today?", hi: "आज आप कैसा महसूस कर रहे हैं?" },
        body: {
          en: "A quick 10-second check-in — just for you.",
          hi: "बस 10 सेकंड का एक छोटा-सा चेक-इन — सिर्फ़ आपके लिए।",
        },
      },
      {
        title: { en: "A quiet moment for you", hi: "आपके लिए एक शांत पल" },
        body: {
          en: "No rush — whenever you're ready, we're here to listen.",
          hi: "कोई जल्दी नहीं — जब भी आप तैयार हों, हम सुनने के लिए यहाँ हैं।",
        },
      },
      {
        title: { en: "Just checking in", hi: "बस एक हाल-चाल" },
        body: {
          en: "However today's going, a few seconds is all it takes.",
          hi: "आज दिन कैसा भी रहा हो, बस कुछ सेकंड काफ़ी हैं।",
        },
      },
    ],
    link: "/sukoon/mood",
  },
  journey_reminder: {
    variants: [
      {
        title: { en: "Today's step is waiting", hi: "आज का कदम आपका इंतज़ार कर रहा है" },
        body: {
          en: "A few gentle minutes on your journey today.",
          hi: "आज अपनी जर्नी पर कुछ शांत मिनट बिताइए।",
        },
      },
      {
        title: { en: "A small moment of calm today", hi: "आज शांति का एक छोटा पल" },
        body: {
          en: "Your journey's next step is here, whenever you'd like it.",
          hi: "आपकी जर्नी का अगला कदम यहाँ है, जब भी आप चाहें।",
        },
      },
      {
        title: { en: "Continue whenever you like", hi: "जब मन हो, जारी रखिए" },
        body: {
          en: "A short, gentle step from your journey — no pressure, just an option.",
          hi: "आपकी जर्नी से एक छोटा, शांत कदम — कोई दबाव नहीं, बस एक विकल्प।",
        },
      },
    ],
    link: "/sukoon/journeys",
  },
  exam_eve: {
    variants: [
      {
        title: { en: "Exam tomorrow — we're here", hi: "कल परीक्षा है — हम साथ हैं" },
        body: {
          en: "Feeling the nerves? A short Exam-Eve session can help settle them.",
          hi: "घबराहट हो रही है? एक छोटा-सा Exam-Eve सेशन आपको शांत करने में मदद कर सकता है।",
        },
      },
      {
        title: { en: "Tomorrow's the day — take a breath", hi: "कल का दिन है — एक गहरी साँस लीजिए" },
        body: {
          en: "A short Exam-Eve session is here if you'd like a moment to settle.",
          hi: "अगर मन को शांत करने के लिए एक पल चाहिए, तो छोटा Exam-Eve सेशन यहाँ मौजूद है।",
        },
      },
    ],
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

/** True if this (user, type, IST day) hasn't been decided yet — and claims it
 *  immediately by inserting the row, so a concurrent/retried tick can't send
 *  (or re-skip) twice. A 23505 (unique_violation) means another tick already
 *  claimed it today; that's the expected steady-state outcome, not an error.
 *  `variantKey` is the picked variant's index as a string, or `null` when the
 *  slot is being claimed as "decided, but nothing sent" (repetition skip). */
async function claim(userId: string, type: ReminderType, day: string, variantKey: string | null): Promise<boolean> {
  const { error } = await supabase()
    .from("sukoon_notification_log")
    .insert({ user_id: userId, type, day, variant_key: variantKey });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`sukoon reminder claim failed (${type}): ${error.message}`);
}

/** How many of the user's most-recent ACTUALLY-SENT notifications (any type)
 *  to compare a new candidate against. */
const REPETITION_HISTORY_LIMIT = 5;

/** Cosine similarity at/above which a candidate variant is judged "basically
 *  the same message" as something recently sent, and the send is skipped
 *  outright rather than repeated (mirrors the mentor FAQ cache's near-
 *  duplicate floor — see CLAUDE.md's Session 26.5 log). */
const REPETITION_SKIP_THRESHOLD = 0.93;

interface SentVariantRow {
  type: ReminderType;
  variant_key: string;
}

/** The user's last few actually-sent notifications, oldest-filtered-out —
 *  rows with `variant_key = null` (a pre-guard row, or a prior skip) never
 *  represent something the user actually received, so they're excluded here
 *  rather than compared against. Fails open to "no history" on any error, so
 *  a lookup failure degrades to "send the default variant," never blocks a
 *  reminder. */
async function recentSentVariants(userId: string): Promise<SentVariantRow[]> {
  const { data, error } = await supabase()
    .from("sukoon_notification_log")
    .select("type, variant_key")
    .eq("user_id", userId)
    .not("variant_key", "is", null)
    .order("created_at", { ascending: false })
    .limit(REPETITION_HISTORY_LIMIT);
  if (error) {
    logger.warn({ err: error.message, userId }, "sukoon reminder: repetition history lookup failed");
    return [];
  }
  return (data as SentVariantRow[] | null) ?? [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? -1 : dot / denom;
}

/** Memoizes one embedding per (type, variant index, locale) for the lifetime
 *  of a single cron run — see the file header's REPETITION GUARD note on why
 *  this keeps the whole feature to "a small embed + compare" regardless of
 *  user count. Returns null for an out-of-range index (e.g. a history row
 *  referencing a variant that's since been trimmed from COPY) so callers can
 *  simply skip that comparison rather than throw. */
const variantEmbeddingCache = new Map<string, number[]>();

async function getVariantEmbedding(type: ReminderType, index: number, locale: "hi" | "en"): Promise<number[] | null> {
  const variant = COPY[type].variants[index];
  if (!variant) return null;
  const key = `${type}:${index}:${locale}`;
  const cached = variantEmbeddingCache.get(key);
  if (cached) return cached;
  const [vec] = await embeddings().embed([`${variant.title[locale]} ${variant.body[locale]}`]);
  variantEmbeddingCache.set(key, vec);
  return vec;
}

interface VariantPick {
  index: number;
  /** true = every variant read as too similar to recent history; send nothing today. */
  skip: boolean;
}

/**
 * Picks the least-repetitive of `type`'s variants for `userId`, by comparing
 * each candidate's embedding against the user's last few actually-sent
 * notifications (see REPETITION_HISTORY_LIMIT). No history yet, or only one
 * variant exists → variant 0 with no comparison needed. FAILS OPEN on any
 * embedding error: send the default variant rather than lose the reminder.
 */
async function pickVariant(userId: string, type: ReminderType, locale: "hi" | "en"): Promise<VariantPick> {
  const variants = COPY[type].variants;
  if (variants.length <= 1) return { index: 0, skip: false };

  try {
    const history = await recentSentVariants(userId);
    if (history.length === 0) return { index: 0, skip: false };

    let best: { index: number; maxSim: number } | null = null;
    for (let i = 0; i < variants.length; i++) {
      const candidate = await getVariantEmbedding(type, i, locale);
      if (!candidate) continue;
      let maxSim = -Infinity;
      for (const h of history) {
        const historic = await getVariantEmbedding(h.type, Number(h.variant_key), locale);
        if (!historic) continue;
        maxSim = Math.max(maxSim, cosineSimilarity(candidate, historic));
      }
      if (!best || maxSim < best.maxSim) best = { index: i, maxSim };
    }
    if (!best) return { index: 0, skip: false };
    return { index: best.index, skip: best.maxSim >= REPETITION_SKIP_THRESHOLD };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, userId, type },
      "sukoon reminder: repetition check failed; sending default variant",
    );
    return { index: 0, skip: false };
  }
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

async function pushToUser(
  subs: PushSubscriptionRow[],
  type: ReminderType,
  locale: "hi" | "en",
  variantIndex: number,
): Promise<void> {
  const variant = COPY[type].variants[variantIndex] ?? COPY[type].variants[0];
  const payload = {
    type: `sukoon_${type}`,
    title: variant.title[locale],
    body: variant.body[locale],
    link: COPY[type].link,
    tag: `sukoon_${type}`,
  };
  // Pruning a "gone" endpoint is Neev's own push sender's job (push/sender.ts,
  // its own hourly tick) — duplicating that delete here would race it for no
  // benefit; a stale endpoint just 410s harmlessly until then.
  for (const sub of subs) {
    await sendPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, authKey: sub.auth_key }, payload);
  }
}

/** Picks a non-repetitive variant, claims today's (user, type) slot — storing
 *  which variant was picked, or `null` if the repetition guard skipped it —
 *  and pushes only when the slot was actually free and a variant cleared the
 *  guard. Sharing this one path across all three reminder types (rather than
 *  each duplicating pick→claim→push) is what keeps the guard's ordering
 *  (pick BEFORE claim, so the claimed row always records the real outcome)
 *  from drifting between call sites. */
async function sendReminder(
  userId: string,
  type: ReminderType,
  today: string,
  locale: "hi" | "en",
  subs: PushSubscriptionRow[],
): Promise<void> {
  const pick = await pickVariant(userId, type, locale);
  const variantKey = pick.skip ? null : String(pick.index);
  if (!(await claim(userId, type, today, variantKey))) return; // another tick already decided today
  if (pick.skip) {
    logger.info({ userId, type }, "sukoon reminder: skipped — too similar to a recently sent notification");
    return;
  }
  await pushToUser(subs, type, locale, pick.index);
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
      if (now >= dueAt && !(await checkedInToday(userId, today))) {
        await sendReminder(userId, "mood_reminder", today, locale, subs);
      }
    }
  }

  // 2. Journey step — 8pm IST, only if something started is still open today.
  if (profile.journey_reminder_enabled) {
    const eightPm = Date.parse(istClockUtc(today, 20, 0));
    if (now >= eightPm && (await hasIncompleteStepToday(userId))) {
      await sendReminder(userId, "journey_reminder", today, locale, subs);
    }
  }

  // 3. Exam-eve support ping — 7pm IST, the evening before exam_date.
  if (profile.exam_eve_reminder_enabled && profile.exam_date === shiftDate(today, 1)) {
    const sevenPm = Date.parse(istClockUtc(today, 19, 0));
    if (now >= sevenPm) {
      await sendReminder(userId, "exam_eve", today, locale, subs);
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
