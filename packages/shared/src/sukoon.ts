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
