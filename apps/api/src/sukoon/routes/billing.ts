import { Router, raw } from "express";
import { createHash } from "node:crypto";
import {
  sukoonBillingStateResponseSchema,
  sukoonCancelResponseSchema,
  sukoonCreateOrderBodySchema,
  sukoonCreateOrderResponseSchema,
  sukoonEntitlementsResponseSchema,
  sukoonPlansResponseSchema,
  sukoonTrialResponseSchema,
} from "@neev/shared";
import { asyncHandler } from "../../lib/async-handler.js";
import { parse } from "../../lib/validation.js";
import { rateLimit } from "../../lib/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { currentUserId } from "../../lib/user-context.js";
import { logger } from "../../lib/logger.js";
import { verifyWebhookSignature } from "../../lib/razorpay.js";
import {
  cancelSukoonSubscription,
  createSukoonOrder,
  getSukoonBillingState,
  listSukoonPlans,
  processSukoonWebhookEvent,
  startSukoonTrial,
} from "../services/billing.js";
import {
  SUKOON_BUNDLE_DISCOUNT_PCT,
  getSukoonEntitlements,
} from "../services/entitlements.js";
import { hasActivePaidNeevPlan } from "../lib/neev-bridge.js";

/**
 * Sukoon billing (F13). Mounted under /api/sukoon (its own namespace). The
 * feature router attaches requireAuth itself (Sukoon is authenticated-only —
 * there's no public/anon Sukoon surface). The WEBHOOK is a separate router
 * (below) mounted BEFORE express.json in index.ts so the HMAC can verify raw
 * bytes — the exact shape Neev's billingWebhookRouter uses.
 */
export const sukoonBillingRouter = Router();
sukoonBillingRouter.use(requireAuth);
sukoonBillingRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

/** The Sukoon plan catalog + this user's bundle eligibility (so the pricing page
 *  can render discounted prices inline). */
sukoonBillingRouter.get(
  "/billing/plans",
  asyncHandler(async (_req, res) => {
    const userId = currentUserId();
    const [plans, bundleEligible] = await Promise.all([
      listSukoonPlans(),
      hasActivePaidNeevPlan(userId),
    ]);
    res.json(
      sukoonPlansResponseSchema.parse({
        data: { plans, bundle_eligible: bundleEligible, bundle_discount_pct: SUKOON_BUNDLE_DISCOUNT_PCT },
        error: null,
      }),
    );
  }),
);

/** The manage screen's read: current subscription row + full entitlements. */
sukoonBillingRouter.get(
  "/billing/subscription",
  asyncHandler(async (_req, res) => {
    const state = await getSukoonBillingState(currentUserId());
    res.json(sukoonBillingStateResponseSchema.parse({ data: state, error: null }));
  }),
);

/** The lightweight entitlements snapshot (quota chips + client-side gates). */
sukoonBillingRouter.get(
  "/billing/entitlements",
  asyncHandler(async (_req, res) => {
    const entitlements = await getSukoonEntitlements(currentUserId());
    res.json(sukoonEntitlementsResponseSchema.parse({ data: entitlements, error: null }));
  }),
);

/** Create a Razorpay order server-side (authoritative amount + bundle discount). */
sukoonBillingRouter.post(
  "/billing/order",
  asyncHandler(async (req, res) => {
    const { plan_code } = parse(sukoonCreateOrderBodySchema, req.body);
    const order = await createSukoonOrder(currentUserId(), plan_code);
    res.status(201).json(sukoonCreateOrderResponseSchema.parse({ data: order, error: null }));
  }),
);

/** Start the one-time 7-day Pro trial. 400 if already used. */
sukoonBillingRouter.post(
  "/billing/trial",
  asyncHandler(async (_req, res) => {
    const subscription = await startSukoonTrial(currentUserId());
    res.status(201).json(sukoonTrialResponseSchema.parse({ data: { subscription }, error: null }));
  }),
);

/** Cancel — stop continuation, keep access until period end (data never deleted). */
sukoonBillingRouter.post(
  "/billing/cancel",
  asyncHandler(async (_req, res) => {
    const subscription = await cancelSukoonSubscription(currentUserId());
    res.json(sukoonCancelResponseSchema.parse({ data: { subscription }, error: null }));
  }),
);

// ---------------------------------------------------------------------------
// Public webhook router — mounted BEFORE express.json() and requireAuth, with a
// raw-body parser so the HMAC signature verifies against exact bytes. Mirrors
// Neev's billingWebhookRouter exactly (shared webhook secret; a shared Razorpay
// account delivers every event to both webhook URLs — each ignores the other's).
// ---------------------------------------------------------------------------
export const sukoonBillingWebhookRouter = Router();

sukoonBillingWebhookRouter.post(
  "/billing/webhook",
  raw({ type: "*/*" }),
  asyncHandler(async (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.header("x-razorpay-signature");

    if (!verifyWebhookSignature(rawBody, signature)) {
      logger.warn("sukoon billing webhook: invalid signature");
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

    const eventId =
      req.header("x-razorpay-event-id") ?? createHash("sha256").update(rawBody).digest("hex");

    const result = await processSukoonWebhookEvent(eventId, event);
    // Always 200 on a verified webhook (even duplicates / not-ours) so Razorpay
    // doesn't retry a successfully-received event.
    res.status(200).json({ data: result, error: null });
  }),
);
