import { z } from "zod";
import { apiEnvelopeSchema } from "./types";
import { notificationTypeSchema } from "./notifications";

export const pushSubscribeBodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  user_agent: z.string().max(300).optional(),
});
export type PushSubscribeBody = z.infer<typeof pushSubscribeBodySchema>;

export const pushUnsubscribeBodySchema = z.object({
  endpoint: z.string().url(),
});
export type PushUnsubscribeBody = z.infer<typeof pushUnsubscribeBodySchema>;

export const pushPreferencesSchema = z.object({
  quiz_ready: z.boolean(),
  streak_at_risk: z.boolean(),
  srs_due: z.boolean(),
});
export type PushPreferences = z.infer<typeof pushPreferencesSchema>;

export const pushStatusSchema = z.object({
  subscribed: z.boolean(),
  preferences: pushPreferencesSchema,
});
export type PushStatus = z.infer<typeof pushStatusSchema>;

export const pushStatusResponseSchema = apiEnvelopeSchema(pushStatusSchema);
export type PushStatusResponse = z.infer<typeof pushStatusResponseSchema>;

export const pushPreferencesResponseSchema = apiEnvelopeSchema(pushPreferencesSchema);
export type PushPreferencesResponse = z.infer<typeof pushPreferencesResponseSchema>;

export const updatePushPreferencesBodySchema = pushPreferencesSchema.partial();
export type UpdatePushPreferencesBody = z.infer<typeof updatePushPreferencesBodySchema>;

/** Payload shape the service worker's push handler expects, mirrored server-side. */
export const pushPayloadSchema = z.object({
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  tag: z.string(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

export const okResponseSchema = apiEnvelopeSchema(z.object({ ok: z.literal(true) }));
