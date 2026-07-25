import { z } from "zod";
import { apiEnvelopeSchema } from "./types";

/**
 * Sukoon (wellness companion) shared contract — see SUKOON_CONTEXT.md /
 * sukoon-build-blueprint.md. Lives in @neev/shared like every other feature's
 * schemas (the shared package is a neutral util, not a Neev *feature* module,
 * so importing it from the Sukoon frontend/backend respects the isolation
 * rule). If Sukoon is ever extracted to a standalone repo, this one file moves
 * with it.
 */

/**
 * CHAT language preference (what Saathi replies in) — NOT the UI language. The
 * UI still follows Neev's global hi/en toggle; Hinglish is a conversational
 * register only, never a UI locale.
 */
export const sukoonChatLanguageSchema = z.enum(["hi", "en", "hinglish"]);
export type SukoonChatLanguage = z.infer<typeof sukoonChatLanguageSchema>;

/** A local wall-clock reminder time, "HH:MM" (24h). */
const reminderTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

/** An ISO calendar date, "YYYY-MM-DD". */
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/**
 * WHO-5 Wellbeing Index (public-domain, wellness-framed — NOT a clinical
 * screener). Exactly 5 items, each 0 ("at no time") … 5 ("all of the time").
 */
export const who5AnswersSchema = z.array(z.number().int().min(0).max(5)).length(5);
export type Who5Answers = z.infer<typeof who5AnswersSchema>;

/** The Sukoon profile row returned to the client (sukoon_profiles). */
export const sukoonProfileSchema = z.object({
  user_id: z.string().uuid(),
  language: sukoonChatLanguageSchema,
  exam: z.string().nullable(),
  exam_attempt: z.number().int().nullable(),
  exam_date: z.string().nullable(),
  restricted_mode: z.boolean(),
  voice_pref: z.string().nullable(),
  reminder_time: z.string().nullable(),
  // F11 per-type push-reminder opt-outs (Settings → notification preferences).
  // All default true server-side; the cron (services/reminders.ts) checks
  // these BEFORE ever computing whether a nudge is due, so turning one off
  // here is a hard stop, not just a UI hint.
  mood_reminder_enabled: z.boolean(),
  journey_reminder_enabled: z.boolean(),
  exam_eve_reminder_enabled: z.boolean(),
  // F9 weekly insights (Plus+). `insights_opt_in` gates whether the Sunday job
  // generates an insight at all (default on — it's a paid benefit the user
  // asked for by subscribing, but honoured as opt-out). `deep_insights_opt_in`
  // is the STRICTER, separate consent (Pro only) to let the model read
  // decrypted journal bodies, not just metadata — default OFF, and meaningless
  // unless the tier is pro (enforced server-side, never by trusting this flag).
  insights_opt_in: z.boolean(),
  deep_insights_opt_in: z.boolean(),
  onboarding_completed: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SukoonProfile = z.infer<typeof sukoonProfileSchema>;

/**
 * Onboarding submission (F1). `age_confirmed_18` false → the server sets
 * restricted_mode=true (under-18: no open chat; DPDP caution). `consent_accepted`
 * MUST be literal true — the consent version itself is a server-side constant,
 * never sent by the client, so the client can only ATTEST, not choose a version.
 */
export const sukoonOnboardingBodySchema = z.object({
  language: sukoonChatLanguageSchema,
  consent_accepted: z.literal(true),
  age_confirmed_18: z.boolean(),
  who5: who5AnswersSchema.nullable().optional(),
  exam: z.string().trim().min(1).max(120).nullable().optional(),
  exam_attempt: z.number().int().min(0).max(20).nullable().optional(),
  exam_date: isoDateSchema.nullable().optional(),
  reminder_time: reminderTimeSchema.nullable().optional(),
});
export type SukoonOnboardingBody = z.infer<typeof sukoonOnboardingBodySchema>;

/**
 * PATCH /profile — a partial patch of user-editable fields. restricted_mode is
 * DELIBERATELY not here: it is set once by the onboarding age gate and must not
 * be client-flippable (that would let an under-18 account unlock open chat).
 */
export const sukoonProfileUpdateBodySchema = z
  .object({
    language: sukoonChatLanguageSchema.optional(),
    exam: z.string().trim().min(1).max(120).nullable().optional(),
    exam_attempt: z.number().int().min(0).max(20).nullable().optional(),
    exam_date: isoDateSchema.nullable().optional(),
    reminder_time: reminderTimeSchema.nullable().optional(),
    voice_pref: z.string().max(60).nullable().optional(),
    mood_reminder_enabled: z.boolean().optional(),
    journey_reminder_enabled: z.boolean().optional(),
    exam_eve_reminder_enabled: z.boolean().optional(),
    // The insights + deep-insights consent toggles live in Settings (F9/F4).
    // deep_insights_opt_in can be SET to true by any tier, but the Sunday job
    // only honours it for pro (the tier check is the real gate — see
    // services/insights.ts); persisting the preference for a plus user who
    // later upgrades is fine and avoids re-asking.
    insights_opt_in: z.boolean().optional(),
    deep_insights_opt_in: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
export type SukoonProfileUpdateBody = z.infer<typeof sukoonProfileUpdateBodySchema>;

/**
 * GET /profile returns { profile } where profile is null before onboarding —
 * a normal, expected state (not a 404), which the onboarding gate reads to
 * decide whether to redirect. Wrapping it keeps the envelope's `data` a stable
 * object shape rather than a nullable that the typed api client would mis-narrow.
 */
export const sukoonProfileResponseSchema = apiEnvelopeSchema(
  z.object({ profile: sukoonProfileSchema.nullable() }),
);
export type SukoonProfileResponse = z.infer<typeof sukoonProfileResponseSchema>;

/** POST /onboarding and PATCH /profile both return the freshly-written profile. */
export const sukoonProfileWriteResponseSchema = apiEnvelopeSchema(sukoonProfileSchema);
export type SukoonProfileWriteResponse = z.infer<typeof sukoonProfileWriteResponseSchema>;

// ---------------------------------------------------------------------------
// F3 — Crisis detection & escalation (safety spine). Shared because BOTH the
// backend engine (which returns an assessment) and the frontend (which must
// decide takeover vs inline card from the level) need the same vocabulary. The
// DB constraint on sukoon_crisis_events.level is the moderate+low+high+critical
// subset — `none` here is the "no signal" case that is never written to the
// table (see the engine).
// ---------------------------------------------------------------------------

/** Crisis severity, lowest → highest. `none` = no signal (never logged). */
export const sukoonCrisisLevelSchema = z.enum(["none", "low", "moderate", "high", "critical"]);
export type SukoonCrisisLevel = z.infer<typeof sukoonCrisisLevelSchema>;

/** Which detection layer produced the FINAL (max) level. `none` when level is none. */
export const sukoonCrisisLayerSchema = z.enum(["keyword", "classifier", "none"]);
export type SukoonCrisisLayer = z.infer<typeof sukoonCrisisLayerSchema>;

/**
 * The ONE ordered list — every comparison (`max of both layers`, "never below
 * the keyword result") derives from this, so a level's rank is defined in
 * exactly one place. Index === rank.
 */
export const SUKOON_CRISIS_LEVELS = ["none", "low", "moderate", "high", "critical"] as const;

/** Numeric rank of a level (0 = none … 4 = critical). */
export function crisisLevelRank(level: SukoonCrisisLevel): number {
  return SUKOON_CRISIS_LEVELS.indexOf(level);
}

/** The more severe of two levels — the engine's "final = max(keyword, classifier)". */
export function maxCrisisLevel(a: SukoonCrisisLevel, b: SukoonCrisisLevel): SukoonCrisisLevel {
  return crisisLevelRank(a) >= crisisLevelRank(b) ? a : b;
}

/**
 * How the UI must react to a level (the blueprint's escalation ladder):
 *   none/low  → "none"     — no interruption (low only softens Saathi's tone).
 *   moderate  → "inline"   — an inline resource card woven into the reply.
 *   high/crit → "takeover" — a full-screen, acknowledge-to-continue takeover.
 */
export type SukoonCrisisSurface = "none" | "inline" | "takeover";
export function crisisSurface(level: SukoonCrisisLevel): SukoonCrisisSurface {
  if (level === "high" || level === "critical") return "takeover";
  if (level === "moderate") return "inline";
  return "none";
}

/**
 * The helpline directory shown by the crisis UI — a single, bilingual source of
 * truth (Tele-MANAS 14416 ALWAYS first per the safety rules; 112 emergency
 * last). `tel` is the dialable form for a `tel:` link; `phone` is the
 * human-readable form. These are public national helpline numbers, not secrets.
 */
export interface SukoonHelpline {
  id: string;
  name_hi: string;
  name_en: string;
  /** Human-readable, e.g. "1860-2662-345". */
  phone: string;
  /** Dialable digits for `tel:` (no spaces/dashes). */
  tel: string;
  note_hi?: string;
  note_en?: string;
}

export const SUKOON_HELPLINES: readonly SukoonHelpline[] = [
  {
    id: "tele_manas",
    name_hi: "टेली-मानस (सरकारी हेल्पलाइन)",
    name_en: "Tele-MANAS (Govt. helpline)",
    phone: "14416",
    tel: "14416",
    note_hi: "24×7 · निःशुल्क · कई भारतीय भाषाएँ",
    note_en: "24×7 · free · many Indian languages",
  },
  {
    id: "vandrevala",
    name_hi: "वंद्रेवाला फ़ाउंडेशन",
    name_en: "Vandrevala Foundation",
    phone: "1860-2662-345",
    tel: "18602662345",
    note_hi: "24×7 · कॉल और व्हाट्सएप",
    note_en: "24×7 · call & WhatsApp",
  },
  {
    id: "icall",
    name_hi: "iCALL (टीआईएसएस)",
    name_en: "iCALL (TISS)",
    phone: "9152987821",
    tel: "9152987821",
    note_hi: "सोम–शनि · सुबह 10 – रात 8",
    note_en: "Mon–Sat · 10am – 8pm",
  },
  {
    id: "aasra",
    name_hi: "आसरा",
    name_en: "AASRA",
    phone: "9820466726",
    tel: "9820466726",
    note_hi: "24×7",
    note_en: "24×7",
  },
  {
    id: "emergency",
    name_hi: "आपातकालीन सेवाएँ",
    name_en: "Emergency services",
    phone: "112",
    tel: "112",
    note_hi: "तुरंत ख़तरे में",
    note_en: "immediate danger",
  },
] as const;

/**
 * The engine's verdict for one message — returned by the future chat pipeline
 * and by the dev test endpoint. `reason` is a short machine/human note (why the
 * level was assigned); `rate_limited` is the anti-doom-loop flag (3+ high/
 * critical events in the last 24h → chat should pivot to static resources).
 */
export const sukoonCrisisAssessmentSchema = z.object({
  level: sukoonCrisisLevelSchema,
  reason: z.string(),
  layer: sukoonCrisisLayerSchema,
  rate_limited: z.boolean(),
});
export type SukoonCrisisAssessment = z.infer<typeof sukoonCrisisAssessmentSchema>;

/** POST /dev/crisis/assess — a dev-only probe: text in, live assessment out. */
export const sukoonCrisisAssessBodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
});
export type SukoonCrisisAssessBody = z.infer<typeof sukoonCrisisAssessBodySchema>;

export const sukoonCrisisAssessResponseSchema = apiEnvelopeSchema(sukoonCrisisAssessmentSchema);
export type SukoonCrisisAssessResponse = z.infer<typeof sukoonCrisisAssessResponseSchema>;

// ---------------------------------------------------------------------------
// F2 — Saathi chat. Shared because the streaming chat UI, the history/
// conversation views, and the cap-reached state all need the same vocabulary
// as the backend (message shape, tier caps, the SSE event payloads). The tier
// literal mirrors sukoon_subscriptions.tier; caps live server-side (LIMITS),
// surfaced to the client only via GET /chat/usage.
// ---------------------------------------------------------------------------

/** Sukoon subscription tier (mirrors sukoon_subscriptions.tier). */
export const sukoonTierSchema = z.enum(["free", "plus", "pro"]);
export type SukoonTier = z.infer<typeof sukoonTierSchema>;

/** Who authored a chat turn. `system` rows are never returned to the client. */
export const sukoonMessageRoleSchema = z.enum(["user", "assistant"]);
export type SukoonMessageRole = z.infer<typeof sukoonMessageRoleSchema>;

/** One persisted chat turn (sukoon_messages), as returned to the client. */
export const sukoonMessageSchema = z.object({
  id: z.string().uuid(),
  role: sukoonMessageRoleSchema,
  content: z.string(),
  /** Present on assistant turns (which model answered); null on user turns. */
  model_used: z.string().nullable(),
  /** The crisis level assessed for a user turn (drives replayed inline cards). */
  crisis_level: sukoonCrisisLevelSchema.nullable(),
  created_at: z.string(),
});
export type SukoonMessage = z.infer<typeof sukoonMessageSchema>;

/** A conversation summary row for the history drawer (sukoon_conversations). */
export const sukoonConversationSchema = z.object({
  id: z.string().uuid(),
  started_at: z.string(),
  last_message_at: z.string().nullable(),
  /** A short, gentle title/preview — the running summary or first-line fallback. */
  preview: z.string().nullable(),
});
export type SukoonConversation = z.infer<typeof sukoonConversationSchema>;

/**
 * POST /chat/stream body. `conversation_id` continues an existing thread; omit
 * it (or send null) to start a fresh conversation — the server mints one and
 * returns its id in the `conversation` SSE event.
 */
export const sukoonChatStreamBodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
  conversation_id: z.string().uuid().nullable().optional(),
});
export type SukoonChatStreamBody = z.infer<typeof sukoonChatStreamBodySchema>;

