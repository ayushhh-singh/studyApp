/**
 * Thin Razorpay layer: config, server-side order creation (REST, no SDK
 * dependency), and webhook signature verification.
 *
 * TEST vs LIVE mode: the mode is derived authoritatively from the
 * RAZORPAY_KEY_ID prefix — `rzp_test_…` = test, `rzp_live_…` = live (Razorpay's
 * own convention; the secret + webhook secret carry no prefix, so the key id is
 * the only self-describing signal). Set the trio (RAZORPAY_KEY_ID,
 * RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET) to a single mode's credentials.
 * The key id is browser-safe (returned to the SPA for checkout.js); the secret
 * and webhook secret never leave here.
 *
 * Guarding against a SILENT test/live mix: optionally set RAZORPAY_MODE=test|live
 * to DECLARE the intended mode. `razorpayConfig()` then refuses to transact
 * (throws) if the declared mode disagrees with the key id's prefix, or if the
 * prefix is unrecognized — so e.g. a live key left behind a `RAZORPAY_MODE=test`
 * (or the reverse: going live but forgetting to swap a test key) fails loudly at
 * the first order/webhook instead of quietly charging real cards in the wrong
 * mode. The effective mode is logged at boot and surfaced (admins only) on
 * GET /admin/status — never silent. NOTE: the webhook secret cannot be validated
 * by prefix, so ensure it belongs to the SAME mode as the key id when you switch;
 * the boot log + admin badge make the active mode obvious for that cross-check.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http-error.js";

export type RazorpayMode = "test" | "live";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  mode: RazorpayMode;
}

/** Razorpay's own convention: the key id prefix is the source of truth for mode. */
function modeFromKeyId(keyId: string): RazorpayMode | null {
  if (keyId.startsWith("rzp_live_")) return "live";
  if (keyId.startsWith("rzp_test_")) return "test";
  return null;
}

/**
 * Parse the operator's DECLARED mode via RAZORPAY_MODE. Returns the mode, the
 * literal "invalid" when it's set to something other than test|live (a typo like
 * "production"/"liv" must NOT be silently ignored — that would defeat the whole
 * point of the pin), or null when unset.
 */
function declaredMode(): RazorpayMode | "invalid" | null {
  const raw = process.env.RAZORPAY_MODE?.trim();
  if (!raw) return null;
  const lc = raw.toLowerCase();
  return lc === "test" || lc === "live" ? lc : "invalid";
}

/**
 * Throws a clear 500 if Razorpay isn't configured, the key prefix is malformed,
 * or the declared RAZORPAY_MODE disagrees with the key — so no order or webhook
 * is ever processed under an ambiguous or mixed test/live configuration.
 */
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
  const mode = modeFromKeyId(keyId);
  if (!mode) {
    throw new HttpError(
      500,
      "Razorpay key id has an unrecognized prefix (expected rzp_test_ or rzp_live_) — refusing to transact with a malformed key.",
    );
  }
  const declared = declaredMode();
  if (declared === "invalid") {
    throw new HttpError(
      500,
      `RAZORPAY_MODE is set to an unrecognized value (expected "test" or "live") — refusing to transact rather than silently ignore an intended mode pin.`,
    );
  }
  if (declared && declared !== mode) {
    throw new HttpError(
      500,
      `Razorpay mode mismatch: RAZORPAY_MODE=${declared} but RAZORPAY_KEY_ID is a ${mode} key — refusing to transact to avoid mixing test/live credentials. Fix the env so both agree.`,
    );
  }
  return { keyId, keySecret, webhookSecret, mode };
}

export interface RazorpayStatus {
  configured: boolean;
  mode: RazorpayMode | null;
  /** RAZORPAY_MODE declared by the operator, if any. */
  declared: RazorpayMode | null;
  /** True when the config is present but inconsistent (mismatch / bad prefix). */
  misconfigured: boolean;
  detail: string;
}

/**
 * Non-throwing snapshot of the billing config for the boot log + admin surface.
 * Mirrors razorpayConfig()'s validation without throwing, so it can report a
 * misconfiguration loudly rather than only failing at the first transaction.
 */
export function razorpayStatus(): RazorpayStatus {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const declaredRaw = declaredMode();
  const declared = declaredRaw === "invalid" ? null : declaredRaw;
  if (!keyId || !keySecret || !webhookSecret) {
    return {
      configured: false,
      mode: null,
      declared,
      misconfigured: false,
      detail: "not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET unset)",
    };
  }
  const mode = modeFromKeyId(keyId);
  if (declaredRaw === "invalid") {
    return {
      configured: true,
      mode,
      declared: null,
      misconfigured: true,
      detail: `RAZORPAY_MODE is set to an unrecognized value (expected test or live)`,
    };
  }
  if (!mode) {
    return {
      configured: true,
      mode: null,
      declared,
      misconfigured: true,
      detail: "RAZORPAY_KEY_ID has an unrecognized prefix (expected rzp_test_ or rzp_live_)",
    };
  }
  if (declared && declared !== mode) {
    return {
      configured: true,
      mode,
      declared,
      misconfigured: true,
      detail: `RAZORPAY_MODE=${declared} disagrees with the ${mode} key id`,
    };
  }
  return { configured: true, mode, declared, misconfigured: false, detail: `${mode} mode` };
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
