/**
 * Thin Razorpay layer: config, server-side order creation (REST, no SDK
 * dependency), and webhook signature verification.
 *
 * Test mode: set RAZORPAY_KEY_ID (rzp_test_…), RAZORPAY_KEY_SECRET, and
 * RAZORPAY_WEBHOOK_SECRET in apps/api/.env. The key id is browser-safe (returned
 * to the SPA for checkout.js); the secret and webhook secret never leave here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http-error.js";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Throws a clear 500 if Razorpay isn't configured (rather than a vague fetch error). */
export function razorpayConfig(): RazorpayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret || !webhookSecret) {
    throw new HttpError(
      500,
      "Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET in apps/api/.env)",
    );
  }
  return { keyId, keySecret, webhookSecret };
}

/** Public key id for the browser's checkout.js (never the secret). */
export function razorpayKeyId(): string {
  return razorpayConfig().keyId;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Create an order server-side (POST https://api.razorpay.com/v1/orders). The
 * amount is authoritative here — the client never sends a price, only a
 * plan_code the server prices from the DB.
 */
export async function createRazorpayOrder(input: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  const { keyId, keySecret } = razorpayConfig();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(502, `Razorpay order creation failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as RazorpayOrder;
}

/**
 * Verify a webhook body against the shared webhook secret. `rawBody` MUST be the
 * exact bytes Razorpay signed — verify BEFORE JSON parsing (see the raw-body
 * mount in index.ts). Timing-safe compare.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const { webhookSecret } = razorpayConfig();
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