/**
 * GET /chat/usage — the daily cap meter the composer reads to show "N left"
 * and to disable input at 0 before a doomed stream. `limit` is the tier cap;
 * `used`/`remaining` are IST-day counts.
 */
export const sukoonChatUsageSchema = z.object({
  tier: sukoonTierSchema,
  used: z.number().int(),
  limit: z.number().int(),
  remaining: z.number().int(),
});
export type SukoonChatUsage = z.infer<typeof sukoonChatUsageSchema>;
export const sukoonChatUsageResponseSchema = apiEnvelopeSchema(sukoonChatUsageSchema);
export type SukoonChatUsageResponse = z.infer<typeof sukoonChatUsageResponseSchema>;

/**
 * GET /chat/history?conversation_id= — the turns of one conversation (the most
 * recent conversation when the id is omitted). `conversation` is null when the
 * user has no conversations yet (a fresh Saathi screen, not an error).
 */
export const sukoonChatHistorySchema = z.object({
  conversation: sukoonConversationSchema.nullable(),
  messages: z.array(sukoonMessageSchema),
});
export type SukoonChatHistory = z.infer<typeof sukoonChatHistorySchema>;
export const sukoonChatHistoryResponseSchema = apiEnvelopeSchema(sukoonChatHistorySchema);
export type SukoonChatHistoryResponse = z.infer<typeof sukoonChatHistoryResponseSchema>;

/** GET /chat/conversations — the history-drawer list, newest first. */
export const sukoonConversationsResponseSchema = apiEnvelopeSchema(
  z.object({ conversations: z.array(sukoonConversationSchema) }),
);
export type SukoonConversationsResponse = z.infer<typeof sukoonConversationsResponseSchema>;

/**
 * The `crisis` SSE event payload. `surface` is derived from `level` via
 * `crisisSurface()` (inline for moderate, takeover for high/critical) so the
 * client never re-derives the mapping. For a takeover, the stream carries NO
 * reply — the AI never manages a crisis; it hands off to humans.
 */
export const sukoonChatCrisisEventSchema = z.object({
  level: sukoonCrisisLevelSchema,
  surface: z.enum(["inline", "takeover"]),
});
export type SukoonChatCrisisEvent = z.infer<typeof sukoonChatCrisisEventSchema>;

// ---------------------------------------------------------------------------
// F4 — Journaling. Shared because the editor, prompt picker, list/heatmap
// filters, entry view (with AI reflection), export flow and streak chip all
// need the same vocabulary as the backend. HARD privacy rule (blueprint F4):
// entry BODIES are encrypted at rest and only ever cross the wire on the
// single-entry fetch/detail path — the list/search/heatmap surfaces are
// METADATA ONLY (no body), which the schemas below encode by simply omitting
// `body` from the list row.
// ---------------------------------------------------------------------------

/** Guided-prompt categories (mirror sukoon_journal_prompts.category, 0082). */
export const sukoonPromptCategorySchema = z.enum([
  "reflection",
  "gratitude",
  "worry_dump",
  "mock_review",
  "result_feelings",
  "comparison",
  "parental",
  "self_compassion",
  "letter_future",
]);
export type SukoonPromptCategory = z.infer<typeof sukoonPromptCategorySchema>;

/** Exam phase a prompt is tuned for (mirror sukoon_journal_prompts.exam_phase). */
export const sukoonExamPhaseSchema = z.enum(["routine", "pre_exam", "post_result"]);
export type SukoonExamPhase = z.infer<typeof sukoonExamPhaseSchema>;

/** A guided journal prompt (sukoon_journal_prompts) as returned to the client. */
export const sukoonJournalPromptSchema = z.object({
  id: z.string().uuid(),
  text_hi: z.string(),
  text_en: z.string(),
  /** Free-text in the DB; a seeded prompt is always one of the known values. */
  category: z.string().nullable(),
  exam_phase: z.string().nullable(),
});
export type SukoonJournalPrompt = z.infer<typeof sukoonJournalPromptSchema>;

/** GET /journal/prompts?category=&exam_phase= — the guided-prompt picker list. */
export const sukoonJournalPromptsResponseSchema = apiEnvelopeSchema(
  z.object({ prompts: z.array(sukoonJournalPromptSchema) }),
);
export type SukoonJournalPromptsResponse = z.infer<typeof sukoonJournalPromptsResponseSchema>;

/**
 * A journal LIST row — METADATA ONLY. There is deliberately NO `body`: bodies
 * stay encrypted and are never decrypted for a list/search (the documented
 * privacy tradeoff — a card shows date/mood/tags/prompt, never a text preview).
 * `prompt` is the guided prompt this entry was written to, if any (joined), so
 * the card has human context without touching the body.
 */
