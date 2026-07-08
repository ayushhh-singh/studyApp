import webpush from "web-push";
import { logger } from "./logger.js";

let configured = false;

/** True once VAPID keys are present — every push call site checks this and no-ops otherwise, so a dev machine without keys configured just runs with push silently disabled. */
export function pushConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  authKey: string;
}

export type PushSendResult = "sent" | "gone" | "error";

/** Sends one payload to one subscription. Never throws — the caller (sender job) needs a per-subscription result to decide whether to prune it. */
export async function sendPush(target: PushTarget, payload: unknown): Promise<PushSendResult> {
  if (!pushConfigured()) return "error";
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.authKey },
      },
      JSON.stringify(payload),
    );
    return "sent";
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return "gone";
    logger.warn({ err, endpoint: target.endpoint }, "push send failed");
    return "error";
  }
}
