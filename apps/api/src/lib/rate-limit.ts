import type { RequestHandler } from "express";
import { HttpError } from "./http-error.js";
import { currentUserId } from "./user-context.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-route in-memory rate limit, keyed by the AUTHENTICATED USER ID rather than
 * the client IP. Every router this mounts on sits behind requireAuth, so the
 * user is always bound in the async context by the time the limiter runs; we
 * fall back to req.ip only in the defensive case of no user context (e.g. a
 * misordered mount). Keying by user prevents one user's burst from throttling
 * everyone behind a shared NAT/proxy, and stops a single user from evading the
 * limit by rotating source IPs.
 *
 * DEPLOY NOTE: this store is in-process, so it is per-instance. A real
 * multi-instance / autoscaled deployment MUST swap this Map for a shared store
 * (Redis, Upstash, or Postgres) keyed the same way, or each instance enforces
 * only its own slice of the limit. Single-instance dev/staging is fine as-is.
 */
export function rateLimit(opts: { windowMs: number; max: number }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (req, _res, next) => {
    let key: string;
    try {
      key = `u:${currentUserId()}`;
    } catch {
      key = `ip:${req.ip ?? "unknown"}`;
    }
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      next(new HttpError(429, "Too many requests — slow down."));
      return;
    }
    next();
  };
}