export const sukoonJournalListItemSchema = z.object({
  id: z.string().uuid(),
  mood: z.number().int().min(1).max(5).nullable(),
  tags: z.array(z.string()),
  prompt: sukoonJournalPromptSchema.nullable(),
  /** Whether an AI reflection has been generated (drives the ✨ badge) — not the text. */
  has_reflection: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SukoonJournalListItem = z.infer<typeof sukoonJournalListItemSchema>;

/**
 * A single journal entry with its DECRYPTED body + reflection — the ONLY shape
 * that carries plaintext, returned solely on GET /journal/entries/:id (the
 * user reading their own entry). `body` is null for a mood-only/voice-only entry.
 */
export const sukoonJournalEntrySchema = sukoonJournalListItemSchema.extend({
  body: z.string().nullable(),
  reflection: z.string().nullable(),
  reflection_at: z.string().nullable(),
});
export type SukoonJournalEntry = z.infer<typeof sukoonJournalEntrySchema>;

/** Body of a journal entry — rich-text-lite is stored as markdown plaintext. */
const journalBodySchema = z.string().max(20_000);
const journalMoodSchema = z.number().int().min(1).max(5);
/** Tags: short labels, deduped/trimmed server-side; capped to keep cards sane. */
const journalTagsSchema = z.array(z.string().trim().min(1).max(40)).max(12);

/**
 * POST /journal/entries. A valid entry needs SOMETHING — a body or a mood — so
 * an empty save is rejected (an all-null row is meaningless). prompt_id links
 * the guided prompt it answers, if any.
 */
export const sukoonJournalCreateBodySchema = z
  .object({
    body: journalBodySchema.optional(),
    mood: journalMoodSchema.nullable().optional(),
    tags: journalTagsSchema.optional(),
    prompt_id: z.string().uuid().nullable().optional(),
  })
  .refine((d) => (d.body && d.body.trim().length > 0) || d.mood != null, {
    message: "An entry needs a body or a mood",
  });
export type SukoonJournalCreateBody = z.infer<typeof sukoonJournalCreateBodySchema>;

/** PATCH /journal/entries/:id — same shape as create (prompt link is immutable). */
export const sukoonJournalUpdateBodySchema = z
  .object({
    body: journalBodySchema.optional(),
    mood: journalMoodSchema.nullable().optional(),
    tags: journalTagsSchema.optional(),
  })
  .refine((d) => (d.body && d.body.trim().length > 0) || d.mood != null, {
    message: "An entry needs a body or a mood",
  });
export type SukoonJournalUpdateBody = z.infer<typeof sukoonJournalUpdateBodySchema>;

/**
 * GET /journal/entries — metadata-only, filterable search (blueprint F4: search
 * by tags, mood, date range, prompt category — bodies stay encrypted, so this is
 * a METADATA search only). All filters optional; `from`/`to` are inclusive
 * IST calendar dates.
 */
export const sukoonJournalListQuerySchema = z.object({
  tag: z.string().trim().min(1).max(40).optional(),
  mood: z.coerce.number().int().min(1).max(5).optional(),
  category: sukoonPromptCategorySchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type SukoonJournalListQuery = z.infer<typeof sukoonJournalListQuerySchema>;

/**
 * GET /journal — the list response: a page of metadata rows + the distinct tag
 * set (for the filter chips) + the streak. `total` is the filtered count; the
 * page size is a server constant.
 */
export const sukoonJournalListResponseSchema = apiEnvelopeSchema(
  z.object({
    entries: z.array(sukoonJournalListItemSchema),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int(),
    all_tags: z.array(z.string()),
  }),
);
export type SukoonJournalListResponse = z.infer<typeof sukoonJournalListResponseSchema>;

/** GET /journal/entries/:id — the decrypted single entry. */
export const sukoonJournalEntryResponseSchema = apiEnvelopeSchema(
  z.object({ entry: sukoonJournalEntrySchema }),
);
export type SukoonJournalEntryResponse = z.infer<typeof sukoonJournalEntryResponseSchema>;

/** DELETE /journal/entries/:id — a soft delete acknowledgement. */
export const sukoonJournalDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ ok: z.literal(true) }),
);
export type SukoonJournalDeleteResponse = z.infer<typeof sukoonJournalDeleteResponseSchema>;

/** POST/PATCH /journal/entries[/:id] return the freshly-written entry. */
export const sukoonJournalWriteResponseSchema = sukoonJournalEntryResponseSchema;
export type SukoonJournalWriteResponse = SukoonJournalEntryResponse;

/**
 * GET /journal/heatmap?month=YYYY-MM — per-IST-day activity for a calendar month
 * (metadata only). `mood` is the day's average mood (null if no mood that day);
 * `count` is entries that day. Drives the calendar heatmap.
 */
export const sukoonJournalHeatmapDaySchema = z.object({
  date: isoDateSchema,
  count: z.number().int(),
  mood: z.number().nullable(),
});
export type SukoonJournalHeatmapDay = z.infer<typeof sukoonJournalHeatmapDaySchema>;

export const sukoonJournalHeatmapResponseSchema = apiEnvelopeSchema(
  z.object({ month: z.string(), days: z.array(sukoonJournalHeatmapDaySchema) }),
);
export type SukoonJournalHeatmapResponse = z.infer<typeof sukoonJournalHeatmapResponseSchema>;

/**
 * The gentle "self-care days" streak (blueprint F4 — NO loss-aversion). A day
 * counts if the user journaled that IST day; up to 1 skipped day per trailing
 * 7-day window is forgiven so a single miss never resets the count.
 */
export const sukoonJournalStreakSchema = z.object({
  current: z.number().int(),
  longest: z.number().int(),
  /** True if the user has already journaled today (drives "done for today"). */
  active_today: z.boolean(),
  /** Whether a free weekly skip was used to keep the streak alive (gentle notice). */
  skip_used: z.boolean(),
});
export type SukoonJournalStreak = z.infer<typeof sukoonJournalStreakSchema>;

/**
 * GET /journal/reflection/usage — the reflection allowance meter. free = a
 * LIFETIME budget of 3 (scope "lifetime"); plus/pro = a daily budget
 * (scope "daily"). The composer/entry view reads this to show "N left" and to
 * gate the ✨ button before a doomed request.
 */
export const sukoonReflectionUsageSchema = z.object({
  tier: sukoonTierSchema,
  scope: z.enum(["lifetime", "daily"]),
  used: z.number().int(),
  limit: z.number().int(),
  remaining: z.number().int(),
});
export type SukoonReflectionUsage = z.infer<typeof sukoonReflectionUsageSchema>;
export const sukoonReflectionUsageResponseSchema = apiEnvelopeSchema(sukoonReflectionUsageSchema);
export type SukoonReflectionUsageResponse = z.infer<typeof sukoonReflectionUsageResponseSchema>;

/**
 * GET /journal/export?from=&to= — decrypted entries for a date range, for the
 * print-to-PDF export (the existing Neev print-styled-route approach). Carries
 * plaintext (the user exporting their own journal), same as the single-entry
 * detail path. Reuses the full entry shape.
 */
export const sukoonJournalExportResponseSchema = apiEnvelopeSchema(
  z.object({
    from: isoDateSchema,
    to: isoDateSchema,
    entries: z.array(sukoonJournalEntrySchema),
  }),
);
export type SukoonJournalExportResponse = z.infer<typeof sukoonJournalExportResponseSchema>;

// ---------------------------------------------------------------------------
// F5 — Mood tracking & emotions. Shared because the 10-second check-in, the
// Trends view (calendar/line-chart/emotion-bars/correlations), and Home's
// today-status + 7-day strip all need the same vocabulary as the backend. The
// 1-5 score reuses the EXACT scale already defined for journal mood tags
// (same emoji/labels, `Sukoon.journal.mood.{n}`) — one "how do I feel" scale
// across the app rather than a second parallel one for this feature.
// ---------------------------------------------------------------------------

/** The emotion wheel (blueprint F5). A fixed set — validated server-side, not free text. */
export const SUKOON_EMOTION_IDS = [
  "anxious",
  "exhausted",
  "lonely",
  "hopeful",
  "overwhelmed",
  "frustrated",
  "sad",
  "calm",
  "motivated",
  "confident",
  "restless",
  "grateful",
] as const;
export const sukoonEmotionIdSchema = z.enum(SUKOON_EMOTION_IDS);
export type SukoonEmotionId = z.infer<typeof sukoonEmotionIdSchema>;

export interface SukoonEmotionDef {
  id: SukoonEmotionId;
  label_hi: string;
  label_en: string;
}
export const SUKOON_EMOTIONS: readonly SukoonEmotionDef[] = [
  { id: "anxious", label_hi: "चिंता", label_en: "Anxious" },
  { id: "exhausted", label_hi: "थकान", label_en: "Exhausted" },
  { id: "lonely", label_hi: "अकेलापन", label_en: "Lonely" },
  { id: "hopeful", label_hi: "उम्मीद", label_en: "Hopeful" },
  { id: "overwhelmed", label_hi: "अभिभूत", label_en: "Overwhelmed" },
  { id: "frustrated", label_hi: "चिढ़", label_en: "Frustrated" },
  { id: "sad", label_hi: "उदास", label_en: "Sad" },
  { id: "calm", label_hi: "शांत", label_en: "Calm" },
  { id: "motivated", label_hi: "उत्साहित", label_en: "Motivated" },
  { id: "confident", label_hi: "आत्मविश्वासी", label_en: "Confident" },
  { id: "restless", label_hi: "बेचैन", label_en: "Restless" },
  { id: "grateful", label_hi: "आभारी", label_en: "Grateful" },
] as const;

/** The optional "what's behind this" factor chips (blueprint F5, exact set given). */
export const SUKOON_MOOD_FACTOR_IDS = [
  "studies",
  "family",
  "sleep",
  "result",
  "comparison",
  "health",
  "friends",
] as const;
export const sukoonMoodFactorIdSchema = z.enum(SUKOON_MOOD_FACTOR_IDS);
export type SukoonMoodFactorId = z.infer<typeof sukoonMoodFactorIdSchema>;

export interface SukoonMoodFactorDef {
  id: SukoonMoodFactorId;
  label_hi: string;
  label_en: string;
}
export const SUKOON_MOOD_FACTORS: readonly SukoonMoodFactorDef[] = [
  { id: "studies", label_hi: "पढ़ाई", label_en: "Studies" },
  { id: "family", label_hi: "परिवार", label_en: "Family" },
  { id: "sleep", label_hi: "नींद", label_en: "Sleep" },
  { id: "result", label_hi: "परिणाम", label_en: "Result" },
  { id: "comparison", label_hi: "तुलना", label_en: "Comparison" },
  { id: "health", label_hi: "स्वास्थ्य", label_en: "Health" },
  { id: "friends", label_hi: "दोस्त", label_en: "Friends" },
] as const;

const moodScoreSchema = z.number().int().min(1).max(5);
const moodNoteSchema = z.string().trim().max(280);

/** One mood check-in (sukoon_mood_entries) as returned to the client. */
export const sukoonMoodEntrySchema = z.object({
  id: z.string().uuid(),
  score: moodScoreSchema,
  emotions: z.array(sukoonEmotionIdSchema),
  factors: z.array(sukoonMoodFactorIdSchema),
  note: z.string().nullable(),
  created_at: z.string(),
});
export type SukoonMoodEntry = z.infer<typeof sukoonMoodEntrySchema>;

/**
 * POST /mood/entries and PATCH /mood/entries/:id share this shape — a full
 * replace on edit (matches the journal entry update convention) rather than a
 * partial patch, since the check-in is a single small form submitted whole.
 */
export const sukoonMoodCreateBodySchema = z.object({
  score: moodScoreSchema,
  emotions: z.array(sukoonEmotionIdSchema).max(SUKOON_EMOTION_IDS.length).optional(),
  factors: z.array(sukoonMoodFactorIdSchema).max(SUKOON_MOOD_FACTOR_IDS.length).optional(),
  note: moodNoteSchema.optional(),
});
export type SukoonMoodCreateBody = z.infer<typeof sukoonMoodCreateBodySchema>;
export const sukoonMoodUpdateBodySchema = sukoonMoodCreateBodySchema;
export type SukoonMoodUpdateBody = z.infer<typeof sukoonMoodUpdateBodySchema>;

export const sukoonMoodEntryResponseSchema = apiEnvelopeSchema(
  z.object({ entry: sukoonMoodEntrySchema }),
);
export type SukoonMoodEntryResponse = z.infer<typeof sukoonMoodEntryResponseSchema>;

export const sukoonMoodDeleteResponseSchema = apiEnvelopeSchema(z.object({ ok: z.literal(true) }));
export type SukoonMoodDeleteResponse = z.infer<typeof sukoonMoodDeleteResponseSchema>;

/**
 * GET /mood/today — one PRIMARY entry/day (the first check-in that IST day,
 * editable in place) plus any EXTRA check-ins the same day (also stored, both
 * feed the aggregates). `next_reminder_at` is the F11-precursor "expose
 * next-reminder computation" ask — null when no reminder_time is set.
 */
export const sukoonMoodTodayResponseSchema = apiEnvelopeSchema(
  z.object({
    primary: sukoonMoodEntrySchema.nullable(),
    extra: z.array(sukoonMoodEntrySchema),
    next_reminder_at: z.string().nullable(),
  }),
);
export type SukoonMoodTodayResponse = z.infer<typeof sukoonMoodTodayResponseSchema>;

/** GET /mood/heatmap?month=YYYY-MM — per-IST-day check-in count + average mood. */
export const sukoonMoodHeatmapDaySchema = z.object({
  date: isoDateSchema,
  count: z.number().int(),
  avg_score: z.number().nullable(),
});
export type SukoonMoodHeatmapDay = z.infer<typeof sukoonMoodHeatmapDaySchema>;
export const sukoonMoodHeatmapResponseSchema = apiEnvelopeSchema(
  z.object({ month: z.string(), days: z.array(sukoonMoodHeatmapDaySchema) }),
);
export type SukoonMoodHeatmapResponse = z.infer<typeof sukoonMoodHeatmapResponseSchema>;

/** GET /mood/aggregates?range=7|30|90 */
export const sukoonMoodAggregatesRangeSchema = z.enum(["7", "30", "90"]);
export type SukoonMoodAggregatesRange = z.infer<typeof sukoonMoodAggregatesRangeSchema>;

export const sukoonMoodDailyPointSchema = z.object({
  date: isoDateSchema,
  avg_score: z.number().nullable(),
  count: z.number().int(),
});
export type SukoonMoodDailyPoint = z.infer<typeof sukoonMoodDailyPointSchema>;

export const sukoonMoodEmotionFrequencySchema = z.object({
  emotion: sukoonEmotionIdSchema,
  count: z.number().int(),
});
export type SukoonMoodEmotionFrequency = z.infer<typeof sukoonMoodEmotionFrequencySchema>;

/**
 * A naive factor correlation (blueprint F5/Session 6): the user's average mood
 * on days a factor was tagged vs days it wasn't, gated on a minimum of 5
 * samples PER SIDE so a single data point can never produce a claim.
 */
export const sukoonMoodFactorCorrelationSchema = z.object({
  factor: sukoonMoodFactorIdSchema,
  avg_with: z.number(),
  avg_without: z.number(),
  gap: z.number(),
  samples_with: z.number().int(),
  samples_without: z.number().int(),
});
export type SukoonMoodFactorCorrelation = z.infer<typeof sukoonMoodFactorCorrelationSchema>;

export const sukoonMoodAggregatesSchema = z.object({
  range_days: z.number().int(),
  daily: z.array(sukoonMoodDailyPointSchema),
  avg_7d: z.number().nullable(),
  avg_30d: z.number().nullable(),
  total_entries: z.number().int(),
  emotion_frequency: z.array(sukoonMoodEmotionFrequencySchema),
  /** Top 3 (by |gap|) factors that clear the 5-samples-per-side bar; empty when none do. */
  factor_correlations: z.array(sukoonMoodFactorCorrelationSchema),
});
export type SukoonMoodAggregates = z.infer<typeof sukoonMoodAggregatesSchema>;
export const sukoonMoodAggregatesResponseSchema = apiEnvelopeSchema(sukoonMoodAggregatesSchema);
export type SukoonMoodAggregatesResponse = z.infer<typeof sukoonMoodAggregatesResponseSchema>;

// ---------------------------------------------------------------------------
// F6 — Exercise library (breathing, grounding, PMR, meditation timers, guided
// meditations). Shared because the tools grid, every player, and the backend
// content pipeline all need the same vocabulary. RUNTIME IS A STATIC CATALOG
// (blueprint: "nothing generates content at runtime that can be
// pre-generated") — sukoon_exercises rows are seeded/reviewed content, never
// authored live. `config_json` per row is one of the per-type shapes below;
// the discriminated union on the exercise schema itself is what lets the
// player pick the right UI without a second lookup.
// ---------------------------------------------------------------------------

export const SUKOON_EXERCISE_TYPES = ["breathing", "grounding", "pmr", "meditation", "timer"] as const;
export const sukoonExerciseTypeSchema = z.enum(SUKOON_EXERCISE_TYPES);
export type SukoonExerciseType = z.infer<typeof sukoonExerciseTypeSchema>;

// Ambient mixer catalog — a fixed, non-DB set (mirrors SUKOON_EMOTIONS' id-array
// + labeled-def pattern), declared here (before the configs that reference it)
// since a breathing/timer exercise can name a default/allowed ambient sound.
// Real loop files are optional per id; a missing one falls back to a
// client-side synthesized placeholder (Web Audio), so the mixer works today
// and upgrades silently the moment a real file is uploaded to the
// sukoon-audio bucket under `ambient/<id>.mp3` — no code change needed.
export const SUKOON_AMBIENT_IDS = ["rain", "tanpura", "crickets", "fan"] as const;
export const sukoonAmbientIdSchema = z.enum(SUKOON_AMBIENT_IDS);
export type SukoonAmbientId = z.infer<typeof sukoonAmbientIdSchema>;

export interface SukoonAmbientDef {
  id: SukoonAmbientId;
  label_hi: string;
  label_en: string;
}
export const SUKOON_AMBIENT_SOUNDS: readonly SukoonAmbientDef[] = [
  { id: "rain", label_hi: "बारिश", label_en: "Rain" },
  { id: "tanpura", label_hi: "तानपूरा", label_en: "Tanpura" },
  { id: "crickets", label_hi: "रात की झींगुर", label_en: "Night crickets" },
  { id: "fan", label_hi: "पंखा", label_en: "Fan" },
] as const;

/** One phase of a breathing cycle. `seconds: 0` means the phase is skipped in
 *  the player (e.g. 4-7-8 has no second hold) rather than omitted from the
 *  array, so `haptics_pattern_ms` can stay index-aligned with `phases`. */
export const sukoonBreathPhaseIdSchema = z.enum(["inhale", "hold1", "exhale", "hold2"]);
export type SukoonBreathPhaseId = z.infer<typeof sukoonBreathPhaseIdSchema>;

export const sukoonBreathPhaseSchema = z.object({
  id: sukoonBreathPhaseIdSchema,
  seconds: z.number().min(0).max(30),
});
export type SukoonBreathPhase = z.infer<typeof sukoonBreathPhaseSchema>;

export const sukoonBreathingConfigSchema = z.object({
  phases: z.array(sukoonBreathPhaseSchema).min(2).max(4),
  default_cycles: z.number().int().min(1).max(60),
  /** Vibration-API pattern (ms), one entry per `phases` index — a phase
   *  transition fires `navigator.vibrate([ms])`; `0` = no buzz for that phase. */
  haptics_pattern_ms: z.array(z.number().int().min(0).max(2000)),
  /** An ambient sound id (see SUKOON_AMBIENT_SOUNDS) offered as a default bed, or null. */
  default_ambient: sukoonAmbientIdSchema.nullable(),
});
export type SukoonBreathingConfig = z.infer<typeof sukoonBreathingConfigSchema>;

export const sukoonGroundingStepSchema = z.object({
  sense: z.enum(["see", "touch", "hear", "smell", "taste"]),
  count: z.number().int().min(1).max(5),
  prompt_hi: z.string(),
  prompt_en: z.string(),
});
export type SukoonGroundingStep = z.infer<typeof sukoonGroundingStepSchema>;

export const sukoonGroundingConfigSchema = z.object({
  steps: z.array(sukoonGroundingStepSchema).length(5),
  /** Whether the player offers an optional one-line text box per step (blueprint F6). */
  allow_text_input: z.boolean(),
});
export type SukoonGroundingConfig = z.infer<typeof sukoonGroundingConfigSchema>;

export const sukoonPmrSegmentSchema = z.object({
  id: z.string(),
  name_hi: z.string(),
  name_en: z.string(),
  seconds: z.number().int().min(5).max(300),
});
export type SukoonPmrSegment = z.infer<typeof sukoonPmrSegmentSchema>;

export const sukoonPmrConfigSchema = z.object({
  segments: z.array(sukoonPmrSegmentSchema).min(1),
});
export type SukoonPmrConfig = z.infer<typeof sukoonPmrConfigSchema>;

export const sukoonTimerConfigSchema = z.object({
  duration_options_min: z.array(z.number().int().min(1).max(60)).min(1),
  default_duration_min: z.number().int().min(1).max(60),
  chime: z.literal("singing_bowl"),
  ambient_options: z.array(sukoonAmbientIdSchema),
});
export type SukoonTimerConfig = z.infer<typeof sukoonTimerConfigSchema>;

export const sukoonMeditationConfigSchema = z.object({
  category: z.string(),
  duration_min: z.number().int().min(1).max(60),
});
export type SukoonMeditationConfig = z.infer<typeof sukoonMeditationConfigSchema>;

/** GET /exercises/ambient/:id/audio-url and /exercises/:id/audio-url both return this shape. */
export const sukoonAudioUrlResponseSchema = apiEnvelopeSchema(
  z.object({ url: z.string(), expires_at: z.string() }),
);
export type SukoonAudioUrlResponse = z.infer<typeof sukoonAudioUrlResponseSchema>;
export const sukoonExerciseAudioLangSchema = z.enum(["hi", "en"]);
export type SukoonExerciseAudioLang = z.infer<typeof sukoonExerciseAudioLangSchema>;

/**
 * A catalog row (sukoon_exercises) as returned to the client — `config` is
 * narrowed per `type` via the discriminated union, so a player never has to
 * runtime-guess its own config shape. `locked` is resolved SERVER-SIDE from
 * the caller's tier (never trust a client-computed lock state for a paywall).
 */
const exerciseCommonFields = {
  id: z.string().uuid(),
  /** The stable seed key (0084) — how a journey's exercise_ref step (F7)
   *  cross-references a catalog entry without hardcoding its uuid. */
  key: z.string().nullable(),
  title_hi: z.string(),
  title_en: z.string(),
  has_audio_hi: z.boolean(),
  has_audio_en: z.boolean(),
  premium: z.boolean(),
  locked: z.boolean(),
  sort: z.number().int(),
};

export const sukoonExerciseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("breathing"), config: sukoonBreathingConfigSchema, ...exerciseCommonFields }),
  z.object({ type: z.literal("grounding"), config: sukoonGroundingConfigSchema, ...exerciseCommonFields }),
  z.object({ type: z.literal("pmr"), config: sukoonPmrConfigSchema, ...exerciseCommonFields }),
  z.object({ type: z.literal("timer"), config: sukoonTimerConfigSchema, ...exerciseCommonFields }),
  z.object({ type: z.literal("meditation"), config: sukoonMeditationConfigSchema, ...exerciseCommonFields }),
]);
export type SukoonExercise = z.infer<typeof sukoonExerciseSchema>;

