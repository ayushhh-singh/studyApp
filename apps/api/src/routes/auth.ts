import { Router } from "express";
import { claimTrialResponseSchema, guestGateResponseSchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { rateLimitByIp } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { claimTrial } from "../services/trial.js";
import { getEntitlements } from "../services/entitlements.js";

/**
 * PUBLIC guest checkpoint — mounted BEFORE requireAuth (there is no session yet).
 *
 * The web app calls POST /auth/guest before it runs supabase.auth
 * .signInAnonymously(). This is the app-level per-IP gate on guest-session
 * creation, DELIBERATELY separate from the per-user rateLimit() used everywhere
 * else. It does NOT itself create the session (the browser does that directly
 * against Supabase Auth, so GoTrue sees the true client IP for its own
 * unbypassable `anonymous_users` per-IP rate limit — the real backstop). This
 * layer exists for a graceful, localized "you've opened a lot of guest sessions,
 * create a free account" nudge before GoTrue's opaque 429, and for in-repo
 * tunability / a future CAPTCHA hook.
 *
 * Limit: 10 guest sessions / hour / IP. Reasoning: a real visitor needs at most
 * one guest session per device; 10/hr tolerates modest shared-NAT usage (hostel/
 * college/library — common for UPPSC aspirants) and repeated cookie-clears while
 * stopping scripted mass-creation. It sits UNDER Supabase's native 30/hr/IP so
 * our friendly nudge fires first for well-behaved clients; anyone past it is
 * nudged to sign up (a real account isn't IP-throttled the same way), which is
 * exactly the conversion we want.
 */
export const guestAuthPublicRouter = Router();

guestAuthPublicRouter.post(
  "/auth/guest",
  rateLimitByIp({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: "You've started several guest sessions from this network recently. Create a free account to keep going — it's quick and unlocks your 7-day Pro trial.",
  }),
  asyncHandler(async (_req, res) => {
    res.json(guestGateResponseSchema.parse({ data: { ok: true }, error: null }));
  }),
);

/**
 * AUTHENTICATED — mounted AFTER requireAuth. Called by the web app right after
 * an anonymous session is upgraded to a real identity, to grant the 7-day trial
 * that the signup trigger cannot (see services/trial.ts::claimTrial). Idempotent.
 */
export const guestAuthRouter = Router();

guestAuthRouter.post(
  "/auth/claim-trial",
  asyncHandler(async (req, res) => {
    const userId = currentUserId();
    const result = await claimTrial(userId, req.ip ?? null);
    const entitlements = await getEntitlements(userId);
    res.json(claimTrialResponseSchema.parse({ data: { granted: result.granted, entitlements }, error: null }));
  }),
);
