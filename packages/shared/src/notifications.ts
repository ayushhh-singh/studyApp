import { z } from "zod";
import { apiEnvelopeSchema, bilingualTextSchema } from "./types";

/**
 * Scheduled in-app notifications (quiz ready, streak at risk, SRS due). Consumed
 * in-app via the notification bell for now; web push (Session 21) reads the same
 * rows.
 */
export const notificationTypeSchema = z.enum(["quiz_ready", "streak_at_risk", "srs_due"]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationStatusSchema = z.enum(["pending", "read", "dismissed"]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: notificationTypeSchema,
  status: notificationStatusSchema,
  scheduled_for: z.string(),
  title_i18n: bilingualTextSchema,
  body_i18n: bilingualTextSchema,
  link: z.string().nullable(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread_count: z.number().int(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const notificationListResponseSchema = apiEnvelopeSchema(notificationListSchema);
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationResponseSchema = apiEnvelopeSchema(notificationSchema);
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;