export const sukoonExercisesResponseSchema = apiEnvelopeSchema(
  z.object({ exercises: z.array(sukoonExerciseSchema) }),
);
export type SukoonExercisesResponse = z.infer<typeof sukoonExercisesResponseSchema>;

// --- Session logging (start / complete, duration) ---------------------------

export const sukoonExerciseSessionSchema = z.object({
  id: z.string().uuid(),
  exercise_id: z.string().uuid().nullable(),
  duration_s: z.number().int().nullable(),
  completed: z.boolean(),
  created_at: z.string(),
});
export type SukoonExerciseSession = z.infer<typeof sukoonExerciseSessionSchema>;

/** POST /exercises/sessions — starts a session; `exercise_id` is nullable
 *  (a freeform unguided-timer run not tied to one catalog row is still logged). */
export const sukoonExerciseSessionStartBodySchema = z.object({
  exercise_id: z.string().uuid().nullable().optional(),
});
export type SukoonExerciseSessionStartBody = z.infer<typeof sukoonExerciseSessionStartBodySchema>;

/** PATCH /exercises/sessions/:id — marks it complete with the actual elapsed duration. */
export const sukoonExerciseSessionCompleteBodySchema = z.object({
  duration_s: z.number().int().min(0).max(24 * 3600),
  completed: z.boolean().default(true),
});
export type SukoonExerciseSessionCompleteBody = z.infer<typeof sukoonExerciseSessionCompleteBodySchema>;

export const sukoonExerciseSessionResponseSchema = apiEnvelopeSchema(
  z.object({ session: sukoonExerciseSessionSchema }),
);
export type SukoonExerciseSessionResponse = z.infer<typeof sukoonExerciseSessionResponseSchema>;

// ---------------------------------------------------------------------------
// F7 — Guided Journeys (multi-day exam-stress programs). Shared because the
// ADMIN content-queue (paste/upload → validate → preview → publish), the
// catalog/detail/day-player frontend, and the backend content loader all need
// the exact same "journey → days → steps" document shape. Every content node
// carries BOTH `_hi` and `_en` text (SUKOON_CONTEXT's bilingual rule) — there is
// no locale-conditional field anywhere in this section.
//
// Content is authored/validated as ONE JSON document (`sukoonJourneyContentSchema`)
// then exploded by the backend into sukoon_journeys (title/description/premium)
// + sukoon_journey_steps (one row per step, `day`/`step_order` as real columns,
// the rest of the step's fields in `content_json`) — see chapter-persist.ts's
// "one document in, several rows out" precedent in the Notes feature.
// ---------------------------------------------------------------------------

