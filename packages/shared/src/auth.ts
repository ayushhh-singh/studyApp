import { z } from "zod";
import { apiEnvelopeSchema } from "./types.js";
import { entitlementsSchema } from "./billing.js";

/**
 * POST /auth/guest — a PUBLIC, per-IP-rate-limited checkpoint the web app calls
 * before supabase.auth.signInAnonymously(). 200 → go ahead; 429 → too many
 * guest sessions from this IP (the client nudges the visitor to create an
 * account instead). It mints nothing itself — the anonymous session is created
 * client-side against Supabase Auth directly (so GoTrue sees the real client IP
 * for its own authoritative anonymous_users per-IP limit).
 */
export const guestGateResponseSchema = apiEnvelopeSchema(z.object({ ok: z.boolean() }));
export type GuestGateResponse = z.infer<typeof guestGateResponseSchema>;

/**
 * POST /auth/claim-trial — called by the web app right after an anonymous
 * session is upgraded to a real identity (updateUser / linkIdentity). Grants
 * the 7-day Pro trial that the signup trigger couldn't (conversion is an UPDATE,
 * not an INSERT) and returns the fresh entitlements. Idempotent — `granted` is
 * false if the account already used its trial or is somehow still anonymous.
 */
export const claimTrialResponseSchema = apiEnvelopeSchema(
  z.object({ granted: z.boolean(), entitlements: entitlementsSchema }),
);
export type ClaimTrialResponse = z.infer<typeof claimTrialResponseSchema>;
