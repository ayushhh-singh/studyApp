import { Router, raw } from "express";
import { createHash } from "node:crypto";
import {
  createOrderBodySchema,
  createOrderResponseSchema,
  entitlementsResponseSchema,
  plansResponseSchema,
  subscriptionResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { logger } from "../lib/logger.js";
import { verifyWebhookSignature } from "../lib/razorpay.js";
import { createOrder, getBillingState, listPlans, processWebhookEvent } from "../services/billing.js";
import { getEntitlements } from "../services/entitlements.js";

// ---------------------------------------------------------------------------
// Public billing router (mounted BEFORE requireAuth) — /pricing is a public
// marketing page, so the plan list it renders (name/price/description, all
// DB data with nothing user-specific) must be reachable signed-out too.
// ---------------------------------------------------------------------------
export const billingPublicRouter = Router();
billingPublicRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

/** Public list of active plans (pricing lives in the DB, not the client). */
billingPublicRouter.get(
  "/billing/plans",
  asyncHandler(async (_req, res) => {
    const plans = await listPlans();
    res.json(plansResponseSchema.parse({ data: { plans }, error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Authed billing router (mounted after requireAuth)
// ---------------------------------------------------------------------------
export const billingRouter = Router();
billingRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

/** Current user's subscription + entitlements snapshot. */
billingRouter.get(
  "/billing/subscription",
  asyncHandler(async (_req, res) => {
    const state = await getBillingState(currentUserId());
    res.json(subscriptionResponseSchema.parse({ data: state, error: null }));
  }),
);

/** Entitlement snapshot for quota chips + client-side gates. */
billingRouter.get(
  "/entitlements",
  asyncHandler(async (_req, res) => {
    const entitlements = await getEntitlements(currentUserId());
    res.json(entitlementsResponseSchema.parse({ data: entitlements, error: null }));
  }),
);

/** Create a Razorpay order server-side; the SPA opens checkout.js against it. */
billingRouter.post(
  "/billing/order",
  asyncHandler(async (req, res) => {
    const { plan_code } = parse(createOrderBodySchema, req.body);
    const order = await createOrder(currentUserId(), plan_code);
    res.status(201).json(createOrderResponseSchema.parse({ data: order, error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Public webhook router — mounted BEFORE express.json() and requireAuth, with a
// raw-body parser so the HMAC signature can be verified against exact bytes.
// ---------------------------------------------------------------------------
export const billingWebhookRouter = Router();

billingWebhookRouter.post(
  "/billing/webhook",
  raw({ type: "*/*" }),
  asyncHandler(async (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.header("x-razorpay-signature");

    if (!verifyWebhookSignature(rawBody, signature)) {
      logger.warn("billing webhook: invalid signature");
      res.status(400).json({ data: null, error: "invalid signature" });
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ data: null, error: "invalid json" });
      return;
    }

    // Razorpay sends x-razorpay-event-id; fall back to a hash of the body so
    // idempotency still holds if the header is ever absent.
    const eventId = req.header("x-razorpay-event-id") ?? createHash("sha256").update(rawBody).digest("hex");

    const result = await processWebhookEvent(eventId, event);
    // Always 200 on a verified webhook (even duplicates / unhandled types) so
    // Razorpay doesn't retry a successfully-received event.
    res.status(200).json({ data: result, error: null });
  }),
);