/** A stable, admin-authorable slug — also how the FE finds the fixed "Exam-Eve
 *  Panic" journey (see SUKOON_EXAM_EVE_JOURNEY_SLUG below) without a hardcoded id. */
export const sukoonJourneySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, and underscores only");

/** The fixed slug of the single-session "Exam-Eve Panic" journey (blueprint F7 #1)
 *  — instantly available the day before an exam, exempt from day-locking by
 *  construction (a 1-day journey has no "next day" to lock). Sukoon Home and
 *  Saathi both key off this constant to surface it, rather than hardcoding a uuid. */
export const SUKOON_EXAM_EVE_JOURNEY_SLUG = "exam_eve_panic";

export const SUKOON_JOURNEY_STEP_TYPES = [
  "read",
  "exercise_ref",
  "journal_prompt",
  "saathi_checkin",
  "checkin_scale",
] as const;
export const sukoonJourneyStepTypeSchema = z.enum(SUKOON_JOURNEY_STEP_TYPES);
export type SukoonJourneyStepType = z.infer<typeof sukoonJourneyStepTypeSchema>;

const stepCommonFields = {
  title_hi: z.string().trim().min(1).max(140),
  title_en: z.string().trim().min(1).max(140),
};

/** checkin_scale's labeled Likert scale — kept small (a wellness check-in, not a
 *  survey instrument); label arrays must exactly cover `min..max` inclusive.
 *  Plain object (no per-object .refine — that would turn it into a ZodEffects,
 *  which z.discriminatedUnion rejects); the scale-invariant checks are applied
 *  as a .superRefine on the WHOLE union below instead. */
const scaleStepSchema = z.object({
  type: z.literal("checkin_scale"),
  ...stepCommonFields,
  question_hi: z.string().trim().min(1).max(280),
  question_en: z.string().trim().min(1).max(280),
  scale_min: z.number().int().min(0).max(10),
  scale_max: z.number().int().min(1).max(10),
  scale_labels_hi: z.array(z.string().trim().min(1).max(40)).min(2).max(11),
  scale_labels_en: z.array(z.string().trim().min(1).max(40)).min(2).max(11),
});

/** The per-type CONTENT fields an admin authors — no id/day/step_order (those
 *  become real sukoon_journey_steps columns once persisted; see sukoonJourneyStepSchema). */
export const sukoonJourneyStepContentSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("read"),
      ...stepCommonFields,
      body_hi: z.string().trim().min(1).max(4000),
      body_en: z.string().trim().min(1).max(4000),
    }),
    z.object({
      type: z.literal("exercise_ref"),
      ...stepCommonFields,
      // References sukoon_exercises.key (a stable human-authorable seed key —
      // see 0084's seed convention), NOT a uuid, so an admin can author this by
      // hand; the backend resolves + validates it exists at upsert time.
      exercise_key: z.string().trim().min(1).max(80),
    }),
    z.object({
      type: z.literal("journal_prompt"),
      ...stepCommonFields,
      prompt_hi: z.string().trim().min(1).max(500),
      prompt_en: z.string().trim().min(1).max(500),
    }),
    z.object({
      type: z.literal("saathi_checkin"),
      ...stepCommonFields,
      // The message Saathi's chat opens with when this step deep-links in —
      // sent as the FIRST user turn, exactly like tapping a starter chip.
      seed_message_hi: z.string().trim().min(1).max(500),
      seed_message_en: z.string().trim().min(1).max(500),
    }),
    scaleStepSchema,
  ])
  .superRefine((d, ctx) => {
    if (d.type !== "checkin_scale") return;
    if (d.scale_max <= d.scale_min) {
      ctx.addIssue({ code: "custom", message: "scale_max must be greater than scale_min", path: ["scale_max"] });
    }
    const expected = d.scale_max - d.scale_min + 1;
    if (d.scale_labels_hi.length !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `scale_labels_hi must have exactly ${expected} entries`,
        path: ["scale_labels_hi"],
      });
    }
    if (d.scale_labels_en.length !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `scale_labels_en must have exactly ${expected} entries`,
        path: ["scale_labels_en"],
      });
    }
  });
export type SukoonJourneyStepContent = z.infer<typeof sukoonJourneyStepContentSchema>;

export const sukoonJourneyDayContentSchema = z.object({
  day: z.number().int().min(1).max(31),
  steps: z.array(sukoonJourneyStepContentSchema).min(1).max(20),
});
export type SukoonJourneyDayContent = z.infer<typeof sukoonJourneyDayContentSchema>;

/**
 * The whole admin-authored document (paste/upload → validate → preview →
 * publish). `days` must be exactly 1..N, contiguous and in order — the loader
 * refuses a gap or an out-of-order day rather than silently reordering it, so
 * what an admin sees in the preview is exactly what gets persisted.
 */
export const sukoonJourneyContentSchema = z
  .object({
    slug: sukoonJourneySlugSchema,
    title_hi: z.string().trim().min(1).max(140),
    title_en: z.string().trim().min(1).max(140),
    description_hi: z.string().trim().min(1).max(600),
    description_en: z.string().trim().min(1).max(600),
    premium: z.boolean().default(false),
    days: z.array(sukoonJourneyDayContentSchema).min(1).max(31),
  })
  .refine(
    (d) => d.days.every((day, i) => day.day === i + 1),
    { message: "days must be numbered 1..N with no gaps, in order", path: ["days"] },
  );
export type SukoonJourneyContent = z.infer<typeof sukoonJourneyContentSchema>;

/** A persisted step as returned to the client — content fields + where it lives. */
export const sukoonJourneyStepSchema = z.intersection(
  sukoonJourneyStepContentSchema,
  z.object({ id: z.string().uuid(), day: z.number().int(), step_order: z.number().int() }),
);
export type SukoonJourneyStep = z.infer<typeof sukoonJourneyStepSchema>;

/** One day's step count — the catalog/detail's per-day summary (progress dots). */
export const sukoonJourneyDaySummarySchema = z.object({
  day: z.number().int(),
  step_count: z.number().int(),
});
export type SukoonJourneyDaySummary = z.infer<typeof sukoonJourneyDaySummarySchema>;

/** Per-user progress on one journey (sukoon_journey_progress). */
export const sukoonJourneyProgressSchema = z.object({
  journey_id: z.string().uuid(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  /** The furthest day unlocked as of now (day-locking: min(days, elapsed_calendar_days+1)). */
  current_unlocked_day: z.number().int(),
  completed_step_ids: z.array(z.string().uuid()),
  reflection: z.string().nullable(),
  reflection_at: z.string().nullable(),
});
export type SukoonJourneyProgress = z.infer<typeof sukoonJourneyProgressSchema>;

/** GET /journeys — the catalog. `locked` is resolved server-side from tier
 *  (same pattern as sukoonExerciseSchema); `progress` is null pre-start. */
export const sukoonJourneySchema = z.object({
  id: z.string().uuid(),
  slug: sukoonJourneySlugSchema,
  title_hi: z.string(),
  title_en: z.string(),
  description_hi: z.string(),
  description_en: z.string(),
  days: z.number().int(),
  total_steps: z.number().int(),
  premium: z.boolean(),
  locked: z.boolean(),
  version: z.number().int(),
  progress: sukoonJourneyProgressSchema.nullable(),
});
export type SukoonJourney = z.infer<typeof sukoonJourneySchema>;

export const sukoonJourneysResponseSchema = apiEnvelopeSchema(
  z.object({ journeys: z.array(sukoonJourneySchema) }),
);
export type SukoonJourneysResponse = z.infer<typeof sukoonJourneysResponseSchema>;

/** GET /journeys/:slug — detail (catalog row + per-day step counts). */
export const sukoonJourneyDetailResponseSchema = apiEnvelopeSchema(
  z.object({ journey: sukoonJourneySchema, days_summary: z.array(sukoonJourneyDaySummarySchema) }),
);
export type SukoonJourneyDetailResponse = z.infer<typeof sukoonJourneyDetailResponseSchema>;

/** POST /journeys/:slug/start — idempotent while in progress; RESTARTS
 *  (blueprint: "re-take anytime") when the prior run is already completed_at. */
export const sukoonJourneyProgressResponseSchema = apiEnvelopeSchema(
  z.object({ progress: sukoonJourneyProgressSchema }),
);
export type SukoonJourneyProgressResponse = z.infer<typeof sukoonJourneyProgressResponseSchema>;

/**
 * GET /journeys/:slug/today and POST /journeys/:slug/steps/:stepId/complete
 * share this shape — the one contract the day player renders from. `state`:
 *   not_started → the player should offer "Start"
 *   step        → `step` is the next thing to do (day <= current_unlocked_day)
 *   day_locked  → everything unlocked so far is done; `next_unlock_at` is when
 *                 the next day opens (a 1-day journey can never reach this state)
 *   completed   → every day/step is done; the player shows the completion
 *                 celebration + (if not yet saved) the reflection prompt
 */
export const sukoonJourneyStateSchema = z.enum(["not_started", "step", "day_locked", "completed"]);
export type SukoonJourneyState = z.infer<typeof sukoonJourneyStateSchema>;

export const sukoonJourneyTodayResponseSchema = apiEnvelopeSchema(
  z.object({
    state: sukoonJourneyStateSchema,
    progress: sukoonJourneyProgressSchema.nullable(),
    step: sukoonJourneyStepSchema.nullable(),
    next_unlock_at: z.string().nullable(),
  }),
);
export type SukoonJourneyTodayResponse = z.infer<typeof sukoonJourneyTodayResponseSchema>;

/** POST /journeys/:slug/steps/:stepId/complete — `response` is an optional
 *  free-form answer (a checkin_scale pick, a journal-written flag, …), stored
 *  in sukoon_journey_progress.step_responses keyed by step id. Idempotent —
 *  completing an already-completed step is a no-op that just re-returns state. */
export const sukoonJourneyCompleteStepBodySchema = z.object({
  response: z.union([z.string().max(2000), z.number(), z.boolean()]).nullable().optional(),
});
export type SukoonJourneyCompleteStepBody = z.infer<typeof sukoonJourneyCompleteStepBodySchema>;

/** POST /journeys/:slug/reflection — only allowed once the journey is
 *  completed (blueprint: "completion reflection save"). */
export const sukoonJourneyReflectionBodySchema = z.object({
  reflection: z.string().trim().min(1).max(2000),
});
export type SukoonJourneyReflectionBody = z.infer<typeof sukoonJourneyReflectionBodySchema>;

// --- Admin content queue (paste/upload → validate → preview → publish) -----

/** GET /admin/journeys — the queue's list row (draft + published, one place
 *  to see every journey's state before deciding what to touch). */
export const sukoonJourneyAdminSummarySchema = z.object({
  id: z.string().uuid(),
  slug: sukoonJourneySlugSchema,
  title_hi: z.string(),
  title_en: z.string(),
  description_hi: z.string(),
  description_en: z.string(),
  days: z.number().int(),
  total_steps: z.number().int(),
  premium: z.boolean(),
  version: z.number().int(),
  published: z.boolean(),
});
export type SukoonJourneyAdminSummary = z.infer<typeof sukoonJourneyAdminSummarySchema>;

export const sukoonJourneyAdminListResponseSchema = apiEnvelopeSchema(
  z.object({ journeys: z.array(sukoonJourneyAdminSummarySchema) }),
);
export type SukoonJourneyAdminListResponse = z.infer<typeof sukoonJourneyAdminListResponseSchema>;

/** GET /admin/journeys/:slug — the full content document, reconstructed from
 *  the DB, so an admin can re-open an existing journey's JSON to edit it. */
export const sukoonJourneyAdminDetailResponseSchema = apiEnvelopeSchema(
  z.object({ journey: sukoonJourneyAdminSummarySchema, content: sukoonJourneyContentSchema }),
);
export type SukoonJourneyAdminDetailResponse = z.infer<typeof sukoonJourneyAdminDetailResponseSchema>;

/**
 * POST /admin/journeys/validate — a DRY RUN: validates a pasted/uploaded
 * document against sukoonJourneyContentSchema WITHOUT writing anything, so the
 * admin queue can show a field-level error list or a bilingual preview before
 * anyone commits. `content` is raw/unknown in (the admin's pasted JSON.parse
 * result), never pre-validated by the client.
 */
export const sukoonJourneyValidateBodySchema = z.object({ content: z.unknown() });
export type SukoonJourneyValidateBody = z.infer<typeof sukoonJourneyValidateBodySchema>;

export const sukoonJourneyValidationIssueSchema = z.object({ path: z.string(), message: z.string() });
export type SukoonJourneyValidationIssue = z.infer<typeof sukoonJourneyValidationIssueSchema>;

export const sukoonJourneyValidateResponseSchema = apiEnvelopeSchema(
  z.object({
    valid: z.boolean(),
    issues: z.array(sukoonJourneyValidationIssueSchema),
    content: sukoonJourneyContentSchema.nullable(),
  }),
);
export type SukoonJourneyValidateResponse = z.infer<typeof sukoonJourneyValidateResponseSchema>;

/** POST /admin/journeys — upsert-by-slug (create, or replace an existing
 *  journey's content + bump `version`); leaves `published` as-is (a brand-new
 *  journey starts unpublished — publish is a deliberate, separate action). */
export const sukoonJourneyUpsertBodySchema = sukoonJourneyContentSchema;
export type SukoonJourneyUpsertBody = z.infer<typeof sukoonJourneyUpsertBodySchema>;

export const sukoonJourneyUpsertResponseSchema = apiEnvelopeSchema(
  z.object({ journey: sukoonJourneyAdminSummarySchema }),
);
export type SukoonJourneyUpsertResponse = z.infer<typeof sukoonJourneyUpsertResponseSchema>;

/** GET /admin/status (Sukoon's own, self-contained mirror of Neev's) — the
 *  frontend gate for the admin journeys queue page. */
export const sukoonAdminStatusResponseSchema = apiEnvelopeSchema(z.object({ is_admin: z.boolean() }));
export type SukoonAdminStatusResponse = z.infer<typeof sukoonAdminStatusResponseSchema>;

// ---------------------------------------------------------------------------
// F10 — Voice Mode (Sukoon Pro only). Half-duplex push-to-talk: the browser
// records ONE turn (<=60s), the whole record→transcribe→crisis-check→reply→
// speak round trip happens in a single POST (no SSE — see the backend
// services/voice.ts header for why per-token streaming isn't used here), and
// the response carries both transcripts + the reply audio so the player can
// show captions immediately, and either provider (OpenAI/Sarvam) behind one
// contract. Metering is in whole seconds against sukoon_voice_usage
// (user_id, month 'YYYY-MM', seconds_used — table already exists, 0078/0079).
// ---------------------------------------------------------------------------

/** 60 minutes/month (blueprint F10). One place this constant is decided. */
export const SUKOON_VOICE_MONTHLY_CAP_SECONDS = 60 * 60;
/** Soft warning threshold — 50 of the 60 minutes used. */
export const SUKOON_VOICE_WARNING_SECONDS = 50 * 60;
/** Max length of one recorded turn — enforced by the recorder AND the server. */
export const SUKOON_VOICE_MAX_TURN_SECONDS = 60;

/**
 * GET /voice/usage — works for EVERY tier (not just Pro) so the Saathi entry
 * point can render a locked badge for free/plus without erroring. `eligible`
 * is the one field the UI needs to decide lock vs meter; `warning` is true at
 * >=50 of 60 minutes used (never true when ineligible).
 */
export const sukoonVoiceUsageSchema = z.object({
  tier: sukoonTierSchema,
  eligible: z.boolean(),
  used_seconds: z.number().int(),
  limit_seconds: z.number().int(),
  remaining_seconds: z.number().int(),
  warning: z.boolean(),
});
export type SukoonVoiceUsage = z.infer<typeof sukoonVoiceUsageSchema>;
export const sukoonVoiceUsageResponseSchema = apiEnvelopeSchema(sukoonVoiceUsageSchema);
export type SukoonVoiceUsageResponse = z.infer<typeof sukoonVoiceUsageResponseSchema>;

/**
 * Container/codec mime types accepted from MediaRecorder across real browsers
 * — Chrome/Firefox/Edge default to webm or ogg (opus), Safari to mp4 (aac).
 * OpenAI's transcription API accepts all of these directly, so the client
 * just sends whatever `MediaRecorder.isTypeSupported` picked, no transcoding.
 */
export const SUKOON_VOICE_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;
export const sukoonVoiceAudioMimeSchema = z.enum(SUKOON_VOICE_AUDIO_MIME_TYPES);
export type SukoonVoiceAudioMime = z.infer<typeof sukoonVoiceAudioMimeSchema>;

/**
 * Base64 ceiling for the recorded clip: ~8MB raw audio (matches the
 * answer-images bucket's own 8MB/file precedent), *4/3 for base64 expansion,
 * rounded down a little to leave room for the rest of the JSON envelope
 * under the route's raised body limit (see apps/api/src/index.ts).
 */
const SUKOON_VOICE_AUDIO_BASE64_MAX_CHARS = 11_000_000;

/**
 * POST /voice/turn body. `duration_seconds` is the CLIENT-measured recording
 * length (the recorder's own start/stop timestamps, not derived from the
 * blob) — clamped server-side to [0, 60] and used as the exact STT-side
 * metering figure; the reply's TTS-side seconds are estimated server-side
 * from the reply text length (no provider reports exact spoken duration
 * before/without synthesizing, and estimating from text is the same
 * character-rate approach TTS vendors themselves use for pre-flight cost
 * quotes) — see services/voice.ts's `estimateSpeechSeconds`.
 */
export const sukoonVoiceTurnBodySchema = z.object({
  conversation_id: z.string().uuid().nullable().optional(),
  audio_base64: z.string().min(1).max(SUKOON_VOICE_AUDIO_BASE64_MAX_CHARS),
  mime_type: sukoonVoiceAudioMimeSchema,
  duration_seconds: z.number().min(0).max(SUKOON_VOICE_MAX_TURN_SECONDS),
});
export type SukoonVoiceTurnBody = z.infer<typeof sukoonVoiceTurnBodySchema>;

/**
 * POST /voice/turn response. `assistant_text`/`assistant_audio_base64` are
 * null ONLY on a crisis takeover (high/critical — the AI never replies to a
 * crisis, mirroring the chat SSE's takeover contract); `crisis` is null
 * whenever the level is none/low (no UI reaction needed at that level).
 * `conversation_id` is null ONLY for a takeover on a brand-new session (no
 * conversation existed yet) — mirroring chat's own choice not to mint one for
 * a lone crisis message (see services/voice.ts's header for why).
 */
export const sukoonVoiceTurnResultSchema = z.object({
  conversation_id: z.string().uuid().nullable(),
  user_transcript: z.string(),
  assistant_text: z.string().nullable(),
  assistant_audio_base64: z.string().nullable(),
  assistant_audio_mime: z.string().nullable(),
  crisis: sukoonChatCrisisEventSchema.nullable(),
  usage: sukoonVoiceUsageSchema,
});
export type SukoonVoiceTurnResult = z.infer<typeof sukoonVoiceTurnResultSchema>;
export const sukoonVoiceTurnResponseSchema = apiEnvelopeSchema(sukoonVoiceTurnResultSchema);
export type SukoonVoiceTurnResponse = z.infer<typeof sukoonVoiceTurnResponseSchema>;

// ===========================================================================
// F8 — Wellbeing Check-ins (WHO-5 + custom Exam Stress Self-Check).
//
// SAFETY FRAMING (SUKOON_CONTEXT hard rules): these are SELF-REFLECTION tools,
// never clinical screeners. No banned vocabulary (therapy/diagnosis/clinical/…)
// appears in any item or result copy. The custom check is deliberately NOT a
// PHQ/GAD-style instrument — it's authored, exam-aspirant-specific, gentle.
//
// The question COPY lives here (one source of truth for both the API — which
// validates answer shape + scores server-side — and the FE, which renders it),
// NOT seeded into the DB: sukoon_checkins stores only answers_json + score, so
// re-wording an item is a code change, never a data migration.
// ===========================================================================

/** The two check-in kinds (mirrors sukoon_checkins.type CHECK constraint). */
export const sukoonCheckinTypeSchema = z.enum(["who5", "stress_self_check"]);
export type SukoonCheckinType = z.infer<typeof sukoonCheckinTypeSchema>;

/** One selectable point on a check-in's frequency scale, bilingual. */
export interface SukoonScaleOption {
  value: number;
  label_hi: string;
  label_en: string;
}

/** One check-in item (a statement the user rates by frequency), bilingual. */
export interface SukoonCheckinItem {
  id: string;
  text_hi: string;
  text_en: string;
  /**
   * When true, the item is worded in the COPING/steadying direction, so a
   * higher answer means LESS stress-load — the score flips it (max - answer).
   * WHO-5 items are all positive-direction (never reversed).
   */
  reverse?: boolean;
}

/**
 * WHO-5 Wellbeing Index (public domain). Five positively-worded domains rated
 * "over the last two weeks", each 0 (at no time) … 5 (all of the time). Items
 * are phrased as short feeling-states (not full first-person sentences) so they
 * read cleanly on a rating card AND sidestep Hindi verb-gender agreement.
 */
export const SUKOON_WHO5_SCALE: readonly SukoonScaleOption[] = [
  { value: 0, label_hi: "कभी नहीं", label_en: "At no time" },
  { value: 1, label_hi: "कभी-कभार", label_en: "Some of the time" },
  { value: 2, label_hi: "आधे से कम समय", label_en: "Less than half the time" },
  { value: 3, label_hi: "आधे से ज़्यादा समय", label_en: "More than half the time" },
  { value: 4, label_hi: "ज़्यादातर समय", label_en: "Most of the time" },
  { value: 5, label_hi: "हर समय", label_en: "All of the time" },
] as const;

export const SUKOON_WHO5_ITEMS: readonly SukoonCheckinItem[] = [
  { id: "cheerful", text_hi: "खुशी और अच्छा मन", text_en: "Cheerful and in good spirits" },
  { id: "calm", text_hi: "शांति और तनावमुक्ति", text_en: "Calm and relaxed" },
  { id: "active", text_hi: "सक्रियता और ऊर्जा", text_en: "Active and energetic" },
  { id: "rested", text_hi: "सुबह तरोताज़ा और आराम भरी नींद", text_en: "Waking up fresh and rested" },
  { id: "interested", text_hi: "दिन में रुचि जगाने वाली बातें", text_en: "Daily life filled with things that interest me" },
] as const;

/**
 * Exam Stress Self-Check — AUTHORED, non-clinical, exam-aspirant-specific.
 * Rated "over the last two weeks", each 0 (never) … 4 (almost always). Four
 * items name common aspirant pressures; the fifth is a steadying/support item
 * (reverse-scored) so the tool never reads as an all-negative checklist and the
 * result can acknowledge what's already helping.
 */
export const SUKOON_STRESS_CHECK_SCALE: readonly SukoonScaleOption[] = [
  { value: 0, label_hi: "कभी नहीं", label_en: "Never" },
  { value: 1, label_hi: "कभी-कभार", label_en: "Rarely" },
  { value: 2, label_hi: "कभी-कभी", label_en: "Sometimes" },
  { value: 3, label_hi: "अक्सर", label_en: "Often" },
  { value: 4, label_hi: "लगभग हमेशा", label_en: "Almost always" },
] as const;

export const SUKOON_STRESS_CHECK_ITEMS: readonly SukoonCheckinItem[] = [
  {
    id: "overwhelm",
    text_hi: "पढ़ाई का बोझ संभाल पाने से ज़्यादा महसूस हुआ",
    text_en: "Studies felt like more than I could handle",
  },
  {
    id: "comparison",
    text_hi: "दूसरों से अपनी तैयारी की तुलना करके खुद को पीछे महसूस किया",
    text_en: "Comparing my preparation to others, I felt behind",
  },
  {
    id: "result_worry",
    text_hi: "नतीजे की चिंता ने ध्यान लगाना या आराम करना मुश्किल किया",
    text_en: "Worry about the result made it hard to focus or rest",
  },
  {
    id: "self_worth",
    text_hi: "लगा कि मेरी अहमियत इस परीक्षा के नतीजे पर टिकी है",
    text_en: "It felt like my worth depended on this exam's outcome",
  },
  {
    id: "support",
    text_hi: "मुश्किल पलों में कोई या कुछ था जिसने मुझे संभाला",
    text_en: "In hard moments, I had someone or something that steadied me",
    reverse: true,
  },
] as const;

/** Per-type item + scale bundle, so the FE renders and the API validates from one place. */
export const SUKOON_CHECKIN_DEFS: Record<
  SukoonCheckinType,
  { items: readonly SukoonCheckinItem[]; scale: readonly SukoonScaleOption[]; maxPerItem: number }
> = {
  who5: { items: SUKOON_WHO5_ITEMS, scale: SUKOON_WHO5_SCALE, maxPerItem: 5 },
  stress_self_check: { items: SUKOON_STRESS_CHECK_ITEMS, scale: SUKOON_STRESS_CHECK_SCALE, maxPerItem: 4 },
};

/** Below this WHO-5 percentage, surface the gentle (non-alarm) suggestion card. */
export const SUKOON_WHO5_LOW_THRESHOLD = 50;
/** At/above this stress-load percentage, surface the same gentle suggestion card. */
export const SUKOON_STRESS_HIGH_THRESHOLD = 60;

/**
 * Pure, deterministic scoring (0–100). Shared so the FE can preview a result
 * instantly and the server can recompute authoritatively from the same rule —
 * they can never disagree. WHO-5 is the standard Σ×4; the stress check reverses
 * its coping item, sums to 0–20, then ×5. Answer arrays are assumed already
 * length/range-validated (who5AnswersSchema / the API's stress schema).
 */
export function scoreWho5(answers: number[]): { raw: number; score: number } {
  const raw = answers.reduce((s, a) => s + a, 0);
  return { raw, score: raw * 4 };
}
export function scoreStressSelfCheck(answers: number[]): { raw: number; score: number } {
  const max = SUKOON_CHECKIN_DEFS.stress_self_check.maxPerItem;
  const raw = SUKOON_STRESS_CHECK_ITEMS.reduce(
    (s, item, i) => s + (item.reverse ? max - answers[i] : answers[i]),
    0,
  );
  // 5 items × 0–4 = 0–20 → ×5 → 0–100. Higher = more stress-load.
  return { raw, score: raw * 5 };
}

/** Exactly-5 integer answers, each 0–4, for the stress self-check. */
export const sukoonStressAnswersSchema = z.array(z.number().int().min(0).max(4)).length(5);
export type SukoonStressAnswers = z.infer<typeof sukoonStressAnswersSchema>;

/**
 * POST /checkins — the client submits the type + raw answers only; the server
 * scores it (never trusts a client-sent score) and stores the row. A
 * discriminated union keeps each type's answer shape/scale correct.
 */
export const sukoonCheckinSubmitBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("who5"), answers: who5AnswersSchema }),
  z.object({ type: z.literal("stress_self_check"), answers: sukoonStressAnswersSchema }),
]);
export type SukoonCheckinSubmitBody = z.infer<typeof sukoonCheckinSubmitBodySchema>;

/** One stored check-in as returned to the client (sukoon_checkins). */
export const sukoonCheckinSchema = z.object({
  id: z.string().uuid(),
  type: sukoonCheckinTypeSchema,
  score: z.number(),
  created_at: z.string(),
});
export type SukoonCheckin = z.infer<typeof sukoonCheckinSchema>;

/**
 * POST /checkins response — the freshly-stored row plus a `low` flag that tells
 * the FE whether to show the gentle suggestion card (WHO-5 < 50 OR stress ≥ 60).
 * Deliberately NO diagnosis/label — just "is this a moment to offer support".
 */
export const sukoonCheckinSubmitResponseSchema = apiEnvelopeSchema(
  z.object({ checkin: sukoonCheckinSchema, low: z.boolean() }),
);
export type SukoonCheckinSubmitResponse = z.infer<typeof sukoonCheckinSubmitResponseSchema>;

/**
 * GET /checkins/status — per-type: whether the user has ever taken it, when
 * last, and whether a gentle monthly re-prompt is `due` (no check-in of that
 * type in the last 30 days). Drives the Home/You "time for a check-in?" nudge.
 */
export const sukoonCheckinStatusItemSchema = z.object({
  type: sukoonCheckinTypeSchema,
  last_taken_at: z.string().nullable(),
  last_score: z.number().nullable(),
  due: z.boolean(),
});
export const sukoonCheckinStatusResponseSchema = apiEnvelopeSchema(
  z.object({ items: z.array(sukoonCheckinStatusItemSchema) }),
);
export type SukoonCheckinStatusItem = z.infer<typeof sukoonCheckinStatusItemSchema>;
export type SukoonCheckinStatusResponse = z.infer<typeof sukoonCheckinStatusResponseSchema>;

/**
 * GET /checkins/trend?type=who5 — the score history for one type (oldest→newest),
 * for the trend chart on /sukoon/you. Points carry only date + score (no answers).
 */
export const sukoonCheckinTrendPointSchema = z.object({
  date: isoDateSchema,
  score: z.number(),
});
export const sukoonCheckinTrendResponseSchema = apiEnvelopeSchema(
  z.object({
    type: sukoonCheckinTypeSchema,
    points: z.array(sukoonCheckinTrendPointSchema),
  }),
);
export type SukoonCheckinTrendPoint = z.infer<typeof sukoonCheckinTrendPointSchema>;
export type SukoonCheckinTrendResponse = z.infer<typeof sukoonCheckinTrendResponseSchema>;

// ===========================================================================
// F9 — Weekly Insights Report (Plus+). A warm ~150-word summary + one
// suggestion + one journey recommendation, generated Sunday from the week's
// mood/exercise/journey signals + journal METADATA (never bodies, unless the
// Pro user has opted into deep insights). Stored in sukoon_insights; the model
// output is structured (below) so the FE renders fields, not a blob.
// ===========================================================================

/** The structured shape the Sonnet call must return (see prompts/insights.ts). */
export const sukoonInsightContentSchema = z.object({
  /** The warm ~150-word reflective summary, in the user's language. */
  summary: z.string(),
  /** One gentle, concrete suggestion for the coming week. */
  suggestion: z.string(),
  /** The recommended journey's slug (from the published set), or null. */
  journey_slug: z.string().nullable(),
  /** One line on why that journey fits — empty when journey_slug is null. */
  journey_reason: z.string(),
});
export type SukoonInsightContent = z.infer<typeof sukoonInsightContentSchema>;

/** One weekly insight as returned to the client (sukoon_insights, enriched). */
export const sukoonInsightSchema = z.object({
  id: z.string().uuid(),
  week_start: isoDateSchema,
  content: sukoonInsightContentSchema,
  /** Denormalised for the card: the recommended journey's titles (null if none / unpublished). */
  journey_title_hi: z.string().nullable(),
  journey_title_en: z.string().nullable(),
  created_at: z.string(),
});
export type SukoonInsight = z.infer<typeof sukoonInsightSchema>;

export const sukoonInsightsResponseSchema = apiEnvelopeSchema(
  z.object({
    /** Newest first. Empty for a free user, or a Plus+ user with no insight yet. */
    insights: z.array(sukoonInsightSchema),
    /** The viewer's tier — the FE shows the upsell/sample to free users. */
    tier: sukoonTierSchema,
    /** Whether insights are currently enabled for this user (opt-in + tier). */
    enabled: z.boolean(),
  }),
);
export type SukoonInsightsResponse = z.infer<typeof sukoonInsightsResponseSchema>;

/**
 * A fixed, hand-written SAMPLE insight (never model-generated, never stored) —
 * the upsell preview a FREE user sees so they know what a real weekly insight
 * feels like. Bilingual; the FE picks the field for the UI locale.
 */
export const SUKOON_SAMPLE_INSIGHT: {
  summary_hi: string;
  summary_en: string;
  suggestion_hi: string;
  suggestion_en: string;
} = {
  summary_hi:
    "इस हफ़्ते आपने छह दिन अपना हाल दर्ज किया — यह अपने आप में एक अच्छी आदत है। मंगलवार और बुधवार को मन थोड़ा भारी रहा, अक्सर 'पढ़ाई' और 'तुलना' के साथ जुड़ा हुआ। पर हफ़्ते के आख़िर तक मूड फिर से संभला, और आपने तीन बार साँस वाले अभ्यास भी किए — जो असर छोड़ते हैं। याद रखिए, उतार-चढ़ाव तैयारी का हिस्सा हैं, कोई कमी नहीं।",
  summary_en:
    "This week you checked in on six days — a good habit in itself. Tuesday and Wednesday felt a little heavy, often alongside 'studies' and 'comparison'. But by the weekend your mood steadied again, and you did three breathing exercises too — those add up. Remember, ups and downs are part of preparation, not a shortcoming.",
  suggestion_hi:
    "अगले हफ़्ते, जिस दिन तुलना का मन भारी करे, दो मिनट का box breathing आज़माइए — मन को वापस ज़मीन पर लाने में मदद करता है।",
  suggestion_en:
    "Next week, on a day when comparison weighs on you, try two minutes of box breathing — it helps bring your mind back to solid ground.",
};

// ---------------------------------------------------------------------------
// F11 — "Sukoon Garden" (reminders, streaks & gentle gamification). Shared
// because the Home card's SVG plant, its stage copy, and the backend's growth
// calculation (services/garden.ts) must all agree on the same stage ladder.
//
// HARD ANTI-DARK-PATTERN RULE (blueprint F11, verbatim): the garden "grows
// slowly, never dies or regresses." `growth_points` is therefore a pure,
// monotonically non-decreasing function of the user's own activity history —
// there is deliberately no field anywhere in this contract (or the backend
// that fills it) representing decay, a reset, or a loss. `stage` only ever
// moves forward as `growth_points` rises.
// ---------------------------------------------------------------------------

export const sukoonGardenStageIdSchema = z.enum(["seed", "sprout", "sapling", "tree", "blooming"]);
export type SukoonGardenStageId = z.infer<typeof sukoonGardenStageIdSchema>;

export interface SukoonGardenStageDef {
  id: SukoonGardenStageId;
  /** Minimum cumulative growth_points to be at this stage (0 for the first). */
  min: number;
  label_hi: string;
  label_en: string;
}

/**
 * The ONE ordered stage ladder — index === rank, same convention as
 * SUKOON_CRISIS_LEVELS. `min` values are code constants (not seeded/DB-editable
 * data): a five-stage ladder is deliberately calm and slow, never a fast XP-bar
 * feel (blueprint: "no gamified motion like Neev's Conquest Map").
 */
export const SUKOON_GARDEN_STAGES: readonly SukoonGardenStageDef[] = [
  { id: "seed", min: 0, label_hi: "बीज", label_en: "Seed" },
  { id: "sprout", min: 15, label_hi: "अंकुर", label_en: "Sprout" },
  { id: "sapling", min: 40, label_hi: "पौधा", label_en: "Sapling" },
  { id: "tree", min: 80, label_hi: "पेड़", label_en: "Tree" },
  { id: "blooming", min: 150, label_hi: "खिलता हुआ पेड़", label_en: "Blooming tree" },
] as const;

/** GET /garden — the Home card's one read. */
export const sukoonGardenStateSchema = z.object({
  /** Cumulative, capped-per-IST-day total — see services/garden.ts. Never decreases. */
  growth_points: z.number().int().min(0),
  stage: sukoonGardenStageIdSchema,
  stage_index: z.number().int().min(0),
  stage_count: z.number().int().min(1),
  /** Points needed to reach the NEXT stage; null when already at the last (max) stage. */
  next_stage_threshold: z.number().int().nullable(),
  /** 0–1 progress from the current stage's own threshold toward the next; 1 at the max stage. */
  progress_to_next: z.number().min(0).max(1),
});
export type SukoonGardenState = z.infer<typeof sukoonGardenStateSchema>;
export const sukoonGardenResponseSchema = apiEnvelopeSchema(sukoonGardenStateSchema);
export type SukoonGardenResponse = z.infer<typeof sukoonGardenResponseSchema>;

// ---------------------------------------------------------------------------
// F12 — Privacy Center & DPDP (Session 13). The one contract shared by the
// Privacy Center UI and the /api/sukoon/privacy backend: what's stored, consent
// history, account-deletion lifecycle, and the async data-export job. Deliberately
// exposes NO storage paths or raw ciphertext — only counts, statuses, and
// short-lived download URLs the server mints on demand.
// ---------------------------------------------------------------------------

/**
 * A single "what's stored about you" line: a stable category key (the UI maps
 * it to bilingual copy) + how many rows that category holds for this user. The
 * key set is fixed here so the client never has to know table names.
 */
export const sukoonPrivacyCategorySchema = z.enum([
  "journal_entries",
  "conversations",
  "chat_messages",
  "mood_entries",
  "checkins",
  "exercise_sessions",
  "journey_progress",
  "insights",
  "crisis_events",
]);
export type SukoonPrivacyCategory = z.infer<typeof sukoonPrivacyCategorySchema>;

export const sukoonPrivacyDataCountSchema = z.object({
  key: sukoonPrivacyCategorySchema,
  count: z.number().int().min(0),
});
export type SukoonPrivacyDataCount = z.infer<typeof sukoonPrivacyDataCountSchema>;

/** One versioned consent the user has given (append-only history). */
export const sukoonConsentRecordSchema = z.object({
  consent_version: z.string(),
  consented_at: z.string(),
});
export type SukoonConsentRecord = z.infer<typeof sukoonConsentRecordSchema>;

/**
 * Account-deletion lifecycle. `active` is the normal state; `scheduled_deletion`
 * means the user asked to delete (or withdrew consent) and the account is in the
 * grace window — restorable until `purge_after`, after which the nightly cron
 * hard-erases everything.
 */
export const sukoonAccountStatusSchema = z.enum(["active", "scheduled_deletion"]);
export type SukoonAccountStatus = z.infer<typeof sukoonAccountStatusSchema>;

export const sukoonAccountStateSchema = z.object({
  status: sukoonAccountStatusSchema,
  deleted_at: z.string().nullable(),
  /** Hard-purge deadline; the UI shows a countdown + Restore until this passes. */
  purge_after: z.string().nullable(),
  deletion_reason: z.enum(["user_request", "consent_withdrawn"]).nullable(),
});
export type SukoonAccountState = z.infer<typeof sukoonAccountStateSchema>;

/**
 * Async export job status (F12). No storage paths are exposed — the client polls
 * this, and once `status === "ready"` (and not past `expires_at`) fetches a fresh
 * signed URL per artifact from the download endpoint.
 */
export const sukoonExportStatusSchema = z.enum([
  "pending",
  "processing",
  "ready",
  "failed",
  "expired",
]);
export type SukoonExportStatus = z.infer<typeof sukoonExportStatusSchema>;

export const sukoonExportJobSchema = z.object({
  id: z.string().uuid(),
  status: sukoonExportStatusSchema,
  /** Populated only when status === "failed" (a short, non-sensitive reason). */
  error: z.string().nullable(),
  entry_count: z.number().int().nullable(),
  has_json: z.boolean(),
  has_journal: z.boolean(),
  requested_at: z.string(),
  completed_at: z.string().nullable(),
  expires_at: z.string().nullable(),
});
export type SukoonExportJob = z.infer<typeof sukoonExportJobSchema>;

/** One line of the user-visible privacy-action audit trail. */
export const sukoonPrivacyAuditItemSchema = z.object({
  action: z.enum([
    "export_requested",
    "export_ready",
    "export_failed",
    "delete_requested",
    "delete_cancelled",
    "consent_withdrawn",
    "account_purged",
  ]),
  created_at: z.string(),
});
export type SukoonPrivacyAuditItem = z.infer<typeof sukoonPrivacyAuditItemSchema>;

/** GET /privacy/summary — everything the Privacy Center needs in one read. */
export const sukoonPrivacySummarySchema = z.object({
  data_counts: z.array(sukoonPrivacyDataCountSchema),
  consents: z.array(sukoonConsentRecordSchema),
  /** The server's CURRENT consent version + whether the user is on it. */
  current_consent_version: z.string(),
  consent_current: z.boolean(),
  account: sukoonAccountStateSchema,
  /** The user's most recent export job, if any (drives the export card). */
  latest_export: sukoonExportJobSchema.nullable(),
  recent_actions: z.array(sukoonPrivacyAuditItemSchema),
});
export type SukoonPrivacySummary = z.infer<typeof sukoonPrivacySummarySchema>;
export const sukoonPrivacySummaryResponseSchema = apiEnvelopeSchema(sukoonPrivacySummarySchema);
export type SukoonPrivacySummaryResponse = z.infer<typeof sukoonPrivacySummaryResponseSchema>;

/** POST /privacy/export and GET /privacy/export both return the job. */
export const sukoonExportJobResponseSchema = apiEnvelopeSchema(sukoonExportJobSchema);
export type SukoonExportJobResponse = z.infer<typeof sukoonExportJobResponseSchema>;

/** Which artifact of a ready export to download. */
export const sukoonExportArtifactSchema = z.enum(["json", "journal"]);
export type SukoonExportArtifact = z.infer<typeof sukoonExportArtifactSchema>;

/** GET /privacy/export/:id/download → a fresh, short-lived signed URL. */
export const sukoonExportDownloadSchema = z.object({
  url: z.string().url(),
  expires_at: z.string(),
});
export const sukoonExportDownloadResponseSchema = apiEnvelopeSchema(sukoonExportDownloadSchema);
export type SukoonExportDownloadResponse = z.infer<typeof sukoonExportDownloadResponseSchema>;

/**
 * POST /privacy/delete and /privacy/consent/withdraw. The typed-to-confirm guard
 * ("type DELETE") is a UI affordance; the server just requires an explicit
 * `confirm: true` so a request can never soft-delete an account by accident.
 */
export const sukoonDeleteAccountBodySchema = z.object({
  confirm: z.literal(true),
});
export type SukoonDeleteAccountBody = z.infer<typeof sukoonDeleteAccountBodySchema>;

/** Delete / cancel-delete / withdraw all return the fresh account state. */
export const sukoonAccountStateResponseSchema = apiEnvelopeSchema(sukoonAccountStateSchema);
export type SukoonAccountStateResponse = z.infer<typeof sukoonAccountStateResponseSchema>;

// ---------------------------------------------------------------------------
// Admin cost dashboard (Session 13 hardening) — per-model daily Sukoon spend,
// read from the shared llm_calls ledger (purpose LIKE 'sukoon_%'). Admin-only.
// ---------------------------------------------------------------------------

/** One (purpose, model) rollup over the window. */
export const sukoonCostRowSchema = z.object({
  purpose: z.string(),
  model: z.string(),
  calls: z.number().int().min(0),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cost_usd: z.number().min(0),
});
export type SukoonCostRow = z.infer<typeof sukoonCostRowSchema>;

/** One calendar day's total Sukoon spend (for the daily-trend view). */
export const sukoonCostDaySchema = z.object({
  date: z.string(),
  cost_usd: z.number().min(0),
  calls: z.number().int().min(0),
});
export type SukoonCostDay = z.infer<typeof sukoonCostDaySchema>;

export const sukoonCostSummarySchema = z.object({
  days: z.number().int().min(1),
  since: z.string(),
  total_cost_usd: z.number().min(0),
  total_calls: z.number().int().min(0),
  by_purpose_model: z.array(sukoonCostRowSchema),
  daily: z.array(sukoonCostDaySchema),
});
export type SukoonCostSummary = z.infer<typeof sukoonCostSummarySchema>;
export const sukoonCostSummaryResponseSchema = apiEnvelopeSchema(sukoonCostSummarySchema);
export type SukoonCostSummaryResponse = z.infer<typeof sukoonCostSummaryResponseSchema>;
